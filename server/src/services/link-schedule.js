'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createLogger } = require('../utils/logger');
const { isEditorAttribute, schemaHasEditorFields } = require('../utils/editor-fields');
const { guardQuery, collectGuarded } = require('../utils/publish-guard');
const { extractLinks } = require('../../../shared/quality.mjs');

/**
 * Scheduled external link check (opt-in: `qualityChecks.externalLinks.schedule`).
 *
 * A Strapi cron job (registered in bootstrap, removed in destroy) fires on
 * every process; a one-time key per fire time and a renewed lease in
 * `magic_editor_x_locks` let exactly one process run it. A run:
 *
 * 1. scans every API content type with Magic Editor X fields (top level,
 *    components, dynamic zones) with the Document Service in id-ordered
 *    batches, drafts and published versions, all locales;
 * 2. stores one row per field version with external links
 *    (`magic_editor_x_link_fields`) and marks each distinct URL
 *    (`magic_editor_x_link_urls`);
 * 3. checks at most `maxUrlsPerRun` URLs, least recently checked first,
 *    through the quality service (SSRF-safe fetcher, shared 10-minute cache)
 *    with a run-wide rate limit and a per-host concurrency limit;
 * 4. after a complete scan, deletes rows of entries, fields and URLs that
 *    were not seen (pruning).
 *
 * Logs carry counts only, never URLs, content or ids.
 */

const PROCESS_ID = randomUUID();
const CRON_NAME = 'magic-editor-x:link-check';
const LEASE_KEY = 'links:schedule';
const LEASE_TTL_MS = 5 * 60 * 1000;
const FIRE_KEY_TTL_MS = 26 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const CHECK_CHUNK = 50;
const CONCURRENCY = 4;
const STATE_KEY = 'linkSchedule';
const PROBLEMS = new Set(['broken', 'timeout', 'error']);

/**
 * Stable key of one field version.
 * @param {{ uid: string, documentId: string, locale: string|null, field: string, version: string }} target - Target.
 * @returns {string} sha256 hex.
 */
const fieldKey = ({ uid, documentId, locale, field, version }) =>
  createHash('sha256')
    .update(`${uid}|${documentId}|${locale || '-'}|${field}|${version}`)
    .digest('hex');

/**
 * @param {string} url - URL.
 * @returns {string} sha256 hex.
 */
const urlHash = (url) => createHash('sha256').update(url).digest('hex');

/**
 * Host part of a URL for the per-host limit.
 * @param {string} url - URL.
 * @returns {string} Host ('' when unparsable).
 */
const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work(item)` for every item with at most `concurrency` in flight and
 * at most `perHost` per host. `beforeStart` runs before each item starts (rate limit).
 * @template T
 * @param {T[]} items - Items with a `url`.
 * @param {{ concurrency: number, perHost: number, beforeStart: () => Promise<boolean>, work: (item: T) => Promise<void> }} options - Limits and work.
 * @returns {Promise<number>} Items started.
 */
const runLimited = async (items, { concurrency, perHost, beforeStart, work }) => {
  const queue = items.slice();
  const active = new Map();
  const inFlight = new Set();
  let started = 0;
  let stopped = false;
  while ((queue.length && !stopped) || inFlight.size) {
    const index =
      inFlight.size < concurrency && !stopped
        ? queue.findIndex((item) => (active.get(hostOf(item.url)) || 0) < perHost)
        : -1;
    if (index === -1) {
      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
      continue;
    }
    if (!(await beforeStart())) {
      stopped = true;
      continue;
    }
    const [item] = queue.splice(index, 1);
    const host = hostOf(item.url);
    active.set(host, (active.get(host) || 0) + 1);
    started += 1;
    const promise = work(item)
      .catch(() => {})
      .finally(() => {
        active.set(host, active.get(host) - 1);
        inFlight.delete(promise);
      });
    inFlight.add(promise);
  }
  return started;
};

module.exports = ({ strapi }, dependencies = {}) => {
  const logger = createLogger(strapi);
  const plugin = () => strapi.plugin('magic-editor-x');
  const store = () => plugin().service('store');
  const quality = () => plugin().service('quality');
  const now = dependencies.now || Date.now;
  const wait = dependencies.sleep || sleep;
  let running = false;
  let stopping = false;
  let scheduled = false;

  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.qualityChecks.externalLinks.${key}`);
    return value === undefined ? fallback : value;
  };

  /**
   * @returns {{ enabled: boolean, rule: string, maxUrlsPerRun: number, perMinute: number, perHostConcurrency: number }} Effective schedule.
   */
  const settings = () => {
    const schedule = conf('schedule', {}) || {};
    return {
      enabled: conf('enabled', false) === true && schedule.enabled === true,
      rule: typeof schedule.rule === 'string' ? schedule.rule : '0 3 * * *',
      maxUrlsPerRun: Number(schedule.maxUrlsPerRun) || 500,
      perMinute: Number(schedule.perMinute) || 60,
      perHostConcurrency: Number(schedule.perHostConcurrency) || 2,
    };
  };

  const pluginStore = () => strapi.store({ type: 'plugin', name: 'magic-editor-x' });

  /**
   * API content types with Magic Editor X fields, with the query that reads them.
   * @returns {Array<{ contentType: object, query: { fields: string[], populate: object } }>} Types.
   */
  const scanTargets = () => {
    const cache = new Map();
    return Object.values(strapi.contentTypes || {})
      .filter((ct) => typeof ct.uid === 'string' && ct.uid.startsWith('api::'))
      .filter((ct) => schemaHasEditorFields(strapi, ct, cache))
      .map((contentType) => ({
        contentType,
        query: guardQuery(strapi, contentType, 0, isEditorAttribute),
      }))
      .filter((target) => target.query)
      .sort((a, b) => a.contentType.uid.localeCompare(b.contentType.uid));
  };

  /**
   * Scans one content type version (draft or published) in id-ordered batches.
   * @param {{ contentType: object, query: object }} target - Type and query.
   * @param {'draft'|'published'} status - Version.
   * @param {{ runId: string, stats: object, renew: () => Promise<void> }} run - Run state.
   * @returns {Promise<void>}
   */
  const scanVersion = async ({ contentType, query }, status, run) => {
    const uid = contentType.uid;
    const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
    const fields = [...new Set([...query.fields, 'documentId', ...(localized ? ['locale'] : [])])];
    let cursor = 0;
    for (;;) {
      if (stopping) throw Object.assign(new Error('stopped'), { code: 'STOPPED' });
      const rows = await strapi.documents(uid).findMany({
        filters: { id: { $gt: cursor } },
        sort: [{ id: 'asc' }],
        limit: BATCH_SIZE,
        status,
        ...(localized ? { locale: '*' } : {}),
        fields,
        ...(Object.keys(query.populate).length ? { populate: query.populate } : {}),
      });
      if (!Array.isArray(rows) || rows.length === 0) return;
      const fieldRows = [];
      const urls = new Map();
      for (const row of rows) {
        cursor = Math.max(cursor, Number(row.id) || 0);
        run.stats.documents += 1;
        for (const { field, value } of collectGuarded(
          strapi,
          contentType,
          row,
          '',
          [],
          0,
          isEditorAttribute
        )) {
          const external = extractLinks(value).external;
          run.stats.fields += 1;
          if (external.length === 0) continue;
          const links = external.map(({ url, blockId }) => {
            const hash = urlHash(url);
            urls.set(hash, url);
            return { h: hash, b: typeof blockId === 'string' ? blockId.slice(0, 64) : '' };
          });
          const target = {
            uid,
            documentId: row.documentId,
            locale: localized && typeof row.locale === 'string' ? row.locale : null,
            field,
            version: status,
          };
          fieldRows.push({ key: fieldKey(target), ...target, links, runId: run.runId, scannedAt: now() });
        }
      }
      await store().markLinkUrls(
        [...urls].map(([hash, url]) => ({ hash, url })),
        run.runId
      );
      await store().saveLinkFields(fieldRows);
      run.stats.linkedFields += fieldRows.length;
      await run.renew();
      if (rows.length < BATCH_SIZE) return;
    }
  };

  /**
   * Checks the URLs of the run within the budget.
   * @param {{ runId: string, startedAt: number, stats: object, renew: () => Promise<void> }} run - Run state.
   * @returns {Promise<void>}
   */
  const checkUrls = async (run) => {
    const { maxUrlsPerRun, perMinute, perHostConcurrency } = settings();
    let budget = maxUrlsPerRun;
    const beforeStart = async () => {
      if (stopping || budget <= 0) return false;
      budget -= 1;
      for (;;) {
        const { count, resetAt } = await store().hit('links:schedule', 60000);
        if (count <= perMinute) return true;
        await run.renew();
        await wait(Math.max(50, resetAt - now() + 50));
        if (stopping) return false;
      }
    };
    while (budget > 0 && !stopping) {
      const rows = await store().linkUrlsToCheck(run.runId, run.startedAt, Math.min(CHECK_CHUNK, budget));
      if (rows.length === 0) return;
      await runLimited(rows, {
        concurrency: CONCURRENCY,
        perHost: perHostConcurrency,
        beforeStart,
        work: async ({ hash, url }) => {
          let result;
          try {
            result = await quality().checkExternalUrl(url);
          } catch {
            result = { status: 'error' };
          }
          await store().setLinkUrlResult(hash, result, now());
          run.stats.checked += 1;
          if (result.cached) run.stats.cached += 1;
          if (PROBLEMS.has(result.status)) run.stats.problems += 1;
        },
      });
      await run.renew();
      if (rows.length < CHECK_CHUNK) return;
    }
  };

  /**
   * The run body. The caller holds the lease.
   * @param {string} trigger - 'cron' or 'manual'.
   * @returns {Promise<object>} Run record (counts only).
   */
  const execute = async (trigger) => {
    const runId = `${now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const startedAt = now();
    const stats = {
      documents: 0,
      fields: 0,
      linkedFields: 0,
      checked: 0,
      cached: 0,
      problems: 0,
      pruned: 0,
    };
    let lost = false;
    const renew = async () => {
      if (!(await store().renew(LEASE_KEY, PROCESS_ID, LEASE_TTL_MS))) {
        lost = true;
        throw Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' });
      }
    };
    const run = { runId, startedAt, stats, renew };
    let complete = true;
    let failure = null;
    try {
      for (const target of scanTargets()) {
        const versions =
          target.contentType.options?.draftAndPublish === true ? ['draft', 'published'] : ['published'];
        for (const version of versions) {
          try {
            await scanVersion(target, version, run);
          } catch (error) {
            if (lost || stopping) throw error;
            complete = false;
            logger.warn('scheduled link check could not scan a content type', error);
          }
        }
      }
      await checkUrls(run);
      if (complete && !stopping) {
        const removed = await store().pruneLinkRows(runId);
        stats.pruned = removed.fields + removed.urls;
      }
    } catch (error) {
      complete = false;
      failure = (error && error.code) || 'FAILED';
      if (!lost && !stopping) logger.error('scheduled link check failed', error);
    }
    const record = {
      trigger,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(now()).toISOString(),
      complete,
      ...(failure ? { failure: String(failure).slice(0, 40) } : {}),
      ...stats,
    };
    if (!lost) {
      try {
        await pluginStore().set({ key: STATE_KEY, value: { lastRun: record } });
      } catch (error) {
        logger.warn('scheduled link check result could not be stored', error);
      }
    }
    logger.info('scheduled link check finished', {
      documents: stats.documents,
      linkedFields: stats.linkedFields,
      checked: stats.checked,
      problems: stats.problems,
      pruned: stats.pruned,
      complete,
    });
    return record;
  };

  /**
   * Takes the cluster lease and starts a run in the background.
   * @param {'cron'|'manual'} trigger - Who started it.
   * @returns {Promise<{ started: boolean, reason?: 'DISABLED'|'RUNNING', done?: Promise<object> }>} Outcome.
   */
  const start = async (trigger) => {
    if (!settings().enabled) return { started: false, reason: 'DISABLED' };
    if (running || !(await store().acquire(LEASE_KEY, PROCESS_ID, LEASE_TTL_MS)))
      return { started: false, reason: 'RUNNING' };
    running = true;
    stopping = false;
    const done = execute(trigger).finally(async () => {
      running = false;
      try {
        await store().release(LEASE_KEY, PROCESS_ID);
      } catch {
        // the lease expires on its own
      }
    });
    return { started: true, done };
  };

  const api = {
    CRON_NAME,
    LEASE_KEY,
    fieldKey,
    urlHash,
    runLimited,

    /** @returns {ReturnType<typeof settings>} Effective schedule settings. */
    settings,

    /**
     * Registers the cron job when the schedule is enabled. Every process
     * registers it; `onCron` makes sure one process runs per fire time.
     * @returns {boolean} True when a job was registered.
     */
    schedule() {
      const { enabled, rule } = settings();
      if (!enabled || !strapi.cron || typeof strapi.cron.add !== 'function') return false;
      strapi.cron.add({
        [CRON_NAME]: {
          task: (_context, fireDate) => api.onCron(fireDate),
          options: { rule },
        },
      });
      scheduled = Array.isArray(strapi.cron.jobs)
        ? strapi.cron.jobs.some((job) => job && job.name === CRON_NAME)
        : true;
      if (!scheduled) logger.error('scheduled link check could not be registered (check the cron rule)');
      return scheduled;
    },

    /**
     * Cron entry point. One process per fire time (one-time key), one run at a time (lease).
     * @param {Date} [fireDate] - Planned fire time from the cron service.
     * @returns {Promise<object|null>} Run record, or null when another process runs it.
     */
    async onCron(fireDate) {
      const at = fireDate instanceof Date && !Number.isNaN(fireDate.getTime()) ? fireDate : new Date(now());
      const minute = Math.floor(at.getTime() / 60000);
      try {
        if (!(await store().acquire(`linkrun:${minute}`, PROCESS_ID, FIRE_KEY_TTL_MS))) return null;
        const outcome = await start('cron');
        return outcome.started ? await outcome.done : null;
      } catch (error) {
        logger.error('scheduled link check could not start', error);
        return null;
      }
    },

    /**
     * Starts a run now (admin route). Resolves when the run has started.
     * @returns {Promise<{ started: boolean, reason?: string }>} Outcome.
     */
    async runNow() {
      const outcome = await start('manual');
      if (outcome.started) {
        outcome.done.catch(() => {});
        return { started: true };
      }
      return outcome;
    },

    /**
     * Runs once and waits (tests, CLI).
     * @param {'cron'|'manual'} [trigger='manual'] - Trigger.
     * @returns {Promise<object|null>} Run record, or null when it did not start.
     */
    async runAndWait(trigger = 'manual') {
      const outcome = await start(trigger);
      return outcome.started ? outcome.done : null;
    },

    /**
     * Schedule state for Settings (no URLs, counts only).
     * @returns {Promise<{ enabled: boolean, scheduled: boolean, rule: string, maxUrlsPerRun: number, perMinute: number, perHostConcurrency: number, running: boolean, lastRun: object|null }>} State.
     */
    async status() {
      const current = settings();
      let lastRun = null;
      try {
        const stored = await pluginStore().get({ key: STATE_KEY });
        lastRun = (stored && stored.lastRun) || null;
      } catch {
        // no stored run yet or the store is unavailable
      }
      return { ...current, scheduled, running, lastRun };
    },

    /**
     * Last scheduled result of one field (the caller checked access).
     * @param {{ uid: string, documentId: string, locale: string|null, field: string }} target - Field.
     * @returns {Promise<{ enabled: boolean, lastRun: object|null, draft: object|null, published: object|null }>} Report.
     */
    async report(target) {
      const state = await api.status();
      if (!state.enabled) return { enabled: false, lastRun: null, draft: null, published: null };
      const keys = ['draft', 'published'].map((version) => fieldKey({ ...target, version }));
      const rows = await store().getLinkFields(keys);
      const hashes = [...new Set(rows.flatMap((row) => row.links.map((link) => link.h)))];
      const urls = await store().getLinkUrls(hashes);
      const shape = (row) => {
        if (!row) return null;
        const links = row.links
          .map((link) => {
            const entry = urls.get(link.h);
            if (!entry) return null;
            return {
              url: entry.url,
              status: entry.status || 'skipped',
              ...(entry.code ? { code: entry.code } : {}),
              checkedAt: entry.checkedAt ? new Date(entry.checkedAt).toISOString() : null,
              blockId: link.b || null,
            };
          })
          .filter(Boolean)
          .slice(0, 200);
        return {
          scannedAt: new Date(row.scannedAt).toISOString(),
          problems: links.filter((link) => PROBLEMS.has(link.status)).length,
          links,
        };
      };
      const lastRun = state.lastRun
        ? {
            finishedAt: state.lastRun.finishedAt,
            complete: state.lastRun.complete === true,
          }
        : null;
      return {
        enabled: true,
        lastRun,
        draft: shape(rows.find((row) => row.key === keys[0])),
        published: shape(rows.find((row) => row.key === keys[1])),
      };
    },

    /**
     * Removes the cron job and stops a running scan (destroy).
     */
    stop() {
      stopping = true;
      if (strapi.cron && typeof strapi.cron.remove === 'function') {
        try {
          strapi.cron.remove(CRON_NAME);
        } catch {
          // not registered
        }
      }
      scheduled = false;
    },
  };
  return api;
};

'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { z } = require('zod');
const { errors } = require('@strapi/utils');
const { createLogger } = require('../utils/logger');
const { recordAudit } = require('../utils/audit-record');
const { isEditorAttribute } = require('../utils/editor-fields');
const { resolveFieldPreset } = require('../../../shared/presets.mjs');
const { inlineToText } = require('../../../shared/render/inline.mjs');
const { MigrationOptionsError, SOURCE_TYPES } = require('./migrate');

/**
 * Admin migration wizard (2.13, Settings > Magic Editor X > Migrate content).
 *
 * Moves the content of a Strapi Blocks, Markdown rich text or text/HTML field into a Magic Editor X
 * field of the same content type. All conversion and writing is done by `services/migrate.js`
 * (`prepare`, `locales`, `batch`), the same code as the CLI; this service adds what a browser
 * flow needs:
 *
 * - access: the `migrate.run` action (route policy) plus the admin's Content Manager rights on the
 *   type: read of the source field, update of the target field, and their permission conditions
 *   (as query filters) and locales;
 * - preview: a dry run of a few entries with the source text and the converted value;
 * - backup: the source and target values of every entry the run would touch, as JSON;
 * - jobs: a run is a stored job (core store, so every process sees it) worked through in batches
 *   the browser requests one by one. A lease per target field in the plugin's locks table makes
 *   sure only one job runs per field across all processes; a lease per job makes sure one batch
 *   runs at a time. A closed tab leaves a resumable job; an abandoned lease expires.
 *
 * Only drafts are written (Strapi 5: the edit version), only the target field is sent, and the
 * source field is never changed. When a target that already has content is overwritten, its
 * previous content is kept as a "Before migration" version in the field's version history.
 */

const PLUGIN = 'magic-editor-x';
const BATCH_SIZE = 25;
const PREVIEW_MAX = 10;
/** Entries a preview reads at most while it looks for examples that would change. */
const PREVIEW_SCAN = 200;
const TARGET_LEASE_MS = 10 * 60 * 1000;
const BATCH_LEASE_MS = 2 * 60 * 1000;
const MAX_BACKUP_ENTRIES = 20000;
const MAX_FAILURES = 50;
const EXCERPT_CHARS = 600;
const JOB_PREFIX = 'migration-job:';
const TARGET_PREFIX = 'migration-target:';
const PROCESS_ID = randomUUID();
/** Closing tags of block elements and line breaks (one bounded token each, no nested quantifiers). */
const BLOCK_END = /<\/(?:p|h[1-6]|li|blockquote|div|tr|pre|ul|ol|table)\s{0,5}>|<br\s{0,5}\/?>/gi;
/** Closing tags of table cells (a space between cells). */
const CELL_END = /<\/t[dh]\s{0,5}>/gi;
const WIZARD_SOURCE_TYPES = Object.freeze(['blocks', 'richtext', 'text', 'string']);

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const UID = /^api::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/;
const LOCALE = /^(\*|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3})$/;
const JOB_ID = /^[a-f0-9-]{36}$/;

const targetSchema = z.strictObject({
  uid: z.string().regex(UID),
  from: z.string().regex(FIELD),
  to: z.string().regex(FIELD),
  locale: z.string().regex(LOCALE).optional(),
});
const previewSchema = targetSchema.extend({
  overwrite: z.boolean().default(false),
  size: z.number().int().min(1).max(PREVIEW_MAX).default(5),
});
const startSchema = targetSchema.extend({ overwrite: z.boolean().default(false) });

/**
 * Parses input with a strict schema; failures answer 400 with field names only.
 * @param {import('zod').ZodTypeAny} schema - Schema.
 * @param {unknown} input - Input.
 * @returns {object} Parsed value.
 * @throws {errors.ValidationError} When invalid.
 */
const parse = (schema, input) => {
  const result = schema.safeParse(input || {});
  if (!result.success)
    throw new errors.ValidationError('Invalid migration options', z.flattenError(result.error).fieldErrors);
  return result.data;
};

/**
 * Plain-text excerpt of a source value (for the preview; never HTML).
 * @param {unknown} value - Source value.
 * @param {string|undefined} format - Detected format.
 * @returns {string} Text (bounded).
 */
const excerptOf = (value, format) => {
  const textOfNode = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 32) return '';
    if (typeof node.text === 'string') return node.text;
    const children = Array.isArray(node.children) ? node.children : [];
    return children.map((child) => textOfNode(child, depth + 1)).join('');
  };
  let text = '';
  if (Array.isArray(value)) text = value.map((node) => textOfNode(node)).join('\n');
  else if (typeof value === 'string')
    text =
      format === 'html'
        ? // Block ends become line breaks, so paragraphs and list items do not run together.
          inlineToText(value.slice(0, 20000).replace(BLOCK_END, '\n$&').replace(CELL_END, ' $&'))
        : value;
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
};

/**
 * Lock key of a target field (bounded, no content).
 * @param {string} uid - Content type uid.
 * @param {string} to - Target field.
 * @returns {string} Key.
 */
const targetKey = (uid, to) => createHash('sha256').update(`${uid}|${to}`).digest('hex').slice(0, 40);

/**
 * A job or batch already holds the field (the controller answers 409 Conflict).
 */
class MigrationConflictError extends Error {
  /**
   * @param {string} message - Fixed message.
   * @param {'MIGRATION_RUNNING'|'BATCH_RUNNING'} code - Reason.
   */
  constructor(message, code) {
    super(message);
    this.name = 'MigrationConflictError';
    this.code = code;
  }
}

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const migrate = () => strapi.plugin(PLUGIN).service('migrate');
  const locks = () => strapi.plugin(PLUGIN).service('store');
  const kv = () => strapi.store({ type: 'plugin', name: PLUGIN });
  const rawHtml = () => strapi.config.get(`plugin::${PLUGIN}.rawHtml`) || 'sanitize';

  /**
   * Content Manager permission checker of a type.
   * @param {object} userAbility - CASL ability of the admin.
   * @param {string} uid - Content type uid.
   * @returns {object} Checker.
   */
  const checker = (userAbility, uid) =>
    strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model: uid });

  /**
   * Checks the target and the admin's Content Manager rights, and builds the query filters of
   * those rights (permission conditions such as "is creator").
   * @param {object} userAbility - CASL ability.
   * @param {{ uid: string, from: string, to: string, locale?: string }} input - Parsed target.
   * @returns {Promise<{ options: object, filters: object|null, locales: Array<string|undefined> }>} Prepared migration.
   * @throws {errors.ValidationError} When the fields are not a valid source/target pair.
   * @throws {errors.ForbiddenError} When the admin may not read the source or update the target.
   */
  const authorize = async (userAbility, input) => {
    const contentType = strapi.contentType(input.uid);
    const source = contentType && contentType.attributes ? contentType.attributes[input.from] : null;
    if (!source || !WIZARD_SOURCE_TYPES.includes(source.type) || source.customField)
      throw new errors.ValidationError('The source must be a Blocks, rich text or text field', {
        from: ['Unsupported source field'],
      });
    let options;
    try {
      options = migrate().prepare({
        uid: input.uid,
        from: input.from,
        to: input.to,
        ...(input.locale ? { locale: input.locale } : {}),
        dryRun: true,
      });
    } catch (error) {
      if (error instanceof MigrationOptionsError)
        throw new errors.ValidationError('Invalid migration options', { code: error.code });
      throw error;
    }
    const pc = checker(userAbility, input.uid);
    if (pc.cannot.read(null, input.from) || pc.cannot.update(null, input.to))
      throw new errors.ForbiddenError('You cannot read the source field or update the target field');
    const read = await pc.sanitizedQuery.read({});
    const update = await pc.sanitizedQuery.update({});
    const parts = [read && read.filters, update && update.filters].filter(
      (part) => part && typeof part === 'object' && Object.keys(part).length
    );
    const filters = parts.length ? { $and: parts } : null;
    let locales = await migrate().locales(options);
    if (options.localized) {
      // A role limited to some locales migrates only those (Strapi's i18n locale conditions).
      locales = locales.filter(
        (code) =>
          !code || (pc.can.read({ locale: code }, input.from) && pc.can.update({ locale: code }, input.to))
      );
      if (!locales.length)
        throw new errors.ForbiddenError('You cannot update any locale of this content type');
    }
    return { options, filters, locales };
  };

  /**
   * Stored job by id.
   * @param {string} id - Job id.
   * @returns {Promise<object|null>} Job.
   */
  const loadJob = async (id) => {
    if (typeof id !== 'string' || !JOB_ID.test(id)) return null;
    const job = await kv().get({ key: `${JOB_PREFIX}${id}` });
    return job && typeof job === 'object' ? job : null;
  };

  /**
   * Stores a job and its target index.
   * @param {object} job - Job.
   * @returns {Promise<object>} The job.
   */
  const saveJob = async (job) => {
    job.updatedAt = new Date().toISOString();
    await kv().set({ key: `${JOB_PREFIX}${job.id}`, value: job });
    await kv().set({ key: `${TARGET_PREFIX}${targetKey(job.uid, job.to)}`, value: { id: job.id } });
    return job;
  };

  /**
   * Public form of a job (no admin ids).
   * @param {object} job - Stored job.
   * @returns {object} DTO.
   */
  const toDto = (job) => ({
    id: job.id,
    uid: job.uid,
    from: job.from,
    to: job.to,
    locale: job.locale || null,
    overwrite: job.overwrite,
    status: job.status,
    total: job.total,
    processed: job.processed,
    counts: job.counts,
    failures: job.failures,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || null,
  });

  const countAll = async (options, filters, locales) => {
    let total = 0;
    for (const locale of locales)
      total += await strapi.documents(options.uid).count({
        ...(locale ? { locale } : {}),
        ...(filters ? { filters } : {}),
        status: 'draft',
      });
    return total;
  };

  return {
    BATCH_SIZE,
    PREVIEW_MAX,

    /**
     * Content types the admin can migrate: API types with a Magic Editor X field and a
     * Blocks/rich text/text source, readable and updatable in the Content Manager.
     * @param {object} userAbility - CASL ability.
     * @returns {Array<{ uid: string, displayName: string, localized: boolean, draftAndPublish: boolean, sources: Array<{ name: string, type: string }>, targets: Array<{ name: string, preset: string }> }>} Types.
     */
    types(userAbility) {
      const out = [];
      for (const contentType of Object.values(strapi.contentTypes || {})) {
        if (typeof contentType.uid !== 'string' || !UID.test(contentType.uid)) continue;
        const attributes = Object.entries(contentType.attributes || {});
        const targets = attributes.filter(
          ([name, attribute]) => FIELD.test(name) && isEditorAttribute(attribute)
        );
        const sources = attributes.filter(
          ([name, attribute]) =>
            FIELD.test(name) &&
            !attribute.customField &&
            WIZARD_SOURCE_TYPES.includes(attribute.type) &&
            SOURCE_TYPES.has(attribute.type)
        );
        if (!targets.length || !sources.length) continue;
        let pc;
        try {
          pc = checker(userAbility, contentType.uid);
          if (pc.cannot.read() || pc.cannot.update()) continue;
        } catch {
          continue;
        }
        out.push({
          uid: contentType.uid,
          displayName: (contentType.info && contentType.info.displayName) || contentType.uid,
          kind: contentType.kind === 'singleType' ? 'singleType' : 'collectionType',
          localized: Boolean(contentType.pluginOptions?.i18n?.localized),
          draftAndPublish: contentType.options?.draftAndPublish !== false,
          sources: sources
            .filter(([name]) => !pc.cannot.read(null, name))
            .map(([name, attribute]) => ({ name, type: attribute.type })),
          targets: targets
            .filter(([name]) => !pc.cannot.update(null, name))
            .map(([name, attribute]) => ({ name, preset: resolveFieldPreset(attribute.options).name })),
        });
      }
      return out
        .filter((entry) => entry.sources.length && entry.targets.length)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    /**
     * Locales of the project (i18n), the default one marked; [] without i18n.
     * @returns {Promise<Array<{ code: string, name: string, isDefault: boolean }>>} Locales.
     */
    async locales() {
      const i18n = strapi.plugin('i18n');
      if (!i18n) return [];
      try {
        const service = i18n.service('locales');
        const list = await service.find();
        const fallback =
          typeof service.getDefaultLocale === 'function' ? await service.getDefaultLocale() : null;
        return (Array.isArray(list) ? list : [])
          .filter((entry) => entry && typeof entry.code === 'string' && LOCALE.test(entry.code))
          .map((entry) => ({
            code: entry.code,
            name: typeof entry.name === 'string' ? entry.name : entry.code,
            isDefault: entry.code === fallback,
          }));
      } catch {
        return [];
      }
    },

    /**
     * Dry run: up to `size` example entries that would be migrated (or fail), with source text,
     * converted value and lossy parts, plus the counts of the scanned entries (at most 200).
     * Writes nothing.
     * @param {object} userAbility - CASL ability.
     * @param {unknown} body - `{ uid, from, to, locale?, overwrite?, size? }`.
     * @returns {Promise<{ total: number, scanned: number, counts: { converted: number, existing: number, empty: number, failed: number }, entries: Array<object> }>} Examples in id order (first locale first).
     * @throws {errors.ValidationError|errors.ForbiddenError} See `authorize`.
     */
    async preview(userAbility, body) {
      const input = parse(previewSchema, body);
      const { options, filters, locales } = await authorize(userAbility, input);
      // Examples are entries that would change (or fail); skipped ones are only counted, so a
      // preview of a half-migrated type still shows real conversions. Bounded scan.
      const entries = [];
      const counts = { converted: 0, existing: 0, empty: 0, failed: 0 };
      let scanned = 0;
      for (const locale of locales) {
        for (let start = 0; scanned < PREVIEW_SCAN && entries.length < input.size;) {
          const result = await migrate().batch(options, {
            locale,
            start,
            limit: Math.min(50, PREVIEW_SCAN - scanned),
            filters,
            dryRun: true,
            overwrite: input.overwrite,
            rawHtml: rawHtml(),
            collect: true,
          });
          scanned += result.fetched;
          start += result.fetched;
          for (const entry of result.entries) {
            counts[entry.status] += 1;
            if ((entry.status === 'converted' || entry.status === 'failed') && entries.length < input.size)
              entries.push(entry);
          }
          if (result.fetched < 50) break;
        }
        if (scanned >= PREVIEW_SCAN || entries.length >= input.size) break;
      }
      return {
        total: await countAll(options, filters, locales),
        scanned,
        counts,
        entries: entries.map((entry) => ({
          documentId: entry.documentId,
          locale: entry.locale,
          status: entry.status,
          overwrites: Boolean(entry.overwrites),
          notes: entry.notes,
          before: excerptOf(entry.source, entry.format),
          // The converted value (cleaned by the save sanitiser); the admin renders it read-only.
          after: entry.value,
        })),
      };
    },

    /**
     * Backup of every entry a run would touch: documentId, locale, source and target values.
     * @param {object} userAbility - CASL ability.
     * @param {unknown} query - `{ uid, from, to, locale? }`.
     * @returns {Promise<object>} Backup document.
     * @throws {errors.PayloadTooLargeError} Above `MAX_BACKUP_ENTRIES` entries.
     * @sideeffect Records `migration.backup` in the audit trail (counts only).
     */
    async backup(userAbility, query) {
      const input = parse(targetSchema, query);
      const { options, filters, locales } = await authorize(userAbility, input);
      if ((await countAll(options, filters, locales)) > MAX_BACKUP_ENTRIES)
        throw new errors.PayloadTooLargeError(
          'Too many entries for a backup download; use a database backup'
        );
      const entries = [];
      for (const locale of locales) {
        for (let start = 0; ; start += 100) {
          const rows = await strapi.documents(options.uid).findMany({
            ...(locale ? { locale } : {}),
            ...(filters ? { filters } : {}),
            status: 'draft',
            fields: [options.from, options.to],
            sort: ['id:asc'],
            start,
            limit: 100,
          });
          for (const row of rows || [])
            entries.push({
              documentId: row.documentId,
              locale: locale || row.locale || null,
              [options.from]: row[options.from] === undefined ? null : row[options.from],
              [options.to]: row[options.to] === undefined ? null : row[options.to],
            });
          if (!rows || rows.length < 100) break;
        }
      }
      await recordAudit(strapi, {
        event: 'migration.backup',
        target: { uid: options.uid, field: options.to },
        counts: { entries: entries.length },
        meta: { from: options.from, locale: input.locale || 'default' },
      });
      return {
        kind: 'magic-editor-x/migration-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        uid: options.uid,
        from: options.from,
        to: options.to,
        status: 'draft',
        entries,
      };
    },

    /**
     * Starts a run. Only one job per target field runs at a time (all processes).
     * @param {object} userAbility - CASL ability.
     * @param {unknown} body - `{ uid, from, to, locale?, overwrite? }`.
     * @param {{ userId?: number|null }} actor - Admin who started it.
     * @returns {Promise<object>} Job.
     * @throws {MigrationConflictError} `MIGRATION_RUNNING` when a job holds the field.
     * @sideeffect Stores the job, takes the field lease, records `migration.start`.
     */
    async start(userAbility, body, actor = {}) {
      const input = parse(startSchema, body);
      const { options, filters, locales } = await authorize(userAbility, input);
      const id = randomUUID();
      const leaseKey = `migration:${targetKey(options.uid, options.to)}`;
      if (!(await locks().acquire(leaseKey, id, TARGET_LEASE_MS)))
        throw new MigrationConflictError(
          'A migration into this field is already running',
          'MIGRATION_RUNNING'
        );
      const job = {
        id,
        uid: options.uid,
        from: options.from,
        to: options.to,
        locale: input.locale || null,
        overwrite: input.overwrite,
        status: 'running',
        locales: locales.map((code) => code || null),
        cursor: { localeIndex: 0, start: 0 },
        total: await countAll(options, filters, locales),
        processed: 0,
        counts: { converted: 0, skippedExisting: 0, skippedEmpty: 0, failed: 0, lossy: 0, versions: 0 },
        failures: [],
        startedAt: new Date().toISOString(),
        startedBy: Number.isInteger(actor.userId) ? actor.userId : null,
      };
      await saveJob(job);
      await recordAudit(strapi, {
        event: 'migration.start',
        target: { uid: job.uid, field: job.to },
        counts: { total: job.total },
        meta: { from: job.from, locale: job.locale || 'default', overwrite: job.overwrite ? 'on' : 'off' },
      });
      return toDto(job);
    },

    /**
     * Runs the next batch of a job and returns its new state.
     * @param {object} userAbility - CASL ability (rights are checked again on every batch).
     * @param {string} id - Job id.
     * @param {{ userId?: number|null }} actor - Admin running it.
     * @returns {Promise<object>} Job.
     * @throws {errors.NotFoundError} Unknown job.
     * @sideeffect Writes up to `BATCH_SIZE` target fields (drafts), saves "Before migration" versions of overwritten values, updates the job; records `migration.finish` at the end.
     */
    async next(userAbility, id, actor = {}) {
      let job = await loadJob(id);
      if (!job) throw new errors.NotFoundError('Not found');
      if (job.status !== 'running') return toDto(job);
      const { options, filters } = await authorize(userAbility, {
        uid: job.uid,
        from: job.from,
        to: job.to,
        ...(job.locale ? { locale: job.locale } : {}),
      });
      const leaseKey = `migration:${targetKey(job.uid, job.to)}`;
      const held =
        (await locks().renew(leaseKey, job.id, TARGET_LEASE_MS)) ||
        (await locks().acquire(leaseKey, job.id, TARGET_LEASE_MS));
      const batchKey = `migration-batch:${job.id}`;
      const batchOwner = `${PROCESS_ID}:${randomUUID()}`;
      if (!held || !(await locks().acquire(batchKey, batchOwner, BATCH_LEASE_MS))) {
        throw held
          ? new MigrationConflictError('A batch of this migration is already running', 'BATCH_RUNNING')
          : new MigrationConflictError('A migration into this field is already running', 'MIGRATION_RUNNING');
      }
      try {
        // Another process may have advanced the job since it was read.
        job = (await loadJob(id)) || job;
        if (job.status !== 'running') return toDto(job);
        const locale = job.locales[job.cursor.localeIndex];
        const history = strapi.plugin(PLUGIN).service('history');
        const result = await migrate().batch(options, {
          locale: locale || undefined,
          start: job.cursor.start,
          limit: BATCH_SIZE,
          filters,
          dryRun: false,
          overwrite: job.overwrite,
          rawHtml: rawHtml(),
          beforeWrite: async ({ documentId, locale: entryLocale, previous }) => {
            // Undo path for overwritten values: the previous content as a named version.
            await history.create(
              { uid: job.uid, documentId, locale: entryLocale || null, field: job.to },
              previous,
              { trigger: 'manual', label: 'Before migration', userId: actor.userId || null }
            );
            job.counts.versions += 1;
          },
        });
        const part = result.report;
        job.processed += result.fetched;
        job.counts.converted += part.converted;
        job.counts.skippedExisting += part.skippedExisting;
        job.counts.skippedEmpty += part.skippedEmpty;
        job.counts.failed += part.failed.length;
        job.counts.lossy += part.lossy.length;
        job.failures = [...job.failures, ...part.failed].slice(0, MAX_FAILURES);
        if (result.fetched < BATCH_SIZE) job.cursor = { localeIndex: job.cursor.localeIndex + 1, start: 0 };
        else job.cursor = { ...job.cursor, start: job.cursor.start + result.fetched };
        if (job.cursor.localeIndex >= job.locales.length) {
          job.status = 'done';
          job.finishedAt = new Date().toISOString();
        }
        await saveJob(job);
        if (job.status === 'done') {
          await locks().release(leaseKey, job.id);
          await recordAudit(strapi, {
            event: 'migration.finish',
            target: { uid: job.uid, field: job.to },
            counts: {
              processed: job.processed,
              converted: job.counts.converted,
              skippedExisting: job.counts.skippedExisting,
              skippedEmpty: job.counts.skippedEmpty,
              failed: job.counts.failed,
              lossy: job.counts.lossy,
              versions: job.counts.versions,
            },
            meta: { from: job.from, locale: job.locale || 'default' },
          });
          logger.info('migration wizard run finished', {
            processed: job.processed,
            converted: job.counts.converted,
            failed: job.counts.failed,
          });
        }
        return toDto(job);
      } finally {
        await locks().release(batchKey, batchOwner);
      }
    },

    /**
     * One job.
     * @param {object} userAbility - CASL ability.
     * @param {string} id - Job id.
     * @returns {Promise<object>} Job.
     * @throws {errors.NotFoundError} Unknown job or no access to its content type.
     */
    async get(userAbility, id) {
      const job = await loadJob(id);
      if (!job) throw new errors.NotFoundError('Not found');
      try {
        checker(userAbility, job.uid);
        if (checker(userAbility, job.uid).cannot.update(null, job.to)) throw new Error('denied');
      } catch {
        throw new errors.NotFoundError('Not found');
      }
      return toDto(job);
    },

    /**
     * Unfinished jobs the admin can continue (newest first, at most 20).
     * @param {object} userAbility - CASL ability.
     * @returns {Promise<object[]>} Jobs.
     */
    async list(userAbility) {
      const rows = await strapi.db.query('strapi::core-store').findMany({
        where: { key: { $startsWith: `plugin_${PLUGIN}_${JOB_PREFIX}` } },
        orderBy: { id: 'desc' },
        limit: 100,
      });
      const out = [];
      for (const row of rows) {
        let job;
        try {
          job = JSON.parse(row.value);
        } catch {
          continue;
        }
        if (!job || job.status !== 'running' || !strapi.contentType(job.uid)) continue;
        try {
          if (checker(userAbility, job.uid).cannot.update(null, job.to)) continue;
        } catch {
          continue;
        }
        out.push(toDto(job));
        if (out.length >= 20) break;
      }
      return out;
    },

    /**
     * Stops a job; what was migrated stays.
     * @param {object} userAbility - CASL ability.
     * @param {string} id - Job id.
     * @returns {Promise<object>} Job.
     * @sideeffect Marks the job cancelled, releases the field lease, records `migration.cancel`.
     */
    async cancel(userAbility, id) {
      await this.get(userAbility, id);
      const job = await loadJob(id);
      if (job.status !== 'running') return toDto(job);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      await saveJob(job);
      await locks().release(`migration:${targetKey(job.uid, job.to)}`, job.id);
      await recordAudit(strapi, {
        event: 'migration.cancel',
        target: { uid: job.uid, field: job.to },
        counts: { processed: job.processed, converted: job.counts.converted },
        meta: { from: job.from },
      });
      return toDto(job);
    },
  };
};

module.exports.BATCH_SIZE = BATCH_SIZE;
module.exports.MigrationConflictError = MigrationConflictError;
module.exports.excerptOf = excerptOf;
module.exports.targetKey = targetKey;

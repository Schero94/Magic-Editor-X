'use strict';

const { randomUUID } = require('node:crypto');
const { createLogger } = require('../utils/logger');
const { displayName } = require('./templates');
const { cleanAuditInput, AUDIT_EVENTS } = require('../../../shared/audit.mjs');

/**
 * Audit trail (2.4): who changed what and when, per field, with counts and
 * block ids only, never content, e-mail addresses, IP addresses or tokens.
 *
 * Rows live in `magic_editor_x_audit` (services/store.js): an append-only
 * table with indexes on the target (uid, documentId, locale), the time and
 * the actor. Retention: rows older than `audit.retentionDays` are pruned
 * once an hour by one process (one-time key `audit:prune:<hour>` in
 * `magic_editor_x_locks`). A deleted admin user's rows keep the event but
 * lose the id and name (`actor_kind: 'deleted'`).
 *
 * Strapi Enterprise Audit Logs: when the host has the `audit-logs`
 * feature (`strapi.has('audit-logs-lifecycle')`, as @strapi/review-workflows
 * checks it), every event is also registered with
 * `registerEvent('magic-editor-x.<event>', transform)` and emitted on
 * `strapi.eventHub`; Strapi then stores it with its own actor data. Without
 * the feature nothing is emitted.
 *
 * Other features call `record()`; it never throws and never blocks the
 * caller's work on a failure (the failure is logged without data).
 */

const PROCESS_ID = randomUUID();
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACTORS = 200;
const EE_PREFIX = 'magic-editor-x.';

/**
 * Parses a JSON text column.
 * @param {unknown} text - Column value.
 * @param {unknown} fallback - Value for empty or invalid text.
 * @returns {unknown} Parsed value.
 */
const parseJson = (text, fallback) => {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const store = () => strapi.plugin('magic-editor-x').service('store');
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.audit.${key}`);
    return value === undefined ? fallback : value;
  };
  let timer = null;
  let firstTimer = null;
  let enterprise = null;
  const enterpriseEvents = new Set();

  /**
   * The actor of the current request: an admin (id + name snapshot), a
   * Content API caller (no id: API tokens and end users are not admins) or
   * the system (cron jobs, background work).
   * @param {unknown} explicit - `'system'`, an admin user object or `{ id, name }`.
   * @returns {{ id: number|null, name: string|null, kind: 'admin'|'api'|'system' }} Actor.
   */
  const resolveActor = (explicit) => {
    if (explicit === 'system') return { id: null, name: null, kind: 'system' };
    if (explicit && typeof explicit === 'object' && Number.isInteger(explicit.id)) {
      const name =
        typeof explicit.name === 'string' ? explicit.name.slice(0, 200) || null : displayName(explicit);
      return { id: explicit.id, name, kind: 'admin' };
    }
    let state;
    try {
      const ctx = strapi.requestContext && strapi.requestContext.get();
      state = ctx && ctx.state;
    } catch {
      state = undefined;
    }
    if (!state) return { id: null, name: null, kind: 'system' };
    const isAdmin =
      (state.route && state.route.info && state.route.info.type === 'admin') ||
      (state.auth && state.auth.strategy && state.auth.strategy.name === 'admin');
    if (isAdmin && state.user && Number.isInteger(state.user.id))
      return { id: state.user.id, name: displayName(state.user), kind: 'admin' };
    if (state.route || state.auth) return { id: null, name: null, kind: 'api' };
    return { id: null, name: null, kind: 'system' };
  };

  /**
   * Registers an event with Strapi Enterprise Audit Logs (once per name).
   * @param {string} event - Plugin event name.
   * @returns {boolean} True when Enterprise Audit Logs is available.
   */
  const enterpriseReady = (event) => {
    if (!enterprise) return false;
    const name = `${EE_PREFIX}${event}`;
    if (!enterpriseEvents.has(name)) {
      try {
        enterprise.registerEvent(name, (payload) => ({
          resource: {
            type: 'magic-editor-x',
            uid: payload.uid,
            id: payload.documentId,
          },
          details: {
            locale: payload.locale,
            field: payload.field,
            counts: payload.counts,
            blockIds: payload.blockIds,
            meta: payload.meta,
          },
        }));
        enterpriseEvents.add(name);
      } catch {
        return false;
      }
    }
    return true;
  };

  /**
   * Builds the row for one clean record.
   * @param {ReturnType<typeof cleanAuditInput>} clean - Clean input.
   * @param {{ id: number|null, name: string|null, kind: string }} actor - Actor.
   * @param {number} at - Time (ms).
   * @returns {object} Row.
   */
  const toRow = (clean, actor, at) => ({
    created_at: at,
    event: clean.event,
    uid: clean.uid,
    document_id: clean.documentId,
    locale: clean.locale,
    field: clean.field,
    actor_id: actor.id,
    actor_name: actor.name,
    actor_kind: actor.kind,
    counts: JSON.stringify(clean.counts),
    block_ids: JSON.stringify(clean.blockIds),
    meta: JSON.stringify(clean.meta),
  });

  /**
   * Stored row -> API object.
   * @param {object} row - Row.
   * @param {{ viewerId?: number|null, withActorIds?: boolean }} options - Output options.
   * @returns {object} Audit event.
   */
  const toDto = (row, { viewerId = null, withActorIds = false } = {}) => {
    const actorId = row.actor_id === null || row.actor_id === undefined ? null : Number(row.actor_id);
    const actor = {
      kind: row.actor_kind || 'system',
      name: row.actor_name || null,
      own: viewerId !== null && actorId === viewerId,
      deleted: row.actor_kind === 'deleted',
    };
    if (withActorIds) actor.id = actorId;
    return {
      id: String(row.id),
      event: row.event,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      target: {
        uid: row.uid || null,
        documentId: row.document_id || null,
        locale: row.locale || null,
        field: row.field || null,
      },
      actor,
      counts: parseJson(row.counts, {}),
      blockIds: parseJson(row.block_ids, []),
      meta: parseJson(row.meta, {}),
    };
  };

  const api = {
    EVENTS: AUDIT_EVENTS,

    /** @returns {boolean} True unless `audit.enabled` is false. */
    enabled() {
      return conf('enabled', true) !== false;
    },

    /** @returns {number} Retention in days (0 = keep). */
    retentionDays() {
      const days = Number(conf('retentionDays', 180));
      return Number.isInteger(days) && days >= 0 ? days : 180;
    },

    /**
     * Records one event. Never throws; content must never be passed (the
     * input is reduced to identifiers, integer counts and block ids).
     * @param {{ event: string, target?: { uid?: string, documentId?: string, locale?: string|null, field?: string }, counts?: Record<string, number>, blockIds?: string[], meta?: Record<string, string|string[]>, actor?: 'system'|{ id: number, name?: string, firstname?: string, lastname?: string, username?: string } }} input - Event.
     * @returns {Promise<boolean>} True when stored.
     */
    async record(input) {
      return api.recordMany([input]).then((count) => count > 0);
    },

    /**
     * Records several events of one action (one insert). Never throws.
     * @param {Array<Parameters<typeof api.record>[0]>} inputs - Events.
     * @returns {Promise<number>} Events stored.
     */
    async recordMany(inputs) {
      if (!api.enabled() || !Array.isArray(inputs) || inputs.length === 0) return 0;
      try {
        const at = Date.now();
        const rows = [];
        const emitted = [];
        for (const input of inputs.slice(0, 500)) {
          const clean = cleanAuditInput(input);
          if (!clean) continue;
          const actor = resolveActor(input.actor);
          rows.push(toRow(clean, actor, at));
          emitted.push(clean);
        }
        if (!rows.length) return 0;
        await store().appendAudit(rows);
        for (const clean of emitted) {
          if (!enterpriseReady(clean.event)) break;
          strapi.eventHub.emit(`${EE_PREFIX}${clean.event}`, {
            uid: clean.uid,
            documentId: clean.documentId,
            locale: clean.locale,
            field: clean.field,
            counts: clean.counts,
            blockIds: clean.blockIds,
            meta: clean.meta,
          });
        }
        return rows.length;
      } catch (error) {
        logger.warn('audit event could not be stored', { code: error && error.code });
        return 0;
      }
    },

    /**
     * Lists events, newest first.
     * @param {object} filters - Validated filters (see store.listAudit).
     * @param {{ page: number, pageSize: number, viewerId?: number|null, withActorIds?: boolean }} options - Page and output options.
     * @returns {Promise<{ results: object[], pagination: { page: number, pageSize: number, pageCount: number, total: number } }>} Page.
     */
    async list(filters, { page, pageSize, viewerId = null, withActorIds = false }) {
      const { rows, total } = await store().listAudit(filters, {
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });
      return {
        results: rows.map((row) => toDto(row, { viewerId, withActorIds })),
        pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total },
      };
    },

    /**
     * Admin actors that appear in the trail (for the actor filter).
     * @returns {Promise<Array<{ id: number, name: string|null }>>} Actors, by name.
     */
    async actors() {
      const actors = await store().auditActors(MAX_ACTORS);
      return actors.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    },

    /**
     * Deletes rows beyond the retention (no-op with retentionDays 0).
     * @param {number} [now=Date.now()] - Current time.
     * @returns {Promise<number>} Rows removed.
     */
    async prune(now = Date.now()) {
      const days = api.retentionDays();
      if (days === 0) return 0;
      return store().pruneAudit(now - days * DAY_MS);
    },

    /**
     * Prunes once per hour across the cluster (one-time key per hour).
     * @param {number} [now=Date.now()] - Current time.
     * @returns {Promise<number|null>} Rows removed, or null when another process has this hour.
     */
    async pruneTick(now = Date.now()) {
      const hour = Math.floor(now / PRUNE_EVERY_MS);
      if (!(await store().acquire(`audit:prune:${hour}`, PROCESS_ID, 2 * PRUNE_EVERY_MS))) return null;
      const removed = await api.prune(now);
      if (removed) logger.info('audit trail pruned', { removed });
      return removed;
    },

    /**
     * Clears the actor id and name of a deleted admin user.
     * @param {number} userId - Admin id.
     * @returns {Promise<void>}
     */
    async anonymizeUser(userId) {
      if (!Number.isInteger(Number(userId))) return;
      await store().anonymizeAuditActor(Number(userId));
    },

    /**
     * Bootstrap: Enterprise Audit Logs registration and the hourly pruning timer.
     */
    start() {
      try {
        enterprise =
          typeof strapi.has === 'function' && strapi.has('audit-logs-lifecycle')
            ? strapi.get('audit-logs-lifecycle')
            : null;
        if (enterprise && typeof enterprise.registerEvent !== 'function') enterprise = null;
        if (enterprise) for (const event of AUDIT_EVENTS) enterpriseReady(event);
      } catch {
        enterprise = null;
      }
      const tick = () => {
        api
          .pruneTick()
          .catch((error) => logger.warn('audit trail pruning failed', { code: error && error.code }));
      };
      firstTimer = setTimeout(tick, 60 * 1000);
      timer = setInterval(tick, PRUNE_EVERY_MS);
      if (firstTimer.unref) firstTimer.unref();
      if (timer.unref) timer.unref();
    },

    /** Destroy: stops the timer. */
    stop() {
      if (firstTimer) clearTimeout(firstTimer);
      if (timer) clearInterval(timer);
      firstTimer = null;
      timer = null;
    },

    /** @returns {boolean} True when events are also sent to Strapi Enterprise Audit Logs. */
    enterpriseEnabled() {
      return Boolean(enterprise);
    },
  };
  return api;
};

module.exports.parseJson = parseJson;

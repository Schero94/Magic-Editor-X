'use strict';

const { createHash } = require('node:crypto');
const { errors } = require('@strapi/utils');
const { ACTIONS } = require('../permissions');
const { createLogger } = require('../utils/logger');
const { createRateLimiter } = require('../utils/rate-limit');
const { isEditorAttribute, resolveEditorField } = require('../utils/editor-fields');
const { guardQuery, collectGuarded } = require('../utils/publish-guard');
const { displayName, colorFor } = require('./collaboration');
const { fieldKey: linkFieldKey } = require('./link-schedule');
const { lintDocument } = require('../../../shared/quality.mjs');
const { normalizeExcerpt } = require('../../../shared/comments.mjs');
const { fieldIdentity, parseFieldIdentity } = require('../../../shared/field-identity.mjs');

/**
 * Entry panel and homepage widgets (2.5).
 *
 * - Document presence ("Editing now"): one query over the collaboration presence table for every room
 *   of a document locale (`<uid>|<documentId>|<locale or ->|...`): the socket rows of every field room
 *   (positional fields are keyed by identity, so they share the prefix) plus heartbeat rows that the
 *   side panel writes (`...|@entry`) for admins who may update the entry. Rows live in the database, so
 *   every process of a cluster sees the same people. Only display names (never e-mail addresses) of
 *   admins who passed the Content Manager check for this document locale are stored and returned.
 * - Entry summary: open comment threads per field, accessibility lint counts and broken links of the
 *   scheduled link check, for the fields the caller may read.
 * - Widgets: the caller's open threads (started or mentioned in) and entries with broken links.
 *
 * No hard locks: the optional soft lock (`presence.softLock`) only makes the admin ask once.
 */

const PRESENCE_TTL_MS = 30000;
const PRUNE_EVERY_MS = 60000;
const MAX_EDITORS = 20;
const MAX_FIELDS = 100;
const MAX_COMMENT_ROWS = 5000;
const THREAD_SCAN = 200;
const PROBLEMS = ['broken', 'timeout', 'error'];
const MAX_PROBLEM_URLS = 5000;
const LINK_PAGE = 500;
const MAX_LINK_ROWS = 50000;
const MAX_BROKEN_ENTRIES = 1000;
const MAX_ACCESS_CHECKS = 60;
const COMMENT_UID = 'plugin::magic-editor-x.comment';
const NOTIFICATION_UID = 'plugin::magic-editor-x.comment-notification';

const notFound = () => new errors.NotFoundError('Not found');

/**
 * Presence row id of one browser tab of one admin (the admin id is part of the hash, so nobody can
 * refresh or remove someone else's row).
 * @param {number} userId - Admin id.
 * @param {string} tabId - Random tab id from the browser.
 * @returns {string} sha256 hex (64 characters, the column size).
 */
const entryRowId = (userId, tabId) => createHash('sha256').update(`entry|${userId}|${tabId}`).digest('hex');

/**
 * Opaque, stable id of a person in one document's presence list (no admin id leaves the server).
 * @param {string} prefix - Document room prefix.
 * @param {number} userId - Admin id.
 * @returns {string} 16 hex characters.
 */
const personId = (prefix, userId) =>
  createHash('sha256').update(`person|${prefix}|${userId}`).digest('hex').slice(0, 16);

/**
 * Idle flag of a presence row (socket rows keep the caret JSON, heartbeat rows `{ idle }`).
 * @param {{ cursor: string|null }} row - Row.
 * @returns {boolean} Idle.
 */
const rowIdle = (row) => {
  if (!row.cursor) return false;
  try {
    const cursor = JSON.parse(row.cursor);
    return Boolean(cursor && cursor.idle);
  } catch {
    return false;
  }
};

/**
 * Groups presence rows by admin: other admins who may edit, newest first, at most MAX_EDITORS.
 * @param {Array<object>} rows - Presence rows of one document locale.
 * @param {string} prefix - Room prefix.
 * @param {number} selfId - Caller (left out).
 * @param {string} suffix - Heartbeat room suffix.
 * @returns {Array<{ id: string, name: string, color: string, idle: boolean, live: boolean }>} Editors.
 */
const groupEditors = (rows, prefix, selfId, suffix) => {
  const people = new Map();
  for (const row of rows) {
    const userId = Number(row.user_id);
    if (userId === Number(selfId) || !row.can_edit) continue;
    const person = people.get(userId) || {
      id: personId(prefix, userId),
      name: String(row.name || '').slice(0, 80),
      color: String(row.color || 'primary'),
      idle: true,
      live: false,
      at: 0,
    };
    person.idle = person.idle && rowIdle(row);
    if (!String(row.room).endsWith(suffix)) person.live = true;
    person.at = Math.max(person.at, Number(row.updated_at) || 0);
    people.set(userId, person);
  }
  return Array.from(people.values())
    .sort((a, b) => Number(a.idle) - Number(b.idle) || a.name.localeCompare(b.name))
    .slice(0, MAX_EDITORS)
    .map(({ id, name, color, idle, live }) => ({ id, name, color, idle, live }));
};

/**
 * Display path of a field for the panel: indices count from 1 (`sections.0.body` -> `sections 1 › body`).
 * @param {string} path - Field path.
 * @returns {string} Label.
 */
const pathLabel = (path) =>
  String(path)
    .split('.')
    .reduce((parts, part) => {
      if (/^\d+$/.test(part) && parts.length) parts[parts.length - 1] += ` ${Number(part) + 1}`;
      else parts.push(part);
      return parts;
    }, [])
    .join(' › ');

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const plugin = () => strapi.plugin('magic-editor-x');
  const store = () => plugin().service('store');
  const access = () => plugin().service('access');
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.${key}`);
    return value === undefined ? fallback : value;
  };
  let fallbackLimiter = null;
  let lastPrune = 0;
  /** Broken-link summary per finished run: `{ runKey, entries, truncated }`. */
  let brokenCache = null;

  /**
   * Counts one request against a per-admin limit shared by all processes.
   * @param {string} key - Counter key.
   * @param {number} max - Limit per minute.
   * @throws {errors.RateLimitError} 429 when exceeded.
   */
  const limit = async (key, max) => {
    let allowed;
    try {
      allowed = (await store().hit(key, 60000)).count <= max;
    } catch {
      if (!fallbackLimiter) fallbackLimiter = createRateLimiter({ max: 600, windowMs: 60000 });
      allowed = fallbackLimiter.hit(key).allowed;
    }
    if (!allowed) throw new errors.RateLimitError('Too many requests. Try again in a minute.');
  };

  /**
   * @param {object} ability - CASL ability.
   * @param {string} action - Plugin action.
   * @returns {boolean} Allowed.
   */
  const can = (ability, action) => {
    try {
      return Boolean(ability && ability.can(action));
    } catch {
      return false;
    }
  };

  /**
   * Per-call cache of field access checks (`access.checkField`).
   * @param {object} ability - Caller's ability.
   * @returns {(target: { uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }) => Promise<boolean>} Check.
   */
  const fieldReadCache = (ability) => {
    const cache = new Map();
    return async (target) => {
      const key = `${target.uid}|${target.documentId}|${target.locale || ''}|${target.field}|${target.fieldKey || ''}`;
      if (!cache.has(key)) {
        if (cache.size >= MAX_ACCESS_CHECKS) return false;
        let allowed;
        try {
          const checked = await access().checkField({ userAbility: ability, ...target });
          allowed = Boolean(checked && checked.canRead && checked.fieldName);
        } catch {
          allowed = false;
        }
        cache.set(key, allowed);
      }
      return cache.get(key);
    };
  };

  /**
   * Access-check target of a stored row keyed by field identity; null for rows saved by position
   * before 2.4 (never listed).
   * @param {{ uid: string, documentId: string, locale: string|null, fieldName: string }} row - Row.
   * @returns {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }|null} Target.
   */
  const targetOf = ({ uid, documentId, locale, fieldName }) => {
    const parsed = parseFieldIdentity(fieldName);
    if (!parsed || parsed.legacy) return null;
    return {
      uid,
      documentId,
      locale: locale || null,
      field: parsed.field,
      ...(parsed.fieldKey ? { fieldKey: parsed.fieldKey } : {}),
    };
  };

  /**
   * Entry title for a reader (Content Manager main field when readable), else null.
   * @param {object} ability - Reader's ability.
   * @param {{ uid: string, documentId: string, locale: string|null }} target - Entry.
   * @returns {Promise<string|null>} Title.
   */
  const titleFor = async (ability, target) => {
    try {
      const contentType = strapi.contentType(target.uid);
      if (!contentType) return null;
      const field = await plugin().service('links').titleFieldFor(contentType);
      if (!field) return null;
      const pc = strapi
        .plugin('content-manager')
        .service('permission-checker')
        .create({ userAbility: ability, model: target.uid });
      if (pc.cannot.read(null, field)) return null;
      const entry = await strapi.documents(target.uid).findOne({
        documentId: target.documentId,
        ...(target.locale ? { locale: target.locale } : {}),
        status: 'draft',
        fields: [field],
      });
      return entry && typeof entry[field] === 'string' ? normalizeExcerpt(entry[field]) : null;
    } catch {
      return null;
    }
  };

  /**
   * Content Manager link data of an entry (the admin builds the URL).
   * @param {{ uid: string, documentId: string, locale: string|null }} target - Entry.
   * @returns {{ kind: 'collectionType'|'singleType', uid: string, documentId: string, locale: string|null, typeName: string }} Link.
   */
  const linkOf = (target) => {
    const contentType = strapi.contentType(target.uid) || {};
    return {
      kind: contentType.kind === 'singleType' ? 'singleType' : 'collectionType',
      uid: target.uid,
      documentId: target.documentId,
      locale: target.locale || null,
      typeName: normalizeExcerpt(contentType.info && contentType.info.displayName) || target.uid,
    };
  };

  /**
   * Broken-link entries of the last scheduled run, computed once per finished run per process
   * (bounded scans of the link tables).
   * @param {object|null} lastRun - Stored last run.
   * @returns {Promise<{ entries: Array<{ uid: string, documentId: string, locale: string|null, fields: string[], problems: number }>, truncated: boolean }>} Summary.
   */
  const brokenSummary = async (lastRun) => {
    const runKey = lastRun ? `${lastRun.startedAt || ''}|${lastRun.finishedAt || ''}` : '';
    if (brokenCache && brokenCache.runKey === runKey) return brokenCache;
    const problems = await store().problemLinkUrls(PROBLEMS, MAX_PROBLEM_URLS);
    let truncated = problems.size >= MAX_PROBLEM_URLS;
    const byEntry = new Map();
    if (problems.size) {
      let after = '';
      let scanned = 0;
      for (;;) {
        const rows = await store().linkFieldsPage(after, LINK_PAGE);
        if (!rows.length) break;
        scanned += rows.length;
        after = rows[rows.length - 1].key;
        for (const row of rows) {
          const bad = new Set(row.links.map((link) => link.h).filter((hash) => problems.has(hash)));
          if (!bad.size) continue;
          const key = `${row.uid}|${row.documentId}|${row.locale || '-'}`;
          const entry = byEntry.get(key) || {
            uid: row.uid,
            documentId: row.documentId,
            locale: row.locale,
            fields: new Set(),
            urls: new Set(),
          };
          entry.fields.add(row.field);
          bad.forEach((hash) => entry.urls.add(hash));
          byEntry.set(key, entry);
        }
        if (rows.length < LINK_PAGE) break;
        if (scanned >= MAX_LINK_ROWS) {
          truncated = true;
          break;
        }
      }
    }
    const entries = Array.from(byEntry.values())
      .map((entry) => ({
        uid: entry.uid,
        documentId: entry.documentId,
        locale: entry.locale,
        fields: Array.from(entry.fields).slice(0, 20),
        problems: entry.urls.size,
      }))
      .sort((a, b) => b.problems - a.problems || a.documentId.localeCompare(b.documentId));
    if (entries.length > MAX_BROKEN_ENTRIES) truncated = true;
    brokenCache = { runKey, entries: entries.slice(0, MAX_BROKEN_ENTRIES), truncated };
    return brokenCache;
  };

  return {
    PRESENCE_TTL_MS,

    /**
     * Heartbeat and presence of one document locale: refreshes (or removes) the caller's row for this
     * tab when the caller may update the entry, and lists the other admins who edit it now.
     * @param {{ userAbility: object, user: object, uid: string, documentId: string, locale?: string|null, tabId: string, idle?: boolean, leave?: boolean }} input - Request.
     * @returns {Promise<{ enabled: boolean, softLock: boolean, canEdit: boolean, editors: Array<{ id: string, name: string, color: string, idle: boolean, live: boolean }> }>} Presence.
     * @throws {errors.NotFoundError} When the document cannot be read.
     * @throws {errors.RateLimitError} 429 above `presence.perMinute`.
     * @sideeffect Upserts or deletes one row in `magic_editor_x_collab_presence`; prunes stale rows once a minute.
     */
    async presence({ userAbility, user, uid, documentId, locale, tabId, idle = false, leave = false }) {
      const enabled = conf('presence.enabled', true) !== false;
      await limit(`presence:${user.id}`, Number(conf('presence.perMinute', 30)) || 30);
      const checked = await access().checkDocument({ userAbility, uid, documentId, locale });
      const softLock = enabled && conf('presence.softLock', false) === true;
      const id = entryRowId(user.id, tabId);
      if (!enabled) {
        return { enabled: false, softLock: false, canEdit: checked.canUpdate, editors: [] };
      }
      const prefix = `${uid}|${documentId}|${checked.locale || '-'}|`;
      const suffix = store().ENTRY_PRESENCE_SUFFIX;
      if (leave || !checked.canUpdate) {
        await store().removePresence(id);
      } else {
        await store().upsertPresence({
          id,
          room: `${prefix}${suffix.slice(1)}`,
          userId: user.id,
          name: displayName(user),
          color: colorFor(user.id),
          canEdit: true,
          cursor: idle ? { idle: true } : null,
        });
      }
      const now = Date.now();
      if (now - lastPrune > PRUNE_EVERY_MS) {
        lastPrune = now;
        // Collaboration maintenance prunes too; this keeps the table small when collaboration is off.
        store()
          .prunePresence(now - PRESENCE_TTL_MS * 2)
          .catch((error) => logger.warn('presence prune failed', { code: error && error.code }));
      }
      const rows = leave ? [] : await store().listDocumentPresence(prefix, now - PRESENCE_TTL_MS);
      return {
        enabled: true,
        softLock,
        canEdit: checked.canUpdate,
        editors: groupEditors(rows, prefix, user.id, suffix),
      };
    },

    /**
     * Summary of one document locale for the side panel: per readable editor field the open comment
     * threads, the accessibility lint counts of the saved draft and the problems of the scheduled
     * link check (draft and published).
     * @param {{ userAbility: object, user: object, uid: string, documentId: string, locale?: string|null }} input - Request.
     * @returns {Promise<object>} Summary (see AGENTS.md "Entry panel, presence and widgets (2.5)").
     * @throws {errors.NotFoundError} When the document cannot be read.
     * @throws {errors.RateLimitError} 429 above 60 requests per minute.
     */
    async summary({ userAbility, user, uid, documentId, locale }) {
      await limit(`entrypanel:${user.id}`, 60);
      const checked = await access().checkDocument({ userAbility, uid, documentId, locale });
      const { contentType, checker: pc } = checked;
      const query = guardQuery(strapi, contentType, 0, isEditorAttribute);
      const draft = query
        ? await strapi.documents(uid).findOne({
            documentId,
            ...(checked.locale ? { locale: checked.locale } : {}),
            status: 'draft',
            fields: query.fields.length ? query.fields : ['documentId'],
            ...(Object.keys(query.populate).length ? { populate: query.populate } : {}),
          })
        : null;
      if (!draft) throw notFound();
      const fields = [];
      for (const { field: path, value, options } of collectGuarded(
        strapi,
        contentType,
        draft,
        '',
        [],
        0,
        isEditorAttribute
      )) {
        if (fields.length >= MAX_FIELDS) break;
        const resolved = resolveEditorField(strapi, contentType, path);
        if (!resolved) continue;
        if (pc.cannot.read(null, resolved.permissionField || resolved.topLevel)) continue;
        const key = value && typeof value === 'object' ? value.fieldKey : null;
        const identity = fieldIdentity(path, key) || null;
        let issues = { errors: 0, warnings: 0 };
        if (value && typeof value === 'object') {
          try {
            const lint = lintDocument(value, { requireAlt: options.requireAlt === true });
            issues = {
              errors: lint.issues.filter((issue) => issue.severity === 'error').length,
              warnings: lint.issues.filter((issue) => issue.severity !== 'error').length,
            };
          } catch {
            issues = { errors: 0, warnings: 0 };
          }
        }
        fields.push({
          path,
          label: pathLabel(path),
          field: resolved.positional && !key ? null : identity,
          positional: Boolean(resolved.positional),
          issues,
          openThreads: null,
          brokenLinks: { draft: null, published: null },
        });
      }
      const identities = fields.map((field) => field.field).filter(Boolean);

      // Comments: open root threads per field identity, one bounded query.
      const commentsOn =
        conf('comments.enabled', true) !== false &&
        can(userAbility, ACTIONS.access) &&
        can(userAbility, ACTIONS.commentsRead);
      let openThreads = null;
      if (commentsOn) {
        const counts = new Map();
        if (identities.length) {
          const rows = await strapi.db.query(COMMENT_UID).findMany({
            where: {
              contentType: uid,
              entryId: documentId,
              entryLocale: checked.locale || null,
              threadId: null,
              fieldName: { $in: identities },
              $or: [{ resolved: false }, { resolved: null }],
            },
            select: ['fieldName'],
            limit: MAX_COMMENT_ROWS,
          });
          for (const row of rows) counts.set(row.fieldName, (counts.get(row.fieldName) || 0) + 1);
        }
        openThreads = 0;
        for (const field of fields) {
          field.openThreads = field.field ? counts.get(field.field) || 0 : 0;
          openThreads += field.openThreads;
        }
      }

      // Scheduled link check: draft and published rows of every field identity (primary keys, two queries).
      const schedule = plugin().service('link-schedule');
      let links = { enabled: false, lastRun: null, draft: null, published: null };
      const linkState = await schedule.report(null);
      if (linkState.enabled) {
        links = { enabled: true, lastRun: linkState.lastRun, draft: 0, published: 0 };
        const keyOf = new Map();
        for (const field of fields) {
          if (!field.field) continue;
          field.brokenLinks = { draft: 0, published: 0 };
          for (const version of ['draft', 'published'])
            keyOf.set(
              linkFieldKey({ uid, documentId, locale: checked.locale, field: field.field, version }),
              { field, version }
            );
        }
        const rows = keyOf.size ? await store().getLinkFields(Array.from(keyOf.keys())) : [];
        const urls = await store().getLinkUrls([
          ...new Set(rows.flatMap((row) => row.links.map((link) => link.h))),
        ]);
        for (const row of rows) {
          const owner = keyOf.get(row.key);
          if (!owner) continue;
          const problems = new Set(
            row.links
              .filter((link) => {
                const entry = urls.get(link.h);
                return entry && PROBLEMS.includes(entry.status);
              })
              .map((link) => link.h)
          ).size;
          owner.field.brokenLinks[owner.version] = problems;
          links[owner.version] += problems;
        }
      }
      return {
        fields,
        comments: { enabled: commentsOn, open: openThreads },
        quality: {
          errors: fields.reduce((sum, field) => sum + field.issues.errors, 0),
          warnings: fields.reduce((sum, field) => sum + field.issues.warnings, 0),
        },
        links,
      };
    },

    /**
     * The caller's open threads: unresolved threads they started or were mentioned in, newest
     * activity first, only on fields they can still read.
     * @param {{ id: number }} user - Caller.
     * @param {object} ability - Caller's ability.
     * @param {{ pageSize: number }} options - Size (1-20).
     * @returns {Promise<{ data: Array<object>, meta: { total: number, more: boolean } }>} Threads.
     * @throws {errors.NotFoundError} When comments are off.
     */
    async openThreads(user, ability, { pageSize }) {
      if (conf('comments.enabled', true) === false) throw notFound();
      await limit(`widgets:${user.id}`, 60);
      const comments = strapi.db.query(COMMENT_UID);
      const unresolved = { $or: [{ resolved: false }, { resolved: null }] };
      const select = [
        'documentId',
        'contentType',
        'entryId',
        'entryLocale',
        'fieldName',
        'excerpt',
        'body',
        'authorId',
        'authorName',
        'updatedAt',
      ];
      const started = await comments.findMany({
        where: { threadId: null, authorId: user.id, ...unresolved },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        limit: THREAD_SCAN,
        select,
      });
      const mentions = await strapi.db.query(NOTIFICATION_UID).findMany({
        where: { recipientId: user.id, kind: 'mention' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        limit: THREAD_SCAN,
        select: ['threadId'],
      });
      const mentionedIds = Array.from(new Set(mentions.map((row) => row.threadId).filter(Boolean)));
      const mentioned = mentionedIds.length
        ? await comments.findMany({
            where: { threadId: null, documentId: { $in: mentionedIds }, ...unresolved },
            select,
          })
        : [];
      const mentionedSet = new Set(mentioned.map((row) => row.documentId));
      const byId = new Map();
      for (const row of [...started, ...mentioned]) byId.set(row.documentId, row);
      const rows = Array.from(byId.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const canRead = fieldReadCache(ability);
      const visible = [];
      let more = false;
      for (const row of rows) {
        const target = targetOf({
          uid: row.contentType,
          documentId: row.entryId,
          locale: row.entryLocale,
          fieldName: row.fieldName,
        });
        if (!target || !(await canRead(target))) continue;
        if (visible.length >= pageSize) {
          more = true;
          break;
        }
        visible.push({ row, target });
      }
      const titles = new Map();
      const data = [];
      for (const { row, target } of visible) {
        const titleKey = `${target.uid}|${target.documentId}|${target.locale || ''}`;
        if (!titles.has(titleKey)) titles.set(titleKey, await titleFor(ability, target));
        data.push({
          threadId: row.documentId,
          started: Number(row.authorId) === Number(user.id),
          mentioned: mentionedSet.has(row.documentId),
          excerpt: normalizeExcerpt(row.excerpt) || null,
          snippet: normalizeExcerpt(row.body),
          updatedAt: row.updatedAt,
          target: { ...linkOf(target), title: titles.get(titleKey) },
        });
      }
      return { data, meta: { more } };
    },

    /**
     * Entries with broken links in the last scheduled link check that the caller may read (the field
     * with the problem included), most problems first.
     * @param {{ id: number }} user - Caller.
     * @param {object} ability - Caller's ability.
     * @param {{ pageSize: number }} options - Size (1-20).
     * @returns {Promise<{ data: Array<object>, meta: { enabled: boolean, lastRun: object|null, more: boolean, truncated: boolean } }>} Entries.
     */
    async brokenLinks(user, ability, { pageSize }) {
      await limit(`widgets:${user.id}`, 60);
      const schedule = plugin().service('link-schedule');
      const state = await schedule.status();
      const lastRun = state.lastRun
        ? { finishedAt: state.lastRun.finishedAt || null, complete: state.lastRun.complete === true }
        : null;
      if (!state.enabled)
        return { data: [], meta: { enabled: false, lastRun: null, more: false, truncated: false } };
      const summary = await brokenSummary(state.lastRun || null);
      const canRead = fieldReadCache(ability);
      const visible = [];
      let more = false;
      for (const entry of summary.entries) {
        let readable = false;
        for (const fieldName of entry.fields) {
          const target = targetOf({ ...entry, fieldName });
          if (target && (await canRead(target))) {
            readable = true;
            break;
          }
        }
        if (!readable) continue;
        if (visible.length >= pageSize) {
          more = true;
          break;
        }
        visible.push(entry);
      }
      const data = [];
      for (const entry of visible) {
        const target = { uid: entry.uid, documentId: entry.documentId, locale: entry.locale || null };
        data.push({
          problems: entry.problems,
          target: { ...linkOf(target), title: await titleFor(ability, target) },
        });
      }
      return { data, meta: { enabled: true, lastRun, more, truncated: summary.truncated } };
    },
  };
};

module.exports.pathLabel = pathLabel;
module.exports.groupEditors = groupEditors;
module.exports.entryRowId = entryRowId;

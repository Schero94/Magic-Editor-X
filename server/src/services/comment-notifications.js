'use strict';

const { errors } = require('@strapi/utils');
const { ACTIONS } = require('../permissions');
const { createLogger } = require('../utils/logger');
const { createRateLimiter } = require('../utils/rate-limit');
const { normalizeExcerpt } = require('../../../shared/comments.mjs');
const { cleanMentionIds, MAX_MENTION_QUERY } = require('../../../shared/comment-mentions.mjs');
const { parseFieldIdentity } = require('../../../shared/field-identity.mjs');

/**
 * @mentions and in-admin notifications of comments (2.4).
 *
 * Access rule (the one rule everything here follows): a person can be
 * mentioned, notified, listed in the picker or e-mailed about a comment only
 * when their own permissions let them read that comment right now, that is
 * `plugin::magic-editor-x.access` + `comments.read` and Content Manager read
 * on the document, locale and field (`services/access.js` `checkField` with
 * their ability). Listings check the recipient's access again on every read,
 * so a notification about a document they lost access to is not shown.
 *
 * Rows of `plugin::magic-editor-x.comment-notification` hold ids only (no
 * text). The person who caused a notification is the author of the comment,
 * read from the comment row (its name snapshot is cleared when that admin is
 * deleted). Nothing here is logged except operation names and error codes.
 */

const UID = 'plugin::magic-editor-x.comment-notification';
const COMMENT_UID = 'plugin::magic-editor-x.comment';
const ID_PATTERN = /^[a-z0-9]{1,64}$/;

/** Candidates read per picker search before the access check. */
const PICKER_CANDIDATES = 25;
/** People returned by one picker search. */
const PICKER_RESULTS = 8;
/** Notifications scanned per listing (newest first). */
const LIST_SCAN = 200;
/** Recipients of one comment (mentions + thread participants). */
const MAX_RECIPIENTS = 50;

const notFound = () => new errors.NotFoundError('Not found');

/** E-mail address shape accepted for sending (one address, no header characters). */
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

/**
 * One header-safe line: control characters (CR, LF included), line and
 * paragraph separators and bidi overrides removed, bounded.
 * @param {unknown} value - Text.
 * @param {number} max - Longest result.
 * @returns {string} Clean text.
 */
const headerSafe = (value, max) =>
  (normalizeExcerpt(typeof value === 'string' ? value : '') || '')
    // eslint-disable-next-line no-control-regex -- header injection guard
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .slice(0, max)
    .trim();

/**
 * Escapes text for HTML (mention e-mails: providers such as nodemailer send the plain text as the
 * HTML part when no `html` is given, so an unescaped name would be HTML).
 * @param {string} value - Text.
 * @returns {string} Escaped text.
 */
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Display name of an admin user, bounded.
 * @param {{ firstname?: string, lastname?: string, username?: string }|null} user - Admin user.
 * @returns {string|null} Name.
 */
const nameOf = (user) => {
  if (!user) return null;
  const name = [user.firstname, user.lastname].filter((part) => typeof part === 'string' && part).join(' ');
  return (normalizeExcerpt(name) || normalizeExcerpt(user.username) || '').slice(0, 200) || null;
};

/**
 * Access-check target of a stored comment or notification row.
 * @param {{ contentType: string, entryId: string, entryLocale?: string|null, fieldName: string }} row - Row.
 * @returns {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }|null}
 *   Target, or null for rows saved by position before 2.4 (never notified).
 */
const targetOfRow = (row) => {
  const parsed = parseFieldIdentity(row.fieldName);
  if (!parsed || parsed.legacy) return null;
  return {
    uid: row.contentType,
    documentId: row.entryId,
    locale: row.entryLocale || null,
    field: parsed.field,
    ...(parsed.fieldKey ? { fieldKey: parsed.fieldKey } : {}),
  };
};

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);
  const comments = () => strapi.db.query(COMMENT_UID);
  const access = () => strapi.plugin('magic-editor-x').service('access');
  const logger = createLogger(strapi);
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.comments.${key}`);
    return value === undefined ? fallback : value;
  };
  let fallbackLimiter = null;

  /**
   * True when an ability includes the plugin's comment read rights.
   * @param {object|null} ability - CASL ability.
   * @returns {boolean} Result.
   */
  const canReadComments = (ability) => {
    try {
      return Boolean(ability && ability.can(ACTIONS.access) && ability.can(ACTIONS.commentsRead));
    } catch {
      return false;
    }
  };

  /**
   * Per-call cache of abilities and access results (abilities are built from the database once).
   * @returns {{ ability: (id: number) => Promise<object|null>, canRead: (ability: object, target: object) => Promise<boolean> }} Cache.
   */
  const accessCache = () => {
    const abilities = new Map();
    const results = new WeakMap();
    return {
      async ability(id) {
        if (!abilities.has(id)) {
          let ability;
          try {
            ability = await access().abilityForUser(id);
          } catch {
            ability = null;
          }
          abilities.set(id, canReadComments(ability) ? ability : null);
        }
        return abilities.get(id);
      },
      async canRead(ability, target) {
        if (!ability || !target) return false;
        if (!results.has(ability)) results.set(ability, new Map());
        const cache = results.get(ability);
        const key = `${target.uid}|${target.documentId}|${target.locale || ''}|${target.field}|${target.fieldKey || ''}`;
        if (!cache.has(key)) {
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
      },
    };
  };

  /**
   * Counts one event against a per-admin limit shared by all processes.
   * @param {string} key - Counter key.
   * @param {number} max - Limit.
   * @param {number} windowMs - Window.
   * @returns {Promise<boolean>} Allowed.
   */
  const hit = async (key, max, windowMs) => {
    try {
      const { count } = await strapi.plugin('magic-editor-x').service('store').hit(key, windowMs);
      return count <= max;
    } catch {
      if (!fallbackLimiter) fallbackLimiter = createRateLimiter({ max: 1000, windowMs: 60000 });
      return fallbackLimiter.hit(key).allowed;
    }
  };

  /**
   * Active admin users by id (name fields and documentId only).
   * @param {number[]} ids - Admin ids.
   * @returns {Promise<Map<number, object>>} Users.
   */
  const usersById = async (ids) => {
    const list = Array.from(new Set(ids.filter((id) => Number.isInteger(Number(id))).map(Number)));
    if (!list.length) return new Map();
    const rows = await strapi.db.query('admin::user').findMany({
      where: { id: { $in: list.slice(0, 500) } },
      select: ['id', 'documentId', 'firstname', 'lastname', 'username', 'isActive', 'blocked'],
    });
    return new Map(rows.map((row) => [Number(row.id), row]));
  };

  /**
   * Title of an entry for a reader: the Content Manager main field when the
   * reader may read that field, else null.
   * @param {object} ability - Reader's ability.
   * @param {{ uid: string, documentId: string, locale: string|null }} target - Entry.
   * @returns {Promise<string|null>} Title (plain, bounded) or null.
   */
  const titleFor = async (ability, target) => {
    try {
      const contentType = strapi.contentType(target.uid);
      if (!contentType) return null;
      const field = await strapi.plugin('magic-editor-x').service('links').titleFieldFor(contentType);
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
   * Content Manager link data of a target (the admin builds the URL).
   * @param {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }} target - Target.
   * @returns {{ kind: 'collectionType'|'singleType', uid: string, documentId: string, locale: string|null, field: string, fieldKey: string|null, typeName: string }} Link data.
   */
  const linkOf = (target) => {
    const contentType = strapi.contentType(target.uid) || {};
    return {
      kind: contentType.kind === 'singleType' ? 'singleType' : 'collectionType',
      uid: target.uid,
      documentId: target.documentId,
      locale: target.locale || null,
      field: target.field,
      fieldKey: target.fieldKey || null,
      typeName: normalizeExcerpt(contentType.info && contentType.info.displayName) || target.uid,
    };
  };

  /**
   * Absolute Content Manager URL of a thread (e-mails).
   * @param {object} link - `linkOf` result.
   * @param {string} threadId - Thread id.
   * @returns {string|null} URL, or null when the admin URL is unknown.
   */
  const adminUrlOf = (link, threadId) => {
    const base = strapi.config.get('admin.absoluteUrl');
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) return null;
    const kind = link.kind === 'singleType' ? 'single-types' : 'collection-types';
    const path =
      link.kind === 'singleType'
        ? `${kind}/${encodeURIComponent(link.uid)}`
        : `${kind}/${encodeURIComponent(link.uid)}/${encodeURIComponent(link.documentId)}`;
    const params = new URLSearchParams();
    if (link.locale) params.set('plugins[i18n][locale]', link.locale);
    params.set('mexThread', threadId);
    return `${base.replace(/\/+$/, '')}/content-manager/${path}?${params.toString()}`;
  };

  /**
   * Sends mention e-mails (owner opt-in `comments.notifications.email`), at
   * most `comments.notifications.emailPerHour` per recipient. The mail names
   * who mentioned the recipient, the entry title when the recipient may read
   * it, the content type and a link to the admin. The comment text is never
   * sent. Failures are logged without addresses and never reach the caller.
   * @param {Array<{ notification: object, recipientId: number, ability: object }>} items - New mention notifications.
   * @param {{ actorName: string|null, target: object, threadId: string }} context - Comment context.
   * @returns {Promise<number>} Mails sent.
   */
  const sendEmails = async (items, { actorName, target, threadId }) => {
    if (conf('notifications.email', false) !== true || !items.length) return 0;
    const plugin = strapi.plugin('email');
    const mailer = plugin && plugin.service('email');
    if (!mailer || typeof mailer.send !== 'function') return 0;
    const perHour = Number(conf('notifications.emailPerHour', 10)) || 10;
    const link = linkOf(target);
    const url = adminUrlOf(link, threadId);
    let sent = 0;
    for (const { notification, recipientId, ability } of items) {
      try {
        if (!(await hit(`mentionmail:${recipientId}`, perHour, 3600000))) continue;
        const user = await strapi.db
          .query('admin::user')
          .findOne({ where: { id: recipientId }, select: ['email', 'isActive', 'blocked'] });
        if (!user || user.isActive === false || user.blocked === true) continue;
        const to = typeof user.email === 'string' ? user.email.trim() : '';
        if (!EMAIL_PATTERN.test(to)) continue;
        const actor = headerSafe(actorName, 80) || 'Someone';
        const title = headerSafe(await titleFor(ability, target), 120);
        const typeName = headerSafe(link.typeName, 80);
        const where = title ? `"${title}" (${typeName})` : `an entry of ${typeName}`;
        const sentence = `${actor} mentioned you in a comment on ${where}.`;
        const footer =
          'You get this e-mail because e-mail notifications for mentions are turned on in Magic Editor X.';
        const lines = [
          sentence,
          '',
          url ? `Open the comment: ${url}` : 'Open the Content Manager to read the comment.',
          '',
          footer,
        ];
        // Own HTML part with every value escaped (names and titles come from admins and content).
        const html = [
          `<p>${escapeHtml(sentence)}</p>`,
          url
            ? `<p><a href="${escapeHtml(url)}">Open the comment</a></p>`
            : '<p>Open the Content Manager to read the comment.</p>',
          `<p>${escapeHtml(footer)}</p>`,
        ].join('');
        await mailer.send({
          to,
          subject: headerSafe(`${actor} mentioned you in a comment`, 150),
          text: lines.join('\n'),
          html,
        });
        await query().update({ where: { id: notification.id }, data: { emailedAt: new Date() } });
        sent += 1;
      } catch (error) {
        logger.warn('mention e-mail could not be sent', error);
      }
    }
    return sent;
  };

  return {
    UID,
    targetOfRow,

    /**
     * People the caller can mention in a field: active admins (not the caller)
     * whose name matches the query and who can read the field's comments.
     * Never searches e-mail addresses; returns opaque ids (the admin user's
     * documentId) and names only.
     * @param {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }} target - Field.
     * @param {string} text - Search text (max MAX_MENTION_QUERY).
     * @param {number} viewerId - Caller's admin id.
     * @returns {Promise<Array<{ id: string, name: string }>>} People.
     */
    async mentionable(target, text, viewerId) {
      const term = String(text || '')
        .slice(0, MAX_MENTION_QUERY)
        .trim();
      // `blocked` can be null on older rows (SQL `!= true` would drop them): filtered below.
      const where = { id: { $ne: viewerId }, isActive: true };
      if (term) {
        const parts = term.split(/\s+/).slice(0, 3);
        where.$and = parts.map((part) => ({
          $or: [
            { firstname: { $containsi: part } },
            { lastname: { $containsi: part } },
            { username: { $containsi: part } },
          ],
        }));
      }
      const candidates = await strapi.db.query('admin::user').findMany({
        where,
        select: ['id', 'documentId', 'firstname', 'lastname', 'username', 'blocked'],
        orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }, { id: 'asc' }],
        limit: PICKER_CANDIDATES,
      });
      const cache = accessCache();
      const out = [];
      for (const user of candidates) {
        if (out.length >= PICKER_RESULTS) break;
        if (user.blocked === true) continue;
        const name = nameOf(user);
        if (!name || typeof user.documentId !== 'string') continue;
        const ability = await cache.ability(Number(user.id));
        if (await cache.canRead(ability, target)) out.push({ id: user.documentId, name });
      }
      return out;
    },

    /**
     * Resolves picked mentions (opaque ids) to admins who may read the field's
     * comments. Others are dropped.
     * @param {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }} target - Field.
     * @param {unknown} ids - Opaque ids from the request.
     * @returns {Promise<{ ids: number[], dropped: number }>} Admin ids to store and how many were dropped.
     */
    async resolveMentions(target, ids) {
      const wanted = cleanMentionIds(ids);
      if (!wanted.length) return { ids: [], dropped: 0 };
      const users = await strapi.db.query('admin::user').findMany({
        where: { documentId: { $in: wanted }, isActive: true },
        select: ['id', 'documentId', 'blocked'],
        limit: wanted.length,
      });
      const cache = accessCache();
      const allowed = [];
      for (const user of users) {
        if (user.blocked === true) continue;
        const ability = await cache.ability(Number(user.id));
        if (await cache.canRead(ability, target)) allowed.push(Number(user.id));
      }
      return { ids: allowed, dropped: wanted.length - allowed.length };
    },

    /**
     * Mention DTOs of stored admin ids: `{ id (documentId), name, you }`;
     * deleted admins are left out (the text stays as written).
     * @param {Array<number[]|null>} lists - Mention id lists of several comments.
     * @param {number|null} viewerId - Caller.
     * @returns {Promise<(ids: unknown) => Array<{ id: string, name: string, you: boolean }>>} Mapper.
     */
    async mentionMapper(lists, viewerId) {
      const ids = lists.flatMap((list) => (Array.isArray(list) ? list : []));
      const users = await usersById(ids);
      return (list) =>
        (Array.isArray(list) ? list : [])
          .map((id) => users.get(Number(id)))
          .filter((user) => user && typeof user.documentId === 'string' && nameOf(user))
          .map((user) => ({
            id: user.documentId,
            name: nameOf(user),
            you: viewerId != null && Number(user.id) === Number(viewerId),
          }));
    },

    /**
     * Creates the notifications of a new or edited comment: one `mention` per
     * newly mentioned person, one `reply` per other participant of the thread
     * (root author, reply authors, people mentioned in the thread), never for
     * the author, at most one per person and comment. Every recipient's access
     * is checked again. Mention e-mails follow when the owner turned them on.
     * @param {object} comment - The comment row (root or reply).
     * @param {object} root - Its thread's root row (the same row for a new thread).
     * @param {{ mentioned: number[], isReply: boolean }} options - Newly mentioned admin ids; reply notifications.
     * @returns {Promise<{ mentions: number, replies: number }>} Created rows.
     * @sideeffect Inserts notification rows; may send e-mails (asynchronously).
     */
    async notify(comment, root, { mentioned, isReply }) {
      const target = targetOfRow(comment);
      if (!target) return { mentions: 0, replies: 0 };
      const authorId = comment.authorId == null ? null : Number(comment.authorId);
      const mentionIds = Array.from(new Set((mentioned || []).map(Number))).filter((id) => id !== authorId);
      let participants = [];
      if (isReply) {
        const rows = await comments().findMany({
          where: { $or: [{ documentId: root.documentId }, { threadId: root.documentId }] },
          select: ['authorId', 'mentions'],
          limit: 500,
        });
        const ids = new Set();
        for (const row of rows) {
          if (row.authorId != null) ids.add(Number(row.authorId));
          for (const id of Array.isArray(row.mentions) ? row.mentions : []) ids.add(Number(id));
        }
        participants = Array.from(ids).filter((id) => id !== authorId && !mentionIds.includes(id));
      }
      const recipients = [
        ...mentionIds.map((id) => ({ id, kind: 'mention' })),
        ...participants.map((id) => ({ id, kind: 'reply' })),
      ].slice(0, MAX_RECIPIENTS);
      if (!recipients.length) return { mentions: 0, replies: 0 };
      const existing = await query().findMany({
        where: { commentId: comment.documentId, recipientId: { $in: recipients.map((item) => item.id) } },
        select: ['recipientId'],
      });
      const already = new Set(existing.map((row) => Number(row.recipientId)));
      const cache = accessCache();
      const emails = [];
      const created = { mentions: 0, replies: 0 };
      for (const { id, kind } of recipients) {
        if (already.has(id)) continue;
        const ability = await cache.ability(id);
        if (!(await cache.canRead(ability, target))) continue;
        const notification = await query().create({
          data: {
            recipientId: id,
            kind,
            commentId: comment.documentId,
            threadId: root.documentId,
            contentType: comment.contentType,
            entryId: comment.entryId,
            entryLocale: comment.entryLocale || null,
            fieldName: comment.fieldName,
            blockId: comment.blockId || null,
            readAt: null,
          },
        });
        if (kind === 'mention') {
          created.mentions += 1;
          emails.push({ notification, recipientId: id, ability });
        } else created.replies += 1;
      }
      if (emails.length) {
        // After the response: a slow mail server never delays the comment.
        setImmediate(() => {
          sendEmails(emails, { actorName: comment.authorName, target, threadId: root.documentId }).catch(
            () => {}
          );
        });
      }
      return created;
    },

    /**
     * Removes the mention notifications of people no longer mentioned in an edited comment.
     * @param {string} commentId - Comment documentId.
     * @param {number[]} keep - Admin ids still mentioned.
     * @returns {Promise<void>}
     * @sideeffect Deletes rows.
     */
    async pruneMentions(commentId, keep) {
      await query().deleteMany({
        where: { commentId, kind: 'mention', ...(keep.length ? { recipientId: { $notIn: keep } } : {}) },
      });
    },

    /**
     * Unread notifications of the caller for one field (for the comments panel).
     * @param {{ uid: string, documentId: string, locale: string|null, field: string }} where - Field (identity in `field`).
     * @param {number} userId - Caller.
     * @returns {Promise<Array<{ id: string, threadId: string, commentId: string, kind: string }>>} Notifications.
     */
    async forField({ uid, documentId, locale, field }, userId) {
      const rows = await query().findMany({
        where: {
          recipientId: userId,
          readAt: null,
          contentType: uid,
          entryId: documentId,
          entryLocale: locale || null,
          fieldName: field,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        limit: 50,
      });
      return rows.map((row) => ({
        id: row.documentId,
        threadId: row.threadId,
        commentId: row.commentId,
        kind: row.kind,
      }));
    },

    /**
     * Notifications of the caller, newest first, filtered by the caller's
     * current access (rows of documents they cannot read are not shown).
     * @param {{ id: number }} user - Caller.
     * @param {object} ability - Caller's ability.
     * @param {{ page: number, pageSize: number, unread: boolean }} options - Paging and filter.
     * @returns {Promise<{ data: object[], meta: { unread: number, pagination: { page: number, pageSize: number, total: number, pageCount: number } } }>} Listing.
     */
    async list(user, ability, { page, pageSize, unread }) {
      const rows = await query().findMany({
        where: { recipientId: user.id, ...(unread ? { readAt: null } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        limit: LIST_SCAN,
      });
      const cache = accessCache();
      const visible = [];
      for (const row of rows) {
        const target = targetOfRow(row);
        if (target && (await cache.canRead(ability, target))) visible.push({ row, target });
      }
      const unreadCount = visible.filter(({ row }) => !row.readAt).length;
      const start = (page - 1) * pageSize;
      const slice = visible.slice(start, start + pageSize);
      const commentRows = slice.length
        ? await comments().findMany({
            where: {
              documentId: {
                $in: Array.from(new Set(slice.flatMap(({ row }) => [row.commentId, row.threadId]))),
              },
            },
            select: ['documentId', 'body', 'excerpt', 'authorId', 'authorName', 'anchor'],
          })
        : [];
      const byId = new Map(commentRows.map((row) => [row.documentId, row]));
      const titles = new Map();
      const data = [];
      for (const { row, target } of slice) {
        const titleKey = `${target.uid}|${target.documentId}|${target.locale || ''}`;
        if (!titles.has(titleKey)) titles.set(titleKey, await titleFor(ability, target));
        const comment = byId.get(row.commentId) || null;
        const root = byId.get(row.threadId) || null;
        data.push({
          id: row.documentId,
          kind: row.kind,
          read: Boolean(row.readAt),
          createdAt: row.createdAt,
          threadId: row.threadId,
          actor: {
            name: comment && comment.authorId != null ? comment.authorName || null : null,
            deleted: !comment || comment.authorId == null,
          },
          snippet: comment ? normalizeExcerpt(comment.body) : null,
          excerpt: root ? root.excerpt || null : null,
          target: { ...linkOf(target), title: titles.get(titleKey) },
        });
      }
      return {
        data,
        meta: {
          unread: unreadCount,
          pagination: {
            page,
            pageSize,
            total: visible.length,
            pageCount: Math.max(1, Math.ceil(visible.length / pageSize)),
          },
        },
      };
    },

    /**
     * Marks one of the caller's notifications read or unread.
     * @param {string} id - Notification documentId.
     * @param {number} userId - Caller.
     * @param {boolean} read - New state.
     * @returns {Promise<{ id: string, read: boolean }>} State.
     * @throws {errors.NotFoundError} Missing or someone else's notification.
     * @sideeffect Updates `readAt`.
     */
    async setRead(id, userId, read) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw notFound();
      const row = await query().findOne({ where: { documentId: id, recipientId: userId } });
      if (!row) throw notFound();
      await query().update({ where: { id: row.id }, data: { readAt: read ? new Date() : null } });
      return { id: row.documentId, read };
    },

    /**
     * Marks the caller's notifications read: all of them, or those of some threads.
     * @param {number} userId - Caller.
     * @param {string[]|null} threadIds - Threads (null: all).
     * @returns {Promise<number>} Rows changed.
     * @sideeffect Updates `readAt`.
     */
    async readAll(userId, threadIds = null) {
      const where = { recipientId: userId, readAt: null };
      if (Array.isArray(threadIds)) {
        if (!threadIds.length) return 0;
        where.threadId = { $in: threadIds };
      }
      const result = await query().updateMany({ where, data: { readAt: new Date() } });
      return Number(result && result.count) || 0;
    },

    /**
     * Deletes the notifications of deleted comments or threads.
     * @param {string[]} commentIds - Comment documentIds (a thread root also removes the thread's notifications).
     * @returns {Promise<void>}
     * @sideeffect Deletes rows.
     */
    async removeForComments(commentIds) {
      const ids = commentIds.filter((id) => typeof id === 'string' && ID_PATTERN.test(id));
      if (!ids.length) return;
      await query().deleteMany({ where: { $or: [{ commentId: { $in: ids } }, { threadId: { $in: ids } }] } });
    },

    /**
     * Deletes the notifications of deleted entries (same rule as the comments).
     * @param {string} uid - Content type uid.
     * @param {string} documentId - Document id.
     * @param {Array<string|null>} locales - Deleted locales (null: not localised).
     * @returns {Promise<void>}
     * @sideeffect Deletes rows.
     */
    async removeForEntries(uid, documentId, locales) {
      const named = Array.from(new Set(locales.filter((locale) => typeof locale === 'string' && locale)));
      const or = [];
      if (named.length) or.push({ entryLocale: { $in: named } });
      if (locales.some((locale) => !locale)) or.push({ entryLocale: null });
      if (!or.length) return;
      await query().deleteMany({ where: { contentType: uid, entryId: documentId, $or: or } });
    },

    /**
     * Deletes the notifications of a deleted admin user.
     * @param {number} userId - Deleted admin id.
     * @returns {Promise<void>}
     * @sideeffect Deletes rows.
     */
    async removeForRecipient(userId) {
      if (userId == null) return;
      await query().deleteMany({ where: { recipientId: userId } });
    },

    /**
     * Counts one picker search of an admin (`comments.mentionsPerMinute`, 429 above).
     * @param {number} userId - Admin id.
     * @returns {Promise<void>}
     * @throws {errors.RateLimitError} When the limit is reached.
     */
    async checkPickerRate(userId) {
      const max = Number(conf('mentionsPerMinute', 60)) || 60;
      if (!(await hit(`mentions:${userId}`, max, 60000)))
        throw new errors.RateLimitError('Too many searches. Try again in a minute.');
    },

    // For tests.
    _sendEmails: sendEmails,
    _adminUrlOf: adminUrlOf,
  };
};

module.exports.UID = UID;
module.exports.targetOfRow = targetOfRow;
module.exports.headerSafe = headerSafe;
module.exports.EMAIL_PATTERN = EMAIL_PATTERN;
module.exports.escapeHtml = escapeHtml;

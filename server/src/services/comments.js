'use strict';

const { errors } = require('@strapi/utils');
const { createRateLimiter } = require('../utils/rate-limit');
const {
  MAX_COMMENTS_PER_FIELD,
  MAX_REPLIES_PER_THREAD,
  normalizeCommentBody,
  normalizeExcerpt,
  groupThreads,
  countThreads,
} = require('../../../shared/comments.mjs');
const {
  parseFieldIdentity,
  basePathOf,
  ownerOfBlocks,
  fieldIdentity,
} = require('../../../shared/field-identity.mjs');

/**
 * Block comments (2.3).
 *
 * Data access only: callers (controllers/comments.js) check the RBAC actions
 * and Content Manager access first. Rows live in the hidden content type
 * `plugin::magic-editor-x.comment` (table `magic_editor_comments`) and are
 * read and written with the query engine, like the version history.
 *
 * Retention: comments of a document locale are deleted when that entry is
 * deleted (Document Service middleware in register.js); the author's admin id
 * and name snapshot are cleared when the admin user is deleted (lifecycle in
 * bootstrap.js), the text stays as "Deleted user".
 */

const UID = 'plugin::magic-editor-x.comment';
const ID_PATTERN = /^[a-z0-9]{1,64}$/;

const notFound = () => new errors.NotFoundError('Not found');

/**
 * Display name of an admin user (snapshot), bounded.
 * @param {{ firstname?: string, lastname?: string, username?: string }|null|undefined} user - Admin user.
 * @returns {string|null} Name.
 */
const displayName = (user) => {
  if (!user) return null;
  const name = [user.firstname, user.lastname].filter((part) => typeof part === 'string' && part).join(' ');
  return (normalizeExcerpt(name) || normalizeExcerpt(user.username) || '').slice(0, 200) || null;
};

/**
 * Stored row -> API object. Never exposes admin ids: `own` tells the viewer
 * whether they wrote it.
 * @param {object} row - Database row.
 * @param {number|null} viewerId - Admin id of the caller.
 * @returns {object} Comment DTO (with the thread fields grouped later).
 */
const toDto = (row, viewerId) => ({
  id: row.documentId,
  threadId: row.threadId || null,
  blockId: row.blockId,
  excerpt: row.threadId ? null : row.excerpt || null,
  body: row.body,
  author: {
    name: row.authorId == null ? null : row.authorName || null,
    own: viewerId != null && row.authorId != null && Number(row.authorId) === Number(viewerId),
    deleted: row.authorId == null,
  },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  editedAt: row.editedAt || null,
  status: row.resolved ? 'resolved' : 'open',
  resolvedAt: row.resolved ? row.resolvedAt || null : null,
  resolvedBy: row.resolved ? { name: row.resolvedById == null ? null : row.resolvedByName || null } : null,
});

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.comments.${key}`);
    return value === undefined ? fallback : value;
  };
  let fallbackLimiter = null;

  /**
   * Query filter of one field of one document locale.
   * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field.
   * @returns {object} Where clause.
   */
  const whereTarget = ({ uid, documentId, locale, field }) => ({
    contentType: uid,
    entryId: documentId,
    entryLocale: locale || null,
    fieldName: field,
  });

  /**
   * Loads one comment row by documentId.
   * @param {string} id - Comment id.
   * @returns {Promise<object>} Row.
   * @throws {errors.NotFoundError} When missing.
   */
  const findRow = async (id) => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw notFound();
    const row = await query().findOne({ where: { documentId: id } });
    if (!row) throw notFound();
    return row;
  };

  /**
   * Validated body or a 400.
   * @param {unknown} body - Untrusted text.
   * @returns {string} Clean text.
   */
  const cleanBody = (body) => {
    const text = normalizeCommentBody(body);
    if (!text) {
      throw new errors.ValidationError('Validation failed', {
        formErrors: [],
        fieldErrors: { body: ['The comment is empty'] },
      });
    }
    return text;
  };

  return {
    UID,
    displayName,

    /**
     * Target of a stored comment (for the access check).
     * @param {string} id - Comment id.
     * @returns {Promise<{ target: { uid: string, documentId: string, locale: string|null, field: string }, row: object }>} Target.
     * @throws {errors.NotFoundError} When the comment does not exist.
     */
    async findTarget(id) {
      const row = await findRow(id);
      const parsed = parseFieldIdentity(row.fieldName) || { field: String(row.fieldName), fieldKey: null };
      return {
        row,
        target: {
          uid: row.contentType,
          documentId: row.entryId,
          locale: row.entryLocale || null,
          field: parsed.field,
          ...(parsed.fieldKey ? { fieldKey: parsed.fieldKey } : {}),
          // 2.4: saved under a positional path before 2.4 and not mapped to one entry (read-only).
          legacy: Boolean(parsed.legacy),
        },
      };
    },

    /**
     * Maps threads stored under positional paths before 2.4 (`sections.0.body`)
     * to the entry they belong to: a thread whose block exists in exactly one
     * current entry belongs to it. Threads of entries with a key move to the
     * entry's identity with their replies, once. Threads that match no entry or
     * several stay where they are (read-only). Nothing is deleted.
     * @param {{ uid: string, documentId: string, locale: string|null, basePath: string }} target - Field without index.
     * @param {Array<{ path: string, fieldKey: string|null, blockIds: Set<string> }>} entries - Stored entries (access.checkField).
     * @param {number|null} viewerId - Caller's admin id (for `own`).
     * @returns {Promise<{ mapped: number, byPath: Map<string, object[]>, unmapped: object[] }>} Threads proven per
     *   entry path (entries without a key) and the unmapped threads.
     * @sideeffect Updates `fieldName` of mapped legacy rows.
     */
    async adoptLegacy({ uid, documentId, locale, basePath }, entries, viewerId) {
      const top = String(basePath).split('.')[0];
      const rows = (
        await query().findMany({
          where: {
            contentType: uid,
            entryId: documentId,
            entryLocale: locale || null,
            fieldName: { $startsWith: `${top}.`, $notContains: '#' },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          limit: MAX_COMMENTS_PER_FIELD * 4,
        })
      ).filter((row) => {
        const parsed = parseFieldIdentity(row.fieldName);
        return parsed && parsed.legacy && basePathOf(row.fieldName) === basePath;
      });
      const roots = rows.filter((row) => !row.threadId);
      const byPath = new Map();
      const unmappedRows = [];
      let mapped = 0;
      for (const root of roots) {
        const replies = rows.filter((row) => row.threadId === root.documentId);
        const owner = ownerOfBlocks([root.blockId], entries);
        const entry = owner === -1 ? null : entries[owner];
        if (entry && entry.fieldKey) {
          const ids = [root.id, ...replies.map((reply) => reply.id)];
          await query().updateMany({
            where: { id: { $in: ids }, fieldName: root.fieldName },
            data: { fieldName: fieldIdentity(basePath, entry.fieldKey, true) },
          });
          mapped += 1;
        } else if (entry) {
          if (!byPath.has(entry.path)) byPath.set(entry.path, []);
          byPath.get(entry.path).push(root, ...replies);
        } else unmappedRows.push(root, ...replies);
      }
      const threadsOf = (list) => groupThreads(list.map((row) => toDto(row, viewerId)));
      return {
        mapped,
        byPath: new Map(Array.from(byPath, ([path, list]) => [path, threadsOf(list)])),
        unmapped: threadsOf(unmappedRows).map((thread) => ({ ...thread, positional: true })),
      };
    },

    /**
     * Threads of one field (bounded by MAX_COMMENTS_PER_FIELD rows).
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field (locale already resolved).
     * @param {number|null} viewerId - Caller's admin id (for `own`).
     * @returns {Promise<{ threads: object[], counts: { open: number, resolved: number, comments: number } }>} Threads.
     */
    async list(target, viewerId) {
      const rows = await query().findMany({
        where: whereTarget(target),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        limit: MAX_COMMENTS_PER_FIELD,
      });
      const threads = groupThreads(rows.map((row) => toDto(row, viewerId)));
      return { threads, counts: countThreads(threads) };
    },

    /**
     * Counts one more comment of an admin against the per-minute limit,
     * shared by all processes (`magic_editor_x_counters`, key `comments:<adminId>`).
     * @param {number} userId - Admin id.
     * @returns {Promise<void>}
     * @throws {errors.RateLimitError} 429 when the limit is reached.
     */
    async checkRate(userId) {
      const perMinute = Number(conf('perMinute', 30)) || 30;
      let allowed;
      try {
        const { count } = await strapi
          .plugin('magic-editor-x')
          .service('store')
          .hit(`comments:${userId}`, 60000);
        allowed = count <= perMinute;
      } catch {
        if (!fallbackLimiter) fallbackLimiter = createRateLimiter({ max: perMinute, windowMs: 60000 });
        allowed = fallbackLimiter.hit(`comments:${userId}`).allowed;
      }
      if (!allowed) throw new errors.RateLimitError('Too many comments. Try again in a minute.');
    },

    /**
     * Opens a thread on a block.
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field (locale resolved).
     * @param {{ blockId: string, body: string, excerpt?: string|null }} input - Validated input.
     * @param {{ id: number }} user - Author (admin user).
     * @returns {Promise<object>} The new thread.
     * @throws {errors.ValidationError} Empty body or too many comments on the field.
     * @sideeffect Inserts one row.
     */
    async create(target, input, user) {
      const body = cleanBody(input.body);
      const count = await query().count({ where: whereTarget(target) });
      if (count >= MAX_COMMENTS_PER_FIELD) {
        throw new errors.ValidationError('This field has too many comments', { code: 'TOO_MANY_COMMENTS' });
      }
      const row = await query().create({
        data: {
          ...whereTarget(target),
          blockId: input.blockId,
          threadId: null,
          excerpt: normalizeExcerpt(input.excerpt),
          body,
          authorId: user.id,
          authorName: displayName(user),
          resolved: false,
        },
      });
      return groupThreads([toDto(row, user.id)])[0];
    },

    /**
     * Replies to a thread. A reply to a resolved thread reopens it.
     * @param {object} root - Root row (from findTarget).
     * @param {string} bodyInput - Untrusted body.
     * @param {{ id: number }} user - Author.
     * @returns {Promise<object>} The new comment.
     * @throws {errors.ValidationError} Not a thread, empty body or too many replies.
     * @sideeffect Inserts one row; may reopen the thread.
     */
    async reply(root, bodyInput, user) {
      if (root.threadId) {
        throw new errors.ValidationError('Replies go to the thread', { code: 'NOT_A_THREAD' });
      }
      const body = cleanBody(bodyInput);
      const target = {
        uid: root.contentType,
        documentId: root.entryId,
        locale: root.entryLocale,
        field: root.fieldName,
      };
      const [replies, total] = await Promise.all([
        query().count({ where: { threadId: root.documentId } }),
        query().count({ where: whereTarget(target) }),
      ]);
      if (replies >= MAX_REPLIES_PER_THREAD || total >= MAX_COMMENTS_PER_FIELD) {
        throw new errors.ValidationError('This thread has too many replies', { code: 'TOO_MANY_COMMENTS' });
      }
      const row = await query().create({
        data: {
          ...whereTarget(target),
          blockId: root.blockId,
          threadId: root.documentId,
          body,
          authorId: user.id,
          authorName: displayName(user),
          resolved: false,
        },
      });
      if (root.resolved) {
        await query().update({
          where: { id: root.id },
          data: { resolved: false, resolvedAt: null, resolvedById: null, resolvedByName: null },
        });
      }
      return toDto(row, user.id);
    },

    /**
     * Changes the text of a comment. Only its author may do this.
     * @param {object} row - Comment row.
     * @param {string} bodyInput - Untrusted body.
     * @param {{ id: number }} user - Caller.
     * @returns {Promise<object>} Updated comment.
     * @throws {errors.ForbiddenError} When the caller is not the author.
     * @sideeffect Updates `body` and `editedAt`.
     */
    async edit(row, bodyInput, user) {
      if (row.authorId == null || Number(row.authorId) !== Number(user.id)) {
        throw new errors.ForbiddenError('Only the author can edit this comment');
      }
      const body = cleanBody(bodyInput);
      const updated = await query().update({
        where: { id: row.id },
        data: { body, editedAt: new Date() },
      });
      return toDto(updated, user.id);
    },

    /**
     * Resolves or reopens a thread.
     * @param {object} root - Root row.
     * @param {boolean} resolved - New state.
     * @param {{ id: number }} user - Caller.
     * @returns {Promise<{ id: string, status: 'open'|'resolved', resolvedAt: string|null, resolvedBy: object|null }>} State.
     * @throws {errors.ValidationError} When the id is a reply.
     * @sideeffect Updates the root row.
     */
    async setResolved(root, resolved, user) {
      if (root.threadId) {
        throw new errors.ValidationError('Only threads can be resolved', { code: 'NOT_A_THREAD' });
      }
      const updated = await query().update({
        where: { id: root.id },
        data: resolved
          ? {
              resolved: true,
              resolvedAt: new Date(),
              resolvedById: user.id,
              resolvedByName: displayName(user),
            }
          : { resolved: false, resolvedAt: null, resolvedById: null, resolvedByName: null },
      });
      const dto = toDto(updated, user.id);
      return { id: dto.id, status: dto.status, resolvedAt: dto.resolvedAt, resolvedBy: dto.resolvedBy };
    },

    /**
     * Deletes a comment; deleting a thread's root deletes the thread.
     * Authors delete their own comments; deleting a thread that has replies
     * by other people, or anyone else's comment, needs `canModerate`.
     * @param {object} row - Comment row.
     * @param {{ id: number }} user - Caller.
     * @param {{ canWrite: boolean, canModerate: boolean }} rights - Caller's comment rights.
     * @returns {Promise<{ id: string, removed: number }>} Result.
     * @throws {errors.ForbiddenError} When the caller may not delete it.
     * @sideeffect Deletes rows.
     */
    async remove(row, user, { canWrite, canModerate }) {
      const own = row.authorId != null && Number(row.authorId) === Number(user.id);
      if (!canModerate && !(own && canWrite)) {
        throw new errors.ForbiddenError('You cannot delete this comment');
      }
      if (row.threadId) {
        await query().delete({ where: { id: row.id } });
        return { id: row.documentId, removed: 1 };
      }
      const replies = await query().findMany({
        where: { threadId: row.documentId },
        select: ['id', 'authorId'],
        limit: MAX_REPLIES_PER_THREAD * 2,
      });
      const othersReplied = replies.some(
        (reply) => reply.authorId == null || Number(reply.authorId) !== Number(user.id)
      );
      if (othersReplied && !canModerate) {
        throw new errors.ForbiddenError('This thread has replies from other people');
      }
      const ids = [row.id, ...replies.map((reply) => reply.id)];
      await query().deleteMany({ where: { id: { $in: ids } } });
      // Replies beyond the read bound (never expected) go too.
      await query().deleteMany({ where: { threadId: row.documentId } });
      return { id: row.documentId, removed: ids.length };
    },

    /**
     * Deletes the comments of deleted entries (Document Service `delete`).
     * @param {string} uid - Content type uid.
     * @param {string} documentId - Document id.
     * @param {Array<string|null>} locales - Locales whose entry was deleted (null: not localised).
     * @returns {Promise<number>} Rows removed.
     * @sideeffect Deletes rows.
     */
    async removeForEntries(uid, documentId, locales) {
      if (typeof uid !== 'string' || typeof documentId !== 'string' || !locales.length) return 0;
      const named = Array.from(new Set(locales.filter((locale) => typeof locale === 'string' && locale)));
      const or = [];
      if (named.length) or.push({ entryLocale: { $in: named } });
      if (locales.some((locale) => !locale)) or.push({ entryLocale: null });
      const result = await query().deleteMany({ where: { contentType: uid, entryId: documentId, $or: or } });
      return Number(result && result.count) || 0;
    },

    /**
     * Removes the personal data of a deleted admin user from comments: the
     * author id and name snapshot (the comment stays, shown as "Deleted
     * user") and the "resolved by" snapshot.
     * @param {number} userId - Deleted admin id.
     * @returns {Promise<void>}
     * @sideeffect Updates rows.
     */
    async anonymizeUser(userId) {
      if (userId == null) return;
      await query().updateMany({ where: { authorId: userId }, data: { authorId: null, authorName: null } });
      await query().updateMany({
        where: { resolvedById: userId },
        data: { resolvedById: null, resolvedByName: null },
      });
    },
  };
};

module.exports.UID = UID;
module.exports.toDto = toDto;
module.exports.displayName = displayName;

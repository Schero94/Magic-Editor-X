'use strict';

const { errors } = require('@strapi/utils');
const { ACTIONS } = require('../permissions');
const { service, recordAudit } = require('./helpers');
const { fieldIdentity } = require('../../../shared/audit.mjs');
const { z, parseOrThrow, fieldTargetSchema, documentIdSchema } = require('../utils/validation');
const { BLOCK_ID_PATTERN, MAX_COMMENT_LENGTH } = require('../../../shared/comments.mjs');

/** Comment text as typed; normalised (control characters removed) by the service. */
const bodySchema = z.string().min(1).max(MAX_COMMENT_LENGTH);

const createSchema = fieldTargetSchema.extend({
  blockId: z.string().regex(BLOCK_ID_PATTERN),
  body: bodySchema,
  excerpt: z.string().max(1000).nullish(),
});
const textSchema = z.strictObject({ body: bodySchema });
const idSchema = z.strictObject({ id: documentIdSchema });

/**
 * Block comments (2.3). Every route needs `access` and `comments.read`
 * (route policies); writing needs `comments.write`; deleting someone else's
 * comment needs `comments.moderate`. Every handler then checks that the
 * Content Manager lets the caller read the document, locale and field
 * (`services/access.js`); otherwise it answers 404. Comment ids of other
 * documents answer 404 the same way. Handlers log nothing (no content, no ids).
 */
module.exports = ({ strapi }) => {
  const access = () => service(strapi, 'access');
  const comments = () => service(strapi, 'comments');

  /** 404 when the owner turned comments off (`comments.enabled: false`). */
  const ensureEnabled = () => {
    if (strapi.config.get('plugin::magic-editor-x.comments.enabled') === false) {
      throw new errors.NotFoundError('Not found');
    }
  };

  /**
   * Comment rights of the caller.
   * @param {object} ctx - Koa context.
   * @returns {{ canWrite: boolean, canModerate: boolean }} Rights.
   */
  const rights = (ctx) => {
    const can = (action) => {
      try {
        return Boolean(ctx.state.userAbility && ctx.state.userAbility.can(action));
      } catch {
        return false;
      }
    };
    return { canWrite: can(ACTIONS.commentsWrite), canModerate: can(ACTIONS.commentsModerate) };
  };

  /**
   * Loads a comment and checks that the caller can read its document.
   * @param {object} ctx - Koa context.
   * @returns {Promise<object>} Comment row.
   * @throws {errors.NotFoundError} Missing comment or no read access.
   */
  const loadReadable = async (ctx) => {
    const { id } = parseOrThrow(idSchema, { id: ctx.params.id });
    const { row, target } = await comments().findTarget(id);
    await access().checkField({ userAbility: ctx.state.userAbility, ...target });
    return row;
  };

  /**
   * Audit event of a comment action: thread id and block id only, never text.
   * @param {string} event - Event name.
   * @param {object} row - Comment row (the comment acted on).
   * @returns {Promise<boolean>} Stored.
   */
  const auditComment = (event, row) =>
    recordAudit(strapi, {
      event,
      target: {
        uid: row.contentType,
        documentId: row.entryId,
        locale: row.entryLocale || null,
        field: fieldIdentity(row.fieldName),
      },
      blockIds: row.blockId ? [row.blockId] : [],
      meta: { threadId: row.threadId || row.documentId },
    });

  return {
    /**
     * Threads of one field with counts.
     * @route GET /magic-editor-x/comments?uid&documentId&locale&field
     * @auth admin; plugin::magic-editor-x.access + comments.read; CM read on the document, locale and field
     * @returns {{ data: Array<object>, meta: { counts: { open, resolved, comments }, canWrite: boolean, canModerate: boolean } }} Threads.
     * @throws 400 invalid query, 404 unknown field or document not readable.
     */
    async list(ctx) {
      ensureEnabled();
      const target = parseOrThrow(fieldTargetSchema, { ...ctx.query, locale: ctx.query.locale || null });
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      const { threads, counts } = await comments().list(
        { ...target, locale: result.locale },
        ctx.state.user.id
      );
      ctx.body = { data: threads, meta: { counts, ...rights(ctx) } };
    },

    /**
     * Opens a thread on a block.
     * @route POST /magic-editor-x/comments { uid, documentId, locale?, field, blockId, body, excerpt? }
     * @auth admin; access + comments.read + comments.write; CM read on the document (no update right needed)
     * @returns 201 `{ data: thread }`
     * @throws 400 invalid or empty, 404 not readable, 429 per-admin limit (`comments.perMinute`).
     * @sideeffect Inserts one comment row.
     */
    async create(ctx) {
      ensureEnabled();
      const { blockId, body, excerpt, ...target } = parseOrThrow(createSchema, ctx.request.body || {});
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      await comments().checkRate(ctx.state.user.id);
      const thread = await comments().create(
        { ...target, locale: result.locale },
        { blockId, body, excerpt },
        ctx.state.user
      );
      await recordAudit(strapi, {
        event: 'comment.create',
        target: { ...target, locale: result.locale, field: fieldIdentity(target.field) },
        blockIds: [blockId],
        meta: { threadId: thread.id },
      });
      ctx.status = 201;
      ctx.body = { data: thread };
    },

    /**
     * Replies to a thread (reopens a resolved thread).
     * @route POST /magic-editor-x/comments/:id/replies { body }
     * @auth admin; access + comments.read + comments.write; CM read on the thread's document
     * @returns 201 `{ data: comment }`
     * @throws 400 invalid, empty or not a thread; 404 missing or not readable; 429 per-admin limit.
     * @sideeffect Inserts one comment row.
     */
    async reply(ctx) {
      ensureEnabled();
      const { body } = parseOrThrow(textSchema, ctx.request.body || {});
      const row = await loadReadable(ctx);
      await comments().checkRate(ctx.state.user.id);
      const reply = await comments().reply(row, body, ctx.state.user);
      await auditComment('comment.reply', row);
      ctx.status = 201;
      ctx.body = { data: reply };
    },

    /**
     * Edits the caller's own comment.
     * @route PUT /magic-editor-x/comments/:id { body }
     * @auth admin; access + comments.read + comments.write; CM read; author only
     * @returns `{ data: comment }`
     * @throws 400 invalid, 403 not the author, 404 missing or not readable.
     * @sideeffect Updates the comment text and `editedAt`.
     */
    async update(ctx) {
      ensureEnabled();
      const { body } = parseOrThrow(textSchema, ctx.request.body || {});
      const row = await loadReadable(ctx);
      ctx.body = { data: await comments().edit(row, body, ctx.state.user) };
    },

    /**
     * @route POST /magic-editor-x/comments/:id/resolve
     * @auth admin; access + comments.read + comments.write; CM read
     * @returns `{ data: { id, status, resolvedAt, resolvedBy } }`
     * @throws 400 not a thread, 404 missing or not readable.
     * @sideeffect Marks the thread resolved.
     */
    async resolve(ctx) {
      ensureEnabled();
      const row = await loadReadable(ctx);
      ctx.body = { data: await comments().setResolved(row, true, ctx.state.user) };
      await auditComment('comment.resolve', row);
    },

    /**
     * @route POST /magic-editor-x/comments/:id/reopen
     * @auth admin; access + comments.read + comments.write; CM read
     * @returns `{ data: { id, status, resolvedAt, resolvedBy } }`
     * @throws 400 not a thread, 404 missing or not readable.
     * @sideeffect Reopens the thread.
     */
    async reopen(ctx) {
      ensureEnabled();
      const row = await loadReadable(ctx);
      ctx.body = { data: await comments().setResolved(row, false, ctx.state.user) };
      await auditComment('comment.reopen', row);
    },

    /**
     * Deletes a comment (a thread with its replies when `id` is the thread).
     * @route DELETE /magic-editor-x/comments/:id
     * @auth admin; access + comments.read; CM read; own comment with comments.write, anyone's with comments.moderate
     * @access A thread with replies by other people needs comments.moderate.
     * @returns `{ data: { id, removed } }`
     * @throws 403 not allowed, 404 missing or not readable.
     * @sideeffect Deletes rows.
     */
    async remove(ctx) {
      ensureEnabled();
      const row = await loadReadable(ctx);
      ctx.body = { data: await comments().remove(row, ctx.state.user, rights(ctx)) };
      await auditComment(row.authorId === ctx.state.user.id ? 'comment.delete' : 'comment.moderate', row);
    },
  };
};

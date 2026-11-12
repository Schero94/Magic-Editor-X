'use strict';

const { errors } = require('@strapi/utils');
const { ACTIONS } = require('../permissions');
const { service, identityTarget, positionalReadOnly, recordAudit } = require('./helpers');
const { fieldIdentity } = require('../../../shared/audit.mjs');
const { z, parseOrThrow, fieldTargetSchema, documentIdSchema } = require('../utils/validation');
const { BLOCK_ID_PATTERN, MAX_COMMENT_LENGTH, countThreads } = require('../../../shared/comments.mjs');
const {
  ANCHOR_PATH_PATTERN,
  BASE64_PATTERN,
  MAX_QUOTE_LENGTH,
  MAX_QUOTE_AFFIX,
  MAX_RELPOS_BASE64,
  cleanAnchor,
  isRelPos,
} = require('../../../shared/comment-anchor.mjs');
const {
  MAX_MENTIONS,
  MAX_MENTION_QUERY,
  MENTION_ID_PATTERN,
} = require('../../../shared/comment-mentions.mjs');

/** Comment text as typed; normalised (control characters removed) by the service. */
const bodySchema = z.string().min(1).max(MAX_COMMENT_LENGTH);

/** 2.4: opaque ids of mentioned people (from GET /comments/mentionable). */
const mentionsSchema = z.array(z.string().regex(MENTION_ID_PATTERN)).max(MAX_MENTIONS);

const relPosSchema = z.string().max(MAX_RELPOS_BASE64).regex(BASE64_PATTERN);

/** 2.4: anchor of a range comment (shared/comment-anchor.mjs). */
const anchorSchema = z
  .strictObject({
    path: z.string().max(600).regex(ANCHOR_PATH_PATTERN).nullable(),
    start: relPosSchema.nullish(),
    end: relPosSchema.nullish(),
    quote: z.strictObject({
      exact: z.string().min(1).max(MAX_QUOTE_LENGTH),
      prefix: z.string().max(MAX_QUOTE_AFFIX),
      suffix: z.string().max(MAX_QUOTE_AFFIX),
    }),
  })
  .refine((anchor) => (anchor.start == null) === (anchor.end == null), { path: ['end'] })
  .refine(
    (anchor) =>
      anchor.start == null || (anchor.path !== null && isRelPos(anchor.start) && isRelPos(anchor.end)),
    {
      path: ['start'],
    }
  )
  .refine((anchor) => cleanAnchor(anchor) !== null, { path: ['quote', 'exact'] });

const createSchema = fieldTargetSchema.extend({
  blockId: z.string().regex(BLOCK_ID_PATTERN),
  body: bodySchema,
  excerpt: z.string().max(1000).nullish(),
  anchor: anchorSchema.nullish(),
  mentions: mentionsSchema.optional(),
});
const textSchema = z.strictObject({ body: bodySchema, mentions: mentionsSchema.optional() });
const idSchema = z.strictObject({ id: documentIdSchema });
const mentionableSchema = fieldTargetSchema.extend({
  q: z
    .string()
    .max(MAX_MENTION_QUERY)
    // eslint-disable-next-line no-control-regex -- control characters are rejected
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .optional(),
});

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
  const notifications = () => service(strapi, 'comment-notifications');

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
    const checked = await access().checkField({
      userAbility: ctx.state.userAbility,
      ...identityTarget(target),
    });
    // 2.4: threads saved by position before 2.4 that belong to no single entry are read-only.
    row.positional = target.legacy;
    // 2.4: the field the comment is on (mention checks), with the resolved locale.
    row.accessTarget = { ...identityTarget(target), locale: checked.locale };
    return row;
  };

  /**
   * Audit event of new mentions: count and thread only, never who.
   * @param {object} row - Comment row.
   * @param {number} count - New mentions notified.
   * @returns {Promise<boolean>|undefined} Stored.
   */
  const auditMentions = (row, count) =>
    count > 0
      ? recordAudit(strapi, {
          event: 'comment.mention',
          target: {
            uid: row.contentType,
            documentId: row.entryId,
            locale: row.entryLocale || null,
            field: fieldIdentity(row.fieldName),
          },
          counts: { mentions: count },
          blockIds: row.blockId ? [row.blockId] : [],
          meta: { threadId: row.threadId || row.documentId },
        })
      : undefined;

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
     * People the caller can @mention in a field's comments (2.4): active admins whose name matches
     * `q` and who can read this field's comments (access + comments.read + CM read on the document,
     * locale and field, checked with their own permissions). Opaque ids (the admin user's
     * documentId) and names only; e-mail addresses are never searched or returned.
     * @route GET /magic-editor-x/comments/mentionable?uid&documentId&locale&field&fieldKey?&q
     * @auth admin; access + comments.read + comments.write; CM read on the document, locale and field
     * @returns {{ data: Array<{ id: string, name: string }> }} At most 8 people.
     * @throws 400 invalid query, 404 not readable or comments off, 409 `FIELD_KEY_REQUIRED`,
     *   429 `comments.mentionsPerMinute` searches per admin.
     */
    async mentionable(ctx) {
      ensureEnabled();
      const { q, ...target } = parseOrThrow(mentionableSchema, {
        ...ctx.query,
        locale: ctx.query.locale || null,
      });
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.fieldName) return positionalReadOnly(ctx, 'FIELD_KEY_REQUIRED');
      await notifications().checkPickerRate(ctx.state.user.id);
      ctx.body = {
        data: await notifications().mentionable(
          { ...target, locale: result.locale },
          q || '',
          ctx.state.user.id
        ),
      };
      return undefined;
    },

    /**
     * Threads of one field with counts. Fields inside a repeatable component or dynamic zone are
     * listed by their identity (2.4): threads saved under positional paths before 2.4 are mapped
     * to their entry once by block id; the ones that cannot be mapped are listed read-only in
     * `meta.positionalThreads` (only when the entry has a key; not counted).
     * @route GET /magic-editor-x/comments?uid&documentId&locale&field&fieldKey?
     * @auth admin; plugin::magic-editor-x.access + comments.read; CM read on the document, locale and field
     * @returns {{ data: Array<object>, meta: { counts: { open, resolved, comments }, canWrite: boolean, canModerate: boolean, fieldKey: string|null, positionalThreads?: Array<object>, notifications?: Array<{ id, threadId, commentId, kind }> } }} Threads
     *   (2.4: `notifications` are the caller's unread mentions and replies on this field).
     * @throws 400 invalid query, 404 unknown field or document not readable.
     * @sideeffect Moves mappable pre-2.4 positional threads to their entry's identity.
     */
    async list(ctx) {
      ensureEnabled();
      const target = parseOrThrow(fieldTargetSchema, { ...ctx.query, locale: ctx.query.locale || null });
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      const where = { uid: target.uid, documentId: target.documentId, locale: result.locale };
      const viewer = ctx.state.user.id;
      if (!result.positional) {
        const { threads, counts } = await comments().list({ ...where, field: result.fieldName }, viewer);
        const notes = await notifications().forField({ ...where, field: result.fieldName }, viewer);
        ctx.body = { data: threads, meta: { counts, ...rights(ctx), fieldKey: null, notifications: notes } };
        return;
      }
      const legacy = await comments().adoptLegacy(
        { ...where, basePath: result.basePath },
        result.entries,
        viewer
      );
      if (!result.fieldName) {
        // No key stored yet: only threads proven to be this entry's, and nothing can be written.
        const own = result.entries.find((entry) => entry.path === target.field);
        const threads = own ? legacy.byPath.get(own.path) || [] : [];
        ctx.body = {
          data: threads,
          meta: { counts: countThreads(threads), canWrite: false, canModerate: false, fieldKey: null },
        };
        return;
      }
      const { threads, counts } = await comments().list({ ...where, field: result.fieldName }, viewer);
      const notes = await notifications().forField({ ...where, field: result.fieldName }, viewer);
      ctx.body = {
        data: threads,
        meta: {
          counts,
          ...rights(ctx),
          fieldKey: result.fieldKey,
          positionalThreads: legacy.unmapped,
          notifications: notes,
        },
      };
    },

    /**
     * Opens a thread on a block.
     * @route POST /magic-editor-x/comments { uid, documentId, locale?, field, fieldKey?, blockId, body, excerpt? }
     * @auth admin; access + comments.read + comments.write; CM read on the document (no update right needed)
     * @returns 201 `{ data: thread }`
     * @throws 400 invalid or empty, 404 not readable, 409 `FIELD_KEY_REQUIRED` (positional field without a stored key),
     *   429 per-admin limit (`comments.perMinute`).
     * @sideeffect Inserts one comment row.
     */
    async create(ctx) {
      ensureEnabled();
      const { blockId, body, excerpt, anchor, mentions, ...target } = parseOrThrow(
        createSchema,
        ctx.request.body || {}
      );
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.fieldName) return positionalReadOnly(ctx, 'FIELD_KEY_REQUIRED');
      await comments().checkRate(ctx.state.user.id);
      const resolved = await notifications().resolveMentions({ ...target, locale: result.locale }, mentions);
      const { thread, row } = await comments().create(
        { uid: target.uid, documentId: target.documentId, locale: result.locale, field: result.fieldName },
        { blockId, body, excerpt, anchor: anchor || null, mentions: resolved.ids },
        ctx.state.user
      );
      const notified = await notifications().notify(row, row, { mentioned: resolved.ids, isReply: false });
      await recordAudit(strapi, {
        event: 'comment.create',
        target: {
          uid: target.uid,
          documentId: target.documentId,
          locale: result.locale,
          field: result.fieldName,
        },
        blockIds: [blockId],
        meta: { threadId: thread.id },
      });
      await auditMentions(row, notified.mentions);
      ctx.status = 201;
      ctx.body = { data: thread, meta: { droppedMentions: resolved.dropped } };
      return undefined;
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
      const { body, mentions } = parseOrThrow(textSchema, ctx.request.body || {});
      const row = await loadReadable(ctx);
      if (row.positional) return positionalReadOnly(ctx, 'POSITIONAL_READ_ONLY');
      await comments().checkRate(ctx.state.user.id);
      const resolved = await notifications().resolveMentions(row.accessTarget, mentions);
      const { comment, row: created } = await comments().reply(row, body, ctx.state.user, resolved.ids);
      const notified = await notifications().notify(created, row, { mentioned: resolved.ids, isReply: true });
      // Replying answers the replier's own notifications of this thread.
      await notifications().readAll(ctx.state.user.id, [row.documentId]);
      await auditComment('comment.reply', row);
      await auditMentions(created, notified.mentions);
      ctx.status = 201;
      ctx.body = { data: comment, meta: { droppedMentions: resolved.dropped } };
      return undefined;
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
      const { body, mentions } = parseOrThrow(textSchema, ctx.request.body || {});
      const row = await loadReadable(ctx);
      if (row.positional) return positionalReadOnly(ctx, 'POSITIONAL_READ_ONLY');
      let ids;
      let dropped = 0;
      if (mentions !== undefined) {
        const resolved = await notifications().resolveMentions(row.accessTarget, mentions);
        ids = resolved.ids;
        dropped = resolved.dropped;
      }
      const { comment, row: updated, added } = await comments().edit(row, body, ctx.state.user, ids);
      if (ids !== undefined) {
        await notifications().pruneMentions(row.documentId, ids);
        const root = row.threadId ? { documentId: row.threadId } : updated;
        const notified = await notifications().notify(updated, root, { mentioned: added, isReply: false });
        await auditMentions(updated, notified.mentions);
      }
      ctx.body = { data: comment, meta: { droppedMentions: dropped } };
      return undefined;
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
      if (row.positional) return positionalReadOnly(ctx, 'POSITIONAL_READ_ONLY');
      ctx.body = { data: await comments().setResolved(row, true, ctx.state.user) };
      await auditComment('comment.resolve', row);
      return undefined;
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
      if (row.positional) return positionalReadOnly(ctx, 'POSITIONAL_READ_ONLY');
      ctx.body = { data: await comments().setResolved(row, false, ctx.state.user) };
      await auditComment('comment.reopen', row);
      return undefined;
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
      if (row.positional) return positionalReadOnly(ctx, 'POSITIONAL_READ_ONLY');
      ctx.body = { data: await comments().remove(row, ctx.state.user, rights(ctx)) };
      await auditComment(row.authorId === ctx.state.user.id ? 'comment.delete' : 'comment.moderate', row);
      return undefined;
    },
  };
};

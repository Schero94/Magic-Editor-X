'use strict';

const { errors } = require('@strapi/utils');
const { service } = require('./helpers');
const { z, parseOrThrow, documentIdSchema } = require('../utils/validation');

const listSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(20).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  unread: z.enum(['true', 'false']).optional(),
});
const idSchema = z.strictObject({ id: documentIdSchema });
const readAllSchema = z.strictObject({ threadIds: z.array(documentIdSchema).max(100).optional() });

/**
 * In-admin notifications of comment mentions and replies (2.4). Every route
 * needs `access` + `comments.read` (route policies) and serves only the
 * caller's own notifications; each listed notification is checked against the
 * caller's current Content Manager access (rows of documents they cannot read
 * are not shown). Someone else's notification answers 404. Handlers log nothing.
 */
module.exports = ({ strapi }) => {
  const notifications = () => service(strapi, 'comment-notifications');

  /** 404 when the owner turned comments off. */
  const ensureEnabled = () => {
    if (strapi.config.get('plugin::magic-editor-x.comments.enabled') === false) {
      throw new errors.NotFoundError('Not found');
    }
  };

  return {
    /**
     * The caller's notifications, newest first.
     * @route GET /magic-editor-x/notifications?page&pageSize&unread
     * @auth admin; access + comments.read; own notifications on documents the caller can read
     * @returns {{ data: Array<object>, meta: { unread: number, pagination: { page, pageSize, total, pageCount } } }} Listing
     *   (`page` 1-20, `pageSize` 1-50, default 10; at most the newest 200 notifications are considered).
     * @throws 400 invalid query, 404 comments off.
     */
    async list(ctx) {
      ensureEnabled();
      const { page = 1, pageSize = 10, unread } = parseOrThrow(listSchema, ctx.query || {});
      const result = await notifications().list(ctx.state.user, ctx.state.userAbility, {
        page,
        pageSize,
        unread: unread === 'true',
      });
      ctx.body = result;
    },

    /**
     * @route POST /magic-editor-x/notifications/:id/read
     * @auth admin; access + comments.read; own notification only
     * @returns `{ data: { id, read: true } }`
     * @throws 404 missing or someone else's.
     * @sideeffect Sets `readAt`.
     */
    async read(ctx) {
      ensureEnabled();
      const { id } = parseOrThrow(idSchema, { id: ctx.params.id });
      ctx.body = { data: await notifications().setRead(id, ctx.state.user.id, true) };
    },

    /**
     * @route POST /magic-editor-x/notifications/:id/unread
     * @auth admin; access + comments.read; own notification only
     * @returns `{ data: { id, read: false } }`
     * @throws 404 missing or someone else's.
     * @sideeffect Clears `readAt`.
     */
    async unread(ctx) {
      ensureEnabled();
      const { id } = parseOrThrow(idSchema, { id: ctx.params.id });
      ctx.body = { data: await notifications().setRead(id, ctx.state.user.id, false) };
    },

    /**
     * Marks the caller's notifications read: all, or those of the given threads.
     * @route POST /magic-editor-x/notifications/read-all { threadIds? }
     * @auth admin; access + comments.read; own notifications only
     * @returns `{ data: { updated } }`
     * @throws 400 invalid body, 404 comments off.
     * @sideeffect Sets `readAt`.
     */
    async readAll(ctx) {
      ensureEnabled();
      const { threadIds } = parseOrThrow(readAllSchema, ctx.request.body || {});
      ctx.body = { data: { updated: await notifications().readAll(ctx.state.user.id, threadIds || null) } };
    },
  };
};

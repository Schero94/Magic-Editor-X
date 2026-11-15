'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, uidSchema, documentIdSchema, localeSchema } = require('../utils/validation');

/** One document locale of an API content type. */
const documentSchema = z.strictObject({
  uid: uidSchema,
  documentId: documentIdSchema,
  locale: localeSchema.nullish(),
});

/** POST /presence body: the document plus a random per-tab id from the browser. */
const presenceSchema = documentSchema.extend({
  tabId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  idle: z.boolean().optional(),
  leave: z.boolean().optional(),
});

const widgetSchema = z.strictObject({ pageSize: z.coerce.number().int().min(1).max(20).optional() });

/**
 * Entry panel (Content Manager side panel) and homepage widgets (2.5). Handlers log nothing; every
 * response is bounded and `Cache-Control: no-store`.
 */
module.exports = ({ strapi }) => {
  const panel = () => service(strapi, 'entry-panel');

  return {
    /**
     * Heartbeat of the caller's tab on one entry and the other admins who edit it now.
     * @route POST /magic-editor-x/presence { uid, documentId, locale?, tabId, idle?, leave? }
     * @auth admin; plugin::magic-editor-x.access; Content Manager read on the document locale (404 otherwise);
     *   the heartbeat row is written only when the caller may update it
     * @returns {{ data: { enabled, softLock, canEdit, editors: Array<{ id, name, color, idle, live }> } }} Presence (names only).
     * @throws 400 invalid body, 404 no access / no editor field / missing, 429 above `presence.perMinute`.
     * @sideeffect Upserts or removes the tab's row in `magic_editor_x_collab_presence` (30 s lifetime).
     */
    async presence(ctx) {
      const input = parseOrThrow(presenceSchema, ctx.request.body || {});
      ctx.set('Cache-Control', 'no-store');
      ctx.body = {
        data: await panel().presence({
          ...input,
          locale: input.locale || null,
          userAbility: ctx.state.userAbility,
          user: ctx.state.user,
        }),
      };
    },

    /**
     * Comments, quality and broken links of one entry for the side panel.
     * @route GET /magic-editor-x/entry-summary?uid&documentId&locale
     * @auth admin; plugin::magic-editor-x.access; Content Manager read on the document locale (404 otherwise);
     *   fields the caller cannot read are left out; comment counts need comments.read
     * @returns {{ data: { fields: Array<{ path, label, field, positional, issues: { errors, warnings }, openThreads, brokenLinks: { draft, published } }>, comments: { enabled, open }, quality: { errors, warnings }, links: { enabled, lastRun, draft, published } } }} Summary.
     * @throws 400 invalid query, 404 no access, 429 above 60 per minute.
     */
    async summary(ctx) {
      const input = parseOrThrow(documentSchema, ctx.query || {});
      ctx.set('Cache-Control', 'no-store');
      ctx.body = {
        data: await panel().summary({
          ...input,
          locale: input.locale || null,
          userAbility: ctx.state.userAbility,
          user: ctx.state.user,
        }),
      };
    },

    /**
     * Homepage widget "My open threads".
     * @route GET /magic-editor-x/widgets/open-threads?pageSize
     * @auth admin; plugin::magic-editor-x.access + comments.read; threads on fields the caller can read
     * @returns {{ data: Array<{ threadId, started, mentioned, excerpt, snippet, updatedAt, target }>, meta: { more } }} Threads.
     * @throws 400 invalid query, 404 comments off, 429 above 60 per minute.
     */
    async openThreads(ctx) {
      const { pageSize = 5 } = parseOrThrow(widgetSchema, ctx.query || {});
      ctx.set('Cache-Control', 'no-store');
      ctx.body = await panel().openThreads(ctx.state.user, ctx.state.userAbility, { pageSize });
    },

    /**
     * Homepage widget "Broken links".
     * @route GET /magic-editor-x/widgets/broken-links?pageSize
     * @auth admin; plugin::magic-editor-x.access; entries whose affected field the caller can read
     * @returns {{ data: Array<{ problems, target }>, meta: { enabled, lastRun, more, truncated } }} Entries.
     * @throws 400 invalid query, 429 above 60 per minute.
     */
    async brokenLinks(ctx) {
      const { pageSize = 5 } = parseOrThrow(widgetSchema, ctx.query || {});
      ctx.set('Cache-Control', 'no-store');
      ctx.body = await panel().brokenLinks(ctx.state.user, ctx.state.userAbility, { pageSize });
    },
  };
};

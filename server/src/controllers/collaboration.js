'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, fieldTargetSchema } = require('../utils/validation');

const sessionSchema = fieldTargetSchema.extend({ initialValue: z.unknown().optional() });

/**
 * @route POST /magic-editor-x/collaboration/session { uid, documentId, locale?, field, initialValue? }
 * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.collaborate;
 *   Content Manager read permission on the document, locale and field (update for editing).
 * @returns {{ data: { token, path, canEdit, expiresAt } }} One-time socket token (60 s).
 * @throws 404 when the document cannot be read (same as missing), 403 when collaboration is off.
 * @sideeffect Seeds the room from `initialValue` once when the caller can edit and the room is new.
 */
module.exports = ({ strapi }) => ({
  async createSession(ctx) {
    const input = parseOrThrow(sessionSchema, ctx.request.body || {});
    ctx.set('Cache-Control', 'no-store');
    ctx.body = {
      data: await service(strapi, 'collaboration').createSession({
        ...input,
        userAbility: ctx.state.userAbility,
        user: ctx.state.user,
      }),
    };
  },
});

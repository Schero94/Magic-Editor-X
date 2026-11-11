'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, fieldTargetSchema, documentIdSchema } = require('../utils/validation');

const createSchema = fieldTargetSchema.extend({ content: z.unknown() });

/**
 * Version history. Every handler checks Content Manager access to the
 * document, locale and field; a document the caller cannot read answers 404.
 */
module.exports = ({ strapi }) => {
  const access = () => service(strapi, 'access');
  const history = () => service(strapi, 'history');

  return {
    /**
     * @route GET /magic-editor-x/history?uid&documentId&locale&field
     * @auth admin; plugin::magic-editor-x.access; CM read on the document
     */
    async list(ctx) {
      const target = parseOrThrow(fieldTargetSchema, { ...ctx.query, locale: ctx.query.locale || null });
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      ctx.body = {
        data: await history().list({ ...target, locale: result.locale }),
        meta: { canRestore: result.canUpdate, canCreate: result.canUpdate },
      };
    },

    /**
     * @route GET /magic-editor-x/history/:id
     * @auth admin; plugin::magic-editor-x.access; CM read on the snapshot's document
     */
    async findOne(ctx) {
      const { id } = parseOrThrow(z.strictObject({ id: documentIdSchema }), ctx.params);
      const { target, snapshot } = await history().findOne(id);
      await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      ctx.body = { data: snapshot };
    },

    /**
     * @route POST /magic-editor-x/history { uid, documentId, locale?, field, content }
     * @auth admin; plugin::magic-editor-x.access; CM update on the document
     * @sideeffect Stores a snapshot (skipped when identical to the latest one).
     */
    async create(ctx) {
      const input = parseOrThrow(createSchema, ctx.request.body || {});
      const { content, ...target } = input;
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.canUpdate) return ctx.forbidden('You cannot edit this document');
      const outcome = await history().create({ ...target, locale: result.locale }, content, {
        trigger: 'manual',
        userId: ctx.state.user.id,
      });
      ctx.status = outcome.created ? 201 : 200;
      ctx.body = { data: outcome.snapshot, meta: { created: outcome.created } };
      return undefined;
    },
  };
};

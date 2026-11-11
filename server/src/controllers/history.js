'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, fieldTargetSchema, documentIdSchema } = require('../utils/validation');

/** Version name: plain text, at most 120 characters, no control characters; '' or null removes it. */
const labelSchema = z
  .string()
  .trim()
  .max(120)
  // eslint-disable-next-line no-control-regex -- control characters are rejected
  .regex(/^[^\u0000-\u001f\u007f]*$/)
  .nullable();

const createSchema = fieldTargetSchema.extend({ content: z.unknown(), label: labelSchema.optional() });
const renameSchema = z.strictObject({ label: labelSchema });

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
      const { id } = parseOrThrow(z.strictObject({ id: documentIdSchema }), { id: ctx.params.id });
      const { target, snapshot } = await history().findOne(id);
      await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      ctx.body = { data: snapshot };
    },

    /**
     * @route POST /magic-editor-x/history { uid, documentId, locale?, field, content, label? }
     * @auth admin; plugin::magic-editor-x.access; CM update on the document
     * @sideeffect Stores a snapshot (skipped when identical to the latest one; a label then names the latest one).
     */
    async create(ctx) {
      const input = parseOrThrow(createSchema, ctx.request.body || {});
      const { content, label, ...target } = input;
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.canUpdate) return ctx.forbidden('You cannot edit this document');
      const outcome = await history().create({ ...target, locale: result.locale }, content, {
        trigger: 'manual',
        userId: ctx.state.user.id,
        label: label || null,
      });
      ctx.status = outcome.created ? 201 : 200;
      ctx.body = { data: outcome.snapshot, meta: { created: outcome.created } };
      return undefined;
    },

    /**
     * Names, renames or unnames a version.
     * @route PUT /magic-editor-x/history/:id { label }
     * @auth admin; plugin::magic-editor-x.access; CM update on the version's document
     * @access 404 when the version is missing or its document cannot be read; 403 when it can be read but not updated.
     * @sideeffect Updates the version's label.
     */
    async rename(ctx) {
      const { id } = parseOrThrow(z.strictObject({ id: documentIdSchema }), { id: ctx.params.id });
      const { label } = parseOrThrow(renameSchema, ctx.request.body || {});
      const { target } = await history().findOne(id);
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.canUpdate) return ctx.forbidden('You cannot edit this document');
      ctx.body = { data: await history().rename(id, label) };
      return undefined;
    },
  };
};

'use strict';

const { ACTIONS } = require('../permissions');
const { service } = require('./helpers');
const { z, parseOrThrow, documentIdSchema } = require('../utils/validation');

const idParams = z.strictObject({ id: documentIdSchema });

/**
 * Custom block management.
 */
module.exports = ({ strapi }) => {
  const blocks = () => service(strapi, 'custom-blocks');

  return {
    /**
     * @route GET /magic-editor-x/custom-blocks[?all=true]
     * @auth admin; plugin::magic-editor-x.access (all=true also needs custom-blocks.manage)
     * @returns {{ data: object[] }} Enabled blocks (editor) or every block (management page).
     */
    async list(ctx) {
      const all = ctx.query.all === 'true' && ctx.state.userAbility.can(ACTIONS.customBlocksManage);
      ctx.body = { data: await blocks().list({ enabledOnly: !all }) };
    },

    /** @route POST /magic-editor-x/custom-blocks @auth admin; custom-blocks.manage @sideeffect Creates a block. */
    async create(ctx) {
      ctx.status = 201;
      ctx.body = { data: await blocks().create(ctx.request.body || {}, ctx.state.user) };
    },

    /** @route PUT /magic-editor-x/custom-blocks/:id @auth admin; custom-blocks.manage @sideeffect Replaces a block. */
    async update(ctx) {
      const { id } = parseOrThrow(idParams, ctx.params);
      ctx.body = { data: await blocks().update(id, ctx.request.body || {}) };
    },

    /** @route DELETE /magic-editor-x/custom-blocks/:id @auth admin; custom-blocks.manage @sideeffect Deletes a block. */
    async remove(ctx) {
      const { id } = parseOrThrow(idParams, ctx.params);
      ctx.body = { data: await blocks().remove(id) };
    },

    /** @route POST /magic-editor-x/custom-blocks/:id/duplicate @auth admin; custom-blocks.manage @sideeffect Creates a copy. */
    async duplicate(ctx) {
      const { id } = parseOrThrow(idParams, ctx.params);
      ctx.status = 201;
      ctx.body = { data: await blocks().duplicate(id, ctx.state.user) };
    },

    /** @route PUT /magic-editor-x/custom-blocks/order { ids } @auth admin; custom-blocks.manage @sideeffect Saves the toolbox order. */
    async reorder(ctx) {
      const { ids } = parseOrThrow(
        z.strictObject({ ids: z.array(documentIdSchema).max(1000) }),
        ctx.request.body || {}
      );
      ctx.body = { data: await blocks().reorder(ids) };
    },

    /** @route GET /magic-editor-x/custom-blocks/export @auth admin; custom-blocks.manage */
    async export(ctx) {
      ctx.set('Cache-Control', 'no-store');
      ctx.body = { data: await blocks().exportAll() };
    },

    /** @route POST /magic-editor-x/custom-blocks/import @auth admin; custom-blocks.manage @sideeffect Creates blocks. */
    async import(ctx) {
      ctx.body = { data: await blocks().importAll(ctx.request.body || {}, ctx.state.user) };
    },
  };
};

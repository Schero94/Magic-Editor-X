'use strict';

const { ACTIONS } = require('../permissions');
const { service } = require('./helpers');
const { z, errors, parseOrThrow, documentIdSchema } = require('../utils/validation');

const idParams = z.strictObject({ id: documentIdSchema });

/**
 * Can the caller do `action` (CASL ability from the admin auth strategy)?
 * @param {object} ctx - Koa context.
 * @param {string} action - Action id.
 * @returns {boolean} Result.
 */
const can = (ctx, action) => {
  try {
    return Boolean(ctx.state.userAbility && ctx.state.userAbility.can(action));
  } catch {
    return false;
  }
};

/**
 * Templates and block patterns (2.3). Handlers log nothing; template content
 * never reaches a log line.
 */
module.exports = ({ strapi }) => {
  const templates = () => service(strapi, 'templates');

  /**
   * True when the Content Manager lets the caller read the content type
   * (the editor list is only offered where the caller can open the field).
   * @param {object} ctx - Koa context.
   * @param {string} uid - Content type uid.
   * @returns {boolean} Readable.
   */
  const canReadType = (ctx, uid) => {
    try {
      return !strapi
        .plugin('content-manager')
        .service('permission-checker')
        .create({ userAbility: ctx.state.userAbility, model: uid })
        .cannot.read();
    } catch {
      return false;
    }
  };

  return {
    /**
     * @route GET /magic-editor-x/templates?uid&field | ?all=true
     * @auth admin; plugin::magic-editor-x.access (`all=true` also needs templates.manage, else 403)
     * @returns {{ data: object[] }} Enabled templates offered in the field, or every template for managers.
     * @throws {errors.NotFoundError} Unknown field, or the caller cannot read the content type (404).
     */
    async list(ctx) {
      const params = parseOrThrow(templates().listQuerySchema, ctx.query || {});
      if (params.all) {
        if (!can(ctx, ACTIONS.templatesManage)) throw new errors.ForbiddenError('Forbidden');
        ctx.body = { data: await templates().listAll() };
        return;
      }
      if (!strapi.contentType(params.uid) || !canReadType(ctx, params.uid))
        throw new errors.NotFoundError('Not found');
      ctx.body = { data: await templates().listForField(params) };
    },

    /**
     * @route GET /magic-editor-x/templates/targets
     * @auth admin; templates.manage
     * @returns {{ data: Array<{ uid, displayName, field, preset }> }} Magic Editor X fields for scope selection.
     */
    async targets(ctx) {
      ctx.body = { data: templates().targets() };
    },

    /**
     * @route GET /magic-editor-x/templates/:id
     * @auth admin; access (disabled templates only with templates.manage, else 404)
     */
    async findOne(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.body = {
        data: await templates().findOne(id, { includeDisabled: can(ctx, ACTIONS.templatesManage) }),
      };
    },

    /** @route POST /magic-editor-x/templates @auth admin; access + templates.manage @sideeffect Creates a template (blocks sanitised). */
    async create(ctx) {
      ctx.status = 201;
      ctx.body = { data: await templates().create(ctx.request.body || {}, ctx.state.user) };
    },

    /** @route PUT /magic-editor-x/templates/:id @auth admin; access + templates.manage @sideeffect Replaces a template. */
    async update(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.body = { data: await templates().update(id, ctx.request.body || {}) };
    },

    /** @route DELETE /magic-editor-x/templates/:id @auth admin; access + templates.manage @sideeffect Deletes a template. */
    async remove(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.body = { data: await templates().remove(id) };
    },

    /** @route POST /magic-editor-x/templates/:id/duplicate @auth admin; access + templates.manage @sideeffect Creates a disabled copy. */
    async duplicate(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.status = 201;
      ctx.body = { data: await templates().duplicate(id, ctx.state.user) };
    },

    /** @route PUT /magic-editor-x/templates/order { ids } @auth admin; access + templates.manage @sideeffect Saves the order. */
    async reorder(ctx) {
      const { ids } = parseOrThrow(
        z.strictObject({ ids: z.array(documentIdSchema).max(500) }),
        ctx.request.body || {}
      );
      ctx.body = { data: await templates().reorder(ids) };
    },
  };
};

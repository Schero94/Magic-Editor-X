'use strict';

const { ACTIONS } = require('../permissions');
const { service } = require('./helpers');
const { z, errors, parseOrThrow, documentIdSchema } = require('../utils/validation');

const idParams = z.strictObject({ id: documentIdSchema });
const versionParams = z.strictObject({ id: documentIdSchema, versionId: documentIdSchema });
/** Version name: plain text, at most 120 characters, no control characters; '' or null removes it. */
const labelBody = z.strictObject({
  label: z
    .string()
    .trim()
    .max(120)
    // eslint-disable-next-line no-control-regex -- control characters are rejected
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .nullable(),
});

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
  const versions = () => service(strapi, 'synced-versions');

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
      ctx.body = { data: await templates().update(id, ctx.request.body || {}, ctx.state.user) };
    },

    /** @route DELETE /magic-editor-x/templates/:id @auth admin; access + templates.manage @sideeffect Deletes a template. */
    async remove(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.body = { data: await templates().remove(id, ctx.state.user) };
    },

    /** @route POST /magic-editor-x/templates/:id/duplicate @auth admin; access + templates.manage @sideeffect Creates a disabled copy. */
    async duplicate(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.status = 201;
      ctx.body = { data: await templates().duplicate(id, ctx.state.user) };
    },

    /**
     * @route GET /magic-editor-x/templates/:id/usage
     * @auth admin; access + templates.manage
     * @returns {{ data: { entries: number, fields: number, templates: number, complete: boolean } }} How often a synced source is referenced (counts only).
     * @throws {errors.NotFoundError} Unknown id or not a synced source.
     */
    async usage(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      ctx.body = { data: await templates().usage(id) };
    },

    /**
     * @route GET /magic-editor-x/templates/:id/versions
     * @auth admin; access + templates.manage
     * @returns {{ data: Array<{ id, version, trigger, label, name, createdAt, createdBy: { name }|null, blockCount }> }} Versions of a synced source, newest first.
     * @throws {errors.NotFoundError} Unknown id or not a synced source.
     */
    async versions(ctx) {
      const { id } = parseOrThrow(idParams, { id: ctx.params.id });
      if (Object.keys(ctx.query || {}).length) throw new errors.ValidationError('Validation failed');
      await templates().assertSynced(id);
      ctx.body = { data: await versions().list(id) };
    },

    /**
     * @route GET /magic-editor-x/templates/:id/versions/:versionId
     * @auth admin; access + templates.manage
     * @returns {{ data: { id, version, trigger, label, name, createdAt, createdBy, blockCount, content } }} One version with its blocks.
     * @throws {errors.NotFoundError} Unknown source, other kinds, or a version of another source.
     */
    async version(ctx) {
      const { id, versionId } = parseOrThrow(versionParams, {
        id: ctx.params.id,
        versionId: ctx.params.versionId,
      });
      await templates().assertSynced(id);
      ctx.body = { data: await versions().findOne(id, versionId) };
    },

    /**
     * @route PUT /magic-editor-x/templates/:id/versions/:versionId { label }
     * @auth admin; access + templates.manage
     * @sideeffect Names or renames a version ('' or null removes the name).
     */
    async renameVersion(ctx) {
      const { id, versionId } = parseOrThrow(versionParams, {
        id: ctx.params.id,
        versionId: ctx.params.versionId,
      });
      const { label } = parseOrThrow(labelBody, ctx.request.body || {});
      await templates().assertSynced(id);
      ctx.body = { data: await versions().rename(id, versionId, label) };
    },

    /**
     * @route POST /magic-editor-x/templates/:id/versions/:versionId/restore
     * @auth admin; access + templates.manage
     * @returns {{ data: object }} The updated source (a normal update: re-validated, new version with trigger `restore`).
     * @sideeffect Replaces the source's blocks and name; the change is live in every referencing field.
     */
    async restoreVersion(ctx) {
      const { id, versionId } = parseOrThrow(versionParams, {
        id: ctx.params.id,
        versionId: ctx.params.versionId,
      });
      const body = ctx.request.body;
      if (body && typeof body === 'object' && Object.keys(body).length)
        throw new errors.ValidationError('Validation failed');
      ctx.body = { data: await templates().restoreVersion(id, versionId, ctx.state.user) };
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

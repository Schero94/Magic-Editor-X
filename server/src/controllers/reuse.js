'use strict';

const { errors } = require('@strapi/utils');
const { service } = require('./helpers');
const { parseOrThrow } = require('../utils/validation');

/**
 * "Use existing content" (2.5): the source side of "Insert from another
 * entry". Entry search reuses `GET /links/search`. Read only, logs nothing.
 */
module.exports = ({ strapi }) => {
  const reuse = () => service(strapi, 'reuse');
  const ensureEnabled = () => {
    if (strapi.config.get('plugin::magic-editor-x.reuse.enabled') === false)
      throw new errors.NotFoundError('Not found');
  };

  return {
    /**
     * Content types (and locales) the caller can take editor content from.
     * @route GET /magic-editor-x/reuse/types
     * @auth admin; plugin::magic-editor-x.access; CM read on each listed type and at least one of its editor fields
     * @returns {{ data: Array<{ uid: string, kind: string, displayName: string, localized: boolean, locales: Array<{ code: string, name: string }>|null }> }} Types.
     * @throws {import('@strapi/utils').errors.ValidationError} 400 on query parameters.
     * @throws {import('@strapi/utils').errors.NotFoundError} 404 when `reuse.enabled` is false.
     * @throws {import('@strapi/utils').errors.RateLimitError} 429 above `reuse.perMinute`.
     */
    async types(ctx) {
      ensureEnabled();
      if (Object.keys(ctx.query || {}).length)
        throw new errors.ValidationError('Validation failed', { formErrors: ['Unexpected parameters'] });
      await reuse().checkRate(ctx.state.user.id);
      ctx.body = { data: await reuse().types(ctx.state.userAbility) };
    },

    /**
     * The readable, non-empty editor fields of one entry locale with their cleaned blocks.
     * @route GET /magic-editor-x/reuse/source?uid&documentId&locale&field
     * @auth admin; plugin::magic-editor-x.access; CM read on the document locale and on each returned field
     * @returns {{ data: { uid: string, documentId: string, locale: string|null, title: string, status: 'draft', hasPublished: boolean|null, updatedAt: string|null, fields: Array<{ field: string, fieldKey: string|null, preset: string, blockCount: number, truncated: boolean, blocks: object[] }>, limited: boolean } }} Source.
     * @throws {import('@strapi/utils').errors.ValidationError} 400 on invalid input (strict).
     * @throws {import('@strapi/utils').errors.NotFoundError} 404 when the type, document, locale or field is missing or not readable, or `reuse.enabled` is false.
     * @throws {import('@strapi/utils').errors.RateLimitError} 429 above `reuse.perMinute`.
     */
    async source(ctx) {
      ensureEnabled();
      const query = { ...ctx.query };
      for (const key of ['locale', 'field']) if (query[key] === '') delete query[key];
      const input = parseOrThrow(reuse().sourceQuerySchema, query);
      await reuse().checkRate(ctx.state.user.id);
      ctx.body = { data: await reuse().source({ userAbility: ctx.state.userAbility, ...input }) };
    },
  };
};

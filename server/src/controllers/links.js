'use strict';

const { service } = require('./helpers');
const { parseOrThrow, linkSearchSchema } = require('../utils/validation');

/**
 * Internal-link picker of the hyperlink tool. Results follow Content Manager
 * read permissions; a type that does not exist or cannot be read answers 404.
 */
module.exports = ({ strapi }) => {
  const links = () => service(strapi, 'links');

  return {
    /**
     * @route GET /magic-editor-x/links/types
     * @auth admin; plugin::magic-editor-x.access
     * @returns {{ data: Array<{ uid: string, kind: string, displayName: string, localized: boolean }> }} API types the caller can read.
     */
    async types(ctx) {
      ctx.body = { data: links().types(ctx.state.userAbility) };
    },

    /**
     * @route GET /magic-editor-x/links/search?uid&q&locale&page
     * @auth admin; plugin::magic-editor-x.access; CM read on the type (conditions and field permissions apply)
     * @returns {{ data: Array<{ documentId: string, uid: string, locale: string|null, title: string, href: string, status?: 'draft'|'published' }>, meta: { pagination: object } }} Up to 20 entries.
     * @throws {import('@strapi/utils').errors.ValidationError} 400 on invalid input.
     * @throws {import('@strapi/utils').errors.NotFoundError} 404 when the type does not exist or cannot be read.
     */
    async search(ctx) {
      const query = { ...ctx.query };
      for (const key of ['q', 'locale', 'page']) if (query[key] === '') delete query[key];
      const input = parseOrThrow(linkSearchSchema, query);
      ctx.body = await links().search({ userAbility: ctx.state.userAbility, ...input });
    },
  };
};

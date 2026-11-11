'use strict';

const { errors } = require('@strapi/utils');
const { renderLinkPattern } = require('../../../shared/link-pattern.mjs');

/**
 * Internal-link picker: lists linkable content types and searches entries.
 *
 * Every result passes the Content Manager permission checker: the query gets
 * the caller's read conditions (for example "is creator" or locale
 * permissions), the title is searched and returned only when the caller may
 * read that field, and output goes through `sanitizeOutput`. Only `documentId`, the title, the
 * locale, the publication status and the rendered `href` leave the server.
 * A type that does not exist or cannot be read answers 404, like the rest of
 * the plugin.
 */

const PAGE_SIZE = 20;
const TITLE_TYPES = new Set(['string', 'text', 'email', 'uid']);

const notFound = () => new errors.NotFoundError('Not found');

module.exports = ({ strapi }) => {
  const access = () => strapi.plugin('magic-editor-x').service('access');

  /**
   * @param {object} userAbility - CASL ability.
   * @param {string} uid - Content type uid.
   * @returns {object} Content Manager permission checker.
   */
  const checker = (userAbility, uid) =>
    strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model: uid });

  /**
   * Title attribute: the Content Manager `mainField` when it is a text
   * attribute, else the first text attribute.
   * @param {object} contentType - Content type schema.
   * @returns {Promise<string|null>} Attribute name or null.
   */
  const titleFieldFor = async (contentType) => {
    const attributes = contentType.attributes || {};
    let mainField;
    try {
      const configuration = await strapi
        .plugin('content-manager')
        .service('content-types')
        .findConfiguration(contentType);
      mainField = configuration && configuration.settings ? configuration.settings.mainField : null;
    } catch {
      // No Content Manager configuration (yet): fall back to the first text attribute.
      mainField = null;
    }
    if (typeof mainField === 'string' && attributes[mainField] && TITLE_TYPES.has(attributes[mainField].type))
      return mainField;
    const first = Object.entries(attributes).find(
      ([, attribute]) => attribute && TITLE_TYPES.has(attribute.type) && !attribute.private
    );
    return first ? first[0] : null;
  };

  /**
   * @param {object} contentType - Content type schema.
   * @returns {string|null} First `uid` attribute (used for `{slug}`).
   */
  const slugFieldFor = (contentType) => {
    const entry = Object.entries(contentType.attributes || {}).find(
      ([, attribute]) => attribute && attribute.type === 'uid'
    );
    return entry ? entry[0] : null;
  };

  const isLocalized = (contentType) => Boolean(contentType.pluginOptions?.i18n?.localized);
  const hasDraftAndPublish = (contentType) => contentType.options?.draftAndPublish === true;

  return {
    PAGE_SIZE,

    /**
     * Content types the caller can read in the Content Manager.
     * @param {object} userAbility - CASL ability.
     * @returns {Array<{ uid: string, kind: string, displayName: string, localized: boolean }>} Types.
     */
    types(userAbility) {
      if (!userAbility) return [];
      return access()
        .readableContentTypes(userAbility)
        .map(({ uid, kind, displayName }) => ({
          uid,
          kind,
          displayName,
          localized: isLocalized(strapi.contentType(uid)),
        }));
    },

    /**
     * Searches readable entries of one type by their title.
     * @param {{ userAbility: object, uid: string, q?: string, locale?: string, page?: number }} input - Validated input.
     * @returns {Promise<{ data: object[], meta: { pagination: { page: number, pageSize: number, pageCount: number, total: number } } }>} Page.
     * @throws {errors.NotFoundError} When the type does not exist or cannot be read.
     */
    async search({ userAbility, uid, q, locale, page = 1 }) {
      if (!userAbility) throw notFound();
      const contentType = strapi.contentType(uid);
      if (!contentType || !uid.startsWith('api::')) throw notFound();
      const pc = checker(userAbility, uid);
      if (pc.cannot.read()) throw notFound();

      let effectiveLocale = null;
      if (isLocalized(contentType)) {
        effectiveLocale =
          locale || (await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.()) || null;
        if (!effectiveLocale) throw notFound();
      }

      const titleField = await titleFieldFor(contentType);
      const canTitle = Boolean(titleField) && !pc.cannot.read(null, titleField);
      const slugField = slugFieldFor(contentType);
      const canSlug = Boolean(slugField) && !pc.cannot.read(null, slugField);
      const fields = ['documentId'];
      if (canTitle) fields.push(titleField);
      if (canSlug && slugField !== titleField) fields.push(slugField);

      const term = typeof q === 'string' ? q.trim() : '';
      let filters;
      if (term) {
        // Strapi escapes LIKE wildcards in $containsi; without a readable title only an exact documentId matches.
        filters = canTitle ? { [titleField]: { $containsi: term } } : { documentId: term };
      }
      // Same pattern as services/access.js: the permission query (with conditions) is combined with our
      // own filter, which only touches the title when the caller can read it.
      const permission = await pc.sanitizedQuery.read({});
      const parts = [permission && permission.filters, filters].filter(Boolean);
      let where;
      if (parts.length > 1) where = { $and: parts };
      else if (parts.length === 1) where = parts[0];

      const base = {
        ...(where ? { filters: where } : {}),
        locale: effectiveLocale || undefined,
        status: 'draft',
      };
      const documents = strapi.documents(uid);
      const [rows, total] = await Promise.all([
        documents.findMany({
          ...base,
          fields,
          ...(canTitle ? { sort: [{ [titleField]: 'asc' }] } : {}),
          start: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        }),
        documents.count(base),
      ]);

      let published = null;
      if (hasDraftAndPublish(contentType) && rows.length) {
        const versions = await documents.findMany({
          filters: { documentId: { $in: rows.map((row) => row.documentId) } },
          locale: effectiveLocale || undefined,
          status: 'published',
          fields: ['documentId'],
        });
        published = new Set(versions.map((version) => version.documentId));
      }

      const pattern = strapi.config.get('plugin::magic-editor-x.links.urlPattern') || '';
      const data = [];
      for (const row of rows) {
        const clean = (await pc.sanitizeOutput(row)) || {};
        const documentId = typeof row.documentId === 'string' ? row.documentId : null;
        if (!documentId) continue;
        const title =
          canTitle && typeof clean[titleField] === 'string' ? clean[titleField].slice(0, 200) : '';
        const slug = canSlug && typeof clean[slugField] === 'string' ? clean[slugField] : null;
        const item = {
          documentId,
          uid,
          locale: effectiveLocale,
          title,
          href: renderLinkPattern(pattern, {
            documentId,
            locale: effectiveLocale,
            slug,
            collection: contentType.info?.pluralName || '',
            singular: contentType.info?.singularName || '',
          }),
        };
        if (published) item.status = published.has(documentId) ? 'published' : 'draft';
        data.push(item);
      }

      return {
        data,
        meta: {
          pagination: {
            page,
            pageSize: PAGE_SIZE,
            pageCount: Math.ceil(total / PAGE_SIZE),
            total,
          },
        },
      };
    },
  };
};

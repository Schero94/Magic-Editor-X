'use strict';

const { errors } = require('@strapi/utils');
const { renderLinkPattern } = require('../../../shared/link-pattern.mjs');
const { normalizeEditorDataSafe, isPlainObject } = require('../../../shared/editor-data.mjs');
const { parseInline, nodesToHtml } = require('../../../shared/render/inline.mjs');

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

  /**
   * Calls `fn` for every string in block data (depth bounded) and stores its result.
   * @param {unknown} value - Data value.
   * @param {(text: string) => string} fn - String transformer.
   * @param {number} [depth=0] - Depth.
   * @returns {unknown} New value.
   */
  const mapStrings = (value, fn, depth = 0) => {
    if (depth > 12) return value;
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, depth + 1));
    if (isPlainObject(value)) {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, fn, depth + 1);
      return out;
    }
    return value;
  };

  /**
   * Visits the internal-link elements of inline HTML.
   * @param {Array<object>} nodes - Parsed inline nodes.
   * @param {(attrs: Record<string, string>) => void} fn - Visitor.
   * @param {number} [depth=0] - Depth.
   */
  const eachInternalLink = (nodes, fn, depth = 0) => {
    if (depth > 40) return;
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tag === 'a' && node.attrs['data-mex-uid'] && node.attrs['data-mex-document-id'])
        fn(node.attrs);
      eachInternalLink(node.children, fn, depth + 1);
    }
  };

  return {
    PAGE_SIZE,

    /**
     * Re-renders the `href` of every internal link in a stored value from
     * `links.urlPattern` and the entry's current values, so links follow slug
     * changes. Internal links store the entry reference (`data-mex-uid`,
     * `data-mex-document-id`, `data-mex-locale`); the `href` is only the
     * value at the time of linking. For server code (custom controllers,
     * lifecycles, webhooks): it does not check admin permissions, so call it
     * only for content the caller may already see. Links to entries that no
     * longer exist keep their stored `href`.
     * @param {unknown} value - Stored field value.
     * @param {{ status?: 'draft'|'published' }} [options] - Which version supplies the slug (default `published`).
     * @returns {Promise<object|null>} A new value (the input is not changed), or null for empty input.
     */
    async resolveHrefs(value, options = {}) {
      const data = normalizeEditorDataSafe(value);
      if (!data) return null;
      const status = options.status === 'draft' ? 'draft' : 'published';
      const wanted = new Map();
      for (const block of data.blocks) {
        mapStrings(block.data, (text) => {
          if (text.includes('data-mex-uid'))
            eachInternalLink(parseInline(text), (attrs) => {
              const uid = attrs['data-mex-uid'];
              const key = `${attrs['data-mex-locale'] || ''}`;
              if (!wanted.has(uid)) wanted.set(uid, new Map());
              if (!wanted.get(uid).has(key)) wanted.get(uid).set(key, new Set());
              wanted.get(uid).get(key).add(attrs['data-mex-document-id']);
            });
          return text;
        });
      }
      if (!wanted.size) return data;
      const pattern = strapi.config.get('plugin::magic-editor-x.links.urlPattern') || '';
      const hrefs = new Map();
      for (const [uid, byLocale] of wanted) {
        const contentType = strapi.contentType(uid);
        if (!contentType || !uid.startsWith('api::')) continue;
        const slugField = slugFieldFor(contentType);
        for (const [locale, ids] of byLocale) {
          const list = [...ids].slice(0, 1000);
          const rows = await strapi.documents(uid).findMany({
            filters: { documentId: { $in: list } },
            locale: isLocalized(contentType) ? locale || undefined : undefined,
            status: hasDraftAndPublish(contentType) ? status : undefined,
            fields: slugField ? ['documentId', slugField] : ['documentId'],
            limit: list.length,
          });
          for (const row of rows || []) {
            const href = renderLinkPattern(pattern, {
              documentId: row.documentId,
              locale: isLocalized(contentType) ? locale || null : null,
              slug: slugField && typeof row[slugField] === 'string' ? row[slugField] : null,
              collection: contentType.info?.pluralName || '',
              singular: contentType.info?.singularName || '',
            });
            if (href) hrefs.set(`${uid}|${locale}|${row.documentId}`, href);
          }
        }
      }
      const blocks = data.blocks.map((block) => ({
        ...block,
        data: mapStrings(block.data, (text) => {
          if (!text.includes('data-mex-uid')) return text;
          const nodes = parseInline(text);
          let changed = false;
          eachInternalLink(nodes, (attrs) => {
            const key = `${attrs['data-mex-uid']}|${attrs['data-mex-locale'] || ''}|${attrs['data-mex-document-id']}`;
            const href = hrefs.get(key);
            if (href && href !== attrs.href) {
              attrs.href = href;
              changed = true;
            }
          });
          return changed ? nodesToHtml(nodes, { storage: true }) : text;
        }),
      }));
      return { ...data, blocks };
    },

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
      // `locale` must be selected: locale permissions are conditions that
      // sanitizeOutput evaluates on the row (without it every field is dropped).
      const fields = effectiveLocale ? ['documentId', 'locale'] : ['documentId'];
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

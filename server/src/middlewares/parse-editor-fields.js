'use strict';

const { looksLikeEditorData } = require('../../../shared/editor-data.mjs');
const { walkOutput, routeContentType } = require('../utils/output-walk');

/**
 * Content API response middleware (enabled by `api.autoParseJSON`, default on).
 *
 * Magic Editor X 1.x stored field values as JSON strings, so 1.x API responses
 * contained strings. 2.x stores objects; entries saved with 1.x keep their
 * string until they are saved again. This middleware turns such strings into
 * objects in GET responses under the REST prefix, so every consumer sees one
 * shape.
 *
 * Schema-aware (fix after the 2.7 API audit): only the values of Magic Editor X fields are
 * parsed (top-level fields, components, dynamic zones and populated
 * relations, in the flat and the v4 response format; the same walk as `?mex=`
 * in `utils/output-walk.js`), on Content API routes of `api::` content types.
 * Strings in any other field (text, JSON fields, other plugins' routes) are
 * returned as stored, even when they look like an Editor.js document. Only
 * strings that parse to an Editor.js document (`{ blocks: [] }`) are touched.
 */

const MAX_STRING = 5 * 1024 * 1024;

/**
 * Parses one stored 1.x JSON string into an Editor.js object.
 * @param {unknown} item - Stored field value.
 * @returns {unknown} The parsed document, or the value unchanged when it is
 *   not a JSON string of an Editor.js document.
 */
const parseEditorString = (item) => {
  if (
    typeof item !== 'string' ||
    item.length <= 12 ||
    item.length >= MAX_STRING ||
    item.charCodeAt(0) !== 123 ||
    !item.includes('"blocks"')
  )
    return item;
  try {
    const parsed = JSON.parse(item);
    return looksLikeEditorData(parsed) ? parsed : item;
  } catch {
    // not JSON: keep the string
    return item;
  }
};

/**
 * Parses the Magic Editor X values of response data in place, following the
 * content-type schema.
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content-type schema of `data`.
 * @param {unknown} data - Response data (entry or list).
 * @returns {unknown} The same data.
 */
const parseEditorFields = (strapi, schema, data) => {
  walkOutput(strapi, schema, data, (holder, key) => {
    holder[key] = parseEditorString(holder[key]);
  });
  return data;
};

/**
 * Creates the Koa middleware.
 * @param {object} _config - Middleware config (unused).
 * @param {{ strapi: object }} context - Strapi.
 * @returns {Function} Koa middleware.
 */
const middleware =
  (_config, { strapi }) =>
  async (ctx, next) => {
    await next();
    if (ctx.method !== 'GET' || ctx.status !== 200 || !ctx.body || typeof ctx.body !== 'object') return;
    const prefix =
      String(strapi.config.get('api.rest.prefix', '/api') || '/api').replace(/\/+$/, '') || '/api';
    const path = ctx.path || '';
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return;
    if (!/json/i.test(String(ctx.type || ''))) return;
    try {
      const uid = routeContentType(ctx.state && ctx.state.route);
      const schema = uid ? strapi.contentType(uid) : null;
      if (!schema || !Object.prototype.hasOwnProperty.call(ctx.body, 'data')) return;
      ctx.body.data = parseEditorFields(strapi, schema, ctx.body.data);
    } catch {
      // never break a response
    }
  };

module.exports = middleware;
module.exports.parseEditorString = parseEditorString;
module.exports.parseEditorFields = parseEditorFields;

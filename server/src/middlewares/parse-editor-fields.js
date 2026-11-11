'use strict';

const { looksLikeEditorData } = require('../../../shared/editor-data.mjs');

/**
 * Content API response middleware (enabled by `api.autoParseJSON`, default on).
 *
 * Magic Editor X 1.x stored field values as JSON strings, so 1.x API responses
 * contained strings. 2.x stores objects; entries saved with 1.x keep their
 * string until they are saved again. This middleware turns such strings into
 * objects in GET responses under the REST prefix, so every consumer sees one
 * shape. Only strings that parse to an Editor.js document (`{ blocks: [] }`)
 * are touched.
 */

const MAX_STRING = 5 * 1024 * 1024;
const MAX_DEPTH = 12;

/**
 * Walks response data and parses Editor.js JSON strings in place.
 * @param {unknown} value - Response data.
 * @param {number} depth - Current depth.
 * @returns {unknown} Value with parsed editor fields.
 */
const parseValue = (value, depth = 0) => {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = parseValue(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === 'string') {
      if (
        item.length > 12 &&
        item.length < MAX_STRING &&
        item.charCodeAt(0) === 123 &&
        item.includes('"blocks"')
      ) {
        try {
          const parsed = JSON.parse(item);
          if (looksLikeEditorData(parsed)) value[key] = parsed;
        } catch {
          // not JSON: keep the string
        }
      }
    } else if (item && typeof item === 'object') {
      value[key] = parseValue(item, depth + 1);
    }
  }
  return value;
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
      if (Object.prototype.hasOwnProperty.call(ctx.body, 'data')) ctx.body.data = parseValue(ctx.body.data);
      else ctx.body = parseValue(ctx.body);
    } catch {
      // never break a response
    }
  };

module.exports = middleware;
module.exports.parseValue = parseValue;

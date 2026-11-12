'use strict';

const { errors } = require('@strapi/utils');
const { OUTPUT_FORMATS } = require('../../../shared/resolve-references.mjs');
const { walkOutput, routeContentType } = require('../utils/output-walk');
const { createLogger } = require('../utils/logger');

/**
 * Content API output transform (`?mex=html|text|markdown|json`).
 *
 * Opt-in per request: without `mex` the response is not touched. With it,
 * every Magic Editor X value in a GET response of a Content API route of an
 * `api::` content type (find/findOne of collection and single types,
 * including components, dynamic zones and populated relations) is replaced:
 * `json` with the stored document whose references are resolved, the other
 * formats with the rendered string. References resolve with the caller's
 * permissions (see services/references.js). Admin routes are never touched.
 *
 * `mex` is registered with `strapi.contentAPI.addQueryParams` (register.js),
 * so it is also accepted when `api.rest.strictParams` is on. An invalid value
 * answers 400 before the controller runs.
 */

const PARAM = 'mex';

/**
 * @param {object} strapi - Strapi instance.
 * @returns {string} REST prefix without a trailing slash.
 */
const restPrefix = (strapi) =>
  String(strapi.config.get('api.rest.prefix', '/api') || '/api').replace(/\/+$/, '') || '/api';

/**
 * Creates the Koa middleware.
 * @param {object} _config - Middleware config (unused).
 * @param {{ strapi: object }} context - Strapi.
 * @returns {Function} Koa middleware.
 */
const middleware = (_config, { strapi }) => {
  const logger = createLogger(strapi);
  return async (ctx, next) => {
    const query = ctx.query || {};
    if (ctx.method !== 'GET' || !Object.prototype.hasOwnProperty.call(query, PARAM)) return next();
    const prefix = restPrefix(strapi);
    const path = ctx.path || '';
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return next();
    const format = query[PARAM];
    if (typeof format !== 'string' || !OUTPUT_FORMATS.includes(format)) {
      throw new errors.ValidationError('Invalid query param mex', {
        key: PARAM,
        path: null,
        source: 'query',
        param: PARAM,
      });
    }
    await next();

    if (ctx.status !== 200 || !ctx.body || typeof ctx.body !== 'object' || !('data' in ctx.body)) return;
    const uid = routeContentType(ctx.state && ctx.state.route);
    const schema = uid ? strapi.contentType(uid) : null;
    if (!schema) return;
    const service = strapi.plugin('magic-editor-x').service('references');

    const targets = [];
    walkOutput(strapi, schema, ctx.body.data, (holder, key, attribute, locale) => {
      targets.push({ holder, key, value: holder[key], locale, options: attribute && attribute.options });
    });
    if (!targets.length) return;
    try {
      const output = await service.transform(targets, {
        format,
        auth: ctx.state.auth,
        status: query.status === 'draft' ? 'draft' : 'published',
      });
      targets.forEach((target, index) => {
        target.holder[target.key] = output[index];
      });
    } catch (error) {
      // Never fall back to the stored values (they may carry hrefs the caller may not resolve).
      logger.error('Content API output could not be rendered', error);
      ctx.status = 500;
      ctx.body = {
        data: null,
        error: { status: 500, name: 'InternalServerError', message: 'Internal Server Error', details: {} },
      };
    }
  };
};

module.exports = middleware;
module.exports.PARAM = PARAM;

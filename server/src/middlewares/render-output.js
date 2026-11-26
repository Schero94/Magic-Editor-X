'use strict';

const { errors } = require('@strapi/utils');
const { OUTPUT_FORMATS } = require('../../../shared/resolve-references.mjs');
const { walkOutput, routeContentType } = require('../utils/output-walk');
const { createLogger } = require('../utils/logger');

/**
 * Content API output transform (`?mex=html|text|markdown|json|blocks`).
 *
 * 2.13: `blocks` replaces each value with Strapi Blocks JSON (an array of nodes, `[]` when
 * empty) for `@strapi/blocks-react-renderer`; `&mexExtensions=true` keeps blocks without a
 * Blocks form as `magic-editor-x/<type>` nodes instead of their fallback.
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
 * so it is also accepted when `api.rest.strictParams` is on (Strapi then
 * validates it before the controller). An invalid value answers 400 on
 * Content API routes of `api::` content types. This global middleware runs
 * before the router, so the route is only known after `next()`: the check
 * runs there, and routes of other plugins (`/api/upload/files?mex=x`) and
 * admin routes are never changed, also with an invalid value.
 */

const PARAM = 'mex';
/**
 * 2.6: `?mex=html&mexBlockIds=true` marks every top-level block element with
 * `data-mex-block-id` and `data-mex-field-path` (renderer option `blockIds`);
 * with Strapi's preview header `strapi-encode-source-maps: true` also with
 * `data-strapi-source`. Other formats ignore it.
 */
const IDS_PARAM = 'mexBlockIds';
const IDS_VALUES = Object.freeze(['true', 'false']);
/** 2.13: `?mex=blocks&mexExtensions=true` (other formats ignore it). Same values as `mexBlockIds`. */
const EXTENSIONS_PARAM = 'mexExtensions';

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
    await next();

    // Only Content API routes of `api::` content types; other plugins' routes stay untouched.
    const uid = routeContentType(ctx.state && ctx.state.route);
    const schema = uid ? strapi.contentType(uid) : null;
    if (!schema) return;
    const format = query[PARAM];
    if (typeof format !== 'string' || !OUTPUT_FORMATS.includes(format)) {
      throw new errors.ValidationError('Invalid query param mex', {
        key: PARAM,
        path: null,
        source: 'query',
        param: PARAM,
      });
    }
    const ids = query[IDS_PARAM];
    if (ids !== undefined && (typeof ids !== 'string' || !IDS_VALUES.includes(ids))) {
      throw new errors.ValidationError(`Invalid query param ${IDS_PARAM}`, {
        key: IDS_PARAM,
        path: null,
        source: 'query',
        param: IDS_PARAM,
      });
    }
    const extensionsValue = query[EXTENSIONS_PARAM];
    if (
      extensionsValue !== undefined &&
      (typeof extensionsValue !== 'string' || !IDS_VALUES.includes(extensionsValue))
    ) {
      throw new errors.ValidationError(`Invalid query param ${EXTENSIONS_PARAM}`, {
        key: EXTENSIONS_PARAM,
        path: null,
        source: 'query',
        param: EXTENSIONS_PARAM,
      });
    }
    const withExtensions = extensionsValue === 'true' && format === 'blocks';
    const withIds = ids === 'true' && format === 'html';
    const withSource = withIds && Boolean(ctx.headers) && ctx.headers['strapi-encode-source-maps'] === 'true';
    if (ctx.status !== 200 || !ctx.body || typeof ctx.body !== 'object' || !('data' in ctx.body)) return;
    const service = strapi.plugin('magic-editor-x').service('references');

    const targets = [];
    walkOutput(strapi, schema, ctx.body.data, (holder, key, attribute, locale, where) => {
      const target = { holder, key, value: holder[key], locale, options: attribute && attribute.options };
      if (withIds)
        target.render = {
          blockIds: { field: where.path, ...(withSource ? { strapiSource: where.entry } : {}) },
        };
      if (withExtensions) target.render = { extensions: true };
      targets.push(target);
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
module.exports.IDS_PARAM = IDS_PARAM;
module.exports.IDS_VALUES = IDS_VALUES;
module.exports.EXTENSIONS_PARAM = EXTENSIONS_PARAM;

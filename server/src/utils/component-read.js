'use strict';

const { schemaHasEditorFields } = require('./editor-fields');
const { walkOutput } = require('./output-walk');
const { createComponentOutput } = require('./component-blocks');
const { createLogger } = require('./logger');

/**
 * Component blocks in default Content API and GraphQL output (2.6).
 *
 * Stored component blocks keep their values when a component is later
 * deleted, or an attribute deleted or made private, in the Content-Type
 * Builder (the editor shows a notice and saves keep the data). `?mex=` output
 * and the GraphQL `Rendered`/`Resolved` fields already follow the current
 * schema (`createComponentOutput`). This Document Service middleware applies
 * the same filter to what the plain REST and GraphQL reads return, so a site
 * never receives values of attributes that no longer exist or are private:
 * blocks of removed or unsupported components are left out, only current,
 * non-private attributes are kept.
 *
 * Only inside a Content API request (route type `content-api`, which also
 * covers `/graphql`). Admin requests (the Content Manager, the plugin's own
 * routes) and internal reads (live rooms, history, migrations) see the stored
 * value unchanged, so nothing is dropped when it is saved again. Values
 * without component blocks are returned as the same object: other output is
 * byte-identical.
 */

const ENTRY_ACTIONS = new Set(['findOne', 'findFirst']);
const LIST_ACTIONS = new Set(['findMany']);

/**
 * True inside a Content API request (REST under the API prefix or GraphQL).
 * @param {object} strapi - Strapi instance.
 * @returns {boolean} Result.
 */
const inContentApiRequest = (strapi) => {
  try {
    const ctx = strapi.requestContext && strapi.requestContext.get();
    const route = ctx && ctx.state && ctx.state.route;
    return Boolean(route && route.info && route.info.type === 'content-api');
  } catch {
    return false;
  }
};

/**
 * Applies the component output filter to the Magic Editor X values of entries (in place).
 * @param {object} strapi - Strapi instance.
 * @param {object} contentType - Schema of the entries.
 * @param {Array<object>} entries - Entries.
 * @param {(value: unknown) => unknown} output - `createComponentOutput(strapi)`.
 * @param {Map<string, boolean>} cache - Schema cache.
 * @returns {number} Values changed.
 */
const filterEntries = (strapi, contentType, entries, output, cache) => {
  let changed = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    walkOutput(
      strapi,
      contentType,
      entry,
      (holder, key) => {
        const next = output(holder[key]);
        if (next !== holder[key]) {
          holder[key] = next;
          changed += 1;
        }
      },
      { cache }
    );
  }
  return changed;
};

/**
 * Registers the read-side Document Service middleware.
 * @param {object} strapi - Strapi instance.
 * @returns {Function} The middleware (for tests).
 */
const registerComponentOutputOnRead = (strapi) => {
  const logger = createLogger(strapi);
  const cache = new Map();
  const output = createComponentOutput(strapi);
  const middleware = async (ctx, next) => {
    const result = await next();
    if (!ENTRY_ACTIONS.has(ctx.action) && !LIST_ACTIONS.has(ctx.action)) return result;
    if (!result || !inContentApiRequest(strapi)) return result;
    const contentType = ctx.contentType || strapi.contentType(ctx.uid);
    if (!contentType || !schemaHasEditorFields(strapi, contentType, cache)) return result;
    try {
      filterEntries(strapi, contentType, Array.isArray(result) ? result : [result], output, cache);
    } catch (error) {
      logger.warn('component blocks could not be filtered for output', { name: error && error.name });
    }
    return result;
  };
  strapi.documents.use(middleware);
  return middleware;
};

module.exports = { registerComponentOutputOnRead, filterEntries, inContentApiRequest };

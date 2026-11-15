'use strict';

const { schemaHasEditorFields, transformEditorFields } = require('./editor-fields');
const { walkOutput } = require('./output-walk');
const { createLogger } = require('./logger');

/**
 * Private upload providers (2.5): a Document Service middleware that does for
 * Magic Editor X values what Strapi's upload plugin does for media, Rich text
 * and Blocks fields (`signFileUrlsOnDocumentService`):
 * - `create`, `update`, `clone`: signatures are removed from the Media
 *   Library file URLs of the written values (`media.unsignValues`), so a
 *   short-lived URL is never stored;
 * - results of `findOne`, `findFirst`, `findMany`, `create`, `update` and of
 *   `delete`/`clone`/`publish`/`unpublish`/`discardDraft` (`{ entries }`) get
 *   freshly signed URLs (`media.signValues`): Content API, GraphQL and every
 *   Document Service reader outside an admin request.
 * - Admin requests (the Content Manager edit view, the plugin's own routes)
 *   keep the stored, unsigned URLs: the editor signs what it shows
 *   (`POST /media/signed-urls`), and a live collaboration room holds the
 *   stored content, so the edit view and the room stay equal (signed copies
 *   made every media block differ from the room and re-render on join).
 *
 * Registered only when the provider says it is private, like Strapi's own
 * middleware; public providers keep their output byte for byte.
 */

const WRITE_ACTIONS = new Set(['create', 'update', 'clone']);
const ENTRY_ACTIONS = new Set(['findOne', 'findFirst', 'create', 'update']);
const ENTRIES_ACTIONS = new Set(['delete', 'clone', 'publish', 'unpublish', 'discardDraft']);

/**
 * Collects the Magic Editor X values of write data, unsigns them in one batch
 * and writes them back.
 * @param {object} strapi - Strapi instance.
 * @param {object} contentType - Schema.
 * @param {object} data - Write data (changed in place).
 * @returns {Promise<void>}
 */
const unsignWrite = async (strapi, contentType, data) => {
  const targets = [];
  transformEditorFields(strapi, contentType, data, (value, _attribute, path, container) => {
    targets.push({ container, key: path.split('.').pop(), value });
    return value;
  });
  if (!targets.length) return;
  const media = strapi.plugin('magic-editor-x').service('media');
  const values = await media.unsignValues(targets.map((target) => target.value));
  targets.forEach((target, index) => {
    if (values[index] !== target.value) target.container[target.key] = values[index];
  });
};

/**
 * Signs the Magic Editor X values of result entries in one batch.
 * @param {object} strapi - Strapi instance.
 * @param {object} contentType - Schema.
 * @param {Array<object>} entries - Result entries (changed in place).
 * @param {Map<string, boolean>} cache - Schema cache.
 * @returns {Promise<void>}
 */
const signRead = async (strapi, contentType, entries, cache) => {
  const targets = [];
  for (const entry of entries) {
    walkOutput(
      strapi,
      contentType,
      entry,
      (holder, key) => {
        targets.push({ holder, key, value: holder[key] });
      },
      { cache }
    );
  }
  if (!targets.length) return;
  const media = strapi.plugin('magic-editor-x').service('media');
  const values = await media.signValues(targets.map((target) => target.value));
  targets.forEach((target, index) => {
    if (values[index] !== target.value) target.holder[target.key] = values[index];
  });
};

/**
 * The plugin's media service, or null (unit tests run services with a partial Strapi).
 * @param {object} strapi - Strapi instance.
 * @returns {object|null} Service.
 */
const mediaService = (strapi) => {
  try {
    const service = strapi.plugin('magic-editor-x').service('media');
    return service && typeof service.signValues === 'function' ? service : null;
  } catch {
    return null;
  }
};

/**
 * Removes private-provider signatures from one value before it is stored.
 * @param {object} strapi - Strapi instance.
 * @param {unknown} value - Value.
 * @returns {Promise<unknown>} Value (the same one for public providers).
 */
const unsignStored = async (strapi, value) => {
  const service = mediaService(strapi);
  return service ? service.unsignValue(value) : value;
};

/**
 * Removes private-provider signatures from several values.
 * @param {object} strapi - Strapi instance.
 * @param {unknown[]} values - Values.
 * @returns {Promise<unknown[]>} Values.
 */
const unsignStoredAll = async (strapi, values) => {
  const service = mediaService(strapi);
  return service ? service.unsignValues(values) : values;
};

/**
 * Signs the private-provider files of several values for output.
 * @param {object} strapi - Strapi instance.
 * @param {unknown[]} values - Values.
 * @returns {Promise<unknown[]>} Values.
 */
const signForOutput = async (strapi, values) => {
  const service = mediaService(strapi);
  return service ? service.signValues(values) : values;
};

/**
 * Registers the middleware when the upload provider is private.
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<boolean>} True when registered.
 */
/**
 * True while serving an admin route (`route.info.type === 'admin'`, set by Strapi's router).
 * @param {object} strapi - Strapi instance.
 * @returns {boolean} Result.
 */
const inAdminRequest = (strapi) => {
  try {
    const ctx = strapi.requestContext && strapi.requestContext.get();
    const route = ctx && ctx.state && ctx.state.route;
    return Boolean(route && route.info && route.info.type === 'admin');
  } catch {
    return false;
  }
};

const registerMediaSigning = async (strapi) => {
  const media = strapi.plugin('magic-editor-x').service('media');
  if (!(await media.isPrivate())) return false;
  const logger = createLogger(strapi);
  const cache = new Map();
  strapi.documents.use(async (ctx, next) => {
    const contentType = ctx.contentType || strapi.contentType(ctx.uid);
    if (!contentType || !schemaHasEditorFields(strapi, contentType, cache)) return next();
    if (WRITE_ACTIONS.has(ctx.action) && ctx.params && ctx.params.data && typeof ctx.params.data === 'object')
      await unsignWrite(strapi, contentType, ctx.params.data);
    const result = await next();
    if (inAdminRequest(strapi)) return result;
    try {
      if (ctx.action === 'findMany' && Array.isArray(result))
        await signRead(strapi, contentType, result, cache);
      else if (ENTRY_ACTIONS.has(ctx.action) && result && typeof result === 'object')
        await signRead(strapi, contentType, [result], cache);
      else if (ENTRIES_ACTIONS.has(ctx.action) && result && Array.isArray(result.entries))
        await signRead(strapi, contentType, result.entries, cache);
    } catch (error) {
      // The stored (unsigned) URLs stay; the entry itself is returned as read.
      logger.warn('media file URLs could not be signed', error);
    }
    return result;
  });
  return true;
};

module.exports = { registerMediaSigning, mediaService, unsignStored, unsignStoredAll, signForOutput };

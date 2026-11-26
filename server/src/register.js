'use strict';

const { createLogger } = require('./utils/logger');
const { cleanEditorValue } = require('./utils/sanitizer');
const { resolveFieldPreset, inlinePolicy, checkPreset } = require('../../shared/presets.mjs');
const { paletteOf } = require('./utils/inline-policy');
const { schemaHasEditorFields, transformEditorFields } = require('./utils/editor-fields');
const { registerPublishGuard } = require('./utils/publish-guard');
const { createRepairMiddleware } = require('./utils/ai-localization-guard');
const { registerReleaseReadiness } = require('./utils/release-readiness');
const { formErrorDetails } = require('./utils/form-errors');
const { registerCommentRetention } = require('./utils/comment-retention');
const { registerAuditTrail } = require('./utils/audit-trail');
const { OUTPUT_FORMATS } = require('../../shared/resolve-references.mjs');
const { registerGraphql } = require('./graphql');
const { createComponentChecker } = require('./utils/component-blocks');
const { isBuiltInBlock } = require('../../shared/sanitize-policy.mjs');
const { registerMcp } = require('./mcp');
const {
  readPositionalEntries,
  rememberedKeysOf,
  fieldKeyScopeOf,
  registerDiscardKeys,
  REMEMBER_TTL_MS,
} = require('./utils/field-identity');
const {
  assignFieldKeys,
  basePathOf,
  isPositionalFieldPath,
  isValidFieldKey,
} = require('../../shared/field-identity.mjs');

/**
 * Positional values of a write that belong to an existing component row (`id` sent).
 * @param {Array<{ path: string, value: object|null, container: object }>} items - Clean values of the write.
 * @returns {Array<object>} Items.
 */
const existingRows = (items) =>
  items.filter(
    (item) =>
      isPositionalFieldPath(item.path) &&
      item.container &&
      item.container.id !== undefined &&
      item.container.id !== null
  );

/**
 * Stored draft entries of the base paths a write needs (2.4 and 2.5): base
 * paths with an existing component entry sent without key (keeps the stored
 * key, for API clients that drop unknown keys), sent as `null` (remembers the
 * key of an emptied entry, 2.5) or whose row has a remembered key (gives it
 * back, 2.5). One draft read per such base path; none for other writes.
 * @param {object} strapi - Strapi instance.
 * @param {object} ctx - Document Service middleware context.
 * @param {Array<{ path: string, value: object|null, container: object }>} items - Clean values of the write.
 * @param {object} logger - Plugin logger.
 * @returns {Promise<Map<string, Array<object>>>} Base path -> entries (`readPositionalEntries`).
 */
const storedEntriesFor = async (strapi, ctx, items, logger) => {
  const out = new Map();
  if (ctx.action !== 'update' || !ctx.params || typeof ctx.params.documentId !== 'string') return out;
  const target = {
    uid: ctx.uid,
    documentId: ctx.params.documentId,
    locale: typeof ctx.params.locale === 'string' ? ctx.params.locale : undefined,
  };
  const byBase = new Map();
  for (const item of existingRows(items)) {
    const basePath = basePathOf(item.path);
    if (!byBase.has(basePath)) byBase.set(basePath, []);
    byBase.get(basePath).push(item);
  }
  for (const [basePath, rows] of byBase) {
    try {
      const needed = rows.some((item) => !item.value || !isValidFieldKey(item.value.fieldKey));
      if (!needed) {
        const { keys } = await rememberedKeysOf(strapi, { ...target, basePath });
        if (!rows.some((item) => keys.has(String(item.container.id)))) continue;
      }
      out.set(basePath, await readPositionalEntries(strapi, { ...target, basePath }));
    } catch (error) {
      logger.warn('stored field keys could not be read', { code: error && error.code });
    }
  }
  return out;
};

/**
 * The stored entry of the component row an item belongs to.
 * @param {Map<string, Array<object>>} stored - `storedEntriesFor` result.
 * @param {{ path: string, container: object }} item - Item.
 * @returns {object|undefined} Entry.
 */
const storedRowOf = (stored, item) => {
  const entries = stored.get(basePathOf(item.path));
  const id = item.container && item.container.id;
  if (!entries || id === undefined || id === null) return undefined;
  return entries.find((entry) => entry.componentId === String(id));
};

/**
 * 2.5: remembers the key of entries emptied by this write and forgets the
 * remembered key of entries that have content again (after the write).
 * @param {object} strapi - Strapi instance.
 * @param {object} ctx - Document Service middleware context.
 * @param {Array<object>} items - Clean values of the write (keys assigned).
 * @param {Map<string, Array<object>>} stored - `storedEntriesFor` result.
 * @param {object} logger - Plugin logger.
 * @returns {Promise<void>}
 */
const updateRememberedKeys = async (strapi, ctx, items, stored, logger) => {
  if (stored.size === 0) return;
  const changes = new Map();
  for (const item of existingRows(items)) {
    const entry = storedRowOf(stored, item);
    if (!entry || !entry.fieldKey) continue;
    const basePath = basePathOf(item.path);
    if (!changes.has(basePath)) changes.set(basePath, { remember: [], forget: [] });
    if (!item.value && !entry.remembered)
      changes.get(basePath).remember.push([entry.componentId, entry.fieldKey]);
    else if (item.value && entry.remembered) changes.get(basePath).forget.push(entry.componentId);
  }
  for (const [basePath, { remember, forget }] of changes) {
    if (!remember.length && !forget.length) continue;
    try {
      const store = strapi.plugin('magic-editor-x').service('store');
      const scope = await fieldKeyScopeOf(strapi, {
        uid: ctx.uid,
        documentId: ctx.params.documentId,
        locale: ctx.params.locale,
        basePath,
      });
      if (remember.length) await store.rememberFieldKeys(scope, remember, REMEMBER_TTL_MS);
      if (forget.length) await store.forgetFieldKeys(scope, forget);
    } catch (error) {
      logger.warn('field keys of emptied entries could not be updated', { code: error && error.code });
    }
  }
};

/**
 * Registers the `mex` query parameter on the GET routes of `api::` content
 * types (Strapi's documented `contentAPI.addQueryParams`), so `?mex=` also
 * passes when the host sets `api.rest.strictParams: true`. Strapi versions
 * without `addQueryParams` accept unknown query keys unless strict mode is on.
 * @param {object} strapi - Strapi instance.
 */
const registerOutputParam = (strapi) => {
  const contentAPI = strapi.contentAPI;
  if (!contentAPI || typeof contentAPI.addQueryParams !== 'function') return;
  const matchRoute = (route) =>
    Boolean(route) && route.method === 'GET' && Boolean(route.info) && typeof route.info.apiName === 'string';
  contentAPI.addQueryParams({
    mex: { schema: (z) => z.enum(OUTPUT_FORMATS).optional(), matchRoute },
    // 2.6: block source attributes in `?mex=html` output.
    mexBlockIds: { schema: (z) => z.enum(['true', 'false']).optional(), matchRoute },
    // 2.13: extension nodes in `?mex=blocks` output.
    mexExtensions: { schema: (z) => z.enum(['true', 'false']).optional(), matchRoute },
  });
};

/**
 * Document Service actions whose `params.data` is written to the database and
 * therefore passes the save sanitiser (checked against the installed
 * @strapi/core 5.63 `document-service/repository.js`): `create` and `update`
 * store `data`; `clone` (the Content Manager "Duplicate") merges `data` over
 * the copied draft before it stores the new document. `publish`,
 * `unpublish` and `discardDraft` ignore `data` (they copy rows that were
 * stored, and therefore sanitised, by one of these actions).
 */
const WRITE_ACTIONS = Object.freeze(['create', 'update', 'clone']);

/**
 * True when a raw value holds a block of type `component` whose data has the
 * built-in shape but no `_mex` marker (written by an import or script, 2.6).
 * @param {unknown} value - Raw field value from the write.
 * @returns {boolean} Result.
 */
const hasUnmarkedComponentBlock = (value) => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
  }
  const blocks = parsed && Array.isArray(parsed.blocks) ? parsed.blocks : [];
  return blocks.some(
    (block) =>
      block &&
      block.type === 'component' &&
      block.data &&
      typeof block.data === 'object' &&
      !Object.prototype.hasOwnProperty.call(block.data, '_mex') &&
      isBuiltInBlock(block)
  );
};

/**
 * Registers the custom field and the Document Service middleware that
 * normalises and sanitises Magic Editor X values on every write that carries
 * data (`WRITE_ACTIONS`: Content Manager create, update and duplicate, Content
 * API, imports, scripts). Invalid values are rejected with a 400 instead of
 * being stored.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 */
module.exports = ({ strapi }) => {
  strapi.customFields.register({
    name: 'richtext',
    plugin: 'magic-editor-x',
    type: 'json',
    inputSize: { default: 12, isResizable: false },
  });

  const logger = createLogger(strapi);
  const cache = new Map();
  // 2.5: component blocks are checked against the field's allowed list and the current schemas.
  const checkComponents = createComponentChecker(strapi);
  let warnedUnmarked = false;
  const saveMiddleware = async (ctx, next) => {
    const sanitize = strapi.config.get('plugin::magic-editor-x.sanitizeOnSave') !== false;
    if (!sanitize || !WRITE_ACTIONS.includes(ctx.action) || !ctx.params || !ctx.params.data) return next();
    const contentType = ctx.contentType || strapi.contentType(ctx.uid);
    if (!contentType || !schemaHasEditorFields(strapi, contentType, cache)) return next();
    const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
    const violations = [];
    const items = [];
    let current = null;
    try {
      transformEditorFields(strapi, contentType, ctx.params.data, (value, attribute, path, container) => {
        current = path;
        const preset = resolveFieldPreset(attribute && attribute.options);
        const sanitized = cleanEditorValue(value, {
          rawHtml,
          inline: inlinePolicy(preset, { palette: paletteOf(strapi) }),
        });
        const checked = checkComponents(sanitized, preset);
        const clean = checked.data;
        for (const violation of checked.violations) {
          if (violations.length < 50) violations.push({ field: path, ...violation });
        }
        // 2.6: data of type `component` written without the built-in marker (imports, scripts) is read as a
        // built-in component block since 2.6. Say so once when such a block is refused (no content logged).
        if (checked.violations.length && !warnedUnmarked && hasUnmarkedComponentBlock(value)) {
          warnedUnmarked = true;
          logger.warn(
            'a block of type "component" without the built-in marker was refused: since 2.6 such data is a component block (see the CHANGELOG migration notes)'
          );
        }
        if (preset.restricted) {
          for (const violation of checkPreset(clean, preset)) {
            if (violations.length < 50) violations.push({ field: path, ...violation });
          }
        }
        items.push({ path, value: clean, container });
        return clean;
      });
    } catch (error) {
      if (error && error.name === 'EditorDataError') {
        const { errors } = require('@strapi/utils');
        throw new errors.ValidationError(
          'A Magic Editor X field contains invalid content',
          formErrorDetails(error.code, current ? [current] : [])
        );
      }
      logger.error('editor content could not be sanitised', error);
      throw error;
    }
    if (violations.length) {
      const { errors } = require('@strapi/utils');
      // Field presets (custom field options) are enforced here for every
      // writer. Details carry rule codes and block ids only, never content.
      throw new errors.ValidationError(
        'A Magic Editor X field does not match its field settings',
        formErrorDetails(
          'PRESET_VIOLATION',
          violations.map((violation) => violation.field),
          { violations }
        )
      );
    }
    // 2.4 field identity: every non-null value inside a repeatable component or dynamic zone
    // carries a `fieldKey`, unique within the write; null stays null (required checks unchanged).
    const stored = await storedEntriesFor(strapi, ctx, items, logger);
    // 2.5: an entry that was emptied (stored null) gets its remembered key back, also when the
    // writer sent a new key (the admin generates one for an empty field) that is stored nowhere.
    for (const item of existingRows(items)) {
      const entry = storedRowOf(stored, item);
      if (!entry || !entry.remembered || !item.value || item.value.fieldKey === entry.fieldKey) continue;
      const entries = stored.get(basePathOf(item.path));
      const savedElsewhere = entries.some(
        (other) => !other.remembered && other.fieldKey === item.value.fieldKey
      );
      if (!savedElsewhere) delete item.value.fieldKey;
    }
    assignFieldKeys(items, {
      inherit: (item) => {
        const entry = storedRowOf(stored, item);
        return entry ? entry.fieldKey : null;
      },
    });
    const result = await next();
    await updateRememberedKeys(strapi, ctx, items, stored, logger);
    return result;
  };
  // 2.4: writes of Strapi's i18n AI translations are rebuilt from the source locale first
  // (no-op for every other write), then cleaned and checked like any write.
  const repairAiLocalization = createRepairMiddleware(strapi, logger);
  strapi.documents.use((ctx, next) => repairAiLocalization(ctx, () => saveMiddleware(ctx, next)));
  registerPublishGuard(strapi);
  registerReleaseReadiness(strapi);
  registerOutputParam(strapi);
  registerGraphql(strapi);
  registerCommentRetention(strapi);
  registerAuditTrail(strapi);
  // 2.5: MCP tools for AI clients (off unless `mcp.enabled` and Strapi's MCP server are on).
  registerMcp(strapi);
  // 2.5: after the audit trail, so its "after" read of a discarded draft sees the kept keys.
  registerDiscardKeys(strapi, logger);
};

module.exports.hasUnmarkedComponentBlock = hasUnmarkedComponentBlock;
module.exports.WRITE_ACTIONS = WRITE_ACTIONS;

'use strict';

const { createLogger } = require('./utils/logger');
const { cleanEditorValue } = require('./utils/sanitizer');
const { resolveFieldPreset, allowedInlineTags, checkPreset } = require('../../shared/presets.mjs');
const { schemaHasEditorFields, transformEditorFields } = require('./utils/editor-fields');
const { registerPublishGuard } = require('./utils/publish-guard');
const { formErrorDetails } = require('./utils/form-errors');
const { registerCommentRetention } = require('./utils/comment-retention');
const { OUTPUT_FORMATS } = require('../../shared/resolve-references.mjs');
const { registerGraphql } = require('./graphql');
const { readPositionalEntries } = require('./utils/field-identity');
const {
  assignFieldKeys,
  basePathOf,
  isPositionalFieldPath,
  isValidFieldKey,
} = require('../../shared/field-identity.mjs');

/**
 * Keys of the stored draft's positional values per component row, so a write
 * that sends an existing component entry (its `id`) without the key keeps the
 * entry's key (API clients that drop unknown keys). Returns an empty map when
 * nothing needs it or the draft cannot be read.
 * @param {object} strapi - Strapi instance.
 * @param {object} ctx - Document Service middleware context.
 * @param {Array<{ path: string, value: object|null, container: object }>} items - Clean values of the write.
 * @param {object} logger - Plugin logger.
 * @returns {Promise<Map<string, string>>} `<base path>|<component id>` -> key.
 */
const storedKeysFor = async (strapi, ctx, items, logger) => {
  const keys = new Map();
  if (ctx.action !== 'update' || !ctx.params || typeof ctx.params.documentId !== 'string') return keys;
  const wanted = new Set();
  for (const item of items) {
    const id = item.container && item.container.id;
    if (item.value && !isValidFieldKey(item.value.fieldKey) && isPositionalFieldPath(item.path) && id != null)
      wanted.add(basePathOf(item.path));
  }
  for (const basePath of wanted) {
    try {
      const entries = await readPositionalEntries(strapi, {
        uid: ctx.uid,
        documentId: ctx.params.documentId,
        locale: typeof ctx.params.locale === 'string' ? ctx.params.locale : undefined,
        basePath,
      });
      for (const entry of entries) {
        if (entry.fieldKey && entry.componentId) keys.set(`${basePath}|${entry.componentId}`, entry.fieldKey);
      }
    } catch (error) {
      logger.warn('stored field keys could not be read', { code: error && error.code });
    }
  }
  return keys;
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
  contentAPI.addQueryParams({
    mex: {
      schema: (z) => z.enum(OUTPUT_FORMATS).optional(),
      matchRoute: (route) =>
        Boolean(route) &&
        route.method === 'GET' &&
        Boolean(route.info) &&
        typeof route.info.apiName === 'string',
    },
  });
};

/**
 * Registers the custom field and the Document Service middleware that
 * normalises and sanitises Magic Editor X values on every write (Content
 * Manager, Content API, imports, scripts). Invalid values are rejected with a
 * 400 instead of being stored.
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
  strapi.documents.use(async (ctx, next) => {
    const sanitize = strapi.config.get('plugin::magic-editor-x.sanitizeOnSave') !== false;
    if (!sanitize || !['create', 'update'].includes(ctx.action) || !ctx.params || !ctx.params.data)
      return next();
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
        const clean = cleanEditorValue(value, { rawHtml, inlineTags: allowedInlineTags(preset) });
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
    const stored = await storedKeysFor(strapi, ctx, items, logger);
    assignFieldKeys(items, {
      inherit: (item) => {
        const id = item.container && item.container.id;
        return id == null ? null : stored.get(`${basePathOf(item.path)}|${String(id)}`);
      },
    });
    return next();
  });
  registerPublishGuard(strapi);
  registerOutputParam(strapi);
  registerGraphql(strapi);
  registerCommentRetention(strapi);
};

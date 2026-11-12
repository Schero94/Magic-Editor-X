'use strict';

const { createLogger } = require('./utils/logger');
const { cleanEditorValue } = require('./utils/sanitizer');
const { resolveFieldPreset, allowedInlineTags, checkPreset } = require('../../shared/presets.mjs');
const { schemaHasEditorFields, transformEditorFields } = require('./utils/editor-fields');
const { registerPublishGuard } = require('./utils/publish-guard');
const { formErrorDetails } = require('./utils/form-errors');
const { registerCommentRetention } = require('./utils/comment-retention');
const { registerAuditTrail } = require('./utils/audit-trail');
const { OUTPUT_FORMATS } = require('../../shared/resolve-references.mjs');
const { registerGraphql } = require('./graphql');

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
    let current = null;
    try {
      transformEditorFields(strapi, contentType, ctx.params.data, (value, attribute, path) => {
        current = path;
        const preset = resolveFieldPreset(attribute && attribute.options);
        const clean = cleanEditorValue(value, { rawHtml, inlineTags: allowedInlineTags(preset) });
        if (preset.restricted) {
          for (const violation of checkPreset(clean, preset)) {
            if (violations.length < 50) violations.push({ field: path, ...violation });
          }
        }
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
    return next();
  });
  registerPublishGuard(strapi);
  registerOutputParam(strapi);
  registerGraphql(strapi);
  registerCommentRetention(strapi);
  registerAuditTrail(strapi);
};

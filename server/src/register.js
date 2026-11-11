'use strict';

const { createLogger } = require('./utils/logger');
const { cleanEditorValue } = require('./utils/sanitizer');
const { resolveFieldPreset, allowedInlineTags, checkPreset } = require('../../shared/presets.mjs');
const { schemaHasEditorFields, transformEditorFields } = require('./utils/editor-fields');
const { registerPublishGuard } = require('./utils/publish-guard');

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
    try {
      transformEditorFields(strapi, contentType, ctx.params.data, (value, attribute, path) => {
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
        throw new errors.ValidationError('A Magic Editor X field contains invalid content', {
          code: error.code,
        });
      }
      logger.error('editor content could not be sanitised', error);
      throw error;
    }
    if (violations.length) {
      const { errors } = require('@strapi/utils');
      // Field presets (custom field options) are enforced here for every
      // writer. Details carry rule codes and block ids only, never content.
      throw new errors.ValidationError('A Magic Editor X field does not match its field settings', {
        code: 'PRESET_VIOLATION',
        violations,
      });
    }
    return next();
  });
  registerPublishGuard(strapi);
};

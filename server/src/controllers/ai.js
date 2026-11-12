'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, uidSchema, fieldPathSchema, errors } = require('../utils/validation');
const { resolveEditorField } = require('../utils/editor-fields');
const { resolveFieldPreset } = require('../../../shared/presets.mjs');

const bodySchema = z.strictObject({
  text: z.string().min(1).max(60000),
  language: z.string().max(40).optional(),
  tone: z.string().max(40).optional(),
  // The field the text comes from: field presets can turn the assistant off per field.
  target: z.strictObject({ uid: uidSchema, field: fieldPathSchema }),
});

const MESSAGES = {
  DISABLED: [503, 'The AI assistant is turned off'],
  NOT_CONFIGURED: [503, 'The AI assistant is not configured'],
  NO_API_KEY: [503, 'The AI provider key is missing'],
  AUTH_FAILED: [502, 'The AI provider rejected the key'],
  PROVIDER_RATE_LIMIT: [503, 'The AI provider is busy. Try again later.'],
  TIMEOUT: [504, 'The AI provider did not answer in time'],
  REFUSED: [422, 'The AI provider declined this request'],
};

/**
 * Maps provider errors to fixed responses with a machine code.
 * @param {object} ctx - Koa context.
 * @param {Error & { code?: string }} error - Error.
 * @returns {boolean} True when handled.
 */
const sendProviderError = (ctx, error) => {
  if (!error || error.message !== 'AI provider unavailable') return false;
  const [status, message] = MESSAGES[error.code] || [502, 'The AI provider is not available'];
  ctx.status = status;
  ctx.body = {
    data: null,
    error: { status, name: 'AIProviderError', message, details: { code: error.code || 'PROVIDER_ERROR' } },
  };
  return true;
};

module.exports = ({ strapi }) => {
  return {
    /**
     * @route POST /magic-editor-x/ai/:action { text, language?, tone?, target: { uid, field } }
     * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.ai.use
     * @returns {{ data: { text: string } }} Suggested replacement (sanitised inline HTML).
     * @throws {errors.NotFoundError} Unknown content type or field (404).
     * @throws {errors.ForbiddenError} The field's options turn the assistant off (403).
     * @sideeffect Sends the text to the owner's AI provider. Text is never logged.
     */
    async run(ctx) {
      const action = String(ctx.params.action || '');
      const { target, ...body } = parseOrThrow(bodySchema, ctx.request.body || {});
      const contentType = strapi.contentType(target.uid);
      const resolved = contentType ? resolveEditorField(strapi, contentType, target.field) : null;
      if (!resolved) throw new errors.NotFoundError('Not found');
      if (!resolveFieldPreset(resolved.attribute.options).ai)
        throw new errors.ForbiddenError('The AI assistant is turned off for this field');
      try {
        ctx.body = { data: await service(strapi, 'ai').run({ action, ...body }, ctx.state.user) };
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },
  };
};

module.exports.sendProviderError = sendProviderError;

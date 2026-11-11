'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow } = require('../utils/validation');

const bodySchema = z.strictObject({
  text: z.string().min(1).max(60000),
  language: z.string().max(40).optional(),
  tone: z.string().max(40).optional(),
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
     * @route POST /magic-editor-x/ai/:action { text, language?, tone? }
     * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.ai.use
     * @returns {{ data: { text: string } }} Suggested replacement (sanitised inline HTML).
     * @sideeffect Sends the text to the owner's AI provider. Text is never logged.
     */
    async run(ctx) {
      const action = String(ctx.params.action || '');
      const body = parseOrThrow(bodySchema, ctx.request.body || {});
      try {
        ctx.body = { data: await service(strapi, 'ai').run({ action, ...body }, ctx.state.user) };
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },
  };
};

module.exports.sendProviderError = sendProviderError;

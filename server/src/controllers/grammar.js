'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, localeSchema, errors } = require('../utils/validation');
const { resolveEditorField } = require('../utils/editor-fields');
const { segmentsSchema, targetSchema } = require('./ai');

const checkSchema = z.strictObject({
  target: targetSchema,
  segments: segmentsSchema,
  locale: localeSchema.nullish(),
});

const MESSAGES = {
  DISABLED: [503, 'The grammar check is turned off'],
  NOT_CONFIGURED: [503, 'The grammar check is not configured'],
  AUTH_FAILED: [502, 'LanguageTool rejected the credentials'],
  PROVIDER_RATE_LIMIT: [503, 'LanguageTool is busy. Try again later.'],
  TIMEOUT: [504, 'LanguageTool did not answer in time'],
  TOO_LONG: [413, 'The text is too long for LanguageTool'],
};

/**
 * Maps LanguageTool errors to fixed responses with a machine code.
 * @param {object} ctx - Koa context.
 * @param {Error & { code?: string }} error - Error.
 * @returns {boolean} True when handled.
 */
const sendGrammarError = (ctx, error) => {
  if (!error || error.message !== 'Grammar check unavailable') return false;
  const [status, message] = MESSAGES[error.code] || [502, 'LanguageTool is not available'];
  ctx.status = status;
  ctx.body = {
    data: null,
    error: {
      status,
      name: 'GrammarProviderError',
      message,
      details: { code: error.code || 'PROVIDER_ERROR' },
    },
  };
  return true;
};

module.exports = ({ strapi }) => ({
  /**
   * @route POST /magic-editor-x/grammar/check { target: { uid, field }, segments: [{ blockId, path, html }], locale? }
   * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.grammar.use
   * @returns {{ data: { language: string, matches: Array<{ blockId, path, offset, length, text, message, shortMessage, replacements, rule }>, truncated: boolean } }} Matches; offsets count characters of the string's plain text.
   * @throws {errors.NotFoundError} Unknown content type or field (404).
   * @sideeffect Sends the plain text of the strings to the LanguageTool server the owner configured. Text is never logged.
   */
  async check(ctx) {
    const input = parseOrThrow(checkSchema, ctx.request.body || {});
    const contentType = strapi.contentType(input.target.uid);
    if (!contentType || !resolveEditorField(strapi, contentType, input.target.field))
      throw new errors.NotFoundError('Not found');
    try {
      ctx.body = {
        data: await service(strapi, 'grammar').check(
          { segments: input.segments, locale: input.locale || null },
          ctx.state.user
        ),
      };
    } catch (error) {
      if (!sendGrammarError(ctx, error)) throw error;
    }
  },
});

module.exports.sendGrammarError = sendGrammarError;

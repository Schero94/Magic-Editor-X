'use strict';

const { service, recordAudit } = require('./helpers');
const { fieldIdentity } = require('../../../shared/audit.mjs');
const { z, parseOrThrow, uidSchema, fieldPathSchema, localeSchema, errors } = require('../utils/validation');
const {
  BLOCK_ID_PATTERN,
  SEGMENT_PATH_PATTERN,
  MAX_SEGMENTS,
  MAX_SEGMENT_HTML,
} = require('../../../shared/ai-fields.mjs');
const { resolveEditorField } = require('../utils/editor-fields');
const { resolveFieldPreset } = require('../../../shared/presets.mjs');

const bodySchema = z.strictObject({
  text: z.string().min(1).max(60000),
  language: z.string().max(40).optional(),
  tone: z.string().max(40).optional(),
  // The field the text comes from: field presets can turn the assistant off per field.
  target: z.strictObject({ uid: uidSchema, field: fieldPathSchema }),
});

const targetSchema = z.strictObject({ uid: uidSchema, field: fieldPathSchema });

/** Inline text strings of a field (2.3 whole-field actions and the grammar check). */
const segmentsSchema = z
  .array(
    z.strictObject({
      blockId: z.string().regex(BLOCK_ID_PATTERN),
      path: z.string().max(200).regex(SEGMENT_PATH_PATTERN),
      html: z.string().max(MAX_SEGMENT_HTML),
    })
  )
  .min(1)
  .max(MAX_SEGMENTS)
  .refine((list) => new Set(list.map((item) => `${item.blockId}|${item.path}`)).size === list.length, {
    message: 'Each block path may appear once',
  });

const altTextSchema = z.strictObject({
  target: targetSchema,
  fileId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  locale: localeSchema.nullish(),
});

const fieldActionSchema = z.strictObject({
  target: targetSchema,
  segments: segmentsSchema,
  language: z.string().max(40).optional(),
});

/**
 * Resolves the field target and refuses fields whose preset turns AI off.
 * @param {object} strapi - Strapi.
 * @param {{ uid: string, field: string }} target - Field.
 * @returns {object} Resolved field.
 * @throws {errors.NotFoundError|errors.ForbiddenError} Unknown field (404), AI off (403).
 */
const resolveAiField = (strapi, target) => {
  const contentType = strapi.contentType(target.uid);
  const resolved = contentType ? resolveEditorField(strapi, contentType, target.field) : null;
  if (!resolved) throw new errors.NotFoundError('Not found');
  if (!resolveFieldPreset(resolved.attribute.options).ai)
    throw new errors.ForbiddenError('The AI assistant is turned off for this field');
  return resolved;
};

const MESSAGES = {
  DISABLED: [503, 'The AI assistant is turned off'],
  NOT_CONFIGURED: [503, 'The AI assistant is not configured'],
  NO_API_KEY: [503, 'The AI provider key is missing'],
  AUTH_FAILED: [502, 'The AI provider rejected the key'],
  PROVIDER_RATE_LIMIT: [503, 'The AI provider is busy. Try again later.'],
  TIMEOUT: [504, 'The AI provider did not answer in time'],
  REFUSED: [422, 'The AI provider declined this request'],
  IMAGES_DISABLED: [503, 'Sending images to the AI provider is turned off'],
  FIELD_ACTIONS_DISABLED: [503, 'Whole-field AI actions are turned off'],
  BAD_RESPONSE: [502, 'The AI provider answered in an unexpected format'],
};

const IMAGE_MESSAGES = {
  IMAGE_UNSUPPORTED: [415, 'This image format cannot be described (JPEG, PNG, GIF or WebP only)'],
  IMAGE_TOO_LARGE: [413, 'The image is too large to send'],
  IMAGE_UNREADABLE: [404, 'The image file could not be read'],
};

/**
 * Maps provider errors to fixed responses with a machine code.
 * @param {object} ctx - Koa context.
 * @param {Error & { code?: string }} error - Error.
 * @returns {boolean} True when handled.
 */
const sendProviderError = (ctx, error) => {
  if (error && error.message === 'Image not usable' && IMAGE_MESSAGES[error.code]) {
    const [status, message] = IMAGE_MESSAGES[error.code];
    ctx.status = status;
    ctx.body = {
      data: null,
      error: { status, name: 'AIImageError', message, details: { code: error.code } },
    };
    return true;
  }
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
        await recordAudit(strapi, {
          event: 'ai.action',
          target: { uid: target.uid, field: fieldIdentity(target.field) },
          counts: { segments: 1 },
          meta: { action },
        });
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },

    /**
     * @route POST /magic-editor-x/ai/image/alt-text { target: { uid, field }, fileId, locale? }
     * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.ai.use; Media Library read on the file (404 otherwise)
     * @returns {{ data: { text: string } }} Suggested alternative text (plain text, at most 150 characters). Never applied by the server.
     * @throws {errors.NotFoundError} Unknown field, missing or unreadable file (404).
     * @throws {errors.ForbiddenError} The field's options turn the assistant off (403).
     * @sideeffect Sends the image (a stored format of at most 1568 px, 3.5 MB) to the owner's AI provider when "Send images" is on. Neither bytes nor URLs are logged.
     */
    async altText(ctx) {
      const input = parseOrThrow(altTextSchema, ctx.request.body || {});
      resolveAiField(strapi, input.target);
      try {
        ctx.body = {
          data: await service(strapi, 'ai').altText(
            { fileId: input.fileId, locale: input.locale || null, userAbility: ctx.state.userAbility },
            ctx.state.user
          ),
        };
        await recordAudit(strapi, {
          event: 'ai.action',
          target: { uid: input.target.uid, field: fieldIdentity(input.target.field) },
          counts: { images: 1 },
          meta: { action: 'alt-text' },
        });
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },

    /**
     * @route POST /magic-editor-x/ai/field/:action { target, segments: [{ blockId, path, html }], language? } (action: translate | summarize)
     * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.ai.use
     * @returns {{ data: { segments: Array<{ blockId, path, html }> } | { text: string } }} Translation of the same segments (sanitised) or a plain-text summary.
     * @throws {errors.NotFoundError} Unknown action or field (404).
     * @throws {errors.ForbiddenError} The field's options turn the assistant off (403).
     * @throws {errors.PayloadTooLargeError} Text over `maxInputChars` (413).
     * @sideeffect Sends the inline text strings of the field to the owner's AI provider when "Allow whole-field AI actions" is on. Content is never logged.
     */
    async field(ctx) {
      const action = String(ctx.params.action || '');
      const input = parseOrThrow(fieldActionSchema, ctx.request.body || {});
      resolveAiField(strapi, input.target);
      try {
        ctx.body = {
          data: await service(strapi, 'ai').fieldAction(
            { action, segments: input.segments, language: input.language },
            ctx.state.user
          ),
        };
        await recordAudit(strapi, {
          event: 'ai.action',
          target: { uid: input.target.uid, field: fieldIdentity(input.target.field) },
          counts: { segments: input.segments.length },
          meta: { action: `field-${action}` },
        });
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },
  };
};

module.exports.sendProviderError = sendProviderError;
module.exports.segmentsSchema = segmentsSchema;
module.exports.targetSchema = targetSchema;

'use strict';

const { service, recordAudit, positionalReadOnly } = require('./helpers');
const { fieldIdentity } = require('../../../shared/audit.mjs');
const {
  z,
  parseOrThrow,
  uidSchema,
  fieldPathSchema,
  fieldTargetSchema,
  localeSchema,
  errors,
} = require('../utils/validation');
const {
  BLOCK_ID_PATTERN,
  SEGMENT_PATH_PATTERN,
  MAX_SEGMENTS,
  MAX_SEGMENT_HTML,
  collectSegments,
} = require('../../../shared/ai-fields.mjs');
const { resolveEditorField } = require('../utils/editor-fields');
const { resolveFieldPreset, allowedInlineTags } = require('../../../shared/presets.mjs');
const {
  ACTION_KEY_PATTERN,
  ACTION_SCOPES,
  MAX_AI_REVIEW_SUGGESTIONS,
  MAX_INSTRUCTION_CHARS,
  MAX_REVIEW_BLOCKS,
  isAiActionAllowed,
  reviewProposals,
} = require('../../../shared/ai-actions.mjs');
const { blockHash, MAX_PROPOSED_CHARS } = require('../../../shared/suggestions.mjs');
const { canonicalJson } = require('../../../shared/diff.mjs');

/** 2.9: "Ask AI…" instruction (cleaned again in the service) and owner-defined action keys. */
const instructionSchema = z.string().max(MAX_INSTRUCTION_CHARS);
const actionKeySchema = z.string().regex(ACTION_KEY_PATTERN);

const bodySchema = z.strictObject({
  text: z.string().min(1).max(60000),
  language: z.string().max(40).optional(),
  tone: z.string().max(40).optional(),
  instruction: instructionSchema.optional(),
  actionKey: actionKeySchema.optional(),
  // The field the text comes from: field presets can turn the assistant off per field.
  target: z.strictObject({ uid: uidSchema, field: fieldPathSchema }),
});

const targetSchema = z.strictObject({ uid: uidSchema, field: fieldPathSchema });

const segmentSchema = z.strictObject({
  blockId: z.string().regex(BLOCK_ID_PATTERN),
  path: z.string().max(200).regex(SEGMENT_PATH_PATTERN),
  html: z.string().max(MAX_SEGMENT_HTML),
});

/**
 * Segment list with each block path once.
 * @param {number} max - Most segments.
 * @returns {import('zod').ZodType} Schema.
 */
const segmentListSchema = (max) =>
  z
    .array(segmentSchema)
    .min(1)
    .max(max)
    .refine((list) => new Set(list.map((item) => `${item.blockId}|${item.path}`)).size === list.length, {
      message: 'Each block path may appear once',
    });

/** Inline text strings of a field (2.3 whole-field actions and the grammar check). */
const segmentsSchema = segmentListSchema(MAX_SEGMENTS);

/** Most segments of one block action (2.4). */
const MAX_BLOCK_SEGMENTS = 200;

const altTextSchema = z.strictObject({
  target: targetSchema,
  fileId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  locale: localeSchema.nullish(),
});

const blockActionSchema = z.strictObject({
  target: targetSchema,
  segments: segmentListSchema(MAX_BLOCK_SEGMENTS),
  language: z.string().max(40).optional(),
  tone: z.string().max(40).optional(),
  instruction: instructionSchema.optional(),
  actionKey: actionKeySchema.optional(),
});

const fieldActionSchema = z.strictObject({
  target: targetSchema,
  segments: segmentsSchema,
  language: z.string().max(40).optional(),
  actionKey: actionKeySchema.optional(),
});

/** 2.9: a block as the editor shows it (normalised); content is checked again before it is stored. */
const reviewBlockSchema = z.strictObject({
  id: z.string().regex(BLOCK_ID_PATTERN),
  type: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  data: z.record(z.string().max(100), z.unknown()),
  tunes: z.record(z.string().max(100), z.unknown()).optional(),
});

/** 2.9 AI review: the field (document, locale, identity), where it runs and the blocks to review. */
const reviewSchema = fieldTargetSchema.extend({
  scope: z.enum(ACTION_SCOPES),
  actionKey: actionKeySchema.optional(),
  blocks: z
    .array(reviewBlockSchema)
    .min(1)
    .max(MAX_REVIEW_BLOCKS)
    .refine((list) => new Set(list.map((block) => block.id)).size === list.length, {
      message: 'Each block may appear once',
    }),
});

/**
 * Key of the action a request runs, for the field preset's allow-list (`aiActions`).
 * @param {string} action - Route action.
 * @param {string|undefined} actionKey - Owner-defined action key.
 * @returns {string} Key.
 */
const actionKeyOf = (action, actionKey) => (action === 'custom' ? actionKey || '' : action);

/**
 * Resolves the field target and refuses fields whose preset turns AI off.
 * @param {object} strapi - Strapi.
 * @param {{ uid: string, field: string }} target - Field.
 * @returns {object} Resolved field.
 * @throws {errors.NotFoundError|errors.ForbiddenError} Unknown field (404), AI off (403).
 */
const resolveAiField = (strapi, target, key) => {
  const contentType = strapi.contentType(target.uid);
  const resolved = contentType ? resolveEditorField(strapi, contentType, target.field) : null;
  if (!resolved) throw new errors.NotFoundError('Not found');
  const preset = resolveFieldPreset(resolved.attribute.options);
  if (!preset.ai) throw new errors.ForbiddenError('The AI assistant is turned off for this field');
  // 2.9: a field preset may list the actions it offers (`aiActions`); others answer 403.
  if (key !== undefined && !isAiActionAllowed(preset, key))
    throw new errors.ForbiddenError('This AI action is turned off for this field');
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
  NO_STYLE_GUIDE: [409, 'No style guide is set'],
  BAD_RESPONSE: [502, 'The AI provider answered in an unexpected format'],
  RESPONSE_TOO_LARGE: [502, 'The AI provider answer is too large'],
  UNREACHABLE: [502, 'The AI provider could not be reached'],
  EMPTY: [502, 'The AI provider returned an empty answer'],
  PROVIDER_ERROR: [502, 'The AI provider answered with an error'],
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
     * @returns {{ data: { text: string } }} Suggested replacement (sanitised inline HTML; 2.4: only the field
     *   preset's inline tags and no links the selection did not hold).
     * @throws {errors.NotFoundError} Unknown content type or field (404).
     * @throws {errors.ForbiddenError} The field's options turn the assistant off (403).
     * @sideeffect Sends the text to the owner's AI provider. Text is never logged.
     */
    async run(ctx) {
      const action = String(ctx.params.action || '');
      const { target, ...body } = parseOrThrow(bodySchema, ctx.request.body || {});
      const resolved = resolveAiField(strapi, target, actionKeyOf(action, body.actionKey));
      const inlineTags = allowedInlineTags(resolveFieldPreset(resolved.attribute.options));
      try {
        ctx.body = {
          data: await service(strapi, 'ai').run({ action, ...body, inlineTags }, ctx.state.user),
        };
        await recordAudit(strapi, {
          event: 'ai.action',
          target: { uid: target.uid, field: fieldIdentity(target.field) },
          counts: { segments: 1 },
          meta: { action: action === 'custom' ? `custom-${body.actionKey}` : action },
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
      const resolved = resolveAiField(strapi, input.target, actionKeyOf(action, input.actionKey));
      try {
        ctx.body = {
          data: await service(strapi, 'ai').fieldAction(
            {
              action,
              segments: input.segments,
              language: input.language,
              actionKey: input.actionKey,
              inlineTags: allowedInlineTags(resolveFieldPreset(resolved.attribute.options)),
            },
            ctx.state.user
          ),
        };
        await recordAudit(strapi, {
          event: 'ai.action',
          target: { uid: input.target.uid, field: fieldIdentity(input.target.field) },
          counts: { segments: input.segments.length },
          meta: { action: action === 'custom' ? `field-custom-${input.actionKey}` : `field-${action}` },
        });
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },

    /**
     * @route POST /magic-editor-x/ai/blocks/:action { target, segments: [{ blockId, path, html }] (1-200), language?, tone? } (action: improve | shorten | translate | tone)
     * @auth admin; plugin::magic-editor-x.access + plugin::magic-editor-x.ai.use
     * @returns {{ data: { segments: Array<{ blockId, path, html }> } }} The same segments, rewritten; sanitised for the
     *   field preset's inline tags, links the original string did not hold unwrapped.
     * @throws {errors.NotFoundError} Unknown action or field (404).
     * @throws {errors.ForbiddenError} The field's options turn the assistant off (403).
     * @throws {errors.PayloadTooLargeError} Text over `maxInputChars` (413).
     * @sideeffect Sends the inline text strings of the chosen blocks to the owner's AI provider. Content is never logged.
     */
    async blocks(ctx) {
      const action = String(ctx.params.action || '');
      const input = parseOrThrow(blockActionSchema, ctx.request.body || {});
      const resolved = resolveAiField(strapi, input.target, actionKeyOf(action, input.actionKey));
      try {
        ctx.body = {
          data: await service(strapi, 'ai').blockAction(
            {
              action,
              segments: input.segments,
              language: input.language,
              tone: input.tone,
              instruction: input.instruction,
              actionKey: input.actionKey,
              inlineTags: allowedInlineTags(resolveFieldPreset(resolved.attribute.options)),
            },
            ctx.state.user
          ),
        };
        await recordAudit(strapi, {
          event: 'ai.action',
          target: { uid: input.target.uid, field: fieldIdentity(input.target.field) },
          counts: { segments: input.segments.length },
          blockIds: [...new Set(input.segments.map((segment) => segment.blockId))],
          meta: { action: action === 'custom' ? `custom-${input.actionKey}` : action },
        });
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
      }
    },

    /**
     * 2.9 AI review: the AI reviews the sent blocks and every block whose text it would change
     * becomes an `update` suggestion in the Suggestions panel (author: the requesting admin,
     * marked as made by AI). Nothing in the field changes. At most MAX_AI_REVIEW_SUGGESTIONS per
     * run (the rest is reported as `capped`); an identical open suggestion for the same block
     * version is not created again (`duplicates`); a proposal that breaks the field preset is
     * dropped (`invalid`).
     * @route POST /magic-editor-x/ai/review/:kind { uid, documentId, locale?, field, fieldKey?, scope, actionKey?, blocks } (kind: proofread | clarity | style-guide | custom)
     * @auth admin; access + ai.use + suggestions.create; CM read on the document, locale and field (404 otherwise)
     * @returns 201 (200 when nothing was stored) `{ data: [suggestion], meta: { created, updated, duplicates, capped, invalid, blocks } }`
     * @throws 400 invalid input or block, 403 AI off for the field or action not in its `aiActions`, 404 unknown
     *   kind, action, field or document, or suggestions off; 409 `FIELD_KEY_REQUIRED`, `NO_STYLE_GUIDE`; 413 text
     *   over `maxInputChars`; 429 suggestion or AI rate limit; provider errors as for the other AI routes.
     * @sideeffect Sends the inline text strings of the blocks to the owner's AI provider; stores suggestion rows.
     *   Content is never logged; the audit trail gets ids and counts only.
     */
    async review(ctx) {
      if (strapi.config.get('plugin::magic-editor-x.suggestions.enabled') === false)
        throw new errors.NotFoundError('Not found');
      const kind = String(ctx.params.kind || '');
      const input = parseOrThrow(reviewSchema, ctx.request.body || {});
      const key = actionKeyOf(kind, input.actionKey);
      const resolved = resolveAiField(strapi, { uid: input.uid, field: input.field }, key);
      for (const block of input.blocks)
        if (canonicalJson(block).length > MAX_PROPOSED_CHARS)
          throw new errors.ValidationError('A block is too large', {
            code: 'SUGGESTION_TOO_LARGE',
            blockIds: [block.id],
          });
      const check = await service(strapi, 'access').checkField({
        userAbility: ctx.state.userAbility,
        uid: input.uid,
        documentId: input.documentId,
        locale: input.locale || null,
        field: input.field,
        ...(input.fieldKey ? { fieldKey: input.fieldKey } : {}),
      });
      if (!check.fieldName) return positionalReadOnly(ctx, 'FIELD_KEY_REQUIRED');
      const target = {
        uid: input.uid,
        documentId: input.documentId,
        locale: check.locale,
        field: check.fieldName,
        path: input.field,
      };
      const segments = collectSegments({ blocks: input.blocks });
      const meta = {
        created: 0,
        updated: 0,
        duplicates: 0,
        capped: 0,
        invalid: 0,
        blocks: input.blocks.length,
      };
      if (!segments.length) {
        ctx.body = { data: [], meta };
        return undefined;
      }
      // One suggestion request per run, counted before the provider is asked.
      await service(strapi, 'suggestions').checkRate(ctx.state.user.id);
      const inlineTags = allowedInlineTags(resolveFieldPreset(resolved.attribute.options));
      let reviewed;
      try {
        reviewed = await service(strapi, 'ai').review(
          { kind, actionKey: input.actionKey, scope: input.scope, segments, inlineTags },
          ctx.state.user
        );
      } catch (error) {
        if (!sendProviderError(ctx, error)) throw error;
        return undefined;
      }
      const proposals = reviewProposals(input.blocks, segments, reviewed.segments);
      meta.capped = Math.max(0, proposals.length - MAX_AI_REVIEW_SUGGESTIONS);
      const items = proposals.slice(0, MAX_AI_REVIEW_SUGGESTIONS).map((proposal) => ({
        op: 'update',
        blockId: proposal.blockId,
        proposed: proposal.proposed,
        baseHash: blockHash(proposal.base),
      }));
      let stored = { suggestions: [], created: 0, updated: 0, duplicates: 0, invalid: 0 };
      if (items.length)
        stored = await service(strapi, 'suggestions').create(
          target,
          { suggestions: items, note: null },
          ctx.state.user,
          {
            origin: `ai:${key}`,
            skipIdentical: true,
            dropInvalid: true,
          }
        );
      Object.assign(meta, {
        created: stored.created,
        updated: stored.updated,
        duplicates: stored.duplicates || 0,
        invalid: stored.invalid || 0,
      });
      const auditTarget = {
        uid: input.uid,
        documentId: input.documentId,
        locale: check.locale,
        field: check.fieldName,
      };
      await recordAudit(strapi, {
        event: 'ai.action',
        target: auditTarget,
        counts: { segments: segments.length, suggestions: stored.suggestions.length },
        blockIds: items.slice(0, 20).map((item) => item.blockId),
        meta: { action: `review-${key}` },
      });
      if (stored.created || stored.updated)
        await recordAudit(strapi, {
          event: 'suggestion.create',
          target: auditTarget,
          counts: {
            suggestions: stored.suggestions.length,
            created: stored.created,
            updated: stored.updated,
            updates: stored.suggestions.length,
            inserts: 0,
            deletes: 0,
          },
          blockIds: stored.suggestions.slice(0, 20).map((item) => item.blockId),
          meta: { origin: 'ai', action: key },
        });
      ctx.status = stored.created || stored.updated ? 201 : 200;
      ctx.body = { data: stored.suggestions, meta };
      return undefined;
    },
  };
};

module.exports.sendProviderError = sendProviderError;
module.exports.blockActionSchema = blockActionSchema;
module.exports.segmentsSchema = segmentsSchema;
module.exports.targetSchema = targetSchema;
module.exports.reviewSchema = reviewSchema;

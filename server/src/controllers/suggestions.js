'use strict';

const { errors } = require('@strapi/utils');
const { ACTIONS } = require('../permissions');
const { service, identityTarget, positionalReadOnly, recordAudit } = require('./helpers');
const { z, parseOrThrow, fieldTargetSchema, documentIdSchema } = require('../utils/validation');
const { BLOCK_ID_PATTERN } = require('../../../shared/comments.mjs');
const {
  BLOCK_HASH_PATTERN,
  MAX_SUGGESTIONS_PER_REQUEST,
  MAX_SUGGESTION_NOTE_LENGTH,
} = require('../../../shared/suggestions.mjs');

const blockIdSchema = z.string().regex(BLOCK_ID_PATTERN);

/** A proposed block; its content is normalised, sanitised and checked by the service. */
const proposedSchema = z.strictObject({
  id: blockIdSchema.optional(),
  type: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  data: z.record(z.string().max(100), z.unknown()),
  tunes: z.record(z.string().max(100), z.unknown()).optional(),
});

const itemSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('update'),
    blockId: blockIdSchema,
    proposed: proposedSchema,
    baseHash: z.string().regex(BLOCK_HASH_PATTERN),
  }),
  z.strictObject({
    op: z.literal('insert'),
    blockId: blockIdSchema,
    afterBlockId: blockIdSchema.nullable(),
    proposed: proposedSchema,
  }),
  z.strictObject({
    op: z.literal('delete'),
    blockId: blockIdSchema,
    baseHash: z.string().regex(BLOCK_HASH_PATTERN),
  }),
]);

const createSchema = fieldTargetSchema.extend({
  suggestions: z.array(itemSchema).min(1).max(MAX_SUGGESTIONS_PER_REQUEST),
  note: z
    .string()
    .max(MAX_SUGGESTION_NOTE_LENGTH * 2)
    .nullish(),
});
const listSchema = fieldTargetSchema.extend({ status: z.enum(['open', 'all']).optional() });
const idSchema = z.strictObject({ id: documentIdSchema });
const decideSchema = z.strictObject({ outdated: z.boolean().optional() });

/**
 * Block suggestions (2.4). Listing needs `access` plus `suggestions.create` or
 * `suggestions.review`; suggesting needs `suggestions.create` and Content
 * Manager read on the document, locale and field (no update right: reviewers
 * suggest); accepting and rejecting need `suggestions.review` and Content
 * Manager update. Every handler checks Content Manager read first and answers
 * 404 otherwise (also for suggestion ids of other documents). Handlers log nothing.
 */
module.exports = ({ strapi }) => {
  const access = () => service(strapi, 'access');
  const suggestions = () => service(strapi, 'suggestions');

  /** 404 when the owner turned suggestions off (`suggestions.enabled: false`). */
  const ensureEnabled = () => {
    if (strapi.config.get('plugin::magic-editor-x.suggestions.enabled') === false) {
      throw new errors.NotFoundError('Not found');
    }
  };

  /**
   * Suggestion rights of the caller (RBAC only).
   * @param {object} ctx - Koa context.
   * @returns {{ canCreate: boolean, canReview: boolean }} Rights.
   */
  const rights = (ctx) => {
    const can = (action) => {
      try {
        return Boolean(ctx.state.userAbility && ctx.state.userAbility.can(action));
      } catch {
        return false;
      }
    };
    return { canCreate: can(ACTIONS.suggestionsCreate), canReview: can(ACTIONS.suggestionsReview) };
  };

  /**
   * Loads a suggestion and checks that the caller can read its document and field.
   * @param {object} ctx - Koa context.
   * @returns {Promise<{ row: object, check: object }>} Row and the access check.
   * @throws {errors.NotFoundError} Missing suggestion or no read access.
   */
  const loadReadable = async (ctx) => {
    const { id } = parseOrThrow(idSchema, { id: ctx.params.id });
    const { row, target } = await suggestions().findTarget(id);
    const check = await access().checkField({
      userAbility: ctx.state.userAbility,
      ...identityTarget(target),
    });
    // The identity must still be the one stored (a deleted key answers 404 in checkField).
    if (check.fieldName !== row.fieldName) throw new errors.NotFoundError('Not found');
    return { row, check };
  };

  /**
   * Audit event of a suggestion action: ids and counts only, never content.
   * @param {string} event - Event name.
   * @param {object} row - Suggestion row.
   * @param {object} [extra] - counts/meta.
   * @returns {Promise<boolean>} Stored.
   */
  const auditSuggestion = (event, row, extra = {}) =>
    recordAudit(strapi, {
      event,
      target: {
        uid: row.contentType,
        documentId: row.entryId,
        locale: row.entryLocale || null,
        field: row.fieldName,
      },
      blockIds: row.blockId ? [row.blockId] : [],
      meta: { suggestionId: row.documentId, op: row.op, ...(extra.meta || {}) },
      ...(extra.counts ? { counts: extra.counts } : {}),
    });

  /**
   * Accept or reject.
   * @param {object} ctx - Koa context.
   * @param {'accepted'|'rejected'} status - Decision.
   * @returns {Promise<undefined>} Nothing (response set).
   */
  const decide = async (ctx, status) => {
    ensureEnabled();
    const { outdated } = parseOrThrow(decideSchema, ctx.request.body || {});
    const { row, check } = await loadReadable(ctx);
    if (!check.canUpdate) throw new errors.ForbiddenError('You cannot change this entry');
    if (row.status !== 'open')
      return ctx.conflict('This suggestion was already decided', { code: 'ALREADY_DECIDED' });
    const decided = await suggestions().decide(row, status, ctx.state.user);
    if (!decided) return ctx.conflict('This suggestion was already decided', { code: 'ALREADY_DECIDED' });
    await auditSuggestion(status === 'accepted' ? 'suggestion.accept' : 'suggestion.reject', row, {
      counts: { outdated: outdated ? 1 : 0 },
    });
    ctx.body = { data: decided };
    return undefined;
  };

  return {
    /**
     * Suggestions of one field (open ones by default) with counts and the caller's rights.
     * @route GET /magic-editor-x/suggestions?uid&documentId&locale&field&fieldKey?&status?
     * @auth admin; plugin::magic-editor-x.access + (suggestions.create or suggestions.review); CM read on the
     *   document, locale and field
     * @returns {{ data: Array<object>, meta: { counts: { open, accepted, rejected }, canCreate: boolean, canReview: boolean, fieldKey: string|null } }}
     *   Suggestions, oldest first. `canReview` also needs CM update; `canCreate` needs a field identity.
     * @throws 400 invalid query, 403 neither action, 404 unknown field or document not readable.
     */
    async list(ctx) {
      ensureEnabled();
      const { status, ...target } = parseOrThrow(listSchema, {
        ...ctx.query,
        locale: ctx.query.locale || null,
      });
      const { canCreate, canReview } = rights(ctx);
      if (!canCreate && !canReview) throw new errors.ForbiddenError('Forbidden');
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.fieldName) {
        // Positional field without a stored key: nothing to show and nothing can be suggested yet.
        ctx.body = {
          data: [],
          meta: {
            counts: { open: 0, accepted: 0, rejected: 0 },
            canCreate: false,
            canReview: false,
            fieldKey: null,
          },
        };
        return;
      }
      const { suggestions: data, counts } = await suggestions().list(
        { uid: target.uid, documentId: target.documentId, locale: result.locale, field: result.fieldName },
        ctx.state.user.id,
        { status: status || 'open' }
      );
      ctx.body = {
        data,
        meta: {
          counts,
          canCreate,
          canReview: canReview && result.canUpdate,
          fieldKey: result.fieldKey || null,
        },
      };
    },

    /**
     * Suggests changes to blocks: one suggestion per item. An open suggestion of the caller for the
     * same block and operation is replaced.
     * @route POST /magic-editor-x/suggestions { uid, documentId, locale?, field, fieldKey?, note?, suggestions: [{ op, blockId, afterBlockId?, proposed?, baseHash? }] }
     * @auth admin; access + suggestions.create; CM read on the document, locale and field (no update right needed)
     * @returns 201 `{ data: [suggestion], meta: { created, updated } }`
     * @throws 400 invalid input, invalid block, preset violation (`PRESET_VIOLATION`, block ids and rule codes),
     *   too many open suggestions; 404 not readable; 409 `FIELD_KEY_REQUIRED`; 429 per-admin limit
     *   (`suggestions.perMinute`).
     * @sideeffect Inserts or updates suggestion rows.
     */
    async create(ctx) {
      ensureEnabled();
      const { suggestions: items, note, ...target } = parseOrThrow(createSchema, ctx.request.body || {});
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.fieldName) return positionalReadOnly(ctx, 'FIELD_KEY_REQUIRED');
      await suggestions().checkRate(ctx.state.user.id);
      const stored = await suggestions().create(
        {
          uid: target.uid,
          documentId: target.documentId,
          locale: result.locale,
          field: result.fieldName,
          path: target.field,
        },
        { suggestions: items, note },
        ctx.state.user
      );
      const counts = { suggestions: items.length, created: stored.created, updated: stored.updated };
      for (const op of ['update', 'insert', 'delete'])
        counts[`${op}s`] = items.filter((item) => item.op === op).length;
      await recordAudit(strapi, {
        event: 'suggestion.create',
        target: {
          uid: target.uid,
          documentId: target.documentId,
          locale: result.locale,
          field: result.fieldName,
        },
        counts,
        blockIds: items.slice(0, 20).map((item) => item.blockId),
      });
      ctx.status = 201;
      ctx.body = { data: stored.suggestions, meta: { created: stored.created, updated: stored.updated } };
      return undefined;
    },

    /**
     * Marks an open suggestion accepted. The editor applies the proposed block through its normal
     * path (shared document, one undo step) after this call; the normal save stores it.
     * @route POST /magic-editor-x/suggestions/:id/accept { outdated?: boolean }
     * @auth admin; access + suggestions.review; CM read and update on the document, locale and field
     * @returns `{ data: suggestion }`
     * @throws 403 no update right, 404 missing or not readable, 409 `ALREADY_DECIDED`.
     * @sideeffect Updates the suggestion's status.
     */
    async accept(ctx) {
      return decide(ctx, 'accepted');
    },

    /**
     * @route POST /magic-editor-x/suggestions/:id/reject
     * @auth admin; access + suggestions.review; CM read and update on the document, locale and field
     * @returns `{ data: suggestion }`
     * @throws 403 no update right, 404 missing or not readable, 409 `ALREADY_DECIDED`.
     * @sideeffect Updates the suggestion's status.
     */
    async reject(ctx) {
      return decide(ctx, 'rejected');
    },

    /**
     * Withdraws the caller's own open suggestion (deletes it).
     * @route DELETE /magic-editor-x/suggestions/:id
     * @auth admin; access + suggestions.create; CM read; author only
     * @returns `{ data: { id } }`
     * @throws 403 not the author, 404 missing or not readable, 409 `ALREADY_DECIDED`.
     * @sideeffect Deletes the row.
     */
    async withdraw(ctx) {
      ensureEnabled();
      const { row } = await loadReadable(ctx);
      if (row.status !== 'open')
        return ctx.conflict('This suggestion was already decided', { code: 'ALREADY_DECIDED' });
      const removed = await suggestions().withdraw(row, ctx.state.user);
      if (!removed) return ctx.conflict('This suggestion was already decided', { code: 'ALREADY_DECIDED' });
      await auditSuggestion('suggestion.withdraw', row);
      ctx.body = { data: { id: row.documentId } };
      return undefined;
    },
  };
};

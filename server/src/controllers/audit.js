'use strict';

const { ACTIONS } = require('../permissions');
const { service } = require('./helpers');
const {
  z,
  errors,
  parseOrThrow,
  uidSchema,
  documentIdSchema,
  localeSchema,
  fieldPathSchema,
} = require('../utils/validation');
const {
  AUDIT_EVENT_PATTERN,
  BLOCK_ID_PATTERN,
  MAX_AUDIT_PAGE_SIZE,
  fieldIdentity,
} = require('../../../shared/audit.mjs');

/** ISO 8601 date or date-time (bounded), turned into epoch milliseconds. */
const timeSchema = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/)
  .transform((value, ctx) => {
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid date' });
      return z.NEVER;
    }
    return time;
  });

/** GET /audit query (strict, bounded). */
const listSchema = z
  .strictObject({
    uid: uidSchema.optional(),
    documentId: documentIdSchema.optional(),
    locale: localeSchema.optional(),
    field: fieldPathSchema.optional(),
    fieldKey: z.string().regex(BLOCK_ID_PATTERN).optional(),
    actor: z.coerce.number().int().min(1).max(2147483647).optional(),
    event: z.string().max(64).regex(AUDIT_EVENT_PATTERN).optional(),
    from: timeSchema.optional(),
    to: timeSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_AUDIT_PAGE_SIZE).default(25),
  })
  .superRefine((value, ctx) => {
    if (value.field && !(value.uid && value.documentId))
      ctx.addIssue({ code: 'custom', path: ['field'], message: 'A field needs uid and documentId' });
    if (value.fieldKey && !value.field)
      ctx.addIssue({ code: 'custom', path: ['fieldKey'], message: 'A field key needs a field' });
    if (value.documentId && !value.uid)
      ctx.addIssue({ code: 'custom', path: ['documentId'], message: 'A document needs a uid' });
    if (value.from && value.to && value.from > value.to)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end is before the start' });
  });

/**
 * Can the caller do `action`?
 * @param {object} ctx - Koa context.
 * @param {string} action - Action id.
 * @returns {boolean} Result.
 */
const can = (ctx, action) => {
  try {
    return Boolean(ctx.state.userAbility && ctx.state.userAbility.can(action));
  } catch {
    return false;
  }
};

/**
 * Audit trail (2.4). Handlers log nothing.
 */
module.exports = ({ strapi }) => ({
  /**
   * @route GET /magic-editor-x/audit?uid&documentId&locale&field&fieldKey&actor&event&from&to&page&pageSize
   * @auth admin; plugin::magic-editor-x.audit.read
   * @access With `field` (and `uid` + `documentId`): Content Manager read on the document, locale and field (services/access.js, 404 otherwise); actors without ids. Without `field` (global listing, also filtered by type or document): also settings.read (403 otherwise); actors with ids.
   * @returns {{ data: object[], meta: { scope: 'field'|'global', pagination: { page, pageSize, pageCount, total } } }} Events, newest first (counts, block ids and identifiers only).
   * @throws {errors.ValidationError} 400 on invalid filters.
   */
  async list(ctx) {
    const input = parseOrThrow(listSchema, ctx.query || {});
    const audit = service(strapi, 'audit');
    const filters = {
      uid: input.uid,
      documentId: input.documentId,
      actorId: input.actor,
      event: input.event,
      from: input.from,
      to: input.to,
    };
    let scope = 'global';
    if (input.field) {
      const access = await service(strapi, 'access').checkField({
        userAbility: ctx.state.userAbility,
        uid: input.uid,
        documentId: input.documentId,
        locale: input.locale || null,
        field: input.field,
      });
      filters.locale = access.locale;
      filters.field = fieldIdentity(input.field, input.fieldKey ? { fieldKey: input.fieldKey } : null);
      scope = 'field';
    } else {
      if (!can(ctx, ACTIONS.settingsRead)) throw new errors.ForbiddenError('Forbidden');
      if (input.locale) filters.locale = input.locale;
    }
    const page = await audit.list(filters, {
      page: input.page,
      pageSize: input.pageSize,
      viewerId: ctx.state.user ? ctx.state.user.id : null,
      withActorIds: scope === 'global',
    });
    ctx.body = {
      data: page.results,
      meta: { scope, pagination: page.pagination, enabled: audit.enabled() },
    };
  },

  /**
   * @route GET /magic-editor-x/audit/actors
   * @auth admin; plugin::magic-editor-x.audit.read + settings.read
   * @returns {{ data: Array<{ id: number, name: string|null }> }} Admins that appear in the trail (max 200).
   */
  async actors(ctx) {
    if (Object.keys(ctx.query || {}).length) throw new errors.ValidationError('Validation failed');
    ctx.body = { data: await service(strapi, 'audit').actors() };
  },
});

module.exports.listSchema = listSchema;

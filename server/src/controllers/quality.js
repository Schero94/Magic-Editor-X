'use strict';

const { errors } = require('@strapi/utils');
const { service } = require('./helpers');
const { parseOrThrow, qualityLinksSchema, fieldTargetSchema } = require('../utils/validation');

/**
 * Link check of the editor's quality panel and the scheduled link check.
 */
module.exports = ({ strapi }) => ({
  /**
   * @route POST /magic-editor-x/quality/links { internal?, media?, external? }
   * @auth admin; plugin::magic-editor-x.access; CM read per type (internal), plugin::upload.read (media)
   * @returns {{ data: { internal: Array<{ uid, documentId, locale, status: 'ok'|'missing'|'draft'|'unknown' }>, media: Array<{ id, status: 'ok'|'missing'|'unknown' }>, external: Array<{ url, status: 'ok'|'broken'|'timeout'|'blocked'|'error'|'skipped', code?: number }> } }} Results in input order.
   * @throws {import('@strapi/utils').errors.ValidationError} 400 on invalid input.
   * @throws {import('@strapi/utils').errors.RateLimitError} 429 when too many external links were checked this minute.
   * @sideeffect Requests external URLs only when qualityChecks.externalLinks.enabled is true. URLs are never logged.
   */
  async links(ctx) {
    const input = parseOrThrow(qualityLinksSchema, ctx.request.body || {});
    ctx.body = {
      data: await service(strapi, 'quality').checkLinks({
        userAbility: ctx.state.userAbility,
        user: ctx.state.user,
        ...input,
      }),
    };
  },

  /**
   * @route GET /magic-editor-x/quality/link-report?uid&documentId&locale&field
   * @auth admin; plugin::magic-editor-x.access; CM read on the document, locale and field (services/access.js)
   * @returns {{ data: { enabled: boolean, lastRun: { finishedAt, complete }|null, draft: object|null, published: object|null } }} Last scheduled result of the field (`draft`/`published`: `{ scannedAt, problems, links: [{ url, status, code?, checkedAt, blockId }] }`).
   * @throws {import('@strapi/utils').errors.ValidationError} 400 on invalid input.
   * @throws {import('@strapi/utils').errors.NotFoundError} 404 when the type, field or document does not exist or cannot be read.
   */
  async linkReport(ctx) {
    const target = parseOrThrow(fieldTargetSchema, { ...ctx.query, locale: ctx.query.locale || null });
    const access = await service(strapi, 'access').checkField({
      userAbility: ctx.state.userAbility,
      ...target,
    });
    ctx.body = {
      data: await service(strapi, 'link-schedule').report({
        uid: target.uid,
        documentId: target.documentId,
        locale: access.locale,
        field: target.field,
      }),
    };
  },

  /**
   * @route GET /magic-editor-x/quality/link-schedule
   * @auth admin; plugin::magic-editor-x.settings.read
   * @returns {{ data: { enabled, scheduled, rule, tz, nextRunAt, maxUrlsPerRun, perMinute, perHostConcurrency, running, lastRun } }} Schedule state, counts only (`running`: any process holds the run lease).
   */
  async scheduleStatus(ctx) {
    if (Object.keys(ctx.query || {}).length) throw new errors.ValidationError('Validation failed');
    ctx.body = { data: await service(strapi, 'link-schedule').status() };
  },

  /**
   * @route POST /magic-editor-x/quality/link-schedule/run
   * @auth admin; plugin::magic-editor-x.settings.read + settings.update
   * @returns {{ data: { started: true } }} 202 when a run started in the background.
   * @throws {import('@strapi/utils').errors.ApplicationError} 400 `details.code: 'DISABLED'` when the schedule is off.
   * @throws {import('@strapi/utils').errors.ApplicationError} 409 `details.code: 'RUNNING'` while a run holds the cluster lease.
   * @sideeffect Starts a scheduled link check now (outgoing requests through the SSRF-safe fetcher, bounded by the schedule limits).
   */
  async runSchedule(ctx) {
    const body = ctx.request.body;
    if (body && typeof body === 'object' && Object.keys(body).length)
      throw new errors.ValidationError('Validation failed');
    const outcome = await service(strapi, 'link-schedule').runNow(ctx.state.user || null);
    if (outcome.started) {
      ctx.status = 202;
      ctx.body = { data: { started: true } };
      return;
    }
    if (outcome.reason === 'RUNNING')
      return ctx.conflict('A link check is already running', { code: 'RUNNING' });
    throw new errors.ApplicationError('Scheduled link checks are turned off', { code: 'DISABLED' });
  },
});

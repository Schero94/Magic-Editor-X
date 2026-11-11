'use strict';

const { service } = require('./helpers');
const { parseOrThrow, qualityLinksSchema } = require('../utils/validation');

/**
 * Link check of the editor's quality panel.
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
});

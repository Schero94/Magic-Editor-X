'use strict';

const { service } = require('./helpers');
const { MigrationConflictError } = require('../services/migration-wizard');

/**
 * Admin migration wizard (2.13). Every route needs `plugin::magic-editor-x.migrate.run`; the
 * service also checks the admin's Content Manager rights on the content type (read the source
 * field, update the target field, their conditions and locales) on every call.
 */

const wizard = (strapi) => service(strapi, 'migration-wizard');

/**
 * Answers 409 for a field or batch that is already running; other errors propagate.
 * @param {object} ctx - Koa context.
 * @param {Function} run - Handler body.
 * @returns {Promise<void>}
 */
const withConflict = async (ctx, run) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof MigrationConflictError) return ctx.conflict(error.message, { code: error.code });
    throw error;
  }
};

const actorOf = (ctx) => ({
  userId: ctx.state.user && Number.isInteger(ctx.state.user.id) ? ctx.state.user.id : null,
});

module.exports = ({ strapi }) => ({
  /**
   * @route GET /magic-editor-x/migration/types
   * @auth admin; migrate.run
   * @returns {{ data: { types: Array<object>, locales: Array<object> } }} Content types with sources and Magic Editor X targets the admin can read and update, and the project's locales.
   */
  async types(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = {
      data: { types: wizard(strapi).types(ctx.state.userAbility), locales: await wizard(strapi).locales() },
    };
  },

  /**
   * @route POST /magic-editor-x/migration/preview { uid, from, to, locale?, overwrite?, size? }
   * @auth admin; migrate.run; CM read (source) + update (target)
   * @returns {{ data: { total: number, entries: Array<object> } }} Dry run of up to 10 entries; writes nothing.
   * @throws 400 invalid options, 403 no Content Manager rights.
   */
  async preview(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: await wizard(strapi).preview(ctx.state.userAbility, ctx.request.body) };
  },

  /**
   * @route GET /magic-editor-x/migration/backup?uid&from&to&locale
   * @auth admin; migrate.run; CM read (source) + update (target)
   * @returns {{ data: object }} Source and target values of every entry the run would touch.
   * @sideeffect Records `migration.backup` (counts only).
   * @throws 400, 403, 413 above 20000 entries.
   */
  async backup(ctx) {
    ctx.set('Cache-Control', 'no-store');
    const query = ctx.query || {};
    const pick = (key) => (typeof query[key] === 'string' ? query[key] : undefined);
    const input = { uid: pick('uid'), from: pick('from'), to: pick('to') };
    if (pick('locale')) input.locale = pick('locale');
    ctx.body = { data: await wizard(strapi).backup(ctx.state.userAbility, input) };
  },

  /**
   * @route GET /magic-editor-x/migration/jobs
   * @auth admin; migrate.run
   * @returns {{ data: Array<object> }} Unfinished runs the admin can continue.
   */
  async jobs(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: await wizard(strapi).list(ctx.state.userAbility) };
  },

  /**
   * @route POST /magic-editor-x/migration/jobs { uid, from, to, locale?, overwrite? }
   * @auth admin; migrate.run; CM read (source) + update (target)
   * @returns {{ data: object }} 201 with the new job.
   * @sideeffect Stores the job, takes the field lease, records `migration.start`.
   * @throws 400, 403, 409 when a run holds the field.
   */
  async start(ctx) {
    await withConflict(ctx, async () => {
      ctx.status = 201;
      ctx.body = { data: await wizard(strapi).start(ctx.state.userAbility, ctx.request.body, actorOf(ctx)) };
    });
  },

  /**
   * @route GET /magic-editor-x/migration/jobs/:id
   * @auth admin; migrate.run; CM update (target)
   * @returns {{ data: object }} Job; 404 when unknown or not accessible.
   */
  async job(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: await wizard(strapi).get(ctx.state.userAbility, ctx.params.id) };
  },

  /**
   * @route POST /magic-editor-x/migration/jobs/:id/next
   * @auth admin; migrate.run; CM read (source) + update (target)
   * @returns {{ data: object }} Job after one batch.
   * @sideeffect Writes up to one batch of target fields (drafts) and "Before migration" versions.
   * @throws 404, 403, 409 when another batch runs.
   */
  async next(ctx) {
    await withConflict(ctx, async () => {
      ctx.body = { data: await wizard(strapi).next(ctx.state.userAbility, ctx.params.id, actorOf(ctx)) };
    });
  },

  /**
   * @route POST /magic-editor-x/migration/jobs/:id/cancel
   * @auth admin; migrate.run; CM update (target)
   * @returns {{ data: object }} Cancelled job (what was migrated stays).
   * @sideeffect Records `migration.cancel`.
   */
  async cancel(ctx) {
    ctx.body = { data: await wizard(strapi).cancel(ctx.state.userAbility, ctx.params.id) };
  },
});

'use strict';

const { service } = require('./helpers');
const { sendProviderError } = require('./ai');

module.exports = ({ strapi }) => ({
  /**
   * @route GET /magic-editor-x/settings
   * @auth admin; plugin::magic-editor-x.settings.read
   * @returns {{ data: object }} Settings without secrets (`hasApiKey` flags only).
   */
  async get(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: await service(strapi, 'settings').get() };
  },

  /**
   * @route PUT /magic-editor-x/settings { ai }
   * @auth admin; settings.read + settings.update
   * @sideeffect Stores settings; an API key is encrypted at rest. Changing provider or base URL requires the key again.
   */
  async update(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: await service(strapi, 'settings').update(ctx.request.body || {}) };
  },

  /**
   * @route POST /magic-editor-x/settings/ai/test { ai }
   * @auth admin; settings.read + settings.update
   * @sideeffect One small request to the AI provider with the submitted settings.
   */
  async testAi(ctx) {
    const input = service(strapi, 'settings').parseAiInput((ctx.request.body || {}).ai);
    try {
      ctx.body = { data: await service(strapi, 'ai').test(input) };
    } catch (error) {
      if (!sendProviderError(ctx, error)) throw error;
    }
  },
});

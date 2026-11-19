'use strict';

const { service, recordAudit } = require('./helpers');
const { sendProviderError } = require('./ai');
const { sendGrammarError } = require('./grammar');

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
   * @route PUT /magic-editor-x/settings { ai, languageTool?, coreBlocks? }
   * @auth admin; settings.read + settings.update
   * @sideeffect Stores settings; an API key is encrypted at rest. Changing provider or base URL requires the key again.
   *   Records `settings.update` in the audit trail with the submitted top-level keys and, for the Core Blocks
   *   bridge switch, `coreBlocks: 'on'|'off'`.
   */
  async update(ctx) {
    ctx.set('Cache-Control', 'no-store');
    const body = ctx.request.body || {};
    ctx.body = { data: await service(strapi, 'settings').update(body) };
    // Audit trail: which top-level keys were submitted, never their values; 2.7: plus the Core Blocks
    // bridge switch (on/off), which is a security-relevant setting without secret content.
    const meta = {
      keys: Object.keys(body && typeof body === 'object' ? body : {})
        .filter((key) => /^[A-Za-z]{1,32}$/.test(key))
        .slice(0, 10),
    };
    if (body.coreBlocks && typeof body.coreBlocks.enabled === 'boolean')
      meta.coreBlocks = body.coreBlocks.enabled ? 'on' : 'off';
    await recordAudit(strapi, { event: 'settings.update', meta });
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

  /**
   * @route POST /magic-editor-x/settings/language-tool/test { languageTool }
   * @auth admin; settings.read + settings.update
   * @sideeffect One check of a fixed sample sentence with the submitted LanguageTool settings.
   */
  async testLanguageTool(ctx) {
    const input = service(strapi, 'settings').parseLanguageToolInput((ctx.request.body || {}).languageTool);
    try {
      ctx.body = { data: await service(strapi, 'grammar').test(input) };
    } catch (error) {
      if (!sendGrammarError(ctx, error)) throw error;
    }
  },
});

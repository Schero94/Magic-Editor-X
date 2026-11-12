'use strict';

const { ACTIONS } = require('../permissions');
const { service } = require('./helpers');

/**
 * @route GET /magic-editor-x/config
 * @auth admin; plugin::magic-editor-x.access
 * @returns {{ data: object }} Editor runtime configuration and the caller's capabilities. No secrets.
 */
module.exports = ({ strapi }) => ({
  async get(ctx) {
    const ability = ctx.state.userAbility;
    const can = (action) => {
      try {
        return Boolean(ability && ability.can(action));
      } catch {
        return false;
      }
    };
    const conf = (key, fallback) => {
      const value = strapi.config.get(`plugin::magic-editor-x.${key}`);
      return value === undefined ? fallback : value;
    };
    const settings = await service(strapi, 'settings').get();
    const ai = service(strapi, 'ai');
    ctx.body = {
      data: {
        collaboration: {
          enabled: service(strapi, 'collaboration').isRunning(),
          path: conf('collaboration.path', '/magic-editor-x/realtime'),
        },
        ai: {
          enabled:
            settings.ai.enabled &&
            ((settings.ai.hasApiKey && !settings.ai.apiKeyUnreadable) ||
              settings.ai.provider === 'openai-compatible'),
          actions: ai.ACTIONS,
          languages: ai.LANGUAGES,
          tones: ai.TONES,
          maxInputChars: settings.ai.maxInputChars,
        },
        uploads: {
          maxImageBytes: conf('uploads.maxImageBytes', 10 * 1024 * 1024),
          maxFileBytes: conf('uploads.maxFileBytes', 20 * 1024 * 1024),
          attachmentTypes: service(strapi, 'editor').attachmentTypes(),
        },
        linkPreview: conf('linkPreview.enabled', true) !== false,
        quality: {
          externalLinks: conf('qualityChecks.externalLinks.enabled', false) === true,
          scheduledLinks: service(strapi, 'link-schedule').settings().enabled,
        },
        comments: { enabled: conf('comments.enabled', true) !== false },
        rawHtml: conf('rawHtml', 'sanitize'),
        permissions: {
          collaborate: can(ACTIONS.collaborate),
          ai: can(ACTIONS.ai),
          upload: can('plugin::upload.assets.create'),
          mediaLibrary: can('plugin::upload.read'),
          customBlocksManage: can(ACTIONS.customBlocksManage),
          settingsRead: can(ACTIONS.settingsRead),
          commentsRead: can(ACTIONS.commentsRead),
          commentsWrite: can(ACTIONS.commentsWrite),
          commentsModerate: can(ACTIONS.commentsModerate),
          templatesManage: can(ACTIONS.templatesManage),
        },
      },
    };
  },
});

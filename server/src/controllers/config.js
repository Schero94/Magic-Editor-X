'use strict';

const { ACTIONS } = require('../permissions');
const { service } = require('./helpers');
const { paletteOf } = require('../utils/inline-policy');
const { createComponentLookup } = require('../utils/component-blocks');
const { MAX_INSTRUCTION_CHARS, REVIEW_KINDS } = require('../../../shared/ai-actions.mjs');
const { ASSET_EDITOR_MIN_VERSION, isVersionAtLeast } = require('../../../shared/media-library.mjs');

/**
 * @route GET /magic-editor-x/config
 * @auth admin; plugin::magic-editor-x.access
 * @returns {{ data: object }} Editor runtime configuration and the caller's capabilities. No secrets.
 *   2.5: `data.components` describes every Content-Type Builder component for component blocks
 *   (uid, display name, icon, supported attributes with their rules, unsupported ones); schema only, no content.
 */
module.exports = ({ strapi }) => ({
  async get(ctx) {
    const lookup = createComponentLookup(strapi);
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
          // 2.3 owner switches (the server checks them again on every request).
          altText: settings.ai.allowImages === true,
          fieldActions: settings.ai.allowFieldActions === true,
          // 2.9: "Ask AI…", AI review and owner-defined actions (names only; instructions stay on the server).
          maxInstructionChars: MAX_INSTRUCTION_CHARS,
          reviews: REVIEW_KINDS.filter(
            (kind) =>
              kind !== 'style-guide' || Boolean(settings.ai.styleGuide && settings.ai.styleGuide.trim())
          ),
          custom: (settings.ai.actions || []).map(({ key, name, scope, output }) => ({
            key,
            name,
            scope,
            output,
          })),
        },
        grammar: { enabled: Boolean(settings.languageTool.enabled && settings.languageTool.baseUrl) },
        uploads: {
          maxImageBytes: conf('uploads.maxImageBytes', 10 * 1024 * 1024),
          maxFileBytes: conf('uploads.maxFileBytes', 20 * 1024 * 1024),
          attachmentTypes: service(strapi, 'editor').attachmentTypes(),
          // 2.5: the upload provider serves files through signed URLs only (the editor refreshes them).
          privateFiles: await service(strapi, 'media').isPrivate(),
        },
        // 2.12: "Edit in Media Library" for image blocks. Strapi 5.54+ opens the asset drawer (with Crop)
        // from `/admin/plugins/upload?assetId=`; the admin also checks that the legacy Media Library is off.
        mediaLibrary: {
          assetEditor:
            Boolean(strapi.plugin('upload')) &&
            isVersionAtLeast(strapi.config.get('info.strapi'), ASSET_EDITOR_MIN_VERSION),
        },
        linkPreview: conf('linkPreview.enabled', true) !== false,
        quality: {
          externalLinks: conf('qualityChecks.externalLinks.enabled', false) === true,
          scheduledLinks: service(strapi, 'link-schedule').settings().enabled,
          // 2.9: readability and SEO hints of the Quality panel (rules, thresholds; no content).
          contentChecks: settings.contentChecks,
        },
        comments: { enabled: conf('comments.enabled', true) !== false },
        suggestions: { enabled: conf('suggestions.enabled', true) !== false },
        audit: { enabled: conf('audit.enabled', true) !== false },
        rawHtml: conf('rawHtml', 'sanitize'),
        // 2.3: code-registered blocks (custom block SDK): names and field types only.
        codeBlocks: service(strapi, 'blocks').summaries(),
        // 2.5: colour and highlight tokens (names, labels, display colours; fields opt in) and inline
        // annotations (built-in abbreviation plus code-registered ones; summaries without functions).
        palette: paletteOf(strapi),
        annotations: service(strapi, 'blocks').annotationSummaries(),
        permissions: {
          collaborate: can(ACTIONS.collaborate),
          ai: can(ACTIONS.ai),
          upload: can('plugin::upload.assets.create'),
          mediaLibrary: can('plugin::upload.read'),
          // 2.12: Crop in the Media Library replaces the file (needs update rights there).
          mediaLibraryUpdate: can('plugin::upload.assets.update'),
          customBlocksManage: can(ACTIONS.customBlocksManage),
          settingsRead: can(ACTIONS.settingsRead),
          commentsRead: can(ACTIONS.commentsRead),
          commentsWrite: can(ACTIONS.commentsWrite),
          commentsModerate: can(ACTIONS.commentsModerate),
          grammar: can(ACTIONS.grammar),
          templatesManage: can(ACTIONS.templatesManage),
          auditRead: can(ACTIONS.auditRead),
          suggestionsCreate: can(ACTIONS.suggestionsCreate),
          suggestionsReview: can(ACTIONS.suggestionsReview),
          // 2.13: the "Need more?" entry of `simple` fields links to the Content-Type Builder.
          contentTypeBuilder: can('plugin::content-type-builder.read'),
        },
        components: Object.keys(strapi.components || {})
          .sort()
          .map(lookup)
          .filter(Boolean),
        // 2.5 "Use existing content".
        reuse: { enabled: conf('reuse.enabled', true) !== false },
        // 2.5: local draft buffer and lazy start of fields (browser-only behaviour).
        drafts: {
          enabled: conf('drafts.enabled', true) !== false,
          ttlHours: conf('drafts.ttlHours', 72),
        },
        lazyInit: {
          enabled: conf('lazyInit.enabled', true) !== false,
          marginPx: conf('lazyInit.marginPx', 800),
        },
      },
    };
  },
});

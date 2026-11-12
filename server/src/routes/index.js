'use strict';

const { ACTIONS, requireActions } = require('../permissions');

const UPLOAD_CREATE = 'plugin::upload.assets.create';

/**
 * Admin API routes (served at /magic-editor-x/...). Every route requires an
 * authenticated admin and the listed RBAC actions; handlers add entry-level
 * Content Manager checks where a route touches a document.
 * The plugin exposes no Content API routes.
 */
const adminRoutes = [
  ['GET', '/config', 'config.get', [ACTIONS.access]],

  ['GET', '/link', 'editor.linkPreview', [ACTIONS.access]],
  ['POST', '/image/byFile', 'editor.uploadImageFile', [ACTIONS.access, UPLOAD_CREATE]],
  ['POST', '/image/byUrl', 'editor.uploadImageUrl', [ACTIONS.access, UPLOAD_CREATE]],
  ['POST', '/file/upload', 'editor.uploadAttachment', [ACTIONS.access, UPLOAD_CREATE]],
  ['POST', '/media/byUrl', 'editor.uploadMediaUrl', [ACTIONS.access, UPLOAD_CREATE]],
  ['GET', '/content-types', 'editor.contentTypes', [ACTIONS.access]],
  ['GET', '/links/types', 'links.types', [ACTIONS.access]],
  ['GET', '/links/search', 'links.search', [ACTIONS.access]],
  ['POST', '/quality/links', 'quality.links', [ACTIONS.access]],
  ['GET', '/quality/link-report', 'quality.linkReport', [ACTIONS.access]],
  ['GET', '/quality/link-schedule', 'quality.scheduleStatus', [ACTIONS.settingsRead]],
  [
    'POST',
    '/quality/link-schedule/run',
    'quality.runSchedule',
    [ACTIONS.settingsRead, ACTIONS.settingsUpdate],
  ],

  ['GET', '/custom-blocks', 'customBlocks.list', [ACTIONS.access]],
  ['GET', '/custom-blocks/export', 'customBlocks.export', [ACTIONS.customBlocksManage]],
  ['POST', '/custom-blocks/import', 'customBlocks.import', [ACTIONS.customBlocksManage]],
  ['PUT', '/custom-blocks/order', 'customBlocks.reorder', [ACTIONS.customBlocksManage]],
  ['POST', '/custom-blocks', 'customBlocks.create', [ACTIONS.customBlocksManage]],
  ['PUT', '/custom-blocks/:id', 'customBlocks.update', [ACTIONS.customBlocksManage]],
  ['DELETE', '/custom-blocks/:id', 'customBlocks.remove', [ACTIONS.customBlocksManage]],
  ['POST', '/custom-blocks/:id/duplicate', 'customBlocks.duplicate', [ACTIONS.customBlocksManage]],

  ['GET', '/templates', 'templates.list', [ACTIONS.access]],
  ['GET', '/templates/targets', 'templates.targets', [ACTIONS.access, ACTIONS.templatesManage]],
  ['PUT', '/templates/order', 'templates.reorder', [ACTIONS.access, ACTIONS.templatesManage]],
  ['GET', '/templates/:id', 'templates.findOne', [ACTIONS.access]],
  ['GET', '/templates/:id/usage', 'templates.usage', [ACTIONS.access, ACTIONS.templatesManage]],
  ['GET', '/templates/:id/versions', 'templates.versions', [ACTIONS.access, ACTIONS.templatesManage]],
  [
    'GET',
    '/templates/:id/versions/:versionId',
    'templates.version',
    [ACTIONS.access, ACTIONS.templatesManage],
  ],
  [
    'PUT',
    '/templates/:id/versions/:versionId',
    'templates.renameVersion',
    [ACTIONS.access, ACTIONS.templatesManage],
  ],
  [
    'POST',
    '/templates/:id/versions/:versionId/restore',
    'templates.restoreVersion',
    [ACTIONS.access, ACTIONS.templatesManage],
  ],
  ['POST', '/templates', 'templates.create', [ACTIONS.access, ACTIONS.templatesManage]],
  ['PUT', '/templates/:id', 'templates.update', [ACTIONS.access, ACTIONS.templatesManage]],
  ['DELETE', '/templates/:id', 'templates.remove', [ACTIONS.access, ACTIONS.templatesManage]],
  ['POST', '/templates/:id/duplicate', 'templates.duplicate', [ACTIONS.access, ACTIONS.templatesManage]],

  ['POST', '/collaboration/session', 'collaboration.createSession', [ACTIONS.access, ACTIONS.collaborate]],

  ['GET', '/history', 'history.list', [ACTIONS.access]],
  ['GET', '/history/:id', 'history.findOne', [ACTIONS.access]],
  ['POST', '/history', 'history.create', [ACTIONS.access]],
  ['PUT', '/history/:id', 'history.rename', [ACTIONS.access]],

  ['GET', '/comments', 'comments.list', [ACTIONS.access, ACTIONS.commentsRead]],
  // 2.4: @mention picker (registered before `/comments/:id` routes; only GET /comments shares the prefix).
  [
    'GET',
    '/comments/mentionable',
    'comments.mentionable',
    [ACTIONS.access, ACTIONS.commentsRead, ACTIONS.commentsWrite],
  ],
  ['POST', '/comments', 'comments.create', [ACTIONS.access, ACTIONS.commentsRead, ACTIONS.commentsWrite]],
  [
    'POST',
    '/comments/:id/replies',
    'comments.reply',
    [ACTIONS.access, ACTIONS.commentsRead, ACTIONS.commentsWrite],
  ],
  ['PUT', '/comments/:id', 'comments.update', [ACTIONS.access, ACTIONS.commentsRead, ACTIONS.commentsWrite]],
  [
    'POST',
    '/comments/:id/resolve',
    'comments.resolve',
    [ACTIONS.access, ACTIONS.commentsRead, ACTIONS.commentsWrite],
  ],
  [
    'POST',
    '/comments/:id/reopen',
    'comments.reopen',
    [ACTIONS.access, ACTIONS.commentsRead, ACTIONS.commentsWrite],
  ],
  // Own comments need comments.write, anyone's comments.moderate (checked in the handler).
  ['DELETE', '/comments/:id', 'comments.remove', [ACTIONS.access, ACTIONS.commentsRead]],
  // 2.4: the caller's own mention and reply notifications.
  ['GET', '/notifications', 'notifications.list', [ACTIONS.access, ACTIONS.commentsRead]],
  ['POST', '/notifications/read-all', 'notifications.readAll', [ACTIONS.access, ACTIONS.commentsRead]],
  ['POST', '/notifications/:id/read', 'notifications.read', [ACTIONS.access, ACTIONS.commentsRead]],
  ['POST', '/notifications/:id/unread', 'notifications.unread', [ACTIONS.access, ACTIONS.commentsRead]],

  // 2.4 block suggestions. Listing needs suggestions.create or suggestions.review (checked in the handler).
  ['GET', '/suggestions', 'suggestions.list', [ACTIONS.access]],
  ['POST', '/suggestions', 'suggestions.create', [ACTIONS.access, ACTIONS.suggestionsCreate]],
  ['POST', '/suggestions/:id/accept', 'suggestions.accept', [ACTIONS.access, ACTIONS.suggestionsReview]],
  ['POST', '/suggestions/:id/reject', 'suggestions.reject', [ACTIONS.access, ACTIONS.suggestionsReview]],
  ['DELETE', '/suggestions/:id', 'suggestions.withdraw', [ACTIONS.access, ACTIONS.suggestionsCreate]],

  ['POST', '/ai/:action', 'ai.run', [ACTIONS.access, ACTIONS.ai]],
  ['POST', '/ai/image/alt-text', 'ai.altText', [ACTIONS.access, ACTIONS.ai]],
  ['POST', '/ai/field/:action', 'ai.field', [ACTIONS.access, ACTIONS.ai]],
  ['POST', '/ai/blocks/:action', 'ai.blocks', [ACTIONS.access, ACTIONS.ai]],
  ['POST', '/grammar/check', 'grammar.check', [ACTIONS.access, ACTIONS.grammar]],

  // Global listing needs settings.read too; a field-scoped one needs CM read on the document (handler).
  ['GET', '/audit', 'audit.list', [ACTIONS.auditRead]],
  ['GET', '/audit/actors', 'audit.actors', [ACTIONS.auditRead, ACTIONS.settingsRead]],

  ['GET', '/settings', 'settings.get', [ACTIONS.settingsRead]],
  ['PUT', '/settings', 'settings.update', [ACTIONS.settingsRead, ACTIONS.settingsUpdate]],
  ['POST', '/settings/ai/test', 'settings.testAi', [ACTIONS.settingsRead, ACTIONS.settingsUpdate]],
  [
    'POST',
    '/settings/language-tool/test',
    'settings.testLanguageTool',
    [ACTIONS.settingsRead, ACTIONS.settingsUpdate],
  ],
].map(([method, path, handler, actions]) => ({
  method,
  path,
  handler,
  config: { policies: requireActions(...actions) },
}));

module.exports = {
  admin: { type: 'admin', routes: adminRoutes },
  'content-api': { type: 'content-api', routes: [] },
};

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
  ['GET', '/content-types', 'editor.contentTypes', [ACTIONS.access]],
  ['GET', '/links/types', 'links.types', [ACTIONS.access]],
  ['GET', '/links/search', 'links.search', [ACTIONS.access]],

  ['GET', '/custom-blocks', 'customBlocks.list', [ACTIONS.access]],
  ['GET', '/custom-blocks/export', 'customBlocks.export', [ACTIONS.customBlocksManage]],
  ['POST', '/custom-blocks/import', 'customBlocks.import', [ACTIONS.customBlocksManage]],
  ['PUT', '/custom-blocks/order', 'customBlocks.reorder', [ACTIONS.customBlocksManage]],
  ['POST', '/custom-blocks', 'customBlocks.create', [ACTIONS.customBlocksManage]],
  ['PUT', '/custom-blocks/:id', 'customBlocks.update', [ACTIONS.customBlocksManage]],
  ['DELETE', '/custom-blocks/:id', 'customBlocks.remove', [ACTIONS.customBlocksManage]],
  ['POST', '/custom-blocks/:id/duplicate', 'customBlocks.duplicate', [ACTIONS.customBlocksManage]],

  ['POST', '/collaboration/session', 'collaboration.createSession', [ACTIONS.access, ACTIONS.collaborate]],

  ['GET', '/history', 'history.list', [ACTIONS.access]],
  ['GET', '/history/:id', 'history.findOne', [ACTIONS.access]],
  ['POST', '/history', 'history.create', [ACTIONS.access]],

  ['POST', '/ai/:action', 'ai.run', [ACTIONS.access, ACTIONS.ai]],

  ['GET', '/settings', 'settings.get', [ACTIONS.settingsRead]],
  ['PUT', '/settings', 'settings.update', [ACTIONS.settingsRead, ACTIONS.settingsUpdate]],
  ['POST', '/settings/ai/test', 'settings.testAi', [ACTIONS.settingsRead, ACTIONS.settingsUpdate]],
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

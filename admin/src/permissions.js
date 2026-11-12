/**
 * RBAC actions mirrored from server/src/permissions.js. They hide links and
 * controls only; the server checks every request.
 */
const action = (uid) => [{ action: `plugin::magic-editor-x.${uid}`, subject: null }];

export const PERMISSIONS = {
  access: action('access'),
  collaborate: action('collaborate'),
  ai: action('ai.use'),
  customBlocksManage: action('custom-blocks.manage'),
  settingsRead: action('settings.read'),
  settingsUpdate: action('settings.update'),
  commentsRead: action('comments.read'),
  commentsWrite: action('comments.write'),
  commentsModerate: action('comments.moderate'),
};

export default PERMISSIONS;

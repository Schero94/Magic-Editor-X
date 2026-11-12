'use strict';

const { createLogger } = require('./utils/logger');
const { registerPermissions } = require('./permissions');
const { subscribeCommentAuthorCleanup } = require('./utils/comment-retention');

/**
 * Bootstrap: RBAC actions, plugin tables, migrations, the response parser
 * and the collaboration server. Failures are logged at error level and never
 * hidden behind the debug flag.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 */
module.exports = async ({ strapi }) => {
  const logger = createLogger(strapi);
  const plugin = strapi.plugin('magic-editor-x');
  await registerPermissions(strapi);

  const removed = [
    'enabledTools',
    'linkPreviewTimeout',
    'maxImageSize',
    'maxFileSize',
    'allowedImageTypes',
  ].filter((key) => strapi.config.get(`plugin::magic-editor-x.${key}`) !== undefined);
  for (const key of ['sessionTTL', 'wsPath', 'wsUrl', 'allowedAdminRoles', 'allowedAdminUserIds', 'cors']) {
    if (strapi.config.get(`plugin::magic-editor-x.collaboration.${key}`) !== undefined)
      removed.push(`collaboration.${key}`);
  }
  if (removed.length)
    logger.warn(`ignoring 1.x config keys: ${removed.join(', ')} (see the 2.0 migration guide)`);

  try {
    await plugin.service('store').init();
    await plugin.service('migrations').run();
  } catch (error) {
    logger.error('database setup failed', error);
  }

  // The plugin never changes the CSP; it only tells the owner what the editor preview needs.
  try {
    const csp = plugin.service('settings').inspectAdminCsp();
    if (csp.frameSrcMissing.length || csp.imgSrcMissing) {
      logger.debug(
        'the admin Content Security Policy blocks some editor embeds or external images; Settings > Magic Editor X > Configuration shows the sources to add'
      );
    }
  } catch (error) {
    logger.error('the admin Content Security Policy could not be inspected', error);
  }

  if (strapi.config.get('plugin::magic-editor-x.api.autoParseJSON') !== false) {
    strapi.server.use(plugin.middleware('parse-editor-fields')({}, { strapi }));
  }

  try {
    await plugin.service('collaboration').start();
  } catch (error) {
    logger.error('live collaboration could not start', error);
  }

  // Permission changes reach open collaboration sockets on every process
  // within about a second (cluster-wide signal, see services/collaboration.js).
  const onPermissionChange = () => {
    plugin
      .service('collaboration')
      .permissionsChanged()
      .catch(() => {});
  };
  strapi.db.lifecycles.subscribe({
    models: ['admin::permission', 'admin::role', 'admin::user'],
    afterCreate: onPermissionChange,
    afterCreateMany: onPermissionChange,
    afterUpdate: onPermissionChange,
    afterUpdateMany: onPermissionChange,
    afterDelete: onPermissionChange,
    afterDeleteMany: onPermissionChange,
  });

  // Block comments: clear the author snapshot of deleted admin users.
  subscribeCommentAuthorCleanup(strapi);
};

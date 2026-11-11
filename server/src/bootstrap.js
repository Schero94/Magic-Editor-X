'use strict';

const { createLogger } = require('./utils/logger');
const { registerPermissions } = require('./permissions');

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

  if (strapi.config.get('plugin::magic-editor-x.api.autoParseJSON') !== false) {
    strapi.server.use(plugin.middleware('parse-editor-fields')({}, { strapi }));
  }

  try {
    await plugin.service('collaboration').start();
  } catch (error) {
    logger.error('live collaboration could not start', error);
  }
};

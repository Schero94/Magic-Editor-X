/**
 * Magic Editor X - Destroy
 * Runs on plugin shutdown
 */
'use strict';

const { createLogger } = require('./utils');

module.exports = async ({ strapi }) => {
  const logger = createLogger(strapi);

  try {
    await strapi.plugin('magic-editor-x').service('realtimeService').close();
  } catch (error) {
    logger.error('Failed to gracefully shutdown realtime server', error);
  }

  logger.info('Plugin destroyed');
};

/**
 * Magic Editor X - Destroy
 * Runs on plugin shutdown
 */
'use strict';

module.exports = async ({ strapi }) => {
  try {
    await strapi.plugin('magic-editor-x').service('realtimeService').close();
  } catch (error) {
    strapi.log.error('[Magic Editor X] Failed to gracefully shutdown realtime server', error);
  }

  strapi.log.info('[Magic Editor X] Plugin destroyed');
};

'use strict';

const { createLogger } = require('./utils/logger');

/**
 * Stops the collaboration server and its timers.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 */
module.exports = async ({ strapi }) => {
  try {
    await strapi.plugin('magic-editor-x').service('collaboration').stop();
  } catch (error) {
    createLogger(strapi).error('collaboration shutdown failed', error);
  }
};

'use strict';

const { createLogger } = require('./utils/logger');

/**
 * Stops the collaboration server and its timers and removes the link check cron job.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 */
module.exports = async ({ strapi }) => {
  try {
    strapi.plugin('magic-editor-x').service('link-schedule').stop();
  } catch (error) {
    createLogger(strapi).error('link check shutdown failed', error);
  }
  try {
    await strapi.plugin('magic-editor-x').service('collaboration').stop();
  } catch (error) {
    createLogger(strapi).error('collaboration shutdown failed', error);
  }
};

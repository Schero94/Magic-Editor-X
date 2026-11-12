'use strict';

const { createLogger } = require('./utils/logger');
const { unsubscribeCommentAuthorCleanup } = require('./utils/comment-retention');

/**
 * Stops the collaboration server and its timers and removes the comment
 * author cleanup subscription.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 */
module.exports = async ({ strapi }) => {
  unsubscribeCommentAuthorCleanup(strapi);
  try {
    await strapi.plugin('magic-editor-x').service('collaboration').stop();
  } catch (error) {
    createLogger(strapi).error('collaboration shutdown failed', error);
  }
};

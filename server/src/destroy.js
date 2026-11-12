'use strict';

const { createLogger } = require('./utils/logger');
const { unsubscribeCommentAuthorCleanup } = require('./utils/comment-retention');
const { clearActiveBlocks } = require('../../shared/blocks/active.mjs');

/**
 * Stops the collaboration server and its timers, removes the link check cron
 * job and the comment author cleanup subscription.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 */
module.exports = async ({ strapi }) => {
  unsubscribeCommentAuthorCleanup(strapi);
  // A new Strapi instance in the same process registers its blocks again.
  clearActiveBlocks();
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

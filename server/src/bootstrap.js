/**
 * Magic Editor X - Bootstrap
 * Runs on plugin start
 * 
 * Handles:
 * - Content type registration check
 * - Realtime server initialization
 * - Cleanup of stale sessions (important after Strapi Transfer)
 * - Compatibility with strapi-plugin-io
 */
'use strict';

const { createLogger } = require('./utils');

module.exports = async ({ strapi }) => {
  const logger = createLogger(strapi);

  try {
    // Check if content types are registered
    const contentTypes = [
      'plugin::magic-editor-x.collab-session',
      'plugin::magic-editor-x.document-snapshot',
      'plugin::magic-editor-x.collab-permission',
    ];

    for (const contentType of contentTypes) {
      const exists = strapi.contentType(contentType);
      if (exists) {
        logger.info(`[SUCCESS] Content type registered: ${contentType}`);
      } else {
        logger.warn(`[WARNING] Content type NOT found: ${contentType}`);
      }
    }

    // Cleanup stale sessions on startup
    // This is important after Strapi Transfer or server restart
    // Using Document Service API (strapi.documents) for Strapi v5
    try {
      const staleSessions = await strapi.documents('plugin::magic-editor-x.collab-session').findMany({
        limit: 1000,
      });
      
      if (staleSessions && staleSessions.length > 0) {
        for (const session of staleSessions) {
          await strapi.documents('plugin::magic-editor-x.collab-session').delete({
            documentId: session.documentId,
          });
        }
        logger.info(`[CLEANUP] Cleaned up ${staleSessions.length} stale sessions`);
      }
    } catch (cleanupError) {
      // Ignore cleanup errors - table might not exist yet
      logger.debug('Session cleanup skipped:', cleanupError.message);
    }

    // Cleanup expired permissions
    try {
      const now = new Date();
      const expiredPerms = await strapi.documents('plugin::magic-editor-x.collab-permission').findMany({
        filters: {
          expiresAt: { $lt: now, $ne: null },
        },
        limit: 1000,
      });
      
      if (expiredPerms && expiredPerms.length > 0) {
        for (const perm of expiredPerms) {
          await strapi.documents('plugin::magic-editor-x.collab-permission').delete({
            documentId: perm.documentId,
          });
        }
        logger.info(`[CLEANUP] Cleaned up ${expiredPerms.length} expired permissions`);
      }
    } catch (cleanupError) {
      logger.debug('Permission cleanup skipped:', cleanupError.message);
    }

    // Check for strapi-plugin-io compatibility
    if (strapi.$io) {
      logger.info('[INFO] strapi-plugin-io detected - running in compatibility mode');
    }

    // Start realtime server
    await strapi.plugin('magic-editor-x').service('realtimeService').initSocketServer();
    logger.info('[SUCCESS] Realtime server started');

    // Register middleware to auto-parse Editor.js JSON fields in API responses
    // This transforms JSON strings to objects for better developer experience
    const pluginConfig = strapi.config.get('plugin::magic-editor-x') || {};
    const autoParseJSON = pluginConfig.api?.autoParseJSON !== false; // Default: true
    
    if (autoParseJSON) {
      const parseMiddleware = strapi.plugin('magic-editor-x').middleware('parse-editor-fields');
      strapi.server.use(parseMiddleware({}, { strapi }));
      logger.info('[SUCCESS] Auto-parse middleware registered (api.autoParseJSON: true)');
    } else {
      logger.info('[INFO] Auto-parse middleware disabled (api.autoParseJSON: false)');
    }
  } catch (error) {
    logger.error('[ERROR] Bootstrap failed:', error);
  }

  logger.info('Plugin bootstrapped');
};

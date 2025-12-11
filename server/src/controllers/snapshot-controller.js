'use strict';

const { errors } = require('@strapi/utils');

/**
 * Snapshot Controller
 * Provides list/create/restore endpoints for version history.
 */
module.exports = ({ strapi }) => ({
  /**
   * List snapshots for a room (ordered desc by version)
   */
  async list(ctx) {
    const { roomId } = ctx.params;
    if (!roomId) {
      throw new errors.ValidationError('roomId is required');
    }

    const snapshots = await strapi
      .plugin('magic-editor-x')
      .service('snapshotService')
      .listSnapshots(roomId);

    ctx.body = { data: snapshots };
  },

  /**
   * Create a snapshot manually (premium feature)
   * Accepts either Y.Doc from active room OR JSON content from request body
   */
  async create(ctx) {
    const { roomId } = ctx.params;
    const { contentType, entryId, fieldName, content } = ctx.request.body || {};

    if (!roomId || !contentType || !entryId || !fieldName) {
      throw new errors.ValidationError('roomId, contentType, entryId, fieldName are required');
    }

    // Check license tier for premium
    const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
    const tier = await licenseService.getCurrentTier();
    if (tier === 'free') {
      throw new errors.ForbiddenError('Version History requires Premium plan');
    }

    // Try to get Y.Doc from active collaboration room
    const realtimeService = strapi.plugin('magic-editor-x').service('realtimeService');
    const room = realtimeService.ensureRoom?.(roomId);
    
    let snapshot;
    
    if (room && room.doc) {
      // Use Y.Doc state from active room
      snapshot = await strapi
        .plugin('magic-editor-x')
        .service('snapshotService')
        .createSnapshot(roomId, contentType, entryId, fieldName, room.doc, ctx.state?.user?.id || null);
    } else if (content) {
      // Fallback: Create snapshot from JSON content provided by frontend
      snapshot = await strapi
        .plugin('magic-editor-x')
        .service('snapshotService')
        .createSnapshotFromJson(roomId, contentType, entryId, fieldName, content, ctx.state?.user?.id || null);
    } else {
      throw new errors.ValidationError('No active collaboration room and no content provided');
    }

    ctx.body = { data: snapshot };
  },

  /**
   * Restore a snapshot by documentId (premium feature)
   * Returns JSON content for frontend to apply, optionally syncs to Y.Doc if room exists
   */
  async restore(ctx) {
    const { documentId } = ctx.params;
    if (!documentId) {
      throw new errors.ValidationError('documentId is required');
    }

    const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
    const tier = await licenseService.getCurrentTier();
    if (tier === 'free') {
      throw new errors.ForbiddenError('Version History requires Premium plan');
    }

    // Get snapshot data
    const snapshot = await strapi.documents('plugin::magic-editor-x.document-snapshot').findOne({
      documentId,
    });

    if (!snapshot) {
      throw new errors.NotFoundError('Snapshot not found');
    }

    // Try to sync to Y.Doc if room exists (optional)
    const realtimeService = strapi.plugin('magic-editor-x').service('realtimeService');
    const roomId = ctx.request.body?.roomId;
    const room = roomId ? realtimeService.ensureRoom?.(roomId) : null;

    if (room && room.doc && snapshot.yjsSnapshot) {
      // Apply Y.js state to active room
      try {
        await strapi
          .plugin('magic-editor-x')
          .service('snapshotService')
          .restoreSnapshot(documentId, room.doc);
      } catch (err) {
        // Log but don't fail - frontend can still use JSON content
        strapi.log.warn('[Snapshot] Could not apply Y.js state to room:', err?.message);
      }
    }

    // Return snapshot with JSON content for frontend to render
    ctx.body = { 
      data: snapshot,
      jsonContent: snapshot.jsonContent, // Frontend uses this to restore editor
    };
  },
});


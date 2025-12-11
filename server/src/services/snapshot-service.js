/**
 * Magic Editor X - Snapshot Service
 * Handles version snapshots and recovery
 * Using Document Service API (strapi.documents) for Strapi v5
 */
'use strict';

const { encodeStateAsUpdate, encodeStateVector, applyUpdate } = require('yjs');
const { createLogger } = require('../utils');

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  return {
  /**
   * Create snapshot from Y.Doc
   */
  async createSnapshot(roomId, contentType, entryId, fieldName, ydoc, userId) {
    try {
      // Get latest version number
      const latestSnapshots = await strapi.documents('plugin::magic-editor-x.document-snapshot').findMany({
          filters: { roomId },
        sort: [{ version: 'desc' }],
          limit: 1,
      });

      const nextVersion = latestSnapshots?.[0]?.version ? latestSnapshots[0].version + 1 : 1;

      // Encode Y.Doc state
      const yjsState = encodeStateAsUpdate(ydoc);
      const yjsSnapshot = Buffer.from(yjsState).toString('base64');

      // Extract JSON content (if available)
      let jsonContent = null;
      try {
        const text = ydoc.getText('content');
        jsonContent = text.toString();
      } catch (e) {
        logger.warn('[Snapshot] Could not extract JSON content:', e);
      }

      // Create snapshot
      // Note: createdAt is auto-set by Strapi
      const snapshot = await strapi.documents('plugin::magic-editor-x.document-snapshot').create({
          data: {
            roomId,
            contentType,
            entryId,
            fieldName,
            version: nextVersion,
            yjsSnapshot,
            jsonContent: jsonContent ? JSON.parse(jsonContent) : null,
            createdBy: userId,
          },
      });

      logger.info(`[Snapshot] Created v${nextVersion} for ${roomId}`);
      return snapshot;
    } catch (error) {
      logger.error('[Snapshot] Error creating snapshot:', error);
      throw error;
    }
  },

  /**
   * Create snapshot from JSON content (when no Y.Doc available)
   * @param {string} roomId - Room identifier
   * @param {string} contentType - Content type UID
   * @param {string} entryId - Entry document ID
   * @param {string} fieldName - Field name
   * @param {object} jsonContent - Editor.js JSON content
   * @param {string|null} userId - User ID who created the snapshot
   */
  async createSnapshotFromJson(roomId, contentType, entryId, fieldName, jsonContent, userId) {
    try {
      // Get latest version number
      const latestSnapshots = await strapi.documents('plugin::magic-editor-x.document-snapshot').findMany({
        filters: { roomId },
        sort: [{ version: 'desc' }],
        limit: 1,
      });

      const nextVersion = latestSnapshots?.[0]?.version ? latestSnapshots[0].version + 1 : 1;

      // Create snapshot without Y.js state (JSON-only snapshot)
      const snapshot = await strapi.documents('plugin::magic-editor-x.document-snapshot').create({
        data: {
          roomId,
          contentType,
          entryId,
          fieldName,
          version: nextVersion,
          yjsSnapshot: null, // No Y.js state available
          jsonContent: typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent,
          createdBy: userId,
        },
      });

      logger.info(`[Snapshot] Created v${nextVersion} for ${roomId} (JSON-only)`);
      return snapshot;
    } catch (error) {
      logger.error('[Snapshot] Error creating JSON snapshot:', error);
      throw error;
    }
  },

  /**
   * List snapshots for a room
   */
  async listSnapshots(roomId, limit = 50) {
    return await strapi.documents('plugin::magic-editor-x.document-snapshot').findMany({
        filters: { roomId },
      sort: [{ version: 'desc' }],
        limit,
        populate: ['createdBy'],
    });
  },

  /**
   * Restore snapshot to Y.Doc
   * Note: Uses documentId instead of numeric id
   */
  async restoreSnapshot(snapshotDocumentId, ydoc) {
    try {
      const snapshot = await strapi.documents('plugin::magic-editor-x.document-snapshot').findOne({
        documentId: snapshotDocumentId,
      });

      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      // Decode and apply snapshot
      const yjsState = Buffer.from(snapshot.yjsSnapshot, 'base64');
      applyUpdate(ydoc, yjsState);

      logger.info(`[Snapshot] Restored v${snapshot.version} for ${snapshot.roomId}`);
      return snapshot;
    } catch (error) {
      logger.error('[Snapshot] Error restoring snapshot:', error);
      throw error;
    }
  },

  /**
   * Auto-cleanup old snapshots (keep last N versions)
   */
  async cleanupSnapshots(roomId, keepLast = 10) {
    try {
      const snapshots = await this.listSnapshots(roomId, 1000);

      if (snapshots.length <= keepLast) {
        return { deleted: 0 };
      }

      const toDelete = snapshots.slice(keepLast);

      for (const snapshot of toDelete) {
        await strapi.documents('plugin::magic-editor-x.document-snapshot').delete({
          documentId: snapshot.documentId,
        });
      }

      logger.info(`[Snapshot] Cleaned up ${toDelete.length} old snapshots for ${roomId}`);
      return { deleted: toDelete.length };
    } catch (error) {
      logger.error('[Snapshot] Error cleaning up snapshots:', error);
      throw error;
    }
  },
};};

/**
 * Magic Editor X - Snapshot Service
 * Handles version snapshots and recovery
 * Using Document Service API (strapi.documents) for Strapi v5
 */
'use strict';

const { encodeStateAsUpdate, encodeStateVector, applyUpdate } = require('yjs');

module.exports = ({ strapi }) => ({
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
        strapi.log.warn('[Snapshot] Could not extract JSON content:', e);
      }

      // Create snapshot
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
            createdAt: new Date(),
          },
      });

      strapi.log.info(`[Snapshot] Created v${nextVersion} for ${roomId}`);
      return snapshot;
    } catch (error) {
      strapi.log.error('[Snapshot] Error creating snapshot:', error);
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

      strapi.log.info(`[Snapshot] Restored v${snapshot.version} for ${snapshot.roomId}`);
      return snapshot;
    } catch (error) {
      strapi.log.error('[Snapshot] Error restoring snapshot:', error);
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

      strapi.log.info(`[Snapshot] Cleaned up ${toDelete.length} old snapshots for ${roomId}`);
      return { deleted: toDelete.length };
    } catch (error) {
      strapi.log.error('[Snapshot] Error cleaning up snapshots:', error);
      throw error;
    }
  },
});

/**
 * Magic Editor X - Collaboration Controller
 * Manages collaboration permissions and access
 */
'use strict';

const { createLogger } = require('../utils');

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  return {
  /**
   * List admin users for collaboration
   */
  async listAdminUsers(ctx) {
    try {
      // Note: Using strapi.query() for admin::user as Document Service doesn't support admin UIDs
      const users = await strapi.query('admin::user').findMany({
        where: { isActive: true },
        select: ['id', 'firstname', 'lastname', 'email', 'username'],
        limit: 100,
      });

      ctx.body = { data: users };
    } catch (error) {
      logger.error('[Collab] Error listing admin users:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * List all collaboration permissions
   * Using Document Service API (strapi.documents) for Strapi v5
   */
  async listPermissions(ctx) {
    try {
      const permissions = await strapi.documents('plugin::magic-editor-x.collab-permission').findMany({
          populate: ['user', 'grantedBy'],
        sort: [{ createdAt: 'desc' }],
      });

      ctx.body = { data: permissions };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Create collaboration permission
   * Checks license limits before creating
   */
  async createPermission(ctx) {
    try {
      const { userId, role, contentType, entryId, fieldName, expiresAt } = ctx.request.body;

      logger.info('[Collab] Creating permission with data:', { userId, role, contentType });

      if (!userId || !role) {
        logger.warn('[Collab] Missing userId or role');
        return ctx.badRequest('userId and role are required');
      }

      // Check collaborator limit before creating
      const accessService = strapi.plugin('magic-editor-x').service('accessService');
      const limitCheck = await accessService.checkCollaboratorLimit();
      
      if (!limitCheck.canAdd) {
        logger.warn('[Collab] Collaborator limit reached:', limitCheck);
        return ctx.forbidden({
          error: 'Collaborator limit reached',
          message: `You have reached the maximum of ${limitCheck.max} collaborators for your plan. Upgrade to add more.`,
          current: limitCheck.current,
          max: limitCheck.max,
          upgradeRequired: true,
        });
      }

      // Validiere dass User existiert
      // Note: Using strapi.query() for admin::user as Document Service doesn't support admin UIDs
      const user = await strapi.query('admin::user').findOne({
        where: { id: userId },
      });

      if (!user) {
        logger.warn('[Collab] User not found:', userId);
        return ctx.badRequest('User not found');
      }

      logger.info('[Collab] Creating permission for user:', user.email);

      // Using Document Service API (strapi.documents) for Strapi v5
      const permission = await strapi.documents('plugin::magic-editor-x.collab-permission').create({
          data: {
            user: userId,
            role,
          // null = all content types, store null not '*'
          contentType: (contentType === '*' || !contentType) ? null : contentType,
            entryId: entryId || null,
            fieldName: fieldName || null,
            expiresAt: expiresAt || null,
            grantedBy: ctx.state.user.id,
          },
      });

      logger.info('[Collab] Permission created successfully:', permission.documentId);

      ctx.body = { data: permission };
    } catch (error) {
      logger.error('[Collab] Error creating permission:', error);
      ctx.throw(500, error.message || 'Failed to create permission');
    }
  },

  /**
   * Update collaboration permission
   * Using Document Service API (strapi.documents) for Strapi v5
   * Note: Uses documentId instead of numeric id
   */
  async updatePermission(ctx) {
    try {
      const { id } = ctx.params; // This is now documentId
      const { role, contentType, entryId, fieldName, expiresAt } = ctx.request.body;

      // Build update data - only include fields that are provided
      const updateData = {};
      
      if (role !== undefined) {
        updateData.role = role;
      }
      
      if (contentType !== undefined) {
        // null or '*' means all content types
        updateData.contentType = (contentType === '*' || contentType === null) ? null : contentType;
      }
      
      if (entryId !== undefined) {
        updateData.entryId = entryId;
      }
      
      if (fieldName !== undefined) {
        updateData.fieldName = fieldName;
      }
      
      if (expiresAt !== undefined) {
        updateData.expiresAt = expiresAt;
      }

      logger.info('[Collab] Updating permission:', { documentId: id, updateData });

      const permission = await strapi.documents('plugin::magic-editor-x.collab-permission').update({
        documentId: id,
        data: updateData,
      });

      ctx.body = { data: permission };
    } catch (error) {
      logger.error('[Collab] Error updating permission:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Delete collaboration permission
   * Using Document Service API (strapi.documents) for Strapi v5
   * Note: Uses documentId instead of numeric id
   */
  async deletePermission(ctx) {
    try {
      const { id } = ctx.params; // This is now documentId

      await strapi.documents('plugin::magic-editor-x.collab-permission').delete({
        documentId: id,
      });

      ctx.body = { data: { documentId: id } };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Check if user can access a specific document
   */
  async checkAccess(ctx) {
    try {
      const { roomId, action } = ctx.query;
      const userId = ctx.state.user.id;

      if (!roomId) {
        return ctx.badRequest('roomId is required');
      }

      const canAccess = await strapi
        .plugin('magic-editor-x')
        .service('accessService')
        .canAccessRoom(userId, roomId, action || 'view');

      ctx.body = { data: { canAccess } };
    } catch (error) {
      ctx.throw(500, error);
    }
  },
};};


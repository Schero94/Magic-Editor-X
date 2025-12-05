'use strict';

/**
 * Realtime Controller
 * Handles session creation and permission checks for collaboration
 */

const pluginId = 'magic-editor-x';

/**
 * Sanitizes initial editor value to string format
 * @param {any} value - Initial value (string or object)
 * @returns {string} Sanitized string value
 */
const sanitizeInitialValue = (value) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return '';
  }
};

/**
 * Verifies admin JWT token and retrieves the admin user
 * Required because content-api routes don't auto-populate admin user
 * @param {object} strapi - Strapi instance
 * @param {object} ctx - Koa context
 * @returns {object|null} Admin user object or null if invalid
 */
const verifyAdminToken = async (strapi, ctx) => {
  const authHeader = ctx.request.header.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  
  try {
    // Decode the admin JWT token
    const decoded = await strapi.admin.services.token.decodeJwtToken(token);
    
    if (!decoded || !decoded.id) {
      return null;
    }

    // Get the admin user
    // Note: Using strapi.query() for admin::user as Document Service doesn't support admin UIDs
    const adminUser = await strapi.query('admin::user').findOne({
      where: { id: decoded.id },
      select: ['id', 'firstname', 'lastname', 'email', 'isActive'],
    });

    if (!adminUser || !adminUser.isActive) {
      return null;
    }

    return adminUser;
  } catch (error) {
    strapi.log.warn('[Realtime] Admin token verification failed:', error.message);
    return null;
  }
};

module.exports = ({ strapi }) => ({
  /**
   * POST /magic-editor-x/realtime/session
   * Issues a short-lived collaboration token for the socket handshake.
   */
  async createSession(ctx) {
    const { roomId, fieldName, meta = {}, initialValue } = ctx.request.body || {};

    strapi.log.info('[Realtime] createSession called with:', { roomId, fieldName });

    if (!roomId || !fieldName) {
      strapi.log.warn('[Realtime] Missing roomId or fieldName');
      return ctx.badRequest('roomId and fieldName are required');
    }

    // Try to get admin user from token (content-api doesn't auto-populate admin user)
    let adminUser = ctx.state?.user;
    
    // If no user in context, try to verify admin JWT token manually
    if (!adminUser || !adminUser.email) {
      adminUser = await verifyAdminToken(strapi, ctx);
    }

    if (!adminUser) {
      strapi.log.warn('[Realtime] No admin user in context or invalid token');
      return ctx.unauthorized('Admin authentication required');
    }

    strapi.log.info('[Realtime] Admin user:', {
      id: adminUser.id,
      email: adminUser.email,
      firstname: adminUser.firstname,
      lastname: adminUser.lastname,
    });

    const accessService = strapi.plugin(pluginId).service('accessService');
    
    // Extract contentType from roomId
    // New format: "contentType|documentId|fieldName" (3 parts)
    // Example: "api::session.session|abc123xyz|EditorX"
    let extractedContentType = null;
    let extractedDocumentId = null;
    if (roomId) {
      const parts = roomId.split('|');
      // parts[0] = contentType (api::xxx.xxx)
      // parts[1] = documentId (abc123xyz or 'new' or 'single')
      // parts[2] = fieldName
      if (parts.length >= 1) {
        const contentType = parts[0];
        // Check if it's a valid Strapi content type UID
        if (contentType && contentType.includes('::')) {
          extractedContentType = contentType;
        }
        if (parts[1]) {
          extractedDocumentId = parts[1];
        }
      }
      strapi.log.info('[Realtime] Parsed roomId:', { 
        contentType: extractedContentType, 
        documentId: extractedDocumentId,
        roomId 
      });
    }
    
    // canUseCollaboration ist jetzt async! Pass extracted contentType for permission check
    const access = await accessService.canUseCollaboration(adminUser, extractedContentType);

    strapi.log.info('[Realtime] Access check result:', {
      allowed: access.allowed,
      reason: access.reason || 'none',
      role: access.role || 'none',
      userId: adminUser.id,
      userEmail: adminUser.email,
      contentType: extractedContentType,
    });

    if (!access.allowed) {
      // Bessere Fehlermeldungen
      if (access.reason === 'permission-required') {
        return ctx.forbidden(
          'Du benötigst eine Freigabe für die Echtzeit-Bearbeitung. ' +
          'Bitte kontaktiere einen Super Admin, um Zugriff zu erhalten.'
        );
      }
      
      return ctx.forbidden(access.reason || 'Realtime collaboration is not enabled for your role');
    }

    const realtimeService = strapi.plugin(pluginId).service('realtimeService');

    try {
      const session = realtimeService.issueSession({
        roomId,
        fieldName,
        meta,
        user: adminUser,
        initialValue: sanitizeInitialValue(initialValue),
      });

      strapi.log.info('[Realtime] [SUCCESS] Session created successfully with role:', access.role);

      // Include the user's collaboration role in the response
      ctx.body = {
        ...session,
        role: access.role || 'viewer', // Default to viewer if no role
        canEdit: ['editor', 'owner'].includes(access.role),
      };
    } catch (error) {
      if (error.message === 'collaboration-disabled') {
        return ctx.forbidden('Realtime collaboration is disabled');
      }

      strapi.log.error('[Magic Editor X] Failed to create realtime session', error);
      ctx.internalServerError('Unable to create realtime session');
    }
  },
});

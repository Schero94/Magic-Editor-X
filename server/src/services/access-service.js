'use strict';

const pluginId = 'magic-editor-x';

/**
 * Extracts role codes from user object
 * @param {object} user - User object with roles
 * @returns {string[]} Array of role codes
 */
const getRoleCodes = (user) => {
  if (!user?.roles) {
    return [];
  }

  return user.roles
    .map((role) => role?.code || role?.name)
    .filter(Boolean);
};

module.exports = ({ strapi }) => {
  const getConfig = () => strapi.config.get(`plugin::${pluginId}`, {});

  return {
    /**
     * Prüft ob ein User Collaboration nutzen darf
     * Standard: Nur Super Admins haben automatisch Zugriff
     * Alle anderen brauchen explizite Freigabe über collab-permission
     * 
     * @param {Object} user - Der Admin User
     * @param {string} contentType - Optional: Der spezifische Content Type (z.B. 'api::article.article')
     */
    async canUseCollaboration(user, contentType = null) {
      if (!user) {
        strapi.log.warn('[Access Service] No user provided');
        return { allowed: false, reason: 'not-authenticated', role: null };
      }

      strapi.log.info('[Access Service] Checking access for user:', user.email, 'contentType:', contentType);

      const config = getConfig();
      const collab = config.collaboration || {};

      // Wenn explizit deaktiviert
      if (collab.enabled === false) {
        strapi.log.info('[Access Service] Collaboration is disabled');
        return { allowed: false, reason: 'collaboration-disabled', role: null };
      }

      // Super Admins haben immer Zugriff als Owner
      const userRoleCodes = getRoleCodes(user);
      const isSuperAdmin = userRoleCodes.includes('strapi-super-admin');
      
      strapi.log.info('[Access Service] User roles:', userRoleCodes, 'isSuperAdmin:', isSuperAdmin);
      
      if (isSuperAdmin) {
        strapi.log.info('[Access Service] [SUCCESS] Super Admin access granted');
        return { allowed: true, reason: 'super-admin', role: 'owner' };
      }

      // Prüfe explizite Permissions für nicht-Super-Admins
      // Using Document Service API (strapi.documents) for Strapi v5
      // Note: Deep filtering required for relations - { user: { id: ... } }
      try {
        const permissions = await strapi.documents('plugin::magic-editor-x.collab-permission').findMany({
            filters: {
              user: { id: user.id },
            },
        });

        strapi.log.info('[Access Service] Found permissions:', permissions?.length || 0);

        if (permissions && permissions.length > 0) {
          // Finde die beste passende Permission
          let bestPermission = null;
          
          for (const perm of permissions) {
            strapi.log.info('[Access Service] Checking permission:', {
              permContentType: perm.contentType,
              requestedContentType: contentType,
              role: perm.role,
              expiresAt: perm.expiresAt,
            });
            
            // Check if permission is expired
            if (perm.expiresAt && new Date(perm.expiresAt) < new Date()) {
              strapi.log.info('[Access Service] Permission expired, skipping');
              continue;
            }
            
            // Globale Permission (null, '*', oder leer = Zugriff auf ALLES)
            if (!perm.contentType || perm.contentType === '*' || perm.contentType === '') {
              strapi.log.info('[Access Service] ✅ Global permission found');
              if (!bestPermission || this.getRoleLevel(perm.role) > this.getRoleLevel(bestPermission.role)) {
                bestPermission = perm;
              }
            }
            // Spezifische Content Type Permission
            else if (contentType && perm.contentType === contentType) {
              strapi.log.info('[Access Service] ✅ Specific content type match');
              // Spezifische Permission hat Vorrang
              bestPermission = perm;
              break;
            }
            // Auch matchen wenn contentType "unknown" ist (z.B. Plugin-Seite)
            // In diesem Fall jede existierende Permission akzeptieren
            else if (!contentType || contentType === 'unknown') {
              strapi.log.info('[Access Service] ✅ Unknown/null contentType - accepting any permission');
              if (!bestPermission || this.getRoleLevel(perm.role) > this.getRoleLevel(bestPermission.role)) {
                bestPermission = perm;
              }
            }
          }
          
          if (bestPermission) {
            strapi.log.info('[Access Service] ✅ Permission granted via collab-permission, role:', bestPermission.role);
            return { 
              allowed: true, 
              reason: 'explicit-permission', 
              role: bestPermission.role,
              permission: bestPermission
            };
          }
        }
      } catch (error) {
        strapi.log.error('[Access Service] Error checking permissions:', error);
      }

      // Keine Berechtigung
      strapi.log.info('[Access Service] [DENIED] No permission found for user');
      return { allowed: false, reason: 'permission-required', role: null };
    },

    /**
     * Hilfsfunktion: Gibt Rollen-Level zurück (höher = mehr Rechte)
     */
    getRoleLevel(role) {
      const levels = { viewer: 1, editor: 2, owner: 3 };
      return levels[role] || 0;
    },

    /**
     * Checks if a new collaborator can be added based on license limits
     * @returns {Promise<object>} Result with canAdd, current, max, and unlimited flags
     */
    async checkCollaboratorLimit() {
      try {
        const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
        return await licenseService.canAddCollaborator();
      } catch (error) {
        strapi.log.error('[Access Service] Error checking collaborator limit:', error);
        // Default to allowing in case of error (fail open for free tier)
        return {
          canAdd: true,
          current: 0,
          max: 2,
          unlimited: false,
          error: true,
        };
      }
    },

    /**
     * Prüft ob User Zugriff auf einen bestimmten Room hat
     */
    async canAccessRoom(userId, roomId, action = 'view') {
      try {
        // Super Admin Check
        // Note: Using strapi.query() for admin::user as Document Service doesn't support admin UIDs
        const user = await strapi.query('admin::user').findOne({
          where: { id: userId },
          populate: ['roles'],
        });

        if (!user) {
          return false;
        }

        const userRoleCodes = getRoleCodes(user);
        const isSuperAdmin = userRoleCodes.includes('strapi-super-admin');

        if (isSuperAdmin) {
          return true;
        }

        // Parse roomId to get contentType
        // New format: "contentType|documentId|fieldName" (3 parts)
        // Example: "api::session.session|abc123xyz|EditorX"
        let contentTypeFromRoom = null;
        if (roomId) {
          const parts = roomId.split('|');
          // First part is the content type UID
          if (parts.length >= 1 && parts[0]?.includes('::')) {
            contentTypeFromRoom = parts[0];
          }
        }

        // Permission Check für andere User
        // Using Document Service API (strapi.documents) for Strapi v5
        // Note: Deep filtering required for relations - { user: { id: ... } }
        const permissions = await strapi.documents('plugin::magic-editor-x.collab-permission').findMany({
            filters: {
              user: { id: userId },
            },
        });

        if (!permissions || permissions.length === 0) {
          return false;
        }

        // Check if any permission matches
        const hasValidPermission = permissions.some(perm => {
          // Global permission ('*' or null or empty)
          if (!perm.contentType || perm.contentType === '*') {
            return true;
          }
          // Specific content type permission
          if (contentTypeFromRoom && perm.contentType === contentTypeFromRoom) {
            return true;
          }
          return false;
        });

        if (!hasValidPermission) {
          return false;
        }

        // Prüfe Rolle basierend auf Action
        const permission = permissions[0];
        if (action === 'view') {
          return ['viewer', 'editor', 'owner'].includes(permission.role);
        }
        if (action === 'edit') {
          return ['editor', 'owner'].includes(permission.role);
        }
        if (action === 'manage') {
          return permission.role === 'owner';
        }

        return false;
      } catch (error) {
        strapi.log.error('[Access Service] Error checking room access:', error);
        return false;
      }
    },
  };
};


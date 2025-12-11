/**
 * License Controller for Magic Editor X
 * Manages license operations from the Admin Panel
 */

'use strict';

const { createLogger } = require('../utils');

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  return {
  /**
   * Auto-create a FREE license with logged-in admin user data
   */
  async autoCreate(ctx) {
    try {
      const adminUser = ctx.state.user;
      
      if (!adminUser) {
        return ctx.unauthorized('No admin user logged in');
      }

      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      
      // Create license with admin user data
      const license = await licenseService.createLicense({ 
        email: adminUser.email,
        firstName: adminUser.firstname || 'Admin',
        lastName: adminUser.lastname || 'User',
      });

      if (!license) {
        return ctx.badRequest('Failed to create license');
      }

      // Store the license key
      await licenseService.storeLicenseKey(license.licenseKey);

      // Start pinging
      const pingInterval = licenseService.startPinging(license.licenseKey, 15);

      // Update global license guard
      strapi.licenseGuardEditorX = {
        licenseKey: license.licenseKey,
        pingInterval,
        data: license,
        tier: 'free',
      };

      return ctx.send({
        success: true,
        message: 'License automatically created and activated',
        data: license,
      });
    } catch (error) {
      logger.error('[Magic Editor X] Error auto-creating license:', error);
      return ctx.badRequest('Error creating license');
    }
  },

  /**
   * Get current license status
   */
  async getStatus(ctx) {
    try {
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      const licenseKey = await licenseService.getStoredLicenseKey();

      if (!licenseKey) {
        return ctx.send({
          success: false,
          demo: true,
          valid: false,
          tier: 'free',
          message: 'No license found. Running in FREE mode.',
        });
      }

      const verification = await licenseService.verifyLicense(licenseKey);
      const license = await licenseService.getLicenseByKey(licenseKey);
      const tier = await licenseService.getCurrentTier();

      return ctx.send({
        success: true,
        valid: verification.valid,
        demo: false,
        tier,
        data: {
          licenseKey,
          email: license?.email || null,
          firstName: license?.firstName || null,
          lastName: license?.lastName || null,
          isActive: license?.isActive || false,
          isExpired: license?.isExpired || false,
          isOnline: license?.isOnline || false,
          expiresAt: license?.expiresAt,
          lastPingAt: license?.lastPingAt,
          deviceName: license?.deviceName,
          features: {
            premium: license?.featurePremium || false,
            advanced: license?.featureAdvanced || false,
            enterprise: license?.featureEnterprise || false,
          },
        },
      });
    } catch (error) {
      logger.error('[Magic Editor X] Error getting license status:', error);
      return ctx.badRequest('Error getting license status');
    }
  },

  /**
   * Store and validate an existing license key
   */
  async storeKey(ctx) {
    try {
      const { licenseKey, email } = ctx.request.body;

      if (!licenseKey || !licenseKey.trim()) {
        return ctx.badRequest('License key is required');
      }

      if (!email || !email.trim()) {
        return ctx.badRequest('Email address is required');
      }

      const trimmedKey = licenseKey.trim();
      const trimmedEmail = email.trim().toLowerCase();
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');

      // Verify the license key
      const verification = await licenseService.verifyLicense(trimmedKey);

      if (!verification.valid) {
        logger.warn(`[Magic Editor X] [WARNING] Invalid license key attempted: ${trimmedKey.substring(0, 8)}...`);
        return ctx.badRequest('Invalid or expired license key');
      }

      // Get license details to verify email
      const license = await licenseService.getLicenseByKey(trimmedKey);
      
      if (!license) {
        return ctx.badRequest('License not found');
      }

      // Verify email matches
      if (license.email.toLowerCase() !== trimmedEmail) {
        logger.warn(`[Magic Editor X] [WARNING] Email mismatch for license key`);
        return ctx.badRequest('Email address does not match this license key');
      }

      // Store the license key
      await licenseService.storeLicenseKey(trimmedKey);

      // Start pinging
      const pingInterval = licenseService.startPinging(trimmedKey, 15);
      const tier = await licenseService.getCurrentTier();

      // Update global license guard
      strapi.licenseGuardEditorX = {
        licenseKey: trimmedKey,
        pingInterval,
        data: verification.data,
        tier,
      };

      logger.info(`[Magic Editor X] [SUCCESS] License validated and stored`);

      return ctx.send({
        success: true,
        message: 'License activated successfully',
        tier,
        data: verification.data,
      });
    } catch (error) {
      logger.error('[Magic Editor X] Error storing license key:', error);
      return ctx.badRequest('Error storing license key');
    }
  },

  /**
   * Get license limits and available features
   */
  async getLimits(ctx) {
    try {
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      
      const tier = await licenseService.getCurrentTier();
      const tierConfig = licenseService.getTierConfig(tier);
      const collaboratorCheck = await licenseService.canAddCollaborator();

      ctx.body = {
        success: true,
        tier,
        tierName: tierConfig.name,
        limits: {
          collaborators: {
            current: collaboratorCheck.current,
            max: collaboratorCheck.max,
            unlimited: collaboratorCheck.unlimited,
            canAdd: collaboratorCheck.canAdd,
          },
        },
        features: tierConfig.features,
      };
    } catch (error) {
      logger.error('[Magic Editor X] Error getting license limits:', error);
      ctx.throw(500, 'Error getting license limits');
    }
  },

  /**
   * Check if user can add a collaborator (used by frontend)
   */
  async canAddCollaborator(ctx) {
    try {
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      const result = await licenseService.canAddCollaborator();
      
      ctx.body = {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error('[Magic Editor X] Error checking collaborator limit:', error);
      ctx.throw(500, 'Error checking collaborator limit');
    }
  },
};};


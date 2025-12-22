/**
 * License Service for Magic Editor X
 * Handles license creation, verification, and limit management
 * 
 * Tier Limits:
 * - FREE: 2 Collaborators
 * - PREMIUM: 10 Collaborators
 * - ADVANCED: Unlimited Collaborators
 */

'use strict';

const crypto = require('crypto');
const os = require('os');
const { createLogger } = require('../utils');

// License Server URL
const LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';

// Plugin name for license server
const PLUGIN_NAME = 'magic-editor-x';
const PRODUCT_NAME = 'Magic Editor X - Collaborative Editor';

// Tier configurations
const TIERS = {
  free: {
    name: 'FREE',
    maxCollaborators: 2,
    features: {
      editor: true,
      allTools: true,
      collaboration: true,
      ai: false,
      customBlocks: {
        maxSimple: 3,
        maxEmbedded: 0,
        maxTotal: 3,
        exportImport: false,
        apiAccess: false,
      },
    },
  },
  premium: {
    name: 'PREMIUM',
    maxCollaborators: 10,
    features: {
      editor: true,
      allTools: true,
      collaboration: true,
      ai: true,
      customBlocks: {
        maxSimple: -1, // Unlimited simple within total
        maxEmbedded: -1, // Unlimited embedded within total
        maxTotal: 10, // Combined limit
        exportImport: false,
        apiAccess: false,
      },
    },
  },
  advanced: {
    name: 'ADVANCED',
    maxCollaborators: -1, // Unlimited
    features: {
      editor: true,
      allTools: true,
      collaboration: true,
      ai: true,
      customBlocks: {
        maxSimple: -1, // Unlimited
        maxEmbedded: -1, // Unlimited
        maxTotal: -1, // Unlimited
        exportImport: true,
        apiAccess: true,
      },
    },
  },
  enterprise: {
    name: 'ENTERPRISE',
    maxCollaborators: -1, // Unlimited
    features: {
      editor: true,
      allTools: true,
      collaboration: true,
      ai: true,
      prioritySupport: true,
      customBlocks: {
        maxSimple: -1, // Unlimited
        maxEmbedded: -1, // Unlimited
        maxTotal: -1, // Unlimited
        exportImport: true,
        apiAccess: true,
      },
    },
  },
};

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  return {
  /**
   * Get license server URL
   * @returns {string} License server URL
   */
  getLicenseServerUrl() {
    return LICENSE_SERVER_URL;
  },

  /**
   * Generate unique device ID based on hardware
   * @returns {string} 32-character device ID
   */
  generateDeviceId() {
    try {
      const networkInterfaces = os.networkInterfaces();
      const macAddresses = [];
      
      Object.values(networkInterfaces).forEach(interfaces => {
        interfaces?.forEach(iface => {
          if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
            macAddresses.push(iface.mac);
          }
        });
      });
      
      const identifier = `${macAddresses.join('-')}-${os.hostname()}`;
      return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 32);
    } catch (error) {
      return crypto.randomBytes(16).toString('hex');
    }
  },

  /**
   * Get device hostname
   * @returns {string} Device name
   */
  getDeviceName() {
    try {
      return os.hostname() || 'Unknown Device';
    } catch (error) {
      return 'Unknown Device';
    }
  },

  /**
   * Get external IP address
   * @returns {string} IP address
   */
  getIpAddress() {
    try {
      const networkInterfaces = os.networkInterfaces();
      for (const name of Object.keys(networkInterfaces)) {
        const interfaces = networkInterfaces[name];
        if (interfaces) {
          for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
              return iface.address;
            }
          }
        }
      }
      return '127.0.0.1';
    } catch (error) {
      return '127.0.0.1';
    }
  },

  /**
   * Get user agent string for license requests
   * @returns {string} User agent
   */
  getUserAgent() {
    try {
      const pluginPkg = require('../../../package.json');
      const pluginVersion = pluginPkg.version || '1.0.0';
      const strapiVersion = strapi.config.get('info.strapi') || '5.0.0';
      return `MagicEditorX/${pluginVersion} Strapi/${strapiVersion} Node/${process.version} ${os.platform()}/${os.release()}`;
    } catch (error) {
      return `MagicEditorX/1.0.0 Node/${process.version}`;
    }
  },

  /**
   * Create a new license
   * @param {object} params - License parameters
   * @param {string} params.email - User email
   * @param {string} params.firstName - User first name
   * @param {string} params.lastName - User last name
   * @returns {Promise<object|null>} Created license or null
   */
  async createLicense({ email, firstName, lastName }) {
    try {
      const deviceId = this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const response = await fetch(`${LICENSE_SERVER_URL}/api/licenses/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          deviceName,
          deviceId,
          ipAddress,
          userAgent,
          pluginName: PLUGIN_NAME,
          productName: PRODUCT_NAME,
        }),
      });

      const data = await response.json();

      if (data.success) {
        logger.info(`[Magic Editor X] [SUCCESS] License created: ${data.data.licenseKey}`);
        return data.data;
      } else {
        logger.error('[Magic Editor X] [ERROR] License creation failed:', data);
        return null;
      }
    } catch (error) {
      logger.error('[Magic Editor X] [ERROR] Error creating license:', error);
      return null;
    }
  },

  /**
   * Verify a license key
   * @param {string} licenseKey - License key to verify
   * @param {boolean} allowGracePeriod - Allow offline grace period
   * @returns {Promise<object>} Verification result
   */
  async verifyLicense(licenseKey, allowGracePeriod = false) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${LICENSE_SERVER_URL}/api/licenses/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          licenseKey,
          pluginName: PLUGIN_NAME,
          productName: PRODUCT_NAME,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();

      if (data.success && data.data) {
        return { valid: true, data: data.data, gracePeriod: false };
      } else {
        return { valid: false, data: null };
      }
    } catch (error) {
      if (allowGracePeriod) {
        logger.warn('[Magic Editor X] [WARNING] License verification timeout - grace period active');
        return { valid: true, data: null, gracePeriod: true };
      }
      logger.error('[Magic Editor X] [ERROR] License verification error:', error.message);
      return { valid: false, data: null };
    }
  },

  /**
   * Get license details by key
   * @param {string} licenseKey - License key
   * @returns {Promise<object|null>} License data or null
   */
  async getLicenseByKey(licenseKey) {
    try {
      const response = await fetch(`${LICENSE_SERVER_URL}/api/licenses/key/${licenseKey}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success && data.data) {
        return data.data;
      }
      
      return null;
    } catch (error) {
      logger.error('[Magic Editor X] Error fetching license by key:', error);
      return null;
    }
  },

  /**
   * Ping license server to update online status
   * @param {string} licenseKey - License key
   * @returns {Promise<object|null>} Ping result or null
   */
  async pingLicense(licenseKey) {
    try {
      const deviceId = this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const response = await fetch(`${LICENSE_SERVER_URL}/api/licenses/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          deviceId,
          deviceName,
          ipAddress,
          userAgent,
          pluginName: PLUGIN_NAME,
        }),
      });

      const data = await response.json();
      return data.success ? data.data : null;
    } catch (error) {
      // Silent fail for pings
      return null;
    }
  },

  /**
   * Store license key in plugin store
   * @param {string} licenseKey - License key to store
   */
  async storeLicenseKey(licenseKey) {
    const pluginStore = strapi.store({ 
      type: 'plugin', 
      name: 'magic-editor-x' 
    });
    await pluginStore.set({ key: 'licenseKey', value: licenseKey });
    logger.info(`[Magic Editor X] [SUCCESS] License key stored: ${licenseKey.substring(0, 8)}...`);
  },

  /**
   * Get stored license key
   * @returns {Promise<string|null>} License key or null
   */
  async getStoredLicenseKey() {
    const pluginStore = strapi.store({ 
      type: 'plugin', 
      name: 'magic-editor-x' 
    });
    return await pluginStore.get({ key: 'licenseKey' });
  },

  /**
   * Start automatic license pinging
   * @param {string} licenseKey - License key
   * @param {number} intervalMinutes - Ping interval in minutes
   * @returns {NodeJS.Timeout} Interval handle
   */
  startPinging(licenseKey, intervalMinutes = 15) {
    // Immediate ping
    this.pingLicense(licenseKey);
    
    const interval = setInterval(async () => {
      try {
        await this.pingLicense(licenseKey);
      } catch (error) {
        // Silent fail
      }
    }, intervalMinutes * 60 * 1000);

    return interval;
  },

  /**
   * Get current license data from store and server
   * @returns {Promise<object|null>} License data or null
   */
  async getCurrentLicense() {
    try {
      const licenseKey = await this.getStoredLicenseKey();

      if (!licenseKey) {
        return null;
      }

      const license = await this.getLicenseByKey(licenseKey);
      return license;
    } catch (error) {
      logger.error(`[Magic Editor X] [ERROR] Error loading license:`, error);
      return null;
    }
  },

  /**
   * Get current tier based on license
   * @returns {Promise<string>} Tier name (free, premium, advanced, enterprise)
   */
  async getCurrentTier() {
    const license = await this.getCurrentLicense();
    
    if (!license) {
      return 'free';
    }

    // Check tier flags from license server
    if (license.featureEnterprise === true) return 'enterprise';
    if (license.featureAdvanced === true) return 'advanced';
    if (license.featurePremium === true) return 'premium';
    
    return 'free';
  },

  /**
   * Get tier configuration
   * @param {string} tierName - Tier name
   * @returns {object} Tier configuration
   */
  getTierConfig(tierName) {
    return TIERS[tierName] || TIERS.free;
  },

  /**
   * Get maximum allowed collaborators for current license
   * @returns {Promise<number>} Max collaborators (-1 for unlimited)
   */
  async getMaxCollaborators() {
    const tier = await this.getCurrentTier();
    const config = this.getTierConfig(tier);
    return config.maxCollaborators;
  },

  /**
   * Check if a specific feature is available
   * @param {string} featureName - Feature name
   * @returns {Promise<boolean>} Feature availability
   */
  async hasFeature(featureName) {
    const tier = await this.getCurrentTier();
    const config = this.getTierConfig(tier);
    return config.features[featureName] === true;
  },

  /**
   * Get custom blocks configuration for current tier
   * @returns {Promise<object>} Custom blocks limits and features
   */
  async getCustomBlocksConfig() {
    const tier = await this.getCurrentTier();
    const config = this.getTierConfig(tier);
    return config.features.customBlocks || {
      maxSimple: 3,
      maxEmbedded: 0,
      maxTotal: 3,
      exportImport: false,
      apiAccess: false,
    };
  },

  /**
   * Check if user can add more collaborators
   * @returns {Promise<object>} Check result with canAdd and current/max counts
   */
  async canAddCollaborator() {
    const maxCollaborators = await this.getMaxCollaborators();
    
    // Count current collaborators (permissions)
    const currentCount = await strapi.documents('plugin::magic-editor-x.collab-permission').count();
    
    const canAdd = maxCollaborators === -1 || currentCount < maxCollaborators;
    
    return {
      canAdd,
      current: currentCount,
      max: maxCollaborators,
      unlimited: maxCollaborators === -1,
    };
  },

  /**
   * Initialize license service on plugin startup
   * @returns {Promise<object>} Initialization result
   */
  async initialize() {
    try {
      logger.info('[Magic Editor X] [INIT] Initializing License Service...');

      const licenseKey = await this.getStoredLicenseKey();
      
      if (!licenseKey) {
        logger.info('[Magic Editor X] [FREE] No license found - Running in FREE mode (2 Collaborators)');
        return {
          valid: false,
          demo: true,
          tier: 'free',
          data: null,
        };
      }

      // Verify license
      const pluginStore = strapi.store({ 
        type: 'plugin', 
        name: 'magic-editor-x' 
      });
      const lastValidated = await pluginStore.get({ key: 'lastValidated' });
      const now = new Date();
      const gracePeriodHours = 24;
      let withinGracePeriod = false;
      
      if (lastValidated) {
        const lastValidatedDate = new Date(lastValidated);
        const hoursSinceValidation = (now.getTime() - lastValidatedDate.getTime()) / (1000 * 60 * 60);
        withinGracePeriod = hoursSinceValidation < gracePeriodHours;
      }

      const verification = await this.verifyLicense(licenseKey, withinGracePeriod);

      if (verification.valid) {
        const license = await this.getLicenseByKey(licenseKey);
        const tier = await this.getCurrentTier();
        const tierConfig = this.getTierConfig(tier);
        
        // Update last validated timestamp
        await pluginStore.set({ 
          key: 'lastValidated', 
          value: now.toISOString() 
        });

        // Start pinging
        const pingInterval = this.startPinging(licenseKey, 15);
        
        // Store interval globally
        strapi.licenseGuardEditorX = {
          licenseKey,
          pingInterval,
          data: verification.data,
          tier,
        };

        logger.info('==================================================================');
        logger.info('[SUCCESS] MAGIC EDITOR X LICENSE ACTIVE');
        logger.info(`  License: ${licenseKey.substring(0, 15)}...`);
        logger.info(`  Tier: ${tierConfig.name}`);
        logger.info(`  Collaborators: ${tierConfig.maxCollaborators === -1 ? 'Unlimited' : tierConfig.maxCollaborators}`);
        logger.info(`  User: ${license?.firstName} ${license?.lastName}`);
        logger.info('==================================================================');

        return {
          valid: true,
          demo: false,
          tier,
          data: verification.data,
          gracePeriod: verification.gracePeriod || false,
        };
      } else {
        logger.warn('[Magic Editor X] [WARNING] License validation failed - Running in FREE mode');
        return {
          valid: false,
          demo: true,
          tier: 'free',
          error: 'Invalid or expired license',
          data: null,
        };
      }
    } catch (error) {
      logger.error('[Magic Editor X] [ERROR] Error initializing License Service:', error);
      return {
        valid: false,
        demo: true,
        tier: 'free',
        error: error.message,
        data: null,
      };
    }
  },
};};


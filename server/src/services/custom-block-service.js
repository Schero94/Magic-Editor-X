/**
 * Custom Block Service
 * Handles CRUD operations for user-defined custom blocks
 */
'use strict';

const { logger } = require('../utils');

/**
 * Get the content type UID for custom blocks
 * @returns {string}
 */
const getCustomBlockUID = () => 'plugin::magic-editor-x.custom-block';

module.exports = ({ strapi }) => ({
  /**
   * Count blocks by type using native count() method
   * @returns {Promise<object>} Block counts by type
   */
  async countBlocks() {
    try {
      // Use native count() for better performance (no data loading)
      const [total, embedded] = await Promise.all([
        strapi.documents(getCustomBlockUID()).count(),
        strapi.documents(getCustomBlockUID()).count({
          filters: { blockType: 'embedded-entry' },
        }),
      ]);
      
      return {
        simple: total - embedded,
        'embedded-entry': embedded,
        total,
      };
      
    } catch (error) {
      logger.error('[CustomBlockService] Error counting blocks:', error);
      throw error;
    }
  },

  /**
   * Get block limits based on current license tier
   * @returns {Promise<object>} Limits and usage information
   */
  async getBlockLimits() {
    try {
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      const tier = await licenseService.getCurrentTier();
      const config = await licenseService.getCustomBlocksConfig();
      const counts = await this.countBlocks();
      
      return {
        tier,
        limits: {
          maxSimple: config.maxSimple,
          maxEmbedded: config.maxEmbedded,
          maxTotal: config.maxTotal,
          exportImport: config.exportImport,
          apiAccess: config.apiAccess,
        },
        usage: {
          simple: counts.simple,
          embedded: counts['embedded-entry'],
          total: counts.total,
        },
        canCreateSimple: this._canCreateBlockType('simple', counts, config),
        canCreateEmbedded: this._canCreateBlockType('embedded-entry', counts, config),
      };
      
    } catch (error) {
      logger.error('[CustomBlockService] Error getting block limits:', error);
      throw error;
    }
  },

  /**
   * Internal helper to check if a block type can be created
   * @param {string} blockType - Block type to check
   * @param {object} counts - Current block counts
   * @param {object} config - Tier configuration
   * @returns {boolean}
   */
  _canCreateBlockType(blockType, counts, config) {
    // Check total limit first
    if (config.maxTotal !== -1 && counts.total >= config.maxTotal) {
      return false;
    }
    
    // Check type-specific limits
    if (blockType === 'simple') {
      return config.maxSimple === -1 || counts.simple < config.maxSimple;
    } else if (blockType === 'embedded-entry') {
      return config.maxEmbedded === -1 || counts['embedded-entry'] < config.maxEmbedded;
    }
    
    return false;
  },

  /**
   * Check if a new block of the given type can be created
   * @param {string} blockType - Block type to check
   * @returns {Promise<object>} Check result with canCreate and reason
   */
  async canCreateBlock(blockType = 'simple') {
    try {
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      const tier = await licenseService.getCurrentTier();
      const config = await licenseService.getCustomBlocksConfig();
      const counts = await this.countBlocks();
      
      // Check total limit
      if (config.maxTotal !== -1 && counts.total >= config.maxTotal) {
        return {
          canCreate: false,
          reason: 'TOTAL_LIMIT_REACHED',
          message: `Maximum of ${config.maxTotal} custom blocks reached. Upgrade to create more.`,
          tier,
          current: counts.total,
          max: config.maxTotal,
        };
      }
      
      // Check type-specific limit
      if (blockType === 'simple') {
        if (config.maxSimple !== -1 && counts.simple >= config.maxSimple) {
          return {
            canCreate: false,
            reason: 'SIMPLE_LIMIT_REACHED',
            message: `Maximum of ${config.maxSimple} simple blocks reached. Upgrade to create more.`,
            tier,
            current: counts.simple,
            max: config.maxSimple,
          };
        }
      } else if (blockType === 'embedded-entry') {
        if (config.maxEmbedded === 0) {
          return {
            canCreate: false,
            reason: 'EMBEDDED_NOT_AVAILABLE',
            message: 'Embedded Entry blocks require Premium or higher tier.',
            tier,
            current: counts['embedded-entry'],
            max: config.maxEmbedded,
          };
        }
        if (config.maxEmbedded !== -1 && counts['embedded-entry'] >= config.maxEmbedded) {
          return {
            canCreate: false,
            reason: 'EMBEDDED_LIMIT_REACHED',
            message: `Maximum of ${config.maxEmbedded} embedded entry blocks reached. Upgrade to create more.`,
            tier,
            current: counts['embedded-entry'],
            max: config.maxEmbedded,
          };
        }
      }
      
      return {
        canCreate: true,
        reason: null,
        message: null,
        tier,
      };
      
    } catch (error) {
      logger.error('[CustomBlockService] Error checking block creation:', error);
      throw error;
    }
  },

  /**
   * Find all custom blocks
   * @param {object} params - Query parameters
   * @param {boolean} params.enabledOnly - Only return enabled blocks
   * @returns {Promise<Array>}
   */
  async findAll({ enabledOnly = true } = {}) {
    try {
      const filters = {};
      
      if (enabledOnly) {
        filters.enabled = true;
      }
      
      const blocks = await strapi.documents(getCustomBlockUID()).findMany({
        filters,
        sort: { sortOrder: 'asc', createdAt: 'asc' },
        populate: ['createdByUser'],
      });
      
      logger.info(`[CustomBlockService] Found ${blocks.length} custom blocks`);
      return blocks;
      
    } catch (error) {
      logger.error('[CustomBlockService] Error finding blocks:', error);
      throw error;
    }
  },

  /**
   * Find a single custom block by ID
   * @param {string} documentId - Block document ID
   * @returns {Promise<object|null>}
   */
  async findOne(documentId) {
    try {
      const block = await strapi.documents(getCustomBlockUID()).findOne({
        documentId,
        populate: ['createdByUser'],
      });
      
      return block;
      
    } catch (error) {
      logger.error(`[CustomBlockService] Error finding block ${documentId}:`, error);
      throw error;
    }
  },

  /**
   * Find a custom block by name
   * @param {string} name - Block name
   * @returns {Promise<object|null>}
   */
  async findByName(name) {
    try {
      const blocks = await strapi.documents(getCustomBlockUID()).findMany({
        filters: { name },
        limit: 1,
      });
      
      return blocks.length > 0 ? blocks[0] : null;
      
    } catch (error) {
      logger.error(`[CustomBlockService] Error finding block by name ${name}:`, error);
      throw error;
    }
  },

  /**
   * Create a new custom block
   * @param {object} data - Block data
   * @param {object} user - Admin user creating the block
   * @param {boolean} skipLimitCheck - Skip limit check (for imports)
   * @returns {Promise<object>}
   */
  async create(data, user = null, skipLimitCheck = false) {
    try {
      // Validate block name format
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(data.name)) {
        throw new Error('Block name must start with a letter and contain only letters, numbers, underscores, and hyphens');
      }
      
      // Check if name already exists
      const existing = await this.findByName(data.name);
      if (existing) {
        throw new Error(`A block with name "${data.name}" already exists`);
      }
      
      // Check tier limits before creating
      if (!skipLimitCheck) {
        const blockType = data.blockType || 'simple';
        const limitCheck = await this.canCreateBlock(blockType);
        
        if (!limitCheck.canCreate) {
          const error = new Error(limitCheck.message);
          error.code = 'LIMIT_EXCEEDED';
          error.reason = limitCheck.reason;
          error.tier = limitCheck.tier;
          throw error;
        }
      }
      
      // Prepare block data
      const blockData = {
        name: data.name,
        label: data.label || data.name,
        blockType: data.blockType || 'simple',
        description: data.description || '',
        icon: data.icon || null,
        contentType: data.contentType || null,
        displayFields: data.displayFields || ['title', 'name', 'id'],
        titleField: data.titleField || 'title',
        previewFields: data.previewFields || [],
        fields: data.fields || [],
        template: data.template || null,
        placeholder: data.placeholder || 'Enter content...',
        styles: data.styles || {},
        inlineToolbar: data.inlineToolbar !== false,
        tunes: data.tunes || [],
        shortcut: data.shortcut || null,
        sortOrder: data.sortOrder || 0,
        enabled: data.enabled !== false,
        createdByUser: user ? user.id : null,
      };
      
      const block = await strapi.documents(getCustomBlockUID()).create({
        data: blockData,
      });
      
      logger.info(`[CustomBlockService] Created custom block: ${block.name}`);
      return block;
      
    } catch (error) {
      logger.error('[CustomBlockService] Error creating block:', error);
      throw error;
    }
  },

  /**
   * Update an existing custom block
   * @param {string} documentId - Block document ID
   * @param {object} data - Updated block data
   * @returns {Promise<object>}
   */
  async update(documentId, data) {
    try {
      // Get existing block
      const existing = await this.findOne(documentId);
      if (!existing) {
        throw new Error(`Block with ID "${documentId}" not found`);
      }
      
      // If name is being changed, validate it
      if (data.name && data.name !== existing.name) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(data.name)) {
          throw new Error('Block name must start with a letter and contain only letters, numbers, underscores, and hyphens');
        }
        
        const nameExists = await this.findByName(data.name);
        if (nameExists) {
          throw new Error(`A block with name "${data.name}" already exists`);
        }
      }
      
      // Prepare update data (only include provided fields)
      const updateData = {};
      const allowedFields = [
        'name', 'label', 'blockType', 'description', 'icon',
        'contentType', 'displayFields', 'titleField', 'previewFields',
        'fields', 'template', 'placeholder', 'styles',
        'inlineToolbar', 'tunes', 'shortcut', 'sortOrder', 'enabled',
      ];
      
      allowedFields.forEach((field) => {
        if (data[field] !== undefined) {
          updateData[field] = data[field];
        }
      });
      
      const block = await strapi.documents(getCustomBlockUID()).update({
        documentId,
        data: updateData,
      });
      
      logger.info(`[CustomBlockService] Updated custom block: ${block.name}`);
      return block;
      
    } catch (error) {
      logger.error(`[CustomBlockService] Error updating block ${documentId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a custom block
   * @param {string} documentId - Block document ID
   * @returns {Promise<object>}
   */
  async delete(documentId) {
    try {
      const existing = await this.findOne(documentId);
      if (!existing) {
        throw new Error(`Block with ID "${documentId}" not found`);
      }
      
      await strapi.documents(getCustomBlockUID()).delete({
        documentId,
      });
      
      logger.info(`[CustomBlockService] Deleted custom block: ${existing.name}`);
      return { success: true, deleted: existing };
      
    } catch (error) {
      logger.error(`[CustomBlockService] Error deleting block ${documentId}:`, error);
      throw error;
    }
  },

  /**
   * Toggle block enabled status
   * @param {string} documentId - Block document ID
   * @returns {Promise<object>}
   */
  async toggle(documentId) {
    try {
      const existing = await this.findOne(documentId);
      if (!existing) {
        throw new Error(`Block with ID "${documentId}" not found`);
      }
      
      const block = await strapi.documents(getCustomBlockUID()).update({
        documentId,
        data: { enabled: !existing.enabled },
      });
      
      logger.info(`[CustomBlockService] Toggled block ${block.name}: enabled=${block.enabled}`);
      return block;
      
    } catch (error) {
      logger.error(`[CustomBlockService] Error toggling block ${documentId}:`, error);
      throw error;
    }
  },

  /**
   * Reorder blocks
   * @param {Array<{documentId: string, sortOrder: number}>} orders - New sort orders
   * @returns {Promise<void>}
   */
  async reorder(orders) {
    try {
      for (const { documentId, sortOrder } of orders) {
        await strapi.documents(getCustomBlockUID()).update({
          documentId,
          data: { sortOrder },
        });
      }
      
      logger.info(`[CustomBlockService] Reordered ${orders.length} blocks`);
      
    } catch (error) {
      logger.error('[CustomBlockService] Error reordering blocks:', error);
      throw error;
    }
  },

  /**
   * Get all available content types for embedded entry blocks
   * @returns {Promise<Array>}
   */
  async getContentTypes() {
    try {
      const contentTypes = Object.values(strapi.contentTypes)
        .filter((ct) => {
          // Only include API content types (not admin or plugin types)
          return ct.uid.startsWith('api::') && ct.kind === 'collectionType';
        })
        .map((ct) => ({
          uid: ct.uid,
          displayName: ct.info?.displayName || ct.info?.singularName || ct.uid,
          singularName: ct.info?.singularName,
          pluralName: ct.info?.pluralName,
          attributes: Object.keys(ct.attributes).filter((attr) => {
            // Exclude system fields
            return !['createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy'].includes(attr);
          }),
        }));
      
      logger.debug(`[CustomBlockService] Found ${contentTypes.length} content types`);
      return contentTypes;
      
    } catch (error) {
      logger.error('[CustomBlockService] Error getting content types:', error);
      throw error;
    }
  },

  /**
   * Duplicate a custom block
   * @param {string} documentId - Block document ID
   * @param {string} newName - New block name
   * @returns {Promise<object>}
   */
  async duplicate(documentId, newName) {
    try {
      const existing = await this.findOne(documentId);
      if (!existing) {
        throw new Error(`Block with ID "${documentId}" not found`);
      }
      
      // Remove unique fields and create new block
      const newBlockData = {
        ...existing,
        name: newName,
        label: `${existing.label} (Copy)`,
        documentId: undefined,
        id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        createdByUser: undefined,
      };
      
      return await this.create(newBlockData);
      
    } catch (error) {
      logger.error(`[CustomBlockService] Error duplicating block ${documentId}:`, error);
      throw error;
    }
  },

  /**
   * Check if export/import is allowed for current tier
   * @returns {Promise<object>} Check result
   */
  async canExportImport() {
    try {
      const licenseService = strapi.plugin('magic-editor-x').service('licenseService');
      const tier = await licenseService.getCurrentTier();
      const config = await licenseService.getCustomBlocksConfig();
      
      return {
        allowed: config.exportImport === true,
        tier,
        message: config.exportImport 
          ? null 
          : 'Export/Import requires Advanced or Enterprise tier.',
      };
      
    } catch (error) {
      logger.error('[CustomBlockService] Error checking export/import permission:', error);
      throw error;
    }
  },

  /**
   * Export custom blocks as JSON
   * @param {boolean} skipPermissionCheck - Skip permission check
   * @returns {Promise<object>}
   */
  async export(skipPermissionCheck = false) {
    try {
      // Check tier permission
      if (!skipPermissionCheck) {
        const permission = await this.canExportImport();
        if (!permission.allowed) {
          const error = new Error(permission.message);
          error.code = 'FEATURE_NOT_AVAILABLE';
          error.tier = permission.tier;
          throw error;
        }
      }
      
      const blocks = await this.findAll({ enabledOnly: false });
      
      // Remove runtime fields
      const exportData = blocks.map((block) => ({
        name: block.name,
        label: block.label,
        blockType: block.blockType,
        description: block.description,
        icon: block.icon,
        contentType: block.contentType,
        displayFields: block.displayFields,
        titleField: block.titleField,
        previewFields: block.previewFields,
        fields: block.fields,
        template: block.template,
        placeholder: block.placeholder,
        styles: block.styles,
        inlineToolbar: block.inlineToolbar,
        tunes: block.tunes,
        shortcut: block.shortcut,
        sortOrder: block.sortOrder,
        enabled: block.enabled,
      }));
      
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        blocks: exportData,
      };
      
    } catch (error) {
      logger.error('[CustomBlockService] Error exporting blocks:', error);
      throw error;
    }
  },

  /**
   * Import custom blocks from JSON
   * @param {object} importData - Import data
   * @param {boolean} overwrite - Overwrite existing blocks with same name
   * @param {boolean} skipPermissionCheck - Skip permission check
   * @returns {Promise<object>}
   */
  async import(importData, overwrite = false, skipPermissionCheck = false) {
    try {
      // Check tier permission
      if (!skipPermissionCheck) {
        const permission = await this.canExportImport();
        if (!permission.allowed) {
          const error = new Error(permission.message);
          error.code = 'FEATURE_NOT_AVAILABLE';
          error.tier = permission.tier;
          throw error;
        }
      }
      
      if (!importData.blocks || !Array.isArray(importData.blocks)) {
        throw new Error('Invalid import data: missing blocks array');
      }
      
      const results = {
        created: [],
        updated: [],
        skipped: [],
        errors: [],
      };
      
      for (const blockData of importData.blocks) {
        try {
          const existing = await this.findByName(blockData.name);
          
          if (existing) {
            if (overwrite) {
              await this.update(existing.documentId, blockData);
              results.updated.push(blockData.name);
            } else {
              results.skipped.push(blockData.name);
            }
          } else {
            // Skip limit check for imports (already passed tier check)
            await this.create(blockData, null, true);
            results.created.push(blockData.name);
          }
        } catch (blockError) {
          results.errors.push({
            name: blockData.name,
            error: blockError.message,
          });
        }
      }
      
      logger.info('[CustomBlockService] Import complete:', results);
      return results;
      
    } catch (error) {
      logger.error('[CustomBlockService] Error importing blocks:', error);
      throw error;
    }
  },
});


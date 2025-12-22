/**
 * Custom Block Controller
 * REST API endpoints for managing custom blocks
 */
'use strict';

const { logger } = require('../utils');

module.exports = ({ strapi }) => ({
  /**
   * Get block limits and usage for current tier
   * GET /api/magic-editor-x/custom-blocks/limits
   */
  async getLimits(ctx) {
    try {
      const limits = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .getBlockLimits();
      
      ctx.body = { data: limits };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in getLimits:', error);
      ctx.throw(500, error.message);
    }
  },

  /**
   * Check if a block type can be created
   * GET /api/magic-editor-x/custom-blocks/can-create/:blockType
   */
  async canCreate(ctx) {
    try {
      const { blockType = 'simple' } = ctx.params;
      
      const result = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .canCreateBlock(blockType);
      
      ctx.body = { data: result };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in canCreate:', error);
      ctx.throw(500, error.message);
    }
  },

  /**
   * Get all custom blocks
   * GET /api/magic-editor-x/custom-blocks
   */
  async find(ctx) {
    try {
      const { enabledOnly = 'true' } = ctx.query;
      
      const blocks = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .findAll({ enabledOnly: enabledOnly === 'true' });
      
      ctx.body = {
        data: blocks,
        meta: {
          total: blocks.length,
        },
      };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in find:', error);
      ctx.throw(500, error.message);
    }
  },

  /**
   * Get a single custom block by ID
   * GET /api/magic-editor-x/custom-blocks/:id
   */
  async findOne(ctx) {
    try {
      const { id } = ctx.params;
      
      const block = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .findOne(id);
      
      if (!block) {
        return ctx.notFound('Block not found');
      }
      
      ctx.body = { data: block };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in findOne:', error);
      ctx.throw(500, error.message);
    }
  },

  /**
   * Create a new custom block
   * POST /api/magic-editor-x/custom-blocks
   */
  async create(ctx) {
    try {
      const data = ctx.request.body;
      const user = ctx.state.user;
      
      // Validate required fields
      if (!data.name) {
        return ctx.badRequest('Block name is required');
      }
      if (!data.blockType) {
        return ctx.badRequest('Block type is required');
      }
      
      const block = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .create(data, user);
      
      ctx.status = 201;
      ctx.body = { data: block };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in create:', error);
      
      if (error.message.includes('already exists')) {
        return ctx.badRequest(error.message);
      }
      if (error.message.includes('must start with')) {
        return ctx.badRequest(error.message);
      }
      
      // Handle tier limit errors
      if (error.code === 'LIMIT_EXCEEDED') {
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: error.message,
            details: {
              code: error.code,
              reason: error.reason,
              tier: error.tier,
            },
          },
        };
        return;
      }
      
      ctx.throw(500, error.message);
    }
  },

  /**
   * Update a custom block
   * PUT /api/magic-editor-x/custom-blocks/:id
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const data = ctx.request.body;
      
      const block = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .update(id, data);
      
      ctx.body = { data: block };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in update:', error);
      
      if (error.message.includes('not found')) {
        return ctx.notFound(error.message);
      }
      if (error.message.includes('already exists') || error.message.includes('must start with')) {
        return ctx.badRequest(error.message);
      }
      
      ctx.throw(500, error.message);
    }
  },

  /**
   * Delete a custom block
   * DELETE /api/magic-editor-x/custom-blocks/:id
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;
      
      const result = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .delete(id);
      
      ctx.body = { data: result };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in delete:', error);
      
      if (error.message.includes('not found')) {
        return ctx.notFound(error.message);
      }
      
      ctx.throw(500, error.message);
    }
  },

  /**
   * Toggle block enabled status
   * POST /api/magic-editor-x/custom-blocks/:id/toggle
   */
  async toggle(ctx) {
    try {
      const { id } = ctx.params;
      
      const block = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .toggle(id);
      
      ctx.body = { data: block };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in toggle:', error);
      
      if (error.message.includes('not found')) {
        return ctx.notFound(error.message);
      }
      
      ctx.throw(500, error.message);
    }
  },

  /**
   * Reorder blocks
   * POST /api/magic-editor-x/custom-blocks/reorder
   */
  async reorder(ctx) {
    try {
      const { orders } = ctx.request.body;
      
      if (!orders || !Array.isArray(orders)) {
        return ctx.badRequest('Orders array is required');
      }
      
      await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .reorder(orders);
      
      ctx.body = { success: true };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in reorder:', error);
      ctx.throw(500, error.message);
    }
  },

  /**
   * Duplicate a block
   * POST /api/magic-editor-x/custom-blocks/:id/duplicate
   */
  async duplicate(ctx) {
    try {
      const { id } = ctx.params;
      const { newName } = ctx.request.body;
      
      if (!newName) {
        return ctx.badRequest('New name is required');
      }
      
      const block = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .duplicate(id, newName);
      
      ctx.status = 201;
      ctx.body = { data: block };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in duplicate:', error);
      
      if (error.message.includes('not found')) {
        return ctx.notFound(error.message);
      }
      if (error.message.includes('already exists')) {
        return ctx.badRequest(error.message);
      }
      
      // Handle tier limit errors
      if (error.code === 'LIMIT_EXCEEDED') {
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: error.message,
            details: {
              code: error.code,
              reason: error.reason,
              tier: error.tier,
            },
          },
        };
        return;
      }
      
      ctx.throw(500, error.message);
    }
  },

  /**
   * Get available content types for embedded entry blocks
   * GET /api/magic-editor-x/content-types
   */
  async getContentTypes(ctx) {
    try {
      const contentTypes = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .getContentTypes();
      
      ctx.body = { contentTypes };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in getContentTypes:', error);
      ctx.throw(500, error.message);
    }
  },

  /**
   * Export custom blocks
   * GET /api/magic-editor-x/custom-blocks/export
   */
  async export(ctx) {
    try {
      const exportData = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .export();
      
      ctx.set('Content-Disposition', 'attachment; filename="custom-blocks.json"');
      ctx.set('Content-Type', 'application/json');
      ctx.body = exportData;
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in export:', error);
      
      // Handle tier permission errors
      if (error.code === 'FEATURE_NOT_AVAILABLE') {
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: error.message,
            details: {
              code: error.code,
              tier: error.tier,
              requiredTier: 'advanced',
            },
          },
        };
        return;
      }
      
      ctx.throw(500, error.message);
    }
  },

  /**
   * Import custom blocks
   * POST /api/magic-editor-x/custom-blocks/import
   */
  async import(ctx) {
    try {
      const importData = ctx.request.body;
      const { overwrite = false } = ctx.query;
      
      if (!importData || !importData.blocks) {
        return ctx.badRequest('Invalid import data');
      }
      
      const result = await strapi
        .plugin('magic-editor-x')
        .service('customBlockService')
        .import(importData, overwrite === 'true');
      
      ctx.body = { data: result };
      
    } catch (error) {
      logger.error('[CustomBlockController] Error in import:', error);
      
      // Handle tier permission errors
      if (error.code === 'FEATURE_NOT_AVAILABLE') {
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: error.message,
            details: {
              code: error.code,
              tier: error.tier,
              requiredTier: 'advanced',
            },
          },
        };
        return;
      }
      
      ctx.throw(500, error.message);
    }
  },
});


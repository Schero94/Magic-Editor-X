/**
 * Magic Editor X - Editor Controller
 * Handles EditorJS API endpoints for link preview, image upload, and file upload
 */
'use strict';

const { createLogger } = require('../utils');

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  return {
  /**
   * Fetch link metadata (OpenGraph) for URL preview
   * GET /api/magic-editor-x/link?url=https://example.com
   */
  async fetchLinkMeta(ctx) {
    try {
      const { url } = ctx.query;

      if (typeof url !== 'string' || !url) {
        return ctx.send({
          success: 0,
          message: 'URL parameter is required',
        }, 400);
      }

      // Use the service to fetch link metadata
      const result = await strapi
        .plugin('magic-editor-x')
        .service('editorService')
        .fetchLinkMeta(url, ctx);

      ctx.send(result);
    } catch (error) {
      logger.error('[Magic Editor X] Link fetch error:', error);
      ctx.send({
        success: 0,
        message: error.statusCode === 400 ? error.message : 'Failed to fetch link metadata',
      }, error.statusCode || 502);
    }
  },

  /**
   * Upload image by file
   * POST /api/magic-editor-x/image/byFile
   * Multipart form data with files.image
   */
  async uploadByFile(ctx) {
    try {
      // Use the service to upload file
      const result = await strapi
        .plugin('magic-editor-x')
        .service('editorService')
        .uploadByFile(ctx);

      ctx.send(result);
    } catch (error) {
      logger.error('[Magic Editor X] File upload error:', error);
      ctx.send({
        success: 0,
        message: error.statusCode === 400 || error.statusCode === 413 ? error.message : 'Failed to upload file',
      }, error.statusCode || 500);
    }
  },

  /**
   * Upload image by URL
   * POST /api/magic-editor-x/image/byUrl
   * JSON body with url field
   */
  async uploadByUrl(ctx) {
    try {
      const { url } = ctx.request.body || {};

      if (typeof url !== 'string' || !url) {
        return ctx.send({
          success: 0,
          message: 'URL is required',
        }, 400);
      }

      // Use the service to upload from URL
      const result = await strapi
        .plugin('magic-editor-x')
        .service('editorService')
        .uploadByUrl(url, ctx);

      ctx.send(result);
    } catch (error) {
      logger.error('[Magic Editor X] URL upload error:', error);
      ctx.send({
        success: 0,
        message: error.statusCode === 400 || error.statusCode === 413 ? error.message : 'Failed to upload from URL',
      }, error.statusCode || 502);
    }
  },

  /**
   * Upload file (for Attaches Tool)
   * POST /api/magic-editor-x/file/upload
   * Multipart form data with file
   */
  async uploadFile(ctx) {
    try {
      // Use the service to upload file
      const result = await strapi
        .plugin('magic-editor-x')
        .service('editorService')
        .uploadAttachment(ctx);

      ctx.send(result);
    } catch (error) {
      logger.error('[Magic Editor X] Attachment upload error:', error);
      ctx.send({
        success: 0,
        message: error.statusCode === 400 || error.statusCode === 413 ? error.message : 'Failed to upload attachment',
      }, error.statusCode || 500);
    }
  },
};};


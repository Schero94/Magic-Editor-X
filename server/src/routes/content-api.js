/**
 * Magic Editor X - Content API Routes
 * Public API routes for EditorJS functionality
 */
'use strict';

module.exports = {
  type: 'content-api',
  routes: [
    /**
     * Link Preview Endpoint
     * GET /api/magic-editor-x/link?url=https://example.com
     * Returns OpenGraph metadata for URL
     */
    {
      method: 'GET',
      path: '/link',
      handler: 'editor.fetchLinkMeta',
      config: {
        description: 'Fetch link metadata (OpenGraph) for URL preview',
        auth: false,
        policies: [],
      },
    },

    /**
     * Upload Image by File
     * POST /api/magic-editor-x/image/byFile
     * Multipart form data with files.image
     */
    {
      method: 'POST',
      path: '/image/byFile',
      handler: 'editor.uploadByFile',
      config: {
        description: 'Upload image by file to Strapi Media Library',
        auth: false,
        policies: [],
      },
    },

    /**
     * Upload Image by URL
     * POST /api/magic-editor-x/image/byUrl
     * JSON body with url field
     */
    {
      method: 'POST',
      path: '/image/byUrl',
      handler: 'editor.uploadByUrl',
      config: {
        description: 'Upload image by URL to Strapi Media Library',
        auth: false,
        policies: [],
      },
    },

    /**
     * Upload File (for Attaches Tool)
     * POST /api/magic-editor-x/file/upload
     * Multipart form data with file
     */
    {
      method: 'POST',
      path: '/file/upload',
      handler: 'editor.uploadFile',
      config: {
        description: 'Upload file to Strapi Media Library (for Attaches)',
        auth: false,
        policies: [],
      },
    },
  ],
};

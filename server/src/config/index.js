/**
 * Magic Editor X - Plugin Configuration
 */
'use strict';

module.exports = {
  default: {
    // Debug/Verbose logging (default: false for production)
    // Set to true to see all [Magic Editor X] logs in the console
    debug: false,

    // Default configuration options
    enabledTools: [
      'header',
      'paragraph',
      'list',
      'checklist',
      'quote',
      'warning',
      'code',
      'delimiter',
      'table',
      'embed',
      'raw',
      'image',
      'mediaLib',
      'linkTool',
      'marker',
      'inlineCode',
      'underline',
    ],
    
    // Link preview timeout (ms)
    linkPreviewTimeout: 10000,
    
    // Max image upload size (bytes)
    maxImageSize: 10 * 1024 * 1024, // 10MB
    
    // Allowed image types
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],

    // Realtime collaboration defaults
    collaboration: {
      enabled: true,
      sessionTTL: 2 * 60 * 1000, // 2 minutes
      wsPath: '/magic-editor-x/realtime',
      wsUrl: null,
      allowedOrigins: [],
      allowedAdminRoles: ['strapi-super-admin'],
      allowedAdminUserIds: [],
    },

    // API Response Settings
    api: {
      autoParseJSON: true, // Automatically parse Editor.js JSON strings to objects in API responses
    },
  },
  
  validator: (config) => {
    // Validate configuration
    if (config.debug !== undefined && typeof config.debug !== 'boolean') {
      throw new Error('[Magic Editor X] debug must be a boolean');
    }

    if (config.linkPreviewTimeout && typeof config.linkPreviewTimeout !== 'number') {
      throw new Error('[Magic Editor X] linkPreviewTimeout must be a number');
    }
    
    if (config.maxImageSize && typeof config.maxImageSize !== 'number') {
      throw new Error('[Magic Editor X] maxImageSize must be a number');
    }

    if (config.collaboration) {
      if (typeof config.collaboration.enabled !== 'boolean') {
        throw new Error('[Magic Editor X] collaboration.enabled must be a boolean');
      }

      if (config.collaboration.sessionTTL && typeof config.collaboration.sessionTTL !== 'number') {
        throw new Error('[Magic Editor X] collaboration.sessionTTL must be a number');
      }

      ['allowedOrigins', 'allowedAdminRoles', 'allowedAdminUserIds'].forEach((key) => {
        if (config.collaboration[key] && !Array.isArray(config.collaboration[key])) {
          throw new Error(`[Magic Editor X] collaboration.${key} must be an array`);
        }
      });
    }
  },
};

/**
 * Magic Editor X - Parse Editor Fields Middleware
 * 
 * Automatically parses Magic Editor X custom fields from JSON strings to objects
 * in API responses for better developer experience.
 * 
 * Before: { "editorX": "{\"time\":...,\"blocks\":[...]}" }
 * After:  { "editorX": { "time": ..., "blocks": [...] } }
 */
'use strict';

const { createLogger } = require('../utils');

module.exports = (config, { strapi }) => {
  const logger = createLogger(strapi);

  return async (ctx, next) => {
    await next();

    // Only process successful GET responses
    if (ctx.method !== 'GET' || ctx.status !== 200) {
      return;
    }

    // Only process JSON responses
    if (!ctx.body || typeof ctx.body !== 'object') {
      return;
    }

    try {
      // Helper function to parse Magic Editor X fields recursively
      const parseEditorFields = (data) => {
        if (!data || typeof data !== 'object') {
          return data;
        }

        // Handle arrays
        if (Array.isArray(data)) {
          return data.map(parseEditorFields);
        }

        // Preserve Date objects as-is (Object.entries(Date) returns [], causing empty object)
        if (data instanceof Date) {
          return data;
        }

        // Handle objects
        const parsed = {};
        for (const [key, value] of Object.entries(data)) {
          // Check if this is a Magic Editor X field (JSON string with Editor.js structure)
          if (typeof value === 'string' && value.startsWith('{') && value.includes('"blocks"')) {
            try {
              const parsedValue = JSON.parse(value);
              // Verify it's actually an Editor.js structure
              if (parsedValue.blocks && Array.isArray(parsedValue.blocks)) {
                parsed[key] = parsedValue;
                continue;
              }
            } catch (e) {
              // Not valid JSON or not an Editor.js structure, keep as string
            }
          }
          
          // Recursively parse nested objects/arrays
          if (value !== null && typeof value === 'object') {
            parsed[key] = parseEditorFields(value);
          } else {
            parsed[key] = value;
          }
        }
        return parsed;
      };

      // Parse the response body
      if (ctx.body.data) {
        // Handle Strapi v4/v5 response format with data wrapper
        ctx.body.data = parseEditorFields(ctx.body.data);
      } else {
        // Handle direct response format
        ctx.body = parseEditorFields(ctx.body);
      }
    } catch (error) {
      // Silently fail - don't break the response if parsing fails
      logger.debug('Failed to parse editor fields:', error.message);
    }
  };
};

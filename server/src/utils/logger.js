/**
 * Magic Editor X - Logger Utility
 * Conditional logging based on plugin debug configuration
 */
'use strict';

const pluginId = 'magic-editor-x';

/**
 * Creates a logger instance that respects the debug configuration
 * @param {object} strapi - Strapi instance
 * @returns {object} Logger with info, warn, error, debug methods
 */
module.exports = (strapi) => {
  const getConfig = () => strapi.config.get(`plugin::${pluginId}`, {});

  return {
    /**
     * Log info message (only when debug: true)
     */
    info: (message, ...args) => {
      if (getConfig().debug) {
        strapi.log.info(`[Magic Editor X] ${message}`, ...args);
      }
    },

    /**
     * Log warning message (always shown)
     */
    warn: (message, ...args) => {
      strapi.log.warn(`[Magic Editor X] ${message}`, ...args);
    },

    /**
     * Log error message (always shown)
     */
    error: (message, ...args) => {
      strapi.log.error(`[Magic Editor X] ${message}`, ...args);
    },

    /**
     * Log debug message (only when debug: true)
     */
    debug: (message, ...args) => {
      if (getConfig().debug) {
        strapi.log.debug(`[Magic Editor X] ${message}`, ...args);
      }
    },
  };
};

/**
 * Magic Editor X - Server Utilities
 */
'use strict';

/**
 * Simple logger that works without strapi instance
 * Used in services/controllers before strapi is available
 */
const logger = {
  info: (message, ...args) => {
    console.log(`[Magic Editor X] [INFO] ${message}`, ...args);
  },
  warn: (message, ...args) => {
    console.warn(`[Magic Editor X] [WARNING] ${message}`, ...args);
  },
  error: (message, ...args) => {
    console.error(`[Magic Editor X] [ERROR] ${message}`, ...args);
  },
  debug: (message, ...args) => {
    if (process.env.DEBUG) {
      console.log(`[Magic Editor X] [DEBUG] ${message}`, ...args);
    }
  },
};

module.exports = {
  createLogger: require('./logger'),
  logger,
};

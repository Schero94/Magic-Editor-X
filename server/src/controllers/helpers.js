'use strict';

/**
 * Shared controller helpers.
 */

const { recordAudit } = require('../utils/audit-record');

const service = (strapi, name) => strapi.plugin('magic-editor-x').service(name);

/**
 * Maps an error carrying `statusCode` (editor helpers) to the Editor.js
 * response shape `{ success: 0, message }`. Unknown errors become a fixed 500.
 * @param {object} ctx - Koa context.
 * @param {Error & { statusCode?: number }} error - Error.
 * @param {string} fallback - Message for unexpected errors.
 * @param {object} logger - Plugin logger.
 * @param {string} operation - Operation name for the log line.
 */
const sendEditorError = (ctx, error, fallback, logger, operation) => {
  const status = Number(error && error.statusCode);
  if (status >= 400 && status < 600) {
    ctx.status = status;
    ctx.body = { success: 0, message: status >= 500 ? fallback : error.message };
    if (status >= 500) logger.warn(`${operation} failed`, { code: error.code, status });
    return;
  }
  logger.error(`${operation} failed`, error);
  ctx.status = 500;
  ctx.body = { success: 0, message: fallback };
};

module.exports = { service, sendEditorError, recordAudit };

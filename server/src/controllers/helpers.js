'use strict';

/**
 * Shared controller helpers.
 */

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

/**
 * Access-check target of a stored row (`history.findOne`, `comments.findTarget`): the field path
 * and, for keyed positional rows, the key (2.4). Internal flags are dropped.
 * @param {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }} target - Row target.
 * @returns {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string }} Target.
 */
const identityTarget = ({ uid, documentId, locale, field, fieldKey }) => ({
  uid,
  documentId,
  locale,
  field,
  ...(fieldKey ? { fieldKey } : {}),
});

/**
 * Answers 409 for writes to a positional field without an identity (2.4): the stored value has no
 * key yet (`FIELD_KEY_REQUIRED`: save the entry once), or the row was saved by position before 2.4
 * and belongs to no single entry (`POSITIONAL_READ_ONLY`).
 * @param {object} ctx - Koa context.
 * @param {'FIELD_KEY_REQUIRED'|'POSITIONAL_READ_ONLY'} code - Reason.
 * @returns {undefined} Nothing (the response is set).
 */
const positionalReadOnly = (ctx, code) =>
  ctx.conflict(
    code === 'FIELD_KEY_REQUIRED'
      ? 'Save the entry once before using history or comments for this field'
      : 'This item was saved by position before 2.4 and is read-only',
    { code }
  );

module.exports = { service, sendEditorError, identityTarget, positionalReadOnly };

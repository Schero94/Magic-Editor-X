'use strict';

/**
 * Plugin logger. Every line is prefixed with the plugin id and carries only
 * operation names and error names/codes: never content, URLs with queries,
 * user ids, email addresses, IPs, tokens or raw error objects.
 */

const PREFIX = '[magic-editor-x]';

/**
 * Reduces an error to fields that are safe to log.
 * @param {unknown} error - Any thrown value.
 * @returns {{ name?: string, code?: string|number }} Safe fields.
 */
const safeError = (error) => {
  if (!error || typeof error !== 'object') return {};
  const out = {};
  if (typeof error.name === 'string') out.name = error.name.slice(0, 80);
  if (typeof error.code === 'string' || typeof error.code === 'number')
    out.code = String(error.code).slice(0, 80);
  return out;
};

/**
 * Creates the logger for a Strapi instance.
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi instance.
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }} Logger.
 */
const createLogger = (strapi) => {
  const debugEnabled = () => {
    try {
      return Boolean(strapi.config.get('plugin::magic-editor-x.debug'));
    } catch {
      return false;
    }
  };
  const write = (level, message, meta) => {
    const log = strapi?.log?.[level];
    if (typeof log !== 'function') return;
    if (meta && Object.keys(meta).length > 0) log(`${PREFIX} ${message}`, meta);
    else log(`${PREFIX} ${message}`);
  };
  return {
    debug: (message, meta) => debugEnabled() && write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, error) => write('error', message, safeError(error)),
  };
};

module.exports = { createLogger, safeError };

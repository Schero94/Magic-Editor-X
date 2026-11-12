'use strict';

/**
 * Records an audit trail event through `services/audit.js` `record()`.
 * Never throws (also when the service is missing, as in unit tests that
 * build a partial plugin), so callers can record after their own work.
 * @param {object} strapi - Strapi.
 * @param {object} input - Event (see services/audit.js `record`).
 * @returns {Promise<boolean>} True when stored.
 */
const recordAudit = async (strapi, input) => {
  try {
    const audit = strapi.plugin('magic-editor-x').service('audit');
    if (!audit || typeof audit.record !== 'function') return false;
    return await audit.record(input);
  } catch {
    return false;
  }
};

module.exports = { recordAudit };

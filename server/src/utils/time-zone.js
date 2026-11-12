'use strict';

/**
 * True for an IANA time zone name the runtime knows (`Europe/Berlin`, `UTC`).
 * `Intl.supportedValuesOf('timeZone')` lists canonical zones only (no `UTC`
 * in V8), so the check constructs a `DateTimeFormat`, which accepts every
 * name the ICU data knows and throws a RangeError otherwise. Croner (the
 * Strapi 5.61 cron engine) resolves zones through the same Intl API.
 * @param {string} value - Candidate.
 * @returns {boolean} Result.
 */
const isTimeZone = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

module.exports = { isTimeZone };

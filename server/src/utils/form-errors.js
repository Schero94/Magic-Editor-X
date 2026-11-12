'use strict';

/**
 * The Content Manager turns a ValidationError's `details.errors`
 * (`[{ path: string[], message, name }]`) into errors on the form fields, so
 * the editor field shows the reason inline. Without `errors` it expects every
 * other key of `details` to be an array of messages. Magic Editor X errors
 * therefore always carry `errors` next to their machine-readable `code`.
 */

const MESSAGES = {
  PRESET_VIOLATION: 'This content does not match the settings of this field',
  QUALITY_GATE: 'Quality checks report errors in this field; fix them before publishing',
  INVALID: 'This field contains invalid content',
};

/**
 * Builds Content Manager compatible ValidationError details.
 * @param {string} code - Machine-readable code (`PRESET_VIOLATION`, `QUALITY_GATE`, or an EditorDataError code).
 * @param {string[]} fields - Dotted field paths (`summary`, `sections.0.body`).
 * @param {object} [extra] - More details (rule codes and block ids only, never content).
 * @returns {{ code: string, errors: Array<{ path: string[], message: string, name: string }> }} Details.
 */
const formErrorDetails = (code, fields, extra = {}) => {
  const message = MESSAGES[code] || MESSAGES.INVALID;
  const unique = [...new Set(fields.filter((field) => typeof field === 'string' && field))];
  return {
    ...extra,
    code,
    errors: unique.map((field) => ({ path: field.split('.'), message, name: 'ValidationError' })),
  };
};

module.exports = { formErrorDetails };

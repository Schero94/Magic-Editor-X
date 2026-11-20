/**
 * Readability and SEO hints on the Configuration page (2.9): draft, validation
 * that mirrors the server schema (server/src/services/settings.js
 * `contentChecksInputSchema`), comparison and payload. Pure, so `node --test`
 * covers it. Errors use the keys `contentChecks.<field>`.
 */

import {
  BLOCKABLE_SETTINGS,
  CONTENT_CHECK_LIMITS,
  INSIGHT_SETTINGS,
  normalizeContentChecks,
} from '../../../../shared/content-insights.mjs';

export { BLOCKABLE_SETTINGS, CONTENT_CHECK_LIMITS, INSIGHT_SETTINGS };

/** Numeric settings in the order the form shows them. */
export const CONTENT_CHECK_NUMBERS = Object.freeze([
  'minWords',
  'minInternalLinks',
  'sentenceWords',
  'paragraphWords',
  'sectionWords',
]);

/**
 * Draft from `data.contentChecks` of GET /settings.
 * @param {object|undefined} dto - DTO part; absent on servers before 2.9.
 * @returns {object|undefined} Draft, undefined when the server has no such settings (then never sent).
 */
export const toContentChecksDraft = (dto) => {
  if (!dto) return undefined;
  const value = normalizeContentChecks(dto);
  return { ...value, disabled: [...value.disabled], blockPublish: [...value.blockPublish] };
};

/**
 * Validates the draft with the server's bounds.
 * @param {object|undefined} draft - Draft.
 * @returns {Record<string, string>} `contentChecks.<field>` -> `required` or `contentRange`.
 */
export const validateContentChecks = (draft) => {
  const errors = {};
  if (!draft) return errors;
  for (const key of CONTENT_CHECK_NUMBERS) {
    const value = draft[key];
    const { min, max } = CONTENT_CHECK_LIMITS[key];
    if (value === undefined || value === null || value === '') errors[`contentChecks.${key}`] = 'required';
    else if (!Number.isInteger(value) || value < min || value > max)
      errors[`contentChecks.${key}`] = 'contentRange';
  }
  return errors;
};

const sameList = (a = [], b = []) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * Draft comparison for the dirty flag.
 * @param {object|undefined} a - Draft.
 * @param {object|undefined} b - Draft.
 * @returns {boolean} Equal or not.
 */
export const sameContentChecks = (a, b) => {
  if (!a || !b) return a === b;
  return (
    a.enabled === b.enabled &&
    a.h1 === b.h1 &&
    sameList(a.disabled, b.disabled) &&
    sameList(a.blockPublish, b.blockPublish) &&
    CONTENT_CHECK_NUMBERS.every((key) => a[key] === b[key])
  );
};

/**
 * PUT body part. A rule that is turned off cannot block publishing, so it is left out of `blockPublish`.
 * @param {object} draft - Draft.
 * @returns {object} Body part.
 */
export const toContentChecksPayload = (draft) => ({
  enabled: Boolean(draft.enabled),
  h1: draft.h1 === 'content' ? 'content' : 'title',
  disabled: INSIGHT_SETTINGS.filter((name) => draft.disabled.includes(name)),
  blockPublish: BLOCKABLE_SETTINGS.filter(
    (name) => draft.blockPublish.includes(name) && !draft.disabled.includes(name)
  ),
  ...Object.fromEntries(CONTENT_CHECK_NUMBERS.map((key) => [key, draft[key]])),
});

/**
 * Toggles a name in one of the lists (`disabled` or `blockPublish`).
 * @param {object} draft - Draft.
 * @param {'disabled'|'blockPublish'} list - List.
 * @param {string} name - Setting name.
 * @param {boolean} present - Whether the name should be in the list.
 * @returns {object} New draft.
 */
export const toggleContentCheck = (draft, list, name, present) => {
  const current = draft[list].filter((item) => item !== name);
  return { ...draft, [list]: present ? [...current, name] : current };
};

/**
 * Splits server field errors (zod `fieldErrors`, keys like `contentChecks.minWords`) into the
 * content check part and the rest, so the rest goes through the page's own mapping.
 * @param {unknown} details - Error details.
 * @returns {{ errors: Record<string, string>, rest: unknown }} Content check errors and the other details.
 */
export const splitContentCheckErrors = (details) => {
  if (!details || typeof details !== 'object' || !details.fieldErrors) return { errors: {}, rest: details };
  const errors = {};
  const fieldErrors = {};
  for (const [key, messages] of Object.entries(details.fieldErrors)) {
    if (key.startsWith('contentChecks')) {
      const field = CONTENT_CHECK_NUMBERS.find((name) => key === `contentChecks.${name}`);
      errors[field ? key : 'contentChecks'] = Array.isArray(messages) ? messages[0] : String(messages || '');
    } else fieldErrors[key] = messages;
  }
  return { errors, rest: { ...details, fieldErrors } };
};

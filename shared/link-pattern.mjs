/**
 * URL pattern for internal links (config `links.urlPattern`).
 *
 * The hyperlink tool's entry picker stores `<a href="…" data-mex-uid
 * data-mex-document-id data-mex-locale>`. The `href` is rendered from this
 * pattern on the server so every frontend gets a working plain link; the data
 * attributes let a frontend resolve the entry itself.
 *
 * Placeholders: `{documentId}`, `{locale}`, `{slug}` (value of the first `uid`
 * attribute, falls back to the documentId), `{collection}` (plural API name),
 * `{singular}` (singular API name). Values are URL-encoded. Empty values (for
 * example `{locale}` of a type without i18n) leave no empty path segment.
 */

import { sanitizeUrl } from './sanitize-policy.mjs';

export const LINK_PATTERN_PLACEHOLDERS = Object.freeze([
  'documentId',
  'locale',
  'slug',
  'collection',
  'singular',
]);

/** Used when `links.urlPattern` is empty. */
export const DEFAULT_LINK_PATTERN = '/{collection}/{documentId}';

export const MAX_LINK_PATTERN_LENGTH = 500;

const TOKEN = /\{([A-Za-z]{1,20})\}/g;
// Site-relative path, or http(s) with a literal host (placeholders are not allowed in the host).
const PREFIX = /^(?:\/(?!\/)|https?:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?(?:[/?#]|$))/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected here
const FORBIDDEN = /[\s\u0000-\u001f\u007f<>"'`\\]/;

/**
 * Checks a URL pattern. The empty string is valid (it means the default pattern).
 * @param {unknown} pattern - Candidate pattern.
 * @returns {boolean} True when the pattern can be used.
 */
export const isValidLinkPattern = (pattern) => {
  if (typeof pattern !== 'string') return false;
  if (pattern === '') return true;
  if (pattern.length > MAX_LINK_PATTERN_LENGTH || FORBIDDEN.test(pattern) || !PREFIX.test(pattern))
    return false;
  let unknown = false;
  const stripped = pattern.replace(TOKEN, (_match, name) => {
    if (!LINK_PATTERN_PLACEHOLDERS.includes(name)) unknown = true;
    return 'x';
  });
  if (unknown || /[{}]/.test(stripped)) return false;
  return Boolean(sanitizeUrl(stripped));
};

/**
 * Encodes one placeholder value. Dot segments are encoded too, so a value never
 * walks up the path.
 * @param {unknown} value - Value.
 * @returns {string} Encoded value.
 */
const encode = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  if (text === '.' || text === '..') return text.replace(/\./g, '%2E');
  return encodeURIComponent(text);
};

/**
 * Renders the link for one entry.
 * @param {string|undefined|null} pattern - `links.urlPattern` (empty means the default).
 * @param {{ documentId: string, locale?: string|null, slug?: string|null, collection?: string, singular?: string }} values - Entry values.
 * @returns {string} A URL that passes the link policy, or '' when the pattern is invalid.
 */
export const renderLinkPattern = (pattern, values) => {
  const source = pattern || DEFAULT_LINK_PATTERN;
  if (!isValidLinkPattern(source)) return '';
  const data = { ...values, slug: (values && values.slug) || (values && values.documentId) };
  const rendered = source.replace(TOKEN, (_match, name) => encode(data[name]));
  const origin = /^https?:\/\/[^/?#]+/i.exec(rendered);
  const head = origin ? origin[0] : '';
  const rest = rendered.slice(head.length);
  const split = rest.search(/[?#]/);
  const path = split === -1 ? rest : rest.slice(0, split);
  const tail = split === -1 ? '' : rest.slice(split);
  const cleanPath = path.replace(/\/{2,}/g, '/');
  return sanitizeUrl(head + (head || cleanPath ? cleanPath : '/') + tail);
};

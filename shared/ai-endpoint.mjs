/**
 * AI provider endpoints and the binding of the environment key (`ai.apiKey`)
 * to the endpoints it was configured for. Shared by the server (settings and
 * AI services) and the Configuration page, so both decide the same way.
 *
 * Pure ESM without dependencies.
 */

/** Official API base URLs of the providers (the default when the base URL field is empty). */
export const OFFICIAL_BASE_URLS = Object.freeze({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'openai-compatible': '',
});

/**
 * Comparable form of a base URL: scheme, lower-case host with a non-default
 * port, path without trailing slashes and the query. '' when it is not an
 * http(s) URL.
 * @param {unknown} value - URL.
 * @returns {string} Normalised URL or ''.
 */
export const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
};

/**
 * Base URL the requests of these settings go to: the base URL field, else the
 * provider's official API.
 * @param {{ provider?: string, baseUrl?: string }} ai - Settings or draft.
 * @param {Record<string, string>} [defaults] - Default base URLs per provider.
 * @returns {string} Normalised base URL or ''.
 */
export const effectiveBaseUrl = (ai, defaults = OFFICIAL_BASE_URLS) => {
  const own = ai && typeof ai.baseUrl === 'string' ? ai.baseUrl.trim() : '';
  const fallback = ai && defaults ? defaults[ai.provider] || '' : '';
  return normalizeBaseUrl(own || fallback);
};

/**
 * Base URLs the environment key may be sent to: the one in `ai.apiKeyBaseUrl`
 * when the owner set it, otherwise the official Anthropic and OpenAI APIs.
 * @param {unknown} boundBaseUrl - `ai.apiKeyBaseUrl` from the plugin config.
 * @returns {string[]} Normalised base URLs.
 */
export const environmentKeyBaseUrls = (boundBaseUrl) => {
  const bound = normalizeBaseUrl(boundBaseUrl);
  if (bound) return [bound];
  return Object.values(OFFICIAL_BASE_URLS).filter(Boolean).map(normalizeBaseUrl);
};

/**
 * True when the environment key may be sent with these settings.
 * @param {{ provider?: string, baseUrl?: string }} ai - Settings or draft.
 * @param {string[]} allowed - From `environmentKeyBaseUrls`.
 * @param {Record<string, string>} [defaults] - Default base URLs per provider.
 * @returns {boolean} Result.
 */
export const environmentKeyCovers = (ai, allowed, defaults = OFFICIAL_BASE_URLS) => {
  const target = effectiveBaseUrl(ai, defaults);
  return Boolean(target) && Array.isArray(allowed) && allowed.includes(target);
};

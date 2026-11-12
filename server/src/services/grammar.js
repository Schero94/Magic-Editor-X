'use strict';

const { errors } = require('@strapi/utils');
const { fetchBounded } = require('../utils/url-security');
const { createRateLimiter } = require('../utils/rate-limit');
const { createLogger } = require('../utils/logger');
const {
  joinTexts,
  locateInJoined,
  segmentText,
  languageToolLanguage,
} = require('../../../shared/ai-fields.mjs');

/**
 * Optional grammar and spelling check with LanguageTool (2.3).
 *
 * LanguageTool HTTP API (docs read 2026-11-12: https://languagetool.org/http-api/,
 * languagetool-swagger.json): `POST {base}/v2/check`, form-urlencoded fields
 * `text`, `language` (`en-US`, `de-DE`, ... or `auto`), optional `username` +
 * `apiKey` and `level` (`default` | `picky`); the answer has `matches[]` with
 * `message`, `shortMessage`, `offset` and `length` (0-based, in UTF-16 code
 * units of `text`), `replacements[].value` and `rule { id, category { id, name } }`.
 * Free API limits: 20,000 characters per request, 20 requests per minute.
 *
 * The plain text of each string is joined with blank lines; matches that
 * touch a separator are dropped, the others are mapped back to their string.
 * Nothing is sent unless the owner turned the check on in Settings. Text is
 * never logged.
 */

const MAX_CHARS_PER_REQUEST = 20000;
const MAX_TOTAL_CHARS = 60000;
const MAX_REQUESTS = 5;
const MAX_MATCHES = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SEPARATOR = '\n\n';

/**
 * Error raised for LanguageTool problems; mapped to fixed client messages.
 * @param {string} code - Machine code.
 * @param {number} status - HTTP status.
 * @returns {Error} Error.
 */
const grammarError = (code, status = 502) =>
  Object.assign(new Error('Grammar check unavailable'), { code, status });

/**
 * Bounded string from an untrusted value.
 * @param {unknown} value - Value.
 * @param {number} max - Limit.
 * @returns {string} String.
 */
const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

module.exports = ({ strapi }, dependencies = {}) => {
  const logger = createLogger(strapi);
  const safeFetch = dependencies.fetchBounded || fetchBounded;
  const settings = () => strapi.plugin('magic-editor-x').service('settings');
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.languageTool.${key}`);
    return value === undefined ? fallback : value;
  };
  let limiter = null;

  /**
   * Per-admin limit shared by every process (database counter per minute);
   * the process-local limiter applies when the database is unavailable.
   * @param {number} userId - Admin id.
   * @returns {Promise<boolean>} True when the request may run.
   */
  const allowRequest = async (userId) => {
    const perMinute = Number(conf('requestsPerMinute', 30)) || 30;
    try {
      const { count } = await strapi
        .plugin('magic-editor-x')
        .service('store')
        .hit(`grammar:${userId}`, 60000);
      return count <= perMinute;
    } catch {
      if (!limiter) limiter = createRateLimiter({ max: perMinute, windowMs: 60000 });
      return limiter.hit(`grammar:${userId}`).allowed;
    }
  };

  /**
   * Sends one check request.
   * @param {{ languageTool: object, apiKey: string|null }} runtime - Settings and key.
   * @param {string} text - Plain text.
   * @param {string} language - LanguageTool language.
   * @returns {Promise<Array<object>>} Raw matches.
   */
  const callLanguageTool = async ({ languageTool, apiKey }, text, language) => {
    const base = String(languageTool.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw grammarError('NOT_CONFIGURED', 503);
    const form = new URLSearchParams({ text, language });
    if (languageTool.level === 'picky') form.set('level', 'picky');
    if (apiKey && languageTool.username) {
      form.set('username', languageTool.username);
      form.set('apiKey', apiKey);
    }
    let response;
    try {
      response = await safeFetch(`${base}/v2/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
        maxBytes: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        timeoutMs: Number(conf('timeoutMs', 20000)) || 20000,
        allowPrivate: conf('allowPrivateBaseUrl', false) === true,
        allowedMimeTypes: ['application/json'],
        acceptStatus: (status) => status >= 200 && status < 600,
      });
    } catch (error) {
      if (error && error.code === 'URL_REJECTED' && error.statusCode === 400)
        throw grammarError('URL_REJECTED', 502);
      throw grammarError(
        error && error.statusCode === 504 ? 'TIMEOUT' : 'UNREACHABLE',
        error && error.statusCode === 504 ? 504 : 502
      );
    }
    if (response.statusCode === 401 || response.statusCode === 403) throw grammarError('AUTH_FAILED', 502);
    if (response.statusCode === 429) throw grammarError('PROVIDER_RATE_LIMIT', 503);
    if (response.statusCode === 413) throw grammarError('TOO_LONG', 413);
    if (response.statusCode !== 200) throw grammarError('PROVIDER_ERROR', 502);
    let json;
    try {
      json = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw grammarError('BAD_RESPONSE', 502);
    }
    if (!json || !Array.isArray(json.matches)) throw grammarError('BAD_RESPONSE', 502);
    return json.matches;
  };

  /**
   * Shapes one LanguageTool match (bounded strings, at most 5 replacements).
   * @param {object} match - Raw match.
   * @returns {object} Clean match without position.
   */
  const shapeMatch = (match) => {
    const rule = match && typeof match.rule === 'object' && match.rule ? match.rule : {};
    const category = rule.category && typeof rule.category === 'object' ? rule.category : {};
    return {
      message: str(match.message, 500),
      shortMessage: str(match.shortMessage, 200),
      replacements: (Array.isArray(match.replacements) ? match.replacements : [])
        .map((item) => str(item && item.value, 200))
        .filter((value) => value !== '')
        .slice(0, 5),
      rule: {
        id: str(rule.id, 100),
        issueType: str(rule.issueType, 50),
        category: { id: str(category.id, 100), name: str(category.name, 100) },
      },
    };
  };

  return {
    /**
     * Checks the strings of a field.
     * @param {{ segments: Array<{ blockId: string, path: string, html: string }>, locale?: string|null }} input - Validated request.
     * @param {{ id: number }} user - Admin user.
     * @returns {Promise<{ language: string, matches: Array<object>, truncated: boolean }>} Matches with `{ blockId, path, offset, length, text, ... }` (offsets in the string's plain text).
     * @throws {errors.PayloadTooLargeError|errors.RateLimitError|Error} Errors.
     */
    async check(input, user) {
      const runtime = await settings().runtimeLanguageTool();
      if (!runtime.languageTool.enabled) throw grammarError('DISABLED', 503);
      if (!runtime.languageTool.baseUrl) throw grammarError('NOT_CONFIGURED', 503);
      const parts = input.segments
        .map((segment) => ({ ...segment, text: segmentText(segment.html).text }))
        .filter((part) => part.text.trim());
      const total = parts.reduce((sum, part) => sum + part.text.length, 0);
      if (total > MAX_TOTAL_CHARS) throw new errors.PayloadTooLargeError('The field is too long to check');
      // Requests of at most MAX_CHARS_PER_REQUEST characters, whole strings only.
      const batches = [];
      let current = [];
      let size = 0;
      for (const part of parts) {
        if (part.text.length > MAX_CHARS_PER_REQUEST)
          throw new errors.PayloadTooLargeError('A block is too long to check');
        if (current.length && size + part.text.length + SEPARATOR.length > MAX_CHARS_PER_REQUEST) {
          batches.push(current);
          current = [];
          size = 0;
        }
        current.push(part);
        size += part.text.length + SEPARATOR.length;
      }
      if (current.length) batches.push(current);
      if (batches.length > MAX_REQUESTS)
        throw new errors.PayloadTooLargeError('The field is too long to check');
      const language = languageToolLanguage(input.locale);
      const matches = [];
      let truncated = false;
      try {
        for (const batch of batches) {
          if (!(await allowRequest(user.id)))
            throw new errors.RateLimitError('Too many grammar checks. Try again in a minute.');
          const joined = joinTexts(batch, SEPARATOR);
          const raw = await callLanguageTool(runtime, joined.text, language);
          for (const match of raw) {
            if (!match || typeof match !== 'object') continue;
            const located = locateInJoined(joined, batch, match.offset, match.length);
            if (!located || match.length < 1) continue;
            const part = batch[located.part];
            matches.push({
              blockId: part.blockId,
              path: part.path,
              offset: located.offset,
              length: match.length,
              text: part.text.slice(located.offset, located.offset + match.length),
              ...shapeMatch(match),
            });
            if (matches.length >= MAX_MATCHES) {
              truncated = true;
              break;
            }
          }
          if (truncated) break;
        }
      } catch (error) {
        logger.warn('grammar check failed', { code: error && error.code });
        throw error;
      }
      return { language, matches, truncated };
    },

    /**
     * Sends a fixed sample sentence with the given (unsaved) settings.
     * @param {object} input - Parsed LanguageTool settings.
     * @returns {Promise<{ ok: true }>} Success.
     * @throws {Error} Grammar error with a code.
     */
    async test(input) {
      const runtime = await settings().runtimeLanguageTool(input);
      try {
        await callLanguageTool(runtime, 'This is a test sentence.', 'en-US');
        return { ok: true };
      } catch (error) {
        logger.warn('grammar connection test failed', { code: error && error.code });
        throw error;
      }
    },
  };
};

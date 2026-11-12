'use strict';

const { errors } = require('@strapi/utils');
const { fetchBounded, requestOnce } = require('../utils/url-security');
const { createRateLimiter } = require('../utils/rate-limit');
const { createLogger } = require('../utils/logger');

/**
 * Link check of the quality panel.
 *
 * - Internal links (`data-mex-uid` + `data-mex-document-id`): checked with the
 *   caller's Content Manager read permission. A type that does not exist or
 *   cannot be read is `unknown`, so the answer never reveals whether entries
 *   exist. When the read permission has conditions, an entry that is not
 *   found is also `unknown` (it may exist but be hidden by the condition).
 * - Media Library files: need `plugin::upload.read`, else `unknown`.
 * - External URLs: only when `qualityChecks.externalLinks.enabled` is true
 *   (owner opt-in, off by default). Requests go through the SSRF-safe
 *   fetcher (public addresses only, pinned DNS, redirects re-checked, size and
 *   time limits), are rate limited per admin across processes and cached in
 *   process memory for 10 minutes. URLs are never logged.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 1000;
const HEAD_MAX_BYTES = 64 * 1024;
const GET_MAX_BYTES = 256 * 1024;
const CONCURRENCY = 4;

/**
 * One request that hands a redirect back as a final answer (the status stays
 * 3xx), so a listed private origin cannot redirect the check elsewhere.
 * @param {URL} url - Target.
 * @param {object} options - requestOnce options.
 * @returns {Promise<{ statusCode: number, headers: object, body: Buffer }>} Response.
 */
const requestWithoutRedirect = async (url, options) => {
  const response = await requestOnce(url, options);
  if (response.statusCode >= 300 && response.statusCode < 400) {
    const { location: _location, ...headers } = response.headers || {};
    return { ...response, headers };
  }
  return response;
};

module.exports = ({ strapi }, dependencies = {}) => {
  const logger = createLogger(strapi);
  const safeFetch = dependencies.fetchBounded || fetchBounded;
  const cache = new Map();
  let fallbackLimiter = null;

  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.qualityChecks.externalLinks.${key}`);
    return value === undefined ? fallback : value;
  };

  /**
   * @param {object} userAbility - CASL ability.
   * @param {string} uid - Content type uid.
   * @returns {object} Content Manager permission checker.
   */
  const checker = (userAbility, uid) =>
    strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model: uid });

  /**
   * Checks the internal links of one content type and locale.
   * @param {object} userAbility - CASL ability.
   * @param {string} uid - Content type uid.
   * @param {string|null} locale - Requested locale.
   * @param {string[]} documentIds - Document ids.
   * @returns {Promise<Map<string, string>>} documentId -> status.
   */
  const checkGroup = async (userAbility, uid, locale, documentIds) => {
    const result = new Map(documentIds.map((id) => [id, 'unknown']));
    const contentType = strapi.contentType(uid);
    if (!contentType || !uid.startsWith('api::')) return result;
    let pc;
    try {
      pc = checker(userAbility, uid);
      if (pc.cannot.read()) return result;
    } catch {
      return result;
    }
    const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
    let effectiveLocale;
    if (localized) {
      effectiveLocale =
        locale || (await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.()) || undefined;
      if (!effectiveLocale) return result;
    }
    const permission = await pc.sanitizedQuery.read({});
    const conditional = Boolean(permission && permission.filters);
    const idFilter = { documentId: { $in: documentIds } };
    const filters = conditional ? { $and: [idFilter, permission.filters] } : idFilter;
    const documents = strapi.documents(uid);
    const drafts = await documents.findMany({
      filters,
      locale: effectiveLocale,
      status: 'draft',
      fields: ['documentId'],
      limit: documentIds.length,
    });
    const found = new Set(drafts.map((row) => row.documentId));
    let published = null;
    if (contentType.options?.draftAndPublish === true && found.size) {
      const rows = await documents.findMany({
        filters: { documentId: { $in: [...found] } },
        locale: effectiveLocale,
        status: 'published',
        fields: ['documentId'],
        limit: found.size,
      });
      published = new Set(rows.map((row) => row.documentId));
    }
    for (const id of documentIds) {
      if (found.has(id)) result.set(id, published && !published.has(id) ? 'draft' : 'ok');
      else result.set(id, conditional ? 'unknown' : 'missing');
    }
    return result;
  };

  /**
   * Counts external checks per admin across processes.
   * @param {number|string} userId - Admin id.
   * @returns {Promise<boolean>} True when one more check is allowed.
   */
  const allowExternal = async (userId) => {
    const perMinute = Number(conf('perMinute', 30)) || 30;
    try {
      const { count } = await strapi.plugin('magic-editor-x').service('store').hit(`links:${userId}`, 60000);
      return count <= perMinute;
    } catch {
      if (!fallbackLimiter) fallbackLimiter = createRateLimiter({ max: perMinute, windowMs: 60000 });
      return fallbackLimiter.hit(`links:${userId}`).allowed;
    }
  };

  /**
   * Maps a fetch error to a link status.
   * @param {Error & { statusCode?: number }} error - Error.
   * @returns {{ status: string }} Status.
   */
  const statusOfError = (error) => {
    const code = Number(error && error.statusCode);
    if (code === 504) return { status: 'timeout' };
    if (code === 400) return { status: 'blocked' };
    return { status: 'error' };
  };

  /**
   * Checks one external URL (HEAD, then GET when HEAD is not supported).
   * @param {string} url - URL.
   * @returns {Promise<{ status: string, code?: number }>} Result.
   */
  const checkUrl = async (url) => {
    const timeoutMs = Number(conf('timeoutMs', 5000)) || 5000;
    const allowed = conf('allowPrivateOrigins', []);
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      // validateHttpUrl rejects it below
    }
    // An origin the owner listed may be private; its redirects are reported, never followed.
    const privateOrigin = Array.isArray(allowed) && origin !== '' && allowed.includes(origin);
    const request = (method, maxBytes) =>
      safeFetch(url, {
        method,
        maxBytes,
        timeoutMs,
        acceptStatus: () => true,
        ...(privateOrigin
          ? { allowPrivate: true, maxRedirects: 0, request: requestWithoutRedirect }
          : { maxRedirects: 5 }),
      });
    let response;
    try {
      response = await request('HEAD', HEAD_MAX_BYTES);
      if (response.statusCode === 405 || response.statusCode === 501)
        response = await request('GET', GET_MAX_BYTES);
    } catch (error) {
      // A page larger than the read cap answered: it exists.
      if (Number(error && error.statusCode) === 413) return { status: 'ok' };
      return statusOfError(error);
    }
    const code = Number(response.statusCode) || 0;
    if (code >= 200 && code < 400) return { status: 'ok', code };
    if (code >= 400 && code < 600) return { status: 'broken', code };
    return { status: 'error' };
  };

  /**
   * Reads a cached result.
   * @param {string} url - URL.
   * @returns {object|undefined} Result.
   */
  const cached = (url) => {
    const entry = cache.get(url);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(url);
      return undefined;
    }
    return entry.result;
  };

  const remember = (url, result) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(url, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  };

  return {
    /**
     * Checks one external URL through the SSRF-safe fetcher and the shared
     * 10-minute cache. Rate limits are the caller's job. Never logs the URL.
     * @param {string} url - Absolute http(s) URL.
     * @returns {Promise<{ status: 'ok'|'broken'|'timeout'|'blocked'|'error', code?: number, cached: boolean }>} Result.
     */
    async checkExternalUrl(url) {
      const hit = cached(url);
      if (hit) return { ...hit, cached: true };
      const result = await checkUrl(url);
      remember(url, result);
      return { ...result, cached: false };
    },

    /**
     * @param {string} url - URL.
     * @returns {boolean} True when the URL has a fresh cached result.
     */
    isCached(url) {
      return cached(url) !== undefined;
    },

    /**
     * Checks links and media references of one document.
     * @param {{ userAbility: object, user: { id: number }, internal?: Array<{ uid: string, documentId: string, locale?: string|null }>, media?: Array<number|string>, external?: string[] }} input - Validated input.
     * @returns {Promise<{ internal: object[], media: object[], external: object[] }>} Results in input order.
     * @throws {errors.RateLimitError} 429 when the admin checked too many external links this minute.
     */
    async checkLinks({ userAbility, user, internal = [], media = [], external = [] }) {
      const can = (action) => {
        try {
          return Boolean(userAbility && userAbility.can(action));
        } catch {
          return false;
        }
      };

      // Internal links, grouped by type and locale.
      const groups = new Map();
      for (const ref of internal) {
        const key = `${ref.uid}|${ref.locale || ''}`;
        if (!groups.has(key)) groups.set(key, { uid: ref.uid, locale: ref.locale || null, ids: new Set() });
        groups.get(key).ids.add(ref.documentId);
      }
      const statuses = new Map();
      for (const [key, group] of groups) {
        let result;
        try {
          result = userAbility
            ? await checkGroup(userAbility, group.uid, group.locale, [...group.ids])
            : new Map();
        } catch (error) {
          logger.warn('internal link check failed', error);
          result = new Map();
        }
        statuses.set(key, result);
      }
      const internalOut = internal.map((ref) => ({
        uid: ref.uid,
        documentId: ref.documentId,
        locale: ref.locale || null,
        status: statuses.get(`${ref.uid}|${ref.locale || ''}`).get(ref.documentId) || 'unknown',
      }));

      // Media Library files.
      let mediaOut = media.map((id) => ({ id, status: 'unknown' }));
      if (media.length && can('plugin::upload.read')) {
        try {
          const numeric = media.filter((id) => typeof id === 'number');
          const strings = media.filter((id) => typeof id === 'string');
          const or = [];
          if (numeric.length) or.push({ id: { $in: numeric } });
          if (strings.length) or.push({ documentId: { $in: strings } });
          const rows = await strapi.db
            .query('plugin::upload.file')
            .findMany({ where: { $or: or }, select: ['id', 'documentId'], limit: media.length * 2 });
          const ids = new Set(rows.map((row) => row.id));
          const documentIds = new Set(rows.map((row) => row.documentId));
          mediaOut = media.map((id) => ({
            id,
            status: (typeof id === 'number' ? ids.has(id) : documentIds.has(id)) ? 'ok' : 'missing',
          }));
        } catch (error) {
          logger.warn('media check failed', error);
        }
      }

      // External URLs (opt-in).
      let externalOut = external.map((url) => ({ url, status: 'skipped' }));
      if (external.length && conf('enabled', false) === true) {
        const unique = [...new Set(external)];
        const results = new Map();
        const pending = [];
        for (const url of unique) {
          const hit = cached(url);
          if (hit) results.set(url, hit);
          else pending.push(url);
        }
        for (let i = 0; i < pending.length; i += 1) {
          if (!(await allowExternal(user && user.id))) {
            throw new errors.RateLimitError('Too many link checks. Try again in a minute.');
          }
        }
        for (let i = 0; i < pending.length; i += CONCURRENCY) {
          const batch = pending.slice(i, i + CONCURRENCY);
          const checked = await Promise.all(batch.map((url) => checkUrl(url)));
          batch.forEach((url, index) => {
            results.set(url, checked[index]);
            remember(url, checked[index]);
          });
        }
        externalOut = external.map((url) => ({ url, ...results.get(url) }));
        logger.debug('external links checked', {
          count: pending.length,
          cached: unique.length - pending.length,
        });
      }

      return { internal: internalOut, media: mediaOut, external: externalOut };
    },
  };
};

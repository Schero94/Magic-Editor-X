'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const ipaddr = require('ipaddr.js');

/**
 * Outbound HTTP for link previews, image-by-URL and the AI provider.
 *
 * SSRF controls:
 * - only http(s), no credentials in the URL, length cap;
 * - the host is resolved once and every address must be public unicast
 *   (no loopback, private, link-local, CGNAT, multicast, reserved or
 *   IPv4-mapped private addresses) unless `allowPrivate` is set by the owner;
 * - the connection is pinned to the checked address (no DNS rebinding);
 * - redirects are followed manually and re-checked, with a small limit;
 * - response size, MIME type and time are bounded.
 */

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10000;
const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid', '.home.arpa'];

/**
 * Creates an error with an HTTP status for the controller.
 * @param {string} message - Fixed message.
 * @param {number} [statusCode=400] - HTTP status.
 * @returns {Error} Error.
 */
function securityError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code: 'URL_REJECTED' });
}

/**
 * True when the address is a public unicast address.
 * @param {string} address - IPv4 or IPv6 address.
 * @returns {boolean} Public or not.
 */
function isPublicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

/**
 * Validates an outbound URL.
 * @param {unknown} input - URL string.
 * @param {{ allowPrivate?: boolean }} [options] - Allow private hosts (owner opt-in).
 * @returns {URL} Parsed URL.
 * @throws {Error} 400 when the URL is not allowed.
 */
function validateHttpUrl(input, options = {}) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw securityError('URL must be a valid HTTP(S) address');
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw securityError('URL must be a valid HTTP(S) address');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hostname) {
    throw securityError('Only public HTTP(S) URLs are allowed');
  }
  if (options.allowPrivate) return url;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    throw securityError('Local and internal hosts are not allowed');
  }
  const unwrapped = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(unwrapped) && !isPublicAddress(unwrapped)) {
    throw securityError('Private and reserved IP addresses are not allowed');
  }
  return url;
}

/**
 * Resolves the host and checks every address.
 * @param {URL} url - Target.
 * @param {Function} [resolve] - DNS lookup (injectable for tests).
 * @param {{ allowPrivate?: boolean }} [options] - Allow private addresses.
 * @returns {Promise<{ address: string, family: number }>} The address to connect to.
 */
async function resolvePublicAddresses(url, resolve = dns.lookup, options = {}) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }]
    : await resolve(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw securityError('URL host could not be resolved', 502);
  }
  if (!options.allowPrivate && addresses.some(({ address }) => !isPublicAddress(address))) {
    throw securityError('URL host does not resolve exclusively to public addresses');
  }
  return addresses[0];
}

/**
 * Performs one HTTP request pinned to a checked address.
 * @param {URL} url - Target.
 * @param {{ address: string, maxBytes: number, timeoutMs?: number, method?: string, headers?: object, body?: Buffer|string }} options - Request options.
 * @returns {Promise<{ statusCode: number, headers: object, body: Buffer }>} Response.
 */
function requestOnce(
  url,
  { address, maxBytes, timeoutMs = REQUEST_TIMEOUT_MS, method = 'GET', headers = {}, body }
) {
  const transport = url.protocol === 'https:' ? https : http;
  const family = ipaddr.parse(address).kind() === 'ipv6' ? 6 : 4;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        method,
        path: `${url.pathname}${url.search}`,
        headers: { 'user-agent': 'MagicEditorX/2.0', accept: '*/*', ...headers },
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions && lookupOptions.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
        servername: ipaddr.isValid(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
        timeout: timeoutMs,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const responseHeaders = response.headers;
        if (statusCode >= 300 && statusCode < 400 && responseHeaders.location) {
          response.resume();
          resolve({ statusCode, headers: responseHeaders, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(responseHeaders['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          response.destroy();
          reject(securityError('Remote response exceeds the allowed size limit', 413));
          return;
        }
        const chunks = [];
        let total = 0;
        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            response.destroy(securityError('Remote response exceeds the allowed size limit', 413));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({ statusCode, headers: responseHeaders, body: Buffer.concat(chunks) })
        );
        response.on('error', reject);
      }
    );
    const timer = setTimeout(
      () => request.destroy(securityError('Remote request timed out', 504)),
      timeoutMs
    );
    request.on('close', () => clearTimeout(timer));
    request.on('timeout', () => request.destroy(securityError('Remote request timed out', 504)));
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/**
 * Fetches a URL with all SSRF controls.
 * @param {string} input - URL.
 * @param {object} options - Options.
 * @param {number} options.maxBytes - Response size limit.
 * @param {string[]} [options.allowedMimeTypes] - Allowed response types.
 * @param {number} [options.maxRedirects=3] - Redirect limit (0 disables redirects).
 * @param {number} [options.timeoutMs] - Time limit per hop.
 * @param {boolean} [options.allowPrivate=false] - Allow private hosts (owner opt-in).
 * @param {string} [options.method='GET'] - HTTP method.
 * @param {object} [options.headers] - Request headers.
 * @param {Buffer|string} [options.body] - Request body.
 * @param {(status: number) => boolean} [options.acceptStatus] - Statuses returned instead of thrown.
 * @param {Function} [options.resolve] - DNS lookup (tests).
 * @param {Function} [options.request] - Request function (tests).
 * @returns {Promise<{ url: URL, statusCode: number, mimeType: string, body: Buffer }>} Response.
 * @throws {Error} With `statusCode` 400/413/415/502/504 on rejection.
 */
async function fetchBounded(input, options = {}) {
  const {
    resolve = dns.lookup,
    request = requestOnce,
    maxBytes,
    allowedMimeTypes,
    maxRedirects = MAX_REDIRECTS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    allowPrivate = false,
    method = 'GET',
    headers,
    body,
    acceptStatus = (status) => status === 200,
  } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw securityError('A positive response size limit is required', 500);
  }
  let url = validateHttpUrl(input, { allowPrivate });
  for (let redirects = 0; ; redirects += 1) {
    const address = await resolvePublicAddresses(url, resolve, { allowPrivate });
    const response = await request(url, {
      address: address.address,
      maxBytes,
      timeoutMs,
      method,
      headers,
      body,
    });
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      if (redirects >= maxRedirects) throw securityError('Remote URL exceeded the redirect limit', 502);
      url = validateHttpUrl(new URL(response.headers.location, url).href, { allowPrivate });
      continue;
    }
    if (!acceptStatus(response.statusCode)) {
      throw Object.assign(securityError(`Remote server returned HTTP ${response.statusCode}`, 502), {
        upstreamStatus: response.statusCode,
      });
    }
    const mimeType = String(response.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (
      Array.isArray(allowedMimeTypes) &&
      allowedMimeTypes.length > 0 &&
      !allowedMimeTypes.includes(mimeType)
    ) {
      throw securityError('Remote response has a disallowed MIME type', 415);
    }
    if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes) {
      throw securityError('Remote response exceeds the allowed size limit', 413);
    }
    return { url, statusCode: response.statusCode, mimeType, body: response.body };
  }
}

/**
 * Cloud metadata endpoints and names. They stay refused even when the owner
 * lists their origin as a private origin: no storage or intranet service
 * lives there, and they hand out credentials.
 */
const METADATA_ADDRESSES = new Set(['169.254.169.254', '169.254.170.2', 'fd00:ec2::254', '100.100.100.200']);
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata']);

/**
 * True for addresses a listed private origin may never reach: link-local
 * (cloud metadata lives in 169.254.0.0/16 and fe80::/10), unspecified,
 * multicast, broadcast, reserved and the known metadata addresses.
 * Loopback, RFC 1918, unique-local and CGNAT addresses are allowed.
 * @param {string} address - IPv4 or IPv6 address.
 * @returns {boolean} Forbidden or not.
 */
function isForbiddenPrivateAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    if (METADATA_ADDRESSES.has(parsed.toString())) return true;
    return ['linkLocal', 'unspecified', 'multicast', 'broadcast', 'reserved'].includes(parsed.range());
  } catch {
    return true;
  }
}

/**
 * True when an origin may be listed as a private origin: http(s), exactly
 * `URL.origin`, not a metadata host or a link-local/unspecified address.
 * Used by the config validator (refused at boot).
 * @param {unknown} value - Origin.
 * @returns {boolean} Allowed or not.
 */
function isListablePrivateOrigin(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(host)) return false;
  return !(ipaddr.isValid(host) && isForbiddenPrivateAddress(host));
}

/**
 * Request function that never follows a redirect: the Location header is
 * dropped, so `fetchBounded` returns or rejects the 3xx response itself.
 * @param {URL} url - Target.
 * @param {object} options - `requestOnce` options.
 * @returns {Promise<{ statusCode: number, headers: object, body: Buffer }>} Response.
 */
async function requestWithoutRedirect(url, options) {
  const response = await requestOnce(url, options);
  if (response.statusCode >= 300 && response.statusCode < 400) {
    const { location: _location, ...headers } = response.headers || {};
    return { ...response, headers };
  }
  return response;
}

/**
 * Fetch options for a URL whose exact origin (`URL.origin`) the owner listed
 * as private (`qualityChecks.externalLinks.allowPrivateOrigins`,
 * `ai.altText.allowPrivateOrigins`). Returns null when the origin is not
 * listed, so the caller keeps the full public-only policy.
 *
 * A listed origin may resolve to loopback or private addresses, but:
 * - redirects are never followed (a 3xx is returned or rejected as is);
 * - the host is resolved once and the connection is pinned to the checked
 *   address (the same DNS-rebinding defence as public URLs);
 * - link-local, unspecified, multicast, reserved and cloud metadata addresses
 *   stay refused, also when a listed host name resolves to them.
 * @param {string} input - URL.
 * @param {unknown} allowedOrigins - Listed origins (config).
 * @param {{ resolve?: Function }} [options] - DNS lookup (tests).
 * @returns {{ allowPrivate: true, maxRedirects: 0, request: Function, resolve: Function }|null} Options or null.
 * @throws {Error} 400 when a listed origin points at a forbidden address.
 */
function privateOriginOptions(input, allowedOrigins, options = {}) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!allowedOrigins.includes(url.origin)) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(host) || (ipaddr.isValid(host) && isForbiddenPrivateAddress(host))) {
    throw securityError('Metadata and link-local addresses are not allowed');
  }
  const lookup = options.resolve || dns.lookup;
  const resolve = async (hostname, lookupOptions) => {
    const addresses = await lookup(hostname, lookupOptions);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.some(({ address }) => isForbiddenPrivateAddress(address))) {
      throw securityError('Metadata and link-local addresses are not allowed');
    }
    return list;
  };
  return { allowPrivate: true, maxRedirects: 0, request: requestWithoutRedirect, resolve };
}

module.exports = {
  isPublicAddress,
  validateHttpUrl,
  resolvePublicAddresses,
  fetchBounded,
  requestOnce,
  requestWithoutRedirect,
  isForbiddenPrivateAddress,
  isListablePrivateOrigin,
  privateOriginOptions,
};

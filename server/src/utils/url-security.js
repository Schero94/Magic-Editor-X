'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const ipaddr = require('ipaddr.js');

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10000;
const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid'];

function securityError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function isPublicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function validateHttpUrl(input) {
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
  if (LOCAL_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    throw securityError('Local and internal hosts are not allowed');
  }
  const unwrappedHostname = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(unwrappedHostname) && !isPublicAddress(unwrappedHostname)) {
    throw securityError('Private and reserved IP addresses are not allowed');
  }

  return url;
}

async function resolvePublicAddresses(url, resolve = dns.lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }]
    : await resolve(hostname, { all: true, verbatim: true });

  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw securityError('URL host does not resolve exclusively to public addresses');
  }

  return addresses[0];
}

function requestOnce(url, { address, maxBytes, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const transport = url.protocol === 'https:' ? https : http;
  const family = ipaddr.parse(address).kind() === 'ipv6' ? 6 : 4;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: { 'user-agent': 'MagicEditorX/1.0', accept: '*/*' },
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      servername: url.hostname.replace(/^\[|\]$/g, ''),
      timeout: timeoutMs,
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const headers = response.headers;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        resolve({ statusCode, headers, body: Buffer.alloc(0) });
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(securityError(`Remote server returned HTTP ${statusCode}`, 502));
        return;
      }

      const declaredLength = Number(headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
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
      response.on('end', () => resolve({ statusCode, headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });

    request.on('timeout', () => request.destroy(securityError('Remote request timed out', 502)));
    request.on('error', reject);
    request.end();
  });
}

async function fetchBounded(input, {
  resolve = dns.lookup,
  request = requestOnce,
  maxBytes,
  allowedMimeTypes,
  maxRedirects = MAX_REDIRECTS,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw securityError('A positive response size limit is required', 500);
  if (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.length === 0) throw securityError('Allowed response types are required', 500);

  let url = validateHttpUrl(input);
  for (let redirects = 0; ; redirects += 1) {
    const address = await resolvePublicAddresses(url, resolve);
    const response = await request(url, { address: address.address, family: address.family, maxBytes, timeoutMs });

    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      if (redirects >= maxRedirects) throw securityError('Remote URL exceeded the redirect limit');
      url = validateHttpUrl(new URL(response.headers.location, url).href);
      continue;
    }

    const mimeType = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (!allowedMimeTypes.includes(mimeType)) throw securityError('Remote response has a disallowed MIME type', 415);
    if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes) throw securityError('Remote response exceeds the allowed size limit', 413);
    return { url, mimeType, body: response.body };
  }
}

module.exports = { isPublicAddress, validateHttpUrl, resolvePublicAddresses, fetchBounded };

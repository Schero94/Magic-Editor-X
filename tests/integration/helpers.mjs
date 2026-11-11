/**
 * Helpers for the integration suite. It runs against a running Strapi 5.61
 * host with this plugin installed (see CONTRIBUTING.md): set MEX_HOST_URL and
 * MEX_CREDS (path to the creds.json written by the seed script). The suite
 * fails, never skips, when they are missing.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

export const HOST = process.env.MEX_HOST_URL;
const CREDS_PATH = process.env.MEX_CREDS;

assert.ok(HOST, 'MEX_HOST_URL must point to the acceptance host (for example http://127.0.0.1:1421)');
assert.ok(
  CREDS_PATH && fs.existsSync(CREDS_PATH),
  'MEX_CREDS must point to the creds.json of the acceptance host'
);

export const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));

/**
 * Calls the host.
 * @param {string} method - HTTP method.
 * @param {string} path - Path.
 * @param {{ token?: string, body?: unknown, headers?: object }} [options] - Options.
 * @returns {Promise<{ status: number, body: any, headers: Headers }>} Response.
 */
export const call = async (method, path, { token, body, headers = {} } = {}) => {
  const init = { method, headers: { accept: 'application/json', ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  const response = await fetch(HOST + path, init);
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
};

const tokens = new Map();

/**
 * Admin session token for a seeded account.
 * @param {'admin'|'editor'|'author'|'reviewer'} who - Account.
 * @returns {Promise<string>} Token.
 */
export const tokenFor = async (who) => {
  if (tokens.has(who)) return tokens.get(who);
  const account = who === 'admin' ? creds.admin : creds.users[who];
  const response = await call('POST', '/admin/login', {
    body: { email: account.email, password: account.password },
  });
  assert.equal(response.status, 200, `login ${who}`);
  tokens.set(who, response.body.data.token);
  return response.body.data.token;
};

/**
 * Creates an article draft through the Content Manager.
 * @param {string} token - Admin token.
 * @param {object} data - Fields.
 * @param {string} [locale] - Locale.
 * @returns {Promise<object>} Created document.
 */
export const createArticle = async (token, data, locale) => {
  const query = locale ? `?plugins[i18n][locale]=${locale}` : '';
  const response = await call('POST', `/content-manager/collection-types/api::article.article${query}`, {
    token,
    body: data,
  });
  assert.equal(response.status, 201, `create article: ${JSON.stringify(response.body).slice(0, 300)}`);
  return response.body.data;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/**
 * Builds a valid RGBA PNG of the given size (solid colour).
 * @param {number} [size=8] - Width and height.
 * @returns {Buffer} PNG bytes.
 */
export const makePng = (size = 8) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < size; y += 1)
    rows.push(Buffer.from([0, ...Array(size).fill([73, 69, 255, 255]).flat()]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

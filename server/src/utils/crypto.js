'use strict';

const crypto = require('node:crypto');

/**
 * Secret storage and signed tokens.
 *
 * - Stored secrets (the AI provider key) use AES-256-GCM with a random 12-byte IV,
 *   a 16-byte tag and the versioned format `v1:<iv>:<tag>:<ciphertext>` (base64url).
 *   The key is derived with HKDF from MAGIC_EDITOR_X_ENCRYPTION_KEY (or the plugin
 *   config `encryptionKey`). Without that key nothing is stored; there is no
 *   built-in fallback key.
 * - Collaboration tokens are HMAC-SHA256 signed with a subkey derived from the
 *   admin JWT secret, which every process of a cluster shares, so a token issued
 *   by one process is accepted by another behind a non-sticky load balancer.
 */

const MIN_KEY_LENGTH = 32;

/**
 * Derives a purpose-specific 32-byte key.
 * @param {string} master - Master secret.
 * @param {string} purpose - Purpose label.
 * @returns {Buffer} Derived key.
 */
const deriveKey = (master, purpose) =>
  Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(master, 'utf8'), Buffer.from('magic-editor-x'), purpose, 32)
  );

/**
 * Reads the encryption key for stored secrets.
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi instance.
 * @returns {string|null} Master key, or null when none is configured or it is too short.
 */
const getEncryptionKey = (strapi) => {
  const fromConfig = strapi.config.get('plugin::magic-editor-x.encryptionKey');
  const key =
    typeof fromConfig === 'string' && fromConfig ? fromConfig : process.env.MAGIC_EDITOR_X_ENCRYPTION_KEY;
  return typeof key === 'string' && key.length >= MIN_KEY_LENGTH ? key : null;
};

/** Default purpose of stored secrets (the AI provider key; 2.2 values use it). */
const AI_CREDENTIALS = 'magic-editor-x:ai-credentials';

/**
 * Encrypts a secret.
 * @param {string} plaintext - Secret value.
 * @param {string} master - Master key.
 * @param {string} [purpose] - Subkey purpose (one per kind of secret).
 * @returns {string} Versioned ciphertext.
 */
const encryptSecret = (plaintext, master, purpose = AI_CREDENTIALS) => {
  const key = deriveKey(master, purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    ':'
  );
};

/**
 * Decrypts a secret produced by `encryptSecret`.
 * @param {string} stored - Versioned ciphertext.
 * @param {string} master - Master key.
 * @param {string} [purpose] - Subkey purpose used for encryption.
 * @returns {string|null} Plaintext, or null when the key does not match or the value is corrupt.
 */
const decryptSecret = (stored, master, purpose = AI_CREDENTIALS) => {
  try {
    const [version, iv, tag, ciphertext] = String(stored).split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext) return null;
    const key = deriveKey(master, purpose);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(
      'utf8'
    );
  } catch {
    return null;
  }
};

/**
 * Returns the signing key for collaboration tokens.
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi instance.
 * @returns {Buffer} HMAC key.
 * @throws {Error} When the admin JWT secret is missing.
 */
const getTokenKey = (strapi) => {
  const secret = strapi.config.get('admin.auth.secret');
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('admin.auth.secret is required for collaboration tokens');
  }
  return deriveKey(secret, 'magic-editor-x:collaboration-token');
};

/**
 * Signs a JSON payload.
 * @param {object} payload - Claims.
 * @param {Buffer} key - HMAC key.
 * @returns {string} `<payload>.<signature>` in base64url.
 */
const signToken = (payload, key) => {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${signature}`;
};

/**
 * Verifies a token from `signToken` and checks its expiry.
 * @param {unknown} token - Token string.
 * @param {Buffer} key - HMAC key.
 * @param {number} [now=Date.now()] - Current time in ms.
 * @returns {object|null} Claims, or null when invalid or expired.
 */
const verifyToken = (token, key, now = Date.now()) => {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', key).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || typeof claims.exp !== 'number' || claims.exp < now)
      return null;
    return claims;
  } catch {
    return null;
  }
};

/**
 * SHA-256 hex digest.
 * @param {string} text - Input.
 * @returns {string} Hex digest.
 */
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

module.exports = {
  MIN_KEY_LENGTH,
  getEncryptionKey,
  encryptSecret,
  decryptSecret,
  getTokenKey,
  signToken,
  verifyToken,
  sha256,
};

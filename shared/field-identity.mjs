/**
 * Stable identity of editor fields inside repeatable components and dynamic
 * zones (2.4).
 *
 * A field inside a repeatable component or a dynamic zone has a positional
 * path (`sections.0.body`, `zone.1.body`): the index says where the entry is
 * in the form, not which entry it is. Version history, block comments, live
 * rooms and link reports are therefore keyed by an identity stored in the
 * value itself: a top-level `fieldKey` (random, URL-safe) that only values of
 * positional fields carry. The storage identity of such a field is
 * `<path without indices>#<fieldKey>` (`sections.body#Xy...`); every other
 * field keeps its path (`body`, `seo.body`).
 *
 * Pure ESM without dependencies: used by the server, the admin and the tests.
 */

/** A field key: 16 to 32 URL-safe characters (the plugin generates 22). */
export const FIELD_KEY_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

/** Length of generated keys (16 random bytes in base64url). */
export const FIELD_KEY_LENGTH = 22;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Whether a value is a valid field key.
 * @param {unknown} value - Candidate.
 * @returns {boolean} True for a string matching FIELD_KEY_PATTERN.
 */
export const isValidFieldKey = (value) => typeof value === 'string' && FIELD_KEY_PATTERN.test(value);

/**
 * Creates a new field key from a cryptographic random source.
 * @param {(bytes: Uint8Array) => Uint8Array} [fill] - Fills the array with random bytes
 *   (default `globalThis.crypto.getRandomValues`, available in browsers and Node 20+).
 * @returns {string} 22 base64url characters (128 random bits).
 * @throws {Error} When no cryptographic random source exists.
 */
export const createFieldKey = (fill) => {
  const bytes = new Uint8Array(22);
  const source =
    fill ||
    (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function'
      ? (array) => globalThis.crypto.getRandomValues(array)
      : null);
  if (!source) throw new Error('No cryptographic random source');
  source(bytes);
  let key = '';
  for (let i = 0; i < FIELD_KEY_LENGTH; i += 1) key += BASE64URL[bytes[i] & 63];
  return key;
};

/**
 * Whether a field path contains a repeatable component or dynamic zone index.
 * @param {unknown} path - Field path (`body`, `seo.text`, `sections.0.body`).
 * @returns {boolean} True for positional paths.
 */
export const isPositionalFieldPath = (path) =>
  typeof path === 'string' && path.split('.').some((part) => /^\d+$/.test(part));

/**
 * The path without its indices (`sections.0.inner.2.body` -> `sections.inner.body`).
 * @param {string} path - Field path.
 * @returns {string} Base path.
 */
export const basePathOf = (path) =>
  String(path)
    .split('.')
    .filter((part) => !/^\d+$/.test(part))
    .join('.');

/**
 * Storage identity of a field: `<base path>#<fieldKey>` for a keyed positional
 * field, the path itself otherwise.
 * @param {string} path - Field path (with or without indices).
 * @param {string|null|undefined} fieldKey - Key of the value (positional fields only).
 * @param {boolean} [positional] - Whether the field is positional (default: the path has an index).
 * @returns {string|null} Identity; null for a positional field without a valid key.
 */
export const fieldIdentity = (path, fieldKey, positional = isPositionalFieldPath(path)) => {
  if (!positional) return String(path);
  return isValidFieldKey(fieldKey) ? `${basePathOf(path)}#${fieldKey}` : null;
};

/**
 * Splits a stored field name into its path and key.
 * @param {unknown} name - Stored `fieldName` (`body`, `sections.body#key`, `sections.0.body`).
 * @returns {{ field: string, fieldKey: string|null, legacy: boolean } | null} Parts: `legacy` marks a
 *   positional path stored before 2.4; null for an invalid name.
 */
export const parseFieldIdentity = (name) => {
  if (typeof name !== 'string' || !name) return null;
  const hash = name.indexOf('#');
  if (hash === -1) return { field: name, fieldKey: null, legacy: isPositionalFieldPath(name) };
  const field = name.slice(0, hash);
  const fieldKey = name.slice(hash + 1);
  if (!field || !isValidFieldKey(fieldKey) || isPositionalFieldPath(field)) return null;
  return { field, fieldKey, legacy: false };
};

/**
 * Block ids of an editor value (any stored shape with a `blocks` array).
 * @param {unknown} value - Editor value.
 * @returns {Set<string>} Ids.
 */
export const blockIdsOf = (value) => {
  const ids = new Set();
  const blocks = value && typeof value === 'object' && Array.isArray(value.blocks) ? value.blocks : [];
  for (const block of blocks) {
    if (block && typeof block.id === 'string' && block.id) ids.add(block.id);
  }
  return ids;
};

/**
 * Finds the one entry a legacy (positional) row belongs to by block ids.
 * Editor.js block ids are random 10-character strings, so a row whose block
 * ids appear in exactly one current entry is that entry's; a row that matches
 * none or several entries stays unmapped.
 * @param {Iterable<string>} rowBlockIds - Block ids the row refers to (a version's blocks, a comment's block).
 * @param {Array<{ blockIds: Set<string> }>} entries - Current entries of the same base path.
 * @returns {number} Index of the owning entry in `entries`, or -1.
 */
export const ownerOfBlocks = (rowBlockIds, entries) => {
  const ids = Array.from(rowBlockIds || []);
  if (ids.length === 0) return -1;
  let owner = -1;
  for (let i = 0; i < entries.length; i += 1) {
    const set = entries[i].blockIds;
    if (!set || set.size === 0) continue;
    if (ids.some((id) => set.has(id))) {
      if (owner !== -1) return -1;
      owner = i;
    }
  }
  return owner;
};

/**
 * Gives every non-null positional value a key and makes keys unique within
 * one write: a value without a valid key gets `inherit(path)` (the key the
 * same stored component row had, if any) or a new key; a key seen earlier in
 * the same write is replaced by a new key. Non-positional values lose any key.
 * Mutates the values.
 * @param {Array<{ path: string, value: object|null }>} items - Clean values in document order.
 * @param {{ create?: () => string, inherit?: (item: object) => string|null|undefined }} [options] - Key sources.
 * @returns {number} Number of keys assigned or replaced.
 */
export const assignFieldKeys = (items, options = {}) => {
  const create = options.create || (() => createFieldKey());
  const seen = new Set();
  let changed = 0;
  for (const item of items) {
    const value = item.value;
    if (!value || typeof value !== 'object') continue;
    if (!isPositionalFieldPath(item.path)) {
      if ('fieldKey' in value) delete value.fieldKey;
      continue;
    }
    let key = isValidFieldKey(value.fieldKey) ? value.fieldKey : null;
    if (!key && options.inherit) {
      const inherited = options.inherit(item);
      if (isValidFieldKey(inherited) && !seen.has(inherited)) key = inherited;
    }
    if (!key || seen.has(key)) {
      key = create();
      while (seen.has(key)) key = create();
    }
    if (value.fieldKey !== key) {
      value.fieldKey = key;
      changed += 1;
    }
    seen.add(key);
  }
  return changed;
};

/**
 * Editor.js data helpers shared by the server and the admin bundle.
 *
 * Every function here is pure (no DOM, no Strapi), so the same rules run when the
 * server stores a value, when the admin renders it and in `node --test`.
 *
 * Stored values of a Magic Editor X field come in several historical shapes:
 * - an Editor.js object `{ time, blocks, version }` (2.x stores this),
 * - the same object serialised as a JSON string (1.x stored strings),
 * - a JSON string serialised twice (seen in imports),
 * - plain text or HTML from a field that was converted from a text type,
 * - an array of blocks without the wrapper object.
 * `normalizeEditorData` turns all of them into one canonical object.
 */

/** Hard limits for one field value. Bigger values are rejected, never truncated. */
import { activeBlock } from './blocks/active.mjs';
import { isMarkedBuiltIn } from './built-in-marker.mjs';
import { isValidFieldKey } from './field-identity.mjs';

export const EDITOR_DATA_LIMITS = Object.freeze({
  maxBlocks: 5000,
  maxBytes: 5 * 1024 * 1024,
  maxDepth: 24,
  maxBlockIdLength: 64,
  maxTypeLength: 64,
});

/** Keys that could change an object's prototype when merged by other code. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BLOCK_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Tells whether a value is a plain JSON object (not null, not an array).
 * @param {unknown} value - Value to test.
 * @returns {boolean} True for `{}`-style objects.
 */
export const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Error thrown when a value cannot be accepted as editor content.
 */
export class EditorDataError extends Error {
  /**
   * @param {string} message - Fixed, non-sensitive message.
   * @param {string} code - Machine-readable reason.
   */
  constructor(message, code) {
    super(message);
    this.name = 'EditorDataError';
    this.code = code;
  }
}

/**
 * Deep-copies JSON-like data and drops keys that could pollute prototypes.
 * Functions, symbols and undefined values are dropped like JSON.stringify does.
 * @param {unknown} value - Input value.
 * @param {number} [depth=0] - Current depth, used to enforce the depth limit.
 * @returns {unknown} A clean copy.
 * @throws {EditorDataError} When the value is nested deeper than the limit.
 */
export const cloneJsonSafe = (value, depth = 0) => {
  if (depth > EDITOR_DATA_LIMITS.maxDepth) {
    throw new EditorDataError('Editor content is nested too deeply', 'TOO_DEEP');
  }
  if (value === null) return null;
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const cloned = cloneJsonSafe(item, depth + 1);
      out.push(cloned === undefined ? null : cloned);
    }
    return out;
  }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'object': {
      const out = {};
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        const cloned = cloneJsonSafe(value[key], depth + 1);
        if (cloned !== undefined) out[key] = cloned;
      }
      return out;
    }
    default:
      return undefined;
  }
};

/**
 * Parses JSON without throwing.
 * @param {string} text - JSON text.
 * @returns {{ ok: true, value: unknown } | { ok: false }} Parse result.
 */
const tryParseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

/**
 * Escapes text for safe use inside HTML.
 * @param {string} text - Plain text.
 * @returns {string} Escaped HTML.
 */
export const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Small deterministic string hash (FNV-1a, 32 bit) used to derive stable block ids.
 * @param {string} text - Input.
 * @returns {string} 8 hex characters.
 */
export const hashString = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Builds a deterministic id for a legacy block that has none, so every client and
 * process derives the same id from the same stored value.
 * @param {number} index - Block position.
 * @param {string} type - Block type.
 * @param {unknown} data - Block data.
 * @returns {string} Block id.
 */
const legacyBlockId = (index, type, data) =>
  `mx${hashString(`${index}:${type}:${JSON.stringify(data)}`)}${index}`;

/**
 * Converts a plain text or HTML string into paragraph blocks.
 * Text without tags is escaped; HTML is kept and sanitised later by the caller.
 * @param {string} text - Legacy text value.
 * @returns {Array<{type: string, data: object}>} Paragraph blocks.
 */
const textToBlocks = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const looksLikeHtml = /<\/?[a-z][^>]{0,200}>/i.test(trimmed.slice(0, 2000));
  if (looksLikeHtml) {
    return [{ type: 'paragraph', data: { text: trimmed } }];
  }
  return trimmed
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ type: 'paragraph', data: { text: escapeHtml(part).replace(/\r?\n/g, '<br>') } }));
};

/**
 * Turns any stored field value into a candidate object before validation.
 * @param {unknown} value - Raw stored value.
 * @returns {{ candidate: unknown, legacy: boolean }} Candidate and whether a legacy shape was found.
 */
const unwrapValue = (value) => {
  let current = value;
  let legacy = false;
  for (let i = 0; i < 3 && typeof current === 'string'; i += 1) {
    const text = current.trim();
    if (!text) return { candidate: null, legacy: true };
    if (text.startsWith('{') || text.startsWith('[') || text.startsWith('"')) {
      const parsed = tryParseJson(text);
      if (parsed.ok) {
        current = parsed.value;
        legacy = true;
        continue;
      }
    }
    return { candidate: { blocks: textToBlocks(text) }, legacy: true };
  }
  if (Array.isArray(current)) {
    return { candidate: { blocks: current }, legacy: true };
  }
  return { candidate: current, legacy };
};

/**
 * Normalises a stored Magic Editor X value into the canonical Editor.js shape.
 *
 * - Accepts every historical shape listed in the file header.
 * - Drops blocks without a valid type, gives blocks without an id a deterministic id,
 *   de-duplicates ids and removes prototype-polluting keys.
 * - Never truncates: a value above the limits throws, so nothing is silently lost.
 * - Keeps a valid `fieldKey` (2.4, identity of a positional field); other top-level keys are dropped.
 *
 * @param {unknown} value - Stored or submitted value.
 * @returns {{ time: number, blocks: Array<{id: string, type: string, data: object, tunes?: object}>, version: string, fieldKey?: string } | null}
 *   The normalised value, or null for an empty/absent value.
 * @throws {EditorDataError} When the value is too large, too deep or not editor content.
 */
export const normalizeEditorData = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.length > EDITOR_DATA_LIMITS.maxBytes) {
    throw new EditorDataError('Editor content exceeds the size limit', 'TOO_LARGE');
  }
  const { candidate } = unwrapValue(value);
  if (candidate === null || candidate === undefined) return null;
  if (!isPlainObject(candidate)) {
    throw new EditorDataError('Editor content must be an Editor.js object', 'INVALID_SHAPE');
  }
  const clean = cloneJsonSafe(candidate);
  const rawBlocks = Array.isArray(clean.blocks) ? clean.blocks : [];
  if (rawBlocks.length > EDITOR_DATA_LIMITS.maxBlocks) {
    throw new EditorDataError('Editor content has too many blocks', 'TOO_MANY_BLOCKS');
  }

  const seen = new Set();
  const blocks = [];
  rawBlocks.forEach((block, index) => {
    if (!isPlainObject(block)) return;
    const type = typeof block.type === 'string' ? block.type.trim() : '';
    if (!BLOCK_TYPE_PATTERN.test(type)) return;
    const data = isPlainObject(block.data) ? block.data : {};
    let id = typeof block.id === 'string' && BLOCK_ID_PATTERN.test(block.id) ? block.id : '';
    if (!id || seen.has(id)) id = legacyBlockId(index, type, data);
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const normalized = { id, type, data };
    if (isPlainObject(block.tunes) && Object.keys(block.tunes).length > 0) normalized.tunes = block.tunes;
    blocks.push(normalized);
  });

  const time = Number.isFinite(clean.time) && clean.time > 0 ? Math.floor(clean.time) : 0;
  const version = typeof clean.version === 'string' && clean.version.length <= 32 ? clean.version : '2.31.7';
  const result = { time, blocks, version };
  // 2.4: identity of a field inside a repeatable component or dynamic zone (shared/field-identity.mjs).
  if (isValidFieldKey(clean.fieldKey)) result.fieldKey = clean.fieldKey;
  const size = byteLength(JSON.stringify(result));
  if (size > EDITOR_DATA_LIMITS.maxBytes) {
    throw new EditorDataError('Editor content exceeds the size limit', 'TOO_LARGE');
  }
  return result;
};

/**
 * Like `normalizeEditorData` but never throws; invalid input becomes null.
 * @param {unknown} value - Stored value.
 * @returns {ReturnType<typeof normalizeEditorData>} Normalised value or null.
 */
export const normalizeEditorDataSafe = (value) => {
  try {
    return normalizeEditorData(value);
  } catch {
    return null;
  }
};

/**
 * UTF-8 byte length of a string without Buffer/TextEncoder dependencies.
 * @param {string} text - Input text.
 * @returns {number} Byte length.
 */
export const byteLength = (text) => {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
};

/**
 * Tells whether a stored value is an Editor.js document (used by the response parser).
 * @param {unknown} value - Parsed value.
 * @returns {boolean} True when it has a `blocks` array.
 */
export const looksLikeEditorData = (value) => isPlainObject(value) && Array.isArray(value.blocks);

/**
 * Counts words and characters of the visible text, for the editor footer.
 * @param {{ blocks: Array<{ data: object }> } | null} data - Normalised editor data.
 * @returns {{ blocks: number, words: number, characters: number }} Statistics.
 */
export const computeStats = (data) => {
  if (!data || !Array.isArray(data.blocks)) return { blocks: 0, words: 0, characters: 0 };
  let text = '';
  const collect = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      text += ` ${value.replace(/<[^>]{0,500}>/g, ' ').replace(/&nbsp;/g, ' ')}`;
    } else if (Array.isArray(value)) value.forEach((item) => collect(item, depth + 1));
    else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (['url', 'link', 'href', 'src', 'id', 'documentId', 'style', 'type', 'service'].includes(key))
          continue;
        collect(item, depth + 1);
      }
    }
  };
  data.blocks.forEach((block) => {
    // A synced block (2.3) stores only a reference; its text belongs to the source.
    if (block && block.type === 'synced' && isMarkedBuiltIn('synced', block.data)) return;
    // Code-registered blocks (custom block SDK) count their text and inline fields only.
    const definition = block && activeBlock(block.type);
    if (definition) definition.fields(block.data).forEach((field) => collect(field.value));
    else collect(block.data);
  });
  const normalized = text.replace(/\s+/g, ' ').trim();
  return {
    blocks: data.blocks.length,
    words: normalized ? normalized.split(' ').length : 0,
    characters: normalized.length,
  };
};

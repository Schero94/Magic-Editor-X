/**
 * Range comments (2.4): anchors of comment threads on a text range inside one
 * block. Pure helpers shared by the server (validation) and the admin
 * (creating anchors from the selection, finding them again).
 *
 * Anchor (stored as JSON in the comment row, next to the thread's `blockId`):
 *
 *   {
 *     path:  'text' | 'items.0.content' | ... | null   data key path of the text field inside the block
 *     start: base64 | null    encoded Yjs RelativePosition (assoc 0) on that field's Y.Text in the live room
 *     end:   base64 | null    encoded Yjs RelativePosition (assoc -1)
 *     quote: { exact, prefix, suffix }                  text-quote fallback (plain text)
 *   }
 *
 * The Y.Text of a field holds its HTML source (shared/ydoc.mjs), so relative
 * positions point into the HTML source. `htmlTextMap` maps between the
 * source and the text a reader sees (tags dropped, entities decoded, `<br>`
 * as a line feed): the DOM text of the field's element is built with the same
 * rules (admin/src/editor/comment-anchor-dom.js), so text offsets of a DOM
 * selection map to source offsets and back.
 *
 * Finding an anchor again: relative positions in the current room document,
 * then the quote in the block, otherwise the thread is "text changed" (block
 * still there) or "detached" (block gone).
 */

/** Longest quoted text (characters). */
export const MAX_QUOTE_LENGTH = 500;

/** Context kept before and after the quote (characters). */
export const MAX_QUOTE_AFFIX = 32;

/** Longest encoded relative position (bytes before base64). */
export const MAX_RELPOS_BYTES = 512;

/** Longest base64 text of an encoded relative position. */
export const MAX_RELPOS_BASE64 = Math.ceil(MAX_RELPOS_BYTES / 3) * 4;

/** Data key path of a text field: up to 8 keys or indexes separated by dots. */
export const ANCHOR_PATH_PATTERN = /^[A-Za-z0-9_-]{1,64}(?:\.[A-Za-z0-9_-]{1,64}){0,7}$/;

/** Standard base64 with padding. */
export const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// C0/C1 controls except line feed (a `<br>` is a line feed in the anchor text).
// eslint-disable-next-line no-control-regex -- control characters are removed from quotes
const QUOTE_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  shy: '\u00ad',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  hellip: '\u2026',
  copy: '\u00a9',
  reg: '\u00ae',
  euro: '\u20ac',
};

/**
 * Decodes one character reference at `index` (which points at `&`).
 * @param {string} html - Source.
 * @param {number} index - Position of `&`.
 * @returns {{ text: string, length: number }|null} Decoded text and source length, or null (literal `&`).
 */
const decodeEntity = (html, index) => {
  const semi = html.indexOf(';', index + 1);
  if (semi === -1 || semi - index > 12) return null;
  const name = html.slice(index + 1, semi);
  let code = null;
  if (/^#[0-9]{1,7}$/.test(name)) code = Number.parseInt(name.slice(1), 10);
  else if (/^#[xX][0-9a-fA-F]{1,6}$/.test(name)) code = Number.parseInt(name.slice(2), 16);
  else if (Object.prototype.hasOwnProperty.call(ENTITIES, name))
    return { text: ENTITIES[name], length: semi - index + 1 };
  if (code === null || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
  return { text: String.fromCodePoint(code), length: semi - index + 1 };
};

/**
 * Text of an HTML source as the browser shows it, with the source position of
 * every text character (UTF-16 code units). Tags are dropped, `<br>` is a line
 * feed, character references are decoded, comments are dropped. Linear in the
 * length of the source.
 * @param {string} html - Inline HTML (an Editor.js text field).
 * @returns {{ text: string, starts: number[], ends: number[] }} Text, and per text unit the source range [start, end).
 */
export const htmlTextMap = (html) => {
  const source = typeof html === 'string' ? html : '';
  let text = '';
  const starts = [];
  const ends = [];
  const push = (value, start, end) => {
    for (let unit = 0; unit < value.length; unit += 1) {
      starts.push(start);
      ends.push(end);
    }
    text += value;
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    // `<` starts a tag only before a letter, `/`, `!` or `?` (like the HTML tokenizer); otherwise it is text.
    if (char === '<' && /[A-Za-z/!?]/.test(source[index + 1] || '')) {
      if (source.startsWith('<!--', index)) {
        const close = source.indexOf('-->', index + 4);
        index = close === -1 ? source.length : close + 3;
        continue;
      }
      const close = source.indexOf('>', index + 1);
      if (close === -1) {
        push(char, index, index + 1);
        index += 1;
        continue;
      }
      const tag = source.slice(index + 1, Math.min(close, index + 8)).toLowerCase();
      if (/^br(?:[\s/]|$)/.test(tag)) push('\n', index, close + 1);
      index = close + 1;
      continue;
    }
    if (char === '&') {
      const entity = decodeEntity(source, index);
      if (entity) {
        push(entity.text, index, index + entity.length);
        index += entity.length;
        continue;
      }
    }
    push(char, index, index + 1);
    index += 1;
  }
  return { text, starts, ends };
};

/**
 * Source range of a text range.
 * @param {{ text: string, starts: number[], ends: number[] }} map - `htmlTextMap` result.
 * @param {number} start - Text start (inclusive).
 * @param {number} end - Text end (exclusive, > start).
 * @returns {{ start: number, end: number }|null} Source range, or null for an empty or invalid range.
 */
export const textRangeToSource = (map, start, end) => {
  if (!map || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > map.text.length || end <= start) return null;
  return { start: map.starts[start], end: map.ends[end - 1] };
};

/**
 * Text range of a source range: the text units that lie completely inside it.
 * @param {{ text: string, starts: number[], ends: number[] }} map - `htmlTextMap` result.
 * @param {number} start - Source start.
 * @param {number} end - Source end.
 * @returns {{ start: number, end: number }|null} Text range, or null when no text is inside.
 */
export const sourceRangeToText = (map, start, end) => {
  if (!map || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  // First unit that starts at or after `start`.
  let low = 0;
  let high = map.starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (map.starts[mid] < start) low = mid + 1;
    else high = mid;
  }
  const from = low;
  // Units that end at or before `end`.
  low = 0;
  high = map.ends.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (map.ends[mid] <= end) low = mid + 1;
    else high = mid;
  }
  const to = low;
  return to > from ? { start: from, end: to } : null;
};

/**
 * Removes control characters (line feeds stay) from quote text.
 * @param {unknown} value - Text.
 * @param {number} max - Longest result.
 * @returns {string} Clean text.
 */
const cleanQuoteText = (value, max) =>
  typeof value === 'string'
    ? value
        .slice(0, max * 2)
        .replace(QUOTE_CONTROL, '')
        .slice(0, max)
    : '';

/**
 * Text-quote selector of a range of a text.
 * @param {string} text - Whole text of the field.
 * @param {number} start - Start (inclusive).
 * @param {number} end - End (exclusive).
 * @returns {{ exact: string, prefix: string, suffix: string }|null} Quote, or null when the range has no visible text.
 */
export const buildQuote = (text, start, end) => {
  if (typeof text !== 'string' || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > text.length || end <= start) return null;
  const exact = text.slice(start, Math.min(end, start + MAX_QUOTE_LENGTH));
  if (!exact.trim()) return null;
  return {
    exact,
    prefix: text.slice(Math.max(0, start - MAX_QUOTE_AFFIX), start),
    suffix: text.slice(start + exact.length, start + exact.length + MAX_QUOTE_AFFIX),
  };
};

/**
 * Length of the common suffix of `a` and `b`.
 * @param {string} a - Text.
 * @param {string} b - Text.
 * @returns {number} Length.
 */
const commonSuffix = (a, b) => {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count])
    count += 1;
  return count;
};

/**
 * Length of the common prefix of `a` and `b`.
 * @param {string} a - Text.
 * @param {string} b - Text.
 * @returns {number} Length.
 */
const commonPrefix = (a, b) => {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
};

/** Occurrences of the exact text considered when choosing by context. */
const MAX_OCCURRENCES = 1000;

/**
 * Finds a quote in a text: the occurrence of `exact` whose surrounding text
 * matches `prefix` and `suffix` best (first one on a tie).
 * @param {string} text - Text to search.
 * @param {{ exact: string, prefix?: string, suffix?: string }|null} quote - Quote.
 * @returns {{ start: number, end: number, score: number }|null} Range, or null when the text is not there.
 */
export const findQuote = (text, quote) => {
  if (typeof text !== 'string' || !quote || typeof quote.exact !== 'string' || !quote.exact) return null;
  const exact = quote.exact;
  const prefix = typeof quote.prefix === 'string' ? quote.prefix : '';
  const suffix = typeof quote.suffix === 'string' ? quote.suffix : '';
  let best = null;
  let from = 0;
  for (let seen = 0; seen < MAX_OCCURRENCES; seen += 1) {
    const index = text.indexOf(exact, from);
    if (index === -1) break;
    const before = text.slice(Math.max(0, index - prefix.length), index);
    const after = text.slice(index + exact.length, index + exact.length + suffix.length);
    const score = commonSuffix(before, prefix) + commonPrefix(after, suffix);
    if (!best || score > best.score) best = { start: index, end: index + exact.length, score };
    if (score === prefix.length + suffix.length) break;
    from = index + 1;
  }
  return best;
};

/**
 * Bytes of a base64 text (standard alphabet).
 * @param {string} value - Base64.
 * @returns {Uint8Array} Bytes.
 */
export const fromBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/**
 * Base64 text of bytes.
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} Base64.
 */
export const toBase64 = (bytes) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
};

/**
 * True when `value` looks like an encoded relative position: standard base64
 * of at most MAX_RELPOS_BYTES bytes. The server never decodes it (it has no
 * room document to resolve it against); the admin decodes it defensively
 * (shared/comment-relpos.mjs) and falls back to the quote when it fails.
 * @param {unknown} value - Untrusted value.
 * @returns {boolean} Result.
 */
export const isRelPos = (value) => {
  if (typeof value !== 'string' || value.length < 4 || value.length > MAX_RELPOS_BASE64) return false;
  if (!BASE64_PATTERN.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding <= MAX_RELPOS_BYTES;
};

/**
 * Validated anchor (server: after the zod shape check; admin: data from the API).
 * @param {unknown} value - Untrusted anchor.
 * @returns {{ path: string|null, start: string|null, end: string|null, quote: { exact: string, prefix: string, suffix: string } }|null}
 *   Clean anchor, or null when it is not usable.
 */
export const cleanAnchor = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const quote = value.quote;
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return null;
  const exact = cleanQuoteText(quote.exact, MAX_QUOTE_LENGTH);
  if (!exact.trim()) return null;
  const path =
    typeof value.path === 'string' &&
    ANCHOR_PATH_PATTERN.test(value.path) &&
    !value.path.split('.').some((key) => FORBIDDEN_KEYS.has(key))
      ? value.path
      : null;
  const relative = path !== null && isRelPos(value.start) && isRelPos(value.end);
  return {
    path,
    start: relative ? value.start : null,
    end: relative ? value.end : null,
    quote: {
      exact,
      prefix: cleanQuoteText(quote.prefix, MAX_QUOTE_AFFIX),
      suffix: cleanQuoteText(quote.suffix, MAX_QUOTE_AFFIX),
    },
  };
};

/* ------------------------------------------------------------ field paths */

/** Deepest data path walked when looking for text fields. */
const MAX_PATH_DEPTH = 8;

/** Text fields walked per block. */
const MAX_LEAVES = 2000;

/**
 * String leaves of a block's stored data with their key paths (Editor.js JSON).
 * @param {unknown} data - `block.data`.
 * @returns {Array<{ path: string, value: string }>} Leaves in key order.
 */
export const textLeaves = (data) => {
  const out = [];
  const visit = (value, path, depth) => {
    if (out.length >= MAX_LEAVES || depth > MAX_PATH_DEPTH) return;
    if (typeof value === 'string') {
      if (path.length) out.push({ path: path.join('.'), value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)], depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key) || !/^[A-Za-z0-9_-]{1,64}$/.test(key)) continue;
        visit(item, [...path, key], depth + 1);
      }
    }
  };
  visit(data, [], 0);
  return out;
};

/**
 * Status of an anchored thread after looking for its text.
 * @param {{ found: boolean, blockPresent: boolean }} state - Search result.
 * @returns {'anchored'|'changed'|'detached'} Status.
 */
export const anchorStatus = ({ found, blockPresent }) => {
  if (!blockPresent) return 'detached';
  return found ? 'anchored' : 'changed';
};

/**
 * Whole-field AI actions and the grammar check (2.3): pure helpers shared by
 * the server and the admin.
 *
 * - `collectSegments(data)` lists the inline text strings of a document as
 *   `{ blockId, path, html }` (the same fields find and replace searches:
 *   paragraphs, headings, quotes, lists, checklists, tables, captions, ...).
 *   Only these strings are ever sent to a provider; block ids, types, tunes,
 *   URLs of images and every other value stay in the browser.
 * - `applySegments(data, segments)` writes translated strings back at the same
 *   block id and path, leaving everything else untouched.
 * - `restrictLinks(html, allowedHrefs)` unwraps links a provider added (a
 *   translation must not introduce new link targets).
 * - `segmentText(html)` / `replaceInSegment(...)` give the plain text of a
 *   string and map a text range back onto the HTML; a range that crosses
 *   formatting (two text nodes) or a line break is refused.
 *
 * No DOM and no dependencies.
 */

import { isPlainObject } from './editor-data.mjs';
import { searchableFields } from './find-replace.mjs';
import { parseInline, nodesToHtml } from './render/inline.mjs';

/** Most segments one request may carry. */
export const MAX_SEGMENTS = 1000;
/** Longest inline HTML string accepted per segment. */
export const MAX_SEGMENT_HTML = 20000;
/** Block id and path patterns (as stored by Editor.js and listed by `searchableFields`). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Keys of code-registered blocks (custom block SDK) may hold digits and underscores (up to 64 characters).
export const SEGMENT_PATH_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]{0,63}(\.\d{1,4}|\.[A-Za-z][A-Za-z0-9_]{0,63}){0,26}$/;

/**
 * @typedef {{ blockId: string, path: string, html: string }} Segment
 */

/**
 * Plain text of inline HTML for length checks (`<br>` counts as one character).
 * @param {string} html - Inline HTML.
 * @returns {string} Text.
 */
export const segmentPlainText = (html) => segmentText(html).text;

/**
 * Lists the inline text strings of a document. Empty strings are skipped.
 * @param {{ blocks?: Array<{ id: string, type: string, data: object }> }|null} data - Normalised document.
 * @returns {Segment[]} Segments in document order (at most MAX_SEGMENTS).
 */
export const collectSegments = (data) => {
  const out = [];
  if (!data || !Array.isArray(data.blocks)) return out;
  for (const block of data.blocks) {
    if (!block || typeof block.id !== 'string' || !BLOCK_ID_PATTERN.test(block.id)) continue;
    for (const field of searchableFields(block)) {
      if (field.kind !== 'html') continue;
      if (!segmentPlainText(field.value).trim()) continue;
      out.push({ blockId: block.id, path: field.path.join('.'), html: field.value });
      if (out.length >= MAX_SEGMENTS) return out;
    }
  }
  return out;
};

/**
 * Sets a value at a path inside a copy of `data` (only existing string slots).
 * @param {object|Array} data - Block data.
 * @param {Array<string|number>} path - Path.
 * @param {string} value - New value.
 * @returns {object|Array|null} New data, or null when the path does not hold a string.
 */
const setStringAt = (data, path, value) => {
  const [head, ...rest] = path;
  if (Array.isArray(data) ? !Number.isInteger(head) : !isPlainObject(data)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, head)) return null;
  if (!rest.length) {
    if (typeof data[head] !== 'string') return null;
    const copy = Array.isArray(data) ? [...data] : { ...data };
    copy[head] = value;
    return copy;
  }
  const inner = setStringAt(data[head], rest, value);
  if (inner === null) return null;
  const copy = Array.isArray(data) ? [...data] : { ...data };
  copy[head] = inner;
  return copy;
};

/**
 * Splits a dotted path into keys and array indexes.
 * @param {string} path - `items.0.content`.
 * @returns {Array<string|number>} Keys.
 */
const splitPath = (path) => path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

/**
 * Reads the string at a block path.
 * @param {object} blockData - Block data.
 * @param {string} path - Dotted path.
 * @returns {string|null} Value.
 */
export const readSegment = (blockData, path) => {
  let value = blockData;
  for (const key of splitPath(path)) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key))
      return null;
    value = value[key];
  }
  return typeof value === 'string' ? value : null;
};

/**
 * Writes strings back into a copy of the document. Blocks keep their id,
 * type, tunes and every other value; only the listed string slots change.
 * @param {{ blocks: Array<{ id: string, type: string, data: object }> }} data - Document.
 * @param {Segment[]} segments - New strings.
 * @returns {{ data: object, changed: number, missing: number }} New document and counts.
 */
export const applySegments = (data, segments) => {
  const byBlock = new Map();
  for (const segment of segments) {
    if (!byBlock.has(segment.blockId)) byBlock.set(segment.blockId, []);
    byBlock.get(segment.blockId).push(segment);
  }
  let changed = 0;
  let missing = 0;
  const seen = new Set();
  const blocks = data.blocks.map((block) => {
    const list = byBlock.get(block.id);
    if (!list) return block;
    seen.add(block.id);
    let next = block.data;
    for (const segment of list) {
      const updated = setStringAt(next, splitPath(segment.path), segment.html);
      if (updated === null) missing += 1;
      else {
        next = updated;
        changed += 1;
      }
    }
    return next === block.data ? block : { ...block, data: next };
  });
  for (const [blockId, list] of byBlock) if (!seen.has(blockId)) missing += list.length;
  return { data: { ...data, blocks }, changed, missing };
};

/**
 * Link targets of inline HTML (`href` values of `<a>`).
 * @param {string} html - Inline HTML.
 * @returns {string[]} Hrefs.
 */
export const linkHrefs = (html) => {
  const out = [];
  const walk = (nodes, depth = 0) => {
    if (depth > 40) return;
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tag === 'a' && typeof node.attrs.href === 'string') out.push(node.attrs.href);
      walk(node.children, depth + 1);
    }
  };
  walk(parseInline(html));
  return out;
};

/**
 * Unwraps every link whose target is not in `allowed` (keeps its text) and
 * serialises the result with the strict inline serialiser.
 * @param {string} html - Inline HTML from a provider.
 * @param {Iterable<string>} allowed - Link targets of the original string.
 * @returns {string} Inline HTML.
 */
export const restrictLinks = (html, allowed) => {
  const set = new Set(allowed);
  const walk = (nodes, depth = 0) =>
    nodes.flatMap((node) => {
      if (node.type !== 'element' || depth > 40) return [node];
      const children = walk(node.children, depth + 1);
      if (node.tag === 'a' && !set.has(node.attrs.href)) return children;
      return [{ ...node, children }];
    });
  return nodesToHtml(walk(parseInline(html)));
};

/**
 * Splits segments into chunks whose plain text stays under a limit (a single
 * longer segment forms its own chunk).
 * @param {Segment[]} segments - Segments.
 * @param {number} maxChars - Text characters per chunk.
 * @returns {Segment[][]} Chunks.
 */
export const chunkSegments = (segments, maxChars) => {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const segment of segments) {
    const length = segmentPlainText(segment.html).length;
    if (current.length && size + length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
};

/**
 * Plain text of inline HTML with the position of every text node.
 * `<br>` becomes "\n" (not part of any piece, so ranges never cross it).
 * @param {string} html - Inline HTML.
 * @returns {{ text: string, pieces: Array<{ start: number, end: number, index: number }> }} Text and text-node ranges (`index` = text node order).
 */
export const segmentText = (html) => {
  let text = '';
  const pieces = [];
  let index = 0;
  const walk = (nodes, depth = 0) => {
    if (depth > 40) return;
    for (const node of nodes) {
      if (node.type === 'text') {
        pieces.push({ start: text.length, end: text.length + node.value.length, index });
        text += node.value;
        index += 1;
      } else if (node.tag === 'br') text += '\n';
      else walk(node.children, depth + 1);
    }
  };
  walk(parseInline(typeof html === 'string' ? html : ''));
  return { text, pieces };
};

/**
 * Replaces a text range of inline HTML when it maps unambiguously onto one
 * text node and still holds the expected text.
 * @param {string} html - Current inline HTML.
 * @param {{ offset: number, length: number, expected: string, replacement: string }} change - Range in `segmentText(html).text`.
 * @returns {{ html: string|null, reason: null|'CHANGED'|'CROSSES_FORMATTING' }} New HTML, or the reason it was refused.
 */
export const replaceInSegment = (html, { offset, length, expected, replacement }) => {
  const { text, pieces } = segmentText(html);
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > text.length ||
    text.slice(offset, offset + length) !== expected
  )
    return { html: null, reason: 'CHANGED' };
  const piece = pieces.find((item) => item.start <= offset && offset + length <= item.end);
  if (!piece || (length === 0 && piece.end === piece.start))
    return { html: null, reason: 'CROSSES_FORMATTING' };
  const nodes = parseInline(html);
  let index = 0;
  let done = false;
  const walk = (list, depth = 0) => {
    if (depth > 40 || done) return;
    for (const node of list) {
      if (done) return;
      if (node.type === 'text') {
        if (index === piece.index) {
          const local = offset - piece.start;
          node.value =
            node.value.slice(0, local) +
            String(replacement).slice(0, 1000) +
            node.value.slice(local + length);
          done = true;
          return;
        }
        index += 1;
      } else if (node.tag !== 'br') walk(node.children, depth + 1);
    }
  };
  walk(nodes);
  return done ? { html: nodesToHtml(nodes), reason: null } : { html: null, reason: 'CROSSES_FORMATTING' };
};

/**
 * Joins the plain text of segments for a check request and keeps the start of
 * every segment, so a match offset maps back to its segment.
 * @param {Array<{ text: string }>} parts - Texts in order.
 * @param {string} [separator='\n\n'] - Separator between segments.
 * @returns {{ text: string, starts: number[] }} Joined text and segment starts.
 */
export const joinTexts = (parts, separator = '\n\n') => {
  let text = '';
  const starts = [];
  parts.forEach((part, index) => {
    if (index) text += separator;
    starts.push(text.length);
    text += part.text;
  });
  return { text, starts };
};

/**
 * Maps an offset range of the joined text to one part. Ranges that touch a
 * separator are dropped.
 * @param {{ starts: number[] }} joined - Result of `joinTexts`.
 * @param {Array<{ text: string }>} parts - Parts.
 * @param {number} offset - Start in the joined text.
 * @param {number} length - Length.
 * @returns {{ part: number, offset: number }|null} Part index and local offset.
 */
export const locateInJoined = (joined, parts, offset, length) => {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0) return null;
  let low = 0;
  let high = joined.starts.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (joined.starts[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  if (found < 0) return null;
  const local = offset - joined.starts[found];
  if (local + length > parts[found].text.length) return null;
  return { part: found, offset: local };
};

/**
 * Language tag for LanguageTool from a content locale. Languages whose
 * spell check needs a variant get the most common one.
 * @param {string|null|undefined} locale - Content locale (`de`, `en-GB`).
 * @returns {string} LanguageTool language code or `auto`.
 */
export const languageToolLanguage = (locale) => {
  if (typeof locale !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(locale)) return 'auto';
  const [language, region] = locale.split('-');
  const lower = language.toLowerCase();
  if (region) return `${lower}-${region.length === 2 ? region.toUpperCase() : region}`;
  const variants = { en: 'en-US', de: 'de-DE', pt: 'pt-PT', ca: 'ca-ES' };
  return variants[lower] || lower;
};

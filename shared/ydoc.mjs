/**
 * Mapping between an Editor.js document and a Yjs document (collaboration schema 4).
 *
 * Layout of the Y.Doc:
 * - `meta`   Y.Map    { schema: 4, time, version, epoch }
 * - `order`  Y.Array  block ids in document order (a sequence CRDT, so
 *                     concurrent inserts from two people are both kept)
 * - `blocks` Y.Map    id -> Y.Map { type, tunes, data, items? }
 *   - `data` and `tunes` are modelled structurally: every JSON object is a
 *     Y.Map, every array a Y.Array and every string a Y.Text. Numbers,
 *     booleans and null are plain values (last writer wins per key).
 *   - `items` (schema 4, built-in columns blocks only): the item store of a
 *     columns block, see "Columns blocks" below.
 *
 * Because every table cell, list item, checklist entry, tune and custom block
 * field has its own shared type, concurrent edits of different cells, items or
 * fields merge, concurrent typing in the same text merges character by
 * character, and concurrent changes of the same scalar resolve
 * deterministically (Yjs map semantics) without touching unrelated values.
 *
 * Block entries are never removed from `blocks`; `order` decides what is
 * visible. A concurrent "move" (delete + insert of the same id in `order`) and
 * a concurrent edit of that block therefore never lose data.
 *
 * Columns blocks (schema 4, 2.6.1): a Yjs type exists only once in a document
 * and cannot be moved, so nested items would be copied by a move and a
 * concurrent edit of the original would be lost. A built-in columns block
 * therefore keeps its items like the document keeps its blocks: the entry key
 * `items` is a Y.Map item id -> Y.Map { type, text, level?, style? } and every
 * column of `data.columns` is a Y.Map { id, items: Y.Array<item id> } that
 * only places items. Moving an item (also "fewer columns") changes the
 * placement lists and keeps the item's Y.Map and Y.Text. Reading: an item is
 * shown at its first place in reading order (two concurrent moves of one item
 * show it once), ids without a stored item are skipped (a delete wins over a
 * move), stored items without a place (placed in a column someone removed at
 * the same time) are shown at the end of the last column, sorted by id.
 * Rooms written by 2.6.0 (items nested in the columns) are read and edited
 * with the structural mapping; the server moves them to this layout with a
 * new room generation (`hasLegacyColumns`).
 *
 * Schema 2 rooms (2.0) stored non-string values as plain JSON. They are read
 * by the same reader; the first local change of such a value replaces it with
 * its structured form.
 *
 * The stored Editor.js JSON is unchanged: this module only maps it.
 */

import * as Y from 'yjs';
import { EDITOR_DATA_LIMITS, cloneJsonSafe, isPlainObject } from './editor-data.mjs';
import { isMarkedBuiltIn } from './built-in-marker.mjs';
import { COLUMNS_LIMITS } from './columns.mjs';

export const YDOC_SCHEMA = 4;

/** Highest nesting level read from or written to a shared document. */
const MAX_DEPTH = EDITOR_DATA_LIMITS.maxDepth;
/** Keys that could change an object's prototype; never read or written. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Returns the shared types of a document.
 * @param {Y.Doc} doc - Yjs document.
 * @returns {{ meta: Y.Map<any>, order: Y.Array<string>, blocks: Y.Map<Y.Map<any>> }} Shared types.
 */
export const getTypes = (doc) => ({
  meta: doc.getMap('meta'),
  order: doc.getArray('order'),
  blocks: doc.getMap('blocks'),
});

/**
 * Stable JSON for comparisons (key order independent).
 * @param {unknown} value - Value.
 * @returns {string} Canonical JSON.
 */
export const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const equal = (a, b) => a === b || stableStringify(a) === stableStringify(b);

/**
 * Applies the minimal edit that turns the text of a Y.Text into `next`
 * (common prefix and suffix are kept, so concurrent edits elsewhere survive).
 * @param {Y.Text} ytext - Shared text.
 * @param {string} next - Desired value.
 * @returns {boolean} True when the text changed.
 */
export const applyTextDiff = (ytext, next) => {
  const current = ytext.toString();
  if (current === next) return false;
  let start = 0;
  const minLength = Math.min(current.length, next.length);
  while (start < minLength && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }
  if (endCurrent > start) ytext.delete(start, endCurrent - start);
  if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  return true;
};

/**
 * Fallback of `applyTextEdit` for very long or very different texts: one
 * edit region, mapped through the common prefix and suffix of the shared text.
 * @param {Y.Text} ytext - Shared text.
 * @param {string} base - Text the editor started from.
 * @param {string} local - Text the editor has now.
 * @returns {boolean} True when the shared text changed.
 */
const applyTextEditApprox = (ytext, base, local) => {
  const shared = ytext.toString();
  let start = 0;
  while (start < base.length && start < local.length && base.charCodeAt(start) === local.charCodeAt(start))
    start += 1;
  let endBase = base.length;
  let endLocal = local.length;
  while (
    endBase > start &&
    endLocal > start &&
    base.charCodeAt(endBase - 1) === local.charCodeAt(endLocal - 1)
  ) {
    endBase -= 1;
    endLocal -= 1;
  }
  let rp = 0;
  while (rp < base.length && rp < shared.length && base.charCodeAt(rp) === shared.charCodeAt(rp)) rp += 1;
  let rsBase = base.length;
  let rsShared = shared.length;
  while (rsBase > rp && rsShared > rp && base.charCodeAt(rsBase - 1) === shared.charCodeAt(rsShared - 1)) {
    rsBase -= 1;
    rsShared -= 1;
  }
  const shift = shared.length - base.length;
  const map = (index) =>
    index <= rp ? index : index >= rsBase ? index + shift : Math.min(index + shift, shared.length);
  const from = map(start);
  const to = Math.max(from, map(endBase));
  if (to > from) ytext.delete(from, Math.min(to, shared.length) - from);
  const inserted = local.slice(start, endLocal);
  if (inserted) ytext.insert(Math.min(from, ytext.length), inserted);
  return true;
};

const MAX_DIFF_LENGTH = 200000;
const MAX_DIFF_EDITS = 4000;

/**
 * Matches of a shortest edit script between two sequences of integers
 * (Myers' O(ND) algorithm).
 * @param {ArrayLike<number>} a - Old sequence.
 * @param {ArrayLike<number>} b - New sequence.
 * @returns {Int32Array|null} For every index of `a`, the index of the same item in `b` (-1 when deleted), or null when the sequences are too different.
 */
const matchSequences = (a, b) => {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, MAX_DIFF_EDITS);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const match = new Int32Array(n).fill(-1);
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = previous[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      match[x] = y;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    match[x] = y;
  }
  return match;
};

/** UTF-16 code units of `text` from `start` to `end`. */
const codeUnits = (text, start = 0, end = text.length) => {
  const out = new Uint16Array(end - start);
  for (let i = start; i < end; i += 1) out[i - start] = text.charCodeAt(i);
  return out;
};

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;
/** True for a code unit that belongs to a word (letters, digits, marks, underscore). */
const isWordUnit = (code) =>
  code < 128
    ? (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
    : (code < 0xd800 || code > 0xdfff) && WORD_CHARACTER.test(String.fromCharCode(code));

/**
 * Words of a text (runs of letters, digits, marks and underscores).
 * @param {string} text - Text.
 * @returns {Array<[number, number]>} Start and end offset of every word.
 */
const wordRanges = (text) => {
  const words = [];
  let i = 0;
  while (i < text.length) {
    if (!isWordUnit(text.charCodeAt(i))) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && isWordUnit(text.charCodeAt(i))) i += 1;
    words.push([start, i]);
  }
  return words;
};

/** Length of the common prefix plus the common suffix (not overlapping) of two strings. */
const commonEnds = (a, b) => {
  let prefix = 0;
  const max = Math.min(a.length, b.length);
  while (prefix < max && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix))
    suffix += 1;
  return prefix + suffix;
};

const OPENING = new Set(['(', '[', '{', '<', '\u00bf', '\u00a1']);
const CLOSING = new Set([')', ']', '}', '>', '.', ',', ';', ':', '!', '?']);
const MAX_ATTACH_DISTANCE = 64;

/**
 * The word a punctuation character belongs to: the nearest word without
 * whitespace in between, to the right for an opening character ("[" of
 * "[word]"), to the left for a closing one, else the left one first.
 * @param {string} text - Text.
 * @param {number} at - Offset of the character.
 * @returns {string} The word, or '' (whitespace, or no word nearby).
 */
const attachedWord = (text, at) => {
  const char = text[at];
  if (/\s/.test(char)) return '';
  const find = (step) => {
    for (let i = at + step, n = 0; i >= 0 && i < text.length && n < MAX_ATTACH_DISTANCE; i += step, n += 1) {
      const code = text.charCodeAt(i);
      if (isWordUnit(code)) {
        let start = i;
        let end = i + 1;
        while (start > 0 && isWordUnit(text.charCodeAt(start - 1))) start -= 1;
        while (end < text.length && isWordUnit(text.charCodeAt(end))) end += 1;
        return text.slice(start, end);
      }
      if (/\s/.test(text[i])) return '';
    }
    return '';
  };
  if (OPENING.has(char)) return find(1);
  if (CLOSING.has(char)) return find(-1);
  return find(-1) || find(1);
};

/**
 * Matches the characters of a region between two matched words: tokens
 * (words and single other characters) first; the characters of a changed
 * run only when both versions are the same text edited (they share at least
 * half of the longer one at their start and end). Two different words are
 * never matched character by character, so nothing is anchored inside a
 * word that replaced another one.
 * @param {string} a - Old text.
 * @param {number} startA - Region start in `a`.
 * @param {number} endA - Region end in `a`.
 * @param {string} b - New text.
 * @param {number} startB - Region start in `b`.
 * @param {number} endB - Region end in `b`.
 * @param {Int32Array} match - Receives the matches (indexes of `a` to indexes of `b`).
 */
const matchGap = (a, startA, endA, b, startB, endB, match) => {
  const tokens = (text, start, end) => {
    const starts = [];
    let i = start;
    while (i < end) {
      starts.push(i);
      if (isWordUnit(text.charCodeAt(i))) {
        i += 1;
        while (i < end && isWordUnit(text.charCodeAt(i))) i += 1;
      } else i += 1;
    }
    starts.push(end);
    return starts;
  };
  const startsA = tokens(a, startA, endA);
  const startsB = tokens(b, startB, endB);
  const ids = new Map();
  const idsOf = (text, starts) =>
    Int32Array.from({ length: starts.length - 1 }, (_, t) => {
      let token = text.slice(starts[t], starts[t + 1]);
      if (token.length === 1 && !isWordUnit(token.charCodeAt(0)))
        token = `${token}\u0000${attachedWord(text, starts[t])}`;
      let id = ids.get(token);
      if (id === undefined) {
        id = ids.size;
        ids.set(token, id);
      }
      return id;
    });
  const pairs = matchSequences(idsOf(a, startsA), idsOf(b, startsB));
  let ta = 0;
  let tb = 0;
  const run = (toA, toB) => {
    if (toA <= ta || toB <= tb) return;
    const fromA = startsA[ta];
    const fromB = startsB[tb];
    const oldText = a.slice(fromA, startsA[toA]);
    const newText = b.slice(fromB, startsB[toB]);
    if (commonEnds(oldText, newText) * 2 < Math.max(oldText.length, newText.length)) return;
    const inner = matchSequences(codeUnits(oldText), codeUnits(newText));
    if (!inner) return;
    for (let i = 0; i < inner.length; i += 1) if (inner[i] >= 0) match[fromA + i] = fromB + inner[i];
  };
  if (pairs) {
    for (let t = 0; t < pairs.length; t += 1) {
      const u = pairs[t];
      if (u < 0) continue;
      run(t, u);
      for (let c = startsA[t]; c < startsA[t + 1]; c += 1) match[c] = startsB[u] + c - startsA[t];
      ta = t + 1;
      tb = u + 1;
    }
  }
  run(startsA.length - 1, startsB.length - 1);
};

/**
 * Character matches of a shortest edit script between two strings. Whole
 * words are matched first (Myers' algorithm on words), then the characters
 * between and inside the words that did not match. A plain character diff
 * may match base characters to the same characters inside someone else's
 * insert ("[a]" against "[b][a]" as "[" + "b][" + "a]"), and matching
 * punctuation may outnumber matching words, which both split concurrent
 * inserts in a three-way merge; anchoring on words does not.
 * @param {string} a - Old text.
 * @param {string} b - New text.
 * @returns {Int32Array|null} For every index of `a`, the index of the same character in `b` (-1 when deleted), or null when the texts are too long or too different.
 */
export const matchCharacters = (a, b) => {
  if (a.length + b.length > MAX_DIFF_LENGTH) return null;
  const wordsA = wordRanges(a);
  const wordsB = wordRanges(b);
  const ids = new Map();
  const wordIds = (text, words) =>
    Int32Array.from(words, ([start, end]) => {
      const word = text.slice(start, end);
      let id = ids.get(word);
      if (id === undefined) {
        id = ids.size;
        ids.set(word, id);
      }
      return id;
    });
  const words = matchSequences(wordIds(a, wordsA), wordIds(b, wordsB));
  if (!words) return matchSequences(codeUnits(a), codeUnits(b));
  const match = new Int32Array(a.length).fill(-1);
  let fromA = 0;
  let fromB = 0;
  // Between two matched words: a[fromA, toA) against b[fromB, toB).
  const refine = (toA, toB) => {
    if (toA <= fromA || toB <= fromB) return;
    matchGap(a, fromA, toA, b, fromB, toB, match);
  };
  for (let t = 0; t < words.length; t += 1) {
    if (words[t] < 0) continue;
    const [startA, endA] = wordsA[t];
    const [startB, endB] = wordsB[words[t]];
    refine(startA, startB);
    for (let c = startA; c < endA; c += 1) match[c] = startB + c - startA;
    fromA = endA;
    fromB = endB;
  }
  refine(a.length, b.length);
  return match;
};

const isOpenBoundary = (char) => char === undefined || char === '[' || char === '<' || /\s/.test(char);
const isCloseBoundary = (char) => char === undefined || char === ']' || char === '>' || /\s/.test(char);

/**
 * Moves single insertions and deletions of a character diff to the
 * neighbouring position that lines up with markup and word boundaries
 * (a minimal diff of "[a][b]" -> "[a][x][b]" may insert "x][" after the
 * second "[", which breaks three-way merges; this moves it to "[x]").
 * @param {string} a - Old text.
 * @param {string} b - New text.
 * @param {Int32Array} match - Result of `matchCharacters(a, b)`.
 * @returns {Int32Array} Equivalent matches with aligned edits.
 */
const alignEdits = (a, b, match) => {
  const ops = [];
  let i = 0;
  let j = 0;
  const push = (type, text) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && match[i] === j) {
      push('=', a[i]);
      i += 1;
      j += 1;
    } else if (i < a.length && match[i] < 0) {
      push('-', a[i]);
      i += 1;
    } else {
      push('+', b[j]);
      j += 1;
    }
  }
  const score = (before, text, after) =>
    (isCloseBoundary(before) ? 1 : 0) +
    (isOpenBoundary(text[0]) || isCloseBoundary(before) ? 1 : 0) +
    (isCloseBoundary(text[text.length - 1]) || isOpenBoundary(after) ? 1 : 0) +
    (isOpenBoundary(after) ? 1 : 0);
  for (let k = 1; k < ops.length - 1; k += 1) {
    const op = ops[k];
    const prev = ops[k - 1];
    const next = ops[k + 1];
    if (op.type === '=' || prev.type !== '=' || next.type !== '=') continue;
    let left = prev.text;
    let text = op.text;
    let right = next.text;
    while (left && left[left.length - 1] === text[text.length - 1]) {
      right = text[text.length - 1] + right;
      text = left[left.length - 1] + text.slice(0, -1);
      left = left.slice(0, -1);
    }
    let best = { left, text, right, score: score(left[left.length - 1], text, right[0]) };
    while (right && right[0] === text[0]) {
      left += text[0];
      text = text.slice(1) + right[0];
      right = right.slice(1);
      const value = score(left[left.length - 1], text, right[0]);
      if (value > best.score) best = { left, text, right, score: value };
    }
    prev.text = best.left;
    op.text = best.text;
    next.text = best.right;
  }
  const out = new Int32Array(a.length).fill(-1);
  i = 0;
  j = 0;
  for (const op of ops) {
    for (let c = 0; c < op.text.length; c += 1) {
      if (op.type === '=') {
        out[i] = j;
        i += 1;
        j += 1;
      } else if (op.type === '-') i += 1;
      else j += 1;
    }
  }
  return out;
};

/**
 * Applies a local text edit (base -> local) to a shared text that may already
 * contain other changes (three-way). Every changed region of the local edit is
 * mapped through a character diff of base and shared text, so concurrent
 * changes anywhere else in the text are kept, and an edit the shared text
 * already holds is not applied twice.
 * @param {Y.Text} ytext - Shared text.
 * @param {string} base - Text the editor started from.
 * @param {string} local - Text the editor has now.
 * @returns {boolean} True when the shared text changed.
 */
export const applyTextEdit = (ytext, base, local) => {
  if (base === local) return false;
  const shared = ytext.toString();
  // The shared text already holds this edit (for example an edit that was
  // stored but whose acknowledgement was lost before a new room generation).
  if (shared === local) return false;
  if (shared === base) return applyTextDiff(ytext, local);
  const sharedMatch = matchCharacters(base, shared);
  const localMatch = sharedMatch && matchCharacters(base, local);
  if (!sharedMatch || !localMatch) return applyTextEditApprox(ytext, base, local);
  const toShared = alignEdits(base, shared, sharedMatch);
  const toLocal = alignEdits(base, local, localMatch);
  // Hunks of the local edit: base range [a0, a1) replaced by local text.
  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < base.length || j < local.length) {
    if (i < base.length && toLocal[i] === j) {
      i += 1;
      j += 1;
      continue;
    }
    const a0 = i;
    while (i < base.length && toLocal[i] < 0) i += 1;
    const next = i < base.length ? toLocal[i] : local.length;
    hunks.push({ a0, a1: i, text: local.slice(j, next) });
    j = next;
  }
  let changed = false;
  for (let h = hunks.length - 1; h >= 0; h -= 1) {
    const { a0, a1, text } = hunks[h];
    let at = 0;
    for (let k = a0 - 1; k >= 0; k -= 1) {
      if (toShared[k] >= 0) {
        at = toShared[k] + 1;
        break;
      }
    }
    // Delete only base characters the shared text still has (right to left).
    for (let k = a1 - 1; k >= a0; k -= 1) {
      if (toShared[k] < 0) continue;
      let first = k;
      while (first - 1 >= a0 && toShared[first - 1] >= 0 && toShared[first - 1] === toShared[first] - 1)
        first -= 1;
      ytext.delete(toShared[first], toShared[k] - toShared[first] + 1);
      changed = true;
      k = first;
    }
    if (text) {
      ytext.insert(Math.min(at, ytext.length), text);
      changed = true;
    }
  }
  return changed;
};

/**
 * Builds the shared form of a JSON value (prelim types, integrated by the caller).
 * Values nested deeper than the limit become null.
 * @param {unknown} value - JSON value.
 * @param {number} [depth=0] - Current depth.
 * @returns {unknown} Y.Text, Y.Array, Y.Map or a primitive.
 */
export const toShared = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === 'string') return value ? new Y.Text(value) : new Y.Text();
  if (Array.isArray(value)) return Y.Array.from(value.map((item) => toShared(item, depth + 1)));
  if (isPlainObject(value)) {
    const entries = [];
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key) || value[key] === undefined) continue;
      entries.push([key, toShared(value[key], depth + 1)]);
    }
    return new Y.Map(entries);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  return null;
};

/**
 * Reads a shared value as JSON. Bounded: deeper levels read as null, unknown
 * shared types (XML, sub-documents) read as null, prototype keys are dropped.
 * @param {unknown} value - Shared value.
 * @param {number} [depth=0] - Current depth.
 * @returns {unknown} JSON value.
 */
export const readShared = (value, depth = 0) => {
  if (value instanceof Y.Text) return value.toString();
  if (depth > MAX_DEPTH) return null;
  if (value instanceof Y.Array) return value.toArray().map((item) => readShared(item, depth + 1));
  if (value instanceof Y.Map) {
    const out = {};
    value.forEach((item, key) => {
      if (!FORBIDDEN_KEYS.has(key)) out[key] = readShared(item, depth + 1);
    });
    return out;
  }
  if (value instanceof Y.AbstractType) return null;
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') {
    try {
      return cloneJsonSafe(value, depth) ?? null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
};

/**
 * Reads one block entry into an Editor.js block. A columns block with an
 * item store (schema 4) reads as the stored Editor.js JSON
 * (`columns[].items[]` objects), see `readColumnsData`.
 * @param {string} id - Block id.
 * @param {Y.Map<any>} entry - Block entry.
 * @returns {{ id: string, type: string, data: object, tunes?: object } | null} Block or null.
 */
export const readBlock = (id, entry) => {
  if (!(entry instanceof Y.Map)) return null;
  const type = entry.get('type');
  if (typeof type !== 'string' || !type) return null;
  const rawData = readShared(entry.get('data'), 2);
  const block = { id, type, data: isPlainObject(rawData) ? rawData : {} };
  // Schema 4: the items of a columns block live in the entry's item store.
  const store = itemStoreOf(entry);
  if (store) block.data = readColumnsData(entry.get('data'), store, block.data);
  const tunes = readShared(entry.get('tunes'), 2);
  if (isPlainObject(tunes) && Object.keys(tunes).length > 0) block.tunes = tunes;
  return block;
};

/**
 * Converts the Y.Doc into an Editor.js document.
 * Duplicate ids in `order` (concurrent moves) keep only their first position.
 * @param {Y.Doc} doc - Yjs document.
 * @param {(id: string, entry: Y.Map<any>) => object|null} [read=readBlock] - Block reader (cache).
 * @returns {{ time: number, blocks: Array<object>, version: string }} Editor.js data.
 */
export const docToEditorData = (doc, read = readBlock) => {
  const { meta, order, blocks } = getTypes(doc);
  const seen = new Set();
  const out = [];
  for (const id of order.toArray()) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const block = read(id, blocks.get(id));
    if (block) out.push(block);
    if (out.length >= EDITOR_DATA_LIMITS.maxBlocks) break;
  }
  return {
    time: Number(meta.get('time')) || 0,
    blocks: out,
    version: typeof meta.get('version') === 'string' ? meta.get('version') : '2.31.7',
  };
};

/**
 * Incremental reader: caches every block and re-reads only blocks that
 * changed since the last read (large documents stay cheap to render).
 * Unchanged blocks keep their object identity between reads.
 * @param {Y.Doc} doc - Yjs document.
 * @returns {{ read: () => { time: number, blocks: Array<object>, version: string }, destroy: () => void }} Reader.
 */
export const createDocReader = (doc) => {
  const { blocks } = getTypes(doc);
  const cache = new Map();
  const observer = (events) => {
    for (const event of events) {
      if (event.target === blocks) {
        event.keysChanged.forEach((key) => cache.delete(key));
      } else if (event.path.length > 0) {
        cache.delete(event.path[0]);
      }
    }
  };
  blocks.observeDeep(observer);
  const read = (id, entry) => {
    if (cache.has(id)) return cache.get(id);
    const block = readBlock(id, entry);
    cache.set(id, block);
    return block;
  };
  return {
    read: () => docToEditorData(doc, read),
    destroy: () => {
      blocks.unobserveDeep(observer);
      cache.clear();
    },
  };
};

/**
 * Pairs of indexes (i in a, j in b) on a longest common subsequence of two
 * key lists. Common prefix and suffix are matched directly; the middle part
 * uses an O(n*m) table and falls back to "no match" above 4M cells.
 * @param {string[]} a - First list.
 * @param {string[]} b - Second list.
 * @returns {Array<[number, number]>} Matched index pairs in ascending order.
 */
export const lcsPairs = (a, b) => {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const pairs = [];
  for (let i = 0; i < start; i += 1) pairs.push([i, i]);
  const midA = endA - start;
  const midB = endB - start;
  if (midA > 0 && midB > 0 && midA * midB <= 4_000_000) {
    const cols = midB + 1;
    const table = new Uint16Array((midA + 1) * cols);
    for (let i = midA - 1; i >= 0; i -= 1) {
      for (let j = midB - 1; j >= 0; j -= 1) {
        table[i * cols + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * cols + j + 1] + 1
            : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA && j < midB) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i += 1;
      else j += 1;
    }
  }
  for (let k = 0; k < a.length - endA; k += 1) pairs.push([endA + k, endB + k]);
  return pairs;
};

/** Kind of a JSON value for in-place merging. */
const kindOf = (value) => {
  if (typeof value === 'string' || value instanceof Y.Text) return 'text';
  if (Array.isArray(value) || value instanceof Y.Array) return 'array';
  if (isPlainObject(value) || value instanceof Y.Map) return 'map';
  return 'scalar';
};

/**
 * Splits the difference between two lists into hunks of unmatched items
 * between LCS anchors.
 * @param {unknown[]} a - Old list.
 * @param {unknown[]} b - New list.
 * @returns {Array<{ a0: number, a1: number, b0: number, b1: number }>} Hunks (half-open ranges).
 */
const diffHunks = (a, b) => {
  const pairs = lcsPairs(a.map(stableStringify), b.map(stableStringify));
  const hunks = [];
  let pa = 0;
  let pb = 0;
  for (const [i, j] of [...pairs, [a.length, b.length]]) {
    if (i > pa || j > pb) hunks.push({ a0: pa, a1: i, b0: pb, b1: j });
    pa = i + 1;
    pb = j + 1;
  }
  return hunks;
};

/**
 * Maps every index of `base` to the index of the same item in `current`
 * (or -1 when it is gone): equal items by LCS, the rest positionally inside
 * each hunk when they are of the same kind.
 * @param {unknown[]} base - List the local edit started from.
 * @param {unknown[]} current - List in the shared document now.
 * @returns {number[]} Target index per base index.
 */
const alignIndexes = (base, current) => {
  const map = new Array(base.length).fill(-1);
  if (base.length === current.length && equal(base, current)) return base.map((_, i) => i);
  for (const [i, j] of lcsPairs(base.map(stableStringify), current.map(stableStringify))) map[i] = j;
  // Items with an id (2.6: the items and columns of a columns block) are the same item only
  // when the id is the same, wherever the shared list has moved them.
  const currentIds = itemIds(current);
  if (currentIds) {
    const taken = new Set(map.filter((j) => j >= 0));
    base.forEach((item, i) => {
      const id = itemId(item);
      if (map[i] >= 0 || id === null || !currentIds.has(id)) return;
      const j = currentIds.get(id);
      if (!taken.has(j)) {
        map[i] = j;
        taken.add(j);
      }
    });
  }
  for (const hunk of diffHunks(base, current)) {
    const n = Math.min(hunk.a1 - hunk.a0, hunk.b1 - hunk.b0);
    for (let k = 0; k < n; k += 1) {
      const a = base[hunk.a0 + k];
      const b = current[hunk.b0 + k];
      if (map[hunk.a0 + k] >= 0 || kindOf(a) !== kindOf(b)) continue;
      if (itemId(a) !== null || itemId(b) !== null) continue;
      if (!map.includes(hunk.b0 + k)) map[hunk.a0 + k] = hunk.b0 + k;
    }
  }
  return map;
};

/**
 * Id of a list item that is an object with a string `id` (null otherwise).
 * @param {unknown} value - Item (plain JSON).
 * @returns {string|null} Id.
 */
const itemId = (value) => (isPlainObject(value) && typeof value.id === 'string' ? value.id : null);

/**
 * Index of every item by id when the ids of a list are unique (null otherwise).
 * @param {unknown[]} list - Items (plain JSON).
 * @returns {Map<string, number>|null} Ids.
 */
const itemIds = (list) => {
  const ids = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const id = itemId(list[i]);
    if (id === null) continue;
    if (ids.has(id)) return null;
    ids.set(id, i);
  }
  return ids.size ? ids : null;
};

/**
 * Pairs the base and local items of one hunk: by id when both items have
 * one (an item that kept its id is the same item, also when an item was
 * inserted before it), else by position like before 2.6.
 * @param {unknown[]} base - Old list.
 * @param {unknown[]} local - New list.
 * @param {{ a0: number, a1: number, b0: number, b1: number }} hunk - Hunk.
 * @returns {{ pairs: Array<[number, number]>, deleted: number[], inserted: number[] }} Base/local index pairs, deleted base indexes, inserted local indexes.
 */
const pairHunk = (base, local, hunk) => {
  const baseIds = new Map();
  for (let i = hunk.a0; i < hunk.a1; i += 1) {
    const id = itemId(base[i]);
    if (id !== null && !baseIds.has(id)) baseIds.set(id, i);
  }
  const pairs = [];
  const usedBase = new Set();
  const usedLocal = new Set();
  for (let j = hunk.b0; j < hunk.b1; j += 1) {
    const id = itemId(local[j]);
    if (id !== null && baseIds.has(id) && !usedBase.has(baseIds.get(id))) {
      pairs.push([baseIds.get(id), j]);
      usedBase.add(baseIds.get(id));
      usedLocal.add(j);
    }
  }
  if (!pairs.length) {
    // No common id: positional pairing of items without ids (pre-2.6 behaviour).
    const n = Math.min(hunk.a1 - hunk.a0, hunk.b1 - hunk.b0);
    for (let k = 0; k < n; k += 1) {
      if (itemId(base[hunk.a0 + k]) !== null && itemId(local[hunk.b0 + k]) !== null) continue;
      pairs.push([hunk.a0 + k, hunk.b0 + k]);
      usedBase.add(hunk.a0 + k);
      usedLocal.add(hunk.b0 + k);
    }
  }
  const deleted = [];
  for (let i = hunk.a0; i < hunk.a1; i += 1) if (!usedBase.has(i)) deleted.push(i);
  const inserted = [];
  for (let j = hunk.b0; j < hunk.b1; j += 1) if (!usedLocal.has(j)) inserted.push(j);
  return { pairs, deleted, inserted };
};

/**
 * Applies the local change `base -> local` of one value to its shared form.
 * @param {unknown} current - Shared value now (Y type or primitive).
 * @param {unknown} base - Value the editor started from (undefined when new).
 * @param {unknown} local - Value the editor has now.
 * @param {number} depth - Nesting depth.
 * @returns {'same'|'merged'|'replace'} What happened; 'replace' means the caller must store `toShared(local)`.
 */
const mergeValue = (current, base, local, depth) => {
  if (base !== undefined && equal(base, local)) return 'same';
  if (depth > MAX_DEPTH) return 'replace';
  // Already shared (an edit applied twice, for example after a new room generation).
  if (current !== undefined && equal(readShared(current, depth), local)) return 'same';
  if (typeof local === 'string' && current instanceof Y.Text) {
    applyTextEdit(current, typeof base === 'string' ? base : current.toString(), local);
    return 'merged';
  }
  if (Array.isArray(local) && current instanceof Y.Array) {
    mergeArray(current, Array.isArray(base) ? base : readShared(current, depth), local, depth);
    return 'merged';
  }
  if (isPlainObject(local) && current instanceof Y.Map) {
    mergeMap(current, isPlainObject(base) ? base : readShared(current, depth), local, depth);
    return 'merged';
  }
  if (!(current instanceof Y.AbstractType) && equal(readShared(current, depth), local)) return 'same';
  return 'replace';
};

/**
 * Applies the local change of an object to a Y.Map key by key.
 * @param {Y.Map<any>} ymap - Shared map.
 * @param {object} base - Old object.
 * @param {object} local - New object.
 * @param {number} depth - Nesting depth.
 */
const mergeMap = (ymap, base, local, depth) => {
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const inLocal = hasOwn(local, key) && local[key] !== undefined;
    const inBase = hasOwn(base, key) && base[key] !== undefined;
    if (!inLocal) {
      if (inBase && ymap.has(key)) ymap.delete(key);
      continue;
    }
    const result = mergeValue(ymap.get(key), inBase ? base[key] : undefined, local[key], depth + 1);
    if (result === 'replace') ymap.set(key, toShared(local[key], depth + 1));
  }
};

/**
 * Applies the local change of a list to a Y.Array: unchanged items stay,
 * changed items are merged in place (a table cell edit touches one Y.Text),
 * removed items are deleted and new items inserted next to their local
 * neighbours. Positions are mapped through changes the shared list received
 * since `base`.
 * @param {Y.Array<any>} yarray - Shared list.
 * @param {unknown[]} base - Old list.
 * @param {unknown[]} local - New list.
 * @param {number} depth - Nesting depth.
 */
const mergeArray = (yarray, base, local, depth) => {
  if (equal(base, local)) return;
  const raw = yarray.toArray();
  const current = raw.map((item) => readShared(item, depth + 1));
  const target = alignIndexes(base, current);
  const ops = [];
  for (const hunk of diffHunks(base, local)) {
    const { pairs, deleted, inserted } = pairHunk(base, local, hunk);
    const pairedBase = new Map(pairs.map(([bi, li]) => [li, bi]));
    for (const [bi, li] of pairs) {
      if (target[bi] >= 0) ops.push({ at: target[bi], rank: 0, kind: 'modify', bi, value: local[li] });
    }
    for (const bi of deleted) {
      if (target[bi] >= 0) ops.push({ at: target[bi], rank: 0, kind: 'delete' });
    }
    // Runs of new items are inserted after the closest preceding item that still exists:
    // a paired item of this hunk, else the closest preceding base item.
    for (let r = 0; r < inserted.length;) {
      let end = r + 1;
      while (end < inserted.length && inserted[end] === inserted[end - 1] + 1) end += 1;
      const first = inserted[r];
      let at = -1;
      for (let li = first - 1; li >= hunk.b0 && at < 0; li -= 1) {
        const bi = pairedBase.get(li);
        if (bi !== undefined && target[bi] >= 0) at = target[bi] + 1;
      }
      if (at < 0) {
        at = 0;
        for (let bi = hunk.a0 - 1; bi >= 0; bi -= 1) {
          if (target[bi] >= 0) {
            at = target[bi] + 1;
            break;
          }
        }
      }
      ops.push({
        at,
        rank: 1,
        order: first,
        kind: 'insert',
        values: inserted.slice(r, end).map((li) => local[li]),
      });
      r = end;
    }
  }
  // Highest position first so earlier indexes stay valid; at the same
  // position changes of the existing item come before inserts in front of it.
  ops.sort((x, y) => y.at - x.at || x.rank - y.rank || (y.order || 0) - (x.order || 0));
  for (const op of ops) {
    if (op.kind === 'insert') {
      yarray.insert(
        Math.min(op.at, yarray.length),
        op.values.map((value) => toShared(value, depth + 1))
      );
    } else if (op.kind === 'delete') {
      yarray.delete(op.at, 1);
    } else {
      const result = mergeValue(raw[op.at], base[op.bi], op.value, depth + 1);
      if (result === 'replace') {
        yarray.delete(op.at, 1);
        yarray.insert(op.at, [toShared(op.value, depth + 1)]);
      }
    }
  }
};

/**
 * Merges a local change into one key of a map, replacing the value when the
 * shapes do not match.
 * @param {Y.Map<any>} ymap - Parent map.
 * @param {string} key - Key.
 * @param {unknown} base - Old value (undefined when new).
 * @param {unknown} local - New value.
 * @param {number} depth - Depth of the value.
 * @returns {boolean} True when something was written.
 */
const mergeSlot = (ymap, key, base, local, depth) => {
  const result = mergeValue(ymap.get(key), base, local, depth);
  if (result === 'replace') ymap.set(key, toShared(local, depth));
  return result !== 'same';
};

/* ------------------------------------------------------------ columns blocks (schema 4) */

/** Entry key of the item store of a built-in columns block. */
const COLUMN_ITEMS = 'items';
/** Depth of an item in the block data (`data.columns[c].items[i]`), for the depth bounds. */
const ITEM_DEPTH = 6;

/**
 * The item store of a block entry (schema 4), or null for every other block
 * and for columns blocks written by 2.6.0 (items nested in the columns).
 * @param {Y.Map<any>} entry - Block entry.
 * @returns {Y.Map<Y.Map<any>>|null} Item store.
 */
export const itemStoreOf = (entry) => {
  if (!(entry instanceof Y.Map) || entry.get('type') !== 'columns') return null;
  const store = entry.get(COLUMN_ITEMS);
  return store instanceof Y.Map ? store : null;
};

/** Plain-object columns of block data (an empty list when `columns` is not a list). */
const columnsOfData = (data) =>
  isPlainObject(data) && Array.isArray(data.columns) ? data.columns.filter(isPlainObject) : [];

/** Item list of a column (plain objects only). */
const itemsOfColumn = (column) => (Array.isArray(column.items) ? column.items.filter(isPlainObject) : []);

/**
 * True when a block is stored with an item store: a built-in columns block
 * whose columns are objects with string ids and whose items are objects with
 * unique string ids (always the case for the editor tool and for content the
 * policy cleaned). Anything else keeps the structural mapping, so no data
 * the store cannot represent is dropped.
 * @param {{ type: string, data: object }} block - Block (JSON).
 * @returns {boolean} Result.
 */
const usesItemStore = (block) => {
  if (!block || block.type !== 'columns' || !isMarkedBuiltIn('columns', block.data)) return false;
  if (!Array.isArray(block.data.columns)) return false;
  const ids = new Set();
  for (const column of block.data.columns) {
    if (!isPlainObject(column) || typeof column.id !== 'string' || FORBIDDEN_KEYS.has(column.id))
      return false;
    if (column.items === undefined) continue;
    if (!Array.isArray(column.items)) return false;
    for (const item of column.items) {
      if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id) return false;
      if (FORBIDDEN_KEYS.has(item.id) || ids.has(item.id)) return false;
      ids.add(item.id);
    }
  }
  return true;
};

/** Item id -> item of block data, first occurrence in reading order. */
const itemsById = (data) => {
  const out = new Map();
  for (const column of columnsOfData(data))
    for (const item of itemsOfColumn(column))
      if (typeof item.id === 'string' && item.id && !out.has(item.id)) out.set(item.id, item);
  return out;
};

/** An item without its id (the store key). */
const itemContent = (item) => {
  const out = {};
  for (const key of Object.keys(item)) if (key !== 'id') out[key] = item[key];
  return out;
};

/** Ids of a column's items that are placed in this column (first occurrence of the id in the data). */
const placedIds = (column, items) =>
  itemsOfColumn(column)
    .filter((item) => typeof item.id === 'string' && items.get(item.id) === item)
    .map((item) => item.id);

/** Id of a shared column (Y.Map) or null. */
const columnIdOf = (ycolumn) => {
  if (!(ycolumn instanceof Y.Map)) return null;
  const id = ycolumn.get('id');
  if (id instanceof Y.Text) return id.toString();
  return typeof id === 'string' ? id : null;
};

/**
 * Shared form of one column: its keys as usual, `items` as the list of item ids.
 * @param {object} column - Column (JSON).
 * @param {Map<string, object>} items - Items by id.
 * @returns {Y.Map<any>} Column (prelim).
 */
const sharedColumn = (column, items) =>
  new Y.Map(
    Object.keys(column)
      .filter((key) => !FORBIDDEN_KEYS.has(key) && column[key] !== undefined)
      .map((key) => {
        if (key === 'items') return [key, Y.Array.from(placedIds(column, items))];
        if (key === 'id') return [key, column.id];
        return [key, toShared(column[key], 4)];
      })
  );

/**
 * Shared data and item store of a columns block (schema 4).
 * @param {object} data - Block data (JSON, `usesItemStore` true).
 * @returns {{ data: Y.Map<any>, items: Y.Map<any> }} Prelim types.
 */
const sharedColumnsData = (data) => {
  const items = itemsById(data);
  const store = new Y.Map(Array.from(items, ([id, item]) => [id, toShared(itemContent(item), ITEM_DEPTH)]));
  const entries = [];
  for (const key of Object.keys(data)) {
    if (FORBIDDEN_KEYS.has(key) || data[key] === undefined) continue;
    if (key === 'columns')
      entries.push([key, Y.Array.from(columnsOfData(data).map((c) => sharedColumn(c, items)))]);
    else entries.push([key, toShared(data[key], 3)]);
  }
  return { data: new Y.Map(entries), items: store };
};

/**
 * Where the items of a columns block are shown: per shared column the ids in
 * reading order. An id is shown at its first place only, ids without a
 * stored item are skipped, stored items without a place go to the end of the
 * last column (sorted by id, the same on every replica). Columns beyond
 * `COLUMNS_LIMITS.maxColumns` (several people added a column at the same
 * moment) are shown inside the last allowed column: their items follow its
 * own, column by column, and the result has at most that many entries.
 * @param {Y.Array<any>} ycolumns - `data.columns`.
 * @param {Y.Map<any>} store - Item store.
 * @returns {Array<{ column: unknown, ids: string[]|null }>} One entry per shown column (`ids` null when the column has no id list).
 */
export const columnsPlacement = (ycolumns, store) => {
  const seen = new Set();
  const out = ycolumns.toArray().map((column) => {
    const list = column instanceof Y.Map ? column.get('items') : undefined;
    if (!(list instanceof Y.Array)) return { column, ids: null };
    const ids = [];
    for (const id of list.toArray()) {
      if (typeof id !== 'string' || seen.has(id) || !(store.get(id) instanceof Y.Map)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { column, ids };
  });
  const max = COLUMNS_LIMITS.maxColumns;
  if (out.length > max) {
    const target = out[max - 1];
    for (const extra of out.splice(max)) if (extra.ids) target.ids = [...(target.ids || []), ...extra.ids];
  }
  const orphans = [];
  store.forEach((value, id) => {
    if (!seen.has(id) && !FORBIDDEN_KEYS.has(id) && value instanceof Y.Map) orphans.push(id);
  });
  if (orphans.length) {
    const last = [...out].reverse().find((entry) => entry.ids);
    if (last) last.ids.push(...orphans.sort());
  }
  return out;
};

/**
 * Reads the data of a columns block with an item store as the stored JSON.
 * @param {unknown} ydata - Shared data (`entry.get('data')`).
 * @param {Y.Map<any>} store - Item store.
 * @param {object} data - The data read structurally (columns hold item ids).
 * @returns {object} Data with `columns[].items[]` as item objects.
 */
const readColumnsData = (ydata, store, data) => {
  const ycolumns = ydata instanceof Y.Map ? ydata.get('columns') : undefined;
  if (!(ycolumns instanceof Y.Array) || !Array.isArray(data.columns)) return data;
  const placement = columnsPlacement(ycolumns, store);
  // Columns beyond the limit are shown inside the last allowed one (see `columnsPlacement`).
  if (data.columns.length > placement.length) data.columns = data.columns.slice(0, placement.length);
  placement.forEach(({ ids }, c) => {
    const column = data.columns[c];
    if (!ids || !isPlainObject(column)) return;
    column.items = ids.map((id) => {
      const content = readShared(store.get(id), ITEM_DEPTH);
      const item = { id };
      if (isPlainObject(content))
        for (const key of Object.keys(content)) if (key !== 'id') item[key] = content[key];
      return item;
    });
  });
  return data;
};

/**
 * True when a room document holds a built-in columns block written by 2.6.0
 * (items nested in the columns). The server then starts a new room
 * generation, which stores the block with an item store.
 * @param {Y.Doc} doc - Room document.
 * @returns {boolean} Result.
 */
export const hasLegacyColumns = (doc) => {
  const { order, blocks } = getTypes(doc);
  for (const id of new Set(order.toArray())) {
    const entry = blocks.get(id);
    if (!(entry instanceof Y.Map) || entry.get('type') !== 'columns' || itemStoreOf(entry)) continue;
    const block = readBlock(id, entry);
    if (block && usesItemStore(block)) return true;
  }
  return false;
};

/**
 * Replaces the data of an entry (new type, or a shape the current layout
 * cannot merge) with the layout `block` needs.
 * @param {Y.Map<any>} entry - Block entry.
 * @param {{ type: string, data: object }} block - Block (JSON).
 */
const setEntryData = (entry, block) => {
  const data = isPlainObject(block.data) ? block.data : {};
  if (usesItemStore({ type: block.type, data })) {
    const shared = sharedColumnsData(data);
    entry.set(COLUMN_ITEMS, shared.items);
    entry.set('data', shared.data);
  } else {
    if (entry.has(COLUMN_ITEMS)) entry.delete(COLUMN_ITEMS);
    entry.set('data', toShared(data, 2));
  }
};

/**
 * Applies the local change of a columns block with an item store: options
 * key by key, items in the store by id (an edited item keeps its Y.Map and
 * Y.Text, wherever it is placed), columns and placements like the block
 * order of the document (moved ids are taken out of every column and put
 * after their local predecessor). Remote changes since `base` stay.
 * @param {Y.Map<any>} entry - Block entry.
 * @param {Y.Map<any>} store - Its item store.
 * @param {object} base - Data the editor started from.
 * @param {object} local - Data the editor has now (`usesItemStore` true).
 * @returns {boolean} True when the shared document changed.
 */
const mergeColumnsEntry = (entry, store, base, local) => {
  const ydata = entry.get('data');
  if (!(ydata instanceof Y.Map)) {
    setEntryData(entry, { type: 'columns', data: local });
    return true;
  }
  let changed = false;
  const mark = () => {
    changed = true;
  };
  // Options (layout, gap, valign, marker): key by key, `columns` excluded.
  const options = (data) => {
    const out = {};
    for (const key of Object.keys(data)) if (key !== 'columns') out[key] = data[key];
    return out;
  };
  const baseData = isPlainObject(base) ? base : {};
  if (!equal(options(baseData), options(local))) {
    mergeMap(ydata, options(baseData), options(local), 2);
    mark();
  }
  let ycolumns = ydata.get('columns');
  if (!(ycolumns instanceof Y.Array)) {
    ycolumns = new Y.Array();
    ydata.set('columns', ycolumns);
    mark();
  }
  const listOf = (ycolumn) => {
    let list = ycolumn.get('items');
    if (!(list instanceof Y.Array)) {
      list = new Y.Array();
      ycolumn.set('items', list);
      mark();
    }
    return list;
  };
  const removeEverywhere = (id) => {
    for (const ycolumn of ycolumns.toArray()) {
      const list = ycolumn instanceof Y.Map ? ycolumn.get('items') : null;
      if (!(list instanceof Y.Array)) continue;
      const ids = list.toArray();
      for (let i = ids.length - 1; i >= 0; i -= 1)
        if (ids[i] === id) {
          list.delete(i, 1);
          mark();
        }
    }
  };
  // 1. Items: deleted ones leave the store (a delete wins over a move), changed ones merge in place.
  const baseItems = itemsById(baseData);
  const localItems = itemsById(local);
  for (const id of baseItems.keys()) {
    if (localItems.has(id)) continue;
    if (store.has(id)) {
      store.delete(id);
      mark();
    }
    removeEverywhere(id);
  }
  const skipped = new Set();
  for (const [id, item] of localItems) {
    const content = itemContent(item);
    const current = store.get(id);
    if (current instanceof Y.Map) {
      const before = baseItems.get(id);
      const result = mergeValue(current, before ? itemContent(before) : undefined, content, ITEM_DEPTH);
      if (result === 'replace') store.set(id, toShared(content, ITEM_DEPTH));
      if (result !== 'same') mark();
    } else if (baseItems.has(id)) {
      // Deleted by someone else since `base`: the delete wins.
      skipped.add(id);
    } else {
      store.set(id, toShared(content, ITEM_DEPTH));
      mark();
    }
  }
  // Columns shown inside the last allowed one (more than the limit, see `columnsPlacement`).
  const folded = new Set(
    ycolumns
      .toArray()
      .slice(COLUMNS_LIMITS.maxColumns)
      .map(columnIdOf)
      .filter((id) => id !== null)
  );
  // 2. Columns: removed ones go, new ones are placed after their local predecessor, a column
  // whose position changed is placed again (its items stay in the store).
  const baseColumns = columnsOfData(baseData);
  const localColumns = columnsOfData(local).filter((column) => typeof column.id === 'string');
  const baseColumnIds = new Set(baseColumns.map((column) => column.id));
  const localColumnIds = new Set(localColumns.map((column) => column.id));
  for (let i = ycolumns.length - 1; i >= 0; i -= 1) {
    const id = columnIdOf(ycolumns.get(i));
    if (id !== null && baseColumnIds.has(id) && !localColumnIds.has(id)) {
      ycolumns.delete(i, 1);
      mark();
    }
  }
  const keptBase = baseColumns.map((column) => column.id).filter((id) => localColumnIds.has(id));
  const localIds = localColumns.map((column) => column.id);
  const keepColumns = new Set(lcsPairs(keptBase, localIds).map(([i]) => keptBase[i]));
  localColumns.forEach((column, index) => {
    const current = ycolumns.toArray().map(columnIdOf);
    const at = current.indexOf(column.id);
    if (at >= 0 && (keepColumns.has(column.id) || !baseColumnIds.has(column.id))) return;
    if (at < 0 && baseColumnIds.has(column.id)) return; // removed by someone else: the removal wins
    if (at >= 0) ycolumns.delete(at, 1);
    const after = ycolumns.toArray().map(columnIdOf);
    let position = 0;
    for (let p = index - 1; p >= 0; p -= 1) {
      const found = after.indexOf(localIds[p]);
      if (found >= 0) {
        position = found + 1;
        break;
      }
    }
    ycolumns.insert(position, [sharedColumn({ ...column, items: [] }, localItems)]);
    mark();
  });
  // 3. Placements: like the block order of the document, per column.
  const baseById = new Map(baseColumns.map((column) => [column.id, column]));
  for (const column of localColumns) {
    const ycolumn = ycolumns.toArray().find((candidate) => columnIdOf(candidate) === column.id);
    if (!(ycolumn instanceof Y.Map)) continue;
    const list = listOf(ycolumn);
    const wanted = placedIds(column, localItems).filter((id) => !skipped.has(id));
    const wantedSet = new Set(wanted);
    const before = baseById.has(column.id) ? placedIds(baseById.get(column.id), baseItems) : [];
    const kept = before.filter((id) => wantedSet.has(id));
    const keep = new Set(lcsPairs(kept, wanted).map(([i]) => kept[i]));
    let touched = false;
    wanted.forEach((id, index) => {
      if (keep.has(id)) return;
      removeEverywhere(id);
      const current = list.toArray();
      let position = 0;
      for (let p = index - 1; p >= 0; p -= 1) {
        const found = current.indexOf(wanted[p]);
        if (found >= 0) {
          position = found + 1;
          break;
        }
      }
      list.insert(position, [id]);
      touched = true;
      mark();
    });
    if (touched || before.some((id) => !wantedSet.has(id))) {
      // Ids whose item is gone (a move that met a delete) are dropped from a column that changed anyway.
      const ids = list.toArray();
      for (let i = ids.length - 1; i >= 0; i -= 1)
        if (typeof ids[i] !== 'string' || !(store.get(ids[i]) instanceof Y.Map)) {
          list.delete(i, 1);
          mark();
        }
    }
  }
  // 4. Columns that were shown inside the last allowed one are removed once none of their ids is
  // shown from them any more (the local change placed their items in a column of its own).
  if (folded.size) {
    const shownFrom = new Map();
    ycolumns.toArray().forEach((ycolumn, index) => {
      const list = ycolumn instanceof Y.Map ? ycolumn.get('items') : null;
      if (list instanceof Y.Array)
        for (const id of list.toArray())
          if (!shownFrom.has(id) && store.get(id) instanceof Y.Map) shownFrom.set(id, index);
    });
    for (let i = ycolumns.length - 1; i >= 0; i -= 1) {
      const ycolumn = ycolumns.get(i);
      const id = columnIdOf(ycolumn);
      if (!folded.has(id) || localColumnIds.has(id)) continue;
      const list = ycolumn instanceof Y.Map ? ycolumn.get('items') : null;
      if ((list instanceof Y.Array ? list.toArray() : []).some((itemId) => shownFrom.get(itemId) === i))
        continue;
      ycolumns.delete(i, 1);
      mark();
    }
  }
  return changed;
};

/**
 * Creates a block entry (a built-in columns block with its item store).
 * @param {{ type: string, data: object, tunes?: object }} block - Block.
 * @returns {Y.Map<any>} Entry (prelim).
 */
const createEntry = (block) => {
  const data = isPlainObject(block.data) ? block.data : {};
  const tunes = ['tunes', toShared(isPlainObject(block.tunes) ? block.tunes : {}, 2)];
  if (usesItemStore({ type: block.type, data })) {
    const shared = sharedColumnsData(data);
    return new Y.Map([['type', block.type], tunes, ['data', shared.data], [COLUMN_ITEMS, shared.items]]);
  }
  return new Y.Map([['type', block.type], tunes, ['data', toShared(data, 2)]]);
};

/**
 * Applies only what changed locally (base -> local) to a shared document.
 * Remote changes the shared document received since `base` stay untouched.
 * @param {Y.Doc} doc - Shared document.
 * @param {{ blocks: Array<object> }} base - Content the editor last showed or sent.
 * @param {{ time?: number, blocks: Array<object>, version?: string }} local - Content of the editor now.
 * @param {unknown} [origin] - Transaction origin.
 * @returns {boolean} True when the shared document changed.
 */
export const applyLocalChanges = (doc, base, local, origin = 'local') => {
  const { meta, order, blocks } = getTypes(doc);
  const baseById = new Map((base.blocks || []).map((block) => [block.id, block]));
  const localBlocks = [];
  const localSet = new Set();
  for (const block of local.blocks || []) {
    if (!block || typeof block.id !== 'string' || typeof block.type !== 'string' || localSet.has(block.id))
      continue;
    localSet.add(block.id);
    localBlocks.push(block);
  }
  const localIds = localBlocks.map((block) => block.id);
  let changed = false;
  doc.transact(() => {
    if (meta.get('schema') !== YDOC_SCHEMA) meta.set('schema', YDOC_SCHEMA);
    // 1. blocks deleted locally
    for (const id of baseById.keys()) {
      if (localSet.has(id)) continue;
      const current = order.toArray();
      for (let i = current.length - 1; i >= 0; i -= 1) {
        if (current[i] === id) {
          order.delete(i, 1);
          changed = true;
        }
      }
    }
    // 2. blocks added or moved locally: place them after their local predecessor
    const baseIds = (base.blocks || []).map((block) => block.id).filter((id) => localSet.has(id));
    const keep = new Set(lcsPairs(baseIds, localIds).map(([i]) => baseIds[i]));
    // Seeding an empty document: one insert of every id gives the same order as
    // placing them one by one, without reading the whole order per block (O(n²)).
    if (order.length === 0 && localIds.every((id) => !(baseById.has(id) && keep.has(id)))) {
      if (localIds.length) {
        order.insert(0, localIds);
        changed = true;
      }
    } else {
      localIds.forEach((id, index) => {
        if (baseById.has(id) && keep.has(id)) return;
        const current = order.toArray();
        for (let i = current.length - 1; i >= 0; i -= 1) {
          if (current[i] === id) order.delete(i, 1);
        }
        const after = order.toArray();
        let position = 0;
        for (let p = index - 1; p >= 0; p -= 1) {
          const at = after.indexOf(localIds[p]);
          if (at >= 0) {
            position = at + 1;
            break;
          }
        }
        order.insert(position, [id]);
        changed = true;
      });
    }
    // 3. block content changed locally
    for (const block of localBlocks) {
      const before = baseById.get(block.id);
      const entry = blocks.get(block.id);
      if (!(entry instanceof Y.Map)) {
        blocks.set(block.id, createEntry(block));
        changed = true;
        continue;
      }
      const reference = before || readBlock(block.id, entry) || { type: block.type, data: {}, tunes: {} };
      const store = itemStoreOf(entry);
      if (entry.get('type') !== block.type && reference.type !== block.type) {
        entry.set('type', block.type);
        setEntryData(entry, block);
        changed = true;
      } else if (store && entry.get('type') === block.type) {
        // Columns block with an item store (schema 4): moves keep the items.
        if (usesItemStore(block)) {
          changed =
            mergeColumnsEntry(
              entry,
              store,
              reference.data || {},
              isPlainObject(block.data) ? block.data : {}
            ) || changed;
        } else if (!equal(readBlock(block.id, entry).data, block.data)) {
          setEntryData(entry, block);
          changed = true;
        }
      } else {
        if (!before && entry.get('type') !== block.type) {
          entry.set('type', block.type);
          changed = true;
        }
        changed =
          mergeSlot(entry, 'data', reference.data || {}, isPlainObject(block.data) ? block.data : {}, 2) ||
          changed;
      }
      changed =
        mergeSlot(entry, 'tunes', reference.tunes || {}, isPlainObject(block.tunes) ? block.tunes : {}, 2) ||
        changed;
    }
    if (changed) {
      if (local.time && meta.get('time') !== local.time) meta.set('time', local.time);
      if (local.version && meta.get('version') !== local.version) meta.set('version', local.version);
    }
  }, origin);
  return changed;
};

/**
 * Brings the shared document to exactly `data` with the smallest set of changes.
 * @param {Y.Doc} doc - Yjs document.
 * @param {{ time?: number, blocks: Array<object>, version?: string }} data - Normalised editor data.
 * @param {unknown} [origin] - Transaction origin.
 * @returns {boolean} True when the document changed.
 */
export const applyEditorDataToDoc = (doc, data, origin = 'local') =>
  applyLocalChanges(doc, docToEditorData(doc), data, origin);

/**
 * Creates a Y update that contains the given document, for seeding a new room.
 * @param {{ time?: number, blocks: Array<object>, version?: string }} data - Normalised editor data.
 * @param {string} [epoch] - Room generation id; a client that sees a new epoch starts over instead of merging.
 * @returns {Uint8Array} Yjs update.
 */
export const createSeedUpdate = (data, epoch) => {
  const doc = new Y.Doc();
  applyEditorDataToDoc(doc, data, 'seed');
  if (epoch) doc.getMap('meta').set('epoch', epoch);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
};

/**
 * Room generation of a document ('' for rooms created before 2.1).
 * @param {Y.Doc} doc - Yjs document.
 * @returns {string} Epoch.
 */
export const epochOf = (doc) => {
  const epoch = doc.getMap('meta').get('epoch');
  return typeof epoch === 'string' ? epoch.slice(0, 64) : '';
};

/**
 * Converts a collaboration state stored by Magic Editor X 1.x into Editor.js data.
 *
 * 1.x used `blocks` Y.Map<id, JSON string> where the JSON was either a full block
 * (`{ type, data, tunes }`) or only metadata (`{ type, tunes }`) with the text in
 * `text` Y.Map<id, Y.Text> (formatting as Yjs attributes), and the order as a JSON
 * string in `meta.blockOrder`.
 * @param {Uint8Array} update - Stored Yjs state (decoded from base64).
 * @returns {{ time: number, blocks: Array<object>, version: string } | null} Editor.js data, or null when the state holds no blocks.
 */
export const legacyStateToEditorData = (update) => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    const blocksMap = doc.getMap('blocks');
    const textMap = doc.getMap('text');
    const metaMap = doc.getMap('meta');
    let order = [];
    const rawOrder = metaMap.get('blockOrder');
    if (typeof rawOrder === 'string') {
      try {
        const parsed = JSON.parse(rawOrder);
        if (Array.isArray(parsed)) order = parsed.filter((id) => typeof id === 'string');
      } catch {
        order = [];
      }
    }
    if (order.length === 0) order = Array.from(blocksMap.keys());
    const blocks = [];
    for (const id of order) {
      const raw = blocksMap.get(id);
      let parsed = null;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      } else if (raw instanceof Y.Map) {
        parsed = raw.toJSON();
      }
      if (!isPlainObject(parsed) || typeof parsed.type !== 'string') continue;
      if (isPlainObject(parsed.data)) {
        blocks.push({
          id,
          type: parsed.type,
          data: parsed.data,
          ...(isPlainObject(parsed.tunes) ? { tunes: parsed.tunes } : {}),
        });
      } else {
        const ytext = textMap.get(id);
        const text = ytext instanceof Y.Text ? legacyDeltaToHtml(ytext.toDelta()) : '';
        blocks.push({
          id,
          type: parsed.type,
          data: { text },
          ...(isPlainObject(parsed.tunes) ? { tunes: parsed.tunes } : {}),
        });
      }
    }
    if (blocks.length === 0) return null;
    return { time: Number(metaMap.get('time')) || 0, blocks, version: '2.31.7' };
  } finally {
    doc.destroy();
  }
};

/**
 * Turns a 1.x Y.Text delta (bold/italic/underline/code/mark/link attributes) into inline HTML.
 * The result is sanitised by the caller like any other stored HTML.
 * @param {Array<{ insert: unknown, attributes?: object }>} delta - Yjs delta.
 * @returns {string} HTML.
 */
export const legacyDeltaToHtml = (delta) => {
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  for (const op of delta || []) {
    if (typeof op.insert !== 'string') continue;
    let part = escape(op.insert).replace(/\n/g, '<br>');
    const attrs = op.attributes || {};
    if (attrs.code) part = `<code class="inline-code">${part}</code>`;
    if (attrs.italic) part = `<i>${part}</i>`;
    if (attrs.bold) part = `<b>${part}</b>`;
    if (attrs.underline) part = `<u class="cdx-underline">${part}</u>`;
    if (attrs.mark) part = `<mark class="cdx-marker">${part}</mark>`;
    if (isPlainObject(attrs.a) && typeof attrs.a.href === 'string') {
      part = `<a href="${escape(attrs.a.href).replace(/"/g, '&quot;')}">${part}</a>`;
    }
    html += part;
  }
  return html;
};

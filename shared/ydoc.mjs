/**
 * Mapping between an Editor.js document and a Yjs document (collaboration schema 3).
 *
 * Layout of the Y.Doc:
 * - `meta`   Y.Map    { schema: 3, time, version, epoch }
 * - `order`  Y.Array  block ids in document order (a sequence CRDT, so
 *                     concurrent inserts from two people are both kept)
 * - `blocks` Y.Map    id -> Y.Map { type, tunes, data }
 *   - `data` and `tunes` are modelled structurally: every JSON object is a
 *     Y.Map, every array a Y.Array and every string a Y.Text. Numbers,
 *     booleans and null are plain values (last writer wins per key).
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
 * Schema 2 rooms (2.0) stored non-string values as plain JSON. They are read
 * by the same reader; the first local change of such a value replaces it with
 * its structured form.
 *
 * The stored Editor.js JSON is unchanged: this module only maps it.
 */

import * as Y from 'yjs';
import { EDITOR_DATA_LIMITS, cloneJsonSafe, isPlainObject } from './editor-data.mjs';

export const YDOC_SCHEMA = 3;

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
 * Character matches of a shortest edit script between two strings (Myers'
 * O(ND) algorithm).
 * @param {string} a - Old text.
 * @param {string} b - New text.
 * @returns {Int32Array|null} For every index of `a`, the index of the same character in `b` (-1 when deleted), or null when the texts are too long or too different.
 */
export const matchCharacters = (a, b) => {
  const n = a.length;
  const m = b.length;
  if (n + m > MAX_DIFF_LENGTH) return null;
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
      while (x < n && y < m && a.charCodeAt(x) === b.charCodeAt(y)) {
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
 * Reads one block entry into an Editor.js block.
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
  for (const hunk of diffHunks(base, current)) {
    const n = Math.min(hunk.a1 - hunk.a0, hunk.b1 - hunk.b0);
    for (let k = 0; k < n; k += 1) {
      if (kindOf(base[hunk.a0 + k]) === kindOf(current[hunk.b0 + k])) map[hunk.a0 + k] = hunk.b0 + k;
    }
  }
  return map;
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
    const n = Math.min(hunk.a1 - hunk.a0, hunk.b1 - hunk.b0);
    for (let k = 0; k < n; k += 1) {
      const bi = hunk.a0 + k;
      if (target[bi] >= 0)
        ops.push({ at: target[bi], rank: 0, kind: 'modify', bi, value: local[hunk.b0 + k] });
    }
    for (let bi = hunk.a0 + n; bi < hunk.a1; bi += 1) {
      if (target[bi] >= 0) ops.push({ at: target[bi], rank: 0, kind: 'delete' });
    }
    if (hunk.b1 - hunk.b0 > n) {
      // Insert after the closest preceding base item that still exists.
      let at = 0;
      for (let bi = hunk.a0 + n - 1; bi >= 0; bi -= 1) {
        if (target[bi] >= 0) {
          at = target[bi] + 1;
          break;
        }
      }
      ops.push({ at, rank: 1, order: hunk.b0, kind: 'insert', values: local.slice(hunk.b0 + n, hunk.b1) });
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

/**
 * Creates a block entry.
 * @param {{ type: string, data: object, tunes?: object }} block - Block.
 * @returns {Y.Map<any>} Entry (prelim).
 */
const createEntry = (block) =>
  new Y.Map([
    ['type', block.type],
    ['tunes', toShared(isPlainObject(block.tunes) ? block.tunes : {}, 2)],
    ['data', toShared(isPlainObject(block.data) ? block.data : {}, 2)],
  ]);

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
      if (entry.get('type') !== block.type && reference.type !== block.type) {
        entry.set('type', block.type);
        entry.set('data', toShared(isPlainObject(block.data) ? block.data : {}, 2));
        changed = true;
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

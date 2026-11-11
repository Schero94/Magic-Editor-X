/**
 * Mapping between an Editor.js document and a Yjs document (collaboration schema 2).
 *
 * Layout of the Y.Doc:
 * - `meta`   Y.Map    { schema: 2, time, version }
 * - `order`  Y.Array  block ids in document order (a real sequence CRDT, so
 *                     concurrent inserts from two people are both kept)
 * - `blocks` Y.Map    id -> Y.Map { type, tunes, data }
 *   - `data` Y.Map    key -> Y.Text for string values (character-level merge of
 *                     concurrent typing in the same field) or a JSON value for
 *                     everything else (last writer wins per key)
 *
 * Block entries are never removed from `blocks`; `order` decides what is visible.
 * That keeps a concurrent "move" (delete + insert of the same id in `order`) and a
 * concurrent edit of that block from losing data. Rooms are short-lived, so the
 * extra entries do not accumulate.
 *
 * The same code runs in the browser (live editing) and on the server (seeding a
 * room from stored content, snapshots), so both sides agree on the result.
 */

import * as Y from 'yjs';
import { isPlainObject } from './editor-data.mjs';

export const YDOC_SCHEMA = 2;

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
 * Reads one block entry into an Editor.js block.
 * @param {string} id - Block id.
 * @param {Y.Map<any>} entry - Block entry.
 * @returns {{ id: string, type: string, data: object, tunes?: object } | null} Block or null.
 */
const readBlock = (id, entry) => {
  if (!(entry instanceof Y.Map)) return null;
  const type = entry.get('type');
  if (typeof type !== 'string' || !type) return null;
  const dataMap = entry.get('data');
  const data = {};
  if (dataMap instanceof Y.Map) {
    dataMap.forEach((value, key) => {
      data[key] = value instanceof Y.Text ? value.toString() : value;
    });
  }
  const block = { id, type, data };
  const tunes = entry.get('tunes');
  if (isPlainObject(tunes) && Object.keys(tunes).length > 0) block.tunes = tunes;
  return block;
};

/**
 * Converts the Y.Doc into an Editor.js document.
 * Duplicate ids in `order` (concurrent moves) keep only their first position.
 * @param {Y.Doc} doc - Yjs document.
 * @returns {{ time: number, blocks: Array<object>, version: string }} Editor.js data.
 */
export const docToEditorData = (doc) => {
  const { meta, order, blocks } = getTypes(doc);
  const seen = new Set();
  const out = [];
  for (const id of order.toArray()) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const block = readBlock(id, blocks.get(id));
    if (block) out.push(block);
  }
  return {
    time: Number(meta.get('time')) || 0,
    blocks: out,
    version: typeof meta.get('version') === 'string' ? meta.get('version') : '2.31.7',
  };
};

/**
 * Writes the data object of one block into its entry.
 * @param {Y.Map<any>} entry - Block entry.
 * @param {object} data - Block data.
 * @returns {boolean} True when something changed.
 */
const writeData = (entry, data) => {
  let dataMap = entry.get('data');
  if (!(dataMap instanceof Y.Map)) {
    dataMap = new Y.Map();
    entry.set('data', dataMap);
  }
  let changed = false;
  for (const key of Array.from(dataMap.keys())) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      dataMap.delete(key);
      changed = true;
    }
  }
  for (const [key, value] of Object.entries(data)) {
    const current = dataMap.get(key);
    if (typeof value === 'string') {
      if (current instanceof Y.Text) {
        changed = applyTextDiff(current, value) || changed;
      } else {
        const text = new Y.Text();
        dataMap.set(key, text);
        text.insert(0, value);
        changed = true;
      }
    } else if (current instanceof Y.Text || stableStringify(current) !== stableStringify(value)) {
      dataMap.set(key, value === undefined ? null : value);
      changed = true;
    }
  }
  return changed;
};

/**
 * Longest common subsequence of two id lists (indexes into `a`).
 * O(n*m) with typed arrays; documents are capped at 5000 blocks and the
 * common case (one edit) is handled by the prefix/suffix shortcut below.
 * @param {string[]} a - Current order.
 * @param {string[]} b - Target order.
 * @returns {Set<number>} Indexes of `a` that are part of the LCS.
 */
const lcsKeep = (a, b) => {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const keep = new Set();
  for (let i = 0; i < start; i += 1) keep.add(i);
  for (let i = endA; i < a.length; i += 1) keep.add(i);
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length === 0 || midB.length === 0) return keep;
  if (midA.length * midB.length > 4_000_000) return keep; // fall back to delete+insert of the middle part
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      keep.add(start + i);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i += 1;
    else j += 1;
  }
  return keep;
};

/**
 * Brings the `order` array to the target id list with the fewest operations.
 * @param {Y.Array<string>} order - Shared order.
 * @param {string[]} target - Desired ids (unique).
 * @returns {boolean} True when the order changed.
 */
const syncOrder = (order, target) => {
  const current = order.toArray();
  if (current.length === target.length && current.every((id, i) => id === target[i])) return false;
  const keep = lcsKeep(current, target);
  // A kept id must appear only once and must exist in the target.
  const targetSet = new Set(target);
  const keptIds = new Set();
  for (let i = 0; i < current.length; i += 1) {
    if (!keep.has(i)) continue;
    if (!targetSet.has(current[i]) || keptIds.has(current[i])) keep.delete(i);
    else keptIds.add(current[i]);
  }
  for (let i = current.length - 1; i >= 0; i -= 1) {
    if (!keep.has(i)) order.delete(i, 1);
  }
  // order now holds the kept ids in target order; insert the rest.
  let index = 0;
  for (const id of target) {
    if (keptIds.has(id)) {
      index += 1;
    } else {
      order.insert(index, [id]);
      index += 1;
    }
  }
  return true;
};

/**
 * Applies an Editor.js document to the Y.Doc with the smallest set of changes.
 * Run it inside the caller's transaction or let it open one with `origin`.
 * @param {Y.Doc} doc - Yjs document.
 * @param {{ time?: number, blocks: Array<{id: string, type: string, data: object, tunes?: object}>, version?: string }} data - Normalised editor data.
 * @param {unknown} [origin] - Transaction origin, used by observers to ignore own changes.
 * @returns {boolean} True when the document changed.
 */
export const applyEditorDataToDoc = (doc, data, origin = 'local') => {
  const { meta, order, blocks } = getTypes(doc);
  let changed = false;
  doc.transact(() => {
    if (meta.get('schema') !== YDOC_SCHEMA) meta.set('schema', YDOC_SCHEMA);
    const ids = [];
    const seen = new Set();
    for (const block of data.blocks || []) {
      if (!block || typeof block.id !== 'string' || seen.has(block.id)) continue;
      seen.add(block.id);
      ids.push(block.id);
      let entry = blocks.get(block.id);
      if (!(entry instanceof Y.Map)) {
        entry = new Y.Map();
        blocks.set(block.id, entry);
        changed = true;
      }
      if (entry.get('type') !== block.type) {
        entry.set('type', block.type);
        changed = true;
      }
      const tunes = isPlainObject(block.tunes) ? block.tunes : {};
      if (stableStringify(entry.get('tunes') || {}) !== stableStringify(tunes)) {
        entry.set('tunes', tunes);
        changed = true;
      }
      changed = writeData(entry, isPlainObject(block.data) ? block.data : {}) || changed;
    }
    changed = syncOrder(order, ids) || changed;
    if (changed) {
      if (data.time && meta.get('time') !== data.time) meta.set('time', data.time);
      if (data.version && meta.get('version') !== data.version) meta.set('version', data.version);
    }
  }, origin);
  return changed;
};

/**
 * Creates a Y update that contains the given document, for seeding a new room.
 * @param {{ time?: number, blocks: Array<object>, version?: string }} data - Normalised editor data.
 * @returns {Uint8Array} Yjs update.
 */
export const createSeedUpdate = (data) => {
  const doc = new Y.Doc();
  applyEditorDataToDoc(doc, data, 'seed');
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
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

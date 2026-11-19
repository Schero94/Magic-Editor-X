/**
 * Range comments (2.4): Yjs relative positions of comment anchors on the
 * Y.Text of a block field in the live room (shared/ydoc.mjs layout). Admin
 * only: the server stores the encoded positions as opaque base64
 * (shared/comment-anchor.mjs `isRelPos`) and never resolves them.
 */

import * as Y from 'yjs';
import {
  ANCHOR_PATH_PATTERN,
  FORBIDDEN_KEYS,
  MAX_RELPOS_BYTES,
  fromBase64,
  isRelPos,
  toBase64,
} from './comment-anchor.mjs';
import { columnsPlacement, itemStoreOf } from './ydoc.mjs';

/** Deepest data path walked when looking for text fields. */
const MAX_PATH_DEPTH = 8;

/** Text fields walked per block. */
const MAX_LEAVES = 2000;

/**
 * Collects the Y.Text leaves under a shared value.
 * @param {unknown} value - Shared value.
 * @param {string[]} path - Key path of the value.
 * @param {number} depth - Depth of the value.
 * @param {Array<{ path: string, text: Y.Text }>} out - Receives the leaves.
 */
const visitLeaves = (value, path, depth, out) => {
  if (out.length >= MAX_LEAVES || depth > MAX_PATH_DEPTH) return;
  if (value instanceof Y.Text) {
    if (path.length) out.push({ path: path.join('.'), text: value });
    return;
  }
  if (value instanceof Y.Array) {
    value.toArray().forEach((item, index) => visitLeaves(item, [...path, String(index)], depth + 1, out));
    return;
  }
  if (value instanceof Y.Map) {
    for (const [key, item] of value.entries()) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      visitLeaves(item, [...path, key], depth + 1, out);
    }
  }
};

/**
 * Y.Text leaves of a block's shared data (room document) with their key paths.
 * @param {Y.Map<any>|null|undefined} data - `blocks.get(id).get('data')`.
 * @returns {Array<{ path: string, text: Y.Text }>} Leaves.
 */
export const sharedTextLeaves = (data) => {
  const out = [];
  visitLeaves(data, [], 0, out);
  return out;
};

/**
 * Y.Text leaves of a block entry with the data paths of the stored JSON. For
 * a columns block with an item store (schema 4) the item texts are reached
 * through the store and get the paths of the stored JSON
 * (`columns.<c>.items.<i>.text`, reading order), like for every other block.
 * @param {Y.Map<any>|null|undefined} entry - `blocks.get(id)`.
 * @returns {Array<{ path: string, text: Y.Text }>} Leaves.
 */
export const sharedBlockTextLeaves = (entry) => {
  if (!(entry instanceof Y.Map)) return [];
  const data = entry.get('data');
  const store = itemStoreOf(entry);
  const columns = data instanceof Y.Map ? data.get('columns') : undefined;
  if (!store || !(columns instanceof Y.Array)) return sharedTextLeaves(data);
  const out = [];
  for (const [key, value] of data.entries()) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (key !== 'columns') {
      visitLeaves(value, [key], 1, out);
      continue;
    }
    columnsPlacement(columns, store).forEach(({ column, ids }, c) => {
      if (!ids) {
        visitLeaves(column, ['columns', String(c)], 2, out);
        return;
      }
      for (const [columnKey, columnValue] of column.entries())
        if (columnKey !== 'items' && !FORBIDDEN_KEYS.has(columnKey))
          visitLeaves(columnValue, ['columns', String(c), columnKey], 3, out);
      ids.forEach((id, i) => visitLeaves(store.get(id), ['columns', String(c), 'items', String(i)], 4, out));
    });
  }
  return out;
};

/**
 * The Y.Text of a block field in a room document.
 * @param {Y.Doc|null} doc - Room document.
 * @param {string} blockId - Block id.
 * @param {string} path - Data key path (stored JSON).
 * @returns {Y.Text|null} Shared text, or null.
 */
export const sharedTextAt = (doc, blockId, path) => {
  if (!doc || typeof path !== 'string' || !ANCHOR_PATH_PATTERN.test(path)) return null;
  const entry = doc.getMap('blocks').get(blockId);
  if (!(entry instanceof Y.Map)) return null;
  let value = entry.get('data');
  let keys = path.split('.');
  // Columns block with an item store: `columns.<c>.items.<i>` is the placed item in the store.
  const store = itemStoreOf(entry);
  if (
    store &&
    keys[0] === 'columns' &&
    keys[2] === 'items' &&
    /^\d+$/.test(keys[1]) &&
    /^\d+$/.test(keys[3] || '')
  ) {
    const columns = value instanceof Y.Map ? value.get('columns') : undefined;
    if (!(columns instanceof Y.Array)) return null;
    const placed = columnsPlacement(columns, store)[Number(keys[1])];
    const id = placed && placed.ids ? placed.ids[Number(keys[3])] : undefined;
    if (id === undefined) return null;
    value = store.get(id);
    keys = keys.slice(4);
  }
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) return null;
    if (value instanceof Y.Map) value = value.get(key);
    else if (value instanceof Y.Array && /^\d+$/.test(key)) value = value.get(Number(key));
    else return null;
  }
  return value instanceof Y.Text ? value : null;
};

/**
 * The Y.Text a range anchor belongs to (2.6.2). The relative start position names its Y.Text
 * itself, which stays right when the anchored text moved (a column item moved to another column
 * keeps its Y.Text, but its data path changes); it is used when it is one of the block's text
 * fields. Otherwise the stored data path is used, as before.
 * @param {Y.Doc|null} doc - Room document.
 * @param {string} blockId - Block id.
 * @param {string} path - Data path stored with the anchor (where the text was when it was anchored).
 * @param {string|null} start - Base64 relative start position.
 * @returns {Y.Text|null} Shared text, or null.
 */
export const anchoredText = (doc, blockId, path, start) => {
  if (!doc) return null;
  const entry = doc.getMap('blocks').get(blockId);
  if (!(entry instanceof Y.Map)) return null;
  if (isRelPos(start)) {
    try {
      const at = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(fromBase64(start)),
        doc
      );
      if (
        at &&
        at.type instanceof Y.Text &&
        sharedBlockTextLeaves(entry).some((leaf) => leaf.text === at.type)
      )
        return at.type;
    } catch {
      // an undecodable position falls back to the path
    }
  }
  return sharedTextAt(doc, blockId, path);
};

/**
 * Encoded relative positions of a source range of a Y.Text.
 * @param {Y.Text} ytext - Shared text.
 * @param {number} start - Source start (inclusive).
 * @param {number} end - Source end (exclusive).
 * @returns {{ start: string, end: string }|null} Base64 positions, or null.
 */
export const encodeRange = (ytext, start, end) => {
  if (!(ytext instanceof Y.Text) || !(end > start) || start < 0 || end > ytext.length) return null;
  // Start sticks to the first character of the range, end to the last one, so
  // text typed right before or after the range does not join it.
  const from = Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, start, 0));
  const to = Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, end, -1));
  if (from.length > MAX_RELPOS_BYTES || to.length > MAX_RELPOS_BYTES) return null;
  return { start: toBase64(from), end: toBase64(to) };
};

/**
 * Resolves encoded relative positions in a room document.
 * @param {Y.Doc} doc - Room document.
 * @param {Y.Text} ytext - The text the positions must belong to.
 * @param {string} start - Base64 start.
 * @param {string} end - Base64 end.
 * @returns {{ start: number, end: number }|null} Source range in the current text, or null (other text,
 *   unknown items, or the range was deleted).
 */
export const resolveRange = (doc, ytext, start, end) => {
  if (!doc || !(ytext instanceof Y.Text) || !isRelPos(start) || !isRelPos(end)) return null;
  try {
    const from = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(fromBase64(start)),
      doc
    );
    const to = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(end)), doc);
    if (!from || !to || from.type !== ytext || to.type !== ytext) return null;
    if (!(to.index > from.index)) return null;
    return { start: from.index, end: to.index };
  } catch {
    return null;
  }
};

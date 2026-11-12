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

/** Deepest data path walked when looking for text fields. */
const MAX_PATH_DEPTH = 8;

/** Text fields walked per block. */
const MAX_LEAVES = 2000;

/**
 * Y.Text leaves of a block's shared data (room document) with their key paths.
 * @param {Y.Map<any>|null|undefined} data - `blocks.get(id).get('data')`.
 * @returns {Array<{ path: string, text: Y.Text }>} Leaves.
 */
export const sharedTextLeaves = (data) => {
  const out = [];
  const visit = (value, path, depth) => {
    if (out.length >= MAX_LEAVES || depth > MAX_PATH_DEPTH) return;
    if (value instanceof Y.Text) {
      if (path.length) out.push({ path: path.join('.'), text: value });
      return;
    }
    if (value instanceof Y.Array) {
      value.toArray().forEach((item, index) => visit(item, [...path, String(index)], depth + 1));
      return;
    }
    if (value instanceof Y.Map) {
      for (const [key, item] of value.entries()) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        visit(item, [...path, key], depth + 1);
      }
    }
  };
  visit(data, [], 0);
  return out;
};

/**
 * The Y.Text of a block field in a room document.
 * @param {Y.Doc|null} doc - Room document.
 * @param {string} blockId - Block id.
 * @param {string} path - Data key path.
 * @returns {Y.Text|null} Shared text, or null.
 */
export const sharedTextAt = (doc, blockId, path) => {
  if (!doc || typeof path !== 'string' || !ANCHOR_PATH_PATTERN.test(path)) return null;
  const entry = doc.getMap('blocks').get(blockId);
  if (!(entry instanceof Y.Map)) return null;
  let value = entry.get('data');
  for (const key of path.split('.')) {
    if (FORBIDDEN_KEYS.has(key)) return null;
    if (value instanceof Y.Map) value = value.get(key);
    else if (value instanceof Y.Array && /^\d+$/.test(key)) value = value.get(Number(key));
    else return null;
  }
  return value instanceof Y.Text ? value : null;
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

/**
 * Server-side checks for Yjs updates sent by collaboration clients.
 *
 * An update is accepted only when
 * 1. it decodes and contains nothing but the structures schema 3 uses
 *    (maps, arrays, texts without formatting, JSON values) under the roots
 *    `meta`, `order` and `blocks` (`inspectUpdate`);
 * 2. everything it depends on is already in the room (otherwise Yjs would
 *    park it as "pending" and it could not be validated; the client retries);
 * 3. after it is applied, every block it touched still reads as a valid
 *    Editor.js block within the content limits (`validateTouched`).
 *
 * Content (HTML) is not rewritten here: every place that renders or stores
 * room content (the editor, version history, the Document Service on save)
 * sanitises it with the shared policy.
 */

import * as Y from 'yjs';
import { EDITOR_DATA_LIMITS, normalizeEditorData } from './editor-data.mjs';
import { readBlock } from './ydoc.mjs';

const ROOTS = new Set(['meta', 'order', 'blocks']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BLOCK_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const META_KEYS = { schema: 'number', time: 'number', version: 'string', epoch: 'string' };
const MAX_KEY_LENGTH = 128;
const MAX_BLOCK_BYTES = 1024 * 1024;

/**
 * Checks a JSON value carried in an update.
 * @param {unknown} value - Value.
 * @param {number} depth - Depth.
 * @returns {boolean} Acceptable or not.
 */
const safeAny = (value, depth = 0) => {
  if (depth > EDITOR_DATA_LIMITS.maxDepth) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => safeAny(item, depth + 1));
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return false;
    return Object.keys(value).every(
      (key) => !FORBIDDEN_KEYS.has(key) && key.length <= MAX_KEY_LENGTH && safeAny(value[key], depth + 1)
    );
  }
  return false;
};

/**
 * Structural check of an update against the room's state vector.
 * @param {Uint8Array} update - Update bytes.
 * @param {Map<number, number>} stateVector - Room state vector (client -> next clock).
 * @returns {{ ok: true } | { ok: false, code: 'INVALID_UPDATE' | 'MISSING_DEPENDENCY' }} Result.
 */
export const inspectUpdate = (update, stateVector) => {
  let decoded;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return { ok: false, code: 'INVALID_UPDATE' };
  }
  const { structs, ds } = decoded;
  const known = (client) => stateVector.get(client) || 0;
  // Extent of each client's structs in this update.
  const covered = new Map();
  for (const struct of structs) {
    const { client, clock } = struct.id;
    const range = covered.get(client);
    if (!range) covered.set(client, { start: clock, end: clock + struct.length });
    else range.end = Math.max(range.end, clock + struct.length);
  }
  for (const [client, range] of covered)
    if (range.start > known(client)) return { ok: false, code: 'MISSING_DEPENDENCY' };
  const exists = (id) => {
    if (!id) return true;
    if (id.clock < known(id.client)) return true;
    const range = covered.get(id.client);
    return Boolean(range && id.clock >= range.start && id.clock < range.end);
  };
  for (const struct of structs) {
    if (struct instanceof Y.GC || struct instanceof Y.Skip) {
      if (struct instanceof Y.Skip && struct.id.clock + struct.length > known(struct.id.client))
        return { ok: false, code: 'MISSING_DEPENDENCY' };
      continue;
    }
    if (!(struct instanceof Y.Item)) return { ok: false, code: 'INVALID_UPDATE' };
    if (!exists(struct.origin) || !exists(struct.rightOrigin))
      return { ok: false, code: 'MISSING_DEPENDENCY' };
    if (typeof struct.parent === 'string') {
      if (!ROOTS.has(struct.parent)) return { ok: false, code: 'INVALID_UPDATE' };
    } else if (struct.parent && !exists(struct.parent)) return { ok: false, code: 'MISSING_DEPENDENCY' };
    if (struct.parentSub !== null && struct.parentSub !== undefined) {
      const key = struct.parentSub;
      if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH || FORBIDDEN_KEYS.has(key))
        return { ok: false, code: 'INVALID_UPDATE' };
      if (struct.parent === 'blocks' && !BLOCK_ID_PATTERN.test(key))
        return { ok: false, code: 'INVALID_UPDATE' };
      if (struct.parent === 'meta' && !Object.prototype.hasOwnProperty.call(META_KEYS, key))
        return { ok: false, code: 'INVALID_UPDATE' };
    }
    const content = struct.content;
    if (content instanceof Y.ContentString || content instanceof Y.ContentDeleted) continue;
    if (content instanceof Y.ContentAny) {
      if (!content.arr.every((value) => safeAny(value))) return { ok: false, code: 'INVALID_UPDATE' };
      continue;
    }
    if (content instanceof Y.ContentType) {
      const type = content.type;
      if (
        type instanceof Y.XmlElement ||
        type instanceof Y.XmlFragment ||
        type instanceof Y.XmlText ||
        type instanceof Y.XmlHook
      )
        return { ok: false, code: 'INVALID_UPDATE' };
      if (!(type instanceof Y.Map || type instanceof Y.Array || type instanceof Y.Text))
        return { ok: false, code: 'INVALID_UPDATE' };
      continue;
    }
    // Formatting, embeds, binary, sub-documents and legacy JSON are never used.
    return { ok: false, code: 'INVALID_UPDATE' };
  }
  for (const [client, deletes] of ds.clients) {
    for (const item of deletes) {
      const end = item.clock + item.len;
      const range = covered.get(client);
      if (end > known(client) && !(range && end <= range.end))
        return { ok: false, code: 'MISSING_DEPENDENCY' };
    }
  }
  return { ok: true };
};

/**
 * Name of a root type (placeholders included), or '' when unknown.
 * @param {Y.AbstractType<any>} type - Root type.
 * @returns {string} Name.
 */
const rootName = (type) => {
  try {
    return Y.findRootTypeKey(type);
  } catch {
    return '';
  }
};

/**
 * Finds the block ids a transaction touched.
 * @param {Y.Transaction} transaction - Transaction.
 * @param {Y.Map<any>} blocks - Root blocks map.
 * @returns {{ ids: Set<string>, order: boolean, meta: boolean }} Touched parts.
 */
export const touchedBy = (transaction, blocks) => {
  const ids = new Set();
  let order = false;
  let meta = false;
  transaction.changed.forEach((keys, type) => {
    let current = type;
    let guard = 0;
    let child = null;
    while (current && current._item && guard < 4096) {
      child = current._item;
      current = current._item.parent;
      guard += 1;
    }
    // `current` is a root type; root placeholders are compared by name.
    const root = current === blocks ? 'blocks' : rootName(current);
    if (root === 'blocks') {
      if (child) ids.add(child.parentSub);
      else keys.forEach((key) => key && ids.add(key));
    } else if (root === 'order') order = true;
    else meta = true;
  });
  return { ids, order, meta };
};

/**
 * Validates the parts of a document a transaction changed.
 * @param {Y.Doc} doc - Room document after the update.
 * @param {{ ids: Set<string>, order: boolean, meta: boolean }} touched - Result of `touchedBy`.
 * @returns {string|null} Error code, or null when the document is valid.
 */
export const validateTouched = (doc, touched) => {
  const blocks = doc.getMap('blocks');
  if (blocks.size > EDITOR_DATA_LIMITS.maxBlocks * 4) return 'TOO_MANY_BLOCKS';
  for (const id of touched.ids) {
    if (!BLOCK_ID_PATTERN.test(id)) return 'INVALID_BLOCK';
    const entry = blocks.get(id);
    if (entry === undefined) continue;
    if (!(entry instanceof Y.Map)) return 'INVALID_BLOCK';
    for (const key of entry.keys()) if (!['type', 'data', 'tunes'].includes(key)) return 'INVALID_BLOCK';
    const type = entry.get('type');
    if (type !== undefined && (typeof type !== 'string' || !BLOCK_TYPE_PATTERN.test(type)))
      return 'INVALID_BLOCK';
    const data = entry.get('data');
    if (data !== undefined && !(data instanceof Y.Map) && (data === null || typeof data !== 'object'))
      return 'INVALID_BLOCK';
    if (type === undefined) continue; // entry created, fields arrive in a later update of the same client
    const block = readBlock(id, entry);
    if (!block) return 'INVALID_BLOCK';
    try {
      if (JSON.stringify(block).length > MAX_BLOCK_BYTES) return 'TOO_LARGE';
      const normalized = normalizeEditorData({ blocks: [block] });
      if (!normalized || normalized.blocks.length !== 1) return 'INVALID_BLOCK';
    } catch (error) {
      return (error && error.code) || 'INVALID_BLOCK';
    }
  }
  if (touched.order) {
    const order = doc.getArray('order');
    if (order.length > EDITOR_DATA_LIMITS.maxBlocks * 2) return 'TOO_MANY_BLOCKS';
    const unique = new Set();
    for (const id of order.toArray()) {
      if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id)) return 'INVALID_ORDER';
      unique.add(id);
    }
    if (unique.size > EDITOR_DATA_LIMITS.maxBlocks) return 'TOO_MANY_BLOCKS';
  }
  if (touched.meta) {
    const meta = doc.getMap('meta');
    for (const [key, kind] of Object.entries(META_KEYS)) {
      const value = meta.get(key);
      if (value === undefined) continue;
      if (typeof value !== kind) return 'INVALID_META';
      if (kind === 'string' && value.length > 64) return 'INVALID_META';
    }
  }
  return null;
};

/**
 * Applies an update to a room document after the checks above.
 * The caller must discard and reload `doc` when the result is not ok
 * (the update may have been partly applied).
 * @param {Y.Doc} doc - Room document.
 * @param {Uint8Array} update - Update.
 * @returns {{ ok: true, changed: boolean } | { ok: false, code: string, dirty: boolean }} Result.
 */
export const applyCheckedUpdate = (doc, update) => {
  const inspected = inspectUpdate(update, Y.decodeStateVector(Y.encodeStateVector(doc)));
  if (!inspected.ok) return { ok: false, code: inspected.code, dirty: false };
  let touched = { ids: new Set(), order: false, meta: false };
  let changed = false;
  const blocks = doc.getMap('blocks');
  doc.getMap('meta');
  doc.getArray('order');
  const listener = (transaction) => {
    const next = touchedBy(transaction, blocks);
    next.ids.forEach((id) => touched.ids.add(id));
    touched = { ids: touched.ids, order: touched.order || next.order, meta: touched.meta || next.meta };
    if (transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0) changed = true;
  };
  doc.on('afterTransaction', listener);
  try {
    Y.applyUpdate(doc, update, 'checked');
  } catch {
    return { ok: false, code: 'INVALID_UPDATE', dirty: true };
  } finally {
    doc.off('afterTransaction', listener);
  }
  const store = doc.store;
  if (store.pendingStructs || store.pendingDs) return { ok: false, code: 'MISSING_DEPENDENCY', dirty: true };
  const error = validateTouched(doc, touched);
  if (error) return { ok: false, code: error, dirty: true };
  return { ok: true, changed };
};

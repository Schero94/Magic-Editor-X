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
import { itemStoreOf, readBlock, readShared, usesItemStore } from './ydoc.mjs';
import { BUILT_IN_MARKER, isBuiltInMarker, isMarkedBuiltIn } from './built-in-marker.mjs';
import { isTableDataShapeValid } from './table.mjs';
import { COMPONENT_ATTRIBUTE, COMPONENT_LIMITS } from './components.mjs';
import { COLUMN_ID, COLUMNS_LIMITS, isColumnsDataShapeValid } from './columns.mjs';

const ROOTS = new Set(['meta', 'order', 'blocks']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BLOCK_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const META_KEYS = { schema: 'number', time: 'number', version: 'string', epoch: 'string' };
const MAX_KEY_LENGTH = 128;
const MAX_BLOCK_BYTES = 1024 * 1024;
/**
 * Items of one columns block with an item store (2.6.2): twice what the block shows (4 columns of
 * 50), so changes of several people that each stay within the limits always merge. The policy
 * fits what is shown on save (`cleanColumnsData`).
 */
const ITEM_STORE_MAX = COLUMNS_LIMITS.maxColumns * COLUMNS_LIMITS.items * 2;

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
 * @returns {{ ids: Set<string>, order: boolean, meta: boolean, structural: Set<string>, dataKeys: Set<string> }} Touched parts
 *   (`dataKeys` 2.6: blocks whose data map gained, lost or replaced a key).
 */
export const touchedBy = (transaction, blocks) => {
  const ids = new Set();
  // Blocks whose structure changed: added (or replaced), new `type`, or a new
  // `data.level` (or `data.uid` of a component block, 2.5). Field preset rules apply to these only, so blocks that were
  // already there (for example before a preset was tightened) stay editable.
  const structural = new Set();
  const dataKeys = new Set();
  let order = false;
  let meta = false;
  transaction.changed.forEach((keys, type) => {
    let current = type;
    let guard = 0;
    let child = null;
    const path = [];
    while (current && current._item && guard < 4096) {
      child = current._item;
      path.push(current._item.parentSub);
      current = current._item.parent;
      guard += 1;
    }
    // `current` is a root type; root placeholders are compared by name.
    const root = current === blocks ? 'blocks' : rootName(current);
    if (root === 'blocks') {
      if (child) {
        ids.add(child.parentSub);
        // 2.6: a key of the block's data map was added, removed or replaced.
        if (path.length === 2 && path[0] === 'data') dataKeys.add(child.parentSub);
        // path (innermost first): [blockId] = the entry map, [ 'data', blockId ] = its data map.
        if (
          (path.length === 1 && keys.has('type')) ||
          (path.length === 2 && path[0] === 'data' && (keys.has('level') || keys.has('uid'))) ||
          // 2.5: the text of a component block's uid changed.
          (path.length === 3 && path[0] === 'uid' && path[1] === 'data')
        )
          structural.add(child.parentSub);
      } else
        keys.forEach((key) => {
          if (!key) return;
          ids.add(key);
          structural.add(key);
        });
    } else if (root === 'order') order = true;
    else meta = true;
  });
  return { ids, order, meta, structural, dataKeys };
};

/**
 * A built-in synced block (`isMarkedBuiltIn`) holds exactly `{ ref, _mex? }`
 * with a documentId or '' (being chosen). Other blocks pass, also custom
 * block data written before 2.3 under the name `synced`.
 * @param {{ type: string, data: object }} block - Normalised block.
 * @returns {boolean} Valid.
 */
const validSyncedData = (block) => {
  if (block.type !== 'synced' || !isMarkedBuiltIn('synced', block.data)) return true;
  const keys = Object.keys(block.data).filter((key) => key !== BUILT_IN_MARKER);
  return (
    keys.length === 1 &&
    typeof block.data.ref === 'string' &&
    /^([a-z0-9]{1,64})?$/.test(block.data.ref) &&
    (!(BUILT_IN_MARKER in block.data) || isBuiltInMarker(block.data[BUILT_IN_MARKER]))
  );
};

/**
 * A built-in component block (2.5) holds `{ uid, values, _mex? }`: a string
 * uid and a plain object of at most `COMPONENT_LIMITS.attributes` scalar
 * values (strings up to the text limit, finite numbers, booleans). The schema
 * rules are checked on save. Other blocks pass.
 * @param {{ type: string, data: object }} block - Normalised block.
 * @returns {boolean} Valid.
 */
const validComponentData = (block) => {
  if (block.type !== 'component' || !isMarkedBuiltIn('component', block.data)) return true;
  const { uid, values } = block.data;
  if (Object.keys(block.data).some((key) => !['uid', 'values', BUILT_IN_MARKER].includes(key))) return false;
  if (typeof uid !== 'string' || uid.length > 201) return false;
  if (values === undefined) return true;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const keys = Object.keys(values);
  if (keys.length > COMPONENT_LIMITS.attributes) return false;
  return keys.every((key) => {
    const value = values[key];
    if (!COMPONENT_ATTRIBUTE.test(key)) return false;
    if (typeof value === 'string') return value.length <= COMPONENT_LIMITS.text;
    return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
  });
};

/**
 * The item store of a columns block (schema 4) and its placement lists: a
 * Y.Map of at most `maxColumns * items` items (ids `COLUMN_ID`, values
 * Y.Map), at most `maxColumns * 4` column maps, and in every column of `data.columns` an `items` Y.Array of item
 * ids, at most four times the item limit (hidden places left by concurrent
 * moves and deletes count). The items read from it are checked by the shape
 * check of the block like any other block data.
 * @param {Y.Map<any>} entry - Block entry with an `items` key.
 * @returns {boolean} Valid.
 */
const validItemStore = (entry) => {
  const store = itemStoreOf(entry);
  if (!store || store.size > ITEM_STORE_MAX) return false;
  const items = [];
  for (const [id, value] of store.entries()) {
    if (!COLUMN_ID.test(id) || !(value instanceof Y.Map)) return false;
    const content = readShared(value, 6);
    items.push({ ...content, id });
  }
  // Every stored item, placed or not, has the shape of a column item (keys, kinds, text length),
  // and all of them together stay within the block size limit.
  if (!isColumnsDataShapeValid({ columns: [{ id: 'store', items }] }, { maxItems: ITEM_STORE_MAX }))
    return false;
  if (JSON.stringify(items).length > MAX_BLOCK_BYTES) return false;
  const data = entry.get('data');
  if (!(data instanceof Y.Map)) return false;
  const columns = data.get('columns');
  if (columns === undefined) return true;
  // More column maps than shown: several people added a column at once; the reader shows the
  // extra ones inside the last allowed column (`columnsPlacement`).
  if (!(columns instanceof Y.Array) || columns.length > COLUMNS_LIMITS.maxColumns * 4) return false;
  for (const column of columns.toArray()) {
    if (!(column instanceof Y.Map)) return false;
    const list = column.get('items');
    if (list === undefined) continue;
    if (!(list instanceof Y.Array) || list.length > ITEM_STORE_MAX * 2) return false;
    if (!list.toArray().every((id) => typeof id === 'string' && COLUMN_ID.test(id))) return false;
  }
  return true;
};

/**
 * Validates the parts of a document a transaction changed.
 * @param {Y.Doc} doc - Room document after the update.
 * @param {{ ids: Set<string>, order: boolean, meta: boolean }} touched - Result of `touchedBy`.
 * @param {{ checkBlock?: (block: { id: string, type: string, data: object }) => string|null, createdNow?: (type: unknown) => boolean }} [options] - Extra per-block rule (field presets); `createdNow` tells whether a shared type was created by the update being checked.
 * @returns {string|null} Error code, or null when the document is valid.
 */
export const validateTouched = (doc, touched, options = {}) => {
  const blocks = doc.getMap('blocks');
  if (blocks.size > EDITOR_DATA_LIMITS.maxBlocks * 4) return 'TOO_MANY_BLOCKS';
  for (const id of touched.ids) {
    if (!BLOCK_ID_PATTERN.test(id)) return 'INVALID_BLOCK';
    const entry = blocks.get(id);
    if (entry === undefined) continue;
    if (!(entry instanceof Y.Map)) return 'INVALID_BLOCK';
    const type = entry.get('type');
    // `items` (schema 4) is the item store of a columns block and nothing else.
    for (const key of entry.keys())
      if (!['type', 'data', 'tunes'].includes(key) && !(key === 'items' && type === 'columns'))
        return 'INVALID_BLOCK';
    if (entry.has('items') && !validItemStore(entry)) return 'INVALID_BLOCK';
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
      // Synced block (2.3): a reference only (`{ ref }`), never copied content.
      if (!validSyncedData(normalized.blocks[0])) return 'INVALID_BLOCK';
      // Component block (2.5): uid and scalar values only.
      if (!validComponentData(normalized.blocks[0])) return 'INVALID_BLOCK';
      // Table (2.4): types and bounds of the cells, header column, alignment, merges and caption.
      if (normalized.blocks[0].type === 'table' && !isTableDataShapeValid(normalized.blocks[0].data))
        return 'INVALID_BLOCK';
      // Columns (2.6): keys, item kinds, ids and bounds of a built-in columns block (custom block
      // data under the name `columns`, written before 2.6, keeps the generic rules).
      if (
        normalized.blocks[0].type === 'columns' &&
        isMarkedBuiltIn('columns', normalized.blocks[0].data) &&
        !isColumnsDataShapeValid(normalized.blocks[0].data, {
          // 2.6.2: merged changes may briefly show more than 50 items in a column of a block with
          // an item store (folded columns, items without a place); the store itself is bounded.
          maxItems: itemStoreOf(entry) ? ITEM_STORE_MAX : COLUMNS_LIMITS.items,
        })
      )
        return 'INVALID_BLOCK';
      // 2.6.2: a columns block without an item store is accepted only as written before (rooms of
      // 2.6.0 until their upgrade). New structure in that layout would make the server start a new
      // room generation again and again (`hasLegacyColumns`).
      if (
        normalized.blocks[0].type === 'columns' &&
        typeof options.createdNow === 'function' &&
        !itemStoreOf(entry) &&
        usesItemStore(block) &&
        (options.createdNow(entry.get('data')) ||
          (entry.get('data') instanceof Y.Map && options.createdNow(entry.get('data').get('columns'))))
      )
        return 'INVALID_BLOCK';
      // 2.6: adding or removing a key of a component block's data can turn custom data into a built-in
      // component (or back), so it is structural too: the field's rule runs as for a new block.
      const structural =
        (touched.structural && touched.structural.has(id)) ||
        (normalized.blocks[0].type === 'component' && touched.dataKeys && touched.dataKeys.has(id));
      if (typeof options.checkBlock === 'function' && structural) {
        const code = options.checkBlock(normalized.blocks[0]);
        if (code) return code;
      }
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
 * @param {{ checkBlock?: (block: object) => string|null }} [options] - Extra per-block rule (field presets).
 * @returns {{ ok: true, changed: boolean } | { ok: false, code: string, dirty: boolean }} Result.
 */
export const applyCheckedUpdate = (doc, update, options = {}) => {
  const inspected = inspectUpdate(update, Y.decodeStateVector(Y.encodeStateVector(doc)));
  if (!inspected.ok) return { ok: false, code: inspected.code, dirty: false };
  let touched = { ids: new Set(), order: false, meta: false, structural: new Set(), dataKeys: new Set() };
  let changed = false;
  const blocks = doc.getMap('blocks');
  doc.getMap('meta');
  doc.getArray('order');
  const listener = (transaction) => {
    const next = touchedBy(transaction, blocks);
    next.ids.forEach((id) => touched.ids.add(id));
    next.structural.forEach((id) => touched.structural.add(id));
    next.dataKeys.forEach((id) => touched.dataKeys.add(id));
    touched = {
      ids: touched.ids,
      order: touched.order || next.order,
      meta: touched.meta || next.meta,
      structural: touched.structural,
      dataKeys: touched.dataKeys,
    };
    if (transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0) changed = true;
  };
  // Structs that integrate without a visible change (for example into a block
  // that was deleted or replaced meanwhile) still advance the state vector.
  // Such an update must be stored, or later updates of the same client
  // depend on clocks no other process and no reload ever sees.
  const vectorBefore = Y.encodeStateVector(doc);
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
  // Shared types this update created (2.6.2: legacy columns layout check).
  const known = Y.decodeStateVector(vectorBefore);
  const createdNow = (type) =>
    type instanceof Y.AbstractType &&
    Boolean(type._item) &&
    type._item.id.clock >= (known.get(type._item.id.client) || 0);
  const error = validateTouched(doc, touched, { ...options, createdNow });
  if (error) return { ok: false, code: error, dirty: true };
  if (!changed) {
    const vectorAfter = Y.encodeStateVector(doc);
    changed =
      vectorAfter.length !== vectorBefore.length || vectorAfter.some((byte, i) => byte !== vectorBefore[i]);
  }
  return { ok: true, changed };
};

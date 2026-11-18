/**
 * Columns block (2.6): a constrained cell model, like Tables v2. One
 * top-level Editor.js block whose tool renders its own columns; there are no
 * nested Editor.js instances (see docs/engine-decision.md, "2.5 columns
 * spike"). Pure functions shared by the content policy, the JSON Schema, the
 * renderers, the live collaboration guard, the text walkers (find and
 * replace, AI segments, translation, comments) and the editor tool.
 *
 * Stored data:
 * `{ columns: [{ id, items: [{ id, type, text, level?, style? }] }], layout?, gap?, valign?, _mex: 1 }`
 *
 * - `columns`: 2 to 4 columns in reading order (left to right, which is also
 *   the order on narrow screens, where renderers stack them).
 * - `items`: at most `COLUMNS_LIMITS.items` simple items per column:
 *   `paragraph`, `heading` (`level` 1-6, default 3) or `list` (one list item;
 *   `style` `unordered` or `ordered`; consecutive list items of one style
 *   render as one list). `text` is inline HTML (the field's inline tools).
 * - Every column and item has an id (`COLUMN_ID`) that stays the same while
 *   the block is edited, so comments, AI segments, find and replace and the
 *   version diff can address them. Missing or repeated ids are replaced by
 *   deterministic ones (`<column id>-<n>`), so cleaning twice gives the same
 *   result.
 * - `layout` (width preset), `gap` and `valign` are written only when they
 *   differ from their default (`equal`, `medium`, `top`).
 *
 * Collaboration (schema 3, unchanged): block data is mapped structurally, so
 * the columns are a Y.Array of Y.Maps, the items of a column a Y.Array of
 * Y.Maps and every item text a Y.Text. Edits in different items and columns
 * merge; typing in the same item merges character by character.
 */

/** Bounds (policy, schema, live guard and editor). */
export const COLUMNS_LIMITS = Object.freeze({
  minColumns: 2,
  maxColumns: 4,
  items: 50,
  text: 20000,
});

/** Item kinds. */
export const COLUMN_ITEM_TYPES = Object.freeze(['paragraph', 'heading', 'list']);
/** List styles of a list item. */
export const COLUMN_LIST_STYLES = Object.freeze(['unordered', 'ordered']);
/** Width presets per column count (the first one is the default). */
export const COLUMNS_LAYOUTS = Object.freeze({
  2: Object.freeze(['equal', 'wide-left', 'wide-right']),
  3: Object.freeze(['equal', 'wide-left', 'wide-center', 'wide-right']),
  4: Object.freeze(['equal']),
});
/** Every layout name (schema enum). */
export const COLUMNS_LAYOUT_NAMES = Object.freeze(['equal', 'wide-left', 'wide-center', 'wide-right']);
/** Space between the columns (default `medium`). */
export const COLUMNS_GAPS = Object.freeze(['small', 'medium', 'large']);
/** Vertical alignment of the columns (default `top`). */
export const COLUMNS_VALIGNS = Object.freeze(['top', 'center', 'bottom']);
/** Column and item ids. */
export const COLUMN_ID = /^[A-Za-z0-9_-]{1,32}$/;
/** Default heading level of a heading item. */
export const COLUMN_HEADING_LEVEL = 3;

const ITEM_KEYS = new Set(['id', 'type', 'text', 'level', 'style']);
const COLUMN_KEYS = new Set(['id', 'items']);
const DATA_KEYS = new Set(['columns', 'layout', 'gap', 'valign', '_mex']);

const isObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Random id for a new column or item (10 characters of `[A-Za-z0-9]`).
 * Uses Web Crypto when available (browsers, Node 22), else Math.random.
 * @returns {string} Id.
 */
export const newColumnsId = () => {
  const bytes = new Uint8Array(10);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
};

/**
 * Valid layouts for a number of columns.
 * @param {number} count - Column count.
 * @returns {readonly string[]} Layouts (first = default).
 */
export const layoutsFor = (count) => COLUMNS_LAYOUTS[count] || COLUMNS_LAYOUTS[4];

/**
 * Relative widths of the columns of a layout (`wide-left` with 2 columns = [2, 1]).
 * @param {number} count - Column count.
 * @param {string} [layout] - Layout name.
 * @returns {number[]} One weight per column.
 */
export const layoutWeights = (count, layout) => {
  const weights = Array.from({ length: count }, () => 1);
  if (!layoutsFor(count).includes(layout) || layout === 'equal') return weights;
  if (layout === 'wide-left') weights[0] = 2;
  else if (layout === 'wide-right') weights[count - 1] = 2;
  else if (layout === 'wide-center' && count === 3) weights[1] = 2;
  return weights;
};

/**
 * Cleans one item. Unknown types become paragraphs; `level` is kept for
 * headings only, `style` for list items only.
 * @param {unknown} input - Stored item.
 * @param {(html: unknown) => string} inline - Inline HTML sanitiser.
 * @returns {{ id?: string, type: string, text: string, level?: number, style?: string }} Item (id checked by the caller).
 */
const cleanItem = (input, inline) => {
  const d = isObject(input) ? input : {};
  const type = COLUMN_ITEM_TYPES.includes(d.type) ? d.type : 'paragraph';
  const text = typeof d.text === 'string' ? inline(d.text.slice(0, COLUMNS_LIMITS.text)) : '';
  const out = { id: d.id, type, text };
  if (type === 'heading')
    out.level = Number.isInteger(d.level) && d.level >= 1 && d.level <= 6 ? d.level : COLUMN_HEADING_LEVEL;
  if (type === 'list') out.style = COLUMN_LIST_STYLES.includes(d.style) ? d.style : 'unordered';
  return out;
};

/**
 * Content policy of the columns block (called by `BLOCK_POLICIES.columns`).
 * Pads to two columns, cuts to four, bounds items and text, repairs ids and
 * writes optional keys only when they differ from their default.
 * @param {object} d - Input data.
 * @param {(html: unknown) => string} inline - Inline HTML sanitiser.
 * @param {number} marker - Built-in marker version to write.
 * @returns {object} Clean data.
 */
export const cleanColumnsData = (d, inline, marker) => {
  const source = Array.isArray(d.columns) ? d.columns.slice(0, COLUMNS_LIMITS.maxColumns) : [];
  while (source.length < COLUMNS_LIMITS.minColumns) source.push({});
  const used = new Set();
  const uniqueId = (candidate, fallback) => {
    let id = typeof candidate === 'string' && COLUMN_ID.test(candidate) ? candidate : null;
    if (!id || used.has(id)) {
      id = fallback;
      for (let n = 2; used.has(id); n += 1) id = `${fallback}${n}`.slice(-32);
    }
    used.add(id);
    return id;
  };
  const columns = source.map((input, c) => {
    const column = isObject(input) ? input : {};
    const id = uniqueId(column.id, `col${c + 1}`);
    const items = (Array.isArray(column.items) ? column.items.slice(0, COLUMNS_LIMITS.items) : []).map(
      (raw, i) => {
        const item = cleanItem(raw, inline);
        item.id = uniqueId(item.id, `${id}-${i + 1}`.slice(-32));
        return item;
      }
    );
    return { id, items };
  });
  const out = { columns };
  const layout = layoutsFor(columns.length).includes(d.layout) ? d.layout : 'equal';
  if (layout !== 'equal') out.layout = layout;
  if (COLUMNS_GAPS.includes(d.gap) && d.gap !== 'medium') out.gap = d.gap;
  if (COLUMNS_VALIGNS.includes(d.valign) && d.valign !== 'top') out.valign = d.valign;
  out._mex = marker;
  return out;
};

/**
 * Shape check for the live collaboration guard (`shared/ydoc-guard.mjs`).
 * Types, keys and bounds only: an id repeated after two people added items
 * at the same time is valid here and repaired by the policy when the
 * content is rendered or saved. Columns may briefly number 1 to 4 (a column
 * being removed or added by someone else).
 * @param {unknown} data - Block data read from the shared document.
 * @returns {boolean} Acceptable.
 */
export const isColumnsDataShapeValid = (data) => {
  if (!isObject(data)) return false;
  for (const key of Object.keys(data)) if (!DATA_KEYS.has(key)) return false;
  const { columns, layout, gap, valign } = data;
  if (layout !== undefined && !COLUMNS_LAYOUT_NAMES.includes(layout)) return false;
  if (gap !== undefined && !COLUMNS_GAPS.includes(gap)) return false;
  if (valign !== undefined && !COLUMNS_VALIGNS.includes(valign)) return false;
  if (columns === undefined) return true;
  if (!Array.isArray(columns) || columns.length > COLUMNS_LIMITS.maxColumns) return false;
  for (const column of columns) {
    if (!isObject(column)) return false;
    for (const key of Object.keys(column)) if (!COLUMN_KEYS.has(key)) return false;
    if (column.id !== undefined && (typeof column.id !== 'string' || !COLUMN_ID.test(column.id)))
      return false;
    if (column.items === undefined) continue;
    if (!Array.isArray(column.items) || column.items.length > COLUMNS_LIMITS.items) return false;
    for (const item of column.items) {
      if (!isObject(item)) return false;
      for (const key of Object.keys(item)) if (!ITEM_KEYS.has(key)) return false;
      if (item.id !== undefined && (typeof item.id !== 'string' || !COLUMN_ID.test(item.id))) return false;
      if (item.type !== undefined && !COLUMN_ITEM_TYPES.includes(item.type)) return false;
      if (
        item.text !== undefined &&
        (typeof item.text !== 'string' || item.text.length > COLUMNS_LIMITS.text)
      )
        return false;
      if (item.level !== undefined && !(Number.isInteger(item.level) && item.level >= 1 && item.level <= 6))
        return false;
      if (item.style !== undefined && !COLUMN_LIST_STYLES.includes(item.style)) return false;
    }
  }
  return true;
};

/**
 * Inline text fields of a columns block in reading order (column by column),
 * as `{ path, value, columnIndex, itemIndex, item }`. The single walker used
 * by find and replace, AI segments, translation and the quality checks.
 * @param {unknown} data - Block data.
 * @returns {Array<{ path: Array<string|number>, value: string, columnIndex: number, itemIndex: number, item: object }>} Fields.
 */
export const columnsTextFields = (data) => {
  const out = [];
  if (!isObject(data) || !Array.isArray(data.columns)) return out;
  data.columns.slice(0, COLUMNS_LIMITS.maxColumns).forEach((column, c) => {
    if (!isObject(column) || !Array.isArray(column.items)) return;
    column.items.slice(0, COLUMNS_LIMITS.items).forEach((item, i) => {
      if (isObject(item) && typeof item.text === 'string')
        out.push({
          path: ['columns', c, 'items', i, 'text'],
          value: item.text,
          columnIndex: c,
          itemIndex: i,
          item,
        });
    });
  });
  return out;
};

/**
 * Groups the clean items of a column for rendering: consecutive list items
 * of one style become one list.
 * @param {Array<{ type: string, text: string, level?: number, style?: string }>} items - Clean items.
 * @returns {Array<{ kind: 'paragraph'|'heading', item: object } | { kind: 'list', style: string, items: object[] }>} Runs.
 */
export const groupColumnItems = (items) => {
  const out = [];
  for (const item of items || []) {
    const last = out[out.length - 1];
    if (item.type === 'list') {
      if (last && last.kind === 'list' && last.style === item.style) last.items.push(item);
      else out.push({ kind: 'list', style: item.style, items: [item] });
    } else out.push({ kind: item.type === 'heading' ? 'heading' : 'paragraph', item });
  }
  return out;
};

/**
 * Data of a new columns block.
 * @param {number} [count=2] - Columns (2-4).
 * @param {string} [layout='equal'] - Layout.
 * @returns {{ columns: Array<{ id: string, items: object[] }>, layout?: string }} Data.
 */
export const createColumnsData = (count = 2, layout = 'equal') => {
  const n = Math.min(COLUMNS_LIMITS.maxColumns, Math.max(COLUMNS_LIMITS.minColumns, Number(count) || 2));
  const data = {
    columns: Array.from({ length: n }, () => ({
      id: newColumnsId(),
      items: [{ id: newColumnsId(), type: 'paragraph', text: '' }],
    })),
  };
  if (layoutsFor(n).includes(layout) && layout !== 'equal') data.layout = layout;
  return data;
};

/**
 * True when a column has no visible text.
 * @param {{ items?: Array<{ text?: string }> }} column - Column.
 * @param {(html: string) => string} toText - Inline HTML to plain text.
 * @returns {boolean} Result.
 */
export const isColumnEmpty = (column, toText) =>
  !column ||
  !Array.isArray(column.items) ||
  column.items.every((item) => !item || typeof item.text !== 'string' || !toText(item.text).trim());

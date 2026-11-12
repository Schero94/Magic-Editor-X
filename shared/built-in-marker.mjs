/**
 * Built-in marker of the block types (2.3 and later) whose names a Settings
 * custom block could already use before they became built-in. Kept free of imports so that every shared
 * module (also `editor-data.mjs`, which `sanitize-policy.mjs` imports) can use
 * it; `sanitize-policy.mjs` re-exports it.
 */

/**
 * Plain object check (same rule as `editor-data.mjs`).
 * @param {unknown} value - Candidate.
 * @returns {value is Record<string, unknown>} Result.
 */
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Key that marks the data of a built-in block whose type name a custom block
 * could already use before 2.3 (`MARKED_BLOCKS`). The built-in tools, the
 * policies and therefore every stored 2.3 value write it with
 * `BUILT_IN_MARKER_VERSION`. A Settings custom block field cannot be named
 * like this (field names start with a letter), so custom block data never
 * carries it. A later version may write a higher number; any positive
 * integer counts as the marker.
 */
export const BUILT_IN_MARKER = '_mex';
export const BUILT_IN_MARKER_VERSION = 1;

/**
 * Block types that became built-in in 2.3, with every key their data may
 * have and the key (and its JSON type) their data always has.
 *
 * Before 2.3 a Settings custom block could be named like one of them. Its
 * stored data keeps being custom block data (generic policy, the site's own
 * tool, template and rendering) and is never rewritten. `isBuiltInBlock`
 * tells the two apart: data with the marker is built-in; data without it is
 * built-in only when it has exactly the built-in shape (only these keys, and
 * the anchor key with its type when the type has one; `toc` has none). Custom
 * block data never has that shape:
 * a simple custom block always stores `content`, `blockType` and
 * `blockName`, an embedded-entry block `entry`, `contentType` and
 * `displayMode`, and none of these keys belongs to a built-in shape.
 */
export const MARKED_BLOCKS = Object.freeze({
  toc: Object.freeze({ keys: Object.freeze(['title', 'minLevel', 'maxLevel', 'style']), anchor: null }),
  gallery: Object.freeze({
    keys: Object.freeze(['images', 'layout', 'columns', 'caption']),
    anchor: Object.freeze(['images', 'array']),
  }),
  video: Object.freeze({
    keys: Object.freeze(['file', 'poster', 'title', 'caption', 'loop', 'muted', 'tracks']),
    anchor: Object.freeze(['file', 'object']),
  }),
  audio: Object.freeze({
    keys: Object.freeze(['file', 'title', 'caption', 'loop', 'tracks']),
    anchor: Object.freeze(['file', 'object']),
  }),
  synced: Object.freeze({ keys: Object.freeze(['ref']), anchor: Object.freeze(['ref', 'string']) }),
  // 2.4: math block. A Settings custom block named `math` could exist before 2.4.
  math: Object.freeze({ keys: Object.freeze(['tex', 'display']), anchor: Object.freeze(['tex', 'string']) }),
});

/**
 * True when a value is a built-in marker (a positive integer).
 * @param {unknown} value - Candidate.
 * @returns {boolean} Result.
 */
export const isBuiltInMarker = (value) => Number.isInteger(value) && /** @type {number} */ (value) >= 1;

/**
 * True when data has the exact built-in shape of a marked block type.
 * @param {{ keys: readonly string[], anchor: readonly string[]|null }} shape - Entry of `MARKED_BLOCKS`.
 * @param {Record<string, unknown>} data - Block data.
 * @returns {boolean} Result.
 */
const hasBuiltInShape = (shape, data) => {
  if (!Object.keys(data).every((key) => shape.keys.includes(key))) return false;
  // `toc` has no anchor: any subset of its keys, also `{}` (no custom block tool writes empty data).
  if (!shape.anchor) return true;
  const [key, kind] = shape.anchor;
  const value = data[key];
  if (kind === 'array') return Array.isArray(value);
  if (kind === 'object') return isPlainObject(value);
  return typeof value === kind;
};

/**
 * True when the data of a `MARKED_BLOCKS` type is built-in data: it has the
 * marker, or exactly the built-in shape. False for other types.
 * @param {string} type - Block type.
 * @param {unknown} data - Block data.
 * @returns {boolean} Result.
 */
export const isMarkedBuiltIn = (type, data) => {
  if (!Object.prototype.hasOwnProperty.call(MARKED_BLOCKS, type) || !isPlainObject(data)) return false;
  if (isBuiltInMarker(data[BUILT_IN_MARKER])) return true;
  return hasBuiltInShape(MARKED_BLOCKS[type], data);
};

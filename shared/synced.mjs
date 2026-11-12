/**
 * Synced blocks (2.3): a field stores a reference block
 * `{ type: 'synced', data: { ref: <documentId of the source> } }`; the source
 * is a template of kind `synced` (Settings > Templates). Pure rules shared by
 * the server (Content API / GraphQL expansion, nesting check), the renderers
 * (`options.synced`) and the admin (editor view, preview, history diff).
 *
 * Expansion replaces each reference with a copy of the source blocks. It is
 * toggle-safe (a toggle's `items` counts the blocks after it, so the counts of
 * enclosing toggles are recomputed), never expands a reference inside a
 * source (no nesting, no cycles), gives the copies ids derived from the
 * reference block id (two references to one source never share ids) and is
 * bounded by the field limits (5000 blocks, 5 MiB). No dependencies besides
 * the editor-data helpers and the block policy, so the render bundle can use
 * it.
 */

import {
  EDITOR_DATA_LIMITS,
  byteLength,
  hashString,
  isPlainObject,
  normalizeEditorDataSafe,
} from './editor-data.mjs';
import { isBuiltInBlock } from './sanitize-policy.mjs';

export const SYNCED_TYPE = 'synced';

/** A source reference: a Strapi documentId. */
export const SYNCED_REF_PATTERN = /^[a-z0-9]{1,64}$/;

/** Bounds of the server expansion per response. */
export const SYNCED_LIMITS = Object.freeze({ refsPerResponse: 100 });

const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TOGGLE_DEPTH = 16;

/**
 * True for a built-in synced reference block (a custom block named `synced`
 * from before 2.3 has no `ref` key and is not one).
 * @param {unknown} block - Block.
 * @returns {boolean} Result.
 */
export const isSyncedBlock = (block) =>
  Boolean(block) && block.type === SYNCED_TYPE && isBuiltInBlock(/** @type {any} */ (block));

/**
 * The source documentId of a synced block, or null.
 * @param {unknown} block - Block.
 * @returns {string|null} Reference.
 */
export const syncedRefOf = (block) => {
  if (!isSyncedBlock(block)) return null;
  const ref = /** @type {any} */ (block).data.ref;
  return typeof ref === 'string' && SYNCED_REF_PATTERN.test(ref) ? ref : null;
};

/**
 * True when a block list contains a synced reference (a source must not).
 * @param {unknown} blocks - Blocks.
 * @returns {boolean} Result.
 */
export const containsSynced = (blocks) => Array.isArray(blocks) && blocks.some(isSyncedBlock);

/**
 * Distinct references of a document, in document order.
 * @param {{ blocks?: unknown[] }|null|undefined} data - Normalised document.
 * @returns {string[]} References.
 */
export const syncedRefsOf = (data) => {
  const out = [];
  const seen = new Set();
  for (const block of (data && Array.isArray(data.blocks) && data.blocks) || []) {
    const ref = syncedRefOf(block);
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
};

/**
 * @typedef {object} BlockNode
 * @property {{ id: string, type: string, data: object, tunes?: object }} block - Block.
 * @property {BlockNode[]} children - Toggle content.
 * @property {boolean} toggle - True when `block` is a grouping toggle.
 */

/**
 * Groups toggle content (the same rule as the renderers: `items` following
 * blocks belong to the toggle, nested up to 16 levels).
 * @param {Array<object>} blocks - Flat blocks.
 * @returns {BlockNode[]} Tree.
 */
export const toBlockTree = (blocks) => {
  const build = (start, end, depth) => {
    const out = [];
    let i = start;
    while (i < end) {
      const block = blocks[i];
      i += 1;
      const node = { block, children: [], toggle: false };
      if (block && block.type === 'toggle' && depth < MAX_TOGGLE_DEPTH && isPlainObject(block.data)) {
        const count = Math.max(0, Math.min(Number(block.data.items) || 0, end - i));
        node.children = build(i, i + count, depth + 1);
        node.toggle = true;
        i += count;
      }
      out.push(node);
    }
    return out;
  };
  return build(0, Array.isArray(blocks) ? blocks.length : 0, 0);
};

/**
 * Flattens a tree; toggle `items` are recomputed (unchanged blocks keep their object).
 * @param {BlockNode[]} nodes - Tree.
 * @returns {Array<object>} Flat blocks.
 */
export const fromBlockTree = (nodes) => {
  const out = [];
  const walk = (list) => {
    for (const node of list) {
      const at = out.length;
      out.push(node.block);
      if (!node.toggle) continue;
      walk(node.children);
      const count = out.length - at - 1;
      if (Number(node.block.data.items) !== count)
        out[at] = { ...node.block, data: { ...node.block.data, items: count } };
    }
  };
  walk(nodes);
  return out;
};

/**
 * Replaces blocks and keeps toggle counts right: `replace(block)` returns the
 * blocks that take its place (`null` keeps it, `[]` removes it). A toggle
 * replaced by one toggle keeps its content; a toggle replaced by anything
 * else leaves its content in place after the replacement.
 * @param {Array<object>} blocks - Flat blocks.
 * @param {(block: object) => Array<object>|null|undefined} replace - Replacement, or null to keep the block.
 * @returns {Array<object>} Flat blocks.
 */
export const replaceBlocks = (blocks, replace) => {
  const map = (nodes) => {
    const out = [];
    for (const node of nodes) {
      const next = replace(node.block);
      const children = node.toggle ? map(node.children) : [];
      if (next === null || next === undefined) {
        out.push(node.toggle ? { ...node, children } : node);
      } else if (node.toggle && next.length === 1 && next[0] && next[0].type === 'toggle') {
        out.push({ block: next[0], children, toggle: true });
      } else {
        out.push(...toBlockTree(next), ...children);
      }
    }
    return out;
  };
  return fromBlockTree(map(toBlockTree(blocks)));
};

/**
 * Normalised source blocks without nested references.
 * @param {unknown} source - Source document or block array (any stored shape).
 * @returns {Array<object>} Blocks.
 */
export const sourceBlocksOf = (source) => {
  const data = normalizeEditorDataSafe(source);
  if (!data || !data.blocks.length) return [];
  return containsSynced(data.blocks)
    ? replaceBlocks(data.blocks, (block) => (isSyncedBlock(block) ? [] : null))
    : data.blocks;
};

/**
 * Id of a copied block, derived from the reference block id and the source block id.
 * @param {string} parentId - Reference block id.
 * @param {string} sourceId - Source block id.
 * @param {Set<string>} taken - Ids in use (updated).
 * @returns {string} Id.
 */
const derivedId = (parentId, sourceId, taken) => {
  const joined = `${parentId}-${sourceId}`;
  let id = BLOCK_ID.test(joined) ? joined : `sx${hashString(joined)}${hashString(`${sourceId}|${parentId}`)}`;
  for (let n = 2; taken.has(id); n += 1) id = `sx${hashString(`${joined}|${n}`)}${n}`;
  taken.add(id);
  return id;
};

/**
 * @typedef {object} SyncedExpansion
 * @property {{ time: number, version: string, blocks: Array<object> }|null} data - Document with the references replaced.
 * @property {Map<string, string>} origins - Copied block id -> source reference.
 * @property {number} expanded - References replaced by content.
 * @property {number} unresolved - References replaced by nothing (no source, nothing allowed, over the limits).
 */

/**
 * Replaces every synced reference with a copy of its source blocks.
 * @param {{ time?: number, version?: string, blocks: Array<object> }|null} data - Normalised document.
 * @param {(ref: string) => unknown} lookup - Source document or blocks of a reference (null/undefined = none).
 * @param {{ filter?: (blocks: Array<object>) => Array<object>, maxBlocks?: number, maxBytes?: number }} [options] - Per-field filter (preset) and bounds.
 * @returns {SyncedExpansion} Result.
 */
export const expandSynced = (data, lookup, options = {}) => {
  const origins = new Map();
  if (!data || !Array.isArray(data.blocks) || !containsSynced(data.blocks))
    return { data, origins, expanded: 0, unresolved: 0 };
  const maxBlocks = options.maxBlocks || EDITOR_DATA_LIMITS.maxBlocks;
  const maxBytes = options.maxBytes || EDITOR_DATA_LIMITS.maxBytes - 64 * 1024;
  const taken = new Set(data.blocks.map((block) => block.id));
  let total = data.blocks.filter((block) => !isSyncedBlock(block)).length;
  let bytes = byteLength(JSON.stringify(data));
  let expanded = 0;
  let unresolved = 0;
  const cache = new Map();
  const sourceFor = (ref) => {
    if (!cache.has(ref)) {
      let blocks;
      try {
        blocks = sourceBlocksOf(typeof lookup === 'function' ? lookup(ref) : null);
        if (blocks.length && typeof options.filter === 'function') {
          const filtered = options.filter(blocks);
          blocks = Array.isArray(filtered) ? filtered.filter((block) => !isSyncedBlock(block)) : [];
        }
      } catch {
        blocks = [];
      }
      cache.set(ref, { blocks, size: blocks.length ? byteLength(JSON.stringify(blocks)) : 0 });
    }
    return cache.get(ref);
  };
  const blocks = replaceBlocks(data.blocks, (block) => {
    if (!isSyncedBlock(block)) return null;
    const ref = syncedRefOf(block);
    const source = ref ? sourceFor(ref) : { blocks: [], size: 0 };
    if (!source.blocks.length || total + source.blocks.length > maxBlocks || bytes + source.size > maxBytes) {
      unresolved += 1;
      return [];
    }
    total += source.blocks.length;
    bytes += source.size;
    expanded += 1;
    return source.blocks.map((item) => {
      const id = derivedId(block.id, item.id, taken);
      origins.set(id, ref);
      const copy = { id, type: item.type, data: JSON.parse(JSON.stringify(item.data || {})) };
      if (isPlainObject(item.tunes) && Object.keys(item.tunes).length)
        copy.tunes = JSON.parse(JSON.stringify(item.tunes));
      return copy;
    });
  });
  return {
    data: { time: data.time || 0, version: data.version || '2.31.7', blocks },
    origins,
    expanded,
    unresolved,
  };
};

/**
 * Lookup from the renderer option `synced`: a map `{ [ref]: document | blocks }`
 * (plain object or Map) or a function `(ref) => document | blocks | null`.
 * @param {unknown} option - `options.synced`.
 * @returns {(ref: string) => unknown} Lookup (always returns null without the option).
 */
export const syncedLookup = (option) => {
  if (typeof option === 'function') return (ref) => option(ref);
  if (option instanceof Map) return (ref) => option.get(ref);
  if (isPlainObject(option))
    return (ref) => (Object.prototype.hasOwnProperty.call(option, ref) ? option[ref] : null);
  return () => null;
};

/**
 * What the version diff shows for a synced block entry.
 * @param {{ op: string, type: string, before?: object, after?: object }} entry - Diff entry (`diffDocuments`).
 * @returns {{ before: string|null, after: string|null }|null} References on each side, or null for other blocks.
 */
export const syncedDiffRefs = (entry) => {
  if (!entry || entry.type !== SYNCED_TYPE) return null;
  const before = entry.before && isSyncedBlock(entry.before) ? syncedRefOf(entry.before) : null;
  const after = entry.after && isSyncedBlock(entry.after) ? syncedRefOf(entry.after) : null;
  if (!before && !after) return null;
  return { before, after };
};

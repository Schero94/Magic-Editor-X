/**
 * "Use existing content" (2.5): pure rules for putting blocks of one Magic
 * Editor X field into another, shared by the server (bounds), the admin
 * ("Insert from another entry" dialog, block clipboard) and the tests.
 *
 * Both ways in end in the same plan (`planReuseInsertion`):
 * - every block gets a fresh id, so comments, range comments and suggestions
 *   of the source (all keyed by block id, never stored in block data) stay
 *   with the source and the live room treats the blocks as new;
 * - blocks the target field cannot take are left out with a reason
 *   (`notAllowed`: the field preset; `unavailable`: the editor has no tool for
 *   the type, for example a disabled custom block; `syncedMissing`: a synced
 *   block whose source is gone or no longer offered; `unfixable`: the preset
 *   fix cannot make it fit); heading levels and links are fixed like "Fix
 *   automatically"; the field's block limit is respected;
 * - toggle groups keep valid `items` counts when blocks are left out;
 * - footnote ids that already exist in the target (or twice in the inserted
 *   blocks) get a new id, so every marker stays its own footnote;
 * - synced blocks stay references, media blocks keep their Media Library
 *   file, and every other data key of an allowed block is kept as it is.
 *
 * Data is never sanitised here: callers clean it with the field policy first
 * (server `cleanEditorValue`, admin `prepareEditorValue`), exactly as a save does.
 */

import { isPlainObject } from './editor-data.mjs';
import { checkBlockStructure, fixPresetViolations, isBlockAllowed } from './presets.mjs';
import { fromBlockTree, replaceBlocks, syncedRefOf, toBlockTree } from './synced.mjs';
import { newBlockId } from './templates.mjs';

/** Bounds of the source route and the block clipboard. */
export const REUSE_LIMITS = Object.freeze({
  /** Blocks of one source field sent to the preview (more: `truncated`). */
  blocksPerField: 200,
  /** Editor fields of one entry in one response. */
  fields: 50,
  /** JSON size of the blocks of one response. */
  bytes: 2 * 1024 * 1024,
  /** Blocks read from an Editor.js block clipboard. */
  clipboardBlocks: 1000,
  /** Length of an Editor.js block clipboard that is read. */
  clipboardBytes: 2 * 1024 * 1024,
});

/** Why a block cannot be inserted (order = how they are reported). */
export const REUSE_REASONS = Object.freeze(['notAllowed', 'unavailable', 'syncedMissing', 'unfixable']);

/** Editor.js clipboard MIME type (`application/x-editor-js`, Editor.js 2.31 `Paste.MIME_TYPE`). */
export const EDITOR_CLIPBOARD_TYPE = 'application/x-editor-js';

const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_$-]{0,63}$/;
const FOOTNOTE_ATTRIBUTE = /data-mex-footnote="([A-Za-z0-9_-]{1,64})"/g;
const MAX_DEPTH = 24;

/**
 * Reads an Editor.js block clipboard (`application/x-editor-js`: the JSON
 * array Editor.js 2.31 writes on copy, `[{ id, tool, data, tunes, time }]`).
 * Entries without a usable tool name or data object are skipped.
 * @param {unknown} json - Clipboard text.
 * @returns {Array<{ id?: string, type: string, data: object, tunes?: object }>|null} Blocks (not cleaned), or null when nothing usable is there.
 */
export const parseEditorClipboard = (json) => {
  if (typeof json !== 'string' || !json || json.length > REUSE_LIMITS.clipboardBytes) return null;
  let list;
  try {
    list = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  const out = [];
  for (const entry of list.slice(0, REUSE_LIMITS.clipboardBlocks)) {
    if (!isPlainObject(entry)) continue;
    const type = typeof entry.tool === 'string' ? entry.tool : entry.type;
    if (typeof type !== 'string' || !TOOL_NAME.test(type) || !isPlainObject(entry.data)) continue;
    const block = { type, data: entry.data };
    if (typeof entry.id === 'string' && entry.id) block.id = entry.id;
    if (isPlainObject(entry.tunes) && Object.keys(entry.tunes).length) block.tunes = entry.tunes;
    out.push(block);
  }
  return out.length ? out : null;
};

/**
 * Whether one block can go into the target field.
 * @param {{ type: string, data: object }} block - Cleaned block.
 * @param {{ preset?: import('./presets.mjs').FieldPreset|null, hasTool?: (type: string) => boolean, syncedAvailable?: (ref: string) => boolean|undefined }} [options] - Target rules;
 *   `syncedAvailable` returns false for a source that is gone or not offered (undefined = not known yet, allowed).
 * @returns {{ ok: true, adjusted: boolean, block: object } | { ok: false, reason: string }} Status; `block` is the (fixed) block.
 */
export const reuseStatus = (block, options = {}) => {
  const { preset = null, hasTool, syncedAvailable } = options;
  if (!block || typeof block.type !== 'string' || !isPlainObject(block.data))
    return { ok: false, reason: 'unfixable' };
  if (preset && !isBlockAllowed(preset, block.type)) return { ok: false, reason: 'notAllowed' };
  if (typeof hasTool === 'function' && !hasTool(block.type)) return { ok: false, reason: 'unavailable' };
  const ref = syncedRefOf(block);
  if (ref && typeof syncedAvailable === 'function' && syncedAvailable(ref) === false)
    return { ok: false, reason: 'syncedMissing' };
  if (preset && checkBlockStructure(preset, block)) {
    const fixed = fixPresetViolations({ blocks: [block] }, preset).data.blocks[0];
    if (!fixed || checkBlockStructure(preset, fixed)) return { ok: false, reason: 'unfixable' };
    return { ok: true, adjusted: true, block: fixed };
  }
  return { ok: true, adjusted: false, block };
};

/**
 * Calls `fn` on every string of a value (depth bounded) and builds a copy.
 * @param {unknown} value - Data.
 * @param {(text: string) => string} fn - String mapper.
 * @param {number} [depth=0] - Depth.
 * @returns {unknown} Copy.
 */
const mapStrings = (value, fn, depth = 0) => {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, fn, depth + 1);
    return out;
  }
  return value;
};

/**
 * Footnote ids used in blocks (`<sup data-mex-footnote="id">`, the stored canonical form).
 * @param {Array<{ data?: object }>} blocks - Blocks.
 * @returns {Set<string>} Ids.
 */
export const footnoteIdsOf = (blocks) => {
  const ids = new Set();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || !isPlainObject(block.data)) continue;
    mapStrings(block.data, (text) => {
      if (text.includes('data-mex-footnote='))
        for (const match of text.matchAll(FOOTNOTE_ATTRIBUTE)) ids.add(match[1]);
      return text;
    });
  }
  return ids;
};

const FOOTNOTE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A new footnote id (`fn` + 10 random characters, the editor's own form).
 * @returns {string} Id.
 */
export const newReuseFootnoteId = () => {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let id = 'fn';
  for (const byte of bytes) id += FOOTNOTE_ALPHABET[byte % FOOTNOTE_ALPHABET.length];
  return id;
};

/**
 * Gives footnote markers whose id is already taken (in the target field or
 * earlier in the inserted blocks) a new id. Note and marker stay together.
 * @param {Array<object>} blocks - Blocks to insert (new objects are returned for changed ones).
 * @param {Set<string>} taken - Ids in use (updated).
 * @param {() => string} [factory] - Id factory.
 * @returns {{ blocks: Array<object>, renamed: number }} Blocks and the number of new ids.
 */
export const refreshFootnoteIds = (blocks, taken, factory = newReuseFootnoteId) => {
  let renamed = 0;
  const next = (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (!block || !isPlainObject(block.data)) return block;
    let changed = false;
    const data = mapStrings(block.data, (text) =>
      text.includes('data-mex-footnote=')
        ? text.replace(FOOTNOTE_ATTRIBUTE, (whole, id) => {
            if (!taken.has(id)) {
              taken.add(id);
              return whole;
            }
            let fresh = factory();
            for (let attempt = 0; taken.has(fresh) && attempt < 20; attempt += 1) fresh = factory();
            taken.add(fresh);
            renamed += 1;
            changed = true;
            return `data-mex-footnote="${fresh}"`;
          })
        : text
    );
    return changed ? { ...block, data } : block;
  });
  return { blocks: next, renamed };
};

/**
 * @typedef {object} ReusePlan
 * @property {Array<{ id: string, type: string, data: object, tunes?: object }>} blocks - Blocks to insert, fresh ids.
 * @property {Array<{ reason: string, type: string, count: number }>} omitted - Blocks left out, by reason and type.
 * @property {number} adjusted - Blocks changed to fit the field (heading level, links).
 * @property {number} truncated - Blocks left out because of the field's block limit.
 * @property {number} footnotes - Footnote markers that got a new id.
 */

/**
 * Plans the insertion of source blocks into a field (dialog and clipboard).
 * @param {Array<{ id?: string, type: string, data: object, tunes?: object }>} source - Cleaned source blocks in document order.
 * @param {object} [options] - Target.
 * @param {Iterable<string>|null} [options.selected] - Source block ids to insert (null = all).
 * @param {import('./presets.mjs').FieldPreset|null} [options.preset] - Target preset (null = everything allowed).
 * @param {(type: string) => boolean} [options.hasTool] - Whether the target editor has a tool for the type.
 * @param {(ref: string) => boolean|undefined} [options.syncedAvailable] - Synced source still offered.
 * @param {Array<{ id: string, data?: object }>} [options.existing] - Blocks already in the target field.
 * @param {() => string} [options.idFactory] - Block id factory.
 * @param {() => string} [options.footnoteIdFactory] - Footnote id factory.
 * @returns {ReusePlan} Plan.
 */
export const planReuseInsertion = (source, options = {}) => {
  const {
    selected = null,
    preset = null,
    hasTool,
    syncedAvailable,
    existing = [],
    idFactory = newBlockId,
    footnoteIdFactory = newReuseFootnoteId,
  } = options;
  const wanted = selected ? new Set(selected) : null;
  const omittedBy = new Map();
  let adjusted = 0;
  const list = replaceBlocks(Array.isArray(source) ? source.filter(Boolean) : [], (block) => {
    if (wanted && !wanted.has(block.id)) return [];
    const status = reuseStatus(block, { preset, hasTool, syncedAvailable });
    if (!status.ok) {
      const key = `${status.reason}|${block.type}`;
      omittedBy.set(key, (omittedBy.get(key) || 0) + 1);
      return [];
    }
    if (status.adjusted) {
      adjusted += 1;
      return [status.block];
    }
    return null;
  });
  const existingList = Array.isArray(existing) ? existing : [];
  let kept = list;
  let truncated = 0;
  const room = preset && preset.maxBlocks ? Math.max(0, preset.maxBlocks - existingList.length) : Infinity;
  if (kept.length > room) {
    truncated = kept.length - room;
    // Toggle counts are recomputed for a toggle whose content was cut.
    kept = fromBlockTree(toBlockTree(kept.slice(0, room)));
  }
  const taken = new Set(existingList.map((block) => block && block.id).filter(Boolean));
  const fresh = kept.map((block) => {
    let id = idFactory();
    for (let attempt = 0; taken.has(id) && attempt < 20; attempt += 1) id = idFactory();
    taken.add(id);
    const copy = { id, type: block.type, data: JSON.parse(JSON.stringify(block.data)) };
    if (isPlainObject(block.tunes) && Object.keys(block.tunes).length)
      copy.tunes = JSON.parse(JSON.stringify(block.tunes));
    return copy;
  });
  const notes = refreshFootnoteIds(fresh, footnoteIdsOf(existingList), footnoteIdFactory);
  const omitted = [...omittedBy]
    .map(([key, count]) => {
      const [reason, type] = key.split('|');
      return { reason, type, count };
    })
    .sort((a, b) => REUSE_REASONS.indexOf(a.reason) - REUSE_REASONS.indexOf(b.reason));
  return { blocks: notes.blocks, omitted, adjusted, truncated, footnotes: notes.renamed };
};

/**
 * Puts blocks into a document: after `afterIndex`, or in place of the block
 * at `replaceIndex` (an empty paragraph the caret is in).
 * @param {{ time?: number, version?: string, blocks?: Array<object> }|null} doc - Current document.
 * @param {Array<object>} blocks - Blocks to insert.
 * @param {{ afterIndex?: number, replaceIndex?: number }} [at] - Position (default: at the end).
 * @returns {{ time: number, version: string, blocks: Array<object> }} New document.
 */
export const spliceReuse = (doc, blocks, at = {}) => {
  const current = doc && Array.isArray(doc.blocks) ? doc.blocks : [];
  const version = (doc && doc.version) || '2.31.7';
  if (Number.isInteger(at.replaceIndex) && at.replaceIndex >= 0 && at.replaceIndex < current.length) {
    return {
      time: Date.now(),
      version,
      blocks: [...current.slice(0, at.replaceIndex), ...blocks, ...current.slice(at.replaceIndex + 1)],
    };
  }
  const index = Number.isInteger(at.afterIndex)
    ? Math.min(Math.max(at.afterIndex + 1, 0), current.length)
    : current.length;
  return {
    time: Date.now(),
    version,
    blocks: [...current.slice(0, index), ...blocks, ...current.slice(index)],
  };
};

/**
 * Readable parts of a field path (`sections.0.body` -> [{ name: 'sections', index: 1 }, { name: 'body' }]).
 * @param {unknown} path - Field path with indices.
 * @returns {Array<{ name: string, index?: number }>} Parts (indices 1-based).
 */
export const fieldPathParts = (path) => {
  const out = [];
  for (const part of String(path || '')
    .split('.')
    .filter(Boolean)) {
    if (/^\d+$/.test(part) && out.length)
      out[out.length - 1] = { ...out[out.length - 1], index: Number(part) + 1 };
    else out.push({ name: part });
  }
  return out;
};

/**
 * Attribute name as words (`relatedArticles` -> `Related articles`, `hero_text` -> `Hero text`).
 * @param {string} name - Attribute name.
 * @returns {string} Label.
 */
export const humanizeAttribute = (name) => {
  const words = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};

/**
 * Label of a field path (`sections.0.body` -> `Sections 1 › Body`).
 * @param {unknown} path - Field path.
 * @returns {string} Label.
 */
export const fieldPathLabel = (path) =>
  fieldPathParts(path)
    .map((part) => `${humanizeAttribute(part.name)}${part.index ? ` ${part.index}` : ''}`)
    .join(' › ');

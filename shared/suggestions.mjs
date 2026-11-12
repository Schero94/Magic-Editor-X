/**
 * Block suggestions (2.4): pure helpers shared by the server and the admin.
 *
 * A suggestion proposes one change to one block of one editor field of one
 * document locale: `update` (replace the block's content), `insert` (a new
 * block after `afterBlockId`, or at the start) or `delete`. Suggestions are
 * stored apart from the field value; accepting one applies the proposed block
 * through the editor (shared document, one undo step) and the normal save
 * stores it.
 *
 * Block-level only: Editor.js 2.x has no character-level change tracking
 * (no mark model in the saved data, every tool owns its DOM), so a change is
 * described as a whole proposed block and shown with the word diff of
 * `shared/diff.mjs`.
 */

import { canonicalJson, diffDocuments, diffTunes } from './diff.mjs';
import { normalizeCommentBody } from './comments.mjs';

/** Operations of a suggestion. */
export const SUGGESTION_OPS = Object.freeze(['update', 'insert', 'delete']);

/** Stored states. `outdated` is derived in the editor from the live content (see `suggestionState`). */
export const SUGGESTION_STATUSES = Object.freeze(['open', 'accepted', 'rejected']);

/** Suggestions one request may create or update. */
export const MAX_SUGGESTIONS_PER_REQUEST = 50;

/** Open suggestions one field of one document locale may hold. */
export const MAX_OPEN_SUGGESTIONS_PER_FIELD = 500;

/** Longest note (plain text, characters after normalisation). */
export const MAX_SUGGESTION_NOTE_LENGTH = 1000;

/** Largest proposed block (canonical JSON, characters). */
export const MAX_PROPOSED_CHARS = 64 * 1024;

/** Block hash written by `blockHash` (14 hex characters, 53 bits). */
export const BLOCK_HASH_PATTERN = /^[a-f0-9]{14}$/;

/**
 * Normalises the optional note of a suggestion: the comment rules (plain text,
 * control and bidi characters removed), bounded.
 * @param {unknown} value - Untrusted input.
 * @returns {string|null} Note or null.
 */
export const normalizeSuggestionNote = (value) => {
  const text = normalizeCommentBody(
    typeof value === 'string' ? value.slice(0, MAX_SUGGESTION_NOTE_LENGTH * 2) : ''
  );
  if (!text) return null;
  return text.length > MAX_SUGGESTION_NOTE_LENGTH
    ? text.slice(0, MAX_SUGGESTION_NOTE_LENGTH).trimEnd()
    : text;
};

/**
 * cyrb53 (public domain): a fast 53-bit string hash. Not cryptographic; it
 * only tells whether a block changed since a suggestion was made.
 * @param {string} text - Text.
 * @returns {string} 14 hex characters.
 */
const cyrb53 = (text) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
};

/**
 * Data without the leaves that mean "not set" (`false`, `null`, `''`): the
 * editor writes defaults such as `withBorder: false` that stored content may
 * not have, and they must not count as a change.
 * @param {unknown} value - Value.
 * @param {number} [depth] - Depth (bounded).
 * @returns {unknown} Value without unset leaves.
 */
const withoutUnset = (value, depth = 0) => {
  if (depth > 24 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => withoutUnset(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === false || item === null || item === '' || item === undefined) continue;
    out[key] = withoutUnset(item, depth + 1);
  }
  return out;
};

/**
 * Comparable content of a block: type, data and tunes, never the id. Built-in
 * tunes at their default value (the editor writes `alignmentTune: left`,
 * `textVariant: ''` and `indentTune: 0` on every block, stored content has
 * none) and unset data leaves do not count (`diffTunes` of shared/diff.mjs).
 * @param {{ type?: string, data?: unknown, tunes?: unknown }|null} block - Block.
 * @returns {string} Canonical JSON.
 */
export const blockContentKey = (block) =>
  block && typeof block === 'object'
    ? canonicalJson({
        type: block.type,
        data: withoutUnset(block.data || {}),
        tunes: diffTunes({}, block.tunes).map((change) => [change.tune, change.after]),
      })
    : '';

/**
 * Hash of a block's content (type, data, tunes), used as `baseHash`.
 * @param {{ type?: string, data?: unknown, tunes?: unknown }|null} block - Block.
 * @returns {string|null} Hash, or null without a block.
 */
export const blockHash = (block) =>
  block && typeof block === 'object' ? cyrb53(blockContentKey(block)) : null;

/**
 * Block of a proposal as stored: id, type, data and tunes only.
 * @param {{ id: string, type: string, data?: object, tunes?: object }} block - Block.
 * @param {string} id - Id to use.
 * @returns {{ id: string, type: string, data: object, tunes?: object }} Block.
 */
const proposalOf = (block, id) => {
  const out = { id, type: block.type, data: block.data || {} };
  if (block.tunes && typeof block.tunes === 'object' && Object.keys(block.tunes).length)
    out.tunes = block.tunes;
  return out;
};

/**
 * Turns the difference between the base the user started from and their
 * edited copy into suggestions, one per changed, inserted or deleted block
 * (block alignment of `diffDocuments`: by id, then by similarity).
 *
 * - changed (also moved and changed): `update` of the base block with the edited content;
 * - added: `insert` after the block before it in the edited copy (another inserted block or a
 *   base block; null = at the start);
 * - removed: `delete`;
 * - moved without a change: not suggested (block order is not part of a suggestion), counted.
 * @param {unknown} base - Content when suggest mode started.
 * @param {unknown} edited - The user's edited copy.
 * @param {{ hash?: (block: object) => string|null }} [options] - Block hash (default `blockHash`; the admin
 *   hashes normalised blocks).
 * @returns {{ suggestions: Array<{ op: 'update'|'insert'|'delete', blockId: string, afterBlockId?: string|null, proposed?: object, baseHash?: string|null }>, moved: number }}
 *   Suggestions in document order and the number of reorders left out.
 */
export const suggestionsFromDiff = (base, edited, { hash = blockHash } = {}) => {
  const entries = diffDocuments(base, edited);
  const suggestions = [];
  let moved = 0;
  // The block before each edited block, in the edited copy's order.
  const editedBlocks = edited && Array.isArray(edited.blocks) ? edited.blocks : [];
  const previous = new Map();
  editedBlocks.forEach((block, index) => {
    if (block && typeof block.id === 'string')
      previous.set(block.id, index > 0 ? editedBlocks[index - 1].id || null : null);
  });
  for (const entry of entries) {
    if (entry.op === 'equal') continue;
    if (entry.op === 'removed') {
      suggestions.push({ op: 'delete', blockId: entry.before.id, baseHash: hash(entry.before) });
      continue;
    }
    if (entry.op === 'added') {
      suggestions.push({
        op: 'insert',
        blockId: entry.after.id,
        afterBlockId: previous.has(entry.after.id) ? previous.get(entry.after.id) : null,
        proposed: proposalOf(entry.after, entry.after.id),
      });
      continue;
    }
    const changed = entry.op === 'changed' || (entry.op === 'moved' && entry.changed);
    if (entry.op === 'moved' && !entry.changed) {
      moved += 1;
      continue;
    }
    if (changed && blockContentKey(entry.before) !== blockContentKey(entry.after)) {
      // A block paired by similarity (new id) still updates the base block.
      suggestions.push({
        op: 'update',
        blockId: entry.before.id,
        proposed: proposalOf(entry.after, entry.before.id),
        baseHash: hash(entry.before),
      });
    }
  }
  return { suggestions, moved };
};

/**
 * State of an open suggestion against the content the reviewer sees now.
 *
 * - `open`: the block is as it was when the change was suggested (insert: its anchor exists);
 * - `outdated`: the block changed since (insert: the anchor is gone); accepting overwrites it;
 * - `applied`: the content already equals the proposal (insert: a block with that id exists);
 * - `missing`: the block is gone (update, delete); it can only be rejected.
 * @param {{ op: string, blockId: string, afterBlockId?: string|null, proposed?: object|null, baseHash?: string|null }} suggestion - Suggestion.
 * @param {unknown} current - Current content.
 * @param {{ hash?: (block: object) => string|null, pendingInserts?: Map<string, string|null> }} [options] - Hash and
 *   the anchors of other open inserts (an insert after a block that another open insert adds is not outdated).
 * @returns {'open'|'outdated'|'applied'|'missing'} State.
 */
export const suggestionState = (
  suggestion,
  current,
  { hash = blockHash, pendingInserts = new Map() } = {}
) => {
  const blocks = current && Array.isArray(current.blocks) ? current.blocks : [];
  const block = blocks.find((item) => item && item.id === suggestion.blockId) || null;
  if (suggestion.op === 'insert') {
    if (block) return 'applied';
    return resolveAnchor(suggestion.afterBlockId, blocks, pendingInserts).found ? 'open' : 'outdated';
  }
  if (!block) return 'missing';
  if (suggestion.op === 'delete') return hash(block) === suggestion.baseHash ? 'open' : 'outdated';
  const now = hash(block);
  if (suggestion.proposed && now === hash(suggestion.proposed)) return 'applied';
  return now === suggestion.baseHash ? 'open' : 'outdated';
};

/**
 * Finds where an insert goes: its anchor block, or, when the anchor is a block
 * another open insert adds, that insert's anchor (and so on).
 * @param {string|null|undefined} anchor - `afterBlockId`.
 * @param {Array<{ id: string }>} blocks - Current blocks.
 * @param {Map<string, string|null>} pendingInserts - Block id of an open insert -> its `afterBlockId`.
 * @returns {{ found: boolean, index: number }} Index of the block to insert after (-1 = at the start).
 */
export const resolveAnchor = (anchor, blocks, pendingInserts = new Map()) => {
  let id = anchor || null;
  const seen = new Set();
  while (id) {
    const index = blocks.findIndex((block) => block && block.id === id);
    if (index !== -1) return { found: true, index };
    if (!pendingInserts.has(id) || seen.has(id)) return { found: false, index: blocks.length - 1 };
    seen.add(id);
    id = pendingInserts.get(id) || null;
  }
  return { found: true, index: -1 };
};

/**
 * Applies accepted suggestions to a document (pure; the editor then shows the
 * result through its normal whole-document path). Suggestions apply in the
 * given order; one that cannot apply (`missing` block, insert of an id that
 * exists) is skipped and reported.
 * @param {{ blocks: object[] }} document - Current content.
 * @param {Array<{ id?: string, op: string, blockId: string, afterBlockId?: string|null, proposed?: object|null }>} list - Suggestions.
 * @param {{ pendingInserts?: Map<string, string|null> }} [options] - Anchors of other open inserts.
 * @returns {{ data: object, applied: string[], skipped: string[] }} New content and the ids (or block ids) applied and skipped.
 */
export const applySuggestions = (document, list, { pendingInserts = new Map() } = {}) => {
  const blocks = document && Array.isArray(document.blocks) ? [...document.blocks] : [];
  const applied = [];
  const skipped = [];
  for (const suggestion of list) {
    const key = suggestion.id || suggestion.blockId;
    const index = blocks.findIndex((block) => block && block.id === suggestion.blockId);
    if (suggestion.op === 'delete') {
      if (index === -1) skipped.push(key);
      else {
        blocks.splice(index, 1);
        applied.push(key);
      }
      continue;
    }
    if (!suggestion.proposed || typeof suggestion.proposed.type !== 'string') {
      skipped.push(key);
      continue;
    }
    const block = proposalOf(suggestion.proposed, suggestion.blockId);
    if (suggestion.op === 'update') {
      if (index === -1) skipped.push(key);
      else {
        blocks[index] = block;
        applied.push(key);
      }
      continue;
    }
    if (index !== -1) {
      skipped.push(key);
      continue;
    }
    const anchor = resolveAnchor(suggestion.afterBlockId, blocks, pendingInserts);
    blocks.splice(anchor.index + 1, 0, block);
    applied.push(key);
  }
  return {
    data: { ...(document && typeof document === 'object' ? document : {}), time: Date.now(), blocks },
    applied,
    skipped,
  };
};

/**
 * Anchors of open inserts (block id -> afterBlockId), for `resolveAnchor`.
 * @param {Array<{ op: string, blockId: string, afterBlockId?: string|null, status?: string }>} list - Suggestions.
 * @returns {Map<string, string|null>} Map.
 */
export const pendingInsertsOf = (list) => {
  const map = new Map();
  for (const suggestion of list || []) {
    if (suggestion && suggestion.op === 'insert' && (!suggestion.status || suggestion.status === 'open'))
      map.set(suggestion.blockId, suggestion.afterBlockId || null);
  }
  return map;
};

/**
 * Open suggestions per block id (for the block markers). An insert counts on
 * the block it goes after (at the start: the first block).
 * @param {Array<{ op: string, blockId: string, afterBlockId?: string|null, status?: string }>} list - Suggestions.
 * @param {string[]} blockIds - Current block ids in order.
 * @returns {Map<string, number>} Counts.
 */
export const openSuggestionsByBlock = (list, blockIds) => {
  const present = new Set(blockIds);
  const pending = pendingInsertsOf(list);
  const counts = new Map();
  for (const suggestion of list || []) {
    if (!suggestion || (suggestion.status && suggestion.status !== 'open')) continue;
    let id = suggestion.blockId;
    // Update or delete of a block that is gone: listed in the panel only.
    if (suggestion.op !== 'insert' && !present.has(id)) continue;
    if (suggestion.op === 'insert') {
      const anchor = resolveAnchor(
        suggestion.op === 'insert' ? suggestion.afterBlockId : null,
        blockIds.map((value) => ({ id: value })),
        pending
      );
      id = anchor.index >= 0 ? blockIds[anchor.index] : blockIds[0];
    }
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
};

/**
 * Block-level and inline diff of two Magic Editor X documents (version
 * history "Changes" view).
 *
 * Blocks are aligned by id first. Blocks whose id exists on both sides but
 * whose relative order changed are reported as moved (everything outside the
 * longest increasing subsequence of matched positions). Blocks without a
 * matching id are paired by type and word similarity, so content that was
 * re-created with a new id (paste, 1.x conversions) still shows as a change
 * instead of a removal plus an addition.
 *
 * Inside a matched block every leaf value is compared by path. Strings that
 * hold inline HTML are compared on their plain text with a word-level LCS;
 * a change of markup only (bold, link) is flagged as `formatting`. Other
 * values are compared as JSON. The result contains plain text and values
 * only and must be rendered as text (never as HTML).
 */

import { normalizeEditorDataSafe } from './editor-data.mjs';
import { inlineToText } from './render/inline.mjs';
import { registeredBlockOf, isBuiltInBlock, BUILT_IN_MARKER } from './sanitize-policy.mjs';

/** Largest number of blocks compared per side. */
export const MAX_DIFF_BLOCKS = 5000;
/** Above this many tokens per side a field is shown as replaced instead of word-diffed. */
export const MAX_DIFF_TOKENS = 2000;
/** Unmatched blocks per side above which the similarity pairing is skipped. */
const MAX_SIMILARITY_CANDIDATES = 400;
/** Minimum word similarity (Jaccard) for pairing blocks without a common id. */
const MIN_SIMILARITY = 0.5;
const MAX_DEPTH = 24;

/** Block types whose strings are plain text, not inline HTML. */
const PLAIN_TYPES = new Set(['code', 'codeFlask', 'raw', 'toc']);
/** Keys holding plain text in otherwise inline blocks. */
const PLAIN_KEYS = new Set([
  'name',
  'description',
  'language',
  'service',
  'style',
  'status',
  'type',
  'align',
]);
/** Keys holding URLs or identifiers: compared as values. */
const VALUE_KEY = /^(url|href|link|src|photo|source|embed|id|documentId|mime|hash|ext|fk)$/i;
/** Enumeration and file keys of the 2.3 media blocks: compared as values, not text. */
const MEDIA_TYPES = new Set(['gallery', 'video', 'audio']);
const MEDIA_VALUE_KEY = /^(layout|kind|srclang|name)$/;

/**
 * Reads the blocks of any stored value.
 * @param {unknown} value - Editor data (any stored shape).
 * @returns {Array<{ id: string, type: string, data: object, tunes?: object }>} Blocks (bounded).
 */
const blocksOf = (value) => {
  const data = normalizeEditorDataSafe(value);
  return data && Array.isArray(data.blocks) ? data.blocks.slice(0, MAX_DIFF_BLOCKS) : [];
};

/**
 * Flattens a value into `[path, leaf]` pairs (objects by sorted key, arrays by index).
 * @param {unknown} value - Value.
 * @param {string} prefix - Path so far.
 * @param {Map<string, unknown>} out - Collector.
 * @param {number} depth - Depth.
 * @returns {Map<string, unknown>} The collector.
 */
const flatten = (value, prefix, out, depth = 0) => {
  if (depth > MAX_DEPTH) return out;
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, []);
    value.forEach((item, index) =>
      flatten(item, prefix ? `${prefix}.${index}` : String(index), out, depth + 1)
    );
    return out;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) out.set(prefix, {});
    for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out, depth + 1);
    return out;
  }
  out.set(prefix, value);
  return out;
};

/**
 * How a leaf is compared.
 * @param {{ type: string, data?: unknown }} block - Block the leaf belongs to.
 * @param {string} path - Leaf path inside `data`.
 * @param {unknown} value - Leaf value (one side).
 * @returns {'inline'|'plain'|'value'} Kind.
 */
const leafKind = (block, path, value) => {
  if (typeof value !== 'string') return 'value';
  // Code-registered blocks (custom block SDK): the kind comes from their schema.
  const definition = registeredBlockOf(block);
  if (definition) return definition.kindOf(path);
  // Custom block data under a name 2.3 gave to a built-in block: no built-in rules.
  const type = isBuiltInBlock(block) ? block.type : '';
  const key =
    path
      .split('.')
      .filter((part) => !/^\d+$/.test(part))
      .pop() || '';
  if (VALUE_KEY.test(key)) return 'value';
  // Synced block (2.3): the reference is an id; the diff view shows the source name.
  if (type === 'synced' && key === 'ref') return 'value';
  if (MEDIA_TYPES.has(type) && MEDIA_VALUE_KEY.test(key)) return 'value';
  if (PLAIN_TYPES.has(type) || PLAIN_KEYS.has(key)) return 'plain';
  return 'inline';
};

/**
 * Plain text of a leaf for display and comparison.
 * @param {unknown} value - Leaf.
 * @param {'inline'|'plain'|'value'} kind - Kind.
 * @returns {string} Text.
 */
const textOf = (value, kind) => {
  if (value === undefined) return '';
  if (kind === 'inline') return inlineToText(value);
  if (kind === 'plain') return String(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/**
 * Splits text into words and whitespace runs.
 * @param {string} text - Text.
 * @returns {string[]} Tokens.
 */
const tokenize = (text) => (text ? text.split(/(\s+)/).filter((token) => token !== '') : []);

/**
 * Appends an op, merging with the previous one of the same kind.
 * @param {Array<{ op: string, text: string }>} ops - Ops.
 * @param {'equal'|'insert'|'delete'} op - Kind.
 * @param {string} text - Text.
 */
const push = (ops, op, text) => {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += text;
  else ops.push({ op, text });
};

/**
 * Word-level diff of two texts (LCS). Long texts are reported as a whole replacement.
 * @param {string} before - Old text.
 * @param {string} after - New text.
 * @returns {Array<{ op: 'equal'|'insert'|'delete', text: string }>} Ops in reading order.
 */
export const diffText = (before, after) => {
  const ops = [];
  if (before === after) {
    push(ops, 'equal', before);
    return ops;
  }
  const a = tokenize(before);
  const b = tokenize(after);
  // Common prefix and suffix are cheap and keep the LCS table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head = a.slice(0, start).join('');
  const tail = a.slice(endA).join('');
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  push(ops, 'equal', head);
  if (midA.length > MAX_DIFF_TOKENS || midB.length > MAX_DIFF_TOKENS) {
    push(ops, 'delete', midA.join(''));
    push(ops, 'insert', midB.join(''));
  } else {
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i][j] =
          midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push(ops, 'equal', midA[i]);
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        push(ops, 'delete', midA[i]);
        i += 1;
      } else {
        push(ops, 'insert', midB[j]);
        j += 1;
      }
    }
    while (i < n) push(ops, 'delete', midA[i++]);
    while (j < m) push(ops, 'insert', midB[j++]);
  }
  push(ops, 'equal', tail);
  return ops;
};

/**
 * JSON text of a value with object keys sorted at every level, so two values
 * that differ only in key order give the same text.
 * @param {unknown} value - Value.
 * @param {number} [depth] - Depth (bounded).
 * @returns {string} Canonical JSON.
 */
export const canonicalJson = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
};

/**
 * Deep equality that ignores object key order.
 * @param {unknown} a - Value.
 * @param {unknown} b - Value.
 * @returns {boolean} Whether both are equal.
 */
export const canonicalEqual = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Built-in tunes: how to read their value and the value that means "not set". */
const KNOWN_TUNES = {
  alignmentTune: {
    read: (value) =>
      value && typeof value === 'object' && typeof value.alignment === 'string' ? value.alignment : 'left',
    fallback: 'left',
  },
  textVariant: { read: (value) => (typeof value === 'string' ? value : ''), fallback: '' },
  indentTune: {
    read: (value) =>
      value && typeof value === 'object' && Number.isFinite(value.indentLevel) ? value.indentLevel : 0,
    fallback: 0,
  },
};

/**
 * Compares block tunes tune by tune. Key order does not matter and a missing
 * built-in tune equals its default value (stored content has no tunes, the
 * editor writes the defaults on every block).
 * @param {object|undefined} before - Old tunes.
 * @param {object|undefined} after - New tunes.
 * @returns {Array<{ tune: string, before: string|number|null, after: string|number|null, known: boolean }>} Changed tunes; built-in values are plain (alignment name, variant name, indent level), others canonical JSON.
 */
export const diffTunes = (before, after) => {
  const left = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const right = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  const names = [...new Set([...Object.keys(KNOWN_TUNES), ...Object.keys(left), ...Object.keys(right)])];
  const changes = [];
  for (const name of names.sort()) {
    const known = Object.prototype.hasOwnProperty.call(KNOWN_TUNES, name);
    if (known) {
      const a =
        left[name] === undefined || left[name] === null
          ? KNOWN_TUNES[name].fallback
          : KNOWN_TUNES[name].read(left[name]);
      const b =
        right[name] === undefined || right[name] === null
          ? KNOWN_TUNES[name].fallback
          : KNOWN_TUNES[name].read(right[name]);
      if (a !== b) changes.push({ tune: name, before: a, after: b, known: true });
      continue;
    }
    const a = left[name] === undefined ? null : canonicalJson(left[name]);
    const b = right[name] === undefined ? null : canonicalJson(right[name]);
    if (a !== b) changes.push({ tune: name, before: a, after: b, known: false });
  }
  return changes;
};

/**
 * Compares two blocks leaf by leaf.
 * @param {object} before - Old block.
 * @param {object} after - New block.
 * @returns {Array<object>} Changed fields (empty when equal).
 */
const diffFields = (before, after) => {
  const fields = [];
  if (before.type !== after.type) {
    fields.push({ path: 'type', kind: 'value', before: before.type, after: after.type });
  }
  const left = flatten(before.data || {}, '', new Map());
  const right = flatten(after.data || {}, '', new Map());
  const paths = [...new Set([...left.keys(), ...right.keys()])];
  for (const path of paths) {
    const a = left.get(path);
    const b = right.get(path);
    if (canonicalEqual(a, b)) continue;
    // The built-in marker is not content (added when a 2.3 block is saved again).
    if (path === BUILT_IN_MARKER && before.type === after.type && isBuiltInBlock(after)) continue;
    const kind = leafKind(after, path, b === undefined ? a : b);
    if (
      kind === 'value' ||
      (typeof a !== 'string' && a !== undefined) ||
      (typeof b !== 'string' && b !== undefined)
    ) {
      fields.push({ path: path || 'data', kind: 'value', before: a, after: b });
      continue;
    }
    const textA = textOf(a, kind);
    const textB = textOf(b, kind);
    const field = { path, kind: 'text', ops: diffText(textA, textB) };
    if (textA === textB) field.formatting = true;
    fields.push(field);
  }
  const tuneChanges = diffTunes(before.tunes, after.tunes);
  if (tuneChanges.length > 0) fields.push({ path: 'tunes', kind: 'tunes', changes: tuneChanges });
  return fields;
};

/**
 * Plain text of a whole block (for similarity and display).
 * @param {object} block - Block.
 * @returns {string} Text.
 */
export const blockText = (block) => {
  if (!block) return '';
  const parts = [];
  for (const [path, value] of flatten(block.data || {}, '', new Map())) {
    if (typeof value !== 'string') continue;
    const kind = leafKind(block, path, value);
    if (kind !== 'value') parts.push(textOf(value, kind));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

/**
 * Word-set similarity (Jaccard) of two texts.
 * @param {Set<string>} a - Words.
 * @param {Set<string>} b - Words.
 * @returns {number} 0..1.
 */
const similarity = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / (a.size + b.size - common);
};

const wordsOf = (block) => new Set(blockText(block).toLowerCase().split(/\s+/).filter(Boolean));

/**
 * Indexes (into `sequence`) of a longest strictly increasing subsequence.
 * @param {number[]} sequence - Values.
 * @returns {Set<number>} Positions that stay in place.
 */
const longestIncreasing = (sequence) => {
  const tails = [];
  const tailIndex = [];
  const previous = new Array(sequence.length).fill(-1);
  sequence.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
    tailIndex[low] = index;
    previous[index] = low > 0 ? tailIndex[low - 1] : -1;
  });
  const keep = new Set();
  let cursor = tailIndex[tails.length - 1];
  while (cursor !== undefined && cursor !== -1) {
    keep.add(cursor);
    cursor = previous[cursor];
  }
  return keep;
};

/**
 * Diffs two documents.
 * @param {unknown} before - Older document (any stored shape).
 * @param {unknown} after - Newer document (any stored shape).
 * @returns {Array<{ op: 'equal'|'added'|'removed'|'changed'|'moved', id: string, type: string, before?: object, after?: object, fields?: object[], changed?: boolean, formattingOnly?: boolean, beforeIndex?: number, afterIndex?: number }>} Entries in display order (new order, removed blocks at their old place).
 */
export const diffDocuments = (before, after) => {
  const oldBlocks = blocksOf(before);
  const newBlocks = blocksOf(after);
  const oldById = new Map();
  oldBlocks.forEach((block, index) => {
    if (!oldById.has(block.id)) oldById.set(block.id, index);
  });
  const pairOfNew = new Array(newBlocks.length).fill(-1);
  const pairedOld = new Set();
  newBlocks.forEach((block, index) => {
    const oldIndex = oldById.get(block.id);
    if (oldIndex !== undefined && !pairedOld.has(oldIndex)) {
      pairOfNew[index] = oldIndex;
      pairedOld.add(oldIndex);
    }
  });

  // Similarity pairing for blocks without a common id (same type only).
  const freeOld = oldBlocks.map((_, index) => index).filter((index) => !pairedOld.has(index));
  const freeNew = newBlocks.map((_, index) => index).filter((index) => pairOfNew[index] === -1);
  if (
    freeOld.length > 0 &&
    freeNew.length > 0 &&
    freeOld.length <= MAX_SIMILARITY_CANDIDATES &&
    freeNew.length <= MAX_SIMILARITY_CANDIDATES
  ) {
    const oldWords = new Map(freeOld.map((index) => [index, wordsOf(oldBlocks[index])]));
    for (const newIndex of freeNew) {
      const words = wordsOf(newBlocks[newIndex]);
      let best = -1;
      let bestScore = MIN_SIMILARITY - 1e-9;
      for (const oldIndex of freeOld) {
        if (pairedOld.has(oldIndex) || oldBlocks[oldIndex].type !== newBlocks[newIndex].type) continue;
        const score = similarity(oldWords.get(oldIndex), words);
        if (score > bestScore) {
          best = oldIndex;
          bestScore = score;
        }
      }
      if (best !== -1) {
        pairOfNew[newIndex] = best;
        pairedOld.add(best);
      }
    }
  }

  // Matched blocks outside the longest increasing run of old positions were moved.
  const matched = [];
  pairOfNew.forEach((oldIndex, newIndex) => {
    if (oldIndex !== -1) matched.push(newIndex);
  });
  const stay = longestIncreasing(matched.map((newIndex) => pairOfNew[newIndex]));
  const inPlace = new Set([...stay].map((position) => matched[position]));

  const entries = [];
  let nextOld = 0;
  /** Emits removed old blocks up to (not including) `limit`. */
  const flushRemoved = (limit) => {
    for (; nextOld < limit; nextOld += 1) {
      if (!pairedOld.has(nextOld)) {
        const block = oldBlocks[nextOld];
        entries.push({ op: 'removed', id: block.id, type: block.type, before: block, beforeIndex: nextOld });
      }
    }
  };
  // Old position of the next block that stays in place, for every new index:
  // removed blocks are listed before additions and moves at the same spot.
  const nextAnchor = new Array(newBlocks.length + 1).fill(oldBlocks.length);
  for (let index = newBlocks.length - 1; index >= 0; index -= 1) {
    nextAnchor[index] = inPlace.has(index) ? pairOfNew[index] : nextAnchor[index + 1];
  }
  newBlocks.forEach((block, newIndex) => {
    const oldIndex = pairOfNew[newIndex];
    if (!inPlace.has(newIndex)) flushRemoved(nextAnchor[newIndex]);
    if (oldIndex === -1) {
      entries.push({ op: 'added', id: block.id, type: block.type, after: block, afterIndex: newIndex });
      return;
    }
    if (inPlace.has(newIndex)) flushRemoved(oldIndex + 1);
    const old = oldBlocks[oldIndex];
    const fields = diffFields(old, block);
    const changed = fields.length > 0;
    const entry = {
      op: inPlace.has(newIndex) ? (changed ? 'changed' : 'equal') : 'moved',
      id: block.id,
      type: block.type,
      before: old,
      after: block,
      beforeIndex: oldIndex,
      afterIndex: newIndex,
    };
    if (changed) {
      entry.fields = fields;
      entry.formattingOnly = fields.every((field) => field.formatting === true);
    }
    if (entry.op === 'moved') entry.changed = changed;
    entries.push(entry);
  });
  flushRemoved(oldBlocks.length);
  return entries;
};

/**
 * Counts diff entries.
 * @param {ReturnType<typeof diffDocuments>} entries - Diff.
 * @returns {{ added: number, removed: number, changed: number, moved: number, equal: number }} Counts (a moved and edited block counts as moved and changed).
 */
export const summarizeDiff = (entries) => {
  const counts = { added: 0, removed: 0, changed: 0, moved: 0, equal: 0 };
  for (const entry of entries || []) {
    if (entry.op in counts) counts[entry.op] += 1;
    if (entry.op === 'moved' && entry.changed) counts.changed += 1;
  }
  return counts;
};

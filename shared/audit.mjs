/**
 * Audit trail (2.4): pure helpers shared by the server and the admin.
 *
 * An audit record says who changed what and when, never the content: event
 * name, target (content type, document, locale, field identity), small
 * integer counts, at most `MAX_BLOCK_IDS` Editor.js block ids and a few
 * identifier-like `meta` values (an AI action name, the top-level settings
 * keys that changed, a comment thread id). `cleanAuditInput` enforces that
 * shape, so no caller can store text by accident.
 *
 * `fieldChanges(before, after)` compares two stored field values by block id
 * and a JSON fingerprint of each block (no word diff): linear in the number
 * of blocks, about the cost of one `JSON.stringify` of both documents.
 */

import { normalizeEditorDataSafe, isPlainObject } from './editor-data.mjs';
import { fieldIdentity as identityOf } from './field-identity.mjs';

/** Block ids kept per record. */
export const MAX_BLOCK_IDS = 20;
/** Largest page size of the audit listing. */
export const MAX_AUDIT_PAGE_SIZE = 100;

/**
 * Events the plugin records. Other features may record their own events
 * (`<area>.<verb>`, see `AUDIT_EVENT_PATTERN`); the admin shows unknown
 * names as they are.
 */
export const AUDIT_EVENTS = Object.freeze([
  'entry.create',
  'entry.update',
  'entry.publish',
  'entry.unpublish',
  'entry.discard',
  'entry.delete',
  'version.create',
  'version.restore',
  'version.rename',
  'ai.action',
  'comment.create',
  'comment.reply',
  'comment.resolve',
  'comment.reopen',
  'comment.delete',
  'comment.moderate',
  'template.create',
  'template.update',
  'template.delete',
  'synced.create',
  'synced.update',
  'synced.delete',
  'synced.restore',
  'settings.update',
  'linkcheck.run',
]);

/** Event names: `area.verb`, lower case. */
export const AUDIT_EVENT_PATTERN = /^[a-z][a-z0-9-]{0,30}\.[a-z][a-z0-9-]{0,30}$/;
/** Editor.js block ids as the sanitiser keeps them. */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Identifier-like meta values (no spaces, no markup). */
export const META_VALUE_PATTERN = /^[A-Za-z0-9_.:-]{0,64}$/;
const META_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;
const COUNT_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;
const MAX_COUNT_KEYS = 12;
const MAX_META_KEYS = 8;
const MAX_META_LIST = 20;
const MAX_COUNT = 1_000_000_000;
const UID_PATTERN = /^(api|plugin|admin)::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/;
const DOCUMENT_ID_PATTERN = /^[a-z0-9]{1,64}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/;
/** Field identities: dotted paths, optionally `#<fieldKey>` (positional fields). */
export const FIELD_IDENTITY_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]{0,79}(\.(\d{1,4}|[A-Za-z_][A-Za-z0-9_]{0,79})){0,8}(#[A-Za-z0-9_-]{1,64})?$/;

/**
 * True when a field path contains a list index (repeatable component or
 * dynamic zone entry), so the position does not identify the field.
 * @param {string} path - Dotted path.
 * @returns {boolean} Result.
 */
export const isPositionalPath = (path) =>
  typeof path === 'string' && path.split('.').some((part) => /^\d+$/.test(part));

/**
 * The identity under which rows keyed by field are stored (2.4 field
 * identity contract): the path for top-level fields and fields in single
 * components; for positional fields the path without indices plus
 * `#<fieldKey>` when the stored value carries a `fieldKey`. A positional
 * field without a key keeps its positional path (it names the entry the
 * change was made in at that moment). This is the ONE place that decides
 * it for the audit trail.
 * @param {string} path - Field path (`body`, `sections.0.body`).
 * @param {unknown} [value] - Stored value (for its `fieldKey`).
 * @returns {string} Identity.
 */
export const fieldIdentity = (path, value) => {
  if (!isPositionalPath(path)) return path;
  const key = isPlainObject(value) && typeof value.fieldKey === 'string' ? value.fieldKey : null;
  // One rule for every field-keyed row (2.4): `shared/field-identity.mjs`.
  return identityOf(path, key) || path;
};

/**
 * Blocks of a stored value with their fingerprint.
 * @param {unknown} value - Stored field value.
 * @returns {{ ids: string[], prints: Map<string, string> }} Ids in order and fingerprints by id.
 */
const fingerprints = (value) => {
  const data = isPlainObject(value) && Array.isArray(value.blocks) ? value : normalizeEditorDataSafe(value);
  const ids = [];
  const prints = new Map();
  const blocks = data && Array.isArray(data.blocks) ? data.blocks : [];
  blocks.forEach((block, index) => {
    if (!isPlainObject(block)) return;
    let id = typeof block.id === 'string' && block.id ? block.id : `#${index}`;
    if (prints.has(id)) id = `${id}#${index}`;
    let print;
    try {
      print = `${block.type}\u0000${JSON.stringify(block.data ?? null)}\u0000${JSON.stringify(block.tunes ?? null)}`;
    } catch {
      print = `${block.type}\u0000${index}`;
    }
    ids.push(id);
    prints.set(id, print);
  });
  return { ids, prints };
};

/**
 * Length of the longest strictly increasing subsequence (O(n log n)).
 * @param {number[]} values - Sequence.
 * @returns {number} Length.
 */
const lisLength = (values) => {
  const tails = [];
  for (const value of values) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
  }
  return tails.length;
};

/**
 * Counts what changed between two stored values of one field: blocks
 * added, removed, changed (same id, different type/data/tunes) and moved
 * (same id, outside the longest run of unchanged relative order), plus up
 * to `maxIds` block ids (changed first, then added, then removed). Never
 * returns content.
 * @param {unknown} before - Earlier value (null for none).
 * @param {unknown} after - Later value (null for none).
 * @param {{ maxIds?: number }} [options] - Bounds.
 * @returns {{ counts: { added: number, removed: number, changed: number, moved: number, blocks: number }, blockIds: string[], changed: boolean }} Summary.
 */
export const fieldChanges = (before, after, { maxIds = MAX_BLOCK_IDS } = {}) => {
  const a = fingerprints(before);
  const b = fingerprints(after);
  const addedIds = [];
  const changedIds = [];
  const commonOrder = [];
  const beforeIndex = new Map(a.ids.map((id, index) => [id, index]));
  for (const id of b.ids) {
    if (!a.prints.has(id)) addedIds.push(id);
    else {
      commonOrder.push(beforeIndex.get(id));
      if (a.prints.get(id) !== b.prints.get(id)) changedIds.push(id);
    }
  }
  const removedIds = a.ids.filter((id) => !b.prints.has(id));
  const moved = commonOrder.length - lisLength(commonOrder);
  const blockIds = [];
  for (const id of [...changedIds, ...addedIds, ...removedIds]) {
    if (blockIds.length >= maxIds) break;
    if (BLOCK_ID_PATTERN.test(id)) blockIds.push(id);
  }
  const counts = {
    added: addedIds.length,
    removed: removedIds.length,
    changed: changedIds.length,
    moved,
    blocks: b.ids.length,
  };
  return {
    counts,
    blockIds,
    changed: counts.added + counts.removed + counts.changed + counts.moved > 0,
  };
};

/**
 * Validates and bounds the input of `audit.record`. Returns null for input
 * that cannot be recorded (unknown shape); never throws.
 * @param {unknown} input - `{ event, target?, counts?, blockIds?, meta? }`.
 * @returns {{ event: string, uid: string|null, documentId: string|null, locale: string|null, field: string|null, counts: Record<string, number>, blockIds: string[], meta: Record<string, string|string[]> }|null} Clean record parts.
 */
export const cleanAuditInput = (input) => {
  if (!isPlainObject(input) || typeof input.event !== 'string' || !AUDIT_EVENT_PATTERN.test(input.event))
    return null;
  const target = isPlainObject(input.target) ? input.target : {};
  const pick = (value, pattern) => (typeof value === 'string' && pattern.test(value) ? value : null);
  const counts = {};
  if (isPlainObject(input.counts)) {
    for (const [key, value] of Object.entries(input.counts)) {
      if (Object.keys(counts).length >= MAX_COUNT_KEYS) break;
      if (!COUNT_KEY_PATTERN.test(key) || !Number.isInteger(value) || value < 0) continue;
      counts[key] = Math.min(value, MAX_COUNT);
    }
  }
  const blockIds = Array.isArray(input.blockIds)
    ? [...new Set(input.blockIds.filter((id) => typeof id === 'string' && BLOCK_ID_PATTERN.test(id)))].slice(
        0,
        MAX_BLOCK_IDS
      )
    : [];
  const meta = {};
  if (isPlainObject(input.meta)) {
    for (const [key, value] of Object.entries(input.meta)) {
      if (Object.keys(meta).length >= MAX_META_KEYS || !META_KEY_PATTERN.test(key)) continue;
      if (typeof value === 'string' && META_VALUE_PATTERN.test(value)) meta[key] = value;
      else if (Array.isArray(value))
        meta[key] = value
          .filter((item) => typeof item === 'string' && META_VALUE_PATTERN.test(item))
          .slice(0, MAX_META_LIST);
    }
  }
  return {
    event: input.event,
    uid: pick(target.uid, UID_PATTERN),
    documentId: pick(target.documentId, DOCUMENT_ID_PATTERN),
    locale: pick(target.locale, LOCALE_PATTERN),
    field: pick(target.field, FIELD_IDENTITY_PATTERN),
    counts,
    blockIds,
    meta,
  };
};

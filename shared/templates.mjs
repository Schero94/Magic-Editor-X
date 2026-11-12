/**
 * Templates and block patterns (2.3): pure rules shared by the server (scope
 * matching on the list route), the admin (insertion into a field) and the
 * tests. No dependencies besides the field preset rules.
 *
 * - A **template** is whole starting content; it is applied to an empty field
 *   (or replaces the content after a confirmation).
 * - A **pattern** is a sequence of blocks inserted after the current block.
 *
 * Scope: `{ all: true }` offers the template in every Magic Editor X field;
 * otherwise it is offered where the field's preset name is in `presets` or
 * the field is listed in `fields` (`{ uid, field }`, field path without
 * component/zone indices, as `sections.body`).
 */

import { isPlainObject } from './editor-data.mjs';
import { checkBlockStructure, fixPresetViolations, isBlockAllowed, PRESET_NAMES } from './presets.mjs';

export const TEMPLATE_KINDS = Object.freeze(['template', 'pattern']);

/** Bounds of one template (enforced on the server; the admin checks them before sending). */
export const TEMPLATE_LIMITS = Object.freeze({
  name: 100,
  description: 500,
  blocks: 200,
  bytes: 256 * 1024,
  scopeFields: 100,
  templates: 500,
});

/** Field path of a scope entry: dotted attribute names, no indices. */
export const SCOPE_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,79}(\.[A-Za-z_][A-Za-z0-9_]{0,79}){0,8}$/;

/**
 * Field path without component and dynamic zone indices (`sections.0.body` -> `sections.body`).
 * @param {unknown} path - Field path.
 * @returns {string} Path used in template scopes.
 */
export const scopeFieldOf = (path) =>
  String(path || '')
    .split('.')
    .filter((part) => part && !/^\d+$/.test(part))
    .join('.');

/**
 * Normalised scope (unknown keys and invalid entries dropped, duplicates removed).
 * @param {unknown} scope - Stored or submitted scope.
 * @returns {{ all: boolean, presets: string[], fields: Array<{ uid: string, field: string }> }} Scope.
 */
export const normalizeScope = (scope) => {
  const source = isPlainObject(scope) ? scope : {};
  const presets = Array.isArray(source.presets)
    ? [...new Set(source.presets.filter((name) => PRESET_NAMES.includes(name)))]
    : [];
  const seen = new Set();
  const fields = [];
  for (const entry of Array.isArray(source.fields) ? source.fields : []) {
    if (!isPlainObject(entry) || typeof entry.uid !== 'string' || typeof entry.field !== 'string') continue;
    if (!/^api::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/.test(entry.uid)) continue;
    if (!SCOPE_FIELD_PATTERN.test(entry.field)) continue;
    const key = `${entry.uid}|${entry.field}`;
    if (seen.has(key) || fields.length >= TEMPLATE_LIMITS.scopeFields) continue;
    seen.add(key);
    fields.push({ uid: entry.uid, field: entry.field });
  }
  const all = source.all === true || (source.all !== false && presets.length === 0 && fields.length === 0);
  return { all, presets: all ? [] : presets, fields: all ? [] : fields };
};

/**
 * Whether a template is offered in a field.
 * @param {unknown} scope - Template scope.
 * @param {{ uid: string, field: string, presetName: string }} target - The field (`field` may contain indices).
 * @returns {boolean} True when the scope covers the field.
 */
export const templateMatchesTarget = (scope, target) => {
  const clean = normalizeScope(scope);
  if (clean.all) return true;
  if (!target || typeof target.uid !== 'string') return false;
  if (clean.presets.includes(target.presetName)) return true;
  const field = scopeFieldOf(target.field);
  return clean.fields.some((entry) => entry.uid === target.uid && entry.field === field);
};

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * A new Editor.js-style block id (10 characters from crypto random values).
 * @returns {string} Id.
 */
export const newBlockId = () => {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET[byte & 63];
  return id;
};

/**
 * @typedef {object} InsertionPlan
 * @property {Array<{ id: string, type: string, data: object, tunes?: object }>} blocks - Blocks to insert, with fresh ids.
 * @property {Array<{ type: string, count: number }>} omitted - Blocks left out because the field does not allow their type (or they cannot be fixed).
 * @property {number} adjusted - Blocks changed to fit the field (heading level, links).
 * @property {number} truncated - Blocks left out because of the field's block limit.
 */

/**
 * Prepares template blocks for insertion into a field: blocks of types the
 * preset does not allow are left out, heading levels and links are fixed the
 * way "Fix automatically" fixes them, the block limit is respected and every
 * block gets a fresh id (no clash with the field's blocks, live collaboration
 * treats them as new).
 * @param {Array<{ id?: string, type: string, data: object, tunes?: object }>} blocks - Template blocks (normalised and sanitised).
 * @param {import('./presets.mjs').FieldPreset|null} preset - Field preset (null = every block allowed).
 * @param {{ existingCount?: number, existingIds?: Iterable<string>, idFactory?: () => string }} [options] - Blocks already in the field (count after the insertion point is irrelevant; the limit counts the whole field).
 * @returns {InsertionPlan} Plan.
 */
export const prepareInsertion = (blocks, preset, options = {}) => {
  const { existingCount = 0, existingIds = [], idFactory = newBlockId } = options;
  const taken = new Set(existingIds);
  const omittedByType = new Map();
  const omit = (type) => omittedByType.set(type, (omittedByType.get(type) || 0) + 1);
  const kept = [];
  let adjusted = 0;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block.type !== 'string' || !isPlainObject(block.data)) continue;
    if (preset && !isBlockAllowed(preset, block.type)) {
      omit(block.type);
      continue;
    }
    let next = block;
    if (preset && checkBlockStructure(preset, block)) {
      const fixed = fixPresetViolations({ blocks: [block] }, preset).data.blocks[0];
      if (!fixed || checkBlockStructure(preset, fixed)) {
        omit(block.type);
        continue;
      }
      next = fixed;
      adjusted += 1;
    }
    kept.push(next);
  }
  let truncated = 0;
  const max = preset && preset.maxBlocks ? Math.max(0, preset.maxBlocks - existingCount) : Infinity;
  if (kept.length > max) {
    truncated = kept.length - max;
    kept.length = max;
  }
  const out = kept.map((block) => {
    let id = idFactory();
    for (let attempt = 0; taken.has(id) && attempt < 20; attempt += 1) id = idFactory();
    taken.add(id);
    const copy = { id, type: block.type, data: JSON.parse(JSON.stringify(block.data)) };
    if (isPlainObject(block.tunes) && Object.keys(block.tunes).length)
      copy.tunes = JSON.parse(JSON.stringify(block.tunes));
    return copy;
  });
  return {
    blocks: out,
    omitted: [...omittedByType].map(([type, count]) => ({ type, count })),
    adjusted,
    truncated,
  };
};

/**
 * A document with blocks inserted after a position.
 * @param {{ time?: number, version?: string, blocks: Array<object> }|null} doc - Current document.
 * @param {Array<object>} blocks - Blocks to insert.
 * @param {number} afterIndex - Index of the block to insert after (-1 = at the start; past the end = at the end).
 * @returns {{ time: number, version: string, blocks: Array<object> }} New document.
 */
export const insertBlocksAt = (doc, blocks, afterIndex) => {
  const current = doc && Array.isArray(doc.blocks) ? doc.blocks : [];
  const at = Math.min(
    Math.max(Number.isInteger(afterIndex) ? afterIndex + 1 : current.length, 0),
    current.length
  );
  return {
    time: Date.now(),
    version: (doc && doc.version) || '2.31.7',
    blocks: [...current.slice(0, at), ...blocks, ...current.slice(at)],
  };
};

/**
 * True when a document has no meaningful content (no blocks, or only empty paragraphs).
 * @param {{ blocks?: Array<{ type: string, data?: object }> }|null} doc - Document.
 * @returns {boolean} Empty.
 */
export const isEmptyDocument = (doc) =>
  !doc ||
  !Array.isArray(doc.blocks) ||
  doc.blocks.every(
    (block) =>
      block.type === 'paragraph' &&
      String((block.data && block.data.text) || '').replace(/<br\s*\/?>|&nbsp;|\s/g, '') === ''
  );

/**
 * Case-insensitive search over name and description.
 * @param {Array<{ name: string, description?: string }>} templates - Templates.
 * @param {string} query - Search text.
 * @returns {Array<object>} Matching templates (same order).
 */
export const searchTemplates = (templates, query) => {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  if (!needle) return templates;
  return templates.filter((template) =>
    `${template.name} ${template.description || ''}`.toLowerCase().includes(needle)
  );
};

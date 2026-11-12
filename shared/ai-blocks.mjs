/**
 * Block-aware AI actions (2.4): pure helpers shared by the admin and the tests.
 *
 * - `blockSegments(data, ids)` lists the inline text strings of the chosen
 *   blocks (document order, same fields as the whole-field translation).
 * - `applyBlockResult(data, sent, result, preset)` writes an answer back only
 *   when the answer names exactly the strings that were sent and the
 *   document still holds every sent string unchanged; the changed blocks are
 *   then fixed against the field preset (links the preset does not allow keep
 *   only their text). Everything else stays as it is.
 *
 * No DOM and no dependencies.
 */

import { applySegments, collectSegments, readSegment } from './ai-fields.mjs';
import { checkBlockStructure, fixPresetViolations } from './presets.mjs';
import { diffText } from './diff.mjs';

/**
 * @typedef {{ blockId: string, path: string, html: string }} Segment
 */

/**
 * Inline text strings of the chosen blocks.
 * @param {{ blocks?: Array<{ id: string }> }|null} data - Normalised document.
 * @param {Iterable<string>} ids - Block ids.
 * @returns {Segment[]} Segments in document order.
 */
export const blockSegments = (data, ids) => {
  if (!data || !Array.isArray(data.blocks)) return [];
  const wanted = new Set(ids);
  return collectSegments({ ...data, blocks: data.blocks.filter((block) => block && wanted.has(block.id)) });
};

const keyOf = (segment) => `${segment.blockId}|${segment.path}`;

/**
 * Applies a block action result.
 * @param {{ blocks: Array<{ id: string, type: string, data: object }> }} data - Current document.
 * @param {Segment[]} sent - Segments that were sent.
 * @param {Segment[]} result - Segments the server returned.
 * @param {import('./presets.mjs').FieldPreset} preset - Field preset.
 * @returns {{ ok: true, data: object, changed: number }|{ ok: false, reason: 'MISMATCH'|'CHANGED' }} Result.
 */
export const applyBlockResult = (data, sent, result, preset) => {
  const sentKeys = new Set(sent.map(keyOf));
  if (
    !Array.isArray(result) ||
    result.length !== sent.length ||
    new Set(result.map(keyOf)).size !== result.length ||
    !result.every((item) => item && typeof item.html === 'string' && sentKeys.has(keyOf(item)))
  )
    return { ok: false, reason: 'MISMATCH' };
  if (!data || !Array.isArray(data.blocks)) return { ok: false, reason: 'CHANGED' };
  const byId = new Map(data.blocks.map((block) => [block.id, block]));
  const unchanged = sent.every((segment) => {
    const block = byId.get(segment.blockId);
    return Boolean(block) && readSegment(block.data, segment.path) === segment.html;
  });
  if (!unchanged) return { ok: false, reason: 'CHANGED' };
  const applied = applySegments(data, result);
  if (applied.missing) return { ok: false, reason: 'CHANGED' };
  const touched = new Set(result.map((item) => item.blockId));
  const blocks = applied.data.blocks.map((block) => {
    if (!touched.has(block.id) || !preset || !preset.restricted || !checkBlockStructure(preset, block))
      return block;
    const fixed = fixPresetViolations({ blocks: [block] }, preset).data.blocks;
    // A fix never removes a block the author chose; when it would, the block stays as answered.
    return fixed.length === 1 ? fixed[0] : block;
  });
  return { ok: true, data: { ...applied.data, blocks }, changed: applied.changed };
};

/**
 * How a change is shown: a word diff when most words stay, otherwise the old
 * text (removed) above the new text (added), which reads better for
 * translations and full rewrites.
 * @param {string} before - Old text.
 * @param {string} after - New text.
 * @returns {Array<Array<{ op: string, text: string }>>} One or two diff lines.
 */
export const changeViews = (before, after) => {
  const ops = diffText(before, after);
  const kept = ops.filter((op) => op.op === 'equal').reduce((sum, op) => sum + op.text.length, 0);
  if (kept >= Math.max(before.length, after.length) * 0.5) return [ops];
  return [[{ op: 'delete', text: before }], [{ op: 'insert', text: after }]];
};

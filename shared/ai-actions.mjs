/**
 * AI actions beyond the fixed list (2.9): pure helpers shared by the server
 * and the admin.
 *
 * - "Ask AI…" (`ask`): the editor types an instruction. It is untrusted text:
 *   `cleanInstruction` removes control characters and turns `<` and `>` into
 *   single angle quotes, so it can never open or close a prompt fence
 *   (`<text>`, `<json>`, `<request>`, `<style_guide>`), and caps its length.
 * - AI review (`proofread`, `clarity`, `style-guide`): the answer becomes block
 *   suggestions in the Suggestions panel instead of an edit
 *   (`reviewProposals` turns an answer into proposed blocks).
 * - Owner-defined actions: named instructions with a scope (selection, chosen
 *   blocks, whole field) and an output (replace through the preview, or
 *   suggestions), stored in the plugin settings (`ai.actions`).
 * - Field presets may list the actions a field offers (`aiActions` option,
 *   `parseAiActionList`, `isAiActionAllowed`).
 *
 * No DOM and no dependencies besides the other shared modules.
 */

import { applySegments, segmentPlainText } from './ai-fields.mjs';

/** Built-in actions per scope (server `ACTIONS`, `BLOCK_ACTIONS`, `FIELD_ACTIONS`). */
export const SELECTION_ACTIONS = Object.freeze([
  'improve',
  'grammar',
  'shorten',
  'expand',
  'summarize',
  'simplify',
  'translate',
  'tone',
  'continue',
]);
export const BLOCK_ACTIONS = Object.freeze(['improve', 'shorten', 'translate', 'tone']);
export const FIELD_ACTIONS = Object.freeze(['translate', 'summarize']);

/** The free-text action. */
export const ASK_ACTION = 'ask';
/** Review kinds that create suggestions. */
export const REVIEW_KINDS = Object.freeze(['proofread', 'clarity', 'style-guide']);
/** Scopes and outputs of owner-defined actions. */
export const ACTION_SCOPES = Object.freeze(['selection', 'blocks', 'field']);
export const ACTION_OUTPUTS = Object.freeze(['replace', 'suggestions']);

/** Longest "Ask AI…" instruction (characters, after cleaning). */
export const MAX_INSTRUCTION_CHARS = 500;
/** Longest instruction of an owner-defined action. */
export const MAX_ACTION_INSTRUCTION_CHARS = 2000;
/** Longest action name. */
export const MAX_ACTION_NAME_CHARS = 60;
/** Most owner-defined actions. */
export const MAX_CUSTOM_ACTIONS = 10;
/** Longest style guide. */
export const MAX_STYLE_GUIDE_CHARS = 4000;
/** Most suggestions one AI review run creates (the rest is reported as `capped`). */
export const MAX_AI_REVIEW_SUGGESTIONS = 20;
/** Most blocks one AI review request may send. */
export const MAX_REVIEW_BLOCKS = 200;
/** Recent "Ask AI…" instructions offered as quick picks. */
export const MAX_RECENT_INSTRUCTIONS = 5;

/** Keys of owner-defined actions: lower case, digits and hyphens, 2-40 characters. */
export const ACTION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

/** Names an owner-defined action cannot take (built-in actions, route segments). */
export const RESERVED_ACTION_KEYS = Object.freeze(
  new Set([
    ...SELECTION_ACTIONS,
    ...BLOCK_ACTIONS,
    ...FIELD_ACTIONS,
    ASK_ACTION,
    ...REVIEW_KINDS,
    'custom',
    'review',
    'blocks',
    'field',
    'image',
    'alt-text',
  ])
);

/** Every built-in key a field preset can list in `aiActions`. */
export const BUILTIN_ACTION_KEYS = Object.freeze([
  ...new Set([...SELECTION_ACTIONS, ...BLOCK_ACTIONS, ...FIELD_ACTIONS, ASK_ACTION, ...REVIEW_KINDS]),
]);

// eslint-disable-next-line no-control-regex -- control characters (except tab and newline) are removed
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Cleans untrusted instruction text (an editor's "Ask AI…" request, an
 * owner's action instruction or style guide) for a prompt: no control or
 * bidirectional characters, `<` and `>` become `‹` and `›` (no fence can be
 * opened or closed), at most two newlines in a row, trimmed and cut.
 * @param {unknown} value - Text.
 * @param {number} [max] - Longest result.
 * @returns {string} Clean text ('' for non-strings).
 */
export const cleanInstruction = (value, max = MAX_INSTRUCTION_CHARS) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim();
};

/**
 * Plain display name of an action (no control characters, single spaces).
 * @param {unknown} value - Name.
 * @returns {string} Name.
 */
export const cleanActionName = (value) =>
  typeof value === 'string'
    ? value.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, MAX_ACTION_NAME_CHARS).trim()
    : '';

/**
 * Parses the `aiActions` field option: a comma list of action keys (built-in
 * names, `ask`, review kinds, owner-defined keys). Empty or invalid: null (all
 * actions are offered).
 * @param {unknown} value - Option value.
 * @returns {string[]|null} Keys, or null.
 */
export const parseAiActionList = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const keys = value
    .slice(0, 2000)
    .split(/[\s,;]+/)
    .map((key) => key.trim().toLowerCase())
    .filter((key) => /^[a-z][a-z0-9-]{0,39}$/.test(key));
  return keys.length ? [...new Set(keys)].slice(0, 100) : null;
};

/**
 * True when a field preset offers an action.
 * @param {{ aiActions?: string[]|null }|null|undefined} preset - Field preset.
 * @param {string} key - Action key.
 * @returns {boolean} Result.
 */
export const isAiActionAllowed = (preset, key) =>
  !preset || !Array.isArray(preset.aiActions) || preset.aiActions.includes(key);

/**
 * Owner-defined actions for one scope that a field offers, in their stored order.
 * @param {Array<{ key: string, scope: string }>|null|undefined} actions - Actions (`config.ai.custom`).
 * @param {'selection'|'blocks'|'field'} scope - Where the menu is.
 * @param {{ aiActions?: string[]|null }} [preset] - Field preset.
 * @returns {Array<object>} Actions.
 */
export const customActionsFor = (actions, scope, preset) =>
  (Array.isArray(actions) ? actions : []).filter(
    (action) => action && action.scope === scope && isAiActionAllowed(preset, action.key)
  );

/**
 * Turns a review answer into proposed blocks: one block per block whose text
 * changed (formatting-only changes are ignored), with only the changed
 * strings replaced. Blocks keep their id, type, tunes and all other data.
 * @param {Array<{ id: string, type: string, data: object, tunes?: object }>} blocks - Blocks that were reviewed.
 * @param {Array<{ blockId: string, path: string, html: string }>} sent - Segments that were sent.
 * @param {Array<{ blockId: string, path: string, html: string }>} result - Checked answer (same keys as `sent`).
 * @returns {Array<{ blockId: string, base: object, proposed: object, segments: number }>} Proposals in block order.
 */
export const reviewProposals = (blocks, sent, result) => {
  const before = new Map(sent.map((segment) => [`${segment.blockId}|${segment.path}`, segment.html]));
  const changed = new Map();
  for (const segment of result) {
    const original = before.get(`${segment.blockId}|${segment.path}`);
    if (typeof original !== 'string') continue;
    if (segmentPlainText(original) === segmentPlainText(segment.html)) continue;
    if (!changed.has(segment.blockId)) changed.set(segment.blockId, []);
    changed.get(segment.blockId).push(segment);
  }
  const out = [];
  for (const block of blocks) {
    const list = changed.get(block.id);
    if (!list) continue;
    const applied = applySegments({ blocks: [block] }, list);
    if (applied.missing || !applied.changed) continue;
    out.push({ blockId: block.id, base: block, proposed: applied.data.blocks[0], segments: list.length });
  }
  return out;
};

/**
 * Adds an instruction to the recent list (newest first, no duplicates ignoring
 * case and spacing, at most MAX_RECENT_INSTRUCTIONS).
 * @param {unknown} list - Stored list.
 * @param {string} instruction - Instruction just used.
 * @returns {string[]} New list.
 */
export const rememberInstruction = (list, instruction) => {
  const text = typeof instruction === 'string' ? instruction.replace(/\s+/g, ' ').trim() : '';
  const current = Array.isArray(list)
    ? list.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.slice(0, 500))
    : [];
  if (!text) return current.slice(0, MAX_RECENT_INSTRUCTIONS);
  const key = text.toLowerCase();
  return [
    text.slice(0, 500),
    ...current.filter((item) => item.replace(/\s+/g, ' ').trim().toLowerCase() !== key),
  ].slice(0, MAX_RECENT_INSTRUCTIONS);
};

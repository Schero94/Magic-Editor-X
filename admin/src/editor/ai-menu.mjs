/**
 * AI menu model (2.9): which entries the AI dialogs offer for a scope, in a
 * fixed order. Built-in actions first, then "Ask AI…" (selection and blocks),
 * then the AI reviews that create suggestions, then the owner's own actions.
 * Pure, so `node --test` covers it.
 *
 * Entry values: a built-in key (`improve`), `ask`, `review:<kind>` and
 * `custom:<key>`. `output` says what an entry produces: `replace` (preview and
 * apply) or `suggestions` (entries in the Suggestions panel).
 */

import {
  ASK_ACTION,
  BLOCK_ACTIONS,
  FIELD_ACTIONS,
  SELECTION_ACTIONS,
  customActionsFor,
  isAiActionAllowed,
} from '../../../shared/ai-actions.mjs';

const BUILTINS = { selection: SELECTION_ACTIONS, blocks: BLOCK_ACTIONS, field: FIELD_ACTIONS };

/**
 * @typedef {object} AiMenuEntry
 * @property {string} value - Unique value (`improve`, `ask`, `review:proofread`, `custom:seo-intro`).
 * @property {'builtin'|'ask'|'review'|'custom'} type - Kind of entry.
 * @property {string} key - Action key (as field presets list it).
 * @property {'replace'|'suggestions'} output - What it produces.
 * @property {string} [name] - Owner-defined actions: their name.
 */

/**
 * Entries of the AI menu for one scope.
 * @param {'selection'|'blocks'|'field'} scope - Where the menu is.
 * @param {object} options - Options.
 * @param {string[]} [options.builtins] - Built-in actions the server offers for this scope (default: all).
 * @param {{ aiActions?: string[]|null }} [options.preset] - Field preset (allow-list).
 * @param {string[]} [options.reviews] - Review kinds the server offers (`config.ai.reviews`).
 * @param {Array<{ key: string, name: string, scope: string, output: string }>} [options.custom] - `config.ai.custom`.
 * @param {boolean} [options.canSuggest] - The admin may create suggestions in this field now.
 * @param {boolean} [options.canReplace] - The field can be changed (not read-only).
 * @returns {AiMenuEntry[]} Entries.
 */
export const aiMenuEntries = (
  scope,
  { builtins, preset, reviews = [], custom = [], canSuggest = false, canReplace = true } = {}
) => {
  const out = [];
  const allowed = (key) => isAiActionAllowed(preset, key);
  if (canReplace) {
    const list = Array.isArray(builtins)
      ? builtins.filter((key) => BUILTINS[scope].includes(key))
      : BUILTINS[scope];
    for (const key of list)
      if (allowed(key)) out.push({ value: key, type: 'builtin', key, output: 'replace' });
    if (scope !== 'field' && allowed(ASK_ACTION))
      out.push({ value: ASK_ACTION, type: 'ask', key: ASK_ACTION, output: 'replace' });
  } else if (scope === 'field' && allowed('summarize')) {
    // A read-only field still offers the summary (copy only).
    out.push({ value: 'summarize', type: 'builtin', key: 'summarize', output: 'replace' });
  }
  if (canSuggest)
    for (const kind of Array.isArray(reviews) ? reviews : [])
      if (allowed(kind))
        out.push({ value: `review:${kind}`, type: 'review', key: kind, output: 'suggestions' });
  for (const action of customActionsFor(custom, scope, preset)) {
    if (action.output === 'suggestions' ? !canSuggest : !canReplace) continue;
    out.push({
      value: `custom:${action.key}`,
      type: 'custom',
      key: action.key,
      output: action.output === 'suggestions' ? 'suggestions' : 'replace',
      name: action.name,
    });
  }
  return out;
};

/**
 * Request parts of an entry: the route action and the extra body fields.
 * @param {AiMenuEntry} entry - Entry.
 * @returns {{ action: string, body: object }} Route action (`custom`, `ask`, `proofread`, a built-in key) and body extras.
 */
export const entryRequest = (entry) => {
  if (entry.type === 'custom') return { action: 'custom', body: { actionKey: entry.key } };
  if (entry.type === 'review') return { action: entry.key, body: {} };
  return { action: entry.key, body: {} };
};

/**
 * Ids of the Editor.js blocks a DOM range touches (`.ce-block[data-id]`), in document order.
 * @param {Range|null|undefined} range - Selection range.
 * @param {HTMLElement|null|undefined} holder - Editor holder (blocks outside it are ignored).
 * @returns {string[]} Block ids.
 */
export const blockIdsOfRange = (range, holder) => {
  if (!range || !holder) return [];
  const blockOf = (node) => {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    const block =
      element && typeof element.closest === 'function' ? element.closest('.ce-block[data-id]') : null;
    return block && holder.contains(block) ? block : null;
  };
  const start = blockOf(range.startContainer);
  const end = blockOf(range.endContainer);
  if (!start) return [];
  if (!end || end === start) return [start.getAttribute('data-id')];
  const all = Array.from(holder.querySelectorAll('.ce-block[data-id]'));
  const from = all.indexOf(start);
  const to = all.indexOf(end);
  if (from < 0 || to < 0) return [start.getAttribute('data-id')];
  return all.slice(Math.min(from, to), Math.max(from, to) + 1).map((block) => block.getAttribute('data-id'));
};

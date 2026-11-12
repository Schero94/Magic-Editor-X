/**
 * `@` mention trigger (2.4): pure rules, used by mention-trigger.js.
 *
 * Typing `@` at the start of a word in a text block opens the entry
 * suggestions; the text typed after it is the search. The `@` only counts
 * when it starts a word, so `a@b`, `name@example.test` or `x@` never open
 * anything.
 */

/** Longest search text after the `@` (the server accepts 100; titles are short). */
export const MAX_MENTION_QUERY = 50;

/** Blocks (Editor.js tool names) where `@` opens the suggestions. */
export const MENTION_TRIGGER_BLOCKS = Object.freeze([
  'paragraph',
  'header',
  'list',
  'checklist',
  'quote',
  'toggle',
  'table',
]);

/** Delay before a search runs while typing. */
export const MENTION_SEARCH_DELAY_MS = 200;

/**
 * Characters that may stand right before a trigger `@`: white space and
 * opening punctuation. Letters, digits and everything else (`.`, `-`, `_`,
 * `+`, `@`) mean the `@` is part of a word or an e-mail address.
 */
const BEFORE_TRIGGER = /[\s\u00a0([{"'«‘“„‹]/;

/**
 * Finds an active mention query: the `@` that starts the word the caret is in.
 * @param {string} before - Text of the text node (or block) up to the caret.
 * @returns {{ start: number, query: string }|null} Offset of the `@` in `before` and the text after it, or null.
 */
export const findMentionQuery = (before) => {
  if (typeof before !== 'string' || !before.includes('@')) return null;
  const from = Math.max(0, before.length - MAX_MENTION_QUERY - 2);
  const start = before.lastIndexOf('@');
  if (start < from) return null;
  const query = before.slice(start + 1);
  if (query.length > MAX_MENTION_QUERY) return null;
  // The query is one line of text and never starts with white space; two spaces end it.
  if (/^[\s\u00a0]/.test(query) || /[\s\u00a0]{2}/.test(query) || /[\n\r\t@]/.test(query)) return null;
  if (start > 0 && !BEFORE_TRIGGER.test(before[start - 1])) return null;
  return { start, query };
};

/**
 * Search text sent to the server for a query (spaces normalised, trimmed).
 * @param {string} query - Typed text after the `@`.
 * @returns {string} Search text.
 */
export const mentionSearchText = (query) =>
  typeof query === 'string'
    ? query
        .replace(/[\s\u00a0]+/g, ' ')
        .trim()
        .slice(0, MAX_MENTION_QUERY)
    : '';

/**
 * True when the `@` trigger may run for a block.
 * @param {string|null|undefined} blockName - Editor.js tool name of the current block.
 * @returns {boolean} Result.
 */
export const isMentionTriggerBlock = (blockName) =>
  typeof blockName === 'string' && MENTION_TRIGGER_BLOCKS.includes(blockName);

/**
 * Position of the popup below (or, without room, above) the caret, kept inside the viewport.
 * @param {{ top: number, bottom: number, left: number }} caret - Caret rectangle (viewport coordinates).
 * @param {{ width: number, height: number }} popup - Popup size.
 * @param {{ width: number, height: number }} viewport - Viewport size.
 * @param {number} [gap=4] - Distance to the caret.
 * @returns {{ top: number, left: number, placement: 'below'|'above' }} Position (viewport coordinates).
 */
export const placePopup = (caret, popup, viewport, gap = 4) => {
  const margin = 8;
  const below = caret.bottom + gap;
  const fitsBelow = below + popup.height <= viewport.height - margin;
  const above = caret.top - gap - popup.height;
  const placement = fitsBelow || above < margin ? 'below' : 'above';
  const top = placement === 'below' ? below : above;
  const maxLeft = Math.max(margin, viewport.width - popup.width - margin);
  const left = Math.min(Math.max(margin, caret.left), maxLeft);
  return { top: Math.round(top), left: Math.round(left), placement };
};

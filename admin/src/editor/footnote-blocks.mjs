/**
 * Blocks that hold footnote markers (2.10.1).
 *
 * Blocks outside the viewport use `content-visibility: auto` (see
 * tools/styles.js), which implies style containment: a CSS counter inside such
 * a block starts again at 1. Footnote markers are numbered in reading order
 * with a counter across blocks, so blocks with a marker keep normal rendering.
 * They are marked with a class instead of a `:has()` selector, which made
 * every edit in a long document check all blocks again.
 */

/** Class of a block that holds at least one footnote marker. */
export const FOOTNOTE_BLOCK_CLASS = 'mex-has-footnote';

/**
 * Sets the class on the blocks that hold a footnote marker and removes it from blocks that no
 * longer do. Only the markers and the blocks marked before are visited.
 * @param {ParentNode|null} holder - Editor holder.
 * @param {Set<Element>} marked - Blocks marked by the previous call (updated in place).
 * @param {string} markerSelector - Footnote marker selector.
 * @returns {void}
 */
export const markFootnoteBlocks = (holder, marked, markerSelector) => {
  if (!holder || typeof holder.querySelectorAll !== 'function') return;
  const now = new Set();
  for (const marker of holder.querySelectorAll(markerSelector)) {
    const block = marker.closest('.ce-block');
    if (block) now.add(block);
  }
  for (const block of marked) if (!now.has(block)) block.classList.remove(FOOTNOTE_BLOCK_CLASS);
  for (const block of now) if (!marked.has(block)) block.classList.add(FOOTNOTE_BLOCK_CLASS);
  marked.clear();
  for (const block of now) marked.add(block);
};

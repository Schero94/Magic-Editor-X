/**
 * Save timing of the editor field for long documents (2.10.1).
 *
 * After each change the field serialises the whole document (Editor.js
 * `save()`, the form value, the live session update). That work grows with
 * the number of blocks: at 5,000 blocks one save is a main-thread task of
 * about 50 to 130 ms. With the short delay used for small documents it ran
 * between two key presses, so the next key waited for it. From
 * `SCALE_FROM_BLOCKS` blocks on, the delay grows with the document, up to
 * `MAX_DELAY_MS`: the save then runs in the pauses of typing. A delay of 0
 * (focus leaves the field, Save is clicked) is never lengthened.
 */

/** Documents up to this many blocks keep the requested delay. */
export const SCALE_FROM_BLOCKS = 1000;
/** Extra milliseconds per block above SCALE_FROM_BLOCKS. */
export const MS_PER_BLOCK = 0.1;
/** Upper bound of a lengthened delay. */
export const MAX_DELAY_MS = 400;

/**
 * Delay before the field saves a change.
 * @param {number} requested - Delay the caller asked for (ms); 0 saves at once.
 * @param {number} blockCount - Blocks in the editor.
 * @returns {number} Delay in ms.
 */
export const saveDelay = (requested, blockCount) => {
  const base = Number.isFinite(requested) && requested > 0 ? requested : 0;
  if (base === 0) return 0;
  const blocks = Number.isFinite(blockCount) && blockCount > 0 ? blockCount : 0;
  if (blocks <= SCALE_FROM_BLOCKS) return base;
  const scaled = base + Math.round((blocks - SCALE_FROM_BLOCKS) * MS_PER_BLOCK);
  return Math.min(Math.max(base, MAX_DELAY_MS), scaled);
};

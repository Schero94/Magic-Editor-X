/**
 * Default block tunes (2.4).
 *
 * Editor.js writes the value of every tune a block has into its output, also
 * when the user never touched it (`alignmentTune: { alignment: 'left' }` on
 * every paragraph). Stored content often has no tunes at all (imports, 1.x,
 * values written by the API), so the same content can come in two shapes.
 * Comparisons (rendered blocks, version history, "unchanged since the last
 * save") treat a default tune value as "no tune". Stored data is never
 * rewritten by this module.
 *
 * Shared by the admin (apply-remote.js) and the server (history, collaboration).
 */

import { stableStringify } from './ydoc.mjs';

/** Tune values Editor.js writes for every block that has the tune; they equal "no tune". */
export const DEFAULT_TUNES = Object.freeze({
  alignmentTune: stableStringify({ alignment: 'left' }),
  textVariant: stableStringify(''),
  indentTune: stableStringify({ indentLevel: 0 }),
});

/**
 * Tunes without default values.
 * @param {object|undefined|null} tunes - Block tunes.
 * @returns {object} Tunes that differ from the defaults (empty object when none).
 */
export const meaningfulTunes = (tunes) => {
  const out = {};
  if (!tunes || typeof tunes !== 'object' || Array.isArray(tunes)) return out;
  for (const [name, value] of Object.entries(tunes)) {
    if (value === undefined || value === null) continue;
    if (DEFAULT_TUNES[name] !== undefined && DEFAULT_TUNES[name] === stableStringify(value)) continue;
    out[name] = value;
  }
  return out;
};

/**
 * Blocks in the form used for comparisons: `tunes` holds only non-default
 * values and is left out when nothing remains. Other keys are unchanged.
 * @param {Array<object>|undefined|null} blocks - Blocks.
 * @returns {Array<object>} Comparable blocks (new objects; the input is not changed).
 */
export const comparableBlocks = (blocks) =>
  (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (!block || typeof block !== 'object' || !('tunes' in block)) return block;
    const { tunes, ...rest } = block;
    const kept = meaningfulTunes(tunes);
    return Object.keys(kept).length ? { ...rest, tunes: kept } : rest;
  });

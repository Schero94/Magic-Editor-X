import { comparableBlocks } from '../../../shared/default-tunes.mjs';
import { stableStringifyBlocks } from '../../../shared/ydoc.mjs';

/**
 * Live collaboration room vs. stored value (2.7.4, M3).
 *
 * A room keeps unsaved text for `roomTtlMinutes` after the last editor left. The first room state a
 * field shows can therefore contain changes nobody saved. The field compares it with the stored
 * value and, when they differ, marks the form as changed and tells the editor, so unsaved text is
 * never shown as if it were saved. Default tune values (`alignment: left`, indent 0, no variant)
 * count as "no tune": the same content written by the API and by Editor.js compares equal.
 */

/**
 * Comparable fingerprint of blocks.
 * @param {Array<object>|null|undefined} blocks - Prepared (sanitised) blocks.
 * @returns {string} Fingerprint.
 */
const fingerprint = (blocks) =>
  stableStringifyBlocks(
    comparableBlocks(Array.isArray(blocks) ? blocks : []).filter(
      (block) =>
        // An empty paragraph is what an empty field shows; it is not content.
        !(
          block &&
          block.type === 'paragraph' &&
          String((block.data && block.data.text) || '').replace(/<br\s*\/?>|&nbsp;|\s/g, '') === ''
        )
    )
  );

/**
 * True when the room shows content that differs from the stored field value.
 * @param {{ blocks?: Array<object> }|null|undefined} room - Room content, prepared like stored content.
 * @param {{ blocks?: Array<object> }|null|undefined} stored - Stored value, prepared.
 * @returns {boolean} The room has unsaved changes.
 */
export const roomDiffersFromStored = (room, stored) =>
  fingerprint(room && room.blocks) !== fingerprint(stored && stored.blocks);

/**
 * True when a live update brought a room with unsaved changes back to the stored value (2.7.8):
 * another person discarded the unsaved changes (or undid them all). The field then says so and
 * offers to put the previous text back.
 * @param {{ blocks?: Array<object> }|null|undefined} before - Room content shown before the update.
 * @param {{ blocks?: Array<object> }|null|undefined} after - Room content shown after the update.
 * @param {{ blocks?: Array<object> }|null|undefined} stored - Stored value, prepared.
 * @returns {boolean} Result.
 */
export const roomWasReset = (before, after, stored) =>
  Boolean(before && after) && roomDiffersFromStored(before, stored) && !roomDiffersFromStored(after, stored);

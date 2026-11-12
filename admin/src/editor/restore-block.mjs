/**
 * Restores one block of an older version into the open editor (version
 * history "Restore this block").
 *
 * Uses the public Editor.js 2.31 Blocks API only, so the change reaches the
 * form and live collaboration like any other edit:
 * - `blocks.getById(id)` / `blocks.getBlockIndex(id)` to find blocks,
 * - `blocks.update(id, data, tunes)` when the block still exists with the same type,
 * - `blocks.insert(type, data, config, index, needToFocus, replace, id)` otherwise
 *   (the 7th argument keeps the block's original id when it is free).
 */

/**
 * @param {object} editor - Editor.js instance.
 * @param {{ id: string, type: string, data: object, tunes?: object }} block - Block from the older version (already sanitised for the editor).
 * @param {{ replaceId?: string|null, afterId?: string|null, beforeId?: string|null }} [position] - Where the block goes.
 *   `replaceId`: a current block to replace; otherwise after `afterId`, else before `beforeId`, else at the end.
 * @returns {Promise<number>} Index of the restored block.
 * @throws {Error} When the editor or block is missing.
 */
export async function restoreBlockInEditor(editor, block, position = {}) {
  if (!editor || !editor.blocks || !block || typeof block.type !== 'string') {
    throw new Error('Nothing to restore');
  }
  const { blocks } = editor;
  const data = block.data || {};
  const indexOf = (id) => (id && blocks.getById(id) ? blocks.getBlockIndex(id) : -1);

  const replaceIndex = indexOf(position.replaceId);
  if (replaceIndex !== -1) {
    const current = blocks.getById(position.replaceId);
    if (current && current.name === block.type && typeof blocks.update === 'function') {
      await blocks.update(position.replaceId, data, block.tunes);
      return replaceIndex;
    }
    // Different type: replace the block in place and keep its id.
    blocks.insert(block.type, data, undefined, replaceIndex, false, true, position.replaceId);
    if (block.tunes) await blocks.update(position.replaceId, data, block.tunes).catch(() => {});
    return replaceIndex;
  }

  let index = blocks.getBlocksCount();
  const after = indexOf(position.afterId);
  const before = indexOf(position.beforeId);
  if (after !== -1) index = after + 1;
  else if (before !== -1) index = before;

  // Keep the original id unless a block with that id is already in the editor.
  const id = block.id && !blocks.getById(block.id) ? block.id : undefined;
  const inserted = blocks.insert(block.type, data, undefined, index, false, false, id);
  if (block.tunes && inserted && inserted.id) {
    await blocks.update(inserted.id, data, block.tunes).catch(() => {});
  }
  return index;
}

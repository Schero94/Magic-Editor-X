import { stableStringify } from '../../../shared/ydoc.mjs';

/**
 * Applies a target document (from collaboration, history restore or a form
 * reset) to a running Editor.js instance with the fewest block operations,
 * keeping the caret of the local user in place where possible.
 *
 * Editor.js 2.31 Blocks API used: getBlocksCount, getBlockByIndex, getBlockIndex,
 * delete(index), move(toIndex, fromIndex), insert(type, data, config, index,
 * needToFocus, replace, id), update(id, data, tunes), render(data).
 */

/**
 * Fingerprint of a block for change detection.
 * @param {{ type: string, data: object, tunes?: object }} block - Block.
 * @returns {string} Fingerprint.
 */
export const blockKey = (block) =>
  stableStringify({ type: block.type, data: block.data || {}, tunes: block.tunes || {} });

/**
 * Character offset of the caret inside an element, or null.
 * @param {HTMLElement} element - Editable element.
 * @returns {number|null} Offset.
 */
const caretOffset = (element) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(element);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
};

/**
 * Puts the caret at a character offset inside an element.
 * @param {HTMLElement} element - Editable element.
 * @param {number} offset - Character offset.
 */
const placeCaret = (element, offset) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  let last = null;
  while (node) {
    last = node;
    if (remaining <= node.textContent.length) break;
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  const range = document.createRange();
  if (node) range.setStart(node, Math.max(0, remaining));
  else if (last) range.setStart(last, last.textContent.length);
  else range.setStart(element, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Text of a block's data field used for caret mapping.
 * @param {object} data - Block data.
 * @returns {string} Plain text.
 */
const plainText = (data) => {
  const html = data && typeof data.text === 'string' ? data.text : '';
  // DOMParser builds an inert document: no scripts run and no resources load.
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
};

/**
 * Applies `target` to the editor.
 * @param {object} editor - Editor.js instance (ready).
 * @param {{ blocks: Array<{ id: string, type: string, data: object, tunes?: object }> }} target - Desired document.
 * @param {Map<string, string>} known - id -> blockKey of what the editor currently shows (updated in place).
 * @returns {Promise<'patched'|'rendered'>} How the change was applied.
 */
export const applyToEditor = async (editor, target, known) => {
  const blocks = target.blocks || [];
  if (blocks.length === 0) {
    await editor.blocks.clear();
    known.clear();
    return 'rendered';
  }
  try {
    const targetIds = new Set(blocks.map((block) => block.id));
    for (let index = editor.blocks.getBlocksCount() - 1; index >= 0; index -= 1) {
      const current = editor.blocks.getBlockByIndex(index);
      if (current && !targetIds.has(current.id)) {
        editor.blocks.delete(index);
        known.delete(current.id);
      }
    }
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const current = editor.blocks.getBlockByIndex(index);
      if (!current || current.id !== block.id) {
        const existingIndex = editor.blocks.getBlockIndex(block.id);
        if (existingIndex !== undefined && existingIndex !== null && existingIndex >= 0) {
          editor.blocks.move(index, existingIndex);
        } else {
          editor.blocks.insert(block.type, block.data, undefined, index, false, false, block.id);
          if (block.tunes) await editor.blocks.update(block.id, block.data, block.tunes);
          known.set(block.id, blockKey(block));
          continue;
        }
      }
      const key = blockKey(block);
      if (known.get(block.id) === key) continue;
      const api = editor.blocks.getBlockByIndex(index);
      const holder = api && api.holder;
      const editable = holder && holder.querySelector('[contenteditable="true"]');
      const offset = editable ? caretOffset(editable) : null;
      let mapped = offset;
      if (offset !== null) {
        const before = editable.textContent || '';
        const after = plainText(block.data);
        let prefix = 0;
        while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
          prefix += 1;
        if (prefix < offset) mapped = Math.max(0, offset + (after.length - before.length));
      }
      await editor.blocks.update(block.id, block.data, block.tunes);
      known.set(block.id, key);
      if (mapped !== null) {
        const updated = editor.blocks.getBlockByIndex(index);
        const target2 = updated && updated.holder && updated.holder.querySelector('[contenteditable="true"]');
        if (target2) placeCaret(target2, Math.min(mapped, (target2.textContent || '').length));
      }
    }
    while (editor.blocks.getBlocksCount() > blocks.length)
      editor.blocks.delete(editor.blocks.getBlocksCount() - 1);
    return 'patched';
  } catch {
    known.clear();
    if (blocks.length === 0) await editor.blocks.clear();
    else await editor.render({ time: target.time || Date.now(), blocks, version: target.version });
    blocks.forEach((block) => known.set(block.id, blockKey(block)));
    return 'rendered';
  }
};

/**
 * Remembers what the editor shows after a local save.
 * @param {Map<string, string>} known - Map to refresh.
 * @param {{ blocks: Array<object> }} data - Saved data.
 */
export const rememberBlocks = (known, data) => {
  known.clear();
  (data.blocks || []).forEach((block) => known.set(block.id, blockKey(block)));
};

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

/** Fingerprints by block object (blocks are treated as immutable). */
const keys = new WeakMap();

/** Tune values Editor.js writes for every block that has the tune; they equal "no tune". */
const DEFAULT_TUNES = {
  alignmentTune: stableStringify({ alignment: 'left' }),
  textVariant: stableStringify(''),
  indentTune: stableStringify({ indentLevel: 0 }),
};

/**
 * Tunes without default values, so stored content (no tunes) and the editor's
 * own output (default tunes on every block) have the same fingerprint.
 * @param {object|undefined} tunes - Block tunes.
 * @returns {object} Tunes that differ from the defaults.
 */
const meaningfulTunes = (tunes) => {
  const out = {};
  if (!tunes || typeof tunes !== 'object') return out;
  for (const [name, value] of Object.entries(tunes)) {
    if (value === undefined || value === null) continue;
    if (DEFAULT_TUNES[name] !== undefined && DEFAULT_TUNES[name] === stableStringify(value)) continue;
    out[name] = value;
  }
  return out;
};

/**
 * Fingerprint of a block for change detection.
 * @param {{ type: string, data: object, tunes?: object }} block - Block.
 * @returns {string} Fingerprint.
 */
export const blockKey = (block) => {
  // Blocks are treated as immutable; unchanged blocks keep their identity, so the key is cached.
  let key = keys.get(block);
  if (key === undefined) {
    key = stableStringify({ type: block.type, data: block.data || {}, tunes: meaningfulTunes(block.tunes) });
    keys.set(block, key);
  }
  return key;
};

/**
 * Above this many changed blocks one full render is cheaper than block-by-block
 * updates: every Editor.js update notifies a mutation watcher on every block,
 * so many updates in a long document cost O(blocks^2).
 */
const MAX_PATCHED_BLOCKS = 150;

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
    const changed = blocks.filter((block) => known.get(block.id) !== blockKey(block)).length;
    if (changed > MAX_PATCHED_BLOCKS && changed > blocks.length / 4) throw new Error('render');
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

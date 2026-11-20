import { stableStringify, stableStringifyCached } from '../../../shared/ydoc.mjs';
import { meaningfulTunes } from '../../../shared/default-tunes.mjs';
import { applyComponentValues } from './tools/component';
import { deleteBlockKeepingFocus } from './focus-guard.mjs';

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

/**
 * Fingerprint of a block for change detection.
 * @param {{ type: string, data: object, tunes?: object }} block - Block.
 * @returns {string} Fingerprint.
 */
export const blockKey = (block) => {
  // Blocks are treated as immutable; unchanged blocks keep their identity, so the key is cached.
  let key = keys.get(block);
  if (key === undefined) {
    key = stableStringifyCached({
      type: block.type,
      data: block.data || {},
      tunes: meaningfulTunes(block.tunes),
    });
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
 * Remote block data with the keys it no longer has set to `undefined`.
 * `editor.blocks.update` merges the new data into the current data, so a key
 * removed by another person (a table caption or merge list cleared, an image
 * no longer decorative) would otherwise stay in this editor.
 * @param {object} api - Block API of the current block.
 * @param {object} data - Remote block data.
 * @returns {Promise<object>} Data to pass to `blocks.update`.
 */
const withRemovedKeys = async (api, data) => {
  if (!api || typeof api.save !== 'function' || !data || typeof data !== 'object') return data;
  let saved;
  try {
    saved = await api.save();
  } catch {
    return data;
  }
  const current = saved && saved.data && typeof saved.data === 'object' ? saved.data : null;
  if (!current) return data;
  const removed = Object.keys(current).filter((name) => !Object.prototype.hasOwnProperty.call(data, name));
  if (!removed.length) return data;
  const out = { ...data };
  for (const name of removed) out[name] = undefined;
  return out;
};

/**
 * True when the block the editor shows (its `blockKey`) differs from `block` only in `data.values`
 * (component blocks, 2.5).
 * @param {string|undefined} shownKey - `blockKey` of the shown block.
 * @param {{ type: string, data: object, tunes?: object }} block - Desired block.
 * @returns {boolean} Result.
 */
const sameExceptValues = (shownKey, block) => {
  if (typeof shownKey !== 'string') return false;
  try {
    const shown = JSON.parse(shownKey);
    const strip = (data) => ({ ...(data || {}), values: null });
    return (
      shown.type === block.type &&
      stableStringify(strip(shown.data)) === stableStringify(strip(block.data)) &&
      stableStringify(shown.tunes) === stableStringify(meaningfulTunes(block.tunes))
    );
  } catch {
    return false;
  }
};

/**
 * Applies `target` to the editor.
 * @param {object} editor - Editor.js instance (ready).
 * @param {{ blocks: Array<{ id: string, type: string, data: object, tunes?: object }> }} target - Desired document.
 * @param {Map<string, string>} known - id -> blockKey of what the editor currently shows (updated in place).
 * @param {{ display?: (data: object, block: object) => object, live?: boolean }} [options] - `live` (2.6): a live
 *   room snapshot (component blocks keep local edits not pushed yet). `display` maps the data handed to
 *   Editor.js (2.5: signed media URLs of private upload providers); comparisons use the target as given.
 * @returns {Promise<'patched'|'rendered'>} How the change was applied.
 */
export const applyToEditor = async (
  editor,
  target,
  known,
  { display = (data) => data, live = false } = {}
) => {
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
        deleteBlockKeepingFocus(editor, index);
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
          editor.blocks.insert(
            block.type,
            display(block.data, block),
            undefined,
            index,
            false,
            false,
            block.id
          );
          if (block.tunes) await editor.blocks.update(block.id, display(block.data, block), block.tunes);
          known.set(block.id, blockKey(block));
          continue;
        }
      }
      const key = blockKey(block);
      if (known.get(block.id) === key) continue;
      // 2.5: a component block takes a collaborator's values in place (keeps focus in its form)
      // when only its values changed (same component, same tunes).
      if (block.type === 'component' && sameExceptValues(known.get(block.id), block)) {
        if (applyComponentValues(block.id, block.data, { keepPending: live })) {
          known.set(block.id, key);
          continue;
        }
      }
      const api = editor.blocks.getBlockByIndex(index);
      const holder = api && api.holder;
      // The caret may be in any input of the block (table cells, captions): remember which one.
      const editables = holder ? Array.from(holder.querySelectorAll('[contenteditable="true"]')) : [];
      let slot = -1;
      let offset = null;
      for (let i = 0; i < editables.length && slot < 0; i += 1) {
        offset = caretOffset(editables[i]);
        if (offset !== null) slot = i;
      }
      let mapped = offset;
      // 2.6: an input inside an element with `data-mex-key` (a column item) keeps the caret by
      // that key, so an item added or removed before it by someone else does not move it.
      const keyed = slot >= 0 ? editables[slot].closest('[data-mex-key]') : null;
      const caretKey = keyed && holder.contains(keyed) ? keyed.getAttribute('data-mex-key') : null;
      const textBeforeUpdate = slot >= 0 ? editables[slot].textContent || '' : '';
      if (offset !== null && slot === 0 && !caretKey) {
        const before = editables[0].textContent || '';
        const after = plainText(block.data);
        let prefix = 0;
        while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
          prefix += 1;
        if (prefix < offset) mapped = Math.max(0, offset + (after.length - before.length));
      }
      await editor.blocks.update(
        block.id,
        await withRemovedKeys(api, display(block.data, block)),
        block.tunes
      );
      known.set(block.id, key);
      if (mapped !== null) {
        const updated = editor.blocks.getBlockByIndex(index);
        const inputs =
          updated && updated.holder ? updated.holder.querySelectorAll('[contenteditable="true"]') : [];
        let target2 = inputs[slot] || inputs[0];
        if (caretKey && updated && updated.holder) {
          const owner = Array.from(updated.holder.querySelectorAll('[data-mex-key]')).find(
            (node) => node.getAttribute('data-mex-key') === caretKey
          );
          const input = owner && owner.querySelector('[contenteditable="true"]');
          if (input) {
            target2 = input;
            // Same mapping as the first input: text changed before the caret shifts it.
            const after = input.textContent || '';
            let prefix = 0;
            while (
              prefix < textBeforeUpdate.length &&
              prefix < after.length &&
              textBeforeUpdate[prefix] === after[prefix]
            )
              prefix += 1;
            mapped =
              prefix < offset ? Math.max(0, offset + (after.length - textBeforeUpdate.length)) : offset;
          }
        }
        if (target2) placeCaret(target2, Math.min(mapped, (target2.textContent || '').length));
      }
    }
    while (editor.blocks.getBlocksCount() > blocks.length)
      deleteBlockKeepingFocus(editor, editor.blocks.getBlocksCount() - 1);
    return 'patched';
  } catch {
    known.clear();
    if (blocks.length === 0) await editor.blocks.clear();
    else
      await editor.render({
        time: target.time || Date.now(),
        blocks: blocks.map((block) => ({ ...block, data: display(block.data, block) })),
        version: target.version,
      });
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

import { allowShortcut, matchBlockShortcut, matchInlineShortcut } from './markdown-shortcuts-logic.mjs';

/**
 * Markdown shortcuts while typing (see markdown-shortcuts-logic.mjs): block
 * markers at the start of a paragraph and inline marks closed by `*`, `_`,
 * `~` or a backtick. Never inside code, raw HTML, tables or form inputs, and
 * only for blocks and marks the field preset allows.
 */

const INLINE_TOOL_OF = { b: 'bold', i: 'italic', s: 'strikethrough', code: 'inlineCode' };
const INLINE_CLASS_OF = { s: 'cdx-strikethrough', code: 'inline-code' };
const SKIP =
  '.ce-code, .ce-rawtool, .cdx-input--code, .mex-code, .tc-table, .tc-wrap, input, textarea, select';

/**
 * Text from the start of `root` up to the caret.
 * @param {HTMLElement} root - Editable element.
 * @param {Range} caret - Collapsed range.
 * @returns {string} Text.
 */
const textBefore = (root, caret) => {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(caret.startContainer, caret.startOffset);
  return range.toString();
};

/**
 * Installs the shortcuts on an editor.
 * @param {{ holder: HTMLElement, editor: object, getPreset: () => object|null, hasTool: (name: string) => boolean, onConverted?: () => void }} options - Options.
 * @returns {{ destroy: () => void }} Handle.
 */
export const createMarkdownShortcuts = ({ holder, editor, getPreset, hasTool, onConverted }) => {
  const currentParagraph = () => {
    const index = editor.blocks.getCurrentBlockIndex();
    const block = index >= 0 ? editor.blocks.getBlockByIndex(index) : null;
    if (!block || block.name !== 'paragraph' || !block.holder) return null;
    const editable = block.holder.querySelector('[contenteditable="true"]');
    return editable ? { index, block, editable } : null;
  };

  const onKeyDown = (event) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key === ' ' ? 'space' : event.key === 'Enter' && !event.shiftKey ? 'enter' : null;
    if (!key || (editor.readOnly && editor.readOnly.isEnabled)) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const current = currentParagraph();
    if (!current || !current.editable.contains(selection.anchorNode)) return;
    const before = textBefore(current.editable, selection.getRangeAt(0));
    // Only a marker on its own: nothing else in the paragraph.
    if (before !== current.editable.textContent) return;
    const block = allowShortcut(matchBlockShortcut(before, key), getPreset(), hasTool);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    editor.blocks.insert(block.type, block.data, undefined, current.index, true, true);
    // Put the caret into the new block right away, so the next keystroke
    // (which may follow within milliseconds) lands there.
    let placed = false;
    try {
      placed = editor.caret.setToBlock(current.index, 'start');
    } catch {
      placed = false;
    }
    if (!placed)
      window.requestAnimationFrame(() => {
        try {
          editor.caret.setToBlock(current.index, 'start');
        } catch {
          // the block is still rendering; the caret stays where Editor.js put it
        }
      });
    if (onConverted) onConverted();
  };

  // After an inline mark is created the caret sits in a zero-width space
  // behind it, so typing continues outside the mark. The space is removed
  // as soon as the next character arrives (or when the editor loses focus).
  let spacer = null;
  const dropSpacer = () => {
    if (!spacer) return;
    const node = spacer;
    spacer = null;
    if (!node.isConnected || !node.data.includes('\u200b')) return;
    const selection = window.getSelection();
    const inside = selection && selection.anchorNode === node;
    const offset = inside ? selection.anchorOffset : 0;
    const before = node.data.slice(0, offset).split('\u200b').length - 1;
    node.data = node.data.replace(/\u200b/g, '');
    if (inside) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - before));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (!node.data) node.remove();
  };

  const onInput = (event) => {
    if (spacer && event.target && event.target.contains && event.target.contains(spacer)) dropSpacer();
    if (event.inputType !== 'insertText' || !['*', '_', '~', '`'].includes(event.data)) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const node = selection.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !holder.contains(node)) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP) || !parent.closest('[contenteditable="true"]')) return;
    if (parent.closest('code, a')) return;
    const match = matchInlineShortcut(node.data.slice(0, selection.anchorOffset));
    if (!match) return;
    const preset = getPreset();
    const tool = INLINE_TOOL_OF[match.tag];
    if (!hasTool(tool) || (preset && preset.inline && !preset.inline.includes(tool))) return;
    const range = document.createRange();
    range.setStart(node, match.start);
    range.setEnd(node, match.end);
    const element = document.createElement(match.tag);
    if (INLINE_CLASS_OF[match.tag]) element.className = INLINE_CLASS_OF[match.tag];
    element.textContent = match.text;
    range.deleteContents();
    range.insertNode(element);
    dropSpacer();
    spacer = document.createTextNode('\u200b');
    element.after(spacer);
    const after = document.createRange();
    after.setStart(spacer, 1);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    if (onConverted) onConverted();
  };

  const onFocusOut = () => dropSpacer();

  holder.addEventListener('keydown', onKeyDown, true);
  holder.addEventListener('input', onInput);
  holder.addEventListener('focusout', onFocusOut);
  return {
    destroy: () => {
      holder.removeEventListener('keydown', onKeyDown, true);
      holder.removeEventListener('input', onInput);
      holder.removeEventListener('focusout', onFocusOut);
    },
  };
};

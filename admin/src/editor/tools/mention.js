import { ICONS, el } from './dom';
import { createLinkPicker } from './link-picker';
import { mentionAttributes, mentionText } from './logic.mjs';
import { LINK_SANITIZE } from './sanitize-config';

/**
 * Mentions (inline entry references, 2.3): a chip that references an entry,
 * stored as an internal link with the mention flag:
 * `<a href data-mex-uid data-mex-document-id data-mex-locale data-mex-mention="true">Title</a>`.
 * Because it is an internal link, every existing rule applies unchanged:
 * `cleanInternalLinkAttributes` on both sides, field presets (`linkTargets`),
 * the link check and the reference resolution of API output (which also
 * replaces the chip text with the entry's current title when the caller may
 * read it).
 *
 * Insert: select a word (or more), then the toolbar button or Ctrl/Cmd+Shift+2;
 * the entry picker opens with the selection as search text. Picking an entry
 * replaces the selection with the chip. On an existing chip the button
 * removes the mention and keeps its text.
 *
 * The chip text stays editable HTML (Editor.js inline content); Backspace and
 * Delete next to a chip remove the whole chip, and typing at its edge goes
 * after it (`createMentionKeys`).
 */

/** Selector of a mention chip in the editor. */
export const MENTION_SELECTOR = 'a[data-mex-mention]';

/**
 * Closest mention chip of a node.
 * @param {Node|null} node - Node.
 * @returns {HTMLElement|null} Chip.
 */
const mentionOf = (node) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  return element && typeof element.closest === 'function' ? element.closest(MENTION_SELECTOR) : null;
};

/**
 * Tells Editor.js and the field that the block content changed.
 * @param {Node} node - Node inside the block.
 */
const notifyInput = (node) => {
  const editable = node && node.parentElement ? node.parentElement.closest('[contenteditable="true"]') : null;
  if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
};

export class MentionTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return 'Mention';
  }

  static get sanitize() {
    return { a: { ...LINK_SANITIZE } };
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    this.button = null;
    this.actions = null;
    this.picker = null;
    this.range = null;
  }

  get shortcut() {
    return 'CMD+SHIFT+2';
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  render() {
    this.button = el('button', {
      className: this.api.styles.inlineToolButton,
      attrs: { type: 'button', 'aria-label': this.t('tools.mention.title', 'Mention an entry') },
    });
    this.button.innerHTML = ICONS.mention;
    return this.button;
  }

  renderActions() {
    this.picker = createLinkPicker({
      t: (id, fallback, values) => this.t(id, fallback, values),
      fetchClient: this.config.fetchClient,
      getLocale: this.config.getLocale,
      label: this.t('tools.mention.title', 'Mention an entry'),
      onPick: (item) => this.insert(item),
      onClose: () => {
        if (this.actions) this.actions.hidden = true;
      },
    });
    this.actions = el('div', { className: 'mex-inline-actions', children: [this.picker.element] });
    this.actions.hidden = true;
    return this.actions;
  }

  surround(range) {
    if (!range) return;
    const existing = mentionOf(range.commonAncestorContainer);
    if (existing) {
      // Toggle off: the chip becomes plain text.
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
      notifyInput(parent.firstChild || parent);
      this.api.inlineToolbar.close();
      return;
    }
    if (!this.picker || !this.config.fetchClient) return;
    this.range = range.cloneRange();
    this.actions.hidden = false;
    this.picker.open(range.toString());
  }

  /**
   * Replaces the remembered selection with a chip for the picked entry.
   * @param {{ href: string, uid: string, documentId: string, locale: string|null, title?: string }} item - Search result.
   */
  insert(item) {
    const range = this.range;
    const attrs = mentionAttributes(item);
    if (!range || !attrs) return;
    const chip = document.createElement('a');
    for (const [name, value] of Object.entries(attrs)) chip.setAttribute(name, value);
    chip.textContent = mentionText(
      item,
      range.toString(),
      this.t('tools.hyperlink.internal.untitled', 'Untitled entry')
    );
    range.deleteContents();
    range.insertNode(chip);
    // A space after the chip so typing continues outside of it.
    const next = chip.nextSibling;
    const space =
      next && next.nodeType === Node.TEXT_NODE && /^[\s\u00a0]/.test(next.data)
        ? null
        : document.createTextNode('\u00a0');
    if (space) chip.after(space);
    this.range = null;
    if (this.picker && this.picker.isOpen()) this.picker.close();
    this.api.inlineToolbar.close();
    const caret = document.createRange();
    if (space) caret.setStart(space, 1);
    else caret.setStart(chip.nextSibling, 1);
    caret.collapse(true);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    notifyInput(chip);
  }

  checkState() {
    const selection = window.getSelection();
    const active = Boolean(selection && selection.rangeCount && mentionOf(selection.anchorNode));
    if (this.button) this.button.classList.toggle(this.api.styles.inlineToolButtonActive, active);
    return active;
  }

  clear() {
    if (this.picker && this.picker.isOpen()) this.picker.close();
    this.range = null;
  }
}

/**
 * Keyboard behaviour of mention chips inside the editor holder: Backspace
 * right after a chip (or inside it) and Delete right before it remove the
 * whole chip; a printable key with the caret at the end of a chip types
 * after the chip instead of extending its text.
 * @param {{ holder: HTMLElement }} options - Editor holder.
 * @returns {{ destroy: () => void }} Handle.
 */
export const createMentionKeys = ({ holder }) => {
  /**
   * Chip that a collapsed caret touches in the given direction.
   * @param {Range} range - Collapsed range.
   * @param {'back'|'forward'} direction - Direction.
   * @returns {HTMLElement|null} Chip.
   */
  const touching = (range, direction) => {
    const inside = mentionOf(range.startContainer);
    if (inside) return inside;
    const { startContainer: container, startOffset: offset } = range;
    let sibling = null;
    if (container.nodeType === Node.TEXT_NODE) {
      const atEdge = direction === 'back' ? offset === 0 : offset === container.data.length;
      if (atEdge) sibling = direction === 'back' ? container.previousSibling : container.nextSibling;
    } else {
      sibling = container.childNodes[direction === 'back' ? offset - 1 : offset] || null;
    }
    return sibling && sibling.nodeType === Node.ELEMENT_NODE && sibling.matches(MENTION_SELECTOR)
      ? sibling
      : null;
  };

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!holder.contains(range.startContainer)) return;
    // Only in editable text (not in read-only mode, inputs or tool forms).
    const container =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    if (!container || !container.closest('[contenteditable="true"]')) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const chip = touching(range, event.key === 'Backspace' ? 'back' : 'forward');
      if (!chip) return;
      event.preventDefault();
      event.stopPropagation();
      const parent = chip.parentNode;
      const caret = document.createRange();
      caret.setStartBefore(chip);
      caret.collapse(true);
      chip.remove();
      selection.removeAllRanges();
      selection.addRange(caret);
      notifyInput(parent.firstChild || parent);
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const chip = mentionOf(range.startContainer);
    if (!chip) return;
    const end = document.createRange();
    end.selectNodeContents(chip);
    end.collapse(false);
    if (range.compareBoundaryPoints(Range.START_TO_START, end) !== 0) return;
    // At the end of a chip: continue after it.
    const after = document.createRange();
    after.setStartAfter(chip);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  };

  holder.addEventListener('keydown', onKeyDown, true);
  return {
    destroy() {
      holder.removeEventListener('keydown', onKeyDown, true);
    },
  };
};

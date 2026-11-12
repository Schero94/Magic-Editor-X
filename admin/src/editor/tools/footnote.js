import { ICONS, el } from './dom';
import { SUP_SANITIZE } from './sanitize-config';
import { newFootnoteId } from './footnote-logic.mjs';
import { mathOf } from './inline-math';

/**
 * Footnotes (2.4): a marker `<sup data-mex-footnote="id" data-mex-note="note HTML">n</sup>`
 * at the caret. The note lives in its marker, so it moves, copies, undoes and
 * merges (collaboration) together with it. Numbers follow the reading order:
 * the editor shows them with a CSS counter, the renderers compute them.
 *
 * In the editor a marker is atomic (`contenteditable="false"`, DOM only:
 * Editor.js drops the attribute on save because the sanitize rule lists only
 * the footnote attributes); Backspace/Delete next to it remove it, a click
 * on it or Ctrl/Cmd+Alt+F next to it opens its note. The note dialog and the footnote list are
 * React components of the field (`config.onEdit`).
 */

/** Selector of a footnote marker in the editor. */
export const FOOTNOTE_SELECTOR = 'sup[data-mex-footnote]';

/**
 * Closest footnote marker of a node.
 * @param {Node|null} node - Node.
 * @returns {HTMLElement|null} Marker.
 */
export const footnoteOf = (node) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  return element && typeof element.closest === 'function' ? element.closest(FOOTNOTE_SELECTOR) : null;
};

/**
 * Tells Editor.js and the field that the block content changed.
 * @param {Node} node - Node inside the block.
 */
export const notifyFootnoteInput = (node) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  const editable = element ? element.closest('[contenteditable="true"]') : null;
  if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
};

/**
 * Makes rendered markers atomic in the editor DOM. `data-mutation-free`
 * keeps Editor.js from treating this attribute change as an edit. Markers
 * the tool inserts are created with `contenteditable="false"` and without
 * `data-mutation-free`, so Editor.js sees the insertion; `releaseFootnote`
 * removes the flag before a marker changes.
 * @param {ParentNode} root - Holder or a node inside it.
 */
export const lockFootnotes = (root) => {
  const markers =
    root.nodeType === Node.ELEMENT_NODE && root.matches(FOOTNOTE_SELECTOR)
      ? [root]
      : Array.from(root.querySelectorAll ? root.querySelectorAll(FOOTNOTE_SELECTOR) : []);
  for (const marker of markers) {
    if (marker.getAttribute('contenteditable') === 'false') continue;
    marker.setAttribute('data-mutation-free', 'true');
    marker.setAttribute('contenteditable', 'false');
  }
};

/**
 * Lets Editor.js see the next change of a marker (its note, its removal):
 * Editor.js ignores mutations of `data-mutation-free` elements.
 * @param {HTMLElement} marker - Marker.
 * @returns {HTMLElement} The marker.
 */
export const releaseFootnote = (marker) => {
  if (marker && marker.hasAttribute('data-mutation-free')) marker.removeAttribute('data-mutation-free');
  return marker;
};

/**
 * Inserts a new marker after a range (a selection is kept as text) and
 * returns it. A space follows it so typing continues after the marker.
 * @param {Range} range - Range inside editable text.
 * @returns {HTMLElement} Marker.
 */
export const insertFootnote = (range) => {
  const end = range.cloneRange();
  end.collapse(false);
  // Never inside inline math (its content is TeX text): after the formula instead.
  const formula = mathOf(end.startContainer);
  if (formula) end.setStartAfter(formula);
  end.collapse(true);
  const marker = document.createElement('sup');
  marker.setAttribute('data-mex-footnote', newFootnoteId());
  // Placeholder text: numbers are shown by CSS and computed by the renderers.
  marker.textContent = '*';
  // Atomic from the start, without `data-mutation-free`, so Editor.js records the insertion.
  marker.setAttribute('contenteditable', 'false');
  end.insertNode(marker);
  const next = marker.nextSibling;
  if (!(next && next.nodeType === Node.TEXT_NODE && next.data.length))
    marker.after(document.createTextNode('\u00a0'));
  const selection = window.getSelection();
  if (selection) {
    const caret = document.createRange();
    caret.setStartAfter(marker);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  notifyFootnoteInput(marker);
  return marker;
};

export class FootnoteTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return 'Footnote';
  }

  static get sanitize() {
    return { sup: { ...SUP_SANITIZE } };
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    this.button = null;
  }

  t(id, fallback) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback) : fallback;
  }

  render() {
    this.button = el('button', {
      className: this.api.styles.inlineToolButton,
      attrs: { type: 'button', 'aria-label': this.t('tools.footnote.title', 'Footnote') },
    });
    this.button.innerHTML = ICONS.footnote;
    return this.button;
  }

  surround(range) {
    if (!range) return;
    this.api.inlineToolbar.close();
    const existing = footnoteOf(range.commonAncestorContainer);
    const marker = existing || insertFootnote(range);
    if (typeof this.config.onEdit === 'function') this.config.onEdit(marker, { isNew: !existing });
  }

  checkState() {
    const selection = window.getSelection();
    const active = Boolean(selection && selection.rangeCount && footnoteOf(selection.anchorNode));
    if (this.button) this.button.classList.toggle(this.api.styles.inlineToolButtonActive, active);
    return active;
  }
}

/**
 * Footnote behaviour inside an editor holder: markers are kept atomic,
 * Ctrl/Cmd+Alt+F inserts a footnote at the caret (or opens the note of the
 * marker next to it), Backspace/Delete next to a marker remove it, a click
 * on a marker opens its note.
 * @param {{ holder: HTMLElement, onEdit: (marker: HTMLElement, info: { isNew: boolean }) => void, enabled: () => boolean, readOnly: () => boolean }} options - Options.
 * @returns {{ destroy: () => void }} Handle.
 */
export const createFootnoteKeys = ({ holder, onEdit, enabled, readOnly }) => {
  lockFootnotes(holder);
  const observer =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((mutations) => {
          for (const mutation of mutations)
            for (const node of mutation.addedNodes)
              if (node.nodeType === Node.ELEMENT_NODE) lockFootnotes(node);
        });
  if (observer) observer.observe(holder, { childList: true, subtree: true });

  /**
   * Marker that a collapsed caret touches in a direction.
   * @param {Range} range - Collapsed range.
   * @param {'back'|'forward'} direction - Direction.
   * @returns {HTMLElement|null} Marker.
   */
  const touching = (range, direction) => {
    const { startContainer: container, startOffset: offset } = range;
    let sibling = null;
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.data;
      // A non-breaking space we added after a marker counts as the edge too.
      const atEdge = direction === 'back' ? offset === 0 : offset === text.length;
      if (atEdge) sibling = direction === 'back' ? container.previousSibling : container.nextSibling;
    } else {
      sibling = container.childNodes[direction === 'back' ? offset - 1 : offset] || null;
    }
    return sibling && sibling.nodeType === Node.ELEMENT_NODE && sibling.matches(FOOTNOTE_SELECTOR)
      ? sibling
      : null;
  };

  const editableAt = (node) => {
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return element ? element.closest('[contenteditable="true"]') : null;
  };

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.isComposing || readOnly()) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!holder.contains(range.startContainer) || !editableAt(range.startContainer)) return;
    const mod = event.ctrlKey || event.metaKey;
    const altGraph = typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');
    if (mod && event.altKey && !event.shiftKey && !altGraph && event.code === 'KeyF') {
      event.preventDefault();
      event.stopPropagation();
      const near = selection.isCollapsed ? touching(range, 'back') || touching(range, 'forward') : null;
      if (near) onEdit(near, { isNew: false });
      else if (enabled() && !footnoteOf(range.startContainer)) onEdit(insertFootnote(range), { isNew: true });
      return;
    }
    if (!selection.isCollapsed || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
    const marker = touching(range, event.key === 'Backspace' ? 'back' : 'forward');
    if (!marker) return;
    event.preventDefault();
    event.stopPropagation();
    const parent = marker.parentNode;
    const caret = document.createRange();
    caret.setStartBefore(marker);
    caret.collapse(true);
    releaseFootnote(marker).remove();
    selection.removeAllRanges();
    selection.addRange(caret);
    notifyFootnoteInput(parent.firstChild || parent);
  };

  const onClick = (event) => {
    const marker = footnoteOf(event.target);
    if (!marker || !holder.contains(marker)) return;
    event.preventDefault();
    onEdit(marker, { isNew: false });
  };

  holder.addEventListener('keydown', onKeyDown, true);
  holder.addEventListener('click', onClick);
  return {
    destroy() {
      if (observer) observer.disconnect();
      holder.removeEventListener('keydown', onKeyDown, true);
      holder.removeEventListener('click', onClick);
    },
  };
};

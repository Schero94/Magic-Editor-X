import { ICONS, el } from './dom';
import { SPAN_SANITIZE } from './sanitize-config';
import { loadMath, renderMathInto } from '../math-view';
import { MAX_INLINE_TEX } from '../../../../shared/sanitize-policy.mjs';

/**
 * Inline math (2.4): `<span data-mex-math="true">TeX</span>` inside text.
 * The TeX source stays editable text of the block (so collaboration, undo,
 * find and copy/paste treat it like any text); a popover under the formula
 * shows the rendered preview or the parser's error while the caret is in it.
 *
 * - Toolbar button: wraps the selected text as TeX, or turns a formula back
 *   into plain text.
 * - Ctrl/Cmd+Shift+E (`createInlineMathKeys`): the same with a selection,
 *   or inserts an empty formula at the caret.
 */

/** Selector of inline math in the editor. */
export const INLINE_MATH_SELECTOR = 'span[data-mex-math]';

/**
 * Closest inline math element of a node.
 * @param {Node|null} node - Node.
 * @returns {HTMLElement|null} Element.
 */
export const mathOf = (node) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  return element && typeof element.closest === 'function' ? element.closest(INLINE_MATH_SELECTOR) : null;
};

/**
 * Tells Editor.js and the field that the block content changed.
 * @param {Node} node - Node inside the block.
 */
const notifyInput = (node) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  const editable = element ? element.closest('[contenteditable="true"]') : null;
  if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
};

/**
 * Places the caret in a text node.
 * @param {Node} node - Text node (or element: caret at its end).
 * @param {number} [offset] - Offset (default: end).
 */
const placeCaret = (node, offset) => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const length = node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length;
  range.setStart(node, offset === undefined ? length : offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Wraps a range as inline math (the selected text becomes the TeX source),
 * or inserts an empty formula at a collapsed range. A space follows the
 * formula so typing can continue after it.
 * @param {Range} range - Range inside editable text.
 * @returns {HTMLElement} The formula element.
 */
export const insertInlineMath = (range) => {
  const tex = range.toString().replace(/\s+/g, ' ').slice(0, MAX_INLINE_TEX);
  const span = document.createElement('span');
  span.setAttribute('data-mex-math', 'true');
  span.textContent = tex;
  range.deleteContents();
  range.insertNode(span);
  const next = span.nextSibling;
  if (!(next && next.nodeType === Node.TEXT_NODE && /^[\s\u00a0]/.test(next.data)))
    span.after(document.createTextNode('\u00a0'));
  if (!tex) {
    // An empty element cannot hold the caret: a zero-width text that the first key replaces.
    span.textContent = '\u200b';
    placeCaret(span.firstChild, 1);
  } else placeCaret(span.firstChild);
  notifyInput(span);
  return span;
};

/**
 * Turns a formula back into plain text (its TeX source).
 * @param {HTMLElement} span - Formula element.
 */
export const unwrapInlineMath = (span) => {
  const parent = span.parentNode;
  if (!parent) return;
  const text = document.createTextNode((span.textContent || '').replace(/\u200b/g, ''));
  parent.replaceChild(text, span);
  placeCaret(text);
  notifyInput(text);
};

export class InlineMathTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return 'Inline math';
  }

  static get sanitize() {
    return { span: { ...SPAN_SANITIZE } };
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
      attrs: { type: 'button', 'aria-label': this.t('tools.inlineMath.title', 'Inline math') },
    });
    this.button.innerHTML = ICONS.inlineMath;
    return this.button;
  }

  surround(range) {
    if (!range) return;
    const existing = mathOf(range.commonAncestorContainer);
    if (existing) unwrapInlineMath(existing);
    else insertInlineMath(range);
    this.api.inlineToolbar.close();
  }

  checkState() {
    const selection = window.getSelection();
    const active = Boolean(selection && selection.rangeCount && mathOf(selection.anchorNode));
    if (this.button) this.button.classList.toggle(this.api.styles.inlineToolButtonActive, active);
    return active;
  }
}

/**
 * Keyboard shortcut and preview popover of inline math inside an editor
 * holder. The popover is a polite live region under the formula with the
 * rendered MathML, or the error; Escape hides it until the caret leaves the
 * formula.
 * @param {{ holder: HTMLElement, t: Function, enabled: () => boolean }} options - Holder, translator, whether inserting is allowed (field preset).
 * @returns {{ destroy: () => void }} Handle.
 */
export const createInlineMathKeys = ({ holder, t, enabled }) => {
  const tr = typeof t === 'function' ? t : (_id, fallback) => fallback;
  const popover = el('div', {
    className: 'mex-math-popover',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': tr('tools.inlineMath.preview', 'Formula preview'),
    },
  });
  popover.hidden = true;
  const body = el('div', { className: 'mex-math-popover__body' });
  const error = el('p', { className: 'mex-math-popover__error' });
  popover.append(body, error);
  // Next to the holder (not inside it), so Editor.js never sees it.
  holder.after(popover);
  let current = null;
  let dismissed = null;
  let timer = null;

  const hide = () => {
    popover.hidden = true;
    current = null;
  };

  const show = (span) => {
    const tex = (span.textContent || '').replace(/\u200b/g, '');
    current = span;
    popover.hidden = false;
    const box = span.getBoundingClientRect();
    const parent = popover.offsetParent || document.body;
    const origin = parent.getBoundingClientRect();
    const width = Math.min(popover.offsetWidth || 240, origin.width);
    const left = Math.max(0, Math.min(box.left - origin.left, origin.width - width));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(box.bottom - origin.top + 6)}px`;
    if (!tex.trim()) {
      body.replaceChildren();
      error.textContent = tr('tools.inlineMath.empty', 'Type TeX, for example x^2');
      error.classList.remove('mex-math-popover__error--invalid');
      return;
    }
    loadMath()
      .then((math) => {
        if (current !== span) return;
        const message = renderMathInto(body, math, tex, false);
        error.textContent = message
          ? tr('tools.math.invalid', 'This TeX does not work: {message}', { message })
          : '';
        error.classList.toggle('mex-math-popover__error--invalid', Boolean(message));
      })
      .catch(() => {
        error.textContent = tr('tools.math.unavailable', 'The preview could not be loaded.');
      });
  };

  const update = () => {
    const selection = window.getSelection();
    const span =
      selection && selection.rangeCount && holder.contains(selection.anchorNode)
        ? mathOf(selection.anchorNode)
        : null;
    if (!span || !holder.contains(span)) {
      dismissed = null;
      hide();
      return;
    }
    if (span === dismissed) return;
    show(span);
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 80);
  };

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape' && current) {
      dismissed = current;
      hide();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || !event.shiftKey || event.altKey || (event.key || '').toLowerCase() !== 'e') return;
    if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const container =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    if (!container || !holder.contains(container) || !container.closest('[contenteditable="true"]')) return;
    if (container.closest('[data-mex-footnote]')) return;
    event.preventDefault();
    event.stopPropagation();
    const existing = mathOf(range.startContainer);
    if (existing) unwrapInlineMath(existing);
    else if (enabled()) insertInlineMath(range);
    schedule();
  };

  /** Typing replaces the zero-width placeholder of an empty formula. */
  const onInput = () => {
    if (!current) return schedule();
    const text = current.firstChild;
    if (text && text.nodeType === Node.TEXT_NODE && text.data.length > 1 && text.data.includes('\u200b')) {
      const selection = window.getSelection();
      const offset = selection && selection.anchorNode === text ? selection.anchorOffset : null;
      const before = text.data.slice(0, offset || 0).split('\u200b').length - 1;
      text.data = text.data.replace(/\u200b/g, '');
      if (offset !== null) placeCaret(text, Math.max(0, offset - before));
    }
    schedule();
  };

  document.addEventListener('selectionchange', schedule);
  holder.addEventListener('keydown', onKeyDown, true);
  holder.addEventListener('input', onInput, true);
  window.addEventListener('resize', schedule);
  return {
    destroy() {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', schedule);
      holder.removeEventListener('keydown', onKeyDown, true);
      holder.removeEventListener('input', onInput, true);
      window.removeEventListener('resize', schedule);
      popover.remove();
    },
  };
};

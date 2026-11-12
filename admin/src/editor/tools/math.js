import { ICONS, el, field, select } from './dom';
import { loadMath, renderMathInto } from '../math-view';
import { MAX_MATH_TEX } from '../../../../shared/sanitize-policy.mjs';

/**
 * Math block (`math`, 2.4): `{ tex, display }` (the built-in marker is added
 * by `markedTool`). Only the TeX source is stored; the block shows a live
 * MathML preview rendered with Temml, loaded on demand. Invalid TeX shows the
 * parser's message under the input and an empty preview; nothing is thrown
 * and no partial markup is shown.
 */

const PREVIEW_DELAY_MS = 120;

export class MathTool {
  static get toolbox() {
    return { title: 'Math', icon: ICONS.math };
  }

  static get isReadOnlySupported() {
    return true;
  }

  /** Enter adds a line to the TeX instead of a new block. */
  static get enableLineBreaks() {
    return true;
  }

  /** The TeX source is plain text, never HTML: Editor.js must keep it as it is. */
  static get sanitize() {
    return { tex: true };
  }

  constructor({ data, config, readOnly, block }) {
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    const source = data && typeof data === 'object' ? data : {};
    this.data = {
      tex: typeof source.tex === 'string' ? source.tex.slice(0, MAX_MATH_TEX) : '',
      display: source.display !== false,
    };
    this.nodes = {};
    this.timer = null;
    this.id = `mex-math-${Math.random().toString(36).slice(2, 10)}`;
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  render() {
    const wrapper = el('div', { className: 'mex-math-tool' });
    this.nodes.preview = el('div', {
      className: ['mex-math-tool__preview', this.data.display ? 'mex-math-tool__preview--display' : ''],
      attrs: {
        id: `${this.id}-preview`,
        role: 'group',
        'aria-label': this.t('tools.math.preview', 'Formula preview'),
      },
    });
    this.nodes.error = el('p', {
      className: 'mex-math-tool__error',
      attrs: { id: `${this.id}-error`, role: 'status', 'aria-live': 'polite' },
    });
    this.nodes.error.hidden = true;
    if (this.readOnly) {
      wrapper.append(this.nodes.preview, this.nodes.error);
      this.refresh();
      return wrapper;
    }
    const label = el('label', {
      className: 'mex-tool__label',
      text: this.t('tools.math.label', 'TeX'),
      attrs: { for: `${this.id}-tex` },
    });
    this.nodes.input = el('textarea', {
      className: ['mex-tool__input', 'mex-math-tool__input'],
      attrs: {
        id: `${this.id}-tex`,
        rows: 2,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        maxlength: String(MAX_MATH_TEX),
        placeholder: this.t('tools.math.placeholder', 'Type TeX, for example x^2 + y^2'),
        'aria-describedby': `${this.id}-error`,
      },
    });
    this.nodes.input.value = this.data.tex;
    this.nodes.input.addEventListener('input', () => {
      this.data.tex = this.nodes.input.value.slice(0, MAX_MATH_TEX);
      this.schedule();
      this.changed();
    });
    // Tab leaves the input; Editor.js keeps Enter (line breaks) and Backspace inside the TeX.
    this.nodes.input.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' || (event.key === 'Backspace' && this.nodes.input.value))
        event.stopPropagation();
    });
    // Pasted text stays text in the input (no block conversion, no HTML).
    this.nodes.input.addEventListener('paste', (event) => event.stopPropagation());
    this.nodes.display = select(
      [
        { value: 'display', label: this.t('tools.math.styleDisplay', 'Display (own line, centred)') },
        { value: 'text', label: this.t('tools.math.styleText', 'Text size') },
      ],
      this.data.display ? 'display' : 'text'
    );
    this.nodes.display.addEventListener('change', () => {
      this.data.display = this.nodes.display.value !== 'text';
      this.nodes.preview.classList.toggle('mex-math-tool__preview--display', this.data.display);
      this.refresh();
      this.changed();
    });
    // Arrow keys and Enter belong to the select, not to Editor.js block navigation.
    this.nodes.display.addEventListener('keydown', (event) => {
      if (['Enter', 'ArrowUp', 'ArrowDown', 'Backspace', 'Tab'].includes(event.key)) event.stopPropagation();
    });
    const toggle = field(this.t('tools.math.style', 'Style'), this.nodes.display);
    wrapper.append(
      el('div', { className: 'mex-tool__field', children: [label, this.nodes.input] }),
      toggle,
      this.nodes.preview,
      this.nodes.error
    );
    this.refresh();
    return wrapper;
  }

  schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.refresh(), PREVIEW_DELAY_MS);
  }

  /** Re-renders the preview (loads the math helper the first time). */
  refresh() {
    const { preview } = this.nodes;
    if (!preview) return;
    const tex = this.data.tex;
    if (!tex.trim()) {
      preview.replaceChildren(
        el('span', {
          className: 'mex-tool__muted',
          text: this.t('tools.math.empty', 'The formula appears here.'),
        })
      );
      this.showError('');
      return;
    }
    loadMath()
      .then((math) => {
        if (this.data.tex !== tex || !preview.isConnected) return;
        this.showError(renderMathInto(preview, math, tex, this.data.display));
      })
      .catch(() => {
        this.showError(this.t('tools.math.unavailable', 'The preview could not be loaded.'));
      });
  }

  /**
   * Shows or clears the error under the input.
   * @param {string} message - Parser message ('' clears it).
   */
  showError(message) {
    const { error, input } = this.nodes;
    const text = message
      ? this.t('tools.math.invalid', 'This TeX does not work: {message}', { message })
      : '';
    if (error.textContent !== text) error.textContent = text;
    error.hidden = !text;
    if (input) {
      if (text) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  removed() {
    window.clearTimeout(this.timer);
  }

  save() {
    return { tex: this.data.tex, display: this.data.display };
  }

  validate() {
    return true;
  }
}

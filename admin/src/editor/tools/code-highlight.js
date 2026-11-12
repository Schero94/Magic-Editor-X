import Prism from './prism';
import { ICONS, el, input, select } from './dom';
import { normalizeCodeFlask } from './logic.mjs';
import { CODE_LANGUAGES, CODE_LANGUAGE_LABELS } from '../../../../shared/code-languages.mjs';
import { MAX_CODE_FILENAME, cleanCodeFilename } from '../../../../shared/sanitize-policy.mjs';

/**
 * Code block with syntax highlighting. Replaces @calumk/editorjs-codeflask
 * (archived) under the same block name `codeFlask` and data
 * `{ code, language, showlinenumbers, filename? }` (`filename`, 2.4: an
 * optional plain-text label shown above the code; omitted when empty).
 *
 * Editing happens in a plain textarea laid over a highlighted <pre>; the
 * highlighted markup comes from Prism, which escapes the code text.
 *
 * Languages come from the shared list (shared/code-languages.mjs), the same
 * ids the renderers write as `language-<id>`. A stored language outside the
 * list is kept and offered as an extra option (highlighted as plain text).
 */

/**
 * Display name of a language id.
 * @param {string} language - Language id.
 * @returns {string} Label.
 */
const labelOf = (language) => CODE_LANGUAGE_LABELS[language] || language;

/**
 * Options of the language select: the shared list plus a stored language outside it.
 * @param {string} current - Current language.
 * @returns {Array<{ value: string, label: string }>} Options.
 */
const languageOptions = (current) => {
  const ids = CODE_LANGUAGES.includes(current) ? CODE_LANGUAGES : [...CODE_LANGUAGES, current];
  return ids.map((value) => ({ value, label: labelOf(value) }));
};

/**
 * Highlights code with Prism (escaped output).
 * @param {string} code - Source.
 * @param {string} language - Language id.
 * @returns {string} HTML.
 */
const highlight = (code, language) => {
  const grammar = Prism.languages[language];
  const source = code.endsWith('\n') ? `${code} ` : code;
  if (!grammar || language === 'plaintext') return Prism.util.encode(source).toString();
  return Prism.highlight(source, grammar, language);
};

/** Keys the file name input keeps from Editor.js. */
const FILENAME_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export class CodeHighlightTool {
  static get toolbox() {
    return { title: 'Code (highlighted)', icon: ICONS.code };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get enableLineBreaks() {
    return true;
  }

  static get sanitize() {
    return { code: true, language: false, showlinenumbers: false, filename: false };
  }

  static get conversionConfig() {
    return { export: 'code', import: 'code' };
  }

  static get pasteConfig() {
    return { tags: ['PRE'] };
  }

  constructor({ data, config, api, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.data = normalizeCodeFlask(data, this.config);
    this.nodes = {};
  }

  t(id, fallback) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback) : fallback;
  }

  render() {
    const wrapper = el('div', { className: 'mex-code' });
    const header = el('div', { className: 'mex-code__header' });
    if (this.readOnly) {
      if (this.data.filename)
        header.appendChild(el('span', { className: 'mex-code__filename-text', text: this.data.filename }));
      header.appendChild(
        el('span', {
          className: 'mex-code__language',
          text: labelOf(this.data.language),
        })
      );
    } else {
      // 2.4: optional file name label (plain text; cleaned like the server policy on save).
      this.nodes.filename = input({
        value: this.data.filename,
        placeholder: this.t('tools.code.filenamePlaceholder', 'File name (optional)'),
      });
      this.nodes.filename.classList.add('mex-code__filename');
      this.nodes.filename.setAttribute('aria-label', this.t('tools.code.filename', 'File name'));
      this.nodes.filename.setAttribute('maxlength', String(MAX_CODE_FILENAME));
      this.nodes.filename.setAttribute('spellcheck', 'false');
      this.nodes.filename.setAttribute('autocomplete', 'off');
      // Typing, Enter and arrows belong to the input, not to Editor.js block navigation.
      this.nodes.filename.addEventListener('keydown', (event) => {
        if (FILENAME_KEYS.has(event.key)) event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          if (this.nodes.input) this.nodes.input.focus();
        }
      });
      this.nodes.filename.addEventListener('paste', (event) => event.stopPropagation());
      this.nodes.filename.addEventListener('input', () => {
        this.data.filename = this.nodes.filename.value;
        this.changed();
      });
      header.appendChild(this.nodes.filename);
      this.nodes.language = select(languageOptions(this.data.language), this.data.language);
      this.nodes.language.setAttribute('aria-label', this.t('tools.code.language', 'Language'));
      // Arrow keys and Enter belong to the select, not to Editor.js block navigation.
      this.nodes.language.addEventListener('keydown', (event) => {
        if (['Enter', 'ArrowUp', 'ArrowDown', 'Backspace', 'Tab'].includes(event.key))
          event.stopPropagation();
      });
      this.nodes.language.addEventListener('change', () => {
        this.data.language = this.nodes.language.value;
        this.paint();
        this.changed();
      });
      header.appendChild(this.nodes.language);
    }
    const body = el('div', { className: 'mex-code__body' });
    this.nodes.gutter = el('div', { className: 'mex-code__gutter', attrs: { 'aria-hidden': 'true' } });
    this.nodes.pre = el('pre', {
      className: 'mex-code__pre',
      attrs: { 'aria-hidden': this.readOnly ? null : 'true' },
    });
    this.nodes.code = el('code', { className: 'mex-code__code' });
    this.nodes.pre.appendChild(this.nodes.code);
    const stack = el('div', { className: 'mex-code__stack', children: [this.nodes.pre] });
    if (!this.readOnly) {
      this.nodes.input = el('textarea', {
        className: 'mex-code__input',
        attrs: {
          spellcheck: 'false',
          autocapitalize: 'off',
          autocomplete: 'off',
          'aria-label': this.t('tools.code.label', 'Code'),
          placeholder: this.t('tools.code.placeholder', 'Enter code'),
        },
      });
      this.nodes.input.value = this.data.code;
      this.nodes.input.addEventListener('input', () => {
        this.data.code = this.nodes.input.value;
        this.paint();
      });
      this.nodes.input.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          const { selectionStart, selectionEnd, value } = this.nodes.input;
          this.nodes.input.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
          this.nodes.input.selectionStart = this.nodes.input.selectionEnd = selectionStart + 2;
          this.data.code = this.nodes.input.value;
          this.paint();
        }
        // Keep Enter and Backspace inside the textarea instead of creating/removing blocks.
        if (event.key === 'Enter' || event.key === 'Backspace') event.stopPropagation();
      });
      this.nodes.input.addEventListener('scroll', () => {
        this.nodes.pre.scrollTop = this.nodes.input.scrollTop;
        this.nodes.pre.scrollLeft = this.nodes.input.scrollLeft;
      });
      stack.appendChild(this.nodes.input);
    }
    body.append(this.nodes.gutter, stack);
    wrapper.append(header, body);
    this.wrapper = wrapper;
    this.paint();
    return wrapper;
  }

  paint() {
    this.nodes.code.className = `mex-code__code language-${this.data.language}`;
    this.nodes.code.innerHTML = highlight(this.data.code, this.data.language);
    const lines = Math.max(1, this.data.code.split('\n').length);
    this.nodes.gutter.textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n');
    this.wrapper.classList.toggle('mex-code--numbers', this.data.showlinenumbers);
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  renderSettings() {
    return [
      {
        icon: ICONS.lineNumbers,
        title: this.t('tools.code.lineNumbers', 'Line numbers'),
        toggle: true,
        isActive: () => this.data.showlinenumbers,
        onActivate: () => {
          this.data.showlinenumbers = !this.data.showlinenumbers;
          this.paint();
          this.changed();
        },
      },
    ];
  }

  onPaste(event) {
    if (event.type === 'tag') {
      this.data.code = event.detail.data.textContent || '';
      if (this.nodes.input) this.nodes.input.value = this.data.code;
      this.paint();
    }
  }

  save() {
    const out = {
      code: this.data.code,
      language: this.data.language,
      showlinenumbers: this.data.showlinenumbers,
    };
    const filename = cleanCodeFilename(this.data.filename);
    if (filename) out.filename = filename;
    return out;
  }
}

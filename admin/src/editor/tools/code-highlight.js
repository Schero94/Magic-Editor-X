import Prism from './prism';
import { ICONS, el, select } from './dom';
import { CODE_LANGUAGES, normalizeCodeFlask } from './logic.mjs';

/**
 * Code block with syntax highlighting. Replaces @calumk/editorjs-codeflask
 * (archived) under the same block name `codeFlask` and data
 * `{ code, language, showlinenumbers }`.
 *
 * Editing happens in a plain textarea laid over a highlighted <pre>; the
 * highlighted markup comes from Prism, which escapes the code text.
 */

const LABELS = {
  plaintext: 'Plain text',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  markup: 'HTML / XML',
  css: 'CSS',
  scss: 'SCSS',
  bash: 'Shell',
  python: 'Python',
  php: 'PHP',
  ruby: 'Ruby',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  csharp: 'C#',
  c: 'C',
  cpp: 'C++',
  go: 'Go',
  rust: 'Rust',
  sql: 'SQL',
  graphql: 'GraphQL',
  yaml: 'YAML',
  markdown: 'Markdown',
  docker: 'Dockerfile',
  diff: 'Diff',
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
    return { code: true, language: false, showlinenumbers: false };
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
      header.appendChild(
        el('span', {
          className: 'mex-code__language',
          text: LABELS[this.data.language] || this.data.language,
        })
      );
    } else {
      this.nodes.language = select(
        CODE_LANGUAGES.map((value) => ({ value, label: LABELS[value] || value })),
        this.data.language
      );
      this.nodes.language.setAttribute('aria-label', this.t('tools.code.language', 'Language'));
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
    return { code: this.data.code, language: this.data.language, showlinenumbers: this.data.showlinenumbers };
  }
}

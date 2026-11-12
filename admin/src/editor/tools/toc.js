import { ICONS, el, field, input, select } from './dom';
import { normalizeToc } from './logic.mjs';
import { buildTocTree, countTocEntries } from '../../../../shared/toc.mjs';

/**
 * Table of contents (`toc`, 2.3). Stores only its settings
 * `{ title, minLevel, maxLevel, style }`; the entries are built from the
 * headings whenever the content is rendered (renderers, Content API).
 *
 * In the editor the block shows a live, read-only preview of the headings of
 * this document. It watches the editor's block area with a MutationObserver,
 * so typing, level changes, moves, undo and remote edits of collaborators all
 * update it.
 */

const LEVELS = [1, 2, 3, 4, 5, 6];
const REFRESH_MS = 150;

/**
 * Headings shown in the editor, in document order.
 * @param {HTMLElement|null} redactor - Editor.js block area.
 * @returns {Array<{ id: string|null, level: number, text: string }>} Headings.
 */
const readHeadings = (redactor) => {
  if (!redactor) return [];
  return Array.from(redactor.querySelectorAll('.ce-block .ce-header')).map((node) => {
    const block = node.closest('.ce-block');
    return {
      id: block ? block.getAttribute('data-id') : null,
      level: Number(node.tagName.slice(1)) || 2,
      text: node.textContent || '',
    };
  });
};

export class TocTool {
  static get toolbox() {
    return { title: 'Table of contents', icon: ICONS.toc };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return { title: false, minLevel: false, maxLevel: false, style: false };
  }

  constructor({ data, api, config, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.data = normalizeToc(data, this.config.levels);
    this.nodes = {};
    this.observer = null;
    this.timer = null;
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  render() {
    const wrapper = el('div', { className: 'mex-toc' });
    this.wrapper = wrapper;
    this.nodes.list = el('div', {
      className: 'mex-toc__preview',
      attrs: {
        role: 'group',
        'aria-label': this.t('tools.toc.preview', 'Headings in this document'),
      },
    });
    this.nodes.empty = el('p', {
      className: 'mex-tool__muted',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    if (this.readOnly) {
      this.nodes.title = el('p', { className: 'mex-toc__title', text: this.data.title });
      this.nodes.title.hidden = !this.data.title;
      wrapper.append(this.nodes.title, this.nodes.list, this.nodes.empty);
      return wrapper;
    }
    this.nodes.titleInput = input({
      value: this.data.title,
      placeholder: this.t('tools.toc.titlePlaceholder', 'Contents'),
    });
    this.nodes.titleInput.setAttribute('maxlength', '200');
    const levelLabels = {
      1: this.t('tools.header.level1', 'Heading 1'),
      2: this.t('tools.header.level2', 'Heading 2'),
      3: this.t('tools.header.level3', 'Heading 3'),
      4: this.t('tools.header.level4', 'Heading 4'),
      5: this.t('tools.header.level5', 'Heading 5'),
      6: this.t('tools.header.level6', 'Heading 6'),
    };
    const levelOptions = LEVELS.map((level) => ({ value: String(level), label: levelLabels[level] }));
    this.nodes.min = select(levelOptions, String(this.data.minLevel));
    this.nodes.max = select(levelOptions, String(this.data.maxLevel));
    this.nodes.style = select(
      [
        { value: 'unordered', label: this.t('tools.list.unordered', 'Bulleted') },
        { value: 'ordered', label: this.t('tools.list.ordered', 'Numbered') },
      ],
      this.data.style
    );
    const sync = (source) => {
      this.data.title = this.nodes.titleInput.value.slice(0, 200);
      let min = Number(this.nodes.min.value);
      let max = Number(this.nodes.max.value);
      if (min > max) {
        // Keep the range valid: the control that was changed wins.
        if (source === this.nodes.min) max = min;
        else min = max;
        this.nodes.min.value = String(min);
        this.nodes.max.value = String(max);
      }
      this.data.minLevel = min;
      this.data.maxLevel = max;
      this.data.style = this.nodes.style.value === 'ordered' ? 'ordered' : 'unordered';
      this.refresh();
      this.changed();
    };
    this.nodes.titleInput.addEventListener('input', () => sync(this.nodes.titleInput));
    for (const control of [this.nodes.min, this.nodes.max, this.nodes.style]) {
      control.addEventListener('change', () => sync(control));
      // Arrow keys and Enter belong to the select, not to Editor.js block navigation.
      control.addEventListener('keydown', (event) => {
        if (['Enter', 'ArrowUp', 'ArrowDown', 'Backspace', 'Tab'].includes(event.key))
          event.stopPropagation();
      });
    }
    this.nodes.titleInput.addEventListener('keydown', (event) => {
      if (['Enter', 'Backspace', 'Tab'].includes(event.key)) event.stopPropagation();
      if (event.key === 'Enter') event.preventDefault();
    });
    wrapper.append(
      el('div', {
        className: ['mex-tool__grid', 'mex-toc__settings'],
        children: [
          field(this.t('tools.toc.title', 'Title'), this.nodes.titleInput),
          field(this.t('tools.toc.from', 'From level'), this.nodes.min),
          field(this.t('tools.toc.to', 'To level'), this.nodes.max),
          field(this.t('tools.toc.style', 'Style'), this.nodes.style),
        ],
      }),
      this.nodes.list,
      this.nodes.empty
    );
    return wrapper;
  }

  /** Starts watching the document once the block is on the page. */
  rendered() {
    this.refresh();
    const redactor = this.redactor();
    if (!redactor || this.observer || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver((mutations) => {
      if (!this.wrapper || !this.wrapper.isConnected) {
        this.destroy();
        return;
      }
      // Changes inside this block (its own preview) do not affect the headings.
      if (mutations.every((mutation) => this.wrapper && this.wrapper.contains(mutation.target))) return;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.refresh(), REFRESH_MS);
    });
    this.observer.observe(redactor, { childList: true, subtree: true, characterData: true });
  }

  /** @returns {HTMLElement|null} Editor.js block area of this editor. */
  redactor() {
    return this.wrapper ? this.wrapper.closest('.codex-editor__redactor') : null;
  }

  /** Re-draws the preview from the headings currently in the editor. */
  refresh() {
    if (!this.nodes.list) return;
    const tree = buildTocTree(readHeadings(this.redactor()), this.data);
    const tag = this.data.style === 'ordered' ? 'ol' : 'ul';
    const list = (nodes) =>
      el(tag, {
        className: 'mex-toc__list',
        children: nodes.map((node) =>
          el('li', {
            className: 'mex-toc__item',
            children: [el('span', { text: node.text }), node.children.length ? list(node.children) : null],
          })
        ),
      });
    this.nodes.list.replaceChildren(...(tree.length ? [list(tree)] : []));
    if (this.nodes.title) {
      this.nodes.title.textContent = this.data.title;
      this.nodes.title.hidden = !this.data.title;
    }
    const count = countTocEntries(tree);
    const text = count
      ? ''
      : this.t(
          'tools.toc.empty',
          'No headings between level {min} and {max} yet. Add headings and they appear here.',
          { min: this.data.minLevel, max: this.data.maxLevel }
        );
    if (this.nodes.empty.textContent !== text) this.nodes.empty.textContent = text;
    this.nodes.empty.hidden = !text;
  }

  removed() {
    this.destroy();
  }

  destroy() {
    window.clearTimeout(this.timer);
    if (this.observer) this.observer.disconnect();
    this.observer = null;
  }

  save() {
    return {
      title: this.data.title.trim(),
      minLevel: this.data.minLevel,
      maxLevel: this.data.maxLevel,
      style: this.data.style,
    };
  }
}

import { el } from './dom';
import { sanitizeInline } from '../sanitize';
import { htmlToBlocks, htmlToInline } from '../../../../shared/convert/html.mjs';
import { parseHtmlWithDom } from '../../../../shared/convert/dom-adapter.mjs';
import { escapeHtml } from '../../../../shared/editor-data.mjs';
import {
  COLUMNS_LIMITS,
  COLUMN_HEADING_LEVEL,
  cleanColumnsData,
  layoutsFor,
  newColumnsId,
} from '../../../../shared/columns.mjs';

/**
 * Columns block (2.6, shared/columns.mjs has the data rules). One Editor.js
 * block that renders its own columns: no nested Editor.js instances, so the
 * field keeps one undo history, one selection and one clipboard.
 *
 * Each column is a labelled group ("Column 1 of 2") with simple items
 * (paragraph, heading, list item). Every item is one contenteditable with a
 * stable id (`data-item-id`), so comments, find and replace, AI segments and
 * collaboration address the same text while items are added or removed.
 *
 * Keyboard: Enter splits the item (a new paragraph, or a new list item in a
 * list; Enter in an empty list item ends the list), Shift+Enter a line break,
 * Backspace at the start of an item removes an empty item, turns a heading or
 * list item into a paragraph or joins a paragraph with the item before it,
 * Delete at the end joins the next item, arrow keys at the edge of an item
 * move to the neighbour item (and out of the block at its edges), Tab and
 * Shift+Tab go to the next or previous column, Alt+F10 the toolbar.
 * `## `, `- ` and `1. ` at the start of a paragraph turn it into a heading or
 * a list item. Pasting several paragraphs creates items; pasted HTML is
 * cleaned to the field's inline content.
 *
 * The toolbar holds what an editor picks while writing (text style and the
 * width preset); the column count, spacing and vertical alignment are in the
 * block menu (Editor.js block settings).
 */

const ICON = (path) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${path}</svg>`;
const S = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  columns2: ICON(`<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M12 4v16" ${S}/>`),
  columns3: ICON(`<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M9 4v16M15 4v16" ${S}/>`),
  columns4: ICON(
    `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M7.5 4v16M12 4v16M16.5 4v16" ${S}/>`
  ),
  equal: ICON(
    `<rect x="3" y="5" width="8" height="14" rx="1" ${S}/><rect x="13" y="5" width="8" height="14" rx="1" ${S}/>`
  ),
  wideLeft: ICON(
    `<rect x="3" y="5" width="11" height="14" rx="1" ${S}/><rect x="16" y="5" width="5" height="14" rx="1" ${S}/>`
  ),
  wideRight: ICON(
    `<rect x="3" y="5" width="5" height="14" rx="1" ${S}/><rect x="10" y="5" width="11" height="14" rx="1" ${S}/>`
  ),
  wideCenter: ICON(
    `<rect x="2" y="5" width="4" height="14" rx="1" ${S}/><rect x="8" y="5" width="8" height="14" rx="1" ${S}/><rect x="18" y="5" width="4" height="14" rx="1" ${S}/>`
  ),
  gap: ICON(
    `<rect x="3" y="5" width="6" height="14" rx="1" ${S}/><rect x="15" y="5" width="6" height="14" rx="1" ${S}/><path d="M11 12h2" ${S}/>`
  ),
  align: ICON(
    `<path d="M4 4h16M4 20h16" ${S}/><rect x="7" y="8" width="4" height="8" rx="1" ${S}/><rect x="13" y="9" width="4" height="6" rx="1" ${S}/>`
  ),
};

/** Width presets: icon and label per layout name. */
const LAYOUT_UI = {
  equal: { icon: ICONS.equal, key: 'tools.columns.layout.equal', text: 'Equal widths' },
  'wide-left': { icon: ICONS.wideLeft, key: 'tools.columns.layout.wideLeft', text: 'Wide left column' },
  'wide-center': {
    icon: ICONS.wideCenter,
    key: 'tools.columns.layout.wideCenter',
    text: 'Wide middle column',
  },
  'wide-right': { icon: ICONS.wideRight, key: 'tools.columns.layout.wideRight', text: 'Wide right column' },
};

/** Text styles of an item: value of the style select -> item fields. */
const STYLES = [
  {
    value: 'paragraph',
    key: 'tools.columns.style.paragraph',
    text: 'Paragraph',
    item: { type: 'paragraph' },
  },
  { value: 'h2', key: 'tools.columns.style.h2', text: 'Heading 2', item: { type: 'heading', level: 2 } },
  { value: 'h3', key: 'tools.columns.style.h3', text: 'Heading 3', item: { type: 'heading', level: 3 } },
  { value: 'h4', key: 'tools.columns.style.h4', text: 'Heading 4', item: { type: 'heading', level: 4 } },
  {
    value: 'unordered',
    key: 'tools.columns.style.unordered',
    text: 'Bulleted list',
    item: { type: 'list', style: 'unordered' },
  },
  {
    value: 'ordered',
    key: 'tools.columns.style.ordered',
    text: 'Numbered list',
    item: { type: 'list', style: 'ordered' },
  },
];

/** Inline rules of the stored strings (Editor.js merges them with the inline tools' rules). */
const INLINE_RULES = { br: true };

const styleOf = (item) => {
  if (item.type === 'heading') return `h${Math.min(4, Math.max(2, item.level || COLUMN_HEADING_LEVEL))}`;
  if (item.type === 'list') return item.style === 'ordered' ? 'ordered' : 'unordered';
  return 'paragraph';
};

/* Caret helpers ------------------------------------------------------------ */

const selectionIn = (element) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.startContainer) ? range : null;
};

const textBefore = (element, range) => {
  const pre = document.createRange();
  pre.selectNodeContents(element);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString();
};

const textAfter = (element, range) => {
  const post = document.createRange();
  post.selectNodeContents(element);
  post.setStart(range.endContainer, range.endOffset);
  return post.toString();
};

/**
 * Whether the caret is on the first or last visual line of an element.
 * @param {HTMLElement} element - Item input.
 * @param {Range} range - Collapsed caret range.
 * @param {'top'|'bottom'} edge - Edge.
 * @returns {boolean} Result.
 */
const onEdgeLine = (element, range, edge) => {
  const rects = range.getClientRects();
  const rect = rects.length ? rects[0] : null;
  if (!rect || rect.height === 0)
    return edge === 'top' ? textBefore(element, range).length === 0 : textAfter(element, range).length === 0;
  const box = element.getBoundingClientRect();
  return edge === 'top'
    ? rect.top - box.top < rect.height * 0.9
    : box.bottom - rect.bottom < rect.height * 0.9;
};

/**
 * Places the caret at a text offset inside an element (or at its end) and focuses it.
 * @param {HTMLElement} element - Element.
 * @param {number|'start'|'end'} offset - Text offset.
 */
const placeCaret = (element, offset) => {
  element.focus({ preventScroll: false });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (offset === 'start' || offset === 'end') {
    // Inside a text node when there is one: a caret on the element itself ignores Home/End.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    let last = first;
    while (last && walker.nextNode()) last = walker.currentNode;
    if (offset === 'start' && first) range.setStart(first, 0);
    else if (offset === 'end' && last) range.setStart(last, last.textContent.length);
    else {
      range.selectNodeContents(element);
      range.collapse(offset === 'start');
    }
    range.collapse(true);
  } else {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    let placed = false;
    while (node) {
      if (remaining <= node.textContent.length) {
        range.setStart(node, remaining);
        placed = true;
        break;
      }
      remaining -= node.textContent.length;
      node = walker.nextNode();
    }
    if (!placed) {
      range.selectNodeContents(element);
      range.collapse(false);
    } else range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
};

/** HTML of a fragment. */
const fragmentHtml = (fragment) => {
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
};

/** Removes a trailing `<br>` that browsers leave in an emptied contenteditable. */
const trimHtml = (html) => (/^(?:\s|<br\s*\/?>)*$/i.test(html) ? '' : html);

/**
 * The rendered tool of each columns block by block id (2.6.1). A collaborator's change re-creates
 * the block (`blocks.update` in `apply-remote.js`), but a block menu that was open keeps the old
 * instance in its callbacks; its choices (number of columns, spacing, alignment) are handed to the
 * instance the editor shows now, so they are not silently lost while someone types in the block.
 */
const liveTools = new Map();

export class ColumnsTool {
  /** Two toolbox entries: the column count is the first choice (one click), equal widths by default. */
  static get toolbox() {
    return [
      { title: '2 columns', icon: ICONS.columns2, data: { columns: [{}, {}] } },
      { title: '3 columns', icon: ICONS.columns3, data: { columns: [{}, {}, {}] } },
    ];
  }

  static get isReadOnlySupported() {
    return true;
  }

  /** Enter and Shift+Enter are handled by the tool (new item, line break). */
  static get enableLineBreaks() {
    return true;
  }

  static get sanitize() {
    return { columns: INLINE_RULES, layout: false, gap: false, valign: false };
  }

  constructor({ data, config, api, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    // Same repairs as the content policy (deterministic ids), without touching the inline HTML.
    const clean = cleanColumnsData(data || {}, (html) => (typeof html === 'string' ? html : ''), 1);
    this.model = {
      columns: clean.columns,
      layout: clean.layout || 'equal',
      gap: clean.gap || 'medium',
      valign: clean.valign || 'top',
    };
    this.active = null;
    this.toolbarIndex = 0;
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  /* ---------------------------------------------------------------- view */

  render() {
    this.wrapper = el('div', {
      className: ['mex-columns-tool', this.readOnly ? 'mex-columns-tool--readonly' : null],
    });
    if (!this.readOnly) {
      this.toolbar = this.renderToolbar();
      this.wrapper.appendChild(this.toolbar);
    }
    this.grid = el('div', { className: 'mex-columns-tool__grid' });
    this.wrapper.appendChild(this.grid);
    this.status = el('div', {
      className: 'mex-columns-tool__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.wrapper.appendChild(this.status);
    this.renderGrid();
    if (!this.readOnly) this.bindEvents();
    if (this.block && typeof this.block.id === 'string') liveTools.set(this.block.id, this);
    return this.wrapper;
  }

  /**
   * The instance of this block the editor shows now: itself, or the instance that replaced it
   * after a collaborator's change (see `liveTools`).
   * @returns {ColumnsTool} Tool instance.
   */
  current() {
    const other = this.block && typeof this.block.id === 'string' ? liveTools.get(this.block.id) : null;
    return other && other !== this && other.wrapper && other.wrapper.isConnected ? other : this;
  }

  /** Editor.js hook: the block is removed or replaced. */
  destroy() {
    if (this.block && liveTools.get(this.block.id) === this) liveTools.delete(this.block.id);
  }

  renderGrid() {
    const count = this.model.columns.length;
    const grid = this.grid;
    grid.setAttribute('data-count', String(count));
    grid.setAttribute(
      'data-layout',
      layoutsFor(count).includes(this.model.layout) ? this.model.layout : 'equal'
    );
    grid.setAttribute('data-gap', this.model.gap);
    grid.setAttribute('data-valign', this.model.valign);
    const columns = this.model.columns.map((column, c) => {
      const node = el('div', {
        className: 'mex-columns-tool__column',
        attrs: {
          role: 'group',
          'aria-label': this.t('tools.columns.column', 'Column {index} of {count}', {
            index: c + 1,
            count,
          }),
          'data-col': c,
          'data-column-id': column.id,
        },
      });
      const items = column.items.length ? column.items : [this.virtualItem(column)];
      let number = 0;
      items.forEach((item) => {
        number = item.type === 'list' && item.style === 'ordered' ? number + 1 : 0;
        node.appendChild(this.renderItem(item, c, number));
      });
      return node;
    });
    grid.replaceChildren(...columns);
    this.updateToolbar();
  }

  /**
   * The editable placeholder item of an empty column. It is stored only once it has text, so
   * an empty column stays empty and two people opening it never create two items.
   * @param {{ id: string, items: object[] }} column - Column.
   * @returns {object} Item.
   */
  virtualItem(column) {
    const ids = new Set(this.model.columns.flatMap((col) => [col.id, ...col.items.map((it) => it.id)]));
    let id = `${column.id}-1`.slice(-32);
    for (let n = 2; ids.has(id); n += 1) id = `${column.id}-${n}`.slice(-32);
    return { id, type: 'paragraph', text: '', virtual: true };
  }

  renderItem(item, col, number) {
    const style = styleOf(item);
    const row = el('div', {
      className: ['mex-columns-tool__item', `mex-columns-tool__item--${style}`],
      attrs: {
        'data-item-id': item.id,
        'data-mex-key': `columns-item:${item.id}`,
        'data-virtual': item.virtual ? 'true' : null,
        'data-marker': item.type === 'list' ? (item.style === 'ordered' ? `${number}.` : '•') : null,
      },
    });
    const style0 = STYLES.find((entry) => entry.value === style);
    const input = el('div', {
      className: 'mex-columns-tool__input',
      attrs: {
        contenteditable: this.readOnly ? 'false' : 'true',
        role: this.readOnly ? null : 'textbox',
        'aria-multiline': this.readOnly ? null : 'true',
        'aria-label': this.readOnly ? null : this.t(style0.key, style0.text),
        'data-col': col,
        'data-placeholder':
          this.readOnly || !item.virtual ? null : this.t('tools.columns.placeholder', 'Type here'),
      },
    });
    input.innerHTML = item.text ? sanitizeInline(item.text) : '';
    row.appendChild(input);
    return row;
  }

  renderToolbar() {
    const toolbar = el('div', {
      className: 'mex-columns-tool__toolbar',
      attrs: { role: 'toolbar', 'aria-label': this.t('tools.columns.toolbar', 'Column tools') },
    });
    this.styleSelect = el('select', {
      className: 'mex-columns-tool__select',
      attrs: { 'aria-label': this.t('tools.columns.style', 'Text style'), 'data-toolbar': 'true' },
      children: STYLES.map((entry) =>
        el('option', { text: this.t(entry.key, entry.text), attrs: { value: entry.value } })
      ),
    });
    this.styleSelect.addEventListener('change', () => this.setStyle(this.styleSelect.value));
    toolbar.appendChild(this.styleSelect);
    toolbar.appendChild(
      el('span', { className: 'mex-columns-tool__separator', attrs: { 'aria-hidden': 'true' } })
    );
    this.layoutButtons = {};
    for (const [name, ui] of Object.entries(LAYOUT_UI)) {
      const button = el('button', {
        className: 'mex-columns-tool__button',
        attrs: {
          type: 'button',
          title: this.t(ui.key, ui.text),
          'aria-label': this.t(ui.key, ui.text),
          'aria-pressed': 'false',
          'data-toolbar': 'true',
          'data-layout': name,
        },
      });
      button.innerHTML = ui.icon;
      // Keep the caret in the item when the button is clicked with the mouse.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.setLayout(name));
      this.layoutButtons[name] = button;
      toolbar.appendChild(button);
    }
    toolbar.addEventListener('keydown', (event) => this.onToolbarKeyDown(event));
    return toolbar;
  }

  updateToolbar() {
    if (!this.toolbar) return;
    const count = this.model.columns.length;
    const allowed = layoutsFor(count);
    for (const [name, button] of Object.entries(this.layoutButtons)) {
      button.hidden = !allowed.includes(name) || allowed.length < 2;
      button.setAttribute('aria-pressed', String(this.model.layout === name));
    }
    const item = this.active ? this.itemById(this.active.id) : null;
    this.styleSelect.value = item ? styleOf(item) : 'paragraph';
    this.styleSelect.disabled = !item;
    const controls = this.toolbarControls();
    controls.forEach((control, index) => {
      control.tabIndex = index === Math.min(this.toolbarIndex, controls.length - 1) ? 0 : -1;
    });
  }

  toolbarControls() {
    return this.toolbar
      ? Array.from(this.toolbar.querySelectorAll('[data-toolbar]')).filter(
          (control) => !control.hidden && !control.disabled
        )
      : [];
  }

  onToolbarKeyDown(event) {
    const controls = this.toolbarControls();
    const index = controls.indexOf(document.activeElement);
    if (index < 0) return;
    const go = (next) => {
      event.preventDefault();
      event.stopPropagation();
      this.toolbarIndex = (next + controls.length) % controls.length;
      this.updateToolbar();
      controls[this.toolbarIndex].focus();
    };
    // The select keeps Up/Down for its options.
    if (event.key === 'ArrowRight') go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(controls.length - 1);
    else if (event.key === 'Escape' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.focusItem(this.active ? this.active.id : null, 'end');
    } else if (
      ['Enter', 'Backspace', 'Delete', ' '].includes(event.key) &&
      event.target !== this.styleSelect
    ) {
      // Buttons handle Enter/Space themselves; Editor.js must not see them.
      event.stopPropagation();
    } else if (event.target === this.styleSelect) event.stopPropagation();
  }

  /* ---------------------------------------------------------------- model */

  /** Copies the item HTML from the DOM into the model (virtual items with text become real). */
  readDom() {
    if (!this.grid) return;
    this.model.columns = this.model.columns.map((column, c) => {
      const node = this.grid.querySelector(`.mex-columns-tool__column[data-col="${c}"]`);
      if (!node) return column;
      const items = [];
      for (const row of node.querySelectorAll('.mex-columns-tool__item')) {
        const input = row.querySelector('.mex-columns-tool__input');
        const html = trimHtml(input ? input.innerHTML : '');
        const id = row.getAttribute('data-item-id');
        const existing = column.items.find((it) => it.id === id);
        if (row.getAttribute('data-virtual') === 'true') {
          if (html) items.push({ id, type: 'paragraph', text: html });
          continue;
        }
        items.push({ ...(existing || { id, type: 'paragraph' }), text: html });
      }
      return { ...column, items };
    });
  }

  itemById(id) {
    for (const column of this.model.columns) {
      const item = column.items.find((it) => it.id === id);
      if (item) return item;
    }
    return null;
  }

  locate(id) {
    for (let c = 0; c < this.model.columns.length; c += 1) {
      const i = this.model.columns[c].items.findIndex((it) => it.id === id);
      if (i >= 0) return { c, i };
    }
    return null;
  }

  itemCount() {
    return this.model.columns.reduce((sum, column) => sum + column.items.length, 0);
  }

  newItemId() {
    const ids = new Set(this.model.columns.flatMap((col) => [col.id, ...col.items.map((it) => it.id)]));
    let id = newColumnsId();
    while (ids.has(id)) id = newColumnsId();
    return id;
  }

  /** Input element of an item. */
  inputOf(id) {
    if (!this.grid || !id) return null;
    const row = Array.from(this.grid.querySelectorAll('.mex-columns-tool__item')).find(
      (node) => node.getAttribute('data-item-id') === id
    );
    return row ? row.querySelector('.mex-columns-tool__input') : null;
  }

  focusItem(id, offset) {
    const input = this.inputOf(id) || (this.grid && this.grid.querySelector('.mex-columns-tool__input'));
    if (!input) return false;
    placeCaret(input, offset);
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  /** Re-renders after a structural change and puts the caret into an item. */
  commit(focusId, offset, message) {
    this.renderGrid();
    if (focusId) this.focusItem(focusId, offset);
    if (message) this.announce(message);
    this.changed();
  }

  announce(text) {
    if (!this.status) return;
    this.status.textContent = '';
    window.setTimeout(() => {
      if (this.status) this.status.textContent = text;
    }, 50);
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  /**
   * Makes the virtual item of a column a real item, so structural edits have something to act on.
   * @param {HTMLElement} row - Item row.
   * @returns {string} Item id.
   */
  materialize(row) {
    const id = row.getAttribute('data-item-id');
    if (row.getAttribute('data-virtual') !== 'true') return id;
    const c = Number(row.closest('.mex-columns-tool__column').getAttribute('data-col'));
    const column = this.model.columns[c];
    if (column && !column.items.some((it) => it.id === id))
      column.items.push({ id, type: 'paragraph', text: '' });
    row.removeAttribute('data-virtual');
    return id;
  }

  /* -------------------------------------------------------------- actions */

  setStyle(value) {
    const entry = STYLES.find((candidate) => candidate.value === value);
    if (!entry || !this.active) return;
    this.readDom();
    const row = this.rowOf(this.active.id);
    if (row) this.materialize(row);
    const item = this.itemById(this.active.id);
    if (!item) return;
    delete item.level;
    delete item.style;
    Object.assign(item, entry.item);
    this.commit(item.id, 'end', this.t(entry.key, entry.text));
  }

  setLayout(name) {
    if (!layoutsFor(this.model.columns.length).includes(name)) return;
    this.readDom();
    this.model.layout = name;
    this.renderGrid();
    if (this.active) this.focusItem(this.active.id, 'end');
    this.announce(this.t(LAYOUT_UI[name].key, LAYOUT_UI[name].text));
    this.changed();
  }

  /**
   * Changes the number of columns. New columns are empty; the items of removed columns move
   * to the end of the last column that stays, so no text is lost.
   * @param {number} count - 2 to 4.
   */
  setCount(count) {
    if (count < COLUMNS_LIMITS.minColumns || count > COLUMNS_LIMITS.maxColumns) return;
    this.readDom();
    const columns = this.model.columns.slice(0, count);
    while (columns.length < count) columns.push({ id: this.newItemId(), items: [] });
    const moved = this.model.columns.slice(count).flatMap((column) => column.items);
    if (moved.length) {
      const last = columns[columns.length - 1];
      last.items = [...last.items, ...moved].slice(0, COLUMNS_LIMITS.items);
    }
    this.model.columns = columns;
    if (!layoutsFor(count).includes(this.model.layout)) this.model.layout = 'equal';
    this.commit(
      null,
      null,
      this.t('tools.columns.countChanged', '{count, plural, one {# column} other {# columns}}', { count })
    );
  }

  setOption(key, value) {
    this.readDom();
    this.model[key] = value;
    this.renderGrid();
    this.changed();
  }

  rowOf(id) {
    const input = this.inputOf(id);
    return input ? input.closest('.mex-columns-tool__item') : null;
  }

  /** Enter: splits the item at the caret. */
  splitItem(row, input, range) {
    const id = this.materialize(row);
    this.readDom();
    const where = this.locate(id);
    if (!where) return;
    const column = this.model.columns[where.c];
    const item = column.items[where.i];
    if (item.type === 'list' && !input.textContent.trim() && !input.querySelector('img')) {
      // Enter in an empty list item ends the list.
      delete item.style;
      item.type = 'paragraph';
      this.commit(item.id, 'start', this.t('tools.columns.style.paragraph', 'Paragraph'));
      return;
    }
    if (column.items.length >= COLUMNS_LIMITS.items) {
      this.announce(
        this.t('tools.columns.limit', 'A column holds at most {max} items', { max: COLUMNS_LIMITS.items })
      );
      return;
    }
    range.deleteContents();
    const after = document.createRange();
    after.selectNodeContents(input);
    after.setStart(range.endContainer, range.endOffset);
    const tail = trimHtml(fragmentHtml(after.extractContents()));
    item.text = trimHtml(input.innerHTML);
    const next = { id: this.newItemId(), type: 'paragraph', text: tail };
    if (item.type === 'list') {
      next.type = 'list';
      next.style = item.style;
    }
    column.items.splice(where.i + 1, 0, next);
    this.commit(next.id, 'start');
  }

  /** Backspace at the start of an item. Returns true when handled. */
  backspaceAtStart(row, input) {
    const id = this.materialize(row);
    this.readDom();
    const where = this.locate(id);
    if (!where) return false;
    const column = this.model.columns[where.c];
    const item = column.items[where.i];
    if (item.type !== 'paragraph') {
      delete item.level;
      delete item.style;
      item.type = 'paragraph';
      this.commit(item.id, 'start', this.t('tools.columns.style.paragraph', 'Paragraph'));
      return true;
    }
    const previous = column.items[where.i - 1];
    const empty = !input.textContent && !trimHtml(input.innerHTML);
    if (!previous) {
      if (!empty || column.items.length === 1) return this.blockIsEmpty() ? false : true;
      column.items.splice(where.i, 1);
      this.commit(column.items[0].id, 'start');
      return true;
    }
    const offset = new DOMParser().parseFromString(previous.text || '', 'text/html').body.textContent.length;
    previous.text = trimHtml(`${previous.text || ''}${item.text || ''}`);
    column.items.splice(where.i, 1);
    this.commit(previous.id, offset, empty ? this.t('tools.columns.removed', 'Item removed') : null);
    return true;
  }

  /** Delete at the end of an item: joins the next item of the column. Returns true when handled. */
  deleteAtEnd(row) {
    const id = this.materialize(row);
    this.readDom();
    const where = this.locate(id);
    if (!where) return false;
    const column = this.model.columns[where.c];
    const item = column.items[where.i];
    const next = column.items[where.i + 1];
    if (!next) return true;
    const offset = new DOMParser().parseFromString(item.text || '', 'text/html').body.textContent.length;
    item.text = trimHtml(`${item.text || ''}${next.text || ''}`);
    column.items.splice(where.i + 1, 1);
    this.commit(item.id, offset);
    return true;
  }

  blockIsEmpty() {
    return !this.grid || !this.grid.textContent.trim();
  }

  /** `## `, `- `, `* `, `1. ` at the start of a paragraph. Returns true when converted. */
  markdownShortcut(row, input, range) {
    const id = row.getAttribute('data-item-id');
    const item = this.itemById(id);
    if (item && item.type !== 'paragraph') return false;
    const before = textBefore(input, range);
    const map = {
      '#': 'h2',
      '##': 'h2',
      '###': 'h3',
      '####': 'h4',
      '-': 'unordered',
      '*': 'unordered',
      '1.': 'ordered',
    };
    const value = map[before];
    if (!value || before !== input.textContent.slice(0, before.length)) return false;
    const strip = document.createRange();
    strip.selectNodeContents(input);
    strip.setEnd(range.startContainer, range.startOffset);
    strip.deleteContents();
    this.materialize(row);
    this.active = { id };
    this.setStyle(value);
    this.focusItem(id, 'start');
    return true;
  }

  /* ---------------------------------------------------------------- events */

  itemOf(target) {
    const input = target && target.closest ? target.closest('.mex-columns-tool__input') : null;
    if (!input || !this.grid || !this.grid.contains(input)) return null;
    const row = input.closest('.mex-columns-tool__item');
    return { input, row, id: row.getAttribute('data-item-id'), col: Number(input.getAttribute('data-col')) };
  }

  bindEvents() {
    this.wrapper.addEventListener('focusin', (event) => {
      const found = this.itemOf(event.target);
      if (!found) return;
      if (!this.active || this.active.id !== found.id) {
        this.active = { id: found.id };
        this.updateToolbar();
      }
    });
    this.grid.addEventListener('keydown', (event) => this.onItemKeyDown(event));
    this.grid.addEventListener('paste', (event) => this.onItemPaste(event));
  }

  onItemKeyDown(event) {
    const found = this.itemOf(event.target);
    if (!found) return;
    const { input, row, col } = found;
    this.active = { id: found.id };
    const modifier = event.ctrlKey || event.metaKey || event.altKey;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.altKey && event.key === 'F10') {
      handled();
      const controls = this.toolbarControls();
      this.updateToolbar();
      if (controls.length) controls[Math.min(this.toolbarIndex, controls.length - 1)].focus();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.code === 'KeyV' || /^v$/i.test(event.key))
    ) {
      this.plainUntil = Date.now() + 1000;
      return;
    }
    if (event.key === 'Tab' && !modifier) {
      const target = col + (event.shiftKey ? -1 : 1);
      if (target >= 0 && target < this.model.columns.length) {
        handled();
        this.readDom();
        const column = this.model.columns[target];
        const first = column.items[0] || this.virtualItem(column);
        this.focusItem(first.id, 'start');
      } else if (!event.shiftKey && this.api && this.api.blocks) {
        const index = this.api.blocks.getCurrentBlockIndex();
        if (index < this.api.blocks.getBlocksCount() - 1) {
          handled();
          this.api.caret.setToBlock(index + 1, 'start');
        }
      } else if (event.shiftKey && this.api && this.api.blocks) {
        const index = this.api.blocks.getCurrentBlockIndex();
        if (index > 0) {
          handled();
          this.api.caret.setToBlock(index - 1, 'end');
        }
      }
      return;
    }
    if (modifier) return;
    const range = selectionIn(input);
    if (!range) return;
    if (event.key === 'Enter') {
      handled();
      if (event.shiftKey) {
        document.execCommand('insertLineBreak');
        return;
      }
      this.splitItem(row, input, range);
      return;
    }
    if (event.shiftKey) return;
    if (event.key === ' ' && range.collapsed && this.markdownShortcut(row, input, range)) {
      handled();
      return;
    }
    const collapsed = range.collapsed;
    const atStart = collapsed && textBefore(input, range).length === 0;
    const atEnd = collapsed && textAfter(input, range).length === 0;
    if (event.key === 'Backspace' && atStart) {
      if (this.backspaceAtStart(row, input)) handled();
      else event.stopPropagation();
      return;
    }
    if (event.key === 'Delete' && atEnd) {
      handled();
      this.deleteAtEnd(row);
      return;
    }
    const rows = Array.from(row.parentElement.querySelectorAll('.mex-columns-tool__item'));
    const index = rows.indexOf(row);
    const inputAt = (r) => r && r.querySelector('.mex-columns-tool__input');
    const columnNode = (c) => this.grid.querySelector(`.mex-columns-tool__column[data-col="${c}"]`);
    if (event.key === 'ArrowUp' && collapsed && onEdgeLine(input, range, 'top')) {
      handled();
      if (index > 0) placeCaret(inputAt(rows[index - 1]), 'end');
      else if (this.api && this.api.caret) this.api.caret.setToPreviousBlock('end');
    } else if (event.key === 'ArrowDown' && collapsed && onEdgeLine(input, range, 'bottom')) {
      handled();
      if (index < rows.length - 1) placeCaret(inputAt(rows[index + 1]), 'start');
      else if (this.api && this.api.caret) this.api.caret.setToNextBlock('start');
    } else if (event.key === 'ArrowLeft' && atStart) {
      handled();
      if (index > 0) placeCaret(inputAt(rows[index - 1]), 'end');
      else if (col > 0) {
        const items = columnNode(col - 1).querySelectorAll('.mex-columns-tool__input');
        placeCaret(items[items.length - 1], 'end');
      } else if (this.api && this.api.caret) this.api.caret.setToPreviousBlock('end');
    } else if (event.key === 'ArrowRight' && atEnd) {
      handled();
      if (index < rows.length - 1) placeCaret(inputAt(rows[index + 1]), 'start');
      else if (col < this.model.columns.length - 1)
        placeCaret(columnNode(col + 1).querySelector('.mex-columns-tool__input'), 'start');
      else if (this.api && this.api.caret) this.api.caret.setToNextBlock('start');
    }
  }

  /**
   * Paste into an item: one paragraph is inserted as inline content; several paragraphs,
   * headings or list items become items after the current one (cleaned to the field's inline
   * content). Editor.js and the field's paste handling never turn it into blocks.
   * @param {ClipboardEvent} event - Paste event.
   */
  onItemPaste(event) {
    const found = this.itemOf(event.target);
    const data = event.clipboardData;
    if (!found || !data) return;
    event.preventDefault();
    event.stopPropagation();
    const text = data.getData('text/plain') || '';
    const html = Date.now() < (this.plainUntil || 0) ? '' : data.getData('text/html') || '';
    if (text.length + html.length > 2 * 1024 * 1024) return;
    // HTML without block elements (a copied phrase) is inline content, never several items.
    const blockLevel = /<(p|div|h[1-6]|ul|ol|li|blockquote|pre|table|section|article|figure)\b/i;
    let pieces;
    if (html && !blockLevel.test(html)) {
      const inline = trimHtml(sanitizeInline(htmlToInline(html, parseHtmlWithDom)));
      pieces = inline ? [{ type: 'paragraph', text: inline }] : [];
    } else pieces = html ? this.htmlPieces(html) : this.textPieces(text);
    if (pieces.length <= 1) {
      const inline = pieces.length ? pieces[0].text : '';
      if (inline) document.execCommand('insertHTML', false, inline);
      return;
    }
    const id = this.materialize(found.row);
    const range = selectionIn(found.input);
    let tail = '';
    if (range) {
      range.deleteContents();
      const after = document.createRange();
      after.selectNodeContents(found.input);
      after.setStart(range.endContainer, range.endOffset);
      tail = trimHtml(fragmentHtml(after.extractContents()));
    }
    this.readDom();
    const where = this.locate(id);
    if (!where) return;
    const column = this.model.columns[where.c];
    const item = column.items[where.i];
    const room = COLUMNS_LIMITS.items - column.items.length;
    const [first, ...rest] = pieces;
    item.text = trimHtml(`${item.text || ''}${first.text}`);
    const added = rest.slice(0, Math.max(0, room)).map((piece) => ({ ...piece, id: this.newItemId() }));
    if (tail && added.length) added[added.length - 1].text += tail;
    else if (tail) item.text += tail;
    column.items.splice(where.i + 1, 0, ...added);
    const last = added.length ? added[added.length - 1] : item;
    this.commit(
      last.id,
      'end',
      rest.length > added.length
        ? this.t('tools.columns.limit', 'A column holds at most {max} items', { max: COLUMNS_LIMITS.items })
        : null
    );
  }

  /** Items of pasted plain text: one per non-empty line. */
  textPieces(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, COLUMNS_LIMITS.items)
      .map((line) => ({ type: 'paragraph', text: escapeHtml(line) }));
  }

  /** Items of pasted HTML through the shared converter (paragraphs, headings, list items). */
  htmlPieces(html) {
    let blocks;
    try {
      blocks = htmlToBlocks(html, { parse: parseHtmlWithDom }).blocks;
    } catch {
      blocks = [];
    }
    const out = [];
    const push = (piece) => {
      const clean = trimHtml(sanitizeInline(piece.text || ''));
      if (clean && out.length < COLUMNS_LIMITS.items) out.push({ ...piece, text: clean });
    };
    const walkList = (items, style, depth = 0) => {
      for (const entry of Array.isArray(items) ? items : []) {
        if (depth > 12) return;
        if (typeof entry === 'string') push({ type: 'list', style, text: entry });
        else if (entry && typeof entry === 'object') {
          push({ type: 'list', style, text: entry.content || entry.text || '' });
          walkList(entry.items, style, depth + 1);
        }
      }
    };
    for (const block of blocks) {
      const d = block.data || {};
      if (block.type === 'header')
        push({ type: 'heading', level: Math.min(6, Math.max(1, d.level || 3)), text: d.text });
      else if (block.type === 'list') walkList(d.items, d.style === 'ordered' ? 'ordered' : 'unordered');
      else if (block.type === 'checklist') walkList(d.items, 'unordered');
      else if (typeof d.text === 'string') push({ type: 'paragraph', text: d.text });
      else if (typeof d.caption === 'string') push({ type: 'paragraph', text: d.caption });
    }
    if (!out.length) {
      const inline = trimHtml(sanitizeInline(htmlToInline(html, parseHtmlWithDom)));
      if (inline) out.push({ type: 'paragraph', text: inline });
    }
    return out;
  }

  /* ------------------------------------------------------- block settings */

  renderSettings() {
    const counts = [2, 3, 4].map((count) => ({
      icon: ICONS[`columns${count}`],
      title: this.t('tools.columns.count', '{count, plural, one {# column} other {# columns}}', { count }),
      isActive: this.model.columns.length === count,
      closeOnActivate: true,
      onActivate: () => this.current().setCount(count),
    }));
    const gaps = [
      { value: 'small', key: 'tools.columns.gap.small', text: 'Narrow' },
      { value: 'medium', key: 'tools.columns.gap.medium', text: 'Normal' },
      { value: 'large', key: 'tools.columns.gap.large', text: 'Wide' },
    ].map(({ value, key, text }) => ({
      title: this.t(key, text),
      isActive: this.model.gap === value,
      closeOnActivate: true,
      onActivate: () => this.current().setOption('gap', value),
    }));
    const aligns = [
      { value: 'top', key: 'tools.columns.valign.top', text: 'Top' },
      { value: 'center', key: 'tools.columns.valign.center', text: 'Middle' },
      { value: 'bottom', key: 'tools.columns.valign.bottom', text: 'Bottom' },
    ].map(({ value, key, text }) => ({
      title: this.t(key, text),
      isActive: this.model.valign === value,
      closeOnActivate: true,
      onActivate: () => this.current().setOption('valign', value),
    }));
    return [
      {
        icon: ICONS.columns3,
        title: this.t('tools.columns.countMenu', 'Number of columns'),
        children: { items: counts },
      },
      {
        icon: ICONS.gap,
        title: this.t('tools.columns.gapMenu', 'Space between columns'),
        children: { items: gaps },
      },
      {
        icon: ICONS.align,
        title: this.t('tools.columns.valignMenu', 'Vertical alignment'),
        children: { items: aligns },
      },
    ];
  }

  save() {
    this.readDom();
    const out = {
      columns: this.model.columns.map((column) => ({
        id: column.id,
        items: column.items.map((item) => {
          const clean = { id: item.id, type: item.type, text: item.text || '' };
          if (item.type === 'heading') clean.level = item.level || COLUMN_HEADING_LEVEL;
          if (item.type === 'list') clean.style = item.style === 'ordered' ? 'ordered' : 'unordered';
          return clean;
        }),
      })),
    };
    if (this.model.layout !== 'equal' && layoutsFor(out.columns.length).includes(this.model.layout))
      out.layout = this.model.layout;
    if (this.model.gap !== 'medium') out.gap = this.model.gap;
    if (this.model.valign !== 'top') out.valign = this.model.valign;
    return out;
  }
}

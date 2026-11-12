import { el } from './dom';
import { sanitizeInline, prepareEditorValue } from '../sanitize';
import { htmlToBlocks, htmlToInline } from '../../../../shared/convert/html.mjs';
import { parseHtmlWithDom } from '../../../../shared/convert/dom-adapter.mjs';
import { escapeHtml } from '../../../../shared/editor-data.mjs';
import {
  TABLE_LIMITS,
  canMergeRect,
  deleteColumn,
  deleteRow,
  expandRect,
  fromTableModel,
  headerKind,
  insertColumn,
  insertRow,
  isBlankInlineHtml,
  mergeMap,
  mergeRect,
  neighbourRect,
  parseTabularText,
  pasteGrid,
  setColumnAlign,
  setHeaderRow,
  spanAt,
  splitCell,
  toTableModel,
} from '../../../../shared/table.mjs';

/**
 * Table block (2.4). Replaces @editorjs/table with the same block name and
 * the same stored data (`{ withHeadings, stretched, content }`), plus the
 * optional 2.4 keys `headerColumn`, `align`, `merges` and `caption`
 * (shared/table.mjs has the rules).
 *
 * The table is a real `<table>`: the header row uses `<th scope="col">`, the
 * header column `<th scope="row">`, merged cells `colspan`/`rowspan`, so
 * screen readers announce the editor like the rendered output. Every cell
 * holds one contenteditable; covered cells of a merge are not shown.
 *
 * Keyboard: Tab/Shift+Tab next/previous cell (Tab in the last cell adds a
 * row), Enter the cell below (adds a row at the end), Shift+Enter a line
 * break, arrow keys at the edge of a cell move to the neighbour cell (and out
 * of the table at its edge), Alt+F10 the table toolbar (arrow keys inside it,
 * Escape or Tab back to the cell). Shift+click or dragging selects a
 * rectangle of cells for "Merge cells"; "Merge right/down" work from one cell.
 * Pasting tab-separated text (spreadsheets, office tables) fills the cells
 * from the current one; other pastes insert inline text.
 */

const ICON = (path) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${path}</svg>`;
const S = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  table: ICON(
    `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M3 10h18M3 15h18M10 4v16" ${S}/>`
  ),
  headerRow: ICON(
    `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M3 10h18" ${S}/><rect x="4" y="5" width="16" height="4" fill="currentColor"/>`
  ),
  headerColumn: ICON(
    `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><path d="M9 4v16" ${S}/><rect x="4" y="5" width="4" height="14" fill="currentColor"/>`
  ),
  alignLeft: ICON(`<path d="M4 6h16M4 10h10M4 14h16M4 18h10" ${S}/>`),
  alignCenter: ICON(`<path d="M4 6h16M7 10h10M4 14h16M7 18h10" ${S}/>`),
  alignRight: ICON(`<path d="M4 6h16M10 10h10M4 14h16M10 18h10" ${S}/>`),
  merge: ICON(
    `<rect x="3" y="5" width="18" height="14" rx="2" ${S}/><path d="m8 12 3-2.5v5L8 12Zm8 0-3-2.5v5l3-2.5Z" ${S}/>`
  ),
  mergeRight: ICON(
    `<rect x="3" y="5" width="8" height="14" rx="1" ${S}/><path d="M14 12h7m-3-3 3 3-3 3" ${S}/>`
  ),
  mergeDown: ICON(
    `<rect x="5" y="3" width="14" height="8" rx="1" ${S}/><path d="M12 14v7m-3-3 3 3 3-3" ${S}/>`
  ),
  split: ICON(`<rect x="3" y="5" width="18" height="14" rx="2" ${S}/><path d="M12 5v14m-6-7h3m6 0h3" ${S}/>`),
  rowAbove: ICON(`<rect x="3" y="11" width="18" height="9" rx="1" ${S}/><path d="M12 3v6M9 6h6" ${S}/>`),
  rowBelow: ICON(`<rect x="3" y="4" width="18" height="9" rx="1" ${S}/><path d="M12 15v6m-3-3h6" ${S}/>`),
  deleteRow: ICON(
    `<rect x="3" y="7" width="18" height="10" rx="1" ${S}/><path d="m9.5 9.5 5 5m0-5-5 5" ${S}/>`
  ),
  columnLeft: ICON(`<rect x="11" y="3" width="9" height="18" rx="1" ${S}/><path d="M3 12h6M6 9v6" ${S}/>`),
  columnRight: ICON(`<rect x="4" y="3" width="9" height="18" rx="1" ${S}/><path d="M15 12h6m-3-3v6" ${S}/>`),
  deleteColumn: ICON(
    `<rect x="7" y="3" width="10" height="18" rx="1" ${S}/><path d="m9.5 9.5 5 5m0-5-5 5" ${S}/>`
  ),
  stretch: ICON(`<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" ${S}/>`),
};

/** Inline rules of the stored strings (Editor.js merges them with the inline tools' rules). */
const INLINE_RULES = { br: true };

/** Caret helpers ---------------------------------------------------------- */

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
 * Number of visual lines of an element's text (1 for an empty cell).
 * @param {HTMLElement} element - Cell input.
 * @returns {number} Lines.
 */
const lineCount = (element) => {
  const style = getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize) || 14;
  const line = parseFloat(style.lineHeight) || fontSize * 1.2;
  const range = document.createRange();
  range.selectNodeContents(element);
  const height = range.getBoundingClientRect().height;
  return Math.max(1, Math.round(height / line));
};

/**
 * Whether the caret is at an edge of a cell: `start`/`end` by text, `top`/
 * `bottom` by line (anywhere in a one-line cell, else the first or last
 * visual line).
 * @param {HTMLElement} element - Cell input.
 * @param {'start'|'end'|'top'|'bottom'} edge - Edge.
 * @returns {boolean} Result.
 */
const caretAt = (element, edge) => {
  const range = selectionIn(element);
  if (!range || !range.collapsed) return false;
  if (edge === 'start') return textBefore(element, range).length === 0;
  if (edge === 'end') return textAfter(element, range).length === 0;
  if (lineCount(element) <= 1) return true;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[0] : null;
  if (!rect || rect.height === 0)
    return edge === 'top' ? textBefore(element, range).length === 0 : textAfter(element, range).length === 0;
  const content = document.createRange();
  content.selectNodeContents(element);
  const box = content.getBoundingClientRect();
  return edge === 'top'
    ? rect.top - box.top < rect.height * 0.75
    : box.bottom - rect.bottom < rect.height * 0.75;
};

/**
 * Places the caret at the start or end of an element and focuses it.
 * @param {HTMLElement} element - Element.
 * @param {boolean} atEnd - End instead of start.
 */
const placeCaret = (element, atEnd) => {
  element.focus({ preventScroll: false });
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
};

export class TableTool {
  static get toolbox() {
    return { title: 'Table', icon: ICONS.table };
  }

  static get isReadOnlySupported() {
    return true;
  }

  /** Enter is handled by the tool (next row); Shift+Enter is a line break. */
  static get enableLineBreaks() {
    return true;
  }

  static get sanitize() {
    return { content: INLINE_RULES, caption: INLINE_RULES, align: false };
  }

  /**
   * Whole tables pasted outside a cell become a table block (Editor.js paste
   * substitution); the cell attributes are kept for the converter.
   */
  static get pasteConfig() {
    const cell = { colspan: true, rowspan: true, scope: true, align: true, style: true };
    return { tags: ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'CAPTION', { th: cell, td: cell }] };
  }

  constructor({ data, config, api, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.model = toTableModel(data, {
      rows: this.config.rows,
      cols: this.config.cols,
      withHeadings: this.config.withHeadings === true,
    });
    this.active = { row: 0, col: 0 };
    this.selection = null;
    this.drag = null;
    this.plainUntil = 0;
    this.toolbarIndex = 0;
    this.onDocumentMouseUp = () => {
      this.drag = null;
    };
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  /* ---------------------------------------------------------------- view */

  render() {
    this.wrapper = el('div', {
      className: ['mex-table-tool', this.readOnly ? 'mex-table-tool--readonly' : null],
    });
    if (!this.readOnly) {
      this.toolbar = this.renderToolbar();
      this.wrapper.appendChild(this.toolbar);
    }
    this.scroll = el('div', { className: 'mex-table-tool__scroll' });
    this.wrapper.appendChild(this.scroll);
    this.captionInput = el('div', {
      className: 'mex-table-tool__caption',
      attrs: {
        contenteditable: this.readOnly ? 'false' : 'true',
        role: this.readOnly ? null : 'textbox',
        'aria-label': this.t('tools.table.captionLabel', 'Table caption'),
        'data-placeholder': this.t('tools.table.caption', 'Caption (optional)'),
      },
    });
    this.captionInput.innerHTML = sanitizeInline(this.model.caption);
    if (this.readOnly && isBlankInlineHtml(this.model.caption)) this.captionInput.hidden = true;
    this.wrapper.appendChild(this.captionInput);
    this.status = el('div', {
      className: 'mex-table-tool__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.wrapper.appendChild(this.status);
    this.renderTable();
    if (!this.readOnly) this.bindEvents();
    return this.wrapper;
  }

  rendered() {
    if (this.block && this.model.stretched) this.block.stretched = true;
  }

  renderTable() {
    const { covered, anchors } = mergeMap(this.model.merges);
    const table = el('table', { className: 'mex-table-tool__table' });
    const caption = this.t('tools.names.table', 'Table');
    table.setAttribute('aria-label', caption);
    const body = el('tbody');
    this.model.content.forEach((row, r) => {
      const tr = el('tr');
      row.forEach((html, c) => {
        if (covered.has(`${r}:${c}`)) return;
        const merge = anchors.get(`${r}:${c}`);
        const header = headerKind(this.model, r, c);
        const align = this.model.align[c];
        const cell = el(header ? 'th' : 'td', {
          className: ['mex-table-tool__cell', align ? `mex-align-${align}` : null],
          attrs: {
            scope: header || null,
            colspan: merge && merge.colspan > 1 ? merge.colspan : null,
            rowspan: merge && merge.rowspan > 1 ? merge.rowspan : null,
            'data-row': r,
            'data-col': c,
          },
        });
        const input = el('div', {
          className: 'mex-table-tool__input',
          attrs: {
            contenteditable: this.readOnly ? 'false' : 'true',
            role: this.readOnly ? null : 'textbox',
            'aria-multiline': this.readOnly ? null : 'true',
            'aria-label': this.readOnly
              ? null
              : this.t('tools.table.cell', 'Row {row}, column {column}', { row: r + 1, column: c + 1 }),
            'data-row': r,
            'data-col': c,
          },
        });
        input.innerHTML = html ? sanitizeInline(html) : '';
        cell.appendChild(input);
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    this.scroll.replaceChildren(table);
    this.table = table;
    this.paintSelection();
    this.updateToolbar();
  }

  inputAt(row, col) {
    return this.table
      ? this.table.querySelector(`.mex-table-tool__input[data-row="${row}"][data-col="${col}"]`)
      : null;
  }

  /** Copies the cell and caption HTML from the DOM into the model. */
  readDom() {
    if (!this.table) return;
    const content = this.model.content.map((row) => [...row]);
    for (const input of this.table.querySelectorAll('.mex-table-tool__input')) {
      const r = Number(input.dataset.row);
      const c = Number(input.dataset.col);
      if (content[r] && c < content[r].length)
        content[r][c] = isBlankInlineHtml(input.innerHTML) ? '' : input.innerHTML;
    }
    const caption = this.captionInput ? this.captionInput.innerHTML : this.model.caption;
    this.model = { ...this.model, content, caption: isBlankInlineHtml(caption) ? '' : caption };
  }

  /* ------------------------------------------------------------- toolbar */

  toolbarItems() {
    return [
      {
        action: 'headerRow',
        icon: ICONS.headerRow,
        label: this.t('tools.table.headerRow', 'Header row'),
        toggle: true,
      },
      {
        action: 'headerColumn',
        icon: ICONS.headerColumn,
        label: this.t('tools.table.headerColumn', 'Header column'),
        toggle: true,
      },
      { separator: true },
      {
        action: 'alignLeft',
        icon: ICONS.alignLeft,
        label: this.t('tools.table.alignLeft', 'Align column left'),
        toggle: true,
      },
      {
        action: 'alignCenter',
        icon: ICONS.alignCenter,
        label: this.t('tools.table.alignCenter', 'Center column'),
        toggle: true,
      },
      {
        action: 'alignRight',
        icon: ICONS.alignRight,
        label: this.t('tools.table.alignRight', 'Align column right'),
        toggle: true,
      },
      { separator: true },
      { action: 'merge', icon: ICONS.merge, label: this.t('tools.table.merge', 'Merge selected cells') },
      {
        action: 'mergeRight',
        icon: ICONS.mergeRight,
        label: this.t('tools.table.mergeRight', 'Merge with the cell to the right'),
      },
      {
        action: 'mergeDown',
        icon: ICONS.mergeDown,
        label: this.t('tools.table.mergeDown', 'Merge with the cell below'),
      },
      { action: 'split', icon: ICONS.split, label: this.t('tools.table.split', 'Split cell') },
      { separator: true },
      { action: 'rowAbove', icon: ICONS.rowAbove, label: this.t('tools.table.rowAbove', 'Add row above') },
      { action: 'rowBelow', icon: ICONS.rowBelow, label: this.t('tools.table.rowBelow', 'Add row below') },
      { action: 'deleteRow', icon: ICONS.deleteRow, label: this.t('tools.table.deleteRow', 'Delete row') },
      { separator: true },
      {
        action: 'columnLeft',
        icon: ICONS.columnLeft,
        label: this.t('tools.table.columnLeft', 'Add column to the left'),
      },
      {
        action: 'columnRight',
        icon: ICONS.columnRight,
        label: this.t('tools.table.columnRight', 'Add column to the right'),
      },
      {
        action: 'deleteColumn',
        icon: ICONS.deleteColumn,
        label: this.t('tools.table.deleteColumn', 'Delete column'),
      },
    ];
  }

  renderToolbar() {
    const toolbar = el('div', {
      className: 'mex-table-tool__toolbar',
      attrs: {
        role: 'toolbar',
        'aria-label': this.t('tools.table.toolbar', 'Table tools'),
        'aria-keyshortcuts': 'Alt+F10',
      },
    });
    this.buttons = [];
    for (const item of this.toolbarItems()) {
      if (item.separator) {
        toolbar.appendChild(
          el('span', { className: 'mex-table-tool__separator', attrs: { 'aria-hidden': 'true' } })
        );
        continue;
      }
      const button = el('button', {
        className: 'mex-table-tool__button',
        attrs: {
          type: 'button',
          tabindex: '-1',
          'aria-label': item.label,
          title: item.label,
          'aria-pressed': item.toggle ? 'false' : null,
          'data-action': item.action,
        },
      });
      button.innerHTML = item.icon;
      // Keeps the caret in the cell when a button is clicked with the mouse.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => this.run(item.action));
      toolbar.appendChild(button);
      this.buttons.push(button);
    }
    toolbar.addEventListener('keydown', (event) => this.onToolbarKeyDown(event));
    return toolbar;
  }

  /** Enabled state and pressed state of every toolbar button for the active cell. */
  updateToolbar() {
    if (!this.buttons) return;
    const { row, col } = this.active;
    const span = spanAt(this.model, row, col);
    const rows = this.model.content.length;
    const cols = this.model.content[0] ? this.model.content[0].length : 0;
    const right = neighbourRect(this.model, row, col, 'right');
    const down = neighbourRect(this.model, row, col, 'down');
    const state = {
      headerRow: { pressed: this.model.withHeadings },
      headerColumn: { pressed: this.model.headerColumn },
      alignLeft: { pressed: this.model.align[col] === 'left' },
      alignCenter: { pressed: this.model.align[col] === 'center' },
      alignRight: { pressed: this.model.align[col] === 'right' },
      merge: { disabled: !this.selection || !canMergeRect(this.model, this.selection) },
      mergeRight: { disabled: !right || !canMergeRect(this.model, right) },
      mergeDown: { disabled: !down || !canMergeRect(this.model, down) },
      split: { disabled: span.rowspan * span.colspan < 2 },
      rowAbove: { disabled: rows >= TABLE_LIMITS.rows },
      rowBelow: { disabled: rows >= TABLE_LIMITS.rows },
      deleteRow: { disabled: rows <= 1 },
      columnLeft: { disabled: cols >= TABLE_LIMITS.cols },
      columnRight: { disabled: cols >= TABLE_LIMITS.cols },
      deleteColumn: { disabled: cols <= 1 },
    };
    this.buttons.forEach((button) => {
      const item = state[button.dataset.action] || {};
      button.disabled = Boolean(item.disabled);
      if (button.hasAttribute('aria-pressed'))
        button.setAttribute('aria-pressed', item.pressed ? 'true' : 'false');
    });
    this.rovingFocus(this.toolbarIndex, false);
  }

  enabledButtons() {
    return (this.buttons || []).filter((button) => !button.disabled);
  }

  /** Roving tabindex: exactly one enabled button is in the tab order. */
  rovingFocus(index, focus) {
    const enabled = this.enabledButtons();
    if (!enabled.length) return;
    const target = enabled[((index % enabled.length) + enabled.length) % enabled.length];
    this.toolbarIndex = enabled.indexOf(target);
    this.buttons.forEach((button) => button.setAttribute('tabindex', button === target ? '0' : '-1'));
    if (focus) target.focus();
  }

  onToolbarKeyDown(event) {
    const enabled = this.enabledButtons();
    const current = enabled.indexOf(document.activeElement);
    const keys = {
      ArrowRight: () => this.rovingFocus(current + 1, true),
      ArrowLeft: () => this.rovingFocus(current - 1, true),
      Home: () => this.rovingFocus(0, true),
      End: () => this.rovingFocus(enabled.length - 1, true),
      Escape: () => this.focusCell(this.active.row, this.active.col, true),
      Tab: () => this.focusCell(this.active.row, this.active.col, true),
    };
    if (keys[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      keys[event.key]();
    } else if (event.key === 'Enter' || event.key === ' ') {
      // The button's own click; Editor.js must not see the key.
      event.stopPropagation();
    }
  }

  /* -------------------------------------------------------------- actions */

  /**
   * Runs a table action on the current model and renders the result.
   * @param {string} action - Toolbar action.
   */
  run(action) {
    this.readDom();
    const { row, col } = this.active;
    const span = spanAt(this.model, row, col);
    const m = this.model;
    let next = null;
    let focus = { row, col };
    let message = '';
    switch (action) {
      case 'headerRow':
        next = setHeaderRow(m, !m.withHeadings);
        break;
      case 'headerColumn':
        next = { ...m, headerColumn: !m.headerColumn };
        break;
      case 'alignLeft':
      case 'alignCenter':
      case 'alignRight': {
        const value = action.slice(5).toLowerCase();
        next = setColumnAlign(m, col, m.align[col] === value ? null : value);
        break;
      }
      case 'merge':
        next = this.selection ? mergeRect(m, this.selection) : null;
        if (next) {
          const box = expandRect(m, this.selection);
          focus = { row: box.top, col: box.left };
          message = this.t('tools.table.merged', 'Cells merged');
        }
        break;
      case 'mergeRight':
      case 'mergeDown': {
        const rect = neighbourRect(m, row, col, action === 'mergeRight' ? 'right' : 'down');
        next = rect ? mergeRect(m, rect) : null;
        if (next) {
          focus = { row: rect.top, col: rect.left };
          message = this.t('tools.table.merged', 'Cells merged');
        }
        break;
      }
      case 'split':
        next = splitCell(m, row, col);
        if (next) {
          focus = { row: span.row, col: span.col };
          message = this.t('tools.table.splitDone', 'Cell split');
        }
        break;
      case 'rowAbove':
        next = insertRow(m, span.row);
        focus = { row: span.row, col };
        break;
      case 'rowBelow':
        next = insertRow(m, span.row + span.rowspan);
        focus = { row: span.row + span.rowspan, col };
        break;
      case 'deleteRow':
        next = deleteRow(m, row);
        focus = { row: Math.min(row, m.content.length - 2), col };
        break;
      case 'columnLeft':
        next = insertColumn(m, span.col);
        focus = { row, col: span.col };
        break;
      case 'columnRight':
        next = insertColumn(m, span.col + span.colspan);
        focus = { row, col: span.col + span.colspan };
        break;
      case 'deleteColumn':
        next = deleteColumn(m, col);
        focus = { row, col: Math.min(col, (m.content[0] || []).length - 2) };
        break;
      case 'stretch':
        next = { ...m, stretched: !m.stretched };
        if (this.block) this.block.stretched = next.stretched;
        break;
      default:
        break;
    }
    if (!next) return;
    this.model = next;
    this.selection = null;
    this.renderTable();
    const anchor = spanAt(this.model, Math.max(0, focus.row), Math.max(0, focus.col));
    this.focusCell(anchor.row, anchor.col, true);
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

  /* ----------------------------------------------------- cells and focus */

  /**
   * Focuses the input of the anchor cell that contains a cell.
   * @param {number} row - Row.
   * @param {number} col - Column.
   * @param {boolean} atEnd - Caret at the end.
   * @returns {boolean} Focused.
   */
  focusCell(row, col, atEnd) {
    const rows = this.model.content.length;
    const cols = this.model.content[0] ? this.model.content[0].length : 0;
    if (row < 0 || col < 0 || row >= rows || col >= cols) return false;
    const span = spanAt(this.model, row, col);
    const input = this.inputAt(span.row, span.col);
    if (!input) return false;
    this.active = { row: span.row, col: span.col };
    placeCaret(input, atEnd);
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  /** Anchor cells in reading order. */
  anchors() {
    const { covered } = mergeMap(this.model.merges);
    const out = [];
    this.model.content.forEach((row, r) =>
      row.forEach((_, c) => {
        if (!covered.has(`${r}:${c}`)) out.push({ row: r, col: c });
      })
    );
    return out;
  }

  stepCell(delta) {
    const list = this.anchors();
    const index = list.findIndex((item) => item.row === this.active.row && item.col === this.active.col);
    return list[index + delta] || null;
  }

  cellOf(target) {
    const input = target && target.closest ? target.closest('.mex-table-tool__input') : null;
    if (!input || !this.table || !this.table.contains(input)) return null;
    return { row: Number(input.dataset.row), col: Number(input.dataset.col), input };
  }

  bindEvents() {
    this.wrapper.addEventListener('focusin', (event) => {
      const cell = this.cellOf(event.target);
      if (!cell) return;
      if (cell.row !== this.active.row || cell.col !== this.active.col) {
        this.active = { row: cell.row, col: cell.col };
        this.updateToolbar();
      }
    });
    this.scroll.addEventListener('keydown', (event) => this.onCellKeyDown(event));
    this.captionInput.addEventListener('keydown', (event) => this.onCaptionKeyDown(event));
    this.scroll.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.scroll.addEventListener('mouseover', (event) => this.onMouseOver(event));
    this.scroll.addEventListener('paste', (event) => this.onCellPaste(event));
    this.captionInput.addEventListener('paste', (event) => this.onCaptionPaste(event));
    document.addEventListener('mouseup', this.onDocumentMouseUp);
  }

  onCellKeyDown(event) {
    const cell = this.cellOf(event.target);
    if (!cell) return;
    const { input } = cell;
    this.active = { row: cell.row, col: cell.col };
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.code === 'KeyV' || /^v$/i.test(event.key))
    ) {
      this.plainUntil = Date.now() + 1000;
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && this.selection) this.clearSelection();
    const modifier = event.ctrlKey || event.metaKey || event.altKey;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.altKey && event.key === 'F10') {
      handled();
      this.rovingFocus(this.toolbarIndex, true);
      return;
    }
    if (event.key === 'Tab' && !modifier) {
      const next = this.stepCell(event.shiftKey ? -1 : 1);
      if (next) {
        handled();
        this.focusCell(next.row, next.col, true);
      } else if (!event.shiftKey && this.model.content.length < TABLE_LIMITS.rows) {
        handled();
        this.addRowAtEnd();
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !modifier) {
      handled();
      const span = spanAt(this.model, cell.row, cell.col);
      const below = span.row + span.rowspan;
      if (below < this.model.content.length) this.focusCell(below, cell.col, true);
      else this.addRowAtEnd(cell.col);
      return;
    }
    if (modifier || event.shiftKey) return;
    const span = spanAt(this.model, cell.row, cell.col);
    if (event.key === 'ArrowUp' && caretAt(input, 'top')) {
      handled();
      if (span.row > 0) this.focusCell(span.row - 1, cell.col, true);
      else if (this.api && this.api.caret) this.api.caret.setToPreviousBlock('end');
    } else if (event.key === 'ArrowDown' && caretAt(input, 'bottom')) {
      handled();
      const below = span.row + span.rowspan;
      if (below < this.model.content.length) this.focusCell(below, cell.col, false);
      else placeCaret(this.captionInput, false);
    } else if (event.key === 'ArrowLeft' && caretAt(input, 'start')) {
      const previous = this.stepCell(-1);
      if (previous) {
        handled();
        this.focusCell(previous.row, previous.col, true);
      }
    } else if (event.key === 'ArrowRight' && caretAt(input, 'end')) {
      const next = this.stepCell(1);
      if (next) {
        handled();
        this.focusCell(next.row, next.col, false);
      } else {
        handled();
        placeCaret(this.captionInput, false);
      }
    }
  }

  addRowAtEnd(col = 0) {
    this.readDom();
    const next = insertRow(this.model, this.model.content.length);
    if (!next) return;
    this.model = next;
    this.renderTable();
    this.focusCell(this.model.content.length - 1, col, false);
    this.changed();
  }

  onCaptionKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (
      (event.key === 'ArrowUp' && caretAt(this.captionInput, 'top')) ||
      (event.key === 'ArrowLeft' && caretAt(this.captionInput, 'start'))
    ) {
      const last = this.anchors().pop();
      if (!last) return;
      event.preventDefault();
      event.stopPropagation();
      this.focusCell(last.row, last.col, true);
    } else if (event.key === 'Enter') {
      // One line: Enter leaves the caption like it leaves a cell.
      event.preventDefault();
      event.stopPropagation();
      if (this.api && this.api.caret) this.api.caret.setToNextBlock('start');
    }
  }

  /* ------------------------------------------------------------ selection */

  onMouseDown(event) {
    if (event.button !== 0) return;
    const cell = this.cellOf(event.target);
    if (!cell) return;
    if (event.shiftKey) {
      event.preventDefault();
      this.setSelection(this.active, cell);
      return;
    }
    this.clearSelection();
    this.drag = { row: cell.row, col: cell.col };
  }

  onMouseOver(event) {
    if (!this.drag) return;
    const cell = this.cellOf(event.target);
    if (!cell || (cell.row === this.drag.row && cell.col === this.drag.col)) return;
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    this.setSelection(this.drag, cell);
  }

  setSelection(from, to) {
    const a = spanAt(this.model, from.row, from.col);
    const b = spanAt(this.model, to.row, to.col);
    this.selection = expandRect(this.model, {
      top: Math.min(a.row, b.row),
      left: Math.min(a.col, b.col),
      bottom: Math.max(a.row + a.rowspan, b.row + b.rowspan) - 1,
      right: Math.max(a.col + a.colspan, b.col + b.colspan) - 1,
    });
    this.paintSelection();
    this.updateToolbar();
    const count = this.anchors().filter((item) => this.inSelection(item.row, item.col)).length;
    this.announce(
      this.t('tools.table.selection', '{count, plural, one {# cell selected} other {# cells selected}}', {
        count,
      })
    );
  }

  inSelection(row, col) {
    const s = this.selection;
    return Boolean(s && row >= s.top && row <= s.bottom && col >= s.left && col <= s.right);
  }

  clearSelection() {
    if (!this.selection) return;
    this.selection = null;
    this.paintSelection();
    this.updateToolbar();
  }

  paintSelection() {
    if (!this.table) return;
    for (const cell of this.table.querySelectorAll('.mex-table-tool__cell')) {
      const selected = this.inSelection(Number(cell.dataset.row), Number(cell.dataset.col));
      cell.classList.toggle('mex-table-tool__cell--selected', selected);
    }
  }

  /* ---------------------------------------------------------------- paste */

  onCellPaste(event) {
    const cell = this.cellOf(event.target);
    const data = event.clipboardData;
    if (!cell || !data) return;
    // Editor.js and the field's paste cleanup must not turn the paste into blocks.
    event.preventDefault();
    event.stopPropagation();
    const text = data.getData('text/plain') || '';
    const html = Date.now() < this.plainUntil ? '' : data.getData('text/html') || '';
    if (text.length + html.length > 2 * 1024 * 1024) return;
    const grid = parseTabularText(text);
    if (grid && (grid.length > 1 || grid[0].length > 1)) {
      this.readDom();
      const span = spanAt(this.model, cell.row, cell.col);
      this.model = pasteGrid(
        this.model,
        span.row,
        span.col,
        grid.map((row) => row.map((value) => escapeHtml(value.trim())))
      );
      this.renderTable();
      this.focusCell(span.row, span.col, true);
      this.changed();
      return;
    }
    const inline = html
      ? sanitizeInline(htmlToInline(html, parseHtmlWithDom))
      : escapeHtml(text).replace(/\r?\n/g, '<br>');
    if (inline) document.execCommand('insertHTML', false, inline);
  }

  onCaptionPaste(event) {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    event.stopPropagation();
    const text = (data.getData('text/plain') || '').slice(0, TABLE_LIMITS.caption);
    if (text) document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  }

  /**
   * A table pasted outside a cell (Editor.js paste substitution): converted
   * with the shared HTML converter, so header cells, spans, alignment and the
   * caption are kept, then cleaned with the content policy.
   * @param {CustomEvent} event - Editor.js paste event.
   */
  onPaste(event) {
    const element = event && event.detail && event.detail.data;
    if (!element || !element.outerHTML) return;
    const html = element.tagName === 'TABLE' ? element.outerHTML : `<table>${element.outerHTML}</table>`;
    const converted = htmlToBlocks(html, { parse: parseHtmlWithDom }).blocks.find(
      (block) => block.type === 'table'
    );
    if (!converted) return;
    const prepared = prepareEditorValue({ blocks: [converted] }).data;
    const data = prepared && prepared.blocks[0] ? prepared.blocks[0].data : null;
    if (!data) return;
    this.model = toTableModel(data, { withHeadings: data.withHeadings });
    if (this.wrapper) {
      this.captionInput.innerHTML = sanitizeInline(this.model.caption);
      this.renderTable();
    }
  }

  /* ------------------------------------------------------- block settings */

  renderSettings() {
    return [
      {
        icon: ICONS.headerRow,
        title: this.t('tools.table.headerRow', 'Header row'),
        isActive: this.model.withHeadings,
        closeOnActivate: true,
        onActivate: () => this.run('headerRow'),
      },
      {
        icon: ICONS.headerColumn,
        title: this.t('tools.table.headerColumn', 'Header column'),
        isActive: this.model.headerColumn,
        closeOnActivate: true,
        onActivate: () => this.run('headerColumn'),
      },
      {
        icon: ICONS.stretch,
        title: this.t('tools.table.stretch', 'Full width'),
        isActive: this.model.stretched,
        closeOnActivate: true,
        onActivate: () => this.run('stretch'),
      },
    ];
  }

  save() {
    this.readDom();
    return fromTableModel(this.model);
  }

  destroy() {
    document.removeEventListener('mouseup', this.onDocumentMouseUp);
  }
}

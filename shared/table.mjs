/**
 * Tables v2 (2.4): header row and header column, column alignment, merged
 * cells and a caption on the `table` block. Pure functions shared by the
 * content policy, the renderers, the converters, the quality lint and the
 * editor tool.
 *
 * Stored data (all new keys optional, written only when they differ from the
 * default, so tables saved before 2.4 keep their exact shape):
 * `{ withHeadings, stretched, content: string[][], headerColumn?: true,
 *    align?: ('left'|'center'|'right'|null)[], merges?: [{ row, col, rowspan, colspan }],
 *    caption?: string }`.
 *
 * Merged cells: `content` stays a full rectangular grid. A merge names its
 * anchor (top left) cell and its size; the cells it covers are stored as ''
 * (the content policy empties them), so a renderer that ignores `merges`
 * still shows a full grid with the text in the anchor cell and empty covered
 * cells. Merges never overlap, stay inside the grid and, with a header row,
 * never reach from the header row into the body (HTML `thead`/`tbody` cannot
 * share a cell). Invalid merges are dropped, never repaired.
 */

/** Bounds of a table (also the policy, schema and live guard limits). */
export const TABLE_LIMITS = Object.freeze({ rows: 500, cols: 100, merges: 1000, caption: 4000 });

/** Column alignments (`null` = not set, the reader's default). */
export const TABLE_ALIGNS = Object.freeze(['left', 'center', 'right']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Number of columns of a grid (its longest row).
 * @param {unknown} content - Rows.
 * @returns {number} Columns.
 */
export const tableWidth = (content) =>
  Array.isArray(content)
    ? content.reduce((width, row) => Math.max(width, Array.isArray(row) ? row.length : 0), 0)
    : 0;

/**
 * Column alignments, cut to the column count; unknown values become null and
 * trailing nulls are removed.
 * @param {unknown} value - Stored `align`.
 * @param {number} cols - Column count.
 * @returns {Array<'left'|'center'|'right'|null>|null} Alignments, or null when none is set.
 */
export const cleanTableAlign = (value, cols) => {
  if (!Array.isArray(value) || cols <= 0) return null;
  const out = value
    .slice(0, Math.min(cols, TABLE_LIMITS.cols))
    .map((item) => (typeof item === 'string' && TABLE_ALIGNS.includes(item) ? item : null));
  while (out.length && out[out.length - 1] === null) out.pop();
  return out.length ? out : null;
};

const intersects = (a, b) =>
  a.row < b.row + b.rowspan &&
  b.row < a.row + a.rowspan &&
  a.col < b.col + b.colspan &&
  b.col < a.col + a.colspan;

/**
 * Valid merges of a grid: integer coordinates, at least two cells, inside the
 * grid, not reaching from the header row into the body, not overlapping an
 * earlier merge (the first one wins). At most `TABLE_LIMITS.merges` are read.
 * Sorted by row, then column.
 * @param {unknown} merges - Stored `merges`.
 * @param {number} rows - Row count.
 * @param {number} cols - Column count.
 * @param {{ headerRow?: boolean }} [options] - `headerRow`: the first row is a header row.
 * @returns {Array<{ row: number, col: number, rowspan: number, colspan: number }>} Merges.
 */
export const normalizeMerges = (merges, rows, cols, options = {}) => {
  if (!Array.isArray(merges) || rows <= 0 || cols <= 0) return [];
  const out = [];
  for (const merge of merges.slice(0, TABLE_LIMITS.merges)) {
    if (!isObject(merge)) continue;
    const { row, col, rowspan, colspan } = merge;
    if (![row, col, rowspan, colspan].every(Number.isInteger)) continue;
    if (row < 0 || col < 0 || rowspan < 1 || colspan < 1 || rowspan * colspan < 2) continue;
    if (row + rowspan > rows || col + colspan > cols) continue;
    if (options.headerRow && row === 0 && rowspan > 1) continue;
    const next = { row, col, rowspan, colspan };
    if (out.some((other) => intersects(other, next))) continue;
    out.push(next);
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
};

/**
 * Anchor and covered cells of a list of (valid) merges.
 * @param {Array<{ row: number, col: number, rowspan: number, colspan: number }>} merges - Merges.
 * @returns {{ anchors: Map<string, object>, covered: Map<string, object> }} Keys `row:col`.
 */
export const mergeMap = (merges) => {
  const anchors = new Map();
  const covered = new Map();
  for (const merge of merges || []) {
    anchors.set(`${merge.row}:${merge.col}`, merge);
    for (let r = merge.row; r < merge.row + merge.rowspan; r += 1)
      for (let c = merge.col; c < merge.col + merge.colspan; c += 1)
        if (r !== merge.row || c !== merge.col) covered.set(`${r}:${c}`, merge);
  }
  return { anchors, covered };
};

/**
 * Header kind of a cell: `col` in the header row, `row` in the header column.
 * @param {{ withHeadings?: boolean, headerColumn?: boolean }} data - Table data.
 * @param {number} row - Row.
 * @param {number} col - Column.
 * @returns {'col'|'row'|null} Kind.
 */
export const headerKind = (data, row, col) => {
  if (data.withHeadings === true && row === 0) return 'col';
  if (data.headerColumn === true && col === 0) return 'row';
  return null;
};

/**
 * Cells of a table as they are rendered: covered cells are left out, anchors
 * carry their spans. Rows keep their own length unless the table has merges
 * (then the grid is rectangular, see the policy).
 * @param {{ content: string[][], merges?: Array<object>, align?: Array<string|null>, withHeadings?: boolean, headerColumn?: boolean }} data - Cleaned table data.
 * @returns {Array<Array<{ row: number, col: number, html: string, rowspan: number, colspan: number, header: 'col'|'row'|null, align: string|null }>>} Rows of cells.
 */
export const tableLayout = (data) => {
  const merges = Array.isArray(data.merges) ? data.merges : [];
  const { anchors, covered } = mergeMap(merges);
  const align = Array.isArray(data.align) ? data.align : [];
  return (data.content || []).map((row, r) =>
    row
      .map((html, c) => {
        if (covered.has(`${r}:${c}`)) return null;
        const merge = anchors.get(`${r}:${c}`);
        return {
          row: r,
          col: c,
          html,
          rowspan: merge ? merge.rowspan : 1,
          colspan: merge ? merge.colspan : 1,
          header: headerKind(data, r, c),
          align: typeof align[c] === 'string' ? align[c] : null,
        };
      })
      .filter(Boolean)
  );
};

/** Inline HTML without visible content (whitespace, `&nbsp;`, `<br>`). */
export const isBlankInlineHtml = (html) =>
  typeof html !== 'string' || /^(?:\s|&nbsp;|&#160;|\u00a0|<br\s*\/?>)*$/i.test(html);

/**
 * Policy of the 2.4 table keys (called by `BLOCK_POLICIES.table`). Adds only
 * keys that differ from their default; with merges the grid is padded to a
 * rectangle and covered cells are emptied.
 * @param {object} out - Cleaned 2.3 table data `{ withHeadings, stretched, content }` (changed in place).
 * @param {object} d - Input data.
 * @param {(html: unknown) => string} inline - Inline HTML sanitiser.
 * @returns {object} `out`.
 */
export const cleanTableExtras = (out, d, inline) => {
  if (d.headerColumn === true) out.headerColumn = true;
  const rows = out.content.length;
  const cols = tableWidth(out.content);
  const align = cleanTableAlign(d.align, cols);
  if (align) out.align = align;
  const merges = normalizeMerges(d.merges, rows, cols, { headerRow: out.withHeadings === true });
  if (merges.length) {
    const { covered } = mergeMap(merges);
    out.content = out.content.map((row, r) =>
      Array.from({ length: cols }, (_, c) =>
        covered.has(`${r}:${c}`) ? '' : row[c] === undefined ? '' : row[c]
      )
    );
    out.merges = merges;
  }
  if (typeof d.caption === 'string') {
    const caption = inline(d.caption.slice(0, TABLE_LIMITS.caption));
    if (!isBlankInlineHtml(caption)) out.caption = caption;
  }
  return out;
};

/**
 * Shape check of the 2.4 keys for the live collaboration guard. Types and
 * bounds only: merges that overlap or leave the grid (possible after two
 * people change the table at the same time) are valid here and dropped by
 * the policy when the content is rendered or saved.
 * @param {object} data - Table data read from the shared document.
 * @returns {boolean} Acceptable.
 */
export const isTableDataShapeValid = (data) => {
  if (!isObject(data)) return false;
  const { content, headerColumn, align, merges, caption } = data;
  if (content !== undefined) {
    if (!Array.isArray(content) || content.length > TABLE_LIMITS.rows) return false;
    for (const row of content)
      if (
        !Array.isArray(row) ||
        row.length > TABLE_LIMITS.cols ||
        !row.every((cell) => typeof cell === 'string')
      )
        return false;
  }
  if (headerColumn !== undefined && typeof headerColumn !== 'boolean') return false;
  if (align !== undefined) {
    if (!Array.isArray(align) || align.length > TABLE_LIMITS.cols) return false;
    if (!align.every((item) => item === null || TABLE_ALIGNS.includes(item))) return false;
  }
  if (merges !== undefined) {
    if (!Array.isArray(merges) || merges.length > TABLE_LIMITS.merges) return false;
    for (const merge of merges) {
      if (!isObject(merge)) return false;
      const keys = Object.keys(merge);
      if (keys.length !== 4 || !['row', 'col', 'rowspan', 'colspan'].every((key) => keys.includes(key)))
        return false;
      const { row, col, rowspan, colspan } = merge;
      if (![row, col, rowspan, colspan].every(Number.isInteger)) return false;
      if (row < 0 || row >= TABLE_LIMITS.rows || col < 0 || col >= TABLE_LIMITS.cols) return false;
      if (rowspan < 1 || rowspan > TABLE_LIMITS.rows || colspan < 1 || colspan > TABLE_LIMITS.cols)
        return false;
    }
  }
  if (caption !== undefined && (typeof caption !== 'string' || caption.length > TABLE_LIMITS.caption))
    return false;
  return true;
};

/* ---------------------------------------------------------------------------
 * Editor model: a rectangular grid with every key present. Operations return
 * a new model (or null when the operation is not possible) and never change
 * their input.
 * ------------------------------------------------------------------------- */

/**
 * Editor model of stored (or new) table data: grid padded to a rectangle,
 * `align` with one entry per column, valid merges, covered cells kept as they
 * are (the editor shows only anchors).
 * @param {object} data - Table data.
 * @param {{ rows?: number, cols?: number, withHeadings?: boolean }} [defaults] - Size and header row of a new table.
 * @returns {{ withHeadings: boolean, stretched: boolean, headerColumn: boolean, content: string[][], align: Array<string|null>, merges: Array<object>, caption: string }} Model.
 */
export const toTableModel = (data, defaults = {}) => {
  const d = isObject(data) ? data : {};
  let content = Array.isArray(d.content)
    ? d.content
        .slice(0, TABLE_LIMITS.rows)
        .map((row) =>
          Array.isArray(row)
            ? row.slice(0, TABLE_LIMITS.cols).map((cell) => (typeof cell === 'string' ? cell : ''))
            : []
        )
    : [];
  let cols = tableWidth(content);
  if (!content.length || !cols) {
    const rows = Math.min(Math.max(Number(defaults.rows) || 2, 1), TABLE_LIMITS.rows);
    cols = Math.min(Math.max(Number(defaults.cols) || 2, 1), TABLE_LIMITS.cols);
    content = Array.from({ length: rows }, () => Array(cols).fill(''));
  }
  content = content.map((row) => (row.length < cols ? [...row, ...Array(cols - row.length).fill('')] : row));
  const withHeadings =
    typeof d.withHeadings === 'boolean'
      ? d.withHeadings
      : Array.isArray(d.content) && d.content.length
        ? false
        : defaults.withHeadings === true;
  const align = Array.from({ length: cols }, (_, c) => {
    const value = Array.isArray(d.align) ? d.align[c] : null;
    return TABLE_ALIGNS.includes(value) ? value : null;
  });
  return {
    withHeadings,
    stretched: d.stretched === true,
    headerColumn: d.headerColumn === true,
    content,
    align,
    merges: normalizeMerges(d.merges, content.length, cols, { headerRow: withHeadings }),
    caption: typeof d.caption === 'string' ? d.caption.slice(0, TABLE_LIMITS.caption) : '',
  };
};

/**
 * Stored data of an editor model: the 2.3 keys always, the 2.4 keys only when
 * set; covered cells are emptied.
 * @param {ReturnType<typeof toTableModel>} model - Model.
 * @returns {object} Table data.
 */
export const fromTableModel = (model) => {
  const { covered } = mergeMap(model.merges);
  const out = {
    withHeadings: model.withHeadings === true,
    stretched: model.stretched === true,
    content: model.content.map((row, r) => row.map((cell, c) => (covered.has(`${r}:${c}`) ? '' : cell))),
  };
  if (model.headerColumn) out.headerColumn = true;
  const align = cleanTableAlign(model.align, tableWidth(model.content));
  if (align) out.align = align;
  if (model.merges.length) out.merges = model.merges.map((merge) => ({ ...merge }));
  if (!isBlankInlineHtml(model.caption)) out.caption = model.caption;
  return out;
};

const copy = (model) => ({
  ...model,
  content: model.content.map((row) => [...row]),
  align: [...model.align],
  merges: model.merges.map((merge) => ({ ...merge })),
});

const rowsOf = (model) => model.content.length;
const colsOf = (model) => (model.content[0] ? model.content[0].length : 0);
const dropSingles = (merges) => merges.filter((merge) => merge.rowspan * merge.colspan >= 2);

/**
 * The merge that contains a cell (anchor or covered), or null.
 * @param {{ merges: Array<object> }} model - Model.
 * @param {number} row - Row.
 * @param {number} col - Column.
 * @returns {object|null} Merge.
 */
export const mergeAt = (model, row, col) =>
  model.merges.find(
    (merge) =>
      row >= merge.row &&
      row < merge.row + merge.rowspan &&
      col >= merge.col &&
      col < merge.col + merge.colspan
  ) || null;

/**
 * Span of a cell: its merge, or the cell itself.
 * @param {object} model - Model.
 * @param {number} row - Row.
 * @param {number} col - Column.
 * @returns {{ row: number, col: number, rowspan: number, colspan: number }} Span.
 */
export const spanAt = (model, row, col) => mergeAt(model, row, col) || { row, col, rowspan: 1, colspan: 1 };

/**
 * Grows a rectangle (inclusive `top`, `left`, `bottom`, `right`) until no
 * merge is cut by its edge.
 * @param {object} model - Model.
 * @param {{ top: number, left: number, bottom: number, right: number }} rect - Rectangle.
 * @returns {{ top: number, left: number, bottom: number, right: number }} Rectangle.
 */
export const expandRect = (model, rect) => {
  const out = {
    top: Math.min(rect.top, rect.bottom),
    bottom: Math.max(rect.top, rect.bottom),
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const merge of model.merges) {
      const box = {
        row: out.top,
        col: out.left,
        rowspan: out.bottom - out.top + 1,
        colspan: out.right - out.left + 1,
      };
      if (!intersects(box, merge)) continue;
      const bottom = merge.row + merge.rowspan - 1;
      const right = merge.col + merge.colspan - 1;
      if (merge.row < out.top || merge.col < out.left || bottom > out.bottom || right > out.right) {
        out.top = Math.min(out.top, merge.row);
        out.left = Math.min(out.left, merge.col);
        out.bottom = Math.max(out.bottom, bottom);
        out.right = Math.max(out.right, right);
        changed = true;
      }
    }
  }
  return out;
};

/**
 * Whether a rectangle can become one merged cell.
 * @param {object} model - Model.
 * @param {{ top: number, left: number, bottom: number, right: number }} rect - Rectangle.
 * @returns {boolean} Result.
 */
export const canMergeRect = (model, rect) => {
  const box = expandRect(model, rect);
  if (box.top < 0 || box.left < 0 || box.bottom >= rowsOf(model) || box.right >= colsOf(model)) return false;
  if ((box.bottom - box.top + 1) * (box.right - box.left + 1) < 2) return false;
  if (
    model.merges.some(
      (m) =>
        m.row === box.top &&
        m.col === box.left &&
        m.row + m.rowspan - 1 === box.bottom &&
        m.col + m.colspan - 1 === box.right
    )
  )
    return false;
  return !(model.withHeadings && box.top === 0 && box.bottom > 0);
};

/**
 * Merges a rectangle into one cell. The non-empty contents are joined in
 * reading order with a line break into the anchor cell.
 * @param {object} model - Model.
 * @param {{ top: number, left: number, bottom: number, right: number }} rect - Rectangle.
 * @returns {object|null} New model, or null when not possible.
 */
export const mergeRect = (model, rect) => {
  if (!canMergeRect(model, rect)) return null;
  const box = expandRect(model, rect);
  const next = copy(model);
  const { covered } = mergeMap(next.merges);
  const parts = [];
  for (let r = box.top; r <= box.bottom; r += 1)
    for (let c = box.left; c <= box.right; c += 1) {
      const html = covered.has(`${r}:${c}`) ? '' : next.content[r][c];
      if (!isBlankInlineHtml(html)) parts.push(html);
      next.content[r][c] = '';
    }
  next.content[box.top][box.left] = parts.join('<br>');
  next.merges = next.merges.filter(
    (m) =>
      !(
        m.row >= box.top &&
        m.col >= box.left &&
        m.row + m.rowspan - 1 <= box.bottom &&
        m.col + m.colspan - 1 <= box.right
      )
  );
  if (next.merges.length >= TABLE_LIMITS.merges) return null;
  next.merges.push({
    row: box.top,
    col: box.left,
    rowspan: box.bottom - box.top + 1,
    colspan: box.right - box.left + 1,
  });
  next.merges.sort((a, b) => a.row - b.row || a.col - b.col);
  return next;
};

/**
 * Rectangle of a cell's span joined with its neighbour to the right or below.
 * @param {object} model - Model.
 * @param {number} row - Row.
 * @param {number} col - Column.
 * @param {'right'|'down'} direction - Direction.
 * @returns {{ top: number, left: number, bottom: number, right: number }|null} Rectangle, or null at the edge.
 */
export const neighbourRect = (model, row, col, direction) => {
  const span = spanAt(model, row, col);
  const rect = {
    top: span.row,
    left: span.col,
    bottom: span.row + span.rowspan - 1,
    right: span.col + span.colspan - 1,
  };
  if (direction === 'right') {
    if (rect.right + 1 >= colsOf(model)) return null;
    rect.right += 1;
  } else {
    if (rect.bottom + 1 >= rowsOf(model)) return null;
    rect.bottom += 1;
  }
  return expandRect(model, rect);
};

/**
 * Splits the merged cell that contains a cell; its content stays in the anchor.
 * @param {object} model - Model.
 * @param {number} row - Row.
 * @param {number} col - Column.
 * @returns {object|null} New model, or null when the cell is not merged.
 */
export const splitCell = (model, row, col) => {
  const merge = mergeAt(model, row, col);
  if (!merge) return null;
  const next = copy(model);
  next.merges = next.merges.filter((m) => !(m.row === merge.row && m.col === merge.col));
  return next;
};

/**
 * Inserts an empty row before `at` (0..rows). A row inserted inside a merged
 * cell makes it one row taller.
 * @param {object} model - Model.
 * @param {number} at - Index.
 * @returns {object|null} New model, or null at the row limit.
 */
export const insertRow = (model, at) => {
  if (rowsOf(model) >= TABLE_LIMITS.rows || at < 0 || at > rowsOf(model)) return null;
  const next = copy(model);
  next.content.splice(at, 0, Array(colsOf(model)).fill(''));
  next.merges = next.merges.map((m) => {
    if (m.row >= at) return { ...m, row: m.row + 1 };
    if (at < m.row + m.rowspan) return { ...m, rowspan: m.rowspan + 1 };
    return m;
  });
  // Header row merges span one row, so a new row never joins one.
  return next;
};

/**
 * Deletes a row (never the last one). Merged cells that span it get shorter;
 * when it held their anchor, the content moves to the next row.
 * @param {object} model - Model.
 * @param {number} at - Index.
 * @returns {object|null} New model, or null when not possible.
 */
export const deleteRow = (model, at) => {
  if (rowsOf(model) <= 1 || at < 0 || at >= rowsOf(model)) return null;
  const next = copy(model);
  const merges = [];
  for (const m of next.merges) {
    if (m.row + m.rowspan - 1 < at) merges.push(m);
    else if (m.row > at) merges.push({ ...m, row: m.row - 1 });
    else if (m.rowspan > 1) {
      if (m.row === at) next.content[at + 1][m.col] = next.content[at][m.col];
      merges.push({ ...m, rowspan: m.rowspan - 1 });
    }
  }
  next.content.splice(at, 1);
  // Deleting the header row can move a body merge into the first row.
  next.merges = normalizeMerges(dropSingles(merges), rowsOf(next), colsOf(next), {
    headerRow: next.withHeadings,
  });
  return next;
};

/**
 * Inserts an empty column before `at` (0..cols). A column inserted inside a
 * merged cell makes it one column wider.
 * @param {object} model - Model.
 * @param {number} at - Index.
 * @returns {object|null} New model, or null at the column limit.
 */
export const insertColumn = (model, at) => {
  if (colsOf(model) >= TABLE_LIMITS.cols || at < 0 || at > colsOf(model)) return null;
  const next = copy(model);
  next.content.forEach((row) => row.splice(at, 0, ''));
  next.align.splice(at, 0, null);
  next.merges = next.merges.map((m) => {
    if (m.col >= at) return { ...m, col: m.col + 1 };
    if (at < m.col + m.colspan) return { ...m, colspan: m.colspan + 1 };
    return m;
  });
  return next;
};

/**
 * Deletes a column (never the last one). Merged cells that span it get
 * narrower; when it held their anchor, the content moves to the next column.
 * @param {object} model - Model.
 * @param {number} at - Index.
 * @returns {object|null} New model, or null when not possible.
 */
export const deleteColumn = (model, at) => {
  if (colsOf(model) <= 1 || at < 0 || at >= colsOf(model)) return null;
  const next = copy(model);
  const merges = [];
  for (const m of next.merges) {
    if (m.col + m.colspan - 1 < at) merges.push(m);
    else if (m.col > at) merges.push({ ...m, col: m.col - 1 });
    else if (m.colspan > 1) {
      if (m.col === at) next.content[m.row][at + 1] = next.content[m.row][at];
      merges.push({ ...m, colspan: m.colspan - 1 });
    }
  }
  next.content.forEach((row) => row.splice(at, 1));
  next.align.splice(at, 1);
  next.merges = dropSingles(merges);
  return next;
};

/**
 * Turns the header row on or off. Turning it on splits merged cells that
 * reach from the first row into the body.
 * @param {object} model - Model.
 * @param {boolean} on - Header row.
 * @returns {object} New model.
 */
export const setHeaderRow = (model, on) => {
  const next = copy(model);
  next.withHeadings = Boolean(on);
  next.merges = normalizeMerges(next.merges, rowsOf(next), colsOf(next), { headerRow: next.withHeadings });
  return next;
};

/**
 * Sets the alignment of one column.
 * @param {object} model - Model.
 * @param {number} col - Column.
 * @param {'left'|'center'|'right'|null} value - Alignment.
 * @returns {object} New model.
 */
export const setColumnAlign = (model, col, value) => {
  const next = copy(model);
  if (col >= 0 && col < next.align.length) next.align[col] = TABLE_ALIGNS.includes(value) ? value : null;
  return next;
};

/**
 * Pastes a grid of inline HTML strings with its top left corner at a cell.
 * Rows and columns are added up to the limits; cells covered by a merge are
 * skipped.
 * @param {object} model - Model.
 * @param {number} row - Row.
 * @param {number} col - Column.
 * @param {string[][]} grid - Cells (already safe inline HTML).
 * @returns {object} New model.
 */
export const pasteGrid = (model, row, col, grid) => {
  let next = copy(model);
  const height = Math.min(grid.length, TABLE_LIMITS.rows - row);
  const width = Math.min(tableWidth(grid), TABLE_LIMITS.cols - col);
  while (rowsOf(next) < row + height) next = insertRow(next, rowsOf(next));
  while (colsOf(next) < col + width) next = insertColumn(next, colsOf(next));
  const { covered } = mergeMap(next.merges);
  for (let r = 0; r < height; r += 1)
    for (let c = 0; c < width; c += 1) {
      if (covered.has(`${row + r}:${col + c}`)) continue;
      const value = grid[r][c];
      if (typeof value === 'string') next.content[row + r][col + c] = value;
    }
  return next;
};

/**
 * Reads tab-separated text (spreadsheet or office table copy) into a grid of
 * plain strings. Text without a tab is not a grid.
 * @param {string} text - Clipboard text.
 * @returns {string[][]|null} Grid, or null.
 */
export const parseTabularText = (text) => {
  if (typeof text !== 'string' || !text.includes('\t') || text.length > 1024 * 1024) return null;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length > TABLE_LIMITS.rows) lines.length = TABLE_LIMITS.rows;
  return lines.map((line) => line.split('\t').slice(0, TABLE_LIMITS.cols));
};

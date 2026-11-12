import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { normalizeEditorData } from '../shared/editor-data.mjs';
import { sanitizeEditorData } from '../shared/sanitize-policy.mjs';
import { inlineToHtml } from '../shared/render/inline.mjs';
import { renderHtml, renderMarkdown, renderText } from '../shared/render/index.mjs';
import { buildEditorSchema } from '../shared/schema.mjs';
import { htmlToBlocks, markdownToBlocks, parseHtmlWithHtmlparser2 } from '../shared/convert/index.mjs';
import { lintDocument } from '../shared/quality.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { createReplica } from '../shared/collab-replica.mjs';
import { createSeedUpdate, docToEditorData, applyEditorDataToDoc } from '../shared/ydoc.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import {
  TABLE_LIMITS,
  canMergeRect,
  deleteColumn,
  deleteRow,
  expandRect,
  fromTableModel,
  insertColumn,
  insertRow,
  isTableDataShapeValid,
  mergeRect,
  neighbourRect,
  normalizeMerges,
  parseTabularText,
  pasteGrid,
  setHeaderRow,
  splitCell,
  toTableModel,
} from '../shared/table.mjs';
import { validate } from './helpers/json-schema.mjs';

/**
 * Tables v2 (2.4): header column, column alignment, merged cells, caption.
 * Stored compatibility, policy bounds, every renderer, conversion, quality,
 * diff, find and replace, the editor model and live collaboration.
 */

const store = (value) =>
  sanitizeEditorData(normalizeEditorData(value), {
    sanitizeInlineHtml: (html) => inlineToHtml(html),
    sanitizeRawHtml: (html) => inlineToHtml(html),
    rawHtml: 'sanitize',
  });
const doc = (data, id = 't1') => ({ time: 1, version: '2.31.7', blocks: [{ id, type: 'table', data }] });
const cleanTable = (data) => store(doc(data)).blocks[0].data;

const V2 = {
  withHeadings: true,
  stretched: false,
  headerColumn: true,
  align: [null, 'right', 'center'],
  merges: [
    { row: 0, col: 1, rowspan: 1, colspan: 2 },
    { row: 1, col: 2, rowspan: 2, colspan: 1 },
  ],
  caption: 'Prices <b>2026</b>',
  content: [
    ['', 'Q1', 'covered'],
    ['A', '1', 'x'],
    ['B', '2', 'covered too'],
  ],
};

test('stored tables from before 2.4 keep their exact shape through the policy', () => {
  const old = { withHeadings: true, stretched: true, content: [['a', '<b>b</b>'], ['c']] };
  assert.deepEqual(cleanTable(old), old);
  assert.deepEqual(Object.keys(cleanTable({ content: [['x']] })), ['withHeadings', 'stretched', 'content']);
  // Default values of the new keys are not written.
  assert.deepEqual(
    cleanTable({ ...old, headerColumn: false, align: [null, null], merges: [], caption: ' <br> ' }),
    old
  );
});

test('policy: new keys are bounded, merges valid, covered cells emptied, grid rectangular', () => {
  const out = cleanTable(V2);
  assert.deepEqual(out, {
    withHeadings: true,
    stretched: false,
    content: [
      ['', 'Q1', ''],
      ['A', '1', 'x'],
      ['B', '2', ''],
    ],
    headerColumn: true,
    align: [null, 'right', 'center'],
    merges: V2.merges,
    caption: 'Prices <b>2026</b>',
  });
  // Ragged rows are padded only when merges need a rectangle.
  assert.deepEqual(
    cleanTable({ content: [['a', 'b'], ['c']], merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }] })
      .content,
    [
      ['a', ''],
      ['c', ''],
    ]
  );
  const hostile = cleanTable({
    withHeadings: true,
    headerColumn: 'yes',
    align: ['middle', 'left', '<script>', 'center', 'right'],
    caption: `<img src=x onerror=alert(1)>${'c'.repeat(TABLE_LIMITS.caption + 50)}`,
    merges: [
      { row: 1, col: 0, rowspan: 1, colspan: 1 }, // one cell
      { row: 0, col: 0, rowspan: 2, colspan: 1 }, // header row into the body
      { row: 1, col: 0, rowspan: 2, colspan: 2 },
      { row: 2, col: 1, rowspan: 1, colspan: 2 }, // overlaps the previous one
      { row: 1, col: 2, rowspan: 5, colspan: 1 }, // outside the grid
      { row: '1', col: 2, rowspan: 2, colspan: 1 }, // not an integer
      { row: 1.5, col: 2, rowspan: 1, colspan: 2 },
      { row: -1, col: 0, rowspan: 2, colspan: 1 },
      { row: 1, col: 2, rowspan: 2, colspan: 1, extra: '<script>' },
      null,
      'x',
    ],
    content: [
      ['h1', 'h2', 'h3'],
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ],
  });
  assert.equal(hostile.headerColumn, undefined);
  assert.deepEqual(hostile.align, [null, 'left']);
  assert.deepEqual(hostile.merges, [
    { row: 1, col: 0, rowspan: 2, colspan: 2 },
    { row: 1, col: 2, rowspan: 2, colspan: 1 },
  ]);
  assert.deepEqual(hostile.content, [
    ['h1', 'h2', 'h3'],
    ['a', '', 'c'],
    ['', '', ''],
  ]);
  assert.doesNotMatch(hostile.caption, /<img|onerror/);
  assert.ok(hostile.caption.length <= TABLE_LIMITS.caption);
  // At most TABLE_LIMITS.merges merges are read.
  const many = Array.from({ length: TABLE_LIMITS.merges + 5 }, (_, i) => ({
    row: i,
    col: 0,
    rowspan: 1,
    colspan: 2,
  }));
  const big = cleanTable({ content: Array.from({ length: 500 }, () => ['a', 'b', 'c']), merges: many });
  assert.equal(big.merges.length, 500);
  assert.ok(normalizeMerges(many, 2000, 3).length <= TABLE_LIMITS.merges);
});

test('schema describes the policy output of a table v2', () => {
  const schema = buildEditorSchema();
  assert.deepEqual(validate(schema, schema, store(doc(V2))), []);
  assert.notDeepEqual(validate(schema, schema, doc({ ...cleanTable(V2), align: ['middle'] })), []);
  assert.notDeepEqual(
    validate(
      schema,
      schema,
      doc({ ...cleanTable(V2), merges: [{ row: 0, col: 0, rowspan: 0, colspan: 1 }] })
    ),
    []
  );
});

test('renderers: caption, thead, header column, spans and alignment classes', () => {
  assert.equal(
    renderHtml(doc(V2)),
    '<table class="mex-table"><caption>Prices <b>2026</b></caption><thead><tr><th scope="col"></th><th scope="col" colspan="2" class="mex-align-right">Q1</th></tr></thead><tbody><tr><th scope="row">A</th><td class="mex-align-right">1</td><td rowspan="2" class="mex-align-center">x</td></tr><tr><th scope="row">B</th><td class="mex-align-right">2</td></tr></tbody></table>'
  );
  assert.equal(
    renderMarkdown(doc(V2)),
    'Prices **2026**\n\n|   | Q1 |   |\n| --- | ---: | :---: |\n| A | 1 | x |\n| B | 2 |   |'
  );
  assert.equal(renderText(doc(V2)), 'Prices 2026\n\tQ1\t\nA\t1\tx\nB\t2\t');
  // Header column only, no header row.
  assert.equal(
    renderHtml(doc({ withHeadings: false, headerColumn: true, content: [['k', 'v']] })),
    '<table class="mex-table"><tbody><tr><th scope="row">k</th><td>v</td></tr></tbody></table>'
  );
  // No style attribute anywhere (CSP friendly).
  assert.doesNotMatch(renderHtml(doc(V2)), /style=/);
});

test('renderer output of tables saved before 2.4 is unchanged', () => {
  const old = doc({
    withHeadings: true,
    content: [
      ['A', 'B|C'],
      ['1<br>x', '<b>2</b>'],
    ],
  });
  assert.equal(
    renderHtml(old),
    '<table class="mex-table"><thead><tr><th scope="col">A</th><th scope="col">B|C</th></tr></thead><tbody><tr><td>1<br>x</td><td><b>2</b></td></tr></tbody></table>'
  );
  assert.equal(renderMarkdown(old), '| A | B\\|C |\n| --- | --- |\n| 1 x | **2** |');
  assert.equal(renderText(old), 'A\tB|C\n1 x\t2');
});

test('HTML conversion: th, scope, colspan/rowspan, text-align/align and caption', () => {
  const convert = (html) => htmlToBlocks(html, { parse: parseHtmlWithHtmlparser2 }).blocks[0].data;
  const word = `<table class=MsoTableGrid><tr><td><p class=MsoNormal><b>Name</b></p></td><td><p class=MsoNormal align=center style='text-align:center'><b>Qty</b></p></td></tr>
    <tr><td><p class=MsoNormal>Apple</p></td><td><p class=MsoNormal align=center style='text-align:center'>3</p></td></tr>
    <tr><td colspan=2><p class=MsoNormal>Total</p></td></tr></table>`;
  assert.deepEqual(convert(word), {
    withHeadings: false,
    stretched: false,
    content: [
      ['<b>Name</b>', '<b>Qty</b>'],
      ['Apple', '3'],
      ['Total', ''],
    ],
    align: [null, 'center'],
    merges: [{ row: 2, col: 0, rowspan: 1, colspan: 2 }],
  });
  const semantic = convert(
    '<table><caption>Plan</caption><thead><tr><th>Day</th><th>AM</th><th>PM</th></tr></thead><tbody><tr><th scope="row">Mon</th><td rowspan="2">Off</td><td>Gym</td></tr><tr><th scope="row">Tue</th><td align="right">Run</td></tr></tbody></table>'
  );
  assert.deepEqual(semantic, {
    withHeadings: true,
    stretched: false,
    content: [
      ['Day', 'AM', 'PM'],
      ['Mon', 'Off', 'Gym'],
      ['Tue', '', 'Run'],
    ],
    headerColumn: true,
    merges: [{ row: 1, col: 1, rowspan: 2, colspan: 1 }],
    caption: 'Plan',
  });
  // A rowspan ends with its row group; spans are bounded.
  const clipped = convert(
    '<table><thead><tr><th rowspan="3">H</th><th>I</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'
  );
  assert.equal(clipped.merges, undefined);
  assert.deepEqual(clipped.content, [
    ['H', 'I'],
    ['a', 'b'],
  ]);
  const huge = convert('<table><tr><td colspan="100000">x</td></tr></table>');
  assert.equal(huge.content[0].length, TABLE_LIMITS.cols);
  // Tables without the new features convert exactly as before.
  assert.deepEqual(convert('<table><tr><th>a</th></tr><tr><td>b</td><td>c</td></tr></table>'), {
    withHeadings: true,
    stretched: false,
    content: [
      ['a', ''],
      ['b', 'c'],
    ],
  });
});

test('Markdown conversion keeps the GFM alignment row', () => {
  const data = markdownToBlocks('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', {
    parse: parseHtmlWithHtmlparser2,
  }).blocks[0].data;
  assert.deepEqual(data.align, ['left', 'center', 'right']);
  const plain = markdownToBlocks('| a |\n|---|\n| 1 |', { parse: parseHtmlWithHtmlparser2 }).blocks[0].data;
  assert.equal(plain.align, undefined);
});

test('quality: a header row or a header column passes, empty header cells are reported', () => {
  const rules = (data) =>
    lintDocument(doc(data)).issues.map((issue) => `${issue.rule}:${JSON.stringify(issue.params || {})}`);
  const rows = [
    ['k1', 'v1'],
    ['k2', 'v2'],
  ];
  assert.deepEqual(rules({ withHeadings: false, content: rows }), ['table-no-header:{}']);
  assert.deepEqual(rules({ withHeadings: false, headerColumn: true, content: rows }), []);
  assert.deepEqual(
    rules({
      withHeadings: true,
      content: [
        ['', 'b'],
        ['1', '2'],
      ],
    }),
    ['table-empty-header:{"count":1}']
  );
  // The corner cell with both header kinds may stay empty; covered cells do not count.
  assert.deepEqual(
    rules({
      withHeadings: true,
      headerColumn: true,
      content: [
        ['', 'Q1', ''],
        ['A', '1', '2'],
      ],
      merges: [{ row: 0, col: 1, rowspan: 1, colspan: 2 }],
    }),
    []
  );
  assert.deepEqual(rules({ withHeadings: true, content: [['', '']] }), []);
});

test('diff: merges and alignment are readable values, the caption is text', () => {
  const before = doc({
    withHeadings: true,
    stretched: false,
    content: [
      ['a', 'b'],
      ['c', 'd'],
    ],
  });
  const after = doc({
    withHeadings: true,
    stretched: false,
    content: [
      ['a b', ''],
      ['c', 'd'],
    ],
    align: ['center'],
    merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }],
    caption: 'New caption',
  });
  const [entry] = diffDocuments(before, after);
  const fields = Object.fromEntries(entry.fields.map((field) => [field.path, field]));
  assert.deepEqual([fields.merges.kind, fields.merges.after], ['value', 'A1:B1']);
  assert.deepEqual([fields.align.kind, fields.align.after], ['value', 'center']);
  assert.equal(fields.caption.kind, 'text');
});

test('find and replace reaches cells and the caption', () => {
  const value = doc({ withHeadings: false, stretched: false, content: [['old']], caption: 'An old caption' });
  const { matches } = findMatches(value, 'old');
  assert.deepEqual(
    matches.map((match) => match.path),
    ['content.0.0', 'caption']
  );
  const replaced = replaceMatches(value, 'old', 'new');
  assert.equal(replaced.count, 2);
  assert.deepEqual(
    [replaced.data.blocks[0].data.content[0][0], replaced.data.blocks[0].data.caption],
    ['new', 'An new caption']
  );
});

test('editor model: rows and columns keep merges consistent', () => {
  const m = toTableModel({
    withHeadings: false,
    content: [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ],
  });
  const merged = mergeRect(m, { top: 0, left: 0, bottom: 1, right: 1 });
  assert.deepEqual(merged.merges, [{ row: 0, col: 0, rowspan: 2, colspan: 2 }]);
  assert.equal(merged.content[0][0], 'a<br>b<br>d<br>e');
  assert.deepEqual(fromTableModel(merged).content, [
    ['a<br>b<br>d<br>e', '', 'c'],
    ['', '', 'f'],
    ['g', 'h', 'i'],
  ]);
  // A row inserted inside a merge makes it taller; deleting its anchor row moves the content.
  assert.deepEqual(insertRow(merged, 1).merges, [{ row: 0, col: 0, rowspan: 3, colspan: 2 }]);
  assert.deepEqual(insertRow(merged, 0).merges, [{ row: 1, col: 0, rowspan: 2, colspan: 2 }]);
  const shorter = deleteRow(merged, 0);
  assert.deepEqual(shorter.merges, [{ row: 0, col: 0, rowspan: 1, colspan: 2 }]);
  assert.equal(shorter.content[0][0], 'a<br>b<br>d<br>e');
  assert.deepEqual(insertColumn(merged, 1).merges, [{ row: 0, col: 0, rowspan: 2, colspan: 3 }]);
  assert.deepEqual(deleteColumn(deleteColumn(merged, 0), 0).merges, []);
  assert.equal(insertColumn(merged, 1).align.length, 4);
  // Selections grow to whole merges; header rows refuse merges into the body.
  assert.deepEqual(expandRect(merged, { top: 1, left: 1, bottom: 2, right: 2 }), {
    top: 0,
    left: 0,
    bottom: 2,
    right: 2,
  });
  assert.equal(canMergeRect(setHeaderRow(m, true), { top: 0, left: 0, bottom: 1, right: 0 }), false);
  assert.deepEqual(setHeaderRow(merged, true).merges, []);
  assert.deepEqual(neighbourRect(merged, 0, 0, 'right'), { top: 0, left: 0, bottom: 1, right: 2 });
  assert.equal(neighbourRect(m, 2, 2, 'down'), null);
  assert.deepEqual(splitCell(merged, 1, 1).merges, []);
  assert.equal(splitCell(m, 0, 0), null);
  // Deleting the header row never leaves a merge across the new header row.
  const header = { ...mergeRect(m, { top: 1, left: 0, bottom: 2, right: 0 }), withHeadings: true };
  assert.deepEqual(deleteRow(header, 0).merges, []);
  // Limits.
  assert.equal(deleteRow(toTableModel({ content: [['x']] }), 0), null);
  assert.equal(deleteColumn(toTableModel({ content: [['x']] }), 0), null);
  const wide = toTableModel({ content: [Array(TABLE_LIMITS.cols).fill('')] });
  assert.equal(insertColumn(wide, 0), null);
});

test('editor model: stored tables round-trip; new tables get the configured size', () => {
  const old = {
    withHeadings: true,
    stretched: false,
    content: [
      ['a', 'b'],
      ['c', 'd'],
    ],
  };
  assert.deepEqual(fromTableModel(toTableModel(old)), old);
  assert.deepEqual(fromTableModel(toTableModel(cleanTable(V2))), cleanTable(V2));
  const fresh = toTableModel({}, { rows: 2, cols: 3, withHeadings: true });
  assert.deepEqual(fresh.content, [
    ['', '', ''],
    ['', '', ''],
  ]);
  assert.equal(fresh.withHeadings, true);
  // A ragged stored table is shown as a full grid.
  assert.deepEqual(toTableModel({ content: [['a', 'b'], ['c']] }).content, [
    ['a', 'b'],
    ['c', ''],
  ]);
});

test('spreadsheet paste: tab-separated text fills cells and grows the table', () => {
  assert.equal(parseTabularText('no tabs here'), null);
  const grid = parseTabularText('a\tb\r\nc\td\n');
  assert.deepEqual(grid, [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  const m = toTableModel({ content: [['x', 'y']] });
  const next = pasteGrid(m, 0, 1, grid);
  assert.deepEqual(next.content, [
    ['x', 'a', 'b'],
    ['', 'c', 'd'],
  ]);
  // Covered cells are skipped.
  const merged = mergeRect(toTableModel({ content: [['1', '2', '3']] }), {
    top: 0,
    left: 0,
    bottom: 0,
    right: 1,
  });
  assert.deepEqual(pasteGrid(merged, 0, 0, [['p', 'q', 'r']]).content, [['p', '', 'r']]);
});

test('live guard: valid table data is accepted, malformed data is refused', () => {
  assert.equal(isTableDataShapeValid(cleanTable(V2)), true);
  // Merges that overlap or leave the grid (two people at once) are valid here; the policy drops them.
  assert.equal(
    isTableDataShapeValid({ content: [['a']], merges: [{ row: 3, col: 3, rowspan: 2, colspan: 2 }] }),
    true
  );
  for (const bad of [
    { content: [['a']], headerColumn: 'yes' },
    { content: [['a']], align: ['middle'] },
    { content: [['a']], merges: [{ row: 0, col: 0, rowspan: 0, colspan: 2 }] },
    { content: [['a']], merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2, x: 1 }] },
    { content: [['a']], merges: [{ row: 0.5, col: 0, rowspan: 1, colspan: 2 }] },
    { content: [['a']], caption: 'x'.repeat(TABLE_LIMITS.caption + 1) },
    { content: [[1]] },
    { content: Array.from({ length: TABLE_LIMITS.rows + 1 }, () => ['a']) },
    { content: [Array(TABLE_LIMITS.cols + 1).fill('')] },
  ])
    assert.equal(isTableDataShapeValid(bad), false, JSON.stringify(bad).slice(0, 80));

  const seed = createSeedUpdate(
    doc({
      withHeadings: true,
      content: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    }),
    'e1'
  );
  const room = new Y.Doc();
  Y.applyUpdate(room, seed);
  const updateFrom = (data) => {
    const client = new Y.Doc();
    Y.applyUpdate(client, seed);
    const before = Y.encodeStateVector(client);
    applyEditorDataToDoc(client, doc(data));
    return Y.encodeStateAsUpdate(client, before);
  };
  const good = updateFrom({
    withHeadings: true,
    content: [
      ['a', ''],
      ['c', 'd'],
    ],
    headerColumn: true,
    align: ['center', null],
    merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }],
    caption: 'Cap',
  });
  assert.deepEqual(applyCheckedUpdate(room, good), { ok: true, changed: true });
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, seed);
  const bad = updateFrom({
    withHeadings: true,
    content: [
      ['a', 'b'],
      ['c', 'd'],
    ],
    align: ['diagonal'],
  });
  assert.equal(applyCheckedUpdate(fresh, bad).code, 'INVALID_BLOCK');
});

/* Two editors over one room (as in collab-convergence.test.mjs), every update through the guard. */
const clone = (value) => JSON.parse(JSON.stringify(value));
const client = (seedUpdate) => {
  const outbox = [];
  const replica = createReplica({
    onLocalUpdate: (update) => outbox.push(update),
    onShouldRender: () => {},
    captureTimeout: 0,
  });
  replica.applyRemote(seedUpdate);
  const c = {
    replica,
    outbox,
    editor: null,
    render() {
      const { data, catchUp } = replica.snapshot();
      c.editor = clone(data);
      replica.markShown(catchUp, clone(data));
    },
    edit(fn) {
      const next = clone(c.editor);
      fn(next.blocks[0].data);
      c.editor = next;
      replica.pushLocal(clone(next));
    },
  };
  c.render();
  return c;
};
const room = (data) => {
  const seedUpdate = createSeedUpdate(doc(data), 'epoch-1');
  const server = new Y.Doc();
  Y.applyUpdate(server, seedUpdate);
  const clients = [client(seedUpdate), client(seedUpdate)];
  const flush = () => {
    for (const c of clients)
      for (const update of c.outbox.splice(0)) {
        assert.equal(applyCheckedUpdate(server, update).ok, true);
        for (const other of clients) if (other !== c) other.replica.applyRemote(update);
      }
    for (const c of clients) c.render();
  };
  return { server, clients, flush };
};

test('two editors: different cells, a header toggle and a merge converge', () => {
  const { server, clients, flush } = room({
    withHeadings: false,
    stretched: false,
    content: [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ],
  });
  const [a, b] = clients;
  a.edit((d) => {
    d.content[1][2] = 'F!';
  });
  b.edit((d) => {
    d.content[0][0] = 'A!';
    d.withHeadings = true;
    d.headerColumn = true;
  });
  flush();
  assert.deepEqual(a.editor, b.editor);
  assert.deepEqual(a.editor.blocks[0].data, {
    withHeadings: true,
    stretched: false,
    content: [
      ['A!', 'b', 'c'],
      ['d', 'e', 'F!'],
    ],
    headerColumn: true,
  });
  // One merges the body, the other aligns a column and adds a caption.
  a.edit((d) => {
    d.content[1][0] = 'd e';
    d.content[1][1] = '';
    d.merges = [{ row: 1, col: 0, rowspan: 1, colspan: 2 }];
  });
  b.edit((d) => {
    d.align = [null, null, 'right'];
    d.caption = 'Totals';
  });
  flush();
  assert.deepEqual(a.editor, b.editor);
  const merged = a.editor.blocks[0].data;
  assert.deepEqual(merged.merges, [{ row: 1, col: 0, rowspan: 1, colspan: 2 }]);
  assert.deepEqual(merged.align, [null, null, 'right']);
  assert.equal(merged.caption, 'Totals');
  assert.deepEqual(docToEditorData(server).blocks[0].data, merged);
  // Removing the merge again converges to no merges at all.
  b.edit((d) => {
    delete d.merges;
  });
  flush();
  assert.deepEqual(a.editor, b.editor);
  assert.equal(a.editor.blocks[0].data.merges, undefined);
});

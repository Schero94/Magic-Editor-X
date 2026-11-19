import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
  COLUMNS_LIMITS,
  cleanColumnsData,
  columnsTextFields,
  createColumnsData,
  groupColumnItems,
  isColumnsDataShapeValid,
  layoutWeights,
  layoutsFor,
  newColumnsId,
} from '../shared/columns.mjs';
import { BLOCK_POLICIES, isBuiltInBlock, sanitizeEditorData } from '../shared/sanitize-policy.mjs';
import { buildEditorSchema } from '../shared/schema.mjs';
import { renderHtml, renderText, renderMarkdown } from '../shared/render/index.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import { createReplica } from '../shared/collab-replica.mjs';
import { createSeedUpdate, applyEditorDataToDoc } from '../shared/ydoc.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { lintDocument, extractLinks } from '../shared/quality.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { collectSegments, applySegments } from '../shared/ai-fields.mjs';
import { toTranslationPayload, repairLocalizedValue } from '../shared/ai-localization.mjs';
import { resolveFieldPreset, checkPreset, fixPresetViolations, isBlockAllowed } from '../shared/presets.mjs';
import { computeStats } from '../shared/editor-data.mjs';
import { XSS, xssDocument, assertSafeHtml } from './helpers/xss-corpus.mjs';
import { validate } from './helpers/json-schema.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');

const clone = (value) => JSON.parse(JSON.stringify(value));
const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });
const item = (id, text, extra = {}) => ({ id, type: 'paragraph', text, ...extra });
const columnsBlock = (id, columns, extra = {}) => ({
  id,
  type: 'columns',
  data: { columns, ...extra, _mex: 1 },
});
const twoColumns = () =>
  columnsBlock('cols1', [
    {
      id: 'left',
      items: [
        item('h1', 'Left title', { type: 'heading', level: 2 }),
        item('p1', 'Left <b>text</b> with a <a href="https://www.example.test/a">pricing page</a>'),
        item('l1', 'one', { type: 'list', style: 'ordered' }),
        item('l2', 'two', { type: 'list', style: 'ordered' }),
      ],
    },
    { id: 'right', items: [item('p2', 'Right text')] },
  ]);
const identity = (value) => (typeof value === 'string' ? value : '');

test('policy: pads, cuts, bounds, repairs ids and writes defaults only when they differ', () => {
  const out = cleanColumnsData(
    {
      columns: [
        {
          id: 'a',
          items: [
            { id: 'x', type: 'heading', level: 9, text: 'H' },
            { id: 'x', type: 'list', text: 'dup id', style: 'weird' },
            { type: 'nope', text: 'no id', level: 2, style: 'ordered' },
            'not an item',
          ],
        },
      ],
      layout: 'wide-center',
      gap: 'medium',
      valign: 'bottom',
      extra: 'dropped',
    },
    identity,
    1
  );
  assert.equal(out.columns.length, 2, 'padded to two columns');
  assert.deepEqual(out.columns[0].items, [
    { id: 'x', type: 'heading', text: 'H', level: 3 },
    { id: 'a-2', type: 'list', text: 'dup id', style: 'unordered' },
    { id: 'a-3', type: 'paragraph', text: 'no id' },
    { id: 'a-4', type: 'paragraph', text: '' },
  ]);
  assert.equal(out.columns[1].id, 'col2');
  assert.equal(out.layout, undefined, 'wide-center needs three columns');
  assert.equal(out.gap, undefined, 'medium is the default');
  assert.equal(out.valign, 'bottom');
  assert.equal(out._mex, 1);
  assert.equal(out.extra, undefined);
  // Idempotent: cleaning the clean data again changes nothing.
  assert.deepEqual(cleanColumnsData(out, identity, 1), out);
  // Bounds.
  const big = cleanColumnsData(
    {
      columns: Array.from({ length: 7 }, (_, c) => ({
        id: `c${c}`,
        items: Array.from({ length: COLUMNS_LIMITS.items + 5 }, (_, i) => ({
          id: `i${c}x${i}`,
          text: 'x'.repeat(COLUMNS_LIMITS.text + 10),
        })),
      })),
    },
    identity,
    1
  );
  assert.equal(big.columns.length, COLUMNS_LIMITS.maxColumns);
  assert.ok(big.columns.every((column) => column.items.length === COLUMNS_LIMITS.items));
  assert.equal(big.columns[0].items[0].text.length, COLUMNS_LIMITS.text);
  // Ids stay unique across columns.
  const ids = big.columns.flatMap((column) => [column.id, ...column.items.map((it) => it.id)]);
  assert.equal(new Set(ids).size, ids.length);
});

test('policy runs through the server sanitiser: inline HTML is cleaned, the marker is written', () => {
  const stored = cleanEditorValue(
    doc(
      columnsBlock('c', [
        { id: 'a', items: [item('i', 'ok <script>alert(1)</script><a href="javascript:x">l</a><b>b</b>')] },
        { id: 'b', items: [] },
      ])
    )
  );
  const [first] = stored.blocks[0].data.columns[0].items;
  assert.doesNotMatch(first.text, /script|javascript/);
  assert.match(first.text, /<b>b<\/b>/);
  assert.equal(stored.blocks[0].data._mex, 1);
  assert.equal(isBuiltInBlock(stored.blocks[0]), true);
});

test('layouts and widths per column count', () => {
  assert.deepEqual(layoutsFor(2), ['equal', 'wide-left', 'wide-right']);
  assert.deepEqual(layoutsFor(4), ['equal']);
  assert.deepEqual(layoutWeights(2, 'wide-left'), [2, 1]);
  assert.deepEqual(layoutWeights(3, 'wide-center'), [1, 2, 1]);
  assert.deepEqual(layoutWeights(3, 'wide-right'), [1, 1, 2]);
  assert.deepEqual(layoutWeights(4, 'wide-left'), [1, 1, 1, 1]);
  const fresh = createColumnsData(3, 'wide-center');
  assert.equal(fresh.columns.length, 3);
  assert.equal(fresh.layout, 'wide-center');
  assert.ok(
    fresh.columns.every((column) => column.items.length === 1 && /^[A-Za-z0-9]{10}$/.test(column.id))
  );
  assert.notEqual(newColumnsId(), newColumnsId());
  assert.deepEqual(
    groupColumnItems([
      item('a', 'x', { type: 'list', style: 'ordered' }),
      item('b', 'y', { type: 'list', style: 'ordered' }),
      item('c', 'z', { type: 'list', style: 'unordered' }),
      item('d', 'p'),
    ]).map((run) => run.kind + (run.items ? run.items.length : '')),
    ['list2', 'list1', 'paragraph']
  );
});

test('schema: stored columns validate; invalid built-in columns data does not', () => {
  const schema = buildEditorSchema();
  const stored = cleanEditorValue(doc(twoColumns()));
  assert.deepEqual(validate(schema, schema, stored), []);
  const bad = doc(
    columnsBlock(
      'c',
      Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, items: [] }))
    )
  );
  assert.notDeepEqual(validate(schema, schema, bad), [], 'five columns are too many');
  const badItem = doc(
    columnsBlock('c', [
      { id: 'a', items: [{ id: 'x', type: 'image', text: '' }] },
      { id: 'b', items: [] },
    ])
  );
  assert.notDeepEqual(validate(schema, schema, badItem), []);
});

test('renderers: HTML, text and Markdown, column by column', () => {
  const value = doc(twoColumns());
  assert.equal(
    renderHtml(value),
    '<div class="mex-columns mex-columns-2" data-mex-columns="2">' +
      '<div class="mex-column" data-mex-column="1"><h2 class="mex-header">Left title</h2>' +
      '<p class="mex-paragraph">Left <b>text</b> with a <a href="https://www.example.test/a">pricing page</a></p>' +
      '<ol class="mex-list"><li>one</li><li>two</li></ol></div>' +
      '<div class="mex-column" data-mex-column="2"><p class="mex-paragraph">Right text</p></div></div>'
  );
  assert.equal(renderText(value), 'Left title\nLeft text with a pricing page\n1. one\n2. two\n\nRight text');
  assert.equal(
    renderMarkdown(value),
    '## Left title\n\nLeft **text** with a [pricing page](https://www.example.test/a)\n\n1. one\n2. two\n\nRight text'
  );
  const options = doc(
    columnsBlock(
      'c',
      [
        { id: 'a', items: [item('x', '')] },
        { id: 'b', items: [] },
        { id: 'd', items: [] },
      ],
      {
        layout: 'wide-center',
        gap: 'small',
        valign: 'center',
      }
    )
  );
  assert.match(
    renderHtml(options),
    /^<div class="mex-columns mex-columns-3 mex-columns-wide-center mex-columns-gap-small mex-columns-valign-center" data-mex-columns="3"><div class="mex-column" data-mex-column="1"><\/div>/
  );
});

test('renderers: React and Vue output equals the HTML renderer', async () => {
  const value = doc(twoColumns());
  const html = renderHtml(value);
  const react = ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, { value }));
  const vue = await renderToString(createSSRApp({ render: () => h(VueContent, { value }) }));
  const strip = (s) => s.replace(/<!--\[-->|<!--\]-->|<!---->/g, '');
  assert.ok(react.includes(html), react);
  assert.ok(strip(vue).includes(html), vue);
});

test('renderers: every XSS payload in every columns slot stays inert', () => {
  for (const payload of XSS) {
    const value = xssDocument(payload);
    const block = value.blocks.find((b) => b.type === 'columns');
    const html = renderHtml({ blocks: [block] });
    assertSafeHtml(html, `columns: ${payload}`);
    assert.doesNotMatch(renderMarkdown({ blocks: [block] }), /(^|[^\\])<script/i);
  }
});

test('legacy: a Settings custom block named `columns` keeps its data and the generic path', () => {
  const legacy = {
    id: 'lgcol',
    type: 'columns',
    data: {
      content: 'Two <b>columns</b>',
      columns: '3',
      blockType: 'simple',
      blockName: 'columns',
    },
  };
  assert.equal(isBuiltInBlock(legacy), false);
  const stored = cleanEditorValue(doc(legacy));
  assert.equal(JSON.stringify(stored.blocks[0]), JSON.stringify(legacy));
  // Custom block output (as 2.2 rendered it): no built-in column markup.
  assert.doesNotMatch(renderHtml(doc(legacy)), /data-mex-columns|mex-column"/);
  assert.deepEqual(findMatches(doc(legacy), 'columns').matches, []);
  // The guard does not apply the built-in shape rules to custom data.
  const seed = createSeedUpdate(
    doc(item('x', 'y') && { id: 'p', type: 'paragraph', data: { text: 'p' } }),
    'e'
  );
  const room = new Y.Doc();
  Y.applyUpdate(room, seed);
  const clientDoc = new Y.Doc();
  Y.applyUpdate(clientDoc, seed);
  const before = Y.encodeStateVector(clientDoc);
  applyEditorDataToDoc(clientDoc, doc(legacy));
  assert.equal(applyCheckedUpdate(room, Y.encodeStateAsUpdate(clientDoc, before)).ok, true);
});

/* ------------------------------------------------------------- collaboration */

/** A replica with the editor modelled as plain JSON (same harness as collab-convergence). */
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
      fn(next);
      c.editor = next;
      replica.pushLocal(clone(next));
    },
  };
  c.render();
  return c;
};

const room = (seed) => {
  const seedUpdate = createSeedUpdate(seed, 'epoch-1');
  const server = new Y.Doc();
  Y.applyUpdate(server, seedUpdate);
  const clients = [client(seedUpdate), client(seedUpdate)];
  const rejected = [];
  const flush = () => {
    for (const c of clients) {
      for (const update of c.outbox.splice(0)) {
        const result = applyCheckedUpdate(server, update);
        if (!result.ok) rejected.push(result.code);
        for (const other of clients) if (other !== c) other.replica.applyRemote(update);
      }
    }
  };
  return { clients, flush, rejected };
};

const columnsOf = (c) => c.editor.blocks[0].data.columns;
const texts = (c) => columnsOf(c).map((column) => column.items.map((it) => `${it.id}:${it.text}`));

const settle = (r) => {
  r.flush();
  for (const c of r.clients) c.render();
  assert.deepEqual(r.rejected, [], 'the guard accepted every update');
  assert.deepEqual(texts(r.clients[0]), texts(r.clients[1]), 'converged');
  return texts(r.clients[0]);
};

test('collaboration: typing in different columns at the same time keeps both edits', () => {
  const r = room(doc(twoColumns()));
  const [a, b] = r.clients;
  a.edit((d) => (d.blocks[0].data.columns[0].items[1].text += ' A'));
  b.edit((d) => (d.blocks[0].data.columns[1].items[0].text += ' B'));
  const out = settle(r);
  assert.match(out[0][1], / A$/);
  assert.equal(out[1][0], 'p2:Right text B');
});

test('collaboration: typing in the same item merges character by character', () => {
  const r = room(doc(twoColumns()));
  const [a, b] = r.clients;
  a.edit((d) => (d.blocks[0].data.columns[1].items[0].text = 'XX Right text'));
  b.edit((d) => (d.blocks[0].data.columns[1].items[0].text = 'Right text YY'));
  assert.equal(settle(r)[1][0], 'p2:XX Right text YY');
});

test('collaboration: insert an item vs edit another item of the same column', () => {
  const r = room(doc(twoColumns()));
  const [a, b] = r.clients;
  a.edit((d) => d.blocks[0].data.columns[0].items.splice(1, 0, item('new1', 'Inserted')));
  b.edit((d) => (d.blocks[0].data.columns[0].items[2].text = 'one edited'));
  const out = settle(r);
  assert.deepEqual(out[0], [
    'h1:Left title',
    'new1:Inserted',
    'p1:Left <b>text</b> with a <a href="https://www.example.test/a">pricing page</a>',
    'l1:one edited',
    'l2:two',
  ]);
});

test('collaboration: insert + edit on one side vs edit of a later item on the other', () => {
  // Remote inserts before an item and edits it while the local side edits the same item.
  const r = room(doc(twoColumns()));
  const [a, b] = r.clients;
  a.edit((d) => {
    const items = d.blocks[0].data.columns[0].items;
    items.splice(2, 0, item('new2', 'Inserted'));
    items[3].text = 'one (A)';
  });
  b.edit((d) => (d.blocks[0].data.columns[0].items[2].text = 'one (B)'));
  const out = settle(r);
  assert.ok(out[0].includes('new2:Inserted'), out[0].join('|'));
  const l1 = out[0].find((entry) => entry.startsWith('l1:'));
  assert.match(l1, /A/);
  assert.match(l1, /B/);
  assert.ok(out[0].includes('l2:two'), 'the next item was not overwritten');
});

test('collaboration: delete an item vs edit of the same item (delete wins, nothing else changes)', () => {
  const r = room(doc(twoColumns()));
  const [a, b] = r.clients;
  a.edit((d) => d.blocks[0].data.columns[1].items.splice(0, 1));
  b.edit((d) => (d.blocks[0].data.columns[1].items[0].text = 'Right text edited'));
  const out = settle(r);
  assert.deepEqual(out[1], []);
  assert.equal(out[0].length, 4);
});

test('collaboration: two people add items at the end of one column; both are kept', () => {
  const r = room(doc(twoColumns()));
  const [a, b] = r.clients;
  a.edit((d) => d.blocks[0].data.columns[1].items.push(item('fromA', 'A')));
  b.edit((d) => d.blocks[0].data.columns[1].items.push(item('fromB', 'B')));
  const out = settle(r);
  assert.equal(out[1].length, 3);
  assert.ok(out[1].includes('fromA:A') && out[1].includes('fromB:B'));
});

test('guard: refuses built-in columns data outside the bounds or with foreign keys', () => {
  assert.equal(isColumnsDataShapeValid(twoColumns().data), true);
  const data = twoColumns().data;
  assert.equal(isColumnsDataShapeValid({ ...data, evil: 1 }), false);
  assert.equal(isColumnsDataShapeValid({ ...data, layout: 'zigzag' }), false);
  assert.equal(
    isColumnsDataShapeValid({ ...data, columns: Array.from({ length: 5 }, () => ({ items: [] })) }),
    false
  );
  const tooMany = clone(data);
  tooMany.columns[0].items = Array.from({ length: COLUMNS_LIMITS.items + 1 }, (_, i) => item(`i${i}`, ''));
  assert.equal(isColumnsDataShapeValid(tooMany), false);
  const longText = clone(data);
  longText.columns[0].items[0].text = 'x'.repeat(COLUMNS_LIMITS.text + 1);
  assert.equal(isColumnsDataShapeValid(longText), false);
  const badItem = clone(data);
  badItem.columns[0].items[0].onclick = 'x';
  assert.equal(isColumnsDataShapeValid(badItem), false);
  // Through the update guard.
  const seed = createSeedUpdate(doc(twoColumns()), 'e1');
  const server = new Y.Doc();
  Y.applyUpdate(server, seed);
  const attacker = new Y.Doc();
  Y.applyUpdate(attacker, seed);
  const before = Y.encodeStateVector(attacker);
  // 2.6.2: a block with an item store may briefly show more than 50 items in a column (merged
  // changes); the store holds at most 400 items.
  const flood = clone(data);
  flood.columns[0].items = Array.from({ length: 401 }, (_, i) => item(`i${i}`, ''));
  applyEditorDataToDoc(attacker, doc(columnsBlock('cols1', flood.columns)));
  assert.equal(applyCheckedUpdate(server, Y.encodeStateAsUpdate(attacker, before)).ok, false);
});

/* ------------------------------------------------------------ other modules */

test('quality: heading order across columns, empty columns, links inside columns', () => {
  const value = doc(
    { id: 'h', type: 'header', data: { text: 'Top', level: 2 } },
    columnsBlock('c', [
      {
        id: 'a',
        items: [
          item('x', 'Skips', { type: 'heading', level: 4 }),
          item('y', '<a href="https://www.example.test/more">click here</a>'),
        ],
      },
      { id: 'b', items: [item('z', '')] },
    ])
  );
  const issues = lintDocument(value).issues;
  const rules = issues.map((issue) => `${issue.rule}@${issue.path || ''}`);
  assert.ok(rules.includes('heading-order@columns.0.items.0.text'), rules.join());
  assert.ok(rules.includes('ambiguous-link-text@columns.0.items.1.text'), rules.join());
  assert.ok(rules.includes('columns-empty-column@columns.1'), rules.join());
  assert.equal(lintDocument(value).stats.links, 1);
  assert.deepEqual(
    extractLinks(value).external.map((link) => link.url),
    ['https://www.example.test/more']
  );
  // A clean block has no issues.
  assert.deepEqual(lintDocument(doc(twoColumns())).issues, []);
});

test('find and replace reaches column text in reading order and writes it back', () => {
  const value = doc(twoColumns());
  const { matches } = findMatches(value, 'text');
  assert.deepEqual(
    matches.map((match) => match.path),
    ['columns.0.items.1.text', 'columns.1.items.0.text']
  );
  const result = replaceMatches(value, 'text', 'copy');
  const out = result.data || result;
  assert.equal(out.blocks[0].data.columns[1].items[0].text, 'Right copy');
  assert.equal(out.blocks[0].data.columns[1].items[0].id, 'p2');
});

test('diff: items are compared by id; an insert does not shift later items', () => {
  const before = doc(twoColumns());
  const after = clone(before);
  after.blocks[0].data.columns[0].items.unshift(item('n', 'New'));
  after.blocks[0].data.columns[1].items[0].text = 'Right text changed';
  const [entry] = diffDocuments(before, after);
  assert.equal(entry.op, 'changed');
  const paths = entry.fields.map((field) => field.path).sort();
  assert.deepEqual(paths, [
    'columns.0.items.n.text',
    'columns.0.items.n.type',
    'columns.0.order',
    'columns.1.items.p2.text',
  ]);
  // The marker and an unchanged block are no change.
  assert.deepEqual(
    diffDocuments(before, clone(before)).map((e) => e.op),
    ['equal']
  );
});

test('AI segments and the Strapi AI translation guard reach column text; structure comes from the source', () => {
  const value = cleanEditorValue(doc(twoColumns()));
  const segments = collectSegments(value);
  assert.deepEqual(
    segments.map((segment) => segment.path),
    [
      'columns.0.items.0.text',
      'columns.0.items.1.text',
      'columns.0.items.2.text',
      'columns.0.items.3.text',
      'columns.1.items.0.text',
    ]
  );
  const applied = applySegments(value, [
    { blockId: 'cols1', path: 'columns.1.items.0.text', html: 'Rechts' },
  ]);
  assert.equal(applied.data.blocks[0].data.columns[1].items[0].text, 'Rechts');
  const { payload } = toTranslationPayload(value);
  assert.ok(!JSON.stringify(payload).includes('"left"'), 'column ids are not sent');
  // The provider answers a document that changed the structure and the ids: only text is taken.
  const answer = clone(value);
  answer.blocks[0].data.columns = answer.blocks[0].data.columns.reverse();
  answer.blocks[0].data.layout = 'wide-left';
  const texts = Object.values(payload)[0];
  const translated = repairLocalizedValue(value, {
    [Object.keys(payload)[0]]: texts.map((text) => text.replace('Left', 'Links').replace('Right', 'Rechts')),
  });
  const data = translated.value.blocks[0].data;
  assert.equal(data.columns[0].id, 'left');
  assert.equal(data.columns[0].items[0].text, 'Links title');
  assert.equal(data.columns[1].items[0].text, 'Rechts text');
  assert.equal(data.layout, undefined);
  assert.equal(translated.translated, 5);
  const structural = repairLocalizedValue(value, answer);
  assert.equal(structural.value.blocks[0].data.columns[0].id, 'left', 'structure from the source');
});

test('presets: allow/deny columns, heading levels inside columns, automatic fix', () => {
  const article = resolveFieldPreset({ preset: 'article' });
  const basic = resolveFieldPreset({ preset: 'basic' });
  assert.equal(isBlockAllowed(article, 'columns'), true);
  assert.equal(isBlockAllowed(basic, 'columns'), false);
  const custom = resolveFieldPreset({ preset: 'full', allowedBlocks: 'paragraph,header' });
  assert.equal(isBlockAllowed(custom, 'columns'), false);
  const value = cleanEditorValue(doc(twoColumns()));
  assert.deepEqual(
    checkPreset(value, basic).map((violation) => violation.code),
    ['BLOCK_NOT_ALLOWED']
  );
  const narrow = resolveFieldPreset({ preset: 'full', headingLevels: '3-4' });
  assert.deepEqual(
    checkPreset(value, narrow).map((violation) => [violation.code, violation.params.level]),
    [['HEADING_LEVEL', 2]]
  );
  const fixed = fixPresetViolations(value, narrow).data;
  assert.equal(fixed.blocks[0].data.columns[0].items[0].level, 3);
  const flattened = fixPresetViolations(value, basic).data;
  assert.equal(flattened.blocks[0].type, 'paragraph');
  assert.match(flattened.blocks[0].data.text, /^Left title<br>Left/);
  const none = resolveFieldPreset({ preset: 'full', allowedBlocks: 'paragraph,columns' });
  const noHeadings = fixPresetViolations(value, none).data;
  assert.equal(noHeadings.blocks[0].data.columns[0].items[0].type, 'paragraph');
});

test('stats count the text of the items only', () => {
  const value = cleanEditorValue(
    doc(
      columnsBlock(
        'c',
        [
          { id: 'a', items: [item('x', 'one two')] },
          { id: 'b', items: [item('y', 'three')] },
        ],
        { layout: 'wide-left' }
      )
    )
  );
  assert.equal(computeStats(value).words, 3);
  assert.equal(columnsTextFields(value.blocks[0].data).length, 2);
});

test('sanitiser keeps the columns of the block clipboard copy (all data kept)', () => {
  const block = twoColumns();
  const clean = sanitizeEditorData(doc(block), {
    sanitizeInlineHtml: (html) => html,
    sanitizeRawHtml: () => '',
  });
  assert.deepEqual(clean.blocks[0].data.columns, block.data.columns);
  assert.equal(BLOCK_POLICIES.columns({}, identity, {})._mex, 1);
});

test('templates and reuse: a columns block is inserted with a new block id and all its data', async () => {
  const { prepareInsertion } = await import('../shared/templates.mjs');
  const block = cleanEditorValue(doc(twoColumns())).blocks[0];
  const article = resolveFieldPreset({ preset: 'article' });
  const plan = prepareInsertion([block], article, { existingIds: ['cols1'] });
  assert.equal(plan.blocks.length, 1);
  assert.notEqual(plan.blocks[0].id, 'cols1');
  assert.deepEqual(plan.blocks[0].data, block.data);
  const basic = resolveFieldPreset({ preset: 'basic' });
  assert.deepEqual(prepareInsertion([block], basic).omitted, [{ type: 'columns', count: 1 }]);
});

test('suggestions: a change inside a columns block is one update suggestion for the block', async () => {
  const { suggestionsFromDiff } = await import('../shared/suggestions.mjs');
  const base = cleanEditorValue(doc(twoColumns()));
  const edited = clone(base);
  edited.blocks[0].data.columns[0].items[1].text = 'Changed';
  edited.blocks[0].data.columns[1].items.push(item('n', 'New'));
  const { suggestions } = suggestionsFromDiff(base, edited);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].op, 'update');
  assert.equal(suggestions[0].blockId, 'cols1');
});

test('comments: range anchors address the text of one column item (data path and Y.Text)', async () => {
  const { textLeaves } = await import('../shared/comment-anchor.mjs');
  const { sharedBlockTextLeaves, sharedTextAt, encodeRange, resolveRange } =
    await import('../shared/comment-relpos.mjs');
  const value = cleanEditorValue(doc(twoColumns()));
  const leaves = textLeaves(value.blocks[0].data).filter((leaf) => leaf.path.endsWith('.text'));
  assert.ok(leaves.some((leaf) => leaf.path === 'columns.1.items.0.text' && leaf.value === 'Right text'));
  const room = new Y.Doc();
  applyEditorDataToDoc(room, value);
  const entry = room.getMap('blocks').get('cols1');
  const shared = sharedBlockTextLeaves(entry).map((leaf) => leaf.path);
  assert.ok(shared.includes('columns.1.items.0.text'));
  assert.ok(shared.includes('columns.0.items.3.text'));
  const ytext = sharedTextAt(room, 'cols1', 'columns.1.items.0.text');
  assert.equal(ytext.toString(), 'Right text');
  // 2.6.2: the item keeps its Y.Text when it moves. The anchor keeps the path it was made with
  // (`columns.1.items.0.text`); the relative position names the moved Y.Text.
  const { anchoredText } = await import('../shared/comment-relpos.mjs');
  const range = encodeRange(ytext, 6, 10); // "text" of "Right text"
  const anchor = { path: 'columns.1.items.0.text', ...range };
  // A second item with the same text makes the quote ambiguous; then the item moves to column 1
  // while someone types in front of the anchored word.
  const moved = clone(value);
  moved.blocks[0].data.columns[1].items.push({ id: 'twin', type: 'paragraph', text: 'Right text' });
  applyEditorDataToDoc(room, moved);
  const next = clone(moved);
  const right = next.blocks[0].data.columns[1].items.shift();
  right.text = 'Right moved text';
  next.blocks[0].data.columns[0].items.push(right);
  applyEditorDataToDoc(room, next);
  const found = anchoredText(room, 'cols1', anchor.path, anchor.start);
  assert.equal(found, ytext, 'the anchor finds the moved item, not the item now at its old path');
  assert.equal(found.toString(), 'Right moved text');
  assert.deepEqual(resolveRange(room, found, anchor.start, anchor.end), { start: 12, end: 16 });
  // The stored path now points at the twin; the path alone would have found the wrong item.
  assert.notEqual(sharedTextAt(room, 'cols1', anchor.path), ytext);
  // An anchor without a relative position still uses its path.
  assert.equal(anchoredText(room, 'cols1', 'columns.0.items.4.text', null), ytext);
});

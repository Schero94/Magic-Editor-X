/**
 * Tables v2 (2.4) against a real host: header row and column, column
 * alignment, merged cells and caption saved through the Content Manager
 * (stored sanitised by the content policy), hostile table data cleaned on
 * save, a table from before 2.4 stored unchanged, and the Content API output
 * `?mex=html|markdown|text`.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

const RUN = `t${Date.now().toString(36)}`;
const ARTICLE = 'api::article.article';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const state = {};

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
    ['', 'Q1', 'hidden'],
    ['A', '1', 'x'],
    ['B', '2', 'hidden too'],
  ],
};
const HOSTILE = {
  withHeadings: true,
  headerColumn: 'yes',
  align: ['<script>alert(1)</script>', 'center', { evil: true }],
  caption: '<img src=x onerror=alert(1)><a href="javascript:alert(1)">cap</a>',
  merges: [
    { row: 0, col: 0, rowspan: 2, colspan: 1 },
    { row: 1, col: 0, rowspan: 9, colspan: 1 },
    { row: 1, col: 0, rowspan: 2, colspan: 2, onclick: 'x' },
    { row: 1, col: 1, rowspan: 1, colspan: 2 },
    { row: '1', col: 2, rowspan: 2, colspan: 1 },
  ],
  content: [
    ['<b onmouseover="alert(1)">h</b>', 'h2', 'h3'],
    ['<script>alert(1)</script>a', 'b', 'c'],
    ['d', 'e', 'f'],
  ],
};
const OLD = {
  withHeadings: false,
  stretched: true,
  content: [['a', '<i>b</i>'], ['c']],
};

before(async () => {
  const admin = await tokenFor('admin');
  const article = await createArticle(admin, {
    title: `Tables ${RUN}`,
    slug: `tables-${RUN}`,
    body: doc([
      { id: 'tv2', type: 'table', data: V2 },
      { id: 'tbad', type: 'table', data: HOSTILE },
      { id: 'told', type: 'table', data: OLD },
    ]),
  });
  state.id = article.documentId;
  state.stored = article.body;
  const published = await call(
    'POST',
    `/content-manager/collection-types/${ARTICLE}/${state.id}/actions/publish`,
    {
      token: admin,
      body: {},
    }
  );
  assert.equal(published.status, 200, JSON.stringify(published.body).slice(0, 300));
  const token = await call('POST', '/admin/api-tokens', {
    token: admin,
    body: { name: `mex-tables-${RUN}`, type: 'full-access', lifespan: null, description: 'integration' },
  });
  assert.equal(token.status, 201, JSON.stringify(token.body).slice(0, 300));
  state.apiToken = token.body.data.accessKey;
});

test('save: a table v2 is stored with its new keys, covered cells emptied', async () => {
  assert.deepEqual(state.stored.blocks[0].data, {
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
  const read = await call('GET', `/content-manager/collection-types/${ARTICLE}/${state.id}`, {
    token: await tokenFor('admin'),
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.data.body.blocks, state.stored.blocks);
});

test('save: hostile table data is cleaned, a table from before 2.4 is unchanged', async () => {
  const bad = state.stored.blocks[1].data;
  assert.equal(bad.headerColumn, undefined);
  assert.deepEqual(bad.align, [null, 'center']);
  assert.deepEqual(bad.merges, [{ row: 1, col: 0, rowspan: 2, colspan: 2 }]);
  const text = JSON.stringify(bad);
  assert.doesNotMatch(text, /script|onerror|onmouseover|onclick|javascript:/i);
  assert.deepEqual(bad.content, [
    ['<b>h</b>', 'h2', 'h3'],
    ['a', '', 'c'],
    ['', '', 'f'],
  ]);
  assert.deepEqual(state.stored.blocks[2].data, OLD);
});

test('?mex=html, markdown and text render the table v2', async () => {
  const get = async (format) => {
    const response = await call('GET', `/api/articles/${state.id}?mex=${format}`, { token: state.apiToken });
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
    return response.body.data.body;
  };
  const html = await get('html');
  assert.ok(
    html.startsWith(
      '<table class="mex-table"><caption>Prices <b>2026</b></caption><thead><tr><th scope="col"></th><th scope="col" colspan="2" class="mex-align-right">Q1</th></tr></thead><tbody><tr><th scope="row">A</th><td class="mex-align-right">1</td><td rowspan="2" class="mex-align-center">x</td></tr><tr><th scope="row">B</th><td class="mex-align-right">2</td></tr></tbody></table>'
    ),
    html.slice(0, 600)
  );
  assert.match(
    html,
    /<table class="mex-table mex-stretched"><tbody><tr><td>a<\/td><td><i>b<\/i><\/td><\/tr><tr><td>c<\/td><\/tr><\/tbody><\/table>$/
  );
  assert.doesNotMatch(html, /style=|script|onerror|javascript:/i);
  const markdown = await get('markdown');
  assert.ok(
    markdown.startsWith('Prices **2026**\n\n|   | Q1 |   |\n| --- | ---: | :---: |'),
    markdown.slice(0, 200)
  );
  const text = await get('text');
  assert.ok(text.startsWith('Prices 2026\n\tQ1\t\nA\t1\tx'), text.slice(0, 200));
});

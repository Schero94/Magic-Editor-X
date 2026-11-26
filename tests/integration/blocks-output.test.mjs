/**
 * 2.13 `?mex=blocks` against a running Strapi host (`api::article.article` with `body`
 * (Magic Editor X, full preset) and `legacy` (Blocks), `api.rest.strictParams: true`,
 * `@strapi/plugin-graphql`). The output must be a Strapi Blocks value the running Strapi accepts
 * when it is written into a Blocks field, extension nodes appear only on request, invalid
 * parameters answer 400, and GraphQL serves the same value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor } from './helpers.mjs';

const UID = 'api::article.article';
const RUN = Date.now().toString(36);
const CM = `/content-manager/collection-types/${UID}`;

const VALUE = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'h1', type: 'header', data: { text: `Blocks output ${RUN}`, level: 2 } },
    {
      id: 'p1',
      type: 'paragraph',
      data: {
        text: 'Plain <b>bold</b> <i>italic</i> <u>under</u> <s>strike</s> <code>code</code> <a href="https://example.test/docs">link</a><br>next',
      },
    },
    {
      id: 'l1',
      type: 'list',
      data: {
        style: 'unordered',
        meta: {},
        items: [
          { content: 'One', meta: {}, items: [{ content: 'Nested', meta: {}, items: [] }] },
          { content: 'Two', meta: {}, items: [] },
        ],
      },
    },
    { id: 'q1', type: 'quote', data: { text: 'A quote', caption: '', alignment: 'left' } },
    { id: 'c1', type: 'codeFlask', data: { code: 'const a = 1;', language: 'javascript' } },
    {
      id: 't1',
      type: 'table',
      data: {
        withHeadings: true,
        stretched: false,
        content: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
    },
    { id: 'd1', type: 'delimiter', data: {} },
  ],
};

let apiKey;
let documentId;

test('setup: a published article with a Magic Editor X body and a full-access API token', async () => {
  const token = await tokenFor('admin');
  const created = await call('POST', `${CM}?locale=en`, {
    token,
    body: { title: `Output ${RUN}`, body: VALUE },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  documentId = created.body.data.documentId;
  const publish = await call('POST', `${CM}/${documentId}/actions/publish?locale=en`, { token, body: {} });
  assert.equal(publish.status, 200);
  const key = await call('POST', '/admin/api-tokens', {
    token,
    body: { name: `mex-blocks-${RUN}`, type: 'full-access', lifespan: null, description: 'integration' },
  });
  assert.equal(key.status, 201);
  apiKey = key.body.data.accessKey;
});

test('?mex=blocks: Strapi Blocks nodes; the fallback for tables; nothing for delimiters', async () => {
  const response = await call('GET', `/api/articles/${documentId}?mex=blocks`, { token: apiKey });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  const nodes = response.body.data.body;
  assert.deepEqual(
    nodes.map((node) => node.type),
    ['heading', 'paragraph', 'list', 'quote', 'code', 'paragraph', 'paragraph']
  );
  assert.deepEqual(
    nodes[2].children.map((child) => child.type),
    ['list-item', 'list', 'list-item']
  );
  assert.ok(
    nodes[1].children.some((child) => child.type === 'link' && child.url === 'https://example.test/docs')
  );
  assert.equal(nodes[4].language, 'javascript');
  assert.ok(JSON.stringify(nodes).includes('A | B'));
});

test('the output is accepted by the running Strapi when written into a Blocks field', async () => {
  const response = await call('GET', `/api/articles/${documentId}?mex=blocks`, { token: apiKey });
  const token = await tokenFor('admin');
  const created = await call('POST', `${CM}?locale=en`, {
    token,
    body: { title: `Round trip ${RUN}`, legacy: response.body.data.body },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 500));
  assert.deepEqual(created.body.data.legacy, response.body.data.body);
});

test('mexExtensions=true keeps the table as an extension node; invalid values answer 400', async () => {
  const response = await call('GET', `/api/articles/${documentId}?mex=blocks&mexExtensions=true`, {
    token: apiKey,
  });
  assert.equal(response.status, 200);
  const table = response.body.data.body.find((node) => node.type === 'magic-editor-x/table');
  assert.ok(table, 'extension node');
  assert.deepEqual(table.data.content, [
    ['A', 'B'],
    ['1', '2'],
  ]);
  assert.equal(table.children[0].type, 'text');
  for (const query of ['mex=blocks&mexExtensions=yes', 'mex=blocksx']) {
    const invalid = await call('GET', `/api/articles/${documentId}?${query}`, { token: apiKey });
    assert.equal(invalid.status, 400, query);
  }
});

test('GraphQL bodyBlocks returns the same nodes', async () => {
  const response = await call('POST', '/graphql', {
    token: apiKey,
    body: {
      query: `query($id: ID!) { article(documentId: $id) { bodyBlocks plain: bodyBlocks(extensions: false) ext: bodyBlocks(extensions: true) } }`,
      variables: { id: documentId },
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  assert.ok(!response.body.errors, JSON.stringify(response.body.errors));
  const rest = await call('GET', `/api/articles/${documentId}?mex=blocks`, { token: apiKey });
  assert.deepEqual(response.body.data.article.bodyBlocks, rest.body.data.body);
  assert.ok(response.body.data.article.ext.some((node) => node.type === 'magic-editor-x/table'));
});

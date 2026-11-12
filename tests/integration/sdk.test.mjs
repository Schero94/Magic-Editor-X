/**
 * Custom block SDK (2.3): the host registers the example block `calloutCard`
 * (tests/fixtures/callout-card.mjs, docs/guides/custom-blocks-sdk.md) in its
 * `register()` with `strapi.plugin('magic-editor-x').service('blocks')
 * .register(definition)`. The suite checks the save round trip (hostile data
 * cleaned by the schema), preset refusal, the live collaboration guard,
 * `?mex=` and GraphQL output through the definition, the admin config summary
 * and the Settings name clash. Synthetic data only.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, openSession, connect, waitFor } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

const RUN = Date.now().toString(36);
const ARTICLE = 'api::article.article';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const card = (id, data) => ({ id, type: 'calloutCard', data });
const HOSTILE = {
  title: `<img src=x onerror=alert(1)>Card ${'x'.repeat(300)}`,
  body: 'Hello <b onclick="alert(1)">bold</b><script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://ok.example.test/a">good</a>',
  link: 'javascript:alert(1)',
  tone: 'evil',
  extra: { nested: '<script>alert(1)</script>' },
  __proto__: { polluted: true },
};
const state = {};

const send = (client, update) =>
  new Promise((resolve) =>
    client.socket
      .timeout(5000)
      .emit('mx:update', update, (error, reply) => resolve(error ? { timeout: true } : reply))
  );
const diffOf = (client, fn) => {
  const before = Y.encodeStateVector(client.ydoc);
  fn(client.ydoc);
  return Y.encodeStateAsUpdate(client.ydoc, before);
};

before(async () => {
  const admin = await tokenFor('admin');
  const token = await call('POST', '/admin/api-tokens', {
    token: admin,
    body: { name: `mex-sdk-${RUN}`, type: 'read-only', lifespan: null, description: 'integration' },
  });
  assert.equal(token.status, 201, JSON.stringify(token.body).slice(0, 300));
  state.apiToken = token.body.data.accessKey;
});

test('GET /config lists the code-registered block (names and field types only)', async () => {
  const response = await call('GET', '/magic-editor-x/config', { token: await tokenFor('editor') });
  assert.equal(response.status, 200);
  const entry = response.body.data.codeBlocks.find((block) => block.name === 'calloutCard');
  assert.deepEqual(entry, {
    name: 'calloutCard',
    version: 1,
    title: 'Callout card',
    presets: ['article'],
    fields: [
      { key: 'title', type: 'text' },
      { key: 'body', type: 'inline' },
      { key: 'link', type: 'url' },
      { key: 'tone', type: 'enum' },
    ],
  });
});

test('save round trip: hostile data is cleaned by the schema, unknown keys are never stored', async () => {
  const admin = await tokenFor('admin');
  const created = await createArticle(admin, {
    title: `SDK ${RUN}`,
    body: doc([
      card('c1', HOSTILE),
      card('c2', { title: 'Second', body: 'Ok', link: '/en/about', tone: 'success' }),
    ]),
  });
  state.documentId = created.documentId;
  const read = await call('GET', `/content-manager/collection-types/${ARTICLE}/${created.documentId}`, {
    token: admin,
  });
  assert.equal(read.status, 200);
  const [first, second] = read.body.data.body.blocks;
  // PostgreSQL jsonb does not keep key order.
  assert.deepEqual(Object.keys(first.data).sort(), ['body', 'link', 'title', 'tone']);
  assert.equal(first.data.title.length, 120);
  assert.equal(first.data.link, '');
  assert.equal(first.data.tone, 'info');
  assert.doesNotMatch(first.data.body, /script|onclick|javascript/i);
  assert.match(first.data.body, /<b>bold<\/b>/);
  assert.match(first.data.body, /<a href="https:\/\/ok\.example\.test\/a">good<\/a>/);
  assert.deepEqual(second.data, { title: 'Second', body: 'Ok', link: '/en/about', tone: 'success' });
  const publish = await call(
    'POST',
    `/content-manager/collection-types/${ARTICLE}/${created.documentId}/actions/publish`,
    { token: admin, body: {} }
  );
  assert.equal(publish.status, 200, JSON.stringify(publish.body).slice(0, 300));
});

test('field presets: the block is refused where the preset leaves it out', async () => {
  const admin = await tokenFor('admin');
  for (const field of ['summary', 'teaser']) {
    const response = await call('POST', `/content-manager/collection-types/${ARTICLE}`, {
      token: admin,
      body: { title: `SDK preset ${field} ${RUN}`, [field]: doc([card('c', { title: 'x' })]) },
    });
    assert.equal(response.status, 400, field);
    assert.equal(response.body.error.details.code, 'PRESET_VIOLATION');
    assert.deepEqual(response.body.error.details.violations[0].params, { type: 'calloutCard' });
  }
});

test('?mex=html|text|markdown and GraphQL render the block through its definition', async () => {
  const get = (format) =>
    call('GET', `/api/articles/${state.documentId}?mex=${format}`, { token: state.apiToken });
  const html = (await get('html')).body.data.body;
  assert.match(html, /^<aside class="callout-card callout-card-info" data-mex-block="calloutCard">/);
  assert.match(html, /<a class="callout-card-link" href="\/en\/about">Read more<\/a>/);
  // The hostile title is escaped text; no element carries an event handler or a script URL.
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;Card/);
  assert.doesNotMatch(html, /<script|<img|<[^>]*\son\w+=|href="javascript:/i);
  const text = (await get('text')).body.data.body;
  assert.ok(text.includes('Second\nOk\n/en/about'), text);
  const markdown = (await get('markdown')).body.data.body;
  assert.ok(markdown.includes('**Second**\n\nOk\n\n[Read more](</en/about>)'), markdown);
  const json = (await get('json')).body.data.body;
  // PostgreSQL jsonb does not keep key order.
  assert.deepEqual(Object.keys(json.blocks[0].data).sort(), ['body', 'link', 'title', 'tone']);

  const gql = await call('POST', '/graphql', {
    token: state.apiToken,
    body: { query: `{ article(documentId: "${state.documentId}") { bodyRendered(format: HTML) } }` },
  });
  assert.equal(gql.status, 200, JSON.stringify(gql.body).slice(0, 300));
  assert.equal(gql.body.data.article.bodyRendered, html);
});

test('Settings > Custom blocks cannot take the name of a code-registered block', async () => {
  const admin = await tokenFor('admin');
  const response = await call('POST', '/magic-editor-x/custom-blocks', {
    token: admin,
    body: { name: 'calloutcard', label: 'Clash', blockType: 'simple', fields: [] },
  });
  assert.equal(response.status, 400, JSON.stringify(response.body).slice(0, 300));
  assert.deepEqual(response.body.error.details.fieldErrors.name, [
    'A block with this name is defined in code',
  ]);
  const imported = await call('POST', '/magic-editor-x/custom-blocks/import', {
    token: admin,
    body: {
      format: 'magic-editor-x/custom-blocks',
      version: 2,
      blocks: [{ name: 'CalloutCard', label: 'Clash', blockType: 'simple', fields: [] }],
    },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body).slice(0, 300));
  assert.deepEqual(imported.body.data.skipped, [{ name: 'CalloutCard', reason: 'exists' }]);
});

test('collaboration: the guard accepts the block live and refuses it in a field whose preset leaves it out', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: `SDK live ${RUN}`, body: doc([]) });
  const target = { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'body' };
  const a = await connect(await openSession(editor, target));
  const b = await connect(await openSession(editor, target));
  const reply = await send(
    a,
    diffOf(a, (d) =>
      applyEditorDataToDoc(
        d,
        doc([card('live1', { title: 'Live', body: 'From A', link: '', tone: 'warning' })])
      )
    )
  );
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const waited = await waitFor(() => docToEditorData(b.ydoc).blocks.some((block) => block.id === 'live1'));
  assert.ok(waited >= 0, 'second editor sees the live edit');
  assert.equal(docToEditorData(b.ydoc).blocks[0].data.tone, 'warning');

  const teaser = { ...target, field: 'teaser' };
  const c = await connect(await openSession(editor, teaser));
  const refused = await send(
    c,
    diffOf(c, (d) => applyEditorDataToDoc(d, doc([card('live2', { title: 'No' })])))
  );
  assert.equal(refused.ok, false);
  for (const client of [a, b, c]) client.socket.disconnect();
});

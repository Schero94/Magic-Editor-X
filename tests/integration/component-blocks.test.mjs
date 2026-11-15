import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, openSession, connect, waitFor } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

/**
 * Component blocks (2.5) against a running host: the save middleware checks
 * component blocks against the field's `allowedComponents` and the current
 * component schema (coercion, unknown attributes dropped, rules), refuses
 * other uids with the preset error contract, `GET /config` describes the
 * components, the Content API and GraphQL output follow the current schema,
 * and live rooms accept component blocks and refuse a switch to a component
 * the field does not allow. Synthetic data only.
 *
 * Host requirement (CONTRIBUTING.md): component `blocks.cta` (title string
 * required max 80, text text max 400, url string required with a pattern,
 * style enumeration primary|secondary|ghost, highlight boolean, priority
 * integer 1-5), component `blocks.media-card` (label string, image media),
 * and the article field `body` with `options.allowedComponents: "blocks.cta,blocks.retired"`
 * (`blocks.retired` does not exist: it stands for a component deleted after use).
 */

const RUN = crypto.randomBytes(3).toString('hex');
const ARTICLE = 'api::article.article';
const CM = `/content-manager/collection-types/${ARTICLE}`;
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const cta = (id, values, uid = 'blocks.cta') => ({ id, type: 'component', data: { uid, values } });

const state = {};

/** Read-only API token for the Content API and GraphQL checks. */
const readToken = async () => {
  if (state.apiToken) return state.apiToken;
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: { name: `mex-components-${RUN}`, type: 'read-only', lifespan: null, description: 'integration' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  state.apiToken = response.body.data.accessKey;
  return state.apiToken;
};

test('GET /config describes the components (schema only)', async () => {
  const response = await call('GET', '/magic-editor-x/config', { token: await tokenFor('editor') });
  assert.equal(response.status, 200);
  const components = response.body.data.components;
  const byUid = Object.fromEntries(components.map((c) => [c.uid, c]));
  assert.equal(byUid['blocks.cta'].supported, true);
  assert.equal(byUid['blocks.cta'].displayName, 'Call to action');
  assert.deepEqual(
    byUid['blocks.cta'].fields.map((f) => `${f.name}:${f.type}`),
    ['title:string', 'text:text', 'url:string', 'style:enumeration', 'highlight:boolean', 'priority:integer']
  );
  assert.equal(byUid['blocks.media-card'].supported, false);
  assert.deepEqual(byUid['blocks.media-card'].unsupported, [
    { name: 'image', type: 'media', reason: 'type' },
  ]);
  // Without an admin session: 401.
  assert.equal((await call('GET', '/magic-editor-x/config')).status, 401);
});

test('save: a valid component block is stored with coerced values and without unknown attributes', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, {
    title: `Components ${RUN}`,
    body: doc([
      p('p1', 'Intro'),
      cta('c1', {
        title: 'Start <b>now</b>',
        url: '/start',
        style: 'secondary',
        highlight: 'true',
        priority: '2',
        unknown: 'dropped',
        nested: { a: 1 },
      }),
    ]),
  });
  state.documentId = article.documentId;
  const stored = article.body.blocks[1];
  state.ctaValues = stored.data.values;
  assert.equal(stored.type, 'component');
  assert.deepEqual(stored.data, {
    uid: 'blocks.cta',
    values: { title: 'Start <b>now</b>', url: '/start', style: 'secondary', highlight: true, priority: 2 },
    _mex: 1,
  });
});

test('save: invalid values, disallowed and unsupported components are refused with PRESET_VIOLATION', async () => {
  const editor = await tokenFor('editor');
  const cases = [
    [
      cta('c1', { title: '', url: 'ftp://nope', priority: 9 }),
      ['COMPONENT_INVALID'],
      ['title', 'url', 'priority'],
    ],
    [cta('c1', { label: 'x' }, 'blocks.media-card'), ['COMPONENT_NOT_ALLOWED'], []],
    [cta('c1', { title: 'x' }, 'blocks.group'), ['COMPONENT_NOT_ALLOWED'], []],
    [cta('c1', { title: 'x', url: '/' }, 'blocks.unknown'), ['COMPONENT_NOT_ALLOWED'], []],
  ];
  for (const [block, codes, fields] of cases) {
    const response = await call('POST', CM, {
      token: editor,
      body: { title: `Refused ${RUN}`, body: doc([block]) },
    });
    assert.equal(response.status, 400, JSON.stringify(response.body).slice(0, 300));
    const details = response.body.error.details;
    assert.equal(details.code, 'PRESET_VIOLATION');
    assert.deepEqual([...new Set(details.violations.map((v) => v.code))], codes);
    assert.deepEqual(
      details.violations.filter((v) => v.params.field).map((v) => v.params.field),
      fields
    );
    assert.deepEqual(details.errors[0].path, ['body']);
    // Details never echo values.
    assert.ok(!JSON.stringify(details).includes('nope'));
  }
  // Another field of the same entry (summary, preset basic, no components) refuses component blocks.
  const response = await call('POST', CM, {
    token: editor,
    body: { title: `Summary ${RUN}`, summary: doc([cta('s1', { title: 'x', url: '/' })]) },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.details.violations[0].code, 'COMPONENT_NOT_ALLOWED');
  // A listed component that no longer exists (deleted in the Content-Type Builder): stored values are kept.
  const update = await call('PUT', `${CM}/${state.documentId}?locale=en`, {
    token: editor,
    body: {
      body: doc([
        p('p1', 'Intro'),
        cta('c1', state.ctaValues),
        cta('c2', { old: 'kept as stored', n: 3 }, 'blocks.retired'),
      ]),
    },
  });
  assert.equal(update.status, 200, JSON.stringify(update.body).slice(0, 300));
  assert.deepEqual(update.body.data.body.blocks[2].data.values, { old: 'kept as stored', n: 3 });
});

test('Content API ?mex= and GraphQL follow the current schema; nothing is rendered by default', async () => {
  const token = await readToken();
  const published = await call('POST', `${CM}/${state.documentId}/actions/publish?locale=en`, {
    token: await tokenFor('admin'),
    body: {},
  });
  assert.equal(published.status, 200, JSON.stringify(published.body).slice(0, 300));
  const json = await call('GET', `/api/articles/${state.documentId}?mex=json`, { token });
  assert.equal(json.status, 200);
  // The block of the removed component is left out of every output.
  assert.deepEqual(
    json.body.data.body.blocks.map((b) => b.id),
    ['p1', 'c1']
  );
  const block = json.body.data.body.blocks.find((b) => b.type === 'component');
  assert.deepEqual(block.data.values, {
    title: 'Start <b>now</b>',
    url: '/start',
    style: 'secondary',
    highlight: true,
    priority: 2,
  });
  const html = await call('GET', `/api/articles/${state.documentId}?mex=html`, { token });
  assert.equal(html.body.data.body, '<p class="mex-paragraph">Intro</p>');
  const text = await call('GET', `/api/articles/${state.documentId}?mex=text`, { token });
  assert.equal(text.body.data.body, 'Intro');
  const gql = await call('POST', '/graphql', {
    token,
    body: {
      query: `query($id: ID!) { article(documentId: $id) { bodyRendered(format: HTML) bodyResolved } }`,
      variables: { id: state.documentId },
    },
  });
  assert.equal(gql.status, 200);
  assert.equal(gql.body.errors, undefined, JSON.stringify(gql.body.errors));
  assert.equal(gql.body.data.article.bodyRendered, '<p class="mex-paragraph">Intro</p>');
  const resolved = gql.body.data.article.bodyResolved.blocks.find((b) => b.type === 'component');
  assert.equal(resolved.data.values.title, 'Start <b>now</b>');
});

test('live rooms: component edits merge; switching to a component the field does not allow is refused', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, {
    title: `Live components ${RUN}`,
    body: doc([cta('lc', { title: 'Start', text: 'Line', url: '/a' })]),
  });
  const target = { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'body' };
  const a = await connect(await openSession(editor, target));
  const b = await connect(await openSession(editor, target));
  const send = async (client, data) => {
    const before = Y.encodeStateVector(client.ydoc);
    applyEditorDataToDoc(client.ydoc, data);
    return new Promise((resolve) =>
      client.socket
        .timeout(5000)
        .emit('mx:update', Y.encodeStateAsUpdate(client.ydoc, before), (error, value) =>
          resolve(error ? { timeout: true } : value)
        )
    );
  };
  const base = docToEditorData(a.ydoc).blocks[0].data;
  const [ra, rb] = await Promise.all([
    send(
      a,
      doc([
        { id: 'lc', type: 'component', data: { ...base, values: { ...base.values, title: 'Start now' } } },
      ])
    ),
    send(
      b,
      doc([{ id: 'lc', type: 'component', data: { ...base, values: { ...base.values, text: 'Line two' } } }])
    ),
  ]);
  assert.equal(ra.ok, true, JSON.stringify(ra));
  assert.equal(rb.ok, true, JSON.stringify(rb));
  const merged = { title: 'Start now', text: 'Line two', url: '/a' };
  assert.notEqual(
    await waitFor(
      () =>
        JSON.stringify(docToEditorData(a.ydoc).blocks[0].data.values) === JSON.stringify(merged) &&
        JSON.stringify(docToEditorData(b.ydoc).blocks[0].data.values) === JSON.stringify(merged)
    ),
    -1,
    'both clients see both edits'
  );
  const current = docToEditorData(a.ydoc).blocks[0].data;
  const refused = await send(
    a,
    doc([{ id: 'lc', type: 'component', data: { ...current, uid: 'blocks.media-card' } }])
  );
  assert.equal(refused.ok, false, JSON.stringify(refused));
  for (const client of [a, b]) client.socket.disconnect();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerComponentOutputOnRead } = require('../server/src/utils/component-read.js');

/**
 * 2.6 review: plain Content API and GraphQL reads returned component `values`
 * of attributes that were later deleted (or made private) in the
 * Content-Type Builder, and blocks of deleted components; only `?mex=` and the
 * GraphQL Rendered/Resolved fields filtered them. Synthetic schemas only.
 */
const ARTICLE = {
  uid: 'api::article.article',
  attributes: {
    title: { type: 'string' },
    body: { type: 'customField', customField: 'plugin::magic-editor-x.richtext' },
  },
};
const CTA = {
  uid: 'blocks.cta',
  info: { displayName: 'Call to action' },
  attributes: { title: { type: 'string' }, url: { type: 'string' } },
};
const fake = (routeType) => {
  const middlewares = [];
  const strapi = {
    components: { 'blocks.cta': CTA },
    contentType: (uid) => (uid === ARTICLE.uid ? ARTICLE : null),
    documents: { use: (fn) => middlewares.push(fn) },
    requestContext: {
      get: () => (routeType ? { state: { route: { info: { type: routeType } } } } : undefined),
    },
    log: { warn() {}, error() {}, info() {}, debug() {} },
    config: { get: () => undefined },
    plugin: () => ({ service: () => ({}) }),
  };
  registerComponentOutputOnRead(strapi);
  return { strapi, run: (ctx, result) => middlewares[0](ctx, async () => result) };
};
const block = (id, uid, values) => ({ id, type: 'component', data: { uid, values, _mex: 1 } });
const stored = () => ({
  title: 'T',
  body: {
    time: 1,
    version: '2.31.7',
    blocks: [
      { id: 'p', type: 'paragraph', data: { text: 'Intro' } },
      block('c1', 'blocks.cta', { title: 'Go', url: '/go', removedLater: 'old secret' }),
      block('c2', 'blocks.deleted', { anything: 'gone' }),
    ],
  },
});

test('Content API reads: attributes and components that no longer exist are not returned', async () => {
  const { run } = fake('content-api');
  const one = await run({ action: 'findOne', uid: ARTICLE.uid }, stored());
  assert.deepEqual(
    one.body.blocks.map((b) => b.id),
    ['p', 'c1']
  );
  assert.deepEqual(one.body.blocks[1].data.values, { title: 'Go', url: '/go' });
  const many = await run({ action: 'findMany', uid: ARTICLE.uid }, [stored(), stored()]);
  assert.ok(many.every((entry) => !JSON.stringify(entry).includes('old secret')));
});

test('admin and internal reads, writes and values without component blocks are unchanged', async () => {
  for (const routeType of ['admin', null]) {
    const { run } = fake(routeType);
    const value = stored();
    const before = JSON.stringify(value);
    assert.equal(
      JSON.stringify(await run({ action: 'findOne', uid: ARTICLE.uid }, value)),
      before,
      String(routeType)
    );
  }
  const { run } = fake('content-api');
  const write = stored();
  const before = JSON.stringify(write);
  assert.equal(
    JSON.stringify(await run({ action: 'update', uid: ARTICLE.uid }, write)),
    before,
    'writes untouched'
  );
  const plain = {
    title: 'x',
    body: { time: 1, blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] },
  };
  const body = plain.body;
  const out = await run({ action: 'findOne', uid: ARTICLE.uid }, plain);
  assert.equal(out.body, body, 'same object: byte-identical output');
});

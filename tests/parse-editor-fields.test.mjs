import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/**
 * 2.7 API audit F3: `api.autoParseJSON` parses 1.x JSON strings only in Magic
 * Editor X fields (schema-aware), never in other fields. Synthetic data only.
 */

const require = createRequire(import.meta.url);
const parseEditorFieldsMiddleware = require('../server/src/middlewares/parse-editor-fields.js');

const FIELD = 'plugin::magic-editor-x.richtext';
const LEGACY = JSON.stringify({
  time: 1,
  version: '2.28.0',
  blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }],
});
const PARSED = JSON.parse(LEGACY);

const types = {
  'api::article.article': {
    uid: 'api::article.article',
    kind: 'collectionType',
    attributes: {
      title: { type: 'string' },
      body: { type: 'json', customField: FIELD },
      notes: { type: 'text' },
      payload: { type: 'json' },
      sections: { type: 'component', repeatable: true, component: 'blocks.section' },
      zone: { type: 'dynamiczone', components: ['blocks.section', 'blocks.plain'] },
      author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
    },
  },
  'api::author.author': {
    uid: 'api::author.author',
    kind: 'collectionType',
    attributes: { bio: { type: 'json', customField: FIELD }, motto: { type: 'string' } },
  },
};
const components = {
  'blocks.section': {
    uid: 'blocks.section',
    attributes: { body: { type: 'json', customField: FIELD }, caption: { type: 'string' } },
  },
  'blocks.plain': { uid: 'blocks.plain', attributes: { text: { type: 'text' } } },
};
const strapi = {
  config: { get: (key, fallback) => fallback },
  contentType: (uid) => types[uid],
  getModel: (uid) => types[uid] || components[uid],
  components,
};
const route = (handler, apiName = 'article') => ({ handler, info: { type: 'content-api', apiName } });

const run = async (ctx) => {
  await parseEditorFieldsMiddleware({}, { strapi })(
    { method: 'GET', status: 200, path: '/api/articles', type: 'application/json', ...ctx },
    async () => {}
  );
};

test('F3: only Magic Editor X fields are parsed, incl. components, dynamic zones and relations', async () => {
  const entry = () => ({
    title: LEGACY,
    body: LEGACY,
    notes: LEGACY,
    payload: LEGACY,
    sections: [{ body: LEGACY, caption: LEGACY }],
    zone: [
      { __component: 'blocks.section', body: LEGACY, caption: LEGACY },
      { __component: 'blocks.plain', text: LEGACY },
    ],
    author: { bio: LEGACY, motto: LEGACY },
  });
  const ctx = { state: { route: route('api::article.article.find') }, body: { data: [entry()], meta: {} } };
  await run(ctx);
  const [out] = ctx.body.data;
  assert.deepEqual(out.body, PARSED);
  assert.deepEqual(out.sections[0].body, PARSED);
  assert.deepEqual(out.zone[0].body, PARSED);
  assert.deepEqual(out.author.bio, PARSED);
  for (const value of [
    out.title,
    out.notes,
    out.payload,
    out.sections[0].caption,
    out.zone[0].caption,
    out.zone[1].text,
    out.author.motto,
  ])
    assert.equal(value, LEGACY);
});

test('F3: v4 response format and short handlers are supported; other routes are untouched', async () => {
  const v4 = {
    state: { route: route('article.findOne') },
    body: { data: { id: 1, attributes: { body: LEGACY, notes: LEGACY } } },
  };
  await run(v4);
  assert.deepEqual(v4.body.data.attributes.body, PARSED);
  assert.equal(v4.body.data.attributes.notes, LEGACY);

  // A Content API route of another plugin, or no route: nothing is parsed.
  for (const state of [
    { route: { handler: 'plugin::foo.bar.find', info: { type: 'content-api', pluginName: 'foo' } } },
    {},
  ]) {
    const ctx = { state, body: { data: { body: LEGACY } } };
    await run(ctx);
    assert.equal(ctx.body.data.body, LEGACY);
  }
  // Non-editor strings, invalid JSON and non-GET requests stay as they are.
  const broken = {
    state: { route: route('api::article.article.findOne') },
    body: { data: { body: '{"blocks": [' } },
  };
  await run(broken);
  assert.equal(broken.body.data.body, '{"blocks": [');
  const post = {
    method: 'POST',
    state: { route: route('api::article.article.create') },
    body: { data: { body: LEGACY } },
  };
  await run(post);
  assert.equal(post.body.data.body, LEGACY);
});

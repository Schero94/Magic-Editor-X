import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  collectReferences,
  applyReferences,
  renderResolved,
  entryKey,
  mediaKey,
  isEmbeddedEntryBlock,
} from '../shared/resolve-references.mjs';

const require = createRequire(import.meta.url);
const createReferences = require('../server/src/services/references.js');
const { walkOutput, routeContentType } = require('../server/src/utils/output-walk.js');
const renderOutput = require('../server/src/middlewares/render-output.js');
const { plannedFields, createLoader, registerGraphql } = require('../server/src/graphql.js');

/**
 * Output transform (`?mex=`, GraphQL fields): reference collection, the
 * permission-safe resolver, the response walk, the middleware and the
 * GraphQL extension, with fake Strapi objects.
 */

const ARTICLE = 'api::article.article';
const CATEGORY = 'api::category.category';
const link = (uid, id, href, text, locale = 'en') =>
  `<a href="${href}" data-mex-uid="${uid}" data-mex-document-id="${id}" data-mex-locale="${locale}">${text}</a>`;

const value = () => ({
  time: 1,
  version: '2.31.7',
  blocks: [
    {
      id: 'p1',
      type: 'paragraph',
      data: {
        text: `A ${link(ARTICLE, 'readable1', '/articles/stale', 'Readable')} B ${link(ARTICLE, 'draft1', '/articles/draft-secret-slug', 'Drafted')} C ${link(CATEGORY, 'cat1', '/categories/hidden-slug', 'Category')}`,
      },
    },
    {
      id: 'l1',
      type: 'list',
      data: {
        style: 'unordered',
        items: [{ content: link(ARTICLE, 'readable1', '/x', 'Again'), items: [] }],
      },
    },
    {
      id: 'e1',
      type: 'entryCard',
      data: {
        entry: { id: 9, documentId: 'cat1', title: 'Stored Secret Title', note: 'stored note' },
        contentType: CATEGORY,
        displayMode: 'card',
      },
    },
    {
      id: 'i1',
      type: 'image',
      data: {
        file: { url: 'https://cdn.example.test/old.png', id: 7, alt: 'old alt' },
        caption: 'Cap',
      },
    },
    { id: 'x1', type: 'paragraph', data: { text: '<a href="https://example.test">external</a>' } },
  ],
});

test('collectReferences lists links, embedded entries and media once each', () => {
  const { data, refs } = collectReferences(value(), { locale: 'de' });
  assert.ok(data);
  const keys = [...refs.keys()].sort();
  assert.deepEqual(
    keys,
    [
      entryKey('entry', CATEGORY, 'de', 'cat1'),
      entryKey('link', ARTICLE, 'en', 'draft1'),
      entryKey('link', ARTICLE, 'en', 'readable1'),
      entryKey('link', CATEGORY, 'en', 'cat1'),
      'media|id|7',
    ].sort()
  );
  assert.equal(refs.get(entryKey('entry', CATEGORY, 'de', 'cat1')).blockType, 'entryCard');
  assert.equal(mediaKey({ documentId: 'abc' }), 'media|doc|abc');
  assert.equal(mediaKey({ id: -1 }), null);
  assert.equal(
    isEmbeddedEntryBlock({ type: 'image', data: { entry: { documentId: 'a' }, contentType: ARTICLE } }),
    false
  );
  assert.equal(
    isEmbeddedEntryBlock({ type: 'x', data: { entry: { documentId: 'a' }, contentType: 'plugin::x.y' } }),
    false
  );
  const invalid = collectReferences({
    blocks: [
      {
        type: 'paragraph',
        data: { text: '<a href="/x" data-mex-uid="admin::user" data-mex-document-id="1">x</a>' },
      },
    ],
  });
  assert.equal(invalid.refs.size, 0);
  assert.equal(collectReferences(null).data, null);
});

test('applyReferences resolves what the map has and removes the rest without leaking', () => {
  const { data } = collectReferences(value(), { locale: 'de' });
  const resolved = new Map([
    [entryKey('link', ARTICLE, 'en', 'readable1'), { href: '/en/articles/readable-alpha' }],
    [
      'media|id|7',
      { file: { url: '/uploads/new.png', alt: 'new alt', width: 10, height: 5, formats: null } },
    ],
  ]);
  const out = applyReferences(data, resolved, { locale: 'de' });
  const text = out.blocks[0].data.text;
  assert.match(text, /href="\/en\/articles\/readable-alpha"/);
  assert.doesNotMatch(text, /draft-secret-slug|hidden-slug|\/articles\/stale/);
  assert.match(text, /Drafted/, 'unresolved links keep their text');
  assert.doesNotMatch(text, /draft1"|cat1"/, 'unresolved links lose their reference attributes');
  assert.match(out.blocks[1].data.items[0].content, /readable-alpha/);
  assert.equal(out.blocks[2].data.entry, null);
  assert.equal(out.blocks[3].data.file.url, '/uploads/new.png');
  assert.equal(out.blocks[3].data.file.alt, 'old alt', 'the alt text written in the block wins');
  assert.equal(out.blocks[3].data.file.id, 7);
  assert.equal(out.blocks[4].data.text, value().blocks[4].data.text, 'external links are untouched');
  const noAlt = {
    ...data,
    blocks: [{ ...data.blocks[3], data: { ...data.blocks[3].data, file: { id: 7, url: '/x.png' } } }],
  };
  const filled = applyReferences(
    noAlt,
    new Map([['media|id|7', { file: { url: '/y.png', alt: 'library alt' } }]])
  );
  assert.equal(filled.blocks[0].data.file.alt, 'library alt', 'the library text fills an empty alt');
  // Without a media resolution the stored file stays.
  const kept = applyReferences(data, new Map(), { locale: 'de' });
  assert.equal(kept.blocks[3].data.file.url, 'https://cdn.example.test/old.png');
  // The input is not changed.
  assert.match(data.blocks[0].data.text, /draft-secret-slug/);
  assert.equal(data.blocks[2].data.entry.title, 'Stored Secret Title');

  for (const format of ['html', 'text', 'markdown']) {
    const rendered = renderResolved(out, format);
    assert.equal(typeof rendered, 'string');
    for (const secret of [
      'Stored Secret Title',
      'stored note',
      'draft-secret-slug',
      'hidden-slug',
      'cat1',
      'draft1',
    ])
      assert.ok(!rendered.includes(secret), `${format} leaks ${secret}`);
  }
  assert.match(renderResolved(out, 'html'), /<a href="\/en\/articles\/readable-alpha"[^>]*>Readable<\/a>/);
  assert.match(renderResolved(out, 'markdown'), /\[Readable\]\(\/en\/articles\/readable-alpha\)/);
  assert.equal(renderResolved(null, 'html'), '');
  assert.equal(renderResolved(null, 'json'), null);
});

test('resolved embedded entries render as a link with their current title', () => {
  const { data } = collectReferences(value(), { locale: 'de' });
  const resolved = new Map([
    [
      entryKey('entry', CATEGORY, 'de', 'cat1'),
      { entry: { id: 3, documentId: 'cat1', title: 'Live <Title>', href: '/categories/cat1' } },
    ],
  ]);
  const out = applyReferences(data, resolved, { locale: 'de' });
  assert.deepEqual(out.blocks[2].data.entry, {
    id: 3,
    documentId: 'cat1',
    title: 'Live <Title>',
    href: '/categories/cat1',
  });
  const html = renderResolved(out, 'html');
  assert.match(html, /<a class="mex-entry-link" href="\/categories\/cat1">Live &lt;Title&gt;<\/a>/);
  assert.match(html, /data-mex-block="entryCard"/);
  assert.match(renderResolved(out, 'text'), /Live <Title>/);
  assert.match(
    renderResolved(out, 'markdown'),
    /\[Live \\<Title\\>\]\(<\/categories\/cat1>\)|\[Live .*Title.*\]\(<\/categories\/cat1>\)/
  );
});

/**
 * Fake Strapi for the resolver.
 * @param {object} [options] - `{ allowed: Set<scope>, rows, delay }`.
 * @returns {{ strapi: object, calls: object }} Fake and recorded calls.
 */
const fakeStrapi = ({ allowed = new Set(), rows = {}, delay = 0 } = {}) => {
  const calls = { documents: [], verify: [], sanitize: 0, db: [] };
  const types = {
    [ARTICLE]: {
      uid: ARTICLE,
      info: { pluralName: 'articles', singularName: 'article' },
      options: { draftAndPublish: true },
      pluginOptions: { i18n: { localized: true } },
      attributes: {
        title: { type: 'string' },
        slug: { type: 'uid' },
        secret: { type: 'string', private: true },
      },
    },
    [CATEGORY]: {
      uid: CATEGORY,
      info: { pluralName: 'categories', singularName: 'category' },
      options: { draftAndPublish: false },
      attributes: { name: { type: 'string' }, note: { type: 'string' } },
    },
  };
  const strapi = {
    config: {
      get: (key) => {
        if (key === 'plugin::magic-editor-x.links.urlPattern') return '/{locale}/{collection}/{slug}';
        return undefined;
      },
    },
    log: { debug() {}, warn() {}, error() {}, info() {} },
    contentType: (uid) => types[uid],
    getModel: (uid) => types[uid] || (uid === 'plugin::upload.file' ? { uid, attributes: {} } : undefined),
    auth: {
      verify: async (auth, { scope }) => {
        calls.verify.push(scope[0]);
        if (!allowed.has(scope[0])) throw new Error('Forbidden');
      },
    },
    contentAPI: {
      sanitize: {
        output: async (row, model) => {
          calls.sanitize += 1;
          const out = { ...row };
          for (const [name, attribute] of Object.entries(model.attributes || {}))
            if (attribute.private) delete out[name];
          return out;
        },
      },
    },
    documents: (uid) => ({
      findMany: async (params) => {
        calls.documents.push({ uid, ...params });
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const ids = params.filters.documentId.$in;
        return (rows[uid] || []).filter(
          (row) =>
            ids.includes(row.documentId) &&
            (params.status !== 'published' || row.publishedAt) &&
            (!params.locale || row.locale === params.locale)
        );
      },
    }),
    db: {
      query: (uid) => ({
        findMany: async (params) => {
          calls.db.push({ uid, ...params });
          if (uid === 'plugin::upload.file')
            return [
              { id: 7, documentId: 'f7', url: '/uploads/new.png', alternativeText: 'new alt', width: 4 },
            ];
          return [{ name: 'entryCard', titleField: 'name', displayFields: ['note'] }];
        },
      }),
    },
  };
  return { strapi, calls };
};

const ROWS = {
  [ARTICLE]: [
    {
      documentId: 'readable1',
      locale: 'en',
      title: 'Alpha',
      slug: 'readable-alpha',
      secret: 'x',
      publishedAt: '2026',
    },
    {
      documentId: 'draft1',
      locale: 'en',
      title: 'Draft Secret',
      slug: 'draft-secret-slug',
      publishedAt: null,
    },
  ],
  [CATEGORY]: [{ id: 3, documentId: 'cat1', name: 'Hidden Cat', note: 'live note' }],
};
const auth = { strategy: { name: 'content-api-token' }, credentials: {} };

test('the resolver queries only readable types, published versions, one batch per type and locale', async () => {
  const { strapi, calls } = fakeStrapi({ allowed: new Set([`${ARTICLE}.find`]), rows: ROWS });
  const service = createReferences({ strapi });
  const [html] = await service.transform([{ value: value(), locale: 'de' }], { format: 'html', auth });
  assert.equal(calls.documents.length, 1, 'one query for the readable type, none for the category');
  assert.equal(calls.documents[0].uid, ARTICLE);
  assert.deepEqual(calls.documents[0].filters.documentId.$in.sort(), ['draft1', 'readable1']);
  assert.equal(calls.documents[0].status, 'published');
  assert.equal(calls.documents[0].locale, 'en');
  assert.ok(calls.verify.includes(`${CATEGORY}.find`));
  assert.ok(calls.verify.includes('plugin::upload.content-api.find'));
  assert.equal(calls.db.filter((call) => call.uid === 'plugin::upload.file').length, 0);
  assert.match(html, /href="\/en\/articles\/readable-alpha"/);
  for (const secret of [
    'Draft Secret',
    'draft-secret-slug',
    'Hidden Cat',
    'hidden-slug',
    'Stored Secret Title',
  ])
    assert.ok(!html.includes(secret), secret);
  // Without auth nothing is queried.
  const anonymous = fakeStrapi({ allowed: new Set([`${ARTICLE}.find`]), rows: ROWS });
  const [json] = await createReferences({ strapi: anonymous.strapi }).transform([{ value: value() }], {
    format: 'json',
  });
  assert.equal(anonymous.calls.documents.length, 0);
  assert.doesNotMatch(json.blocks[0].data.text, /href="\/articles\/stale"/);
});

test('the resolver sanitises rows and uses custom block definitions for embedded entries', async () => {
  const { strapi, calls } = fakeStrapi({
    allowed: new Set([`${ARTICLE}.find`, `${CATEGORY}.find`, 'plugin::upload.content-api.find']),
    rows: ROWS,
  });
  const service = createReferences({ strapi });
  const [json] = await service.transform([{ value: value(), locale: 'de' }], { format: 'json', auth });
  assert.deepEqual(json.blocks[2].data.entry, {
    note: 'live note',
    id: 3,
    documentId: 'cat1',
    title: 'Hidden Cat',
    href: '/categories/cat1',
  });
  assert.equal(json.blocks[3].data.file.url, '/uploads/new.png');
  assert.equal(json.blocks[3].data.file.alt, 'old alt');
  assert.ok(calls.sanitize >= 3);
  assert.equal(calls.documents.length, 2);
  // Draft status resolves drafts.
  const drafts = await service.transform([{ value: value(), locale: 'de' }], {
    format: 'html',
    auth,
    status: 'draft',
  });
  assert.match(drafts[0], /draft-secret-slug/);
});

test('the resolver honours maxReferences and the time budget', async () => {
  const capped = fakeStrapi({
    allowed: new Set([`${ARTICLE}.find`]),
    rows: ROWS,
  });
  const [html] = await createReferences({ strapi: capped.strapi }).transform([{ value: value() }], {
    format: 'html',
    auth,
    limits: { maxReferences: 1 },
  });
  assert.ok(capped.calls.documents.length <= 1);
  assert.ok(capped.calls.documents.every((call) => call.filters.documentId.$in.length === 1));
  assert.equal(typeof html, 'string');

  const slow = fakeStrapi({
    allowed: new Set([`${ARTICLE}.find`]),
    rows: ROWS,
    delay: 300,
  });
  const started = Date.now();
  const [late] = await createReferences({ strapi: slow.strapi }).transform([{ value: value() }], {
    format: 'html',
    auth,
    limits: { timeoutMs: 100 },
  });
  assert.ok(Date.now() - started < 290, 'answers when the budget is used up');
  assert.doesNotMatch(late, /readable-alpha|href="\/articles/);
});

const COMPONENT = {
  uid: 'blocks.text-section',
  attributes: {
    heading: { type: 'string' },
    body: { type: 'customField', customField: 'plugin::magic-editor-x.richtext' },
  },
};
const walkStrapi = {
  components: { 'blocks.text-section': COMPONENT },
  getModel: (uid) => (uid === CATEGORY ? WALK_CATEGORY : undefined),
};
const WALK_CATEGORY = {
  uid: CATEGORY,
  attributes: { body: { type: 'customField', customField: 'plugin::magic-editor-x.richtext' } },
};
const WALK_ARTICLE = {
  uid: ARTICLE,
  attributes: {
    title: { type: 'string' },
    body: { type: 'customField', customField: 'plugin::magic-editor-x.richtext' },
    sections: { type: 'component', component: 'blocks.text-section', repeatable: true },
    zone: { type: 'dynamiczone', components: ['blocks.text-section'] },
    category: { type: 'relation', target: CATEGORY },
    cover: { type: 'media' },
  },
};

test('the response walk finds fields in components, dynamic zones, relations and the v4 format', () => {
  const seen = [];
  const visit = (holder, key, _attribute, locale) => seen.push(`${key}:${locale}`);
  walkOutput(
    walkStrapi,
    WALK_ARTICLE,
    [
      {
        locale: 'de',
        title: 'x',
        body: {},
        sections: [{ body: {} }, { heading: 'h' }],
        zone: [
          { __component: 'blocks.text-section', body: {} },
          { __component: 'unknown.x', body: {} },
        ],
        category: { body: {} },
        cover: { body: {} },
      },
    ],
    visit
  );
  assert.deepEqual(seen, ['body:de', 'body:de', 'body:de', 'body:de']);
  seen.length = 0;
  walkOutput(
    walkStrapi,
    WALK_ARTICLE,
    { id: 1, attributes: { body: {}, category: { data: { attributes: { body: {} } } } } },
    visit
  );
  assert.deepEqual(seen, ['body:null', 'body:null']);
  assert.equal(
    routeContentType({ handler: 'api::article.article.find', info: { type: 'content-api' } }),
    ARTICLE
  );
  assert.equal(
    routeContentType({ handler: 'article.findOne', info: { type: 'content-api', apiName: 'article' } }),
    ARTICLE
  );
  assert.equal(routeContentType({ handler: 'api::article.article.find', info: { type: 'admin' } }), null);
  assert.equal(routeContentType(undefined), null);
});

const middlewareStrapi = (transformed) => ({
  config: { get: (key, fallback) => (key === 'api.rest.prefix' ? '/api' : fallback) },
  log: { error() {} },
  contentType: (uid) => (uid === ARTICLE ? WALK_ARTICLE : undefined),
  components: walkStrapi.components,
  getModel: walkStrapi.getModel,
  plugin: () => ({
    service: () => ({
      settings: () => ({ enabled: true }),
      transform: async (items, options) => {
        transformed.push({ count: items.length, options });
        return items.map(() => `<p>${options.format}</p>`);
      },
    }),
  }),
});

test('the middleware only acts on opted-in Content API GET requests of api types', async () => {
  const transformed = [];
  const mw = renderOutput({}, { strapi: middlewareStrapi(transformed) });
  const route = { handler: 'api::article.article.findOne', info: { type: 'content-api' } };
  const run = async (overrides) => {
    const ctx = {
      method: 'GET',
      path: '/api/articles/abc',
      query: { mex: 'html' },
      status: 200,
      state: { route, auth: { strategy: {} } },
      ...overrides,
    };
    await mw(ctx, async () => {
      ctx.body = { data: { body: { blocks: [] }, sections: [{ body: { blocks: [] } }] }, meta: {} };
    });
    return ctx;
  };
  let ctx = await run({});
  assert.equal(ctx.body.data.body, '<p>html</p>');
  assert.equal(ctx.body.data.sections[0].body, '<p>html</p>');
  assert.equal(transformed[0].count, 2, 'one transform call per response');
  assert.equal(transformed[0].options.status, 'published');

  await run({ query: { mex: 'json', status: 'draft' } });
  assert.equal(transformed[1].options.status, 'draft');

  ctx = await run({ query: {} });
  assert.deepEqual(ctx.body.data.body, { blocks: [] }, 'without mex nothing changes');

  ctx = await run({ state: { route: { ...route, info: { type: 'admin' } } } });
  assert.deepEqual(ctx.body.data.body, { blocks: [] }, 'admin routes are never touched');

  ctx = await run({ path: '/content-manager/collection-types/x' });
  assert.deepEqual(ctx.body.data.body, { blocks: [] });

  for (const mex of ['xml', ['html', 'text'], '']) {
    await assert.rejects(run({ query: { mex } }), (error) => error.name === 'ValidationError');
  }
  assert.equal(transformed.length, 2);
});

test('GraphQL fields are planned for registered types only and batched per request', async () => {
  const strapi = {
    contentTypes: {
      [ARTICLE]: {
        ...WALK_ARTICLE,
        attributes: {
          ...WALK_ARTICLE.attributes,
          hidden: { type: 'customField', customField: 'plugin::magic-editor-x.richtext', private: true },
          off: { type: 'customField', customField: 'plugin::magic-editor-x.richtext' },
        },
      },
      [CATEGORY]: WALK_CATEGORY,
      'plugin::x.y': { uid: 'plugin::x.y', attributes: WALK_CATEGORY.attributes },
    },
    components: { 'blocks.text-section': { ...COMPONENT, globalId: 'ComponentBlocksTextSection' } },
    plugin: () => ({
      service: (name) =>
        name === 'utils'
          ? {
              naming: {
                getTypeName: (ct) => (ct.uid === ARTICLE ? 'Article' : 'Category'),
                getComponentName: (c) => c.globalId,
              },
            }
          : {
              shadowCRUD: (uid) => ({
                field: (field) => ({ hasOutputEnabled: () => !(uid === ARTICLE && field === 'off') }),
              }),
            },
    }),
  };
  const fields = plannedFields(strapi, { has: (name) => name !== 'Category' });
  assert.deepEqual(
    fields.map((field) => `${field.typeName}.${field.rendered}`),
    ['Article.bodyRendered', 'ComponentBlocksTextSection.bodyRendered']
  );

  const batches = [];
  const loader = createLoader({
    plugin: () => ({
      service: () => ({
        transform: async (items, options) => {
          batches.push({ count: items.length, status: options.status });
          return items.map((item) => item.format);
        },
      }),
    }),
  });
  const context = { state: { auth: {} } };
  const results = await Promise.all([
    loader(context, { value: {}, format: 'html', status: 'published' }),
    loader(context, { value: {}, format: 'json', status: 'published' }),
    loader(context, { value: {}, format: 'text', status: 'draft' }),
  ]);
  assert.deepEqual(results, ['html', 'json', 'text']);
  assert.deepEqual(batches, [
    { count: 2, status: 'published' },
    { count: 1, status: 'draft' },
  ]);
  assert.equal(registerGraphql({ plugin: () => undefined }), false, 'no GraphQL plugin: nothing registered');
});

test('the resolver limits cannot be raised by callers', () => {
  const { strapi } = fakeStrapi();
  const service = createReferences({ strapi });
  assert.deepEqual(service.LIMITS, { maxReferences: 500, timeoutMs: 5000 });
});

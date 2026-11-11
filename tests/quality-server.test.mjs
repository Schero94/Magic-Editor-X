import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qualityService = require('../server/src/services/quality.js');
const qualityController = require('../server/src/controllers/quality.js');
const { registerPublishGuard, guardQuery } = require('../server/src/utils/publish-guard.js');
const config = require('../server/src/config/index.js');
const routes = require('../server/src/routes/index.js');

const FIELD = 'plugin::magic-editor-x.richtext';

/**
 * Fake Strapi with two API types (article: D&P, readable; secret: not readable).
 */
const fakeStrapi = ({ pluginConfig = {}, conditional = false, files = [], counters } = {}) => {
  const calls = { findMany: [], counters: 0 };
  const store = { article: ['a1', 'a2'], published: ['a1'] };
  const contentTypes = {
    'api::article.article': {
      uid: 'api::article.article',
      options: { draftAndPublish: true },
      attributes: { title: { type: 'string' } },
    },
    'api::secret.secret': { uid: 'api::secret.secret', attributes: {} },
  };
  const strapi = {
    calls,
    config: {
      get: (key) => (key.startsWith('plugin::magic-editor-x.') ? pluginConfig[key.slice(23)] : undefined),
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    contentType: (uid) => contentTypes[uid],
    components: {},
    plugin: (name) => ({
      service: (service) => {
        if (name === 'content-manager' && service === 'permission-checker')
          return {
            create: ({ model }) => ({
              cannot: { read: () => model !== 'api::article.article' },
              sanitizedQuery: { read: async () => (conditional ? { filters: { createdBy: 1 } } : {}) },
            }),
          };
        if (name === 'magic-editor-x' && service === 'store')
          return {
            hit: async () => {
              calls.counters += 1;
              if (counters === 'fail') throw new Error('db down');
              return { count: calls.counters };
            },
          };
        return {};
      },
    }),
    documents: (uid) => ({
      findMany: async (params) => {
        calls.findMany.push({ uid, ...params });
        const ids = params.filters.$and
          ? params.filters.$and[0].documentId.$in
          : params.filters.documentId.$in;
        const pool = params.status === 'published' ? store.published : store.article;
        return ids.filter((id) => pool.includes(id)).map((documentId) => ({ documentId }));
      },
    }),
    db: {
      query: () => ({
        findMany: async ({ where }) => {
          const wanted = where.$or.flatMap((part) => (part.id ? part.id.$in : part.documentId.$in));
          return files.filter((file) => wanted.includes(file.id) || wanted.includes(file.documentId));
        },
      }),
    },
  };
  return strapi;
};

const ability = (allowed = []) => ({ can: (action) => allowed.includes(action) });

test('internal links: ok, draft, missing; unreadable types are unknown', async () => {
  const strapi = fakeStrapi();
  const service = qualityService({ strapi });
  const result = await service.checkLinks({
    userAbility: ability(),
    user: { id: 1 },
    internal: [
      { uid: 'api::article.article', documentId: 'a1' },
      { uid: 'api::article.article', documentId: 'a2' },
      { uid: 'api::article.article', documentId: 'zz' },
      { uid: 'api::secret.secret', documentId: 's1' },
      { uid: 'api::nothing.nothing', documentId: 'n1' },
    ],
  });
  assert.deepEqual(
    result.internal.map((item) => item.status),
    ['ok', 'draft', 'missing', 'unknown', 'unknown']
  );
  // The unreadable type was never queried.
  assert.ok(strapi.calls.findMany.every((call) => call.uid === 'api::article.article'));
  assert.deepEqual(strapi.calls.findMany[0].fields, ['documentId']);
});

test('internal links under read conditions: not found is unknown, the permission filter applies', async () => {
  const strapi = fakeStrapi({ conditional: true });
  const result = await qualityService({ strapi }).checkLinks({
    userAbility: ability(),
    user: { id: 1 },
    internal: [
      { uid: 'api::article.article', documentId: 'a1' },
      { uid: 'api::article.article', documentId: 'zz' },
    ],
  });
  assert.deepEqual(
    result.internal.map((item) => item.status),
    ['ok', 'unknown']
  );
  assert.deepEqual(strapi.calls.findMany[0].filters.$and[1], { createdBy: 1 });
});

test('media needs upload read permission', async () => {
  const files = [{ id: 7, documentId: 'f7' }];
  const denied = await qualityService({ strapi: fakeStrapi({ files }) }).checkLinks({
    userAbility: ability(),
    user: { id: 1 },
    media: [7, 8],
  });
  assert.deepEqual(
    denied.media.map((item) => item.status),
    ['unknown', 'unknown']
  );
  const allowed = await qualityService({ strapi: fakeStrapi({ files }) }).checkLinks({
    userAbility: ability(['plugin::upload.read']),
    user: { id: 1 },
    media: [7, 8, 'f7'],
  });
  assert.deepEqual(
    allowed.media.map((item) => item.status),
    ['ok', 'missing', 'ok']
  );
});

test('external links are skipped unless the owner enables them', async () => {
  let fetched = 0;
  const service = qualityService(
    { strapi: fakeStrapi() },
    {
      fetchBounded: async () => {
        fetched += 1;
        return { statusCode: 200 };
      },
    }
  );
  const result = await service.checkLinks({
    userAbility: ability(),
    user: { id: 1 },
    external: ['https://example.com/'],
  });
  assert.deepEqual(result.external, [{ url: 'https://example.com/', status: 'skipped' }]);
  assert.equal(fetched, 0);
});

test('external links: statuses, HEAD then GET, cache, SSRF errors', async () => {
  const requests = [];
  const answers = {
    'https://example.com/ok': { HEAD: { statusCode: 200 } },
    'https://example.com/gone': { HEAD: { statusCode: 404 } },
    'https://example.com/nohead': { HEAD: { statusCode: 405 }, GET: { statusCode: 200 } },
    'https://example.com/big': { HEAD: { statusCode: 405 }, GET: 413 },
    'https://example.com/slow': { HEAD: 504 },
    'http://127.0.0.1/admin': { HEAD: 400 },
    'https://example.com/down': { HEAD: 502 },
  };
  const strapi = fakeStrapi({ pluginConfig: { 'qualityChecks.externalLinks.enabled': true } });
  const service = qualityService(
    { strapi },
    {
      fetchBounded: async (url, options) => {
        requests.push(`${options.method} ${url}`);
        assert.ok(options.maxBytes <= 256 * 1024);
        assert.equal(options.acceptStatus(500), true);
        const answer = answers[url][options.method];
        if (typeof answer === 'number') throw Object.assign(new Error('x'), { statusCode: answer });
        return answer;
      },
    }
  );
  const urls = Object.keys(answers);
  const result = await service.checkLinks({ userAbility: ability(), user: { id: 1 }, external: urls });
  assert.deepEqual(result.external, [
    { url: urls[0], status: 'ok', code: 200 },
    { url: urls[1], status: 'broken', code: 404 },
    { url: urls[2], status: 'ok', code: 200 },
    { url: urls[3], status: 'ok' },
    { url: urls[4], status: 'timeout' },
    { url: urls[5], status: 'blocked' },
    { url: urls[6], status: 'error' },
  ]);
  assert.ok(requests.includes('GET https://example.com/nohead'));
  assert.equal(strapi.calls.counters, 7);
  const before = requests.length;
  await service.checkLinks({ userAbility: ability(), user: { id: 1 }, external: [urls[0]] });
  assert.equal(requests.length, before, 'cached');
});

test('external links are rate limited per admin (429)', async () => {
  const strapi = fakeStrapi({
    pluginConfig: { 'qualityChecks.externalLinks.enabled': true, 'qualityChecks.externalLinks.perMinute': 2 },
  });
  const service = qualityService({ strapi }, { fetchBounded: async () => ({ statusCode: 200 }) });
  await assert.rejects(
    service.checkLinks({
      userAbility: ability(),
      user: { id: 1 },
      external: ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'],
    }),
    (error) => error.name === 'RateLimitError'
  );
  // The in-memory limiter applies when the shared counter fails.
  const fallback = qualityService(
    {
      strapi: fakeStrapi({
        counters: 'fail',
        pluginConfig: {
          'qualityChecks.externalLinks.enabled': true,
          'qualityChecks.externalLinks.perMinute': 1,
        },
      }),
    },
    { fetchBounded: async () => ({ statusCode: 200 }) }
  );
  await assert.rejects(
    fallback.checkLinks({
      userAbility: ability(),
      user: { id: 1 },
      external: ['https://example.com/1', 'https://example.com/2'],
    }),
    (error) => error.name === 'RateLimitError'
  );
});

test('the links route is an admin route with the access action and strict input', async () => {
  const route = routes.admin.routes.find((item) => item.path === '/quality/links');
  assert.equal(route.method, 'POST');
  assert.equal(route.handler, 'quality.links');
  assert.ok(JSON.stringify(route.config.policies).includes('plugin::magic-editor-x.access'));

  let received = null;
  const strapi = {
    plugin: () => ({
      service: () => ({ checkLinks: async (input) => ((received = input), { internal: [] }) }),
    }),
  };
  const controller = qualityController({ strapi });
  const ctx = (body) => ({ request: { body }, state: { userAbility: ability(), user: { id: 3 } } });
  for (const body of [
    { internal: [{ uid: 'plugin::upload.file', documentId: 'a' }] },
    { internal: [{ uid: 'api::a.a', documentId: 'A B' }] },
    { external: Array.from({ length: 21 }, (_v, i) => `https://example.com/${i}`) },
    { media: [-1] },
    { media: ['../x'] },
    { other: true },
  ])
    await assert.rejects(
      controller.links(ctx(body)),
      (error) => error.name === 'ValidationError',
      JSON.stringify(body)
    );
  const ok = ctx({ internal: [{ uid: 'api::a.a', documentId: 'abc', locale: 'de-CH' }], media: [3, 'f3'] });
  await controller.links(ok);
  assert.deepEqual(ok.body, { data: { internal: [] } });
  assert.equal(received.user.id, 3);
});

test('config: external link checks are off by default and validated', () => {
  assert.deepEqual(config.default.qualityChecks.externalLinks, {
    enabled: false,
    timeoutMs: 5000,
    perMinute: 30,
  });
  config.validator(config.default);
  const bad = structuredClone(config.default);
  bad.qualityChecks.externalLinks.timeoutMs = 60000;
  assert.throws(() => config.validator(bad), /qualityChecks\.externalLinks\.timeoutMs/);
});

/**
 * Fake Strapi for the publish guard: one D&P type with a guarded field, a
 * component with a guarded field and an unguarded field.
 */
const guardStrapi = (drafts) => {
  const middlewares = [];
  const queries = [];
  const strapi = {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    config: { get: () => undefined },
    components: {
      'shared.section': {
        uid: 'shared.section',
        attributes: {
          text: { type: 'json', customField: FIELD, options: { publishGuard: true, requireAlt: true } },
        },
      },
    },
    contentType: (uid) => strapi.types[uid],
    types: {
      'api::page.page': {
        uid: 'api::page.page',
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
        attributes: {
          body: { type: 'json', customField: FIELD, options: { publishGuard: true } },
          notes: { type: 'json', customField: FIELD, options: {} },
          sections: { type: 'component', repeatable: true, component: 'shared.section' },
        },
      },
      'api::plain.plain': {
        uid: 'api::plain.plain',
        options: { draftAndPublish: true },
        attributes: { body: { type: 'json', customField: FIELD } },
      },
    },
    documents: Object.assign(
      () => ({
        findMany: async (params) => {
          queries.push(params);
          return drafts.filter((draft) => !params.locale || draft.locale === params.locale);
        },
      }),
      { use: (fn) => middlewares.push(fn) }
    ),
    db: { query: () => ({ findMany: async () => drafts.map((draft) => ({ locale: draft.locale })) }) },
  };
  registerPublishGuard(strapi);
  const run = (ctx) => middlewares[0](ctx, async () => 'published');
  return { strapi, run, queries };
};

const emptyLink = {
  blocks: [{ id: 'x1', type: 'paragraph', data: { text: '<a href="https://example.com/"></a>' } }],
};
const noAlt = { blocks: [{ id: 'i1', type: 'image', data: { file: { url: 'https://example.com/a.png' } } }] };
const fine = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Click <a href="/x">here</a>' } }] };

test('publish guard reads only the guarded fields', () => {
  const { strapi } = guardStrapi([]);
  assert.deepEqual(guardQuery(strapi, strapi.types['api::page.page']), {
    fields: ['body'],
    populate: { sections: { fields: ['text'] } },
  });
  assert.equal(guardQuery(strapi, strapi.types['api::plain.plain']), null);
});

test('publish guard blocks errors, never warnings, without content in the error', async () => {
  const passing = guardStrapi([
    { documentId: 'd1', locale: 'en', body: fine, notes: emptyLink, sections: [] },
  ]);
  assert.equal(
    await passing.run({
      action: 'publish',
      uid: 'api::page.page',
      params: { documentId: 'd1', locale: 'en' },
    }),
    'published'
  );
  assert.equal(passing.queries[0].locale, 'en');
  assert.equal(passing.queries[0].status, 'draft');

  const failing = guardStrapi([
    { documentId: 'd1', locale: 'en', body: emptyLink, sections: [{ text: noAlt }] },
    { documentId: 'd1', locale: 'de', body: fine, sections: [] },
  ]);
  await assert.rejects(
    failing.run({ action: 'publish', uid: 'api::page.page', params: { documentId: 'd1', locale: '*' } }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.equal(error.details.code, 'QUALITY_GATE');
      assert.deepEqual(error.details.issues, [
        { field: 'body', rule: 'empty-link', blockId: 'x1', locale: 'en' },
        { field: 'sections.0.text', rule: 'image-alt-missing', blockId: 'i1', locale: 'en' },
      ]);
      assert.doesNotMatch(JSON.stringify(error.details), /example\.com/);
      return true;
    }
  );
  assert.deepEqual(
    failing.queries.map((query) => query.locale),
    ['en', 'de']
  );
});

test('publish guard ignores other actions and types without the option', async () => {
  const { run, queries } = guardStrapi([{ documentId: 'd1', body: emptyLink }]);
  assert.equal(
    await run({ action: 'update', uid: 'api::page.page', params: { documentId: 'd1' } }),
    'published'
  );
  assert.equal(
    await run({ action: 'publish', uid: 'api::plain.plain', params: { documentId: 'd1' } }),
    'published'
  );
  assert.equal(queries.length, 0);
});

/**
 * Internal links: URL pattern, sanitizer policy for data-mex-* attributes,
 * request validation, config validation, picker helpers and the search
 * service against a fake Strapi with Content Manager permission semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isValidLinkPattern, renderLinkPattern, DEFAULT_LINK_PATTERN } from '../shared/link-pattern.mjs';
import { cleanInternalLinkAttributes, INLINE_ATTRIBUTES } from '../shared/sanitize-policy.mjs';
import {
  moveActiveIndex,
  readInternalLink,
  internalLinkAttributes,
} from '../admin/src/editor/tools/logic.mjs';

const require = createRequire(import.meta.url);
const { sanitizeInlineHtml, cleanEditorValue } = require('../server/src/utils/sanitizer.js');
const { linkSearchSchema } = require('../server/src/utils/validation.js');
const config = require('../server/src/config/index.js');
const linksService = require('../server/src/services/links.js');
const accessService = require('../server/src/services/access.js');

const UID = 'api::article.article';

test('URL patterns: placeholders, prefixes and forbidden characters', () => {
  for (const pattern of [
    '',
    DEFAULT_LINK_PATTERN,
    '/{locale}/{collection}/{slug}',
    '/blog/{singular}-{documentId}?lang={locale}',
    'https://www.example.test/{collection}/{documentId}',
    'http://localhost:3000/{slug}',
    '/{documentId}#top',
  ])
    assert.equal(isValidLinkPattern(pattern), true, pattern);
  for (const pattern of [
    null,
    42,
    'articles/{documentId}',
    '//evil.example/{documentId}',
    'javascript:alert(1)//{documentId}',
    'https://{slug}.example.test/',
    '/{unknown}',
    '/{documentId',
    '/a b/{documentId}',
    '/"><script>/{documentId}',
    '/\\{documentId}',
    `/${'a'.repeat(500)}`,
    'mailto:{slug}@example.test',
  ])
    assert.equal(isValidLinkPattern(pattern), false, String(pattern));
});

test('URL patterns render encoded values and collapse empty segments', () => {
  const values = {
    documentId: 'abc123',
    locale: 'de',
    slug: 'hello-world',
    collection: 'articles',
    singular: 'article',
  };
  assert.equal(renderLinkPattern('', values), '/articles/abc123');
  assert.equal(renderLinkPattern('/{locale}/{collection}/{slug}', values), '/de/articles/hello-world');
  assert.equal(
    renderLinkPattern('/{locale}/{collection}/{slug}', { ...values, locale: null }),
    '/articles/hello-world'
  );
  assert.equal(
    renderLinkPattern('/{slug}', { ...values, slug: null }),
    '/abc123',
    'slug falls back to documentId'
  );
  assert.equal(renderLinkPattern('/{slug}', { ...values, slug: 'a/b?c' }), '/a%2Fb%3Fc');
  assert.equal(renderLinkPattern('/{slug}', { ...values, slug: '..' }), '/%2E%2E');
  assert.equal(
    renderLinkPattern('https://www.example.test/{locale}/{documentId}?x={locale}', { ...values, locale: '' }),
    'https://www.example.test/abc123?x='
  );
  assert.equal(renderLinkPattern('/{locale}', { ...values, locale: '' }), '/');
  assert.equal(
    renderLinkPattern('//evil.example/{documentId}', values),
    '',
    'invalid pattern renders nothing'
  );
});

test('internal-link attributes: valid values only, uid and documentId together', () => {
  assert.ok(INLINE_ATTRIBUTES.a.includes('data-mex-document-id'));
  assert.deepEqual(
    cleanInternalLinkAttributes({
      'data-mex-uid': UID,
      'data-mex-document-id': 'abc123',
      'data-mex-locale': 'de-CH',
      'data-other': 'x',
    }),
    { 'data-mex-uid': UID, 'data-mex-document-id': 'abc123', 'data-mex-locale': 'de-CH' }
  );
  assert.deepEqual(
    cleanInternalLinkAttributes({
      'data-mex-uid': UID,
      'data-mex-document-id': 'abc',
      'data-mex-locale': 'x"y',
    }),
    { 'data-mex-uid': UID, 'data-mex-document-id': 'abc' }
  );
  assert.deepEqual(cleanInternalLinkAttributes({ 'data-mex-uid': UID }), {});
  assert.deepEqual(
    cleanInternalLinkAttributes({
      'data-mex-uid': 'plugin::users-permissions.user',
      'data-mex-document-id': 'abc',
    }),
    {}
  );
  assert.deepEqual(cleanInternalLinkAttributes({ 'data-mex-uid': UID, 'data-mex-document-id': 'ABC-1' }), {});
  assert.deepEqual(cleanInternalLinkAttributes(null), {});
});

test('server sanitiser keeps valid internal links and strips invalid or misplaced attributes', () => {
  const link = `<a href="/articles/abc123" data-mex-uid="${UID}" data-mex-document-id="abc123" data-mex-locale="en">x</a>`;
  assert.equal(sanitizeInlineHtml(link), link);
  assert.equal(sanitizeInlineHtml(sanitizeInlineHtml(link)), link, 'idempotent');
  assert.equal(
    sanitizeInlineHtml(`<a href="/a" data-mex-uid="${UID}">x</a>`),
    '<a href="/a">x</a>',
    'a reference without documentId is dropped'
  );
  assert.equal(
    sanitizeInlineHtml(
      `<a href="/a" data-mex-uid="api::x.y&quot; onclick=&quot;1" data-mex-document-id="abc">x</a>`
    ),
    '<a href="/a">x</a>'
  );
  assert.equal(
    sanitizeInlineHtml(
      `<span class="cdx-tooltip" data-tooltip="t" data-mex-uid="${UID}" data-mex-document-id="abc">x</span>`
    ),
    '<span class="cdx-tooltip" data-tooltip="t">x</span>',
    'only <a> carries the reference'
  );
  assert.equal(
    sanitizeInlineHtml(
      `<a href="javascript:alert(1)" data-mex-uid="${UID}" data-mex-document-id="abc">x</a>`
    ),
    `<a data-mex-uid="${UID}" data-mex-document-id="abc">x</a>`,
    'the href policy is unchanged'
  );
  const value = cleanEditorValue({
    blocks: [{ id: 'p1', type: 'paragraph', data: { text: `See ${link}` } }],
  });
  assert.equal(value.blocks[0].data.text, `See ${link}`);
  const raw = cleanEditorValue(
    { blocks: [{ id: 'r1', type: 'raw', data: { html: link } }] },
    { rawHtml: 'sanitize' }
  );
  assert.equal(raw.blocks[0].data.html, '<a href="/articles/abc123">x</a>', 'raw HTML keeps its own policy');
});

test('link search input is strict and bounded', () => {
  assert.deepEqual(linkSearchSchema.parse({ uid: UID, q: '  hello ', locale: 'de', page: '2' }), {
    uid: UID,
    q: 'hello',
    locale: 'de',
    page: 2,
  });
  assert.equal(linkSearchSchema.safeParse({ uid: UID }).success, true);
  for (const input of [
    {},
    { uid: 'plugin::users-permissions.user' },
    { uid: 'admin::user' },
    { uid: 'api::Article.article' },
    { uid: UID, q: 'x'.repeat(101) },
    { uid: UID, q: 'a\u0000b' },
    { uid: UID, q: ['a', 'b'] },
    { uid: UID, locale: 'en;drop' },
    { uid: UID, page: '0' },
    { uid: UID, page: '501' },
    { uid: UID, page: '1.5' },
    { uid: UID, pageSize: '100' },
  ])
    assert.equal(linkSearchSchema.safeParse(input).success, false, JSON.stringify(input));
});

test('config: links.urlPattern defaults to empty and is validated', () => {
  assert.equal(config.default.links.urlPattern, '');
  config.validator({ ...config.default, links: { urlPattern: '/{locale}/{collection}/{slug}' } });
  assert.throws(
    () => config.validator({ ...config.default, links: { urlPattern: 'javascript:alert(1)' } }),
    /links\.urlPattern/
  );
  assert.throws(
    () => config.validator({ ...config.default, links: { urlPattern: '/{nope}' } }),
    /links\.urlPattern/
  );
});

test('picker helpers: arrow keys wrap, references survive only with their href', () => {
  assert.equal(moveActiveIndex(-1, 1, 3), 0);
  assert.equal(moveActiveIndex(-1, -1, 3), 2);
  assert.equal(moveActiveIndex(2, 1, 3), 0);
  assert.equal(moveActiveIndex(0, -1, 3), 2);
  assert.equal(moveActiveIndex(0, 1, 0), -1);
  const attrs = { href: '/a', 'data-mex-uid': UID, 'data-mex-document-id': 'abc', 'data-mex-locale': 'en' };
  const node = { getAttribute: (name) => attrs[name] ?? null };
  const internal = readInternalLink(node);
  assert.deepEqual(internal, { href: '/a', uid: UID, documentId: 'abc', locale: 'en' });
  assert.equal(readInternalLink({ getAttribute: (name) => (name === 'href' ? '/a' : null) }), null);
  assert.deepEqual(internalLinkAttributes(internal, '/a'), {
    'data-mex-uid': UID,
    'data-mex-document-id': 'abc',
    'data-mex-locale': 'en',
  });
  assert.deepEqual(internalLinkAttributes(internal, 'https://elsewhere.example.test/'), {
    'data-mex-uid': null,
    'data-mex-document-id': null,
    'data-mex-locale': null,
    'data-mex-mention': null,
  });
  assert.equal(internalLinkAttributes(null, '/a')['data-mex-uid'], null);
});

/**
 * Fake Strapi with the Content Manager permission checker surface the links
 * service uses.
 */
const fakeStrapi = ({
  canRead = true,
  unreadableFields = [],
  permissionFilters = { createdBy: { id: { $eq: 7 } } },
  rows = [],
  publishedIds = [],
  pattern = '',
  mainField = 'title',
} = {}) => {
  const calls = [];
  const contentTypes = {
    [UID]: {
      uid: UID,
      kind: 'collectionType',
      info: { displayName: 'Article', pluralName: 'articles', singularName: 'article' },
      options: { draftAndPublish: true },
      pluginOptions: { i18n: { localized: true } },
      attributes: {
        title: { type: 'string' },
        slug: { type: 'uid' },
        body: { type: 'json' },
      },
    },
    'api::secret.secret': {
      uid: 'api::secret.secret',
      kind: 'collectionType',
      info: { displayName: 'Secret', pluralName: 'secrets', singularName: 'secret' },
      attributes: { name: { type: 'string' } },
    },
  };
  const checker = (model) => ({
    cannot: {
      read: (_entity, field) =>
        !canRead || model !== UID || Boolean(field && unreadableFields.includes(field)),
    },
    sanitizedQuery: { read: async (query) => ({ ...query, filters: permissionFilters }) },
    sanitizeOutput: async (row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !unreadableFields.includes(key))),
  });
  const strapi = {
    contentTypes,
    contentType: (uid) => contentTypes[uid],
    config: {
      get: (key) => (key === 'plugin::magic-editor-x.links.urlPattern' ? pattern : undefined),
    },
    plugin: (name) => ({
      service: (serviceName) => {
        if (name === 'content-manager' && serviceName === 'permission-checker')
          return { create: ({ model }) => checker(model) };
        if (name === 'content-manager' && serviceName === 'content-types')
          return { findConfiguration: async () => ({ settings: { mainField } }) };
        if (name === 'i18n') return { getDefaultLocale: async () => 'en' };
        if (name === 'magic-editor-x' && serviceName === 'access') return accessService({ strapi });
        throw new Error(`unexpected service ${name}.${serviceName}`);
      },
    }),
    documents: () => ({
      findMany: async (params) => {
        calls.push({ findMany: params });
        if (params.status === 'published') return publishedIds.map((documentId) => ({ documentId }));
        return rows;
      },
      count: async (params) => {
        calls.push({ count: params });
        return rows.length;
      },
    }),
  };
  return { strapi, calls };
};

const ability = {};

test('links service lists readable types with their i18n flag', () => {
  const { strapi } = fakeStrapi();
  assert.deepEqual(linksService({ strapi }).types(ability), [
    { uid: UID, kind: 'collectionType', displayName: 'Article', localized: true },
  ]);
  assert.deepEqual(linksService({ strapi }).types(null), []);
});

test('links service searches the title inside the permission query and renders hrefs', async () => {
  const { strapi, calls } = fakeStrapi({
    rows: [
      { documentId: 'abc', title: 'Hello', slug: 'hello', body: { secret: true } },
      { documentId: 'def', title: 'Help', slug: null },
    ],
    publishedIds: ['abc'],
    pattern: '/{locale}/{collection}/{slug}',
  });
  const result = await linksService({ strapi }).search({ userAbility: ability, uid: UID, q: 'hel', page: 2 });
  assert.deepEqual(result.data, [
    {
      documentId: 'abc',
      uid: UID,
      locale: 'en',
      title: 'Hello',
      href: '/en/articles/hello',
      status: 'published',
    },
    { documentId: 'def', uid: UID, locale: 'en', title: 'Help', href: '/en/articles/def', status: 'draft' },
  ]);
  assert.deepEqual(result.meta.pagination, { page: 2, pageSize: 20, pageCount: 1, total: 2 });
  const find = calls[0].findMany;
  assert.deepEqual(find.filters, {
    $and: [{ createdBy: { id: { $eq: 7 } } }, { title: { $containsi: 'hel' } }],
  });
  assert.equal(find.locale, 'en');
  assert.equal(find.status, 'draft');
  assert.deepEqual(find.fields, ['documentId', 'locale', 'title', 'slug']);
  assert.equal(find.start, 20);
  assert.equal(find.limit, 20);
  assert.deepEqual(calls[1].count.filters, find.filters, 'count uses the same filters');
});

test('links service never searches or returns a title the caller cannot read', async () => {
  const { strapi, calls } = fakeStrapi({
    unreadableFields: ['title'],
    rows: [{ documentId: 'abc', title: 'Hidden' }],
  });
  const result = await linksService({ strapi }).search({
    userAbility: ability,
    uid: UID,
    q: 'abc',
    locale: 'de',
  });
  assert.equal(result.data[0].title, '');
  assert.equal(result.data[0].locale, 'de');
  assert.equal(result.data[0].href, '/articles/abc');
  assert.deepEqual(calls[0].findMany.filters.$and[1], { documentId: 'abc' });
  assert.deepEqual(calls[0].findMany.fields, ['documentId', 'locale', 'slug']);
});

test('links service uses the first text attribute when mainField is not text', async () => {
  const { strapi, calls } = fakeStrapi({ mainField: 'id', rows: [] });
  await linksService({ strapi }).search({ userAbility: ability, uid: UID, q: 'x' });
  assert.deepEqual(calls[0].findMany.filters.$and[1], { title: { $containsi: 'x' } });
});

test('links service answers 404 for unknown, unreadable and non-API types', async () => {
  const { strapi } = fakeStrapi();
  const service = linksService({ strapi });
  for (const input of [
    { userAbility: ability, uid: 'api::missing.missing' },
    { userAbility: ability, uid: 'api::secret.secret' },
    { userAbility: null, uid: UID },
  ])
    await assert.rejects(service.search(input), { name: 'NotFoundError' }, JSON.stringify(input));
  const denied = fakeStrapi({ canRead: false });
  await assert.rejects(linksService({ strapi: denied.strapi }).search({ userAbility: ability, uid: UID }), {
    name: 'NotFoundError',
  });
});

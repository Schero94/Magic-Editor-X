import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderHtml } from '../shared/render/index.mjs';

const require = createRequire(import.meta.url);
const createLinks = require('../server/src/services/links.js');

/**
 * Internal links store the entry reference; the href follows slug changes at
 * render time (renderer `links` option) or through `links.resolveHrefs`.
 */

const link = (id, href, locale = 'en') =>
  `<a href="${href}" data-mex-uid="api::article.article" data-mex-document-id="${id}" data-mex-locale="${locale}">${id}</a>`;
const value = {
  time: 1,
  version: '2.31.7',
  blocks: [
    {
      id: 'p1',
      type: 'paragraph',
      data: { text: `See ${link('abc', '/articles/old-slug')} and ${link('gone', '/articles/gone')}` },
    },
    {
      id: 'l1',
      type: 'list',
      data: { style: 'unordered', items: [{ content: link('abc', '/x'), items: [] }] },
    },
    { id: 'p2', type: 'paragraph', data: { text: '<a href="https://example.test">external</a>' } },
  ],
};

test('resolveHrefs re-renders internal hrefs from the current slug and keeps the rest', async () => {
  const queries = [];
  const strapi = {
    config: {
      get: (key) =>
        key === 'plugin::magic-editor-x.links.urlPattern' ? '/{locale}/{collection}/{slug}' : undefined,
    },
    contentType: (uid) =>
      uid === 'api::article.article'
        ? {
            uid,
            info: { pluralName: 'articles', singularName: 'article' },
            options: { draftAndPublish: true },
            pluginOptions: { i18n: { localized: true } },
            attributes: { title: { type: 'string' }, slug: { type: 'uid' } },
          }
        : undefined,
    documents: () => ({
      findMany: async (params) => {
        queries.push(params);
        return [{ documentId: 'abc', slug: 'new-slug' }];
      },
    }),
    plugin: () => ({ service: () => ({}) }),
  };
  const out = await createLinks({ strapi }).resolveHrefs(value);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].filters, { documentId: { $in: ['abc', 'gone'] } });
  assert.equal(queries[0].status, 'published');
  assert.equal(queries[0].locale, 'en');
  assert.match(out.blocks[0].data.text, /href="\/en\/articles\/new-slug"/);
  assert.match(out.blocks[0].data.text, /href="\/articles\/gone"/);
  assert.match(out.blocks[1].data.items[0].content, /new-slug/);
  assert.equal(out.blocks[2].data.text, value.blocks[2].data.text);
  // The input is not changed.
  assert.match(value.blocks[0].data.text, /old-slug/);
  assert.equal(await createLinks({ strapi }).resolveHrefs(null), null);
});

test('renderers resolve internal links by documentId at render time', () => {
  const html = renderHtml(value, {
    links: ({ documentId }) => (documentId === 'abc' ? '/blog/new-slug' : undefined),
  });
  assert.match(html, /href="\/blog\/new-slug"/);
  assert.match(html, /href="\/articles\/gone"/);
});

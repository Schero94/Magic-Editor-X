/**
 * GraphQL `<field>Rendered` / `<field>Resolved` inside components and dynamic
 * zones resolve with the locale and publication status of the entry that
 * holds them (2.7 API re-audit), also through nested components and populated
 * relations. The GraphQL plugin is faked: the extension, its nexus plugin hook
 * and the references service.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerGraphql } = require('../server/src/graphql.js');

const RICH = { type: 'customField', customField: 'plugin::magic-editor-x.richtext' };
const ARTICLE = 'api::article.article';
const AUTHOR = 'api::author.author';

const setup = () => {
  const calls = [];
  let configure;
  const strapi = {
    contentTypes: {
      [ARTICLE]: {
        uid: ARTICLE,
        attributes: {
          body: RICH,
          sections: { type: 'component', component: 'blocks.section', repeatable: true },
          zone: { type: 'dynamiczone', components: ['blocks.section'] },
          author: { type: 'relation', relation: 'manyToOne', target: AUTHOR },
        },
      },
      [AUTHOR]: {
        uid: AUTHOR,
        attributes: { bio: { type: 'component', component: 'blocks.section' } },
      },
    },
    components: {
      'blocks.section': {
        uid: 'blocks.section',
        globalId: 'ComponentBlocksSection',
        attributes: {
          body: RICH,
          inner: { type: 'component', component: 'blocks.inner' },
        },
      },
      'blocks.inner': { uid: 'blocks.inner', globalId: 'ComponentBlocksInner', attributes: { body: RICH } },
    },
    log: { error: () => {}, warn: () => {}, info: () => {} },
    plugin: (name) => {
      if (name === 'graphql')
        return {
          service: (service) =>
            service === 'utils'
              ? {
                  naming: {
                    getTypeName: (ct) => (ct.uid === ARTICLE ? 'Article' : 'Author'),
                    getComponentName: (c) => c.globalId,
                  },
                }
              : {
                  use: (fn) => {
                    configure = fn;
                  },
                  shadowCRUD: () => ({ field: () => ({ hasOutputEnabled: () => true }) }),
                },
        };
      return {
        service: () => ({
          transform: async (items, options) => {
            calls.push(...items.map((item) => ({ locale: item.locale, status: options.status })));
            return items.map(() => 'out');
          },
        }),
      };
    },
  };
  assert.equal(registerGraphql(strapi), true);
  const generated = configure({
    strapi,
    typeRegistry: { has: () => true },
    nexus: { plugin: (config) => config },
  });
  const plugins = generated.plugins || [];
  /** Runs Strapi's field resolver through the plugins' middlewares, like nexus does. */
  const field = (typeName, fieldName, base) => {
    const middlewares = plugins
      .map((plugin) =>
        plugin.onCreateFieldResolver({
          parentTypeConfig: { name: typeName },
          fieldConfig: { name: fieldName },
        })
      )
      .filter(Boolean);
    return (root, args, ctx, info) =>
      middlewares.reduceRight((next, middleware) => (r, a, c, i) => middleware(r, a, c, i, next), base)(
        root,
        args,
        ctx,
        info
      );
  };
  const rendered = (typeName, parent, ctx) =>
    generated.resolvers[typeName].bodyRendered.resolve(parent, { format: 'HTML' }, ctx);
  return { calls, field, rendered, generated };
};

const value = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] };

test('components and dynamic zones use the locale and status of their entry', async () => {
  const { calls, field, rendered } = setup();
  const ctx = { state: { auth: {} } };
  const article = { documentId: 'art1', locale: 'de', publishedAt: null, body: value };
  const sections = await field('Article', 'sections', async () => [{ body: value, inner: { body: value } }])(
    article,
    {},
    ctx,
    {}
  );
  const zone = await field('Article', 'zone', async () => [
    { __typename: 'ComponentBlocksSection', body: value },
  ])(article, {}, ctx, {});
  const inner = await field('ComponentBlocksSection', 'inner', async () => ({ body: value }))(
    sections[0],
    {},
    ctx,
    {}
  );
  await Promise.all([
    rendered('Article', article, ctx),
    rendered('ComponentBlocksSection', sections[0], ctx),
    rendered('ComponentBlocksSection', zone[0], ctx),
    rendered('ComponentBlocksInner', inner, ctx),
  ]);
  assert.deepEqual(calls, [
    { locale: 'de', status: 'draft' },
    { locale: 'de', status: 'draft' },
    { locale: 'de', status: 'draft' },
    { locale: 'de', status: 'draft' },
  ]);
});

test('a populated relation starts its own scope; other requests are not affected', async () => {
  const { calls, field, rendered } = setup();
  const ctx = { state: { auth: {} } };
  const article = { documentId: 'art1', locale: 'de', publishedAt: null };
  const author = await field('Article', 'author', async () => ({
    documentId: 'au1',
    locale: 'fr',
    publishedAt: '2026-11-20T00:00:00.000Z',
  }))(article, {}, ctx, {});
  const bio = await field('Author', 'bio', async () => ({ body: value }))(author, {}, ctx, {});
  await rendered('ComponentBlocksSection', bio, ctx);
  // The same component object seen by another request (another context) is not tagged there.
  const other = { state: { auth: {} } };
  await rendered('ComponentBlocksSection', bio, other);
  assert.deepEqual(calls, [
    { locale: 'fr', status: 'published' },
    { locale: null, status: 'published' },
  ]);
});

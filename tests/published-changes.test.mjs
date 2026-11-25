/**
 * 2.12 "Changes since last publish": block classification against the published version
 * (shared/published-changes.mjs), the scoped mark style sheet, the 2,000-block budget, the
 * published-version service (Document Service, status published, CM read permission query) and
 * the GET /published-version handler and route (RBAC 403, Content Manager 404).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  classifyPublishedChanges,
  hasPublishedChanges,
  publishedChangesCss,
} from '../shared/published-changes.mjs';
import { STRICT_TIMING } from './helpers/perf-strict.mjs';

const require = createRequire(import.meta.url);
const { errors } = require('@strapi/utils');
const publishedService = require('../server/src/services/published.js');
const accessService = require('../server/src/services/access.js');
const historyController = require('../server/src/controllers/history.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS } = require('../server/src/permissions.js');
// The installed admin policy, by file path (not in the package's `exports`).
const hasPermissions = require(
  path.join(
    path.dirname(require.resolve('@strapi/admin/package.json')),
    'dist/server/server/src/policies/hasPermissions.js'
  )
);

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });

test('classify: added, changed (word level), removed and unchanged blocks', () => {
  const published = doc([p('a', 'Alpha one'), p('b', 'Bravo two'), p('c', 'Charlie three'), p('d', 'Delta')]);
  const current = doc([
    p('a', 'Alpha one'),
    p('b', 'Bravo <b>2</b> two'),
    p('n', 'New block'),
    p('d', 'Delta'),
  ]);
  const changes = classifyPublishedChanges(published, current);
  assert.equal(changes.marks.get('a'), undefined, 'unchanged block has no mark');
  assert.equal(changes.marks.get('b').kind, 'changed');
  const field = changes.marks.get('b').entry.fields[0];
  assert.equal(field.kind, 'text');
  assert.deepEqual(
    field.ops.filter((op) => op.op !== 'equal').map((op) => `${op.op}:${op.text.trim()}`),
    ['insert:2']
  );
  assert.equal(changes.marks.get('n').kind, 'added');
  assert.deepEqual(changes.counts, { added: 1, changed: 1, removed: 1 });
  assert.equal(changes.removed.length, 1);
  assert.equal(changes.removed[0].before, 'n', 'removed "c" sits before the block that took its place');
  assert.equal(changes.removed[0].entries[0].before.data.text, 'Charlie three');
  assert.equal(hasPublishedChanges(changes), true);
});

test('classify: removed groups at the start and the end, moved blocks count as changed', () => {
  const published = doc([p('x', 'Gone first'), p('a', 'A'), p('b', 'B'), p('c', 'C'), p('z', 'Gone last')]);
  const current = doc([p('b', 'B'), p('a', 'A'), p('c', 'C')]);
  const changes = classifyPublishedChanges(published, current);
  assert.deepEqual(
    changes.removed.map((group) => [group.before, group.entries.map((entry) => entry.id)]),
    [
      ['b', ['x']],
      [null, ['z']],
    ]
  );
  const moved = [...changes.marks.values()].filter((mark) => mark.moved);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].kind, 'changed');
  assert.equal(moved[0].entry.fields, undefined, 'moved only: no field changes');
  assert.deepEqual(changes.counts, { added: 0, changed: 1, removed: 2 });
});

test('classify: the version history block-id matching pairs re-created blocks by similarity', () => {
  const published = doc([p('old', 'The quick brown fox jumps over the lazy dog')]);
  const current = doc([p('new', 'The quick brown fox jumps over the lazy cat')]);
  const changes = classifyPublishedChanges(published, current);
  assert.equal(changes.marks.get('new').kind, 'changed');
  assert.deepEqual(changes.counts, { added: 0, changed: 1, removed: 0 });
});

test('classify: an empty published field marks every block as added; identical content marks nothing', () => {
  const current = doc([p('a', 'One'), p('b', 'Two')]);
  assert.deepEqual(classifyPublishedChanges(null, current).counts, { added: 2, changed: 0, removed: 0 });
  const same = classifyPublishedChanges(current, JSON.parse(JSON.stringify(current)));
  assert.equal(same.marks.size, 0);
  assert.equal(hasPublishedChanges(same), false);
  // Default tune values are "no tune": not a change.
  const tuned = doc([{ ...p('a', 'One'), tunes: { alignmentTune: { alignment: 'left' } } }, p('b', 'Two')]);
  assert.equal(hasPublishedChanges(classifyPublishedChanges(current, tuned)), false);
});

test('mark style sheet: scoped selectors, inline-start bars (also right to left), unsafe ids skipped', () => {
  const published = doc([p('a', 'A'), p('gone', 'Gone'), p('b', 'B')]);
  const current = doc([
    p('a', 'A changed'),
    p('b', 'B'),
    p('x"]{}*{color:red', 'Injected id'),
    p('ok_1', 'New'),
  ]);
  const changes = classifyPublishedChanges(published, current);
  const style = { scope: 'mexbody', added: 'GREEN', changed: 'ORANGE', gap: '4rem', width: '3px' };
  const css = publishedChangesCss(changes, style);
  assert.match(css, /\[data-mex-changes="mexbody"\] \.ce-block\[data-id="a"\] \.ce-block__content/);
  assert.match(css, /\[data-id="ok_1"\][^{]*\{ box-shadow: inset 3px 0 0 0 GREEN; \}/);
  assert.match(
    css,
    /\[dir="rtl"\] \.ce-block\[data-id="ok_1"\][^{]*\{ box-shadow: inset -3px 0 0 0 GREEN; \}/
  );
  assert.match(css, /\[data-id="a"\][^{]*\{ box-shadow: inset 3px 0 0 0 ORANGE; \}/);
  assert.match(
    css,
    /\.ce-block\[data-id="b"\] \{ margin-block-start: 4rem; \}/,
    'room above the block after "gone"'
  );
  assert.ok(!css.includes('color:red'), 'a stored id cannot inject CSS');
  assert.equal(publishedChangesCss(changes, { ...style, scope: 'bad"scope' }), '');
  assert.equal(publishedChangesCss(null, style), '');
});

// The time budget runs only with MEX_PERF_STRICT=1 (CI job `bench`); the browser benchmark
// (npm run bench:browser) measures the marks in the editor with every run.
test('2,000 blocks: one edit, one addition and one removal are classified exactly', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/editor-2x-all-blocks.json', import.meta.url), 'utf8')
  );
  const blocks = [];
  for (let index = 0; blocks.length < 2000; index += 1) {
    const source = fixture.blocks[index % fixture.blocks.length];
    blocks.push({ ...JSON.parse(JSON.stringify(source)), id: `b${index}` });
  }
  const published = doc(blocks);
  const current = doc(JSON.parse(JSON.stringify(blocks)));
  current.blocks[10] = p('b10', 'Edited paragraph text');
  current.blocks.splice(700, 1);
  current.blocks.splice(1500, 0, p('fresh', 'Added while typing'));
  const result = classifyPublishedChanges(published, current);
  assert.deepEqual(result.counts, { added: 1, changed: 1, removed: 1 });
  assert.equal(result.marks.get('b10').kind, 'changed');
  assert.equal(result.marks.get('fresh').kind, 'added');
  assert.equal(result.removed.length, 1);
});

test(
  'budget (MEX_PERF_STRICT=1): classifying 2,000 blocks stays under 50 ms per update',
  { skip: !STRICT_TIMING },
  () => {
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/editor-2x-all-blocks.json', import.meta.url), 'utf8')
    );
    const blocks = [];
    for (let index = 0; blocks.length < 2000; index += 1) {
      const source = fixture.blocks[index % fixture.blocks.length];
      blocks.push({ ...JSON.parse(JSON.stringify(source)), id: `b${index}` });
    }
    const published = doc(blocks);
    const current = doc(JSON.parse(JSON.stringify(blocks)));
    // Typical editing: a few blocks changed, one added, one removed.
    current.blocks[10] = p('b10', 'Edited paragraph text');
    current.blocks.splice(700, 1);
    current.blocks.splice(1500, 0, p('fresh', 'Added while typing'));
    classifyPublishedChanges(published, current); // warm-up
    const times = [];
    for (let run = 0; run < 7; run += 1) {
      const start = performance.now();
      classifyPublishedChanges(published, current);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    assert.ok(median < 50, `median ${median.toFixed(1)} ms`);
  }
);

// --- Server: service, handler, route -------------------------------------------------------

const EDITOR = { type: 'json', customField: 'plugin::magic-editor-x.richtext' };
const article = {
  uid: 'api::article.article',
  options: { draftAndPublish: true },
  attributes: {
    body: EDITOR,
    sections: { type: 'component', component: 'shared.section', repeatable: true },
  },
};
const plain = { uid: 'api::page.page', options: { draftAndPublish: false }, attributes: { body: EDITOR } };
const components = { 'shared.section': { uid: 'shared.section', attributes: { text: EDITOR } } };
const KEY = 'k1234567890abcdef';

/**
 * Fake Strapi with one article (draft and published) and a CM permission checker.
 * @param {{ published?: object|null, canRead?: boolean, filters?: object }} [options] - Fixture.
 * @returns {{ strapi: object, reads: object[] }} Strapi and Document Service calls.
 */
const fakeStrapi = ({ published = null, canRead = true, filters = null } = {}) => {
  const reads = [];
  const strapi = {
    components,
    contentType: (uid) => ({ [article.uid]: article, [plain.uid]: plain })[uid],
    config: { get: () => undefined },
    plugin: (name) => ({
      service: (service) => {
        if (name === 'content-manager' && service === 'permission-checker')
          return {
            create: () => ({
              cannot: { read: () => !canRead, update: () => true },
              sanitizedQuery: {
                read: async () => (filters ? { filters } : {}),
                update: async () => ({}),
              },
            }),
          };
        if (name === 'i18n') return { getDefaultLocale: async () => 'en' };
        return undefined;
      },
    }),
    documents: () => ({
      findFirst: async (params) => {
        reads.push(params);
        if (params.status === 'published') return published;
        return { documentId: 'doc1', body: doc([p('a', 'Draft')]) };
      },
      findOne: async () => ({ documentId: 'doc1', sections: [] }),
    }),
  };
  return { strapi, reads };
};

test('service: reads the published version with status published through the CM permission query', async () => {
  const { strapi, reads } = fakeStrapi({
    published: { documentId: 'doc1', publishedAt: '2026-11-20T10:00:00.000Z', body: doc([p('a', 'Live')]) },
    filters: { createdBy: { id: 7 } },
  });
  const service = publishedService({ strapi });
  const result = await service.read({
    userAbility: {},
    uid: article.uid,
    documentId: 'doc1',
    locale: null,
    field: 'body',
    fieldKey: null,
    positional: false,
    basePath: 'body',
  });
  assert.equal(result.published, true);
  assert.equal(result.publishedAt, '2026-11-20T10:00:00.000Z');
  assert.equal(result.content.blocks[0].data.text, 'Live');
  assert.equal(reads[0].status, 'published');
  assert.deepEqual(reads[0].filters, { $and: [{ documentId: 'doc1' }, { createdBy: { id: 7 } }] });
  assert.deepEqual(reads[0].fields, ['documentId', 'publishedAt', 'body']);
  // content: false asks for existence only (no field, no populate).
  await service.read(
    { userAbility: {}, uid: article.uid, documentId: 'doc1', field: 'body', basePath: 'body' },
    { content: false }
  );
  assert.deepEqual(reads[1].fields, ['documentId', 'publishedAt']);
  assert.equal(reads[1].populate, undefined);
});

test('service: never published answers published false; positional fields match by field key', async () => {
  const none = publishedService({ strapi: fakeStrapi({ published: null }).strapi });
  assert.deepEqual(
    await none.read({
      userAbility: {},
      uid: article.uid,
      documentId: 'doc1',
      field: 'body',
      basePath: 'body',
    }),
    { published: false, publishedAt: null, content: null }
  );
  const { strapi, reads } = fakeStrapi({
    published: {
      documentId: 'doc1',
      publishedAt: '2026-11-20T10:00:00.000Z',
      sections: [
        { id: 1, text: { ...doc([p('o', 'Other entry')]), fieldKey: 'kother0000000000' } },
        { id: 2, text: { ...doc([p('m', 'Mine')]), fieldKey: KEY } },
      ],
    },
  });
  const result = await publishedService({ strapi }).read({
    userAbility: {},
    uid: article.uid,
    documentId: 'doc1',
    field: 'sections.0.text',
    fieldKey: KEY,
    positional: true,
    basePath: 'sections.text',
  });
  assert.equal(
    result.content.blocks[0].data.text,
    'Mine',
    'the entry with the key, not the one at the index'
  );
  assert.deepEqual(reads[0].populate, { sections: { fields: ['text'] } });
});

const ctxFor = (query, ability = {}) => ({
  query,
  state: { userAbility: ability, user: { id: 7 } },
  body: null,
});

test('GET /published-version: content, never published, types without Draft & Publish', async () => {
  const { strapi } = fakeStrapi({
    published: { documentId: 'doc1', publishedAt: '2026-11-20T10:00:00.000Z', body: doc([p('a', 'Live')]) },
  });
  const services = {};
  strapi.plugin = ((original) => (name) =>
    name === 'magic-editor-x' ? { service: (service) => services[service] } : original(name))(strapi.plugin);
  services.access = accessService({ strapi });
  services.published = publishedService({ strapi });
  const controller = historyController({ strapi });
  const ctx = ctxFor({ uid: article.uid, documentId: 'doc1', field: 'body' });
  await controller.published(ctx);
  assert.equal(ctx.body.data.draftAndPublish, true);
  assert.equal(ctx.body.data.published, true);
  assert.equal(ctx.body.data.content.blocks[0].data.text, 'Live');
  const statusOnly = ctxFor({ uid: article.uid, documentId: 'doc1', field: 'body', content: 'false' });
  await controller.published(statusOnly);
  assert.equal(statusOnly.body.data.content, null);
  const noDp = ctxFor({ uid: plain.uid, documentId: 'doc1', field: 'body' });
  await controller.published(noDp);
  assert.deepEqual(noDp.body.data, {
    draftAndPublish: false,
    published: false,
    publishedAt: null,
    content: null,
  });
  await assert.rejects(
    controller.published(ctxFor({ uid: article.uid, documentId: 'doc1', field: 'body', content: 'yes' })),
    (error) => error.name === 'ValidationError'
  );
  await assert.rejects(
    controller.published(ctxFor({ uid: article.uid, documentId: 'doc1', field: 'body', extra: '1' })),
    (error) => error.name === 'ValidationError',
    'unknown query keys are rejected'
  );
});

test('GET /published-version: 404 without Content Manager read access (same as history)', async () => {
  const { strapi, reads } = fakeStrapi({ canRead: false, published: { documentId: 'doc1', body: null } });
  const services = {};
  strapi.plugin = ((original) => (name) =>
    name === 'magic-editor-x' ? { service: (service) => services[service] } : original(name))(strapi.plugin);
  services.access = accessService({ strapi });
  services.published = publishedService({ strapi });
  await assert.rejects(
    historyController({ strapi }).published(ctxFor({ uid: article.uid, documentId: 'doc1', field: 'body' })),
    (error) => error instanceof errors.NotFoundError
  );
  assert.equal(reads.filter((read) => read.status === 'published').length, 0, 'nothing published is read');
  // Unknown field or type: 404 as well.
  const open = fakeStrapi({ published: null });
  const own = {};
  open.strapi.plugin = ((original) => (name) =>
    name === 'magic-editor-x' ? { service: (service) => own[service] } : original(name))(open.strapi.plugin);
  own.access = accessService({ strapi: open.strapi });
  own.published = publishedService({ strapi: open.strapi });
  await assert.rejects(
    historyController({ strapi: open.strapi }).published(
      ctxFor({ uid: article.uid, documentId: 'doc1', field: 'title' })
    ),
    (error) => error instanceof errors.NotFoundError
  );
});

test('route: GET /published-version needs an authenticated admin with the access action (else 403)', () => {
  const route = routes.admin.routes.find((item) => item.path === '/published-version');
  assert.equal(route.method, 'GET');
  assert.equal(route.handler, 'history.published');
  assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
  const policy = route.config.policies.find((item) => item && item.name === 'admin::hasPermissions');
  assert.deepEqual(policy.config.actions, [ACTIONS.access]);
  // The installed admin policy denies a role without the action (Strapi answers 403 PolicyError).
  const ctx = (allowed) => ({ state: { userAbility: { can: (action) => allowed.includes(action) } } });
  assert.equal(hasPermissions.handler(ctx([]), policy.config), false);
  assert.equal(hasPermissions.handler(ctx([ACTIONS.access]), policy.config), true);
  // Registered before nothing that could shadow it: no other route uses the path.
  assert.equal(routes.admin.routes.filter((item) => item.path === '/published-version').length, 1);
});

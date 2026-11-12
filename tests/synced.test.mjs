/**
 * Synced blocks (2.3): the stored reference (policy, schema, presets, Yjs
 * guard), the source rules (no nesting, kind lock, usage scan), the
 * toggle-safe expansion, the preset interaction (sources are filtered by the
 * containing field), the renderer option `synced`, the Content API
 * expansion with the caller's permissions, the version diff and the settings
 * form logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import {
  SYNCED_LIMITS,
  containsSynced,
  expandSynced,
  isSyncedBlock,
  replaceBlocks,
  sourceBlocksOf,
  syncedDiffRefs,
  syncedLookup,
  syncedRefOf,
  syncedRefsOf,
  toBlockTree,
} from '../shared/synced.mjs';
import { BLOCK_POLICIES, isBuiltInBlock } from '../shared/sanitize-policy.mjs';
import { checkPreset, resolveFieldPreset } from '../shared/presets.mjs';
import { filterSyncedForField, TEMPLATE_KINDS } from '../shared/templates.mjs';
import { computeStats } from '../shared/editor-data.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { renderHtml, renderText, renderMarkdown } from '../shared/render/index.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { applyEditorDataToDoc, createSeedUpdate } from '../shared/ydoc.mjs';
import {
  filterByKind,
  fromDto,
  moveWithin,
  validateTemplate,
} from '../admin/src/pages/TemplatesPage/templateForm.mjs';

const require = createRequire(import.meta.url);
const templatesService = require('../server/src/services/templates.js');
const createReferences = require('../server/src/services/references.js');
const routes = require('../server/src/routes/index.js');
const contentTypes = require('../server/src/content-types/index.js');
const { ACTIONS } = require('../server/src/permissions.js');

const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const synced = (id, ref) => ({ id, type: 'synced', data: { ref } });
const h = (id, text, level = 2) => ({ id, type: 'header', data: { text, level } });

const SOURCE = doc(h('s1', 'Shared heading', 1), p('s2', 'Shared <b>text</b>'), {
  id: 's3',
  type: 'table',
  data: { withHeadings: false, content: [['a', 'b']] },
});

// --- stored reference -------------------------------------------------------

test('policy: only a valid reference is kept; a pre-2.3 custom block named synced is not a synced block', () => {
  const inline = (html) => html;
  assert.deepEqual(BLOCK_POLICIES.synced({ ref: 'abc123', extra: '<b>x</b>' }, inline), {
    ref: 'abc123',
    _mex: 1,
  });
  assert.deepEqual(BLOCK_POLICIES.synced({ ref: 'ABC 1' }, inline), { ref: '', _mex: 1 });
  assert.deepEqual(BLOCK_POLICIES.synced({ ref: 7 }, inline), { ref: '', _mex: 1 });
  assert.equal(isSyncedBlock(synced('a', 'abc')), true);
  const legacy = { id: 'b', type: 'synced', data: { title: 'Custom block data' } };
  assert.equal(isBuiltInBlock(legacy), false);
  assert.equal(isSyncedBlock(legacy), false);
  assert.equal(syncedRefOf(legacy), null);
  assert.equal(syncedRefOf(synced('a', 'not valid')), null);
  assert.deepEqual(syncedRefsOf(doc(synced('a', 'x1'), p('b', ''), synced('c', 'x1'), synced('d', 'x2'))), [
    'x1',
    'x2',
  ]);
});

test('presets: full and article allow synced blocks, basic and minimal do not, allowedBlocks may list it', () => {
  assert.equal(resolveFieldPreset({}).blocks, null);
  assert.ok(resolveFieldPreset({ preset: 'article' }).blocks.includes('synced'));
  assert.ok(!resolveFieldPreset({ preset: 'basic' }).blocks.includes('synced'));
  assert.ok(!resolveFieldPreset({ preset: 'minimal' }).blocks.includes('synced'));
  assert.ok(resolveFieldPreset({ allowedBlocks: 'paragraph,synced' }).blocks.includes('synced'));
  const violations = checkPreset(doc(synced('a', 'x1')), resolveFieldPreset({ preset: 'basic' }));
  assert.equal(violations[0].code, 'BLOCK_NOT_ALLOWED');
  assert.equal(violations[0].blockId, 'a');
  assert.deepEqual(checkPreset(doc(synced('a', 'x1')), resolveFieldPreset({ preset: 'article' })), []);
});

test('a reference has no text of its own (statistics, character limits)', () => {
  assert.deepEqual(computeStats(doc(synced('a', 'abcdef'))), { blocks: 1, words: 0, characters: 0 });
});

test('Yjs guard: a synced block holds only { ref } with a documentId', () => {
  const seed = createSeedUpdate(doc(p('p1', 'hi')), 'e1');
  const room = () => {
    const d = new Y.Doc();
    Y.applyUpdate(d, seed);
    return d;
  };
  const update = (data) => {
    const client = new Y.Doc();
    Y.applyUpdate(client, seed);
    const before = Y.encodeStateVector(client);
    applyEditorDataToDoc(client, data);
    return Y.encodeStateAsUpdate(client, before);
  };
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), synced('s', 'abc123')))).ok, true);
  const marked = { id: 's', type: 'synced', data: { ref: 'abc123', _mex: 1 } };
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), marked))).ok, true);
  const copied = { id: 's', type: 'synced', data: { ref: 'abc123', _mex: 1, blocks: [p('x', 'copied')] } };
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), copied))).ok, false);
  const badMarker = { id: 's', type: 'synced', data: { ref: 'abc123', _mex: 'x' } };
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), badMarker))).ok, true, 'custom data');
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), synced('s', '../x')))).ok, false);
  // A pre-2.3 custom block named synced is not affected, also with a field named `ref`
  // (without the marker, extra keys make it custom block data, never a synced block).
  const legacy = { id: 'c', type: 'synced', data: { title: 'x' } };
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), legacy))).ok, true);
  const legacyRef = {
    id: 'c',
    type: 'synced',
    data: { content: '', ref: 'Any text', blockType: 'simple', blockName: 'synced' },
  };
  assert.equal(applyCheckedUpdate(room(), update(doc(p('p1', 'hi'), legacyRef))).ok, true);
});

// --- expansion --------------------------------------------------------------

test('expansion replaces references with copies (derived ids, origins), drops unknown ones', () => {
  const value = doc(p('a', 'Before'), synced('r1', 'src1'), synced('r2', 'src1'), synced('r3', 'gone'));
  const result = expandSynced(value, (ref) => (ref === 'src1' ? SOURCE : null));
  const ids = result.data.blocks.map((block) => block.id);
  assert.deepEqual(ids, ['a', 'r1-s1', 'r1-s2', 'r1-s3', 'r2-s1', 'r2-s2', 'r2-s3']);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(result.origins.get('r2-s2'), 'src1');
  assert.equal(result.origins.has('a'), false);
  assert.equal(result.expanded, 2);
  assert.equal(result.unresolved, 1);
  assert.equal(containsSynced(result.data.blocks), false);
  // The source document is not mutated by later changes of the copy.
  result.data.blocks[1].data.text = 'changed';
  assert.equal(SOURCE.blocks[0].data.text, 'Shared heading');
});

test('expansion never nests: references inside a source are dropped (no cycles)', () => {
  const loop = doc(p('x', 'Loop text'), synced('inner', 'self'));
  const result = expandSynced(doc(synced('r', 'self')), () => loop);
  assert.deepEqual(
    result.data.blocks.map((block) => block.type),
    ['paragraph']
  );
  assert.deepEqual(sourceBlocksOf(loop).length, 1);
});

test('expansion keeps toggle content counts right', () => {
  const toggle = (id, items) => ({ id, type: 'toggle', data: { text: 'T', status: 'open', items } });
  const value = doc(toggle('t', 2), p('in1', 'inside'), synced('r', 'src'), p('after', 'outside'));
  const expanded = expandSynced(value, () => doc(p('s1', 'one'), p('s2', 'two'), p('s3', 'three'))).data;
  assert.equal(expanded.blocks[0].data.items, 4);
  const tree = toBlockTree(expanded.blocks);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].children.length, 4);
  const removed = expandSynced(value, () => null).data;
  assert.equal(removed.blocks[0].data.items, 1);
  assert.equal(toBlockTree(removed.blocks)[1].block.id, 'after');
  // A toggle replaced by something else leaves its content in place.
  const flat = replaceBlocks(value.blocks, (block) => (block.type === 'toggle' ? [] : null));
  assert.deepEqual(
    flat.map((block) => block.id),
    ['in1', 'r', 'after']
  );
});

test('expansion respects the field limits', () => {
  const big = doc(...Array.from({ length: 30 }, (_, index) => p(`s${index}`, `x${index}`)));
  const result = expandSynced(doc(synced('r1', 'a'), synced('r2', 'a')), () => big, { maxBlocks: 40 });
  assert.equal(result.data.blocks.length, 30);
  assert.equal(result.unresolved, 1);
});

// --- preset interaction ------------------------------------------------------

test('preset interaction: the containing field filters the source (types, heading levels, links, alt text)', () => {
  const source = [
    h('h1', 'Title', 1),
    p(
      'p',
      'See <a href="https://example.test">external</a> and <a href="/x" data-mex-uid="api::article.article" data-mex-document-id="abc">internal</a>'
    ),
    { id: 't', type: 'table', data: { withHeadings: false, content: [['a']] } },
    { id: 'i', type: 'image', data: { file: { url: 'https://cdn.example.test/a.png' }, caption: '' } },
    { id: 'tg', type: 'toggle', data: { text: 'Toggle', status: 'open', items: 1 } },
    p('inside', 'Inside the toggle'),
  ];
  const basic = resolveFieldPreset({ preset: 'basic', requireAlt: true, linkTargets: 'internal' });
  const { blocks, omitted } = filterSyncedForField(source, basic);
  assert.deepEqual(
    blocks.map((block) => block.id),
    ['h1', 'p', 'inside']
  );
  assert.equal(omitted, 3);
  assert.equal(blocks[0].data.level, 2);
  assert.doesNotMatch(blocks[1].data.text, /example\.test/);
  assert.match(blocks[1].data.text, /data-mex-uid/);
  // An unrestricted field keeps everything.
  assert.equal(filterSyncedForField(source, resolveFieldPreset({})).blocks.length, source.length);
});

// --- renderers ----------------------------------------------------------------

test('renderers: options.synced (object, Map, function) expands references; without it they render nothing', () => {
  const value = doc(p('a', 'Intro'), synced('r', 'src1'));
  assert.equal(renderHtml(value), '<p class="mex-paragraph">Intro</p>');
  assert.equal(renderText(value), 'Intro');
  const sources = { src1: SOURCE };
  const html = renderHtml(value, { synced: sources });
  assert.match(html, /<h1 class="mex-header">Shared heading<\/h1>/);
  assert.match(html, /Shared <b>text<\/b>/);
  assert.equal(renderHtml(value, { synced: new Map([['src1', SOURCE.blocks]]) }), html);
  assert.equal(renderHtml(value, { synced: (ref) => (ref === 'src1' ? SOURCE : null) }), html);
  assert.match(renderMarkdown(value, { synced: sources }), /# Shared heading/);
  // A source cannot inject a nested reference or unsafe markup.
  const evil = doc(p('e', '<img src=x onerror=alert(1)>ok'), synced('n', 'src1'));
  const out = renderHtml(value, { synced: { src1: evil } });
  assert.doesNotMatch(out, /onerror|<img/);
  assert.doesNotMatch(out, /Shared heading/);
  assert.deepEqual(syncedLookup('nope')('x'), null);
});

test('a table of contents in the field lists the headings of synced content', () => {
  const value = doc(
    { id: 'toc', type: 'toc', data: { title: '', minLevel: 1, maxLevel: 3, style: 'unordered' } },
    synced('r', 'src1')
  );
  const html = renderHtml(value, { synced: { src1: SOURCE } });
  assert.match(html, /href="#mex-h-r-s1"/);
  assert.match(html, /<h1 id="mex-h-r-s1" class="mex-header">/);
});

// --- version diff -------------------------------------------------------------

test('diff: a changed reference is a value change; the view names the sources', () => {
  const entries = diffDocuments(doc(synced('r', 'old1')), doc(synced('r', 'new1'), synced('n', 'x9')));
  const changed = entries.find((entry) => entry.id === 'r');
  assert.equal(changed.op, 'changed');
  assert.equal(changed.fields[0].kind, 'value');
  assert.deepEqual(syncedDiffRefs(changed), { before: 'old1', after: 'new1' });
  const added = entries.find((entry) => entry.id === 'n');
  assert.deepEqual(syncedDiffRefs(added), { before: null, after: 'x9' });
  assert.equal(syncedDiffRefs({ type: 'paragraph', op: 'added', after: p('a', 'x') }), null);
});

// --- server: sources ------------------------------------------------------------

const ARTICLE = {
  uid: 'api::article.article',
  kind: 'collectionType',
  info: { displayName: 'Article', pluralName: 'articles', singularName: 'article' },
  options: { draftAndPublish: true },
  pluginOptions: { i18n: { localized: true } },
  attributes: {
    title: { type: 'string' },
    slug: { type: 'uid' },
    body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' },
    summary: { type: 'json', customField: 'plugin::magic-editor-x.richtext', options: { preset: 'basic' } },
    sections: { type: 'component', component: 'blocks.section', repeatable: true },
  },
};
const SECTION = {
  uid: 'blocks.section',
  attributes: { body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' } },
};

/**
 * In-memory Strapi: the template query engine plus Document Service rows of one article type.
 * @param {{ entries?: object[], config?: object }} [input] - Article rows (with `status`) and plugin config.
 * @returns {{ strapi: object, rows: object[], calls: object }} Fake.
 */
const fakeStrapi = ({ entries = [], config = {} } = {}) => {
  const rows = [];
  const calls = { documents: [] };
  let id = 0;
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object' && Array.isArray(value.$in)
        ? value.$in.includes(row[key])
        : row[key] === value
    );
  const query = {
    findMany: async ({ where, limit } = {}) =>
      rows.filter((row) => matches(row, where)).slice(0, limit || 1000),
    findOne: async ({ where }) => rows.find((row) => matches(row, where)) || null,
    count: async () => rows.length,
    create: async ({ data }) => {
      id += 1;
      const row = { id, documentId: `tpl${id}`, createdAt: 'now', updatedAt: 'now', ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) =>
      Object.assign(
        rows.find((row) => matches(row, where)),
        data
      ),
    delete: async ({ where }) =>
      rows.splice(
        rows.findIndex((row) => matches(row, where)),
        1
      ),
  };
  const strapi = {
    db: { query: () => query, transaction: async (fn) => fn() },
    contentTypes: { [ARTICLE.uid]: ARTICLE },
    components: { [SECTION.uid]: SECTION },
    contentType: (uid) => (uid === ARTICLE.uid ? ARTICLE : undefined),
    config: {
      get: (key) =>
        key === 'plugin::magic-editor-x.links.urlPattern'
          ? '/{locale}/{collection}/{slug}'
          : config[key.replace('plugin::magic-editor-x.', '')],
    },
    log: { debug() {}, warn() {}, error() {}, info() {} },
    documents: (uid) => ({
      findMany: async (params) => {
        calls.documents.push({ uid, ...params });
        const cursor = params.filters?.id?.$gt ?? -1;
        const ids = params.filters?.documentId?.$in;
        return entries
          .filter((row) => (params.status ? row.status === params.status : true))
          .filter((row) => row.id > cursor)
          .filter((row) => !ids || ids.includes(row.documentId))
          .slice(0, params.limit || 100);
      },
    }),
  };
  strapi.plugin = () => ({ service: (name) => (name === 'templates' ? templatesService({ strapi }) : null) });
  return { strapi, rows, calls };
};

const definition = (overrides = {}) => ({
  name: 'Footer note',
  kind: 'synced',
  blocks: SOURCE,
  scope: { all: true },
  ...overrides,
});

test('server: a synced source may not contain a synced block, and its kind never changes', async () => {
  assert.ok(TEMPLATE_KINDS.includes('synced'));
  assert.ok(contentTypes.template.schema.attributes.kind.enum.includes('synced'));
  const { strapi } = fakeStrapi();
  const service = templatesService({ strapi });
  await assert.rejects(
    service.create(definition({ blocks: doc(p('a', 'x'), synced('b', 'abc')) }), null),
    (error) =>
      error.name === 'ValidationError' &&
      /cannot contain another synced block/.test(error.details.fieldErrors.blocks[0])
  );
  // Templates and patterns may hold references (inserting them inserts the reference).
  const pattern = await service.create(
    definition({ kind: 'pattern', blocks: doc(synced('b', 'abc')) }),
    null
  );
  const source = await service.create(definition(), null);
  await assert.rejects(service.update(source.id, definition({ kind: 'pattern' })), (error) =>
    /cannot be changed/.test(error.details.fieldErrors.kind[0])
  );
  await assert.rejects(service.update(pattern.id, definition({ kind: 'synced', blocks: SOURCE })), (error) =>
    /cannot be changed/.test(error.details.fieldErrors.kind[0])
  );
  // A disabled source is still readable for existing references.
  await service.update(source.id, definition({ enabled: false }));
  assert.equal((await service.findOne(source.id, { includeDisabled: false })).kind, 'synced');
  await service.update(pattern.id, definition({ kind: 'pattern', enabled: false, blocks: doc(p('a', 'x')) }));
  await assert.rejects(service.findOne(pattern.id, { includeDisabled: false }), { name: 'NotFoundError' });
});

test('server: the field list offers synced blocks only where the preset allows them', async () => {
  const { strapi } = fakeStrapi();
  const service = templatesService({ strapi });
  await service.create(definition(), null);
  await service.create(definition({ name: 'P', kind: 'pattern', blocks: doc(p('a', 'x')) }), null);
  const full = await service.listForField({ uid: ARTICLE.uid, field: 'body' });
  assert.deepEqual(full.map((item) => item.kind).sort(), ['pattern', 'synced']);
  const basic = await service.listForField({ uid: ARTICLE.uid, field: 'summary' });
  assert.deepEqual(
    basic.map((item) => item.kind),
    ['pattern']
  );
});

test('server: usage counts references in every field version (components too) and in patterns', async () => {
  const entries = [
    { id: 1, documentId: 'a1', locale: 'en', status: 'draft', body: doc(synced('x', 'tpl1')), sections: [] },
    {
      id: 2,
      documentId: 'a1',
      locale: 'en',
      status: 'published',
      body: doc(synced('x', 'tpl1')),
      sections: [],
    },
    {
      id: 3,
      documentId: 'a2',
      locale: 'de',
      status: 'draft',
      body: doc(p('n', 'none')),
      sections: [{ body: doc(synced('y', 'tpl1')) }],
    },
    {
      id: 4,
      documentId: 'a3',
      locale: 'en',
      status: 'draft',
      body: JSON.stringify(doc(synced('z', 'other1'))),
      sections: [],
    },
  ];
  const { strapi, calls } = fakeStrapi({ entries });
  const service = templatesService({ strapi });
  const source = await service.create(definition(), null);
  assert.equal(source.id, 'tpl1');
  await service.create(definition({ name: 'P', kind: 'pattern', blocks: doc(synced('q', 'tpl1')) }), null);
  assert.deepEqual(await service.usage('tpl1'), { entries: 2, fields: 3, templates: 1, complete: true });
  assert.ok(calls.documents.every((call) => call.locale === '*' && call.fields.includes('documentId')));
  assert.deepEqual([...new Set(calls.documents.map((call) => call.status))].sort(), ['draft', 'published']);
  await assert.rejects(service.usage('tpl2'), { name: 'NotFoundError' });
});

test('routes: usage needs access and templates.manage', () => {
  const route = routes.admin.routes.find((item) => item.path === '/templates/:id/usage');
  assert.equal(route.method, 'GET');
  assert.equal(route.handler, 'templates.usage');
  const policy = route.config.policies.find((item) => item.name === 'admin::hasPermissions');
  assert.deepEqual(policy.config.actions, [ACTIONS.access, ACTIONS.templatesManage]);
});

// --- server: Content API expansion ---------------------------------------------

test('Content API: synced blocks expand for the field (preset, sanitiser) and links resolve with the caller', async () => {
  const mention =
    '<a href="/stale" data-mex-uid="api::article.article" data-mex-document-id="hidden1" data-mex-locale="en" data-mex-mention="true">Secret title</a>';
  const { strapi } = fakeStrapi({
    entries: [
      { id: 1, documentId: 'hidden1', locale: 'en', status: 'published', title: 'T', slug: 'secret-slug' },
    ],
  });
  strapi.auth = {
    verify: async () => {
      throw new Error('Forbidden');
    },
  };
  strapi.contentAPI = { sanitize: { output: async (row) => row } };
  strapi.getModel = () => undefined;
  const service = templatesService({ strapi });
  await service.create(
    definition({
      blocks: doc(h('s1', 'Shared', 1), p('s2', `Hi <mark>marked</mark> ${mention}`), {
        id: 's3',
        type: 'table',
        data: { withHeadings: false, content: [['cell']] },
      }),
    }),
    null
  );
  const references = createReferences({ strapi });
  const items = [
    { value: doc(p('a', 'Intro'), synced('r', 'tpl1')), locale: 'en', options: {} },
    {
      value: doc(synced('r', 'tpl1'), synced('gone', 'missing1')),
      locale: 'en',
      options: { preset: 'basic' },
    },
    { value: doc(p('plain', 'No synced block')), locale: 'en', options: {} },
  ];
  const [full, basic] = await references.transform(items, {
    format: 'html',
    auth: { strategy: { name: 'api-token' } },
  });
  assert.match(full, /<h1 class="mex-header">Shared<\/h1>/);
  assert.match(full, /<table/);
  assert.match(full, /<mark>marked<\/mark>/);
  // The mention points at an entry the caller may not read: plain text, no href or reference attributes.
  assert.doesNotMatch(full, /secret-slug|\/stale|data-mex-document-id/);
  assert.match(full, /Secret title/);
  // basic: no table, heading level 2, marker unwrapped by the preset's inline tags.
  assert.doesNotMatch(basic, /<table|<h1|<mark/);
  assert.match(basic, /<h2 class="mex-header">Shared<\/h2>/);
  const [json] = await references.transform([items[0]], { format: 'json' });
  assert.deepEqual(
    json.blocks.map((block) => [block.id, block.syncedFrom || null]),
    [
      ['a', null],
      ['r-s1', 'tpl1'],
      ['r-s2', 'tpl1'],
      ['r-s3', 'tpl1'],
    ]
  );
  // Deleting the source: the reference expands to nothing.
  await service.remove('tpl1');
  const [after] = await references.transform([items[0]], { format: 'text' });
  assert.equal(after, 'Intro');
  assert.ok(SYNCED_LIMITS.refsPerResponse >= 50);
});

// --- settings form ------------------------------------------------------------------

test('settings form: synced kind round trip, nested refusal, kind filter and moving inside a filter', () => {
  assert.equal(fromDto({ name: 'x', kind: 'synced', scope: { all: true }, blocks: SOURCE }).kind, 'synced');
  const values = { name: 'x', description: '', kind: 'synced', scopeMode: 'all', presets: [], fields: [] };
  assert.equal(
    validateTemplate({ ...values, blocks: doc(p('a', 'x'), synced('b', 'y')) }).blocks,
    'nestedSynced'
  );
  assert.equal(
    validateTemplate({ ...values, kind: 'pattern', blocks: doc(p('a', 'x'), synced('b', 'y')) }).blocks,
    undefined
  );
  const list = [
    { id: 'a', kind: 'template' },
    { id: 'b', kind: 'synced' },
    { id: 'c', kind: 'pattern' },
    { id: 'd', kind: 'synced' },
  ];
  assert.deepEqual(
    filterByKind(list, 'synced').map((item) => item.id),
    ['b', 'd']
  );
  assert.equal(filterByKind(list, 'all').length, 4);
  assert.deepEqual(moveWithin(['a', 'b', 'c', 'd'], ['b', 'd'], 'd', -1), ['a', 'd', 'c', 'b']);
  assert.equal(moveWithin(['a', 'b'], ['b'], 'b', -1), null);
});

/**
 * "Use existing content" (2.5): the shared insertion rules (clipboard parsing,
 * preset check, fresh ids, footnotes, toggles, synced references, limits),
 * the source service against a fake Strapi (Content Manager read on the
 * document, locale and field; cleaning like a save; bounds), the controller
 * (strict input, switch, rate limit) and the routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  REUSE_LIMITS,
  parseEditorClipboard,
  reuseStatus,
  planReuseInsertion,
  refreshFootnoteIds,
  footnoteIdsOf,
  spliceReuse,
  fieldPathLabel,
  fieldPathParts,
  humanizeAttribute,
} from '../shared/reuse.mjs';
import { resolveFieldPreset } from '../shared/presets.mjs';

const require = createRequire(import.meta.url);
const reuseService = require('../server/src/services/reuse.js');
const accessService = require('../server/src/services/access.js');
const reuseController = require('../server/src/controllers/reuse.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS } = require('../server/src/permissions.js');
const config = require('../server/src/config/index.js');

const p = (id, text, extra = {}) => ({ id, type: 'paragraph', data: { text }, ...extra });
const counter = (prefix) => {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
};
const full = resolveFieldPreset({});
const basic = resolveFieldPreset({ preset: 'basic' });

test('parseEditorClipboard reads the Editor.js 2.31 block clipboard and skips junk', () => {
  const json = JSON.stringify([
    {
      id: 'a1',
      tool: 'header',
      data: { text: 'H', level: 2 },
      tunes: { alignmentTune: { alignment: 'center' } },
      time: 3,
    },
    { id: 'a2', tool: 'paragraph', data: { text: 'x' }, tunes: {} },
    { tool: 'bad name!', data: {} },
    { tool: 'paragraph', data: 'not an object' },
    'string',
    null,
  ]);
  assert.deepEqual(parseEditorClipboard(json), [
    {
      type: 'header',
      data: { text: 'H', level: 2 },
      id: 'a1',
      tunes: { alignmentTune: { alignment: 'center' } },
    },
    { type: 'paragraph', data: { text: 'x' }, id: 'a2' },
  ]);
  assert.equal(parseEditorClipboard('not json'), null);
  assert.equal(parseEditorClipboard('{}'), null);
  assert.equal(parseEditorClipboard('[]'), null);
  assert.equal(parseEditorClipboard(42), null);
  assert.equal(parseEditorClipboard(`["${'x'.repeat(REUSE_LIMITS.clipboardBytes)}"]`), null);
  const many = JSON.stringify(
    Array.from({ length: REUSE_LIMITS.clipboardBlocks + 5 }, () => ({ tool: 'paragraph', data: {} }))
  );
  assert.equal(parseEditorClipboard(many).length, REUSE_LIMITS.clipboardBlocks);
  // `type` (our own block shape) is accepted as well as Editor.js' `tool`; tool keys like `name$mex` too.
  assert.equal(
    parseEditorClipboard(JSON.stringify([{ type: 'calloutCard', data: {} }]))[0].type,
    'calloutCard'
  );
  assert.equal(parseEditorClipboard(JSON.stringify([{ tool: 'math$mex', data: {} }]))[0].type, 'math$mex');
});

test('reuseStatus: preset, missing tool, synced source, adjustable and unfixable blocks', () => {
  const header = { id: 'h', type: 'header', data: { text: 'H', level: 5 } };
  assert.deepEqual(reuseStatus(p('x', 'a'), { preset: basic }), {
    ok: true,
    adjusted: false,
    block: p('x', 'a'),
  });
  assert.equal(
    reuseStatus({ id: 'c', type: 'code', data: { code: 'x' } }, { preset: basic }).reason,
    'notAllowed'
  );
  assert.equal(reuseStatus(p('x', 'a'), { hasTool: () => false }).reason, 'unavailable');
  const fixed = reuseStatus(header, { preset: basic });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.adjusted, true);
  assert.equal(fixed.block.data.level, 3);
  const synced = { id: 's', type: 'synced', data: { ref: 'abc123', _mex: 1 } };
  assert.equal(reuseStatus(synced, { syncedAvailable: () => false }).reason, 'syncedMissing');
  assert.equal(reuseStatus(synced, { syncedAvailable: () => undefined }).ok, true);
  assert.equal(reuseStatus(synced, { preset: basic }).reason, 'notAllowed');
  assert.equal(reuseStatus(null).reason, 'unfixable');
  assert.equal(reuseStatus({ type: 'paragraph', data: 'x' }).reason, 'unfixable');
  // A field without heading levels cannot take a heading: left out, not adjusted.
  const minimal = resolveFieldPreset({ preset: 'minimal' });
  assert.equal(reuseStatus(header, { preset: minimal }).reason, 'notAllowed');
});

test('planReuseInsertion: fresh ids, tunes and every data key kept, synced stays a reference', () => {
  const source = [
    p('s1', 'One', { tunes: { alignmentTune: { alignment: 'center' } } }),
    {
      id: 's2',
      type: 'image',
      data: {
        file: { url: '/uploads/a.png', id: 7, documentId: 'f1' },
        caption: '',
        fileId: 7,
        extra: { nested: [1] },
      },
    },
    { id: 's3', type: 'synced', data: { ref: 'src1', _mex: 1 } },
    { id: 's4', type: 'calloutCard', data: { title: 'T', body: 'B', tone: 'info' } },
  ];
  const plan = planReuseInsertion(source, {
    preset: null,
    existing: [p('n1', 'kept'), p('n2', 'kept')],
    idFactory: counter('n'),
  });
  assert.deepEqual(
    plan.blocks.map((block) => block.id),
    ['n3', 'n4', 'n5', 'n6'],
    'ids already in the field are skipped'
  );
  assert.deepEqual(plan.blocks[0].tunes, { alignmentTune: { alignment: 'center' } });
  assert.deepEqual(plan.blocks[1].data, source[1].data, 'unknown keys of allowed blocks are kept');
  assert.notEqual(plan.blocks[1].data, source[1].data, 'data is a copy');
  assert.deepEqual(plan.blocks[2].data, { ref: 'src1', _mex: 1 }, 'a synced block stays a reference');
  assert.equal(plan.blocks[3].type, 'calloutCard');
  assert.deepEqual(plan.omitted, []);
  assert.equal(plan.truncated, 0);
  assert.ok(!('tunes' in plan.blocks[2]));
  assert.equal(source[0].id, 's1', 'the source is not changed');
});

test('planReuseInsertion: selection, preset filter with reasons, adjusted blocks and block limit', () => {
  const source = [
    p('a', 'A'),
    { id: 'b', type: 'header', data: { text: 'B', level: 1 } },
    { id: 'c', type: 'code', data: { code: 'x' } },
    { id: 'd', type: 'calloutCard', data: { title: 't' } },
    { id: 'e', type: 'synced', data: { ref: 'gone', _mex: 1 } },
    p('f', 'F'),
  ];
  const plan = planReuseInsertion(source, {
    selected: ['a', 'b', 'c', 'd', 'e'],
    preset: resolveFieldPreset({ preset: 'basic', maxBlocks: 3 }),
    hasTool: (type) => type !== 'calloutCard',
    syncedAvailable: () => false,
    existing: [p('x', 'x')],
    idFactory: counter('id'),
  });
  assert.deepEqual(
    plan.blocks.map((block) => block.type),
    ['paragraph', 'header']
  );
  assert.equal(plan.blocks[1].data.level, 2, 'heading level fixed like "Fix automatically"');
  assert.equal(plan.adjusted, 1);
  assert.deepEqual(plan.omitted, [
    { reason: 'notAllowed', type: 'code', count: 1 },
    { reason: 'notAllowed', type: 'calloutCard', count: 1 },
    { reason: 'notAllowed', type: 'synced', count: 1 },
  ]);
  assert.equal(plan.truncated, 0);
  const limited = planReuseInsertion([p('1', '1'), p('2', '2'), p('3', '3')], {
    preset: resolveFieldPreset({ maxBlocks: 3 }),
    existing: [p('x', 'x'), p('y', 'y')],
  });
  assert.equal(limited.blocks.length, 1);
  assert.equal(limited.truncated, 2);
  // The full preset knows every block; a missing editor tool and a removed synced source are reported.
  const reasons = planReuseInsertion(source.slice(3, 5), {
    preset: full,
    hasTool: (type) => type !== 'calloutCard',
    syncedAvailable: () => false,
  });
  assert.deepEqual(
    reasons.omitted.map((item) => item.reason),
    ['unavailable', 'syncedMissing']
  );
});

test('planReuseInsertion keeps toggle counts right when blocks are left out or cut', () => {
  const toggle = { id: 't', type: 'toggle', data: { text: 'Group', status: 'open', items: 2 } };
  const source = [toggle, p('c1', 'one'), p('c2', 'two'), p('after', 'after')];
  const plan = planReuseInsertion(source, { selected: ['t', 'c2', 'after'], idFactory: counter('n') });
  assert.deepEqual(
    plan.blocks.map((block) => [block.type, block.data.items ?? null]),
    [
      ['toggle', 1],
      ['paragraph', null],
      ['paragraph', null],
    ]
  );
  // Unticked toggle: its content stays as plain blocks.
  const loose = planReuseInsertion(source, { selected: ['c1', 'c2'], idFactory: counter('m') });
  assert.deepEqual(
    loose.blocks.map((block) => block.data.text),
    ['one', 'two']
  );
  // The block limit cuts inside the toggle: the count follows.
  const cut = planReuseInsertion(source, {
    preset: resolveFieldPreset({ maxBlocks: 2 }),
    idFactory: counter('k'),
  });
  assert.equal(cut.blocks[0].data.items, 1);
  assert.equal(cut.truncated, 2);
});

test('footnote ids taken in the field or repeated in the inserted blocks get a new id', () => {
  const marker = (id, note) => `<sup data-mex-footnote="${id}" data-mex-note="${note}">*</sup>`;
  const existing = [p('e1', `Text${marker('fnShared01', 'old')}`)];
  assert.deepEqual([...footnoteIdsOf(existing)], ['fnShared01']);
  const source = [
    p('s1', `A${marker('fnShared01', 'note A')}`),
    p('s2', `B${marker('fnOwn00001', 'note B')} and again${marker('fnOwn00001', 'copy')}`),
  ];
  const plan = planReuseInsertion(source, {
    existing,
    idFactory: counter('n'),
    footnoteIdFactory: counter('fnNew'),
  });
  assert.equal(plan.footnotes, 2);
  assert.equal(plan.blocks[0].data.text, `A${marker('fnNew1', 'note A')}`, 'the note stays with its marker');
  assert.equal(
    plan.blocks[1].data.text,
    `B${marker('fnOwn00001', 'note B')} and again${marker('fnNew2', 'copy')}`
  );
  // Nested strings (list items, table cells) are covered too.
  const nested = refreshFootnoteIds(
    [{ id: 'l', type: 'list', data: { items: [{ content: marker('fnX', 'n'), items: [] }] } }],
    new Set(['fnX']),
    () => 'fnY'
  );
  assert.equal(nested.blocks[0].data.items[0].content, marker('fnY', 'n'));
  assert.equal(nested.renamed, 1);
});

test('spliceReuse inserts after a block, replaces an empty paragraph, or appends', () => {
  const doc = { time: 1, version: '2.31.7', blocks: [p('a', 'A'), p('b', ''), p('c', 'C')] };
  const ids = (value) => value.blocks.map((block) => block.id);
  assert.deepEqual(ids(spliceReuse(doc, [p('x', 'X')], { afterIndex: 0 })), ['a', 'x', 'b', 'c']);
  assert.deepEqual(ids(spliceReuse(doc, [p('x', 'X')], { replaceIndex: 1 })), ['a', 'x', 'c']);
  assert.deepEqual(ids(spliceReuse(doc, [p('x', 'X')], { afterIndex: -1 })), ['x', 'a', 'b', 'c']);
  assert.deepEqual(ids(spliceReuse(doc, [p('x', 'X')])), ['a', 'b', 'c', 'x']);
  assert.deepEqual(ids(spliceReuse(null, [p('x', 'X')], { afterIndex: 5 })), ['x']);
  assert.equal(spliceReuse(doc, []).version, '2.31.7');
});

test('field path labels for the field picker', () => {
  assert.deepEqual(fieldPathParts('sections.0.body'), [{ name: 'sections', index: 1 }, { name: 'body' }]);
  assert.equal(fieldPathLabel('sections.0.body'), 'Sections 1 › Body');
  assert.equal(fieldPathLabel('zone.2.items.0.heroText'), 'Zone 3 › Items 1 › Hero text');
  assert.equal(fieldPathLabel('body'), 'Body');
  assert.equal(humanizeAttribute('related_articles'), 'Related articles');
  assert.equal(humanizeAttribute(''), '');
});

/* ------------------------------------------------------------------ server */

const editorField = (options = {}) => ({
  type: 'customField',
  customField: 'plugin::magic-editor-x.richtext',
  options,
});
const ARTICLE = {
  uid: 'api::article.article',
  kind: 'collectionType',
  info: { displayName: 'Article', singularName: 'article', pluralName: 'articles' },
  options: { draftAndPublish: true },
  pluginOptions: { i18n: { localized: true } },
  attributes: {
    title: { type: 'string' },
    body: editorField(),
    summary: editorField({ preset: 'basic' }),
    sections: { type: 'component', repeatable: true, component: 'blocks.section' },
  },
};
const NOTE = {
  uid: 'api::note.note',
  kind: 'collectionType',
  info: { displayName: 'Note' },
  options: {},
  attributes: { name: { type: 'string' } },
};
const SECTION = { uid: 'blocks.section', attributes: { heading: { type: 'string' }, body: editorField() } };

/**
 * Fake Strapi: one article (en + de), Content Manager rules from `rules`.
 * @param {{ read?: boolean, fields?: string[]|null, locales?: string[]|null, reuse?: object, hits?: number }} rules - Caller's permissions.
 * @returns {object} Strapi.
 */
const fakeStrapi = (rules = {}) => {
  const { read = true, fields = null, locales = null, reuse = {}, rawHtml } = rules;
  const rows = {
    en: {
      documentId: 'doc1',
      locale: 'en',
      title: 'Source',
      updatedAt: '2026-11-12T10:00:00.000Z',
      body: { blocks: [p('b1', 'Hello <script>alert(1)</script><b>bold</b>'), p('b2', 'Two')] },
      summary: { blocks: [p('s1', 'Summary')] },
      sections: [
        { id: 3, heading: 'One', body: { fieldKey: 'Key0123456789abcdefAB', blocks: [p('c1', 'Section')] } },
        { id: 4, heading: 'Empty', body: null },
      ],
    },
    de: { documentId: 'doc1', locale: 'de', title: 'Quelle', body: { blocks: [p('d1', 'Hallo')] } },
  };
  const calls = { findOne: [], counts: [] };
  const allowedLocale = (code) => !locales || locales.includes(code);
  const pick = (row, query) => {
    if (!row) return null;
    const out = { documentId: row.documentId };
    for (const key of query.fields || []) if (key in row) out[key] = row[key];
    for (const key of Object.keys(query.populate || {})) if (key in row) out[key] = row[key];
    return out;
  };
  const strapi = {
    contentTypes: { [ARTICLE.uid]: ARTICLE, [NOTE.uid]: NOTE },
    components: { [SECTION.uid]: SECTION },
    contentType: (uid) => strapi.contentTypes[uid],
    config: {
      get: (key) => {
        if (key === 'plugin::magic-editor-x.rawHtml') return rawHtml;
        if (key.startsWith('plugin::magic-editor-x.reuse.'))
          return reuse[key.slice('plugin::magic-editor-x.reuse.'.length)];
        return undefined;
      },
    },
    documents: (uid) => ({
      findFirst: async (query) => {
        if (uid !== ARTICLE.uid) return null;
        const id = query.filters?.$and ? query.filters.$and[0].documentId : query.filters?.documentId;
        const permission = query.filters?.$and ? query.filters.$and[1] : null;
        if (permission && permission.locale && !permission.locale.$in.includes(query.locale)) return null;
        if (query.status === 'published') return query.locale === 'en' ? { documentId: id } : null;
        return id === 'doc1' && rows[query.locale] ? { documentId: id } : null;
      },
      findOne: async (query) => {
        calls.findOne.push(query);
        return uid === ARTICLE.uid && query.documentId === 'doc1' ? pick(rows[query.locale], query) : null;
      },
      count: async (query) => {
        calls.counts.push({ uid, ...query });
        if (uid !== ARTICLE.uid) return 0;
        const permission = query.filters;
        if (permission && permission.locale && !permission.locale.$in.includes(query.locale)) return 0;
        return rows[query.locale] ? 1 : 0;
      },
    }),
    plugin: (name) => ({
      service: (service) => {
        if (name === 'content-manager' && service === 'permission-checker')
          return {
            create: ({ model }) => ({
              cannot: {
                read: (entity, field) =>
                  !read ||
                  model !== ARTICLE.uid ||
                  (field ? fields !== null && !fields.includes(field) : false),
              },
              sanitizedQuery: {
                read: async () => (locales ? { filters: { locale: { $in: locales } } } : {}),
              },
              sanitizeOutput: async (row) => row,
            }),
          };
        if (name === 'i18n' && service === 'locales')
          return {
            getDefaultLocale: async () => 'en',
            find: async () => [
              { code: 'en', name: 'English (en)' },
              { code: 'de', name: 'German (de)' },
              { code: 'fr', name: 'French (fr)' },
            ],
          };
        if (name === 'magic-editor-x' && service === 'access') return access;
        if (name === 'magic-editor-x' && service === 'links') return { titleFieldFor: async () => 'title' };
        if (name === 'magic-editor-x' && service === 'store')
          return {
            hit: async () => {
              strapi.hits = (strapi.hits || 0) + 1;
              return { count: strapi.hits, resetAt: 0 };
            },
          };
        if (name === 'magic-editor-x' && service === 'reuse') return reuse_;
        throw new Error(`unexpected service ${name}.${service}`);
      },
    }),
    calls,
    allowedLocale,
  };
  const access = accessService({ strapi });
  const reuse_ = reuseService({ strapi });
  strapi.reuse = reuse_;
  return strapi;
};
const ability = {};

test('source: readable fields with blocks cleaned like a save, draft, title, identities', async () => {
  const strapi = fakeStrapi();
  const data = await strapi.reuse.source({
    userAbility: ability,
    uid: ARTICLE.uid,
    documentId: 'doc1',
    locale: 'en',
  });
  assert.equal(data.title, 'Source');
  assert.equal(data.status, 'draft');
  assert.equal(data.hasPublished, true);
  assert.equal(data.locale, 'en');
  assert.deepEqual(
    data.fields.map((field) => [field.field, field.preset, field.blockCount, field.fieldKey]),
    [
      ['body', 'full', 2, null],
      ['summary', 'basic', 1, null],
      ['sections.0.body', 'full', 1, 'Key0123456789abcdefAB'],
    ],
    'empty values are not offered'
  );
  assert.doesNotMatch(data.fields[0].blocks[0].data.text, /script/);
  assert.match(data.fields[0].blocks[0].data.text, /<b>bold<\/b>/);
  assert.ok(strapi.calls.findOne.every((query) => query.status === 'draft' && query.locale === 'en'));
  // One field only (positional path).
  const one = await strapi.reuse.source({
    userAbility: ability,
    uid: ARTICLE.uid,
    documentId: 'doc1',
    locale: 'en',
    field: 'sections.0.body',
  });
  assert.deepEqual(
    one.fields.map((field) => field.field),
    ['sections.0.body']
  );
  // Default locale when none is given.
  const fallback = await strapi.reuse.source({ userAbility: ability, uid: ARTICLE.uid, documentId: 'doc1' });
  assert.equal(fallback.locale, 'en');
  const german = await strapi.reuse.source({
    userAbility: ability,
    uid: ARTICLE.uid,
    documentId: 'doc1',
    locale: 'de',
  });
  assert.equal(german.hasPublished, false);
  assert.equal(german.fields[0].blocks[0].data.text, 'Hallo');
});

test('source: 404 without read on the type, document, locale or field; hidden fields are left out', async () => {
  const notFound = (promise) => assert.rejects(promise, (error) => error.name === 'NotFoundError');
  const input = { userAbility: ability, uid: ARTICLE.uid, documentId: 'doc1', locale: 'en' };
  await notFound(fakeStrapi({ read: false }).reuse.source(input));
  await notFound(fakeStrapi().reuse.source({ ...input, documentId: 'nope' }));
  await notFound(fakeStrapi().reuse.source({ ...input, uid: 'api::note.note' }));
  await notFound(fakeStrapi().reuse.source({ ...input, uid: 'plugin::users-permissions.user' }));
  await notFound(fakeStrapi().reuse.source({ ...input, userAbility: null }));
  // Locale permission: German only.
  await notFound(fakeStrapi({ locales: ['de'] }).reuse.source(input));
  assert.equal(
    (await fakeStrapi({ locales: ['de'] }).reuse.source({ ...input, locale: 'de' })).fields.length,
    1
  );
  // Field-level permission: summary hidden.
  const hidden = fakeStrapi({ fields: ['title', 'body', 'sections.body'] });
  const data = await hidden.reuse.source(input);
  assert.deepEqual(
    data.fields.map((field) => field.field),
    ['body', 'sections.0.body']
  );
  await notFound(hidden.reuse.source({ ...input, field: 'summary' }));
  await notFound(hidden.reuse.source({ ...input, field: 'title' }));
  await notFound(hidden.reuse.source({ ...input, field: 'sections.1.body' }), 'an empty field is not found');
  // Without read on the title field, no title.
  const noTitle = await fakeStrapi({ fields: ['body'] }).reuse.source(input);
  assert.equal(noTitle.title, '');
  assert.deepEqual(
    noTitle.fields.map((field) => field.field),
    ['body']
  );
});

test('source: bounds per field and per response', async () => {
  const strapi = fakeStrapi();
  const big = Array.from({ length: REUSE_LIMITS.blocksPerField + 20 }, (_, i) => p(`p${i}`, `Block ${i}`));
  const original = strapi.documents;
  strapi.documents = (uid) => {
    const docs = original(uid);
    return {
      ...docs,
      findOne: async (query) => {
        const row = await docs.findOne(query);
        if (row && 'body' in row) row.body = { blocks: big };
        return row;
      },
    };
  };
  const data = await strapi.reuse.source({
    userAbility: ability,
    uid: ARTICLE.uid,
    documentId: 'doc1',
    locale: 'en',
  });
  const body = data.fields.find((field) => field.field === 'body');
  assert.equal(body.blocks.length, REUSE_LIMITS.blocksPerField);
  assert.equal(body.blockCount, REUSE_LIMITS.blocksPerField + 20);
  assert.equal(body.truncated, true);
});

test('types: editor types with a readable field and the locales with readable entries', async () => {
  const strapi = fakeStrapi({ locales: ['en', 'de'] });
  assert.deepEqual(await strapi.reuse.types(ability), [
    {
      uid: ARTICLE.uid,
      kind: 'collectionType',
      displayName: 'Article',
      localized: true,
      locales: [
        { code: 'en', name: 'English (en)' },
        { code: 'de', name: 'German (de)' },
      ],
    },
  ]);
  assert.deepEqual(await fakeStrapi({ read: false }).reuse.types(ability), []);
  assert.deepEqual(
    await fakeStrapi({ fields: ['title'] }).reuse.types(ability),
    [],
    'no readable editor field'
  );
  assert.deepEqual(await fakeStrapi({ locales: ['fr'] }).reuse.types(ability), [], 'no readable entry');
  assert.deepEqual(await strapi.reuse.types(null), []);
});

test('controller: strict input, switch off answers 404, rate limit 429', async () => {
  const run = async (strapi, handler, query) => {
    const ctx = { query, state: { userAbility: ability, user: { id: 9 } }, body: null };
    await reuseController({ strapi })[handler](ctx);
    return ctx.body;
  };
  const strapi = fakeStrapi();
  const body = await run(strapi, 'source', { uid: ARTICLE.uid, documentId: 'doc1', locale: 'en', field: '' });
  assert.equal(body.data.fields.length, 3);
  for (const query of [
    { uid: ARTICLE.uid, documentId: 'doc1', extra: '1' },
    { uid: 'plugin::x.y', documentId: 'doc1' },
    { uid: ARTICLE.uid, documentId: 'DOC 1' },
    { uid: ARTICLE.uid, documentId: 'doc1', field: 'a..b' },
    { uid: ARTICLE.uid, documentId: 'doc1', locale: 'en;drop' },
    { uid: ARTICLE.uid },
  ])
    await assert.rejects(
      run(strapi, 'source', query),
      (error) => error.name === 'ValidationError',
      JSON.stringify(query)
    );
  await assert.rejects(run(strapi, 'types', { x: '1' }), (error) => error.name === 'ValidationError');
  assert.equal((await run(strapi, 'types', {})).data.length, 1);
  const off = fakeStrapi({ reuse: { enabled: false } });
  await assert.rejects(run(off, 'types', {}), (error) => error.name === 'NotFoundError');
  await assert.rejects(
    run(off, 'source', { uid: ARTICLE.uid, documentId: 'doc1' }),
    (error) => error.name === 'NotFoundError'
  );
  const limited = fakeStrapi({ reuse: { perMinute: 2 } });
  await run(limited, 'types', {});
  await run(limited, 'types', {});
  await assert.rejects(run(limited, 'types', {}), (error) => error.name === 'RateLimitError');
});

test('routes, config defaults and validation', () => {
  const byKey = new Map(routes.admin.routes.map((route) => [`${route.method} ${route.path}`, route]));
  for (const key of ['GET /reuse/types', 'GET /reuse/source']) {
    const route = byKey.get(key);
    assert.ok(route, key);
    assert.deepEqual(route.config.policies[0], 'admin::isAuthenticatedAdmin');
    assert.deepEqual(route.config.policies[1].config.actions, [ACTIONS.access]);
  }
  assert.deepEqual(config.default.reuse, { enabled: true, perMinute: 60 });
  config.validator({ ...config.default });
  const { reuse, ...withoutReuse } = config.default;
  assert.ok(reuse);
  config.validator(withoutReuse);
  assert.throws(() => config.validator({ ...config.default, reuse: { enabled: 'yes' } }), /reuse/);
  assert.throws(() => config.validator({ ...config.default, reuse: { perMinute: 0 } }), /reuse/);
});

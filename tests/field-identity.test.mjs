/**
 * Stable identity of editor fields inside repeatable components and dynamic
 * zones (2.4): the `fieldKey` in the stored value, key assignment on save,
 * the server resolution in `access.checkField`, and the mapping of rows that
 * were stored under positional paths before 2.4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  FIELD_KEY_PATTERN,
  isValidFieldKey,
  createFieldKey,
  basePathOf,
  fieldIdentity,
  parseFieldIdentity,
  blockIdsOf,
  ownerOfBlocks,
  assignFieldKeys,
} from '../shared/field-identity.mjs';
import { normalizeEditorData } from '../shared/editor-data.mjs';
import { renderHtml } from '../shared/render/index.mjs';
import { fieldKeysAt, identityTarget } from '../admin/src/editor/field-path.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');
const { resolveEditorField } = require('../server/src/utils/editor-fields.js');
const { pathQuery, collectAt } = require('../server/src/utils/field-identity.js');
const accessService = require('../server/src/services/access.js');
const historyService = require('../server/src/services/history.js');
const commentsService = require('../server/src/services/comments.js');
const { targetOfRoom } = require('../server/src/services/collaboration.js');

const FIELD = 'plugin::magic-editor-x.richtext';
const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'BBBBBBBBBBBBBBBBBBBBBB';
const KEY_C = 'CCCCCCCCCCCCCCCCCCCCCC';

const doc = (ids, extra = {}) => ({
  time: 1,
  version: '2.31.7',
  blocks: ids.map((id) => ({ id, type: 'paragraph', data: { text: `Text ${id}` } })),
  ...extra,
});

/* ------------------------------------------------------------ pure helpers */

test('field keys: format, generation, identity strings', () => {
  const keys = new Set(Array.from({ length: 200 }, () => createFieldKey()));
  assert.equal(keys.size, 200);
  for (const key of keys) assert.match(key, FIELD_KEY_PATTERN);
  assert.equal(createFieldKey().length, 22);
  for (const bad of ['', 'short', 'x'.repeat(33), 'has space aaaaaaaaaaaa', 'a/b'.repeat(8), null, 7])
    assert.equal(isValidFieldKey(bad), false, String(bad));

  assert.equal(basePathOf('sections.0.body'), 'sections.body');
  assert.equal(basePathOf('zone.12.items.3.body'), 'zone.items.body');
  assert.equal(fieldIdentity('body', KEY_A), 'body', 'top-level fields keep their path');
  assert.equal(fieldIdentity('seo.body', null), 'seo.body');
  assert.equal(fieldIdentity('sections.3.body', KEY_A), `sections.body#${KEY_A}`);
  assert.equal(fieldIdentity('sections.3.body', null), null, 'positional without a key has no identity');
  assert.equal(fieldIdentity('sections.body', KEY_A, true), `sections.body#${KEY_A}`);

  assert.deepEqual(parseFieldIdentity(`zone.body#${KEY_B}`), {
    field: 'zone.body',
    fieldKey: KEY_B,
    legacy: false,
  });
  assert.deepEqual(parseFieldIdentity('sections.0.body'), {
    field: 'sections.0.body',
    fieldKey: null,
    legacy: true,
  });
  assert.deepEqual(parseFieldIdentity('body'), { field: 'body', fieldKey: null, legacy: false });
  assert.equal(parseFieldIdentity('sections.body#bad'), null);
  assert.equal(parseFieldIdentity(`sections.0.body#${KEY_A}`), null);
});

test('block-id evidence maps a row to exactly one entry', () => {
  const entries = [
    { blockIds: new Set(['aaaaaaaaaa', 'bbbbbbbbbb']) },
    { blockIds: new Set(['cccccccccc']) },
    { blockIds: new Set() },
  ];
  assert.equal(ownerOfBlocks(['cccccccccc', 'zzzzzzzzzz'], entries), 1);
  assert.equal(ownerOfBlocks(['aaaaaaaaaa'], entries), 0);
  assert.equal(ownerOfBlocks(['aaaaaaaaaa', 'cccccccccc'], entries), -1, 'two entries: ambiguous');
  assert.equal(ownerOfBlocks(['zzzzzzzzzz'], entries), -1, 'no entry');
  assert.equal(ownerOfBlocks([], entries), -1, 'no evidence');
  assert.deepEqual([...blockIdsOf(doc(['x1', 'x2']))], ['x1', 'x2']);
  assert.equal(blockIdsOf(null).size, 0);
});

test('assignFieldKeys: new keys, duplicates, inheritance, null stays null, top level loses keys', () => {
  let n = 0;
  const create = () => `GENERATEDKEY${String((n += 1)).padStart(10, '0')}`;
  const items = [
    { path: 'body', value: doc(['t'], { fieldKey: KEY_A }) },
    { path: 'sections.0.body', value: doc(['a'], { fieldKey: KEY_A }) },
    { path: 'sections.1.body', value: doc(['b'], { fieldKey: KEY_A }) },
    { path: 'sections.2.body', value: doc(['c']) },
    { path: 'sections.3.body', value: null },
    { path: 'zone.0.body', value: doc(['d'], { fieldKey: 'not a key' }) },
    { path: 'zone.1.body', value: doc(['e']), container: { id: 42 } },
  ];
  const changed = assignFieldKeys(items, {
    create,
    inherit: (item) => (item.container && item.container.id === 42 ? KEY_C : null),
  });
  assert.equal('fieldKey' in items[0].value, false, 'top-level values carry no key');
  assert.equal(items[1].value.fieldKey, KEY_A, 'the first occurrence keeps its key');
  assert.match(items[2].value.fieldKey, /^GENERATEDKEY/, 'a duplicate gets a new key');
  assert.match(items[3].value.fieldKey, /^GENERATEDKEY/);
  assert.equal(items[4].value, null, 'null is never turned into an object');
  assert.match(items[5].value.fieldKey, /^GENERATEDKEY/, 'an invalid key is replaced');
  assert.equal(items[6].value.fieldKey, KEY_C, 'a stored component row keeps its key');
  assert.equal(changed, 4);
  const keys = items
    .slice(1)
    .map((item) => item.value && item.value.fieldKey)
    .filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
});

test('stored shape: normalise, sanitise and render keep or ignore the key', () => {
  const value = doc(['p1'], { fieldKey: KEY_A });
  assert.equal(normalizeEditorData(value).fieldKey, KEY_A);
  assert.equal(normalizeEditorData(doc(['p1'], { fieldKey: 'x' })).fieldKey, undefined);
  assert.equal(normalizeEditorData(JSON.stringify(value)).fieldKey, KEY_A, '1.x strings keep a valid key');
  assert.equal(cleanEditorValue(value).fieldKey, KEY_A);
  assert.equal(cleanEditorValue(null), null);
  assert.equal(renderHtml(value), renderHtml(doc(['p1'])), 'renderers ignore the key');
});

/* ---------------------------------------------------------------- schema */

const components = {
  'blocks.text': {
    uid: 'blocks.text',
    attributes: { heading: { type: 'string' }, body: { type: 'json', customField: FIELD } },
  },
  'blocks.quote': {
    uid: 'blocks.quote',
    attributes: { caption: { type: 'string' }, body: { type: 'json', customField: FIELD } },
  },
  'blocks.group': {
    uid: 'blocks.group',
    attributes: { items: { type: 'component', repeatable: true, component: 'blocks.text' } },
  },
  'shared.seo': { uid: 'shared.seo', attributes: { body: { type: 'json', customField: FIELD } } },
};
const article = {
  uid: 'api::article.article',
  kind: 'collectionType',
  pluginOptions: { i18n: { localized: true } },
  attributes: {
    body: { type: 'json', customField: FIELD },
    seo: { type: 'component', component: 'shared.seo' },
    sections: { type: 'component', repeatable: true, component: 'blocks.text' },
    groups: { type: 'component', repeatable: true, component: 'blocks.group' },
    zone: { type: 'dynamiczone', components: ['blocks.text', 'blocks.quote', 'blocks.group'] },
  },
};

test('resolveEditorField: positional flag and base path, with and without indices', () => {
  const strapi = { components };
  const pick = (path) => {
    const resolved = resolveEditorField(strapi, article, path);
    return resolved && [resolved.positional, resolved.basePath, resolved.permissionField];
  };
  assert.deepEqual(pick('body'), [false, 'body', 'body']);
  assert.deepEqual(pick('seo.body'), [false, 'seo.body', 'seo.body']);
  assert.deepEqual(pick('sections.0.body'), [true, 'sections.body', 'sections.body']);
  assert.deepEqual(pick('sections.body'), [true, 'sections.body', 'sections.body']);
  assert.deepEqual(pick('groups.1.items.0.body'), [true, 'groups.items.body', 'groups.items.body']);
  assert.deepEqual(pick('zone.2.body'), [true, 'zone.body', 'zone']);
  assert.deepEqual(pick('zone.body'), [true, 'zone.body', 'zone']);
  assert.deepEqual(pick('zone.0.items.3.body'), [true, 'zone.items.body', 'zone']);
  assert.equal(pick('seo.0.body'), null, 'an index after a single component is not a path');
  assert.equal(pick('sections.0.heading'), null);
});

test('pathQuery reads only the field along the base path; collectAt walks every entry', () => {
  const strapi = { components };
  assert.deepEqual(pathQuery(strapi, article, ['sections', 'body']), {
    fields: [],
    populate: { sections: { fields: ['body'] } },
  });
  assert.deepEqual(pathQuery(strapi, article, ['zone', 'body']), {
    fields: [],
    populate: { zone: { on: { 'blocks.text': { fields: ['body'] }, 'blocks.quote': { fields: ['body'] } } } },
  });
  assert.deepEqual(pathQuery(strapi, article, ['zone', 'items', 'body']), {
    fields: [],
    populate: {
      zone: { on: { 'blocks.group': { fields: ['id'], populate: { items: { fields: ['body'] } } } } },
    },
  });
  const stored = {
    zone: [
      { id: 1, __component: 'blocks.text', body: doc(['a']) },
      { id: 2, __component: 'blocks.group' },
      { id: 3, __component: 'blocks.quote', body: null },
    ],
  };
  assert.deepEqual(
    collectAt(stored, ['zone', 'body']).map((item) => [item.path, item.container.id]),
    [
      ['zone.0.body', 1],
      ['zone.2.body', 3],
    ]
  );
});

/* ---------------------------------------------------- save middleware */

const createSaveHarness = (stored = null) => {
  const register = require('../server/src/register.js');
  const middlewares = [];
  const reads = [];
  const strapi = {
    customFields: { register: () => {} },
    config: { get: () => undefined },
    log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    components,
    contentType: () => article,
    documents: Object.assign(
      () => ({
        findOne: async (params) => {
          reads.push(params);
          return stored;
        },
      }),
      { use: (fn) => middlewares.push(fn) }
    ),
  };
  register({ strapi });
  const save = async (data, action = 'update', params = {}) => {
    await middlewares[0](
      { action, uid: article.uid, params: { documentId: 'doc1', locale: 'en', ...params, data } },
      async () => 'saved'
    );
    return data;
  };
  return { save, reads };
};

test('save: positional values get unique keys, null stays null, top-level values carry none', async () => {
  const { save, reads } = createSaveHarness();
  const data = await save(
    {
      body: doc(['t1'], { fieldKey: KEY_A }),
      seo: { body: doc(['s1']) },
      sections: [
        { heading: 'One', body: doc(['a1']) },
        { heading: 'Two', body: null },
        { heading: 'Three', body: doc(['c1'], { fieldKey: KEY_B }) },
        { heading: 'Copy', body: doc(['c1'], { fieldKey: KEY_B }) },
      ],
      groups: [{ items: [{ body: doc(['g1']) }] }],
      zone: [
        { __component: 'blocks.quote', body: doc(['q1']) },
        { __component: 'blocks.text', body: doc(['z1'], { fieldKey: KEY_C }) },
      ],
    },
    'create'
  );
  assert.equal('fieldKey' in data.body, false);
  assert.equal('fieldKey' in data.seo.body, false);
  assert.ok(isValidFieldKey(data.sections[0].body.fieldKey));
  assert.equal(data.sections[1].body, null);
  assert.equal(data.sections[2].body.fieldKey, KEY_B);
  assert.ok(isValidFieldKey(data.sections[3].body.fieldKey));
  assert.notEqual(data.sections[3].body.fieldKey, KEY_B, 'a copied key is replaced');
  assert.ok(isValidFieldKey(data.groups[0].items[0].body.fieldKey), 'nested components');
  assert.ok(isValidFieldKey(data.zone[0].body.fieldKey));
  assert.equal(data.zone[1].body.fieldKey, KEY_C);
  assert.equal(reads.length, 0, 'create never reads the stored draft');
});

test('save: an existing component sent without its key keeps the stored key', async () => {
  const { save, reads } = createSaveHarness({
    documentId: 'doc1',
    sections: [
      { id: 7, body: doc(['a1'], { fieldKey: KEY_A }) },
      { id: 8, body: doc(['b1'], { fieldKey: KEY_B }) },
    ],
  });
  const data = await save({
    sections: [
      { id: 8, heading: 'Moved up', body: doc(['b1']) },
      { id: 7, heading: 'Moved down', body: doc(['a1']) },
      { heading: 'New', body: doc(['n1']) },
    ],
  });
  assert.equal(data.sections[0].body.fieldKey, KEY_B);
  assert.equal(data.sections[1].body.fieldKey, KEY_A);
  assert.ok(![KEY_A, KEY_B].includes(data.sections[2].body.fieldKey));
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].populate, { sections: { fields: ['body'] } });
  assert.equal(reads[0].status, 'draft');
});

/* --------------------------------------------------------- checkField */

const createAccess = ({ stored, canUpdate = true } = {}) => {
  const reads = [];
  const strapi = {
    components,
    contentType: (uid) => (uid === article.uid ? article : undefined),
    plugin: (name) => ({
      service: (service) => {
        if (name === 'content-manager' && service === 'permission-checker')
          return {
            create: () => ({
              cannot: { read: () => false, update: () => !canUpdate },
              sanitizedQuery: { read: async () => ({}), update: async () => ({}) },
            }),
          };
        if (name === 'i18n') return { getDefaultLocale: async () => 'en' };
        return undefined;
      },
    }),
    documents: () => ({
      findFirst: async () => ({ documentId: 'doc1' }),
      findOne: async (params) => {
        reads.push(params);
        return stored;
      },
    }),
  };
  return { access: accessService({ strapi }), reads };
};

const STORED = {
  documentId: 'doc1',
  sections: [
    { id: 1, body: doc(['aaaaaaaaaa'], { fieldKey: KEY_A }) },
    { id: 2, body: doc(['bbbbbbbbbb']) },
    { id: 3, body: doc(['cccccccccc'], { fieldKey: KEY_C }) },
  ],
};
const base = { userAbility: {}, uid: article.uid, documentId: 'doc1', locale: 'en' };

test('checkField: top-level fields keep their path as identity', async () => {
  const { access, reads } = createAccess({ stored: STORED });
  const result = await access.checkField({ ...base, field: 'body' });
  assert.equal(result.fieldName, 'body');
  assert.equal(result.positional, false);
  assert.equal(reads.length, 0, 'no extra read for stable paths');
  await assert.rejects(access.checkField({ ...base, field: 'body', fieldKey: KEY_A }), {
    name: 'NotFoundError',
  });
});

test('checkField: positional fields resolve to their key, by key (any index) or by stored index', async () => {
  const { access } = createAccess({ stored: STORED });
  const byKey = await access.checkField({ ...base, field: 'sections.0.body', fieldKey: KEY_C });
  assert.equal(byKey.fieldName, `sections.body#${KEY_C}`, 'the index of the request does not matter');
  assert.equal(byKey.unsaved, false);
  const byIndex = await access.checkField({ ...base, field: 'sections.2.body' });
  assert.equal(byIndex.fieldName, `sections.body#${KEY_C}`);
  const keyless = await access.checkField({ ...base, field: 'sections.1.body' });
  assert.equal(keyless.fieldName, null, 'a stored value without a key has no identity');
  assert.equal(keyless.entries.length, 3);
  const missing = await access.checkField({ ...base, field: 'sections.9.body' });
  assert.equal(missing.fieldName, null);
  await assert.rejects(access.checkField({ ...base, field: 'sections.0.body', fieldKey: KEY_B }), {
    name: 'NotFoundError',
  });
  await assert.rejects(access.checkField({ ...base, field: 'sections.0.body', fieldKey: 'bad' }), {
    name: 'NotFoundError',
  });
});

test('checkField: an unsaved key only for live sessions of editors', async () => {
  const editor = createAccess({ stored: STORED });
  const session = await editor.access.checkField({
    ...base,
    field: 'sections.1.body',
    fieldKey: KEY_B,
    allowUnsavedKey: true,
  });
  assert.equal(session.fieldName, `sections.body#${KEY_B}`);
  assert.equal(session.unsaved, true);
  const viewer = createAccess({ stored: STORED, canUpdate: false });
  await assert.rejects(
    viewer.access.checkField({ ...base, field: 'sections.1.body', fieldKey: KEY_B, allowUnsavedKey: true }),
    { name: 'NotFoundError' }
  );
});

/* ------------------------------------------------------- legacy mapping */

/** Query engine stand-in with the operators the services use. */
const fakeDb = () => {
  const rows = [];
  let nextId = 1;
  const test1 = (value, condition) => {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if ('$in' in condition) return condition.$in.includes(value);
      return Object.entries(condition).every(([op, arg]) => {
        if (op === '$startsWith') return String(value).startsWith(arg);
        if (op === '$notContains') return !String(value).includes(arg);
        throw new Error(`operator ${op}`);
      });
    }
    return (value ?? null) === (condition ?? null);
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, condition]) => {
      if (key === '$or') return condition.some((part) => matches(row, part));
      return test1(row[key], condition);
    });
  const api = {
    rows,
    async findMany({ where, limit, offset = 0 }) {
      const list = rows
        .filter((row) => matches(row, where))
        .sort((a, b) => b.version - a.version || b.id - a.id);
      return list.slice(offset, limit ? offset + limit : undefined).map((row) => ({ ...row }));
    },
    async findOne({ where }) {
      return rows.find((row) => matches(row, where)) || null;
    },
    async count({ where }) {
      return rows.filter((row) => matches(row, where)).length;
    },
    async create({ data }) {
      const row = { id: nextId, documentId: `r${nextId}`, createdAt: `2026-11-1${nextId % 9}`, ...data };
      nextId += 1;
      rows.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows.find((item) => matches(item, where));
      Object.assign(row, data);
      return { ...row };
    },
    async updateMany({ where, data }) {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    },
    async deleteMany({ where }) {
      for (const row of rows.filter((item) => matches(item, where))) rows.splice(rows.indexOf(row), 1);
    },
  };
  return api;
};

const ENTRIES = [
  { path: 'sections.0.body', fieldKey: KEY_A, blockIds: new Set(['aaaaaaaaaa']) },
  { path: 'sections.1.body', fieldKey: null, blockIds: new Set(['bbbbbbbbbb']) },
  { path: 'sections.2.body', fieldKey: KEY_C, blockIds: new Set(['cccccccccc', 'shared0000']) },
  { path: 'sections.3.body', fieldKey: KEY_B, blockIds: new Set(['shared0000']) },
];

test('history: versions saved by position move to the one entry they belong to', async () => {
  const db = fakeDb();
  const strapi = {
    db: { query: () => db },
    config: { get: () => undefined },
    plugin: () => ({ service: () => ({ acquire: async () => true, release: async () => true }) }),
  };
  const history = historyService({ strapi });
  const legacy = (field, ids, version) =>
    db.create({
      data: {
        roomId: `api::article.article|doc1|en|${field}`,
        contentType: 'api::article.article',
        entryId: 'doc1',
        entryLocale: 'en',
        fieldName: field,
        version,
        trigger: 'manual',
        jsonContent: doc(ids),
      },
    });
  await legacy('sections.1.body', ['aaaaaaaaaa'], 1); // entry A moved: belongs to A
  await legacy('sections.0.body', ['bbbbbbbbbb'], 1); // entry without a key: proven, not moved
  await legacy('sections.2.body', ['shared0000'], 1); // two entries: ambiguous
  await legacy('sections.4.body', ['gone000000'], 1); // removed entry: unmapped
  await legacy('zone.0.body', ['aaaaaaaaaa'], 1); // other attribute: untouched
  await legacy('body', ['aaaaaaaaaa'], 1); // top level: untouched
  const target = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', basePath: 'sections.body' };
  const result = await history.adoptLegacy(target, ENTRIES);
  assert.equal(result.mapped, 1);
  const moved = db.rows.find((row) => row.id === 1);
  assert.equal(moved.fieldName, `sections.body#${KEY_A}`);
  assert.equal(moved.roomId, `api::article.article|doc1|en|sections.body#${KEY_A}`);
  assert.deepEqual([...result.byPath.keys()], ['sections.1.body']);
  assert.equal(result.byPath.get('sections.1.body')[0].positional, true);
  assert.deepEqual(
    result.unmapped.map((row) => [row.positional, row.restorable]),
    [
      [true, false],
      [true, false],
    ]
  );
  assert.equal(db.rows.length, 6, 'nothing is deleted');
  assert.equal(db.rows.find((row) => row.id === 5).fieldName, 'zone.0.body');
  const list = await history.list({
    uid: 'api::article.article',
    documentId: 'doc1',
    locale: 'en',
    field: `sections.body#${KEY_A}`,
  });
  assert.equal(list.length, 1, 'the entry lists its mapped version');
  assert.equal((await history.adoptLegacy(target, ENTRIES)).mapped, 0, 'mapped once');

  // New versions of an entry never include another entry's, and carry no key in the content.
  await history.create(
    { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: `sections.body#${KEY_C}` },
    doc(['cccccccccc'], { fieldKey: KEY_C })
  );
  const own = db.rows.find((row) => row.fieldName === `sections.body#${KEY_C}`);
  assert.equal('fieldKey' in own.jsonContent, false);
  const { target: rowTarget } = await history.findOne(own.documentId);
  assert.deepEqual(rowTarget, {
    uid: 'api::article.article',
    documentId: 'doc1',
    locale: 'en',
    field: 'sections.body',
    fieldKey: KEY_C,
    legacy: false,
  });
  assert.equal((await history.findOne('r4')).target.legacy, true);
});

test('comments: threads saved by position follow their block, with their replies', async () => {
  const db = fakeDb();
  const strapi = {
    db: { query: () => db },
    config: { get: () => undefined },
    plugin: () => ({ service: () => ({}) }),
  };
  const comments = commentsService({ strapi });
  const row = (field, blockId, threadId = null) =>
    db.create({
      data: {
        contentType: 'api::article.article',
        entryId: 'doc1',
        entryLocale: 'en',
        fieldName: field,
        blockId,
        threadId,
        body: 'Synthetic note',
        authorId: 1,
        authorName: 'Anna',
        resolved: false,
      },
    });
  const root = await row('sections.0.body', 'cccccccccc');
  await row('sections.0.body', 'cccccccccc', root.documentId);
  await row('sections.1.body', 'shared0000');
  await row('sections.1.body', 'bbbbbbbbbb');
  const target = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', basePath: 'sections.body' };
  const result = await comments.adoptLegacy(target, ENTRIES, 1);
  assert.equal(result.mapped, 1);
  assert.deepEqual(
    db.rows.slice(0, 2).map((item) => item.fieldName),
    [`sections.body#${KEY_C}`, `sections.body#${KEY_C}`]
  );
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0].positional, true);
  assert.equal(result.byPath.get('sections.1.body').length, 1);
  const found = await comments.findTarget(root.documentId);
  assert.equal(found.target.fieldKey, KEY_C);
  assert.equal(found.target.legacy, false);
  assert.equal((await comments.findTarget('r3')).target.legacy, true);
});

/* ------------------------------------------------------------- rooms, admin */

test('room keys parse back to the identity', () => {
  assert.deepEqual(targetOfRoom(`api::article.article|doc1|en|sections.body#${KEY_A}`), {
    uid: 'api::article.article',
    documentId: 'doc1',
    locale: 'en',
    field: 'sections.body',
    fieldKey: KEY_A,
    fieldName: `sections.body#${KEY_A}`,
  });
  assert.equal(targetOfRoom('api::article.article|doc1|-|sections.0.body').field, 'sections.0.body');
  assert.equal(targetOfRoom('api::article.article|doc1|-|sections.body#bad'), null);
});

test('admin: saved keys come from the loaded form values; targets carry the key', () => {
  const initialValues = {
    sections: [{ body: doc(['a'], { fieldKey: KEY_A }) }, { body: null }, { body: doc(['b']) }],
    zone: [{ __component: 'blocks.group', items: [{ body: doc(['g'], { fieldKey: KEY_B }) }] }],
  };
  assert.deepEqual([...fieldKeysAt(initialValues, 'sections.2.body')], [KEY_A]);
  assert.deepEqual([...fieldKeysAt(initialValues, 'zone.0.items.0.body')], [KEY_B]);
  assert.equal(fieldKeysAt(undefined, 'sections.0.body').size, 0);
  const target = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'sections.1.body' };
  assert.deepEqual(identityTarget(target, KEY_A), { ...target, fieldKey: KEY_A });
  assert.deepEqual(identityTarget(target, null), target);
  assert.deepEqual(identityTarget({ ...target, field: 'body' }, KEY_A), { ...target, field: 'body' });
});

/* ------------------------------------------------------------ controllers */

test('controllers: keyless positional fields refuse writes, unmapped rows are read-only', async () => {
  const historyController = require('../server/src/controllers/history.js');
  const commentsController = require('../server/src/controllers/comments.js');
  const db = fakeDb();
  const services = {};
  const strapi = {
    db: { query: () => db },
    config: { get: () => undefined },
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = { acquire: async () => true, release: async () => true, hit: async () => ({ count: 1 }) };
  services.history = historyService({ strapi });
  services.comments = commentsService({ strapi });
  // 2.4 mentions and notifications are covered by tests/comment-mentions.test.mjs.
  services['comment-notifications'] = {
    resolveMentions: async () => ({ ids: [], dropped: 0 }),
    notify: async () => ({ mentions: 0, replies: 0 }),
    forField: async () => [],
    pruneMentions: async () => {},
    mentionMapper: async () => () => [],
    removeForComments: async () => {},
    readAll: async () => 0,
  };
  const checked = [];
  services.access = {
    checkField: async (input) => {
      checked.push(input);
      const positional =
        /\.\d+\.|#/.test(input.field) || Boolean(input.fieldKey) || input.field === 'sections.body';
      const keyed = Boolean(input.fieldKey);
      return {
        canRead: true,
        canUpdate: true,
        locale: 'en',
        positional,
        basePath: 'sections.body',
        fieldName: positional ? (keyed ? `sections.body#${input.fieldKey}` : null) : input.field,
        fieldKey: input.fieldKey || null,
        entries: [{ path: 'sections.0.body', fieldKey: null, blockIds: new Set(['proven0001']) }],
      };
    },
  };
  const ctx = (extra) => ({
    query: {},
    params: {},
    request: { body: {} },
    state: { userAbility: { can: () => true }, user: { id: 1, firstname: 'Anna' } },
    status: 200,
    body: undefined,
    conflict(message, details) {
      this.status = 409;
      this.body = { error: { message, details } };
    },
    forbidden() {
      this.status = 403;
    },
    ...extra,
  });
  const base = { uid: 'api::article.article', documentId: 'doc1', locale: 'en' };

  const create = ctx({ request: { body: { ...base, field: 'sections.0.body', content: doc(['x']) } } });
  await historyController({ strapi }).create(create);
  assert.equal(create.status, 409);
  assert.equal(create.body.error.details.code, 'FIELD_KEY_REQUIRED');
  const comment = ctx({
    request: { body: { ...base, field: 'sections.0.body', blockId: 'proven0001', body: 'x' } },
  });
  await commentsController({ strapi }).create(comment);
  assert.equal(comment.status, 409);

  // A keyless entry lists only proven rows and cannot create anything.
  await db.create({
    data: {
      roomId: 'r',
      contentType: base.uid,
      entryId: 'doc1',
      entryLocale: 'en',
      fieldName: 'sections.3.body',
      version: 1,
      trigger: 'manual',
      jsonContent: doc(['proven0001']),
    },
  });
  await db.create({
    data: {
      roomId: 'r',
      contentType: base.uid,
      entryId: 'doc1',
      entryLocale: 'en',
      fieldName: 'sections.2.body',
      version: 1,
      trigger: 'manual',
      jsonContent: doc(['unknown001']),
    },
  });
  const list = ctx({ query: { ...base, field: 'sections.0.body' } });
  await historyController({ strapi }).list(list);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.meta.canCreate, false);
  assert.equal(list.body.meta.positionalVersions, undefined, 'no unmapped group without a key');

  // Rename of an unmapped legacy version: 409.
  const legacyId = db.rows.find((row) => row.fieldName === 'sections.2.body').documentId;
  const rename = ctx({ params: { id: legacyId }, request: { body: { label: 'x' } } });
  await historyController({ strapi }).rename(rename);
  assert.equal(rename.status, 409);
  assert.equal(rename.body.error.details.code, 'POSITIONAL_READ_ONLY');
  assert.deepEqual(checked.at(-1), {
    ...base,
    field: 'sections.2.body',
    userAbility: rename.state.userAbility,
  });

  // Replies to an unmapped legacy thread: 409; nothing is written.
  const thread = await db.create({
    data: {
      contentType: base.uid,
      entryId: 'doc1',
      entryLocale: 'en',
      fieldName: 'sections.4.body',
      blockId: 'unknown002',
      body: 'Old',
      resolved: false,
    },
  });
  const before = db.rows.length;
  const reply = ctx({ params: { id: thread.documentId }, request: { body: { body: 'New' } } });
  await commentsController({ strapi }).reply(reply);
  assert.equal(reply.status, 409);
  assert.equal(db.rows.length, before);
});

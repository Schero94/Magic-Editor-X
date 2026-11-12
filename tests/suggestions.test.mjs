import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MAX_SUGGESTION_NOTE_LENGTH,
  applySuggestions,
  blockHash,
  normalizeSuggestionNote,
  openSuggestionsByBlock,
  pendingInsertsOf,
  resolveAnchor,
  suggestionState,
  suggestionsFromDiff,
} from '../shared/suggestions.mjs';

const require = createRequire(import.meta.url);
const suggestionsService = require('../server/src/services/suggestions.js');
const suggestionsController = require('../server/src/controllers/suggestions.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS, ACTION_DEFINITIONS } = require('../server/src/permissions.js');
const contentTypes = require('../server/src/content-types/index.js');
const config = require('../server/src/config/index.js');
const { errors } = require('@strapi/utils');

const p = (id, text, extra = {}) => ({ id, type: 'paragraph', data: { text }, ...extra });
const h = (id, text, level = 2) => ({ id, type: 'header', data: { text, level } });
const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });

/* ------------------------------------------------------------------ pure */

test('block hashes ignore the id and key order and change with content and tunes', () => {
  const a = blockHash({ id: 'x1', type: 'paragraph', data: { text: 'Hi', extra: 1 } });
  const b = blockHash({ type: 'paragraph', id: 'other', data: { extra: 1, text: 'Hi' } });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{14}$/);
  assert.notEqual(a, blockHash({ id: 'x1', type: 'paragraph', data: { text: 'Hi!', extra: 1 } }));
  assert.notEqual(
    a,
    blockHash({
      id: 'x1',
      type: 'paragraph',
      data: { text: 'Hi', extra: 1 },
      tunes: { alignmentTune: { alignment: 'center' } },
    })
  );
  assert.equal(blockHash(null), null);
  // The editor writes default tunes and unset data leaves that stored content does not have.
  const stored = { id: 'x1', type: 'image', data: { file: { url: '/a.png' }, caption: 'C' } };
  const saved = {
    ...stored,
    data: { ...stored.data, withBorder: false, stretched: false, alt: '' },
    tunes: { alignmentTune: { alignment: 'left' }, textVariant: '', indentTune: { indentLevel: 0 } },
  };
  assert.equal(blockHash(stored), blockHash(saved));
  assert.notEqual(blockHash(stored), blockHash({ ...saved, data: { ...saved.data, withBorder: true } }));
  assert.notEqual(blockHash(stored), blockHash({ ...saved, tunes: { indentTune: { indentLevel: 1 } } }));
});

test('the diff of an edited copy becomes one suggestion per changed, inserted or deleted block', () => {
  const base = doc([h('h1', 'Title'), p('p1', 'One two three'), p('p2', 'Delete me'), p('p3', 'Last')]);
  const edited = doc([
    p('n0', 'A new first paragraph'),
    h('h1', 'Title'),
    p('p1', 'One two four'),
    p('n1', 'Inserted after p1'),
    p('n2', 'Inserted after n1'),
    p('p3', 'Last'),
  ]);
  const { suggestions, moved } = suggestionsFromDiff(base, edited);
  assert.equal(moved, 0);
  const byBlock = Object.fromEntries(suggestions.map((s) => [`${s.op}:${s.blockId}`, s]));
  assert.deepEqual(Object.keys(byBlock).sort(), [
    'delete:p2',
    'insert:n0',
    'insert:n1',
    'insert:n2',
    'update:p1',
  ]);
  assert.equal(byBlock['insert:n0'].afterBlockId, null);
  assert.equal(byBlock['insert:n1'].afterBlockId, 'p1');
  assert.equal(byBlock['insert:n2'].afterBlockId, 'n1');
  assert.deepEqual(byBlock['update:p1'].proposed, p('p1', 'One two four'));
  assert.equal(byBlock['update:p1'].baseHash, blockHash(p('p1', 'One two three')));
  assert.equal(byBlock['delete:p2'].baseHash, blockHash(p('p2', 'Delete me')));
  assert.equal(byBlock['delete:p2'].proposed, undefined);
});

test('reorders are not suggested; a block paired by similarity updates the base block', () => {
  const base = doc([p('a', 'Alpha block text here'), p('b', 'Beta block text here')]);
  const reordered = doc([p('b', 'Beta block text here'), p('a', 'Alpha block text here')]);
  const result = suggestionsFromDiff(base, reordered);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.moved, 1);
  // Retyped block with a new id (deleted and written again), similar words, same type.
  const retyped = doc([p('zz', 'Alpha block text there'), p('b', 'Beta block text here')]);
  const paired = suggestionsFromDiff(base, retyped).suggestions;
  assert.equal(paired.length, 1);
  assert.equal(paired[0].op, 'update');
  assert.equal(paired[0].blockId, 'a');
  assert.equal(paired[0].proposed.id, 'a');
  // A moved and edited block is one update.
  const movedEdited = doc([p('b', 'Beta block text here'), p('a', 'Alpha block text changed')]);
  const both = suggestionsFromDiff(base, movedEdited);
  assert.deepEqual(
    both.suggestions.map((s) => `${s.op}:${s.blockId}`),
    ['update:a']
  );
});

test('suggestion state: open, outdated, applied and missing against the live content', () => {
  const base = p('p1', 'Original');
  const update = { op: 'update', blockId: 'p1', proposed: p('p1', 'Proposed'), baseHash: blockHash(base) };
  assert.equal(suggestionState(update, doc([base])), 'open');
  assert.equal(suggestionState(update, doc([p('p1', 'Changed by someone')])), 'outdated');
  assert.equal(suggestionState(update, doc([p('p1', 'Proposed')])), 'applied');
  assert.equal(suggestionState(update, doc([p('p9', 'Other')])), 'missing');
  const del = { op: 'delete', blockId: 'p1', baseHash: blockHash(base) };
  assert.equal(suggestionState(del, doc([base])), 'open');
  assert.equal(suggestionState(del, doc([p('p1', 'Edited')])), 'outdated');
  assert.equal(suggestionState(del, doc([])), 'missing');
  const insert = { op: 'insert', blockId: 'n1', afterBlockId: 'p1', proposed: p('n1', 'New') };
  assert.equal(suggestionState(insert, doc([base])), 'open');
  assert.equal(suggestionState(insert, doc([p('p2', 'x')])), 'outdated');
  assert.equal(suggestionState(insert, doc([base, p('n1', 'New')])), 'applied');
  // Anchored on another open insert whose anchor exists: not outdated.
  const chained = { op: 'insert', blockId: 'n2', afterBlockId: 'n1', proposed: p('n2', 'Next') };
  const pending = pendingInsertsOf([insert, chained]);
  assert.equal(suggestionState(chained, doc([base]), { pendingInserts: pending }), 'open');
  assert.equal(suggestionState(chained, doc([base])), 'outdated');
  // A custom hash (the admin hashes normalised blocks): differences it normalises away do not count.
  const trimmed = (block) => blockHash({ ...block, data: { text: String(block.data.text).trim() } });
  assert.equal(suggestionState(update, doc([p('p1', ' Original ')]), { hash: trimmed }), 'open');
  assert.equal(suggestionState(update, doc([p('p1', ' Original ')])), 'outdated');
});

test('applying suggestions: update keeps the id, inserts follow their chain, deletes, skips', () => {
  const current = doc([h('h1', 'Title'), p('p1', 'One'), p('p2', 'Two')]);
  const list = [
    {
      id: 's1',
      op: 'update',
      blockId: 'p1',
      proposed: { id: 'evil', type: 'paragraph', data: { text: 'Uno' } },
    },
    { id: 's2', op: 'insert', blockId: 'n2', afterBlockId: 'n1', proposed: p('n2', 'After n1') },
    { id: 's3', op: 'delete', blockId: 'p2' },
    { id: 's4', op: 'update', blockId: 'gone', proposed: p('gone', 'x') },
    { id: 's5', op: 'insert', blockId: 'n0', afterBlockId: null, proposed: p('n0', 'At start') },
  ];
  // n1 is another open insert after p1 that is not accepted: n2 goes after p1.
  const pendingInserts = new Map([
    ['n1', 'p1'],
    ['n2', 'n1'],
  ]);
  const { data, applied, skipped } = applySuggestions(current, list, { pendingInserts });
  assert.deepEqual(
    data.blocks.map((block) => `${block.id}:${block.data.text}`),
    ['n0:At start', 'h1:Title', 'p1:Uno', 'n2:After n1']
  );
  assert.deepEqual(applied, ['s1', 's2', 's3', 's5']);
  assert.deepEqual(skipped, ['s4']);
  assert.equal(current.blocks.length, 3, 'the input is not changed');
  // Inserting an id that exists is skipped (accepted twice).
  const again = applySuggestions(data, [list[1]]);
  assert.deepEqual(again.skipped, ['s2']);
  // Anchor gone and not pending: at the end.
  const orphan = applySuggestions(doc([p('a', 'A')]), [
    { op: 'insert', blockId: 'n9', afterBlockId: 'zz', proposed: p('n9', 'Orphan') },
  ]);
  assert.deepEqual(
    orphan.data.blocks.map((block) => block.id),
    ['a', 'n9']
  );
  assert.deepEqual(resolveAnchor('x', [], new Map([['x', 'x']])), { found: false, index: -1 });
});

test('open suggestions per block for the markers', () => {
  const list = [
    { op: 'update', blockId: 'p1', status: 'open' },
    { op: 'delete', blockId: 'p1', status: 'open' },
    { op: 'insert', blockId: 'n1', afterBlockId: 'p2', status: 'open' },
    { op: 'insert', blockId: 'n2', afterBlockId: 'n1', status: 'open' },
    { op: 'insert', blockId: 'n0', afterBlockId: null, status: 'open' },
    { op: 'update', blockId: 'gone', status: 'open' },
    { op: 'update', blockId: 'p2', status: 'accepted' },
  ];
  const counts = openSuggestionsByBlock(list, ['p1', 'p2']);
  assert.deepEqual(Object.fromEntries(counts), { p1: 3, p2: 2 });
});

test('notes are plain bounded text', () => {
  assert.equal(normalizeSuggestionNote('  Please‮ check\u0000 '), 'Please check');
  assert.equal(normalizeSuggestionNote('   '), null);
  assert.equal(normalizeSuggestionNote(5), null);
  assert.equal(normalizeSuggestionNote('x'.repeat(5000)).length, MAX_SUGGESTION_NOTE_LENGTH);
});

/* -------------------------------------------- routes, permissions, schema */

test('routes, actions, content type and config', () => {
  const byHandler = Object.fromEntries(
    routes.admin.routes
      .filter((route) => route.handler.startsWith('suggestions.'))
      .map((route) => [route.handler, route])
  );
  const actionsOf = (handler) => byHandler[handler].config.policies[1].config.actions;
  assert.deepEqual(actionsOf('suggestions.list'), [ACTIONS.access]);
  assert.deepEqual(actionsOf('suggestions.create'), [ACTIONS.access, ACTIONS.suggestionsCreate]);
  assert.deepEqual(actionsOf('suggestions.accept'), [ACTIONS.access, ACTIONS.suggestionsReview]);
  assert.deepEqual(actionsOf('suggestions.reject'), [ACTIONS.access, ACTIONS.suggestionsReview]);
  assert.deepEqual(actionsOf('suggestions.withdraw'), [ACTIONS.access, ACTIONS.suggestionsCreate]);
  for (const route of Object.values(byHandler))
    assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
  const uids = ACTION_DEFINITIONS.map((action) => action.uid);
  assert.ok(uids.includes('suggestions.create') && uids.includes('suggestions.review'));
  const schema = contentTypes.suggestion.schema;
  assert.equal(schema.collectionName, 'magic_editor_suggestions');
  assert.equal(schema.pluginOptions['content-manager'].visible, false);
  assert.equal(schema.pluginOptions['content-type-builder'].visible, false);
  assert.deepEqual(schema.attributes.status.enum, ['open', 'accepted', 'rejected']);
  config.validator({ ...config.default });
  assert.deepEqual(config.default.suggestions, { enabled: true, perMinute: 20 });
  assert.throws(() => config.validator({ ...config.default, suggestions: { enabled: 1, perMinute: 20 } }));
  assert.throws(() => config.validator({ ...config.default, suggestions: { enabled: true, perMinute: 0 } }));
});

/* --------------------------------------------- service + controller (fake) */

/** Minimal in-memory stand-in for strapi.db.query (equality, null, $in, $or). */
const createFakeDb = () => {
  let nextId = 1;
  let rows = [];
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, condition]) => {
      if (key === '$or') return condition.some((part) => matches(row, part));
      const value = row[key] ?? null;
      if (condition && typeof condition === 'object' && '$in' in condition)
        return condition.$in.includes(value);
      return value === (condition ?? null);
    });
  const api = {
    async findOne({ where }) {
      const row = rows.find((item) => matches(item, where));
      return row ? structuredClone(row) : null;
    },
    async findMany({ where, limit }) {
      return rows
        .filter((row) => matches(row, where))
        .slice(0, limit || undefined)
        .map((row) => structuredClone(row));
    },
    async count({ where }) {
      return rows.filter((row) => matches(row, where)).length;
    },
    async create({ data }) {
      const now = new Date(Date.now() + nextId).toISOString();
      const row = {
        id: nextId,
        documentId: `s${nextId}`,
        createdAt: now,
        updatedAt: now,
        ...structuredClone(data),
      };
      nextId += 1;
      rows.push(row);
      return structuredClone(row);
    },
    async update({ where, data }) {
      const row = rows.find((item) => matches(item, where));
      Object.assign(row, structuredClone(data), { updatedAt: new Date().toISOString() });
      return structuredClone(row);
    },
    async updateMany({ where, data }) {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    },
    async deleteMany({ where }) {
      const before = rows.length;
      rows = rows.filter((row) => !matches(row, where));
      return { count: before - rows.length };
    },
  };
  return { api, all: () => rows };
};

const EDITOR_FIELD = { type: 'customField', customField: 'plugin::magic-editor-x.richtext' };

const createFixture = ({ readable = ['doc1'], updatable = ['doc1'], conf = {}, fieldName } = {}) => {
  const db = createFakeDb();
  const counters = new Map();
  const services = {};
  const audits = [];
  const contentType = {
    uid: 'api::article.article',
    attributes: {
      body: EDITOR_FIELD,
      summary: { ...EDITOR_FIELD, options: { preset: 'minimal', requireAlt: true } },
    },
  };
  const strapi = {
    config: { get: (key) => conf[key.replace('plugin::magic-editor-x.', '')] },
    db: { query: () => db.api },
    components: {},
    contentType: (uid) => (uid === contentType.uid ? contentType : undefined),
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = {
    async hit(key) {
      counters.set(key, (counters.get(key) || 0) + 1);
      return { count: counters.get(key) };
    },
  };
  services.audit = {
    async record(input) {
      audits.push(input);
      return true;
    },
  };
  services.access = {
    async checkField({ documentId, locale, field }) {
      if (!readable.includes(documentId)) throw new errors.NotFoundError('Not found');
      return {
        canRead: true,
        canUpdate: updatable.includes(documentId),
        locale: locale || 'en',
        fieldName: fieldName === undefined ? field : fieldName,
        fieldKey: null,
        positional: false,
      };
    },
  };
  services.suggestions = suggestionsService({ strapi });
  const controller = suggestionsController({ strapi });
  const users = {
    anna: { id: 1, firstname: 'Anna', lastname: 'Beispiel' },
    cora: { id: 3, firstname: 'Cora', lastname: 'Prüfer' },
    dana: { id: 4, firstname: 'Dana', lastname: 'Leserin' },
  };
  const grants = {
    anna: [ACTIONS.suggestionsCreate, ACTIONS.suggestionsReview],
    cora: [ACTIONS.suggestionsCreate],
    dana: [],
  };
  const call = async (who, handler, { query = {}, params = {}, body } = {}) => {
    const ctx = {
      query,
      params,
      request: { body },
      state: { user: users[who], userAbility: { can: (action) => grants[who].includes(action) } },
      status: 200,
      body: null,
      conflict(message, details) {
        this.status = 409;
        this.body = { error: { message, details } };
      },
    };
    try {
      await controller[handler](ctx);
    } catch (error) {
      ctx.status =
        error.name === 'NotFoundError'
          ? 404
          : error.name === 'ForbiddenError'
            ? 403
            : error.name === 'RateLimitError'
              ? 429
              : 400;
      ctx.body = { error: { name: error.name, message: error.message, details: error.details } };
    }
    return ctx;
  };
  return { db, call, services, audits };
};

const TARGET = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' };
const BASE = p('p1', 'Original text');

test('a reviewer suggests; hostile proposed data is stored inert; ids are never returned', async () => {
  const { call, db, audits } = createFixture();
  const created = await call('cora', 'create', {
    body: {
      ...TARGET,
      note: ' Please‮ check ',
      suggestions: [
        {
          op: 'update',
          blockId: 'p1',
          baseHash: blockHash(BASE),
          proposed: {
            id: 'whatever',
            type: 'paragraph',
            data: {
              text: 'Safe <img src=x onerror="alert(1)"><a href="javascript:alert(2)">link</a><script>alert(3)</script>',
            },
          },
        },
        {
          op: 'insert',
          blockId: 'n1',
          afterBlockId: 'p1',
          proposed: {
            type: 'raw',
            data: { html: '<div onclick="steal()">x</div><script>alert(4)</script>' },
          },
        },
        { op: 'delete', blockId: 'p2', baseHash: blockHash(p('p2', 'x')) },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.meta, { created: 3, updated: 0 });
  const stored = JSON.stringify(db.all());
  assert.doesNotMatch(stored, /onerror|javascript:|<script|onclick/i);
  const update = created.body.data.find((s) => s.op === 'update');
  assert.equal(update.proposed.id, 'p1', 'the proposed block keeps the target id');
  assert.match(update.proposed.data.text, /^Safe /);
  assert.equal(update.note, 'Please check');
  assert.equal(update.author.own, true);
  assert.equal(update.author.name, 'Cora Prüfer');
  assert.equal(update.status, 'open');
  const del = created.body.data.find((s) => s.op === 'delete');
  assert.equal(del.proposed, null);
  assert.doesNotMatch(JSON.stringify(created.body), /authorId|decidedById/);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].event, 'suggestion.create');
  assert.deepEqual(audits[0].counts, {
    suggestions: 3,
    created: 3,
    updated: 0,
    updates: 1,
    inserts: 1,
    deletes: 1,
  });
  assert.doesNotMatch(JSON.stringify(audits), /Safe|Please/);

  // Sending again replaces the author's own open suggestion for the same block.
  const again = await call('cora', 'create', {
    body: {
      ...TARGET,
      suggestions: [
        { op: 'update', blockId: 'p1', baseHash: blockHash(BASE), proposed: p('p1', 'Second try') },
      ],
    },
  });
  assert.equal(again.status, 201);
  assert.deepEqual(again.body.meta, { created: 0, updated: 1 });
  assert.equal(db.all().length, 3);

  const listed = await call('cora', 'list', { query: { ...TARGET } });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 3);
  assert.deepEqual(listed.body.meta.counts, { open: 3, accepted: 0, rejected: 0 });
  assert.equal(listed.body.meta.canCreate, true);
  assert.equal(listed.body.meta.canReview, false);
});

test('field preset: blocks the field does not allow are refused; strict schemas', async () => {
  const { call, db } = createFixture();
  const summary = { ...TARGET, field: 'summary' };
  const header = await call('cora', 'create', {
    body: {
      ...summary,
      suggestions: [{ op: 'insert', blockId: 'n1', afterBlockId: null, proposed: h('x', 'Title') }],
    },
  });
  assert.equal(header.status, 400);
  assert.equal(header.body.error.details.code, 'PRESET_VIOLATION');
  assert.deepEqual(header.body.error.details.blockIds, ['n1']);
  const image = await call('cora', 'create', {
    body: {
      ...summary,
      suggestions: [
        {
          op: 'insert',
          blockId: 'n2',
          afterBlockId: null,
          proposed: { type: 'image', data: { file: { url: '/uploads/a.png' }, caption: '' } },
        },
      ],
    },
  });
  assert.equal(image.status, 400);
  // Inline tags outside the preset are removed (minimal: bold, italic, link).
  const inline = await call('cora', 'create', {
    body: {
      ...summary,
      suggestions: [
        {
          op: 'insert',
          blockId: 'n3',
          afterBlockId: null,
          proposed: p('x', '<b>b</b> <u>u</u> <mark>m</mark>'),
        },
      ],
    },
  });
  assert.equal(inline.status, 201, JSON.stringify(inline.body));
  assert.equal(inline.body.data[0].proposed.data.text, '<b>b</b> u m');
  assert.equal(db.all().length, 1);

  for (const body of [
    { ...TARGET, suggestions: [] },
    { ...TARGET, suggestions: [{ op: 'update', blockId: 'p1', proposed: p('p1', 'x') }] },
    { ...TARGET, suggestions: [{ op: 'update', blockId: 'p1', baseHash: 'nothex', proposed: p('p1', 'x') }] },
    { ...TARGET, suggestions: [{ op: 'move', blockId: 'p1' }] },
    { ...TARGET, suggestions: [{ op: 'delete', blockId: 'bad id!', baseHash: blockHash(BASE) }] },
    { ...TARGET, suggestions: [{ op: 'delete', blockId: 'p1', baseHash: blockHash(BASE), extra: 1 }] },
    { ...TARGET, extra: true, suggestions: [{ op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) }] },
    {
      ...TARGET,
      suggestions: [
        { op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) },
        { op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) },
      ],
    },
    {
      ...TARGET,
      suggestions: [
        { op: 'insert', blockId: 'n1', afterBlockId: null, proposed: p('n1', 'x'.repeat(70000)) },
      ],
    },
    {
      ...TARGET,
      suggestions: Array.from({ length: 51 }, (_, i) => ({
        op: 'delete',
        blockId: `b${i}`,
        baseHash: blockHash(BASE),
      })),
    },
  ]) {
    const response = await call('cora', 'create', { body });
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 200));
  }
  assert.equal(db.all().length, 1);
});

test('RBAC: listing needs an action, review needs the action and update access, 404 without read', async () => {
  const { call } = createFixture({ readable: ['doc1', 'doc2'], updatable: ['doc1'] });
  assert.equal((await call('dana', 'list', { query: TARGET })).status, 403);
  assert.equal((await call('cora', 'list', { query: { ...TARGET, documentId: 'nope' } })).status, 404);
  const other = { ...TARGET, documentId: 'doc2' };
  const created = await call('cora', 'create', {
    body: { ...other, suggestions: [{ op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) }] },
  });
  assert.equal(created.status, 201);
  const id = created.body.data[0].id;
  // Anna has suggestions.review but cannot update doc2.
  const listed = await call('anna', 'list', { query: other });
  assert.equal(listed.body.meta.canReview, false);
  assert.equal((await call('anna', 'accept', { params: { id }, body: {} })).status, 403);
  assert.equal((await call('anna', 'reject', { params: { id }, body: {} })).status, 403);
  // An id of a document the caller cannot read answers 404.
  const hidden = createFixture({ readable: [] });
  assert.equal((await hidden.call('anna', 'accept', { params: { id: 's1' }, body: {} })).status, 404);
  assert.equal((await call('anna', 'accept', { params: { id: 'BAD!' }, body: {} })).status, 400);
});

test('accept and reject once; withdraw own open suggestions only', async () => {
  const { call, audits } = createFixture();
  const created = await call('cora', 'create', {
    body: {
      ...TARGET,
      suggestions: [
        { op: 'update', blockId: 'p1', baseHash: blockHash(BASE), proposed: p('p1', 'New') },
        { op: 'delete', blockId: 'p2', baseHash: blockHash(BASE) },
        { op: 'insert', blockId: 'n1', afterBlockId: 'p1', proposed: p('n1', 'Added') },
      ],
    },
  });
  const [upd, del, ins] = created.body.data;
  const accepted = await call('anna', 'accept', { params: { id: upd.id }, body: { outdated: true } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.status, 'accepted');
  assert.equal(accepted.body.data.decidedBy.name, 'Anna Beispiel');
  assert.equal(accepted.body.data.proposed.data.text, 'New');
  const twice = await call('anna', 'reject', { params: { id: upd.id }, body: {} });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error.details.code, 'ALREADY_DECIDED');
  const rejected = await call('anna', 'reject', { params: { id: del.id }, body: {} });
  assert.equal(rejected.body.data.status, 'rejected');
  // Withdraw: not someone else's, not decided ones.
  assert.equal((await call('anna', 'withdraw', { params: { id: ins.id } })).status, 403);
  assert.equal((await call('cora', 'withdraw', { params: { id: upd.id } })).status, 409);
  const withdrawn = await call('cora', 'withdraw', { params: { id: ins.id } });
  assert.equal(withdrawn.status, 200);
  const listed = await call('anna', 'list', { query: { ...TARGET, status: 'all' } });
  assert.deepEqual(listed.body.meta.counts, { open: 0, accepted: 1, rejected: 1 });
  assert.equal(listed.body.meta.canReview, true);
  assert.deepEqual(
    audits.map((audit) => audit.event),
    ['suggestion.create', 'suggestion.accept', 'suggestion.reject', 'suggestion.withdraw']
  );
  assert.deepEqual(audits[1].counts, { outdated: 1 });
  assert.deepEqual(audits[1].blockIds, ['p1']);
});

test('decisions are conditional: a concurrent decision loses with 409', async () => {
  const { call, services } = createFixture();
  const created = await call('cora', 'create', {
    body: { ...TARGET, suggestions: [{ op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) }] },
  });
  const id = created.body.data[0].id;
  const { row } = await services.suggestions.findTarget(id);
  // Both reviewers loaded the row while it was open.
  const first = await services.suggestions.decide(row, 'accepted', { id: 1, firstname: 'A' });
  const second = await services.suggestions.decide(row, 'rejected', { id: 2, firstname: 'B' });
  assert.equal(first.status, 'accepted');
  assert.equal(second, null);
});

test('off switch, rate limit, positional field without a key, too many open suggestions', async () => {
  const off = createFixture({ conf: { 'suggestions.enabled': false } });
  assert.equal((await off.call('anna', 'list', { query: TARGET })).status, 404);
  const limited = createFixture({ conf: { 'suggestions.perMinute': 2 } });
  const send = (fixture, blockId) =>
    fixture.call('cora', 'create', {
      body: { ...TARGET, suggestions: [{ op: 'delete', blockId, baseHash: blockHash(BASE) }] },
    });
  assert.equal((await send(limited, 'a')).status, 201);
  assert.equal((await send(limited, 'b')).status, 201);
  assert.equal((await send(limited, 'c')).status, 429);
  const keyless = createFixture({ fieldName: null });
  const conflict = await send(keyless, 'a');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.details.code, 'FIELD_KEY_REQUIRED');
  const empty = await keyless.call('anna', 'list', { query: TARGET });
  assert.deepEqual(empty.body.data, []);
  assert.equal(empty.body.meta.canCreate, false);

  const full = createFixture({ conf: { 'suggestions.perMinute': 1000 } });
  for (let round = 0; round < 10; round += 1) {
    const batch = Array.from({ length: 50 }, (_, i) => ({
      op: 'delete',
      blockId: `b${round}x${i}`,
      baseHash: blockHash(BASE),
    }));
    const response = await full.call('cora', 'create', { body: { ...TARGET, suggestions: batch } });
    assert.equal(response.status, 201);
  }
  const over = await send(full, 'last');
  assert.equal(over.status, 400);
  assert.equal(over.body.error.details.code, 'TOO_MANY_SUGGESTIONS');
});

test('retention: deleted entries and deleted admins', async () => {
  const { call, db, services } = createFixture({ readable: ['doc1'] });
  await call('cora', 'create', {
    body: { ...TARGET, suggestions: [{ op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) }] },
  });
  await call('cora', 'create', {
    body: {
      ...TARGET,
      locale: 'de',
      suggestions: [{ op: 'delete', blockId: 'p1', baseHash: blockHash(BASE) }],
    },
  });
  const id = db.all()[0].documentId;
  await call('anna', 'accept', { params: { id }, body: {} });
  await services.suggestions.anonymizeUser(1);
  await services.suggestions.anonymizeUser(3);
  assert.ok(db.all().every((row) => row.authorId === null && row.authorName === null));
  assert.equal(db.all()[0].decidedById, null);
  assert.equal(db.all()[0].decidedByName, null);
  const removed = await services.suggestions.removeForEntries('api::article.article', 'doc1', ['en']);
  assert.equal(removed, 1);
  assert.equal(db.all().length, 1);
  assert.equal(db.all()[0].entryLocale, 'de');
});

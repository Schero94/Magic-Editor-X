import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MAX_COMMENT_LENGTH,
  normalizeCommentBody,
  normalizeExcerpt,
  blockExcerpt,
  groupThreads,
  arrangeThreads,
  openThreadsByBlock,
  countThreads,
} from '../shared/comments.mjs';

const require = createRequire(import.meta.url);
const commentsService = require('../server/src/services/comments.js');
const commentsController = require('../server/src/controllers/comments.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS, ACTION_DEFINITIONS } = require('../server/src/permissions.js');
const { deletedLocales } = require('../server/src/utils/comment-retention.js');
const contentTypes = require('../server/src/content-types/index.js');
const config = require('../server/src/config/index.js');

/* ------------------------------------------------------------------ pure */

test('comment bodies are plain text without control or bidi-override characters', () => {
  const nul = String.fromCharCode(0);
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  assert.equal(normalizeCommentBody(`  Hello${nul}\r\nworld${rlo}gnp.exe${zwsp}  `), 'Hello\nworldgnp.exe');
  assert.equal(normalizeCommentBody('a\n\n\n\n\nb'), 'a\n\nb');
  assert.equal(normalizeCommentBody('tab\there'), 'tab here');
  assert.equal(normalizeCommentBody('<b>not html</b>'), '<b>not html</b>');
  assert.equal(normalizeCommentBody('   '), '');
  assert.equal(normalizeCommentBody(42), '');
  assert.equal(normalizeCommentBody('x'.repeat(MAX_COMMENT_LENGTH + 500)).length, MAX_COMMENT_LENGTH);
  const start = performance.now();
  normalizeCommentBody(`${' '.repeat(50000)}\n`.repeat(4));
  assert.ok(performance.now() - start < 200, 'linear time on adversarial whitespace');
});

test('block excerpts are one bounded line of text', () => {
  assert.equal(normalizeExcerpt('  two\n lines  '), 'two lines');
  assert.equal(normalizeExcerpt(''), null);
  assert.equal(normalizeExcerpt('y'.repeat(500)).length, 200);
  assert.equal(
    blockExcerpt({
      type: 'paragraph',
      data: { text: 'Hello <b>bold</b> &amp; <a href="https://x.example.test">link</a>' },
    }),
    'Hello bold & link'
  );
  assert.equal(
    blockExcerpt({
      type: 'image',
      data: { file: { url: 'https://cdn.example.test/a.png' }, caption: 'A bike' },
    }),
    'A bike'
  );
  assert.equal(
    blockExcerpt({ type: 'list', data: { items: [{ content: 'one' }, { content: 'two' }] } }),
    'one two'
  );
  assert.equal(blockExcerpt(null), null);
  const start = performance.now();
  blockExcerpt({ type: 'paragraph', data: { text: '<'.repeat(100000) } });
  assert.ok(performance.now() - start < 200);
});

test('rows are grouped into threads; counts, order and detached threads', () => {
  const row = (id, extra) => ({
    id,
    threadId: null,
    blockId: 'b1',
    excerpt: 'Intro',
    body: id,
    author: { name: 'Anna', own: false, deleted: false },
    createdAt: `2026-01-01T00:00:0${id.length}Z`,
    updatedAt: `2026-01-01T00:00:0${id.length}Z`,
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    ...extra,
  });
  const threads = groupThreads([
    row('t1'),
    row('r1', { threadId: 't1', createdAt: '2026-01-01T00:01:00Z', updatedAt: '2026-01-01T00:01:00Z' }),
    row('t2', { blockId: 'gone', status: 'resolved' }),
    row('t3', { blockId: 'b2' }),
    row('orphan', { threadId: 'missing' }),
  ]);
  assert.equal(threads.length, 3);
  const t1 = threads.find((thread) => thread.id === 't1');
  assert.deepEqual(
    t1.comments.map((comment) => comment.id),
    ['t1', 'r1']
  );
  assert.equal(t1.updatedAt, '2026-01-01T00:01:00Z');
  assert.ok(!('blockId' in t1.comments[0]), 'thread fields are not repeated on comments');
  assert.deepEqual(countThreads(threads), { open: 2, resolved: 1, comments: 4 });
  assert.deepEqual(Array.from(openThreadsByBlock(threads)), [
    ['b1', 1],
    ['b2', 1],
  ]);
  const arranged = arrangeThreads(threads, ['b2', 'b1']);
  assert.deepEqual(
    arranged.map((thread) => [thread.id, thread.detached]),
    [
      ['t3', false],
      ['t1', false],
      ['t2', true],
    ]
  );
  assert.equal(
    arrangeThreads(threads, null).some((thread) => thread.detached),
    false,
    'unknown document: nothing detached'
  );
});

/* ------------------------------------------------------------- contract */

test('comment actions are registered and every comment route has its policies', () => {
  const uids = ACTION_DEFINITIONS.map((action) => action.uid);
  for (const uid of ['comments.read', 'comments.write', 'comments.moderate']) {
    assert.ok(uids.includes(uid), uid);
    assert.match(uid, /^[a-z]([a-z.-]+)[a-z]$/);
  }
  const commentRoutes = routes.admin.routes.filter((route) => route.path.startsWith('/comments'));
  assert.equal(commentRoutes.length, 7);
  for (const route of commentRoutes) {
    const [auth, perms] = route.config.policies;
    assert.equal(auth, 'admin::isAuthenticatedAdmin');
    assert.equal(perms.name, 'admin::hasPermissions');
    assert.ok(perms.config.actions.includes(ACTIONS.access), route.path);
    assert.ok(perms.config.actions.includes(ACTIONS.commentsRead), route.path);
    const writes = route.method !== 'GET' && route.method !== 'DELETE';
    assert.equal(
      perms.config.actions.includes(ACTIONS.commentsWrite),
      writes,
      `${route.method} ${route.path}`
    );
  }
  const schema = contentTypes.comment.schema;
  assert.equal(schema.pluginOptions['content-manager'].visible, false);
  assert.equal(schema.pluginOptions['content-type-builder'].visible, false);
  assert.equal(schema.options.draftAndPublish, false);
  config.validator({ ...config.default, comments: { enabled: true, perMinute: 30 } });
  assert.throws(() => config.validator({ ...config.default, comments: { enabled: 'yes', perMinute: 30 } }));
});

test('deleted entry locales are read from the Document Service result', () => {
  assert.deepEqual(deletedLocales({ entries: [{ locale: 'en' }, { locale: 'en' }, { locale: 'de' }] }), [
    'en',
    'de',
  ]);
  assert.deepEqual(deletedLocales({ entries: [{ id: 1 }] }), [null]);
  assert.deepEqual(deletedLocales(null), []);
});

/* --------------------------------------------- service + controller (fake) */

/** Minimal in-memory stand-in for strapi.db.query (equality, null, $in, $or). */
const createFakeDb = () => {
  let nextId = 1;
  let rows = [];
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, condition]) => {
      if (key === '$or') return condition.some((part) => matches(row, part));
      if (key === '$and') return condition.every((part) => matches(row, part));
      const value = row[key] ?? null;
      if (condition && typeof condition === 'object' && '$in' in condition)
        return condition.$in.includes(value);
      return value === (condition ?? null);
    });
  const api = {
    async findOne({ where }) {
      return rows.find((row) => matches(row, where)) || null;
    },
    async findMany({ where, limit }) {
      return rows.filter((row) => matches(row, where)).slice(0, limit || undefined);
    },
    async count({ where }) {
      return rows.filter((row) => matches(row, where)).length;
    },
    async create({ data }) {
      const now = new Date(Date.now() + nextId).toISOString();
      const row = { id: nextId, documentId: `c${nextId}`, createdAt: now, updatedAt: now, ...data };
      nextId += 1;
      rows.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows.find((item) => matches(item, where));
      Object.assign(row, data, { updatedAt: new Date().toISOString() });
      return { ...row };
    },
    async updateMany({ where, data }) {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    },
    async delete({ where }) {
      rows = rows.filter((row) => !matches(row, where));
    },
    async deleteMany({ where }) {
      const before = rows.length;
      rows = rows.filter((row) => !matches(row, where));
      return { count: before - rows.length };
    },
  };
  return { api, all: () => rows };
};

const { errors } = require('@strapi/utils');

const createFixture = ({ readable = ['doc1'] } = {}) => {
  const db = createFakeDb();
  const counters = new Map();
  const services = {};
  const strapi = {
    config: { get: () => undefined },
    db: { query: () => db.api },
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = {
    async hit(key) {
      counters.set(key, (counters.get(key) || 0) + 1);
      return { count: counters.get(key) };
    },
  };
  services.access = {
    async checkField({ documentId, locale }) {
      if (!readable.includes(documentId)) throw new errors.NotFoundError('Not found');
      return { canRead: true, canUpdate: false, locale: locale || 'en' };
    },
  };
  services.comments = commentsService({ strapi });
  const controller = commentsController({ strapi });
  const users = {
    anna: { id: 1, firstname: 'Anna', lastname: 'Beispiel' },
    cora: { id: 3, firstname: 'Cora', lastname: 'Prüfer' },
    mod: { id: 9, firstname: 'Review', lastname: 'Admin' },
  };
  const grants = {
    anna: [ACTIONS.commentsRead, ACTIONS.commentsWrite],
    cora: [ACTIONS.commentsRead, ACTIONS.commentsWrite],
    mod: [ACTIONS.commentsRead, ACTIONS.commentsWrite, ACTIONS.commentsModerate],
  };
  const call = async (who, handler, { query = {}, params = {}, body } = {}) => {
    const ctx = {
      query,
      params,
      request: { body },
      state: { user: users[who], userAbility: { can: (action) => grants[who].includes(action) } },
      status: 200,
      body: null,
    };
    await controller[handler](ctx);
    return ctx;
  };
  return { db, call, services };
};

const TARGET = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' };

test('threads: create, reply, edit own only, resolve and reopen', async () => {
  const { call, db } = createFixture();
  const created = await call('anna', 'create', {
    body: { ...TARGET, blockId: 'blk1', body: ' First note ', excerpt: 'Intro\nline' },
  });
  assert.equal(created.status, 201);
  const thread = created.body.data;
  assert.equal(thread.comments[0].body, 'First note');
  assert.equal(thread.excerpt, 'Intro line');
  assert.equal(thread.comments[0].author.own, true);
  assert.ok(!JSON.stringify(created.body).includes('"authorId"'), 'admin ids are never returned');

  const reply = await call('cora', 'reply', { params: { id: thread.id }, body: { body: 'Agreed' } });
  assert.equal(reply.status, 201);
  await assert.rejects(
    call('cora', 'reply', { params: { id: reply.body.data.id }, body: { body: 'nested' } }),
    (error) => error.name === 'ValidationError'
  );

  await assert.rejects(
    call('cora', 'update', { params: { id: thread.id }, body: { body: 'hijack' } }),
    (error) => error.name === 'ForbiddenError'
  );
  const edited = await call('anna', 'update', {
    params: { id: thread.id },
    body: { body: 'First note, edited' },
  });
  assert.equal(edited.body.data.body, 'First note, edited');
  assert.ok(edited.body.data.editedAt);

  const resolved = await call('cora', 'resolve', { params: { id: thread.id } });
  assert.equal(resolved.body.data.status, 'resolved');
  assert.equal(resolved.body.data.resolvedBy.name, 'Cora Prüfer');
  await call('anna', 'reply', { params: { id: thread.id }, body: { body: 'One more thing' } });
  const listed = await call('cora', 'list', { query: { ...TARGET } });
  assert.equal(listed.body.data[0].status, 'open', 'a reply reopens the thread');
  assert.deepEqual(listed.body.meta.counts, { open: 1, resolved: 0, comments: 3 });
  assert.deepEqual(
    listed.body.data[0].comments.map((comment) => comment.author.own),
    [false, true, false]
  );
  assert.equal(listed.body.meta.canWrite, true);
  assert.equal(listed.body.meta.canModerate, false);
  assert.equal(db.all().length, 3);
});

test('validation is strict and bounded; ids of unreadable documents answer 404', async () => {
  const { call } = createFixture({ readable: ['doc1'] });
  const bad = [
    { ...TARGET, blockId: 'blk1', body: 'x', authorId: 9 },
    { ...TARGET, blockId: 'bad id!', body: 'x' },
    { ...TARGET, blockId: 'blk1', body: '' },
    { ...TARGET, blockId: 'blk1', body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) },
    { ...TARGET, documentId: 'NOT valid', blockId: 'blk1', body: 'x' },
  ];
  for (const body of bad) {
    await assert.rejects(call('anna', 'create', { body }), (error) => error.name === 'ValidationError');
  }
  await assert.rejects(
    call('anna', 'create', { body: { ...TARGET, blockId: 'blk1', body: String.fromCharCode(1, 2) } }),
    (error) => error.name === 'ValidationError'
  );
  await assert.rejects(
    call('anna', 'create', { body: { ...TARGET, documentId: 'doc2', blockId: 'blk1', body: 'x' } }),
    (error) => error.name === 'NotFoundError'
  );
  await assert.rejects(
    call('anna', 'resolve', { params: { id: 'nope' } }),
    (error) => error.name === 'NotFoundError'
  );
});

test('comment ids of another document are not reachable without read access', async () => {
  const fixture = createFixture({ readable: ['doc1', 'doc2'] });
  const other = await fixture.call('mod', 'create', {
    body: { ...TARGET, documentId: 'doc2', blockId: 'blk1', body: 'secret' },
  });
  const restricted = createFixture({ readable: ['doc1'] });
  // Same database rows, but a caller that can only read doc1.
  restricted.services.comments = fixture.services.comments;
  const ctrl = commentsController({
    strapi: {
      config: { get: () => undefined },
      plugin: () => ({
        service: (name) => (name === 'access' ? restricted.services.access : fixture.services[name]),
      }),
    },
  });
  const ctx = {
    params: { id: other.body.data.id },
    request: { body: { body: 'peek' } },
    state: { user: { id: 1 }, userAbility: { can: () => true } },
  };
  for (const handler of ['reply', 'update', 'resolve', 'reopen', 'remove']) {
    await assert.rejects(ctrl[handler](ctx), (error) => error.name === 'NotFoundError', handler);
  }
});

test('deleting: own comments, threads with other replies, moderators', async () => {
  const { call, db } = createFixture();
  const make = async (who, blockId) =>
    (await call(who, 'create', { body: { ...TARGET, blockId, body: `${who} says` } })).body.data;
  const mine = await make('anna', 'b1');
  await assert.rejects(
    call('cora', 'remove', { params: { id: mine.id } }),
    (e) => e.name === 'ForbiddenError'
  );
  const reply = await call('cora', 'reply', { params: { id: mine.id }, body: { body: 'reply' } });
  await assert.rejects(
    call('anna', 'remove', { params: { id: mine.id } }),
    (e) => e.name === 'ForbiddenError',
    'a thread with replies by others needs a moderator'
  );
  const removedReply = await call('cora', 'remove', { params: { id: reply.body.data.id } });
  assert.equal(removedReply.body.data.removed, 1);
  const removedThread = await call('anna', 'remove', { params: { id: mine.id } });
  assert.equal(removedThread.body.data.removed, 1);

  const other = await make('cora', 'b2');
  await call('anna', 'reply', { params: { id: other.id }, body: { body: 'r' } });
  const moderated = await call('mod', 'remove', { params: { id: other.id } });
  assert.equal(moderated.body.data.removed, 2);
  assert.equal(db.all().length, 0);
});

test('per-admin rate limit on new comments', async () => {
  const { call } = createFixture();
  for (let index = 0; index < 30; index += 1) {
    await call('anna', 'create', { body: { ...TARGET, blockId: 'b1', body: `n${index}` } });
  }
  await assert.rejects(
    call('anna', 'create', { body: { ...TARGET, blockId: 'b1', body: 'one too many' } }),
    (error) => error.name === 'RateLimitError'
  );
  // Another admin is not affected.
  const ok = await call('cora', 'create', { body: { ...TARGET, blockId: 'b1', body: 'fine' } });
  assert.equal(ok.status, 201);
});

test('retention: entry locales and deleted admin users', async () => {
  const { call, services, db } = createFixture({ readable: ['doc1'] });
  await call('anna', 'create', { body: { ...TARGET, blockId: 'b1', body: 'en' } });
  await call('anna', 'create', { body: { ...TARGET, locale: 'de', blockId: 'b1', body: 'de' } });
  const thread = (await call('cora', 'create', { body: { ...TARGET, blockId: 'b2', body: 'cora' } })).body
    .data;
  await call('anna', 'resolve', { params: { id: thread.id } });
  await services.comments.anonymizeUser(1);
  const listed = await call('cora', 'list', { query: { ...TARGET } });
  const annas = listed.body.data.find((item) => item.blockId === 'b1');
  assert.deepEqual(annas.comments[0].author, { name: null, own: false, deleted: true });
  assert.deepEqual(listed.body.data.find((item) => item.id === thread.id).resolvedBy, { name: null });
  assert.equal(db.all().filter((row) => row.authorId === 1 || row.resolvedById === 1).length, 0);

  const removed = await services.comments.removeForEntries('api::article.article', 'doc1', ['en']);
  assert.equal(removed, 2);
  assert.deepEqual(
    db.all().map((row) => row.entryLocale),
    ['de']
  );
});

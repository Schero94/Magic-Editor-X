/**
 * @mentions and comment notifications (2.4): mention parsing in the comment
 * box, chip segments, the access filter (picker, stored mentions,
 * notifications, listings), read state, retention and mention e-mails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MAX_MENTIONS,
  cleanMentionIds,
  insertMention,
  mentionQueryAt,
  mentionSegments,
  mentionsInText,
} from '../shared/comment-mentions.mjs';
import { notificationPath } from '../admin/src/components/MentionsWidget/link.mjs';

const require = createRequire(import.meta.url);
const { errors } = require('@strapi/utils');
const commentsService = require('../server/src/services/comments.js');
const notificationsService = require('../server/src/services/comment-notifications.js');
const commentsController = require('../server/src/controllers/comments.js');
const notificationsController = require('../server/src/controllers/notifications.js');
const routes = require('../server/src/routes/index.js');
const contentTypes = require('../server/src/content-types/index.js');
const config = require('../server/src/config/index.js');
const { ACTIONS } = require('../server/src/permissions.js');

/* ------------------------------------------------------------------ pure */

test('mention query at the caret', () => {
  assert.deepEqual(mentionQueryAt('Hi @an', 6), { start: 3, query: 'an' });
  assert.deepEqual(mentionQueryAt('@', 1), { start: 0, query: '' });
  assert.deepEqual(mentionQueryAt('Hi @Anna B', 10), { start: 3, query: 'Anna B' });
  assert.equal(mentionQueryAt('mail me@example.test', 20), null, 'an @ inside a word is no mention');
  assert.equal(mentionQueryAt('Hi @ an', 7), null, 'space right after @');
  assert.equal(mentionQueryAt('Hi @an\nx', 8), null, 'line break ends it');
  assert.equal(mentionQueryAt('Hi @a b c d', 11), null, 'more than three words');
  assert.equal(mentionQueryAt(`@${'x'.repeat(60)}`, 61), null, 'bounded');
  assert.equal(mentionQueryAt('abc', 0), null);
  assert.equal(mentionQueryAt(null, 1), null);
  assert.deepEqual(mentionQueryAt('(@co', 4), { start: 1, query: 'co' });
});

test('inserting a mention and keeping only mentions still in the text', () => {
  const inserted = insertMention('Hi @an please', 3, 6, 'Anna Beispiel');
  assert.deepEqual(inserted, { text: 'Hi @Anna Beispiel please', caret: 18 });
  const picked = [
    { id: 'a1', name: 'Anna Beispiel' },
    { id: 'c3', name: 'Cora Prüfer' },
    { id: 'a1', name: 'Anna Beispiel' },
  ];
  assert.deepEqual(mentionsInText(inserted.text, picked), [{ id: 'a1', name: 'Anna Beispiel' }]);
  const many = Array.from({ length: 30 }, (_, index) => ({ id: `u${index}`, name: `U${index}` }));
  assert.equal(mentionsInText(many.map((item) => `@${item.name}`).join(' '), many).length, MAX_MENTIONS);
  assert.deepEqual(cleanMentionIds(['abc', 'abc', 'bad id', 5, 'x'.repeat(65), 'Z9']), ['abc', 'Z9']);
});

test('mention chips: longest name wins, only at a word start, text stays text', () => {
  const segments = mentionSegments('Hi @Anna Beispiel and @Anna, mail@Anna <b>', [
    { name: 'Anna', you: false },
    { name: 'Anna Beispiel', you: true },
  ]);
  assert.deepEqual(segments, [
    { type: 'text', text: 'Hi ' },
    { type: 'mention', text: '@Anna Beispiel', you: true },
    { type: 'text', text: ' and ' },
    { type: 'mention', text: '@Anna', you: false },
    { type: 'text', text: ', mail@Anna <b>' },
  ]);
  assert.deepEqual(mentionSegments('plain', []), [{ type: 'text', text: 'plain' }]);
  assert.deepEqual(mentionSegments('', null), []);
});

test('notification links open the entry, locale and thread in the Content Manager', () => {
  assert.equal(
    notificationPath({
      threadId: 't1',
      target: { kind: 'collectionType', uid: 'api::article.article', documentId: 'doc1', locale: 'de' },
    }),
    '/content-manager/collection-types/api%3A%3Aarticle.article/doc1?plugins%5Bi18n%5D%5Blocale%5D=de&mexThread=t1'
  );
  assert.equal(
    notificationPath({ threadId: 't2', target: { kind: 'singleType', uid: 'api::home.home', locale: null } }),
    '/content-manager/single-types/api%3A%3Ahome.home?mexThread=t2'
  );
});

/* ------------------------------------------------------------- contract */

test('notification routes need access + comments.read; content type is hidden; config keys', () => {
  const list = routes.admin.routes.filter((route) => route.path.startsWith('/notifications'));
  assert.deepEqual(
    list.map((route) => `${route.method} ${route.path}`),
    [
      'GET /notifications',
      'POST /notifications/read-all',
      'POST /notifications/:id/read',
      'POST /notifications/:id/unread',
    ]
  );
  for (const route of list) {
    const [auth, perms] = route.config.policies;
    assert.equal(auth, 'admin::isAuthenticatedAdmin');
    assert.deepEqual(perms.config.actions, [ACTIONS.access, ACTIONS.commentsRead]);
  }
  const mentionable = routes.admin.routes.find((route) => route.path === '/comments/mentionable');
  assert.ok(mentionable.config.policies[1].config.actions.includes(ACTIONS.commentsWrite));
  const index = routes.admin.routes.indexOf(mentionable);
  assert.ok(
    routes.admin.routes.findIndex((route) => route.path === '/comments/:id') === -1 ||
      routes.admin.routes.findIndex((route) => route.path === '/comments/:id') > index
  );
  const schema = contentTypes['comment-notification'].schema;
  assert.equal(schema.pluginOptions['content-manager'].visible, false);
  assert.equal(schema.pluginOptions['content-type-builder'].visible, false);
  assert.ok(contentTypes.comment.schema.attributes.anchor);
  assert.ok(contentTypes.comment.schema.attributes.mentions);
  assert.equal(config.default.comments.notifications.email, false, 'e-mails are opt-in');
  config.validator(config.default);
  assert.throws(() =>
    config.validator({
      ...config.default,
      comments: { ...config.default.comments, notifications: { email: 'yes', emailPerHour: 10 } },
    })
  );
  assert.throws(() =>
    config.validator({ ...config.default, comments: { ...config.default.comments, mentionsPerMinute: 0 } })
  );
});

/* --------------------------------------------- service + controller (fake) */

/**
 * In-memory query engine: equality, null, $in, $notIn, $ne, $or, $and, $containsi, select, orderBy, limit.
 * @returns {object} Factory of `strapi.db.query(uid)` per uid.
 */
const createFakeDb = () => {
  const tables = new Map();
  let nextId = 1;
  const rowsOf = (uid) => {
    if (!tables.has(uid)) tables.set(uid, []);
    return tables.get(uid);
  };
  const test = (value, condition) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$in' in condition) return condition.$in.includes(value);
      if ('$notIn' in condition) return !condition.$notIn.includes(value);
      if ('$ne' in condition) return value !== condition.$ne;
      if ('$containsi' in condition)
        return String(value || '')
          .toLowerCase()
          .includes(String(condition.$containsi).toLowerCase());
      if ('$startsWith' in condition) return String(value || '').startsWith(condition.$startsWith);
      if ('$notContains' in condition) return !String(value || '').includes(condition.$notContains);
    }
    return (value ?? null) === (condition ?? null);
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, condition]) => {
      if (key === '$or') return condition.some((part) => matches(row, part));
      if (key === '$and') return condition.every((part) => matches(row, part));
      return test(row[key], condition);
    });
  const api = (uid) => ({
    async findOne({ where }) {
      const row = rowsOf(uid).find((item) => matches(item, where));
      return row ? { ...row } : null;
    },
    async findMany({ where, limit, orderBy }) {
      let list = rowsOf(uid).filter((row) => matches(row, where));
      if (Array.isArray(orderBy) && orderBy.length) {
        const [first] = orderBy;
        const [key, direction] = Object.entries(first)[0];
        list = [...list].sort((a, b) =>
          direction === 'desc' ? (a[key] < b[key] ? 1 : -1) : a[key] < b[key] ? -1 : 1
        );
      }
      return list.slice(0, limit || undefined).map((row) => ({ ...row }));
    },
    async count({ where }) {
      return rowsOf(uid).filter((row) => matches(row, where)).length;
    },
    async create({ data }) {
      const now = new Date(Date.now() + nextId).toISOString();
      const row = { id: nextId, documentId: `d${nextId}`, createdAt: now, updatedAt: now, ...data };
      nextId += 1;
      rowsOf(uid).push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rowsOf(uid).find((item) => matches(item, where));
      Object.assign(row, data, { updatedAt: new Date().toISOString() });
      return { ...row };
    },
    async updateMany({ where, data }) {
      const hit = rowsOf(uid).filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    },
    async delete({ where }) {
      tables.set(
        uid,
        rowsOf(uid).filter((row) => !matches(row, where))
      );
    },
    async deleteMany({ where }) {
      const before = rowsOf(uid).length;
      tables.set(
        uid,
        rowsOf(uid).filter((row) => !matches(row, where))
      );
      return { count: before - rowsOf(uid).length };
    },
  });
  return { api, rowsOf, seed: (uid, row) => rowsOf(uid).push(row) };
};

const READ = [ACTIONS.access, ACTIONS.commentsRead];
const WRITE = [...READ, ACTIONS.commentsWrite];

/**
 * Fixture: admins with roles, documents they can read, a mailer stub.
 * - anna (1): writes, reads doc1 + doc2
 * - ben (2): reads doc1 only
 * - cora (3): reads doc2 only
 * - dana (4): comments.read missing (Content Manager read on doc1 only)
 * - eli (5): blocked
 * @param {object} [options] - Options.
 * @returns {object} Fixture.
 */
const createFixture = ({ email = false, configOverrides = {} } = {}) => {
  const db = createFakeDb();
  const users = [
    {
      id: 1,
      documentId: 'adm1',
      firstname: 'Anna',
      lastname: 'Beispiel',
      email: 'anna@example.test',
      isActive: true,
    },
    {
      id: 2,
      documentId: 'adm2',
      firstname: 'Ben',
      lastname: 'Muster',
      email: 'ben@example.test',
      isActive: true,
    },
    {
      id: 3,
      documentId: 'adm3',
      firstname: 'Cora',
      lastname: 'Prüfer',
      email: 'cora@example.test',
      isActive: true,
    },
    {
      id: 4,
      documentId: 'adm4',
      firstname: 'Dana',
      lastname: 'Leserin',
      email: 'dana@example.test',
      isActive: true,
    },
    {
      id: 5,
      documentId: 'adm5',
      firstname: 'Eli',
      lastname: 'Block',
      email: 'eli@example.test',
      isActive: true,
      blocked: true,
    },
  ];
  for (const user of users) db.seed('admin::user', { ...user });
  const grants = { 1: WRITE, 2: WRITE, 3: WRITE, 4: [ACTIONS.access], 5: WRITE };
  const readable = { 1: ['doc1', 'doc2'], 2: ['doc1'], 3: ['doc2'], 4: ['doc1'], 5: ['doc1', 'doc2'] };
  const ability = (id) => ({ id, can: (action) => grants[id].includes(action) });
  const counters = new Map();
  const mails = [];
  const services = {};
  const values = {
    'plugin::magic-editor-x.comments.notifications.email': email,
    'admin.absoluteUrl': 'http://127.0.0.1:1483/admin',
    ...configOverrides,
  };
  const strapi = {
    config: { get: (key) => values[key] },
    db: { query: (uid) => db.api(uid) },
    contentType: (uid) =>
      uid === 'api::article.article'
        ? {
            kind: 'collectionType',
            info: { displayName: 'Article' },
            attributes: { title: { type: 'string' } },
          }
        : null,
    documents: () => ({ findOne: async ({ documentId }) => ({ title: `Title of ${documentId}` }) }),
    plugin: (name) => {
      if (name === 'email') return { service: () => ({ send: async (mail) => mails.push(mail) }) };
      if (name === 'content-manager')
        return { service: () => ({ create: () => ({ cannot: { read: () => false } }) }) };
      return { service: (service) => services[service] };
    },
    log: { warn() {}, error() {}, info() {}, debug() {} },
  };
  services.store = {
    async hit(key) {
      counters.set(key, (counters.get(key) || 0) + 1);
      return { count: counters.get(key) };
    },
  };
  services.access = {
    async abilityForUser(id) {
      const user = users.find((item) => item.id === id);
      return user && !user.blocked ? ability(id) : null;
    },
    async checkField({ userAbility, documentId, locale, field }) {
      if (!userAbility || !readable[userAbility.id].includes(documentId))
        throw new errors.NotFoundError('Not found');
      return { canRead: true, canUpdate: false, locale: locale || 'en', fieldName: field, positional: false };
    },
  };
  services.links = { titleFieldFor: async () => 'title' };
  services.comments = commentsService({ strapi });
  services['comment-notifications'] = notificationsService({ strapi });
  const comments = commentsController({ strapi });
  const notes = notificationsController({ strapi });
  const call = async (controller, userId, handler, { query = {}, params = {}, body } = {}) => {
    const ctx = {
      query,
      params,
      request: { body },
      state: { user: users.find((user) => user.id === userId), userAbility: ability(userId) },
      status: 200,
      body: null,
      conflict(message, details) {
        this.status = 409;
        this.body = { error: { message, details } };
      },
    };
    await controller[handler](ctx);
    return ctx;
  };
  return {
    db,
    mails,
    services,
    comment: (userId, handler, input) => call(comments, userId, handler, input),
    notes: (userId, handler, input) => call(notes, userId, handler, input),
  };
};

const TARGET = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' };
const NOTES = 'plugin::magic-editor-x.comment-notification';

/** Waits for work scheduled with setImmediate (mention e-mails). */
const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

test('picker: only people who can read the field, never the caller, names and opaque ids only', async () => {
  const fx = createFixture();
  const all = await fx.comment(1, 'mentionable', { query: { ...TARGET } });
  assert.deepEqual(all.body.data, [{ id: 'adm2', name: 'Ben Muster' }]);
  const none = await fx.comment(1, 'mentionable', { query: { ...TARGET, q: 'cora' } });
  assert.deepEqual(none.body.data, [], 'Cora cannot read doc1');
  const doc2 = await fx.comment(1, 'mentionable', { query: { ...TARGET, documentId: 'doc2', q: 'pr' } });
  assert.deepEqual(doc2.body.data, [{ id: 'adm3', name: 'Cora Prüfer' }]);
  assert.ok(!JSON.stringify(all.body).includes('example.test'), 'no e-mail addresses');
  // E-mail addresses are not searched.
  const byMail = await fx.comment(1, 'mentionable', { query: { ...TARGET, q: 'ben@example' } });
  assert.deepEqual(byMail.body.data, []);
  // Someone who cannot read the document gets 404, like every comment route.
  await assert.rejects(fx.comment(3, 'mentionable', { query: { ...TARGET } }), errors.NotFoundError);
  // Bounded, strict query.
  await assert.rejects(
    fx.comment(1, 'mentionable', { query: { ...TARGET, q: 'x'.repeat(51) } }),
    errors.ValidationError
  );
  await assert.rejects(
    fx.comment(1, 'mentionable', { query: { ...TARGET, extra: '1' } }),
    errors.ValidationError
  );
});

test('picker is rate limited per admin', async () => {
  const fx = createFixture({ configOverrides: { 'plugin::magic-editor-x.comments.mentionsPerMinute': 2 } });
  await fx.comment(1, 'mentionable', { query: { ...TARGET } });
  await fx.comment(1, 'mentionable', { query: { ...TARGET } });
  await assert.rejects(fx.comment(1, 'mentionable', { query: { ...TARGET } }), errors.RateLimitError);
});

test('mentions: re-checked on create, dropped without access, stored as ids, returned as names', async () => {
  const fx = createFixture();
  const created = await fx.comment(1, 'create', {
    body: {
      ...TARGET,
      blockId: 'blk1',
      body: 'Hi @Ben Muster and @Cora Prüfer',
      mentions: ['adm2', 'adm3', 'adm4', 'adm5', 'nobody'],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.meta.droppedMentions, 4);
  const comment = created.body.data.comments[0];
  assert.deepEqual(comment.mentions, [{ id: 'adm2', name: 'Ben Muster', you: false }]);
  const row = fx.db.rowsOf('plugin::magic-editor-x.comment')[0];
  assert.deepEqual(row.mentions, [2]);
  // One notification for Ben only.
  const rows = fx.db.rowsOf(NOTES);
  assert.deepEqual(
    rows.map((note) => [note.recipientId, note.kind]),
    [[2, 'mention']]
  );
  assert.ok(!('body' in rows[0]), 'notifications hold no text');
  // Ben sees "you".
  const listed = await fx.comment(2, 'list', { query: { ...TARGET } });
  assert.deepEqual(listed.body.data[0].comments[0].mentions, [{ id: 'adm2', name: 'Ben Muster', you: true }]);
  assert.equal(listed.body.meta.notifications.length, 1);
  assert.equal(listed.body.meta.notifications[0].kind, 'mention');
  // Too many or malformed mention ids are refused.
  await assert.rejects(
    fx.comment(1, 'create', {
      body: {
        ...TARGET,
        blockId: 'blk1',
        body: 'x',
        mentions: Array.from({ length: 21 }, (_, i) => `a${i}`),
      },
    }),
    errors.ValidationError
  );
  await assert.rejects(
    fx.comment(1, 'create', { body: { ...TARGET, blockId: 'blk1', body: 'x', mentions: ['bad id'] } }),
    errors.ValidationError
  );
});

test('range anchors: stored on the thread, strict and bounded', async () => {
  const fx = createFixture();
  const anchor = {
    path: 'text',
    start: null,
    end: null,
    quote: { exact: 'brave', prefix: 'Hello ', suffix: ' new' },
  };
  const created = await fx.comment(1, 'create', {
    body: { ...TARGET, blockId: 'blk1', body: 'On this', anchor },
  });
  assert.deepEqual(created.body.data.anchor, anchor);
  const listed = await fx.comment(1, 'list', { query: { ...TARGET } });
  assert.deepEqual(listed.body.data[0].anchor, anchor);
  const bad = [
    { ...anchor, extra: 1 },
    { ...anchor, quote: { ...anchor.quote, exact: 'x'.repeat(501) } },
    { ...anchor, quote: { ...anchor.quote, prefix: 'x'.repeat(33) } },
    { ...anchor, quote: { exact: '   ', prefix: '', suffix: '' } },
    { ...anchor, start: 'AAAA' },
    { ...anchor, start: 'AAAA', end: 'AAAA', path: null },
    { ...anchor, start: '!!!!', end: 'AAAA' },
    { ...anchor, start: 'A'.repeat(800), end: 'AAAA' },
    { ...anchor, path: 'a..b' },
  ];
  for (const value of bad) {
    await assert.rejects(
      fx.comment(1, 'create', { body: { ...TARGET, blockId: 'blk1', body: 'x', anchor: value } }),
      errors.ValidationError,
      JSON.stringify(value).slice(0, 80)
    );
  }
  // Block comments keep working without an anchor.
  const block = await fx.comment(1, 'create', { body: { ...TARGET, blockId: 'blk2', body: 'Block' } });
  assert.equal(block.body.data.anchor, null);
});

test('replies notify thread participants once; replying reads your own notifications', async () => {
  const fx = createFixture();
  const created = await fx.comment(1, 'create', { body: { ...TARGET, blockId: 'blk1', body: 'Start' } });
  const thread = created.body.data.id;
  // Ben replies: Anna (root author) gets a reply notification.
  await fx.comment(2, 'reply', { params: { id: thread }, body: { body: 'Reply from Ben' } });
  // Anna replies and mentions Ben: Ben gets a mention (not also a reply).
  await fx.comment(1, 'reply', {
    params: { id: thread },
    body: { body: '@Ben Muster ok', mentions: ['adm2'] },
  });
  const rows = fx.db.rowsOf(NOTES).map((note) => [note.recipientId, note.kind, Boolean(note.readAt)]);
  assert.deepEqual(rows, [
    [1, 'reply', true],
    [2, 'mention', false],
  ]);
  // Dana (no comments.read) and Cora (no access to doc1) are never notified.
  assert.ok(!fx.db.rowsOf(NOTES).some((note) => [3, 4].includes(note.recipientId)));
});

test('editing: new mentions notify, removed mentions lose their notification', async () => {
  const fx = createFixture();
  const created = await fx.comment(1, 'create', { body: { ...TARGET, blockId: 'blk1', body: 'Plain' } });
  const id = created.body.data.comments[0].id;
  await fx.comment(1, 'update', { params: { id }, body: { body: 'Now @Ben Muster', mentions: ['adm2'] } });
  assert.equal(fx.db.rowsOf(NOTES).length, 1);
  // Saving again with the same mention does not notify twice.
  await fx.comment(1, 'update', { params: { id }, body: { body: 'Again @Ben Muster', mentions: ['adm2'] } });
  assert.equal(fx.db.rowsOf(NOTES).length, 1);
  // Without `mentions` the list stays.
  await fx.comment(1, 'update', { params: { id }, body: { body: 'Text only @Ben Muster' } });
  assert.deepEqual(fx.db.rowsOf('plugin::magic-editor-x.comment')[0].mentions, [2]);
  await fx.comment(1, 'update', { params: { id }, body: { body: 'Removed', mentions: [] } });
  assert.equal(fx.db.rowsOf(NOTES).length, 0);
  assert.equal(fx.db.rowsOf('plugin::magic-editor-x.comment')[0].mentions, null);
});

test('notification listing: own only, access re-checked, read and unread, read all', async () => {
  const fx = createFixture();
  const first = await fx.comment(1, 'create', {
    body: { ...TARGET, blockId: 'blk1', body: 'Hi @Ben Muster', mentions: ['adm2'] },
  });
  await fx.comment(1, 'create', {
    body: { ...TARGET, blockId: 'blk2', body: 'And @Ben Muster again', mentions: ['adm2'] },
  });
  let listed = await fx.notes(2, 'list', { query: {} });
  assert.equal(listed.body.meta.unread, 2);
  assert.equal(listed.body.data.length, 2);
  const item = listed.body.data[1];
  assert.equal(item.kind, 'mention');
  assert.equal(item.actor.name, 'Anna Beispiel');
  assert.equal(item.threadId, first.body.data.id);
  assert.equal(item.snippet, 'Hi @Ben Muster');
  assert.deepEqual(
    { ...item.target },
    {
      kind: 'collectionType',
      uid: 'api::article.article',
      documentId: 'doc1',
      locale: 'en',
      field: 'body',
      fieldKey: null,
      typeName: 'Article',
      title: 'Title of doc1',
    }
  );
  assert.ok(!JSON.stringify(listed.body).match(/"(recipientId|authorId)"/), 'no admin ids');
  // Anna has none; Anna cannot read Ben's notification.
  const anna = await fx.notes(1, 'list', { query: {} });
  assert.equal(anna.body.data.length, 0);
  await assert.rejects(fx.notes(1, 'read', { params: { id: item.id } }), errors.NotFoundError);
  // Mark read / unread / all.
  await fx.notes(2, 'read', { params: { id: item.id } });
  listed = await fx.notes(2, 'list', { query: { unread: 'true' } });
  assert.equal(listed.body.data.length, 1);
  await fx.notes(2, 'unread', { params: { id: item.id } });
  const all = await fx.notes(2, 'readAll', { body: {} });
  assert.equal(all.body.data.updated, 2);
  listed = await fx.notes(2, 'list', { query: {} });
  assert.equal(listed.body.meta.unread, 0);
  // Paging and strict queries.
  const page = await fx.notes(2, 'list', { query: { page: '2', pageSize: '1' } });
  assert.equal(page.body.data.length, 1);
  assert.equal(page.body.meta.pagination.total, 2);
  await assert.rejects(fx.notes(2, 'list', { query: { pageSize: '51' } }), errors.ValidationError);
  await assert.rejects(fx.notes(2, 'list', { query: { other: '1' } }), errors.ValidationError);
  await assert.rejects(fx.notes(2, 'read', { params: { id: 'BAD!' } }), errors.ValidationError);
});

test('lost access hides notifications; deleting comments, entries and admins removes them', async () => {
  const fx = createFixture();
  const created = await fx.comment(1, 'create', {
    body: { ...TARGET, blockId: 'blk1', body: 'Hi @Ben Muster', mentions: ['adm2'] },
  });
  // Ben loses access to doc1: the notification is no longer listed (the row stays).
  const access = fx.services.access;
  const original = access.checkField;
  access.checkField = async (input) => {
    if (input.userAbility.id === 2) throw new errors.NotFoundError('Not found');
    return original(input);
  };
  let listed = await fx.notes(2, 'list', { query: {} });
  assert.equal(listed.body.data.length, 0);
  assert.equal(listed.body.meta.unread, 0);
  access.checkField = original;
  listed = await fx.notes(2, 'list', { query: {} });
  assert.equal(listed.body.data.length, 1);
  // Thread deleted: its notifications go.
  await fx.comment(1, 'remove', { params: { id: created.body.data.id } });
  assert.equal(fx.db.rowsOf(NOTES).length, 0);
  // Entry deleted.
  await fx.comment(1, 'create', {
    body: { ...TARGET, blockId: 'b', body: '@Ben Muster', mentions: ['adm2'] },
  });
  await fx.services.comments.removeForEntries('api::article.article', 'doc1', ['en']);
  assert.equal(fx.db.rowsOf(NOTES).length, 0);
  // Admin deleted.
  await fx.comment(1, 'create', {
    body: { ...TARGET, blockId: 'b', body: '@Ben Muster', mentions: ['adm2'] },
  });
  await fx.services.comments.anonymizeUser(2);
  assert.equal(fx.db.rowsOf(NOTES).length, 0);
});

test('mention e-mails: off by default; when on, safe headers, no comment text, rate limited', async () => {
  const off = createFixture();
  await off.comment(1, 'create', {
    body: { ...TARGET, blockId: 'b', body: 'Secret @Ben Muster', mentions: ['adm2'] },
  });
  await flush();
  assert.equal(off.mails.length, 0);

  const on = createFixture({
    email: true,
    configOverrides: { 'plugin::magic-editor-x.comments.notifications.emailPerHour': 2 },
  });
  // A display name with header characters.
  on.db.rowsOf('admin::user')[0].firstname = 'Anna\r\nBcc: evil@example.test';
  for (let index = 0; index < 3; index += 1) {
    await on.comment(1, 'create', {
      body: { ...TARGET, blockId: 'b', body: `Secret text ${index} @Ben Muster`, mentions: ['adm2'] },
    });
  }
  await flush();
  assert.equal(on.mails.length, 2, 'two per hour');
  const [mail] = on.mails;
  assert.equal(mail.to, 'ben@example.test');
  assert.ok(!/[\r\n]/.test(mail.subject), 'subject has no line breaks');
  assert.ok(!('from' in mail) && !('replyTo' in mail) && !('bcc' in mail));
  assert.ok(!mail.text.includes('Secret text'), 'no comment text');
  assert.match(mail.text, /"Title of doc1" \(Article\)/);
  assert.match(
    mail.text,
    /http:\/\/127\.0\.0\.1:1483\/admin\/content-manager\/collection-types\/api%3A%3Aarticle\.article\/doc1\?plugins%5Bi18n%5D%5Blocale%5D=en&mexThread=/
  );
  assert.ok(on.db.rowsOf(NOTES).some((note) => note.emailedAt));
  // An address with header characters is never used.
  const bad = createFixture({ email: true });
  bad.db.rowsOf('admin::user')[1].email = 'ben@example.test\r\nBcc: x@example.test';
  await bad.comment(1, 'create', {
    body: { ...TARGET, blockId: 'b', body: '@Ben Muster', mentions: ['adm2'] },
  });
  await flush();
  assert.equal(bad.mails.length, 0);
});

test('header-safe text and e-mail pattern', () => {
  const { headerSafe, EMAIL_PATTERN } = notificationsService;
  assert.equal(headerSafe('A\r\nB C‮D', 100), 'A B CD');
  assert.equal(headerSafe('x'.repeat(300), 10), 'x'.repeat(10));
  assert.equal(headerSafe(null, 10), '');
  assert.ok(EMAIL_PATTERN.test('ben@example.test'));
  assert.ok(!EMAIL_PATTERN.test('ben@example.test\nBcc: a@example.test'));
  assert.ok(!EMAIL_PATTERN.test('Ben <ben@example.test>'));
  assert.ok(!EMAIL_PATTERN.test('a,b@example.test'));
});

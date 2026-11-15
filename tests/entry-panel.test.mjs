import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  hasEditorFields,
  nextDelay,
  createTabId,
  entryPath,
  fieldsWith,
  fieldProblems,
  HEARTBEAT_MS,
  MAX_BACKOFF_MS,
} from '../admin/src/components/EntryPanel/logic.mjs';
import { matchesFieldRequest, OPEN_FIELD_PANEL_EVENT } from '../admin/src/editor/entry-panel-events.mjs';

/**
 * Entry panel, presence and widgets (2.5): pure helpers of server and admin, the presence service on a
 * real SQLite store (heartbeat rows, aggregation across field rooms incl. positional rooms, exclusion
 * from the socket limits, leave, read-only callers, LIKE escaping, rate limit, presence off), routes,
 * config and the admin source contract (one side panel, registered in bootstrap).
 */

const require = createRequire(import.meta.url);
const knexFactory = require('knex');
const config = require('../server/src/config/index.js');
const createStore = require('../server/src/services/store.js');
const createEntryPanel = require('../server/src/services/entry-panel.js');
const { pathLabel, groupEditors, entryRowId } = createEntryPanel;
const routes = require('../server/src/routes/index.js');
const { ACTIONS } = require('../server/src/permissions.js');

const databases = [];
after(() => Promise.all(databases.map((knex) => knex.destroy())));

const UID = 'api::article.article';
const DOC = 'doc1';

/**
 * Presence service on an in-memory SQLite store with a stubbed access service.
 * @param {{ conf?: object, access?: Function }} [options] - Overrides.
 * @returns {Promise<object>} Harness.
 */
const harness = async ({ conf = {}, access } = {}) => {
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  databases.push(knex);
  const values = { 'presence.enabled': true, 'presence.softLock': false, 'presence.perMinute': 30, ...conf };
  const services = {};
  const strapi = {
    db: {
      connection: knex,
      getConnection: (name) => knex(name),
      getSchemaConnection: () => knex.schema,
    },
    config: { get: (key) => values[key.replace('plugin::magic-editor-x.', '')] },
    log: { warn() {}, error() {}, info() {}, debug() {} },
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = createStore({ strapi });
  await services.store.init();
  services.access = {
    checkDocument:
      access ||
      (async ({ userAbility, locale }) => ({
        canRead: true,
        canUpdate: userAbility.canUpdate !== false,
        locale: locale || 'en',
      })),
  };
  services['entry-panel'] = createEntryPanel({ strapi });
  return { knex, services, panel: services['entry-panel'], store: services.store };
};

const user = (id, firstname = `User${id}`) => ({
  id,
  firstname,
  lastname: 'Example',
  email: `u${id}@example.test`,
});
const beat = (panel, who, extra = {}) =>
  panel.presence({
    userAbility: { canUpdate: true },
    user: who,
    uid: UID,
    documentId: DOC,
    locale: 'en',
    tabId: `tab-${who.id}-aaaaaaaaaaaa`,
    ...extra,
  });

test('presence: heartbeats of two admins see each other, names only, never the caller', async () => {
  const { panel, knex } = await harness();
  const first = await beat(panel, user(1, 'Anna'));
  assert.deepEqual(first.editors, []);
  const second = await beat(panel, user(2, 'Ben'));
  assert.equal(second.editors.length, 1);
  assert.equal(second.editors[0].name, 'Anna E.');
  assert.equal(second.editors[0].live, false);
  assert.match(second.editors[0].id, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(second).includes('example.test'), 'no e-mail address');
  assert.ok(!JSON.stringify(second).includes('"1"'), 'no admin id');
  const rows = await knex('magic_editor_x_collab_presence').select('*');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.room === `${UID}|${DOC}|en|@entry`));
});

test('presence: socket rows of every field room count, positional rooms included, other locales do not', async () => {
  const { panel, store } = await harness();
  await store.upsertPresence({
    id: 's1',
    room: `${UID}|${DOC}|en|body`,
    userId: 3,
    name: 'Cora E.',
    color: 'primary',
    canEdit: true,
  });
  await store.upsertPresence({
    id: 's2',
    room: `${UID}|${DOC}|en|sections.body#AAAAAAAAAAAAAAAAAAAAAA`,
    userId: 4,
    name: 'Dana E.',
    color: 'success',
    canEdit: true,
    cursor: { idle: true },
  });
  await store.upsertPresence({
    id: 's3',
    room: `${UID}|${DOC}|de|body`,
    userId: 5,
    name: 'Eli E.',
    color: 'danger',
    canEdit: true,
  });
  await store.upsertPresence({
    id: 's4',
    room: `${UID}|${DOC}|en|body`,
    userId: 6,
    name: 'Fynn E.',
    color: 'danger',
    canEdit: false,
  });
  const result = await beat(panel, user(1));
  assert.deepEqual(
    result.editors.map(({ name, idle, live }) => ({ name, idle, live })),
    [
      { name: 'Cora E.', idle: false, live: true },
      { name: 'Dana E.', idle: true, live: true },
    ]
  );
});

test('presence: entry heartbeats never count against the socket limits', async () => {
  const { panel, store } = await harness();
  await beat(panel, user(7));
  await store.upsertPresence({
    id: 'sock',
    room: `${UID}|${DOC}|en|body`,
    userId: 7,
    name: 'U',
    color: 'primary',
    canEdit: true,
  });
  const usage = await store.presenceOfUser(7, Date.now() - 30000);
  assert.equal(usage.sockets, 1);
  assert.deepEqual(Array.from(usage.rooms), [`${UID}|${DOC}|en|body`]);
});

test('presence: leave removes the row at once; read-only callers write none but see editors', async () => {
  const { panel, knex } = await harness();
  await beat(panel, user(1, 'Anna'));
  const reader = await beat(panel, user(2), { userAbility: { canUpdate: false } });
  assert.equal(reader.canEdit, false);
  assert.equal(reader.editors.length, 1);
  assert.equal((await knex('magic_editor_x_collab_presence').count({ n: '*' }))[0].n, 1);
  await beat(panel, user(1, 'Anna'), { leave: true });
  assert.equal((await knex('magic_editor_x_collab_presence').count({ n: '*' }))[0].n, 0);
});

test('presence: LIKE wildcards in the room prefix match nothing else', async () => {
  const { store } = await harness();
  await store.upsertPresence({
    id: 'x1',
    room: 'api::my_type.my_type|d1|-|body',
    userId: 1,
    name: 'A',
    color: 'primary',
    canEdit: true,
  });
  await store.upsertPresence({
    id: 'x2',
    room: 'api::myXtype.myXtype|d1|-|body',
    userId: 2,
    name: 'B',
    color: 'primary',
    canEdit: true,
  });
  const rows = await store.listDocumentPresence('api::my_type.my_type|d1|-|', Date.now() - 30000);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['x1']
  );
  assert.deepEqual(await store.listDocumentPresence('api::%|d1|-|', Date.now() - 30000), []);
});

test('presence: stale rows are not listed', async () => {
  const { panel, knex } = await harness();
  await beat(panel, user(1));
  await knex('magic_editor_x_collab_presence').update({ updated_at: Date.now() - 31000 });
  const result = await beat(panel, user(2));
  assert.deepEqual(result.editors, []);
});

test('presence: access errors pass through (404) and nothing is written', async () => {
  const { panel, knex } = await harness({
    access: async () => {
      const error = new Error('Not found');
      error.name = 'NotFoundError';
      throw error;
    },
  });
  await assert.rejects(() => beat(panel, user(1)), /Not found/);
  assert.equal((await knex('magic_editor_x_collab_presence').count({ n: '*' }))[0].n, 0);
});

test('presence: the per-admin limit is shared and answers 429', async () => {
  const { panel } = await harness({ conf: { 'presence.perMinute': 3 } });
  for (let i = 0; i < 3; i += 1) await beat(panel, user(9));
  await assert.rejects(
    () => beat(panel, user(9)),
    (error) => error.name === 'RateLimitError'
  );
});

test('presence: off returns no editors and writes nothing; softLock follows the config', async () => {
  const off = await harness({ conf: { 'presence.enabled': false } });
  const result = await beat(off.panel, user(1));
  assert.deepEqual(result, { enabled: false, softLock: false, canEdit: true, editors: [] });
  assert.equal((await off.knex('magic_editor_x_collab_presence').count({ n: '*' }))[0].n, 0);
  const on = await harness({ conf: { 'presence.softLock': true } });
  assert.equal((await beat(on.panel, user(1))).softLock, true);
});

test('server helpers: path labels, row ids, grouping', () => {
  assert.equal(pathLabel('body'), 'body');
  assert.equal(pathLabel('sections.0.body'), 'sections 1 › body');
  assert.equal(pathLabel('zone.2.items.0.body'), 'zone 3 › items 1 › body');
  assert.match(entryRowId(1, 'tab'), /^[0-9a-f]{64}$/);
  assert.notEqual(entryRowId(1, 'tab'), entryRowId(2, 'tab'));
  const many = Array.from({ length: 30 }, (_, i) => ({
    room: `p|@entry`,
    user_id: i + 2,
    name: `N${String(i).padStart(2, '0')}`,
    color: 'primary',
    can_edit: 1,
    cursor: null,
    updated_at: 1,
  }));
  assert.equal(groupEditors(many, 'p|', 1, '|@entry').length, 20);
});

test('config: presence defaults and bounds', () => {
  const base = structuredClone(config.default);
  assert.deepEqual(base.presence, { enabled: true, softLock: false, perMinute: 30 });
  config.validator(base);
  for (const [key, value] of [
    ['enabled', 'yes'],
    ['softLock', 1],
    ['perMinute', 0],
    ['perMinute', 601],
  ]) {
    const bad = structuredClone(config.default);
    bad.presence[key] = value;
    assert.throws(() => config.validator(bad), /presence/);
  }
});

test('routes: entry panel and widget routes need an admin and the listed actions', () => {
  const find = (method, path) => routes.admin.routes.find((r) => r.method === method && r.path === path);
  const expect = {
    'POST /presence': [ACTIONS.access],
    'GET /entry-summary': [ACTIONS.access],
    'GET /widgets/open-threads': [ACTIONS.access, ACTIONS.commentsRead],
    'GET /widgets/broken-links': [ACTIONS.access],
  };
  for (const [key, actions] of Object.entries(expect)) {
    const [method, path] = key.split(' ');
    const route = find(method, path);
    assert.ok(route, key);
    assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
    assert.deepEqual(route.config.policies[1].config.actions, actions, key);
  }
});

test('controller: strict bounded input', async () => {
  const controller = require('../server/src/controllers/entry-panel.js')({
    strapi: {
      plugin: () => ({
        service: () => ({ presence: async () => ({}), summary: async () => ({}) }),
      }),
    },
  });
  const ctx = (body, query) => ({
    request: { body },
    query,
    state: { user: { id: 1 }, userAbility: {} },
    set() {},
  });
  const ok = { uid: UID, documentId: 'abc', locale: 'en', tabId: 'abcdefghijklmnop' };
  await controller.presence(ctx(ok));
  for (const bad of [
    { ...ok, tabId: 'short' },
    { ...ok, tabId: 'x'.repeat(65) },
    { ...ok, uid: 'api::x' },
    { ...ok, documentId: 'ABC!' },
    { ...ok, extra: true },
    { ...ok, idle: 'yes' },
  ])
    await assert.rejects(() => controller.presence(ctx(bad)), /Validation failed/);
  await assert.rejects(
    () => controller.summary(ctx(undefined, { uid: UID, documentId: 'abc', field: 'body' })),
    /Validation failed/
  );
  await assert.rejects(() => controller.openThreads(ctx(undefined, { pageSize: '21' })), /Validation failed/);
});

test('admin logic: editor field detection, backoff, tab ids, paths', () => {
  const components = {
    'blocks.text': {
      attributes: { body: { type: 'customField', customField: 'plugin::magic-editor-x.richtext' } },
    },
    'blocks.plain': { attributes: { name: { type: 'string' } } },
  };
  assert.equal(hasEditorFields({ attributes: { name: { type: 'string' } } }, components), false);
  assert.equal(
    hasEditorFields({ attributes: { s: { type: 'component', component: 'blocks.text' } } }, components),
    true
  );
  assert.equal(
    hasEditorFields(
      { attributes: { z: { type: 'dynamiczone', components: ['blocks.plain', 'blocks.text'] } } },
      components
    ),
    true
  );
  assert.equal(hasEditorFields(undefined), false);
  assert.equal(nextDelay(0), HEARTBEAT_MS);
  assert.equal(nextDelay(1), 30000);
  assert.equal(nextDelay(10), MAX_BACKOFF_MS);
  assert.equal(nextDelay(1, 429), 60000);
  const id = createTabId();
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(id, createTabId());
  assert.equal(
    entryPath({ kind: 'collectionType', uid: UID, documentId: 'd1', locale: 'de' }, { mexThread: 't1' }),
    '/content-manager/collection-types/api%3A%3Aarticle.article/d1?plugins%5Bi18n%5D%5Blocale%5D=de&mexThread=t1'
  );
  assert.equal(
    entryPath({ kind: 'singleType', uid: 'api::home.home', locale: null }),
    '/content-manager/single-types/api%3A%3Ahome.home'
  );
  const fields = [
    { path: 'a', openThreads: 0, issues: { errors: 0, warnings: 0 }, brokenLinks: { draft: 2 } },
    { path: 'b', openThreads: 3, issues: { errors: 1, warnings: 1 }, brokenLinks: { draft: null } },
  ];
  assert.deepEqual(
    fieldsWith(fields, (f) => f.openThreads).map((f) => f.path),
    ['b']
  );
  assert.deepEqual(fields.map(fieldProblems), [2, 2]);
});

test('admin events: a request names one field by identity, or by path without a saved key', () => {
  assert.equal(OPEN_FIELD_PANEL_EVENT, 'magic-editor-x:open-field-panel');
  const key = 'AAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(matchesFieldRequest({ field: 'body', path: 'body' }, { path: 'body', savedKey: null }), true);
  assert.equal(
    matchesFieldRequest({ field: 'body', path: 'body' }, { path: 'summary', savedKey: null }),
    false
  );
  assert.equal(
    matchesFieldRequest(
      { field: `sections.body#${key}`, path: 'sections.0.body' },
      { path: 'sections.3.body', savedKey: key }
    ),
    true
  );
  assert.equal(
    matchesFieldRequest(
      { field: `sections.body#${key}`, path: 'sections.0.body' },
      { path: 'sections.0.body', savedKey: null }
    ),
    false
  );
  assert.equal(
    matchesFieldRequest(
      { field: null, path: 'sections.0.body' },
      { path: 'sections.0.body', savedKey: null }
    ),
    true
  );
  assert.equal(matchesFieldRequest(null, { path: 'body', savedKey: null }), false);
});

test('admin source contract: one side panel in bootstrap; widgets with RBAC; sections are a list', () => {
  const index = readFileSync(new URL('../admin/src/index.js', import.meta.url), 'utf8');
  assert.equal((index.match(/addEditViewSidePanel\(/g) || []).length, 1);
  const bootstrap = index.slice(index.indexOf('bootstrap(app)'));
  assert.match(bootstrap, /addEditViewSidePanel\(\[EntryPanel\]\)/);
  for (const id of ['open-threads', 'broken-links']) assert.match(index, new RegExp(`id: '${id}'`));
  const panel = readFileSync(
    new URL('../admin/src/components/EntryPanel/index.jsx', import.meta.url),
    'utf8'
  );
  assert.match(panel, /useRBAC\(PERMISSIONS\.access\)/);
  assert.match(panel, /return null/);
  const sections = readFileSync(
    new URL('../admin/src/components/EntryPanel/sections.jsx', import.meta.url),
    'utf8'
  );
  assert.match(sections, /export const ENTRY_PANEL_SECTIONS = \[/);
  const field = readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  assert.match(field, /window\.addEventListener\(OPEN_FIELD_PANEL_EVENT/);
});

test('checkDocument ignores the locale the Content Manager sends for a type without i18n (2.5)', async () => {
  const uid = 'api::longform.longform';
  const seen = [];
  const strapi = {
    contentType: (name) =>
      name === uid
        ? {
            uid,
            pluginOptions: {},
            attributes: { body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' } },
          }
        : undefined,
    components: {},
    documents: () => ({
      findFirst: async (query) => {
        seen.push(query.locale);
        return { documentId: 'long1' };
      },
    }),
    plugin: (name) => ({
      service: (service) => {
        if (name === 'content-manager' && service === 'permission-checker')
          return {
            create: () => ({
              cannot: { read: () => false, update: () => false },
              sanitizedQuery: { read: async () => ({}), update: async () => ({}) },
            }),
          };
        throw new Error(`unexpected service ${name}.${service}`);
      },
    }),
  };
  const access = require('../server/src/services/access.js')({ strapi });
  const result = await access.checkDocument({ userAbility: {}, uid, documentId: 'long1', locale: 'en' });
  assert.equal(result.locale, null);
  assert.equal(result.canUpdate, true);
  assert.deepEqual(seen, [undefined, undefined], 'documents are read without a locale');
});

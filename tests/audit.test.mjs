import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import {
  fieldChanges,
  fieldIdentity,
  cleanAuditInput,
  AUDIT_EVENTS,
  MAX_BLOCK_IDS,
} from '../shared/audit.mjs';

/**
 * Audit trail (2.4): change summaries (counts and block ids only), field
 * identity, input cleaning, the audit service on a real SQLite store
 * (filters, pagination, retention, anonymisation, disabled trail, actor
 * resolution, Enterprise Audit Logs hand-off), the Document Service
 * middleware (create/update/publish/unpublish/discard/delete, positional
 * fields, 5000-block cost) and a property test with marker strings: no
 * record ever contains block text.
 */

const require = createRequire(import.meta.url);
const knexFactory = require('knex');
const config = require('../server/src/config/index.js');
const createStore = require('../server/src/services/store.js');
const createAudit = require('../server/src/services/audit.js');
const { registerAuditTrail, PLANS } = require('../server/src/utils/audit-trail.js');
const auditController = require('../server/src/controllers/audit.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS, ACTION_DEFINITIONS } = require('../server/src/permissions.js');

const FIELD = { type: 'json', customField: 'plugin::magic-editor-x.richtext' };
const ARTICLE = 'api::article.article';
const MARKER = 'SECRET-MARKER-7Q';

const databases = [];
after(() => Promise.all(databases.map((knex) => knex.destroy())));

const paragraph = (id, text) => ({ id, type: 'paragraph', data: { text } });
const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });

/**
 * Fake Strapi: SQLite store, audit service, Document Service with a
 * registered middleware chain over in-memory rows `{ documentId, locale, status, ...fields }`.
 */
const setup = async ({ settings = {}, requestState = null, enterprise = null } = {}) => {
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  databases.push(knex);
  const conf = { 'audit.enabled': true, 'audit.retentionDays': 180, ...settings };
  const services = {};
  const rows = [];
  const middlewares = [];
  const reads = [];
  const logs = [];
  const emitted = [];
  const strapi = {
    config: { get: (key) => conf[key.replace('plugin::magic-editor-x.', '')] },
    log: {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
      debug() {},
    },
    db: {
      connection: knex,
      getConnection: (name) => knex(name),
      getSchemaConnection: () => knex.schema,
      getSchemaName: () => undefined,
      transaction: (cb) => knex.transaction((trx) => cb({ trx })),
      lifecycles: { subscribe: () => () => {} },
    },
    requestContext: { get: () => (requestState ? { state: requestState } : undefined) },
    eventHub: { emit: (name, payload) => emitted.push({ name, payload }) },
    has: (name) => name === 'audit-logs-lifecycle' && Boolean(enterprise),
    get: () => enterprise,
    contentTypes: {
      [ARTICLE]: {
        uid: ARTICLE,
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
        attributes: {
          title: { type: 'string' },
          body: FIELD,
          sections: { type: 'component', repeatable: true, component: 'shared.section' },
        },
      },
    },
    components: {
      'shared.section': { uid: 'shared.section', attributes: { heading: { type: 'string' }, body: FIELD } },
    },
    contentType: (uid) => strapi.contentTypes[uid],
    plugin: () => ({ service: (name) => services[name] }),
    documents: Object.assign(
      (uid) => {
        const find = async (params) => {
          reads.push(params);
          return rows
            .filter((row) => row.uid === uid && row.documentId === params.filters.documentId)
            .filter((row) => row.status === params.status)
            .filter((row) => params.locale === '*' || row.locale === (params.locale || 'en'))
            .map((row) => structuredClone(row));
        };
        const write = (action) => async (params) => {
          const ctx = { action, uid, params, contentType: strapi.contentTypes[uid] };
          const base = async () => perform(action, uid, params);
          const chain = middlewares.reduceRight((nextFn, mw) => () => mw(ctx, nextFn), base);
          return chain();
        };
        return {
          findMany: find,
          create: write('create'),
          update: write('update'),
          publish: write('publish'),
          unpublish: write('unpublish'),
          discardDraft: write('discardDraft'),
          delete: write('delete'),
        };
      },
      { use: (fn) => middlewares.push(fn) }
    ),
  };
  let nextDoc = 1;
  const perform = (action, uid, params) => {
    const locale = params.locale || 'en';
    const find = (status) =>
      rows.find(
        (row) =>
          row.uid === uid &&
          row.documentId === params.documentId &&
          row.locale === locale &&
          row.status === status
      );
    if (action === 'create') {
      const row = { uid, documentId: `d${nextDoc++}`, locale, status: 'draft', ...params.data };
      rows.push(row);
      return { documentId: row.documentId, locale };
    }
    if (action === 'update') Object.assign(find('draft'), params.data);
    if (action === 'publish') {
      const draft = find('draft');
      const old = find('published');
      if (old) rows.splice(rows.indexOf(old), 1);
      rows.push({ ...structuredClone(draft), status: 'published' });
    }
    if (action === 'unpublish') rows.splice(rows.indexOf(find('published')), 1);
    if (action === 'discardDraft') {
      const draft = find('draft');
      rows.splice(rows.indexOf(draft), 1, { ...structuredClone(find('published')), status: 'draft' });
    }
    if (action === 'delete')
      for (const row of rows.filter((item) => item.documentId === params.documentId))
        rows.splice(rows.indexOf(row), 1);
    return { documentId: params.documentId, locale, entries: [{ locale }] };
  };
  services.store = createStore({ strapi });
  services.audit = createAudit({ strapi });
  await services.store.init();
  registerAuditTrail(strapi);
  const all = async () => knex('magic_editor_x_audit').orderBy('id', 'asc').select('*');
  return { knex, strapi, services, rows, reads, logs, emitted, all, audit: services.audit };
};

test('config: audit is on by default with 180 days; bounds are validated', () => {
  const base = structuredClone(config.default);
  assert.deepEqual(base.audit, { enabled: true, retentionDays: 180 });
  config.validator(base);
  for (const [key, value] of [
    ['enabled', 'yes'],
    ['retentionDays', -1],
    ['retentionDays', 1.5],
    ['retentionDays', 4000],
  ]) {
    const bad = structuredClone(base);
    bad.audit[key] = value;
    assert.throws(() => config.validator(bad), /audit\./);
  }
  const keep = structuredClone(base);
  keep.audit.retentionDays = 0;
  config.validator(keep);
});

test('fieldChanges: added, removed, changed and moved blocks with bounded ids', () => {
  const before = doc(
    paragraph('a', 'one'),
    paragraph('b', 'two'),
    paragraph('c', 'three'),
    paragraph('d', 'four')
  );
  const after = doc(
    paragraph('c', 'three'),
    paragraph('a', 'one!'),
    paragraph('d', 'four'),
    paragraph('e', 'new')
  );
  const summary = fieldChanges(before, after);
  assert.deepEqual(summary.counts, { added: 1, removed: 1, changed: 1, moved: 1, blocks: 4 });
  assert.deepEqual(summary.blockIds, ['a', 'e', 'b']);
  assert.equal(summary.changed, true);
  assert.equal(fieldChanges(before, structuredClone(before)).changed, false);
  assert.deepEqual(fieldChanges(null, before).counts, {
    added: 4,
    removed: 0,
    changed: 0,
    moved: 0,
    blocks: 4,
  });
  assert.deepEqual(fieldChanges(before, null).counts, {
    added: 0,
    removed: 4,
    changed: 0,
    moved: 0,
    blocks: 0,
  });
  const many = doc(...Array.from({ length: 60 }, (_, i) => paragraph(`p${i}`, 'x')));
  assert.equal(fieldChanges(null, many).blockIds.length, MAX_BLOCK_IDS);
  // Tunes count as a change; 1.x JSON strings are read too.
  const tuned = structuredClone(before);
  tuned.blocks[0].tunes = { alignmentTune: { alignment: 'center' } };
  assert.equal(fieldChanges(before, tuned).counts.changed, 1);
  assert.equal(fieldChanges(JSON.stringify(before), before).changed, false);
});

test('fieldIdentity: positional paths use the field key when the value has one', () => {
  assert.equal(fieldIdentity('body', { fieldKey: 'k1' }), 'body');
  assert.equal(fieldIdentity('hero.body', null), 'hero.body');
  assert.equal(
    fieldIdentity('sections.0.body', { fieldKey: 'fk_1aaaaaaaaaaaaaaaaaa' }),
    'sections.body#fk_1aaaaaaaaaaaaaaaaaa'
  );
  assert.equal(
    fieldIdentity('zone.3.inner.1.body', { fieldKey: 'abcaaaaaaaaaaaaaaaaaaa' }),
    'zone.inner.body#abcaaaaaaaaaaaaaaaaaaa'
  );
  assert.equal(fieldIdentity('sections.0.body', {}), 'sections.0.body');
  assert.equal(fieldIdentity('sections.0.body', { fieldKey: 'bad key<' }), 'sections.0.body');
});

test('cleanAuditInput keeps identifiers, integer counts and block ids only', () => {
  assert.equal(cleanAuditInput({ event: 'Not An Event' }), null);
  assert.equal(cleanAuditInput(null), null);
  const clean = cleanAuditInput({
    event: 'entry.update',
    target: { uid: ARTICLE, documentId: 'abc123', locale: 'en', field: `body ${MARKER}` },
    counts: { added: 2, text: MARKER, negative: -1, fraction: 1.5, 'bad key': 1 },
    blockIds: ['ok_1', `<b>${MARKER}</b>`, 'ok_1'],
    meta: { action: 'improve', note: `${MARKER} free text`, keys: ['ai', MARKER + ' x'], 'Bad-Key': 'x' },
    body: MARKER,
  });
  assert.deepEqual(clean, {
    event: 'entry.update',
    uid: ARTICLE,
    documentId: 'abc123',
    locale: 'en',
    field: null,
    counts: { added: 2 },
    blockIds: ['ok_1'],
    meta: { action: 'improve', keys: ['ai'] },
  });
  for (const event of AUDIT_EVENTS) assert.ok(cleanAuditInput({ event }), event);
});

test('property: records never contain block text (random documents with marker strings)', async () => {
  const { strapi, rows, all } = await setup({
    requestState: {
      route: { info: { type: 'admin' } },
      user: { id: 7, firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.test' },
    },
  });
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const randomDoc = (round) =>
    doc(
      ...Array.from({ length: 1 + Math.floor(random() * 12) }, (_, i) => {
        const id = `b${Math.floor(random() * 15)}`;
        const kind = random();
        if (kind < 0.5) return paragraph(id + i, `${MARKER}-${round}-${i} text`);
        if (kind < 0.75) return { id: id + i, type: 'header', data: { text: `${MARKER} heading`, level: 2 } };
        return {
          id: id + i,
          type: 'list',
          data: { style: 'unordered', meta: {}, items: [{ content: `${MARKER} item`, meta: {}, items: [] }] },
        };
      })
    );
  const created = await strapi.documents(ARTICLE).create({ data: { title: MARKER, body: randomDoc(0) } });
  for (let round = 1; round <= 40; round += 1) {
    const data = { body: random() < 0.8 ? randomDoc(round) : rows[0].body };
    if (random() < 0.3) data.sections = [{ heading: MARKER, body: randomDoc(round) }];
    await strapi.documents(ARTICLE).update({ documentId: created.documentId, data });
    if (round % 10 === 0) await strapi.documents(ARTICLE).publish({ documentId: created.documentId });
  }
  const stored = await all();
  assert.ok(stored.length >= 30);
  const text = JSON.stringify(stored);
  assert.equal(text.includes(MARKER), false);
  assert.equal(text.includes('example.test'), false);
  for (const row of stored) {
    assert.equal(row.actor_id, 7);
    assert.equal(row.actor_name, 'Ada Lovelace');
  }
});

test('middleware: one event per changed field for create, update, publish, discard, unpublish and delete', async () => {
  const { strapi, all, reads } = await setup({
    requestState: { route: { info: { type: 'admin' } }, user: { id: 3, firstname: 'Ben' } },
  });
  const docs = strapi.documents(ARTICLE);
  const { documentId } = await docs.create({
    data: { title: 'x', body: doc(paragraph('a', 'one'), paragraph('b', 'two')) },
  });
  await docs.update({ documentId, data: { title: 'only the title' } });
  await docs.update({ documentId, data: { body: doc(paragraph('b', 'two'), paragraph('a', 'one!')) } });
  await docs.publish({ documentId });
  await docs.update({ documentId, data: { body: doc(paragraph('c', 'three')) } });
  await docs.discardDraft({ documentId });
  await docs.unpublish({ documentId });
  await docs.delete({ documentId });
  const events = (await all()).map((row) => ({
    event: row.event,
    field: row.field,
    locale: row.locale,
    counts: JSON.parse(row.counts),
    blockIds: JSON.parse(row.block_ids),
  }));
  assert.deepEqual(
    events.map((event) => event.event),
    [
      'entry.create',
      'entry.update',
      'entry.publish',
      'entry.update',
      'entry.discard',
      'entry.unpublish',
      'entry.delete',
    ]
  );
  assert.deepEqual(events[0].counts, { added: 2, removed: 0, changed: 0, moved: 0, blocks: 2 });
  assert.deepEqual(events[1].counts, { added: 0, removed: 0, changed: 1, moved: 1, blocks: 2 });
  assert.deepEqual(events[1].blockIds, ['a']);
  assert.deepEqual(events[2].counts, { added: 2, removed: 0, changed: 0, moved: 0, blocks: 2 });
  assert.deepEqual(events[4].counts, { added: 2, removed: 1, changed: 0, moved: 0, blocks: 2 });
  assert.equal(events[5].counts.removed, 2);
  assert.equal(events[6].counts.removed, 2);
  assert.ok(events.every((event) => event.field === 'body' && event.locale === 'en'));
  // The reads ask for editor fields only (components populated with their editor fields).
  for (const read of reads) {
    assert.ok(!read.fields.includes('title'));
    assert.deepEqual(read.populate, { sections: { fields: ['body'] } });
  }
});

test('middleware: positional fields are keyed by path without indices plus fieldKey', async () => {
  const { strapi, all } = await setup();
  const docs = strapi.documents(ARTICLE);
  const { documentId } = await docs.create({
    data: {
      sections: [
        { heading: 'h', body: { ...doc(paragraph('a', 'x')), fieldKey: 'key1aaaaaaaaaaaaaaaaaa' } },
        { heading: 'h', body: doc(paragraph('b', 'y')) },
      ],
    },
  });
  const fields = (await all()).map((row) => row.field).sort();
  assert.deepEqual(fields, ['sections.1.body', 'sections.body#key1aaaaaaaaaaaaaaaaaa']);
  const events = await all();
  assert.ok(events.every((row) => row.actor_kind === 'system' && row.actor_id === null));
  assert.equal(typeof documentId, 'string');
});

test('middleware: Content API writes are recorded without an actor id', async () => {
  const { strapi, all } = await setup({
    requestState: {
      route: { info: { type: 'content-api' } },
      auth: { strategy: { name: 'api-token' } },
      user: { id: 99 },
    },
  });
  await strapi.documents(ARTICLE).create({ data: { body: doc(paragraph('a', 'x')) } });
  const [row] = await all();
  assert.equal(row.actor_kind, 'api');
  assert.equal(row.actor_id, null);
  assert.equal(row.actor_name, null);
});

test('middleware: audit.enabled false records nothing and reads nothing', async () => {
  const { strapi, all, reads } = await setup({ settings: { 'audit.enabled': false } });
  await strapi.documents(ARTICLE).create({ data: { body: doc(paragraph('a', 'x')) } });
  assert.equal((await all()).length, 0);
  assert.equal(reads.length, 0);
  assert.deepEqual(Object.keys(PLANS).sort(), [
    'create',
    'delete',
    'discardDraft',
    'publish',
    'unpublish',
    'update',
  ]);
});

test('performance: comparing two 5000-block versions stays linear and fast', () => {
  const make = (count, edit) =>
    doc(
      ...Array.from({ length: count }, (_, i) =>
        paragraph(`p${i}`, `Paragraph ${i} with <b>bold</b> text${edit && i % 50 === 0 ? ' edited' : ''}`)
      )
    );
  const time = (count) => {
    const before = make(count, false);
    const after = make(count, true);
    fieldChanges(before, after);
    const start = performance.now();
    for (let i = 0; i < 5; i += 1) fieldChanges(before, after);
    return (performance.now() - start) / 5;
  };
  const small = time(500);
  const large = time(5000);
  assert.equal(fieldChanges(make(5000, false), make(5000, true)).counts.changed, 100);
  assert.ok(large < 250, `5000 blocks took ${large.toFixed(1)} ms`);
  assert.ok(large / Math.max(small, 0.05) < 30, `scaling ${(large / small).toFixed(1)}`);
});

test('service: filters, pagination, actor ids only for global listings, own flag', async () => {
  const { audit } = await setup();
  const ada = { id: 1, firstname: 'Ada', lastname: 'L' };
  const ben = { id: 2, firstname: 'Ben' };
  for (let i = 0; i < 30; i += 1)
    await audit.record({
      event: i % 2 ? 'entry.update' : 'comment.create',
      target: { uid: ARTICLE, documentId: i < 20 ? 'doca' : 'docb', locale: 'en', field: 'body' },
      counts: { added: i },
      actor: i % 3 ? ada : ben,
    });
  const page1 = await audit.list({ documentId: 'doca' }, { page: 1, pageSize: 8, viewerId: 1 });
  assert.equal(page1.pagination.total, 20);
  assert.equal(page1.pagination.pageCount, 3);
  assert.equal(page1.results.length, 8);
  assert.equal(page1.results[0].counts.added, 19);
  assert.equal('id' in page1.results[0].actor, false);
  assert.equal(page1.results.find((row) => row.actor.name === 'Ada L').actor.own, true);
  const global = await audit.list(
    { event: 'comment.create', actorId: 2 },
    { page: 1, pageSize: 100, withActorIds: true }
  );
  assert.ok(global.results.every((row) => row.event === 'comment.create' && row.actor.id === 2));
  const actors = await audit.actors();
  assert.deepEqual(actors, [
    { id: 1, name: 'Ada L' },
    { id: 2, name: 'Ben' },
  ]);
  const future = await audit.list({ from: Date.now() + 60000 }, { page: 1, pageSize: 10 });
  assert.equal(future.pagination.total, 0);
});

test('service: retention prunes old rows once per hour across processes; 0 keeps everything', async () => {
  const { audit, knex, services } = await setup({ settings: { 'audit.retentionDays': 30 } });
  await audit.record({ event: 'settings.update', meta: { keys: ['ai'] } });
  await knex('magic_editor_x_audit').update({ created_at: Date.now() - 31 * 86400000 });
  await audit.record({ event: 'settings.update' });
  const now = Date.now();
  assert.equal(await audit.pruneTick(now), 1);
  assert.equal(await audit.pruneTick(now), null);
  assert.equal((await knex('magic_editor_x_audit').count({ c: '*' }))[0].c, 1);
  const keep = createAudit({
    strapi: {
      ...services.audit,
      config: { get: (key) => (key.endsWith('retentionDays') ? 0 : true) },
      plugin: () => ({ service: () => services.store }),
      log: { info() {}, warn() {} },
    },
  });
  await knex('magic_editor_x_audit').update({ created_at: 1 });
  assert.equal(await keep.prune(), 0);
});

test('service: a deleted admin is anonymised; events stay', async () => {
  const { audit, all } = await setup();
  await audit.record({ event: 'template.create', actor: { id: 5, firstname: 'Cora' } });
  await audit.record({ event: 'template.update', actor: { id: 6, firstname: 'Dan' } });
  await audit.anonymizeUser(5);
  const rows = await all();
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].actor_id, rows[0].actor_name, rows[0].actor_kind], [null, null, 'deleted']);
  assert.equal(rows[1].actor_name, 'Dan');
  const listed = await audit.list({}, { page: 1, pageSize: 10 });
  assert.equal(listed.results[1].actor.deleted, true);
});

test('service: never throws; a store failure is logged without data', async () => {
  const { audit, services, logs } = await setup();
  services.store.appendAudit = async () => {
    throw Object.assign(new Error(MARKER), { code: 'X' });
  };
  assert.equal(await audit.record({ event: 'entry.update', meta: { action: 'improve' } }), false);
  assert.equal(JSON.stringify(logs).includes(MARKER), false);
});

test('Enterprise Audit Logs: events are registered and emitted only when the feature exists', async () => {
  const registered = new Map();
  const enterprise = { registerEvent: (name, transform) => registered.set(name, transform) };
  const { audit, emitted } = await setup({ enterprise });
  audit.start();
  audit.stop();
  assert.equal(audit.enterpriseEnabled(), true);
  assert.ok(registered.has('magic-editor-x.entry.update'));
  await audit.record({
    event: 'entry.update',
    target: { uid: ARTICLE, documentId: 'abc', locale: 'en', field: 'body' },
    counts: { changed: 1 },
    blockIds: ['a'],
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].name, 'magic-editor-x.entry.update');
  const shape = registered.get('magic-editor-x.entry.update')(emitted[0].payload);
  assert.deepEqual(shape.resource, { type: 'magic-editor-x', uid: ARTICLE, id: 'abc' });
  // Other features' events are registered on first use.
  await audit.record({ event: 'suggestion.accept' });
  assert.ok(registered.has('magic-editor-x.suggestion.accept'));
  const plain = await setup();
  plain.audit.start();
  plain.audit.stop();
  await plain.audit.record({ event: 'entry.update' });
  assert.equal(plain.emitted.length, 0);
});

test('route and permission: GET /audit needs audit.read; global listings also settings.read', async () => {
  const list = routes.admin.routes.find((route) => route.path === '/audit');
  assert.deepEqual(list.config.policies[1].config.actions, [ACTIONS.auditRead]);
  const actors = routes.admin.routes.find((route) => route.path === '/audit/actors');
  assert.deepEqual(actors.config.policies[1].config.actions, [ACTIONS.auditRead, ACTIONS.settingsRead]);
  assert.ok(ACTION_DEFINITIONS.some((action) => action.uid === 'audit.read'));

  const calls = [];
  const fakeAudit = {
    enabled: () => true,
    list: async (filters, options) => {
      calls.push({ filters, options });
      return { results: [], pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } };
    },
  };
  const checked = [];
  const strapi = {
    plugin: () => ({
      service: (name) =>
        name === 'audit'
          ? fakeAudit
          : {
              checkField: async (target) => {
                checked.push(target);
                if (target.documentId === 'hidden') {
                  const { errors } = require('@strapi/utils');
                  throw new errors.NotFoundError('Not found');
                }
                return { locale: 'en', canUpdate: false };
              },
            },
    }),
  };
  const controller = auditController({ strapi });
  const ctx = (query, abilities) => ({
    query,
    state: { user: { id: 4 }, userAbility: { can: (action) => abilities.includes(action) } },
  });
  // Field scope: CM access check, no settings.read needed.
  const field = ctx({ uid: ARTICLE, documentId: 'abc', field: 'body' }, [ACTIONS.auditRead]);
  await controller.list(field);
  assert.equal(field.body.meta.scope, 'field');
  assert.deepEqual(calls[0].filters.field, 'body');
  assert.equal(calls[0].filters.locale, 'en');
  assert.equal(calls[0].options.withActorIds, false);
  await assert.rejects(
    controller.list(ctx({ uid: ARTICLE, documentId: 'hidden', field: 'body' }, [ACTIONS.auditRead])),
    { name: 'NotFoundError' }
  );
  // Global: 403 without settings.read.
  await assert.rejects(controller.list(ctx({}, [ACTIONS.auditRead])), { name: 'ForbiddenError' });
  await assert.rejects(controller.list(ctx({ uid: ARTICLE, documentId: 'abc' }, [ACTIONS.auditRead])), {
    name: 'ForbiddenError',
  });
  const global = ctx({ event: 'entry.update', page: '2', pageSize: '10', from: '2026-11-01' }, [
    ACTIONS.auditRead,
    ACTIONS.settingsRead,
  ]);
  await controller.list(global);
  assert.equal(global.body.meta.scope, 'global');
  assert.equal(calls.at(-1).options.withActorIds, true);
  assert.equal(calls.at(-1).filters.from, Date.parse('2026-11-01'));
  // Strict, bounded input.
  for (const query of [
    { unknown: '1' },
    { pageSize: '101' },
    { field: 'body' },
    { event: 'DROP TABLE' },
    { from: 'yesterday' },
    { from: '2026-11-02', to: '2026-11-01' },
    { uid: ARTICLE, documentId: 'abc', field: 'sections.0.body', fieldKey: 'x y' },
  ])
    await assert.rejects(controller.list(ctx(query, [ACTIONS.auditRead, ACTIONS.settingsRead])), {
      name: 'ValidationError',
    });
  // A positional field with its key is looked up by identity.
  await controller.list(
    ctx({ uid: ARTICLE, documentId: 'abc', field: 'sections.0.body', fieldKey: 'k1aaaaaaaaaaaaaaaaaaaa' }, [
      ACTIONS.auditRead,
    ])
  );
  assert.equal(calls.at(-1).filters.field, 'sections.body#k1aaaaaaaaaaaaaaaaaaaa');
  assert.equal(checked.at(-1).field, 'sections.0.body');
});

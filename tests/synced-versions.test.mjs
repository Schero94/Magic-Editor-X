import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/**
 * Version history of synced block sources (2.4): a version per save of a
 * synced source (create, update, restore), identical saves skipped, the
 * per-source limit, author name snapshot without admin id, routes limited
 * to synced sources (404 for other kinds and other sources' versions),
 * restore as a normal update, rename, delete with the source, anonymised
 * authors and the audit events of template writes. Field history routes
 * never return these rows.
 */

const require = createRequire(import.meta.url);
const templatesService = require('../server/src/services/templates.js');
const versionsService = require('../server/src/services/synced-versions.js');
const templatesController = require('../server/src/controllers/templates.js');
const historyController = require('../server/src/controllers/history.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS } = require('../server/src/permissions.js');

const SNAPSHOT_UID = 'plugin::magic-editor-x.document-snapshot';

/** In-memory query engine for one content type (equality, `$in`, orderBy, offset, limit). */
const fakeQuery = (prefix) => {
  const rows = [];
  let id = 0;
  const match = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(row[key]);
      return (row[key] ?? null) === value;
    });
  const sort = (list, orderBy) => {
    const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...list].sort((a, b) => {
      for (const order of orders) {
        const [key, dir] = Object.entries(order)[0];
        if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  };
  return {
    rows,
    findMany: async ({ where, orderBy, limit, offset = 0 } = {}) =>
      sort(
        rows.filter((row) => match(row, where)),
        orderBy
      ).slice(offset, offset + (limit || 1000)),
    findOne: async ({ where }) => rows.find((row) => match(row, where)) || null,
    count: async () => rows.length,
    create: async ({ data }) => {
      id += 1;
      const row = { id, documentId: `${prefix}${id}`, createdAt: `t${id}`, updatedAt: `t${id}`, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = rows.find((item) => match(item, where));
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }) => {
      for (const row of rows.filter((item) => match(item, where))) Object.assign(row, data);
    },
    delete: async ({ where }) => {
      rows.splice(
        rows.findIndex((item) => match(item, where)),
        1
      );
    },
    deleteMany: async ({ where }) => {
      const gone = rows.filter((item) => match(item, where));
      for (const row of gone) rows.splice(rows.indexOf(row), 1);
      return { count: gone.length };
    },
  };
};

const setup = (config = {}) => {
  const templates = fakeQuery('tpl');
  const snapshots = fakeQuery('ver');
  const audit = [];
  const services = {};
  const strapi = {
    db: {
      query: (uid) => (uid === SNAPSHOT_UID ? snapshots : templates),
      transaction: async (fn) => fn(),
    },
    contentTypes: {},
    components: {},
    contentType: () => undefined,
    config: { get: (key) => config[key.replace('plugin::magic-editor-x.', '')] },
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = { acquire: async () => true, release: async () => {} };
  services.audit = { record: async (input) => audit.push(input) };
  services.templates = templatesService({ strapi });
  services['synced-versions'] = versionsService({ strapi });
  return { strapi, services, templates, snapshots, audit };
};

const doc = (...texts) => ({
  time: 1,
  version: '2.31.7',
  blocks: texts.map((text, index) => ({ id: `b${index}`, type: 'paragraph', data: { text } })),
});
const source = (overrides = {}) => ({
  name: 'Footer',
  kind: 'synced',
  blocks: doc('Contact us'),
  scope: { all: true },
  ...overrides,
});
const ada = { id: 11, firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.test' };

test('every save of a synced source stores a version; identical saves do not', async () => {
  const { services, snapshots } = setup();
  const created = await services.templates.create(source(), ada);
  await services.templates.update(created.id, source(), ada);
  await services.templates.update(created.id, source({ blocks: doc('Contact us', 'Call us') }), ada);
  await services.templates.update(
    created.id,
    source({ name: 'Footer 2', blocks: doc('Contact us', 'Call us') }),
    ada
  );
  const list = await services['synced-versions'].list(created.id);
  assert.deepEqual(
    list.map((version) => [version.version, version.name, version.blockCount, version.trigger]),
    [
      [3, 'Footer 2', 2, 'manual'],
      [2, 'Footer', 2, 'manual'],
      [1, 'Footer', 1, 'manual'],
    ]
  );
  assert.deepEqual(list[0].createdBy, { name: 'Ada Lovelace' });
  assert.equal(JSON.stringify(list).includes('11'), false);
  assert.equal(JSON.stringify(list).includes('example.test'), false);
  assert.ok(snapshots.rows.every((row) => row.contentType === 'plugin::magic-editor-x.template'));
  assert.ok(snapshots.rows.every((row) => row.fieldName === 'blocks' && row.entryLocale === null));
  assert.equal(snapshots.rows[0].roomId, `plugin::magic-editor-x.template|${created.id}|-|blocks`);
});

test('templates and patterns get no versions; the version routes answer 404 for them', async () => {
  const { services, snapshots, strapi } = setup();
  const pattern = await services.templates.create(source({ kind: 'pattern' }), ada);
  await services.templates.update(pattern.id, source({ kind: 'pattern', blocks: doc('x') }), ada);
  assert.equal(snapshots.rows.length, 0);
  const controller = templatesController({ strapi });
  const ctx = (params, query = {}) => ({ params, query, request: { body: {} }, state: { user: ada } });
  await assert.rejects(controller.versions(ctx({ id: pattern.id })), { name: 'NotFoundError' });
  await assert.rejects(controller.version(ctx({ id: pattern.id, versionId: 'ver1' })), {
    name: 'NotFoundError',
  });
  await assert.rejects(controller.versions(ctx({ id: 'missing' })), { name: 'NotFoundError' });
  await assert.rejects(controller.versions(ctx({ id: 'BAD!' })), { name: 'ValidationError' });
});

test('a version of another source answers 404; strict params and label body', async () => {
  const { services, strapi } = setup();
  const one = await services.templates.create(source(), ada);
  const two = await services.templates.create(source({ name: 'Other' }), ada);
  const [twoVersion] = await services['synced-versions'].list(two.id);
  const controller = templatesController({ strapi });
  const ctx = (params, body = {}, query = {}) => ({ params, query, request: { body }, state: { user: ada } });
  await assert.rejects(controller.version(ctx({ id: one.id, versionId: twoVersion.id })), {
    name: 'NotFoundError',
  });
  await assert.rejects(controller.restoreVersion(ctx({ id: one.id, versionId: twoVersion.id })), {
    name: 'NotFoundError',
  });
  await assert.rejects(controller.versions(ctx({ id: one.id }, {}, { page: '1' })), {
    name: 'ValidationError',
  });
  const [oneVersion] = await services['synced-versions'].list(one.id);
  await assert.rejects(
    controller.renameVersion(ctx({ id: one.id, versionId: oneVersion.id }, { label: 'x'.repeat(121) })),
    { name: 'ValidationError' }
  );
  await assert.rejects(
    controller.renameVersion(ctx({ id: one.id, versionId: oneVersion.id }, { label: 'ok', extra: 1 })),
    { name: 'ValidationError' }
  );
  // @koa/router also puts numbered captures on ctx.params; only id and versionId are read.
  const renamed = ctx({ id: one.id, versionId: oneVersion.id, 0: 'x' }, { label: '  Launch copy  ' });
  await controller.renameVersion(renamed);
  assert.equal(renamed.body.data.label, 'Launch copy');
  const loaded = ctx({ id: one.id, versionId: oneVersion.id });
  await controller.version(loaded);
  assert.deepEqual(
    loaded.body.data.content.blocks.map((block) => block.data.text),
    ['Contact us']
  );
});

test('restore is a normal update: re-validated, a new version with trigger restore, scope kept', async () => {
  const { services, strapi, audit } = setup();
  const created = await services.templates.create(source({ description: 'Shared footer' }), ada);
  await services.templates.update(
    created.id,
    source({ name: 'Renamed', description: 'Shared footer', blocks: doc('New text'), enabled: false }),
    ada
  );
  const [, first] = await services['synced-versions'].list(created.id);
  const controller = templatesController({ strapi });
  const ctx = {
    params: { id: created.id, versionId: first.id },
    query: {},
    request: { body: {} },
    state: { user: ada },
  };
  await controller.restoreVersion(ctx);
  assert.equal(ctx.body.data.name, 'Footer');
  assert.deepEqual(
    ctx.body.data.blocks.blocks.map((block) => block.data.text),
    ['Contact us']
  );
  assert.equal(ctx.body.data.description, 'Shared footer');
  assert.equal(ctx.body.data.enabled, false);
  const list = await services['synced-versions'].list(created.id);
  assert.equal(list.length, 3);
  assert.equal(list[0].trigger, 'restore');
  assert.ok(audit.some((event) => event.event === 'synced.restore'));
  // A body is refused.
  await assert.rejects(controller.restoreVersion({ ...ctx, request: { body: { force: true } } }), {
    name: 'ValidationError',
  });
});

test('the per-source limit reuses history.maxSnapshotsPerField', async () => {
  const { services } = setup({ 'history.maxSnapshotsPerField': 3 });
  const created = await services.templates.create(source(), ada);
  for (let i = 0; i < 6; i += 1)
    await services.templates.update(created.id, source({ blocks: doc(`Text ${i}`) }), ada);
  const list = await services['synced-versions'].list(created.id);
  assert.deepEqual(
    list.map((version) => version.version),
    [7, 6, 5]
  );
});

test('deleting a source deletes its versions; a deleted admin loses the name', async () => {
  const { services, snapshots } = setup();
  const keep = await services.templates.create(source({ name: 'Keep' }), ada);
  const gone = await services.templates.create(source({ name: 'Gone' }), { id: 12, firstname: 'Ben' });
  assert.equal(snapshots.rows.length, 2);
  await services.templates.remove(gone.id, ada);
  assert.deepEqual(
    snapshots.rows.map((row) => row.entryId),
    [keep.id]
  );
  await services['synced-versions'].anonymizeUser(11);
  const [version] = await services['synced-versions'].list(keep.id);
  assert.equal(version.createdBy, null);
  assert.equal(snapshots.rows[0].authorId, null);
});

test('template writes record audit events without content', async () => {
  const { services, audit } = setup();
  const tpl = await services.templates.create(source({ kind: 'template', blocks: doc('SECRET text') }), ada);
  await services.templates.update(tpl.id, source({ kind: 'template', blocks: doc('SECRET 2') }), ada);
  await services.templates.remove(tpl.id, ada);
  const synced = await services.templates.create(source(), ada);
  assert.deepEqual(
    audit.map((event) => event.event),
    ['template.create', 'template.update', 'template.delete', 'synced.create']
  );
  assert.equal(JSON.stringify(audit.map(({ actor, ...rest }) => rest)).includes('SECRET'), false);
  assert.equal(audit[3].target.documentId, synced.id);
});

test('routes need templates.manage; field history never serves a source version', async () => {
  for (const path of [
    '/templates/:id/versions',
    '/templates/:id/versions/:versionId',
    '/templates/:id/versions/:versionId/restore',
  ]) {
    const route = routes.admin.routes.find((item) => item.path === path);
    assert.deepEqual(
      route.config.policies[1].config.actions,
      [ACTIONS.access, ACTIONS.templatesManage],
      path
    );
  }
  const { services, strapi } = setup();
  const created = await services.templates.create(source(), ada);
  const [version] = await services['synced-versions'].list(created.id);
  // GET /history/:id loads the row, then checks Content Manager access to its target:
  // the real access service answers 404 for every non-api:: type.
  const accessService = require('../server/src/services/access.js')({
    strapi: { contentType: () => ({ uid: 'plugin::magic-editor-x.template', attributes: {} }) },
  });
  services.history = require('../server/src/services/history.js')({ strapi });
  services.access = accessService;
  const controller = historyController({ strapi });
  await assert.rejects(
    controller.findOne({ params: { id: version.id }, query: {}, state: { userAbility: {}, user: ada } }),
    { name: 'NotFoundError' }
  );
});

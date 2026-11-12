/**
 * Named versions: history service (label on create, naming the latest
 * version, rename) and the PUT /history/:id controller (validation, access).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const historyService = require('../server/src/services/history.js');
const historyController = require('../server/src/controllers/history.js');
const routes = require('../server/src/routes/index.js');
const contentTypes = require('../server/src/content-types/index.js');

/** In-memory stand-in for strapi.db.query('plugin::magic-editor-x.document-snapshot'). */
const fakeQuery = () => {
  const rows = [];
  let nextId = 1;
  const matches = (row, where) =>
    Object.entries(where).every(([key, value]) => {
      if (key === '$or') return value.some((part) => matches(row, part));
      if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(row[key]);
      return (row[key] ?? null) === value;
    });
  const sorted = (list) => [...list].sort((a, b) => b.version - a.version || b.id - a.id);
  return {
    rows,
    findMany: async ({ where, limit, offset = 0 }) =>
      sorted(rows.filter((row) => matches(row, where))).slice(offset, limit ? offset + limit : undefined),
    findOne: async ({ where }) => rows.find((row) => matches(row, where)) || null,
    create: async ({ data }) => {
      const row = { id: nextId, documentId: `v${nextId}`, createdAt: '2026-11-11T10:00:00.000Z', ...data };
      nextId += 1;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) return null;
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }) => {
      for (const row of rows.filter((candidate) => matches(candidate, where)))
        rows.splice(rows.indexOf(row), 1);
    },
  };
};

const fakeStrapi = (query) => {
  const services = {};
  const strapi = {
    db: { query: () => query },
    config: { get: () => undefined },
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = { acquire: async () => true, release: async () => true };
  services.history = historyService({ strapi });
  return { strapi, services };
};

const target = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' };
const content = (text) => ({
  time: 1,
  version: '2.31.7',
  blocks: [{ id: 'a', type: 'paragraph', data: { text } }],
});

test('the snapshot content type has an optional label column', () => {
  assert.deepEqual(contentTypes['document-snapshot'].schema.attributes.label, {
    type: 'string',
    maxLength: 120,
  });
});

test('create stores a label, list returns it', async () => {
  const { services } = fakeStrapi(fakeQuery());
  const first = await services.history.create(target, content('One'), { label: '  Before review  ' });
  assert.equal(first.created, true);
  assert.equal(first.snapshot.label, 'Before review');
  const second = await services.history.create(target, content('Two'));
  assert.equal(second.snapshot.label, null);
  const list = await services.history.list(target);
  assert.deepEqual(
    list.map((item) => [item.version, item.label]),
    [
      [2, null],
      [1, 'Before review'],
    ]
  );
});

test('a label for unchanged content names the latest version instead of creating one', async () => {
  const query = fakeQuery();
  const { services } = fakeStrapi(query);
  await services.history.create(target, content('Same'));
  const outcome = await services.history.create(target, content('Same'), { label: 'Approved' });
  assert.equal(outcome.created, false);
  assert.equal(outcome.snapshot.version, 1);
  assert.equal(outcome.snapshot.label, 'Approved');
  assert.equal(query.rows.length, 1);
  const unchanged = await services.history.create(target, content('Same'));
  assert.equal(unchanged.created, false);
  assert.equal(unchanged.snapshot.label, 'Approved');
});

// 2.4: Editor.js writes default tune values into every block it saves, stored
// content often has none. Identical content must not create a version (seen as
// session-end versions without changes).
test('default tune values do not make content different; stored data keeps its tunes', async () => {
  const { comparableBlocks } = await import('../shared/default-tunes.mjs');
  const query = fakeQuery();
  const { services } = fakeStrapi(query);
  const withTunes = (text, tunes) => ({
    ...content(text),
    blocks: [{ id: 'a', type: 'paragraph', data: { text }, tunes }],
  });
  const defaults = { alignmentTune: { alignment: 'left' }, textVariant: '', indentTune: { indentLevel: 0 } };
  assert.equal((await services.history.create(target, content('Same'))).created, true);
  const again = await services.history.create(target, withTunes('Same', defaults), { trigger: 'auto' });
  assert.equal(again.created, false);
  assert.equal(query.rows.length, 1);
  // A real tune change is a change, and the version keeps the tunes as stored.
  const centered = withTunes('Same', { ...defaults, alignmentTune: { alignment: 'center' } });
  const changed = await services.history.create(target, centered, { trigger: 'auto' });
  assert.equal(changed.created, true);
  assert.deepEqual(query.rows[1].jsonContent.blocks[0].tunes.alignmentTune, { alignment: 'center' });
  assert.deepEqual(query.rows[1].jsonContent.blocks[0].tunes.indentTune, { indentLevel: 0 });
  // The default form of the same content again is a change back (alignment left).
  assert.equal((await services.history.create(target, withTunes('Same', defaults))).created, true);
  assert.deepEqual(comparableBlocks([{ id: 'a', type: 'p', data: {}, tunes: defaults }]), [
    { id: 'a', type: 'p', data: {} },
  ]);
});

test('a version stored before 2.4 (hash with default tunes) is recognised as unchanged content', async () => {
  const { createHash } = await import('node:crypto');
  const { stableStringify } = await import('../shared/ydoc.mjs');
  const query = fakeQuery();
  const { services } = fakeStrapi(query);
  const old = {
    ...content('Kept'),
    blocks: [
      { id: 'a', type: 'paragraph', data: { text: 'Kept' }, tunes: { alignmentTune: { alignment: 'left' } } },
    ],
  };
  await query.create({
    data: {
      ...target,
      roomId: 'legacy',
      contentType: target.uid,
      entryId: target.documentId,
      entryLocale: target.locale,
      fieldName: target.field,
      version: 1,
      trigger: 'auto',
      contentHash: createHash('sha256').update(stableStringify(old.blocks)).digest('hex'),
      jsonContent: old,
    },
  });
  const outcome = await services.history.create(target, content('Kept'), { trigger: 'auto' });
  assert.equal(outcome.created, false);
  assert.equal(query.rows.length, 1);
});

test('rename sets, normalises and clears labels; unknown ids are 404', async () => {
  const { services } = fakeStrapi(fakeQuery());
  const { snapshot } = await services.history.create(target, content('One'));
  assert.equal((await services.history.rename(snapshot.id, 'Line\u0000one\ttwo')).label, 'Line one two');
  assert.equal((await services.history.rename(snapshot.id, 'x'.repeat(300))).label.length, 120);
  assert.equal((await services.history.rename(snapshot.id, '')).label, null);
  assert.equal((await services.history.rename(snapshot.id, null)).label, null);
  await assert.rejects(services.history.rename('missing', 'x'), (error) => error.name === 'NotFoundError');
  await assert.rejects(services.history.rename('../x', 'x'), (error) => error.name === 'NotFoundError');
});

/** Controller with a fake access service: `canRead`/`canUpdate` decide the outcome. */
const controllerFor = ({ canRead = true, canUpdate = true } = {}) => {
  const query = fakeQuery();
  const { strapi, services } = fakeStrapi(query);
  const checked = [];
  services.access = {
    checkField: async (input) => {
      checked.push(input);
      if (!canRead) {
        const error = new Error('Not found');
        error.name = 'NotFoundError';
        throw error;
      }
      return {
        canRead: true,
        canUpdate,
        locale: input.locale || null,
        fieldName: input.field,
        positional: false,
      };
    },
  };
  return { controller: historyController({ strapi }), services, checked, query };
};

const context = (params, body) => {
  const ctx = {
    params,
    request: { body },
    state: { userAbility: {}, user: { id: 7 } },
    status: 200,
    body: undefined,
    forbidden(message) {
      ctx.status = 403;
      ctx.body = { error: message };
    },
  };
  return ctx;
};

test('PUT /history/:id renames after a Content Manager update check', async () => {
  const { controller, services, checked } = controllerFor();
  const { snapshot } = await services.history.create(target, content('One'));
  const ctx = context({ id: snapshot.id }, { label: 'Final' });
  await controller.rename(ctx);
  assert.equal(ctx.body.data.label, 'Final');
  assert.equal(ctx.body.data.content, undefined);
  assert.deepEqual(checked[0], { userAbility: {}, ...target });
});

test('PUT /history/:id: viewer 403, no access 404, missing version 404', async () => {
  const viewer = controllerFor({ canUpdate: false });
  const { snapshot } = await viewer.services.history.create(target, content('One'));
  const ctx = context({ id: snapshot.id }, { label: 'X' });
  await viewer.controller.rename(ctx);
  assert.equal(ctx.status, 403);
  assert.equal(viewer.query.rows[0].label ?? null, null);

  const stranger = controllerFor({ canRead: false });
  const other = await stranger.services.history.create(target, content('One'));
  await assert.rejects(
    stranger.controller.rename(context({ id: other.snapshot.id }, { label: 'X' })),
    (error) => error.name === 'NotFoundError'
  );
  await assert.rejects(
    stranger.controller.rename(context({ id: 'nope' }, { label: 'X' })),
    (error) => error.name === 'NotFoundError'
  );
});

test('PUT /history/:id validates strictly', async () => {
  const { controller, services } = controllerFor();
  const { snapshot } = await services.history.create(target, content('One'));
  for (const body of [
    {},
    { label: 'x'.repeat(121) },
    { label: 'bad\u0007char' },
    { label: 3 },
    { label: 'ok', extra: true },
  ]) {
    await assert.rejects(
      controller.rename(context({ id: snapshot.id }, body)),
      (error) => error.name === 'ValidationError',
      JSON.stringify(body)
    );
  }
  await assert.rejects(
    controller.rename(context({ id: 'A-B' }, { label: 'x' })),
    (error) => error.name === 'ValidationError'
  );
  const cleared = context({ id: snapshot.id }, { label: null });
  await controller.rename(cleared);
  assert.equal(cleared.body.data.label, null);
});

test('POST /history passes an optional label', async () => {
  const { controller } = controllerFor();
  const ctx = context({}, { ...target, content: content('One'), label: 'First draft' });
  await controller.create(ctx);
  assert.equal(ctx.status, 201);
  assert.equal(ctx.body.data.label, 'First draft');
  await assert.rejects(
    controller.create(context({}, { ...target, content: content('Two'), label: 'x'.repeat(121) })),
    (error) => error.name === 'ValidationError'
  );
});

test('the rename route requires the access action', () => {
  const route = routes.admin.routes.find((item) => item.method === 'PUT' && item.path === '/history/:id');
  assert.equal(route.handler, 'history.rename');
  const policy = route.config.policies.find((item) => item.name === 'admin::hasPermissions');
  assert.deepEqual(policy.config.actions, ['plugin::magic-editor-x.access']);
});

test('the diff view renders text only', () => {
  for (const file of ['VersionDiff.jsx', 'HistoryModal.jsx']) {
    const source = readFileSync(
      new URL(`../admin/src/components/EditorField/${file}`, import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/, file);
  }
});

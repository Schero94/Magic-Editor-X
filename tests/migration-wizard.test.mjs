import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migrateService = require('../server/src/services/migrate.js');
const wizardService = require('../server/src/services/migration-wizard.js');
const { MigrationConflictError, BATCH_SIZE } = wizardService;

/**
 * 2.13 admin migration wizard: Content Manager rights, previews, backups, batched jobs, the
 * field and batch leases, "Before migration" versions and cancel. The Document Service, the
 * locks table, the core store and the permission checker are in-memory fakes.
 */

const UID = 'api::article.article';
const blocks = (text) => [{ type: 'paragraph', children: [{ type: 'text', text }] }];

/**
 * Fake Strapi for the wizard.
 * @param {object} [options] - `rows`, `localized`, `deny` ('read'|'update'|'type'), `locales` the role may use, `filters` from the permission query.
 * @returns {object} Fake with recorders.
 */
const fakeStrapi = (options = {}) => {
  const rows =
    options.rows ||
    Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      documentId: `doc${String(index + 1).padStart(3, '0')}`,
      locale: 'en',
      title: `Title ${index + 1}`,
      body: index % 10 === 9 ? null : blocks(`Synthetic paragraph ${index + 1}`),
      content: index === 3 ? { blocks: [{ id: 'k', type: 'paragraph', data: { text: 'kept' } }] } : null,
    }));
  const contentType = {
    uid: UID,
    kind: 'collectionType',
    info: { displayName: 'Article' },
    options: { draftAndPublish: true },
    pluginOptions: options.localized ? { i18n: { localized: true } } : {},
    attributes: {
      title: { type: 'string' },
      body: { type: 'blocks' },
      notes: { type: 'json' },
      content: {
        type: 'json',
        customField: 'plugin::magic-editor-x.richtext',
        options: { preset: 'simple' },
      },
    },
  };
  const recorded = { updates: [], findMany: [], audits: [], versions: [] };
  const lockRows = new Map();
  const kv = new Map();
  const services = {};
  const strapi = {
    contentTypes: { [UID]: contentType },
    contentType: (uid) => (uid === UID ? contentType : undefined),
    config: { get: () => undefined },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    store: () => ({
      get: async ({ key }) => (kv.has(key) ? structuredClone(kv.get(key)) : null),
      set: async ({ key, value }) => kv.set(key, structuredClone(value)),
    }),
    db: {
      query: () => ({
        findMany: async ({ where }) =>
          [...kv.entries()]
            .filter(([key]) => `plugin_magic-editor-x_${key}`.startsWith(where.key.$startsWith))
            .map(([key, value], index) => ({ id: index, key, value: JSON.stringify(value) })),
      }),
    },
    documents: (uid) => {
      assert.equal(uid, UID);
      const select = (locale, filters) =>
        rows
          .filter((row) => (locale ? row.locale === locale : row.locale === 'en'))
          .filter((row) => !filters || !options.filterOut || !options.filterOut(row));
      return {
        findMany: async (params) => {
          recorded.findMany.push(params);
          assert.equal(params.status, 'draft');
          return select(params.locale, params.filters)
            .sort((a, b) => a.id - b.id)
            .slice(params.start, params.start + params.limit)
            .map((row) => ({
              documentId: row.documentId,
              locale: row.locale,
              ...Object.fromEntries(params.fields.map((field) => [field, structuredClone(row[field])])),
            }));
        },
        count: async (params) => select(params.locale, params.filters).length,
        update: async ({ documentId, locale, data }) => {
          const row = rows.find(
            (entry) => entry.documentId === documentId && entry.locale === (locale || 'en')
          );
          Object.assign(row, structuredClone(data));
          recorded.updates.push({ documentId, locale: locale || null, keys: Object.keys(data) });
          return row;
        },
      };
    },
    plugin: (name) => {
      if (name === 'i18n')
        return options.localized
          ? {
              service: () => ({
                find: async () => [
                  { code: 'en', name: 'English' },
                  { code: 'de', name: 'German' },
                ],
                getDefaultLocale: async () => 'en',
              }),
            }
          : null;
      if (name === 'content-manager')
        return {
          service: () => ({
            create: () => {
              const allowed = (action, entity, field) => {
                if (options.deny === 'type') return false;
                if (options.deny === 'read' && action === 'read' && field === 'body') return false;
                if (options.deny === 'update' && action === 'update' && field === 'content') return false;
                if (entity && entity.locale && options.locales && !options.locales.includes(entity.locale))
                  return false;
                return true;
              };
              const can = {
                read: (entity, field) => allowed('read', entity, field),
                update: (entity, field) => allowed('update', entity, field),
              };
              const cannot = {
                read: (entity, field) => !allowed('read', entity, field),
                update: (entity, field) => !allowed('update', entity, field),
              };
              const query = async () => (options.filters ? { filters: options.filters } : {});
              return { can, cannot, sanitizedQuery: { read: query, update: query } };
            },
          }),
        };
      if (name === 'magic-editor-x')
        return {
          service: (service) => {
            if (services[service]) return services[service];
            if (service === 'migrate') services.migrate = migrateService({ strapi });
            if (service === 'store')
              services.store = {
                acquire: async (key, owner, ttl) => {
                  const now = Date.now();
                  const row = lockRows.get(key);
                  if (row && row.expires >= now) return false;
                  lockRows.set(key, { owner, expires: now + ttl });
                  return true;
                },
                renew: async (key, owner, ttl) => {
                  const row = lockRows.get(key);
                  if (!row || row.owner !== owner) return false;
                  row.expires = Date.now() + ttl;
                  return true;
                },
                release: async (key, owner) => {
                  if (lockRows.get(key) && lockRows.get(key).owner === owner) lockRows.delete(key);
                },
              };
            if (service === 'history')
              services.history = {
                create: async (target, content, meta) => {
                  recorded.versions.push({ target, content, meta });
                  return { created: true };
                },
              };
            if (service === 'audit')
              services.audit = {
                record: async (input) => {
                  recorded.audits.push(input);
                  return true;
                },
              };
            return services[service];
          },
        };
      return null;
    },
  };
  return { strapi, rows, recorded, lockRows, kv };
};

const ability = {};
const target = { uid: UID, from: 'body', to: 'content' };

test('types: only API types with a supported source and a Magic Editor X target the admin may change', () => {
  const { strapi } = fakeStrapi();
  const types = wizardService({ strapi }).types(ability);
  assert.equal(types.length, 1);
  assert.deepEqual(types[0].sources, [
    { name: 'title', type: 'string' },
    { name: 'body', type: 'blocks' },
  ]);
  assert.deepEqual(types[0].targets, [{ name: 'content', preset: 'simple' }]);
  const denied = fakeStrapi({ deny: 'type' });
  assert.deepEqual(wizardService({ strapi: denied.strapi }).types(ability), []);
});

test('preview: examples that would change, with source text and converted value; counts; writes nothing', async () => {
  const { strapi, recorded } = fakeStrapi();
  const result = await wizardService({ strapi }).preview(ability, { ...target, size: 5 });
  assert.equal(result.total, 60);
  // Entry 4 has content in the target: counted, not shown as an example.
  assert.deepEqual(
    result.entries.map((entry) => entry.documentId),
    ['doc001', 'doc002', 'doc003', 'doc005', 'doc006']
  );
  assert.ok(result.entries.every((entry) => entry.status === 'converted'));
  assert.equal(result.scanned, 50);
  assert.deepEqual(result.counts, { converted: 44, existing: 1, empty: 5, failed: 0 });
  assert.equal(result.entries[0].before, 'Synthetic paragraph 1');
  assert.equal(result.entries[0].after.blocks[0].type, 'paragraph');
  assert.deepEqual(recorded.updates, []);
});

test('preview and start check the Content Manager rights and the fields', async () => {
  for (const deny of ['read', 'update']) {
    const { strapi } = fakeStrapi({ deny });
    await assert.rejects(
      wizardService({ strapi }).preview(ability, target),
      (error) => error.name === 'ForbiddenError'
    );
  }
  const { strapi } = fakeStrapi();
  const wizard = wizardService({ strapi });
  // JSON sources belong to the CLI; the wizard takes Blocks, rich text and text only.
  await assert.rejects(
    wizard.preview(ability, { ...target, from: 'notes' }),
    (error) => error.name === 'ValidationError'
  );
  await assert.rejects(
    wizard.preview(ability, { ...target, to: 'title' }),
    (error) => error.name === 'ValidationError'
  );
  await assert.rejects(
    wizard.preview(ability, { ...target, extra: 1 }),
    (error) => error.name === 'ValidationError'
  );
  await assert.rejects(
    wizard.preview(ability, { ...target, size: 99 }),
    (error) => error.name === 'ValidationError'
  );
});

test('permission filters narrow every read; the admin sees and migrates only those entries', async () => {
  const filters = { createdBy: { id: 7 } };
  const { strapi, recorded } = fakeStrapi({ filters, filterOut: (row) => row.id % 2 === 0 });
  const wizard = wizardService({ strapi });
  const preview = await wizard.preview(ability, target);
  assert.equal(preview.total, 30);
  assert.ok(
    recorded.findMany.every(
      (params) => JSON.stringify(params.filters) === JSON.stringify({ $and: [filters, filters] })
    )
  );
});

test('a run: batches until done, only the target field is written, counts and audit events', async () => {
  const { strapi, rows, recorded, lockRows } = fakeStrapi();
  const wizard = wizardService({ strapi });
  let job = await wizard.start(ability, target, { userId: 1 });
  assert.equal(job.status, 'running');
  assert.equal(job.total, 60);
  assert.equal(job.startedBy, undefined, 'admin ids are not returned');
  let batches = 0;
  while (job.status === 'running') {
    job = await wizard.next(ability, job.id, { userId: 1 });
    batches += 1;
  }
  assert.equal(batches, Math.ceil(60 / BATCH_SIZE));
  assert.equal(job.status, 'done');
  assert.equal(job.processed, 60);
  assert.equal(job.counts.converted, 53);
  assert.equal(job.counts.skippedEmpty, 6);
  assert.equal(job.counts.skippedExisting, 1);
  assert.ok(recorded.updates.every((update) => update.keys.length === 1 && update.keys[0] === 'content'));
  assert.equal(rows[0].title, 'Title 1');
  assert.deepEqual(rows[0].body, blocks('Synthetic paragraph 1'), 'the source is never changed');
  assert.equal(rows[0].content.blocks[0].data.text, 'Synthetic paragraph 1');
  assert.equal(rows[3].content.blocks[0].data.text, 'kept');
  assert.deepEqual(
    recorded.audits.map((entry) => entry.event),
    ['migration.start', 'migration.finish']
  );
  assert.equal(recorded.audits[1].counts.converted, 53);
  assert.equal(lockRows.size, 0, 'the field lease is released at the end');
  // A finished job answers with its state and writes nothing more.
  const writes = recorded.updates.length;
  assert.equal((await wizard.next(ability, job.id)).status, 'done');
  assert.equal(recorded.updates.length, writes);
});

test('one run per field: a second start answers MIGRATION_RUNNING; a running batch blocks a second one', async () => {
  const { strapi, lockRows } = fakeStrapi();
  const wizard = wizardService({ strapi });
  const job = await wizard.start(ability, target);
  await assert.rejects(
    wizard.start(ability, target),
    (error) => error instanceof MigrationConflictError && error.code === 'MIGRATION_RUNNING'
  );
  // Another process or tab holds the batch lease of this job.
  lockRows.set(`migration-batch:${job.id}`, { owner: 'other', expires: Date.now() + 60000 });
  await assert.rejects(
    wizard.next(ability, job.id),
    (error) => error instanceof MigrationConflictError && error.code === 'BATCH_RUNNING'
  );
  lockRows.delete(`migration-batch:${job.id}`);
  assert.equal((await wizard.next(ability, job.id)).processed, BATCH_SIZE);
});

test('resume after a closed tab: the stored cursor continues where it stopped (another process too)', async () => {
  const shared = fakeStrapi();
  const first = wizardService({ strapi: shared.strapi });
  const job = await first.start(ability, target);
  await first.next(ability, job.id);
  // A second wizard instance (another process) finds the job and continues it.
  const second = wizardService({ strapi: shared.strapi });
  const listed = await second.list(ability);
  assert.deepEqual(
    listed.map((entry) => [entry.id, entry.processed]),
    [[job.id, BATCH_SIZE]]
  );
  let state = await second.next(ability, job.id);
  assert.equal(state.processed, BATCH_SIZE * 2);
  while (state.status === 'running') state = await second.next(ability, job.id);
  assert.equal(state.processed, 60);
  assert.equal(
    new Set(shared.recorded.updates.map((update) => update.documentId)).size,
    53,
    'no entry twice'
  );
});

test('overwrite: the previous target content is saved as "Before migration" first', async () => {
  const { strapi, recorded, rows } = fakeStrapi();
  const wizard = wizardService({ strapi });
  let job = await wizard.start(ability, { ...target, overwrite: true }, { userId: 3 });
  while (job.status === 'running') job = await wizard.next(ability, job.id, { userId: 3 });
  assert.equal(job.counts.versions, 1);
  assert.equal(recorded.versions.length, 1);
  assert.deepEqual(recorded.versions[0].target, {
    uid: UID,
    documentId: 'doc004',
    locale: 'en',
    field: 'content',
  });
  assert.equal(recorded.versions[0].content.blocks[0].data.text, 'kept');
  assert.equal(recorded.versions[0].meta.label, 'Before migration');
  assert.equal(rows[3].content.blocks[0].data.text, 'Synthetic paragraph 4');
});

test('locales: all locales one after the other; a role limited to some locales migrates only those', async () => {
  const rows = ['en', 'de'].flatMap((locale, offset) =>
    Array.from({ length: 3 }, (_, index) => ({
      id: offset * 10 + index + 1,
      documentId: `doc${index}`,
      locale,
      body: blocks(`${locale} ${index}`),
      content: null,
    }))
  );
  const all = fakeStrapi({ rows: structuredClone(rows), localized: true });
  let job = await wizardService({ strapi: all.strapi }).start(ability, { ...target, locale: '*' });
  assert.equal(job.total, 6);
  while (job.status === 'running') job = await wizardService({ strapi: all.strapi }).next(ability, job.id);
  assert.deepEqual(
    all.recorded.updates.map((update) => `${update.documentId}:${update.locale}`),
    ['doc0:en', 'doc1:en', 'doc2:en', 'doc0:de', 'doc1:de', 'doc2:de']
  );
  const limited = fakeStrapi({ rows: structuredClone(rows), localized: true, locales: ['de'] });
  job = await wizardService({ strapi: limited.strapi }).start(ability, { ...target, locale: '*' });
  assert.equal(job.total, 3);
  while (job.status === 'running')
    job = await wizardService({ strapi: limited.strapi }).next(ability, job.id);
  assert.ok(limited.recorded.updates.every((update) => update.locale === 'de'));
  const none = fakeStrapi({ rows: structuredClone(rows), localized: true, locales: [] });
  await assert.rejects(
    wizardService({ strapi: none.strapi }).start(ability, { ...target, locale: '*' }),
    (error) => error.name === 'ForbiddenError'
  );
});

test('cancel keeps what was migrated, releases the field and records the event', async () => {
  const { strapi, recorded, lockRows } = fakeStrapi();
  const wizard = wizardService({ strapi });
  const job = await wizard.start(ability, target);
  await wizard.next(ability, job.id);
  const cancelled = await wizard.cancel(ability, job.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(lockRows.size, 0);
  assert.equal(recorded.audits.at(-1).event, 'migration.cancel');
  assert.equal((await wizard.next(ability, job.id)).status, 'cancelled', 'no more batches');
  assert.equal((await wizard.start(ability, target)).status, 'running', 'the field is free again');
  await assert.rejects(wizard.get(ability, 'not-a-job'), (error) => error.name === 'NotFoundError');
});

test('backup: source and target values of every entry, nothing else; audit with counts only', async () => {
  const { strapi, recorded } = fakeStrapi();
  const backup = await wizardService({ strapi }).backup(ability, target);
  assert.equal(backup.kind, 'magic-editor-x/migration-backup');
  assert.equal(backup.entries.length, 60);
  assert.deepEqual(Object.keys(backup.entries[0]).sort(), ['body', 'content', 'documentId', 'locale']);
  assert.deepEqual(recorded.audits[0].counts, { entries: 60 });
  assert.ok(!JSON.stringify(recorded.audits).includes('Synthetic'), 'no content in the audit trail');
});

test('excerpts: plain text with line breaks between blocks, bounded, fast on adversarial input', () => {
  const { excerptOf } = wizardService;
  assert.equal(
    excerptOf('<h2>Title</h2><p>One <b>two</b></p><ul><li>a</li><li>b</li></ul>', 'html'),
    'Title\nOne two\na\nb'
  );
  assert.equal(excerptOf('<script>alert(1)</script><p>x</p>', 'html'), 'x');
  assert.equal(
    excerptOf(
      '<table><tr><th>Plan</th><th>Seats</th></tr><tr><td>Starter</td><td>5</td></tr></table>',
      'html'
    ),
    'Plan Seats\nStarter 5'
  );
  assert.equal(excerptOf(blocks('Blocks text'), 'blocks'), 'Blocks text');
  assert.ok(excerptOf('x'.repeat(5000), 'markdown').length <= 601);
  const started = performance.now();
  excerptOf(`${'<p'.repeat(50000)}${'</p   '.repeat(50000)}`, 'html');
  assert.ok(performance.now() - started < 200, 'no regex backtracking');
});

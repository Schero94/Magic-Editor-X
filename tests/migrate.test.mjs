import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migrateService = require('../server/src/services/migrate.js');
const { MigrationOptionsError } = migrateService;

const UID = 'api::article.article';
const strapiBlocks = JSON.parse(
  readFileSync(new URL('./fixtures/paste/strapi-blocks.json', import.meta.url), 'utf8')
);
const SECRET = 'Synthetic secret sentence';

/**
 * In-memory Document Service with draft rows per documentId and locale.
 * @param {Array<object>} rows - Rows `{ id, documentId, locale, ...fields }`.
 * @param {{ localized?: boolean, failOn?: string }} [options] - Schema and failure injection.
 * @returns {{ strapi: object, rows: Array<object>, updates: Array<object>, logs: Array<unknown[]> }} Fake.
 */
const fakeStrapi = (rows, options = {}) => {
  const updates = [];
  const logs = [];
  const contentType = {
    uid: UID,
    kind: 'collectionType',
    pluginOptions: options.localized ? { i18n: { localized: true } } : {},
    attributes: {
      title: { type: 'string' },
      blocksBody: { type: 'blocks' },
      markdown: { type: 'richtext' },
      html: { type: 'text' },
      data: { type: 'json' },
      content: { type: 'json', customField: 'plugin::magic-editor-x.richtext' },
      other: { type: 'json', customField: 'plugin::magic-editor-x.richtext' },
    },
  };
  const strapi = {
    contentType: (uid) => (uid === UID ? contentType : undefined),
    config: { get: () => undefined },
    log: {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    plugin: (name) =>
      name === 'i18n' ? { service: () => ({ find: async () => [{ code: 'en' }, { code: 'de' }] }) } : null,
    documents: (uid) => {
      assert.equal(uid, UID);
      return {
        findMany: async ({ locale, status, fields, sort, start, limit }) => {
          assert.equal(status, 'draft');
          assert.deepEqual(sort, ['id:asc']);
          const matching = rows
            .filter((row) => (locale ? row.locale === locale : row.locale === 'en'))
            .sort((a, b) => a.id - b.id)
            .slice(start, start + limit);
          return matching.map((row) => ({
            documentId: row.documentId,
            locale: row.locale,
            ...Object.fromEntries(fields.map((field) => [field, structuredClone(row[field])])),
          }));
        },
        update: async ({ documentId, locale, data }) => {
          if (options.failOn === documentId) {
            const error = new Error('fail');
            error.name = 'ValidationError';
            throw error;
          }
          const row = rows.find(
            (entry) => entry.documentId === documentId && entry.locale === (locale || 'en')
          );
          Object.assign(row, structuredClone(data));
          updates.push({ documentId, locale, keys: Object.keys(data) });
          return row;
        },
      };
    },
  };
  return { strapi, rows, updates, logs };
};

const sampleRows = () => [
  { id: 1, documentId: 'doca', locale: 'en', blocksBody: strapiBlocks, content: null },
  { id: 2, documentId: 'docb', locale: 'en', blocksBody: [], content: null },
  { id: 3, documentId: 'docc', locale: 'en', blocksBody: null, content: null },
  {
    id: 4,
    documentId: 'docd',
    locale: 'en',
    blocksBody: [{ type: 'paragraph', children: [{ type: 'text', text: SECRET }] }],
    content: { blocks: [{ id: 'k1', type: 'paragraph', data: { text: 'kept' } }] },
  },
];

test('dry run reports and writes nothing', async () => {
  const { strapi, rows, updates } = fakeStrapi(sampleRows());
  const before = structuredClone(rows);
  const report = await migrateService({ strapi }).run({
    uid: UID,
    from: 'blocksBody',
    to: 'content',
    batchSize: 2,
  });
  assert.deepEqual(updates, []);
  assert.deepEqual(rows, before);
  assert.equal(report.dryRun, true);
  assert.equal(report.scanned, 4);
  assert.equal(report.converted, 1);
  assert.equal(report.skippedEmpty, 2);
  assert.equal(report.skippedExisting, 1);
  assert.deepEqual(report.lossy, [
    { documentId: 'doca', locale: 'en', notes: ['unsupported-node:unknown-node'] },
  ]);
});

test('apply writes once; a second run is a no-op; overwrite replaces', async () => {
  const { strapi, rows, updates } = fakeStrapi(sampleRows());
  const service = migrateService({ strapi });
  const first = await service.run({ uid: UID, from: 'blocksBody', to: 'content', dryRun: false });
  assert.equal(first.converted, 1);
  assert.deepEqual(updates, [{ documentId: 'doca', locale: undefined, keys: ['content'] }]);
  const stored = rows[0].content;
  assert.equal(stored.blocks[0].type, 'header');
  assert.equal(stored.blocks[0].data.text, 'Strapi &lt;Blocks&gt;');
  assert.deepEqual(rows[0].blocksBody, strapiBlocks, 'source is not changed');

  const second = await service.run({ uid: UID, from: 'blocksBody', to: 'content', dryRun: false });
  assert.equal(second.converted, 0);
  assert.equal(second.skippedExisting, 2);
  assert.equal(updates.length, 1);

  const third = await service.run({
    uid: UID,
    from: 'blocksBody',
    to: 'content',
    dryRun: false,
    overwrite: true,
  });
  assert.equal(third.converted, 2);
  assert.deepEqual(rows[0].content.blocks, stored.blocks, 'conversion is deterministic');
  assert.equal(rows[3].content.blocks[0].data.text, SECRET);
});

test('Markdown, HTML and JSON sources with auto format', async () => {
  const rows = [
    {
      id: 1,
      documentId: 'm1',
      locale: 'en',
      markdown: '# Title\n\n- a\n- b',
      html: '<h2>H</h2><p>t <b>b</b></p>',
      data: null,
      content: null,
      other: null,
    },
    {
      id: 2,
      documentId: 'm2',
      locale: 'en',
      markdown: 'plain',
      html: 'no tags here, *md*',
      data: strapiBlocks,
      content: null,
      other: null,
    },
    {
      id: 3,
      documentId: 'm3',
      locale: 'en',
      markdown: '',
      html: '',
      data: { unknown: true },
      content: null,
      other: null,
    },
  ];
  const { strapi } = fakeStrapi(rows);
  const service = migrateService({ strapi });
  await service.run({ uid: UID, from: 'markdown', to: 'content', dryRun: false });
  assert.deepEqual(
    rows[0].content.blocks.map((block) => block.type),
    ['header', 'list']
  );
  await service.run({ uid: UID, from: 'html', to: 'other', dryRun: false });
  assert.deepEqual(
    rows[0].other.blocks.map((block) => [block.type, block.data.text]),
    [
      ['header', 'H'],
      ['paragraph', 't <b>b</b>'],
    ]
  );
  assert.equal(rows[1].other.blocks[0].data.text, 'no tags here, <i>md</i>');
  const json = await service.run({ uid: UID, from: 'data', to: 'content', overwrite: true });
  assert.equal(json.converted, 1);
  assert.deepEqual(json.failed, [{ documentId: 'm3', locale: 'en', code: 'UNSUPPORTED_VALUE' }]);
});

test('every locale with locale "*", limit, and failure isolation', async () => {
  const rows = [
    { id: 1, documentId: 'a', locale: 'en', markdown: '# A', content: null },
    { id: 2, documentId: 'a', locale: 'de', markdown: '# A de', content: null },
    { id: 3, documentId: 'b', locale: 'de', markdown: '# B de', content: null },
    { id: 4, documentId: 'c', locale: 'de', markdown: '# C de', content: null },
  ];
  const { strapi, updates } = fakeStrapi(rows, { localized: true, failOn: 'b' });
  const report = await migrateService({ strapi }).run({
    uid: UID,
    from: 'markdown',
    to: 'content',
    locale: '*',
    dryRun: false,
  });
  assert.equal(report.scanned, 4);
  assert.equal(report.converted, 3);
  assert.deepEqual(report.failed, [{ documentId: 'b', locale: 'de', code: 'VALIDATION' }]);
  assert.deepEqual(
    updates.map((entry) => `${entry.documentId}:${entry.locale}`),
    ['a:en', 'a:de', 'c:de']
  );
  const limited = await migrateService({
    strapi: fakeStrapi(structuredClone(rows), { localized: true }).strapi,
  }).run({
    uid: UID,
    from: 'markdown',
    to: 'content',
    locale: 'de',
    limit: 2,
    batchSize: 1,
  });
  assert.equal(limited.scanned, 2);
});

test('options are validated against the schema', async () => {
  const { strapi } = fakeStrapi([]);
  const service = migrateService({ strapi });
  const cases = [
    [{ uid: 'api::missing.missing', from: 'markdown', to: 'content' }, 'UNKNOWN_CONTENT_TYPE'],
    [{ uid: UID, from: 'title2', to: 'content' }, 'INVALID_SOURCE'],
    [{ uid: UID, from: 'content', to: 'other' }, 'INVALID_SOURCE'],
    [{ uid: UID, from: 'markdown', to: 'data' }, 'INVALID_TARGET'],
    [{ uid: UID, from: 'content', to: 'content' }, 'SAME_FIELD'],
    [{ uid: UID, from: 'markdown', to: 'content', format: 'docx' }, 'INVALID_OPTIONS'],
    [{ uid: UID, from: 'markdown', to: 'content', batchSize: 0 }, 'INVALID_OPTIONS'],
    [{ uid: UID, from: 'markdown', to: 'content', status: 'published' }, 'INVALID_OPTIONS'],
    [{ uid: UID, from: 'markdown', to: 'content', extra: 1 }, 'INVALID_OPTIONS'],
    [{ uid: 'x', from: 'markdown', to: 'content' }, 'INVALID_OPTIONS'],
    [null, 'INVALID_OPTIONS'],
  ];
  for (const [input, code] of cases) {
    await assert.rejects(
      service.run(input),
      (error) => error instanceof MigrationOptionsError && error.code === code,
      code
    );
  }
});

test('report and log contain no content', async () => {
  const { strapi, logs } = fakeStrapi(sampleRows());
  const report = await migrateService({ strapi }).run({
    uid: UID,
    from: 'blocksBody',
    to: 'content',
    overwrite: true,
  });
  assert.ok(!JSON.stringify(report).includes('Synthetic'));
  assert.ok(!JSON.stringify(report).includes('Strapi'));
  assert.ok(!JSON.stringify(logs).includes('Synthetic'));
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0][1]).sort(), [
    'converted',
    'failed',
    'lossy',
    'scanned',
    'skippedEmpty',
    'skippedExisting',
  ]);
});

test('an unreadable target value counts as existing content', async () => {
  const rows = [
    { id: 1, documentId: 'u1', locale: 'en', markdown: '# A', content: 'x'.repeat(6 * 1024 * 1024) },
  ];
  const report = await migrateService({ strapi: fakeStrapi(rows).strapi }).run({
    uid: UID,
    from: 'markdown',
    to: 'content',
  });
  assert.equal(report.skippedExisting, 1);
});

test('CLI arguments are parsed strictly', async () => {
  const { parseCommand, formatReport } = await import('../bin/magic-editor-x.mjs');
  assert.deepEqual(parseCommand(['--help']), { help: true });
  assert.deepEqual(
    parseCommand([
      'migrate',
      '--uid',
      UID,
      '--from',
      'body',
      '--to',
      'content',
      '--locale',
      '*',
      '--batch',
      '20',
      '--apply',
    ]),
    {
      help: false,
      json: false,
      out: undefined,
      options: {
        uid: UID,
        from: 'body',
        to: 'content',
        format: 'auto',
        dryRun: false,
        overwrite: false,
        locale: '*',
        batchSize: 20,
      },
    }
  );
  assert.equal(parseCommand(['migrate', '--uid', UID, '--from', 'a', '--to', 'b']).options.dryRun, true);
  assert.throws(() => parseCommand(['migrate', '--uid', UID, '--from', 'a']), /--to is required/);
  assert.throws(() => parseCommand(['convert', '--uid', UID, '--from', 'a', '--to', 'b']), /Unknown command/);
  assert.throws(() => parseCommand(['migrate', '--uid', UID, '--from', 'a', '--to', 'b', '--batch', '-1']));
  assert.throws(() => parseCommand(['migrate', '--uid', UID, '--from', 'a', '--to', 'b', '--unknown']));
  const text = formatReport({
    uid: UID,
    from: 'a',
    to: 'b',
    format: 'auto',
    dryRun: true,
    scanned: 2,
    converted: 1,
    skippedExisting: 0,
    skippedEmpty: 1,
    failed: [{ documentId: 'x1', locale: 'en', code: 'VALIDATION' }],
    lossy: [],
  });
  assert.match(text, /Dry run/);
  assert.match(text, /failed x1 en VALIDATION/);
  assert.match(text, /--apply/);
});

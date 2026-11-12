import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/**
 * Scheduled external link check (services/link-schedule.js) on a real
 * SQLite database (the plugin's own store service), with a fake Document
 * Service and a fake fetcher: config validation, one run per fire time
 * across "processes", batching through components and dynamic zones, run
 * budget and rate limit, per-host concurrency, pruning, the report shape and
 * log hygiene.
 */

const require = createRequire(import.meta.url);
const knexFactory = require('knex');
const config = require('../server/src/config/index.js');
const storePath = require.resolve('../server/src/services/store.js');
const schedulePath = require.resolve('../server/src/services/link-schedule.js');
const qualityPath = require.resolve('../server/src/services/quality.js');

const FIELD = { type: 'json', customField: 'plugin::magic-editor-x.richtext' };
const ARTICLE = 'api::article.article';
const PAGE = 'api::page.page';

const doc = (...urls) => ({
  time: 1,
  version: '2.31.7',
  blocks: urls.map((url, index) => ({
    id: `b${index}`,
    type: 'paragraph',
    data: { text: `See <a href="${url}">target ${index}</a>` },
  })),
});

const databases = [];
after(() => Promise.all(databases.map((knex) => knex.destroy())));

const openDatabase = () => {
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  databases.push(knex);
  return knex;
};

/**
 * In-memory content: rows `{ id, documentId, locale, status, ...fields }`.
 * @returns {{ rows: object[], calls: object[], findMany: Function }} Store.
 */
const createContent = () => {
  const rows = [];
  const calls = [];
  const findMany = (uid) => async (params) => {
    calls.push({ uid, ...params });
    const status = params.status || 'draft';
    const after = params.filters?.id?.$gt ?? 0;
    return rows
      .filter((row) => row.uid === uid && row.status === status && row.id > after)
      .filter((row) => params.locale === '*' || !row.locale || row.locale === params.locale)
      .sort((a, b) => a.id - b.id)
      .slice(0, params.limit)
      .map((row) => structuredClone(row));
  };
  return { rows, calls, findMany };
};

/**
 * One "process": fresh module instances of store, quality and link-schedule
 * on the shared database.
 */
const createProcess = (knex, content, { schedule = {}, fetch, pluginConfig = {}, logs = [] } = {}) => {
  for (const path of [storePath, schedulePath, qualityPath]) delete require.cache[path];
  const createStore = require(storePath);
  const createSchedule = require(schedulePath);
  const createQuality = require(qualityPath);
  const settings = {
    'qualityChecks.externalLinks.enabled': true,
    'qualityChecks.externalLinks.timeoutMs': 1000,
    'qualityChecks.externalLinks.allowPrivateOrigins': [],
    'qualityChecks.externalLinks.schedule': {
      enabled: true,
      rule: '0 3 * * *',
      maxUrlsPerRun: 500,
      perMinute: 600,
      perHostConcurrency: 2,
      ...schedule,
    },
    ...pluginConfig,
  };
  const pluginStore = new Map();
  const services = {};
  const cronJobs = [];
  const strapi = {
    config: {
      get: (key) => (key.startsWith('plugin::magic-editor-x.') ? settings[key.slice(23)] : undefined),
    },
    log: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
      debug: () => {},
    },
    db: {
      connection: knex,
      getConnection: (name) => knex(name),
      getSchemaConnection: () => knex.schema,
    },
    store: () => ({
      get: async ({ key }) => pluginStore.get(key) ?? null,
      set: async ({ key, value }) => pluginStore.set(key, structuredClone(value)),
    }),
    cron: {
      add: (tasks) => {
        for (const [name, value] of Object.entries(tasks)) cronJobs.push({ name, ...value });
      },
      remove: (name) => {
        const index = cronJobs.findIndex((job) => job.name === name);
        if (index >= 0) cronJobs.splice(index, 1);
      },
      get jobs() {
        return cronJobs.map((job) => ({ name: job.name }));
      },
    },
    contentTypes: {
      [ARTICLE]: {
        uid: ARTICLE,
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
        attributes: {
          title: { type: 'string' },
          body: FIELD,
          sections: { type: 'component', repeatable: true, component: 'shared.section' },
          zone: { type: 'dynamiczone', components: ['shared.section', 'shared.quote'] },
        },
      },
      [PAGE]: { uid: PAGE, options: { draftAndPublish: false }, attributes: { intro: FIELD } },
      'api::plain.plain': { uid: 'api::plain.plain', attributes: { title: { type: 'string' } } },
      'plugin::other.thing': { uid: 'plugin::other.thing', attributes: { body: FIELD } },
    },
    components: {
      'shared.section': { uid: 'shared.section', attributes: { heading: { type: 'string' }, body: FIELD } },
      'shared.quote': { uid: 'shared.quote', attributes: { text: { type: 'string' } } },
    },
    documents: (uid) => ({ findMany: content.findMany(uid) }),
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = createStore({ strapi });
  services.quality = createQuality({ strapi }, { fetchBounded: fetch });
  services['link-schedule'] = createSchedule({ strapi }, { sleep: async () => {} });
  return { strapi, services, cronJobs, schedule: services['link-schedule'], logs, pluginStore };
};

/** Fake fetcher: answers by path, records calls. */
const fakeFetch = (statuses = {}) => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const fn = async (url, options) => {
    calls.push({ url, options });
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    const path = new URL(url).pathname;
    const status = statuses[path] ?? 200;
    if (status === 'timeout') throw Object.assign(new Error('timeout'), { statusCode: 504 });
    return { statusCode: status, mimeType: 'text/html', body: Buffer.alloc(0) };
  };
  fn.calls = calls;
  fn.maxActive = () => maxActive;
  return fn;
};

const setup = async (options = {}) => {
  const knex = openDatabase();
  const content = createContent();
  const fetch = options.fetch || fakeFetch(options.statuses);
  const one = createProcess(knex, content, { ...options, fetch });
  await one.services.store.init();
  return { knex, content, fetch, one };
};

test('config: the schedule is off by default, needs external checks and bounded values', () => {
  const base = structuredClone(config.default);
  config.validator(base);
  assert.equal(base.qualityChecks.externalLinks.schedule.enabled, false);
  const on = structuredClone(base);
  on.qualityChecks.externalLinks.schedule.enabled = true;
  assert.throws(() => config.validator(on), /qualityChecks\.externalLinks\.schedule\.enabled/);
  on.qualityChecks.externalLinks.enabled = true;
  config.validator(on);
  for (const [key, value] of [
    ['rule', '*/5 * * * * *'],
    ['rule', '0 3 * * *; rm'],
    ['rule', ''],
    ['maxUrlsPerRun', 0],
    ['maxUrlsPerRun', 10001],
    ['perMinute', 601],
    ['perHostConcurrency', 9],
  ]) {
    const bad = structuredClone(on);
    bad.qualityChecks.externalLinks.schedule[key] = value;
    assert.throws(() => config.validator(bad), /schedule/, `${key}=${value}`);
  }
  for (const value of ['http://127.0.0.1:8080/', 'ftp://127.0.0.1', 'http://user@127.0.0.1', 'nope']) {
    const bad = structuredClone(on);
    bad.qualityChecks.externalLinks.allowPrivateOrigins = [value];
    assert.throws(() => config.validator(bad), /allowPrivateOrigins/, value);
  }
  const good = structuredClone(on);
  good.qualityChecks.externalLinks.allowPrivateOrigins = ['http://127.0.0.1:8080'];
  good.qualityChecks.externalLinks.schedule.rule = '30 2 * * 1-5';
  config.validator(good);
});

test('schedule: registers a named cron job only when enabled and removes it on stop', async () => {
  const { one, knex } = await setup();
  assert.equal(one.schedule.schedule(), true);
  assert.deepEqual(
    one.cronJobs.map((job) => [job.name, job.options.rule]),
    [['magic-editor-x:link-check', '0 3 * * *']]
  );
  one.schedule.stop();
  assert.equal(one.cronJobs.length, 0);
  const off = createProcess(knex, createContent(), {
    fetch: fakeFetch(),
    pluginConfig: { 'qualityChecks.externalLinks.enabled': false },
  });
  assert.equal(off.schedule.schedule(), false);
  assert.equal(off.cronJobs.length, 0);
  assert.deepEqual(await off.schedule.runNow(), { started: false, reason: 'DISABLED' });
});

test('scan: id-ordered batches over drafts, published versions, locales, components and dynamic zones', async () => {
  const { one, content, fetch } = await setup({ statuses: { '/gone': 404 } });
  let id = 0;
  for (let i = 0; i < 120; i += 1)
    content.rows.push({
      uid: ARTICLE,
      id: (id += 1),
      documentId: `doc${i}`,
      locale: i % 2 ? 'de' : 'en',
      status: 'draft',
      body: doc(`https://www.example.test/a${i % 7}`),
    });
  content.rows.push({
    uid: ARTICLE,
    id: (id += 1),
    documentId: 'rich',
    locale: 'en',
    status: 'draft',
    body: doc('https://www.example.test/gone'),
    sections: [{ heading: 'x', body: doc('https://cdn.example.test/s') }],
    zone: [
      { __component: 'shared.quote', text: 'q' },
      { __component: 'shared.section', body: JSON.stringify(doc('https://www.example.test/z')) },
    ],
  });
  content.rows.push({
    uid: ARTICLE,
    id: (id += 1),
    documentId: 'rich',
    locale: 'en',
    status: 'published',
    body: doc('https://www.example.test/live'),
  });
  content.rows.push({ uid: PAGE, id: id + 1, documentId: 'page1', status: 'published', intro: doc() });

  const record = await one.schedule.runAndWait();
  assert.equal(record.complete, true);
  assert.equal(record.documents, 123);
  const articleDrafts = content.calls.filter((call) => call.uid === ARTICLE && call.status === 'draft');
  assert.equal(articleDrafts.length, 3, 'three batches of at most 50');
  assert.ok(articleDrafts.every((call) => call.limit === 50 && call.locale === '*'));
  assert.deepEqual(
    articleDrafts.map((call) => call.filters.id.$gt),
    [0, 50, 100]
  );
  assert.deepEqual(articleDrafts[0].sort, [{ id: 'asc' }]);
  assert.ok(articleDrafts[0].populate.sections && articleDrafts[0].populate.zone.on['shared.section']);
  assert.equal(content.calls.filter((call) => call.uid === PAGE).length, 1);
  assert.ok(
    !content.calls.some((call) => call.uid === 'api::plain.plain' || call.uid.startsWith('plugin::'))
  );
  // 7 + gone + s + z + live distinct URLs, each requested once (HEAD).
  assert.equal(fetch.calls.length, 11);
  assert.equal(record.checked, 11);
  assert.equal(record.problems, 1);

  const report = await one.schedule.report({ uid: ARTICLE, documentId: 'rich', locale: 'en', field: 'body' });
  assert.equal(report.enabled, true);
  assert.equal(report.lastRun.complete, true);
  assert.equal(report.draft.problems, 1);
  assert.deepEqual(
    {
      url: report.draft.links[0].url,
      status: report.draft.links[0].status,
      code: report.draft.links[0].code,
    },
    { url: 'https://www.example.test/gone', status: 'broken', code: 404 }
  );
  assert.equal(report.published.links[0].status, 'ok');
  const component = await one.schedule.report({
    uid: ARTICLE,
    documentId: 'rich',
    locale: 'en',
    field: 'sections.0.body',
  });
  assert.equal(component.draft.links[0].url, 'https://cdn.example.test/s');
  const zone = await one.schedule.report({
    uid: ARTICLE,
    documentId: 'rich',
    locale: 'en',
    field: 'zone.1.body',
  });
  assert.equal(zone.draft.links[0].url, 'https://www.example.test/z');
  const otherLocale = await one.schedule.report({
    uid: ARTICLE,
    documentId: 'rich',
    locale: 'de',
    field: 'body',
  });
  assert.equal(otherLocale.draft, null);
});

test('lease: one cron fire time runs on exactly one process; a second run waits for the lease', async () => {
  const knex = openDatabase();
  const content = createContent();
  content.rows.push({
    uid: PAGE,
    id: 1,
    documentId: 'p',
    status: 'published',
    intro: doc('https://www.example.test/x'),
  });
  const fetch = fakeFetch();
  const a = createProcess(knex, content, { fetch });
  const b = createProcess(knex, content, { fetch });
  await a.services.store.init();
  const fireDate = new Date('2026-11-12T03:00:00.000Z');
  const results = await Promise.all([a.schedule.onCron(fireDate), b.schedule.onCron(fireDate)]);
  assert.equal(results.filter(Boolean).length, 1, 'one process ran');
  assert.equal(content.calls.filter((call) => call.uid === PAGE).length, 1);
  // The same fire time again (clock skew) does not run twice.
  assert.equal(await b.schedule.onCron(new Date('2026-11-12T03:00:20.000Z')), null);
  // A manual run while another process holds the lease answers RUNNING.
  await a.services.store.acquire('links:schedule', 'someone-else', 60000);
  assert.deepEqual(await b.schedule.runNow(), { started: false, reason: 'RUNNING' });
  await a.services.store.release('links:schedule', 'someone-else');
  assert.deepEqual(await b.schedule.runNow(), { started: true });
});

test('budget: at most maxUrlsPerRun requests, the least recently checked first; the rate limit waits', async () => {
  const knex = openDatabase();
  const content = createContent();
  const urls = ['a', 'b', 'c', 'd', 'e'].map((name) => `https://www.example.test/${name}`);
  content.rows.push({ uid: PAGE, id: 1, documentId: 'p', status: 'published', intro: doc(...urls) });
  const fetch = fakeFetch();
  const one = createProcess(knex, content, { fetch, schedule: { maxUrlsPerRun: 2, perMinute: 1 } });
  await one.services.store.init();
  let waits = 0;
  delete require.cache[schedulePath];
  one.services['link-schedule'] = require(schedulePath)(
    { strapi: one.strapi },
    {
      sleep: async () => {
        waits += 1;
        // Move to the next counter window.
        await knex('magic_editor_x_counters').del();
      },
    }
  );
  const run1 = await one.services['link-schedule'].runAndWait();
  assert.equal(run1.checked, 2);
  assert.ok(waits >= 1, 'the second request waited for the next minute');
  let report = await one.services['link-schedule'].report({
    uid: PAGE,
    documentId: 'p',
    locale: null,
    field: 'intro',
  });
  assert.equal(report.draft, null);
  const statuses = report.published.links.map((link) => link.status);
  assert.equal(statuses.filter((status) => status === 'ok').length, 2);
  assert.equal(statuses.filter((status) => status === 'skipped').length, 3);
  await one.services['link-schedule'].runAndWait();
  await one.services['link-schedule'].runAndWait();
  report = await one.services['link-schedule'].report({
    uid: PAGE,
    documentId: 'p',
    locale: null,
    field: 'intro',
  });
  assert.ok(report.published.links.every((link) => link.status === 'ok' && link.checkedAt));
  assert.equal(fetch.calls.length, 5, 'three cached results were not requested again within the cache time');
});

test('per-host concurrency is never exceeded', async () => {
  delete require.cache[schedulePath];
  const schedule = require(schedulePath)({ strapi: { config: { get: () => undefined }, log: {} } });
  const active = new Map();
  let maxPerHost = 0;
  let maxTotal = 0;
  let total = 0;
  const items = Array.from({ length: 30 }, (_, i) => ({
    url: `https://host${i % 3}.example.test/${i}`,
  }));
  const started = await schedule.runLimited(items, {
    concurrency: 4,
    perHost: 1,
    beforeStart: async () => true,
    work: async (item) => {
      const host = new URL(item.url).host;
      active.set(host, (active.get(host) || 0) + 1);
      total += 1;
      maxPerHost = Math.max(maxPerHost, active.get(host));
      maxTotal = Math.max(maxTotal, total);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active.set(host, active.get(host) - 1);
      total -= 1;
    },
  });
  assert.equal(started, 30);
  assert.equal(maxPerHost, 1);
  assert.ok(maxTotal <= 3);
});

test('pruning: rows of deleted entries and removed links disappear after a complete run', async () => {
  const { one, content, knex } = await setup();
  content.rows.push(
    { uid: PAGE, id: 1, documentId: 'keep', status: 'published', intro: doc('https://www.example.test/k') },
    { uid: PAGE, id: 2, documentId: 'gone', status: 'published', intro: doc('https://www.example.test/g') }
  );
  await one.schedule.runAndWait();
  assert.equal((await knex('magic_editor_x_link_fields').count({ n: '*' }))[0].n, 2);
  assert.equal((await knex('magic_editor_x_link_urls').count({ n: '*' }))[0].n, 2);
  content.rows.splice(1, 1);
  const record = await one.schedule.runAndWait();
  assert.equal(record.pruned, 2);
  const fields = await knex('magic_editor_x_link_fields').select('document_id');
  assert.deepEqual(
    fields.map((row) => row.document_id),
    ['keep']
  );
  const urls = await knex('magic_editor_x_link_urls').select('url');
  assert.deepEqual(
    urls.map((row) => row.url),
    ['https://www.example.test/k']
  );
});

test('an incomplete scan keeps earlier rows; logs carry counts only', async () => {
  const logs = [];
  const { one, content, knex } = await setup({ logs });
  content.rows.push({
    uid: PAGE,
    id: 1,
    documentId: 'p',
    status: 'published',
    intro: doc('https://secret-host.example.test/private?token=abc'),
  });
  await one.schedule.runAndWait();
  const original = content.findMany;
  one.strapi.documents = (uid) => ({
    findMany: async (params) => {
      if (uid === ARTICLE) throw Object.assign(new Error('db down'), { code: 'DB' });
      return original(uid)(params);
    },
  });
  content.rows.length = 0;
  const record = await one.schedule.runAndWait();
  assert.equal(record.complete, false);
  assert.equal(record.pruned, 0);
  assert.equal((await knex('magic_editor_x_link_fields').count({ n: '*' }))[0].n, 1);
  const text = JSON.stringify(logs);
  assert.doesNotMatch(text, /secret-host|token|example\.test|db down/);
  assert.match(text, /scheduled link check finished/);
});

test('private origins: only the listed exact origin may be private, and its redirects are not followed', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { statusCode: 200, mimeType: 'text/html', body: Buffer.alloc(0) };
  };
  delete require.cache[qualityPath];
  const settings = {
    'qualityChecks.externalLinks.enabled': true,
    'qualityChecks.externalLinks.allowPrivateOrigins': ['http://127.0.0.1:1488'],
  };
  const quality = require(qualityPath)(
    {
      strapi: {
        config: { get: (key) => settings[key.slice(23)] },
        log: { info() {}, warn() {}, error() {}, debug() {} },
      },
    },
    { fetchBounded: fetch }
  );
  await quality.checkExternalUrl('http://127.0.0.1:1488/page');
  await quality.checkExternalUrl('http://127.0.0.1:1489/page');
  await quality.checkExternalUrl('https://www.example.test/');
  assert.equal(calls[0].options.allowPrivate, true);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(typeof calls[0].options.request, 'function');
  for (const call of calls.slice(1)) {
    assert.equal(call.options.allowPrivate, undefined);
    assert.equal(call.options.maxRedirects, 5);
  }
  const cached = await quality.checkExternalUrl('http://127.0.0.1:1489/page');
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 3);
});

test('field permissions: component fields are checked by their path, dynamic zones by the zone', async () => {
  const { resolveEditorField } = require('../server/src/utils/editor-fields.js');
  const knex = openDatabase();
  const { strapi } = createProcess(knex, createContent(), { fetch: fakeFetch() });
  const article = strapi.contentTypes[ARTICLE];
  assert.equal(resolveEditorField(strapi, article, 'body').permissionField, 'body');
  assert.equal(resolveEditorField(strapi, article, 'sections.0.body').permissionField, 'sections.body');
  assert.equal(resolveEditorField(strapi, article, 'zone.1.body').permissionField, 'zone');
  assert.equal(resolveEditorField(strapi, article, 'sections.0.heading'), null);
});

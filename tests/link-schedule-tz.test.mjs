import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Scheduled link check 2.4: `schedule.tz` (validation, cron registration,
 * fire times through the installed Strapi 5.61 cron service and croner),
 * the one-time key per fire minute with a time zone, and the cluster-wide
 * `running` state that the Settings "Run now" button polls.
 */

const require = createRequire(import.meta.url);
const knexFactory = require('knex');
const config = require('../server/src/config/index.js');
const { isTimeZone } = require('../server/src/utils/time-zone.js');
const storePath = require.resolve('../server/src/services/store.js');
const schedulePath = require.resolve('../server/src/services/link-schedule.js');

const databases = [];
after(() => Promise.all(databases.map((knex) => knex.destroy())));

const withSchedule = (schedule) => {
  const value = structuredClone(config.default);
  value.qualityChecks.externalLinks.enabled = true;
  Object.assign(value.qualityChecks.externalLinks.schedule, { enabled: true }, schedule);
  return value;
};

/**
 * One "process" with a real SQLite store and a cron stand-in that records
 * the options passed to `strapi.cron.add`.
 */
const createProcess = (knex, schedule = {}, cron = null) => {
  for (const file of [storePath, schedulePath]) delete require.cache[file];
  const createStore = require(storePath);
  const createSchedule = require(schedulePath);
  const settings = {
    'qualityChecks.externalLinks.enabled': true,
    'qualityChecks.externalLinks.schedule': { enabled: true, rule: '0 3 * * *', ...schedule },
  };
  const jobs = [];
  const services = {};
  const strapi = {
    config: { get: (key) => settings[key.replace('plugin::magic-editor-x.', '')] },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      connection: knex,
      getConnection: (name) => knex(name),
      getSchemaConnection: () => knex.schema,
    },
    store: () => ({ get: async () => null, set: async () => {} }),
    cron: cron || {
      add: (tasks) => {
        for (const [name, value] of Object.entries(tasks)) jobs.push({ name, ...value });
      },
      remove: () => {},
      get jobs() {
        return jobs.map((job) => ({ name: job.name }));
      },
    },
    contentTypes: {},
    components: {},
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = createStore({ strapi });
  services['link-schedule'] = createSchedule({ strapi }, { sleep: async () => {} });
  return { strapi, jobs, services, schedule: services['link-schedule'] };
};

const openDatabase = async () => {
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  databases.push(knex);
  return knex;
};

/** The installed Strapi cron service (Strapi 5.61, croner 10), loaded by file path. */
const loadStrapiCron = () => {
  const core = path.dirname(require.resolve('@strapi/core/package.json'));
  return require(path.join(core, 'dist/services/cron.js'));
};

test('tz: IANA names pass, unknown or malformed names are rejected at boot', () => {
  for (const zone of ['UTC', 'Etc/UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata', 'Etc/GMT+2']) {
    assert.equal(isTimeZone(zone), true, zone);
    config.validator(withSchedule({ tz: zone }));
  }
  // V8's Intl.supportedValuesOf('timeZone') has no 'UTC' entry; the DateTimeFormat check accepts it.
  assert.equal(Intl.supportedValuesOf('timeZone').includes('UTC'), false);
  for (const zone of ['Mars/Olympus', '../etc/passwd', 'Europe/Berlin ', '', 'a'.repeat(65), 42, null]) {
    assert.equal(isTimeZone(zone), false, String(zone));
    assert.throws(
      () => config.validator(withSchedule({ tz: zone })),
      /qualityChecks\.externalLinks\.schedule\.tz/
    );
  }
  // Default: no tz key (server time zone).
  assert.equal('tz' in config.default.qualityChecks.externalLinks.schedule, false);
  config.validator(withSchedule({}));
});

test('cron registration passes options.tz only when set', async () => {
  const knex = await openDatabase();
  const plain = createProcess(knex);
  assert.equal(plain.schedule.schedule(), true);
  assert.deepEqual(plain.jobs[0].options, { rule: '0 3 * * *' });
  assert.equal(plain.schedule.settings().tz, null);
  const zoned = createProcess(knex, { tz: 'Europe/Berlin' });
  zoned.schedule.schedule();
  assert.deepEqual(zoned.jobs[0].options, { rule: '0 3 * * *', tz: 'Europe/Berlin' });
  assert.equal(zoned.schedule.settings().tz, 'Europe/Berlin');
  // An invalid value that slipped past validation is ignored (server time zone).
  const bad = createProcess(knex, { tz: 'Nowhere/Land' });
  bad.schedule.schedule();
  assert.deepEqual(bad.jobs[0].options, { rule: '0 3 * * *' });
});

test('fire times: the installed Strapi cron service schedules the rule in the configured zone', async () => {
  const createCron = loadStrapiCron();
  const logs = [];
  const previous = globalThis.strapi;
  globalThis.strapi = { log: { error: (...args) => logs.push(args) } };
  const cron = createCron();
  try {
    const knex = await openDatabase();
    const cases = [
      ['Asia/Tokyo', 3, 18], // UTC+9, no DST: 03:00 local is 18:00 UTC the day before
      ['Asia/Kolkata', 3, 21], // UTC+5:30: 21:30 UTC
      ['UTC', 3, 3],
    ];
    for (const [tz, localHour, utcHour] of cases) {
      const one = createProcess(knex, { tz }, cron);
      assert.equal(one.schedule.schedule(), true);
      const next = one.schedule.nextRun();
      assert.ok(next instanceof Date, tz);
      assert.equal(next.getUTCHours(), utcHour, tz);
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(next);
      assert.equal(Number(local), localHour, tz);
      assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: tz, minute: 'numeric' }).format(next), '0');
      one.schedule.stop();
    }
    // Daylight saving: America/New_York 03:00 is 07:00 UTC in summer and 08:00 UTC in winter.
    const ny = createProcess(knex, { tz: 'America/New_York' }, cron);
    ny.schedule.schedule();
    const entry = cron.jobs.find((job) => job.name === ny.schedule.CRON_NAME);
    const summer = entry.job.nextRun(new Date('2026-07-01T00:00:00Z'));
    const winter = entry.job.nextRun(new Date('2026-12-01T00:00:00Z'));
    assert.equal(summer.toISOString(), '2026-07-01T07:00:00.000Z');
    assert.equal(winter.toISOString(), '2026-12-01T08:00:00.000Z');
    ny.schedule.stop();
    assert.deepEqual(logs, []);
  } finally {
    cron.destroy();
    globalThis.strapi = previous;
  }
});

test('one-time key: the fire minute is an absolute instant, the same on processes in any zone', async () => {
  const knex = await openDatabase();
  const berlin = createProcess(knex, { tz: 'Europe/Berlin' });
  const tokyo = createProcess(knex, { tz: 'Asia/Tokyo' });
  await berlin.services.store.init();
  const fire = new Date('2026-11-12T02:00:00.000Z');
  // Both processes get the same planned instant from croner, whatever the zone.
  const runs = await Promise.all([berlin.schedule.onCron(fire), tokyo.schedule.onCron(fire)]);
  assert.equal(runs.filter(Boolean).length, 1);
  const keys = await knex('magic_editor_x_locks').where('key', 'like', 'linkrun:%').select('key');
  assert.deepEqual(
    keys.map((row) => row.key),
    [`linkrun:${Math.floor(fire.getTime() / 60000)}`]
  );
  // The next fire minute is a new key.
  const next = await berlin.schedule.onCron(new Date(fire.getTime() + 24 * 3600 * 1000));
  assert.ok(next);
});

test('status: running is true while any process holds the run lease, and lists tz and the next run', async () => {
  const knex = await openDatabase();
  const one = createProcess(knex, { tz: 'UTC' });
  const two = createProcess(knex, { tz: 'UTC' });
  await one.services.store.init();
  assert.equal((await two.schedule.status()).running, false);
  assert.equal(await one.services.store.acquire('links:schedule', 'other-process', 60000), true);
  const state = await two.schedule.status();
  assert.equal(state.running, true);
  assert.equal(state.tz, 'UTC');
  assert.equal(state.nextRunAt, null);
  // runNow on the second process answers RUNNING while the lease is held elsewhere.
  assert.deepEqual(await two.schedule.runNow(), { started: false, reason: 'RUNNING' });
  await one.services.store.release('links:schedule', 'other-process');
  assert.equal((await two.schedule.status()).running, false);
});

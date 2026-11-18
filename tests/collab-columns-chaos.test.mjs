import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { loadCollabClient, simulatedEditor, ioRef } from '../scripts/cluster/node-client.mjs';
import { createSeedUpdate } from '../shared/ydoc.mjs';

/**
 * Columns item store (2.6.1) under load: several real admin clients on two
 * service instances type into paragraphs, table cells, list items and column
 * items, add items and move them between columns (also by changing the
 * number of columns), all at the same time. Every update must pass the live
 * guard, no seed block may disappear and every typed marker must be kept once.
 */

const require = createRequire(import.meta.url);
// The server source requires 'yjs' (CommonJS build) while the shared modules
// import it (ESM build). The published server bundle has one copy; here the
// server source is pointed at the ESM build so both use the same instance.
const Module = require('node:module');
const yjsEsm = fileURLToPath(import.meta.resolve('yjs'));
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request === 'yjs') return yjsEsm;
  return resolveFilename.call(this, request, ...rest);
};
const knexFactory = require('knex');
const storePath = require.resolve('../server/src/services/store.js');
const collabPath = require.resolve('../server/src/services/collaboration.js');
const { signToken, getTokenKey } = require('../server/src/utils/crypto.js');

ioRef.io = io;
const { createCollabClient } = await loadCollabClient();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TABLES = [
  'magic_editor_x_collab_updates',
  'magic_editor_x_collab_presence',
  'magic_editor_x_locks',
  'magic_editor_x_counters',
];

const openDatabase = async () => {
  const pgUrl = process.env.MEX_TEST_PG_URL;
  if (pgUrl) {
    if (!/^mex_[a-z0-9_]+$/.test(new URL(pgUrl).pathname.slice(1)))
      throw new Error('MEX_TEST_PG_URL: the database name must start with mex_');
    const knex = knexFactory({ client: 'pg', connection: pgUrl, pool: { min: 0, max: 8 } });
    for (const name of TABLES) await knex.schema.dropTableIfExists(name);
    return knex;
  }
  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
};

/** A fake Strapi with the plugin's store and collaboration services on a shared database. */
const createInstance = (knex, config = {}) => {
  // A fresh module per instance: every "process" gets its own PROCESS_ID and memory.
  delete require.cache[storePath];
  delete require.cache[collabPath];
  const createStore = require(storePath);
  const createCollaboration = require(collabPath);
  const settings = {
    'admin.auth.secret': 'synthetic-admin-secret-for-tests-only',
    'plugin::magic-editor-x.collaboration.pollIntervalMs': 50,
    'plugin::magic-editor-x.collaboration.snapshotIntervalMinutes': 0,
    'plugin::magic-editor-x.collaboration.compaction': { enabled: false },
    ...config,
  };
  const logs = [];
  const services = {};
  const strapi = {
    config: { get: (key) => settings[key] },
    log: {
      info: (message) => logs.push(['info', message]),
      warn: (message, meta) => logs.push(['warn', message, meta]),
      error: (message) => logs.push(['error', message]),
      debug: () => {},
    },
    db: {
      connection: knex,
      getConnection: (name) => knex(name),
      getSchemaConnection: () => knex.schema,
    },
    server: { httpServer: http.createServer() },
    plugin: () => ({ service: (name) => services[name] }),
  };
  services.store = createStore({ strapi });
  services.access = {
    abilityForUser: async () => ({}),
    checkField: async ({ field }) => ({ canUpdate: true, locale: 'en', fieldName: field }),
  };
  services.history = {
    fieldKey: ({ uid, documentId, locale, field }) => `${uid}|${documentId}|${locale || '-'}|${field}`,
    create: async () => ({ created: true }),
  };
  services.collaboration = createCollaboration({ strapi });
  return { strapi, services, logs, collab: services.collaboration, store: services.store };
};

const startInstance = async (instance) => {
  await new Promise((resolve) => instance.strapi.server.httpServer.listen(0, '127.0.0.1', resolve));
  await instance.collab.start();
  instance.url = `http://127.0.0.1:${instance.strapi.server.httpServer.address().port}`;
  return instance;
};

const stopInstance = async (instance) => {
  await instance.collab.stop();
  await new Promise((resolve) => instance.strapi.server.httpServer.close(() => resolve()));
};

const target = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' };
const ROOM = 'api::article.article|doc1|en|body';
let nonce = 0;
const tokenFor = (instance) =>
  signToken(
    {
      room: ROOM,
      target,
      userId: 1,
      name: 'Synthetic A.',
      color: 'primary',
      canEdit: true,
      protocol: 4,
      nonce: `n${Date.now()}-${(nonce += 1)}`,
      exp: Date.now() + 60000,
    },
    getTokenKey(instance.strapi)
  );

const seed = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'Start' } },
    {
      id: 't1',
      type: 'table',
      data: {
        withHeadings: false,
        content: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
    },
    { id: 'p2', type: 'paragraph', data: { text: 'End' } },
    {
      id: 'm1',
      type: 'columns',
      data: {
        columns: [
          { id: 'mc1', items: [{ id: 'mi1', type: 'paragraph', text: 'One' }] },
          { id: 'mc2', items: [{ id: 'mi2', type: 'paragraph', text: 'Two' }] },
          {
            id: 'mc3',
            items: [
              { id: 'mi3', type: 'heading', text: 'Three', level: 3 },
              { id: 'mi4', type: 'list', text: 'Four', style: 'unordered' },
            ],
          },
        ],
        _mex: 1,
      },
    },
  ],
};

test('typing, adding and moving column items on two processes: nothing refused, lost or duplicated', async () => {
  const knex = await openDatabase();
  const a = await startInstance(createInstance(knex));
  const b = await startInstance(createInstance(knex));
  const sims = [];
  const random = (() => {
    let s = 7;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  })();
  const rnd = (n) => Math.floor(random() * n);
  try {
    await a.store.init();
    await a.store.appendUpdate(ROOM, createSeedUpdate(seed, 'chaos-1'), 'seed');
    await a.store.ensureGeneration(ROOM, 'chaos-1');
    for (let i = 0; i < 6; i += 1) {
      const instance = i % 2 ? b : a;
      sims.push(
        simulatedEditor({
          name: `c${i}`,
          createCollabClient,
          url: instance.url,
          requestSession: async () => ({
            token: tokenFor(instance),
            path: '/magic-editor-x/realtime',
            canEdit: true,
          }),
        })
      );
    }
    const until = Date.now() + 15000;
    while (!sims.every((sim) => sim.state.status === 'live' && sim.renders > 0) && Date.now() < until)
      await sleep(20);
    const markers = [];
    let counter = 0;
    let moves = 0;
    for (let round = 0; round < 40; round += 1) {
      for (const sim of sims) {
        const marker = `[${sim.name}m${(counter += 1)}]`;
        const kind = random();
        const ok = sim.edit((doc) => {
          const block = doc.blocks.find((x) => x.id === 'm1');
          if (kind < 0.25 && block) {
            const columns = block.data.columns;
            if (random() < 0.25) {
              if (columns.length === 3) {
                columns[1].items.push(...columns[2].items);
                block.data.columns = columns.slice(0, 2);
              } else columns.push({ id: `mc${sim.name}x${counter}`, items: [] });
            } else {
              const from = columns.filter((column) => column.items.length);
              const source = from[rnd(from.length)];
              const target = columns[rnd(columns.length)];
              if (source && target !== source)
                target.items.splice(
                  rnd(target.items.length + 1),
                  0,
                  ...source.items.splice(rnd(source.items.length), 1)
                );
            }
            moves += 1;
            return;
          }
          const slots = [];
          for (const x of doc.blocks) {
            if (x.type === 'paragraph') slots.push((f) => (x.data.text = f(x.data.text)));
            if (x.type === 'table')
              x.data.content.forEach((row) => row.forEach((_, k) => slots.push((f) => (row[k] = f(row[k])))));
            if (x.type === 'columns')
              x.data.columns.forEach((c) =>
                c.items.forEach((it) => slots.push((f) => (it.text = f(it.text))))
              );
          }
          if (kind < 0.3 && block)
            block.data.columns[0].items.push({
              id: `n${sim.name}x${counter}`,
              type: 'paragraph',
              text: marker,
            });
          else if (slots.length) slots[rnd(slots.length)]((text) => `${text}${marker}`);
          else doc.blocks.push({ id: `b${sim.name}x${counter}`, type: 'paragraph', data: { text: marker } });
          markers.push(marker);
        });
        if (!ok) markers.splice(markers.indexOf(marker), markers.includes(marker) ? 1 : 0);
      }
      await sleep(25);
    }
    const settleUntil = Date.now() + 30000;
    const same = () =>
      sims.every(
        (sim) =>
          sim.state.status === 'live' &&
          !sim.state.pending &&
          JSON.stringify(sim.client.getData().blocks) === JSON.stringify(sims[0].client.getData().blocks)
      );
    while (!same() && Date.now() < settleUntil) await sleep(100);
    assert.ok(same(), 'converged');
    const refused = [...a.logs, ...b.logs].filter(
      ([level, message]) => level === 'warn' && /refused/.test(message)
    );
    assert.deepEqual(
      refused.map((entry) => entry[2]),
      [],
      'no update refused'
    );
    const data = sims[0].client.getData();
    assert.deepEqual(
      seed.blocks.map((x) => x.id).filter((id) => !data.blocks.some((x) => x.id === id)),
      [],
      'every seed block kept'
    );
    const text = JSON.stringify(data);
    assert.deepEqual(
      markers.filter((m) => !text.includes(m)),
      [],
      'no lost edits'
    );
    assert.deepEqual(
      markers.filter((m) => text.split(m).length > 2),
      [],
      'no duplicates'
    );
    const ids = data.blocks
      .find((x) => x.id === 'm1')
      .data.columns.flatMap((c) => c.items.map((it) => it.id));
    assert.equal(new Set(ids).size, ids.length, 'every item once');
    assert.ok(moves > 20, `${moves} moves`);
  } finally {
    for (const sim of sims) sim.client.destroy();
    await stopInstance(a);
    await stopInstance(b);
    await knex.destroy();
  }
});

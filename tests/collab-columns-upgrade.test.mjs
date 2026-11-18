import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { io } from 'socket.io-client';
import { loadCollabClient, simulatedEditor, ioRef } from '../scripts/cluster/node-client.mjs';
import {
  docToEditorData,
  epochOf,
  getTypes,
  hasLegacyColumns,
  itemStoreOf,
  toShared,
} from '../shared/ydoc.mjs';

/**
 * Columns item store (2.6.1) on the server: a room written by 2.6.0 (columns
 * items nested in the columns) is moved to a new generation with the item
 * store as soon as it is loaded; connected clients follow without losing
 * edits; afterwards moving an item while someone types into it keeps the
 * typing; a client of protocol 3 (the 2.6.0 admin) is refused with
 * UPGRADE_REQUIRED. Two service instances share one database (SQLite in
 * memory, or MEX_TEST_PG_URL like collab-compaction).
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

const columnsDoc = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'Before' } },
    {
      id: 'cols1',
      type: 'columns',
      data: {
        columns: [
          { id: 'c1', items: [{ id: 'a', type: 'paragraph', text: 'Alpha' }] },
          { id: 'c2', items: [{ id: 'b', type: 'paragraph', text: 'Bravo' }] },
          { id: 'c3', items: [{ id: 'c', type: 'paragraph', text: 'Charlie' }] },
        ],
        _mex: 1,
      },
    },
  ],
};

/** The seed row of a room as 2.6.0 wrote it (structural mapping of the columns). */
const legacySeed = (data, epoch) => {
  const ydoc = new Y.Doc();
  const { meta, order, blocks } = getTypes(ydoc);
  ydoc.transact(() => {
    meta.set('schema', 3);
    meta.set('epoch', epoch);
    order.insert(
      0,
      data.blocks.map((block) => block.id)
    );
    for (const block of data.blocks)
      blocks.set(
        block.id,
        new Y.Map([
          ['type', block.type],
          ['tunes', toShared({}, 2)],
          ['data', toShared(block.data, 2)],
        ])
      );
  });
  const update = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return update;
};

const roomDoc = async (store) => {
  const doc = new Y.Doc();
  for (const row of await store.readRoom(ROOM)) Y.applyUpdate(doc, row.update);
  return doc;
};

const waitFor = async (check, label, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(50);
  }
  assert.fail(`timed out: ${label}`);
};

test('a 2.6.0 room moves to the item store; then a move keeps concurrent typing on two processes', async () => {
  const knex = await openDatabase();
  const a = await startInstance(createInstance(knex));
  const b = await startInstance(createInstance(knex));
  const sims = [];
  try {
    await a.store.init();
    await a.store.appendUpdate(ROOM, legacySeed(columnsDoc, 'legacy-260'), 'seed');
    await a.store.ensureGeneration(ROOM, 'legacy-260');
    const before = await roomDoc(a.store);
    assert.equal(hasLegacyColumns(before), true);
    before.destroy();
    for (const [i, instance] of [a, b].entries()) {
      const sim = simulatedEditor({
        name: `c${i}`,
        createCollabClient,
        url: instance.url,
        requestSession: async () => ({
          token: tokenFor(instance),
          path: '/magic-editor-x/realtime',
          canEdit: true,
        }),
      });
      sims.push(sim);
    }
    await waitFor(() => sims.every((sim) => sim.state.status === 'live'), 'clients live');
    // Loading the room started the upgrade: a new generation without nested columns.
    await waitFor(async () => {
      const doc = await roomDoc(a.store);
      const done = epochOf(doc) !== 'legacy-260' && !hasLegacyColumns(doc);
      doc.destroy();
      return done;
    }, 'room upgraded');
    const upgraded = await roomDoc(a.store);
    assert.ok(itemStoreOf(getTypes(upgraded).blocks.get('cols1')), 'the columns block has an item store');
    assert.equal(
      JSON.stringify(docToEditorData(upgraded).blocks),
      JSON.stringify(columnsDoc.blocks),
      'same content, byte for byte'
    );
    upgraded.destroy();
    const sameView = () =>
      sims.every(
        (sim) =>
          sim.state.status === 'live' &&
          !sim.state.pending &&
          sim.renders > 0 &&
          JSON.stringify(sim.client.getData().blocks) === JSON.stringify(sims[0].client.getData().blocks)
      );
    await waitFor(sameView, 'clients on the new generation');
    // Fewer columns on one process (moves c), typing into c on the other, at the same time.
    const [mover, typist] = sims;
    for (let round = 0; round < 10; round += 1) {
      const word = `w${round}`;
      typist.edit((doc) => {
        const it = doc.blocks[1].data.columns.flatMap((c) => c.items).find((x) => x.id === 'c');
        it.text = `${it.text} ${word}`;
      });
      mover.edit((doc) => {
        const data = doc.blocks[1].data;
        if (data.columns.length === 3) {
          data.columns[1].items.push(...data.columns[2].items);
          data.columns = data.columns.slice(0, 2);
        } else data.columns.push({ id: `n${round}`, items: data.columns[1].items.splice(-1) });
      });
      await sleep(30);
    }
    await waitFor(sameView, 'converged');
    const shown = sims[0].client.getData().blocks[1].data.columns.flatMap((c) => c.items);
    const c = shown.filter((x) => x.id === 'c');
    assert.equal(c.length, 1, 'shown once');
    for (let round = 0; round < 10; round += 1) assert.match(c[0].text, new RegExp(`\\bw${round}\\b`));
    const stored = await roomDoc(b.store);
    assert.equal(
      JSON.stringify(docToEditorData(stored).blocks),
      JSON.stringify(sims[0].client.getData().blocks)
    );
    stored.destroy();
    // The 2.6.0 admin (protocol 3) is refused.
    const errors = [];
    const old = io(a.url, {
      path: '/magic-editor-x/realtime',
      transports: ['websocket'],
      reconnection: false,
      auth: { token: tokenFor(a), protocol: 3 },
    });
    old.on('connect_error', (error) => errors.push(error && error.data && error.data.code));
    await waitFor(() => errors.length > 0, 'old client refused');
    old.close();
    assert.deepEqual(errors, ['UPGRADE_REQUIRED']);
  } finally {
    for (const sim of sims) sim.client.destroy();
    await stopInstance(a);
    await stopInstance(b);
    await knex.destroy();
  }
});

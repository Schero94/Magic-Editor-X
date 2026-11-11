import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { io } from 'socket.io-client';
import { loadCollabClient, simulatedEditor, ioRef } from '../scripts/cluster/node-client.mjs';
import { applyTextEdit, createSeedUpdate, docToEditorData, epochOf } from '../shared/ydoc.mjs';
import { createReplica } from '../shared/collab-replica.mjs';

/**
 * Room compaction (2.2): a long-lived room is rebuilt as a new generation
 * from its current content, which drops the Yjs metadata of every deleted
 * character, and connected clients move to it without reconnecting.
 *
 * - store: the generation row guards appends and generation switches (an
 *   append against an old generation fails, a switch aborts when anything was
 *   written meanwhile, the 200-row merge never stores an old generation);
 * - two collaboration service instances ("processes") with separate memory
 *   share one database; real admin clients (the browser code) edit through
 *   both while one client is offline with unsent edits and another has an
 *   edit in flight; a compaction on one instance moves every room and client
 *   to the new generation: no client disconnects, nothing is lost or
 *   duplicated, an update of the old generation is answered RETRY, and the
 *   encoded room state shrinks.
 *
 * Sessions: MEX_COMPACT_SEEDS (default 3) from MEX_COMPACT_FROM (default 1).
 * PostgreSQL instead of SQLite: MEX_TEST_PG_URL (database name must start
 * with mex_; its collaboration tables are dropped first).
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
const clone = (value) => JSON.parse(JSON.stringify(value));
const TABLES = [
  'magic_editor_x_collab_updates',
  'magic_editor_x_collab_presence',
  'magic_editor_x_locks',
  'magic_editor_x_counters',
];

/** Deterministic PRNG (mulberry32). */
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

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
    checkField: async () => ({ canUpdate: true, locale: 'en' }),
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
      protocol: 3,
      nonce: `n${Date.now()}-${(nonce += 1)}`,
      exp: Date.now() + 60000,
    },
    getTokenKey(instance.strapi)
  );

const seedDoc = {
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
  ],
};

const roomData = async (store) => {
  const rows = await store.readRoom(ROOM);
  const doc = new Y.Doc();
  for (const row of rows) Y.applyUpdate(doc, row.update);
  const out = { data: docToEditorData(doc), epoch: epochOf(doc), rows };
  doc.destroy();
  return out;
};

test('compaction drops tombstones: the rebuilt generation is much smaller and has the same content', () => {
  // Several people typing and deleting: Yjs keeps an id range per client and edit.
  const seedUpdate = createSeedUpdate(seedDoc, 'e1');
  const server = new Y.Doc();
  Y.applyUpdate(server, seedUpdate);
  const replicas = Array.from({ length: 4 }, () => {
    const outbox = [];
    const replica = createReplica({ onLocalUpdate: (update) => outbox.push(update), captureTimeout: 0 });
    replica.applyRemote(seedUpdate);
    const shown = replica.snapshot();
    replica.markShown(shown.catchUp);
    return { replica, outbox, editor: clone(shown.data) };
  });
  for (let i = 0; i < 4000; i += 1) {
    const c = replicas[i % replicas.length];
    const block = c.editor.blocks[(i * 7) % c.editor.blocks.length];
    if (block.type === 'paragraph') block.data.text = i % 2 ? 'Start' : `Start typing ${i}`;
    else block.data.content[0][0] = i % 2 ? 'a' : `a ${i}`;
    c.replica.pushLocal(clone(c.editor));
    for (const update of c.outbox.splice(0)) {
      Y.applyUpdate(server, update);
      for (const other of replicas) {
        if (other === c) continue;
        other.replica.applyRemote(update);
        const shown = other.replica.snapshot();
        other.editor = clone(shown.data);
        other.replica.markShown(shown.catchUp, clone(shown.data));
      }
    }
  }
  const before = Y.encodeStateAsUpdate(server).byteLength;
  const seed = createSeedUpdate(docToEditorData(server), 'e2');
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, seed);
  assert.deepEqual(docToEditorData(fresh).blocks, docToEditorData(server).blocks);
  assert.ok(seed.byteLength * 4 < before, `${before} -> ${seed.byteLength} bytes`);
  for (const c of replicas) c.replica.destroy();
  server.destroy();
  fresh.destroy();
});

test('re-applying unsent text edits onto a newer text keeps every concurrent change, once', () => {
  const run = (shared, base, local) => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, shared);
    applyTextEdit(text, base, local);
    const out = text.toString();
    doc.destroy();
    return out;
  };
  // Insert next to other people's inserts: whole markers, never split.
  assert.ok(
    ['[a][x][b][y][n][c]', '[a][x][b][n][y][c]'].includes(run('[a][x][b][y][c]', '[a][b][c]', '[a][b][n][c]'))
  );
  // Several local changes in one text, the shared text changed elsewhere too.
  assert.equal(
    run('One two THREE four five', 'One two three four', 'Uno two three four!'),
    'Uno two THREE four! five'
  );
  // Deleting a word someone else edited keeps their edit.
  assert.equal(run('alpha beta+ gamma', 'alpha beta gamma', 'alpha gamma'), 'alpha+ gamma');
  // An edit the shared text already holds is not applied twice.
  assert.equal(run('Start [m1]', 'Start', 'Start [m1]'), 'Start [m1]');
});

test('store: the generation row guards appends, switches and the 200-row merge', async () => {
  const knex = await openDatabase();
  try {
    const { store } = createInstance(knex);
    await store.init();
    const seed1 = createSeedUpdate(seedDoc, 'e1');
    const seedId = await store.appendUpdate(ROOM, seed1, 'seed');
    await store.ensureGeneration(ROOM, 'e1');
    await store.ensureGeneration(ROOM, 'other');
    assert.equal(await store.getGeneration(ROOM), 'e1');
    const id = await store.appendUpdate(ROOM, new Uint8Array([0, 0]), 'update', { epoch: 'e1' });
    assert.ok(id > seedId);
    await assert.rejects(store.appendUpdate(ROOM, new Uint8Array([0, 0]), 'update', { epoch: 'old' }), {
      code: 'STALE_GENERATION',
    });
    // A switch aborts when a row was written after the rows it read.
    const seed2 = createSeedUpdate(seedDoc, 'e2');
    const aborted = await store.replaceGeneration(ROOM, {
      ids: [seedId],
      lastId: seedId,
      lastAt: 1,
      fromEpoch: 'e1',
      toEpoch: 'e2',
      seed: seed2,
    });
    assert.equal(aborted, 0);
    assert.equal(await store.getGeneration(ROOM), 'e1');
    // A switch from the wrong generation aborts too.
    assert.equal(
      await store.replaceGeneration(ROOM, {
        ids: [seedId, id],
        lastId: id,
        lastAt: 1,
        fromEpoch: 'nope',
        toEpoch: 'e2',
        seed: seed2,
      }),
      0
    );
    const switched = await store.replaceGeneration(ROOM, {
      ids: [seedId, id],
      lastId: id,
      lastAt: 12345,
      fromEpoch: 'e1',
      toEpoch: 'e2',
      seed: seed2,
    });
    assert.ok(switched > id);
    assert.equal(await store.getGeneration(ROOM), 'e2');
    const rows = await store.readRoom(ROOM);
    assert.deepEqual(
      rows.map((row) => [row.id, row.kind, row.createdAt]),
      [[switched, 'seed', 12345]]
    );
    // Appends of the old generation fail; of the new one succeed.
    await assert.rejects(store.appendUpdate(ROOM, new Uint8Array([0, 0]), 'update', { epoch: 'e1' }), {
      code: 'STALE_GENERATION',
    });
    await store.appendUpdate(ROOM, new Uint8Array([0, 0]), 'update', { epoch: 'e2' });
    // The 200-row merge of rows that a switch already replaced stores nothing.
    const before = (await store.readRoom(ROOM)).length;
    await store.replaceRows(ROOM, [seedId, id], new Uint8Array([0, 0]));
    assert.equal((await store.readRoom(ROOM)).length, before);
    // Deleting the room forgets its generation.
    await store.deleteRoom(ROOM);
    assert.equal(await store.getGeneration(ROOM), null);
  } finally {
    await knex.destroy();
  }
});

const FROM = Number(process.env.MEX_COMPACT_FROM || 1);
const SEEDS = Number(process.env.MEX_COMPACT_SEEDS || 3);

for (let seed = FROM; seed < FROM + SEEDS; seed += 1) {
  test(`two processes, live and offline clients, compaction mid-session (seed ${seed})`, async () => {
    const random = prng(seed);
    const rnd = (n) => Math.floor(random() * n);
    const knex = await openDatabase();
    const a = await startInstance(createInstance(knex));
    const b = await startInstance(createInstance(knex));
    const sims = [];
    try {
      await a.store.init();
      const seedId = await a.store.appendUpdate(ROOM, createSeedUpdate(seedDoc, `e-${seed}`), 'seed');
      assert.ok(seedId > 0);
      await a.store.ensureGeneration(ROOM, `e-${seed}`);

      const instances = [a, b, a, b, b];
      instances.forEach((instance, i) => {
        const net = { online: true, sockets: [], disconnects: 0 };
        const sim = simulatedEditor({
          name: `c${i}`,
          createCollabClient,
          url: instance.url,
          requestSession: async () => {
            if (!net.online) throw Object.assign(new Error('offline'), { response: { status: 0 } });
            return { token: tokenFor(instance), path: '/magic-editor-x/realtime', canEdit: true };
          },
          onSocket: (socket) => {
            net.sockets.push(socket);
            socket.on('disconnect', () => {
              net.disconnects += 1;
            });
          },
        });
        sim.net = net;
        sims.push(sim);
      });
      const live = async (list) => {
        const until = Date.now() + 15000;
        while (Date.now() < until) {
          if (list.every((sim) => sim.state.status === 'live')) return;
          await sleep(20);
        }
        throw new Error(`seed ${seed}: clients not live`);
      };
      await live(sims);
      await sleep(200);

      const markers = [];
      let counter = 0;
      const edit = (sim) => {
        if (!sim.editor.blocks.length) return;
        const marker = `[${sim.name}m${(counter += 1)}]`;
        const ok = sim.edit((doc) => {
          const r = random();
          if (r < 0.15) {
            doc.blocks.splice(rnd(doc.blocks.length + 1), 0, {
              id: `n${sim.name}x${counter}`,
              type: 'paragraph',
              data: { text: marker },
            });
            return;
          }
          const slots = [];
          for (const block of doc.blocks) {
            // p2 is rewritten by the churn below; markers go elsewhere.
            if (block.type === 'paragraph' && block.id !== 'p2')
              slots.push((f) => (block.data.text = f(block.data.text)));
            if (block.type === 'table')
              block.data.content.forEach((row) =>
                row.forEach((_, k) => slots.push((f) => (row[k] = f(row[k]))))
              );
          }
          slots[rnd(slots.length)]((text) => {
            const s = String(text);
            let at = rnd(s.length + 1);
            const open = s.lastIndexOf('[', at - 1);
            const close = s.lastIndexOf(']', at - 1);
            if (open > close) at = open;
            return s.slice(0, at) + marker + s.slice(at);
          });
        });
        if (ok) markers.push(marker);
      };
      // Typing and deleting builds tombstones (what compaction removes).
      const churn = (sim, rounds) => {
        for (let i = 0; i < rounds; i += 1) {
          sim.edit((doc) => {
            const block = doc.blocks.find((item) => item.id === 'p2');
            if (block) block.data.text = i % 2 ? 'End' : `End ${'x'.repeat(40)} ${i}`;
          });
        }
      };

      for (let round = 0; round < 15; round += 1) {
        for (const sim of sims) if (random() < 0.6) edit(sim);
        churn(sims[round % sims.length], 6);
        await sleep(20 + rnd(40));
      }
      const settle = async (label) => {
        const until = Date.now() + 30000;
        while (Date.now() < until) {
          await sleep(100);
          const first = JSON.stringify(sims[0].client.getData().blocks);
          if (
            sims.every((sim) => sim.state.status === 'live' && !sim.state.pending) &&
            sims.every((sim) => JSON.stringify(sim.client.getData().blocks) === first)
          )
            return;
        }
        throw new Error(`seed ${seed}: no convergence ${label}`);
      };
      await settle('before compaction');
      const check = (label) => {
        const text = JSON.stringify(sims[0].client.getData());
        const lost = markers.filter((marker) => !text.includes(marker));
        const dupes = markers.filter((marker) => text.split(marker).length > 2);
        assert.deepEqual(lost, [], `seed ${seed}: lost edits ${label}`);
        assert.deepEqual(dupes, [], `seed ${seed}: duplicated edits ${label}`);
      };
      check('before compaction');
      const oldEpoch = (await roomData(a.store)).epoch;

      // An old-generation update kept back (raw socket of the old generation).
      const raw = io(a.url, {
        path: '/magic-editor-x/realtime',
        transports: ['websocket'],
        auth: { token: tokenFor(a), protocol: 3 },
      });
      const rawDoc = new Y.Doc();
      const rawSync = await new Promise((resolve) => raw.once('mx:sync', (message) => resolve(message)));
      Y.applyUpdate(rawDoc, new Uint8Array(rawSync.update));
      const rawVector = Y.encodeStateVector(rawDoc);
      rawDoc.getMap('blocks').get('p1').get('data').get('text').insert(0, 'OLD-GENERATION ');
      const staleUpdate = Y.encodeStateAsUpdate(rawDoc, rawVector);

      // Client 4 goes offline and keeps typing (unsent edits); client 1 has an edit in flight.
      const offline = sims[4];
      offline.net.online = false;
      for (const socket of offline.net.sockets) if (socket.io && socket.io.engine) socket.io.engine.close();
      await sleep(100);
      for (let i = 0; i < 3; i += 1) edit(offline);
      const disconnectsBefore = sims.slice(0, 4).map((sim) => sim.net.disconnects);
      edit(sims[1]);

      let result = { compacted: false };
      for (let attempt = 0; attempt < 50 && !result.compacted; attempt += 1) {
        result = await a.collab.compactRoom(ROOM, { force: true, idleMs: 0 });
        if (!result.compacted) await sleep(50);
      }
      assert.ok(result.compacted, `seed ${seed}: compaction did not run`);
      const after = await roomData(a.store);
      assert.notEqual(after.epoch, oldEpoch);
      assert.equal(after.rows[0].kind, 'seed');
      assert.equal(await a.store.getGeneration(ROOM), after.epoch);

      // Every online client moves to the new generation without reconnecting.
      await sleep(400);
      const replies = await new Promise((resolve) =>
        raw.timeout(3000).emit('mx:update', staleUpdate, (error, reply) => resolve(error ? { error } : reply))
      );
      assert.deepEqual(replies, { ok: false, code: 'RETRY' }, `seed ${seed}: old generation update`);
      raw.disconnect();
      rawDoc.destroy();

      for (let round = 0; round < 8; round += 1) {
        for (const sim of sims) if (random() < 0.6) edit(sim);
        await sleep(20 + rnd(40));
      }
      offline.net.online = true;
      for (const socket of offline.net.sockets) if (!socket.connected) socket.connect();
      await settle('after compaction');

      assert.deepEqual(
        sims.slice(0, 4).map((sim) => sim.net.disconnects),
        disconnectsBefore,
        `seed ${seed}: online clients were disconnected`
      );
      const final = JSON.stringify(sims[0].client.getData());
      const lost = markers.filter((marker) => !final.includes(marker));
      const dupes = markers.filter((marker) => final.split(marker).length > 2);
      assert.deepEqual(lost, [], `seed ${seed}: lost edits`);
      assert.deepEqual(dupes, [], `seed ${seed}: duplicated edits`);
      assert.ok(!final.includes('OLD-GENERATION'), `seed ${seed}: old-generation update merged`);
      for (const sim of sims)
        assert.equal(JSON.stringify(sim.editor.blocks), JSON.stringify(sims[0].client.getData().blocks));
      const stored = await roomData(b.store);
      assert.equal(JSON.stringify(stored.data.blocks), JSON.stringify(sims[0].client.getData().blocks));
      for (const instance of [a, b]) {
        const info = instance.collab.roomsInfo().find((entry) => entry.room === ROOM);
        assert.equal(info.epoch, after.epoch, `seed ${seed}: instance kept the old generation`);
      }
      assert.ok(result.after < result.before, `seed ${seed}: ${result.before} -> ${result.after} bytes`);
      assert.deepEqual(
        [...a.logs, ...b.logs].filter(([level]) => level !== 'info'),
        [],
        `seed ${seed}: warnings`
      );
    } finally {
      for (const sim of sims) sim.client.destroy();
      await stopInstance(a);
      await stopInstance(b);
      await knex.destroy();
    }
  });
}

test('everybody but one goes offline on a long document, the room is compacted, all unsent edits arrive once', async () => {
  const random = prng(4242);
  const rnd = (n) => Math.floor(random() * n);
  const longDoc = {
    time: 1,
    version: '2.31.7',
    blocks: Array.from({ length: 120 }, (_, i) => ({
      id: `b${i}`,
      type: 'paragraph',
      data: { text: `Text ${i}` },
    })),
  };
  const knex = await openDatabase();
  const a = await startInstance(createInstance(knex));
  const b = await startInstance(createInstance(knex));
  const sims = [];
  try {
    await a.store.init();
    await a.store.appendUpdate(ROOM, createSeedUpdate(longDoc, 'long-1'), 'seed');
    await a.store.ensureGeneration(ROOM, 'long-1');
    for (let i = 0; i < 8; i += 1) {
      const instance = i % 2 ? b : a;
      const net = { online: true, sockets: [] };
      const sim = simulatedEditor({
        name: `c${i}`,
        createCollabClient,
        url: instance.url,
        requestSession: async () => {
          if (!net.online) throw Object.assign(new Error('offline'), { response: { status: 0 } });
          return { token: tokenFor(instance), path: '/magic-editor-x/realtime', canEdit: true };
        },
        onSocket: (socket) => net.sockets.push(socket),
      });
      sim.net = net;
      sims.push(sim);
    }
    while (!sims.every((sim) => sim.state.status === 'live')) await sleep(20);
    await sleep(300);
    const markers = [];
    let counter = 0;
    const mark = (sim) => {
      const marker = `[${sim.name}m${(counter += 1)}]`;
      const ok = sim.edit((doc) => {
        if (random() < 0.2) {
          doc.blocks.splice(rnd(doc.blocks.length + 1), 0, {
            id: `n${counter}`,
            type: 'paragraph',
            data: { text: marker },
          });
          return;
        }
        const candidates = doc.blocks.filter((block) => block.id !== 'churn');
        const block = candidates[rnd(candidates.length)];
        const text = block.data.text;
        let at = rnd(text.length + 1);
        const open = text.lastIndexOf('[', at - 1);
        const close = text.lastIndexOf(']', at - 1);
        if (open > close) at = open;
        block.data.text = text.slice(0, at) + marker + text.slice(at);
      });
      if (ok) markers.push(marker);
    };
    // Several people create the same block at once and keep rewriting it.
    const churn = (sim) =>
      sim.edit((doc) => {
        const block = doc.blocks.find((item) => item.id === 'churn');
        if (!block) doc.blocks.push({ id: 'churn', type: 'paragraph', data: { text: 'Churn' } });
        else block.data.text = block.data.text === 'Churn' ? 'Churn xxxx' : 'Churn';
      });
    const settle = async () => {
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        await sleep(200);
        const first = JSON.stringify(sims[0].client.getData().blocks);
        if (
          sims.every(
            (sim) =>
              sim.state.status === 'live' &&
              !sim.state.pending &&
              JSON.stringify(sim.client.getData().blocks) === first
          )
        )
          return true;
      }
      return false;
    };
    const check = (label) => {
      const text = JSON.stringify(sims[0].client.getData());
      assert.deepEqual(
        [markers.filter((m) => !text.includes(m)), markers.filter((m) => text.split(m).length > 2)],
        [[], []],
        `lost or duplicated ${label}`
      );
    };
    for (let round = 0; round < 20; round += 1) {
      for (const sim of sims) {
        mark(sim);
        churn(sim);
      }
      await sleep(30);
    }
    assert.ok(await settle(), 'converged before compaction');
    check('before compaction');
    for (const sim of sims.slice(1)) {
      sim.net.online = false;
      for (const socket of sim.net.sockets) if (socket.io && socket.io.engine) socket.io.engine.close();
    }
    await sleep(300);
    for (let round = 0; round < 5; round += 1)
      for (const sim of sims.slice(1)) {
        mark(sim);
        churn(sim);
      }
    let result = { compacted: false };
    for (let attempt = 0; attempt < 50 && !result.compacted; attempt += 1) {
      result = await a.collab.compactRoom(ROOM, { force: true, idleMs: 0 });
      if (!result.compacted) await sleep(50);
    }
    assert.ok(result.compacted);
    for (const sim of sims) {
      sim.net.online = true;
      for (const socket of sim.net.sockets) if (!socket.connected) socket.connect();
    }
    assert.ok(await settle(), 'converged after compaction');
    check('after compaction');
    const stored = await roomData(b.store);
    assert.equal(JSON.stringify(stored.data.blocks), JSON.stringify(sims[0].client.getData().blocks));
  } finally {
    for (const sim of sims) sim.client.destroy();
    await stopInstance(a);
    await stopInstance(b);
    await knex.destroy();
  }
});

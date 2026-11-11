import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { loadCollabClient } from '../scripts/cluster/node-client.mjs';
import { createSeedUpdate, docToEditorData } from '../shared/ydoc.mjs';

/**
 * The admin collaboration client against a fake Socket.IO server: unsent
 * edits survive disconnects, a new room generation (epoch) never merges the
 * old document (no duplicated content), refusals keep or drop edits as
 * documented, and the backoff has jitter within bounds.
 */

const { createCollabClient, backoffDelay } = await loadCollabClient();
const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });

/** In-memory server with one room and a socket the client talks to. */
const fakeServer = (blocks, epoch) => {
  const server = { doc: new Y.Doc(), epoch, refuse: null, sockets: [] };
  Y.applyUpdate(server.doc, createSeedUpdate({ time: 1, blocks }, epoch));
  server.replaceRoom = (nextBlocks, nextEpoch) => {
    server.doc = new Y.Doc();
    server.epoch = nextEpoch;
    Y.applyUpdate(server.doc, createSeedUpdate({ time: 1, blocks: nextBlocks }, nextEpoch));
  };
  server.factory = () => {
    const handlers = new Map();
    const fire = (event, payload) => (handlers.get(event) || []).forEach((fn) => fn(payload));
    const socket = {
      connected: false,
      active: true,
      on(event, fn) {
        handlers.set(event, [...(handlers.get(event) || []), fn]);
        return socket;
      },
      removeAllListeners() {
        handlers.clear();
      },
      timeout() {
        return socket;
      },
      emit(event, payload, ack) {
        if (event === 'mx:update') {
          if (server.refuse) return ack(null, { ok: false, code: server.refuse });
          Y.applyUpdate(server.doc, new Uint8Array(payload));
          return ack(null, { ok: true, id: 1 });
        }
        if (event === 'mx:resync') socket.sync();
        return undefined;
      },
      sync() {
        fire('mx:sync', {
          update: Y.encodeStateAsUpdate(server.doc),
          stateVector: Y.encodeStateVector(server.doc),
          epoch: server.epoch,
        });
      },
      open() {
        socket.connected = true;
        fire('connect');
        fire('mx:welcome', { canEdit: true, presenceId: 'me', color: 'primary', epoch: server.epoch });
        socket.sync();
      },
      drop() {
        socket.connected = false;
        fire('disconnect', 'transport close');
      },
      connect() {
        socket.open();
      },
      disconnect() {
        socket.connected = false;
      },
    };
    server.sockets.push(socket);
    setTimeout(() => socket.open(), 0);
    return socket;
  };
  return server;
};

const start = (server) => {
  const states = [];
  const client = createCollabClient({
    url: 'http://127.0.0.1:1',
    requestSession: async () => ({ token: 't', path: '/x', canEdit: true }),
    onRemoteData: () => {},
    onState: (state) => states.push(state),
    socketFactory: server.factory,
    win: null,
  });
  return { client, states };
};

test('edits made while disconnected are sent after the reconnect', async () => {
  const server = fakeServer([p('a', 'one')], 'e1');
  const { client } = start(server);
  await flush();
  const socket = server.sockets[0];
  socket.drop();
  client.pushLocal({ blocks: [p('a', 'one two')] });
  assert.equal(docToEditorData(server.doc).blocks[0].data.text, 'one');
  socket.open();
  await flush();
  assert.equal(docToEditorData(server.doc).blocks[0].data.text, 'one two');
  client.destroy();
});

test('a new room generation starts over: unsent edits are re-applied once, nothing is duplicated', async () => {
  const server = fakeServer([p('a', 'one'), p('b', 'two')], 'e1');
  const { client } = start(server);
  await flush();
  const socket = server.sockets[0];
  socket.drop();
  client.pushLocal({ blocks: [p('a', 'one'), p('b', 'two'), p('c', 'typed offline')] });
  // The room was cleaned up and seeded again (same content, new Yjs identities).
  server.replaceRoom([p('a', 'one'), p('b', 'two')], 'e2');
  socket.open();
  await flush();
  const data = client.getData();
  assert.deepEqual(
    data.blocks.map((block) => block.id),
    ['a', 'b', 'c']
  );
  assert.deepEqual(docToEditorData(server.doc).blocks, data.blocks);
  client.destroy();
});

test('RETRY and STORE_FAILED keep the edit; INVALID_UPDATE starts over from the server', async () => {
  const server = fakeServer([p('a', 'x')], 'e1');
  const { client } = start(server);
  await flush();
  server.refuse = 'RETRY';
  client.pushLocal({ blocks: [p('a', 'xy')] });
  await flush();
  assert.equal(docToEditorData(server.doc).blocks[0].data.text, 'x');
  server.refuse = null;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(docToEditorData(server.doc).blocks[0].data.text, 'xy');
  server.refuse = 'INVALID_UPDATE';
  client.pushLocal({ blocks: [p('a', 'xyz')] });
  await flush();
  server.refuse = null;
  await flush();
  assert.equal(client.getData().blocks[0].data.text, 'xy');
  client.destroy();
});

test('backoff grows exponentially with jitter and is capped', () => {
  assert.equal(
    backoffDelay(0, () => 0),
    250
  );
  assert.equal(
    backoffDelay(0, () => 1),
    500
  );
  assert.ok(backoffDelay(3, () => 0.5) > backoffDelay(1, () => 0.5));
  assert.ok(backoffDelay(30, () => 1) <= 15000);
});

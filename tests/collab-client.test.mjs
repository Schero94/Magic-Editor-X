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
        fire('mx:welcome', {
          canEdit: server.canEdit !== false,
          presenceId: 'me',
          color: 'primary',
          epoch: server.epoch,
        });
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

/**
 * Starts a client. By default its editor renders like the field does
 * (snapshot -> show -> markShown); `render: false` models an editor that has
 * not rendered the room yet.
 */
const start = (server, { getInitialView, onRemoteData, render = true } = {}) => {
  const states = [];
  const client = createCollabClient({
    url: 'http://127.0.0.1:1',
    requestSession: async () => ({ token: 't', path: '/x', canEdit: true }),
    onRemoteData: () => {
      if (onRemoteData) return onRemoteData();
      if (!render) return undefined;
      const { data, catchUp } = client.snapshot();
      return client.markShown(catchUp, JSON.parse(JSON.stringify(data)));
    },
    getInitialView,
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

// 2.4 regression (cluster proof run 1, lost first-round markers): a client is
// `live` as soon as the first mx:sync is applied, but the editor renders the
// room only after the debounced onRemoteData (30 ms, longer under load). An
// edit in that window was diffed against the room state instead of what the
// editor showed, so everything the editor had not rendered yet was deleted,
// including edits other clients had stored and got acknowledged.
test('an edit between the first sync and the first render never deletes what the editor has not shown', async () => {
  const server = fakeServer([p('p1', 'Start'), p('p2', 'End')], 'e1');
  const writer = start(server);
  await flush();
  writer.client.pushLocal({ blocks: [p('p1', 'Start [c1m0]'), p('p2', 'End')] });
  await flush();
  assert.equal(docToEditorData(server.doc).blocks[0].data.text, 'Start [c1m0]');
  // A second editor that has not rendered anything yet (onRemoteData never renders).
  const late = start(server, { getInitialView: () => ({ blocks: [] }), render: false });
  await flush();
  assert.equal(late.states.at(-1).status, 'live');
  late.client.pushLocal({ blocks: [p('x', '[c2m1]')] });
  await flush();
  const stored = docToEditorData(server.doc).blocks;
  assert.deepEqual(
    stored.map((block) => block.id),
    ['x', 'p1', 'p2']
  );
  assert.equal(stored[1].data.text, 'Start [c1m0]');
  writer.client.destroy();
  late.client.destroy();
});

test('an editor showing stored content keeps unsaved room changes it has not rendered yet', async () => {
  // The entry was loaded with p1, p2; meanwhile the room holds an acknowledged
  // remote edit of p1 and a new block r that the editor has not rendered.
  const server = fakeServer([p('p1', 'Start remote'), p('r', 'remote block'), p('p2', 'End')], 'e1');
  const { client } = start(server, {
    getInitialView: () => ({ blocks: [p('p1', 'Start'), p('p2', 'End')] }),
    render: false,
  });
  await flush();
  client.pushLocal({ blocks: [p('p1', 'Start'), p('p2', 'End typed')] });
  await flush();
  assert.deepEqual(
    docToEditorData(server.doc).blocks.map((block) => [block.id, block.data.text]),
    [
      ['p1', 'Start remote'],
      ['r', 'remote block'],
      ['p2', 'End typed'],
    ]
  );
  client.destroy();
});

// 2.4 regression (authoring agent: a Markdown "## " heading typed right after
// the field was ready vanished): edits made before the first mx:sync were
// dropped, then the first render replaced them with the room state.
test('edits made before the first sync are applied on top of the room state, never dropped', async () => {
  const server = fakeServer([p('x', 'hello'), p('y', 'remote')], 'e1');
  let rendered = null;
  const holder = {};
  const { client, states } = start(server, {
    getInitialView: () => ({ blocks: [p('x', 'hello')] }),
    onRemoteData: () => {
      rendered = holder.client.snapshot().data;
    },
  });
  holder.client = client;
  // Typed before the session request even returned: "## " turned paragraph x into heading h.
  client.pushLocal({ blocks: [{ id: 'h', type: 'header', data: { text: 'Title', level: 2 } }] });
  assert.equal(states.at(-1).pending, true);
  await flush();
  const stored = docToEditorData(server.doc).blocks;
  assert.deepEqual(
    stored.map((block) => block.id),
    ['h', 'y']
  );
  assert.equal(stored[0].type, 'header');
  assert.deepEqual(
    rendered.blocks.map((block) => block.id),
    ['h', 'y']
  );
  assert.equal(states.at(-1).pending, false);
  client.destroy();
});

test('a read-only session drops edits made before the first sync', async () => {
  const server = fakeServer([p('x', 'hello')], 'e1');
  server.canEdit = false;
  const { client } = start(server, { getInitialView: () => ({ blocks: [p('x', 'hello')] }), render: false });
  client.pushLocal({ blocks: [p('x', 'hello typed')] });
  await flush();
  assert.equal(docToEditorData(server.doc).blocks[0].data.text, 'hello');
  assert.equal(client.getData().blocks[0].data.text, 'hello');
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

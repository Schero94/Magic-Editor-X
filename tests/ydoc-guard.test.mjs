import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { applyCheckedUpdate, inspectUpdate } from '../shared/ydoc-guard.mjs';
import { applyEditorDataToDoc, createSeedUpdate, docToEditorData, toShared } from '../shared/ydoc.mjs';

/**
 * Malicious and malformed Yjs updates must be refused before they are stored
 * or relayed, and must never crash the server or poison the room.
 */

const SEED = createSeedUpdate(
  { time: 1, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] },
  'e1'
);
const seed = () => SEED;
const roomDoc = () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seed());
  return doc;
};
/** Runs `fn` on a client copy of the room and returns the update it produced. */
const updateFrom = (fn) => {
  const client = new Y.Doc();
  Y.applyUpdate(client, seed());
  const before = Y.encodeStateVector(client);
  fn(client);
  return Y.encodeStateAsUpdate(client, before);
};

test('a normal structured edit is accepted', () => {
  const room = roomDoc();
  const update = updateFrom((doc) =>
    applyEditorDataToDoc(doc, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'hi there' } },
        { id: 't1', type: 'table', data: { content: [['a', 'b']] } },
      ],
    })
  );
  assert.deepEqual(applyCheckedUpdate(room, update), { ok: true, changed: true });
  assert.equal(docToEditorData(room).blocks.length, 2);
});

test('garbage bytes are refused', () => {
  assert.equal(inspectUpdate(new Uint8Array([9, 9, 9, 9, 9]), new Map()).ok, false);
});

test('unknown root types are refused', () => {
  const update = updateFrom((doc) => doc.getMap('evil').set('x', 1));
  assert.deepEqual(applyCheckedUpdate(roomDoc(), update), {
    ok: false,
    code: 'INVALID_UPDATE',
    dirty: false,
  });
});

test('XML types, formatting attributes and embeds are refused', () => {
  const xml = updateFrom((doc) =>
    doc.getMap('blocks').get('p1').get('data').set('x', new Y.XmlElement('img'))
  );
  assert.equal(applyCheckedUpdate(roomDoc(), xml).ok, false);
  const format = updateFrom((doc) =>
    doc.getMap('blocks').get('p1').get('data').get('text').format(0, 2, { bold: true })
  );
  assert.equal(applyCheckedUpdate(roomDoc(), format).ok, false);
  const embed = updateFrom((doc) =>
    doc.getMap('blocks').get('p1').get('data').get('text').insertEmbed(0, { a: 1 })
  );
  assert.equal(applyCheckedUpdate(roomDoc(), embed).ok, false);
  const subdoc = updateFrom((doc) => doc.getMap('blocks').get('p1').get('data').set('d', new Y.Doc()));
  assert.equal(applyCheckedUpdate(roomDoc(), subdoc).ok, false);
});

test('prototype keys are refused in maps and JSON values', () => {
  const key = updateFrom((doc) => doc.getMap('blocks').get('p1').get('data').set('__proto__', 'x'));
  assert.equal(applyCheckedUpdate(roomDoc(), key).ok, false);
  const value = updateFrom((doc) =>
    doc.getMap('blocks').get('p1').get('data').set('v', JSON.parse('{"__proto__":{"polluted":1}}'))
  );
  assert.equal(applyCheckedUpdate(roomDoc(), value).ok, false);
  assert.equal({}.polluted, undefined);
});

test('unknown meta keys and invalid block ids or types are refused', () => {
  assert.equal(
    applyCheckedUpdate(
      roomDoc(),
      updateFrom((doc) => doc.getMap('meta').set('admin', true))
    ).ok,
    false
  );
  assert.equal(
    applyCheckedUpdate(
      roomDoc(),
      updateFrom((doc) => doc.getMap('meta').set('time', 'x'))
    ).ok,
    false
  );
  const badId = updateFrom((doc) => doc.getMap('blocks').set('../x', new Y.Map([['type', 'paragraph']])));
  assert.equal(applyCheckedUpdate(roomDoc(), badId).ok, false);
  const badType = updateFrom((doc) => doc.getMap('blocks').get('p1').set('type', '<script>'));
  const room = roomDoc();
  const result = applyCheckedUpdate(room, badType);
  assert.equal(result.ok, false);
  assert.equal(result.dirty, true);
  const extraKey = updateFrom((doc) => doc.getMap('blocks').get('p1').set('owner', 1));
  assert.equal(applyCheckedUpdate(roomDoc(), extraKey).ok, false);
  const orderJunk = updateFrom((doc) => doc.getArray('order').push([42]));
  assert.equal(applyCheckedUpdate(roomDoc(), orderJunk).ok, false);
});

test('deeply nested shared types are refused, reading stays bounded', () => {
  const update = updateFrom((doc) => {
    let value = 'leaf';
    for (let i = 0; i < 60; i += 1) value = { n: value };
    doc.getMap('blocks').get('p1').get('data').set('deep', toShared(value));
    // toShared caps at the depth limit; build the rest by hand
    let map = doc.getMap('blocks').get('p1').get('data').get('deep');
    while (map instanceof Y.Map && map.get('n') instanceof Y.Map) map = map.get('n');
    let inner = map;
    for (let i = 0; i < 40; i += 1) {
      const next = new Y.Map();
      inner.set('n', next);
      inner = next;
    }
  });
  const room = roomDoc();
  const result = applyCheckedUpdate(room, update);
  assert.equal(result.ok, false);
  assert.ok(['TOO_DEEP', 'INVALID_BLOCK'].includes(result.code));
});

test('updates with missing dependencies are refused for a retry, not parked', () => {
  const client = new Y.Doc();
  Y.applyUpdate(client, seed());
  const v0 = Y.encodeStateVector(client);
  client.getMap('blocks').get('p1').get('data').get('text').insert(2, ' one');
  const v1 = Y.encodeStateVector(client);
  client.getMap('blocks').get('p1').get('data').get('text').insert(6, ' two');
  const second = Y.encodeStateAsUpdate(client, v1);
  const room = roomDoc();
  assert.deepEqual(applyCheckedUpdate(room, second), { ok: false, code: 'MISSING_DEPENDENCY', dirty: false });
  assert.equal(room.store.pendingStructs, null);
  const both = Y.encodeStateAsUpdate(client, v0);
  assert.equal(applyCheckedUpdate(room, both).ok, true);
  assert.equal(docToEditorData(room).blocks[0].data.text, 'hi one two');
});

test('a huge delete (select all, delete) is a valid edit', () => {
  const update = updateFrom((doc) => applyEditorDataToDoc(doc, { blocks: [] }));
  assert.equal(applyCheckedUpdate(roomDoc(), update).ok, true);
});

test('fuzzed byte flips never throw out of the guard', () => {
  const base = updateFrom((doc) =>
    applyEditorDataToDoc(doc, {
      blocks: [
        {
          id: 't1',
          type: 'table',
          data: {
            content: [
              ['a', 'b'],
              ['c', 'd'],
            ],
          },
        },
      ],
    })
  );
  let seedValue = 7;
  const rnd = () => {
    seedValue = (seedValue * 1103515245 + 12345) % 2147483648;
    return seedValue / 2147483648;
  };
  for (let i = 0; i < 3000; i += 1) {
    const bytes = Uint8Array.from(base);
    const flips = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < flips; k += 1) bytes[Math.floor(rnd() * bytes.length)] = Math.floor(rnd() * 256);
    const room = roomDoc();
    const result = applyCheckedUpdate(room, bytes);
    if (result.ok) assert.doesNotThrow(() => docToEditorData(room));
  }
});

test('an update without a visible change is still reported as changed (it must be stored)', () => {
  // A client types into a block that another person replaced meanwhile: the
  // text integrates into the deleted entry (no visible change), but the
  // client's clock advances. If the server did not store it, every later
  // update of that client would wait for it forever (RETRY) on other
  // processes and after a reload.
  const seed = createSeedUpdate(
    { time: 1, version: '2.31.7', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }] },
    'e1'
  );
  const server = new Y.Doc();
  Y.applyUpdate(server, seed);
  const client = new Y.Doc();
  Y.applyUpdate(client, seed);
  const entry = new Y.Map();
  server.getMap('blocks').set('p1', entry);
  entry.set('type', 'paragraph');
  const data = new Y.Map();
  entry.set('data', data);
  data.set('text', new Y.Text('New'));
  const vector = Y.encodeStateVector(client);
  client.getMap('blocks').get('p1').get('data').get('text').insert(5, ' world');
  const result = applyCheckedUpdate(server, Y.encodeStateAsUpdate(client, vector));
  assert.deepEqual(result, { ok: true, changed: true });
});

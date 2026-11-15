import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createReplica, restrictView } from '../shared/collab-replica.mjs';
import { createSeedUpdate, docToEditorData } from '../shared/ydoc.mjs';

/**
 * 2.5: live editing of an empty field. A room seeded from an empty value has
 * no blocks, while Editor.js shows one empty default paragraph. When that
 * paragraph was part of the diff base ("what the editor showed"), the first
 * local push created its block entry without adding the id to `order`, and so
 * did every later edit in it: the other editors never saw anything typed into
 * an empty field (found while reproducing the focus bug of the first live
 * catch-up, browser check pw/live.mjs).
 */

const paragraph = (id, text = '') => ({
  id,
  type: 'paragraph',
  data: { text },
  tunes: { alignmentTune: { alignment: 'left' } },
});

/** Server room: applies every update; `data()` is what a new client renders. */
const room = (seed) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seed);
  return { doc, apply: (update) => Y.applyUpdate(doc, update), data: () => docToEditorData(doc) };
};

const client = (server) => {
  const outbox = [];
  const replica = createReplica({ onLocalUpdate: (update) => outbox.push(update), captureTimeout: 0 });
  replica.applyRemote(Y.encodeStateAsUpdate(server.doc));
  const flush = () => outbox.splice(0).forEach((update) => server.apply(update));
  return { replica, flush };
};

test('text typed into an empty field reaches the room', () => {
  const server = room(createSeedUpdate({ blocks: [] }, 'epoch-1'));
  const b = client(server);
  // The editor rendered the (empty) room: Editor.js shows its default paragraph.
  const { catchUp } = b.replica.snapshot();
  b.replica.markShown(catchUp, { blocks: [paragraph('defaultP01')] });
  assert.deepEqual(b.replica.view().blocks, [], 'the default paragraph is not in the base');
  b.replica.pushLocal({ blocks: [paragraph('defaultP01', 'Remote words')] });
  b.flush();
  assert.deepEqual(
    server.data().blocks.map((block) => [block.id, block.data.text]),
    [['defaultP01', 'Remote words']]
  );
  // Another editor joining now sees the text.
  const a = client(server);
  assert.equal(a.replica.snapshot().data.blocks[0].data.text, 'Remote words');
});

test('the base keeps the editor form of blocks the room has', () => {
  const server = room(createSeedUpdate({ blocks: [paragraph('kept000001', 'A')] }, 'epoch-1'));
  const c = client(server);
  const { catchUp } = c.replica.snapshot();
  const shown = { blocks: [paragraph('kept000001', 'A'), paragraph('defaultP02')] };
  c.replica.markShown(catchUp, shown);
  assert.deepEqual(
    c.replica.view().blocks.map((block) => block.id),
    ['kept000001']
  );
  // Unchanged content is no update at all.
  assert.equal(c.replica.pushLocal({ blocks: [paragraph('kept000001', 'A')] }), false);
});

test('restrictView returns the same object when nothing is left out', () => {
  const view = { blocks: [paragraph('x000000001')] };
  assert.equal(restrictView(view, ['x000000001']), view);
  assert.deepEqual(restrictView(view, []).blocks, []);
  assert.deepEqual(restrictView(null, []).blocks, []);
});

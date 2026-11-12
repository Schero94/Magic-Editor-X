import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  applyEditorDataToDoc,
  docToEditorData,
  createSeedUpdate,
  legacyStateToEditorData,
  applyTextDiff,
} from '../shared/ydoc.mjs';

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });
const p = (id, text, extra = {}) => ({ id, type: 'paragraph', data: { text, ...extra } });

/** Two peers that exchange updates like the server relay does. */
const pair = (seed) => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const update = createSeedUpdate(seed);
  Y.applyUpdate(a, update);
  Y.applyUpdate(b, update);
  const sync = () => {
    const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(b, ua);
    Y.applyUpdate(a, ub);
  };
  return { a, b, sync };
};

test('round trip keeps every block, tune and data type', () => {
  const data = doc([
    p('a1', 'Hello <b>world</b>'),
    {
      id: 'h1',
      type: 'header',
      data: { text: 'Title', level: 2 },
      tunes: { alignmentTune: { alignment: 'center' } },
    },
    {
      id: 't1',
      type: 'table',
      data: {
        withHeadings: true,
        content: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
    },
    {
      id: 'l1',
      type: 'list',
      data: { style: 'ordered', meta: {}, items: [{ content: 'x', meta: {}, items: [] }] },
    },
  ]);
  const y = new Y.Doc();
  applyEditorDataToDoc(y, data);
  assert.deepEqual(docToEditorData(y).blocks, data.blocks);
});

test('concurrent typing in the same paragraph merges character by character', () => {
  const { a, b, sync } = pair(doc([p('a1', 'Hello world')]));
  applyEditorDataToDoc(a, doc([p('a1', 'Hello brave world')]));
  applyEditorDataToDoc(b, doc([p('a1', 'Hello world!')]));
  sync();
  assert.equal(docToEditorData(a).blocks[0].data.text, 'Hello brave world!');
  assert.deepEqual(docToEditorData(a), docToEditorData(b));
});

test('concurrent inserts of new blocks from two people are both kept', () => {
  const { a, b, sync } = pair(doc([p('a1', 'one'), p('a2', 'two')]));
  applyEditorDataToDoc(a, doc([p('a1', 'one'), p('x1', 'from A'), p('a2', 'two')]));
  applyEditorDataToDoc(b, doc([p('a1', 'one'), p('a2', 'two'), p('y1', 'from B')]));
  sync();
  const ids = docToEditorData(a).blocks.map((block) => block.id);
  assert.deepEqual(ids, ['a1', 'x1', 'a2', 'y1']);
  assert.deepEqual(docToEditorData(a), docToEditorData(b));
});

test('delete, move and edit in parallel converge without duplicates', () => {
  const { a, b, sync } = pair(doc([p('a1', '1'), p('a2', '2'), p('a3', '3')]));
  applyEditorDataToDoc(a, doc([p('a3', '3'), p('a1', '1'), p('a2', '2')]));
  applyEditorDataToDoc(b, doc([p('a1', '1 edited'), p('a3', '3')]));
  sync();
  const ra = docToEditorData(a);
  assert.deepEqual(ra, docToEditorData(b));
  const ids = ra.blocks.map((block) => block.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ra.blocks.find((block) => block.id === 'a1').data.text, '1 edited');
});

test('text diff only touches the changed range', () => {
  const y = new Y.Doc();
  const text = y.getText('t');
  text.insert(0, 'abcdef');
  applyTextDiff(text, 'abXYef');
  assert.equal(text.toString(), 'abXYef');
  assert.equal(applyTextDiff(text, 'abXYef'), false);
});

test('a 1.x collaboration state converts to Editor.js data', () => {
  const legacy = new Y.Doc();
  legacy.transact(() => {
    legacy.getMap('blocks').set('b1', JSON.stringify({ type: 'paragraph', tunes: {} }));
    legacy.getMap('blocks').set('b2', JSON.stringify({ type: 'table', data: { content: [['x']] } }));
    const t = new Y.Text();
    legacy.getMap('text').set('b1', t);
    t.insert(0, 'bold', { bold: true });
    t.insert(4, ' <tag>', { bold: null });
    legacy.getMap('meta').set('blockOrder', JSON.stringify(['b2', 'b1']));
  });
  const result = legacyStateToEditorData(Y.encodeStateAsUpdate(legacy));
  assert.deepEqual(
    result.blocks.map((block) => block.id),
    ['b2', 'b1']
  );
  assert.equal(result.blocks[1].data.text, '<b>bold</b> &lt;tag&gt;');
  assert.deepEqual(result.blocks[0].data, { content: [['x']] });
});

test('seeding the same content twice yields the same document', () => {
  const data = doc([p('a1', 'x')]);
  const y = new Y.Doc();
  Y.applyUpdate(y, createSeedUpdate(data));
  assert.deepEqual(docToEditorData(y).blocks, data.blocks);
});

test('a stale local snapshot does not undo remote edits', async () => {
  const { applyLocalChanges } = await import('../shared/ydoc.mjs');
  const base = doc([p('a1', 'Shared start')]);
  const { a, b, sync } = pair(base);
  // A types at the end; B, still showing the old text, adds a paragraph.
  applyLocalChanges(a, base, doc([p('a1', 'Shared start from A')]));
  sync();
  applyLocalChanges(b, base, doc([p('a1', 'Shared start'), p('b1', 'from B')]));
  sync();
  const result = docToEditorData(a);
  assert.deepEqual(
    result.blocks.map((block) => block.data.text),
    ['Shared start from A', 'from B']
  );
  assert.deepEqual(docToEditorData(b), result);
});

test('local typing is mapped through concurrent remote typing in the same text', async () => {
  const { applyLocalChanges } = await import('../shared/ydoc.mjs');
  const base = doc([p('a1', 'Hello world')]);
  const { a, b, sync } = pair(base);
  applyLocalChanges(a, base, doc([p('a1', 'Hello big world')]));
  sync();
  applyLocalChanges(b, base, doc([p('a1', 'Hello world!')]));
  sync();
  assert.equal(docToEditorData(a).blocks[0].data.text, 'Hello big world!');
  assert.deepEqual(docToEditorData(a), docToEditorData(b));
});

test('seeding a large document keeps the order, drops duplicate ids and stays linear', () => {
  const blocks = Array.from({ length: 4000 }, (_, i) => p(`s${i}`, `Text ${i}`));
  blocks.splice(10, 0, p('s3', 'duplicate id'));
  const started = performance.now();
  const target = new Y.Doc();
  Y.applyUpdate(target, createSeedUpdate(doc(blocks), 'epoch-1'));
  const elapsed = performance.now() - started;
  const read = docToEditorData(target);
  assert.equal(read.blocks.length, 4000);
  assert.deepEqual(
    read.blocks.slice(0, 5).map((block) => block.id),
    ['s0', 's1', 's2', 's3', 's4']
  );
  assert.equal(read.blocks[3].data.text, 'Text 3');
  assert.equal(read.blocks[3999].id, 's3999');
  // One bulk insert: the order array holds one item run, not one per block.
  assert.equal(target.getArray('order').length, 4000);
  assert.ok(elapsed < 5000, `seeding took ${elapsed} ms`);
});

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

/** Merges a local edit (base -> local) into a shared text that changed since base. */
const mergeText = async (shared, base, local) => {
  const { applyTextEdit } = await import('../shared/ydoc.mjs');
  const target = new Y.Doc();
  const text = target.getText('t');
  text.insert(0, shared);
  applyTextEdit(text, base, local);
  const out = text.toString();
  target.destroy();
  return out;
};

test('re-applied unsent inserts never split a concurrent insert at the same place', async () => {
  // Found by the compaction session test (seeds 40 and 185): a character
  // diff that matched base characters inside the other person's insert put
  // the re-applied text in the middle of it ("[c2m6" + "2][c4m6" + "1]").
  const merged = await mergeText(
    '[c1m63][c0m49][c2m61][c4m40]d[c1m26][c0m37][c1m44][c1m16][c2m4]',
    '[c4m40]d[c1m26][c0m37][c1m16][c2m4]',
    '[c4m62][c4m40]d[c1m26][c0m37][c1m16][c2m4]'
  );
  assert.ok(
    [
      '[c4m62][c1m63][c0m49][c2m61][c4m40]d[c1m26][c0m37][c1m44][c1m16][c2m4]',
      '[c1m63][c0m49][c2m61][c4m62][c4m40]d[c1m26][c0m37][c1m44][c1m16][c2m4]',
    ].includes(merged),
    merged
  );
  const cell = await mergeText(
    '[c0m12][c4m11][c0m39][c3m74][c2m7][c2m18][c1m30][c2m10][c1m9][c1m1][c1m53]c',
    '[c0m12][c4m11][c0m39][c2m7][c2m18][c1m30][c2m10][c1m9][c1m1]c',
    '[c0m12][c4m11][c0m39][c2m7][c2m18][c1m30][c2m10][c1m9][c1m1][c4m45]c'
  );
  assert.ok(
    [
      '[c0m12][c4m11][c0m39][c3m74][c2m7][c2m18][c1m30][c2m10][c1m9][c1m1][c4m45][c1m53]c',
      '[c0m12][c4m11][c0m39][c3m74][c2m7][c2m18][c1m30][c2m10][c1m9][c1m1][c1m53][c4m45]c',
    ].includes(cell),
    cell
  );
});

test('three-way text merge keeps every whole insert and delete of both sides (property)', async () => {
  // mulberry32: deterministic.
  let state = 7;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = (n) => Math.floor(random() * n);
  let serial = 0;
  // Markers share most characters ("[c", "m", digits) like words share letters.
  const marker = () => `[c${rnd(5)}m${(serial += 1)}]`;
  // Plain text pieces never join a neighbour into one word.
  const plain = [' ', ' a ', ' d ', ' m1 ', '.', ', '];
  const MARK = /\[c\dm\d+\]/g;
  // A side removes some base markers and/or inserts new ones between pieces.
  // It never inserts next to a marker it removed: that is a replacement,
  // which conflicts with a concurrent change of the same marker by nature.
  const side = (base, { remove, insert }) => {
    const keep = base.map((piece) => !(remove && piece.startsWith('[') && random() < 0.25));
    const pieces = [];
    const added = [];
    for (let i = 0; i <= base.length; i += 1) {
      const free = (i === 0 || keep[i - 1]) && (i === base.length || keep[i]);
      if (insert && free && random() < 0.3) {
        const piece = marker();
        added.push(piece);
        pieces.push(piece);
      }
      if (i < base.length && keep[i]) pieces.push(base[i]);
    }
    return { pieces, added, removed: base.filter((piece, i) => piece.startsWith('[') && !keep[i]) };
  };
  // The person who re-applies unsent edits only typed, or only deleted; the
  // shared text has inserts and deletes of everybody else.
  for (const local of [{ insert: true }, { remove: true }]) {
    for (let round = 0; round < 1500; round += 1) {
      const base = Array.from({ length: rnd(9) }, () =>
        random() < 0.75 ? marker() : plain[rnd(plain.length)]
      );
      const shared = side(base, { remove: true, insert: true });
      const mine = side(base, local);
      const out = await mergeText(shared.pieces.join(''), base.join(''), mine.pieces.join(''));
      const expected = [
        ...base.filter(
          (piece) => piece.startsWith('[') && !shared.removed.includes(piece) && !mine.removed.includes(piece)
        ),
        ...shared.added,
        ...mine.added,
      ].sort();
      const label = JSON.stringify({
        base: base.join(''),
        shared: shared.pieces.join(''),
        local: mine.pieces.join(''),
        out,
      });
      assert.deepEqual((out.match(MARK) || []).sort(), expected, label);
      assert.ok(!/[[\]]/.test(out.replace(MARK, '')), label);
    }
  }
});

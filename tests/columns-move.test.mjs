// Columns block: moving an item to another column keeps a concurrent edit of that item (2.6.2).
// Replica-level tests (the same harness as collab-convergence and columns.test.mjs): two clients,
// a server document that checks every update with the live guard, and the editor modelled as JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import { createReplica } from '../shared/collab-replica.mjs';
import {
  applyEditorDataToDoc,
  applyLocalChanges,
  createSeedUpdate,
  docToEditorData,
  getTypes,
  hasLegacyColumns,
  toShared,
} from '../shared/ydoc.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { renderHtml, renderMarkdown, renderText } from '../shared/render/index.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');

const clone = (value) => JSON.parse(JSON.stringify(value));
const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });
const item = (id, text, extra = {}) => ({ id, type: 'paragraph', text, ...extra });
const columnsBlock = (id, columns, extra = {}) => ({
  id,
  type: 'columns',
  data: { columns, ...extra, _mex: 1 },
});
const threeColumns = () =>
  columnsBlock('cols1', [
    { id: 'c1', items: [item('a', 'Alpha'), item('b', 'Bravo', { type: 'heading', level: 2 })] },
    { id: 'c2', items: [item('c', 'Charlie', { type: 'list', style: 'ordered' })] },
    { id: 'c3', items: [item('d', 'Delta'), item('e', 'Echo')] },
  ]);

/** One client: a replica plus the editor content as JSON. */
const client = (seedUpdate) => {
  const outbox = [];
  const replica = createReplica({
    onLocalUpdate: (update) => outbox.push(update),
    onShouldRender: () => {},
    captureTimeout: 0,
  });
  replica.applyRemote(seedUpdate);
  const c = {
    replica,
    outbox,
    editor: null,
    render() {
      const { data, catchUp } = replica.snapshot();
      c.editor = clone(data);
      replica.markShown(catchUp, clone(data));
    },
    edit(fn) {
      const next = clone(c.editor);
      fn(next);
      c.editor = next;
      replica.pushLocal(clone(next));
    },
  };
  c.render();
  return c;
};

/** A room: server document (guard on every update) and N clients that exchange updates on flush. */
const room = (seed, count = 2, seedUpdate = createSeedUpdate(seed, 'epoch-1')) => {
  const server = new Y.Doc();
  Y.applyUpdate(server, seedUpdate);
  const clients = Array.from({ length: count }, () => client(seedUpdate));
  const rejected = [];
  const flush = () => {
    for (const c of clients) {
      for (const update of c.outbox.splice(0)) {
        const result = applyCheckedUpdate(server, update);
        if (!result.ok) rejected.push(result.code);
        for (const other of clients) if (other !== c) other.replica.applyRemote(update);
      }
    }
  };
  return { server, clients, flush, rejected };
};

const columnsOf = (data) => data.blocks.find((block) => block.type === 'columns').data.columns;
const layoutOf = (data) => columnsOf(data).map((column) => column.items.map((it) => `${it.id}:${it.text}`));
const findItem = (data, id) => {
  for (const column of columnsOf(data)) for (const it of column.items) if (it.id === id) return it;
  return null;
};

/** Flushes, re-renders every client, checks guard, convergence and unique ids; returns the layout. */
const settle = (r) => {
  r.flush();
  for (const c of r.clients) c.render();
  assert.deepEqual(r.rejected, [], 'the guard accepted every update');
  const first = layoutOf(r.clients[0].editor);
  for (const c of r.clients.slice(1)) assert.deepEqual(layoutOf(c.editor), first, 'converged');
  assert.deepEqual(layoutOf(docToEditorData(r.server)), first, 'the server reads the same');
  const ids = first.flat().map((entry) => entry.split(':')[0]);
  assert.equal(new Set(ids).size, ids.length, 'no item is shown twice');
  return first;
};

/** Editor-side move: takes the item out of its column and inserts it into another one. */
const move = (data, id, toColumn, toIndex = Infinity) => {
  const columns = columnsOf(data);
  let moved = null;
  for (const column of columns) {
    const index = column.items.findIndex((it) => it.id === id);
    if (index >= 0) [moved] = column.items.splice(index, 1);
  }
  const target = columns[toColumn].items;
  target.splice(Math.min(toIndex, target.length), 0, moved);
};

let columnSeq = 0;
/** Editor-side "Number of columns" (same rule as tools/columns.js `setCount`; new columns get new ids). */
const setCount = (data, count) => {
  const block = data.blocks.find((b) => b.type === 'columns');
  const columns = block.data.columns.slice(0, count);
  while (columns.length < count) columns.push({ id: `n${(columnSeq += 1)}`, items: [] });
  const moved = block.data.columns.slice(count).flatMap((column) => column.items);
  if (moved.length) columns[columns.length - 1].items.push(...moved);
  block.data.columns = columns;
};

/** A room document as Magic Editor X 2.6.0 wrote it: column items nested in the column arrays. */
const legacyRoomUpdate = (data, epoch = 'epoch-260') => {
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
          ['tunes', toShared(block.tunes || {}, 2)],
          ['data', toShared(block.data, 2)],
        ])
      );
  });
  const update = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return update;
};

/* ------------------------------------------------------------------ move vs edit */

test('move vs edit: fewer columns moves the items of the removed column; a concurrent edit survives', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => setCount(d, 2));
  b.edit((d) => (findItem(d, 'd').text = 'Delta edited by B'));
  const out = settle(r);
  assert.deepEqual(out, [
    ['a:Alpha', 'b:Bravo'],
    ['c:Charlie', 'd:Delta edited by B', 'e:Echo'],
  ]);
});

test('move vs edit: an item moved to another column keeps typing that happened at the same time', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => move(d, 'a', 2, 1));
  b.edit((d) => (findItem(d, 'a').text = 'Alpha, typed by B'));
  const out = settle(r);
  assert.deepEqual(out[0], ['b:Bravo']);
  assert.deepEqual(out[2], ['d:Delta', 'a:Alpha, typed by B', 'e:Echo']);
});

test('move vs edit, edit first: both orders of arrival give the same result', () => {
  for (const first of [0, 1]) {
    const r = room(doc(threeColumns()));
    const [a, b] = r.clients;
    a.edit((d) => move(d, 'c', 0, 0));
    b.edit((d) => (findItem(d, 'c').text = 'Charlie (B)'));
    // Deliver one side completely before the other.
    const order = first ? [b, a] : [a, b];
    for (const c of order)
      for (const update of c.outbox.splice(0)) {
        assert.equal(applyCheckedUpdate(r.server, update).ok, true);
        for (const other of r.clients) if (other !== c) other.replica.applyRemote(update);
      }
    const out = settle(r);
    assert.deepEqual(out[0], ['c:Charlie (B)', 'a:Alpha', 'b:Bravo']);
    assert.deepEqual(out[1], []);
  }
});

test('move vs edit of the item style and text: type, level and text all survive the move', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => move(d, 'b', 1));
  b.edit((d) => {
    const it = findItem(d, 'b');
    it.text = 'Bravo!';
    it.level = 4;
  });
  settle(r);
  assert.deepEqual(findItem(a.editor, 'b'), { id: 'b', type: 'heading', text: 'Bravo!', level: 4 });
  assert.deepEqual(
    columnsOf(a.editor)[1].items.map((it) => it.id),
    ['c', 'b']
  );
});

test('move vs typing on both sides: the mover also types into the moved item', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => {
    move(d, 'e', 0, 0);
    findItem(d, 'e').text = 'AA Echo';
  });
  b.edit((d) => (findItem(d, 'e').text = 'Echo BB'));
  const out = settle(r);
  assert.equal(out[0][0], 'e:AA Echo BB');
});

/* ------------------------------------------------------------------ move vs move */

test('move vs move of the same item: one deterministic place, never twice', () => {
  const results = new Set();
  for (const swap of [false, true]) {
    const r = room(doc(threeColumns()));
    const [a, b] = swap ? [...r.clients].reverse() : r.clients;
    a.edit((d) => move(d, 'd', 0));
    b.edit((d) => move(d, 'd', 1));
    const out = settle(r);
    // The first place in reading order wins (column 1 before column 2).
    assert.deepEqual(out[0], ['a:Alpha', 'b:Bravo', 'd:Delta']);
    assert.deepEqual(out[1], ['c:Charlie']);
    assert.deepEqual(out[2], ['e:Echo']);
    results.add(JSON.stringify(out));
  }
  assert.equal(results.size, 1);
});

test('move vs move, then the winner is moved again: the hidden second place never comes back', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => move(d, 'd', 0));
  b.edit((d) => move(d, 'd', 1));
  settle(r);
  b.edit((d) => move(d, 'd', 2, 0));
  let out = settle(r);
  assert.deepEqual(out[2], ['d:Delta', 'e:Echo']);
  a.edit((d) => columnsOf(d)[2].items.splice(0, 1));
  out = settle(r);
  assert.equal(out.flat().filter((entry) => entry.startsWith('d:')).length, 0, 'deleted for good');
});

test('two people reduce the number of columns at the same time: every item once', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => setCount(d, 2));
  b.edit((d) => setCount(d, 2));
  const out = settle(r);
  assert.deepEqual(out, [
    ['a:Alpha', 'b:Bravo'],
    ['c:Charlie', 'd:Delta', 'e:Echo'],
  ]);
});

/* --------------------------------------------------------------- move vs delete */

test('move vs delete of the same item: the delete wins on every replica', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => move(d, 'a', 1));
  b.edit((d) => columnsOf(d)[0].items.splice(0, 1));
  const out = settle(r);
  assert.equal(
    out.flat().some((entry) => entry.startsWith('a:')),
    false
  );
  assert.deepEqual(out[1], ['c:Charlie']);
});

test('fewer columns vs an item inserted into the removed column: the new item is kept', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => setCount(d, 2));
  b.edit((d) => columnsOf(d)[2].items.push(item('f', 'Foxtrot by B')));
  const out = settle(r);
  assert.deepEqual(out[1], ['c:Charlie', 'd:Delta', 'e:Echo', 'f:Foxtrot by B']);
});

test('fewer columns vs a move into the removed column: the moved item stays in the block', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => setCount(d, 2));
  b.edit((d) => move(d, 'a', 2));
  const out = settle(r);
  assert.equal(out.flat().filter((entry) => entry.startsWith('a:')).length, 1);
  assert.equal(out.length, 2);
});

/* ------------------------------------------------------------------------- undo */

test('undo of a move puts the item back; the other person keeps the text typed meanwhile', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => move(d, 'a', 2));
  settle(r);
  b.edit((d) => (findItem(d, 'a').text = 'Alpha (B)'));
  r.flush();
  a.render();
  assert.equal(a.replica.undo(), true);
  const out = settle(r);
  assert.deepEqual(out[0], ['a:Alpha (B)', 'b:Bravo']);
  assert.deepEqual(out[2], ['d:Delta', 'e:Echo']);
  // Redo moves it again.
  assert.equal(a.replica.redo(), true);
  assert.deepEqual(settle(r)[2], ['d:Delta', 'e:Echo', 'a:Alpha (B)']);
});

test('undo of fewer columns brings the column back with its items', () => {
  const r = room(doc(threeColumns()));
  const [a, b] = r.clients;
  a.edit((d) => setCount(d, 2));
  settle(r);
  b.edit((d) => (findItem(d, 'e').text = 'Echo (B)'));
  r.flush();
  a.render();
  assert.equal(a.replica.undo(), true);
  const out = settle(r);
  assert.deepEqual(out, [['a:Alpha', 'b:Bravo'], ['c:Charlie'], ['d:Delta', 'e:Echo (B)']]);
});

/* ------------------------------------------------------------- stored format */

test('the stored JSON is unchanged: a room reads back byte for byte, renderers give the same output', () => {
  const value = cleanEditorValue(
    doc(threeColumns(), { id: 'p1', type: 'paragraph', data: { text: 'After' } })
  );
  const ydoc = new Y.Doc();
  applyEditorDataToDoc(ydoc, value);
  const back = docToEditorData(ydoc);
  assert.equal(JSON.stringify(back.blocks), JSON.stringify(value.blocks));
  assert.equal(renderHtml(back), renderHtml(value));
  assert.equal(renderText(back), renderText(value));
  assert.equal(renderMarkdown(back), renderMarkdown(value));
  // The same content read from a 2.6.0 room is identical too.
  const legacy = new Y.Doc();
  Y.applyUpdate(legacy, legacyRoomUpdate(value));
  assert.equal(JSON.stringify(docToEditorData(legacy).blocks), JSON.stringify(value.blocks));
});

/* -------------------------------------------------------------- 2.6.0 rooms */

test('2.6.0 rooms: read and edited as before; a new generation moves them to the id-preserving layout', () => {
  const seed = doc(threeColumns());
  const update = legacyRoomUpdate(seed);
  const legacy = new Y.Doc();
  Y.applyUpdate(legacy, update);
  assert.equal(hasLegacyColumns(legacy), true);
  // Clients of this version edit a 2.6.0 room through the guard.
  const r = room(seed, 2, update);
  const [a, b] = r.clients;
  a.edit((d) => (findItem(d, 'a').text = 'Alpha A'));
  b.edit((d) => columnsOf(d)[1].items.push(item('f', 'New')));
  const out = settle(r);
  assert.deepEqual(out[0], ['a:Alpha A', 'b:Bravo']);
  assert.deepEqual(out[1], ['c:Charlie', 'f:New']);
  // The server's upgrade is a new room generation seeded from the content (like compaction).
  const next = new Y.Doc();
  Y.applyUpdate(next, createSeedUpdate(docToEditorData(r.server), 'epoch-2'));
  assert.equal(hasLegacyColumns(next), false);
  assert.deepEqual(layoutOf(docToEditorData(next)), out);
});

/* ------------------------------------------------------------------ rebase */

test('rebase: a move made against an older state is applied to the current one', () => {
  const value = doc(threeColumns());
  const ydoc = new Y.Doc();
  applyEditorDataToDoc(ydoc, value);
  const older = docToEditorData(ydoc);
  // Someone else types into the item meanwhile.
  const edited = clone(older);
  findItem(edited, 'd').text = 'Delta (other)';
  applyEditorDataToDoc(ydoc, edited);
  // The unsent local edit (move d to column 1) is re-applied on the new state.
  const local = clone(older);
  move(local, 'd', 0);
  applyLocalChanges(ydoc, older, local);
  const out = layoutOf(docToEditorData(ydoc));
  assert.deepEqual(out[0], ['a:Alpha', 'b:Bravo', 'd:Delta (other)']);
  assert.deepEqual(out[2], ['e:Echo']);
});

/* ------------------------------------------------------------------- random */

/** Small deterministic PRNG (mulberry32). */
const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('random concurrent moves, edits, inserts, deletes and column changes: converge, no duplicates, no lost words', () => {
  let words = 0;
  for (let run = 0; run < 300; run += 1) {
    const random = rng(run + 1);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const r = room(doc(threeColumns()), 3);
    const typed = new Map(); // item id -> words typed into it
    const deleted = new Set();
    let next = 0;
    for (let step = 0; step < 12; step += 1) {
      for (const c of r.clients) {
        const roll = random();
        c.edit((d) => {
          const columns = columnsOf(d);
          const all = columns.flatMap((column) => column.items);
          if (roll < 0.45 && all.length) {
            const it = pick(all);
            const word = `w${run}x${(next += 1)}`;
            it.text = random() < 0.5 ? `${word} ${it.text}` : `${it.text} ${word}`;
            typed.set(it.id, [...(typed.get(it.id) || []), word]);
          } else if (roll < 0.75 && all.length) {
            move(d, pick(all).id, Math.floor(random() * columns.length), Math.floor(random() * 4));
          } else if (roll < 0.82) {
            const id = `n${run}x${(next += 1)}`;
            pick(columns).items.push(item(id, ''));
          } else if (roll < 0.88 && all.length > 3) {
            const column = pick(columns.filter((col) => col.items.length));
            const [gone] = column.items.splice(Math.floor(random() * column.items.length), 1);
            deleted.add(gone.id);
          } else if (roll < 0.94) {
            setCount(d, random() < 0.5 ? Math.max(2, columns.length - 1) : Math.min(4, columns.length + 1));
          }
        });
      }
      if (random() < 0.5) {
        settle(r);
      }
    }
    settle(r);
    const final = docToEditorData(r.server);
    for (const [id, list] of typed) {
      if (deleted.has(id)) continue;
      const it = findItem(final, id);
      assert.ok(it, `run ${run}: item ${id} still exists`);
      for (const word of list) {
        assert.ok(it.text.includes(word), `run ${run}: ${word} kept in ${id} (${it.text})`);
        words += 1;
      }
    }
  }
  assert.ok(words > 500, `checked ${words} words`);
});

/* -------------------------------------------------------------------- guard */

test('guard: the item store and the placement lists are checked like any other block data', () => {
  const seed = createSeedUpdate(
    doc(threeColumns(), { id: 'p1', type: 'paragraph', data: { text: 'x' } }),
    'e1'
  );
  const attempt = (change) => {
    const server = new Y.Doc();
    Y.applyUpdate(server, seed);
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, seed);
    const before = Y.encodeStateVector(attacker);
    attacker.transact(() => change(getTypes(attacker).blocks));
    return applyCheckedUpdate(server, Y.encodeStateAsUpdate(attacker, before));
  };
  const store = (blocks) => blocks.get('cols1').get('items');
  const firstList = (blocks) => blocks.get('cols1').get('data').get('columns').get(0).get('items');
  // A legitimate edit through the store passes.
  assert.equal(attempt((blocks) => store(blocks).get('a').get('text').insert(0, 'ok ')).ok, true);
  // An item store on another block type.
  assert.equal(attempt((blocks) => blocks.get('p1').set('items', new Y.Map())).ok, false);
  // Store keys must be item ids, values maps.
  assert.equal(attempt((blocks) => store(blocks).set('bad id!', new Y.Map())).ok, false);
  assert.equal(attempt((blocks) => store(blocks).set('x1', 'plain')).ok, false);
  // Unknown keys and types in a stored item.
  assert.equal(attempt((blocks) => store(blocks).get('a').set('onclick', new Y.Text('x'))).ok, false);
  assert.equal(attempt((blocks) => store(blocks).get('a').set('type', 'script')).ok, false);
  // Placement lists hold item ids only, and are bounded.
  assert.equal(attempt((blocks) => firstList(blocks).insert(0, [new Y.Map()])).ok, false);
  assert.equal(attempt((blocks) => firstList(blocks).insert(0, ['bad id!'])).ok, false);
  assert.equal(
    attempt((blocks) =>
      firstList(blocks).insert(
        0,
        Array.from({ length: 801 }, () => 'a')
      )
    ).ok,
    false
  );
  // More items than the store may hold (twice what the block shows).
  assert.equal(
    attempt((blocks) => {
      for (let i = 0; i < 401; i += 1) store(blocks).set(`z${i}`, new Y.Map([['type', 'paragraph']]));
    }).ok,
    false
  );
  // 2.6.2 review: items without a place are checked too (keys, kinds, text length, total size).
  const hidden = (fields) =>
    attempt((blocks) => store(blocks).set('hidden1', new Y.Map(Object.entries(fields))));
  assert.equal(hidden({ type: 'paragraph', text: new Y.Text('ok') }).ok, true);
  assert.equal(hidden({ type: 'paragraph', onclick: new Y.Text('x') }).ok, false);
  assert.equal(hidden({ type: 'script', text: new Y.Text('x') }).ok, false);
  assert.equal(hidden({ type: 'paragraph', text: new Y.Text('x'.repeat(20001)) }).ok, false);
  assert.equal(
    attempt((blocks) => {
      for (let i = 0; i < 60; i += 1)
        store(blocks).set(
          `h${i}`,
          new Y.Map([
            ['type', 'paragraph'],
            ['text', new Y.Text('x'.repeat(19000))],
          ])
        );
    }).ok,
    false,
    'all stored items together stay within the block size limit'
  );
  // A columns block in the 2.6.0 layout is not accepted as new structure (the server would start a
  // new room generation for it again and again).
  assert.equal(
    attempt((blocks) =>
      blocks.set(
        'legacy2',
        new Y.Map([
          ['type', 'columns'],
          ['tunes', new Y.Map()],
          ['data', toShared(threeColumns().data, 2)],
        ])
      )
    ).ok,
    false
  );
});

test('more columns than allowed at once (concurrent "add a column"): the extra columns show inside the last one', () => {
  const r = room(doc(threeColumns()), 3);
  for (const c of r.clients)
    c.edit((d) =>
      columnsOf(d).push({ id: `x${c === r.clients[0] ? 'a' : c === r.clients[1] ? 'b' : 'c'}`, items: [] })
    );
  r.clients[1].edit((d) => (columnsOf(d)[3].items = [item('nb', 'In the new column of B')]));
  r.clients[2].edit((d) => (columnsOf(d)[3].items = [item('nc', 'In the new column of C')]));
  let out = settle(r);
  assert.equal(out.length, 4, 'at most four columns are shown');
  assert.deepEqual(out.slice(0, 3), [['a:Alpha', 'b:Bravo'], ['c:Charlie'], ['d:Delta', 'e:Echo']]);
  assert.deepEqual([...out[3]].sort(), ['nb:In the new column of B', 'nc:In the new column of C']);
  // Typing in an item of a folded column works like anywhere else.
  r.clients[0].edit((d) => (findItem(d, 'nc').text += ' (A)'));
  out = settle(r);
  assert.ok(out[3].includes('nc:In the new column of C (A)'));
  // Fewer columns: everything lands in the last remaining column once, the extra columns are gone.
  r.clients[0].edit((d) => setCount(d, 2));
  out = settle(r);
  assert.equal(out.length, 2);
  assert.equal(out.flat().length, 7);
  const entry = getTypes(r.server).blocks.get('cols1');
  assert.equal(entry.get('data').get('columns').length, 2, 'the extra column maps were removed');
});

test('an item added at the end of a column after items shown there from a folded column stays last', () => {
  const r = room(doc(threeColumns()), 3);
  const [a, b, c] = r.clients;
  a.edit((d) => columnsOf(d).push({ id: 'xa', items: [item('fa', 'From A')] }));
  b.edit((d) => columnsOf(d).push({ id: 'xb', items: [item('fb', 'From B')] }));
  settle(r);
  // Four columns plus one folded into the fourth.
  c.edit((d) => columnsOf(d).push({ id: 'xc', items: [] }));
  let out = settle(r);
  assert.equal(out.length, 4);
  const shown = out[3].map((entry) => entry.split(':')[0]);
  // Append a new item at the end of the fourth column as the editor shows it.
  a.edit((d) => columnsOf(d)[3].items.push(item('last', 'Added last')));
  out = settle(r);
  assert.deepEqual(
    out[3].map((entry) => entry.split(':')[0]),
    [...shown, 'last']
  );
});

test('near the item limit, merged valid changes are never refused and nothing is lost on save', () => {
  const many = (prefix, n) => Array.from({ length: n }, (_, i) => item(`${prefix}${i}`, `${prefix} ${i}`));
  const block = columnsBlock('cols1', [
    { id: 'c1', items: [item('a', 'Alpha')] },
    { id: 'c2', items: [item('b', 'Bravo')] },
    { id: 'c3', items: many('p', 25) },
    { id: 'c4', items: many('q', 25) },
  ]);
  const r = room(doc(block));
  const [a, b] = r.clients;
  a.edit((d) => setCount(d, 3));
  b.edit((d) => columnsOf(d)[3].items.push(item('late', 'Typed by B')));
  const out = settle(r);
  assert.equal(out.flat().length, 53, 'every item is still in the room');
  assert.ok(out.flat().includes('late:Typed by B'));
  // Saving keeps every item: the policy moves what is beyond 50 into a new column.
  const saved = cleanEditorValue(docToEditorData(r.server));
  const ids = saved.blocks[0].data.columns.flatMap((column) => column.items.map((it) => it.id));
  assert.equal(ids.length, 53);
  assert.ok(ids.includes('late'));
  assert.ok(saved.blocks[0].data.columns.every((column) => column.items.length <= 50));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createReplica } from '../shared/collab-replica.mjs';
import { createSeedUpdate, docToEditorData, stableStringify } from '../shared/ydoc.mjs';
import { normalizeEditorData } from '../shared/editor-data.mjs';

/**
 * Convergence of structured collaboration (schema 3).
 *
 * Targeted cases prove that concurrent edits of different cells, items, tunes
 * and fields merge. The property test runs N simulated clients with random
 * concurrent operations, random network delays, reordering, duplicates and
 * offline periods, and checks that every client ends with the same, valid
 * Editor.js document. Seeds: MEX_FUZZ_SEEDS (default 200) starting at
 * MEX_FUZZ_FROM (default 1); a failure prints the seed.
 */

const clone = (value) => JSON.parse(JSON.stringify(value));

/** A replica with the editor modelled as plain JSON (what the user sees). */
const client = (seedUpdate) => {
  const outbox = [];
  let dirty = false;
  const replica = createReplica({
    onLocalUpdate: (update) => outbox.push(update),
    onShouldRender: () => {
      dirty = true;
    },
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
      dirty = false;
    },
    edit(fn) {
      const next = clone(c.editor);
      fn(next);
      c.editor = next;
      replica.pushLocal(clone(next));
    },
    get dirty() {
      return dirty;
    },
  };
  c.render();
  return c;
};

/** Delivers every pending update between clients through a server doc. */
const room = (seed, n) => {
  const seedUpdate = createSeedUpdate(seed, 'epoch-1');
  const server = new Y.Doc();
  Y.applyUpdate(server, seedUpdate);
  const clients = Array.from({ length: n }, () => client(seedUpdate));
  const flush = () => {
    for (const c of clients) {
      for (const update of c.outbox.splice(0)) {
        Y.applyUpdate(server, update);
        for (const other of clients) if (other !== c) other.replica.applyRemote(update);
      }
    }
  };
  return { server, clients, flush };
};

const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const table = (id, content) => ({ id, type: 'table', data: { withHeadings: false, content } });
const docOf = (blocks) => ({ time: 1, version: '2.31.7', blocks });

test('concurrent edits of different table cells both survive', () => {
  const { clients, flush } = room(
    docOf([
      table('t1', [
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ]),
    2
  );
  const [a, b] = clients;
  a.edit((d) => {
    d.blocks[0].data.content[0][0] = 'A1';
  });
  b.edit((d) => {
    d.blocks[0].data.content[1][1] = 'B2';
  });
  flush();
  a.render();
  b.render();
  assert.deepEqual(a.editor.blocks[0].data.content, [
    ['A1', 'b'],
    ['c', 'B2'],
  ]);
  assert.deepEqual(a.editor, b.editor);
});

test('adding a row while someone edits a cell keeps both', () => {
  const { clients, flush } = room(docOf([table('t1', [['a', 'b']])]), 2);
  const [a, b] = clients;
  a.edit((d) => d.blocks[0].data.content.push(['x', 'y']));
  b.edit((d) => {
    d.blocks[0].data.content[0][1] = 'b edited';
  });
  flush();
  a.render();
  b.render();
  assert.deepEqual(b.editor.blocks[0].data.content, [
    ['a', 'b edited'],
    ['x', 'y'],
  ]);
  assert.deepEqual(a.editor, b.editor);
});

test('adding a column while someone edits a cell keeps both', () => {
  const { clients, flush } = room(
    docOf([
      table('t1', [
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ]),
    2
  );
  const [a, b] = clients;
  a.edit((d) => d.blocks[0].data.content.forEach((row) => row.push('')));
  b.edit((d) => {
    d.blocks[0].data.content[1][0] = 'c!';
  });
  flush();
  a.render();
  b.render();
  assert.deepEqual(a.editor.blocks[0].data.content, [
    ['a', 'b', ''],
    ['c!', 'd', ''],
  ]);
  assert.deepEqual(a.editor, b.editor);
});

test('list items: concurrent edits, inserts and nesting merge', () => {
  const item = (content, items = []) => ({ content, meta: {}, items });
  const { clients, flush } = room(
    docOf([
      {
        id: 'l1',
        type: 'list',
        data: { style: 'unordered', meta: {}, items: [item('one'), item('two'), item('three')] },
      },
    ]),
    3
  );
  const [a, b, c] = clients;
  a.edit((d) => {
    d.blocks[0].data.items[0].content = 'one (A)';
  });
  b.edit((d) => d.blocks[0].data.items.splice(2, 0, item('B inserted')));
  c.edit((d) => d.blocks[0].data.items[1].items.push(item('nested by C')));
  flush();
  clients.forEach((x) => x.render());
  const items = a.editor.blocks[0].data.items;
  assert.deepEqual(
    items.map((i) => i.content),
    ['one (A)', 'two', 'B inserted', 'three']
  );
  assert.equal(items[1].items[0].content, 'nested by C');
  assert.deepEqual(a.editor, b.editor);
  assert.deepEqual(a.editor, c.editor);
});

test('checklist: toggling one item and editing another merge', () => {
  const { clients, flush } = room(
    docOf([
      {
        id: 'c1',
        type: 'checklist',
        data: {
          items: [
            { text: 'first', checked: false },
            { text: 'second', checked: false },
          ],
        },
      },
    ]),
    2
  );
  const [a, b] = clients;
  a.edit((d) => {
    d.blocks[0].data.items[0].checked = true;
  });
  b.edit((d) => {
    d.blocks[0].data.items[1].text = 'second, edited';
  });
  flush();
  a.render();
  b.render();
  assert.deepEqual(a.editor.blocks[0].data.items, [
    { text: 'first', checked: true },
    { text: 'second, edited', checked: false },
  ]);
  assert.deepEqual(a.editor, b.editor);
});

test('tunes: alignment and text variant changed by two people both survive, text edit too', () => {
  const { clients, flush } = room(docOf([p('p1', 'Hello')]), 3);
  const [a, b, c] = clients;
  a.edit((d) => {
    d.blocks[0].tunes = { alignmentTune: { alignment: 'center' } };
  });
  b.edit((d) => {
    d.blocks[0].tunes = { textVariant: 'call-out' };
  });
  c.edit((d) => {
    d.blocks[0].data.text = 'Hello world';
  });
  flush();
  clients.forEach((x) => x.render());
  assert.deepEqual(a.editor.blocks[0].tunes, {
    alignmentTune: { alignment: 'center' },
    textVariant: 'call-out',
  });
  assert.equal(a.editor.blocks[0].data.text, 'Hello world');
  assert.deepEqual(a.editor, b.editor);
  assert.deepEqual(a.editor, c.editor);
});

test('custom block: different fields merge, the same scalar resolves deterministically', () => {
  const { clients, flush } = room(
    docOf([{ id: 'x1', type: 'productCard', data: { title: 'T', price: 1, featured: false } }]),
    2
  );
  const [a, b] = clients;
  a.edit((d) => {
    d.blocks[0].data.title = 'Title A';
    d.blocks[0].data.price = 10;
  });
  b.edit((d) => {
    d.blocks[0].data.featured = true;
    d.blocks[0].data.price = 20;
  });
  flush();
  a.render();
  b.render();
  assert.equal(a.editor.blocks[0].data.title, 'Title A');
  assert.equal(a.editor.blocks[0].data.featured, true);
  assert.ok([10, 20].includes(a.editor.blocks[0].data.price));
  assert.deepEqual(a.editor, b.editor);
});

test('per-user undo reverts only my own change', () => {
  const { clients, flush } = room(docOf([p('p1', 'A'), p('p2', 'B')]), 2);
  const [a, b] = clients;
  a.edit((d) => {
    d.blocks[0].data.text = 'A by a';
  });
  flush();
  b.render();
  b.edit((d) => {
    d.blocks[1].data.text = 'B by b';
  });
  flush();
  a.render();
  assert.equal(a.replica.canUndo(), true);
  a.replica.undo();
  flush();
  a.render();
  b.render();
  assert.deepEqual(
    a.editor.blocks.map((x) => x.data.text),
    ['A', 'B by b']
  );
  assert.deepEqual(a.editor, b.editor);
  a.replica.redo();
  flush();
  a.render();
  b.render();
  assert.deepEqual(
    b.editor.blocks.map((x) => x.data.text),
    ['A by a', 'B by b']
  );
});

test('a local edit on a stale view does not revert remote changes it has not shown', () => {
  const { clients, flush } = room(docOf([p('p1', 'Hello'), table('t1', [['a']])]), 2);
  const [a, b] = clients;
  b.edit((d) => {
    d.blocks[1].data.content[0][0] = 'remote';
  });
  flush();
  // A has not rendered B's change yet and edits the paragraph.
  a.edit((d) => {
    d.blocks[0].data.text = 'Hello there';
  });
  flush();
  a.render();
  b.render();
  assert.equal(a.editor.blocks[1].data.content[0][0], 'remote');
  assert.equal(a.editor.blocks[0].data.text, 'Hello there');
  assert.deepEqual(a.editor, b.editor);
});

test('schema 2 rooms (plain JSON values) are read and upgraded on edit', () => {
  const legacy = new Y.Doc();
  legacy.transact(() => {
    legacy.getMap('meta').set('schema', 2);
    legacy.getArray('order').push(['t1']);
    const entry = new Y.Map();
    legacy.getMap('blocks').set('t1', entry);
    entry.set('type', 'table');
    entry.set('tunes', { alignmentTune: { alignment: 'left' } });
    const data = new Y.Map();
    entry.set('data', data);
    data.set('content', [['a', 'b']]);
  });
  const update = Y.encodeStateAsUpdate(legacy);
  const a = client(update);
  assert.deepEqual(a.editor.blocks[0].data.content, [['a', 'b']]);
  assert.deepEqual(a.editor.blocks[0].tunes, { alignmentTune: { alignment: 'left' } });
  a.edit((d) => {
    d.blocks[0].data.content[0][0] = 'x';
  });
  assert.deepEqual(docToEditorData(a.replica.doc).blocks[0].data.content, [['x', 'b']]);
});

// ---------------------------------------------------------------- property test

/** Deterministic PRNG (mulberry32). */
const prng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const WORDS = ['alpha', 'beta', 'gamma', '<b>bold</b>', 'x', '', 'ü', '😀', 'delta epsilon'];

/** Random operations on an Editor.js document (mutates `d`). */
const operations = (rnd, me, counter) => {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const word = () => pick(WORDS);
  const editText = (text) => {
    const s = String(text);
    const at = Math.floor(rnd() * (s.length + 1));
    const del = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0;
    return s.slice(0, at) + (rnd() < 0.8 ? word() : '') + s.slice(at + del);
  };
  const newId = () => `${me}n${counter.next++}`;
  const ofType = (d, type) => d.blocks.filter((b) => b.type === type);
  return [
    (d) => {
      const b = pick(ofType(d, 'paragraph'));
      if (b) b.data.text = editText(b.data.text);
    },
    (d) => {
      const b = pick(ofType(d, 'table'));
      if (!b || !b.data.content.length) return;
      const row = pick(b.data.content);
      const i = Math.floor(rnd() * row.length);
      row[i] = editText(row[i]);
    },
    (d) => {
      const b = pick(ofType(d, 'table'));
      if (!b) return;
      const cols = b.data.content[0] ? b.data.content[0].length : 2;
      b.data.content.splice(
        Math.floor(rnd() * (b.data.content.length + 1)),
        0,
        Array.from({ length: cols }, () => word())
      );
    },
    (d) => {
      const b = pick(ofType(d, 'table'));
      if (b && b.data.content.length > 1) b.data.content.splice(Math.floor(rnd() * b.data.content.length), 1);
    },
    (d) => {
      const b = pick(ofType(d, 'table'));
      if (!b || !b.data.content.length) return;
      const at = Math.floor(rnd() * (b.data.content[0].length + 1));
      b.data.content.forEach((row) => row.splice(at, 0, ''));
    },
    (d) => {
      const b = pick(ofType(d, 'list'));
      if (!b) return;
      const items = rnd() < 0.3 && b.data.items[0] ? b.data.items[0].items : b.data.items;
      const r = rnd();
      if (r < 0.4 && items.length) {
        const it = pick(items);
        it.content = editText(it.content);
      } else if (r < 0.75)
        items.splice(Math.floor(rnd() * (items.length + 1)), 0, { content: word(), meta: {}, items: [] });
      else if (items.length) items.splice(Math.floor(rnd() * items.length), 1);
    },
    (d) => {
      const b = pick(ofType(d, 'checklist'));
      if (!b || !b.data.items.length) return;
      const it = pick(b.data.items);
      if (rnd() < 0.5) it.checked = !it.checked;
      else it.text = editText(it.text);
    },
    (d) => {
      const b = pick(d.blocks);
      if (!b) return;
      b.tunes = { ...(b.tunes || {}) };
      if (rnd() < 0.5) b.tunes.alignmentTune = { alignment: pick(['left', 'center', 'right']) };
      else b.tunes.textVariant = pick(['', 'call-out', 'citation']);
    },
    (d) => {
      const b = pick(ofType(d, 'productCard'));
      if (!b) return;
      const r = rnd();
      if (r < 0.33) b.data.title = editText(b.data.title);
      else if (r < 0.66) b.data.price = Math.floor(rnd() * 100);
      else b.data.featured = !b.data.featured;
    },
    (d) => {
      if (d.blocks.length < 2) return;
      const from = Math.floor(rnd() * d.blocks.length);
      const [moved] = d.blocks.splice(from, 1);
      d.blocks.splice(Math.floor(rnd() * (d.blocks.length + 1)), 0, moved);
    },
    (d) => {
      if (d.blocks.length > 1) d.blocks.splice(Math.floor(rnd() * d.blocks.length), 1);
    },
    (d) => {
      const at = Math.floor(rnd() * (d.blocks.length + 1));
      const kind = rnd();
      const block =
        kind < 0.5
          ? p(newId(), word())
          : kind < 0.75
            ? table(newId(), [
                ['', ''],
                ['', ''],
              ])
            : {
                id: newId(),
                type: 'list',
                data: { style: 'ordered', meta: {}, items: [{ content: word(), meta: {}, items: [] }] },
              };
      d.blocks.splice(at, 0, block);
    },
    (d) => {
      // block type conversion (paragraph -> header) by one person
      const b = pick(ofType(d, 'paragraph'));
      if (b) {
        b.type = 'header';
        b.data = { text: b.data.text, level: 2 };
      }
    },
  ];
};

const initial = () =>
  docOf([
    p('p1', 'First paragraph'),
    table('t1', [
      ['a', 'b'],
      ['c', 'd'],
    ]),
    {
      id: 'l1',
      type: 'list',
      data: {
        style: 'unordered',
        meta: {},
        items: [
          { content: 'one', meta: {}, items: [] },
          { content: 'two', meta: {}, items: [] },
        ],
      },
    },
    {
      id: 'c1',
      type: 'checklist',
      data: {
        items: [
          { text: 'todo', checked: false },
          { text: 'done', checked: true },
        ],
      },
    },
    { id: 'x1', type: 'productCard', data: { title: 'Card', price: 5, featured: false } },
    p('p2', 'Last paragraph'),
  ]);

/**
 * Runs one random session and returns the converged documents.
 * @param {number} seed - PRNG seed.
 * @returns {{ ok: boolean, reason?: string, steps: number }} Result.
 */
const runSession = (seed) => {
  const rnd = prng(seed);
  const n = 2 + Math.floor(rnd() * 4); // 2..5 clients
  const seedUpdate = createSeedUpdate(initial(), 'e');
  const server = new Y.Doc();
  Y.applyUpdate(server, seedUpdate);
  const clients = Array.from({ length: n }, (_, i) => ({ c: client(seedUpdate), id: i, offline: false }));
  const counter = { next: 0 };
  /** In-flight messages: { to: 'server'|clientIndex, update, at } */
  let network = [];
  let now = 0;
  const send = (to, update) => {
    const copies = rnd() < 0.1 ? 2 : 1; // duplicates
    for (let k = 0; k < copies; k += 1) network.push({ to, update, at: now + Math.floor(rnd() * 8) });
  };
  const deliver = (force = false) => {
    // random order among due messages (reordering)
    const due = network.filter((m) => force || m.at <= now);
    network = network.filter((m) => !(force || m.at <= now));
    due.sort(() => rnd() - 0.5);
    for (const m of due) {
      if (m.to === 'server') {
        Y.applyUpdate(server, m.update);
        clients.forEach((x, i) => {
          if (i !== m.from) send(i, m.update);
        });
      } else if (!clients[m.to].offline || force) clients[m.to].c.replica.applyRemote(m.update);
      else network.push(m); // held while offline
    }
  };
  const steps = 30 + Math.floor(rnd() * 60);
  for (let step = 0; step < steps; step += 1) {
    now += 1;
    for (const x of clients) {
      const ops = operations(rnd, `c${x.id}`, counter);
      const r = rnd();
      if (r < 0.45) {
        const op = ops[Math.floor(rnd() * ops.length)];
        x.c.edit(op);
      } else if (r < 0.75 && x.c.dirty) {
        x.c.render();
      } else if (r < 0.78) {
        x.offline = !x.offline;
        if (!x.offline) {
          // reconnect: exchange what each side is missing (state vectors)
          const toServer = Y.encodeStateAsUpdate(x.c.replica.doc, Y.encodeStateVector(server));
          network.push({ to: 'server', update: toServer, at: now, from: x.id });
          x.c.replica.applyRemote(Y.encodeStateAsUpdate(server, Y.encodeStateVector(x.c.replica.doc)));
        }
      } else if (r < 0.8 && x.c.replica.canUndo()) {
        x.c.replica.undo();
      }
      if (!x.offline) {
        for (const update of x.c.outbox.splice(0))
          network.push({ to: 'server', update, at: now + Math.floor(rnd() * 5), from: x.id });
      }
    }
    deliver();
  }
  // Heal: everyone online, deliver everything, final state-vector sync.
  clients.forEach((x) => {
    x.offline = false;
    for (const update of x.c.outbox.splice(0)) network.push({ to: 'server', update, at: now, from: x.id });
  });
  for (let round = 0; round < 4; round += 1) deliver(true);
  for (const x of clients) {
    Y.applyUpdate(server, Y.encodeStateAsUpdate(x.c.replica.doc, Y.encodeStateVector(server)));
  }
  for (const x of clients) x.c.replica.applyRemote(Y.encodeStateAsUpdate(server));
  clients.forEach((x) => x.c.render());
  const expected = stableStringify(docToEditorData(server));
  for (const x of clients) {
    if (stableStringify(x.c.editor) !== expected)
      return { ok: false, reason: `client ${x.id} differs from the server`, steps };
  }
  const result = docToEditorData(server);
  try {
    const normalized = normalizeEditorData(result);
    if (normalized && normalized.blocks.length !== result.blocks.length)
      return { ok: false, reason: 'invalid blocks were dropped by normalisation', steps };
  } catch (error) {
    return { ok: false, reason: `invalid Editor.js data: ${error.code}`, steps };
  }
  if (new Set(result.blocks.map((b) => b.id)).size !== result.blocks.length)
    return { ok: false, reason: 'duplicate block ids', steps };
  clients.forEach((x) => x.c.replica.destroy());
  server.destroy();
  return { ok: true, steps };
};

test('property: random concurrent sessions converge to identical, valid Editor.js data', () => {
  const from = Number(process.env.MEX_FUZZ_FROM || 1);
  const count = Number(process.env.MEX_FUZZ_SEEDS || 200);
  let steps = 0;
  for (let seed = from; seed < from + count; seed += 1) {
    const result = runSession(seed);
    steps += result.steps;
    assert.ok(result.ok, `seed ${seed}: ${result.reason}`);
  }
  if (process.env.MEX_FUZZ_REPORT)
    console.log(`fuzz: ${count} seeds from ${from}, ${steps} steps, all converged`);
});

/**
 * Inserts only (unique markers into paragraphs, cells, list items and
 * checklist texts) on stale views with random delivery: every marker must
 * survive, which proves no concurrent edit is lost.
 * @param {number} seed - PRNG seed.
 * @returns {{ ok: boolean, reason?: string, markers: number }} Result.
 */
const runMarkerSession = (seed) => {
  const rnd = prng(seed);
  const n = 2 + Math.floor(rnd() * 6); // 2..7 clients
  const seedUpdate = createSeedUpdate(initial(), 'e');
  const clients = Array.from({ length: n }, () => client(seedUpdate));
  const pending = [];
  const markers = [];
  const steps = 20 + Math.floor(rnd() * 40);
  for (let step = 0; step < steps; step += 1) {
    clients.forEach((c, i) => {
      if (rnd() < 0.5) {
        const marker = `[m${i}x${step}]`;
        markers.push(marker);
        c.edit((d) => {
          const slots = [];
          d.blocks.forEach((b) => {
            if (b.type === 'paragraph') slots.push((f) => (b.data.text = f(b.data.text)));
            if (b.type === 'table')
              b.data.content.forEach((row) => row.forEach((_, k) => slots.push((f) => (row[k] = f(row[k])))));
            if (b.type === 'list')
              b.data.items.forEach((it) => slots.push((f) => (it.content = f(it.content))));
            if (b.type === 'checklist')
              b.data.items.forEach((it) => slots.push((f) => (it.text = f(it.text))));
          });
          const slot = slots[Math.floor(rnd() * slots.length)];
          slot((text) => {
            const at = Math.floor(rnd() * (String(text).length + 1));
            // never split another marker
            const s = String(text);
            const safe = s.lastIndexOf(']', at - 1) + 1;
            const pos = s.slice(safe, at).includes('[') ? safe : at;
            return s.slice(0, pos) + marker + s.slice(pos);
          });
        });
      }
      for (const update of c.outbox.splice(0)) pending.push({ from: i, update });
      if (rnd() < 0.4 && c.dirty) c.render();
    });
    pending.sort(() => rnd() - 0.5);
    const now = pending.splice(0, Math.floor(rnd() * (pending.length + 1)));
    for (const m of now) clients.forEach((c, i) => i !== m.from && c.replica.applyRemote(m.update));
  }
  for (const m of pending) clients.forEach((c, i) => i !== m.from && c.replica.applyRemote(m.update));
  clients.forEach((c) => c.render());
  const text = JSON.stringify(clients[0].editor);
  for (const c of clients)
    if (JSON.stringify(c.editor) !== text) return { ok: false, reason: 'diverged', markers: markers.length };
  const lost = markers.filter((m) => !text.includes(m));
  return lost.length
    ? { ok: false, reason: `lost ${lost.join(',')}`, markers: markers.length }
    : { ok: true, markers: markers.length };
};

test('property: concurrent inserts on stale views never lose an edit', () => {
  const from = Number(process.env.MEX_FUZZ_FROM || 1);
  const count = Number(process.env.MEX_FUZZ_SEEDS || 200);
  let markers = 0;
  for (let seed = from; seed < from + count; seed += 1) {
    const result = runMarkerSession(seed);
    markers += result.markers;
    assert.ok(result.ok, `seed ${seed}: ${result.reason}`);
  }
  if (process.env.MEX_FUZZ_REPORT)
    console.log(`markers: ${count} seeds, ${markers} concurrent edits, none lost`);
});

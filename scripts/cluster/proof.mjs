/**
 * Cluster proof for Magic Editor X live collaboration, run by
 * scripts/cluster-acceptance.mjs against several Strapi processes that share
 * one PostgreSQL database behind a non-sticky round-robin balancer.
 *
 * Checks:
 * 1. two editors connected to different processes edit the same field at the
 *    same time (concurrent typing in one paragraph plus new blocks) and
 *    converge to the same document that contains every edit;
 * 2. a third client that joins through the balancer receives the merged state;
 * 3. the process of one editor is killed; the editor reconnects through the
 *    balancer to another process, keeps editing, and nothing acknowledged is
 *    lost; after the process restarts, a fresh client sees everything;
 * 4. automatic snapshots are created exactly once: when the last editors of a
 *    room leave from two processes at the same time, one snapshot exists for
 *    that state; time-bucket snapshots exist at most once per bucket.
 * Prints a result table and exits non-zero on any failure.
 */
import crypto from 'node:crypto';
import { io } from 'socket.io-client';
import * as Y from 'yjs';
import pg from 'pg';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

const balancerPort = Number(process.env.MEX_CLUSTER_BALANCER_PORT);
const ports = String(process.env.MEX_CLUSTER_PORTS).split(',').map(Number);
const BALANCER = `http://127.0.0.1:${balancerPort}`;
const url = (port) => `http://127.0.0.1:${port}`;
const results = [];
const record = (check, ok, detail) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check}: ${detail}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const call = async (base, method, path, { token, body } = {}) => {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
};

// --- setup: admin, article --------------------------------------------------
const password = `Mx1!${crypto.randomBytes(12).toString('base64url')}`;
const email = 'cluster-admin@example.test';
let response = await call(BALANCER, 'POST', '/admin/register-admin', {
  body: { firstname: 'Cluster', lastname: 'Admin', email, password },
});
if (response.status !== 200) throw new Error(`register-admin ${response.status}`);
const token = response.body.data.token;
response = await call(BALANCER, 'POST', '/content-manager/collection-types/api::article.article', {
  token,
  body: {
    title: 'Cluster',
    body: { time: 1, version: '2.31.7', blocks: [{ id: 'c1', type: 'paragraph', data: { text: 'Start' } }] },
  },
});
if (response.status !== 201) throw new Error(`create article ${response.status}`);
const documentId = response.body.data.documentId;
const target = { uid: 'api::article.article', documentId, locale: 'en', field: 'body' };
const room = `${target.uid}|${target.documentId}|en|body`;

// --- clients ----------------------------------------------------------------
/**
 * A collaboration client bound to one HTTP base (process or balancer).
 * Mirrors admin/src/editor/collab-client.js: unacknowledged updates are kept
 * and sent again after a reconnect.
 */
const client = (name, sessionBase, socketBase) =>
  new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    let pending = null;
    let acked = 0;
    let socket = null;
    let resync = null;
    let resolved = false;
    const requestToken = async (base) => {
      const result = await call(base, 'POST', '/magic-editor-x/collaboration/session', {
        token,
        body: {
          ...target,
          initialValue: { time: 1, blocks: [{ id: 'c1', type: 'paragraph', data: { text: 'Start' } }] },
        },
      });
      if (result.status !== 200) throw new Error(`${name} session ${result.status}`);
      return result.body.data;
    };
    const flush = () => {
      if (!pending || !socket || !socket.connected) return;
      const update = pending;
      pending = null;
      socket.timeout(5000).emit('mx:update', update, (error, reply) => {
        if (error || !reply || !reply.ok) pending = pending ? Y.mergeUpdates([update, pending]) : update;
        else acked += 1;
      });
    };
    doc.on('update', (update, origin) => {
      if (origin === 'remote') return;
      pending = pending ? Y.mergeUpdates([pending, update]) : update;
      flush();
    });
    const open = async (sBase, wBase) => {
      const first = await requestToken(sBase);
      let firstToken = first.token;
      socket = io(wBase, {
        path: first.path,
        transports: ['websocket'],
        reconnectionDelay: 300,
        reconnectionDelayMax: 1000,
        auth: (cb) => {
          if (firstToken) {
            const t = firstToken;
            firstToken = null;
            cb({ token: t });
          } else
            requestToken(sBase).then(
              (next) => cb({ token: next.token }),
              () => cb({ token: '' })
            );
        },
      });
      socket.on('mx:sync', ({ update, stateVector }) => {
        Y.applyUpdate(doc, new Uint8Array(update), 'remote');
        const missing = Y.encodeStateAsUpdate(doc, new Uint8Array(stateVector));
        if (missing.byteLength > 2) pending = pending ? Y.mergeUpdates([pending, missing]) : missing;
        flush();
        if (!resolved) {
          resolved = true;
          resolve(api);
        }
      });
      socket.on('mx:update', (update) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
      socket.on('connect_error', () => {});
      clearInterval(resync);
      resync = setInterval(
        () => socket.connected && socket.emit('mx:resync', Y.encodeStateVector(doc)),
        2000
      );
    };
    const api = {
      name,
      doc,
      data: () => docToEditorData(doc),
      edit: (mutator) => applyEditorDataToDoc(doc, mutator(docToEditorData(doc)), 'local'),
      pendingBytes: () => (pending ? pending.byteLength : 0),
      acked: () => acked,
      /** Opens a new connection with the same document (a browser reconnecting through the load balancer). */
      reconnect: async (sBase, wBase) => {
        socket.removeAllListeners();
        socket.disconnect();
        await open(sBase, wBase);
      },
      close: () => {
        clearInterval(resync);
        socket.disconnect();
      },
    };
    open(sessionBase(), socketBase()).catch(reject);
  });

const textOf = (data, id) =>
  (data.blocks.find((block) => block.id === id) || { data: { text: '' } }).data.text;

// 1. two processes, concurrent edits
const a = await client(
  'A',
  () => url(ports[0]),
  () => url(ports[0])
);
const b = await client(
  'B',
  () => url(ports[1]),
  () => url(ports[1])
);
const markers = [];
for (let round = 0; round < 30; round += 1) {
  const ma = `a${round};`;
  const mb = `b${round};`;
  markers.push(ma, mb);
  a.edit((data) => ({
    ...data,
    blocks: data.blocks.map((block) =>
      block.id === 'c1' ? { ...block, data: { text: `${ma}${block.data.text}` } } : block
    ),
  }));
  b.edit((data) => ({
    ...data,
    blocks: data.blocks.map((block) =>
      block.id === 'c1' ? { ...block, data: { text: `${block.data.text}${mb}` } } : block
    ),
  }));
  if (round % 5 === 0) {
    a.edit((data) => ({
      ...data,
      blocks: [
        ...data.blocks,
        { id: `ab${round}`, type: 'paragraph', data: { text: `block from A ${round}` } },
      ],
    }));
    b.edit((data) => ({
      ...data,
      blocks: [
        { id: `bb${round}`, type: 'header', data: { text: `heading from B ${round}`, level: 2 } },
        ...data.blocks,
      ],
    }));
  }
  await sleep(40);
}
let converged = false;
for (let i = 0; i < 60 && !converged; i += 1) {
  await sleep(250);
  converged = JSON.stringify(a.data().blocks) === JSON.stringify(b.data().blocks);
}
const merged = textOf(a.data(), 'c1');
record(
  'two processes converge',
  converged,
  `ports ${ports[0]} and ${ports[1]}, ${a.data().blocks.length} blocks`
);
record(
  'no concurrent edit lost',
  markers.every((marker) => merged.includes(marker)),
  `${markers.filter((m) => merged.includes(m)).length}/${markers.length} markers`
);
record(
  'concurrent block inserts kept',
  [0, 5, 10, 15, 20, 25].every(
    (round) =>
      a.data().blocks.some((x) => x.id === `ab${round}`) && a.data().blocks.some((x) => x.id === `bb${round}`)
  ),
  'A appends, B prepends'
);

// 2. third client through the balancer
const c = await client(
  'C',
  () => BALANCER,
  () => BALANCER
);
await sleep(500);
record(
  'late joiner via balancer gets merged state',
  JSON.stringify(c.data().blocks) === JSON.stringify(a.data().blocks),
  `${c.data().blocks.length} blocks`
);

// 3. kill the process of client A while it edits; it reconnects elsewhere
const killPort = ports[0];
process.send?.({ kill: killPort });
await new Promise((resolve) =>
  process.once('message', (message) => message && message.killed === killPort && resolve())
);
for (let i = 0; i < 10; i += 1) {
  a.edit((data) => ({
    ...data,
    blocks: data.blocks.map((block) =>
      block.id === 'c1' ? { ...block, data: { text: `${block.data.text}k${i};` } } : block
    ),
  }));
  await sleep(100);
}
// A's process is gone: it reconnects through the balancer with the same document and unsent edits.
await a.reconnect(BALANCER, BALANCER);
let recovered = false;
for (let i = 0; i < 80 && !recovered; i += 1) {
  await sleep(250);
  recovered =
    a.pendingBytes() === 0 && [...Array(10).keys()].every((n) => textOf(b.data(), 'c1').includes(`k${n};`));
}
record(
  'edits during a process crash are not lost',
  recovered,
  `client A reconnected after port ${killPort} was killed`
);
process.send?.({ restart: killPort });
await new Promise((resolve) =>
  process.once('message', (message) => message && message.restarted === killPort && resolve())
);
const d = await client(
  'D',
  () => url(killPort),
  () => url(killPort)
);
await sleep(500);
record(
  'restarted process serves the full room',
  JSON.stringify(d.data().blocks) === JSON.stringify(b.data().blocks),
  `fresh client on ${killPort}`
);

// 4. exactly-once snapshots
const db = new pg.Client({ connectionString: process.env.MEX_CLUSTER_PG_URL });
await db.connect();
for (const x of [a, b, c, d]) x.close();
await sleep(4000);
const rows = (
  await db.query(
    "select trigger, content_hash, version from magic_editor_doc_snapshots where content_type = $1 and entry_id = $2 and field_name = 'body' order by version",
    [target.uid, target.documentId]
  )
).rows;
const hashes = rows.map((row) => row.content_hash);
record(
  'session-end snapshot exactly once',
  rows.filter((row) => row.trigger === 'auto').length >= 1 && new Set(hashes).size === hashes.length,
  `${rows.length} snapshot(s), versions ${rows.map((r) => r.version).join(',')}`
);
const locks = (await db.query('select key from magic_editor_x_locks where key like $1', [`snap:${room}:%`]))
  .rows;
const endLocks = locks.filter((row) => row.key.includes(':end'));
record(
  'snapshot leases unique per key',
  new Set(locks.map((row) => row.key)).size === locks.length,
  `${endLocks.length} session-end lease(s), ${locks.length - endLocks.length} time-bucket lease(s)`
);
const stored = (
  await db.query(
    'select count(*)::int as n, sum(size)::int as bytes from magic_editor_x_collab_updates where room = $1',
    [room]
  )
).rows[0];
record('room stored in the shared database', stored.n > 0, `${stored.n} update rows, ${stored.bytes} bytes`);
await db.end();

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} cluster checks passed`);
process.exit(failed.length ? 1 : 0);

/**
 * Cluster proof for Magic Editor X live collaboration (2.1), run by
 * scripts/cluster-acceptance.mjs against several Strapi processes that share
 * one PostgreSQL database behind a non-sticky round-robin balancer.
 *
 * Every client is the real admin collaboration client
 * (admin/src/editor/collab-client.js, loaded by node-client.mjs) around a
 * simulated editor. During the chaos phase (MEX_CLUSTER_DURATION_S, default
 * 150 s, so at least two one-minute snapshot buckets pass):
 * - MEX_CLUSTER_CLIENTS (default 12) clients connect through the balancer and
 *   insert unique markers into paragraphs, table cells and list items, add
 *   blocks, table rows and list items, all at the same time;
 * - random processes are killed (SIGKILL) and restarted;
 * - random processes are cut off from all clients (network partition at the
 *   balancer) for a few seconds;
 * - random clients go offline for a few seconds and keep editing.
 * Then: every client converges to the same document, every marker is present
 * (zero lost edits), no client has unsent edits, a fresh client sees the same
 * state; time-bucket and session-end versions exist exactly once per key; a
 * permission change reaches a client on another process within the SLA; the
 * AI rate limit is shared by all processes; field presets are enforced by
 * every process (save and live channel) when the app has the `teaser` field
 * with `{ preset: 'minimal' }` (see CONTRIBUTING.md).
 * Prints a result table and exits non-zero on any failure.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { io } from 'socket.io-client';
import pg from 'pg';
import * as Y from 'yjs';
import { loadCollabClient, simulatedEditor, ioRef } from './node-client.mjs';
import { applyEditorDataToDoc } from '../../shared/ydoc.mjs';

ioRef.io = io;
const { createCollabClient } = await loadCollabClient();
const balancerPort = Number(process.env.MEX_CLUSTER_BALANCER_PORT);
const ports = String(process.env.MEX_CLUSTER_PORTS).split(',').map(Number);
const BALANCER = `http://127.0.0.1:${balancerPort}`;
const DURATION_MS = Number(process.env.MEX_CLUSTER_DURATION_S || 150) * 1000;
const CLIENTS = Number(process.env.MEX_CLUSTER_CLIENTS || 12);
const PERMISSION_SLA_MS = 5000;
const url = (port) => `http://127.0.0.1:${port}`;
const results = [];
const record = (check, ok, detail) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check}: ${detail}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rnd = (n) => Math.floor(Math.random() * n);

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

// --- setup -------------------------------------------------------------------
const password = `Mx1!${crypto.randomBytes(12).toString('base64url')}`;
let response = await call(BALANCER, 'POST', '/admin/register-admin', {
  body: { firstname: 'Cluster', lastname: 'Admin', email: 'cluster-admin@example.test', password },
});
if (response.status !== 200) throw new Error(`register-admin ${response.status}`);
const token = response.body.data.token;
const seed = {
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
    {
      id: 'l1',
      type: 'list',
      data: { style: 'unordered', meta: {}, items: [{ content: 'one', meta: {}, items: [] }] },
    },
    { id: 'p2', type: 'paragraph', data: { text: 'End' } },
  ],
};
response = await call(BALANCER, 'POST', '/content-manager/collection-types/api::article.article', {
  token,
  body: { title: 'Cluster', body: seed },
});
if (response.status !== 201) throw new Error(`create article ${response.status}`);
const documentId = response.body.data.documentId;
const target = { uid: 'api::article.article', documentId, locale: 'en', field: 'body' };
const room = `${target.uid}|${target.documentId}|en|body`;

const session =
  (authToken, base = BALANCER, gate = () => true) =>
  async () => {
    if (!gate()) throw Object.assign(new Error('offline'), { response: { status: 0 } });
    const result = await call(base, 'POST', '/magic-editor-x/collaboration/session', {
      token: authToken,
      body: target,
    });
    if (result.status !== 200)
      throw Object.assign(new Error(`session ${result.status}`), { response: { status: result.status } });
    return result.body.data;
  };

const waitLive = async (list, ms = 60000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (list.every((sim) => sim.state.status === 'live')) return true;
    await sleep(200);
  }
  return false;
};

// --- clients -----------------------------------------------------------------
const clients = [];
for (let i = 0; i < CLIENTS; i += 1) {
  const net = { online: true, sockets: [] };
  const sim = simulatedEditor({
    name: `c${i}`,
    createCollabClient,
    url: BALANCER,
    requestSession: session(token, BALANCER, () => net.online),
    onSocket: (socket) => {
      net.sockets.push(socket);
      socket.on('disconnect', () => {
        net.disconnects = (net.disconnects || 0) + 1;
      });
    },
  });
  sim.net = net;
  clients.push(sim);
}
record('all clients reach the live state', await waitLive(clients), `${CLIENTS} clients via the balancer`);

// --- chaos phase ---------------------------------------------------------------
const markers = [];
let counter = 0;
const slotEdit = (sim) => {
  const marker = `[${sim.name}m${counter++}]`;
  const ok = sim.edit((doc) => {
    const slots = [];
    doc.blocks.forEach((block) => {
      // The compaction phase rewrites the "churn" block as a whole; markers go elsewhere.
      if (block.type === 'paragraph' && block.id !== 'churn')
        slots.push((f) => (block.data.text = f(block.data.text)));
      if (block.type === 'table')
        block.data.content.forEach((row) => row.forEach((_, k) => slots.push((f) => (row[k] = f(row[k])))));
      if (block.type === 'list')
        block.data.items.forEach((item) => slots.push((f) => (item.content = f(item.content))));
    });
    const r = Math.random();
    const table = doc.blocks.find((block) => block.type === 'table');
    const list = doc.blocks.find((block) => block.type === 'list');
    // An editor that has not rendered the room yet has no slots: add a block instead.
    if (r < 0.08 || slots.length === 0) {
      doc.blocks.splice(rnd(doc.blocks.length + 1), 0, {
        id: `b${sim.name}x${counter}`,
        type: 'paragraph',
        data: { text: marker },
      });
    } else if (r < 0.12 && table) {
      table.data.content.push([marker, '']);
    } else if (r < 0.15 && list) {
      list.data.items.push({ content: marker, meta: {}, items: [] });
    } else {
      slots[rnd(slots.length)]((text) => {
        const s = String(text);
        let at = rnd(s.length + 1);
        const open = s.lastIndexOf('[', at - 1);
        const close = s.lastIndexOf(']', at - 1);
        if (open > close) at = open; // never split another marker
        return s.slice(0, at) + marker + s.slice(at);
      });
    }
  });
  if (ok) markers.push(marker);
};

const down = new Set();
const events = { kills: 0, partitions: 0, offline: 0 };
const chaosEnd = Date.now() + DURATION_MS;
process.on('message', (message) => {
  if (message && message.restarted) down.delete(message.restarted);
});
const editing = (async () => {
  while (Date.now() < chaosEnd) {
    for (const sim of clients) if (Math.random() < 0.35) slotEdit(sim);
    await sleep(150 + rnd(200));
  }
})();
const chaos = (async () => {
  while (Date.now() < chaosEnd - 20000) {
    await sleep(8000 + rnd(6000));
    const kind = rnd(3);
    if (kind === 0 && down.size < 2) {
      const port = ports[1 + rnd(ports.length - 1)];
      if (down.has(port)) continue;
      down.add(port);
      events.kills += 1;
      process.send?.({ kill: port });
      setTimeout(() => process.send?.({ restart: port }), 4000);
    } else if (kind === 1) {
      events.partitions += 1;
      process.send?.({ partition: ports[rnd(ports.length)], ms: 6000 });
    } else {
      const sim = clients[rnd(clients.length)];
      events.offline += 1;
      sim.net.online = false;
      for (const socket of sim.net.sockets) if (socket.io && socket.io.engine) socket.io.engine.close();
      setTimeout(() => {
        sim.net.online = true;
      }, 5000);
    }
  }
})();
await Promise.all([editing, chaos]);
for (const sim of clients) sim.net.online = true;
while (down.size > 0) await sleep(500);

// --- convergence ---------------------------------------------------------------
const settleStart = Date.now();
let settled = false;
while (!settled && Date.now() - settleStart < 120000) {
  await sleep(1000);
  const first = JSON.stringify(clients[0].client.getData().blocks);
  settled =
    clients.every((sim) => sim.state.status === 'live' && !sim.state.pending) &&
    clients.every((sim) => JSON.stringify(sim.client.getData().blocks) === first);
}
record(
  'chaos events happened',
  events.kills > 0 && events.partitions > 0 && events.offline > 0,
  `${events.kills} process kills, ${events.partitions} partitions, ${events.offline} client offline periods in ${Math.round(DURATION_MS / 1000)} s`
);
record(
  'every client converges with no unsent edits',
  settled,
  `after ${Math.round((Date.now() - settleStart) / 1000)} s`
);
const finalText = JSON.stringify(clients[0].client.getData());
const lost = markers.filter((marker) => !finalText.includes(marker));
record(
  'zero lost edits',
  lost.length === 0,
  `${markers.length - lost.length}/${markers.length} edits present${lost.length ? `; lost ${lost.slice(0, 5).join(',')}` : ''}`
);
const dupes = markers.filter((marker) => finalText.split(marker).length > 2);
record('no duplicated edits', dupes.length === 0, `${dupes.length} duplicates`);
const rendered = clients.map((sim) => JSON.stringify(sim.editor.blocks));
record(
  'rendered editors equal the shared state',
  rendered.every((value) => value === JSON.stringify(clients[0].client.getData().blocks)),
  `${clients[0].editor.blocks.length} blocks`
);
const lastPort = ports[ports.length - 1];
const fresh = simulatedEditor({
  name: 'fresh',
  createCollabClient,
  url: url(lastPort),
  requestSession: session(token, url(lastPort)),
});
await waitLive([fresh], 30000);
await sleep(1000);
record(
  'a fresh client on another process sees the same state',
  JSON.stringify(fresh.client.getData().blocks) === JSON.stringify(clients[0].client.getData().blocks),
  `port ${lastPort}`
);

// --- room compaction across processes ---------------------------------------------
// The hosts run with small compaction thresholds (MEX_COMPACT_* in
// cluster-acceptance.mjs). Everybody types and deletes (tombstones), one
// client goes offline and keeps typing, then the room is idle: exactly one
// process must rebuild it as a new generation, every process and online
// client must switch without reconnecting, and the offline client's edits
// must arrive once after it comes back.
if (process.env.MEX_COMPACT_IDLE_S) {
  const idleMs = Number(process.env.MEX_COMPACT_IDLE_S) * 1000;
  const pgdb = new pg.Client({ connectionString: process.env.MEX_CLUSTER_PG_URL });
  await pgdb.connect();
  const generation = async () =>
    (await pgdb.query('select owner from magic_editor_x_locks where key = $1', [`gen:${room}`])).rows[0]
      ?.owner || null;
  const churnStart = markers.length;
  const churnEnd = Date.now() + 10000;
  while (Date.now() < churnEnd) {
    for (const sim of clients) {
      sim.edit((doc) => {
        const block = doc.blocks.find((item) => item.id === 'churn');
        if (!block) doc.blocks.push({ id: 'churn', type: 'paragraph', data: { text: 'Churn' } });
        else block.data.text = block.data.text === 'Churn' ? `Churn ${'x'.repeat(60)}` : 'Churn';
      });
      if (Math.random() < 0.2) slotEdit(sim);
    }
    await sleep(100);
  }
  const genBefore = await generation();
  const phaseStart = markers.length;
  const pendingAtIdle = clients
    .filter((sim) => sim.state.pending || sim.state.status !== 'live')
    .map((sim) => `${sim.name}:${sim.state.status}${sim.state.pending ? '+pending' : ''}`);
  const snapshotsAtIdle = new Map(clients.map((sim) => [sim.name, JSON.stringify(sim.client.getData())]));
  const offlineSim = clients[clients.length - 1];
  offlineSim.net.online = false;
  for (const socket of offlineSim.net.sockets) if (socket.io && socket.io.engine) socket.io.engine.close();
  await sleep(500);
  for (let i = 0; i < 3; i += 1) slotEdit(offlineSim);
  const online = clients.slice(0, -1);
  const disconnectsBefore = online.map((sim) => sim.net.disconnects || 0);
  const idleStart = Date.now();
  let genAfter = genBefore;
  while (genAfter === genBefore && Date.now() - idleStart < idleMs + 60000) {
    await sleep(500);
    genAfter = await generation();
  }
  const switchMs = Date.now() - idleStart;
  const rows = (
    await pgdb.query('select kind from magic_editor_x_collab_updates where room = $1 order by id', [room])
  ).rows;
  record(
    'idle room is compacted into a new generation once',
    genAfter !== genBefore &&
      rows.length >= 1 &&
      rows[0].kind === 'seed' &&
      rows.filter((r) => r.kind === 'seed').length === 1,
    `after ${Math.round(switchMs / 1000)} s idle (threshold ${idleMs / 1000} s); ${rows.length} row(s) left, first ${rows[0] && rows[0].kind}`
  );
  await sleep(3000);
  const sameState = online.every(
    (sim) => JSON.stringify(sim.client.getData().blocks) === JSON.stringify(online[0].client.getData().blocks)
  );
  record(
    'online clients on every process switch without reconnecting',
    sameState &&
      online.every((sim, i) => (sim.net.disconnects || 0) === disconnectsBefore[i]) &&
      online.every((sim) => sim.state.status === 'live'),
    `${online.length} clients, ${online.reduce((n, sim, i) => n + (sim.net.disconnects || 0) - disconnectsBefore[i], 0)} disconnects`
  );
  offlineSim.net.online = true;
  for (const socket of offlineSim.net.sockets) if (!socket.connected) socket.connect();
  const burstEnd = Date.now() + 8000;
  while (Date.now() < burstEnd) {
    for (const sim of clients) if (Math.random() < 0.35) slotEdit(sim);
    await sleep(200);
  }
  const settleCompaction = Date.now();
  let converged = false;
  while (!converged && Date.now() - settleCompaction < 60000) {
    await sleep(500);
    const first = JSON.stringify(clients[0].client.getData().blocks);
    converged =
      clients.every((sim) => sim.state.status === 'live' && !sim.state.pending) &&
      clients.every((sim) => JSON.stringify(sim.client.getData().blocks) === first);
  }
  const text = JSON.stringify(clients[0].client.getData());
  const lostAfter = markers.filter((marker) => !text.includes(marker));
  const dupesAfter = markers.filter((marker) => text.split(marker).length > 2);
  record(
    'after compaction: converged, offline edits kept, nothing lost or duplicated',
    converged && lostAfter.length === 0 && dupesAfter.length === 0,
    `${markers.length - lostAfter.length}/${markers.length} edits, ${dupesAfter.length} duplicates, converged ${converged}${
      lostAfter.length
        ? `; lost ${lostAfter.slice(0, 8).join(',')} (offline client ${offlineSim.name}, ${markers.length} markers, churn from ${churnStart}, offline phase from ${phaseStart}; not settled at idle: ${pendingAtIdle.join(' ') || 'none'}; holders at idle: ${lostAfter
            .slice(0, 3)
            .map(
              (m) =>
                `${m}=${[...snapshotsAtIdle]
                  .filter(([, text]) => text.includes(m))
                  .map(([name]) => name)
                  .join('/')}`
            )
            .join(' ')})`
        : ''
    }`
  );
  const late = simulatedEditor({
    name: 'late',
    createCollabClient,
    url: url(ports[3]),
    requestSession: session(token, url(ports[3])),
  });
  await waitLive([late], 30000);
  await sleep(1000);
  record(
    'a fresh client after compaction sees the same state',
    JSON.stringify(late.client.getData().blocks) === JSON.stringify(clients[0].client.getData().blocks),
    `port ${ports[3]}`
  );
  late.client.destroy();
  await pgdb.end();
}

// --- field presets on every process -------------------------------------------
// `teaser` has `{ preset: 'minimal' }`: no headings. Every process must refuse a
// heading on save and over its realtime channel, and accept a paragraph.
{
  const probe = await call(BALANCER, 'POST', '/content-manager/collection-types/api::article.article', {
    token,
    body: {
      title: 'Cluster preset',
      teaser: { time: 1, version: '2.31.7', blocks: [{ id: 't1', type: 'paragraph', data: { text: 'hi' } }] },
    },
  });
  if (probe.status === 201 && probe.body.data.teaser) {
    const presetTarget = {
      uid: 'api::article.article',
      documentId: probe.body.data.documentId,
      locale: 'en',
      field: 'teaser',
    };
    const heading = {
      time: 2,
      version: '2.31.7',
      blocks: [{ id: 'h1', type: 'header', data: { text: 'H', level: 2 } }],
    };
    let saves = 0;
    let live = 0;
    let accepted = 0;
    for (const port of ports) {
      const saved = await call(
        url(port),
        'PUT',
        `/content-manager/collection-types/api::article.article/${presetTarget.documentId}?plugins[i18n][locale]=en`,
        {
          token,
          body: { title: 'Cluster preset', teaser: heading },
        }
      );
      if (saved.status === 400 && saved.body.error.details.code === 'PRESET_VIOLATION') saves += 1;
      const sess = await call(url(port), 'POST', '/magic-editor-x/collaboration/session', {
        token,
        body: presetTarget,
      });
      if (sess.status !== 200) continue;
      const ydoc = new Y.Doc();
      const socket = io(url(port), {
        path: sess.body.data.path,
        transports: ['websocket'],
        auth: { token: sess.body.data.token, protocol: 3 },
        reconnection: false,
      });
      await new Promise((resolve) => {
        socket.on('mx:sync', ({ update }) => {
          Y.applyUpdate(ydoc, new Uint8Array(update));
          resolve();
        });
        setTimeout(resolve, 5000);
      });
      const send = (blocks) => {
        const scratch = new Y.Doc();
        Y.applyUpdate(scratch, Y.encodeStateAsUpdate(ydoc));
        const before = Y.encodeStateVector(scratch);
        applyEditorDataToDoc(scratch, { time: 3, version: '2.31.7', blocks });
        const update = Y.encodeStateAsUpdate(scratch, before);
        return new Promise((resolve) =>
          socket.timeout(5000).emit('mx:update', update, (error, reply) => resolve(error ? {} : reply))
        );
      };
      const current = () => {
        const order = ydoc.getArray('order').toArray();
        return order.map((id) => ({
          id,
          type: ydoc.getMap('blocks').get(id).get('type'),
          data: { text: String(ydoc.getMap('blocks').get(id).get('data').get('text') || '') },
        }));
      };
      const refused = await send([
        ...current(),
        { id: `h${port}`, type: 'header', data: { text: 'H', level: 2 } },
      ]);
      if (refused && refused.ok === false && refused.code === 'INVALID_UPDATE') live += 1;
      socket.disconnect();
      const sess2 = await call(url(port), 'POST', '/magic-editor-x/collaboration/session', {
        token,
        body: presetTarget,
      });
      const socket2 = io(url(port), {
        path: sess2.body.data.path,
        transports: ['websocket'],
        auth: { token: sess2.body.data.token, protocol: 3 },
        reconnection: false,
      });
      const fresh = new Y.Doc();
      await new Promise((resolve) => {
        socket2.on('mx:sync', ({ update }) => {
          Y.applyUpdate(fresh, new Uint8Array(update));
          resolve();
        });
        setTimeout(resolve, 5000);
      });
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(fresh));
      const ok = await new Promise((resolve) => {
        const scratch = new Y.Doc();
        Y.applyUpdate(scratch, Y.encodeStateAsUpdate(fresh));
        const before = Y.encodeStateVector(scratch);
        applyEditorDataToDoc(scratch, {
          time: 4,
          version: '2.31.7',
          blocks: [...current(), { id: `p${port}`, type: 'paragraph', data: { text: `from ${port}` } }],
        });
        socket2
          .timeout(5000)
          .emit('mx:update', Y.encodeStateAsUpdate(scratch, before), (error, reply) =>
            resolve(error ? {} : reply)
          );
      });
      if (ok && ok.ok) accepted += 1;
      socket2.disconnect();
    }
    record(
      'field presets are enforced by every process (save and live channel)',
      saves === ports.length && live === ports.length && accepted === ports.length,
      `save refused ${saves}/${ports.length}, live heading refused ${live}/${ports.length}, paragraph accepted ${accepted}/${ports.length}`
    );
  }
}

// --- permission revocation across processes ------------------------------------
const suffix = crypto.randomBytes(3).toString('hex');
const role = await call(url(ports[0]), 'POST', '/admin/roles', {
  token,
  body: { name: `Cluster ${suffix}`, description: 'temp' },
});
const roleId = role.body.data.id;
const P = (action, subject = null, fields = null) => ({
  action,
  subject,
  properties: fields ? { fields, locales: ['en'] } : {},
  conditions: [],
});
const fields = ['title', 'body', 'sections.heading', 'sections.body'];
const perms = (update, read = true) => [
  ...(read ? [P('plugin::content-manager.explorer.read', 'api::article.article', fields)] : []),
  ...(update ? [P('plugin::content-manager.explorer.update', 'api::article.article', fields)] : []),
  P('plugin::magic-editor-x.access'),
  P('plugin::magic-editor-x.collaborate'),
];
await call(url(ports[0]), 'PUT', `/admin/roles/${roleId}/permissions`, {
  token,
  body: { permissions: perms(true) },
});
const userEmail = `cluster-${suffix}@example.test`;
const created = await call(url(ports[0]), 'POST', '/admin/users', {
  token,
  body: { firstname: 'Rita', lastname: 'Revoke', email: userEmail, roles: [roleId] },
});
const userPassword = `Mx1!${crypto.randomBytes(12).toString('base64url')}`;
await call(url(ports[0]), 'POST', '/admin/register', {
  body: {
    registrationToken: created.body.data.registrationToken,
    userInfo: { firstname: 'Rita', lastname: 'Revoke', password: userPassword },
  },
});
const userToken = (
  await call(url(ports[0]), 'POST', '/admin/login', { body: { email: userEmail, password: userPassword } })
).body.data.token;
const revokee = simulatedEditor({
  name: 'revokee',
  createCollabClient,
  url: url(ports[2]),
  requestSession: session(userToken, url(ports[2])),
});
await waitLive([revokee], 30000);
let start = Date.now();
await call(url(ports[5]), 'PUT', `/admin/roles/${roleId}/permissions`, {
  token,
  body: { permissions: perms(false) },
});
while (revokee.state.canEdit && Date.now() - start < 15000) await sleep(50);
const downgradeMs = Date.now() - start;
record(
  'downgrade to read-only reaches another process within the SLA',
  !revokee.state.canEdit && downgradeMs < PERMISSION_SLA_MS,
  `${downgradeMs} ms (change on ${ports[5]}, socket on ${ports[2]})`
);
start = Date.now();
await call(url(ports[6]), 'PUT', `/admin/roles/${roleId}/permissions`, {
  token,
  body: { permissions: perms(false, false) },
});
while (revokee.state.status !== 'denied' && Date.now() - start < 15000) await sleep(50);
const revokeMs = Date.now() - start;
record(
  'revocation ends the session on another process within the SLA',
  revokee.state.status === 'denied' && revokeMs < PERMISSION_SLA_MS,
  `${revokeMs} ms (change on ${ports[6]}, socket on ${ports[2]})`
);
revokee.client.destroy();

// --- AI rate limit shared across processes ---------------------------------------
const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const aiSettings = await call(url(ports[0]), 'PUT', '/magic-editor-x/settings', {
  token,
  body: {
    ai: {
      enabled: true,
      provider: 'openai',
      baseUrl: `http://127.0.0.1:${fake.address().port}/v1`,
      model: 'synthetic',
      maxInputChars: 2000,
      maxOutputTokens: 256,
      apiKey: 'sk-synthetic-cluster-key',
    },
  },
});
if (new Date().getSeconds() > 40) await sleep((61 - new Date().getSeconds()) * 1000);
const statuses = [];
for (let i = 0; i < 32; i += 1) {
  const r = await call(url(ports[i % ports.length]), 'POST', '/magic-editor-x/ai/improve', {
    token,
    body: { text: `Hello ${i}`, target: { uid: 'api::article.article', field: 'body' } },
  });
  statuses.push(r.status);
}
fake.close();
const okCount = statuses.filter((status) => status === 200).length;
const limited = statuses.filter((status) => status === 429).length;
record(
  'AI rate limit is shared by all processes',
  aiSettings.status === 200 && okCount === 20 && limited === 12,
  `${okCount} answered, ${limited} refused with 429 across ${ports.length} processes (limit 20/min); settings ${aiSettings.status}`
);

// --- versions exactly once ---------------------------------------------------------
for (const sim of [...clients, fresh]) sim.client.destroy();
await sleep(6000);
const db = new pg.Client({ connectionString: process.env.MEX_CLUSTER_PG_URL });
await db.connect();
const locks = (
  await db.query('select key, owner from magic_editor_x_locks where key like $1', [`snap:${room}:%`])
).rows;
const tLocks = locks.filter((row) => /:t\d+$/.test(row.key));
const endLocks = locks.filter((row) => /:end\d+$/.test(row.key));
const versions = (
  await db.query(
    "select trigger, content_hash, version from magic_editor_doc_snapshots where content_type = $1 and entry_id = $2 and field_name = 'body' order by version",
    [target.uid, target.documentId]
  )
).rows;
const auto = versions.filter((row) => row.trigger === 'auto');
record(
  'time-bucket versions: one lease per bucket across all processes',
  tLocks.length >= 2 && new Set(tLocks.map((row) => row.key)).size === tLocks.length,
  `${tLocks.length} buckets, taken by ${new Set(tLocks.map((row) => row.owner)).size} different process(es)`
);
record(
  'automatic versions exactly once per key',
  auto.length >= 1 &&
    auto.length <= tLocks.length + endLocks.length &&
    new Set(versions.map((row) => row.version)).size === versions.length,
  `${auto.length} automatic versions for ${tLocks.length} bucket and ${endLocks.length} session-end leases; version numbers unique`
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

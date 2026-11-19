/**
 * Cluster proof for the 2.5 document presence ("Editing now" in the side panel), run by
 * `node scripts/cluster-acceptance.mjs ... --proof presence` against several Strapi processes that
 * share one PostgreSQL database. Requests go to single processes (not the balancer) on purpose:
 * - a heartbeat written by one process is seen through every other process;
 * - a live socket in a field room (a positional field keyed by identity) on one process is seen
 *   through another process; a closed socket leaves the list everywhere;
 * - a process crash (SIGKILL) leaves no ghost: its rows expire after the 30 s lifetime;
 * - leaving on one process removes the row for all;
 * - the per-admin presence limit is shared by all processes (fixed one-minute window).
 * Prints a result table and exits non-zero on any failure.
 */
import crypto from 'node:crypto';
import { io } from 'socket.io-client';

const ports = String(process.env.MEX_CLUSTER_PORTS).split(',').map(Number);
const BALANCER = `http://127.0.0.1:${process.env.MEX_CLUSTER_BALANCER_PORT}`;
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

/** Waits for a message from the parent (kill/restart acknowledgements). */
const reply = (key) =>
  new Promise((resolve) => {
    const listener = (message) => {
      if (message && message[key]) {
        process.off('message', listener);
        resolve(message[key]);
      }
    };
    process.on('message', listener);
  });

// --- setup: two super admins, one article with a top-level and a positional field ----------------
const password = () => `Mx1!${crypto.randomBytes(12).toString('base64url')}`;
const passA = password();
let response = await call(BALANCER, 'POST', '/admin/register-admin', {
  body: { firstname: 'Ada', lastname: 'Cluster', email: 'ada-cluster@example.test', password: passA },
});
if (response.status !== 200) throw new Error(`register-admin ${response.status}`);
const tokenA = response.body.data.token;
const roles = (await call(BALANCER, 'GET', '/admin/roles', { token: tokenA })).body.data;
const superRole = roles.find((role) => role.code === 'strapi-super-admin');
response = await call(BALANCER, 'POST', '/admin/users', {
  token: tokenA,
  body: { firstname: 'Bo', lastname: 'Cluster', email: 'bo-cluster@example.test', roles: [superRole.id] },
});
const passB = password();
await call(BALANCER, 'POST', '/admin/register', {
  body: {
    registrationToken: response.body.data.registrationToken,
    userInfo: { firstname: 'Bo', lastname: 'Cluster', password: passB },
  },
});
response = await call(BALANCER, 'POST', '/admin/login', {
  body: { email: 'bo-cluster@example.test', password: passB },
});
const tokenB = response.body.data.token;
const doc = (text) => ({
  time: 1,
  version: '2.31.7',
  blocks: [{ id: 'p1', type: 'paragraph', data: { text } }],
});
response = await call(BALANCER, 'POST', '/content-manager/collection-types/api::article.article', {
  token: tokenA,
  body: { title: 'Presence', body: doc('Body'), sections: [{ heading: 'S', body: doc('Section') }] },
});
if (response.status !== 201) throw new Error(`create article ${response.status}`);
const documentId = response.body.data.documentId;
let fieldKey = response.body.data.sections?.[0]?.body?.fieldKey;
if (!fieldKey) {
  const read = await call(
    BALANCER,
    'GET',
    `/content-manager/collection-types/api::article.article/${documentId}?locale=en&populate=*`,
    { token: tokenA }
  );
  fieldKey = read.body.data.sections[0].body.fieldKey;
}
const target = { uid: 'api::article.article', documentId, locale: 'en' };
const presence = (port, token, tabId, extra = {}) =>
  call(url(port), 'POST', '/magic-editor-x/presence', { token, body: { ...target, tabId, ...extra } });
const names = (res) => (res.body && res.body.data ? res.body.data.editors.map((e) => e.name) : []);
const TAB_A = 'cluster-tab-ada-000000';
const TAB_B = 'cluster-tab-bo-0000000';

// 1. A heartbeat on process 0 is seen through every other process.
await presence(ports[0], tokenA, TAB_A);
const seen = [];
for (const port of ports.slice(1)) seen.push(names(await presence(port, tokenB, TAB_B)).includes('Ada C.'));
record(
  'heartbeat seen through every process',
  seen.every(Boolean),
  `${seen.filter(Boolean).length}/${seen.length} other processes list "Ada C."`
);

// 2. B's view from A on yet another process; then A leaves on one process, everyone stops listing A.
const back = names(await presence(ports[ports.length - 1], tokenA, TAB_A));
record('both directions', back.includes('Bo C.'), `Ada sees ${JSON.stringify(back)}`);
await presence(ports[1], tokenA, TAB_A, { leave: true });
const after = names(await presence(ports[2], tokenB, TAB_B));
record('leave on one process removes the row for all', !after.includes('Ada C.'), JSON.stringify(after));

// 3. A live socket in a positional field room on process 3 is seen through process 5.
const sessionPort = ports[3 % ports.length];
response = await call(url(sessionPort), 'POST', '/magic-editor-x/collaboration/session', {
  token: tokenA,
  body: { ...target, field: 'sections.0.body', fieldKey },
});
const session = response.body.data;
const socket = io(url(sessionPort), {
  path: session.path,
  transports: ['websocket'],
  auth: { token: session.token, protocol: 4 },
  reconnection: false,
});
await new Promise((resolve) => {
  socket.on('mx:sync', resolve);
  setTimeout(resolve, 5000);
});
const otherPort = ports[5 % ports.length];
let live = null;
for (let i = 0; i < 20 && !live; i += 1) {
  const res = await presence(otherPort, tokenB, TAB_B);
  live = res.body.data.editors.find((e) => e.name === 'Ada C.') || null;
  if (!live) await sleep(100);
}
record(
  'live socket of a positional field room seen through another process',
  Boolean(live && live.live),
  live ? `listed with live=${live.live}` : 'not listed'
);
socket.disconnect();
let gone = false;
const closedAt = Date.now();
for (let i = 0; i < 40 && !gone; i += 1) {
  await sleep(100);
  gone = !names(await presence(ports[6 % ports.length], tokenB, TAB_B)).includes('Ada C.');
}
record('closed socket leaves the list everywhere', gone, `${Date.now() - closedAt} ms`);

// 4. Crash: a socket on a process that is killed leaves no ghost after the 30 s lifetime.
const crashPort = ports[4 % ports.length];
response = await call(url(crashPort), 'POST', '/magic-editor-x/collaboration/session', {
  token: tokenA,
  body: { ...target, field: 'body' },
});
const crashSocket = io(url(crashPort), {
  path: response.body.data.path,
  transports: ['websocket'],
  auth: { token: response.body.data.token, protocol: 4 },
  reconnection: false,
});
await new Promise((resolve) => {
  crashSocket.on('mx:sync', resolve);
  setTimeout(resolve, 5000);
});
const before = names(await presence(ports[0], tokenB, TAB_B)).includes('Ada C.');
process.send?.({ kill: crashPort });
await reply('killed');
crashSocket.close();
const killedAt = Date.now();
let ghost = true;
while (ghost && Date.now() - killedAt < 45000) {
  await sleep(1000);
  ghost = names(await presence(ports[0], tokenB, TAB_B)).includes('Ada C.');
}
record(
  'crashed process leaves no ghost after the presence lifetime',
  before && !ghost,
  `listed before the kill: ${before}; gone after ${Math.round((Date.now() - killedAt) / 1000)} s`
);
process.send?.({ restart: crashPort });
await reply('restarted');

// 5. The presence limit (30 per minute per admin) is shared by all processes.
await sleep(Math.max(0, 60000 - (Date.now() % 60000)) + 200);
const statuses = [];
for (let i = 0; i < 40; i += 1) {
  const res = await presence(ports[i % ports.length], tokenB, TAB_B);
  statuses.push(res.status);
}
const ok = statuses.filter((status) => status === 200).length;
record(
  'presence limit shared by all processes',
  ok === 30 && statuses.filter((status) => status === 429).length === 10,
  `${ok} answered 200, ${statuses.length - ok} answered 429 over ${ports.length} processes`
);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} presence cluster checks passed`);
process.exit(failed.length ? 1 : 0);

#!/usr/bin/env node
/**
 * Long-running multi-client session against one acceptance host, to check
 * that neither the server nor the client grows in memory.
 *
 * Usage: node --expose-gc scripts/soak.mjs --url http://127.0.0.1:<port> --creds <creds.json>
 *          --pid <strapi pid> [--minutes 30] [--clients 6]
 *
 * Every client is the real admin collaboration client. Each one types into
 * paragraphs and table cells and removes text again, so the visible document
 * stays the same size while the room keeps receiving updates (compaction,
 * tombstones). Every 30 s the server RSS (ps) and the client heap (after a
 * forced GC) are sampled; the result compares the first and last third.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { io } from 'socket.io-client';
import { loadCollabClient, simulatedEditor, ioRef } from './cluster/node-client.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = option('url');
const creds = JSON.parse(fs.readFileSync(option('creds'), 'utf8'));
const pid = Number(option('pid'));
const minutes = Number(option('minutes', '30'));
const count = Number(option('clients', '6'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const call = async (method, path, token, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

ioRef.io = io;
const { createCollabClient } = await loadCollabClient();
const token = (await call('POST', '/admin/login', null, creds.admin)).json.data.token;
const created = await call('POST', '/content-manager/collection-types/api::article.article', token, {
  title: 'Soak',
  body: {
    time: 1,
    blocks: [
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `s${i}`,
        type: 'paragraph',
        data: { text: `Paragraph ${i}` },
      })),
      {
        id: 'st',
        type: 'table',
        data: {
          content: [
            ['a', 'b', 'c'],
            ['d', 'e', 'f'],
          ],
        },
      },
    ],
  },
});
const target = {
  uid: 'api::article.article',
  documentId: created.json.data.documentId,
  locale: 'en',
  field: 'body',
};
const session = async () =>
  (await call('POST', '/magic-editor-x/collaboration/session', token, target)).json.data;
const clients = Array.from({ length: count }, (_, i) =>
  simulatedEditor({ name: `s${i}`, createCollabClient, url: BASE, requestSession: session })
);
while (!clients.every((sim) => sim.state.status === 'live')) await sleep(200);

const samples = [];
const sample = () => {
  if (global.gc) global.gc();
  const rss =
    Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) * 1024;
  samples.push({ at: Date.now(), serverRss: rss, clientHeap: process.memoryUsage().heapUsed });
};
const end = Date.now() + minutes * 60000;
let edits = 0;
let next = Date.now();
sample();
while (Date.now() < end) {
  for (const sim of clients) {
    const tag = ` ${sim.name}-${edits}`;
    sim.edit((doc) => {
      const block = doc.blocks[Math.floor(Math.random() * doc.blocks.length)];
      if (block.type === 'table') {
        const row = block.data.content[Math.floor(Math.random() * block.data.content.length)];
        const k = Math.floor(Math.random() * row.length);
        row[k] = row[k].length > 40 ? row[k].slice(0, 1) : row[k] + tag;
      } else {
        block.data.text =
          block.data.text.length > 60 ? block.data.text.replace(/ s\d+-\d+/g, '') : block.data.text + tag;
      }
    });
    edits += 1;
  }
  await sleep(250);
  if (Date.now() >= next) {
    sample();
    next = Date.now() + 30000;
  }
}
await sleep(5000);
sample();
const same = clients.every(
  (sim) => JSON.stringify(sim.client.getData()) === JSON.stringify(clients[0].client.getData())
);
const third = Math.max(1, Math.floor(samples.length / 3));
const avg = (list, key) => list.reduce((sum, s) => sum + s[key], 0) / list.length;
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const first = samples.slice(1, 1 + third);
const last = samples.slice(-third);
console.log(
  JSON.stringify(
    {
      minutes,
      clients: count,
      edits,
      converged: same,
      serverRss: {
        firstThird: mb(avg(first, 'serverRss')),
        lastThird: mb(avg(last, 'serverRss')),
        max: mb(Math.max(...samples.map((s) => s.serverRss))),
      },
      clientHeap: {
        firstThird: mb(avg(first, 'clientHeap')),
        lastThird: mb(avg(last, 'clientHeap')),
        max: mb(Math.max(...samples.map((s) => s.clientHeap))),
      },
      samples: samples.length,
    },
    null,
    2
  )
);
for (const sim of clients) sim.client.destroy();
process.exit(same ? 0 : 1);

#!/usr/bin/env node
/**
 * Multi-process acceptance run for Magic Editor X live collaboration.
 *
 * Starts a non-sticky round-robin TCP balancer and N Strapi processes
 * (default 8: two "replicas" of four processes, like Railway 2 x pm2 4) of an
 * existing Strapi 5.61 app that has magic-editor-x installed and its admin
 * built, all on one PostgreSQL database, then runs scripts/cluster/proof.mjs:
 * concurrent editing across processes, a late joiner through the balancer, a
 * process crash and restart, exactly-once snapshots. Everything is stopped
 * afterwards.
 *
 * Usage (see CONTRIBUTING.md):
 *   node scripts/cluster-acceptance.mjs --app ../mex-host --pg postgres://user@127.0.0.1:5440/mex_cluster \
 *     [--reset] [--processes 8] [--base 1480]
 *
 * The app needs an `api::article.article` collection type with a Magic Editor X
 * field `body` (the acceptance host in CONTRIBUTING.md has it) and a config that
 * reads DATABASE_CLIENT / DATABASE_URL.
 *
 * Safety:
 * - secrets are random per run, kept in memory and never printed;
 * - outgoing network is blocked in every process (cluster/block-egress.cjs);
 * - busy ports are refused; the database name must start with "mex_" and
 *   --reset drops and recreates its public schema;
 * - the app folder must be outside this repository.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(`cluster-acceptance: ${message}`);
  process.exit(1);
};

const appDir = path.resolve(option('app', process.env.MEX_CLUSTER_APP || ''));
const pgUrl = option('pg', process.env.MEX_CLUSTER_PG_URL || '');
const count = Number(option('processes', '8'));
const base = Number(option('base', '1480'));
if (!option('app', process.env.MEX_CLUSTER_APP)) fail('--app <Strapi app folder> is required');
if (!pgUrl) fail('--pg <postgres url> is required');
if (appDir === repo || appDir.startsWith(repo + path.sep))
  fail('the app folder must be outside this repository');
if (!fs.existsSync(path.join(appDir, 'node_modules', '.bin', 'strapi'))) fail(`no Strapi app at ${appDir}`);
const dbName = new URL(pgUrl).pathname.slice(1);
if (!/^mex_[a-z0-9_]+$/.test(dbName))
  fail('the database name must start with "mex_" (it is reset between runs)');
if (!Number.isInteger(count) || count < 2 || count > 16) fail('--processes must be between 2 and 16');

const ports = { balancer: base, strapi: Array.from({ length: count }, (_, i) => base + 11 + i) };
const isFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
for (const port of [ports.balancer, ...ports.strapi]) if (!(await isFree(port))) fail(`port ${port} is busy`);

if (flag('reset')) {
  const db = new pg.Client({ connectionString: pgUrl });
  await db.connect();
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
  await db.end();
  console.log(`reset database ${dbName}`);
}

const secret = () => crypto.randomBytes(32).toString('base64');
const runEnv = {
  ...process.env,
  NODE_ENV: 'production',
  NODE_OPTIONS: `-r "${path.join(here, 'cluster', 'block-egress.cjs')}"`,
  STRAPI_TELEMETRY_DISABLED: 'true',
  DATABASE_CLIENT: 'postgres',
  DATABASE_URL: pgUrl,
  DATABASE_POOL_MAX: '5',
  PUBLIC_URL: `http://127.0.0.1:${ports.balancer}`,
  APP_KEYS: [secret(), secret()].join(','),
  ADMIN_JWT_SECRET: secret(),
  API_TOKEN_SALT: secret(),
  TRANSFER_TOKEN_SALT: secret(),
  ENCRYPTION_KEY: secret(),
  JWT_SECRET: secret(),
  MAGIC_EDITOR_X_ENCRYPTION_KEY: secret(),
  MEX_POLL_MS: '200',
  MEX_CLUSTER_BALANCER_PORT: String(ports.balancer),
  MEX_CLUSTER_PORTS: ports.strapi.join(','),
  MEX_CLUSTER_PG_URL: pgUrl,
};

const logDir = fs.mkdtempSync(path.join(appDir, '.mex-cluster-logs-'));
const processes = new Map();
const strapiBin = path.join(appDir, 'node_modules', '.bin', 'strapi');
const start = (name, command, commandArgs, extraEnv = {}) => {
  const out = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  const child = spawn(command, commandArgs, {
    cwd: appDir,
    env: { ...runEnv, ...extraEnv },
    stdio: ['ignore', out, out],
  });
  processes.set(name, child);
  return child;
};
const startStrapi = (port) => start(`strapi-${port}`, strapiBin, ['start'], { PORT: String(port) });
const stopAll = () => {
  for (const child of processes.values()) if (child.exitCode === null) child.kill('SIGTERM');
};
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});
const waitHealthy = async (port, ms = 180_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/_health`);
      if (res.status === 204 || res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`process on ${port} did not become healthy (logs in ${logDir})`);
};

let code = 1;
try {
  start('balancer', process.execPath, [path.join(here, 'cluster', 'balancer.cjs')]);
  // The first process creates the schema alone: Strapi core does not coordinate schema sync.
  startStrapi(ports.strapi[0]);
  await waitHealthy(ports.strapi[0]);
  for (const port of ports.strapi.slice(1)) startStrapi(port);
  for (const port of ports.strapi.slice(1)) await waitHealthy(port);
  console.log(`${count} processes healthy on ${ports.strapi.join(', ')}; balancer on ${ports.balancer}`);
  const proof = spawn(process.execPath, [path.join(here, 'cluster', 'proof.mjs')], {
    cwd: repo,
    env: runEnv,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  proof.on('message', async (message) => {
    if (message && message.kill) {
      processes.get(`strapi-${message.kill}`).kill('SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 500));
      proof.send({ killed: message.kill });
    }
    if (message && message.restart) {
      startStrapi(message.restart);
      await waitHealthy(message.restart);
      proof.send({ restarted: message.restart });
    }
  });
  code = await new Promise((resolve) => proof.on('exit', (exitCode) => resolve(exitCode ?? 1)));
  const errors = [];
  for (const file of fs.readdirSync(logDir).filter((name) => name.startsWith('strapi-'))) {
    const lines = fs.readFileSync(path.join(logDir, file), 'utf8').split('\n');
    errors.push(
      ...lines
        .filter((line) => /magic-editor-x/.test(line) && /error|warn/i.test(line))
        .map((line) => `${file}: ${line}`)
    );
  }
  console.log(
    errors.length
      ? `plugin warnings/errors in process logs:\n${errors.join('\n')}`
      : 'process logs: no Magic Editor X warnings or errors'
  );
} catch (error) {
  console.error(`cluster-acceptance: ${error.message}`);
} finally {
  stopAll();
  console.log(`process logs: ${logDir}`);
}
process.exit(code);

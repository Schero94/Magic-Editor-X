/**
 * Throw-away Strapi host for the browser benchmark (`npm run bench:browser`).
 *
 * Writes a minimal Strapi 5 app under `.tmp/` of this repository (one
 * collection type with a Magic Editor X field), so Strapi, React and the
 * editor resolve from this repository's node_modules: one React, one
 * styled-components, no second install. The plugin is either the built
 * working copy (`resolve` to the repository) or an `npm pack` tarball
 * unpacked next to the app (`--tarball`), which also checks the package
 * `files` list.
 *
 * The host listens on 127.0.0.1 only, uses SQLite inside the app folder,
 * random secrets in a mode-600 `.env`, `admin.autoOpen: false`, no telemetry
 * and no update check, and blocks every outbound connection with the
 * `block-egress.cjs` preload. `destroy()` stops it and deletes the folder
 * (database, secrets, build).
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const STRAPI_BIN = path.join(ROOT, 'node_modules', '@strapi', 'strapi', 'bin', 'strapi.js');

const secret = () => randomBytes(32).toString('base64');

/**
 * Writes the app files.
 * @param {string} dir - App directory (created).
 * @param {{ port: number, pluginDir: string }} options - Port and plugin directory.
 * @returns {void}
 */
const writeApp = (dir, { port, pluginDir }) => {
  const file = (relative, content, mode) => {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, mode ? { mode } : undefined);
  };
  const versionOf = (name) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  // `strapi build` checks that the app declares React, React Router and styled-components.
  file(
    'package.json',
    JSON.stringify(
      {
        name: 'mex-bench-browser-host',
        private: true,
        version: '0.0.0',
        dependencies: Object.fromEntries(
          ['@strapi/strapi', 'react', 'react-dom', 'react-router-dom', 'styled-components'].map((name) => [
            name,
            versionOf(name),
          ])
        ),
      },
      null,
      2
    )
  );
  file(
    '.env',
    [
      `PORT=${port}`,
      `APP_KEYS=${[secret(), secret(), secret(), secret()].join(',')}`,
      `API_TOKEN_SALT=${secret()}`,
      `ADMIN_JWT_SECRET=${secret()}`,
      `TRANSFER_TOKEN_SALT=${secret()}`,
      `ENCRYPTION_KEY=${secret()}`,
      'STRAPI_TELEMETRY_DISABLED=true',
      '',
    ].join('\n'),
    0o600
  );
  file('public/uploads/.gitkeep', '');
  file(
    'config/server.js',
    `module.exports = ({ env }) => ({
  host: '127.0.0.1',
  port: env.int('PORT'),
  url: 'http://127.0.0.1:' + env.int('PORT'),
  app: { keys: env.array('APP_KEYS') },
  logger: { updates: { enabled: false } },
});
`
  );
  file(
    'config/admin.js',
    `module.exports = ({ env }) => ({
  autoOpen: false,
  auth: { secret: env('ADMIN_JWT_SECRET') },
  apiToken: { salt: env('API_TOKEN_SALT') },
  transfer: { token: { salt: env('TRANSFER_TOKEN_SALT') } },
  secrets: { encryptionKey: env('ENCRYPTION_KEY') },
});
`
  );
  file(
    'config/database.js',
    `const path = require('node:path');
module.exports = () => ({
  connection: {
    client: 'sqlite',
    connection: { filename: path.join(__dirname, '..', '.tmp', 'bench.db') },
    useNullAsDefault: true,
  },
});
`
  );
  file(
    'config/plugins.js',
    `module.exports = () => ({ 'magic-editor-x': { enabled: true, resolve: ${JSON.stringify(pluginDir)} } });
`
  );
  // Strapi's body parser accepts 1 MB of JSON by default; a 5,000-block entry is about 1.3 MB
  // (the plugin's own limit is 5 MB, EDITOR_DATA_LIMITS.maxBytes).
  file(
    'config/middlewares.js',
    `module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  { name: 'strapi::body', config: { jsonLimit: '6mb' } },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
`
  );
  file('src/index.js', 'module.exports = { register() {}, bootstrap() {} };\n');
  file(
    'src/api/article/content-types/article/schema.json',
    JSON.stringify({
      kind: 'collectionType',
      collectionName: 'articles',
      info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
      options: { draftAndPublish: true },
      attributes: {
        title: { type: 'string' },
        body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' },
      },
    })
  );
  for (const name of ['controllers', 'routes', 'services'])
    file(
      `src/api/article/${name}/article.js`,
      `module.exports = require('@strapi/strapi').factories.createCore${
        { controllers: 'Controller', routes: 'Router', services: 'Service' }[name]
      }('api::article.article');
`
    );
};

/**
 * Unpacks an `npm pack` tarball into `<dir>/plugin` (the package folder).
 * @param {string} tarball - Tarball path.
 * @param {string} dir - App directory.
 * @returns {string} Plugin directory.
 * @throws {Error} When tar fails.
 */
const unpack = (tarball, dir) => {
  const target = path.join(dir, 'plugin');
  fs.mkdirSync(target, { recursive: true });
  const result = spawnSync('tar', ['-xzf', path.resolve(tarball), '-C', target, '--strip-components=1'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  return target;
};

/**
 * Environment for the Strapi child processes (egress preload, no telemetry).
 * @returns {NodeJS.ProcessEnv} Environment.
 */
const childEnv = () => ({
  ...process.env,
  NODE_ENV: 'production',
  STRAPI_TELEMETRY_DISABLED: 'true',
  // Relative to the app directory (the repository path may contain spaces).
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} -r ./block-egress.cjs`.trim(),
});

/**
 * Waits until `GET /_health` answers.
 * @param {string} baseUrl - Host URL.
 * @param {number} timeoutMs - Deadline.
 * @param {() => string|null} failed - Returns a message when the process died.
 * @returns {Promise<void>}
 * @throws {Error} On timeout or when the process exits.
 */
const waitForHealth = async (baseUrl, timeoutMs, failed) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const reason = failed();
    if (reason) throw new Error(reason);
    try {
      const response = await fetch(`${baseUrl}/_health`);
      if (response.status === 204 || response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`host did not answer ${baseUrl}/_health within ${timeoutMs} ms`);
};

/**
 * Creates, builds and starts a host.
 * @param {{ port: number, tarball?: string, sourcemap?: boolean, log?: (line: string) => void }} options - Port, optional tarball, source maps for profiling, logger.
 * @returns {Promise<{ baseUrl: string, dir: string, buildMs: number, destroy: () => Promise<void> }>} Running host.
 * @throws {Error} When the build or start fails.
 * @sideeffect Writes `.tmp/bench-browser-host-<id>/`, spawns `strapi build` and `strapi start`.
 */
export const startHost = async ({ port, tarball, sourcemap = false, log = () => {} }) => {
  if (!fs.existsSync(STRAPI_BIN)) throw new Error('@strapi/strapi is not installed (run npm ci)');
  const dir = path.join(ROOT, '.tmp', `bench-browser-host-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  let child = null;
  const destroy = async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const pluginDir = tarball ? unpack(tarball, dir) : ROOT;
    if (!fs.existsSync(path.join(pluginDir, 'dist', 'admin')))
      throw new Error('the plugin is not built (npm run build)');
    writeApp(dir, { port, pluginDir });
    fs.copyFileSync(path.join(import.meta.dirname, 'block-egress.cjs'), path.join(dir, 'block-egress.cjs'));
    log(
      `host: building the admin in ${path.relative(ROOT, dir)} (plugin: ${tarball ? path.basename(tarball) : 'working copy'})`
    );
    const buildStart = Date.now();
    const build = spawnSync(process.execPath, [STRAPI_BIN, 'build', ...(sourcemap ? ['--sourcemap'] : [])], {
      cwd: dir,
      env: childEnv(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(dir, 'build.log'), `${build.stdout || ''}${build.stderr || ''}`);
    if (build.status !== 0)
      throw new Error(
        `strapi build failed (${build.status}):\n${(build.stdout || '') + (build.stderr || '')}`.slice(
          0,
          4000
        )
      );
    const buildMs = Date.now() - buildStart;
    log(`host: admin built in ${(buildMs / 1000).toFixed(1)} s, starting on 127.0.0.1:${port}`);
    const output = fs.openSync(path.join(dir, 'host.log'), 'a');
    child = spawn(process.execPath, [STRAPI_BIN, 'start'], {
      cwd: dir,
      env: childEnv(),
      stdio: ['ignore', output, output],
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, 120000, () =>
      child.exitCode !== null
        ? `strapi start exited with ${child.exitCode}:\n${fs.readFileSync(path.join(dir, 'host.log'), 'utf8').slice(-3000)}`
        : null
    );
    return { baseUrl, dir, buildMs, destroy };
  } catch (error) {
    await destroy();
    throw error;
  }
};

/**
 * Registers the first admin (empty database only) with a random password kept in memory.
 * @param {string} baseUrl - Host URL.
 * @returns {Promise<{ email: string, password: string, token: string }>} Credentials and admin token.
 * @throws {Error} When the registration fails.
 */
export const registerAdmin = async (baseUrl) => {
  const account = {
    email: 'bench-admin@example.test',
    password: `Bx1!${randomBytes(12).toString('base64url')}`,
  };
  const response = await fetch(`${baseUrl}/admin/register-admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstname: 'Bench', lastname: 'Admin', ...account }),
  });
  if (response.status !== 200 && response.status !== 201)
    throw new Error(`register-admin answered ${response.status}`);
  const body = await response.json();
  return { ...account, token: body.data.token };
};

/**
 * Logs in an existing admin (for `--base-url` runs against a host you started).
 * @param {string} baseUrl - Host URL.
 * @param {{ email: string, password: string }} account - Credentials.
 * @returns {Promise<{ email: string, password: string, token: string }>} Credentials and admin token.
 * @throws {Error} When the login fails.
 */
export const loginAdmin = async (baseUrl, account) => {
  const response = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (response.status !== 200) throw new Error(`admin login answered ${response.status}`);
  const body = await response.json();
  return { ...account, token: body.data.token };
};

/**
 * Creates an article draft through the Content Manager API.
 * @param {string} baseUrl - Host URL.
 * @param {string} token - Admin token.
 * @param {{ title: string, body: object }} data - Fields.
 * @returns {Promise<string>} The new documentId.
 * @throws {Error} When the API does not answer 201.
 */
export const createArticle = async (baseUrl, token, data) => {
  const response = await fetch(`${baseUrl}/content-manager/collection-types/api::article.article`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  const text = await response.text();
  if (response.status !== 201)
    throw new Error(`create article answered ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).data.documentId;
};

/**
 * Publishes an article, then stores a changed draft (the "Changes since last publish" marks of
 * 2.12 compare the draft with the published version).
 * @param {string} baseUrl - Host URL.
 * @param {string} token - Admin token.
 * @param {string} documentId - Document.
 * @param {{ title: string, body: object }} draft - Draft fields after publishing.
 * @returns {Promise<void>}
 * @throws {Error} When the API does not answer 200.
 */
export const publishThenEdit = async (baseUrl, token, documentId, draft) => {
  const base = `${baseUrl}/content-manager/collection-types/api::article.article/${documentId}`;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const published = await fetch(`${base}/actions/publish`, { method: 'POST', headers, body: '{}' });
  if (published.status !== 200) throw new Error(`publish answered ${published.status}`);
  const updated = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(draft) });
  if (updated.status !== 200) throw new Error(`draft update answered ${updated.status}`);
};

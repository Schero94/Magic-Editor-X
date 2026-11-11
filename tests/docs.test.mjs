/**
 * Documentation contract: README and AGENTS.md describe every admin route and
 * every top-level config key, the site contains no paid-tier wording, local
 * site references resolve and llms-full.txt is generated from the docs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const readme = read('README.md');
const agents = read('AGENTS.md');
const site = read('docs/site/index.html');
const llms = read('docs/site/llms.txt');

test('README and AGENTS.md list every admin route', () => {
  const { admin } = require('../server/src/routes/index.js');
  assert.ok(admin.routes.length > 15);
  for (const route of admin.routes) {
    const path = `/magic-editor-x${route.path}`;
    assert.ok(readme.includes(`\`${path}\``), `README misses ${route.method} ${path}`);
    assert.ok(agents.includes(`\`${route.path}\``), `AGENTS.md misses ${route.method} ${route.path}`);
    assert.ok(agents.includes(`\`${route.handler}\``), `AGENTS.md misses handler ${route.handler}`);
  }
});

test('README documents every config key with its default', () => {
  const config = require('../server/src/config/index.js').default;
  const keys = [];
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of Object.keys(value)) keys.push(`${key}.${child}`);
    } else keys.push(key);
  }
  for (const key of keys) assert.ok(readme.includes(`\`${key}\``), `README misses config key ${key}`);
  assert.ok(readme.includes('`MAGIC_EDITOR_X_ENCRYPTION_KEY`'));
});

test('README and AGENTS.md list every RBAC action', () => {
  const { ACTIONS } = require('../server/src/permissions.js');
  for (const action of Object.values(ACTIONS)) {
    assert.ok(readme.includes(action), `README misses ${action}`);
    assert.ok(agents.includes(action), `AGENTS.md misses ${action}`);
  }
});

test('no license, tier or upsell wording in the user-facing docs', () => {
  for (const [name, text] of [
    ['README.md', readme],
    ['docs/site/index.html', site],
    ['docs/site/llms.txt', llms],
  ]) {
    assert.doesNotMatch(
      text,
      /magicdx|license key|premium|upgrade to|pricing|enterprise tier|advanced tier/i,
      name
    );
  }
});

test('the Pages site has the required structure and references only existing local files', () => {
  assert.ok(site.startsWith('<!doctype html>'));
  for (const id of ['features', 'install', 'configuration', 'security', 'api', 'releases']) {
    assert.match(site, new RegExp(`<section[^>]*id="${id}"`), `section #${id}`);
  }
  assert.match(site, /<a class="skip-link"/);
  assert.match(site, /<main[^>]*id="main-content"/);
  assert.ok(site.includes('https://github.com/Schero94/Magic-Editor-X'));
  assert.ok(site.includes('https://www.npmjs.com/package/magic-editor-x'));
  assert.doesNotMatch(site, /<script[^>]+src="http/i);
  for (const term of ['editor.js', 'custom blocks', 'collaboration', 'media library']) {
    assert.ok(site.toLowerCase().includes(term), `site mentions ${term}`);
  }
  const refs = [...site.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map((match) => match[1]);
  for (const ref of refs)
    assert.ok(existsSync(path.join(root, 'docs/site', ref)), `missing docs/site/${ref}`);
});

test('README images and local links resolve', () => {
  for (const [, file] of readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (/^https?:/.test(file)) continue;
    assert.ok(existsSync(path.join(root, file)), `README image missing: ${file}`);
  }
  for (const [, file] of readme.matchAll(/\]\(\.\/([^)#]+)\)/g)) {
    assert.ok(existsSync(path.join(root, file)), `README link missing: ${file}`);
  }
  assert.ok(readme.includes('https://schero94.github.io/Magic-Editor-X/'));
});

test('llms-full.txt matches README.md and AGENTS.md', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-llms-full.mjs'), '--check'], {
    stdio: 'pipe',
  });
});

test('LICENSE is plain MIT', () => {
  const license = read('LICENSE');
  assert.match(license, /^MIT License/);
  assert.match(license, /Schero D\./);
  assert.doesNotMatch(license, /ADDITIONAL CONDITION|license validation/i);
  assert.equal(JSON.parse(read('package.json')).license, 'MIT');
});

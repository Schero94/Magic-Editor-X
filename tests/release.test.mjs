/**
 * Release pipeline contract: semantic-release configuration, the local plugin
 * that folds the hand-written [Unreleased] section into the notes, pinned
 * workflows, Dependabot cooldowns and the package file list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const loadPlugin = () => import('../scripts/release-unreleased.mjs');

test('semantic-release keeps the v<version> tags and folds [Unreleased] before the changelog', () => {
  const config = JSON.parse(read('.releaserc.json'));
  assert.equal(config.tagFormat, 'v${version}');
  assert.deepEqual(config.branches, ['main']);
  const names = config.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
  assert.deepEqual(names, [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    './scripts/release-unreleased.mjs',
    '@semantic-release/changelog',
    '@semantic-release/npm',
    '@semantic-release/github',
    '@semantic-release/git',
  ]);
  const github = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/github'
  )[1];
  assert.equal(github.successComment, false);
  assert.equal(github.failComment, false);
  assert.equal(github.releasedLabels, false);
});

test('the release plugin moves [Unreleased] into the notes and strips co-author trailers', async () => {
  const { generateNotes, prepare, splitUnreleased, stripCoAuthorTrailers } = await loadPlugin();
  const sample =
    '# Changelog\n\n## [Unreleased]\n\n### Migration\n\n* Step.\n\n## [1.5.1](x) (2026-02-12)\n\n* old\n';
  assert.equal(splitUnreleased(sample).body, '### Migration\n\n* Step.');
  assert.equal(stripCoAuthorTrailers('* a\nCo-Authored-By: X <x@example.test>\n'), '* a\n');
  const cwd = await mkdtemp(path.join(tmpdir(), 'mex-release-'));
  try {
    await writeFile(path.join(cwd, 'CHANGELOG.md'), sample);
    assert.equal(await generateNotes({}, { cwd }), '### Migration\n\n* Step.');
    await prepare({}, { cwd, logger: { log() {} } });
    const after = await readFile(path.join(cwd, 'CHANGELOG.md'), 'utf8');
    assert.ok(!after.includes('[Unreleased]'));
    assert.ok(after.includes('## [1.5.1]'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  assert.ok((read('CHANGELOG.md').match(/^## \[Unreleased\]/gm) || []).length <= 1);
});

const SHA_PIN = /uses:\s*[\w.-]+\/[\w.-]+(?:\/[\w.-]+)?@[0-9a-f]{40}\b/;

test('every workflow pins actions to a commit SHA and is read-only by default', () => {
  for (const file of ['release.yml', 'ci.yml', 'pages.yml', 'dependency-auto-merge.yml']) {
    const text = read(`.github/workflows/${file}`);
    const uses = text.split('\n').filter((line) => /^\s*-?\s*uses:/.test(line));
    assert.ok(uses.length > 0, `${file} uses actions`);
    for (const line of uses) assert.match(line, SHA_PIN, `${file}: ${line.trim()}`);
    assert.match(text, /^permissions:\n {2}contents: read/m, `${file} defaults to read-only`);
  }
});

test('the release job runs the full gate before publishing with OIDC, token fallback and provenance', () => {
  const text = read('.github/workflows/release.yml');
  for (const step of [
    'npm install --global npm@11',
    'npm ci --ignore-scripts',
    'npm run lint',
    'npm run format:check',
    'npm run build',
    'npm test',
    'npm run verify',
    'npm audit --omit=dev',
  ]) {
    assert.ok(text.includes(step), `release.yml runs ${step}`);
  }
  assert.match(text, /id-token: write/);
  assert.match(text, /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(text, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(text, /NPM_CONFIG_PROVENANCE: 'true'/);
  assert.ok(text.indexOf('npm audit --omit=dev') < text.indexOf('npx --no-install semantic-release'));
});

test('CI covers Node 22 and 24 and checks the lockfile with npm 10 and 11', () => {
  const text = read('.github/workflows/ci.yml');
  assert.match(text, /node: \['22', '24'\]/);
  for (const step of [
    'npm run lint',
    'npm run format:check',
    'npm run build',
    'npm test',
    'npm run verify',
    'npm pack --dry-run',
    'npm audit --omit=dev',
    'npm@10 ci --dry-run',
    'npm@11 ci --dry-run',
  ]) {
    assert.ok(text.includes(step), `ci.yml runs ${step}`);
  }
});

test('Dependabot waits before proposing releases and never proposes versions the Strapi admin cannot run', () => {
  const text = read('.github/dependabot.yml');
  const [npmPart, actionsPart] = text.split('package-ecosystem: github-actions');
  assert.match(npmPart, /package-ecosystem: npm/);
  assert.match(npmPart, /default-days: 7/);
  assert.match(npmPart, /semver-major-days: 14/);
  assert.match(npmPart, /semver-minor-days: 7/);
  assert.match(npmPart, /semver-patch-days: 7/);
  assert.match(actionsPart, /cooldown:\n {6}default-days: 7\n(?! {6}semver)/);
  for (const name of [
    'react',
    'react-dom',
    'react-intl',
    'react-router-dom',
    'styled-components',
    '@strapi/*',
    '@strapi/design-system',
    '@strapi/icons',
  ]) {
    assert.ok(text.includes(`dependency-name: '${name}'`), `ignores ${name}`);
  }
});

test('the package ships only build output and the top-level docs', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.files, [
    'dist',
    'bin',
    'strapi-admin.js',
    'strapi-server.js',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
  ]);
  for (const entry of pkg.files) assert.doesNotMatch(entry, /docs|tests|pics|scripts/);
  assert.equal(pkg.name, 'magic-editor-x');
  // The CLI is self-contained (Node built-ins and the project's own @strapi/strapi).
  assert.deepEqual(pkg.bin, { 'magic-editor-x': 'bin/magic-editor-x.mjs' });
  assert.doesNotMatch(read('bin/magic-editor-x.mjs'), /from '\.\.?\//);
  assert.equal(pkg.homepage, 'https://schero94.github.io/Magic-Editor-X/');
});

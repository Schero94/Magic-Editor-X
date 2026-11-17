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

// The README is rendered outside GitHub: on npm and on the Strapi marketplace
// (community.strapi.io/marketplace/magic-editor-x), which resolves relative
// paths against its own URL. Images and links must therefore be absolute.
const PAGES_IMG = 'https://schero94.github.io/Magic-Editor-X/img/';
const REPO_BLOB = 'https://github.com/Schero94/Magic-Editor-X/blob/main/';
const MAX_README_SCREENSHOTS = 8;
/** README without fenced code blocks and inline code, which are not rendered as links. */
const readmeProse = readme.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
const readmeImages = [
  ...[...readmeProse.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map(([, alt, src]) => ({ alt, src })),
  ...[...readmeProse.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
    alt: tag.match(/\balt="([^"]*)"/)?.[1] ?? '',
    src: tag.match(/\bsrc="([^"]*)"/)?.[1] ?? '',
  })),
];

test('README images use absolute URLs that resolve to committed files and carry alt text', () => {
  assert.ok(readmeImages.length > 0);
  for (const { alt, src } of readmeImages) {
    assert.match(src, /^https:\/\//, `README image must be absolute for npm and the marketplace: ${src}`);
    assert.ok(alt.trim(), `README image needs alt text: ${src}`);
    if (src.startsWith(PAGES_IMG)) {
      const file = path.join(root, 'docs/site/img', src.slice(PAGES_IMG.length));
      assert.ok(existsSync(file), `README image not in docs/site/img: ${src}`);
    } else {
      assert.match(src, /^https:\/\/img\.shields\.io\//, `README image must come from Pages: ${src}`);
    }
  }
});

test('README shows a curated set of screenshots and links the full gallery', () => {
  const screenshots = readmeImages.filter(({ src }) => src.startsWith(PAGES_IMG) && src.endsWith('.png'));
  assert.ok(screenshots.length >= 4, `README shows ${screenshots.length} screenshots`);
  assert.ok(
    screenshots.length <= MAX_README_SCREENSHOTS,
    `README shows ${screenshots.length} screenshots, at most ${MAX_README_SCREENSHOTS}`
  );
  assert.match(readme, /\(https:\/\/schero94\.github\.io\/Magic-Editor-X\/[^)]*\)/);
});

test('README links are absolute or in-page anchors, and repository links resolve', () => {
  const links = [
    ...[...readmeProse.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]),
    ...[...readmeProse.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]),
  ];
  assert.ok(links.length > 0);
  for (const href of links) {
    assert.match(href, /^(#|https:\/\/|mailto:)/, `README link must be absolute or #anchor: ${href}`);
    if (href.startsWith(REPO_BLOB)) {
      const file = href.slice(REPO_BLOB.length).split('#')[0];
      assert.ok(existsSync(path.join(root, file)), `README links a missing file: ${file}`);
    }
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

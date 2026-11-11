/**
 * Source contract for the admin bundle: Design System tokens only, no native
 * dialogs, no debug logging, DS v2 props and no emoji.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../admin/src/', import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(jsx?|mjs)$/.test(entry) ? [path] : [];
  });
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const sources = walk(root).map((file) => [file.slice(root.length), strip(readFileSync(file, 'utf8'))]);
const offenders = (pattern) => sources.filter(([, source]) => pattern.test(source)).map(([file]) => file);

test('no colour literals and no var(--colors-*)', () => {
  assert.deepEqual(
    offenders(
      /(?<=['"`:\s(,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\brgba?\s*\(|\bhsla?\s*\(/
    ),
    []
  );
  assert.deepEqual(offenders(/var\(--colors-/), []);
});

test('no native confirm, alert or prompt', () => {
  assert.deepEqual(
    offenders(/\bwindow\.(confirm|alert|prompt)\s*\(|(?<![.\w])(confirm|alert|prompt)\s*\(/),
    []
  );
});

test('no console.log or console.info', () => {
  assert.deepEqual(offenders(/\bconsole\.(log|info|debug)\s*\(/), []);
});

test('no v1 `as` prop on JSX elements', () => {
  assert.deepEqual(offenders(/<[A-Z][\w.]*\b[^>]*\sas=\{/), []);
});

test('no emoji', () => {
  assert.deepEqual(offenders(/(?![©®™])\p{Extended_Pictographic}/u), []);
});

test('no px font sizes and no custom media widths', () => {
  assert.deepEqual(offenders(/font-?size\s*[:=]\s*[{'"`]*\s*\d+(?:\.\d+)?px/i), []);
  assert.deepEqual(
    offenders(
      /@media[^{`]*\(\s*(?:max|min)-width\s*:\s*\d+(?:\.\d+)?(?:px|em|rem)|matchMedia\(\s*['"`][^'"`]*\d+px/
    ),
    []
  );
});

test('no admin token read from browser storage', () => {
  assert.deepEqual(offenders(/(localStorage|sessionStorage)\.getItem\(\s*['"]jwtToken/), []);
});

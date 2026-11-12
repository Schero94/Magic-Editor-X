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

test('remote collaboration content is sanitised before the editor renders it (MEX-21-01)', () => {
  const field = readFileSync(join(root, 'components/EditorField/index.jsx'), 'utf8');
  const handler = field.slice(
    field.indexOf('onRemoteData: async'),
    field.indexOf('onRemoteData: async') + 1200
  );
  assert.match(handler, /client\.snapshot\(\)/);
  assert.match(handler, /prepareRemoteData\(data,/);
  assert.ok(handler.indexOf('prepareRemoteData(data,') < handler.indexOf('applyExternal('));
  const sanitize = readFileSync(join(root, 'editor/sanitize.js'), 'utf8');
  assert.match(sanitize, /export const prepareRemoteData[\s\S]*prepareEditorValue\(/);
});

test('internal-link attributes survive the admin sanitiser (DOMPurify treats them as URI-safe)', () => {
  const source = sources.find(([file]) => file === 'editor/sanitize.js')[1];
  assert.match(source, /ADD_URI_SAFE_ATTR:\s*\[\.\.\.INTERNAL_LINK_ATTRIBUTES\]/);
});

test('the gallery offers the AI alternative text suggestion per image like the image block', () => {
  const read = (file) => sources.find(([name]) => name === file)[1];
  const tools = read('editor/tools/index.js');
  const gallery = tools.slice(tools.indexOf('gallery: {'), tools.indexOf('video: {'));
  assert.match(gallery, /suggestAltText:\s*ctx\.suggestAltText/);
  const media = read('editor/tools/media.js');
  const item = media.slice(media.indexOf('const alt = createAltControl({'), media.indexOf('const caption ='));
  assert.match(item, /suggest:\s*typeof this\.config\.suggestAltText === 'function'/);
  assert.match(item, /getFileId:\s*\(\)\s*=>\s*mediaFileId\(image\.file\)/);
  assert.match(media, /import \{ mediaFileId \} from '\.\.\/ai-alt-text'/);
});

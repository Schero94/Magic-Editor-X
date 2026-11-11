import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'admin/src/translations/tools');
const load = (locale) => JSON.parse(readFileSync(path.join(dir, `${locale}.json`), 'utf8'));
const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const placeholders = (text) => (text.match(/\{([a-zA-Z]+)[,}]/g) || []).sort();

test('tool translations exist in all five locales with the same keys', () => {
  const en = load('en');
  for (const locale of LOCALES) {
    const messages = load(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      assert.ok(typeof value === 'string' && value.trim(), `${locale}:${key} is empty`);
      assert.deepEqual(placeholders(value), placeholders(en[key]), `${locale}:${key} placeholders`);
    }
  }
});

test('German tool texts use the formal address', () => {
  const de = Object.values(load('de')).join('\n');
  assert.doesNotMatch(de, /\b(du|dein|deine|dich|dir)\b/i);
});

test('every tools.* id used in the tool sources has an English text equal to its default', () => {
  const en = load('en');
  const toolDir = path.join(root, 'admin/src/editor/tools');
  const files = readdirSync(toolDir).filter((name) => /\.(m?js)$/.test(name));
  const pattern = /\b(?:t|tr|this\.t|ctx\.t)\(\s*'(tools\.[A-Za-z0-9.]+)',\s*'((?:\\'|[^'])*)'/g;
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(path.join(toolDir, file), 'utf8');
    assert.doesNotMatch(source, /\bt\(\s*`/, `${file} uses a template-literal translation id`);
    for (const match of source.matchAll(pattern)) {
      assert.equal(en[match[1]], match[2].replace(/\\'/g, "'"), `${file}: ${match[1]}`);
      checked += 1;
    }
  }
  assert.ok(checked > 50);
});

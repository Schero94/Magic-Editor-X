/**
 * Translation completeness for the whole admin: four areas (common, editor,
 * tools, settings) in five locales. The ICU parser comes from react-intl's own
 * dependency (@formatjs/icu-messageformat-parser), which the admin ships with.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

const root = fileURLToPath(new URL('../admin/src/', import.meta.url));
const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const AREAS = ['common', 'editor', 'tools', 'settings'];
const read = (area, locale) =>
  JSON.parse(readFileSync(join(root, 'translations', area, `${locale}.json`), 'utf8'));
const catalog = Object.fromEntries(
  AREAS.map((area) => [area, Object.fromEntries(LOCALES.map((l) => [l, read(area, l)]))])
);
const merged = Object.fromEntries(
  LOCALES.map((l) => [l, Object.assign({}, ...AREAS.map((area) => catalog[area][l]))])
);

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'translations' ? [] : walk(path);
    return /\.(jsx?|mjs)$/.test(entry) ? [path] : [];
  });
const sources = walk(root).map((file) => [file, readFileSync(file, 'utf8')]);

const STRING = `'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"`;
// t('id', 'default') (also this.t / ctx.t), tr('id', 'default'), getTranslation('id'), defaultMessage: 'default'
// and the `{ labelKey: 'id', label: 'default' }` pairs the inline tools use.
const PATTERNS = [
  new RegExp(`\\b(?:t|tr)\\(\\s*'([a-zA-Z][\\w.]*)'\\s*,\\s*(?:${STRING})`, 'g'),
  new RegExp(`\\b\\w+Key:\\s*'([a-zA-Z][\\w.]*)'\\s*,\\s*\\w+:\\s*(?:${STRING})`, 'g'),
  new RegExp(`getTranslation\\(\\s*'([a-zA-Z][\\w.]*)'\\s*\\)\\s*,\\s*defaultMessage:\\s*(?:${STRING})`, 'g'),
  // message tables: ['id', 'default'] and { key: 'id', text: 'default' }
  new RegExp(`\\[\\s*'((?:editor|tools|settings|field|common)\\.[\\w.]+)'\\s*,\\s*(?:${STRING})\\s*\\]`, 'g'),
  new RegExp(`\\bkey:\\s*'([a-zA-Z][\\w.]*)'\\s*,\\s*text:\\s*(?:${STRING})`, 'g'),
];
const used = new Map();
const conflicts = [];
for (const [file, source] of sources) {
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const value = (match[2] ?? match[3]).replace(/\\(['"\\])/g, '$1');
      if (used.has(match[1]) && used.get(match[1]).value !== value) conflicts.push(`${match[1]} (${file})`);
      used.set(match[1], { value, file });
    }
  }
}

const args = (message, out = new Set()) => {
  for (const element of Array.isArray(message) ? message : parse(message)) {
    if (
      [TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.select, TYPE.plural, TYPE.tag].includes(
        element.type
      )
    ) {
      out.add(element.value);
    }
    for (const option of Object.values(element.options || {})) args(option.value, out);
    if (element.children) args(element.children, out);
  }
  return [...out].sort().join(',');
};

test('no template-literal translation ids', () => {
  const offenders = sources.filter(([, s]) => /getTranslation\(\s*`|\bt\(\s*`/.test(s)).map(([f]) => f);
  assert.deepEqual(offenders, []);
});

test('each area has the same key set in every locale', () => {
  for (const area of AREAS) {
    const keys = Object.keys(catalog[area].en).sort();
    for (const locale of LOCALES)
      assert.deepEqual(Object.keys(catalog[area][locale]).sort(), keys, `${area}/${locale}`);
  }
});

test('no key is defined in two areas', () => {
  const seen = new Map();
  const duplicates = [];
  for (const area of AREAS) {
    for (const key of Object.keys(catalog[area].en)) {
      if (seen.has(key)) duplicates.push(`${key} (${seen.get(key)}, ${area})`);
      seen.set(key, area);
    }
  }
  assert.deepEqual(duplicates, []);
});

test('every id used in admin/src exists in every locale', () => {
  for (const locale of LOCALES) {
    assert.deepEqual([...used.keys()].filter((id) => !(id in merged[locale])).sort(), [], locale);
  }
});

test('defaultMessage equals the English text and one id has one default', () => {
  assert.deepEqual(conflicts, []);
  const drift = [...used]
    .filter(([id, { value }]) => id in merged.en && merged.en[id] !== value)
    .map(([id]) => id);
  assert.deepEqual(drift, []);
});

test('no orphan keys', () => {
  assert.deepEqual(
    Object.keys(merged.en)
      .filter((key) => !used.has(key))
      .sort(),
    []
  );
});

test('messages are valid ICU with identical placeholders in every locale', () => {
  for (const locale of LOCALES) {
    for (const [id, message] of Object.entries(merged[locale])) {
      assert.equal(typeof message, 'string', `${locale} ${id}`);
      assert.ok(message.trim().length > 0, `${locale} ${id} is empty`);
      assert.equal(args(message), args(merged.en[id]), `${locale} ${id}`);
    }
  }
});

test('German uses the formal Sie', () => {
  const du = /\b(du|dich|dir|dein\w*|euch|euer\w*)\b/i;
  assert.deepEqual(
    Object.entries(merged.de)
      .filter(([, message]) => du.test(message))
      .map(([key]) => key),
    []
  );
});

/**
 * Live collaboration only for editor fields with a stable path: inside a
 * repeatable component or dynamic zone the path is positional, and after an
 * entry is removed before saving the room of `sections.0.body` held the removed
 * entry's content, which the next entry's editor then showed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPositionalFieldPath } from '../admin/src/editor/field-path.mjs';

test('positional field paths are recognised', () => {
  for (const path of ['sections.0.body', 'zone.12.body', 'blocks.0.inner.3.text'])
    assert.equal(isPositionalFieldPath(path), true, path);
  for (const path of ['body', 'seo.description', 'section2.body', '', null, undefined])
    assert.equal(isPositionalFieldPath(path), false, String(path));
});

test('the editor field starts live collaboration only for stable paths', () => {
  const source = readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('const collaborationTarget =');
  const block = source.slice(start, source.indexOf('? target', start));
  assert.match(block, /!isPositionalFieldPath\(target\.field\)/);
});

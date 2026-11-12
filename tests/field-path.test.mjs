/**
 * Editor fields inside a repeatable component or dynamic zone have positional
 * paths (`sections.0.body`). 2.3.1 turned live rooms, history and comments off
 * for them because all three were keyed by that path. Since 2.4 they are keyed
 * by the value's `fieldKey` and turned on again once the key is saved
 * (tests/field-identity.test.mjs covers the server side).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPositionalFieldPath } from '../admin/src/editor/field-path.mjs';

const source = readFileSync(
  new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
  'utf8'
);

test('positional field paths are recognised', () => {
  for (const path of ['sections.0.body', 'zone.12.body', 'blocks.0.inner.3.text'])
    assert.equal(isPositionalFieldPath(path), true, path);
  for (const path of ['body', 'seo.description', 'section2.body', '', null, undefined])
    assert.equal(isPositionalFieldPath(path), false, String(path));
});

test('the live room uses the saved field identity, never a bare positional path', () => {
  const start = source.indexOf('const collaborationTarget =');
  const block = source.slice(start, source.indexOf(': null;', start));
  assert.match(block, /identityReady/);
  assert.match(block, /\? fieldTarget/);
  assert.match(source, /const identityReady = !positional \|\| Boolean\(savedKey\);/);
  assert.match(source, /target\.savedFieldKeys\.has\(fieldKey\)/);
});

test('version history, comments and the link report use the field identity', () => {
  const comments = source.slice(
    source.indexOf('const commentsEnabled ='),
    source.indexOf('const comments = useComments(')
  );
  assert.match(comments, /identityReady/);
  assert.match(source, /useComments\(\{\s*target: fieldTarget,/);
  const history = source.slice(source.indexOf('historyAvailable='), source.indexOf('onOpenHistory='));
  assert.match(history, /identityReady/);
  assert.match(history, /editor\.identity\.saveHint/);
  assert.match(source, /<HistoryModal\s+t=\{t\}\s+target=\{fieldTarget\}/);
  assert.match(source, /scheduledLinks\)\}\s+target=\{fieldTarget\}/);
});

test('edited positional values get a key; empty values stay null', () => {
  const emit = source.slice(
    source.indexOf('const emit = useCallback('),
    source.indexOf('const scheduleSave')
  );
  assert.match(emit, /if \(copy && isPositionalFieldPath\(name\)\)/);
  assert.match(emit, /createFieldKey\(\)/);
  assert.match(emit, /const copy = next \? JSON\.parse\(JSON\.stringify\(next\)\) : null;/);
});

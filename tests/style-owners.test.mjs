/**
 * Shared editor styles: one global stylesheet per page instead of one copy
 * per mounted field (each copy made every mount and unmount rebuild them all).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStyleOwners } from '../admin/src/editor/style-owners.mjs';

test('style owners: the first mounted field owns the editor styles, the next one takes over', () => {
  const owners = createStyleOwners();
  const calls = [];
  const stop = owners.subscribe(() => calls.push(owners.owner()));
  assert.equal(owners.owner(), null);
  owners.add('a');
  owners.add('b');
  owners.add('a');
  assert.equal(owners.owner(), 'a');
  owners.remove('a');
  assert.equal(owners.owner(), 'b');
  owners.remove('missing');
  owners.remove('b');
  assert.equal(owners.owner(), null);
  assert.deepEqual(calls, ['a', 'a', 'b', null]);
  stop();
  owners.add('c');
  assert.equal(calls.length, 4, 'no calls after unsubscribe');
});

test('the field renders the global editor styles through the shared owner only', () => {
  const source = readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  assert.equal((source.match(/<EditorStyles \/>/g) || []).length, 1);
  assert.match(source, /return owner \? <EditorStyles \/> : null;/);
  assert.match(source, /<SharedEditorStyles \/>/);
});

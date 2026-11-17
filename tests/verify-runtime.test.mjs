import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runIsolated, YJS_DUPLICATE } from '../scripts/run-isolated.mjs';

/**
 * The server bundle runtime check (`npm run verify:runtime`) loads the CJS and
 * the ESM server bundle in separate processes and fails when a process loads
 * two copies of Yjs, instead of printing the warning as noise.
 */
const root = path.resolve(import.meta.dirname, '..');

test('one copy of Yjs passes, its CJS and ESM build in one process fail', () => {
  assert.match(runIsolated(['-e', "require('yjs'); console.log('one')"], { cwd: root }), /one/);
  assert.throws(
    () => runIsolated(['-e', "require('yjs'); import('yjs').then(() => console.log('two'))"], { cwd: root }),
    new RegExp(YJS_DUPLICATE)
  );
  assert.throws(() => runIsolated(['-e', 'process.exit(3)'], { cwd: root }), /failed \(3\)/);
});

test('the runtime check loads each server bundle format in its own process', () => {
  const source = readFileSync(path.join(root, 'scripts/verify-server-bundle.mjs'), 'utf8');
  assert.doesNotMatch(source, /require\('\.\.\/dist\/server\/index\.js'\)/);
  assert.doesNotMatch(source, /import\('\.\.\/dist\/server\/index\.mjs'\)/);
  assert.match(source, /runIsolated\(/);
});

test('CommonJS server code takes Yjs from shared/yjs.mjs, never from a direct require', () => {
  const files = execFileSync('git', ['ls-files', 'server/src'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(c?js|mjs)$/.test(file));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /require\(\s*['"]yjs['"]\s*\)/, `${file} requires yjs directly`);
  }
});

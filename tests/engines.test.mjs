/**
 * Installing the package must not warn with EBADENGINE on the oldest Node the
 * plugin supports: every production dependency in the lockfile has to accept
 * the minimum of `engines.node` (2.5: @editorjs/embed 2.8.0 required Node 24).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const semver = require('semver');
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

test('every production dependency accepts the oldest supported Node version', () => {
  const oldest = semver.minVersion(pkg.engines.node);
  assert.ok(oldest && oldest.major >= 22, `engines.node ${pkg.engines.node}`);
  const refused = [];
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || entry.dev || entry.devOptional || !entry.engines?.node) continue;
    if (!semver.satisfies(oldest, entry.engines.node, { includePrerelease: true }))
      refused.push(`${location.replace(/^.*node_modules\//, '')}@${entry.version} (${entry.engines.node})`);
  }
  assert.deepEqual(refused, [], `refuse Node ${oldest}: ${refused.join(', ')}`);
});

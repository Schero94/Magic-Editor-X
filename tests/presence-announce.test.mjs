import test from 'node:test';
import assert from 'node:assert/strict';
import { claimPresence, diffPeers } from '../admin/src/editor/presence-announce.mjs';

test('2.7.8: diffPeers by display name (a second socket of the same person is no join)', () => {
  const a = [{ id: '1', name: 'Ben M.' }];
  assert.deepEqual(diffPeers([], a), { joined: ['Ben M.'], left: [] });
  assert.deepEqual(diffPeers(a, [...a, { id: '2', name: 'Ben M.' }]), { joined: [], left: [] });
  assert.deepEqual(diffPeers(a, []), { joined: [], left: ['Ben M.'] });
});

test('2.7.8: three fields of one entry announce a join once; another entry announces again', () => {
  const registry = new Map();
  const base = { entry: '/admin/x/1', event: 'joined', names: ['Ben M.'] };
  assert.deepEqual(claimPresence(registry, { ...base, owner: 'f1' }), ['Ben M.']);
  assert.deepEqual(claimPresence(registry, { ...base, owner: 'f2' }), []);
  assert.deepEqual(claimPresence(registry, { ...base, owner: 'f3' }), []);
  // StrictMode: the same field renders twice
  assert.deepEqual(claimPresence(registry, { ...base, owner: 'f1' }), ['Ben M.']);
  assert.deepEqual(claimPresence(registry, { ...base, entry: '/admin/x/2', owner: 'f4' }), ['Ben M.']);
  // Leaving is announced once, by whichever field sees it first; a later join again once.
  assert.deepEqual(claimPresence(registry, { ...base, event: 'left', owner: 'f2' }), ['Ben M.']);
  assert.deepEqual(claimPresence(registry, { ...base, event: 'left', owner: 'f1' }), []);
  assert.deepEqual(claimPresence(registry, { ...base, owner: 'f3' }), ['Ben M.']);
  assert.deepEqual(claimPresence(registry, { ...base, owner: 'f1' }), []);
});

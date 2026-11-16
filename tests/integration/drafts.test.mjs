// 2.5: local draft buffer and lazy start are browser-only; the server reports their config in GET /config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor } from './helpers.mjs';

test('config reports the draft buffer and lazy start settings to every plugin user', async () => {
  for (const who of ['admin', 'editor', 'reviewer']) {
    const response = await call('GET', '/magic-editor-x/config', { token: await tokenFor(who) });
    assert.equal(response.status, 200, who);
    const { drafts, lazyInit } = response.body.data;
    assert.equal(typeof drafts.enabled, 'boolean', who);
    assert.ok(Number.isInteger(drafts.ttlHours) && drafts.ttlHours >= 1 && drafts.ttlHours <= 720, who);
    assert.equal(typeof lazyInit.enabled, 'boolean', who);
    assert.ok(Number.isInteger(lazyInit.marginPx) && lazyInit.marginPx >= 0, who);
    assert.deepEqual(Object.keys(drafts).sort(), ['enabled', 'ttlHours']);
    assert.deepEqual(Object.keys(lazyInit).sort(), ['enabled', 'marginPx']);
  }
});

test('config stays closed to anonymous callers and roles without plugin access', async () => {
  assert.equal((await call('GET', '/magic-editor-x/config')).status, 401);
  assert.equal(
    (await call('GET', '/magic-editor-x/config', { token: await tokenFor('author') })).status,
    403
  );
});

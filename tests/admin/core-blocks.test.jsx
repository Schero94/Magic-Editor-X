/**
 * Core Blocks bridge (2.7): the audit trail shows the bridge switch (review item 5 of PR #22).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeSummary } from '../../admin/src/components/audit/auditText';

const t = (_id, text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));

test('audit: settings.update shows the Core Blocks bridge switched on or off', () => {
  const on = changeSummary(t, {
    event: 'settings.update',
    meta: { keys: ['ai', 'coreBlocks'], coreBlocks: 'on' },
  });
  const off = changeSummary(t, {
    event: 'settings.update',
    meta: { keys: ['coreBlocks'], coreBlocks: 'off' },
  });
  const none = changeSummary(t, { event: 'settings.update', meta: { keys: ['ai'] } });
  const text = (value) => (Array.isArray(value) ? value.join(' ') : String(value));
  assert.match(text(on), /Core Blocks bridge switched on/);
  assert.match(text(off), /Core Blocks bridge switched off/);
  assert.doesNotMatch(text(none), /Core Blocks/);
});

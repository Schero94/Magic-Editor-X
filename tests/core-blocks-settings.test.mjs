// Core Blocks bridge (2.7): the Settings switch (server settings service, admin form helpers)
// and the admin helper that wraps the Content Manager's addRichTextBlocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  prepareCoreBlocks,
  coreBlockCoverage,
  CoreBlockEditorError,
  RESERVED_CORE_BLOCK_KEYS,
} from '../admin/src/editor/core-blocks-logic.mjs';
import {
  toDraft,
  toPayload,
  sameDraft,
  mapServerErrors,
} from '../admin/src/pages/ConfigurationPage/configForm.mjs';

const require = createRequire(import.meta.url);
const settingsService = require('../server/src/services/settings.js');

const AI = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: '',
  model: 'claude-opus-5-5',
  maxInputChars: 8000,
  maxOutputTokens: 4096,
};

const host = (stored = null) => {
  let value = stored;
  const calls = [];
  const coreBlocks = {
    status: () => ({
      enabled: Boolean(value && value.coreBlocks && value.coreBlocks.enabled),
      configEnabled: false,
      source: value && value.coreBlocks ? 'settings' : 'config',
      state: value && value.coreBlocks && value.coreBlocks.enabled ? 'active' : 'off',
      reason: null,
      types: [{ type: 'callout', plugin: 'magic-editor-x' }],
    }),
    setEnabled: async (next) => calls.push(next),
  };
  const strapi = {
    config: { get: () => undefined },
    store: () => ({ get: async () => value, set: async ({ value: next }) => (value = next) }),
    plugin: () => ({
      service: (name) => {
        if (name === 'core-blocks') return coreBlocks;
        if (name === 'link-schedule') return { status: async () => ({}) };
        if (name === 'blocks') return { annotationSummaries: () => [] };
        return null;
      },
    }),
  };
  return { settings: settingsService({ strapi }), calls, stored: () => value };
};

test('settings: the switch is stored, applied at once and reported; omitted keeps it', async () => {
  const { settings, calls, stored } = host();
  const before = await settings.get();
  assert.equal(before.coreBlocks.state, 'off');
  assert.equal(before.coreBlocks.source, 'config');
  assert.deepEqual(before.coreBlocks.types, [{ type: 'callout', plugin: 'magic-editor-x' }]);

  const after = await settings.update({ ai: AI, coreBlocks: { enabled: true } });
  assert.deepEqual(stored().coreBlocks, { enabled: true });
  assert.deepEqual(calls, [true]);
  assert.equal(after.coreBlocks.state, 'active');

  await settings.update({ ai: AI });
  assert.deepEqual(stored().coreBlocks, { enabled: true }, 'an AI-only save keeps the switch');
  assert.deepEqual(calls, [true], 'and does not apply anything');
});

test('settings: strict input for the switch', async () => {
  const { settings, calls } = host();
  for (const coreBlocks of [{ enabled: 'yes' }, { enabled: true, extra: 1 }, true, {}]) {
    await assert.rejects(
      settings.update({ ai: AI, coreBlocks }),
      (error) => error.name === 'ValidationError'
    );
  }
  assert.deepEqual(calls, []);
});

test('settings form: draft, payload only when changed, dirty flag, server errors', () => {
  const dtoAi = { ...AI, apiKeyEncrypted: undefined };
  const saved = toDraft(dtoAi, undefined, { enabled: false, state: 'off' });
  assert.deepEqual(saved.coreBlocks, { enabled: false });
  assert.equal(toDraft(dtoAi, undefined, undefined).coreBlocks, undefined, 'older server: no switch');
  assert.equal(toPayload(saved, saved).coreBlocks, undefined);
  const changed = { ...saved, coreBlocks: { enabled: true } };
  assert.equal(sameDraft(changed, saved), false);
  assert.deepEqual(toPayload(changed, saved).coreBlocks, { enabled: true });
  assert.equal(toPayload(changed).coreBlocks, undefined, 'the AI connection test never sends it');
  assert.deepEqual(mapServerErrors({ fieldErrors: { 'coreBlocks.enabled': ['Invalid input'] } }), {
    'coreBlocks.enabled': 'Invalid input',
  });
});

test('admin helper: types, reserved keys, renderElement and selector requirements, default matchNode', () => {
  const render = () => null;
  const code = (blocks) => {
    try {
      prepareCoreBlocks(blocks);
    } catch (error) {
      assert.ok(error instanceof CoreBlockEditorError);
      return error.code;
    }
    return null;
  };
  assert.equal(code(null), 'INVALID_BLOCKS');
  assert.equal(code({}), 'INVALID_BLOCKS');
  assert.equal(code({ Callout: { renderElement: render } }), 'INVALID_TYPE');
  for (const key of RESERVED_CORE_BLOCK_KEYS)
    assert.equal(code({ [key]: { renderElement: render } }), 'RESERVED_TYPE');
  assert.equal(code({ callout: {} }), 'INVALID_BLOCK');
  assert.equal(code({ callout: { renderElement: render, isInBlocksSelector: true } }), 'INVALID_BLOCK');
  const prepared = prepareCoreBlocks({
    callout: {
      renderElement: render,
      isInBlocksSelector: true,
      icon: render,
      label: { id: 'x', defaultMessage: 'Callout' },
    },
  });
  assert.equal(prepared.callout.matchNode({ type: 'callout' }), true);
  assert.equal(prepared.callout.matchNode({ type: 'paragraph' }), false);
  const own = () => true;
  assert.equal(prepareCoreBlocks({ tip: { renderElement: render, matchNode: own } }).tip.matchNode, own);
});

test('admin helper: coverage of editor and server registrations', () => {
  assert.deepEqual(coreBlockCoverage([{ type: 'callout' }, { type: 'tip' }], ['callout', 'banner']), {
    both: ['callout'],
    editorOnly: ['banner'],
    serverOnly: ['tip'],
  });
  assert.deepEqual(coreBlockCoverage(undefined, undefined), { both: [], editorOnly: [], serverOnly: [] });
});

test('CI runs the Core Blocks bridge tests on the peer floor and the newest 5.x', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = text.slice(text.indexOf('  core-blocks:'), text.indexOf('  peer-floor:'));
  const floor = text.match(/FLOOR_STRAPI: '([\d.]+)'/)[1];
  assert.ok(job.includes(`strapi: ['${floor}', 'newest-5']`), 'matrix is [peer floor, newest 5.x]');
  for (const step of ['npm rebuild better-sqlite3', 'npm run build', 'npm run test:core-blocks'])
    assert.ok(job.includes(step), step);
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.match(scripts['test:core-blocks'], /core-blocks-host/);
});

test('review 5: the settings audit records whether the Core Blocks bridge was switched on or off', async () => {
  const settingsController = require('../server/src/controllers/settings.js');
  const recorded = [];
  const strapi = {
    plugin: () => ({
      service: (name) =>
        name === 'audit'
          ? { record: async (input) => recorded.push(input) }
          : { update: async () => ({ ok: true }) },
    }),
  };
  const controller = settingsController({ strapi });
  for (const enabled of [true, false]) {
    const ctx = { set() {}, request: { body: { ai: {}, coreBlocks: { enabled } } } };
    await controller.update(ctx);
  }
  await controller.update({ set() {}, request: { body: { ai: {} } } });
  assert.deepEqual(
    recorded.map((entry) => entry.meta),
    [
      { keys: ['ai', 'coreBlocks'], coreBlocks: 'on' },
      { keys: ['ai', 'coreBlocks'], coreBlocks: 'off' },
      { keys: ['ai'] },
    ]
  );
});

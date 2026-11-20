/**
 * The provider key from the environment (`ai.apiKey`) is only sent to the base
 * URL it was configured for (`ai.apiKeyBaseUrl`, else the official Anthropic and
 * OpenAI APIs), like the encrypted stored key: a settings admin who points the
 * provider at another host gets no key there unless one is entered again.
 * Synthetic keys and hosts only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { environmentKeyBaseUrls, environmentKeyCovers, normalizeBaseUrl } from '../shared/ai-endpoint.mjs';
import { toDraft, validateDraft } from '../admin/src/pages/ConfigurationPage/configForm.mjs';

const require = createRequire(import.meta.url);
const aiService = require('../server/src/services/ai.js');
const settingsService = require('../server/src/services/settings.js');
const pluginConfig = require('../server/src/config/index.js');

const ENV_KEY = 'sk-env-SYNTHETIC-0001';
const BOUND = 'https://llm.example.test';
const OTHER = 'https://attacker.example.test';

const fakeStrapi = ({ config = {}, stored = {} } = {}) => {
  const state = { settings: stored };
  const strapi = {
    config: {
      get: (key) => {
        if (key === 'plugin::magic-editor-x.encryptionKey') return 'e'.repeat(40);
        if (key === 'middlewares') return [];
        return key.startsWith('plugin::magic-editor-x.') ? config[key.slice(23)] : undefined;
      },
    },
    log: { warn: () => {}, error: () => {}, info: () => {} },
    store: () => ({
      get: async () => state.settings,
      set: async ({ value }) => {
        state.settings = value;
      },
    }),
    plugin: () => ({
      service: (name) => {
        if (name === 'settings') return settings;
        if (name === 'store') return { hit: async () => ({ count: 1 }) };
        if (name === 'core-blocks') return { status: () => undefined, setEnabled: async () => {} };
        return null;
      },
    }),
  };
  const settings = settingsService({ strapi });
  return { strapi, state, settings };
};

const compatible = (overrides = {}) => ({
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: BOUND,
  model: 'synthetic-model',
  maxInputChars: 8000,
  maxOutputTokens: 1024,
  ...overrides,
});

const recorder = () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers || {} });
    const answer = String(url).endsWith('/v1/messages')
      ? { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] };
    return { statusCode: 200, mimeType: 'application/json', body: Buffer.from(JSON.stringify(answer)) };
  };
  return { calls, fetch };
};

const keyOf = (call) =>
  call.headers.authorization ? call.headers.authorization.replace(/^Bearer /, '') : call.headers['x-api-key'];

const ENV = { 'ai.apiKey': ENV_KEY, 'ai.apiKeyBaseUrl': BOUND, 'ai.allowPrivateBaseUrl': true };

test('connection test: the environment key is not sent to another base URL', async () => {
  const { strapi, settings } = fakeStrapi({ config: ENV, stored: { ai: compatible() } });
  const { calls, fetch } = recorder();
  const service = aiService({ strapi }, { fetchBounded: fetch });
  await service.test(settings.parseAiInput(compatible({ baseUrl: OTHER })));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(OTHER));
  assert.equal(keyOf(calls[0]), undefined, 'no key travels to the other host');

  await service.test(settings.parseAiInput(compatible({ baseUrl: `${BOUND}/` })));
  assert.equal(keyOf(calls[1]), ENV_KEY, 'the configured base URL (trailing slash ignored) gets the key');

  await service.test(settings.parseAiInput(compatible({ baseUrl: OTHER, apiKey: 'sk-entered-0002' })));
  assert.equal(
    keyOf(calls[2]),
    'sk-entered-0002',
    'a key entered for the test is used, not the environment key'
  );
});

test('settings update: moving away from the configured base URL needs a key', async () => {
  const { strapi, settings, state } = fakeStrapi({ config: ENV, stored: { ai: compatible() } });
  await assert.rejects(
    settings.update({ ai: compatible({ baseUrl: OTHER }) }),
    (error) => error.name === 'ValidationError' && Array.isArray(error.details.fieldErrors['ai.apiKey'])
  );
  assert.equal(state.settings.ai.baseUrl, BOUND, 'nothing was stored');

  // Settings stored before this check (or with `apiKey: ''`): the AI routes still send no key there.
  const removed = await settings.update({ ai: compatible({ baseUrl: OTHER, apiKey: '' }) });
  assert.equal(removed.ai.hasApiKey, false);
  assert.equal(removed.ai.apiKeyFromEnvironment, false);
  const { calls, fetch } = recorder();
  const service = aiService({ strapi }, { fetchBounded: fetch });
  await service.run({ action: 'improve', text: 'Synthetic text' }, { id: 1 });
  assert.ok(calls[0].url.startsWith(OTHER));
  assert.equal(keyOf(calls[0]), undefined);
});

test('settings update: a key entered for another base URL is stored and used there', async () => {
  const { strapi, settings } = fakeStrapi({ config: ENV, stored: { ai: compatible() } });
  const dto = await settings.update({ ai: compatible({ baseUrl: OTHER, apiKey: 'sk-entered-0003' }) });
  assert.equal(dto.ai.hasApiKey, true);
  assert.equal(dto.ai.apiKeyFromEnvironment, false);
  const { calls, fetch } = recorder();
  const service = aiService({ strapi }, { fetchBounded: fetch });
  await service.run({ action: 'improve', text: 'Synthetic text' }, { id: 1 });
  assert.equal(keyOf(calls[0]), 'sk-entered-0003');

  // Back to the configured base URL: the environment key is used and the other key is dropped,
  // so it can never reach this host later (for example after ai.apiKey is removed).
  const back = await settings.update({ ai: compatible() });
  assert.equal(back.ai.apiKeyFromEnvironment, true);
  assert.equal(back.ai.hasStoredApiKey, false);
  await service.run({ action: 'improve', text: 'Synthetic text' }, { id: 1 });
  assert.equal(keyOf(calls[1]), ENV_KEY);
});

test('without ai.apiKeyBaseUrl the environment key goes to the official APIs only', async () => {
  const config = { 'ai.apiKey': ENV_KEY, 'ai.allowPrivateBaseUrl': true };
  const anthropic = compatible({ provider: 'anthropic', baseUrl: '', model: 'claude-opus-5-5' });
  const { strapi, settings } = fakeStrapi({ config, stored: { ai: anthropic } });
  const { calls, fetch } = recorder();
  const service = aiService({ strapi }, { fetchBounded: fetch });
  await service.test(settings.parseAiInput(anthropic));
  assert.ok(calls[0].url.startsWith('https://api.anthropic.com/'));
  assert.equal(keyOf(calls[0]), ENV_KEY);
  await assert.rejects(service.test(settings.parseAiInput({ ...anthropic, baseUrl: OTHER })), {
    code: 'NO_API_KEY',
  });
  await service.test(settings.parseAiInput(compatible({ baseUrl: OTHER })));
  assert.equal(keyOf(calls[1]), undefined);
  assert.equal(calls.length, 2);
  const dto = await settings.get();
  assert.deepEqual(dto.ai.apiKeyEnvironmentBaseUrls, ['https://api.anthropic.com', 'https://api.openai.com']);
});

test('settings DTO: environment key flags follow the stored endpoint, no key in the body', async () => {
  const { settings } = fakeStrapi({ config: ENV, stored: { ai: compatible({ baseUrl: OTHER }) } });
  const dto = await settings.get();
  assert.equal(dto.ai.apiKeyFromEnvironment, false);
  assert.equal(dto.ai.hasApiKey, false);
  assert.deepEqual(dto.ai.apiKeyEnvironmentBaseUrls, [BOUND]);
  assert.ok(!JSON.stringify(dto).includes(ENV_KEY));
});

test('config: ai.apiKeyBaseUrl must be an http(s) URL without credentials', () => {
  const base = pluginConfig.default;
  const check = (value) => () =>
    pluginConfig.validator({ ...base, ai: { ...base.ai, apiKeyBaseUrl: value } });
  assert.doesNotThrow(check(undefined));
  assert.doesNotThrow(check('https://llm.example.test/v2'));
  assert.throws(check('ftp://llm.example.test'));
  assert.throws(check('https://user:pw@llm.example.test'));
  assert.throws(check(42));
});

test('shared helper: normalisation and coverage', () => {
  assert.equal(normalizeBaseUrl('HTTPS://API.Example.test:443/v1/'), 'https://api.example.test/v1');
  assert.equal(normalizeBaseUrl('javascript:alert(1)'), '');
  const allowed = environmentKeyBaseUrls('');
  assert.equal(environmentKeyCovers({ provider: 'openai', baseUrl: '' }, allowed), true);
  assert.equal(environmentKeyCovers({ provider: 'openai-compatible', baseUrl: OTHER }, allowed), false);
  assert.equal(environmentKeyCovers({ provider: 'openai-compatible', baseUrl: '' }, allowed), false);
});

test('Configuration page: the key field opens and asks for a key when the environment key does not apply', () => {
  const ai = {
    ...compatible(),
    hasApiKey: true,
    hasStoredApiKey: false,
    apiKeyFromEnvironment: true,
    apiKeyEnvironmentBaseUrls: [BOUND],
    apiKeyUnreadable: false,
    canStoreApiKey: true,
  };
  const environment = { allowPrivateBaseUrl: true, defaults: { models: {}, baseUrls: {} } };
  const saved = toDraft(ai);
  assert.equal(
    validateDraft({ ...saved, baseUrl: `${BOUND}/` }, { saved, ai, environment }).apiKey,
    undefined
  );
  assert.equal(validateDraft({ ...saved, baseUrl: OTHER }, { saved, ai, environment }).apiKey, 'reenter');
  assert.equal(
    validateDraft(
      { ...saved, baseUrl: OTHER, apiKeyMode: 'replace', apiKey: 'k' },
      { saved, ai, environment }
    ).apiKey,
    undefined
  );
});

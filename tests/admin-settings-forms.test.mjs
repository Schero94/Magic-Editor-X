/**
 * Pure logic of the settings screens, checked against the server schemas so
 * the admin never sends something the server rejects for a reason the form
 * could have shown inline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  applyProvider,
  adjustedFields,
  mapServerErrors as mapSettingsErrors,
  sameDraft,
  toDraft,
  toPayload as toSettingsPayload,
  validateDraft,
} from '../admin/src/pages/ConfigurationPage/configForm.mjs';
import {
  RESERVED_NAMES,
  deriveName,
  emptyField,
  emptyValues,
  fillTemplate,
  fromDto,
  mapServerErrors,
  moveId,
  textToOptions,
  optionsToText,
  toPayload,
  validateBlock,
  withEnabled,
} from '../admin/src/pages/CustomBlocksPage/blockForm.mjs';

const require = createRequire(import.meta.url);
const server = require('../server/src/services/custom-blocks.js');

const ai = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: '',
  model: 'claude-opus-5-5',
  maxInputChars: 8000,
  maxOutputTokens: 4096,
  hasApiKey: true,
  apiKeyFromEnvironment: false,
  apiKeyUnreadable: false,
  canStoreApiKey: true,
};
const environment = {
  allowPrivateBaseUrl: false,
  defaults: { models: { anthropic: 'claude-opus-5-5', openai: 'gpt-6-luna', 'openai-compatible': '' } },
};

test('settings draft round trip and dirty check', () => {
  const draft = toDraft(ai);
  assert.equal(sameDraft(draft, toDraft(ai)), true);
  assert.deepEqual(toSettingsPayload(draft), {
    ai: {
      enabled: false,
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-opus-5-5',
      maxInputChars: 8000,
      maxOutputTokens: 4096,
    },
  });
  assert.equal(toSettingsPayload({ ...draft, apiKeyMode: 'remove' }).ai.apiKey, '');
  assert.equal(
    toSettingsPayload({ ...draft, apiKeyMode: 'replace', apiKey: ' sk-test ' }).ai.apiKey,
    'sk-test'
  );
  assert.equal(sameDraft({ ...draft, apiKeyMode: 'remove' }, draft), false);
});

test('settings validation mirrors the server ranges without clamping', () => {
  const saved = toDraft(ai);
  const check = (patch) => validateDraft({ ...saved, ...patch }, { saved, ai, environment });
  assert.deepEqual(check({}), {});
  assert.equal(check({ maxInputChars: 199 }).maxInputChars, 'range');
  assert.equal(check({ maxInputChars: 50001 }).maxInputChars, 'range');
  assert.equal(check({ maxOutputTokens: 63 }).maxOutputTokens, 'range');
  assert.equal(check({ maxOutputTokens: null }).maxOutputTokens, 'required');
  assert.equal(check({ model: 'bad model' }).model, 'modelPattern');
  assert.equal(check({ baseUrl: 'http://example.test' }).baseUrl, 'https');
  assert.equal(check({ baseUrl: 'javascript:alert(1)' }).baseUrl, 'url');
  assert.equal(check({ baseUrl: 'https://user:pw@example.test' }).baseUrl, 'url');
  assert.equal(
    validateDraft(
      { ...saved, baseUrl: 'http://127.0.0.1:11434' },
      { saved, ai, environment: { ...environment, allowPrivateBaseUrl: true } }
    ).baseUrl,
    undefined
  );
  assert.equal(check({ provider: 'openai-compatible', model: 'llama' }).baseUrl, 'required');
});

test('changing the endpoint requires the stored key again', () => {
  const saved = toDraft(ai);
  const changed = { ...saved, provider: 'openai', model: 'gpt-6-luna' };
  assert.equal(validateDraft(changed, { saved, ai, environment }).apiKey, 'reenter');
  assert.equal(
    validateDraft({ ...changed, apiKeyMode: 'replace', apiKey: 'k' }, { saved, ai, environment }).apiKey,
    undefined
  );
  assert.equal(
    validateDraft(changed, { saved, ai: { ...ai, apiKeyFromEnvironment: true }, environment }).apiKey,
    undefined
  );
  assert.equal(
    validateDraft(
      { ...saved, apiKeyMode: 'replace', apiKey: 'k' },
      { saved, ai: { ...ai, canStoreApiKey: false }, environment }
    ).apiKey,
    'cannotStore'
  );
});

test('provider switch updates a default model and keeps a custom one', () => {
  const draft = toDraft(ai);
  assert.equal(applyProvider(draft, 'openai', environment.defaults.models).model, 'gpt-6-luna');
  assert.equal(
    applyProvider({ ...draft, model: 'claude-custom' }, 'openai', environment.defaults.models).model,
    'claude-custom'
  );
});

test('server adjustments and field errors are reported', () => {
  const draft = { ...toDraft(ai), model: ' claude-opus-5-5 ' };
  assert.deepEqual(adjustedFields(draft, toDraft(ai)), []);
  assert.deepEqual(adjustedFields({ ...draft, maxInputChars: 9000 }, toDraft(ai)), ['maxInputChars']);
  assert.deepEqual(
    mapSettingsErrors({ formErrors: [], fieldErrors: { 'ai.apiKey': ['Enter it again'], ai: ['bad'] } }),
    {
      apiKey: 'Enter it again',
      _form: 'bad',
    }
  );
});

test('reserved block names match the server list', () => {
  assert.deepEqual(
    [...RESERVED_NAMES].sort(),
    [...server.RESERVED_NAMES, ...server.MEDIA_BLOCK_NAMES].sort()
  );
});

test('block names are derived from labels', () => {
  assert.equal(deriveName('Call to action'), 'callToAction');
  assert.equal(deriveName('  Über uns!  '), 'uberUns');
  assert.equal(deriveName('2 columns'), 'block2Columns');
  assert.equal(deriveName('X'), 'xBlock');
  assert.equal(deriveName('***'), '');
});

test('form payloads pass the server schema', () => {
  const simple = {
    ...emptyValues(),
    name: 'callToAction',
    label: 'Call to action',
    fields: [
      { ...emptyField(0), name: 'title', label: 'Title', required: true },
      {
        ...emptyField(1),
        name: 'variant',
        label: 'Variant',
        type: 'select',
        optionsText: 'primary\nghost | Ghost button',
      },
      { ...emptyField(2), name: 'count', label: 'Count', type: 'number', default: '3' },
      { ...emptyField(3), name: 'show', label: 'Show', type: 'checkbox', default: true },
    ],
    template: '<div class="cta"><h3 data-field="title">{{title}}</h3></div>',
    tunes: ['alignmentTune'],
    shortcut: 'cmd+shift+k',
  };
  assert.deepEqual(validateBlock(simple), {});
  const payload = toPayload(simple);
  assert.equal(payload.shortcut, 'CMD+SHIFT+K');
  assert.deepEqual(payload.fields[1].options, ['primary', { value: 'ghost', label: 'Ghost button' }]);
  assert.equal(payload.fields[2].default, 3);
  assert.equal(payload.fields[3].default, true);
  assert.equal(server.blockSchema.safeParse(payload).success, true);

  const embedded = {
    ...emptyValues(),
    name: 'relatedPost',
    label: 'Related post',
    blockType: 'embedded-entry',
    contentType: 'api::article.article',
    titleField: 'title',
    displayFields: ['title', 'slug'],
  };
  assert.deepEqual(validateBlock(embedded), {});
  assert.equal(server.blockSchema.safeParse(toPayload(embedded)).success, true);
  assert.equal(server.blockSchema.safeParse(toPayload({ ...embedded, contentType: '' })).success, true);
});

test('validation mirrors the server rules', () => {
  const base = { ...emptyValues(), name: 'quoteBox', label: 'Quote box' };
  const errors = (patch, context) => validateBlock({ ...base, ...patch }, context);
  assert.equal(errors({ name: 'paragraph' }).name, 'reserved');
  assert.equal(errors({ name: '1abc' }).name, 'namePattern');
  assert.equal(errors({ name: 'x' }).name, 'namePattern');
  assert.equal(errors({}, { existingNames: ['QuoteBox'] }).name, 'taken');
  assert.equal(errors({ shortcut: 'K' }).shortcut, 'shortcut');
  assert.equal(
    errors({ fields: [{ ...emptyField(0), name: 'a', label: 'A', type: 'select' }] })['fields.0.options'],
    'options'
  );
  assert.equal(
    errors({
      fields: [
        { ...emptyField(0), name: 'a', label: 'A' },
        { ...emptyField(1), name: 'a', label: 'B' },
      ],
    })['fields.1.name'],
    'duplicate'
  );
  for (const patch of [{ name: 'paragraph' }, { name: '1abc' }, { shortcut: 'K' }]) {
    assert.equal(
      server.blockSchema.safeParse(toPayload({ ...base, ...patch })).success,
      false,
      JSON.stringify(patch)
    );
  }
});

test('stored blocks convert back to an equivalent definition', () => {
  const dto = {
    id: 'abc',
    name: 'card',
    label: 'Card',
    blockType: 'simple',
    description: '',
    icon: '',
    contentType: null,
    displayFields: [],
    titleField: null,
    previewFields: [],
    fields: [{ name: 'size', label: 'Size', type: 'select', options: ['s', { value: 'l', label: 'Large' }] }],
    template: '',
    placeholder: '',
    styles: {},
    inlineToolbar: true,
    tunes: [],
    shortcut: null,
    sortOrder: 4,
    enabled: true,
  };
  const definition = withEnabled(dto, false);
  assert.equal(definition.enabled, false);
  assert.equal(definition.sortOrder, 4);
  assert.deepEqual(definition.fields[0].options, ['s', { value: 'l', label: 'Large' }]);
  assert.equal(server.blockSchema.safeParse(definition).success, true);
  assert.equal(optionsToText(dto.fields[0].options), 's\nl | Large');
  assert.deepEqual(textToOptions(optionsToText(dto.fields[0].options)), dto.fields[0].options);
  assert.equal(fromDto(dto).fields[0].optionsText, 's\nl | Large');
});

test('server field errors and ordering helpers', () => {
  assert.deepEqual(mapServerErrors({ formErrors: ['x'], fieldErrors: { name: ['taken'] } }), {
    name: { server: 'taken' },
    _form: { server: 'x' },
  });
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.equal(moveId(['a', 'b'], 'a', -1), null);
  assert.equal(moveId(['a', 'b'], 'b', 1), null);
});

test('template preview escapes values and keeps unknown placeholders', () => {
  const html = fillTemplate('<p>{{title}} {{ other }} {{content}}</p>', [
    { name: 'title', label: '<b>x</b>', default: '' },
  ]);
  assert.equal(html, '<p>&lt;b&gt;x&lt;/b&gt; {{ other }} Content</p>');
});

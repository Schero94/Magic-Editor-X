import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ADVANCED_TOOLS,
  NEW_FIELD_PRESET,
  PRESET_NAMES,
  checkPreset,
  isBlockAllowed,
  isBlockOffered,
  resolveFieldPreset,
} from '../shared/presets.mjs';
import { buildPresetSchema } from '../shared/preset-schema.mjs';
import { generateTypes } from '../shared/typegen.mjs';
import { presetHintPath } from '../admin/src/editor/preset-hint.mjs';

/**
 * 2.13 "Simple" preset: the Strapi Blocks set plus tables, no advanced tools; preselected for new
 * fields only. "Standard": everything except raw HTML.
 */

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });

test('simple: the Strapi Blocks set plus tables, headings 1-6, the Blocks inline marks', () => {
  const preset = resolveFieldPreset({ preset: 'simple' });
  assert.equal(preset.name, 'simple');
  assert.equal(preset.simple, true);
  assert.deepEqual(preset.blocks, [
    'paragraph',
    'header',
    'list',
    'quote',
    'code',
    'codeFlask',
    'image',
    'table',
  ]);
  assert.deepEqual(preset.inline, [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'inlineCode',
    'hyperlink',
  ]);
  assert.deepEqual(preset.headingLevels, [1, 2, 3, 4, 5, 6]);
  assert.equal(preset.restricted, true);
  for (const type of ['embed', 'math', 'columns', 'raw', 'gallery', 'toggle', 'myCustomBlock'])
    assert.equal(isBlockAllowed(preset, type), false, type);
});

test('simple: every advanced tool is off and field options cannot turn AI, grammar or live editing on', () => {
  const preset = resolveFieldPreset({ preset: 'simple', disableAi: false, disableGrammar: false });
  assert.equal(preset.ai, false);
  assert.equal(preset.grammar, false);
  assert.equal(preset.collaboration, false);
  for (const tool of ADVANCED_TOOLS) assert.equal(preset.tools[tool], false, tool);
});

test('simple: the toolbox offers one code block; stored plain code blocks stay valid', () => {
  const preset = resolveFieldPreset({ preset: 'simple' });
  assert.equal(isBlockOffered(preset, 'codeFlask'), true);
  assert.equal(isBlockOffered(preset, 'code'), false);
  assert.equal(isBlockAllowed(preset, 'code'), true);
  const violations = checkPreset(
    doc([
      { id: 'a', type: 'code', data: { code: 'x' } },
      { id: 'b', type: 'embed', data: { service: 'youtube', source: '', embed: '', caption: '' } },
    ]),
    preset
  );
  assert.deepEqual(
    violations.map((violation) => [violation.code, violation.blockId]),
    [['BLOCK_NOT_ALLOWED', 'b']]
  );
});

test('existing fields keep their preset: no stored option still resolves to full with every tool', () => {
  for (const options of [undefined, {}, { preset: '' }, { preset: 'unknown' }]) {
    const preset = resolveFieldPreset(options);
    assert.equal(preset.name, 'full');
    assert.equal(preset.simple, false);
    for (const tool of ADVANCED_TOOLS) assert.equal(preset.tools[tool], true, tool);
  }
  // A full field that turned AI off keeps that.
  assert.equal(resolveFieldPreset({ disableAi: true }).tools.ai, false);
});

test('standard: every block and tool except raw HTML; allowedBlocks replaces the list', () => {
  const preset = resolveFieldPreset({ preset: 'standard' });
  assert.equal(preset.blocks, null);
  assert.deepEqual(preset.excludedBlocks, ['raw']);
  assert.equal(preset.restricted, true);
  assert.equal(isBlockAllowed(preset, 'raw'), false);
  for (const type of ['embed', 'math', 'columns', 'gallery', 'myCustomBlock'])
    assert.equal(isBlockAllowed(preset, type), true, type);
  for (const tool of ADVANCED_TOOLS) assert.equal(preset.tools[tool], true, tool);
  const violations = checkPreset(doc([{ id: 'r', type: 'raw', data: { html: '<b>x</b>' } }]), preset);
  assert.deepEqual(
    violations.map((violation) => violation.code),
    ['BLOCK_NOT_ALLOWED']
  );
  const listed = resolveFieldPreset({ preset: 'standard', allowedBlocks: 'paragraph, raw' });
  assert.equal(isBlockAllowed(listed, 'raw'), true);
});

test('new fields get simple: the Content-Type Builder option preselects it, the admin constant matches', () => {
  assert.equal(NEW_FIELD_PRESET, 'simple');
  assert.ok(PRESET_NAMES.includes('simple') && PRESET_NAMES.includes('standard'));
  const admin = fs.readFileSync(new URL('../admin/src/index.js', import.meta.url), 'utf8');
  assert.match(admin, /export const NEW_FIELD_PRESET = 'simple';/);
  // The CTB reads `defaultValue` on the option item when a field is created (never when editing).
  const item = admin.slice(
    admin.indexOf("name: 'options.preset'"),
    admin.indexOf("name: 'options.linkTargets'")
  );
  assert.match(item, /defaultValue: NEW_FIELD_PRESET,/);
  // Simple is listed first, Standard second.
  const options = admin.slice(admin.indexOf('const PRESET_OPTIONS = ['), admin.indexOf('const LINK_OPTIONS'));
  assert.ok(options.indexOf("value: 'simple'") < options.indexOf("value: 'standard'"));
  assert.ok(options.indexOf("value: 'standard'") < options.indexOf("value: 'full'"));
});

test('preset JSON Schema and generated types leave raw HTML out of standard', () => {
  const schema = buildPresetSchema(resolveFieldPreset({ preset: 'standard' }));
  assert.deepEqual(schema.$defs.block.properties.type.not, { enum: ['raw'] });
  assert.equal(schema.$defs.data_raw, undefined);
  assert.deepEqual(schema['x-mex-preset'].excludedBlocks, ['raw']);
  const simple = buildPresetSchema(resolveFieldPreset({ preset: 'simple' }));
  assert.deepEqual(simple.$defs.block.properties.type.enum, resolveFieldPreset({ preset: 'simple' }).blocks);

  const field = (preset) => ({
    kind: 'collectionType',
    info: { singularName: 'article' },
    attributes: {
      body: { type: 'json', customField: 'plugin::magic-editor-x.richtext', options: { preset } },
    },
  });
  const standard = generateTypes({ contentTypes: { 'api::article.article': field('standard') } });
  const full = generateTypes({ contentTypes: { 'api::article.article': field('full') } });
  assert.match(full.code, /"raw"/);
  assert.doesNotMatch(standard.code, /"raw"/);
});

test('the "Need more?" entry links to the Content-Type Builder page of api:: content types only', () => {
  assert.equal(
    presetHintPath('api::article.article'),
    '/plugins/content-type-builder/content-types/api::article.article'
  );
  for (const uid of [null, '', 'plugin::users-permissions.user', 'api::a.b/../../x', 'api::A.b', 42])
    assert.equal(presetHintPath(uid), null, String(uid));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import {
  resolveFieldPreset,
  parseHeadingLevels,
  parseBlockList,
  checkPreset,
  checkBlockStructure,
  fixPresetViolations,
  allowedInlineTags,
  isBlockAllowed,
  nearestHeadingLevel,
} from '../shared/presets.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { applyEditorDataToDoc, createSeedUpdate } from '../shared/ydoc.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');

/**
 * Field presets (custom field options) are enforced by the same shared code in
 * the editor, the realtime server and the save middleware.
 */

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });

test('options resolve to presets; invalid values fall back to the defaults', () => {
  const full = resolveFieldPreset(undefined);
  assert.equal(full.name, 'full');
  assert.equal(full.blocks, null);
  assert.equal(full.restricted, false);
  assert.deepEqual(full.headingLevels, [1, 2, 3, 4, 5, 6]);
  assert.equal(full.ai, true);
  assert.equal(full.collaboration, true);

  const typo = resolveFieldPreset({ preset: 'nope', linkTargets: 'evil', maxBlocks: -3, headingLevels: 'x' });
  assert.equal(typo.name, 'full');
  assert.equal(typo.linkTargets, 'all');
  assert.equal(typo.maxBlocks, null);
  assert.equal(typo.restricted, false);

  const basic = resolveFieldPreset({
    preset: 'basic',
    maxCharacters: '500',
    requireAlt: true,
    disableAi: true,
  });
  assert.deepEqual(basic.blocks, ['paragraph', 'header', 'list', 'quote', 'image', 'delimiter']);
  assert.deepEqual(basic.headingLevels, [2, 3]);
  assert.equal(basic.maxCharacters, 500);
  assert.equal(basic.requireAlt, true);
  assert.equal(basic.ai, false);
  assert.equal(basic.restricted, true);

  const custom = resolveFieldPreset({ allowedBlocks: 'header, image ,myHero', headingLevels: '2-3,5' });
  assert.deepEqual(custom.blocks, ['paragraph', 'header', 'image', 'myHero']);
  assert.deepEqual(custom.headingLevels, [2, 3, 5]);
  assert.equal(isBlockAllowed(custom, 'myHero'), true);
  assert.equal(isBlockAllowed(custom, 'raw'), false);

  // No header block: no heading level is allowed.
  assert.deepEqual(resolveFieldPreset({ preset: 'minimal' }).headingLevels, []);
  // linkTargets none removes the link tool.
  assert.equal(resolveFieldPreset({ linkTargets: 'none' }).inline.includes('hyperlink'), false);
});

test('option parsers are strict and bounded', () => {
  assert.deepEqual(parseHeadingLevels('4-2'), [2, 3, 4]);
  assert.deepEqual(parseHeadingLevels(3), [3]);
  assert.equal(parseHeadingLevels('7,0,abc'), null);
  assert.equal(parseHeadingLevels(''), null);
  assert.deepEqual(parseBlockList('a;b c,,a'), ['a', 'b', 'c']);
  assert.equal(parseBlockList('<script>'), null);
  assert.equal(nearestHeadingLevel(1, [2, 3]), 2);
  assert.equal(nearestHeadingLevel(4, [3, 5]), 5);
  assert.equal(nearestHeadingLevel(4, []), null);
});

test('checkPreset reports block types, heading levels, links, alt texts and limits', () => {
  const preset = resolveFieldPreset({
    preset: 'basic',
    requireAlt: true,
    linkTargets: 'internal',
    maxBlocks: 4,
    maxCharacters: 10,
  });
  const data = doc([
    { id: 'a', type: 'paragraph', data: { text: 'Hello <a href="https://x.example.test">world</a>' } },
    { id: 'b', type: 'header', data: { text: 'Big', level: 1 } },
    { id: 'c', type: 'raw', data: { html: '<b>x</b>' } },
    { id: 'd', type: 'image', data: { file: { url: 'https://cdn.example.test/a.png', alt: ' ' } } },
    { id: 'e', type: 'image', data: { file: { url: 'https://cdn.example.test/b.png' }, decorative: true } },
    {
      id: 'f',
      type: 'paragraph',
      data: { text: '<a href="/a/1" data-mex-uid="api::a.a" data-mex-document-id="abc">ok</a>' },
    },
  ]);
  const codes = checkPreset(data, preset).map((v) => `${v.code}:${v.blockId}`);
  assert.deepEqual(codes, [
    'LINK_NOT_ALLOWED:a',
    'HEADING_LEVEL:b',
    'BLOCK_NOT_ALLOWED:c',
    'ALT_REQUIRED:d',
    'TOO_MANY_BLOCKS:null',
    'TOO_MANY_CHARACTERS:null',
  ]);
  // The full preset never reports anything.
  assert.deepEqual(checkPreset(data, resolveFieldPreset({})), []);
  // External-only fields refuse internal links and link blocks are external.
  const external = resolveFieldPreset({ linkTargets: 'external' });
  assert.equal(checkBlockStructure(external, data.blocks[5]).code, 'LINK_NOT_ALLOWED');
  assert.equal(checkBlockStructure(external, data.blocks[0]), null);
  const none = resolveFieldPreset({ linkTargets: 'none' });
  assert.equal(
    checkBlockStructure(none, { type: 'button', data: { text: 'Go', link: '/x' } }).code,
    'LINK_NOT_ALLOWED'
  );
});

test('fixPresetViolations repairs structure and keeps text', () => {
  const preset = resolveFieldPreset({ preset: 'basic', linkTargets: 'none' });
  const { data, fixed, removed } = fixPresetViolations(
    doc([
      { id: 'h', type: 'header', data: { text: 'Title', level: 1 } },
      { id: 'w', type: 'warning', data: { title: 'Careful', message: 'Hot' } },
      { id: 'r', type: 'raw', data: { html: '<b>x</b>' } },
      { id: 'l', type: 'paragraph', data: { text: 'See <a href="https://x.example.test">this</a>' } },
      { id: 'c', type: 'code', data: { code: '<x>\n1' } },
      { id: 'b', type: 'button', data: { text: 'Go', link: '/x' } },
    ]),
    preset
  );
  assert.equal(fixed, 6);
  assert.equal(removed, 2);
  assert.deepEqual(data.blocks, [
    { id: 'h', type: 'header', data: { text: 'Title', level: 2 } },
    { id: 'w', type: 'paragraph', data: { text: 'Careful<br>Hot' } },
    { id: 'l', type: 'paragraph', data: { text: 'See this' } },
    { id: 'c', type: 'paragraph', data: { text: '&lt;x&gt;<br>1' } },
  ]);
  assert.deepEqual(checkPreset(data, preset), []);
});

test('the server sanitiser unwraps inline formatting a preset leaves out', () => {
  const preset = resolveFieldPreset({ preset: 'minimal' });
  assert.deepEqual(allowedInlineTags(preset), ['a', 'b', 'br', 'em', 'i', 'strong']);
  const clean = cleanEditorValue(
    doc([
      {
        id: 'p',
        type: 'paragraph',
        data: {
          text: '<b>B</b> <mark class="cdx-marker">M</mark> <code class="inline-code">c</code> <a href="/x">l</a>',
        },
      },
    ]),
    { inlineTags: allowedInlineTags(preset) }
  );
  assert.equal(clean.blocks[0].data.text, '<b>B</b> M c <a href="/x">l</a>');
});

const SEED = createSeedUpdate(
  doc([
    { id: 'p1', type: 'paragraph', data: { text: 'hi' } },
    { id: 'old', type: 'raw', data: { html: 'legacy' } },
    { id: 'h1', type: 'header', data: { text: 'H', level: 2 } },
  ]),
  'e1'
);
const room = () => {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, SEED);
  return ydoc;
};
const updateFrom = (blocks) => {
  const client = room();
  const before = Y.encodeStateVector(client);
  applyEditorDataToDoc(client, doc(blocks));
  return Y.encodeStateAsUpdate(client, before);
};
const BASE = [
  { id: 'p1', type: 'paragraph', data: { text: 'hi' } },
  { id: 'old', type: 'raw', data: { html: 'legacy' } },
  { id: 'h1', type: 'header', data: { text: 'H', level: 2 } },
];

test('realtime updates: new disallowed blocks and heading levels are refused, old blocks stay editable', () => {
  const preset = resolveFieldPreset({ preset: 'basic' });
  const checkBlock = (block) => (checkBlockStructure(preset, block) ? 'PRESET_VIOLATION' : null);

  const newRaw = updateFrom([...BASE, { id: 'r2', type: 'raw', data: { html: 'x' } }]);
  assert.equal(applyCheckedUpdate(room(), newRaw, { checkBlock }).code, 'PRESET_VIOLATION');

  const level1 = updateFrom([BASE[0], BASE[1], { id: 'h1', type: 'header', data: { text: 'H', level: 1 } }]);
  assert.equal(applyCheckedUpdate(room(), level1, { checkBlock }).code, 'PRESET_VIOLATION');

  const editOld = updateFrom([BASE[0], { id: 'old', type: 'raw', data: { html: 'legacy edited' } }, BASE[2]]);
  assert.deepEqual(applyCheckedUpdate(room(), editOld, { checkBlock }), { ok: true, changed: true });

  const allowed = updateFrom([...BASE, { id: 'q', type: 'quote', data: { text: 'q' } }]);
  assert.deepEqual(applyCheckedUpdate(room(), allowed, { checkBlock }), { ok: true, changed: true });

  // Without a rule (full preset) the same update is fine.
  assert.equal(applyCheckedUpdate(room(), newRaw).ok, true);
});

test('the save middleware enforces presets for every writer, incl. components', async () => {
  const register = require('../server/src/register.js');
  const FIELD = 'plugin::magic-editor-x.richtext';
  const middlewares = [];
  const strapi = {
    customFields: { register: () => {} },
    config: { get: () => undefined },
    log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    components: {
      'shared.teaser': {
        uid: 'shared.teaser',
        attributes: { text: { type: 'json', customField: FIELD, options: { preset: 'minimal' } } },
      },
    },
    contentType: () => ({
      uid: 'api::post.post',
      attributes: {
        body: { type: 'json', customField: FIELD, options: { preset: 'basic', requireAlt: true } },
        free: { type: 'json', customField: FIELD },
        teasers: { type: 'component', repeatable: true, component: 'shared.teaser' },
      },
    }),
    documents: { use: (fn) => middlewares.push(fn) },
  };
  register({ strapi });
  const save = (data) =>
    middlewares[0]({ action: 'update', uid: 'api::post.post', params: { data } }, async () => 'saved');

  assert.equal(
    await save({
      body: doc([{ id: 'p', type: 'paragraph', data: { text: '<mark class="cdx-marker">x</mark>' } }]),
      free: doc([{ id: 'r', type: 'raw', data: { html: '<b>ok</b>' } }]),
    }),
    'saved'
  );

  await assert.rejects(
    save({
      body: doc([{ id: 'i', type: 'image', data: { file: { url: 'https://cdn.example.test/a.png' } } }]),
      teasers: [{ text: doc([{ id: 'h', type: 'header', data: { text: 'Secret words', level: 2 } }]) }],
    }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.equal(error.details.code, 'PRESET_VIOLATION');
      assert.deepEqual(
        error.details.violations.map((v) => [v.field, v.code, v.blockId]),
        [
          ['body', 'ALT_REQUIRED', 'i'],
          ['teasers.0.text', 'BLOCK_NOT_ALLOWED', 'h'],
        ]
      );
      assert.doesNotMatch(JSON.stringify(error.details), /Secret/);
      return true;
    }
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import * as Y from 'yjs';
import {
  COMPONENT_LIMITS,
  checkComponentBlocks,
  checkComponentValues,
  cleanValuesShape,
  currentValues,
  defaultValues,
  mergeComponentPatch,
  rebaseTextEdit,
  mergePendingValues,
  describeComponent,
  parseComponentList,
  setActiveComponents,
} from '../shared/components.mjs';
import { BLOCK_POLICIES, isBuiltInBlock, sanitizeEditorData } from '../shared/sanitize-policy.mjs';
import { checkPreset, fixPresetViolations, resolveFieldPreset } from '../shared/presets.mjs';
import { renderHtml, renderMarkdown, renderText, renderTree } from '../shared/render/index.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import { applyEditorDataToDoc, createSeedUpdate, docToEditorData } from '../shared/ydoc.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { collectSegments } from '../shared/ai-fields.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');
const {
  createComponentChecker,
  createComponentOutput,
  isComponentBlock,
} = require('../server/src/utils/component-blocks.js');

/** Synthetic Content-Type Builder component like the acceptance host's `blocks.cta`. */
const CTA = {
  collectionName: 'components_blocks_ctas',
  info: { displayName: 'Call to action', icon: 'cursor' },
  attributes: {
    id: { type: 'increments' },
    title: { type: 'string', required: true, maxLength: 80 },
    text: { type: 'text', maxLength: 400 },
    url: { type: 'string', required: true, regex: '^(https?://|/)[^\\s]*$' },
    style: { type: 'enumeration', enum: ['primary', 'secondary', 'ghost'], default: 'primary' },
    highlight: { type: 'boolean', default: false },
    priority: { type: 'integer', min: 1, max: 5 },
  },
};
const ALL_SCALARS = {
  info: { displayName: 'Every scalar' },
  attributes: {
    s: { type: 'string' },
    t: { type: 'text' },
    r: { type: 'richtext' },
    e: { type: 'email' },
    n: { type: 'enumeration', enum: ['a', 'b'] },
    d: { type: 'date' },
    dt: { type: 'datetime' },
    tm: { type: 'time' },
    i: { type: 'integer' },
    bi: { type: 'biginteger', min: '-5', max: '9007199254740993' },
    f: { type: 'float', min: 0.5 },
    dc: { type: 'decimal', max: 10 },
    b: { type: 'boolean' },
  },
};
const MEDIA = {
  info: { displayName: 'Media card' },
  attributes: { label: { type: 'string' }, image: { type: 'media' } },
};
const SECRET = { info: { displayName: 'Secret' }, attributes: { note: { type: 'string', private: true } } };
const COMPONENTS = {
  'blocks.cta': CTA,
  'blocks.all': ALL_SCALARS,
  'blocks.media-card': MEDIA,
  'blocks.secret': SECRET,
};
const cta = describeComponent('blocks.cta', CTA);
const fakeStrapi = (components = COMPONENTS) => ({ components });

const block = (id, uid, values) => ({ id, type: 'component', data: { uid, values, _mex: 1 } });
const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });

test('field option: comma list of valid uids, unique, bounded', () => {
  assert.deepEqual(parseComponentList('blocks.cta, blocks.hero;blocks.cta  nope x.y.z'), [
    'blocks.cta',
    'blocks.hero',
  ]);
  assert.deepEqual(parseComponentList(''), []);
  assert.deepEqual(parseComponentList(['blocks.cta']), []);
  const many = Array.from({ length: 80 }, (_, i) => `c.n${i}`).join(',');
  assert.equal(parseComponentList(many).length, COMPONENT_LIMITS.components);
  assert.deepEqual(resolveFieldPreset({}).components, []);
  assert.deepEqual(resolveFieldPreset({ allowedComponents: 'blocks.cta' }).components, ['blocks.cta']);
  // Listing components does not make a field "restricted".
  assert.equal(resolveFieldPreset({ allowedComponents: 'blocks.cta' }).restricted, false);
});

test('describeComponent: scalar attributes with rules; hidden skipped; others make it unsupported', () => {
  assert.equal(cta.supported, true);
  assert.equal(cta.displayName, 'Call to action');
  assert.equal(cta.icon, 'cursor');
  assert.deepEqual(
    cta.fields.map((field) => field.name),
    ['title', 'text', 'url', 'style', 'highlight', 'priority']
  );
  assert.deepEqual(cta.fields[0], { name: 'title', type: 'string', required: true, maxLength: 80 });
  assert.deepEqual(cta.fields[3].enum, ['primary', 'secondary', 'ghost']);
  assert.equal(describeComponent('blocks.all', ALL_SCALARS).supported, true);
  const media = describeComponent('blocks.media-card', MEDIA);
  assert.equal(media.supported, false);
  assert.deepEqual(media.unsupported, [{ name: 'image', type: 'media', reason: 'type' }]);
  assert.deepEqual(describeComponent('blocks.secret', SECRET).unsupported[0].reason, 'private');
  // Strapi's own private rule (api.responses.privateAttributes) is honoured on the server.
  const viaRule = describeComponent('blocks.cta', CTA, { isPrivate: (name) => name === 'text' });
  assert.equal(viaRule.supported, false);
  for (const type of [
    'relation',
    'component',
    'dynamiczone',
    'json',
    'password',
    'uid',
    'blocks',
    'customField',
  ])
    assert.equal(
      describeComponent('a.b', { attributes: { x: { type } } }).supported,
      false,
      `${type} is not supported`
    );
  assert.equal(
    describeComponent('a.b', { attributes: { x: { type: 'enumeration', enum: [] } } }).supported,
    false
  );
  assert.equal(describeComponent('a.b', { attributes: {} }).supported, false, 'no fields');
  assert.equal(describeComponent('a.b', { attributes: { __proto__x: { type: 'string' } } }).supported, true);
  assert.equal(describeComponent('nope', CTA), null);
  assert.equal(describeComponent('a.b', null), null);
  const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, { type: 'string' }]));
  assert.equal(describeComponent('a.b', { attributes: many }).supported, false);
  // A broken pattern is ignored like Strapi does not apply it.
  assert.equal(
    describeComponent('a.b', { attributes: { x: { type: 'string', regex: '(' } } }).fields[0].regex,
    undefined
  );
  assert.deepEqual(defaultValues(cta), { style: 'primary', highlight: false });
});

test('checkComponentValues: unknown attributes dropped, values coerced, every rule checked', () => {
  const ok = checkComponentValues(cta, {
    title: 'Go',
    url: '/start',
    priority: '3',
    highlight: 'true',
    style: 'ghost',
    extra: 'x',
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.values, { title: 'Go', url: '/start', style: 'ghost', highlight: true, priority: 3 });
  assert.equal(ok.dropped, 1);
  const rules = (values) => checkComponentValues(cta, values).errors.map((e) => `${e.field}:${e.rule}`);
  assert.deepEqual(rules({}), ['title:required', 'url:required']);
  assert.deepEqual(rules({ title: 'x'.repeat(81), url: 'ftp://x' }), ['title:maxLength', 'url:regex']);
  assert.deepEqual(rules({ title: 'a', url: '/', style: 'pink', priority: 9, highlight: 'yes' }), [
    'style:enum',
    'highlight:type',
    'priority:max',
  ]);
  assert.deepEqual(rules({ title: 'a', url: '/', priority: 1.5 }), ['priority:type']);
  assert.deepEqual(rules({ title: { a: 1 }, url: ['x'] }), ['title:type', 'url:type']);
  const all = describeComponent('blocks.all', ALL_SCALARS);
  const good = checkComponentValues(all, {
    s: 7,
    t: 'line\nline',
    r: '# md',
    e: 'a@example.test',
    n: 'b',
    d: '2026-02-28',
    dt: '2026-11-12T10:00:00+01:00',
    tm: '09:30',
    i: -2147483648,
    bi: '9007199254740993',
    f: 0.5,
    dc: '9.99',
    b: false,
  });
  assert.deepEqual(good.errors, []);
  assert.equal(good.values.s, '7');
  assert.equal(good.values.dt, '2026-11-12T09:00:00.000Z');
  assert.equal(good.values.tm, '09:30:00.000');
  assert.equal(good.values.bi, '9007199254740993');
  assert.equal(good.values.dc, 9.99);
  const bad = checkComponentValues(all, {
    e: 'not an address',
    d: '2026-02-30',
    dt: 'yesterday',
    tm: '25:00',
    i: 2147483648,
    bi: '9007199254740994',
    f: 0.1,
    dc: 11,
    t: 'x'.repeat(COMPONENT_LIMITS.text + 1),
    s: 'x'.repeat(COMPONENT_LIMITS.string + 1),
  }).errors.map((e) => `${e.field}:${e.rule}`);
  assert.deepEqual(bad.sort(), [
    'bi:max',
    'd:date',
    'dc:max',
    'dt:datetime',
    'e:email',
    'f:min',
    'i:type',
    's:maxLength',
    't:maxLength',
    'tm:time',
  ]);
  assert.deepEqual(currentValues(cta, { title: 'a', gone: 'b', url: 3 }), { title: 'a', url: 3 });
});

test('stored shape: policy keeps uid and plain scalar values, never HTML handling or prototype keys', () => {
  const clean = BLOCK_POLICIES.component(
    {
      uid: 'blocks.cta',
      values: { title: '<b>x</b> & y', n: 1, ok: true, bad: { a: 1 }, nan: NaN, nul: null, 'a-b': 'x' },
    },
    () => 'never'
  );
  assert.deepEqual(clean, { uid: 'blocks.cta', values: { title: '<b>x</b> & y', n: 1, ok: true }, _mex: 1 });
  assert.equal(BLOCK_POLICIES.component({ uid: 'javascript:alert(1)' }).uid, '');
  assert.deepEqual(cleanValuesShape(JSON.parse('{"__proto__":"x","constructor":"y","a":"z"}')), { a: 'z' });
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v']));
  assert.equal(Object.keys(cleanValuesShape(many)).length, COMPONENT_LIMITS.attributes);
  // Server sanitiser: plain text stays plain text (no inline HTML policy on values).
  const stored = cleanEditorValue(doc(block('c1', 'blocks.cta', { title: 'a < b & <i>c</i>' })), {});
  assert.equal(stored.blocks[0].data.values.title, 'a < b & <i>c</i>');
});

test('a Settings custom block named `component` from before 2.5 keeps its data', () => {
  const legacy = {
    id: 'l1',
    type: 'component',
    data: { content: '<b>x</b>', blockType: 'simple', blockName: 'component' },
  };
  assert.equal(isBuiltInBlock(legacy), false);
  assert.equal(isComponentBlock(legacy), false);
  const out = sanitizeEditorData(doc(legacy), { sanitizeInlineHtml: (s) => s, sanitizeRawHtml: (s) => s });
  assert.equal(out.blocks[0].data.blockName, 'component');
  // The preset rule for component blocks never touches it; a full field keeps allowing it.
  assert.deepEqual(checkPreset(doc(legacy), resolveFieldPreset({ preset: 'full' })), []);
  // The exact built-in shape without the marker counts as a component block.
  assert.equal(isBuiltInBlock({ type: 'component', data: { uid: 'blocks.cta', values: {} } }), true);
});

test('presets: a component block needs its uid in allowedComponents; the fixer removes it', () => {
  const value = doc(block('c1', 'blocks.cta', { title: 'a' }), {
    id: 'p1',
    type: 'paragraph',
    data: { text: 'x' },
  });
  const basic = resolveFieldPreset({ preset: 'basic' });
  assert.deepEqual(
    checkPreset(value, basic).map((v) => v.code),
    ['COMPONENT_NOT_ALLOWED']
  );
  const allowed = resolveFieldPreset({ preset: 'basic', allowedComponents: 'blocks.cta' });
  assert.deepEqual(checkPreset(value, allowed), []);
  const fixed = fixPresetViolations(value, basic);
  assert.deepEqual(
    fixed.data.blocks.map((b) => b.id),
    ['p1']
  );
  assert.equal(fixed.removed, 1);
});

test('server save check: allowed list, current schema, coercion, unknown attributes, removed components', () => {
  const check = createComponentChecker(fakeStrapi());
  const preset = resolveFieldPreset({ allowedComponents: 'blocks.cta, blocks.media-card, blocks.gone' });
  const valid = check(
    doc(block('c1', 'blocks.cta', { title: 'Go', url: '/x', priority: '2', extra: 'drop' })),
    preset
  );
  assert.deepEqual(valid.violations, []);
  assert.deepEqual(valid.data.blocks[0].data.values, { title: 'Go', url: '/x', priority: 2 });
  const invalid = check(doc(block('c1', 'blocks.cta', { title: '', url: 'nope' })), preset);
  assert.deepEqual(
    invalid.violations.map((v) => [v.code, v.params.field, v.params.rule]),
    [
      ['COMPONENT_INVALID', 'title', 'required'],
      ['COMPONENT_INVALID', 'url', 'regex'],
    ]
  );
  // Violations carry ids and rule names, never values.
  assert.ok(!JSON.stringify(invalid.violations).includes('nope'));
  assert.deepEqual(
    check(doc(block('c1', 'blocks.hero', {})), preset).violations.map((v) => v.code),
    ['COMPONENT_NOT_ALLOWED']
  );
  assert.deepEqual(
    check(doc(block('c1', 'blocks.media-card', { label: 'x' })), preset).violations.map((v) => v.code),
    ['COMPONENT_UNSUPPORTED']
  );
  // A listed component that no longer exists: the stored values are kept as they are.
  const gone = check(doc(block('c1', 'blocks.gone', { a: 'kept' })), preset);
  assert.deepEqual(gone.violations, []);
  assert.deepEqual(gone.data.blocks[0].data.values, { a: 'kept' });
  // Restricted fields report COMPONENT_NOT_ALLOWED through checkPreset only (no duplicate).
  const restricted = resolveFieldPreset({ preset: 'basic' });
  assert.deepEqual(
    check(doc(block('c1', 'blocks.cta', { title: 'a', url: '/' })), restricted).violations,
    []
  );
  // Same object back when there is no component block.
  const plain = doc({ id: 'p', type: 'paragraph', data: { text: 'x' } });
  assert.equal(check(plain, preset).data, plain);
  // Pure core: unknown uid in lookup + allowed.
  const core = checkComponentBlocks(doc(block('c1', '', {})), ['blocks.cta'], () => null, isComponentBlock);
  assert.equal(core.violations[0].code, 'COMPONENT_NOT_ALLOWED');
});

test('API output: removed or unsupported components disappear, removed attributes are dropped, toggles stay intact', () => {
  const output = createComponentOutput(fakeStrapi());
  const value = doc(
    { id: 't', type: 'toggle', data: { text: 'T', status: 'open', items: 2 } },
    block('a', 'blocks.gone', { x: 'secret' }),
    block('b', 'blocks.cta', { title: 'Go', url: '/', removed: 'old' }),
    block('c', 'blocks.media-card', { label: 'x' }),
    { id: 'p', type: 'paragraph', data: { text: 'after' } }
  );
  const out = output(value);
  assert.deepEqual(
    out.blocks.map((b) => b.id),
    ['t', 'b', 'p']
  );
  assert.equal(out.blocks[0].data.items, 1);
  assert.equal(value.blocks[0].data.items, 2, 'input not mutated');
  assert.deepEqual(out.blocks[1].data.values, { title: 'Go', url: '/' });
  const untouched = doc({ id: 'p', type: 'paragraph', data: { text: 'x' } });
  assert.equal(output(untouched), untouched);
  assert.equal(output(null), null);
});

test('renderers: nothing by default; componentBlocks renders in HTML, tree, React and Vue alike', async () => {
  const value = doc(
    { id: 'p', type: 'paragraph', data: { text: 'Hi' } },
    block('c', 'blocks.cta', { title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }),
    { id: 'q', type: 'paragraph', data: { text: 'Bye' } }
  );
  const plain = '<p class="mex-paragraph">Hi</p>\n<p class="mex-paragraph">Bye</p>';
  assert.equal(renderHtml(value), plain);
  assert.equal(renderText(value), 'Hi\n\nBye');
  assert.equal(renderMarkdown(value), 'Hi\n\nBye');
  assert.equal(renderHtml(doc(block('c', 'blocks.cta', { title: 'x' }))), '');
  const options = {
    componentBlocks: {
      'blocks.cta': (b, helpers) =>
        helpers.h('a', { class: 'cta', href: b.data.values.url }, [helpers.textNode(b.data.values.title)]),
    },
  };
  const html = renderHtml(value, options);
  assert.equal(
    html,
    '<p class="mex-paragraph">Hi</p>\n<a class="cta">&lt;img src=x onerror=alert(1)&gt;</a>\n<p class="mex-paragraph">Bye</p>'
  );
  const react = ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, { value, options }));
  assert.equal(react, html);
  const vue = await renderToString(createSSRApp({ render: () => h(VueContent, { value, options }) }));
  assert.equal(vue.replace(/<!--[[\]]-->/g, ''), html);
  assert.equal(renderTree(value, options).filter((n) => n.type === 'element').length, 3);
  // Another uid in the map, or a non-function entry: default (nothing).
  assert.equal(
    renderHtml(value, { componentBlocks: { 'blocks.other': () => null, 'blocks.cta': 'x' } }),
    plain
  );
  // overrides.component wins over the map.
  assert.equal(
    renderHtml(value, { ...options, overrides: { component: (b, helpers) => helpers.h('hr', {}) } }),
    '<p class="mex-paragraph">Hi</p>\n<hr>\n<p class="mex-paragraph">Bye</p>'
  );
  // React `components.component` and the Vue `block-component` slot receive the block.
  const reactComponents = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ReactContent, {
      value,
      components: { component: ({ block: b }) => React.createElement('aside', null, b.data.uid) },
    })
  );
  assert.equal(
    reactComponents,
    // An empty component block has no separator of its own (whitespace between blocks only).
    '<p class="mex-paragraph">Hi</p><aside>blocks.cta</aside>\n<p class="mex-paragraph">Bye</p>'
  );
  const vueSlot = await renderToString(
    createSSRApp({
      render: () =>
        h(VueContent, { value }, { 'block-component': ({ block: b }) => h('aside', null, b.data.uid) }),
    })
  );
  assert.equal(vueSlot.replace(/<!--[[\]]-->/g, ''), reactComponents);
  // Text and Markdown: `overrides.component` returns the text.
  assert.equal(
    renderText(value, { overrides: { component: (b) => b.data.values.title.length.toString() } }),
    'Hi\n\n28\n\nBye'
  );
});

test('collaboration: component blocks map to Yjs, concurrent edits of different attributes merge', () => {
  const start = doc(block('c1', 'blocks.cta', { title: 'Start', text: 'Line', url: '/a' }));
  const seed = createSeedUpdate(start, 'e1');
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, seed);
  Y.applyUpdate(b, seed);
  assert.deepEqual(docToEditorData(a).blocks[0].data, {
    uid: 'blocks.cta',
    values: { title: 'Start', text: 'Line', url: '/a' },
    _mex: 1,
  });
  applyEditorDataToDoc(a, doc(block('c1', 'blocks.cta', { title: 'Start now', text: 'Line', url: '/a' })));
  applyEditorDataToDoc(
    b,
    doc(block('c1', 'blocks.cta', { title: 'Start', text: 'Line two', url: '/a', highlight: true }))
  );
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const merged = docToEditorData(a).blocks[0].data.values;
  assert.deepEqual(merged, { title: 'Start now', text: 'Line two', url: '/a', highlight: true });
  assert.deepEqual(docToEditorData(b).blocks[0].data.values, merged);
});

test('live guard: component shape refused when wrong; uid changes are structural (preset rule)', () => {
  const seed = createSeedUpdate(doc(block('c1', 'blocks.cta', { title: 'a' })), 'e1');
  const room = () => {
    const d = new Y.Doc();
    Y.applyUpdate(d, seed);
    return d;
  };
  const updateFrom = (data) => {
    const client = new Y.Doc();
    Y.applyUpdate(client, seed);
    const before = Y.encodeStateVector(client);
    applyEditorDataToDoc(client, data);
    return Y.encodeStateAsUpdate(client, before);
  };
  const ok = updateFrom(doc(block('c1', 'blocks.cta', { title: 'ab', n: 2 })));
  assert.equal(applyCheckedUpdate(room(), ok).ok, true);
  for (const values of [
    { title: { nested: 1 } },
    { 'bad-key': 'x' },
    { t: 'x'.repeat(COMPONENT_LIMITS.text + 1) },
  ])
    assert.equal(applyCheckedUpdate(room(), updateFrom(doc(block('c1', 'blocks.cta', values)))).ok, false);
  const preset = resolveFieldPreset({ allowedComponents: 'blocks.cta' });
  const rule = (b) => (checkPreset({ blocks: [b] }, preset).length ? 'PRESET_VIOLATION' : null);
  // Typing in an attribute is not structural; switching the uid is and must be allowed by the field.
  assert.equal(applyCheckedUpdate(room(), ok, { checkBlock: rule }).ok, true);
  const switched = updateFrom(doc(block('c1', 'blocks.other', { title: 'a' })));
  const result = applyCheckedUpdate(room(), switched, { checkBlock: rule });
  assert.equal(result.ok, false);
});

test('find and replace (text attributes of known components only), diff kinds, no AI segments', () => {
  const value = doc(block('c1', 'blocks.cta', { title: 'Start here', url: '/start', style: 'primary' }));
  setActiveComponents([]);
  assert.equal(findMatches(value, 'start').matches.length, 0, 'unknown component: nothing searchable');
  setActiveComponents([cta]);
  try {
    // title and url are string attributes; style (enumeration) is not text.
    assert.equal(findMatches(value, 'start').matches.length, 2);
    assert.equal(findMatches(value, 'primary').matches.length, 0);
    const replaced = replaceMatches(value, 'Start', 'Begin', { matchCase: true });
    assert.equal(replaced.data.blocks[0].data.values.title, 'Begin here');
  } finally {
    setActiveComponents([]);
  }
  const fields = diffDocuments(
    value,
    doc(block('c1', 'blocks.cta', { title: 'Start there', url: '/start', style: 'ghost', n: 1 }))
  );
  const changed = fields.blocks ? fields.blocks : fields;
  const flat = JSON.stringify(changed);
  assert.ok(flat.includes('values.title'), 'title diffed');
  assert.ok(flat.includes('"kind":"text"'), 'text diff for attribute values');
  assert.deepEqual(collectSegments(value), []);
});

test('regression: a form edit is merged into the block values, never replaces them (live data loss)', () => {
  // Collaborator A typed into `title`; the change reached B's block before B's form re-rendered.
  const blockValues = { title: 'Tabcdefgh', text: 'X', url: '/a' };
  // B types into `text` from a stale render (title still 'T'): only the edited attribute is sent.
  assert.deepEqual(mergeComponentPatch(blockValues, { text: 'Xi' }), {
    title: 'Tabcdefgh',
    text: 'Xi',
    url: '/a',
  });
  assert.deepEqual(mergeComponentPatch(blockValues, { url: undefined }), { title: 'Tabcdefgh', text: 'X' });
  assert.deepEqual(mergeComponentPatch(blockValues, { priority: 3, bad: { a: 1 } }).priority, 3);
  assert.equal(mergeComponentPatch(blockValues, { bad: { a: 1 } }).bad, undefined);
  // Through Yjs: the merged write keeps A's title; a whole stale write would have deleted it.
  const seed = createSeedUpdate(doc(block('c1', 'blocks.cta', { title: 'T', text: 'X', url: '/a' })), 'e1');
  const b = new Y.Doc();
  Y.applyUpdate(b, seed);
  applyEditorDataToDoc(b, doc(block('c1', 'blocks.cta', blockValues)));
  applyEditorDataToDoc(b, doc(block('c1', 'blocks.cta', mergeComponentPatch(blockValues, { text: 'Xi' }))));
  assert.equal(docToEditorData(b).blocks[0].data.values.title, 'Tabcdefgh');
  // The old behaviour, for the record: the stale whole values remove A's edit.
  const stale = new Y.Doc();
  Y.applyUpdate(stale, seed);
  applyEditorDataToDoc(stale, doc(block('c1', 'blocks.cta', blockValues)));
  applyEditorDataToDoc(stale, doc(block('c1', 'blocks.cta', { title: 'T', text: 'Xi', url: '/a' })));
  assert.equal(docToEditorData(stale).blocks[0].data.values.title, 'T');
});

test('regression: a keystroke on stale text is replayed on the latest text (same attribute)', () => {
  // The input showed 'T'; A's 'abc' already arrived; B typed 'i' at the end.
  assert.equal(rebaseTextEdit('T', 'Ti', 'Tabc'), 'Tabci');
  // B typed at the start, A appended.
  assert.equal(rebaseTextEdit('Title', 'XTitle', 'Title now'), 'XTitle now');
  // B deleted a character that still exists.
  assert.equal(rebaseTextEdit('Tab', 'Ta', 'Tabcd'), 'Tacd');
  assert.equal(rebaseTextEdit('same', 'same!', 'same'), 'same!');
  // A collaborator replaced the text: the local insertion is replayed where its context still matches.
  assert.equal(rebaseTextEdit('abc', 'abcd', 'zzz'), 'zzzd');
  // 2.6: a deleted range that no longer exists is already gone: the collaborator's text stays.
  assert.equal(rebaseTextEdit('abcd', 'ad', 'zzz'), 'zzz');
  // 2.6: a replacement whose range is gone keeps both texts (the insertion goes where it was).
  assert.equal(rebaseTextEdit('abcd', 'aXd', 'zzz'), 'zXzz');
  // 2.6: an insertion is never dropped, even when its context changed on both sides.
  assert.equal(rebaseTextEdit('abc', 'aQbc', 'xyz'), 'xQyz');
});

test('2.6 regression: edits not yet in the room survive a collaborator snapshot (mergePendingValues)', () => {
  // The room had { title: 'T', text: 'X' }; locally 'T' became 'Ti' after the last push;
  // the snapshot brings A's 'Tabc' and a new url.
  const synced = { title: 'T', text: 'X' };
  const local = { title: 'Ti', text: 'X' };
  const remote = { title: 'Tabc', text: 'X', url: '/a' };
  const merged = mergePendingValues(synced, local, remote);
  assert.deepEqual(merged.values, { title: 'Tabci', text: 'X', url: '/a' });
  assert.deepEqual(Object.keys(merged.pending), ['title']);
  // Nothing pending: the snapshot wins as it is (also removed keys).
  assert.deepEqual(mergePendingValues({ a: 'x', b: 'y' }, { a: 'x', b: 'y' }, { a: 'z' }), {
    values: { a: 'z' },
    pending: {},
  });
  // A local removal of a key is pending, a scalar change wins over the snapshot.
  const scalars = mergePendingValues(
    { n: 1, on: true, s: 'a' },
    { n: 2, s: 'a' },
    { n: 1, on: true, s: 'ab' }
  );
  assert.deepEqual(scalars.values, { n: 2, s: 'ab' });
  assert.deepEqual(Object.keys(scalars.pending).sort(), ['n', 'on']);
  // Hostile shapes are cleaned.
  assert.deepEqual(mergePendingValues(null, { __proto__: { x: 1 } }, 'nope').values, {});
});

test('2.6 regression: a keystroke typed while a snapshot is applied reaches the room (replica)', async () => {
  const { createReplica } = await import('../shared/collab-replica.mjs');
  const comp = (values) => ({
    blocks: [{ id: 'c1', type: 'component', data: { uid: 'blocks.cta', values, _mex: 1 } }],
  });
  const run = (useRoomView) => {
    const server = new Y.Doc();
    Y.applyUpdate(server, createSeedUpdate(comp({ title: 'T', text: 'X' }), 'e1'));
    const make = () => {
      const outbox = [];
      const replica = createReplica({ onLocalUpdate: (u) => outbox.push(u), captureTimeout: 0 });
      replica.applyRemote(Y.encodeStateAsUpdate(server));
      const { data, catchUp } = replica.snapshot();
      replica.markShown(catchUp, data);
      return {
        replica,
        flush: () => outbox.splice(0).forEach((u) => Y.applyUpdate(server, u)),
        pull: () => replica.applyRemote(Y.encodeStateAsUpdate(server)),
      };
    };
    const a = make();
    const b = make();
    // A edits the text; the room has it.
    a.replica.pushLocal(comp({ title: 'T', text: 'Xyz' }));
    a.flush();
    // B pushed nothing yet; its room state ("synced") is the seed. B's flush is done, the snapshot
    // arrives, and B types "i" into the title while the snapshot is applied.
    const synced = { title: 'T', text: 'X' };
    b.pull();
    const { data, catchUp } = b.replica.snapshot();
    const remote = data.blocks[0].data.values;
    const local = { title: 'Ti', text: 'X' };
    const merged = mergePendingValues(synced, local, remote).values;
    // What B's editor shows now, and what it records as the base of its next diff.
    const shown = comp(merged);
    b.replica.markShown(catchUp, useRoomView ? comp(remote) : shown);
    b.replica.pushLocal(comp(merged));
    b.flush();
    return docToEditorData(server).blocks[0].data.values;
  };
  // 2.5 behaviour: the editor's own serialisation was the base, so "i" never reached the room.
  assert.deepEqual(run(false), { title: 'T', text: 'Xyz' });
  // 2.6: the room's values are the base, so both edits are in the room.
  assert.deepEqual(run(true), { title: 'Ti', text: 'Xyz' });
});

test('2.6 review: removing a key that turns custom data into a built-in component is structural (field rule runs)', () => {
  const preset = resolveFieldPreset({ allowedComponents: 'blocks.cta' });
  const rule = (b) => (checkPreset({ blocks: [b] }, preset).length ? 'PRESET_VIOLATION' : null);
  // The room has a block of type `component` with an extra key: custom data, not a built-in component.
  const custom = { id: 'c1', type: 'component', data: { uid: 'blocks.forbidden', values: {}, extra: 'x' } };
  const room = new Y.Doc();
  Y.applyUpdate(room, createSeedUpdate(doc(custom), 'e1'));
  assert.equal(
    isBuiltInBlock(docToEditorData(room).blocks[0]),
    false,
    'custom data while the extra key exists'
  );
  // A collaborator deletes only the extra key: the block becomes a built-in component with a disallowed uid.
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(room));
  const before = Y.encodeStateVector(client);
  client.getMap('blocks').get('c1').get('data').delete('extra');
  const update = Y.encodeStateAsUpdate(client, before);
  const result = applyCheckedUpdate(room, update, { checkBlock: rule });
  assert.equal(result.ok, false, 'refused like inserting the disallowed component');
  // Changing a value of an allowed component stays possible (not structural).
  const okRoom = new Y.Doc();
  Y.applyUpdate(okRoom, createSeedUpdate(doc(block('c2', 'blocks.cta', { title: 'a' })), 'e1'));
  const okClient = new Y.Doc();
  Y.applyUpdate(okClient, Y.encodeStateAsUpdate(okRoom));
  const sv = Y.encodeStateVector(okClient);
  applyEditorDataToDoc(okClient, doc(block('c2', 'blocks.cta', { title: 'ab' })));
  assert.equal(
    applyCheckedUpdate(okRoom, Y.encodeStateAsUpdate(okClient, sv), { checkBlock: rule }).ok,
    true
  );
});

test('2.6 review: unmarked `component` data from imports is detected for the one-time save hint', () => {
  const { hasUnmarkedComponentBlock } = require('../server/src/register.js');
  const raw = (data) => ({ blocks: [{ id: 'x', type: 'component', data }] });
  assert.equal(hasUnmarkedComponentBlock(raw({ uid: 'blocks.cta' })), true);
  assert.equal(hasUnmarkedComponentBlock(raw({ uid: 'blocks.cta', values: {} })), true);
  assert.equal(hasUnmarkedComponentBlock(JSON.stringify(raw({ uid: 'blocks.cta', values: {} }))), true);
  assert.equal(hasUnmarkedComponentBlock(raw({ uid: 'blocks.cta', values: {}, _mex: 1 })), false, 'marked');
  assert.equal(hasUnmarkedComponentBlock(raw({ uid: 'blocks.cta', other: 1 })), false, 'custom data');
  assert.equal(hasUnmarkedComponentBlock(null), false);
});

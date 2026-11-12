import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import {
  BLOCK_POLICIES,
  BUILT_IN_MARKER,
  MARKED_BLOCKS,
  isBuiltInBlock,
  sanitizeEditorData,
} from '../shared/sanitize-policy.mjs';
import { computeStats } from '../shared/editor-data.mjs';
import { buildEditorSchema, BLOCK_DATA_SCHEMAS } from '../shared/schema.mjs';
import { renderHtml, renderText, renderMarkdown, renderTree } from '../shared/render/index.mjs';
import { lintDocument } from '../shared/quality.mjs';
import { collectReferences, applyReferences, renderResolved } from '../shared/resolve-references.mjs';
import { findMatches } from '../shared/find-replace.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { imageHasAlt } from '../shared/presets.mjs';
import { isSyncedBlock, syncedRefsOf } from '../shared/synced.mjs';
import { createSeedUpdate, applyEditorDataToDoc } from '../shared/ydoc.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { validateBlock, emptyValues } from '../admin/src/pages/CustomBlocksPage/blockForm.mjs';
import { validate } from './helpers/json-schema.mjs';
import { LEGACY_BLOCKS, legacyDocument } from './fixtures/reserved-names-doc.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');
const customBlocks = require('../server/src/services/custom-blocks.js');

/** Output of magic-editor-x 2.2.0 for `legacyDocument()` (see `generatedBy`). */
const V22 = JSON.parse(readFileSync(new URL('./fixtures/reserved-names-2.2.json', import.meta.url), 'utf8'));
const NEW_NAMES = ['toc', 'gallery', 'video', 'audio', 'synced', 'math'];
const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });

test('every 2.3/2.4 block name that a custom block could have is a marked block type', () => {
  assert.deepEqual(Object.keys(MARKED_BLOCKS).sort(), [...NEW_NAMES].sort());
  for (const type of NEW_NAMES) {
    // The shape keys are the schema keys without the marker, and the policy always writes the marker.
    const schemaKeys = Object.keys(BLOCK_DATA_SCHEMAS[type].properties).filter((key) => key !== '_mex');
    assert.deepEqual([...MARKED_BLOCKS[type].keys].sort(), schemaKeys.sort(), type);
    assert.equal(BLOCK_POLICIES[type]({}, (s) => s, { rawHtml: 'sanitize' })[BUILT_IN_MARKER], 1, type);
  }
  assert.ok(LEGACY_BLOCKS.every((block) => NEW_NAMES.includes(block.type)));
});

test('legacy custom block data is never built-in; marked or exactly shaped data is', () => {
  for (const block of LEGACY_BLOCKS) assert.equal(isBuiltInBlock(block), false, block.id);
  const marked = (type, data) => ({ type, data: { ...data, _mex: 1 } });
  assert.equal(isBuiltInBlock(marked('toc', { title: 'x', extra: 1 })), true, 'marker wins');
  assert.equal(isBuiltInBlock({ type: 'toc', data: { title: 'x', _mex: 2 } }), true, 'later marker version');
  assert.equal(isBuiltInBlock({ type: 'toc', data: { title: 'x', _mex: 0 } }), false);
  assert.equal(isBuiltInBlock({ type: 'toc', data: { title: 'x', _mex: '1' } }), false);
  // Exact shape without the marker (2.3 data written before the marker, API input).
  assert.equal(isBuiltInBlock({ type: 'toc', data: {} }), true);
  assert.equal(isBuiltInBlock({ type: 'toc', data: { title: 'T', minLevel: 2 } }), true);
  assert.equal(isBuiltInBlock({ type: 'toc', data: { title: 'T', blockType: 'simple' } }), false);
  assert.equal(isBuiltInBlock({ type: 'gallery', data: { images: [] } }), true);
  assert.equal(isBuiltInBlock({ type: 'gallery', data: { images: 'Hero' } }), false, 'anchor type');
  assert.equal(isBuiltInBlock({ type: 'gallery', data: {} }), false, 'anchor missing');
  assert.equal(isBuiltInBlock({ type: 'video', data: { file: { url: '/v.mp4' }, title: 'V' } }), true);
  assert.equal(isBuiltInBlock({ type: 'video', data: { file: 'https://cdn.example.test/v.mp4' } }), false);
  assert.equal(isBuiltInBlock({ type: 'audio', data: { file: { url: '/a.mp3' }, muted: true } }), false);
  assert.equal(isBuiltInBlock({ type: 'synced', data: { ref: 'abc' } }), true);
  assert.equal(isBuiltInBlock({ type: 'synced', data: { ref: 'abc', title: 'x' } }), false);
  assert.equal(isBuiltInBlock({ type: 'synced', data: null }), false);
  // Older built-in types are not affected.
  assert.equal(isBuiltInBlock({ type: 'paragraph', data: { text: 'x', blockType: 'simple' } }), true);
});

test('server sanitiser keeps legacy custom block data byte for byte (as 2.2 stored it)', () => {
  const input = legacyDocument();
  const stored = cleanEditorValue(input);
  assert.equal(JSON.stringify(stored.blocks), JSON.stringify(input.blocks));
  assert.equal(JSON.stringify(stored.blocks), JSON.stringify(V22.stored.blocks));
  // Idempotent: a second save changes nothing either.
  assert.equal(JSON.stringify(cleanEditorValue(stored).blocks), JSON.stringify(input.blocks));
  // The shared policy (also used by the admin with DOMPurify) takes the same path.
  const shared = sanitizeEditorData(input, {
    sanitizeInlineHtml: (html) => html,
    sanitizeRawHtml: () => '',
  });
  assert.equal(JSON.stringify(shared.blocks), JSON.stringify(input.blocks));
});

test('built-in data of the same types is cleaned by the built-in policy and gets the marker', () => {
  const stored = cleanEditorValue(
    doc(
      { id: 't', type: 'toc', data: { title: 'Inhalt', minLevel: 5, maxLevel: 3 } },
      { id: 's', type: 'synced', data: { ref: 'abc123' } },
      { id: 'g', type: 'gallery', data: { images: [], _mex: 1, junk: '<b>x</b>' } }
    )
  );
  assert.deepEqual(stored.blocks[0].data, {
    title: 'Inhalt',
    minLevel: 3,
    maxLevel: 5,
    style: 'unordered',
    _mex: 1,
  });
  assert.deepEqual(stored.blocks[1].data, { ref: 'abc123', _mex: 1 });
  assert.deepEqual(stored.blocks[2].data, { images: [], layout: 'grid', columns: 3, caption: '', _mex: 1 });
});

test('renderers use the custom block path for legacy data, exactly as 2.2 did', () => {
  const value = legacyDocument();
  assert.equal(renderHtml(value), V22.html);
  assert.equal(renderText(value), V22.text);
  assert.equal(renderMarkdown(value), V22.markdown);
  // No built-in toc: no heading ids, no nav, no media elements.
  assert.doesNotMatch(renderHtml(value), /<nav|<video|<audio|mex-h-|<figure/);
  const tree = renderTree(value);
  const nodes = Array.isArray(tree) ? tree : tree.children;
  const custom = nodes.filter((node) => node && node.attrs && node.attrs['data-mex-block']);
  assert.deepEqual(
    custom.map((node) => node.attrs['data-mex-block']),
    LEGACY_BLOCKS.map((block) => block.type)
  );
});

test('?mex=json keeps simple legacy blocks unchanged; embedded-entry ones resolve like any entry block', () => {
  const { data, refs } = collectReferences(legacyDocument());
  // Only the two embedded-entry blocks reference entries (none of the simple blocks).
  const entryRefs = [...refs.values()].filter((ref) => ref.kind === 'entry');
  assert.equal(entryRefs.length, 2);
  assert.ok([...refs.values()].every((ref) => ref.kind === 'entry'));
  const json = renderResolved(applyReferences(data, new Map()), 'json');
  const input = legacyDocument();
  for (const [index, block] of input.blocks.entries()) {
    const out = json.blocks[index];
    if (block.data.entry) assert.equal(out.data.entry, null, 'unresolved entry, as for every entry block');
    else assert.equal(JSON.stringify(out.data), JSON.stringify(block.data), block.id);
  }
});

test('quality, find and replace, diff, stats and presets treat legacy data as a custom block', () => {
  const value = legacyDocument();
  const rules = lintDocument(value).issues.map((issue) => issue.rule);
  assert.ok(!rules.includes('toc-no-headings') && !rules.includes('video-no-captions'), rules.join());
  // Settings custom blocks have no searchable fields (2.2 behaviour).
  assert.deepEqual(
    findMatches(value, { query: 'Contents' }).matches.filter((match) => match.blockId === 'lgtoc1'),
    []
  );
  const changed = legacyDocument();
  changed.blocks[1].data.title = 'Contents <b>bold</b>';
  const diff = diffDocuments(value, changed);
  const entry = diff.find((item) => item.id === 'lgtoc1');
  assert.equal(entry.op, 'changed');
  // Custom block strings are inline HTML (not the built-in toc's plain-text title).
  const title = entry.fields.find((field) => field.path === 'title');
  assert.equal(title.kind, 'text');
  assert.ok(!JSON.stringify(title.ops).includes('<b>'), 'markup is not shown as text');
  assert.equal(computeStats(doc(LEGACY_BLOCKS[6])).words > 0, true, 'legacy synced text counts');
  assert.equal(isSyncedBlock(LEGACY_BLOCKS[6]), false);
  assert.deepEqual(syncedRefsOf(value), []);
  assert.equal(imageHasAlt(LEGACY_BLOCKS[2]), null);
});

test('the marker is not a content change in the version diff', () => {
  const before = doc({
    id: 't',
    type: 'toc',
    data: { title: 'A', minLevel: 2, maxLevel: 4, style: 'ordered' },
  });
  const after = doc({
    id: 't',
    type: 'toc',
    data: { title: 'A', minLevel: 2, maxLevel: 4, style: 'ordered', _mex: 1 },
  });
  assert.deepEqual(
    diffDocuments(before, after).map((entry) => entry.op),
    ['equal']
  );
});

test('the published schema accepts legacy custom data and still checks built-in data', () => {
  const schema = buildEditorSchema();
  assert.deepEqual(validate(schema, schema, cleanEditorValue(legacyDocument())), []);
  const bad = doc({ id: 't', type: 'toc', data: { title: 'x', minLevel: 9, _mex: 1 } });
  assert.notDeepEqual(validate(schema, schema, bad), []);
  const shaped = doc({ id: 's', type: 'synced', data: { ref: 'Not valid' } });
  assert.notDeepEqual(validate(schema, schema, shaped), [], 'exact shape is checked as built-in');
});

test('Yjs guard accepts legacy custom data under every new name', () => {
  const seed = createSeedUpdate(doc({ id: 'p', type: 'paragraph', data: { text: 'hi' } }), 'e1');
  const room = new Y.Doc();
  Y.applyUpdate(room, seed);
  const client = new Y.Doc();
  Y.applyUpdate(client, seed);
  const before = Y.encodeStateVector(client);
  applyEditorDataToDoc(client, legacyDocument());
  assert.equal(applyCheckedUpdate(room, Y.encodeStateAsUpdate(client, before)).ok, true);
});

test('custom blocks: new blocks cannot take a 2.3 name, an existing one keeps it', () => {
  assert.deepEqual([...customBlocks.LEGACY_BUILT_IN_NAMES].sort(), [
    'audio',
    'gallery',
    'math',
    'mention',
    'synced',
    'toc',
    'video',
  ]);
  for (const name of ['toc', 'mention']) {
    // The schema accepts the name (so the stored block stays editable); create refuses it in the service.
    assert.equal(customBlocks.RESERVED_NAMES.has(name), false, name);
    assert.equal(validateBlock({ ...emptyValues(), name, label: 'X' }).name, 'reserved', name);
    assert.equal(
      validateBlock({ ...emptyValues(), name, label: 'X' }, { originalName: name }).name,
      undefined
    );
    assert.equal(
      validateBlock({ ...emptyValues(), name, label: 'X' }, { originalName: 'other' }).name,
      'reserved'
    );
  }
});

test('admin: a Settings block keeps its 2.3 name and the built-in tools never take over custom data', () => {
  const tools = readFileSync(new URL('../admin/src/editor/tools/index.js', import.meta.url), 'utf8');
  for (const [name, ToolClass] of [
    ['toc', 'TocTool'],
    ['synced', 'SyncedTool'],
    ['gallery', 'GalleryTool'],
    ['video', 'VideoTool'],
    ['audio', 'AudioTool'],
  ])
    assert.match(tools, new RegExp(`markedTool\\(${ToolClass}, '${name}'\\)`), name);
  assert.match(tools, /LEGACY_CUSTOM_NAMES = new Set\(\[\.\.\.Object\.keys\(MARKED_BLOCKS\), 'mention'\]\)/);
  assert.match(tools, /const legacy = LEGACY_CUSTOM_NAMES\.has\(name\)/);
  const marked = readFileSync(new URL('../admin/src/editor/tools/marked.js', import.meta.url), 'utf8');
  assert.match(marked, /if \(this\.mexForeign\) return copy\(this\.mexForeign\);/);
  assert.match(marked, /!isBuiltInBlock\(\{ type, data \}\)/);
});

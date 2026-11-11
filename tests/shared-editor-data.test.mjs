import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEditorData, EditorDataError, computeStats } from '../shared/editor-data.mjs';

test('accepts the 2.x object shape unchanged', () => {
  const value = {
    time: 5,
    version: '2.31.7',
    blocks: [{ id: 'abc', type: 'paragraph', data: { text: 'x' } }],
  };
  assert.deepEqual(normalizeEditorData(value), value);
});

test('parses 1.x JSON strings and double-encoded strings', () => {
  const inner = { time: 1, blocks: [{ id: 'q1', type: 'quote', data: { text: 'a' } }] };
  assert.equal(normalizeEditorData(JSON.stringify(inner)).blocks[0].id, 'q1');
  assert.equal(normalizeEditorData(JSON.stringify(JSON.stringify(inner))).blocks[0].type, 'quote');
});

test('plain text and HTML strings become paragraphs', () => {
  const text = normalizeEditorData('Line <1>\n\nSecond');
  assert.deepEqual(
    text.blocks.map((block) => block.data.text),
    ['Line &lt;1&gt;', 'Second']
  );
  const html = normalizeEditorData('<p>Hello <b>you</b></p>');
  assert.equal(html.blocks[0].data.text, '<p>Hello <b>you</b></p>');
});

test('blocks without ids get stable ids; duplicates are renamed', () => {
  const value = {
    blocks: [
      { type: 'paragraph', data: { text: 'a' } },
      { id: 'x', type: 'paragraph', data: {} },
      { id: 'x', type: 'header', data: {} },
    ],
  };
  const first = normalizeEditorData(value);
  const second = normalizeEditorData(value);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.blocks.map((block) => block.id)).size, 3);
});

test('drops invalid blocks and prototype-polluting keys', () => {
  const value = JSON.parse(
    '{"blocks":[{"type":"paragraph","data":{"text":"a","__proto__":{"polluted":true}}},{"type":"<script>"},null,{"data":{}}]}'
  );
  const result = normalizeEditorData(value);
  assert.equal(result.blocks.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.blocks[0].data, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('rejects oversized and deeply nested content instead of truncating', () => {
  const blocks = Array.from({ length: 5001 }, (_, i) => ({ id: `b${i}`, type: 'paragraph', data: {} }));
  assert.throws(() => normalizeEditorData({ blocks }), EditorDataError);
  let deep = {};
  const root = deep;
  for (let i = 0; i < 40; i += 1) deep = deep.child = {};
  assert.throws(
    () => normalizeEditorData({ blocks: [{ type: 'paragraph', data: root }] }),
    /nested too deeply/
  );
});

test('empty values normalise to null', () => {
  assert.equal(normalizeEditorData(null), null);
  assert.equal(normalizeEditorData(''), null);
  assert.equal(normalizeEditorData('   '), null);
});

test('stats count words of visible text only', () => {
  const stats = computeStats({
    blocks: [{ data: { text: 'Hello <b>big</b> world', url: 'https://example.test/x y' } }],
  });
  assert.deepEqual(stats, { blocks: 1, words: 3, characters: 15 });
});

test('plain text parsing finishes quickly on adversarial input', () => {
  const started = Date.now();
  normalizeEditorData(`${'\n '.repeat(50000)}x`);
  normalizeEditorData(`<${'a'.repeat(100000)}`);
  assert.ok(Date.now() - started < 500);
});

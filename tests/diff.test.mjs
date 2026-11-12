import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffDocuments,
  summarizeDiff,
  diffText,
  blockText,
  diffTunes,
  canonicalEqual,
} from '../shared/diff.mjs';

const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const doc = (...blocks) => ({ time: 1, blocks, version: '2.31.7' });
const ops = (entries) => entries.map((entry) => `${entry.op}:${entry.id}`);

test('identical documents are all equal', () => {
  const a = doc(p('a', 'One'), p('b', 'Two'));
  const entries = diffDocuments(a, structuredClone(a));
  assert.deepEqual(ops(entries), ['equal:a', 'equal:b']);
  assert.deepEqual(summarizeDiff(entries), { added: 0, removed: 0, changed: 0, moved: 0, equal: 2 });
});

test('insert in the middle and removal keep their positions', () => {
  const before = doc(p('a', 'One'), p('b', 'Two'), p('c', 'Three'));
  const after = doc(p('a', 'One'), p('n', 'New text here'), p('c', 'Three'));
  assert.deepEqual(ops(diffDocuments(before, after)), ['equal:a', 'removed:b', 'added:n', 'equal:c']);
});

test('reordered blocks are reported as moved, the rest stays equal', () => {
  const before = doc(p('a', 'One'), p('b', 'Two'), p('c', 'Three'), p('d', 'Four'));
  const after = doc(p('a', 'One'), p('c', 'Three'), p('d', 'Four'), p('b', 'Two'));
  const entries = diffDocuments(before, after);
  assert.deepEqual(ops(entries), ['equal:a', 'equal:c', 'equal:d', 'moved:b']);
  assert.equal(entries[3].changed, false);
  assert.equal(summarizeDiff(entries).moved, 1);
});

test('word-level text diff inside a changed paragraph', () => {
  const entries = diffDocuments(doc(p('a', 'The quick brown fox')), doc(p('a', 'The slow brown fox jumps')));
  assert.equal(entries[0].op, 'changed');
  assert.deepEqual(entries[0].fields[0].ops, [
    { op: 'equal', text: 'The ' },
    { op: 'delete', text: 'quick' },
    { op: 'insert', text: 'slow' },
    { op: 'equal', text: ' brown fox' },
    { op: 'insert', text: ' jumps' },
  ]);
});

test('formatting-only change is flagged', () => {
  const entries = diffDocuments(doc(p('a', 'Hello <b>world</b>')), doc(p('a', 'Hello <i>world</i>')));
  assert.equal(entries[0].op, 'changed');
  assert.equal(entries[0].formattingOnly, true);
  assert.equal(entries[0].fields[0].formatting, true);
  assert.deepEqual(entries[0].fields[0].ops, [{ op: 'equal', text: 'Hello world' }]);
});

test('table cell change is reported by path', () => {
  const table = (cell) => ({
    id: 't',
    type: 'table',
    data: {
      withHeadings: true,
      stretched: false,
      content: [
        ['A', 'B'],
        ['1', cell],
      ],
    },
  });
  const entries = diffDocuments(doc(table('2')), doc(table('3')));
  assert.equal(entries[0].op, 'changed');
  assert.deepEqual(
    entries[0].fields.map((field) => field.path),
    ['content.1.1']
  );
});

test('list item change and added item', () => {
  const list = (items) => ({
    id: 'l',
    type: 'list',
    data: { style: 'unordered', items: items.map((content) => ({ content, items: [] })) },
  });
  const entries = diffDocuments(doc(list(['Milk', 'Eggs'])), doc(list(['Milk', 'Bread', 'Eggs'])));
  assert.equal(entries[0].op, 'changed');
  const paths = entries[0].fields.map((field) => field.path);
  assert.ok(paths.includes('items.1.content'));
  assert.ok(paths.includes('items.2.content'));
});

test('value changes (heading level, tunes, type) are value fields', () => {
  const before = doc({ id: 'h', type: 'header', data: { text: 'Title', level: 2 } });
  const after = doc({
    id: 'h',
    type: 'header',
    data: { text: 'Title', level: 3 },
    tunes: { alignmentTune: { alignment: 'center' } },
  });
  const [entry] = diffDocuments(before, after);
  assert.deepEqual(
    entry.fields.map((field) => [field.path, field.kind, field.before, field.after]),
    [
      ['level', 'value', 2, 3],
      ['tunes', 'tunes', undefined, undefined],
    ]
  );
  assert.deepEqual(entry.fields[1].changes, [
    { tune: 'alignmentTune', before: 'left', after: 'center', known: true },
  ]);
});

test('tunes that differ only in key order are not a change (history regression)', () => {
  const tunesA = {
    indentTune: { indentLevel: 1 },
    textVariant: 'citation',
    alignmentTune: { alignment: 'center' },
  };
  const tunesB = {
    alignmentTune: { alignment: 'center' },
    textVariant: 'citation',
    indentTune: { indentLevel: 1 },
  };
  const before = doc({ id: 'a', type: 'paragraph', data: { text: 'Same' }, tunes: tunesA });
  const after = doc({ id: 'a', type: 'paragraph', data: { text: 'Same' }, tunes: tunesB });
  assert.deepEqual(ops(diffDocuments(before, after)), ['equal:a']);
  assert.deepEqual(diffTunes(tunesA, tunesB), []);
});

test('default tune values equal missing tunes', () => {
  const stored = doc(p('a', 'Text'));
  const fromEditor = doc({
    id: 'a',
    type: 'paragraph',
    data: { text: 'Text' },
    tunes: { textVariant: '', alignmentTune: { alignment: 'left' }, indentTune: { indentLevel: 0 } },
  });
  assert.deepEqual(ops(diffDocuments(stored, fromEditor)), ['equal:a']);
});

test('real tune changes are listed per tune with readable values', () => {
  const changes = diffTunes(
    { alignmentTune: { alignment: 'left' }, indentTune: { indentLevel: 0 }, textVariant: '' },
    { indentTune: { indentLevel: 1 }, alignmentTune: { alignment: 'center' }, textVariant: 'call-out' }
  );
  assert.deepEqual(changes, [
    { tune: 'alignmentTune', before: 'left', after: 'center', known: true },
    { tune: 'indentTune', before: 0, after: 1, known: true },
    { tune: 'textVariant', before: '', after: 'call-out', known: true },
  ]);
});

test('unknown tunes compare canonically and are reported as JSON text', () => {
  assert.deepEqual(diffTunes({ myTune: { b: 1, a: 2 } }, { myTune: { a: 2, b: 1 } }), []);
  assert.deepEqual(diffTunes({}, { myTune: { b: 1, a: 2 } }), [
    { tune: 'myTune', before: null, after: '{"a":2,"b":1}', known: false },
  ]);
  assert.ok(canonicalEqual({ x: [{ b: 1, a: 2 }] }, { x: [{ a: 2, b: 1 }] }));
  assert.ok(!canonicalEqual([1, 2], [2, 1]));
});

test('blocks re-created with a new id are paired by similarity', () => {
  const before = doc(p('old', 'A long paragraph about synthetic content and testing'));
  const after = doc(p('new', 'A long paragraph about synthetic content and more testing'));
  const entries = diffDocuments(before, after);
  assert.deepEqual(ops(entries), ['changed:new']);
  assert.equal(entries[0].before.id, 'old');
});

test('unrelated blocks are not paired', () => {
  const entries = diffDocuments(doc(p('x', 'Alpha beta gamma')), doc(p('y', 'Completely different words')));
  assert.deepEqual(ops(entries), ['removed:x', 'added:y']);
});

test('code blocks compare their text without parsing HTML', () => {
  const code = (text) => ({ id: 'c', type: 'code', data: { code: text } });
  const [entry] = diffDocuments(doc(code('<div>a</div>')), doc(code('<div>b</div>')));
  const text = entry.fields[0].ops.map((op) => op.text).join('');
  assert.match(text, /<div>/);
});

test('the result carries plain text only (no HTML from old versions)', () => {
  const before = doc(p('a', 'Hi <img src=x onerror=alert(1)> there'));
  const after = doc(p('a', 'Hi <script>alert(1)</script> friend'));
  const [entry] = diffDocuments(before, after);
  const text = entry.fields[0].ops.map((op) => op.text).join('');
  assert.doesNotMatch(text, /<|onerror|alert/);
  assert.equal(blockText(before.blocks[0]), 'Hi there');
});

test('invalid input is treated as an empty document', () => {
  assert.deepEqual(diffDocuments(null, undefined), []);
  assert.deepEqual(ops(diffDocuments({ blocks: 'nope' }, doc(p('a', 'x')))), ['added:a']);
});

test('long fields fall back to a whole replacement', () => {
  const long = (word) => Array.from({ length: 2500 }, (_, i) => `${word}${i}`).join(' ');
  const result = diffText(long('a'), long('b'));
  assert.deepEqual(
    result.map((op) => op.op),
    ['delete', 'insert']
  );
});

test('deterministic and fast on 2000 blocks', () => {
  const before = doc(...Array.from({ length: 2000 }, (_, i) => p(`b${i}`, `Paragraph ${i} with some words`)));
  const after = structuredClone(before);
  after.blocks.splice(10, 5);
  after.blocks.splice(500, 0, p('n1', 'Inserted paragraph'));
  after.blocks[700].data.text = 'Changed paragraph text';
  after.blocks.push(after.blocks.splice(100, 1)[0]);
  const start = performance.now();
  const first = diffDocuments(before, after);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `took ${elapsed} ms`);
  assert.deepEqual(diffDocuments(before, after), first);
  assert.deepEqual(summarizeDiff(first), { added: 1, removed: 5, changed: 1, moved: 1, equal: 1993 });
});

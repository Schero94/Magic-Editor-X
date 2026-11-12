import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, replaceMatches, compileQuery } from '../shared/find-replace.mjs';
import {
  matchBlockShortcut,
  matchInlineShortcut,
  allowShortcut,
} from '../admin/src/editor/markdown-shortcuts-logic.mjs';
import { resolveFieldPreset } from '../shared/presets.mjs';

/** Find and replace on the document model, and Markdown shortcuts. */

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });
const DATA = doc([
  { id: 'a', type: 'paragraph', data: { text: 'Cats &amp; dogs. <b>Cats</b> sleep.' } },
  {
    id: 'b',
    type: 'list',
    data: {
      style: 'unordered',
      items: [{ content: 'cat food', items: [{ content: 'Cat toys', items: [] }] }],
    },
  },
  {
    id: 'c',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        ['cat', 'dog'],
        ['x', 'scat'],
      ],
    },
  },
  { id: 'd', type: 'code', data: { code: 'const cat = "<cat>";' } },
  { id: 'e', type: 'image', data: { file: { url: 'https://cdn.example.test/cat.png' }, caption: 'A cat' } },
  {
    id: 'f',
    type: 'paragraph',
    data: {
      text: '<a href="https://cat.example.test">link</a> <span class="cdx-tooltip" data-tooltip="cat &gt; dog">tip</span>',
    },
  },
]);

test('find searches every text field but never markup, URLs or attributes', () => {
  const { matches } = findMatches(DATA, 'cat');
  assert.deepEqual(
    matches.map((m) => `${m.blockId}:${m.path}:${m.text}`),
    [
      'a:text:Cat',
      'a:text:Cat',
      'b:items.0.content:cat',
      'b:items.0.items.0.content:Cat',
      'c:content.0.0:cat',
      'c:content.1.1:cat',
      'd:code:cat',
      'd:code:cat',
      'e:caption:cat',
    ]
  );
  assert.equal(findMatches(DATA, 'cat', { matchCase: true }).matches.length, 6);
  assert.equal(findMatches(DATA, 'cat', { wholeWord: true }).matches.length, 6);
  assert.equal(findMatches(DATA, '&').matches.length, 1);
  assert.equal(findMatches(DATA, 'c.t').matches.length, 0);
  assert.equal(findMatches(DATA, 'c.t', { regex: true }).matches.length, 9);
});

test('invalid, empty and oversized queries are reported, never thrown', () => {
  assert.equal(compileQuery('').error, 'EMPTY');
  assert.equal(compileQuery('x'.repeat(201)).error, 'TOO_LONG');
  assert.equal(compileQuery('(', { regex: true }).error, 'INVALID');
  assert.equal(findMatches(DATA, '(', { regex: true }).error, 'INVALID');
  // Zero-length regex matches do not loop.
  assert.equal(findMatches(DATA, 'x*', { regex: true }).matches.length, 1);
});

test('replace keeps formatting and escapes the replacement', () => {
  const all = replaceMatches(DATA, 'cat', '<Dog>', { wholeWord: true });
  assert.equal(all.count, 6);
  assert.deepEqual(all.blockIds, ['b', 'c', 'd', 'e']);
  const bold = replaceMatches(DATA, 'Cats', '<Dog>', { matchCase: true });
  assert.equal(bold.data.blocks[0].data.text, '&lt;Dog&gt; &amp; dogs. <b>&lt;Dog&gt;</b> sleep.');
  assert.equal(all.data.blocks[3].data.code, 'const <Dog> = "<<Dog>>";');
  assert.equal(all.data.blocks[2].data.content[1][1], 'scat');
  // Untouched blocks keep their identity.
  assert.equal(all.data.blocks[5], DATA.blocks[5]);
  assert.equal(all.data.blocks[0], DATA.blocks[0]);

  const one = findMatches(DATA, 'cat').matches[2];
  const single = replaceMatches(DATA, 'cat', 'bird', {}, { only: one });
  assert.equal(single.count, 1);
  assert.equal(single.data.blocks[1].data.items[0].content, 'bird food');
  assert.equal(single.data.blocks[1].data.items[0].items[0].content, 'Cat toys');

  const groups = replaceMatches(
    doc([{ id: 'x', type: 'paragraph', data: { text: 'John Smith' } }]),
    '(\\w+) (\\w+)',
    '$2, $1',
    { regex: true }
  );
  assert.equal(groups.data.blocks[0].data.text, 'Smith, John');
  const literal = replaceMatches(doc([{ id: 'x', type: 'paragraph', data: { text: 'a' } }]), 'a', '$&$&');
  assert.equal(literal.data.blocks[0].data.text, '$&amp;$&amp;');
});

test('block shortcuts', () => {
  assert.deepEqual(matchBlockShortcut('##', 'space'), { type: 'header', data: { text: '', level: 2 } });
  assert.equal(matchBlockShortcut('#######', 'space'), null);
  assert.equal(matchBlockShortcut('-', 'space').data.style, 'unordered');
  assert.deepEqual(matchBlockShortcut('3.', 'space').data.meta, { start: 3 });
  assert.equal(matchBlockShortcut('1)', 'space').data.meta, undefined);
  assert.equal(matchBlockShortcut('[x]', 'space').data.items[0].checked, true);
  assert.equal(matchBlockShortcut('[]', 'space').data.items[0].checked, false);
  assert.equal(matchBlockShortcut('>', 'space').type, 'quote');
  assert.deepEqual(matchBlockShortcut('```js', 'enter'), {
    type: 'codeFlask',
    data: { code: '', language: 'js' },
  });
  assert.equal(matchBlockShortcut('---', 'enter').type, 'delimiter');
  assert.equal(matchBlockShortcut('---', 'space'), null);
  assert.equal(matchBlockShortcut('# x', 'space'), null);
});

test('block shortcuts respect the field preset', () => {
  const basic = resolveFieldPreset({ preset: 'basic' });
  assert.equal(allowShortcut(matchBlockShortcut('#', 'space'), basic), null);
  assert.equal(allowShortcut(matchBlockShortcut('##', 'space'), basic).type, 'header');
  assert.equal(allowShortcut(matchBlockShortcut('[]', 'space'), basic), null);
  assert.equal(allowShortcut(matchBlockShortcut('```', 'enter'), basic), null);
  const article = resolveFieldPreset({ allowedBlocks: 'code' });
  assert.equal(allowShortcut(matchBlockShortcut('```', 'enter'), article).type, 'code');
  assert.equal(
    allowShortcut(matchBlockShortcut('-', 'space'), null, (name) => name !== 'list'),
    null
  );
});

test('inline shortcuts', () => {
  assert.deepEqual(matchInlineShortcut('a **bold**'), { start: 2, end: 10, text: 'bold', tag: 'b' });
  assert.deepEqual(matchInlineShortcut('x _it_'), { start: 2, end: 6, text: 'it', tag: 'i' });
  assert.equal(matchInlineShortcut('snake_case_'), null);
  assert.equal(matchInlineShortcut('**bold*'), null);
  assert.equal(matchInlineShortcut('a * b *'), null);
  assert.deepEqual(matchInlineShortcut('`x`'), { start: 0, end: 3, text: 'x', tag: 'code' });
  assert.equal(matchInlineShortcut('~~gone~~').tag, 's');
});

test('matches carry their occurrence inside the block', () => {
  const { matches } = findMatches(doc([{ id: 'p', type: 'paragraph', data: { text: 'a A <b>a</b>' } }]), 'a');
  assert.deepEqual(
    matches.map((m) => m.occurrence),
    [0, 1, 2]
  );
});

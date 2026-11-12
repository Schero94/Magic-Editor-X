import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_PASTED_IMAGE_BYTES,
  clampHeadingLevel,
  countBlockTags,
  decidePaste,
  decodeDataImage,
  filterBlocks,
  isOfficeHtml,
} from '../admin/src/editor/paste-logic.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/paste/${name}`, import.meta.url), 'utf8');

test('office clipboards are recognised', () => {
  assert.equal(isOfficeHtml(fixture('word.html')), true);
  assert.equal(isOfficeHtml(fixture('gdocs.html')), true);
  assert.equal(isOfficeHtml('<meta name="generator" content="LibreOffice 24.2"><p>x</p>'), true);
  assert.equal(isOfficeHtml('<p>plain <b>web</b> text</p>'), false);
  assert.equal(countBlockTags('<p>a</p><p>b</p><p>c</p>'), 2);
  assert.equal(countBlockTags('<span>a</span>'), 0);
});

test('decidePaste converts office and multi-block HTML and Markdown, nothing else', () => {
  assert.equal(decidePaste({ html: fixture('word.html'), text: 'x' }), 'html');
  assert.equal(decidePaste({ html: '<p>a</p><ul><li>b</li></ul>', text: 'a b' }), 'html');
  assert.equal(decidePaste({ html: '<span>one <b>inline</b> run</span>', text: 'x' }), null);
  assert.equal(decidePaste({ text: '# Title\n\n- a\n- b' }), 'markdown');
  assert.equal(decidePaste({ text: 'just one sentence' }), null);
  assert.equal(decidePaste({ text: '# Title\n- a', hasFiles: true }), null);
  assert.equal(decidePaste({ html: '<p>a</p><p>b</p>', text: 'a', protectedTarget: true }), null);
  assert.equal(decidePaste({ html: '<p>a</p><p>b</p>', text: 'a b', plainOnly: true }), 'plain');
  assert.equal(decidePaste({ html: '', text: '', plainOnly: true }), null);
  assert.equal(decidePaste({ html: `<p>${'x'.repeat(2 * 1024 * 1024)}</p><p>y</p>`, text: 'x' }), null);
});

test('heading levels move to the nearest allowed level', () => {
  assert.equal(clampHeadingLevel(1, [2, 3]), 2);
  assert.equal(clampHeadingLevel(6, [2, 3]), 3);
  assert.equal(clampHeadingLevel(4, [3, 5]), 5);
  assert.equal(clampHeadingLevel(4, []), 4);
  assert.equal(clampHeadingLevel(4, undefined), 4);
});

test('filterBlocks keeps allowed blocks and falls back to paragraphs', () => {
  const blocks = [
    { type: 'header', data: { text: 'H', level: 1 } },
    {
      type: 'list',
      data: { style: 'unordered', items: [{ content: 'a', items: [{ content: 'b', items: [] }] }] },
    },
    { type: 'checklist', data: { items: [{ text: 'c', checked: true }] } },
    { type: 'codeFlask', data: { code: 'x<1\ny', language: 'js' } },
    {
      type: 'table',
      data: {
        content: [
          ['a', 'b'],
          ['', ''],
        ],
      },
    },
    { type: 'image', data: { file: { url: '/x.png' } } },
    { type: 'delimiter', data: {} },
    { type: 'paragraph', data: { text: 'p' } },
  ];
  const all = filterBlocks(blocks);
  assert.equal(all.blocks.length, blocks.length);
  assert.equal(all.dropped, 0);

  const onlyText = filterBlocks(blocks, { isAllowed: () => false });
  assert.deepEqual(
    onlyText.blocks.map((block) => block.data.text),
    ['H', 'a', 'b', 'c', 'x&lt;1<br>y', 'a | b', 'p']
  );
  assert.equal(onlyText.dropped, 2);

  const headings = filterBlocks(blocks, {
    isAllowed: (type) => ['header', 'list', 'code'].includes(type),
    allowedHeadingLevels: [2, 3],
  });
  assert.equal(headings.blocks[0].data.level, 2);
  assert.equal(blocks[0].data.level, 1, 'input is not changed');
  assert.deepEqual(
    headings.blocks[2].data.items.map((item) => item.content),
    ['c']
  );
  assert.deepEqual(headings.blocks[3], { type: 'code', data: { code: 'x<1\ny' } });
});

test('data images: type allow-list and size cap', () => {
  const png = decodeDataImage('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(png.type, 'image/png');
  assert.equal(png.bytes[1], 0x50);
  assert.equal(decodeDataImage('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(decodeDataImage('data:text/html;base64,PHA+'), null);
  assert.equal(decodeDataImage('https://example.com/a.png'), null);
  assert.equal(decodeDataImage('data:image/png;base64,!!!'), null);
  const big = `data:image/png;base64,${'A'.repeat(Math.ceil(((MAX_PASTED_IMAGE_BYTES + 10) * 4) / 3))}`;
  assert.equal(decodeDataImage(big), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToBlocks, strapiBlocksToEditor } from '../shared/convert/index.mjs';
import { renderMarkdown } from '../shared/render/index.mjs';

/**
 * 2.7 API audit F7 (Markdown quote caption round trip) and F8 (Strapi Blocks
 * code trailing newline, custom nodes reported). Synthetic data only.
 */

const quote = (data) => ({ blocks: [{ id: 'q1', type: 'quote', data: { alignment: 'left', ...data } }] });

test('F7: a quote caption survives renderMarkdown -> markdownToBlocks -> renderMarkdown', () => {
  for (const data of [
    { text: 'line1<br>line2', caption: 'who' },
    { text: 'a <b>bold</b> claim', caption: '<i>Ann</i> Lee' },
    { text: 'no caption', caption: '' },
    { text: '', caption: 'only a caption' },
  ]) {
    const md = renderMarkdown(quote(data));
    const back = markdownToBlocks(md);
    assert.equal(back.blocks.length, 1, md);
    assert.equal(back.blocks[0].type, 'quote');
    assert.equal(back.blocks[0].data.text, data.text, md);
    assert.equal(back.blocks[0].data.caption, data.caption, md);
    assert.equal(renderMarkdown({ blocks: back.blocks }), md);
  }
});

test('F7: a dash that is not the last paragraph, or not an em dash, stays quote text', () => {
  const middle = markdownToBlocks('> — first\n>\n> second').blocks[0].data;
  assert.equal(middle.caption, '');
  assert.match(middle.text, /first/);
  const hyphen = markdownToBlocks('> text\n>\n> - item').blocks[0].data;
  assert.equal(hyphen.caption, '');
});

test('F8: Strapi Blocks code keeps its trailing newline; custom nodes are reported, not guessed', () => {
  const { blocks, report } = strapiBlocksToEditor([
    { type: 'code', language: 'javascript', children: [{ type: 'text', text: 'const a = "<x>";\n' }] },
    { type: 'code', children: [{ type: 'text', text: 'plain\n\n' }] },
    { type: 'tone', tone: 'warning', children: [{ type: 'text', text: 'custom core block node' }] },
  ]);
  assert.deepEqual(
    blocks.map((block) => [block.type, block.data.code]),
    [
      ['codeFlask', 'const a = "<x>";\n'],
      ['code', 'plain\n\n'],
    ]
  );
  assert.deepEqual(report.skipped, [{ reason: 'unsupported-node', tag: 'tone', count: 1 }]);
});

test('Markdown and HTML fences still drop their formatting newline', () => {
  const [block] = markdownToBlocks('```js\nconst a = 1;\n```').blocks;
  assert.equal(block.data.code, 'const a = 1;');
});

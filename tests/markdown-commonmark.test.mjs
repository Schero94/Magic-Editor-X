/**
 * Markdown output is valid CommonMark + GFM and the importers keep what the
 * renderers write (2.7 API re-audit): trailing line breaks, adjacent and nested
 * marks, consecutive lists, `<ol>` without `start`, display math, quote
 * figures, nested checklists and a guard against pathological nesting.
 * marked (the plugin's own Markdown dependency) is the reference parser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderMarkdown } from '../shared/render/index.mjs';
import { parseInline } from '../shared/render/inline.mjs';
import { htmlToBlocks, markdownToBlocks, parseHtmlWithHtmlparser2 } from '../shared/convert/index.mjs';

const require = createRequire(import.meta.url);
const { marked, lexer } = require('marked');

const doc = (...blocks) => ({
  time: 1,
  version: '2.31.7',
  blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })),
});
const para = (text) => ({ type: 'paragraph', data: { text } });
const html = (markdown) => marked.parse(markdown).trim();
const parse = parseHtmlWithHtmlparser2;
const list = (style, contents, extra = {}) => ({
  type: 'list',
  data: {
    style,
    meta: style === 'ordered' ? { start: 1, counterType: 'numeric' } : {},
    items: contents.map((content) => ({
      content,
      meta: style === 'checklist' ? { checked: false } : {},
      items: [],
    })),
    ...extra,
  },
});

/* ------------------------------------------------------- 4.a breaks */

test('a trailing <br> leaves no dangling backslash (paragraph, heading, item, cell, quote)', () => {
  assert.equal(renderMarkdown(doc(para('Hello world<br>'))), 'Hello world');
  assert.equal(html(renderMarkdown(doc(para('Hello world<br>')))), '<p>Hello world</p>');
  assert.equal(renderMarkdown(doc({ type: 'header', data: { text: 'Title<br>', level: 2 } })), '## Title');
  assert.equal(renderMarkdown(doc(list('unordered', ['one<br>', 'two']))), '- one\n- two');
  const table = renderMarkdown(
    doc({
      type: 'table',
      data: {
        withHeadings: true,
        content: [
          ['A<br>', 'B'],
          ['x<br>', 'y'],
        ],
      },
    })
  );
  assert.doesNotMatch(table, /\\/);
  assert.equal(renderMarkdown(doc({ type: 'quote', data: { text: 'Quote<br>', caption: '' } })), '> Quote');
  // A break inside the text stays a hard break; one at the end of a mark moves outside it.
  assert.equal(html(renderMarkdown(doc(para('a<br>b')))), '<p>a<br>b</p>');
  assert.equal(html(renderMarkdown(doc(para('<b>x<br></b>y')))), '<p><strong>x</strong><br>y</p>');
  assert.equal(html(renderMarkdown(doc(para('<br><br>Start')))), '<p>Start</p>');
});

/* ------------------------------------------------------- 4.b marks */

test('adjacent and nested marks of one kind render as one run', () => {
  const cases = [
    ['<b>Bold</b><b>Bold2</b>', '<p><strong>BoldBold2</strong></p>'],
    [
      '<s class="cdx-strikethrough">gone</s><s class="cdx-strikethrough">gone2</s>',
      '<p><del>gonegone2</del></p>',
    ],
    ['<i>it</i><i>al</i>', '<p><em>ital</em></p>'],
    ['<b>a<b>b</b>c</b>', '<p><strong>abc</strong></p>'],
    ['<b>a<strong>b</strong></b>', '<p><strong>ab</strong></p>'],
    ['<code>a</code><code>b</code>', '<p><code>ab</code></p>'],
    ['<b><i>a</i></b><b><i>b</i></b>', '<p><strong><em>ab</em></strong></p>'],
    ['a<i>b</i>c', '<p>a<em>b</em>c</p>'],
    ['<b><i>a</i>b</b>', '<p><strong><em>a</em>b</strong></p>'],
    [
      '<b>a</b><i>b</i> and <i>c</i><b>d</b>',
      '<p><strong>a</strong><em>b</em> and <em>c</em><strong>d</strong></p>',
    ],
    ['<b>end.</b><s>gone</s>', '<p><strong>end.</strong><del>gone</del></p>'],
    ['<i>end.</i><s>gone</s>', '<p><em>end.</em><del>gone</del></p>'],
    ['end!<a href="https://example.test/">link</a>', '<p>end!<a href="https://example.test/">link</a></p>'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(html(renderMarkdown(doc(para(input)))), expected, input);
  }
});

/* ------------------------------------------------------- 4.c lists */

test('consecutive list blocks stay separate lists', () => {
  const count = (...blocks) => lexer(renderMarkdown(doc(...blocks))).filter((t) => t.type === 'list').length;
  assert.equal(count(list('unordered', ['a']), list('unordered', ['b'])), 2);
  assert.equal(count(list('ordered', ['a']), list('ordered', ['b'])), 2);
  assert.equal(count(list('checklist', ['a']), list('checklist', ['b'])), 2);
  assert.equal(count(list('unordered', ['a']), list('checklist', ['b'])), 2);
  assert.equal(count(list('unordered', ['a']), list('unordered', ['b']), list('unordered', ['c'])), 3);
  assert.equal(
    count(
      { type: 'checklist', data: { items: [{ text: 'a', checked: true }] } },
      { type: 'checklist', data: { items: [{ text: 'b', checked: false }] } }
    ),
    2
  );
  // The second ordered list keeps its own numbers.
  const md = renderMarkdown(doc(list('ordered', ['a', 'b']), list('ordered', ['c'])));
  const lists = lexer(md).filter((t) => t.type === 'list');
  assert.deepEqual(
    lists.map((t) => [t.ordered, t.start, t.items.length]),
    [
      [true, 1, 2],
      [true, 1, 1],
    ]
  );
  // A paragraph in between needs nothing special.
  assert.equal(
    renderMarkdown(doc(list('unordered', ['a']), para('p'), list('unordered', ['b']))),
    '- a\n\np\n\n- b'
  );
});

/* ------------------------------------------------------- property test */

/** Deterministic PRNG (mulberry32). */
const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const WORDS = [
  'alpha',
  'beta',
  'x',
  'y2',
  'a.b',
  'end!',
  'q?',
  '1.',
  'x*y',
  'a_b',
  '~t',
  '#h',
  '[x]',
  'a&b',
  '<p>',
];
const MARKS = ['b', 'i', 's', 'code', 'a'];

const entity = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Random inline HTML: words (with Markdown punctuation), marks nested and
 * adjacent to each other, line breaks. A mark next to a word is separated by
 * a space: CommonMark cannot express emphasis that ends in punctuation right
 * before a letter (`**"a"**b`), with any delimiter.
 */
const inlineHtml = (rand, depth = 0, active = []) => {
  const items = [];
  const count = 1 + Math.floor(rand() * 4);
  for (let index = 0; index < count; index += 1) {
    const roll = rand();
    if (roll < 0.35 && depth < 3) {
      // A mark is not nested in itself here (the unit test above covers that): unwrapping it would
      // leave text touching a neighbouring mark. Links never nest (Markdown cannot express it).
      const choices = MARKS.filter((name) => !active.includes(name));
      const mark = choices[Math.floor(rand() * choices.length)];
      let inner =
        mark === 'code'
          ? entity(WORDS[Math.floor(rand() * WORDS.length)].replace(/[<&>]/g, ''))
          : inlineHtml(rand, depth + 1, [...active, mark]);
      // A mark around nothing but breaks has no text (an empty link shows its URL).
      if (!/[A-Za-z0-9]/.test(inner.replace(/<[^>]*>/g, ''))) inner += 'alpha';
      items.push({
        kind: 'mark',
        name: mark,
        html: mark === 'a' ? `<a href="https://example.test/x">${inner}</a>` : `<${mark}>${inner}</${mark}>`,
      });
    } else if (roll < 0.45) {
      items.push({ kind: 'br', html: '<br>' });
    } else {
      items.push({ kind: 'word', html: entity(WORDS[Math.floor(rand() * WORDS.length)]) });
    }
  }
  return items
    .map((item, index) => {
      const next = items[index + 1];
      if (!next) return item.html;
      // marked (unlike CommonMark) does not close `**`/`*` after punctuation right before `~~`;
      // the renderer uses `__`/`_` there when it can, so strikethrough only touches simple marks.
      // Touching marks of one kind merge into one run (unit-tested above); their contents would
      // then touch inside a word, which CommonMark cannot always express.
      const touch =
        item.kind === 'mark' &&
        next.kind === 'mark' &&
        next.name !== item.name &&
        (next.name !== 's' || !/<(b|i|a)>|<a /.test(item.html)) &&
        rand() < 0.5;
      return touch || item.kind === 'br' || next.kind === 'br' ? item.html : `${item.html} `;
    })
    .join('');
};

const KIND = { b: 'strong', strong: 'strong', i: 'em', em: 'em', s: 'del', code: 'code', a: 'link' };

/** Signature of stored inline HTML: non-space characters with their marks, `\n` for breaks. */
const expected = (value) => {
  const out = [];
  const walk = (nodes, marks) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        for (const char of node.value) if (char.trim()) out.push(`${char}:${[...marks].sort().join(',')}`);
      } else if (node.tag === 'br') out.push('\n');
      else walk(node.children, KIND[node.tag] ? new Set([...marks, KIND[node.tag]]) : marks);
    }
  };
  walk(parseInline(value), new Set());
  while (out[0] === '\n') out.shift();
  while (out.at(-1) === '\n') out.pop();
  return out.join(' ');
};

/** The same signature of marked's inline tokens. */
const actual = (tokens) => {
  const out = [];
  const walk = (list, marks) => {
    for (const token of list || []) {
      if (token.type === 'br') out.push('\n');
      else if (token.type === 'codespan') {
        for (const char of token.text)
          if (char.trim()) out.push(`${char}:${[...marks, 'code'].sort().join(',')}`);
      } else if (KIND[token.type] || ['strong', 'em', 'del', 'link'].includes(token.type)) {
        walk(token.tokens, new Set([...marks, KIND[token.type] || token.type]));
      } else if (token.tokens) walk(token.tokens, marks);
      else {
        const text =
          token.type === 'escape'
            ? token.text
            : (token.text || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        for (const char of text) if (char.trim()) out.push(`${char}:${[...marks].sort().join(',')}`);
      }
    }
  };
  walk(tokens, new Set());
  return out.join(' ');
};

test('property: rendered Markdown parses back to the same blocks, text and marks', () => {
  const rand = random(20261120);
  for (let run = 0; run < 400; run += 1) {
    const blocks = [];
    const total = 1 + Math.floor(rand() * 4);
    for (let index = 0; index < total; index += 1) {
      const roll = rand();
      if (roll < 0.4) blocks.push(para(inlineHtml(rand)));
      else if (roll < 0.55)
        blocks.push({ type: 'header', data: { text: inlineHtml(rand).replace(/<br>/g, ' '), level: 2 } });
      else {
        const style = ['unordered', 'ordered', 'checklist'][Math.floor(rand() * 3)];
        blocks.push(list(style, [inlineHtml(rand), inlineHtml(rand)]));
      }
    }
    const value = doc(...blocks);
    const markdown = renderMarkdown(value);
    const tokens = lexer(markdown).filter((token) => token.type !== 'space');
    const kept = value.blocks.filter((block) =>
      block.type === 'list' ? true : expected(block.data.text) !== ''
    );
    const label = `run ${run}: ${JSON.stringify(markdown)} ${JSON.stringify(blocks.map((b) => b.data))}`;
    assert.equal(tokens.length, kept.length, label);
    kept.forEach((block, index) => {
      const token = tokens[index];
      if (block.type === 'list') {
        assert.equal(token.type, 'list', label);
        assert.equal(token.ordered, block.data.style === 'ordered', label);
        assert.equal(token.items.length, block.data.items.length, label);
        block.data.items.forEach((item, at) => {
          // An empty task item (`- [ ]` without text) is plain text in GFM; nothing to keep there.
          if (!expected(item.content)) return;
          assert.equal(token.items[at].task, block.data.style === 'checklist', label);
          const inline = token.items[at].tokens.flatMap((t) =>
            t.type === 'text' || t.type === 'paragraph' ? t.tokens || [] : []
          );
          assert.equal(actual(inline), expected(item.content), label);
        });
      } else {
        assert.equal(token.type, block.type === 'header' ? 'heading' : 'paragraph', label);
        assert.equal(actual(token.tokens), expected(block.data.text), label);
      }
    });
  }
});

/* ------------------------------------------------------- 2: <ol start> */

test('HTML <ol> without a valid start begins at 1; an explicit start is kept', () => {
  const start = (source) => htmlToBlocks(source, { parse }).blocks[0].data.meta.start;
  assert.equal(start('<ol><li>a</li><li>b</li></ol>'), 1);
  assert.equal(start('<ol start=""><li>a</li></ol>'), 1);
  assert.equal(start('<ol start="x"><li>a</li></ol>'), 1);
  assert.equal(start('<ol start="2.5"><li>a</li></ol>'), 1);
  assert.equal(start('<ol start="3"><li>a</li></ol>'), 3);
  assert.equal(start('<ol start="0"><li>a</li></ol>'), 0);
  // The renderers' own list round-trips.
  const value = doc(list('ordered', ['one', 'two']));
  const out = renderMarkdown(value);
  assert.equal(out, '1. one\n2. two');
  const fromHtml = htmlToBlocks('<ol class="mex-list"><li>one</li><li>two</li></ol>', { parse }).blocks[0];
  assert.deepEqual(fromHtml.data.meta, { start: 1, counterType: 'numeric' });
});

/* ------------------------------------------------------- 5: import fidelity */

test('display math round-trips through markdownToBlocks', () => {
  for (const tex of ['e=mc^2', '\\frac{a}{b}\n+ c', 'x = $5 + $$y']) {
    const out = renderMarkdown(doc({ type: 'math', data: { tex, display: true } }));
    const { blocks } = markdownToBlocks(out);
    assert.equal(blocks.length, 1, out);
    assert.equal(blocks[0].type, 'math');
    assert.deepEqual(blocks[0].data, { tex, display: true });
  }
  // Text that only looks like a dollar amount stays a paragraph.
  assert.equal(markdownToBlocks('It costs $$5 and $$6.').blocks[0].type, 'paragraph');
});

test('the quote figure HTML imports with its caption', () => {
  const { blocks } = htmlToBlocks(
    '<figure class="mex-quote"><blockquote>Quote <b>text</b></blockquote><figcaption>Ada</figcaption></figure>',
    { parse }
  );
  assert.deepEqual(
    blocks.map((b) => [b.type, b.data]),
    [['quote', { text: 'Quote <b>text</b>', caption: 'Ada', alignment: 'left' }]]
  );
  // Without a caption it is a plain quote.
  assert.deepEqual(htmlToBlocks('<figure><blockquote>Q</blockquote></figure>', { parse }).blocks[0].data, {
    text: 'Q',
    caption: '',
    alignment: 'left',
  });
});

test('nested checklists keep their nesting (list block, checklist style); flat ones stay checklists', () => {
  const nested = {
    style: 'checklist',
    meta: {},
    items: [
      {
        content: 'parent',
        meta: { checked: false },
        items: [{ content: 'child', meta: { checked: true }, items: [] }],
      },
    ],
  };
  const markdown = renderMarkdown(doc({ type: 'list', data: nested }));
  const fromMarkdown = markdownToBlocks(markdown).blocks;
  assert.deepEqual(
    fromMarkdown.map((b) => [b.type, b.data]),
    [['list', nested]]
  );
  const fromHtml = htmlToBlocks(
    '<ul><li><input type="checkbox"> parent<ul><li><input type="checkbox" checked> child</li></ul></li></ul>',
    { parse }
  ).blocks;
  assert.deepEqual(
    fromHtml.map((b) => [b.type, b.data]),
    [['list', nested]]
  );
  assert.equal(markdownToBlocks('- [ ] a\n- [x] b').blocks[0].type, 'checklist');
});

/* ------------------------------------------------------- 8: nesting guard */

test('pathologically nested Markdown is refused quickly (no list or quote recursion in marked)', () => {
  const deepList = Array.from({ length: 2000 }, (_, i) => `${' '.repeat(i * 2)}- x`).join('\n');
  let started = Date.now();
  let result = markdownToBlocks(deepList);
  assert.ok(Date.now() - started < 1000, 'deep list under a second');
  assert.equal(result.blocks.length, 0);
  assert.deepEqual(result.report.skipped, [{ reason: 'too-deep', count: 1 }]);

  started = Date.now();
  result = markdownToBlocks(`${'> '.repeat(50000)}x`);
  assert.ok(Date.now() - started < 1000, 'deep quote under a second');
  assert.deepEqual(result.report.skipped, [{ reason: 'too-deep', count: 1 }]);

  // Ordinary nesting (12 levels) and indented code inside fences still convert.
  const ok = Array.from({ length: 12 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n');
  assert.equal(markdownToBlocks(ok).blocks[0].type, 'list');
  const fenced = ['```', ...Array.from({ length: 200 }, (_, i) => `${' '.repeat(i)}- code`), '```'].join(
    '\n'
  );
  assert.equal(markdownToBlocks(fenced).blocks[0].type, 'code');
});

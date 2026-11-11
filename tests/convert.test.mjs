import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  htmlToBlocks,
  htmlToInline,
  markdownToBlocks,
  looksLikeMarkdown,
  strapiBlocksToEditor,
  isStrapiBlocks,
  parseHtmlWithHtmlparser2,
  toDocument,
} from '../shared/convert/index.mjs';
import { fromDomNode, parseHtmlWithDom } from '../shared/convert/dom-adapter.mjs';
import { BLOCK_POLICIES } from '../shared/sanitize-policy.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');

const fixture = (name) => readFileSync(new URL(`./fixtures/paste/${name}`, import.meta.url), 'utf8');
const expected = (name) => JSON.parse(fixture(`${name}.expected.json`));
const parse = parseHtmlWithHtmlparser2;
const strip = (blocks) => blocks.map(({ type, data }) => ({ type, data }));

/** Key-order and `<br />` independent form, to compare converter output with sanitised output. */
const canonical = (value) => {
  if (typeof value === 'string') return value.replace(/<br \/>/g, '<br>');
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
};

const CASES = {
  word: () => htmlToBlocks(fixture('word.html'), { parse }),
  gdocs: () => htmlToBlocks(fixture('gdocs.html'), { parse }),
  article: () => htmlToBlocks(fixture('article.html'), { parse }),
  readme: () => markdownToBlocks(fixture('readme.md'), { parse }),
  strapi: () => strapiBlocksToEditor(JSON.parse(fixture('strapi-blocks.json'))),
};

for (const [name, convert] of Object.entries(CASES)) {
  test(`${name}: exact blocks, idempotent ids, unchanged by the server sanitiser`, () => {
    const first = convert();
    assert.deepEqual(strip(first.blocks), expected(name));
    assert.deepEqual(convert(), first, 'same input gives the same output');
    for (const block of first.blocks) {
      assert.match(block.id, /^[A-Za-z0-9_-]{1,64}$/);
      assert.ok(Object.prototype.hasOwnProperty.call(BLOCK_POLICIES, block.type), block.type);
    }
    assert.equal(new Set(first.blocks.map((block) => block.id)).size, first.blocks.length);
    const cleaned = cleanEditorValue(toDocument(first.blocks));
    assert.deepEqual(canonical(cleaned.blocks), canonical(first.blocks));
  });
}

test('Word: titles, nested mso lists, list markers and local images', () => {
  const { blocks, report } = CASES.word();
  assert.deepEqual(
    blocks.slice(0, 2).map((block) => [block.type, block.data.level]),
    [
      ['header', 1],
      ['header', 2],
    ]
  );
  const [bullets, numbers] = blocks.filter((block) => block.type === 'list');
  assert.equal(bullets.data.style, 'unordered');
  assert.equal(bullets.data.items[0].items[0].content, 'North field');
  assert.equal(numbers.data.style, 'ordered');
  assert.ok(!JSON.stringify(blocks).includes('·'), 'list markers are removed');
  assert.ok(!JSON.stringify(blocks).includes('mso'), 'no Word styles');
  assert.deepEqual(
    report.images,
    [{ index: -1, src: '', kind: 'unsupported' }],
    'file: paths are not reported'
  );
});

test('Google Docs: guid wrapper is not bold, styled spans become marks, aria-level nests', () => {
  const { blocks, report } = CASES.gdocs();
  assert.equal(blocks[0].data.text, 'Release plan');
  assert.match(blocks[1].data.text, /^<b>Owner:<\/b> Team /);
  assert.match(blocks[1].data.text, /<s class="cdx-strikethrough">old<\/s><sup>2<\/sup>$/);
  assert.equal(blocks[2].data.items[0].items[0].content.startsWith('Review'), true);
  assert.deepEqual(report.images, [
    { index: 4, src: 'https://lh7-rt.googleusercontent.example/docsz/AD_synthetic', kind: 'remote' },
  ]);
});

test('generic HTML: report lists data, blob, iframe and form controls', () => {
  const { report } = CASES.article();
  const reasons = report.skipped.map((entry) => `${entry.reason}:${entry.tag || ''}`).sort();
  assert.deepEqual(reasons, [
    'image:data',
    'image:unsupported',
    'unsupported-element:button',
    'unsupported-element:iframe',
    'unsupported-element:input',
  ]);
  const data = report.images.find((image) => image.kind === 'data');
  assert.equal(data.index, -1);
  assert.match(data.src, /^data:image\/png/);
});

test('data images can be kept as placeholders for upload', () => {
  const { blocks, report } = htmlToBlocks('<p>a</p><img src="data:image/png;base64,AAAA" alt="x">', {
    parse,
    dataImages: 'placeholder',
  });
  assert.equal(blocks[1].type, 'image');
  assert.equal(blocks[1].data.file.url, '');
  assert.deepEqual(report.images[0].index, 1);
});

test('Markdown: raw HTML without a parser stays escaped text', () => {
  const { blocks } = markdownToBlocks('<img src=x onerror=alert(1)>\n\nok <span onclick="x">t</span>');
  assert.equal(blocks[0].data.text, '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(blocks[1].data.text, 'ok &lt;span onclick="x"&gt;t&lt;/span&gt;'.replace(/"/g, '&quot;'));
});

test('Markdown: entity-encoded javascript: links and images are refused', () => {
  const { blocks } = markdownToBlocks('[a](jav&#x61;script:alert(1)) [b](JAVASCRIPT:x) ![c](javascript:y)');
  assert.equal(blocks.length, 1);
  assert.ok(!/href/.test(blocks[0].data.text));
});

test('Markdown: video links as images become embeds; code without a known language is plain code', () => {
  const { blocks } = markdownToBlocks(
    '![v](https://youtu.be/dQw4w9WgXcQ)\n\n```\nplain\n```\n\n```not a lang!\nx\n```'
  );
  assert.equal(blocks[0].type, 'embed');
  assert.equal(blocks[0].data.embed, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.deepEqual(blocks[1], { ...blocks[1], type: 'code', data: { code: 'plain' } });
  assert.equal(blocks[2].type, 'codeFlask');
  assert.equal(blocks[2].data.language, 'not');
});

test('looksLikeMarkdown has few false positives', () => {
  assert.equal(looksLikeMarkdown('# Title\nText'), true);
  assert.equal(looksLikeMarkdown('- one\n- two'), true);
  assert.equal(looksLikeMarkdown('```js\nx\n```'), true);
  assert.equal(looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), true);
  assert.equal(looksLikeMarkdown('See [docs](https://example.com)\n- item'), true);
  assert.equal(looksLikeMarkdown('Dear team,\nthe meeting moved to 3 pm.\nThanks - Alex'), false);
  assert.equal(looksLikeMarkdown('Price: 5 - 10 EUR\nCall us at 555'), false);
  assert.equal(looksLikeMarkdown('one line # not a heading'), false);
  assert.equal(looksLikeMarkdown('**bold** only\nsecond line'), false);
  assert.equal(looksLikeMarkdown(42), false);
});

test('Strapi Blocks: detection, escaping and unsafe links', () => {
  const value = JSON.parse(fixture('strapi-blocks.json'));
  assert.equal(isStrapiBlocks(value), true);
  assert.equal(isStrapiBlocks([{ type: 'paragraph' }]), false);
  assert.equal(isStrapiBlocks({ blocks: [] }), false);
  const { blocks, report } = strapiBlocksToEditor(JSON.stringify(value));
  assert.equal(blocks[0].data.text, 'Strapi &lt;Blocks&gt;');
  assert.ok(!/href="javascript/i.test(JSON.stringify(blocks)));
  assert.deepEqual(report.skipped, [{ reason: 'unsupported-node', tag: 'unknown-node', count: 1 }]);
  assert.deepEqual(strapiBlocksToEditor('not json').blocks, []);
});

const XSS_HTML = [
  '<script>alert(1)</script><p>after</p>',
  '<img src=x onerror=alert(1)>',
  '<img src="javascript:alert(1)">',
  '<p onclick="alert(1)" style="background:url(javascript:alert(1))">click</p>',
  '<a href="javascript:alert(1)">js</a><a href="JaVaScRiPt:alert(1)">js2</a><a href="  javascript:alert(1)">js3</a>',
  '<a href="jav&#x09;ascript:alert(1)">tab</a><a href="data:text/html;base64,PHNjcmlwdD4=">data</a>',
  '<a href="vbscript:msgbox(1)">vb</a><a href="//evil.example/x">proto</a>',
  '<style>*{color:red}</style><p>styled</p>',
  '<iframe src="https://evil.example/frame"></iframe><iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">s</a></svg>',
  '<math><mi xlink:href="javascript:alert(1)">m</mi></math>',
  '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">b</button></form>',
  '<table><tr><td onmouseover="alert(1)"><img src=x onerror=alert(1)>cell</td></tr></table>',
  '<pre><code class="language-js" onclick="x">&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  '<p><b>a</b><!--<script>alert(1)</script>--></p>',
  '<template><script>alert(1)</script></template><noscript><img src=x onerror=alert(1)></noscript>',
  '<base href="javascript:alert(1)//"><meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<p><span style="font-weight:bold" onmouseover="alert(1)">x</span></p>',
  '<div><<script>script>alert(1)<</script>/script></div>',
  '<ul><li><input type="checkbox" onfocus="alert(1)" autofocus> t</li></ul>',
  '<blockquote cite="javascript:alert(1)">q</blockquote>',
  '<figure><img src="https://example.com/a.png" alt="&quot; onerror=&quot;alert(1)"><figcaption><img src=x onerror=alert(1)>c</figcaption></figure>',
];

const XSS_MARKDOWN = [
  '<script>alert(1)</script>',
  '[x](javascript:alert(1))',
  '[x](<javascript:alert(1)>)',
  '![x](javascript:alert(1))',
  '<a href="javascript:alert(1)">x</a>',
  '<img src=x onerror=alert(1)>',
  '`<script>`',
  '| <script>alert(1)</script> | x |\n|---|---|\n| [a](javascript:x) | b |',
  '> <iframe src="https://evil.example"></iframe>',
  '- [x] <b onclick=alert(1)>t</b>',
  '[a](data:text/html,<script>alert(1)</script>)',
  '<https://example.com/"onmouseover="alert(1)>',
];

/** No executable markup: no script/style/iframe/svg tags, no event handlers, no javascript:/data: URLs. */
const assertInert = (value, label) => {
  // Code blocks hold plain text that every renderer escapes; they are checked separately.
  const blocks = Array.isArray(value) ? value : value && Array.isArray(value.blocks) ? value.blocks : null;
  const text = JSON.stringify(
    blocks ? blocks.filter((block) => block.type !== 'code' && block.type !== 'codeFlask') : value
  );
  assert.ok(
    !/<\s*(script|style|iframe|svg|math|object|embed|form|input|button|base|meta|template)\b/i.test(text),
    `${label}: tag in ${text}`
  );
  assert.ok(!/<[^>]*\son[a-z]+\s*=/i.test(text), `${label}: event handler in ${text}`);
  assert.ok(
    !/<[^>]*\b(href|src)=\\"\s*(javascript|vbscript|data):/i.test(text),
    `${label}: unsafe URL in ${text}`
  );
  assert.ok(!/\bstyle=/i.test(text), `${label}: style attribute in ${text}`);
};

test('XSS corpus: converter output and sanitised output are inert', () => {
  for (const html of XSS_HTML) {
    const { blocks } = htmlToBlocks(html, { parse, dataImages: 'placeholder' });
    assertInert(blocks, html);
    assertInert(cleanEditorValue(toDocument(blocks)), html);
    for (const block of blocks) {
      if (block.type === 'embed')
        assert.match(block.data.embed, /^https:\/\/(www\.youtube\.com|player\.vimeo\.com)\//);
      if (block.type === 'image') assert.match(block.data.file.url, /^(https?:\/\/|\/(?!\/)|$)/);
      if (block.type === 'codeFlask' || block.type === 'code')
        assert.equal(Object.keys(block.data).includes('html'), false);
    }
    assertInert(htmlToInline(html, parse), html);
  }
  for (const markdown of XSS_MARKDOWN) {
    for (const options of [{}, { parse }]) {
      const { blocks } = markdownToBlocks(markdown, options);
      assertInert(blocks, markdown);
      assertInert(cleanEditorValue(toDocument(blocks)), markdown);
    }
  }
  const strapi = strapiBlocksToEditor([
    { type: 'paragraph', children: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    {
      type: 'paragraph',
      children: [{ type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'x' }] }],
    },
    { type: 'image', image: { url: 'javascript:alert(1)' }, children: [] },
    { type: 'heading', level: 99, children: [{ type: 'text', text: 'h', bold: 'yes' }] },
  ]);
  assertInert(strapi.blocks, 'strapi');
  assert.equal(strapi.blocks[0].data.text, '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(strapi.blocks[2].data.level, 6);
});

test('limits: oversized input and block cap', () => {
  const big = htmlToBlocks('x'.repeat(5 * 1024 * 1024 + 1), { parse });
  assert.deepEqual(big.blocks, []);
  assert.equal(big.report.skipped[0].reason, 'too-large');
  const many = markdownToBlocks(Array.from({ length: 5010 }, (_, i) => `p${i}`).join('\n\n'));
  assert.equal(many.blocks.length, 5000);
  assert.equal(many.report.skipped[0].reason, 'too-many-blocks');
  const deep = htmlToBlocks(`${'<div>'.repeat(500)}deep${'</div>'.repeat(500)}`, { parse });
  assert.ok(Array.isArray(deep.blocks));
  assert.throws(() => htmlToBlocks('<p>x</p>'), TypeError);
});

test('DOM adapter maps nodes like the htmlparser2 adapter', () => {
  const el = (name, attributes, childNodes) => ({
    nodeType: 1,
    nodeName: name.toUpperCase(),
    attributes: Object.entries(attributes).map(([key, value]) => ({ name: key, value })),
    childNodes,
  });
  const text = (value) => ({ nodeType: 3, nodeValue: value });
  const node = el('P', { CLASS: 'MsoNormal' }, [
    text('Hi '),
    el('b', {}, [text('there')]),
    { nodeType: 8, nodeValue: 'c' },
  ]);
  assert.deepEqual(fromDomNode(node), {
    type: 'element',
    name: 'p',
    attribs: { class: 'MsoNormal' },
    children: [
      { type: 'text', data: 'Hi ' },
      { type: 'element', name: 'b', attribs: {}, children: [{ type: 'text', data: 'there' }] },
      { type: 'comment', data: 'c' },
    ],
  });
  class FakeParser {
    parseFromString() {
      return { body: { childNodes: [node] } };
    }
  }
  const nodes = parseHtmlWithDom('<p>ignored</p>', FakeParser);
  assert.equal(htmlToBlocks('x', { parse: () => nodes }).blocks[0].data.text, 'Hi <b>there</b>');
});

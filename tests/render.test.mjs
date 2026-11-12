import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderHtml,
  renderText,
  renderMarkdown,
  inlineToHtml,
  inlineToText,
  escapeMarkdown,
} from '../shared/render/index.mjs';
import { INLINE_TAGS } from '../shared/sanitize-policy.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ALL = fixture('editor-2x-all-blocks.json');
const LEGACY = fixture('editor-1x-string.json');
const doc = (...blocks) => ({ blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })) });
const one = (type, data, tunes) => doc({ type, data, ...(tunes ? { tunes } : {}) });

test('empty, null and invalid input render as empty strings', () => {
  for (const value of [null, undefined, '', { blocks: [] }, 42, { blocks: 'x' }, '   ']) {
    assert.equal(renderHtml(value), '');
    assert.equal(renderText(value), '');
    assert.equal(renderMarkdown(value), '');
  }
});

test('output is deterministic', () => {
  for (const render of [renderHtml, renderText, renderMarkdown]) {
    assert.equal(render(ALL), render(JSON.parse(JSON.stringify(ALL))));
    assert.equal(render(LEGACY), render(LEGACY));
  }
});

test('1.x JSON strings render like objects', () => {
  const html = renderHtml(LEGACY);
  assert.match(html, /<h2 class="mex-header">Legacy title<\/h2>/);
  assert.match(html, /<ul class="mex-list"><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol class="mex-list"><li>x<ol><li>y<\/li><\/ol><\/li><\/ol>/);
  assert.match(renderMarkdown(LEGACY), /^## Legacy title\n\nOld \*\*content\*\* without ids/);
});

test('paragraph and header with tunes', () => {
  const html = renderHtml(
    one(
      'paragraph',
      { text: 'Hi <b>you</b>' },
      {
        alignmentTune: { alignment: 'center' },
        textVariant: 'call-out',
        indentTune: { indentLevel: 2 },
      }
    )
  );
  assert.equal(
    html,
    '<p class="mex-paragraph mex-align-center mex-variant-call-out mex-indent-2">Hi <b>you</b></p>'
  );
  assert.equal(renderHtml(one('header', { text: 'T', level: 3 })), '<h3 class="mex-header">T</h3>');
  assert.equal(renderHtml(one('header', { text: 'T', level: 9 })), '<h2 class="mex-header">T</h2>');
  assert.equal(renderText(one('header', { text: 'A &amp; <i>B</i>', level: 1 })), 'A & B');
  assert.equal(renderMarkdown(one('header', { text: 'A <b>B</b><br>C', level: 4 })), '#### A **B** C');
});

test('inline marks in all formats', () => {
  const text =
    '<b>b</b> <strong>s</strong> <i>i</i> <em>e</em> <u class="cdx-underline">u</u> <s class="cdx-strikethrough">s</s> <mark class="cdx-marker">m</mark> <code class="inline-code">c`d</code> <span class="cdx-tooltip" data-tooltip="hint">t</span> <sub>2</sub><sup>3</sup>';
  const html = renderHtml(one('paragraph', { text }));
  for (const tag of ['b', 'strong', 'i', 'em', 'u', 's', 'mark', 'code', 'span', 'sub', 'sup'])
    assert.match(html, new RegExp(`<${tag}[ >]`));
  assert.match(html, /<span class="cdx-tooltip" data-tooltip="hint">t<\/span>/);
  assert.equal(renderMarkdown(one('paragraph', { text })), '**b** **s** _i_ _e_ u ~~s~~ m ``c`d`` t 23');
  assert.equal(renderText(one('paragraph', { text })), 'b s i e u s m c`d t 23');
});

test('markdown escapes text that would create structure', () => {
  const md = renderMarkdown(
    one('paragraph', { text: '# not a heading<br>- not a list<br>1. no *star* [x](y) <b>|</b> &lt;tag&gt;' })
  );
  assert.equal(md, '\\# not a heading\\\n\\- not a list\\\n1\\. no \\*star\\* \\[x\\](y) **\\|** \\<tag\\>');
  assert.equal(escapeMarkdown('a_b'), 'a\\_b');
});

test('links: target _blank gets rel, internal links resolve at render time', () => {
  const text =
    '<a href="/articles/abc" data-mex-uid="api::article.article" data-mex-document-id="abc" data-mex-locale="en">A</a> <a href="https://x.example.test" target="_blank" rel="author">B</a>';
  const plain = renderHtml(one('paragraph', { text }));
  assert.match(
    plain,
    /<a href="\/articles\/abc" data-mex-uid="api::article.article" data-mex-document-id="abc" data-mex-locale="en">A<\/a>/
  );
  assert.match(
    plain,
    /<a href="https:\/\/x.example.test" target="_blank" rel="author noopener noreferrer">B<\/a>/
  );
  const refs = [];
  const resolved = renderHtml(one('paragraph', { text }), {
    links: (ref) => {
      refs.push(ref);
      return `/en/articles/new-slug`;
    },
  });
  assert.deepEqual(refs, [
    { uid: 'api::article.article', documentId: 'abc', locale: 'en', href: '/articles/abc' },
  ]);
  assert.match(resolved, /href="\/en\/articles\/new-slug"/);
  assert.match(
    renderMarkdown(one('paragraph', { text }), { links: () => '/n' }),
    /^\[A\]\(\/n\) \[B\]\(https:\/\/x.example.test\)$/
  );
  // false drops the link, unsafe results keep the stored href, throwing resolvers are ignored.
  assert.equal(
    renderHtml(one('paragraph', { text: text.split(' <a')[0] }), { links: () => false }),
    '<p class="mex-paragraph">A</p>'
  );
  assert.match(
    renderHtml(one('paragraph', { text }), { links: () => 'javascript:alert(1)' }),
    /href="\/articles\/abc"/
  );
  assert.match(
    renderHtml(one('paragraph', { text }), {
      links: () => {
        throw new Error('x');
      },
    }),
    /href="\/articles\/abc"/
  );
});

test('lists: nested, ordered start and counter type, legacy strings, checklist style', () => {
  const ordered = one('list', {
    style: 'ordered',
    meta: { start: 3, counterType: 'upper-alpha' },
    items: [
      { content: 'a', items: [{ content: 'b', items: [] }] },
      { content: 'c', items: [] },
    ],
  });
  assert.equal(
    renderHtml(ordered),
    '<ol class="mex-list" start="3" type="A"><li>a<ol><li>b</li></ol></li><li>c</li></ol>'
  );
  assert.equal(renderText(ordered), '3. a\n  1. b\n4. c');
  assert.equal(renderMarkdown(ordered), '3. a\n   1. b\n4. c');
  const check = one('list', {
    style: 'checklist',
    items: [
      { content: 'x', meta: { checked: true }, items: [] },
      { content: 'y', meta: { checked: false }, items: [] },
    ],
  });
  assert.match(
    renderHtml(check),
    /<ul class="mex-list mex-checklist"><li class="mex-checklist-item" data-checked="true"><input type="checkbox" disabled checked aria-label="done"> x<\/li>/
  );
  assert.equal(renderMarkdown(check), '- [x] x\n- [ ] y');
  assert.equal(renderText(check), '[x] x\n[ ] y');
  assert.equal(renderMarkdown(one('list', { style: 'unordered', items: ['p', 'q'] })), '- p\n- q');
});

test('checklist block', () => {
  const block = one('checklist', { items: [{ text: 'a', checked: true }, { text: 'b' }] });
  assert.match(
    renderHtml(block),
    /data-checked="true"><input type="checkbox" disabled checked aria-label="done"> a<\/li><li class="mex-checklist-item" data-checked="false">/
  );
  assert.equal(renderMarkdown(block), '- [x] a\n- [ ] b');
  assert.equal(renderText(block), '[x] a\n[ ] b');
});

test('quote, warning, alert', () => {
  const quote = one('quote', { text: 'Q<br>R', caption: 'C', alignment: 'center' });
  assert.equal(
    renderHtml(quote),
    '<figure class="mex-quote mex-align-center"><blockquote>Q<br>R</blockquote><figcaption>C</figcaption></figure>'
  );
  assert.equal(renderMarkdown(quote), '> Q\\\n> R\n>\n> — C');
  assert.equal(renderText(quote), 'Q\nR\n— C');
  const warning = one('warning', { title: 'T', message: 'M' });
  assert.equal(
    renderHtml(warning),
    '<aside class="mex-warning" role="note"><p class="mex-warning-title"><strong>T</strong></p><p class="mex-warning-message">M</p></aside>'
  );
  assert.equal(renderMarkdown(warning), '> **T**\n>\n> M');
  const alert = one('alert', { type: 'danger', align: 'center', message: 'Careful' });
  assert.equal(
    renderHtml(alert),
    '<div class="mex-alert mex-alert-danger mex-align-center" role="note">Careful</div>'
  );
  assert.equal(
    renderHtml(one('alert', { type: 'evil" onclick="x', message: 'm' })),
    '<div class="mex-alert mex-alert-info" role="note">m</div>'
  );
  assert.equal(renderText(alert), 'Careful');
});

test('toggle groups its child blocks', () => {
  const value = doc(
    { type: 'toggle', data: { text: 'More', status: 'closed', items: 2 } },
    { type: 'paragraph', data: { text: 'one' } },
    { type: 'paragraph', data: { text: 'two' } },
    { type: 'paragraph', data: { text: 'after' } }
  );
  assert.equal(
    renderHtml(value),
    '<details class="mex-toggle"><summary>More</summary><p class="mex-paragraph">one</p>\n<p class="mex-paragraph">two</p></details>\n<p class="mex-paragraph">after</p>'
  );
  assert.match(
    renderHtml(one('toggle', { text: 'Open', status: 'open', items: 5 })),
    /<details class="mex-toggle" open><summary>Open<\/summary><\/details>/
  );
  assert.equal(renderMarkdown(value), '**More**\n\none\n\ntwo\n\nafter');
  assert.equal(renderText(value), 'More\n\none\n\ntwo\n\nafter');
});

test('code blocks are escaped and fences grow', () => {
  const code = one('code', { code: '<script>alert(1)</script>\n```' });
  assert.equal(
    renderHtml(code),
    '<pre class="mex-code"><code>&lt;script&gt;alert(1)&lt;/script&gt;\n```</code></pre>'
  );
  assert.equal(renderMarkdown(code), '````\n<script>alert(1)</script>\n```\n````');
  const flask = one('codeFlask', { code: 'x', language: 'python' });
  assert.equal(
    renderHtml(flask),
    '<pre class="mex-code" data-language="python"><code class="language-python">x</code></pre>'
  );
  assert.equal(renderMarkdown(flask), '```python\nx\n```');
  assert.equal(renderText(flask), 'x');
});

test('raw HTML is omitted unless allowed with a sanitiser', () => {
  const raw = one('raw', { html: '<div onclick="x">Hi</div>' });
  assert.equal(renderHtml(raw), '');
  assert.equal(renderHtml(raw, { rawHtml: 'allow' }), '');
  assert.equal(renderMarkdown(raw), '');
  assert.equal(renderText(raw), '');
  const sanitizeRaw = (html) => html.replace(/ on\w+="[^"]*"/g, '');
  assert.equal(
    renderHtml(raw, { rawHtml: 'allow', sanitizeRaw }),
    '<div class="mex-raw"><div>Hi</div></div>'
  );
  assert.equal(renderMarkdown(raw, { rawHtml: 'allow', sanitizeRaw }), '<div>Hi</div>');
});

test('tables', () => {
  const table = one('table', {
    withHeadings: true,
    content: [
      ['A', 'B|C'],
      ['1<br>x', '<b>2</b>'],
    ],
  });
  assert.equal(
    renderHtml(table),
    '<table class="mex-table"><thead><tr><th scope="col">A</th><th scope="col">B|C</th></tr></thead><tbody><tr><td>1<br>x</td><td><b>2</b></td></tr></tbody></table>'
  );
  assert.equal(renderMarkdown(table), '| A | B\\|C |\n| --- | --- |\n| 1 x | **2** |');
  assert.equal(renderText(table), 'A\tB|C\n1 x\t2');
  const plain = one('table', { withHeadings: false, content: [['a', 'b']] });
  assert.equal(
    renderHtml(plain),
    '<table class="mex-table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'
  );
  assert.equal(renderMarkdown(plain), '|   |   |\n| --- | --- |\n| a | b |');
  assert.equal(renderHtml(one('table', { content: [] })), '');
});

test('images: alt, decorative, srcset from formats, media hook', () => {
  const html = renderHtml(ALL);
  assert.match(
    html,
    /<figure class="mex-image mex-image-border"><img src="https:\/\/cdn.example.test\/uploads\/valley.jpg" alt="A green valley" width="1600" height="900" srcset="https:\/\/cdn.example.test\/uploads\/thumbnail_valley.jpg 245w, https:\/\/cdn.example.test\/uploads\/small_valley.jpg 500w, https:\/\/cdn.example.test\/uploads\/large_valley.jpg 1000w, https:\/\/cdn.example.test\/uploads\/valley.jpg 1600w" sizes="100vw" loading="lazy" decoding="async"><figcaption>The valley at <i>dawn<\/i><\/figcaption><\/figure>/
  );
  assert.match(html, /<img src="https:\/\/cdn.example.test\/uploads\/divider.png" alt="" loading/);
  const md = renderMarkdown(ALL);
  assert.match(
    md,
    /!\[A green valley\]\(https:\/\/cdn.example.test\/uploads\/valley.jpg "The valley at dawn"\)/
  );
  assert.match(md, /!\[\]\(https:\/\/cdn.example.test\/uploads\/divider.png\)/);
  const hooked = renderHtml(
    one('image', { file: { url: 'https://a.example.test/x.png', id: 7, alt: 'old' }, caption: '' }),
    {
      media: (file) => ({ ...file, url: 'https://cdn.example.test/new.png', alt: 'New alt' }),
      imageSizes: '(min-width: 800px) 800px, 100vw',
    }
  );
  assert.match(hooked, /src="https:\/\/cdn.example.test\/new.png" alt="New alt"/);
  const unsafeHook = renderHtml(one('image', { file: { url: 'https://a.example.test/x.png' } }), {
    media: () => ({ url: 'javascript:alert(1)' }),
  });
  assert.equal(unsafeHook, '');
  assert.equal(renderHtml(one('image', { file: { url: 'data:image/png;base64,AAAA' } })), '');
  assert.equal(
    renderText(one('image', { file: { url: 'https://a.example.test/x.png', alt: 'Alt only' }, caption: '' })),
    'Alt only'
  );
  assert.match(
    renderHtml(one('simpleImage', { url: 'https://a.example.test/s.png', caption: 'Cap' })),
    /<img src="https:\/\/a.example.test\/s.png" alt="Cap"/
  );
  assert.equal(
    renderMarkdown(one('simpleImage', { url: 'https://a.example.test/s.png', caption: 'Cap' })),
    '![Cap](https://a.example.test/s.png)'
  );
});

test('link preview, attachment, personality, button, delimiter', () => {
  const html = renderHtml(ALL);
  assert.match(
    html,
    /<div class="mex-link-preview"><a href="https:\/\/www.example.test\/post" rel="nofollow noopener noreferrer"><img class="mex-link-image" src="https:\/\/www.example.test\/og.png" alt="" loading="lazy"><span class="mex-link-title">A post<\/span>/
  );
  assert.match(
    html,
    /<p class="mex-attachment"><a href="https:\/\/cdn.example.test\/report.pdf" download>Annual report<\/a> <span class="mex-attachment-meta">\(PDF, 20.0 KB\)<\/span><\/p>/
  );
  assert.match(html, /<p class="mex-personality-name">Ada Example<\/p>/);
  assert.match(
    html,
    /<a class="mex-button mex-button-secondary" href="https:\/\/www.example.test\/signup" target="_blank" rel="noopener noreferrer">Sign up<\/a>/
  );
  assert.match(html, /<hr class="mex-delimiter">/);
  const md = renderMarkdown(ALL);
  assert.match(md, /\[A post\]\(https:\/\/www.example.test\/post\)/);
  assert.match(md, /\[Annual report\]\(https:\/\/cdn.example.test\/report.pdf\)/);
  assert.match(
    md,
    /\*\*Ada Example\*\*\n\nEngineer\n\n\[https:\/\/www.example.test\/ada\]\(https:\/\/www.example.test\/ada\)/
  );
  assert.match(md, /\[Sign up\]\(https:\/\/www.example.test\/signup\)/);
  assert.match(md, /\n\n---\n\n/);
  const text = renderText(ALL);
  assert.match(text, /Sign up \(https:\/\/www.example.test\/signup\)/);
  assert.equal(
    renderHtml(one('button', { text: 'B', link: 'javascript:x' })),
    '<p class="mex-button-block"><span class="mex-button mex-button-primary">B</span></p>'
  );
});

test('embeds: iframe only for allowed https hosts', () => {
  const html = renderHtml(ALL);
  assert.match(
    html,
    /<figure class="mex-embed mex-embed-youtube"><iframe src="https:\/\/www.youtube.com\/embed\/abc123" title="A video" width="580" height="320" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen><\/iframe><figcaption>A video<\/figcaption><\/figure>/
  );
  assert.match(
    html,
    /<p class="mex-embed mex-embed-link"><a href="https:\/\/media.example.test\/x" rel="nofollow noopener noreferrer">https:\/\/media.example.test\/x<\/a><\/p>/
  );
  const custom = renderHtml(
    one('embed', {
      service: 'x',
      source: 'https://m.example.test',
      embed: 'https://m.example.test/e',
      caption: '',
    }),
    {
      embedHosts: ['m.example.test'],
    }
  );
  assert.match(custom, /<iframe src="https:\/\/m.example.test\/e"/);
  assert.doesNotMatch(
    renderHtml(one('embed', { embed: 'http://www.youtube.com/embed/x', source: '' })),
    /iframe/
  );
  assert.match(renderMarkdown(ALL), /\[A video\]\(https:\/\/www.youtube.com\/watch\?v=abc123\)/);
});

test('custom blocks render neutrally with escaped values, overrides replace any type', () => {
  const html = renderHtml(ALL);
  assert.match(
    html,
    /<div class="mex-block mex-productCard" data-mex-block="productCard"><div class="mex-field" data-mex-field="title">Lamp X<\/div><div class="mex-field" data-mex-field="price">19<\/div><div class="mex-field" data-mex-field="url">https:\/\/shop.example.test\/lamp<\/div><\/div>/
  );
  const out = renderHtml(ALL, {
    overrides: {
      productCard: (block, h) => `<article>${h.escape(h.text(block.data.title))}</article>`,
      paragraph: (block, h) => (block.id === 'p2' ? `<p>${h.inline(block.data.text)}</p>` : undefined),
      toggle: (block, h) => `<section>${h.renderChildren(block.children)}</section>`,
    },
  });
  assert.match(out, /<article>Lamp X<\/article>/);
  assert.match(
    out,
    /<p>External <a href="https:\/\/www.example.test\/docs\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">docs<\/a>/
  );
  assert.match(
    out,
    /<section><p class="mex-paragraph">Hidden one<\/p>\n<p class="mex-paragraph">Hidden two<\/p><\/section>/
  );
  assert.equal(renderMarkdown(one('hero', { title: '<b>Big</b> *deal*' })), '**Big** \\*deal\\*');
  assert.equal(renderText(one('hero', { title: '<b>Big</b>', n: 1 })), 'Big\n1');
  assert.equal(renderText(ALL, { overrides: { delimiter: () => '***' } }).includes('***'), true);
  assert.equal(
    renderHtml(one('x', {}), { overrides: { __proto__: () => 'bad' } }),
    '<div class="mex-block mex-x" data-mex-block="x"></div>'
  );
});

test('full fixture renders every block type in all formats', () => {
  const html = renderHtml(ALL);
  for (const marker of [
    'mex-header',
    'mex-paragraph',
    'mex-list',
    'mex-checklist',
    'mex-quote',
    'mex-warning',
    'mex-alert',
    'mex-toggle',
    'mex-code',
    'mex-table',
    'mex-image',
    'mex-link-preview',
    'mex-attachment',
    'mex-embed',
    'mex-personality',
    'mex-button',
    'mex-delimiter',
  ])
    assert.ok(html.includes(marker), marker);
  assert.ok(!html.includes('mex-raw'));
  const text = renderText(ALL);
  assert.ok(text.startsWith('Field notes from Example Valley\n\nRead the earlier report, then bold'));
  assert.ok(!/[<>]/.test(text.replace(/<b>|const x = '<b>'/g, '')));
});

/* --------------------------------------------------------------- XSS corpus */

const XSS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//x.example.test/x.js></SCRIPT>',
  '<scr<script>ipt>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<b onmouseover="alert(1)">x</b>',
  '<b/onmouseover=alert(1)>x</b>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="java&#x09;script:alert(1)">x</a>',
  '<a href="java&#9;script:alert(1)">x</a>',
  '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>',
  '<a href="&#x6A;avascript&colon;alert(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="\u0001javascript:alert(1)">x</a>',
  '<a href="java\nscript:alert(1)">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="//evil.example.test">x</a>',
  '<a href="https://ok.example.test" onclick="alert(1)">x</a>',
  '<a href="https://ok.example.test"" onclick="alert(1)">x</a>',
  `<a href='https://ok.example.test' title='a" onmouseover="alert(1)'>x</a>`,
  '<a href=https://ok.example.test/ onfocus=alert(1) autofocus>x</a>',
  '<svg><script>alert(1)</script></svg>',
  '<svg onload=alert(1)>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<style>*{background:url(javascript:alert(1))}</style>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<textarea></textarea><script>alert(1)</script>',
  '</textarea><script>alert(1)</script>',
  '<!--<script>alert(1)</script>-->',
  '<!-- --!><script>alert(1)</script> -->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<?xml version="1.0"?><script>alert(1)</script>',
  '<b>unclosed <i>tags <a href="https://ok.example.test">',
  '<b',
  '<a href="https://ok.example.test',
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
  '<span style="background:url(javascript:alert(1))" class="cdx-tooltip evil">x</span>',
  '<code class="inline-code" onmouseover=alert(1)>x</code>',
  '<form action="javascript:alert(1)"><button>x</button></form>',
  '<details open ontoggle=alert(1)>',
  '<base href="javascript:alert(1)//">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<template><script>alert(1)</script></template>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<a href="https://ok.example.test" data-mex-uid="api::a.a" data-mex-document-id="x" onclick=alert(1)>x</a>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058alert(1)">x</a>',
  '<a href="https://ok.example.test" target="javascript:alert(1)">x</a>',
];

const ALLOWED_OUTPUT_TAGS = new Set([
  ...INLINE_TAGS,
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'figure',
  'figcaption',
  'blockquote',
  'ul',
  'ol',
  'li',
  'input',
  'aside',
  'div',
  'details',
  'summary',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'hr',
  'iframe',
]);

const assertSafeHtml = (html, label) => {
  assert.doesNotMatch(html, /<script/i, label);
  for (const frame of html.matchAll(/<iframe\b[^>]*>/gi))
    assert.match(frame[0], /^<iframe src="https:\/\/www\.youtube\.com\/embed\/1" /, label);
  assert.doesNotMatch(
    html,
    /<(svg|math|style|object|embed|form|base|meta|textarea|template|noscript)\b/i,
    label
  );
  assert.doesNotMatch(html, /(href|src|srcset)="\s*(javascript|data|vbscript):/i, label);
  assert.doesNotMatch(html, /(href|src)="\/\//i, label);
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g))
    assert.ok(ALLOWED_OUTPUT_TAGS.has(match[1].toLowerCase()), `${label}: tag ${match[1]}`);
  // Every attribute value is quoted and the quotes are balanced.
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const withoutValues = tag[0].replace(/="[^"]*"/g, '');
    assert.doesNotMatch(withoutValues, /["'=]/, `${label}: ${tag[0]}`);
    assert.doesNotMatch(withoutValues, /\son[a-z]+/i, `${label}: ${tag[0]}`);
  }
};

test('XSS corpus: no executable HTML in any text-bearing field', () => {
  for (const payload of XSS) {
    const value = doc(
      { type: 'paragraph', data: { text: payload } },
      { type: 'header', data: { text: payload, level: 2 } },
      { type: 'quote', data: { text: payload, caption: payload } },
      {
        type: 'list',
        data: {
          style: 'unordered',
          items: [payload, { content: payload, items: [{ content: payload, items: [] }] }],
        },
      },
      { type: 'checklist', data: { items: [{ text: payload, checked: true }] } },
      { type: 'warning', data: { title: payload, message: payload } },
      { type: 'alert', data: { type: payload, align: payload, message: payload } },
      { type: 'toggle', data: { text: payload, items: 0 } },
      { type: 'code', data: { code: payload } },
      { type: 'codeFlask', data: { code: payload, language: payload } },
      { type: 'raw', data: { html: payload } },
      {
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [payload, payload],
            [payload, payload],
          ],
        },
      },
      {
        type: 'image',
        data: {
          file: {
            url: 'https://ok.example.test/i.png',
            alt: payload,
            formats: { small: { url: payload, width: 3 } },
          },
          caption: payload,
        },
      },
      { type: 'image', data: { file: { url: payload, alt: payload }, caption: payload } },
      { type: 'simpleImage', data: { url: payload, caption: payload } },
      {
        type: 'linkTool',
        data: {
          link: payload,
          meta: { title: payload, description: payload, site_name: payload, image: { url: payload } },
        },
      },
      {
        type: 'linkTool',
        data: {
          link: 'https://ok.example.test',
          meta: { title: payload, description: payload, site_name: payload },
        },
      },
      {
        type: 'attaches',
        data: {
          file: { url: 'https://ok.example.test/f.pdf', name: payload, extension: payload },
          title: payload,
        },
      },
      { type: 'embed', data: { service: payload, source: payload, embed: payload, caption: payload } },
      {
        type: 'embed',
        data: {
          service: 'youtube',
          source: 'https://www.youtube.com/watch?v=1',
          embed: 'https://www.youtube.com/embed/1',
          caption: payload,
        },
      },
      { type: 'personality', data: { name: payload, description: payload, link: payload, photo: payload } },
      { type: 'button', data: { text: payload, link: payload, style: payload } },
      { type: 'custom-x', data: { title: payload, url: payload, nested: { a: payload } } }
    );
    const html = renderHtml(value, { links: () => payload });
    assertSafeHtml(html, payload);
    assertSafeHtml(renderHtml(value, { rawHtml: 'allow' }), payload);
    assertSafeHtml(inlineToHtml(payload), payload);
    // Code blocks may contain any text inside their fences; everything else must be escaped.
    const md = renderMarkdown(value)
      .replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, '')
      .replace(/\\</g, '');
    assert.doesNotMatch(md, /<script/i, payload);
    assert.doesNotMatch(md, /\]\(\s*(javascript|data|vbscript):/i, payload);
    assert.doesNotMatch(md, /<[a-z!/?]/i, payload);
    assert.equal(typeof renderText(value), 'string');
  }
});

test('inline helpers', () => {
  assert.equal(inlineToText('a&nbsp;&amp;&#x41;&#66;<br>b &unknown;'), 'a &AB\nb &unknown;');
  assert.equal(inlineToHtml('a &unknown; < b'), 'a &amp;unknown; &lt; b');
  assert.equal(inlineToHtml('<b><i>x</b>y</i>'), '<b><i>x</i></b>y');
  assert.equal(
    inlineToHtml('<a href="https://ok.example.test" target="_blank">x</a>'),
    '<a href="https://ok.example.test" target="_blank" rel="noopener noreferrer">x</a>'
  );
  assert.equal(inlineToHtml('<a>no href</a>'), 'no href');
  assert.equal(inlineToHtml('x'.repeat(10)), 'xxxxxxxxxx');
  const deep = '<b>'.repeat(5000) + 'x';
  assert.ok(inlineToHtml(deep).includes('x'));
});

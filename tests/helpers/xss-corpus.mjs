/**
 * XSS payloads shared by the HTML renderer tests and the React/Vue parity
 * tests, plus the tags the renderers may output.
 */

import assert from 'node:assert/strict';
import { INLINE_TAGS } from '../../shared/sanitize-policy.mjs';
import { escapeHtml } from '../../shared/render/nodes.mjs';

export const XSS = [
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
  '<a href="/x" data-mex-uid="api::a.a" data-mex-document-id="x" data-mex-mention="true" class="evil" onclick=alert(1)><img src=x onerror=alert(1)>m</a>',
  '<a href="javascript:alert(1)" data-mex-uid="api::a.a" data-mex-document-id="x" data-mex-mention>m</a>',
  '<span data-mex-mention="true" data-mex-uid="api::a.a" data-mex-document-id="x">not a link</span>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058alert(1)">x</a>',
  '<a href="https://ok.example.test" target="javascript:alert(1)">x</a>',
  // 2.4: inline math and footnote markers.
  '<span data-mex-math onclick="alert(1)" class="cdx-tooltip">x<img src=x onerror=alert(1)></span>',
  '<span data-mex-math="true">&lt;/span&gt;&lt;script&gt;alert(1)&lt;/script&gt;</span>',
  '<span data-mex-math>\\href{javascript:alert(1)}{x}\\url{javascript:alert(1)}</span>',
  '<sup data-mex-footnote="a" data-mex-note="&lt;img src=x onerror=alert(1)&gt;&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;" onclick="alert(1)">1</sup>',
  '<sup data-mex-footnote="a&quot; onclick=&quot;alert(1)">1</sup>',
  '<sup data-mex-footnote="ok" data-mex-note="&lt;sup data-mex-footnote=&quot;in&quot; data-mex-note=&quot;&amp;lt;script&amp;gt;&quot;&gt;2&lt;/sup&gt;">1</sup>',
];

/** TeX payloads for the math renderer (2.4). */
export const TEX_XSS = [
  '\\href{javascript:alert(1)}{x}',
  '\\url{javascript:alert(1)}',
  '\\htmlClass{evil}{x}',
  '\\class{evil}{x}',
  '\\style{background:url(javascript:alert(1))}{x}',
  '\\data{x=1}{y}',
  '\\id{top}{x}',
  '\\includegraphics{https://x.example.test/a.png}',
  '\\rule{100000em}{100000em}',
  '\\def\\a{\\a\\a}\\a',
  `${'{'.repeat(5000)}x${'}'.repeat(5000)}`,
  '\\frac{'.repeat(2000),
  '</span><script>alert(1)</script>',
  '</math><img src=x onerror=alert(1)>',
  '\\text{<img src=x onerror=alert(1)>}',
  '\\color{red;background:url(x)}{x}',
  '\\textcolor{javascript:alert(1)}{x}',
  '\\label{x" onclick="alert(1)}x',
  '\\tag{<b>1</b>}x',
];

export const ALLOWED_OUTPUT_TAGS = new Set([
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
  'caption',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'hr',
  'iframe',
  'button',
  'video',
  'audio',
  'track',
  'nav',
  'section',
]);

export const assertSafeHtml = (html, label) => {
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

const doc = (...blocks) => ({ blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })) });

/**
 * A document that puts one payload into every text-bearing field of every block type.
 * @param {string} payload - XSS payload.
 * @returns {object} Editor data.
 */
export const xssDocument = (payload) =>
  doc(
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
    // Tables v2 (2.4): header column, alignment, merges and caption carry the payload too.
    {
      type: 'table',
      data: {
        withHeadings: true,
        headerColumn: true,
        caption: payload,
        align: [payload, 'center', { toString: payload }],
        merges: [
          { row: 1, col: 0, rowspan: 2, colspan: 2 },
          { row: payload, col: 0, rowspan: 1, colspan: 2 },
        ],
        content: [
          [payload, payload, payload],
          [payload, payload, payload],
          [payload, payload, payload],
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
      type: 'gallery',
      data: {
        images: [
          {
            file: {
              url: 'https://ok.example.test/g.png',
              alt: payload,
              formats: { small: { url: payload, width: 2 } },
            },
            caption: payload,
            focalPoint: { x: payload, y: 0.5 },
          },
          { file: { url: payload, alt: payload }, caption: payload },
          {
            file: { url: '/uploads/g2.png', alt: payload },
            caption: payload,
            focalPoint: { x: 0.2, y: 0.8 },
          },
        ],
        layout: payload,
        columns: payload,
        caption: payload,
      },
    },
    {
      type: 'video',
      data: {
        file: { url: 'https://ok.example.test/v.webm', mime: 'video/webm', name: payload },
        poster: { url: payload },
        title: payload,
        caption: payload,
        loop: payload,
        muted: true,
        tracks: [
          { file: { url: 'https://ok.example.test/t.vtt' }, kind: payload, srclang: payload, label: payload },
          { file: { url: payload, mime: 'text/vtt' }, kind: 'captions', srclang: 'en', label: payload },
        ],
      },
    },
    { type: 'video', data: { file: { url: payload }, title: payload, caption: payload, tracks: payload } },
    {
      type: 'audio',
      data: {
        file: { url: '/uploads/a.mp3', mime: 'audio/mpeg', name: payload },
        title: '',
        caption: payload,
        loop: true,
        tracks: [
          {
            file: { url: '/uploads/a.vtt' },
            kind: 'subtitles',
            srclang: 'de',
            label: payload,
            default: true,
          },
        ],
      },
    },
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
    { type: 'toc', data: { title: payload, minLevel: payload, maxLevel: 6, style: payload } },
    { type: 'toc', data: { title: '', minLevel: 1, maxLevel: 6, style: 'ordered' } },
    // Synced blocks render nothing without `options.synced` (the Content API expands them).
    { type: 'synced', data: { ref: payload } },
    { type: 'synced', data: { ref: 'abc123' } },
    // 2.4: math block, inline math and a footnote whose note holds the payload.
    { type: 'math', data: { tex: payload, display: payload } },
    { type: 'math', data: { tex: payload, display: false, _mex: 1 } },
    {
      type: 'paragraph',
      data: {
        text: `<span data-mex-math>${payload}</span><sup data-mex-footnote="fn1" data-mex-note="${escapeHtml(payload)}">1</sup>`,
      },
    },
    { type: 'custom-x', data: { title: payload, url: payload, nested: { a: payload } } }
  );

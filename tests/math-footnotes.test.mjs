import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseDocument } from 'htmlparser2';
import {
  renderHtml,
  renderText,
  renderMarkdown,
  renderTree,
  inlineToHtml,
  inlineToText,
} from '../shared/render/index.mjs';
import {
  parseInline,
  canonicalInlineExtras,
  mapFootnoteNotes,
  walkInlineElements,
} from '../shared/render/inline.mjs';
import { cleanMathResult, MATHML_TAGS } from '../shared/render/mathml.mjs';
import { serializeNodes } from '../shared/render/nodes.mjs';
import { renderMath, checkMath, MATH_SETTINGS } from '../shared/math/index.mjs';
import { BLOCK_POLICIES, isBuiltInBlock, MAX_MATH_TEX, MAX_INLINE_TEX } from '../shared/sanitize-policy.mjs';
import {
  resolveFieldPreset,
  allowedInlineTags,
  checkPreset,
  blockLinkKinds,
  fixPresetViolations,
  INLINE_TOOL_TAGS,
  BUILTIN_BLOCKS,
} from '../shared/presets.mjs';
import { lintDocument, extractLinks } from '../shared/quality.mjs';
import { buildEditorSchema } from '../shared/schema.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { applyEditorDataToDoc, createSeedUpdate, docToEditorData } from '../shared/ydoc.mjs';
import { checkBlockStructure } from '../shared/presets.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import { validate } from './helpers/json-schema.mjs';
import { XSS, TEX_XSS, xssDocument } from './helpers/xss-corpus.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue, sanitizeInlineHtml } = require('../server/src/utils/sanitizer.js');

const doc = (...blocks) => ({
  time: 1,
  version: '2.31.7',
  blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })),
});
const p = (text) => ({ type: 'paragraph', data: { text } });
const note = (id, html, text = '1') =>
  `<sup data-mex-footnote="${id}" data-mex-note="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">${text}</sup>`;

/* ----------------------------------------------------------- stored data */

test('math block: policy, built-in marker and a custom block named math from before 2.4', () => {
  assert.deepEqual(BLOCK_POLICIES.math({ tex: 'x^2', display: false, extra: 1 }), {
    tex: 'x^2',
    display: false,
    _mex: 1,
  });
  assert.deepEqual(BLOCK_POLICIES.math({}), { tex: '', display: true, _mex: 1 });
  assert.equal(BLOCK_POLICIES.math({ tex: 'a'.repeat(MAX_MATH_TEX + 50) }).tex.length, MAX_MATH_TEX);
  // Built-in: the marker, or exactly the built-in shape.
  assert.equal(isBuiltInBlock({ type: 'math', data: { tex: 'x' } }), true);
  assert.equal(isBuiltInBlock({ type: 'math', data: { tex: 'x', display: true } }), true);
  assert.equal(isBuiltInBlock({ type: 'math', data: { tex: 'x', extra: 1, _mex: 1 } }), true);
  // Settings custom block data (simple blocks always store content, blockType, blockName).
  const legacy = {
    id: 'legacy',
    type: 'math',
    data: { content: { formula: 'E=mc^2' }, blockType: 'simple', blockName: 'math' },
  };
  assert.equal(isBuiltInBlock(legacy), false);
  const stored = cleanEditorValue({ blocks: [legacy] });
  assert.deepEqual(stored.blocks[0].data, legacy.data, 'custom block data is kept, never rewritten');
  assert.equal(stored.blocks[0].data._mex, undefined);
  assert.match(renderHtml({ blocks: [legacy] }), /^<div class="mex-block mex-math" data-mex-block="math">/);
  // Built-in data is stored with the marker.
  const builtIn = cleanEditorValue({ blocks: [{ id: 'm', type: 'math', data: { tex: '\\frac12' } }] });
  assert.deepEqual(builtIn.blocks[0].data, { tex: '\\frac12', display: true, _mex: 1 });
});

test('stored inline math and footnotes: canonical form on the server and in the shared parser', () => {
  const input =
    'E=<span data-mex-math="" class="cdx-tooltip" data-tooltip="x" onclick="alert(1)">mc^2 <b>&lt;i&gt;</b></span>' +
    note(
      'n_1',
      'See <b>this</b> <a href="javascript:alert(1)">bad</a> <a href="https://ok.example.test" data-mex-uid="api::a.a" data-mex-document-id="abc">ok</a> <sup data-mex-footnote="x" data-mex-note="nested">2</sup> <span data-mex-math>y</span>'
    ) +
    ' end';
  const expected =
    'E=<span data-mex-math="true">mc^2 &lt;i&gt;</span><sup data-mex-footnote="n_1" data-mex-note="See &lt;b&gt;this&lt;/b&gt; bad &lt;a href=&quot;https://ok.example.test&quot;&gt;ok&lt;/a&gt; &lt;sup&gt;2&lt;/sup&gt; &lt;span data-mex-math=&quot;true&quot;&gt;y&lt;/span&gt;">1</sup> end';
  assert.equal(sanitizeInlineHtml(input), expected);
  assert.equal(inlineToHtml(input, { storage: true }), expected);
  // Idempotent.
  assert.equal(sanitizeInlineHtml(expected), expected);
  assert.equal(canonicalInlineExtras(expected), expected);
  // Invalid ids and flags are ordinary elements.
  assert.equal(sanitizeInlineHtml('<sup data-mex-footnote="a b" data-mex-note="n">1</sup>'), '<sup>1</sup>');
  assert.equal(sanitizeInlineHtml('<span data-mex-math="yes">x</span>'), '<span>x</span>');
  // Bounds: inline TeX and the note input are cut.
  const long = parseInline(`<span data-mex-math>${'a'.repeat(MAX_INLINE_TEX + 10)}</span>`);
  assert.equal(long[0].children[0].value.length, MAX_INLINE_TEX);
  // Text: math is its TeX, a marker contributes nothing.
  assert.equal(inlineToText(expected), 'E=mc^2 <i> end');
});

test('field presets: math block in full and article; inline tools unwrap math and drop footnotes', () => {
  assert.ok(BUILTIN_BLOCKS.includes('math'));
  assert.ok(resolveFieldPreset({ preset: 'article' }).blocks.includes('math'));
  assert.equal(resolveFieldPreset({ preset: 'basic' }).blocks.includes('math'), false);
  assert.deepEqual(INLINE_TOOL_TAGS.inlineMath, ['span']);
  assert.deepEqual(INLINE_TOOL_TAGS.footnote, ['sup']);
  const basic = resolveFieldPreset({ preset: 'basic' });
  const value = doc(p(`a <span data-mex-math>x^2</span> b${note('f', 'note')} c`));
  const stored = cleanEditorValue(value, { inlineTags: allowedInlineTags(basic) });
  assert.equal(stored.blocks[0].data.text, 'a x^2 b c');
  // linkTargets 'none' keeps every other inline tool (math and footnotes stay).
  const none = resolveFieldPreset({ linkTargets: 'none' });
  assert.ok(none.inline.includes('inlineMath') && none.inline.includes('footnote'));
  const kept = cleanEditorValue(value, { inlineTags: allowedInlineTags(none) });
  assert.match(kept.blocks[0].data.text, /data-mex-math="true">x\^2<\/span> b<sup data-mex-footnote="f"/);
  // Block not allowed.
  assert.equal(checkPreset(doc({ type: 'math', data: { tex: 'x' } }), basic)[0].code, 'BLOCK_NOT_ALLOWED');
});

test('links inside footnote notes count for presets, quality and the link check', () => {
  const block = {
    id: 'b',
    type: 'paragraph',
    data: { text: `x${note('f', '<a href="https://e.example.test/a">click here</a>')}` },
  };
  assert.deepEqual(blockLinkKinds(block), ['external']);
  const internalOnly = resolveFieldPreset({ linkTargets: 'internal' });
  assert.equal(checkBlockStructure(internalOnly, block).code, 'LINK_NOT_ALLOWED');
  const fixed = fixPresetViolations({ blocks: [block] }, internalOnly);
  assert.equal(fixed.removed, 0, 'the paragraph is kept, only the link inside the note is unwrapped');
  assert.equal(checkBlockStructure(internalOnly, fixed.data.blocks[0]), null);
  assert.match(fixed.data.blocks[0].data.text, /data-mex-note="click here"/);
  assert.deepEqual(
    extractLinks({ blocks: [block] }).external.map((link) => link.url),
    ['https://e.example.test/a']
  );
  const lint = lintDocument({ blocks: [block] });
  assert.deepEqual(
    lint.issues.map((issue) => issue.rule),
    ['ambiguous-link-text']
  );
  // mapFootnoteNotes leaves strings without footnotes alone.
  assert.equal(
    mapFootnoteNotes('<b>x</b>', () => 'y'),
    '<b>x</b>'
  );
});

test('quality: math-invalid with a TeX check, footnote-empty', () => {
  const value = doc(
    { type: 'math', data: { tex: '\\frac{' } },
    { type: 'math', data: { tex: '\\frac12' } },
    p(`ok <span data-mex-math>\\sqrt{</span>${note('e', ' ')}${note('f', 'text')}`)
  );
  const without = lintDocument(value);
  assert.deepEqual(
    without.issues.map((issue) => issue.rule),
    ['footnote-empty'],
    'without a checker no math rule'
  );
  const result = lintDocument(value, { checkMath });
  assert.deepEqual(
    result.issues.map((issue) => [issue.rule, issue.blockId, issue.severity, issue.path]),
    [
      ['math-invalid', 'b0', 'warning', 'tex'],
      ['math-invalid', 'b2', 'warning', 'text'],
      ['footnote-empty', 'b2', 'warning', 'text'],
    ]
  );
  // A throwing checker never fails the lint.
  assert.equal(
    lintDocument(value, {
      checkMath: () => {
        throw new Error('x');
      },
    }).issues.length,
    1
  );
});

test('schema: stored math blocks validate; wrong shapes do not', () => {
  const schema = buildEditorSchema();
  const stored = cleanEditorValue(doc({ type: 'math', data: { tex: 'x', display: false } }));
  assert.deepEqual(validate(schema, schema, stored), []);
  const bad = { ...stored, blocks: [{ id: 'm', type: 'math', data: { tex: 1, display: true, _mex: 1 } }] };
  assert.notDeepEqual(validate(schema, schema, bad), []);
});

/* ------------------------------------------------------------ renderers */

const MIXED = doc(
  { type: 'header', data: { text: `Intro${note('h1', 'Heading note')}`, level: 2 } },
  p(
    `Energy <span data-mex-math>E=mc^2</span>${note('p1', 'First <b>bold</b> note')} and${note('p2', 'Second')}.`
  ),
  { type: 'toggle', data: { text: `Toggle${note('t1', 'In summary')}`, items: 1 } },
  p(`Inside${note('p1', 'Copied marker, same id')}`),
  {
    type: 'table',
    data: { withHeadings: false, content: [[`a${note('c1', 'Cell')}`, 'b']] },
  },
  { type: 'math', data: { tex: '\\frac{a}{b}' } },
  { type: 'math', data: { tex: 'x<y', display: false } }
);

test('HTML fallback: delimited TeX, numbered footnotes in reading order, list at the end', () => {
  const html = renderHtml(MIXED);
  assert.equal(
    html,
    [
      '<h2 class="mex-header">Intro<sup class="mex-footnote-ref"><a href="#mex-fn-h1" id="mex-fnref-h1" aria-describedby="mex-footnotes-label">1</a></sup></h2>',
      '<p class="mex-paragraph">Energy <span class="mex-math" data-mex-math="inline">\\(E=mc^2\\)</span><sup class="mex-footnote-ref"><a href="#mex-fn-p1" id="mex-fnref-p1" aria-describedby="mex-footnotes-label">2</a></sup> and<sup class="mex-footnote-ref"><a href="#mex-fn-p2" id="mex-fnref-p2" aria-describedby="mex-footnotes-label">3</a></sup>.</p>',
      '<details class="mex-toggle" open><summary>Toggle<sup class="mex-footnote-ref"><a href="#mex-fn-t1" id="mex-fnref-t1" aria-describedby="mex-footnotes-label">4</a></sup></summary><p class="mex-paragraph">Inside<sup class="mex-footnote-ref"><a href="#mex-fn-p1-2" id="mex-fnref-p1-2" aria-describedby="mex-footnotes-label">5</a></sup></p></details>',
      '<table class="mex-table"><tbody><tr><td>a<sup class="mex-footnote-ref"><a href="#mex-fn-c1" id="mex-fnref-c1" aria-describedby="mex-footnotes-label">6</a></sup></td><td>b</td></tr></tbody></table>',
      '<div class="mex-math mex-math-display" data-mex-math="display">\\[\\frac{a}{b}\\]</div>',
      '<div class="mex-math" data-mex-math="inline">\\(x&lt;y\\)</div>',
      '<section class="mex-footnotes" aria-labelledby="mex-footnotes-label"><h2 id="mex-footnotes-label" class="mex-footnotes-label">Footnotes</h2><ol class="mex-footnotes-list">' +
        '<li id="mex-fn-h1" class="mex-footnote">Heading note <a href="#mex-fnref-h1" class="mex-footnote-back" aria-label="Back to reference 1">↩</a></li>' +
        '<li id="mex-fn-p1" class="mex-footnote">First <b>bold</b> note <a href="#mex-fnref-p1" class="mex-footnote-back" aria-label="Back to reference 2">↩</a></li>' +
        '<li id="mex-fn-p2" class="mex-footnote">Second <a href="#mex-fnref-p2" class="mex-footnote-back" aria-label="Back to reference 3">↩</a></li>' +
        '<li id="mex-fn-t1" class="mex-footnote">In summary <a href="#mex-fnref-t1" class="mex-footnote-back" aria-label="Back to reference 4">↩</a></li>' +
        '<li id="mex-fn-p1-2" class="mex-footnote">Copied marker, same id <a href="#mex-fnref-p1-2" class="mex-footnote-back" aria-label="Back to reference 5">↩</a></li>' +
        '<li id="mex-fn-c1" class="mex-footnote">Cell <a href="#mex-fnref-c1" class="mex-footnote-back" aria-label="Back to reference 6">↩</a></li>' +
        '</ol></section>',
    ].join('\n')
  );
  // Heading text (toc, anchors) does not include the marker.
  assert.equal(inlineToText(MIXED.blocks[0].data.text), 'Intro');
});

test('footnote options: label, back label, prefix; invalid values fall back', () => {
  const value = doc(p(`a${note('x', 'n')}`));
  const html = renderHtml(value, {
    footnotes: { label: 'Fußnoten', backLabel: 'Zurück zu {n}', prefix: 'body-' },
  });
  assert.match(html, /href="#body-fn-x" id="body-fnref-x" aria-describedby="body-footnotes-label"/);
  assert.match(html, /<h2 id="body-footnotes-label" class="mex-footnotes-label">Fußnoten<\/h2>/);
  assert.match(html, /aria-label="Zurück zu 1"/);
  const fallback = renderHtml(value, { footnotes: { prefix: '1"><x', label: '', backLabel: 5 } });
  assert.match(fallback, /id="mex-footnotes-label" class="mex-footnotes-label">Footnotes</);
  assert.match(fallback, /aria-label="Back to reference 1"/);
  // Two fields on one page with their own prefixes share no id.
  const ids = (out) => [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const a = ids(renderHtml(value, { footnotes: { prefix: 'a-' } }));
  const b = ids(renderHtml(value, { footnotes: { prefix: 'b-' } }));
  assert.equal(a.filter((id) => b.includes(id)).length, 0);
  // Without footnotes nothing is added (output of existing content is unchanged).
  assert.equal(renderHtml(doc(p('plain'))), '<p class="mex-paragraph">plain</p>');
});

test('text and Markdown output', () => {
  assert.equal(
    renderText(MIXED),
    [
      'Intro[1]',
      'Energy E=mc^2[2] and[3].',
      'Toggle[4]\n\nInside[5]',
      'a[6]\tb',
      '\\frac{a}{b}',
      'x<y',
      'Footnotes\n[1] Heading note\n[2] First bold note\n[3] Second\n[4] In summary\n[5] Copied marker, same id\n[6] Cell',
    ].join('\n\n')
  );
  assert.equal(
    renderMarkdown(MIXED),
    [
      '## Intro[^1]',
      'Energy $E=mc^2$[^2] and[^3].',
      '**Toggle[^4]**\n\nInside[^5]',
      '|   |   |\n| --- | --- |\n| a[^6] | b |',
      '$$\n\\frac{a}{b}\n$$',
      '$x< y$',
      '[^1]: Heading note\n[^2]: First **bold** note\n[^3]: Second\n[^4]: In summary\n[^5]: Copied marker, same id\n[^6]: Cell',
    ].join('\n\n')
  );
  assert.match(
    renderMarkdown(doc(p(`a${note('x', 'n')}`)), { footnotes: { prefix: 'b-' } }),
    /a\[\^b-1\]\n\n\[\^b-1\]: n$/
  );
});

test('Markdown math: fences outlast dollar runs, `<` cannot open HTML, blank lines removed', () => {
  const md = (tex, display) => renderMarkdown(doc({ type: 'math', data: { tex, display } }));
  assert.equal(md('a $ b', false), '$$a $ b$$');
  assert.equal(md('a $$ b', true), '$$$\na $$ b\n$$$');
  assert.equal(md('a\n\n\nb', true), '$$\na\nb\n$$');
  assert.equal(md('x</span><script>alert(1)</script>', true), '$$\nx< /span>< script>alert(1)< /script>\n$$');
  assert.equal(md('a<b<!--c', false), '$a< b< !--c$');
  assert.equal(md('', true), '');
  assert.equal(renderMarkdown(doc(p('<span data-mex-math>x\n y</span> *not* math'))), '$x y$ \\*not\\* math');
});

test('math option: MathML through the allow-list, fallback on failure', () => {
  const value = doc({ type: 'math', data: { tex: 'x^2' } }, p('<span data-mex-math>y</span>'));
  const html = renderHtml(value, { math: renderMath });
  assert.equal(
    html,
    '<div class="mex-math mex-math-display" data-mex-math="display"><math display="block" class="tml-display"><semantics><msup><mi>x</mi><mn class="tml-sml-pad">2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math></div>\n' +
      '<p class="mex-paragraph"><span class="mex-math" data-mex-math="inline"><math><semantics><mi>y</mi><annotation encoding="application/x-tex">y</annotation></semantics></math></span></p>'
  );
  for (const math of [
    () => null,
    () => '',
    () => '<b>not math</b>',
    () => 42,
    () => {
      throw new Error('x');
    },
  ])
    assert.match(renderHtml(value, { math }), /\\\[x\^2\\\]/);
  // Node results are validated like strings.
  const nodes = renderHtml(value, {
    math: () => ({
      type: 'element',
      tag: 'math',
      attrs: { onclick: 'x', href: 'javascript:alert(1)', display: 'block' },
      children: [{ type: 'element', tag: 'script', attrs: {}, children: ['alert(1)'] }, 'x'],
    }),
  });
  assert.match(nodes, /<math display="block">x<\/math>/);
  assert.equal(MATH_SETTINGS.trust, false);
});

test('MathML allow-list: no href, style, id, events, annotation-xml or HTML', () => {
  const dirty =
    '<math display="block" xmlns="http://www.w3.org/1998/Math/MathML" id="x" onclick="alert(1)" style="color:#f00;background:url(javascript:x)" href="javascript:alert(1)">' +
    '<mi mathvariant="bold" style="color:red" class="tml-x evil">a</mi>' +
    '<mo lspace="0em" rspace="calc(1em)" stretchy="true" href="x">+</mo>' +
    '<mtext><img src=x onerror=alert(1)>t<b>b</b></mtext>' +
    '<mspace width="javascript:alert(1)" height="1em"></mspace>' +
    '<maction actiontype="statusline"><mi>q</mi></maction>' +
    '<semantics><mi>z</mi><annotation-xml encoding="text/html"><a href="javascript:x">l</a></annotation-xml>' +
    '<annotation encoding="text/html"><script>x</script></annotation><annotation encoding="application/x-tex">z<b>' +
    '</annotation></semantics><svg><script>alert(1)</script></svg><mi mathcolor="url(x)" mathbackground="#00ff00">c</mi>' +
    '<!-- c --><![CDATA[x]]><?pi x?></math><script>alert(1)</script><math display="evil"><mi>2</mi></math>';
  assert.equal(
    serializeNodes(cleanMathResult(dirty)),
    '<math display="block" mathcolor="#f00"><mi mathvariant="bold" class="tml-x" mathcolor="red">a</mi><mo lspace="0em" stretchy="true">+</mo><mtext></mtext><mspace height="1em"></mspace><semantics><mi>z</mi><annotation encoding="application/x-tex">z</annotation></semantics><mi mathbackground="#00ff00">c</mi></math><math><mi>2</mi></math>'
  );
  assert.deepEqual(cleanMathResult('<p>no math</p>'), []);
  assert.deepEqual(cleanMathResult(null), []);
  assert.ok(MATHML_TAGS.includes('mfrac') && !MATHML_TAGS.includes('maction'));
});

/**
 * Asserts rendered output with MathML: allowed tags only, no script vectors.
 * @param {string} html - Output.
 * @param {string} label - Label.
 */
const assertSafeMathHtml = (html, label) => {
  const allowed = new Set([
    ...MATHML_TAGS,
    ...['p', 'div', 'span', 'sup', 'a', 'b', 'section', 'h2', 'ol', 'li', 'br', 'i', 'em', 'strong'],
  ]);
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g))
    assert.ok(allowed.has(match[1].toLowerCase()), `${label}: tag ${match[1]}`);
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const withoutValues = tag[0].replace(/="[^"]*"/g, '');
    assert.doesNotMatch(
      withoutValues,
      /\s(on[a-z]+|style|href|src|id|xlink:[a-z]+|xmlns)\b/i,
      `${label}: ${tag[0]}`
    );
    if (/^<a /.test(tag[0])) assert.match(tag[0], /href="#mex-fn/, `${label}: ${tag[0]}`);
  }
  // TeX source may mention anything as text; markup and attribute values may not.
  assert.doesNotMatch(html, /="[^"]*javascript:|<script|<img|<svg|annotation-xml/i, label);
};

test('XSS: hostile TeX through renderMath is inert in HTML, text and Markdown', () => {
  for (const tex of TEX_XSS) {
    const value = doc(
      { type: 'math', data: { tex } },
      p(`<span data-mex-math>${tex.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`)
    );
    const started = Date.now();
    const html = renderHtml(value, { math: renderMath });
    assert.ok(Date.now() - started < 2000, `${tex.slice(0, 30)} renders fast`);
    assertSafeMathHtml(html.replace(/<a href="#mex-fn[^"]*"/g, '<a'), tex.slice(0, 40));
    assert.doesNotMatch(html, /(width|height|depth)="\d{3,}/, 'sizes are capped');
    assert.doesNotMatch(renderMarkdown(value), /<(?=[A-Za-z/!?])/, tex.slice(0, 40));
    assert.equal(typeof renderText(value), 'string');
  }
  // Untrusted commands do not render (fallback with the source as text).
  for (const tex of [
    '\\href{javascript:alert(1)}{x}',
    '\\includegraphics{https://x.example.test/a.png}',
    '\\class{evil}{x}',
  ])
    assert.equal(renderMath(tex), null, tex);
  assert.equal(renderMath('x'.repeat(MAX_MATH_TEX + 1)), null);
  assert.equal(checkMath('\\frac{').ok, false);
  assert.equal(checkMath('\\frac12').ok, true);
  assert.equal(checkMath('').ok, true);
});

const normalize = (html) => {
  const walk = (nodes) => {
    const out = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        const last = out[out.length - 1];
        if (typeof last === 'string') out[out.length - 1] = last + node.data;
        else out.push(node.data);
      } else if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
        out.push([
          node.name,
          Object.entries(node.attribs).sort(([a], [b]) => (a < b ? -1 : 1)),
          walk(node.children),
        ]);
      }
    }
    return out;
  };
  return JSON.stringify(walk(parseDocument(html).children));
};

/** Fails on any React or Vue warning printed while rendering. */
const quiet = async (fn) => {
  const messages = [];
  const { error, warn } = console;
  console.error = (...args) => messages.push(args.join(' '));
  console.warn = (...args) => messages.push(args.join(' '));
  try {
    return await fn();
  } finally {
    console.error = error;
    console.warn = warn;
    assert.deepEqual(messages, []);
  }
};

test('React and Vue output equals renderHtml with math and footnotes (MathML and fallback, XSS corpus)', async () => {
  const cases = [
    [MIXED, {}],
    [MIXED, { math: renderMath, footnotes: { prefix: 'f-', label: 'Notes' } }],
    ...TEX_XSS.map((tex) => [
      doc({ type: 'math', data: { tex } }, p(`<span data-mex-math>${tex.replace(/</g, '&lt;')}</span>`)),
      { math: renderMath },
    ]),
    ...XSS.map((payload) => [xssDocument(payload), { math: renderMath }]),
  ];
  for (const [value, options] of cases) {
    const expected = normalize(renderHtml(value, options));
    const react = await quiet(() =>
      ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, { value, options }))
    );
    const vue = await quiet(() =>
      renderToString(createSSRApp({ render: () => h(VueContent, { value, options }) }))
    );
    assert.equal(normalize(react), expected);
    assert.equal(normalize(vue), expected);
  }
  // The tree has no raw nodes for math.
  const tree = JSON.stringify(renderTree(MIXED, { math: renderMath }));
  assert.doesNotMatch(tree, /"type":"raw"/);
});

/* ---------------------------------------------------------- collaboration */

test('Yjs guard accepts math blocks, inline math and footnotes; presets refuse them where not allowed', () => {
  const seed = createSeedUpdate(
    { time: 1, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] },
    'e1'
  );
  const room = new Y.Doc();
  Y.applyUpdate(room, seed);
  const client = new Y.Doc();
  Y.applyUpdate(client, seed);
  const before = Y.encodeStateVector(client);
  const next = {
    blocks: [
      {
        id: 'p1',
        type: 'paragraph',
        data: { text: `hi <span data-mex-math="true">x^2</span>${note('f1', 'A <b>note</b>')}` },
      },
      { id: 'm1', type: 'math', data: { tex: '\\frac{a}{b}', display: true, _mex: 1 } },
    ],
  };
  applyEditorDataToDoc(client, next);
  const update = Y.encodeStateAsUpdate(client, before);
  assert.deepEqual(applyCheckedUpdate(room, update), { ok: true, changed: true });
  assert.deepEqual(docToEditorData(room).blocks, next.blocks);
  // A basic field refuses a new math block (structural preset rule).
  const basic = resolveFieldPreset({ preset: 'basic' });
  const room2 = new Y.Doc();
  Y.applyUpdate(room2, seed);
  const refused = applyCheckedUpdate(room2, update, {
    checkBlock: (block) => {
      const violation = checkBlockStructure(basic, block);
      return violation ? violation.code : null;
    },
  });
  assert.equal(refused.ok, false);
  // Two users add footnotes at the same time: both survive (notes live in their markers).
  const a = new Y.Doc();
  const b = new Y.Doc();
  const shared = new Y.Doc();
  for (const d of [a, b, shared]) Y.applyUpdate(d, seed);
  applyEditorDataToDoc(a, {
    blocks: [{ id: 'p1', type: 'paragraph', data: { text: `hi${note('fa', 'From A')}` } }],
  });
  applyEditorDataToDoc(b, {
    blocks: [{ id: 'p1', type: 'paragraph', data: { text: `${note('fb', 'From B')}hi` } }],
  });
  Y.applyUpdate(shared, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(shared, Y.encodeStateAsUpdate(b));
  const merged = docToEditorData(shared).blocks[0].data.text;
  const ids = [];
  walkInlineElements(parseInline(merged), (node) => {
    if (node.attrs['data-mex-footnote']) ids.push(node.attrs['data-mex-footnote']);
  });
  assert.deepEqual(ids.sort(), ['fa', 'fb']);
  assert.match(
    renderHtml({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: merged } }] }),
    /From A[\s\S]*From B|From B[\s\S]*From A/
  );
});

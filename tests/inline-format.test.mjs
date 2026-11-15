/**
 * 2.5 inline formatting: colour and highlight tokens, superscript and
 * subscript, inline annotations (block SDK), the contrast lint and the
 * sanitiser policy per field.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
  normalizePalette,
  paletteCss,
  hasPalette,
  tokenLabel,
  colorClass,
  highlightClass,
} from '../shared/inline-format.mjs';
import {
  defineInlineAnnotation,
  annotationJsonSchema,
  abbreviationAnnotation,
  ANNOTATION_LIMITS,
} from '../shared/blocks/index.mjs';
import {
  activeAnnotation,
  activeAnnotations,
  registerAnnotationDefinition,
  clearActiveAnnotations,
  cleanAnnotationAttributes,
  cleanAnnotationWrapper,
  annotationsFromSummaries,
  annotationSummary,
} from '../shared/blocks/annotations.mjs';
import { canonicalInlineExtras, inlineToHtml, parseInline } from '../shared/render/inline.mjs';
import { renderHtml, renderText, renderMarkdown } from '../shared/render/index.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import {
  resolveFieldPreset,
  allowedInlineTags,
  inlinePolicy,
  enabledAnnotations,
  parseAnnotationList,
} from '../shared/presets.mjs';
import {
  lintDocument,
  paletteContrastIssues,
  tokenContrast,
  contrastRatio,
  parseColor,
} from '../shared/quality.mjs';
import { glossaryAnnotation } from './fixtures/glossary.mjs';
import { assertSafeHtml } from './helpers/xss-corpus.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue, inlineSanitizerForPolicy } = require('../server/src/utils/sanitizer.js');
const config = require('../server/src/config/index.js');

const PALETTE = normalizePalette({
  colors: [
    { name: 'accent', label: { en: 'Accent', de: 'Akzent' }, light: '#B3261E', dark: '#ffb4ab' },
    { name: 'pale', label: 'Pale', light: '#ccc' },
  ],
  highlights: [{ name: 'note', label: 'Note', light: '#fff3b0', dark: '#5c4a00' }],
});
const doc = (text) => ({
  time: 1,
  version: '2.31.7',
  blocks: [{ id: 'p1', type: 'paragraph', data: { text } }],
});
const textOf = (value) => value.blocks[0].data.text;

/* ------------------------------------------------------------ palette */

test('palette: normalised tokens, defaults, labels, CSS without styles in content', () => {
  assert.deepEqual(PALETTE.colors[0], {
    name: 'accent',
    label: { en: 'Accent', de: 'Akzent' },
    light: '#b3261e',
    dark: '#ffb4ab',
  });
  // `dark` defaults to `light`, `#rgb` becomes `#rrggbb`.
  assert.equal(PALETTE.colors[1].dark, '#cccccc');
  assert.deepEqual(PALETTE.background, { light: '#ffffff', dark: '#121212' });
  assert.equal(hasPalette(PALETTE), true);
  assert.equal(hasPalette(normalizePalette({})), false);
  // Invalid entries are dropped: bad names, bad colours, duplicates.
  const dirty = normalizePalette({
    colors: [
      { name: 'Bad', light: '#000' },
      { name: 'x', light: 'red' },
      { name: 'ok', light: '#000' },
      { name: 'ok', light: '#111' },
      { name: 'evil;}', light: '#000' },
    ],
  });
  assert.deepEqual(
    dirty.colors.map((token) => token.name),
    ['ok']
  );
  assert.equal(tokenLabel(PALETTE.colors[0], 'de-CH'), 'Akzent');
  assert.equal(tokenLabel(PALETTE.colors[0], 'fr'), 'Accent');
  assert.equal(tokenLabel({ name: 'n', label: null }, 'en'), 'n');
  const css = paletteCss(PALETTE);
  assert.match(css, /^\.mex-color-accent \{ color: #b3261e; \}/);
  assert.match(css, /\.mex-highlight-note \{ background-color: #fff3b0; color: inherit; \}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n {2}\.mex-color-accent \{ color: #ffb4ab; \}/);
  assert.equal(colorClass('accent'), 'mex-color-accent');
  assert.equal(highlightClass('note'), 'mex-highlight-note');
});

test('config: palette validator accepts tokens and refuses bad names, colours and duplicates', () => {
  const base = JSON.parse(JSON.stringify(config.default));
  config.validator(base);
  base.palette = {
    background: { light: '#fff', dark: '#000' },
    colors: [{ name: 'accent', label: { en: 'Accent' }, light: '#b3261e', dark: '#ffb4ab' }],
    highlights: [{ name: 'note', light: '#fff3b0' }],
  };
  config.validator(base);
  for (const bad of [
    { colors: [{ name: 'Accent', light: '#000' }], highlights: [] },
    { colors: [{ name: 'a', light: 'red' }], highlights: [] },
    { colors: [{ name: 'a', light: '#000', style: 'x' }], highlights: [] },
    {
      colors: [
        { name: 'a', light: '#000' },
        { name: 'a', light: '#111' },
      ],
      highlights: [],
    },
    { colors: Array.from({ length: 25 }, (_, i) => ({ name: `c${i}`, light: '#000' })), highlights: [] },
  ]) {
    base.palette = bad;
    assert.throws(() => config.validator(base), /palette/);
  }
});

/* ------------------------------------------------------- parse/render */

test('renderers: tokens become classes plus the data attribute; storage keeps the token only', () => {
  const html =
    'a <span data-mex-color="accent">red</span> <mark data-mex-highlight="note" class="cdx-marker">n</mark> <mark class="cdx-marker">m</mark>';
  assert.equal(
    inlineToHtml(html),
    'a <span class="mex-color-accent" data-mex-color="accent">red</span> <mark class="mex-highlight-note" data-mex-highlight="note">n</mark> <mark class="cdx-marker">m</mark>'
  );
  assert.equal(
    canonicalInlineExtras(html),
    'a <span data-mex-color="accent">red</span> <mark data-mex-highlight="note">n</mark> <mark class="cdx-marker">m</mark>'
  );
  // Invalid tokens: plain elements, never a class built from input.
  assert.equal(
    inlineToHtml('<span data-mex-color="Bad Token">x</span><mark data-mex-highlight="a&quot;b">y</mark>'),
    '<span>x</span><mark>y</mark>'
  );
  // Never a style.
  assert.doesNotMatch(inlineToHtml('<span data-mex-color="accent" style="color:red">x</span>'), /style/);
});

test('renderers: superscript and subscript stay plain; footnote markers keep working next to them', () => {
  const html = 'E = mc<sup>2</sup>, H<sub>2</sub>O<sup data-mex-footnote="fn1" data-mex-note="Note">*</sup>';
  const out = renderHtml(doc(html));
  assert.match(out, /mc<sup>2<\/sup>, H<sub>2<\/sub>O<sup class="mex-footnote-ref">/);
  assert.match(out, /<section class="mex-footnotes"/);
  assert.equal(renderText(doc(html)).split('\n')[0], 'E = mc2, H2O[1]');
});

test('annotations: built-in abbreviation renders <abbr title>; text and markdown keep the text', () => {
  const html =
    'The <span data-mex-annotation="abbreviation" data-mex-a-title="HyperText Markup Language">HTML</span> spec';
  assert.equal(inlineToHtml(html), 'The <abbr title="HyperText Markup Language">HTML</abbr> spec');
  assert.equal(renderText(doc(html)), 'The HTML spec');
  assert.equal(renderMarkdown(doc(html)), 'The HTML spec');
  // Missing required full form: text only.
  assert.equal(inlineToHtml('<span data-mex-annotation="abbreviation">HTML</span>'), 'HTML');
  // Unknown annotation: default span without the unvalidated values.
  assert.equal(
    inlineToHtml('<span data-mex-annotation="glossary" data-mex-a-term="api">API</span>'),
    '<span class="mex-annotation mex-annotation-glossary" data-mex-annotation="glossary">API</span>'
  );
});

test('annotations: the renderer option and resolveAnnotation drive render; wrappers are validated', () => {
  const html = '<span data-mex-annotation="glossary" data-mex-a-term="api">API</span>';
  const seen = [];
  const out = inlineToHtml(html, {
    annotations: [glossaryAnnotation],
    resolveAnnotation: (annotation) => {
      seen.push(annotation);
      return 'Application programming interface';
    },
  });
  assert.equal(
    out,
    '<dfn class="glossary-term" data-term="api" title="Application programming interface">API</dfn>'
  );
  assert.deepEqual(seen, [{ name: 'glossary', attrs: { term: 'api' }, text: 'API' }]);
  // A throwing resolver or render falls back safely.
  assert.equal(
    inlineToHtml(html, {
      annotations: [glossaryAnnotation],
      resolveAnnotation: () => {
        throw new Error('x');
      },
    }),
    '<dfn class="glossary-term" data-term="api">API</dfn>'
  );
  const hostile = defineInlineAnnotation({
    name: 'hostile',
    attributes: { u: { type: 'url' } },
    render: ({ attrs }) => ({
      tag: 'a',
      attrs: {
        href: 'javascript:alert(1)',
        onclick: 'alert(1)',
        style: 'color:red',
        'data-mex-uid': 'api::a.a',
        class: 'ok bad"class',
        title: attrs.u,
      },
    }),
  });
  assert.equal(
    inlineToHtml('<span data-mex-annotation="hostile" data-mex-a-u="https://x.example.test/a">x</span>', {
      annotations: [hostile],
    }),
    '<a class="ok" title="https://x.example.test/a">x</a>'
  );
  // A tag outside the allow-list gives the default rendering; `false` renders the text only.
  const script = defineInlineAnnotation({
    name: 'script-tag',
    attributes: {},
    render: () => ({ tag: 'script' }),
  });
  assert.equal(
    inlineToHtml('<span data-mex-annotation="script-tag">x</span>', { annotations: [script] }),
    '<span class="mex-annotation mex-annotation-script-tag" data-mex-annotation="script-tag">x</span>'
  );
  const bare = defineInlineAnnotation({ name: 'bare', attributes: {}, render: () => false });
  assert.equal(inlineToHtml('<span data-mex-annotation="bare">x</span>', { annotations: [bare] }), 'x');
  assert.deepEqual(cleanAnnotationWrapper({ tag: 'abbr', attrs: { href: '/x', title: 't' } }), {
    tag: 'abbr',
    attrs: { title: 't' },
  });
});

test('renderers: React and Vue output equals renderHtml for colours, highlights, script and annotations', async () => {
  const value = doc(
    'x<sup>2</sup> <mark data-mex-highlight="note"><span data-mex-color="accent">c</span></mark> <span data-mex-annotation="abbreviation" data-mex-a-title="Full &amp; &quot;form&quot;">AB</span> <span data-mex-annotation="glossary" data-mex-a-term="api">API</span>'
  );
  const options = { annotations: [glossaryAnnotation], resolveAnnotation: () => 'Definition <b>x</b>' };
  const expected = renderHtml(value, options);
  const react = ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, { value, options }));
  const vue = (
    await renderToString(createSSRApp({ render: () => h(VueContent, { value, options }) }))
  ).replace(/<!--[[\]]-->/g, '');
  const norm = (html) =>
    html
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&');
  assert.equal(norm(react), norm(expected));
  assert.equal(norm(vue), norm(expected));
  assert.match(expected, /<abbr title="Full &amp; &quot;form&quot;">AB<\/abbr>/);
  assert.match(
    expected,
    /<dfn class="glossary-term" data-term="api" title="Definition &lt;b&gt;x&lt;\/b&gt;">API<\/dfn>/
  );
  for (const html of [expected, react, vue]) assertSafeHtml(html.replace(/<\/?dfn/g, '<span'), 'parity');
});

/* ------------------------------------------------------- definitions */

test('defineInlineAnnotation validates names, attributes, presets and functions', () => {
  const bad = [
    null,
    { name: 'A', attributes: {} },
    { name: 'x', attributes: {} },
    { name: 'ok-name', attributes: [] },
    { name: 'ok-name', attributes: { Bad: { type: 'text' } } },
    { name: 'ok-name', attributes: { a: { type: 'html' } } },
    { name: 'ok-name', attributes: { a: { type: 'text', max: 5000 } } },
    { name: 'ok-name', attributes: { a: { type: 'enum', values: [] } } },
    { name: 'ok-name', attributes: { a: { type: 'url', schemes: ['javascript'] } } },
    { name: 'ok-name', attributes: { a: { type: 'text', extra: 1 } } },
    { name: 'ok-name', attributes: {}, presets: ['everything'] },
    { name: 'ok-name', attributes: {}, render: 'x' },
    { name: 'ok-name', attributes: {}, unknown: true },
    {
      name: 'ok-name',
      attributes: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, { type: 'text' }])),
    },
  ];
  for (const definition of bad)
    assert.throws(() => defineInlineAnnotation(definition), { name: 'BlockDefinitionError' });
  const def = defineInlineAnnotation({
    name: 'status',
    attributes: {
      level: { type: 'enum', values: ['low', 'high'], required: true },
      link: { type: 'url', schemes: ['https'], relative: false },
      note: { type: 'text', max: 5 },
    },
  });
  assert.ok(Object.isFrozen(def));
  assert.deepEqual(
    cleanAnnotationAttributes(def, {
      level: 'high',
      link: 'javascript:alert(1)',
      note: ' abcdefgh ',
      x: '1',
    }),
    { level: 'high', note: 'abcde' }
  );
  assert.equal(cleanAnnotationAttributes(def, { level: 'mid' }), null);
  assert.deepEqual(annotationJsonSchema(def), {
    title: 'status',
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['low', 'high'] },
      link: { type: 'string', format: 'uri-reference', maxLength: 2048 },
      note: { type: 'string', minLength: 1, maxLength: 5 },
    },
    required: ['level'],
    additionalProperties: false,
    'x-mex-stored-as': '<span data-mex-annotation="status" data-mex-a-<key>="…">',
  });
  assert.equal(ANNOTATION_LIMITS.attributes, 8);
});

test('registry: built-in abbreviation, register once, reserved and taken names, summaries for the admin', () => {
  clearActiveAnnotations();
  assert.equal(activeAnnotation('abbreviation'), abbreviationAnnotation);
  assert.throws(() => registerAnnotationDefinition({ name: 'abbreviation', attributes: {} }), {
    code: 'RESERVED_NAME',
  });
  const registered = registerAnnotationDefinition(glossaryAnnotation);
  assert.equal(registered, glossaryAnnotation);
  assert.equal(registerAnnotationDefinition(glossaryAnnotation), glossaryAnnotation);
  assert.throws(() => registerAnnotationDefinition({ name: 'glossary', attributes: {} }), {
    code: 'NAME_TAKEN',
  });
  assert.deepEqual(
    activeAnnotations().map((item) => item.name),
    ['abbreviation', 'glossary']
  );
  const summary = annotationSummary(glossaryAnnotation);
  assert.equal(summary.resolves, true);
  assert.equal(JSON.stringify(summary).includes('function'), false);
  const rebuilt = annotationsFromSummaries([summary, { name: 'abbreviation' }, { name: 'B A D' }]);
  assert.deepEqual(
    rebuilt.map((item) => item.name),
    ['glossary']
  );
  assert.equal(rebuilt[0].render, undefined);
  clearActiveAnnotations();
});

/* ----------------------------------------------------------- presets */

test('presets: extra formatting is off by default and turned on per field', () => {
  const full = resolveFieldPreset({});
  assert.equal(full.colors, false);
  assert.equal(full.script, false);
  assert.deepEqual(full.annotations, []);
  assert.equal(full.restricted, false);
  const basic = resolveFieldPreset({
    preset: 'basic',
    inlineColors: true,
    inlineScript: true,
    inlineAnnotations: 'Abbreviation, glossary; b@d, x',
  });
  assert.deepEqual(basic.annotations, ['abbreviation', 'glossary']);
  assert.deepEqual(parseAnnotationList(' a-b , ,c1, z '), ['a-b', 'c1']);
  assert.deepEqual(allowedInlineTags(basic), [
    'a',
    'b',
    'br',
    'em',
    'i',
    'mark',
    's',
    'span',
    'strong',
    'sub',
    'sup',
    'u',
  ]);
  assert.equal(allowedInlineTags(full), null);
  const policy = inlinePolicy(basic, {
    palette: PALETTE,
    definitions: [abbreviationAnnotation, glossaryAnnotation],
  });
  assert.equal(policy.footnotes, false);
  assert.deepEqual(policy.colors, ['accent', 'pale']);
  assert.deepEqual(policy.highlights, ['note']);
  assert.deepEqual([...policy.annotations.keys()], ['abbreviation', 'glossary']);
  assert.deepEqual(policy.plainTags, ['mark', 'span']);
  // A definition joins presets it lists.
  const article = defineInlineAnnotation({ name: 'term', attributes: {}, presets: ['article'] });
  assert.deepEqual(
    enabledAnnotations(resolveFieldPreset({ preset: 'article' }), [abbreviationAnnotation, article]).map(
      (item) => item.name
    ),
    ['term']
  );
  // Full preset without the options: nothing new is allowed.
  const plain = inlinePolicy(full, { palette: PALETTE });
  assert.deepEqual(
    [plain.colors, plain.highlights, plain.annotations.size, plain.footnotes],
    [[], [], 0, true]
  );
});

/* --------------------------------------------------------- sanitiser */

test('server sanitiser: unknown tokens and annotations are unwrapped on save, known ones kept', () => {
  const html =
    '<span data-mex-color="accent">a</span><span data-mex-color="ghost">b</span><mark data-mex-highlight="note">c</mark><mark data-mex-highlight="ghost">d</mark><span data-mex-annotation="abbreviation" data-mex-a-title="Full" data-mex-a-x="drop">E</span><span data-mex-annotation="unknown" data-mex-a-y="1">F</span><span data-mex-annotation="abbreviation">G</span>';
  const on = inlinePolicy(resolveFieldPreset({ inlineColors: true, inlineAnnotations: 'abbreviation' }), {
    palette: PALETTE,
  });
  assert.equal(
    textOf(cleanEditorValue(doc(html), { inline: on })),
    '<span data-mex-color="accent">a</span>b<mark data-mex-highlight="note">c</mark>d<span data-mex-annotation="abbreviation" data-mex-a-title="Full">E</span>FG'
  );
  // The full preset without the options unwraps every token and annotation; other markup is untouched.
  const off = inlinePolicy(resolveFieldPreset({}), { palette: PALETTE });
  assert.equal(textOf(cleanEditorValue(doc(html), { inline: off })), 'abcdEFG');
  assert.equal(
    textOf(cleanEditorValue(doc('<b>x</b> <mark class="cdx-marker">m</mark>'), { inline: off })),
    '<b>x</b> <mark class="cdx-marker">m</mark>'
  );
  // Basic + colours: an ordinary span/mark (tools the preset leaves out) is unwrapped, tokens stay.
  const basic = inlinePolicy(resolveFieldPreset({ preset: 'basic', inlineColors: true }), {
    palette: PALETTE,
  });
  assert.equal(
    textOf(
      cleanEditorValue(
        doc(
          '<mark class="cdx-marker">m</mark><span class="cdx-tooltip" data-tooltip="t">t</span><span data-mex-color="pale">p</span>'
        ),
        { inline: basic }
      )
    ),
    'mt<span data-mex-color="pale">p</span>'
  );
  // Superscript without the footnote tool: plain sup stays, footnote markers go with their notes.
  const script = inlinePolicy(resolveFieldPreset({ preset: 'basic', inlineScript: true }), {});
  assert.equal(
    textOf(
      cleanEditorValue(
        doc('m<sup>2</sup> H<sub>2</sub>O<sup data-mex-footnote="f" data-mex-note="n">*</sup>'),
        {
          inline: script,
        }
      )
    ),
    'm<sup>2</sup> H<sub>2</sub>O'
  );
  // Without the option a basic field unwraps sup/sub as before (2.4 behaviour).
  const basicOnly = inlinePolicy(resolveFieldPreset({ preset: 'basic' }), {});
  assert.equal(textOf(cleanEditorValue(doc('m<sup>2</sup>'), { inline: basicOnly })), 'm2');
  // Inside footnote notes the same rules apply.
  const note = cleanEditorValue(
    doc(
      'x<sup data-mex-footnote="f1" data-mex-note="&lt;span data-mex-color=&quot;ghost&quot;&gt;n&lt;/span&gt;">*</sup>'
    ),
    { inline: on }
  );
  assert.equal(textOf(note), 'x<sup data-mex-footnote="f1" data-mex-note="n">*</sup>');
  // The policy sanitiser is cached per policy and stays idempotent.
  const sanitize = inlineSanitizerForPolicy(on);
  assert.equal(inlineSanitizerForPolicy(on), sanitize);
  const once = sanitize(html);
  assert.equal(sanitize(once), once);
});

test('server sanitiser: hostile token and annotation markup never survives', () => {
  const on = inlinePolicy(resolveFieldPreset({ inlineColors: true, inlineAnnotations: 'abbreviation' }), {
    palette: PALETTE,
  });
  for (const payload of [
    '<span data-mex-color="accent" onclick="alert(1)" style="color:red">x</span>',
    '<span data-mex-color="accent&quot; onclick=&quot;alert(1)">x</span>',
    '<mark data-mex-highlight="note" onmouseover="alert(1)">x</mark>',
    '<span data-mex-annotation="abbreviation" data-mex-a-title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" onclick="alert(1)">x</span>',
    '<span data-mex-annotation="abbreviation" data-mex-a-title="t" data-mex-a-onclick="alert(1)" data-mex-a-Upper="x">x</span>',
  ]) {
    const out = textOf(cleanEditorValue(doc(payload), { inline: on }));
    assert.doesNotMatch(
      out,
      /onclick|onmouseover|style=|<script|data-mex-a-onclick|data-mex-a-upper/i,
      payload
    );
    const rendered = renderHtml(doc(out));
    assertSafeHtml(rendered, payload);
  }
});

/* ----------------------------------------------------------- quality */

test('contrast maths: WCAG ratios and palette issues in light and dark', () => {
  assert.equal(Math.round(contrastRatio(parseColor('#000'), parseColor('#fff')) * 100) / 100, 21);
  assert.ok(contrastRatio(parseColor('#767676'), parseColor('#fff')) >= 4.5);
  assert.ok(contrastRatio(parseColor('#777777'), parseColor('#fff')) < 4.5);
  assert.equal(tokenContrast(PALETTE, 'ghost', null, 'light'), null);
  const issues = paletteContrastIssues(PALETTE);
  assert.deepEqual(
    issues.map((issue) => `${issue.mode}:${issue.color}/${issue.highlight}`),
    ['light:pale/null', 'light:pale/note']
  );
  assert.ok(issues.every((issue) => issue.ratio < 4.5));
  assert.deepEqual(paletteContrastIssues({}), []);
});

test('quality: color-contrast flags used combinations below 4.5:1 (worst theme), only with a palette', () => {
  const value = {
    blocks: [
      {
        id: 'a',
        type: 'paragraph',
        data: {
          text: '<span data-mex-color="pale">p</span> <span data-mex-color="pale">again</span> <mark data-mex-highlight="note"><span data-mex-color="accent">ok</span></mark> <span data-mex-color="ghost">?</span>',
        },
      },
      {
        id: 'b',
        type: 'header',
        data: {
          level: 2,
          text: '<mark data-mex-highlight="note"><span data-mex-color="pale">h</span></mark>',
        },
      },
    ],
  };
  const issues = lintDocument(value, { palette: PALETTE }).issues.filter(
    (issue) => issue.rule === 'color-contrast'
  );
  assert.deepEqual(
    issues.map((issue) => [issue.blockId, issue.params.pair, issue.params.mode, issue.severity]),
    [
      ['a', 'pale / -', 'light', 'warning'],
      ['b', 'pale / note', 'light', 'warning'],
    ]
  );
  assert.equal(lintDocument(value).issues.filter((issue) => issue.rule === 'color-contrast').length, 0);
});

test('parser: annotation values are bounded and names validated', () => {
  const many = Array.from({ length: 12 }, (_, i) => `data-mex-a-k${i}="v"`).join(' ');
  const [node] = parseInline(
    `<span data-mex-annotation="glossary" ${many} data-mex-a-big="${'x'.repeat(5000)}">t</span>`
  );
  const keys = Object.keys(node.attrs).filter((name) => name.startsWith('data-mex-a-'));
  assert.equal(keys.length, ANNOTATION_LIMITS.attributes);
  assert.ok(Object.values(node.attrs).every((value) => value.length <= ANNOTATION_LIMITS.text));
  const [bad] = parseInline('<span data-mex-annotation="Bad Name">t</span>');
  assert.deepEqual(bad.attrs, {});
});

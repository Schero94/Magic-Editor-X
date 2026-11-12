/**
 * Custom block SDK (2.3): definitions, registration rules, schema cleaning,
 * presets, the collaboration guard, renderers (HTML, tree, text, Markdown,
 * React, Vue with the XSS corpus), diff, find and replace, quality and
 * statistics. Uses the example block of docs/guides/custom-blocks-sdk.md.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseDocument } from 'htmlparser2';
import {
  defineBlock,
  blockJsonSchema,
  BlockDefinitionError,
  RESERVED_BLOCK_NAMES,
  BLOCK_LIMITS,
} from '../shared/blocks/index.mjs';
import { compileBlock } from '../shared/blocks/define.mjs';
import { registerBlockDefinition } from '../shared/blocks/registry.mjs';
import { clearActiveBlocks, activeBlocks } from '../shared/blocks/active.mjs';
import { BLOCK_POLICIES, sanitizeEditorData } from '../shared/sanitize-policy.mjs';
import { BUILTIN_BLOCKS, resolveFieldPreset, checkPreset } from '../shared/presets.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import { applyEditorDataToDoc, createSeedUpdate } from '../shared/ydoc.mjs';
import { renderHtml, renderTree, renderText, renderMarkdown, inlineToHtml } from '../shared/render/index.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { collectSegments } from '../shared/ai-fields.mjs';
import { extractLinks, lintDocument } from '../shared/quality.mjs';
import { computeStats } from '../shared/editor-data.mjs';
import { XSS, assertSafeHtml } from './helpers/xss-corpus.mjs';
import { validate } from './helpers/json-schema.mjs';
import { calloutCard } from './fixtures/callout-card.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');
const { RESERVED_NAMES } = require('../server/src/services/custom-blocks.js');
const blocksService = require('../server/src/services/blocks.js');

const doc = (...blocks) => ({ time: 1, version: '2.31.7', blocks });
const cardBlock = (id, data) => ({ id, type: 'calloutCard', data });
const HOSTILE = {
  title: `<img src=x onerror=alert(1)>${'t'.repeat(200)}`,
  body: 'Hi <b onclick="alert(1)">there</b><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
  link: 'javascript:alert(1)',
  tone: 'evil',
  extra: { deep: '<script>alert(1)</script>' },
};

afterEach(() => clearActiveBlocks());

test('defineBlock validates the definition with clear messages', () => {
  const bad = [
    [{ name: '1x', schema: { a: { type: 'text' } } }, /must match/],
    [{ name: 'Paragraph', schema: { a: { type: 'text' } } }, /built-in tool name/],
    [{ name: 'ok', schema: {} }, /1 to 50 fields/],
    [{ name: 'okBlock', schema: { a: { type: 'html' } } }, /unknown field type/],
    [{ name: 'okBlock', schema: { a: { type: 'text', maxx: 3 } } }, /unknown option "maxx"/],
    [{ name: 'okBlock', schema: { a: { type: 'text', max: 0 } } }, /"max" must be an integer/],
    [{ name: 'okBlock', schema: { constructor: { type: 'text' } } }, /field name/],
    [{ name: 'okBlock', schema: { a: { type: 'enum', values: [] } } }, /"values"/],
    [{ name: 'okBlock', schema: { a: { type: 'enum', values: ['x'], default: 'y' } } }, /"default"/],
    [{ name: 'okBlock', schema: { a: { type: 'url', schemes: ['javascript'] } } }, /"schemes"/],
    [{ name: 'okBlock', schema: { a: { type: 'number', min: 5, max: 1 } } }, /"min"/],
    [{ name: 'okBlock', schema: { a: { type: 'text' } }, presets: ['full'] }, /"presets"/],
    [{ name: 'okBlock', schema: { a: { type: 'text' } }, render: 'x' }, /"render" must be a function/],
    [{ name: 'okBlock', schema: { a: { type: 'text' } }, extra: 1 }, /unknown key "extra"/],
    [
      {
        name: 'deepBlock',
        schema: {
          a: {
            type: 'object',
            fields: {
              b: {
                type: 'array',
                items: {
                  type: 'object',
                  fields: {
                    c: { type: 'array', items: { type: 'object', fields: { d: { type: 'text' } } } },
                  },
                },
              },
            },
          },
        },
      },
      /nest at most 4/,
    ],
  ];
  for (const [definition, message] of bad) {
    assert.throws(
      () => defineBlock(definition),
      (error) => {
        assert.ok(error instanceof BlockDefinitionError);
        assert.match(error.message, message);
        return true;
      }
    );
  }
  assert.equal(Object.isFrozen(calloutCard), true);
  assert.equal(calloutCard.version, 1);
  // A compiled definition can be defined again (idempotent).
  assert.equal(compileBlock(compileBlock(calloutCard)), compileBlock(calloutCard));
});

test('reserved names cover every built-in block, tool and tune name', () => {
  const reserved = new Set(RESERVED_BLOCK_NAMES.map((name) => name.toLowerCase()));
  for (const name of [...Object.keys(BLOCK_POLICIES), ...BUILTIN_BLOCKS, ...RESERVED_NAMES])
    assert.ok(reserved.has(name.toLowerCase()), name);
  for (const name of ['gallery', 'VIDEO', 'audio', 'mediaLib'])
    assert.throws(() => defineBlock({ name, schema: { a: { type: 'text' } } }), { code: 'RESERVED_NAME' });
});

test('registration: names are unique ignoring case, the same object registers once', () => {
  registerBlockDefinition(calloutCard);
  registerBlockDefinition(calloutCard);
  assert.equal(activeBlocks().length, 1);
  assert.throws(
    () => registerBlockDefinition(defineBlock({ name: 'CALLOUTCARD', schema: { a: { type: 'text' } } })),
    { code: 'NAME_TAKEN' }
  );
});

test('server service: register before bootstrap, clash with a Settings block stops the start, then sealed', async () => {
  const rows = [{ name: 'calloutcard' }];
  const strapi = { db: { query: () => ({ findMany: async () => rows }) } };
  const service = blocksService({ strapi });
  service.register(calloutCard);
  assert.equal(service.isRegisteredName('CalloutCard'), true);
  assert.deepEqual(service.summaries()[0].fields[1], { key: 'body', type: 'inline' });
  await assert.rejects(
    () => service.verify(),
    (error) => {
      assert.equal(error.code, 'NAME_TAKEN');
      assert.match(error.message, /"calloutCard" clash with a custom block defined in Settings/);
      return true;
    }
  );
  rows.length = 0;
  await service.verify();
  assert.throws(() => service.register(defineBlock({ name: 'lateBlock', schema: { a: { type: 'text' } } })), {
    code: 'REGISTRY_SEALED',
  });
});

test('schema cleaning per field type: bounded, typed, unknown keys dropped, deterministic', () => {
  const def = compileBlock(
    defineBlock({
      name: 'allTypes',
      schema: {
        text: { type: 'text', max: 5 },
        inline: { type: 'inline', max: 50 },
        url: { type: 'url', schemes: ['https'], relative: false },
        rel: { type: 'url' },
        mail: { type: 'url', schemes: ['mailto'] },
        tone: { type: 'enum', values: ['a', 'b'], default: 'b' },
        count: { type: 'number', min: 0, max: 10, integer: true },
        ratio: { type: 'number', min: 0, max: 1, default: 0.5 },
        flag: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'text', max: 3 }, max: 2 },
        items: {
          type: 'array',
          max: 3,
          items: { type: 'object', fields: { label: { type: 'text' }, href: { type: 'url' } } },
        },
        meta: { type: 'object', fields: { note: { type: 'inline' } } },
      },
    })
  );
  const inline = (html) => inlineToHtml(html, { storage: true });
  const clean = def.clean(
    {
      text: 'abcdefgh',
      inline: '<b>x</b><img src=x onerror=alert(1)>',
      url: 'http://insecure.example.test',
      rel: '/about',
      mail: 'mailto:a@example.test',
      tone: 'c',
      count: 2.5,
      ratio: 2,
      flag: 'yes',
      tags: ['abcd', 5, 'x', 'y'],
      items: [{ label: 'One', href: 'javascript:alert(1)', other: 1 }, 'nope', { label: 'Two' }],
      meta: { note: '<script>x</script>ok', more: 1 },
      unknown: 'dropped',
      ['__proto__']: { polluted: 1 },
    },
    inline
  );
  assert.deepEqual(clean, {
    text: 'abcde',
    inline: '<b>x</b>',
    url: '',
    rel: '/about',
    mail: 'mailto:a@example.test',
    tone: 'b',
    ratio: 0.5,
    flag: false,
    tags: ['abc', 'x'],
    items: [
      { label: 'One', href: '' },
      { label: 'Two', href: '' },
    ],
    meta: { note: 'ok' },
  });
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  assert.deepEqual(def.clean(clean, inline), clean, 'cleaning is idempotent');
  assert.deepEqual(def.clean(null, inline).items, []);
  // The JSON Schema describes exactly what cleaning stores.
  const schema = blockJsonSchema(def);
  assert.deepEqual(validate(schema, schema, clean), []);
  assert.notDeepEqual(validate(schema, schema, { ...clean, unknown: 1 }), []);
});

test('the value budget bounds huge arrays', () => {
  const def = compileBlock(
    defineBlock({
      name: 'bigBlock',
      schema: {
        rows: {
          type: 'array',
          max: 500,
          items: { type: 'array', max: 500, items: { type: 'text' } },
        },
      },
    })
  );
  const row = Array.from({ length: 500 }, () => 'x');
  const clean = def.clean({ rows: Array.from({ length: 500 }, () => row) }, (s) => s);
  const values = clean.rows.reduce((sum, list) => sum + list.length + 1, 1);
  assert.ok(values <= BLOCK_LIMITS.maxValues + 1, String(values));
});

test('the sanitize hook runs after the schema and its result is cleaned again; a throw is ignored', () => {
  const def = compileBlock(
    defineBlock({
      name: 'hookBlock',
      schema: { title: { type: 'text', max: 10 }, link: { type: 'url' } },
      sanitize: (data) => ({
        ...data,
        title: data.title.trim().toUpperCase(),
        link: 'javascript:x',
        evil: 1,
      }),
    })
  );
  assert.deepEqual(
    def.clean({ title: '  hello  ', link: '/x' }, (s) => s),
    { title: 'HELLO', link: '' }
  );
  const throwing = compileBlock(
    defineBlock({
      name: 'throwBlock',
      schema: { title: { type: 'text' } },
      sanitize: () => {
        throw new Error('bug');
      },
    })
  );
  assert.deepEqual(
    throwing.clean({ title: 'x', y: 1 }, (s) => s),
    { title: 'x' }
  );
});

test('server save: the registered schema applies; without the definition the generic policy keeps the data', () => {
  const value = doc(cardBlock('c', HOSTILE));
  const generic = cleanEditorValue(value);
  assert.ok(generic.blocks[0].data.extra, 'generic policy keeps unknown keys (stored content is never lost)');
  registerBlockDefinition(calloutCard);
  const clean = cleanEditorValue(value);
  assert.deepEqual(Object.keys(clean.blocks[0].data), ['title', 'body', 'link', 'tone']);
  assert.equal(clean.blocks[0].data.title.length, 120);
  assert.equal(clean.blocks[0].data.link, '');
  assert.equal(clean.blocks[0].data.tone, 'info');
  assert.doesNotMatch(clean.blocks[0].data.body, /script|onclick|javascript/);
  // Explicit compiled definitions (tests, tools) take precedence over the registry.
  const explicit = sanitizeEditorData(value, {
    sanitizeInlineHtml: (s) => s,
    sanitizeRawHtml: () => '',
    blocks: new Map(),
  });
  assert.ok(explicit.blocks[0].data.extra);
  clearActiveBlocks();
  // A removed definition: stored data stays under the generic policy (every
  // string is then inline HTML, so markup in text fields is cleaned too).
  const stored = cleanEditorValue(
    doc(cardBlock('k', { title: 'Plain & simple', body: '<b>x</b>', link: '/a', tone: 'info' }))
  );
  assert.deepEqual(stored.blocks[0].data, {
    title: 'Plain &amp; simple',
    body: '<b>x</b>',
    link: '/a',
    tone: 'info',
  });
});

test('presets: full includes registered blocks, named presets only when the definition lists them', () => {
  registerBlockDefinition(calloutCard);
  const value = doc(cardBlock('c', { title: 'x', body: '', link: '', tone: 'info' }));
  assert.equal(resolveFieldPreset({ preset: 'full' }).blocks, null);
  assert.ok(resolveFieldPreset({ preset: 'article' }).blocks.includes('calloutCard'));
  for (const preset of ['basic', 'minimal']) {
    const resolved = resolveFieldPreset({ preset });
    assert.ok(!resolved.blocks.includes('calloutCard'));
    assert.deepEqual(checkPreset(value, resolved)[0], {
      code: 'BLOCK_NOT_ALLOWED',
      params: { type: 'calloutCard' },
      blockId: 'c',
      index: 0,
    });
  }
  assert.deepEqual(checkPreset(value, resolveFieldPreset({ allowedBlocks: 'paragraph, calloutCard' })), []);
  // URL fields are external links for `linkTargets`.
  const linked = doc(cardBlock('l', { title: '', body: '', link: 'https://a.example.test', tone: 'info' }));
  assert.equal(
    checkPreset(linked, resolveFieldPreset({ linkTargets: 'internal' }))[0].code,
    'LINK_NOT_ALLOWED'
  );
});

test('collaboration guard: a registered block is accepted live and refused where the preset leaves it out', () => {
  registerBlockDefinition(calloutCard);
  const seed = createSeedUpdate(
    { time: 1, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] },
    'e1'
  );
  const room = () => {
    const d = new Y.Doc();
    Y.applyUpdate(d, seed);
    return d;
  };
  const client = room();
  const before = Y.encodeStateVector(client);
  applyEditorDataToDoc(
    client,
    doc(
      { id: 'p1', type: 'paragraph', data: { text: 'hi' } },
      cardBlock('c1', { title: 'Live', body: '<b>x</b>', link: '', tone: 'success' })
    )
  );
  const update = Y.encodeStateAsUpdate(client, before);
  const rule = (options) => {
    const preset = resolveFieldPreset(options);
    return (block) => (checkPreset({ blocks: [block] }, preset).length ? 'PRESET_VIOLATION' : null);
  };
  assert.deepEqual(applyCheckedUpdate(room(), update, { checkBlock: rule({ preset: 'article' }) }), {
    ok: true,
    changed: true,
  });
  const refused = applyCheckedUpdate(room(), update, { checkBlock: rule({ preset: 'minimal' }) });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'PRESET_VIOLATION');
});

const SAMPLE = doc(
  { id: 'p', type: 'paragraph', data: { text: 'Intro' } },
  cardBlock('c', {
    title: 'Note',
    body: 'Read <a href="https://a.example.test/x">this</a>',
    link: '/docs',
    tone: 'warning',
  })
);

test('renderers: definitions passed as `blocks` render through the definition; without them, neutral output', () => {
  const options = { blocks: [calloutCard] };
  assert.equal(
    renderHtml(SAMPLE, options),
    '<p class="mex-paragraph">Intro</p>\n<aside class="callout-card callout-card-warning" data-mex-block="calloutCard"><p class="callout-card-title">Note</p><div class="callout-card-body">Read <a href="https://a.example.test/x">this</a></div><a class="callout-card-link" href="/docs">Read more</a></aside>'
  );
  assert.equal(renderText(SAMPLE, options), 'Intro\n\nNote\nRead this\n/docs');
  assert.equal(
    renderMarkdown(SAMPLE, options),
    'Intro\n\n**Note**\n\nRead [this](https://a.example.test/x)\n\n[Read more](</docs>)'
  );
  assert.equal(renderTree(SAMPLE, options)[2].tag, 'aside');
  // Without the definition: the 2.2 neutral rendering (escaped top-level values).
  assert.match(renderHtml(SAMPLE), /<div class="mex-block mex-calloutCard" data-mex-block="calloutCard">/);
  // Overrides still win over the definition.
  assert.equal(renderHtml(doc(SAMPLE.blocks[1]), { ...options, overrides: { calloutCard: () => [] } }), '');
});

test('renderers: default output without render/text/markdown, failing hooks fall back, strings need the raw opt-in', () => {
  const plain = defineBlock({
    name: 'plainCard',
    schema: {
      title: { type: 'text' },
      body: { type: 'inline' },
      link: { type: 'url' },
      on: { type: 'boolean' },
    },
  });
  const value = doc({
    id: 'x',
    type: 'plainCard',
    data: { title: 'T', body: '<i>b</i>', link: '/l', on: true },
  });
  assert.equal(
    renderHtml(value, { blocks: [plain] }),
    '<div class="mex-block mex-plainCard" data-mex-block="plainCard"><div class="mex-field" data-mex-field="title">T</div><div class="mex-field" data-mex-field="body"><i>b</i></div><div class="mex-field" data-mex-field="link"><a href="/l">/l</a></div><div class="mex-field" data-mex-field="on">true</div></div>'
  );
  assert.equal(renderText(value, { blocks: [plain] }), 'T\nb');
  assert.equal(renderMarkdown(value, { blocks: [plain] }), 'T\n\n_b_');
  const failing = defineBlock({
    name: 'failCard',
    schema: { title: { type: 'text' } },
    render: () => {
      throw new Error('bug');
    },
    text: () => {
      throw new Error('bug');
    },
  });
  const failValue = doc({ id: 'f', type: 'failCard', data: { title: 'T' } });
  assert.match(renderHtml(failValue, { blocks: [failing] }), /data-mex-field="title">T</);
  assert.equal(renderText(failValue, { blocks: [failing] }), 'T');
  const stringy = defineBlock({
    name: 'stringCard',
    schema: { title: { type: 'text' } },
    render: (block) => `<script>alert(1)</script><b>${block.data.title}</b>`,
  });
  const stringValue = doc({ id: 's', type: 'stringCard', data: { title: 'T' } });
  assert.doesNotMatch(renderHtml(stringValue, { blocks: [stringy] }), /<script|<b>/);
  assert.equal(
    renderHtml(stringValue, {
      blocks: [stringy],
      rawHtml: 'allow',
      sanitizeRaw: (html) => inlineToHtml(html),
    }),
    '<div class="mex-override" data-mex-block="stringCard"><b>T</b></div>'
  );
});

/**
 * Canonical HTML (comments dropped, entities decoded, attributes sorted) for comparing adapters.
 * @param {string} html - HTML.
 * @returns {string} JSON.
 */
const canonical = (html) => {
  const walk = (nodes) => {
    const out = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        if (typeof out[out.length - 1] === 'string') out[out.length - 1] += node.data;
        else out.push(node.data);
      } else if (node.type === 'tag' || node.type === 'script')
        out.push([
          node.name,
          Object.entries(node.attribs).sort(([x], [y]) => (x < y ? -1 : 1)),
          walk(node.children),
        ]);
    }
    return out;
  };
  return JSON.stringify(walk(parseDocument(html).children));
};

/**
 * Fails when parsed HTML has a dangerous element, attribute or URL.
 * @param {string} html - HTML.
 * @param {string} label - Message.
 */
const assertNoActiveContent = (html, label) => {
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'script' || node.type === 'style') assert.fail(`${label}: <${node.name}>`);
      if (node.type !== 'tag') continue;
      assert.ok(
        !['iframe', 'object', 'embed', 'svg', 'math', 'form', 'img'].includes(node.name),
        `${label}: <${node.name}>`
      );
      for (const [name, value] of Object.entries(node.attribs)) {
        assert.ok(!/^on|^(style|srcdoc|formaction)$/i.test(name), `${label}: ${name}`);
        if (['href', 'src'].includes(name))
          assert.doesNotMatch(value, /^\s*(javascript|data|vbscript):/i, label);
      }
      walk(node.children);
    }
  };
  walk(parseDocument(html).children);
};

test('XSS parity: hostile data in a registered block is safe in HTML, React and Vue and identical across them', async () => {
  const unsafe = defineBlock({
    name: 'unsafeCard',
    schema: {
      title: { type: 'text' },
      body: { type: 'inline' },
      link: { type: 'url', schemes: ['http', 'https', 'mailto'] },
    },
    // A careless renderer: hostile attributes and tags are removed by the node validation.
    render: (block, { h, inlineNodes }) =>
      h('div', { class: 'u', onclick: block.data.title, style: 'x', title: block.data.title }, [
        h('script', {}, block.data.title),
        h(
          'a',
          { href: block.data.link || block.data.title, onmouseover: 'alert(1)' },
          inlineNodes(block.data.body)
        ),
        h('iframe', { src: block.data.title, srcdoc: block.data.title }),
        h('p', {}, block.data.title),
      ]),
  });
  const options = { blocks: [unsafe, calloutCard] };
  const normalize = (html) => html.replace(/<!--[[\]]-->/g, '');
  for (const payload of XSS) {
    const value = doc(
      { id: 'u', type: 'unsafeCard', data: { title: payload, body: payload, link: payload } },
      cardBlock('c', { title: payload, body: payload, link: payload, tone: payload })
    );
    const html = renderHtml(value, options);
    assertSafeHtml(html.replace(/<iframe\b[^>]*>/g, ''), payload);
    assertNoActiveContent(html, payload);
    const react = ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, { value, options }));
    const vue = normalize(
      await renderToString(createSSRApp({ render: () => h(VueContent, { value, options }) }))
    );
    for (const [name, out] of [
      ['react', react],
      ['vue', vue],
    ]) {
      assertNoActiveContent(out, `${name} ${payload}`);
      assert.equal(canonical(out), canonical(html), `${name} equals renderHtml: ${payload}`);
      assert.equal(out.includes('<aside class="callout-card'), true, `${name} ${payload}`);
    }
  }
});

test('diff, find and replace, AI segments, quality and statistics follow the schema', () => {
  registerBlockDefinition(calloutCard);
  const before = doc(
    cardBlock('c', { title: 'Old title', body: 'Hello <b>world</b>', link: '', tone: 'info' })
  );
  const after = doc(
    cardBlock('c', { title: 'New title', body: 'Hello <b>there</b>', link: '/x', tone: 'success' })
  );
  const entry = diffDocuments(before, after)[0];
  assert.equal(entry.op, 'changed');
  const kinds = Object.fromEntries(entry.fields.map((field) => [field.path, field.kind]));
  assert.deepEqual(kinds, { title: 'text', body: 'text', link: 'value', tone: 'value' });

  const found = findMatches(after, 'there');
  assert.deepEqual(
    found.matches.map((match) => match.path),
    ['body']
  );
  assert.equal(findMatches(after, 'title').matches[0].path, 'title');
  assert.equal(findMatches(after, 'success').matches.length, 0, 'enum values are not text');
  const replaced = replaceMatches(after, 'there', '<you>');
  assert.equal(replaced.data.blocks[0].data.body, 'Hello <b>&lt;you&gt;</b>');
  assert.deepEqual(
    collectSegments(after).map((segment) => segment.path),
    ['body']
  );

  const links = extractLinks(
    doc(
      cardBlock('c', {
        title: '',
        body: '<a href="https://b.example.test">b</a>',
        link: 'https://a.example.test',
        tone: 'info',
      })
    )
  );
  assert.deepEqual(links.external.map((link) => link.url).sort(), [
    'https://a.example.test',
    'https://b.example.test',
  ]);
  assert.equal(lintDocument(after).issues.length, 0);
  assert.deepEqual(computeStats(after), { blocks: 1, words: 4, characters: 21 });
});

test('the guide, the fixture and the host example use the same definition', () => {
  const guide = readFileSync(new URL('../docs/guides/custom-blocks-sdk.md', import.meta.url), 'utf8');
  const fixture = readFileSync(new URL('./fixtures/callout-card.mjs', import.meta.url), 'utf8');
  const start = fixture.indexOf('export const calloutCard');
  const body = fixture.slice(start).trim();
  assert.ok(guide.includes(body), 'the guide shows tests/fixtures/callout-card.mjs verbatim');
  for (const name of ['defineBlock', 'blockJsonSchema']) assert.ok(guide.includes(name), name);
});

test('admin helpers: localized titles, Editor.js sanitize rules from the schema, Settings list merge', async () => {
  const { localized, sanitizeRulesFor, mergeCodeBlocks } =
    await import('../admin/src/editor/block-registry-logic.mjs');
  const { LINK_SANITIZE } = await import('../admin/src/editor/tools/sanitize-config.js').catch(() => ({}));
  assert.equal(localized({ en: 'Card', de: 'Karte' }, 'de-DE'), 'Karte');
  assert.equal(localized({ en: 'Card' }, 'fr'), 'Card');
  assert.equal(localized('Card', 'de'), 'Card');
  const rules = sanitizeRulesFor(compileBlock(calloutCard).schema);
  assert.equal(rules.title, true);
  assert.equal(rules.link, true);
  assert.equal(rules.body.b, true);
  assert.equal(rules.body.a['data-mex-document-id'], true);
  if (LINK_SANITIZE) assert.deepEqual(rules.body.a, LINK_SANITIZE);
  const nested = sanitizeRulesFor(
    compileBlock(
      defineBlock({
        name: 'nestBlock',
        schema: { items: { type: 'array', items: { type: 'object', fields: { t: { type: 'inline' } } } } },
      })
    ).schema
  );
  assert.equal(nested.items.t.i, true);
  const rows = mergeCodeBlocks(
    [
      { name: 'serverOnly', version: 2, title: null, fields: [], presets: [] },
      { name: 'calloutCard', version: 1, title: 'Callout card', fields: [], presets: ['article'] },
    ],
    [
      { definition: compileBlock(calloutCard), title: { de: 'Hinweiskarte' } },
      {
        definition: compileBlock(defineBlock({ name: 'adminOnly', schema: { a: { type: 'text' } } })),
        title: 'Admin',
      },
    ],
    'de'
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.title, row.onServer, row.inAdmin]),
    [
      ['adminOnly', 'Admin', false, true],
      ['calloutCard', 'Hinweiskarte', true, true],
      ['serverOnly', 'serverOnly', true, false],
    ]
  );
});

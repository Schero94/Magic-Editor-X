import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseDocument } from 'htmlparser2';
import {
  renderHtml,
  renderTree,
  isBlockId,
  isFieldPath,
  strapiSourceValue,
  locateMessage,
  editViewUrl,
  LOCATE_MESSAGE_TYPE,
} from '../shared/render/index.mjs';
import { blockIdOptions, annotateBlockSources } from '../shared/render/source.mjs';
import { parseLocateMessage, parseLocateQuery, LOCATE_QUERY } from '../shared/preview-locate.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import { XSS, xssDocument, assertSafeHtml } from './helpers/xss-corpus.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ALL = fixture('editor-2x-all-blocks.json');
const LEGACY = fixture('editor-1x-string.json');
const SOURCE = {
  documentId: 'abc123def456',
  model: 'api::article.article',
  kind: 'collectionType',
  locale: 'en',
};

const reactHtml = (props) => ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, props));
const vueHtml = (props) => renderToString(createSSRApp({ render: () => h(VueContent, props) }));

/** Canonical form (comments dropped, entities decoded, attributes sorted). */
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

/** Top-level elements of an HTML string. */
const topElements = (html) => parseDocument(html).children.filter((node) => node.type === 'tag');

test('default output is unchanged: no option, false and invalid values add nothing', () => {
  for (const value of [ALL, LEGACY, xssDocument('<img src=x onerror=alert(1)>')]) {
    const base = renderHtml(value);
    assert.doesNotMatch(base, /data-mex-block-id|data-mex-field-path|data-strapi-source/);
    for (const blockIds of [undefined, false, null, 0, '', 'yes', [], () => true]) {
      assert.equal(renderHtml(value, { blockIds }), base, String(blockIds));
    }
  }
});

test('blockIds: true marks every top-level block element with its id and nothing else', () => {
  const value = {
    blocks: [
      { id: 'h1', type: 'header', data: { text: 'Title', level: 2 } },
      { id: 'p1', type: 'paragraph', data: { text: 'One' } },
      { id: 'q1', type: 'quote', data: { text: 'Q', caption: 'C' } },
    ],
  };
  const html = renderHtml(value, { blockIds: true });
  const tops = topElements(html);
  assert.deepEqual(
    tops.map((node) => node.attribs['data-mex-block-id']),
    ['h1', 'p1', 'q1']
  );
  assert.ok(tops.every((node) => !('data-mex-field-path' in node.attribs)));
  // Nested elements are not marked; only the attributes were added.
  assert.equal((html.match(/data-mex-block-id/g) || []).length, 3);
  assert.equal(html.replace(/ data-mex-block-id="[^"]*"/g, ''), renderHtml(value));
});

test('every fixture block keeps its id; the stripped output equals the default output', () => {
  const opts = { blockIds: { field: 'sections.2.body', strapiSource: SOURCE } };
  const html = renderHtml(ALL, opts);
  const strip = (s) => s.replace(/ data-(?:mex-block-id|mex-field-path|strapi-source)="[^"]*"/g, '');
  assert.equal(strip(html), renderHtml(ALL));
  const ids = new Set(ALL.blocks.map((block) => block.id));
  for (const node of topElements(html)) {
    if (node.attribs.class && node.attribs.class.includes('mex-footnotes')) continue;
    assert.ok(ids.has(node.attribs['data-mex-block-id']), node.name);
    assert.equal(node.attribs['data-mex-field-path'], 'sections.2.body');
    assert.equal(
      node.attribs['data-strapi-source'],
      'documentId=abc123def456&type=json&model=api%3A%3Aarticle.article&kind=collectionType&locale=en&fieldPath=sections.2.body'
    );
  }
});

test('the strapi source has no `path` key (Strapi 5.62 would overwrite the blocks with text)', () => {
  const value = strapiSourceValue(SOURCE, 'body');
  const params = new URLSearchParams(value);
  assert.equal(params.has('path'), false);
  assert.equal(params.get('fieldPath'), 'body');
  assert.equal(params.get('type'), 'json');
  assert.equal(params.get('model'), 'api::article.article');
  // The preview script matches `[data-strapi-source*="path=<field>"]` case-sensitively.
  assert.equal(value.includes('path=body'), false);
});

test('ids, paths and source parts are validated; invalid ones are left out', () => {
  for (const id of ['', ' ', 'a b', '"><script>', 'x'.repeat(65), 'é', null, 42])
    assert.equal(isBlockId(id), false, String(id));
  for (const id of ['a', 'A-b_9', 'x'.repeat(64)]) assert.equal(isBlockId(id), true);
  for (const path of ['body', 'seo.body', 'sections.2.body', 'zone.10.items.3.text'])
    assert.equal(isFieldPath(path), true, path);
  for (const path of ['', '.body', 'body.', '2.body', 'a..b', 'a b', 'body"', 'a-b', 'x'.repeat(301), null])
    assert.equal(isFieldPath(path), false, String(path));
  assert.equal(strapiSourceValue({ ...SOURCE, documentId: 'a&path=x' }, 'body'), null);
  assert.equal(strapiSourceValue({ ...SOURCE, model: 'api::a.b"x' }, 'body'), null);
  assert.equal(strapiSourceValue(SOURCE, 'bad path'), null);
  assert.doesNotMatch(
    strapiSourceValue({ ...SOURCE, locale: 'en"><x', kind: 'evil' }, 'body'),
    /locale|kind/
  );

  const value = {
    blocks: [
      { id: '"><img src=x onerror=alert(1)>', type: 'paragraph', data: { text: 'A' } },
      { id: 'ok', type: 'paragraph', data: { text: 'B' } },
    ],
  };
  const html = renderHtml(value, { blockIds: { field: 'body"><script>', strapiSource: SOURCE } });
  // The renderer replaces an invalid stored id with a generated one before rendering.
  const [first, second] = topElements(html);
  assert.match(first.attribs['data-mex-block-id'], /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(second.attribs['data-mex-block-id'], 'ok');
  assert.doesNotMatch(html, /onerror|data-mex-field-path|data-strapi-source/);
  assert.deepEqual(
    annotateBlockSources(
      [
        {
          type: 'block',
          block: { id: '"><x' },
          children: [{ type: 'element', tag: 'p', attrs: {}, children: [] }],
        },
      ],
      { field: null, source: null }
    )[0].children[0].attrs,
    {}
  );
  assert.deepEqual(blockIdOptions({ field: 'x y' }), { field: null, source: null });
  assert.equal(blockIdOptions(undefined), null);
});

test('React and Vue output equal renderHtml with block ids (fixtures, legacy, options)', async () => {
  const options = { blockIds: { field: 'body', strapiSource: SOURCE }, code: { copyButton: true } };
  for (const value of [ALL, LEGACY]) {
    for (const opts of [{ blockIds: true }, options]) {
      const expected = normalize(renderHtml(value, opts));
      assert.equal(normalize(reactHtml({ value, options: opts })), expected);
      assert.equal(normalize(await vueHtml({ value, options: opts })), expected);
    }
  }
});

test('XSS corpus with block ids: safe and identical in HTML, React and Vue', async () => {
  for (const payload of XSS) {
    const value = xssDocument(payload);
    value.blocks.forEach((block, index) => {
      block.id = index % 2 ? payload.slice(0, 64) : `b${index}`;
    });
    const options = { blockIds: { field: 'body', strapiSource: { ...SOURCE, locale: payload } } };
    const expected = renderHtml(value, options);
    assertSafeHtml(expected, payload);
    const react = reactHtml({ value, options });
    const vue = await vueHtml({ value, options });
    assert.equal(normalize(react), normalize(expected), payload);
    assert.equal(normalize(vue), normalize(expected), payload);
    assertSafeHtml(react, `react ${payload}`);
  }
});

test('string overrides (raw HTML) carry no attributes; node overrides do', () => {
  const value = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'A' } }] };
  assert.equal(
    renderHtml(value, { blockIds: true, overrides: { paragraph: () => '<p>raw</p>' } }),
    '<p>raw</p>'
  );
  assert.equal(
    renderHtml(value, {
      blockIds: true,
      overrides: { paragraph: (_b, helpers) => helpers.h('section', {}, 'n') },
    }),
    '<section data-mex-block-id="p1">n</section>'
  );
  // The render tree carries the same attributes (renderTree has no block wrappers).
  assert.equal(renderTree(value, { blockIds: true })[0].attrs['data-mex-block-id'], 'p1');
  // annotateBlockSources never changes its input nodes.
  const nodes = [
    {
      type: 'block',
      block: { id: 'p1' },
      children: [{ type: 'element', tag: 'p', attrs: {}, children: [] }],
    },
  ];
  const out = annotateBlockSources(nodes, { field: null, source: null });
  assert.deepEqual(nodes[0].children[0].attrs, {});
  assert.deepEqual(out[0].children[0].attrs, { 'data-mex-block-id': 'p1' });
});

test('locate message and query: built and parsed strictly', () => {
  assert.deepEqual(locateMessage('body', 'p1'), { type: LOCATE_MESSAGE_TYPE, field: 'body', blockId: 'p1' });
  assert.deepEqual(locateMessage('body'), { type: LOCATE_MESSAGE_TYPE, field: 'body', blockId: null });
  assert.equal(locateMessage('bad path', 'p1'), null);
  assert.equal(locateMessage('body', '"><x'), null);
  assert.deepEqual(parseLocateMessage(locateMessage('sections.1.body', 'p1')), {
    field: 'sections.1.body',
    blockId: 'p1',
  });
  for (const data of [
    null,
    'x',
    [],
    { type: 'strapiFieldFocusIntent' },
    { type: LOCATE_MESSAGE_TYPE },
    { type: LOCATE_MESSAGE_TYPE, field: 'a', blockId: 5 },
  ])
    assert.equal(parseLocateMessage(data), null);

  assert.deepEqual(parseLocateQuery('?mexField=body&mexBlock=p1&plugins[i18n][locale]=en'), {
    field: 'body',
    blockId: 'p1',
  });
  assert.deepEqual(parseLocateQuery('mexField=body'), { field: 'body', blockId: null });
  assert.equal(parseLocateQuery('?mexField=body&mexField=summary'), null);
  assert.equal(parseLocateQuery('?mexField=body&mexBlock=a&mexBlock=b'), null);
  assert.equal(parseLocateQuery('?mexBlock=p1'), null);
  assert.equal(parseLocateQuery('?mexField=body&mexBlock=%22%3E'), null);
  assert.equal(parseLocateQuery(`?mexField=${'a'.repeat(5000)}`), null);
  assert.deepEqual(LOCATE_QUERY, { field: 'mexField', block: 'mexBlock' });
});

test('editViewUrl builds Content Manager URLs and refuses invalid input', () => {
  assert.equal(
    editViewUrl({
      adminUrl: 'https://cms.example.test/admin/',
      model: 'api::article.article',
      documentId: 'abc123',
      locale: 'de',
      field: 'body',
      blockId: 'p1',
    }),
    'https://cms.example.test/admin/content-manager/collection-types/api::article.article/abc123?plugins%5Bi18n%5D%5Blocale%5D=de&mexField=body&mexBlock=p1'
  );
  assert.equal(
    editViewUrl({
      adminUrl: 'http://127.0.0.1:1337/admin',
      model: 'api::homepage.homepage',
      kind: 'singleType',
      field: 'sections.0.body',
    }),
    'http://127.0.0.1:1337/admin/content-manager/single-types/api::homepage.homepage?mexField=sections.0.body'
  );
  for (const input of [
    null,
    { adminUrl: 'javascript:alert(1)', model: 'api::a.a', documentId: 'x', field: 'body' },
    { adminUrl: 'https://cms.example.test/admin', model: 'api::a.a', field: 'body' },
    { adminUrl: 'https://cms.example.test/admin', model: 'evil', documentId: 'x', field: 'body' },
    { adminUrl: 'https://cms.example.test/admin', model: 'api::a.a', documentId: 'x/../y', field: 'body' },
    {
      adminUrl: 'https://cms.example.test/admin',
      model: 'api::a.a',
      documentId: 'x',
      field: 'body',
      locale: 'e n',
    },
    {
      adminUrl: 'https://cms.example.test/admin',
      model: 'api::a.a',
      documentId: 'x',
      field: 'body',
      blockId: '<x>',
    },
    { adminUrl: 'not a url', model: 'api::a.a', documentId: 'x', field: 'body' },
  ])
    assert.equal(editViewUrl(input), null, JSON.stringify(input));
});

test('locate messages are accepted only from frames embedded in the page', async () => {
  const { isEmbeddedFrameWindow } = await import('../admin/src/editor/frame-source.mjs');
  const preview = {};
  const doc = { querySelectorAll: () => [{ contentWindow: {} }, { contentWindow: preview }] };
  assert.equal(isEmbeddedFrameWindow(preview, doc), true);
  for (const source of [null, undefined, {}, 'x']) assert.equal(isEmbeddedFrameWindow(source, doc), false);
  assert.equal(isEmbeddedFrameWindow(preview, null), false);
});

test('the editor field wires locate requests through the shared parsers', () => {
  const source = readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /parseLocateQuery\(window\.location\.search\)/);
  assert.match(source, /parseLocateMessage\(event\.data\)/);
  assert.match(source, /isEmbeddedFrameWindow\(event\.source\)/);
  assert.match(source, /editor\.locate\.missing/);
});

test('requestLocate posts the message to the admin origin and resolves on the answer or a timeout', async () => {
  const { requestLocate, LOCATED_MESSAGE_TYPE } = await import('../shared/render/index.mjs');
  const listeners = new Set();
  const posted = [];
  const parent = {
    postMessage: (data, origin) => {
      posted.push([data, origin]);
      if (data.blockId === 'answered')
        for (const fn of listeners)
          fn({
            source: parent,
            origin: 'https://cms.example.test',
            data: { type: LOCATED_MESSAGE_TYPE, field: data.field },
          });
      if (data.blockId === 'spoofed')
        for (const fn of listeners)
          fn({
            source: {},
            origin: 'https://evil.example.test',
            data: { type: LOCATED_MESSAGE_TYPE, field: data.field },
          });
    },
  };
  globalThis.window = {
    parent,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  try {
    const adminOrigin = 'https://cms.example.test/admin';
    assert.equal(await requestLocate({ field: 'body', blockId: 'answered', adminOrigin }), true);
    assert.deepEqual(posted[0], [
      { type: 'magic-editor-x:locate', field: 'body', blockId: 'answered' },
      'https://cms.example.test',
    ]);
    assert.equal(
      await requestLocate({ field: 'body', blockId: 'spoofed', adminOrigin, timeoutMs: 50 }),
      false
    );
    assert.equal(
      await requestLocate({ field: 'body', blockId: 'silent', adminOrigin, timeoutMs: 50 }),
      false
    );
    assert.equal(await requestLocate({ field: 'bad path', adminOrigin }), false);
    assert.equal(await requestLocate({ field: 'body', adminOrigin: 'not a url' }), false);
    assert.equal(listeners.size, 0, 'listeners are removed');
    globalThis.window.parent = globalThis.window;
    assert.equal(await requestLocate({ field: 'body', adminOrigin }), false, 'not in a frame');
  } finally {
    delete globalThis.window;
  }
});

test('Live Preview guide: the documented attribute shape is what the renderer writes', () => {
  const guide = readFileSync(new URL('../docs/guides/live-preview.md', import.meta.url), 'utf8');
  const html = renderHtml(
    { blocks: [{ id: 'intro01', type: 'header', data: { text: 'T', level: 2 } }] },
    { blockIds: { field: 'body', strapiSource: { ...SOURCE, documentId: 'x1' } } }
  );
  assert.match(
    html,
    /^<h2 class="mex-header" data-mex-block-id="intro01" data-mex-field-path="body" data-strapi-source="documentId=x1&amp;type=json&amp;model=api%3A%3Aarticle.article&amp;kind=collectionType&amp;locale=en&amp;fieldPath=body">/
  );
  assert.ok(
    guide.includes(
      'data-strapi-source="documentId=…&type=json&model=api%3A%3Aarticle.article&kind=collectionType&locale=en&fieldPath=body"'
    )
  );
  for (const name of [
    'mexBlockIds',
    'strapi-encode-source-maps',
    'magic-editor-x:locate',
    'magic-editor-x:located',
    'mexField',
  ])
    assert.ok(
      guide.includes(name) ||
        readFileSync(new URL('../docs/live-preview.md', import.meta.url), 'utf8').includes(name),
      name
    );
});

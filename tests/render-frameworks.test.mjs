import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp, defineComponent } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseDocument } from 'htmlparser2';
import { renderHtml, renderTree, inlineToHtml } from '../shared/render/index.mjs';
import { MagicEditorXContent as ReactContent, treeToReact } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent, treeToVue } from '../shared/frameworks/vue.mjs';
import { XSS, xssDocument, assertSafeHtml } from './helpers/xss-corpus.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ALL = fixture('editor-2x-all-blocks.json');
const LEGACY = fixture('editor-1x-string.json');
const doc = (...blocks) => ({ blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })) });
const one = (type, data) => doc({ type, data });

/** Fails the test on any React or Vue warning printed while rendering. */
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

const reactHtml = (props) =>
  quiet(() => ReactDOMServer.renderToStaticMarkup(React.createElement(ReactContent, props)));
const vueHtml = (props, slots) =>
  quiet(() => renderToString(createSSRApp({ render: () => h(VueContent, props, slots) })));

/**
 * Canonical form of an HTML string: comments (Vue fragment markers) removed,
 * entities decoded, adjacent text merged, attributes sorted, valueless and
 * empty attributes treated alike.
 * @param {string} html - HTML.
 * @returns {string} Canonical JSON.
 */
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

const SANITIZE = (html) => inlineToHtml(html);

test('XSS corpus: React and Vue output equals renderHtml and is safe', async () => {
  for (const payload of XSS) {
    const value = xssDocument(payload);
    for (const options of [
      { links: () => payload },
      {
        links: () => payload,
        rawHtml: 'allow',
        sanitizeRaw: SANITIZE,
        code: { lineNumbers: true, copyButton: { label: payload, copiedLabel: payload } },
      },
    ]) {
      const expected = renderHtml(value, options);
      const react = await reactHtml({ value, options });
      const vue = await vueHtml({ value, options });
      assert.equal(normalize(react), normalize(expected), payload);
      assert.equal(normalize(vue), normalize(expected), payload);
      assertSafeHtml(react, `react ${payload}`);
      assertSafeHtml(vue.replace(/<!--[[\]]-->/g, ''), `vue ${payload}`);
    }
  }
});

test('fixtures, legacy 1.x strings and every option render the same in all three', async () => {
  const options = {
    rawHtml: 'allow',
    sanitizeRaw: SANITIZE,
    embedHosts: ['www.youtube.com'],
    imageSizes: '50vw',
    links: () => '/resolved',
    code: { lineNumbers: 'block', copyButton: true },
  };
  for (const value of [ALL, LEGACY, JSON.stringify(ALL)]) {
    for (const opts of [undefined, options]) {
      const expected = normalize(renderHtml(value, opts));
      assert.equal(normalize(await reactHtml({ value, options: opts })), expected);
      assert.equal(normalize(await vueHtml({ value, options: opts })), expected);
    }
  }
  assert.match(await reactHtml({ value: LEGACY }), /<h2 class="mex-header">Legacy title<\/h2>/);
  assert.match(await vueHtml({ value: LEGACY }), /<h2 class="mex-header">Legacy title<\/h2>/);
});

test('empty, null and invalid values render nothing', async () => {
  for (const value of [null, undefined, '', '   ', { blocks: [] }, 42, { blocks: 'x' }]) {
    assert.equal(await reactHtml({ value }), '');
    assert.equal(normalize(await vueHtml({ value })), '[]');
  }
  assert.equal(await reactHtml({}), '');
  // A string that is not JSON is 1.x plain text, rendered as a paragraph by all three.
  const text = 'plain <b>1.x</b> text';
  assert.equal(await reactHtml({ value: text }), renderHtml(text));
  assert.equal(normalize(await vueHtml({ value: text })), normalize(renderHtml(text)));
});

test('raw nodes: only as innerHTML of their element, nested in toggles, never from overrides', async () => {
  const value = doc(
    { type: 'toggle', data: { text: 'T', items: 1 } },
    { type: 'raw', data: { html: '<i onclick="x">raw</i><script>alert(1)</script>' } },
    { type: 'productCard', data: { title: 'Lamp' } }
  );
  const options = {
    rawHtml: 'allow',
    sanitizeRaw: SANITIZE,
    overrides: {
      productCard: () => [
        { type: 'raw', html: '<script>alert(1)</script>' },
        { type: 'text', value: 'safe' },
      ],
    },
  };
  const expected =
    '<details class="mex-toggle" open><summary>T</summary><div class="mex-raw"><i>raw</i></div></details>\nsafe';
  assert.equal(renderHtml(value, options), expected);
  assert.equal(await reactHtml({ value, options }), expected.replace(' open>', ' open="">'));
  assert.equal(normalize(await vueHtml({ value, options })), normalize(expected));
  // Without the opt-in the raw block is omitted everywhere.
  assert.doesNotMatch(await reactHtml({ value }), /raw/);
  assert.doesNotMatch(await vueHtml({ value }), /raw/);
  // A stray raw node (not an only child) handed to the tree adapters is dropped.
  const stray = [
    {
      type: 'element',
      tag: 'div',
      attrs: {},
      children: [
        { type: 'raw', html: '<script>alert(1)</script>' },
        { type: 'text', value: 'x' },
      ],
    },
    { type: 'raw', html: '<script>alert(1)</script>' },
  ];
  assert.equal(
    ReactDOMServer.renderToStaticMarkup(React.createElement(React.Fragment, null, ...treeToReact(stray))),
    '<div>x</div>'
  );
  assert.equal(
    (await renderToString(createSSRApp({ render: () => treeToVue(stray) }))).replace(/<!--[[\]]-->/g, ''),
    '<div>x</div>'
  );
});

test('adapters drop unsafe names even in a hand-made tree', async () => {
  const tree = [
    {
      type: 'element',
      tag: 'a',
      attrs: {
        href: 'https://ok.example.test',
        onclick: 'alert(1)',
        innerHTML: '<script>alert(1)</script>',
        style: 'x',
        'x y': 'z',
      },
      children: [{ type: 'text', value: '<b>x</b>' }],
    },
    { type: 'element', tag: 'script', attrs: {}, children: [{ type: 'text', value: 'alert(1)' }] },
    { type: 'element', tag: 'img src=x', attrs: {}, children: [] },
  ];
  const expected = '<a href="https://ok.example.test">&lt;b&gt;x&lt;/b&gt;</a>';
  assert.equal(
    ReactDOMServer.renderToStaticMarkup(React.createElement(React.Fragment, null, ...treeToReact(tree))),
    expected
  );
  assert.equal(
    (await renderToString(createSSRApp({ render: () => treeToVue(tree) }))).replace(/<!--[[\]]-->/g, ''),
    expected
  );
  assert.equal(normalize(expected), normalize(renderHtml(null) + expected));
  assert.deepEqual(renderTree(null), []);
});

test('React components override block types with block, helpers and children', async () => {
  const value = doc(
    { type: 'toggle', data: { text: 'More', items: 1 } },
    { type: 'paragraph', data: { text: 'inside <b>bold</b>' } },
    { type: 'productCard', data: { title: '<i>Lamp</i>', url: 'javascript:alert(1)' } },
    { type: 'delimiter', data: {} },
    { type: 'header', data: { text: 'Hi', level: 2 } }
  );
  const seen = [];
  const components = {
    paragraph: ({ children }) => React.createElement('section', { className: 'wrap' }, children),
    productCard: ({ block, helpers }) => {
      seen.push(Object.keys(helpers).sort());
      return React.createElement(
        'a',
        { href: helpers.url(block.data.url) || undefined },
        helpers.inline(block.data.title),
        ' ',
        helpers.text(block.data.title)
      );
    },
    toggle: ({ block, helpers }) =>
      React.createElement('div', { id: block.id }, helpers.renderBlocks(block.children)),
    delimiter: () => null,
    __proto__: () => React.createElement('p', null, 'bad'),
  };
  const html = await reactHtml({ value, components });
  assert.equal(
    html,
    '<div id="b0"><section class="wrap"><p class="mex-paragraph">inside <b>bold</b></p></section></div>\n<a><i>Lamp</i> Lamp</a>\n\n<h2 class="mex-header">Hi</h2>'
  );
  assert.deepEqual(seen, [['inline', 'renderBlocks', 'text', 'url']]);
  // overrides from options still work and string results need the raw opt-in.
  const overridden = await reactHtml({
    value: one('paragraph', { text: 'x' }),
    options: {
      overrides: { paragraph: (b, helpers) => helpers.h('blockquote', {}, helpers.inlineNodes(b.data.text)) },
    },
  });
  assert.equal(overridden, '<blockquote>x</blockquote>');
  assert.equal(
    await reactHtml({
      value: one('paragraph', { text: 'x' }),
      options: { overrides: { paragraph: () => '<b>s</b>' } },
    }),
    '<p class="mex-paragraph">x</p>'
  );
});

test('Vue slots and components override block types', async () => {
  const value = doc(
    { type: 'toggle', data: { text: 'More', items: 1 } },
    { type: 'paragraph', data: { text: 'inside' } },
    { type: 'productCard', data: { title: '<i>Lamp</i>' } },
    { type: 'header', data: { text: 'Hi', level: 2 } }
  );
  const Card = defineComponent({
    props: { block: Object, helpers: Object },
    setup:
      (props, { slots }) =>
      () =>
        h('article', { 'data-id': props.block.id }, [
          props.helpers.inline(props.block.data.title),
          slots.default(),
        ]),
  });
  const Toggle = defineComponent({
    props: { block: Object, helpers: Object },
    setup: (props) => () =>
      h('div', { id: props.block.id }, props.helpers.renderBlocks(props.block.children)),
  });
  const html = await vueHtml(
    { value, components: { productCard: Card, toggle: Toggle, header: Card } },
    {
      'block-paragraph': ({ children }) => h('section', children),
      'block-header': ({ block, helpers }) => h('strong', helpers.text(block.data.text)),
    }
  );
  assert.equal(
    html.replace(/<!--[[\]]-->/g, ''),
    '<div id="b0"><section><p class="mex-paragraph">inside</p></section></div>\n<article data-id="b2"><i>Lamp</i><div class="mex-block mex-productCard" data-mex-block="productCard"><div class="mex-field" data-mex-field="title">Lamp</div></div></article>\n<strong>Hi</strong>'
  );
});

/** Finds the first element in a React tree whose type matches. */
const findReact = (element, match) => {
  if (!element || typeof element !== 'object') return null;
  if (Array.isArray(element)) {
    for (const item of element) {
      const found = findReact(item, match);
      if (found) return found;
    }
    return null;
  }
  if (match(element)) return element;
  return findReact(element.props && element.props.children, match);
};

const withClipboard = async (clipboard, fn) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  try {
    await fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before);
    else delete globalThis.navigator;
  }
};

const CODE = one('codeFlask', { code: 'a\nb', language: 'js' });
const COPY_OPTIONS = {
  code: { lineNumbers: true, copyButton: { label: 'Copy', copiedLabel: 'Done', failedLabel: 'Nope' } },
};

test('React copy button writes the code to the clipboard and announces the status', async () => {
  const root = ReactContent({ value: CODE, options: COPY_OPTIONS });
  const block = findReact(root, (el) => typeof el.type === 'function' && el.props && el.props.node);
  assert.ok(block);
  // Render the copy block with a stand-in for useState to reach its handlers.
  const updates = [];
  const original = React.useState;
  React.useState = (initial) => [initial, (next) => updates.push(next)];
  let output;
  try {
    output = block.type(block.props);
  } finally {
    React.useState = original;
  }
  const button = findReact(output, (el) => el.type === 'button');
  const status = findReact(output, (el) => el.props && el.props.role === 'status');
  assert.equal(button.props.type, 'button');
  assert.equal(status.props['aria-live'], 'polite');
  const copied = [];
  await withClipboard({ writeText: async (text) => copied.push(text) }, async () => {
    button.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(copied, ['a\nb']);
  await withClipboard(undefined, async () => {
    button.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(updates, ['Done', 'Nope']);
  const html = await reactHtml({ value: CODE, options: COPY_OPTIONS });
  assert.match(
    html,
    /<button type="button" class="mex-code-copy" data-mex-copy="code" data-mex-copied="Done" data-mex-failed="Nope">Copy<\/button><span class="mex-code-copy-status" role="status" aria-live="polite"><\/span>/
  );
});

test('Vue copy button writes the code to the clipboard and announces the status', async () => {
  const render = VueContent.setup(
    { value: CODE, options: COPY_OPTIONS, components: undefined },
    { slots: {} }
  );
  const vnodes = render().flat(Infinity);
  const block = vnodes.find((vnode) => vnode && vnode.type && vnode.type.name === 'MagicEditorXCodeCopy');
  assert.ok(block);
  const inner = block.type.setup(block.props);
  const findVue = (vnode, match) => {
    if (!vnode || typeof vnode !== 'object') return null;
    if (match(vnode)) return vnode;
    for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
      const found = findVue(child, match);
      if (found) return found;
    }
    return null;
  };
  const button = findVue(inner(), (v) => v.type === 'button');
  const copied = [];
  await withClipboard({ writeText: async (text) => copied.push(text) }, async () => {
    button.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(copied, ['a\nb']);
  assert.equal(findVue(inner(), (v) => v.props && v.props.role === 'status').children, 'Done');
  await withClipboard(undefined, async () => {
    button.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(findVue(inner(), (v) => v.props && v.props.role === 'status').children, 'Nope');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  renderHtml,
  renderTree,
  serializeNodes,
  renderMarkdown,
  renderText,
  enhanceCodeBlocks,
  inlineToHtml,
} from '../shared/render/index.mjs';
import { MAX_NUMBERED_LINES } from '../shared/render/tree.mjs';
import { XSS, xssDocument, assertSafeHtml } from './helpers/xss-corpus.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ALL = fixture('editor-2x-all-blocks.json');
const LEGACY = fixture('editor-1x-string.json');
const doc = (...blocks) => ({ blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })) });
const one = (type, data, tunes) => doc({ type, data, ...(tunes ? { tunes } : {}) });

/** Asserts the public tree contract on every node. */
const assertTreeShape = (nodes, label) => {
  for (const node of nodes) {
    assert.ok(['element', 'text', 'raw'].includes(node.type), `${label}: type ${node.type}`);
    if (node.type === 'text') assert.equal(typeof node.value, 'string', label);
    if (node.type === 'raw') assert.equal(typeof node.html, 'string', label);
    if (node.type !== 'element') continue;
    assert.match(node.tag, /^[a-z][a-z0-9-]*$/, label);
    for (const [name, value] of Object.entries(node.attrs)) {
      assert.match(name, /^[a-z][a-z0-9-]*$/, `${label}: ${name}`);
      assert.ok(!name.startsWith('on') && name !== 'style' && name !== 'srcdoc', `${label}: ${name}`);
      assert.ok(value === true || typeof value === 'string', `${label}: ${name}`);
    }
    const raws = node.children.filter((child) => child.type === 'raw');
    if (raws.length) assert.equal(node.children.length, 1, `${label}: raw node must be an only child`);
    assertTreeShape(node.children, label);
  }
};

test('renderTree is the tree renderHtml serialises (fixtures, legacy, XSS corpus)', () => {
  const sanitizeRaw = (html) => inlineToHtml(html);
  const values = [ALL, LEGACY, ...XSS.map(xssDocument)];
  const dir = new URL('./fixtures/', import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) values.push(fixture(name));
  for (const value of values) {
    for (const options of [
      {},
      { rawHtml: 'allow', sanitizeRaw, links: () => '/x' },
      { code: { lineNumbers: true, copyButton: { label: 'Copy' } } },
    ]) {
      const tree = renderTree(value, options);
      assertTreeShape(tree, JSON.stringify(options));
      assert.equal(serializeNodes(tree), renderHtml(value, options));
    }
  }
});

test('renderTree node shapes and empty input', () => {
  for (const value of [null, undefined, '', { blocks: [] }, 42]) assert.deepEqual(renderTree(value), []);
  assert.deepEqual(renderTree(one('paragraph', { text: 'Hi <b>you</b><br>x' })), [
    {
      type: 'element',
      tag: 'p',
      attrs: { class: 'mex-paragraph' },
      children: [
        { type: 'text', value: 'Hi ' },
        { type: 'element', tag: 'b', attrs: {}, children: [{ type: 'text', value: 'you' }] },
        { type: 'element', tag: 'br', attrs: {}, children: [] },
        { type: 'text', value: 'x' },
      ],
    },
  ]);
  const two = renderTree(doc({ type: 'delimiter', data: {} }, { type: 'delimiter', data: {} }));
  assert.deepEqual(
    two.map((n) => n.type),
    ['element', 'text', 'element']
  );
  assert.equal(two[1].value, '\n');
  const raw = renderTree(one('raw', { html: '<i>x</i>' }), { rawHtml: 'allow', sanitizeRaw: (h) => h });
  assert.deepEqual(raw, [
    {
      type: 'element',
      tag: 'div',
      attrs: { class: 'mex-raw' },
      children: [{ type: 'raw', html: '<i>x</i>' }],
    },
  ]);
  const check = renderTree(one('checklist', { items: [{ text: 'a', checked: true }] }));
  assert.deepEqual(check[0].children[0].children[0].attrs, {
    type: 'checkbox',
    disabled: true,
    checked: true,
    'aria-label': 'done',
  });
});

test('string overrides: verbatim in renderHtml, only through sanitizeRaw in renderTree', () => {
  const value = one('paragraph', { text: 'Default' });
  const overrides = { paragraph: () => '<p onclick="x">Custom</p>' };
  assert.equal(renderHtml(value, { overrides }), '<p onclick="x">Custom</p>');
  // No opt-in: the tree keeps the default output.
  assert.equal(serializeNodes(renderTree(value, { overrides })), '<p class="mex-paragraph">Default</p>');
  assert.equal(
    serializeNodes(renderTree(value, { overrides, sanitizeRaw: (h) => h })),
    '<p class="mex-paragraph">Default</p>'
  );
  const sanitizeRaw = (html) => html.replace(/ on\w+="[^"]*"/g, '');
  assert.deepEqual(renderTree(value, { overrides, rawHtml: 'allow', sanitizeRaw }), [
    {
      type: 'element',
      tag: 'div',
      attrs: { class: 'mex-override', 'data-mex-block': 'paragraph' },
      children: [{ type: 'raw', html: '<p>Custom</p>' }],
    },
  ]);
  assert.deepEqual(renderTree(value, { overrides, rawHtml: 'allow', sanitizeRaw: () => '' }), []);
  // Undefined and numbers keep the default.
  for (const out of [undefined, null, 3])
    assert.equal(
      renderHtml(value, { overrides: { paragraph: () => out } }),
      '<p class="mex-paragraph">Default</p>'
    );
});

test('node overrides are validated (tags, attribute names, URLs, raw)', () => {
  const value = doc(
    { type: 'toggle', data: { text: 'T', items: 1 } },
    { type: 'paragraph', data: { text: 'child' } },
    { type: 'productCard', data: { title: 'Lamp' } }
  );
  const evilUrls = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example.test'];
  const out = renderHtml(value, {
    overrides: {
      productCard: (block, h) =>
        h.h('article', { class: 'card', 'data-id': block.id }, [
          h.h('script', {}, 'alert(1)'),
          h.h('style', {}, '*{}'),
          h.h('IMG', { src: 'https://ok.example.test/a.png' }),
          { type: 'raw', html: '<script>alert(1)</script>' },
          { type: 'element', tag: 'a b', attrs: {}, children: [] },
          ...evilUrls.map((url) =>
            h.h('a', {
              href: url,
              src: url,
              poster: url,
              action: url,
              formaction: url,
              cite: url,
              data: url,
              background: url,
              srcset: `${url} 1x`,
              title: 'kept',
            })
          ),
          {
            type: 'element',
            tag: 'img',
            attrs: {
              src: 'https://ok.example.test/b.png',
              srcset: 'https://ok.example.test/b.png 1x, https://ok.example.test/c.png 2x',
              onerror: 'alert(1)',
              ONLOAD: 'alert(1)',
              style: 'x',
              srcdoc: '<script>',
              'x onmouseover': 'alert(1)',
              alt: '',
            },
            children: [],
          },
          { type: 'element', tag: 'iframe', attrs: { src: 'javascript:alert(1)' }, children: [] },
          h.textNode('<b>escaped</b>'),
          h.inlineNodes('<b onclick="x">inline</b>'),
          'plain <i>',
        ]),
      toggle: (block, h) => h.h('section', {}, h.childNodes(block.children)),
    },
  });
  assertSafeHtml(out.replace(/<\/?(article|section|a)\b/g, '<p'), 'override');
  assert.match(out, /<article class="card" data-id="b2">/);
  assert.doesNotMatch(out, /script|style=|srcdoc|onerror|onload|onmouseover|alert/i);
  assert.doesNotMatch(out, /<IMG/);
  assert.match(
    out,
    /<img src="https:\/\/ok.example.test\/b.png" srcset="https:\/\/ok.example.test\/b.png 1x, https:\/\/ok.example.test\/c.png 2x" alt="">/
  );
  assert.equal((out.match(/<a title="kept"><\/a>/g) || []).length, evilUrls.length);
  assert.match(out, /&lt;b&gt;escaped&lt;\/b&gt;<b>inline<\/b>plain &lt;i&gt;/);
  assert.match(out, /<section><p class="mex-paragraph">child<\/p><\/section>/);
});

test('code blocks: defaults unchanged, language class, line numbers, copy button', () => {
  const flask = one('codeFlask', { code: 'a\nb\n', language: 'python', showlinenumbers: true });
  const plain = one('code', { code: 'x<y' });
  assert.equal(
    renderHtml(flask),
    '<pre class="mex-code" data-language="python"><code class="language-python">a\nb\n</code></pre>'
  );
  assert.equal(
    renderHtml(flask, { code: { lineNumbers: true } }),
    '<pre class="mex-code mex-code-lines" data-language="python"><code class="language-python"><span class="mex-code-line">a</span>\n<span class="mex-code-line">b</span>\n</code></pre>'
  );
  // 'block' follows the stored showlinenumbers flag of codeFlask blocks.
  assert.match(renderHtml(flask, { code: { lineNumbers: 'block' } }), /mex-code-lines/);
  assert.doesNotMatch(renderHtml(plain, { code: { lineNumbers: 'block' } }), /mex-code-lines/);
  assert.equal(
    renderHtml(plain, { code: { lineNumbers: true } }),
    '<pre class="mex-code mex-code-lines"><code><span class="mex-code-line">x&lt;y</span></code></pre>'
  );
  assert.equal(
    renderHtml(one('code', { code: '' }), { code: { lineNumbers: true } }),
    '<pre class="mex-code mex-code-lines"><code><span class="mex-code-line"></span></code></pre>'
  );
  const long = one('code', { code: 'x\n'.repeat(MAX_NUMBERED_LINES + 1) });
  assert.doesNotMatch(renderHtml(long, { code: { lineNumbers: true } }), /mex-code-line/);
  assert.equal(
    renderHtml(plain, { code: { copyButton: true } }),
    '<div class="mex-code-block" data-mex-code="copy"><pre class="mex-code"><code>x&lt;y</code></pre><button type="button" class="mex-code-copy" data-mex-copy="code" data-mex-copied="Copied" data-mex-failed="Copy failed">Copy code</button><span class="mex-code-copy-status" role="status" aria-live="polite"></span></div>'
  );
  assert.match(
    renderHtml(plain, {
      code: { copyButton: { label: 'Code kopieren', copiedLabel: 'Kopiert', failedLabel: '"><script>' } },
    }),
    /data-mex-copied="Kopiert" data-mex-failed="&quot;&gt;&lt;script&gt;">Code kopieren<\/button>/
  );
  for (const bad of [{ label: '' }, { label: 'x'.repeat(81) }, { label: 7 }])
    assert.match(renderHtml(plain, { code: { copyButton: bad } }), />Copy code<\/button>/);
  for (const off of [false, 'yes', 1, null])
    assert.doesNotMatch(renderHtml(plain, { code: { copyButton: off } }), /button/);
  // Language is the validated identifier from the shared policy.
  assert.match(
    renderHtml(one('codeFlask', { code: 'x', language: 'c" onclick="x' }), { code: { copyButton: true } }),
    /<code class="language-plaintext">/
  );
  // Markdown and text keep code as fenced or plain text, whatever the options.
  const options = { code: { lineNumbers: true, copyButton: true } };
  assert.equal(renderMarkdown(flask, options), '```python\na\nb\n```');
  assert.equal(renderMarkdown(plain, options), '```\nx<y\n```');
  assert.equal(renderText(flask, options), 'a\nb\n');
});

/** Minimal DOM stand-in for the copy helper. */
const fakeDom = (code) => {
  const listeners = {};
  const attributes = { 'data-mex-copied': 'Kopiert', 'data-mex-failed': 'Fehler' };
  const status = { textContent: '' };
  const block = {
    querySelector: (selector) =>
      selector === 'pre code' ? { textContent: code } : selector === '[role="status"]' ? status : null,
  };
  const button = {
    hasAttribute: (name) => name in attributes,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    },
    closest: () => block,
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete listeners[type];
    },
  };
  const root = { querySelectorAll: () => [button] };
  return { root, button, status, listeners };
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

test('enhanceCodeBlocks copies the code text and reports the status', async () => {
  assert.equal(typeof enhanceCodeBlocks(), 'function');
  assert.equal(typeof enhanceCodeBlocks({}), 'function');
  const dom = fakeDom('a\nb');
  const copied = [];
  await withClipboard({ writeText: async (text) => copied.push(text) }, async () => {
    const cleanup = enhanceCodeBlocks(dom.root);
    assert.equal(dom.button.hasAttribute('data-mex-enhanced'), true);
    enhanceCodeBlocks(dom.root); // second call skips the enhanced button
    await dom.listeners.click();
    assert.deepEqual(copied, ['a\nb']);
    assert.equal(dom.status.textContent, 'Kopiert');
    cleanup();
    assert.equal(dom.listeners.click, undefined);
    assert.equal(dom.button.hasAttribute('data-mex-enhanced'), false);
  });
  const failing = fakeDom('x');
  await withClipboard(
    {
      writeText: async () => {
        throw new Error('denied');
      },
    },
    async () => {
      enhanceCodeBlocks(failing.root);
      await failing.listeners.click();
      assert.equal(failing.status.textContent, 'Fehler');
    }
  );
  const missing = fakeDom('x');
  await withClipboard(undefined, async () => {
    enhanceCodeBlocks(missing.root);
    await missing.listeners.click();
    assert.equal(missing.status.textContent, 'Fehler');
  });
});

test('the core renderer graph imports no framework and no Node built-in', () => {
  const dir = new URL('../shared/render/', import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    for (const match of source.matchAll(/^import[\s\S]*?from '([^']+)'/gm))
      assert.match(match[1], /^\.\.?\//, `${name} imports ${match[1]}`);
  }
});

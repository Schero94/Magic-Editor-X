import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { h, createSSRApp, defineComponent } from 'vue';
import { renderToString } from 'vue/server-renderer';
import * as render from '../shared/render/index.mjs';
import * as reactEntry from '../shared/frameworks/react.mjs';
import * as vueEntry from '../shared/frameworks/vue.mjs';

const read = (name) => readFileSync(new URL(`../docs/guides/${name}`, import.meta.url), 'utf8');
const GUIDES = ['astro.md', 'react.md', 'vue-nuxt.md'];
const ENTRIES = { render, react: reactEntry, vue: vueEntry };
const ARTICLE = {
  blocks: [
    {
      id: 'p',
      type: 'paragraph',
      data: {
        text: 'See <a href="/old" data-mex-uid="api::article.article" data-mex-document-id="q8n2x" data-mex-locale="de">this</a>',
      },
    },
    { id: 'c', type: 'codeFlask', data: { code: 'a\nb', language: 'js', showlinenumbers: true } },
    { id: 'x', type: 'productCard', data: { title: '<b>Lamp</b>', url: 'https://shop.example.test/lamp' } },
  ],
};

test('every name the guides import from magic-editor-x exists in that entry', () => {
  let count = 0;
  for (const guide of GUIDES) {
    const text = read(guide);
    for (const match of text.matchAll(/import \{([^}]+)\} from 'magic-editor-x\/(render|react|vue)'/g)) {
      for (const name of match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        assert.ok(name in ENTRIES[match[2]], `${guide}: ${name} from magic-editor-x/${match[2]}`);
        count += 1;
      }
    }
    // Relative links between the guides resolve.
    for (const link of text.matchAll(/\]\(([a-z-]+\.md)(#[a-z0-9-]+)?\)/g))
      assert.ok(GUIDES.includes(link[1]), link[1]);
  }
  assert.ok(count >= 6);
});

test('Astro guide: renderHtml with the documented options', () => {
  const html = render.renderHtml(ARTICLE, {
    links: ({ uid, documentId, locale }) =>
      uid === 'api::article.article' ? `/${locale ?? 'en'}/articles/${documentId}` : null,
    code: { lineNumbers: 'block', copyButton: { label: 'Copy code', copiedLabel: 'Copied' } },
  });
  assert.match(html, /<a href="\/de\/articles\/q8n2x"/);
  assert.match(
    html,
    /<pre class="mex-code mex-code-lines" data-language="js"><code class="language-js"><span class="mex-code-line">a<\/span>/
  );
  assert.match(
    html,
    /<button type="button" class="mex-code-copy" data-mex-copy="code" data-mex-copied="Copied"/
  );
  // The classes the guide documents are the ones the renderer writes.
  const guide = read('astro.md');
  for (const cls of html.matchAll(/class="([^"]+)"/g))
    for (const name of cls[1].split(' ').filter((c) => c.startsWith('mex-code') || c.startsWith('language-')))
      assert.ok(guide.includes(name.startsWith('language-') ? 'language-<lang>' : name), name);
  // The helper is safe to call on the server (no DOM): it does nothing.
  assert.equal(typeof render.enhanceCodeBlocks(), 'function');
});

test('React guide: components with helpers, server components fallback for the copy button', () => {
  const components = {
    productCard: ({ block, helpers }) =>
      React.createElement(
        'a',
        { className: 'card', href: helpers.url(block.data.url) || undefined },
        helpers.inline(block.data.title)
      ),
    paragraph: ({ children }) => React.createElement('div', { className: 'lead' }, children),
  };
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(reactEntry.MagicEditorXContent, { value: ARTICLE, components })
  );
  assert.match(html, /^<div class="lead"><p class="mex-paragraph">See <a href="\/old"/);
  assert.match(html, /<a class="card" href="https:\/\/shop.example.test\/lamp"><b>Lamp<\/b><\/a>$/);
  // Without useState (React Server Components) the copy block is static markup for enhanceCodeBlocks.
  const root = reactEntry.MagicEditorXContent({ value: ARTICLE, options: { code: { copyButton: true } } });
  const find = (el) => {
    if (!el || typeof el !== 'object') return null;
    if (Array.isArray(el)) return el.map(find).find(Boolean) || null;
    if (typeof el.type === 'function' && el.props.node) return el;
    return find(el.props && el.props.children);
  };
  const block = find(root);
  const original = React.useState;
  React.useState = undefined;
  let output;
  try {
    output = block.type(block.props);
  } finally {
    React.useState = original;
  }
  const markup = ReactDOMServer.renderToStaticMarkup(output);
  assert.equal(markup, render.renderHtml({ blocks: [ARTICLE.blocks[1]] }, { code: { copyButton: true } }));
});

test('Vue guide: scoped slots and components prop', async () => {
  const Card = defineComponent({
    props: { block: Object, helpers: Object },
    setup: (props) => () => h('article', props.helpers.inline(props.block.data.title)),
  });
  const app = createSSRApp({
    render: () =>
      h(
        vueEntry.MagicEditorXContent,
        { value: ARTICLE, components: { productCard: Card } },
        {
          // Equivalent of <div class="lead"><component :is="() => children" /></div>.
          'block-paragraph': ({ children }) => h('div', { class: 'lead' }, [h(() => children)]),
        }
      ),
  });
  const html = (await renderToString(app)).replace(/<!--[[\]]-->/g, '');
  assert.match(html, /^<div class="lead"><p class="mex-paragraph">See <a href="\/old"/);
  assert.match(html, /<article><b>Lamp<\/b><\/article>$/);
});

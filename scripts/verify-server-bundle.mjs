import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjsModule = require('../dist/server/index.js');
const esmModule = await import('../dist/server/index.mjs');
const cjsPlugin = cjsModule.default || cjsModule;
const esmPlugin = esmModule.default || esmModule;
const expectedTypes = {
  bootstrap: 'function',
  destroy: 'function',
  register: 'function',
  config: 'object',
  contentTypes: 'object',
  controllers: 'object',
  middlewares: 'object',
  policies: 'object',
  routes: 'object',
  services: 'object',
};

for (const [format, plugin] of [
  ['CJS', cjsPlugin],
  ['ESM', esmPlugin],
]) {
  for (const [key, expected] of Object.entries(expectedTypes)) {
    if (typeof plugin?.[key] !== expected) {
      throw new Error(
        `${format} server bundle export ${key} must be ${expected}, received ${typeof plugin?.[key]}`
      );
    }
  }
}

console.log('Magic Editor X CJS and ESM server bundles load with all Strapi plugin exports');

const cjsRender = require('../dist/render/index.js');
const esmRender = await import('../dist/render/index.mjs');
const smoke = {
  blocks: [
    { id: 'a', type: 'header', data: { text: 'Hello <b>world</b>', level: 2 } },
    { id: 'b', type: 'paragraph', data: { text: '<img src=x onerror=alert(1)>Safe' } },
  ],
};
for (const [format, render] of [
  ['CJS', cjsRender],
  ['ESM', esmRender],
]) {
  for (const name of ['renderHtml', 'renderText', 'renderMarkdown']) {
    if (typeof render[name] !== 'function') throw new Error(`${format} render bundle must export ${name}`);
  }
  const html = render.renderHtml(smoke);
  if (html !== '<h2 class="mex-header">Hello <b>world</b></h2>\n<p class="mex-paragraph">Safe</p>')
    throw new Error(`${format} render bundle produced unexpected HTML`);
  if (
    render.renderText(smoke) !== 'Hello world\n\nSafe' ||
    render.renderMarkdown(smoke) !== '## Hello **world**\n\nSafe'
  )
    throw new Error(`${format} render bundle produced unexpected text or Markdown`);
}

console.log('Magic Editor X CJS and ESM render bundles load and render');

// Custom block SDK (`magic-editor-x/blocks`): both formats define a block that
// the render bundle (a separate bundle) accepts through the `blocks` option.
const cjsBlocks = require('../dist/blocks/index.js');
const esmBlocks = await import('../dist/blocks/index.mjs');
for (const [format, blocks] of [
  ['CJS', cjsBlocks],
  ['ESM', esmBlocks],
]) {
  for (const name of ['defineBlock', 'blockJsonSchema', 'BlockDefinitionError'])
    if (typeof blocks[name] !== 'function') throw new Error(`${format} blocks bundle must export ${name}`);
  const card = blocks.defineBlock({
    name: 'verifyCard',
    schema: { title: { type: 'text', max: 20 }, link: { type: 'url' } },
    render: (block, { h }) =>
      h('aside', { class: 'card' }, h('a', { href: block.data.link }, block.data.title)),
  });
  const value = {
    blocks: [
      { id: 'v', type: 'verifyCard', data: { title: '<b>Hi</b>', link: 'javascript:alert(1)', x: 1 } },
    ],
  };
  const html = cjsRender.renderHtml(value, { blocks: [card] });
  if (html !== '<aside class="card"><a>&lt;b&gt;Hi&lt;/b&gt;</a></aside>')
    throw new Error(`${format} blocks bundle definition rendered unexpected HTML: ${html}`);
  if (blocks.blockJsonSchema(card).additionalProperties !== false)
    throw new Error(`${format} blocks bundle produced an unexpected JSON Schema`);
}
for (const file of ['../dist/blocks/index.mjs', '../dist/blocks/index.js']) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  if (/\b(require\(|from |import\()["'](node:|react|react-dom|vue|zod)/.test(source))
    throw new Error(`${file} must not import Node built-ins, a framework or zod`);
}

console.log('Magic Editor X CJS and ESM blocks bundles load and define blocks the renderers accept');

// Math helper (`magic-editor-x/math`, 2.4): both formats render MathML that the
// render bundle accepts through its allow-list; hostile TeX renders nothing unsafe.
const cjsMath = require('../dist/math/index.js');
const esmMath = await import('../dist/math/index.mjs');
for (const [format, math] of [
  ['CJS', cjsMath],
  ['ESM', esmMath],
]) {
  for (const name of ['renderMath', 'checkMath'])
    if (typeof math[name] !== 'function') throw new Error(`${format} math bundle must export ${name}`);
  const value = {
    blocks: [
      { id: 'm', type: 'math', data: { tex: '\\frac{a}{b}' } },
      { id: 'p', type: 'paragraph', data: { text: 'x <span data-mex-math>\\includegraphics{x.png}</span>' } },
    ],
  };
  const html = cjsRender.renderHtml(value, { math: math.renderMath });
  if (!html.includes('<mfrac><mi>a</mi><mi>b</mi></mfrac>') || /<img|style=/.test(html))
    throw new Error(`${format} math bundle rendered unexpected HTML: ${html}`);
  if (!html.includes('\\(\\includegraphics{x.png}\\)'))
    throw new Error(`${format} math bundle did not fall back for untrusted TeX`);
  if (math.checkMath('\\frac{').ok !== false) throw new Error(`${format} math bundle accepted invalid TeX`);
}
for (const file of ['../dist/math/index.mjs', '../dist/math/index.js']) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  if (/\b(require\(|from |import\()["'](node:|react|react-dom|vue|zod)/.test(source))
    throw new Error(`${file} must not import Node built-ins, a framework or zod`);
}

console.log('Magic Editor X CJS and ESM math bundles render TeX through the render bundle');

// Framework components: both formats load with the caller's framework and
// render the same HTML as renderHtml (Vue fragment markers removed).
const frameworkSmoke = {
  blocks: [
    ...smoke.blocks,
    { id: 'c', type: 'code', data: { code: 'a\nb' } },
    { id: 'd', type: 'raw', data: { html: '<i>raw</i><script>alert(1)</script>' } },
  ],
};
const frameworkOptions = {
  code: { lineNumbers: true, copyButton: true },
  rawHtml: 'allow',
  sanitizeRaw: (html) => cjsRender.inlineToHtml(html),
};
const expectedHtml = cjsRender.renderHtml(frameworkSmoke, frameworkOptions);
if (/<script/i.test(expectedHtml) || !expectedHtml.includes('mex-code-copy'))
  throw new Error('render bundle produced unexpected framework smoke HTML');

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cjsReact = require('../dist/react/index.js');
const esmReact = await import('../dist/react/index.mjs');
for (const [format, mod] of [
  ['CJS', cjsReact],
  ['ESM', esmReact],
]) {
  if (typeof mod.MagicEditorXContent !== 'function' || mod.default !== mod.MagicEditorXContent)
    throw new Error(`${format} react bundle must export MagicEditorXContent`);
  const html = renderToStaticMarkup(
    React.createElement(mod.MagicEditorXContent, { value: frameworkSmoke, options: frameworkOptions })
  );
  if (html !== expectedHtml) throw new Error(`${format} react bundle rendered different HTML`);
}

const { createSSRApp, h } = require('vue');
const { renderToString } = require('vue/server-renderer');
const cjsVue = require('../dist/vue/index.js');
const esmVue = await import('../dist/vue/index.mjs');
for (const [format, mod] of [
  ['CJS', cjsVue],
  ['ESM', esmVue],
]) {
  if (!mod.MagicEditorXContent || mod.default !== mod.MagicEditorXContent)
    throw new Error(`${format} vue bundle must export MagicEditorXContent`);
  const html = await renderToString(
    createSSRApp({
      render: () => h(mod.MagicEditorXContent, { value: frameworkSmoke, options: frameworkOptions }),
    })
  );
  if (html.replace(/<!--[[\]]-->/g, '') !== cjsRender.renderHtml(frameworkSmoke, frameworkOptions))
    throw new Error(`${format} vue bundle rendered different HTML`);
}

for (const file of ['../dist/render/index.mjs', '../dist/render/index.js']) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  if (/\b(require\(|from )["'](react|react-dom|vue)["']/.test(source))
    throw new Error(`${file} must not import a framework`);
}

console.log('Magic Editor X CJS and ESM React and Vue bundles load and render like renderHtml');

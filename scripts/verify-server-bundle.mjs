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

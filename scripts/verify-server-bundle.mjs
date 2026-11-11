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

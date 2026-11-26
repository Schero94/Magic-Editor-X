import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BLOCKS_FALLBACKS,
  EXTENSION_PREFIX,
  LOSSLESS_BLOCKS,
  blocksLinkUrl,
  editorToStrapiBlocks,
  renderStrapiBlocks,
} from '../shared/convert/to-strapi-blocks.mjs';
import { strapiBlocksToEditor } from '../shared/convert/strapi-blocks.mjs';
import { renderResolved, OUTPUT_FORMATS } from '../shared/resolve-references.mjs';
import * as render from '../shared/render/index.mjs';

const require = createRequire(import.meta.url);

/**
 * 2.13 `?mex=blocks`: Magic Editor X JSON to Strapi Blocks JSON. The output is checked against the
 * installed Strapi server validator of Blocks fields (the format contract the official renderer
 * reads), and Strapi Blocks -> Magic Editor X -> Strapi Blocks keeps the supported subset.
 */

// The installed @strapi/core does not export its validator path; load the file directly.
const coreDir = path.dirname(require.resolve('@strapi/core/package.json'));
const { blocksValidator } = require(path.join(coreDir, 'dist/services/entity-validator/blocks-validator.js'));
const STRAPI_VERSION = require('@strapi/core/package.json').version;

/**
 * Validates root nodes with Strapi's own Blocks validator. Image nodes get the three keys only the
 * Media Library knows on write (provider, createdAt, updatedAt); everything else must pass as is.
 * @param {Array<object>} nodes - Root nodes.
 */
const assertValidBlocks = async (nodes) => {
  const withUploadKeys = nodes.map((node) =>
    node.type === 'image'
      ? {
          ...node,
          image: {
            hash: 'h',
            ext: '.png',
            mime: 'image/png',
            size: 1,
            width: 1,
            height: 1,
            name: 'n',
            ...node.image,
            provider: 'local',
            createdAt: '2026-11-26T00:00:00.000Z',
            updatedAt: '2026-11-26T00:00:00.000Z',
          },
        }
      : node
  );
  await blocksValidator().validate(withUploadKeys, { strict: true, abortEarly: false });
};

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });

/** Strapi Blocks content covering every node and mark the official renderer knows. */
const STRAPI_BLOCKS = [
  { type: 'heading', level: 1, children: [{ type: 'text', text: 'Release notes' }] },
  {
    type: 'paragraph',
    children: [
      { type: 'text', text: 'Plain ' },
      { type: 'text', text: 'bold', bold: true },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'italic', italic: true },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'underline', underline: true },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'strike', strikethrough: true },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'code', code: true },
      { type: 'text', text: ' and ' },
      { type: 'link', url: 'https://example.test/docs', children: [{ type: 'text', text: 'a link' }] },
      { type: 'text', text: '.' },
    ],
  },
  { type: 'heading', level: 6, children: [{ type: 'text', text: 'Small heading' }] },
  {
    type: 'list',
    format: 'unordered',
    children: [
      { type: 'list-item', children: [{ type: 'text', text: 'First' }] },
      {
        type: 'list',
        format: 'unordered',
        children: [{ type: 'list-item', children: [{ type: 'text', text: 'Nested' }] }],
      },
      { type: 'list-item', children: [{ type: 'text', text: 'Second' }] },
    ],
  },
  {
    type: 'list',
    format: 'ordered',
    children: [
      { type: 'list-item', children: [{ type: 'text', text: 'One' }] },
      { type: 'list-item', children: [{ type: 'text', text: 'Two' }] },
    ],
  },
  { type: 'quote', children: [{ type: 'text', text: 'A synthetic quote.' }] },
  { type: 'code', language: 'javascript', children: [{ type: 'text', text: 'const answer = 42;\n' }] },
  {
    type: 'image',
    image: {
      url: '/uploads/diagram.png',
      name: 'diagram.png',
      alternativeText: 'Synthetic diagram',
      caption: null,
      width: 640,
      height: 480,
    },
    children: [{ type: 'text', text: '' }],
  },
];

test('round trip: Strapi Blocks -> Magic Editor X -> Strapi Blocks keeps the supported subset', async () => {
  const { blocks } = strapiBlocksToEditor(STRAPI_BLOCKS);
  const { blocks: back, report } = editorToStrapiBlocks(doc(blocks));
  const strip = (nodes) =>
    nodes.map((node) =>
      node.type === 'image'
        ? {
            ...node,
            image: {
              url: node.image.url,
              alternativeText: node.image.alternativeText,
              width: node.image.width,
              height: node.image.height,
            },
          }
        : node
    );
  assert.deepEqual(strip(back), strip(STRAPI_BLOCKS));
  assert.deepEqual(report.lossy, []);
  await assertValidBlocks(back);
});

test(`output passes the installed Strapi ${STRAPI_VERSION} Blocks validator for every block type`, async () => {
  const value = doc([
    { id: 'p', type: 'paragraph', data: { text: '' } },
    { id: 'c', type: 'checklist', data: { items: [{ text: 'Done', checked: true }] } },
    {
      id: 't',
      type: 'table',
      data: {
        withHeadings: true,
        stretched: false,
        content: [
          ['A', '<b>B</b>'],
          ['1', '<a href="/x">2</a>'],
        ],
      },
    },
    { id: 'w', type: 'warning', data: { title: 'Note', message: 'Be <i>careful</i>' } },
    { id: 'al', type: 'alert', data: { type: 'info', align: 'left', message: 'Heads up' } },
    { id: 'tg', type: 'toggle', data: { text: 'More', status: 'open', items: 0 } },
    { id: 'd', type: 'delimiter', data: {} },
    {
      id: 'e',
      type: 'embed',
      data: {
        service: 'youtube',
        source: 'https://www.youtube.com/watch?v=x',
        embed: 'https://www.youtube.com/embed/x',
        caption: 'Video',
      },
    },
    {
      id: 'l',
      type: 'linkTool',
      data: { link: 'https://example.test', meta: { title: 'Example', description: '' } },
    },
    {
      id: 'b',
      type: 'button',
      data: { text: 'Go', link: 'https://example.test', style: 'primary', openInNewTab: false },
    },
    { id: 'at', type: 'attaches', data: { file: { url: '/uploads/a.pdf', name: 'a.pdf' }, title: '' } },
    { id: 'm', type: 'math', data: { tex: 'e^{i\\pi}+1=0', display: true, _mex: 1 } },
    {
      id: 'g',
      type: 'gallery',
      data: {
        images: [{ file: { url: '/uploads/g1.png', alt: 'One' }, caption: 'First' }],
        layout: 'grid',
        columns: 3,
        caption: '',
        _mex: 1,
      },
    },
    {
      id: 'v',
      type: 'video',
      data: {
        file: { url: '/uploads/v.mp4', mime: 'video/mp4' },
        title: 'Clip',
        caption: '',
        loop: false,
        muted: false,
        tracks: [],
        _mex: 1,
      },
    },
    {
      id: 'pe',
      type: 'personality',
      data: { name: 'Ada Example', description: 'Writer', link: 'https://example.test/ada', photo: '' },
    },
    {
      id: 'co',
      type: 'columns',
      data: {
        columns: [
          {
            id: 'c1',
            items: [
              { id: 'i1', type: 'heading', text: 'Left', level: 3 },
              { id: 'i2', type: 'paragraph', text: 'Text' },
            ],
          },
          { id: 'c2', items: [{ id: 'i3', type: 'list', text: 'Item', style: 'ordered' }] },
        ],
        _mex: 1,
      },
    },
    { id: 'r', type: 'raw', data: { html: '<b>raw</b>' } },
    { id: 'q', type: 'quote', data: { text: 'Quote', caption: 'Ada', alignment: 'left' } },
    { id: 'cf', type: 'codeFlask', data: { code: 'x', language: 'python', filename: 'a.py' } },
    {
      id: 'cu',
      type: 'myCustomBlock',
      data: { content: 'Custom text', blockType: 'simple', blockName: 'myCustomBlock' },
    },
  ]);
  const { blocks, report } = editorToStrapiBlocks(value);
  await assertValidBlocks(blocks);
  // Raw HTML, delimiter and toc are left out; nothing else disappears silently.
  const lossyTypes = report.lossy.map((entry) => entry.type);
  for (const type of ['checklist', 'table', 'warning', 'embed', 'math', 'raw', 'delimiter', 'columns'])
    assert.ok(lossyTypes.includes(type), type);
  assert.ok(!JSON.stringify(blocks).includes('raw</b>'), 'raw HTML is never output');
});

test('extensions: blocks with a fallback become magic-editor-x/<type> nodes; the subset is unchanged', async () => {
  const value = doc([
    {
      id: 'p',
      type: 'paragraph',
      data: { text: 'Text<sup data-mex-footnote="fn1" data-mex-note="n">1</sup>' },
    },
    { id: 't', type: 'table', data: { withHeadings: false, stretched: false, content: [['a', 'b']] } },
    { id: 'r', type: 'raw', data: { html: '<b>x</b>' } },
    {
      id: 'l',
      type: 'list',
      data: { style: 'checklist', items: [{ content: 'Task', meta: { checked: true }, items: [] }] },
    },
  ]);
  const { blocks } = editorToStrapiBlocks(value, { extensions: true });
  assert.deepEqual(
    blocks.map((node) => node.type),
    ['paragraph', `${EXTENSION_PREFIX}table`, `${EXTENSION_PREFIX}list`]
  );
  assert.deepEqual(blocks[1].data.content, [['a', 'b']]);
  assert.deepEqual(blocks[1].children, [{ type: 'text', text: 'a | b' }]);
  // Without extensions the same value is valid Blocks content.
  await assertValidBlocks(editorToStrapiBlocks(value).blocks);
});

test('every documented fallback has a test case and the subset list matches the README contract', () => {
  assert.deepEqual(LOSSLESS_BLOCKS, [
    'paragraph',
    'header',
    'list',
    'quote',
    'code',
    'codeFlask',
    'image',
    'simpleImage',
  ]);
  for (const type of Object.keys(BLOCKS_FALLBACKS))
    assert.equal(typeof BLOCKS_FALLBACKS[type], 'string', type);
});

test('links and images only with URLs Strapi Blocks accepts', () => {
  for (const ok of [
    'https://example.test',
    'http://example.test/a?b=1',
    'mailto:a@example.test',
    'tel:+15550100',
    '/about',
  ])
    assert.equal(blocksLinkUrl(ok), ok);
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.example',
    '#top',
    'relative/page',
    '',
  ])
    assert.equal(blocksLinkUrl(bad), null, bad);
  const { blocks, report } = editorToStrapiBlocks(
    doc([
      {
        id: 'a',
        type: 'paragraph',
        data: { text: '<a href="javascript:alert(1)">x</a> <a href="#top">y</a>' },
      },
      {
        id: 'b',
        type: 'image',
        data: {
          file: { url: 'javascript:alert(1)' },
          caption: '',
          withBorder: false,
          withBackground: false,
          stretched: false,
        },
      },
    ])
  );
  assert.deepEqual(blocks, [{ type: 'paragraph', children: [{ type: 'text', text: 'x y' }] }]);
  assert.deepEqual(report.lossy[0].notes, ['link']);
});

test('inline: nested marks, line breaks, inline math as code, colours as plain text', () => {
  const { blocks, report } = editorToStrapiBlocks(
    doc([
      {
        id: 'a',
        type: 'paragraph',
        data: {
          text: '<b>a<i>b</i></b><br><span data-mex-math="true">x^2</span> <mark data-mex-highlight="yellow">hi</mark>',
        },
      },
    ])
  );
  assert.deepEqual(blocks[0].children, [
    { type: 'text', text: 'a', bold: true },
    { type: 'text', text: 'b', bold: true, italic: true },
    { type: 'text', text: '\n' },
    { type: 'text', text: 'x^2', code: true },
    { type: 'text', text: ' hi' },
  ]);
  assert.deepEqual(report.lossy[0].notes, ['inline-format', 'inline-math']);
});

test('output pipeline: renderResolved("blocks"), ?mex formats and the public render helper', () => {
  assert.ok(OUTPUT_FORMATS.includes('blocks'));
  const value = doc([{ id: 'a', type: 'header', data: { text: 'Hi', level: 2 } }]);
  assert.deepEqual(renderResolved(value, 'blocks'), [
    { type: 'heading', level: 2, children: [{ type: 'text', text: 'Hi' }] },
  ]);
  assert.deepEqual(renderResolved(null, 'blocks'), []);
  assert.deepEqual(render.renderStrapiBlocks(value), renderResolved(value, 'blocks'));
  assert.deepEqual(renderStrapiBlocks('not editor data {'), [
    { type: 'paragraph', children: [{ type: 'text', text: 'not editor data {' }] },
  ]);
  assert.deepEqual(renderStrapiBlocks(42), []);
});

test('large documents convert within budget (5000 blocks)', () => {
  const blocks = Array.from({ length: 5000 }, (_, index) => ({
    id: `b${index}`,
    type: index % 3 ? 'paragraph' : 'list',
    data:
      index % 3
        ? { text: `Paragraph <b>${index}</b> with <a href="https://example.test/${index}">link</a>` }
        : { style: 'unordered', items: [{ content: 'x', items: [{ content: 'y', items: [] }] }] },
  }));
  const started = performance.now();
  const out = editorToStrapiBlocks(doc(blocks));
  assert.equal(out.blocks.length, 5000);
  assert.ok(performance.now() - started < 2000, 'converted in under 2 s');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEditorSchema, BLOCK_DATA_SCHEMAS, SCHEMA_ONLY_KEYS } from '../shared/schema.mjs';
import { BLOCK_POLICIES, sanitizeEditorData } from '../shared/sanitize-policy.mjs';
import { normalizeEditorData } from '../shared/editor-data.mjs';
import { inlineToHtml } from '../shared/render/inline.mjs';
import { validate } from './helpers/json-schema.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const published = JSON.parse(read('../schema/magic-editor-x.schema.json'));
const schema = buildEditorSchema();

/** Stores a value the way the server does (normalise + shared policy). */
const store = (value, rawHtml = 'sanitize') =>
  sanitizeEditorData(normalizeEditorData(value), {
    sanitizeInlineHtml: (html) => inlineToHtml(html),
    sanitizeRawHtml: (html) => inlineToHtml(html),
    rawHtml,
  });

test('the published schema file is up to date (run `npm run schema`)', () => {
  assert.deepEqual(published, schema);
});

test('schema block types equal the sanitising policy', () => {
  assert.deepEqual(Object.keys(BLOCK_DATA_SCHEMAS).sort(), Object.keys(BLOCK_POLICIES).sort());
});

/** Input with every key a tool can write, per type. */
const KITCHEN_SINK = {
  paragraph: { text: 'p' },
  header: { text: 'h', level: 2 },
  quote: { text: 'q', caption: 'c', alignment: 'center' },
  list: {
    style: 'ordered',
    meta: { start: 2, counterType: 'lower-alpha' },
    items: [{ content: 'a', meta: { checked: true, start: 1, counterType: 'numeric' }, items: ['b'] }],
  },
  checklist: { items: [{ text: 't', checked: true }] },
  warning: { title: 't', message: 'm' },
  alert: { type: 'danger', align: 'center', message: 'm' },
  toggle: { text: 't', status: 'closed', fk: 'k1', items: 1 },
  code: { code: 'x' },
  codeFlask: { code: 'x', language: 'js', showlinenumbers: true },
  raw: { html: '<b>x</b>' },
  table: {
    withHeadings: true,
    stretched: true,
    content: [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ],
    headerColumn: true,
    align: ['center', 'right'],
    merges: [{ row: 1, col: 0, rowspan: 2, colspan: 2 }],
    caption: 'Caption',
  },
  image: {
    file: {
      url: 'https://cdn.example.test/a.png',
      id: 4,
      documentId: 'abc',
      alt: 'A',
      mime: 'image/png',
      name: 'a.png',
      hash: 'a_1',
      ext: '.png',
      width: 10,
      height: 10,
      size: 1.5,
      formats: { small: { url: 'https://cdn.example.test/s.png', width: 5, height: 5, ext: '.png' } },
    },
    caption: 'c',
    withBorder: true,
    withBackground: true,
    stretched: true,
    decorative: true,
    focalPoint: { x: 0.25, y: 0.7 },
  },
  simpleImage: {
    url: 'https://cdn.example.test/a.png',
    caption: 'c',
    withBorder: true,
    withBackground: true,
    stretched: true,
    alt: 'A',
    decorative: true,
  },
  gallery: {
    images: [
      {
        file: {
          url: '/uploads/g1.png',
          id: 7,
          documentId: 'g1',
          alt: 'G',
          mime: 'image/png',
          name: 'g1.png',
          hash: 'g1',
          ext: '.png',
          width: 20,
          height: 10,
          size: 2,
          formats: { thumbnail: { url: '/uploads/t_g1.png', width: 10, height: 5 } },
        },
        caption: 'c',
        decorative: true,
        focalPoint: { x: 0.123, y: 1 },
      },
    ],
    layout: 'carousel',
    columns: 4,
    caption: 'g',
  },
  video: {
    file: { url: '/uploads/v.webm', id: 8, documentId: 'v', mime: 'video/webm', name: 'v.webm', size: 9 },
    poster: { url: '/uploads/p.png', id: 9, mime: 'image/png', alt: 'P', width: 4, height: 3 },
    title: 'V',
    caption: 'c',
    loop: true,
    muted: true,
    tracks: [
      {
        file: { url: '/uploads/v.vtt', id: 10, mime: 'text/vtt', ext: '.vtt' },
        kind: 'subtitles',
        srclang: 'de',
        label: 'Deutsch',
        default: true,
      },
    ],
  },
  audio: {
    file: { url: '/uploads/a.mp3', id: 11, mime: 'audio/mpeg' },
    title: 'A',
    caption: 'c',
    loop: true,
    tracks: [],
  },
  linkTool: {
    link: 'https://www.example.test',
    meta: { title: 't', description: 'd', site_name: 's', image: { url: 'https://www.example.test/i.png' } },
  },
  attaches: {
    file: { url: 'https://cdn.example.test/f.pdf', name: 'f.pdf', extension: 'pdf', size: 3, title: 'F' },
    title: 'T',
  },
  embed: {
    service: 'youtube',
    source: 'https://www.youtube.com/watch?v=1',
    embed: 'https://www.youtube.com/embed/1',
    width: 10,
    height: 10,
    caption: 'c',
  },
  personality: {
    name: 'n',
    description: 'd',
    link: 'https://www.example.test',
    photo: 'https://www.example.test/p.png',
  },
  button: { text: 'b', link: '/x', style: 'outline', openInNewTab: true },
  delimiter: {},
  toc: { title: 'Contents', minLevel: 2, maxLevel: 3, style: 'ordered' },
  synced: { ref: 'abc123def456' },
  math: { tex: '\\frac{a}{b}', display: false },
};

test('policy output for every type has exactly the keys the schema describes', () => {
  assert.deepEqual(Object.keys(KITCHEN_SINK).sort(), Object.keys(BLOCK_POLICIES).sort());
  for (const [type, data] of Object.entries(KITCHEN_SINK)) {
    const [block] = store({ blocks: [{ id: 'x', type, data }] }).blocks;
    const described = Object.keys(BLOCK_DATA_SCHEMAS[type].properties).filter(
      (key) => !(SCHEMA_ONLY_KEYS[type] || []).includes(key)
    );
    assert.deepEqual(Object.keys(block.data).sort(), described.sort(), type);
    assert.deepEqual(validate(schema, schema.$defs.block, block), [], type);
  }
});

test('fixtures validate after storing; the schema rejects wrong shapes', () => {
  for (const name of ['editor-2x-all-blocks.json', 'editor-1x-string.json']) {
    const value = JSON.parse(read(`./fixtures/${name}`));
    assert.deepEqual(validate(schema, schema, store(value)), [], name);
  }
  const bad = [
    { time: 1, version: 'x', blocks: [{ id: 'a', type: 'header', data: { text: 'x', level: 7 } }] },
    { time: 1, version: 'x', blocks: [{ id: 'a', type: 'paragraph', data: { text: 1 } }] },
    { time: 1, version: 'x', blocks: [{ id: 'a b', type: 'paragraph', data: { text: 'x' } }] },
    { time: 1, version: 'x', blocks: [{ id: 'a', type: 'list', data: { style: 'x', items: [] } }] },
    { time: 1, version: 'x', blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x', extra: 1 } }] },
    { time: 1, version: 'x', blocks: [], extra: true },
    { blocks: [] },
  ];
  for (const value of bad) assert.notDeepEqual(validate(schema, schema, value), [], JSON.stringify(value));
  // Custom blocks: any object data.
  assert.deepEqual(
    validate(schema, schema, {
      time: 0,
      version: '2',
      blocks: [{ id: 'c', type: 'hero', data: { any: [1] } }],
    }),
    []
  );
});

/**
 * Known gaps of shared/sanitize-policy.mjs found by this test: `embed.service`
 * and `codeFlask.language` are checked with a RegExp that coerces numbers, so a
 * number (for example 123) is kept instead of becoming a string. Remove an entry
 * when the policy checks `typeof value === 'string'`.
 */
const KNOWN_POLICY_GAPS = [];

test('stored random documents always validate (policy output is a subset of the schema)', () => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const values = [
    '',
    'x',
    1,
    -5,
    99999999,
    true,
    null,
    [],
    {},
    '<b>x</b>',
    'javascript:x',
    [['a']],
    { url: 'x' },
  ];
  const pick = () => values[Math.floor(rand() * values.length)];
  for (let i = 0; i < 300; i += 1) {
    const type = Object.keys(KITCHEN_SINK)[i % Object.keys(KITCHEN_SINK).length];
    const data = {};
    for (const key of Object.keys(BLOCK_DATA_SCHEMAS[type].properties)) if (rand() < 0.7) data[key] = pick();
    if (type === 'image' || type === 'attaches')
      data.file =
        rand() < 0.5
          ? pick()
          : {
              url: pick(),
              alt: pick(),
              width: pick(),
              formats: rand() < 0.5 ? { small: { url: 'https://a.example.test/x', width: 1 } } : pick(),
            };
    const stored = store({
      blocks: [
        {
          id: `b${i}`,
          type,
          data,
          tunes: {
            alignmentTune: { alignment: pick() },
            textVariant: pick(),
            indentTune: { indentLevel: pick() },
          },
        },
      ],
    });
    const errors = validate(schema, schema, stored);
    // Media formats are kept as stored by the Media Library; non-object entries are the only allowed mismatch.
    const relevant = errors.filter(
      (error) => !error.includes('/formats/') && !KNOWN_POLICY_GAPS.some((gap) => error.startsWith(gap))
    );
    assert.deepEqual(relevant, [], JSON.stringify(data));
  }
});

test('TypeScript types name every block type of the policy', () => {
  const dts = read('../types/index.d.ts');
  const map = /export interface BlockDataMap \{([\s\S]*?)\n\}/.exec(dts)[1];
  const names = Array.from(map.matchAll(/^\s+([A-Za-z]+): [A-Za-z]+Data;$/gm)).map((m) => m[1]);
  assert.deepEqual(names.sort(), Object.keys(BLOCK_POLICIES).sort());
  const render = read('../types/render.d.ts');
  for (const name of [
    'renderHtml',
    'renderText',
    'renderMarkdown',
    'RenderOptions',
    'links?',
    'media?',
    'overrides?',
    'rawHtml?',
    'sanitizeRaw?',
    'embedHosts?',
    'imageSizes?',
  ])
    assert.ok(render.includes(name), name);
});

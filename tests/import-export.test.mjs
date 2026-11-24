/**
 * 2.11 import and export: the bounded ZIP reader (zip-bomb limits), the Word
 * reader (headings, marks, links, lists, tables, quotes, code, images as
 * placeholders), Markdown import, sanitising of malicious content, the Word
 * writer (round trip through the own reader) and the print/HTML document.
 * Word files are generated in the tests with fflate (tests/fixtures/docx-builder.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { strToU8, zipSync } from 'fflate';
import { ImportError, ZIP_LIMITS, inflateEntry, readZipDirectory } from '../shared/convert/zip.mjs';
import { docxToHtml } from '../shared/convert/docx.mjs';
import { convertImportFile, importKindOf } from '../shared/convert/import-file.mjs';
import { parseHtmlWithHtmlparser2 } from '../shared/convert/htmlparser-adapter.mjs';
import { buildDocx, image, link, p, r, sampleDocx, table } from './fixtures/docx-builder.mjs';
import { buildDocxFile } from '../admin/src/editor/export/docx-writer.mjs';
import {
  exportFileName,
  exportHtmlDocument,
  exportMarkdown,
  exportStylesheet,
} from '../admin/src/editor/export/export-content.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');

const { window } = new JSDOM('');
const parseXml = (xml) => new window.DOMParser().parseFromString(xml, 'application/xml');
const parseHtml = parseHtmlWithHtmlparser2;
const importDocx = (bytes, name = 'report.docx') =>
  convertImportFile({ name, bytes }, { parseXml, parseHtml });
const clean = (blocks) => cleanEditorValue({ blocks }, { rawHtml: 'disable' }).blocks;
const LABELS = {
  embed: 'Embedded content',
  component: 'Component block',
  raw: 'HTML block (not exported)',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
};
// 1x1 transparent PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ImportError ? error.code : `unexpected ${error && error.message}`;
  }
  return 'no error';
};

// ---------------------------------------------------------------------------
// ZIP reader limits

/** Patches the central directory record of the first entry (declared sizes). */
const patchDirectory = (zip, { size, compressed } = {}) => {
  const bytes = zip.slice();
  const view = new DataView(bytes.buffer);
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      const directory = view.getUint32(offset + 16, true);
      if (size !== undefined) view.setUint32(directory + 24, size, true);
      if (compressed !== undefined) view.setUint32(directory + 20, compressed, true);
      return bytes;
    }
  }
  throw new Error('no directory');
};

test('zip: a normal archive is read entry by entry', async () => {
  const zip = zipSync({ 'a.xml': strToU8('<a>hello</a>'), 'b/c.txt': strToU8('x'.repeat(500)) });
  const { entries } = readZipDirectory(zip);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['a.xml', 'b/c.txt']
  );
  assert.equal(new TextDecoder().decode(await inflateEntry(zip, entries[0])), '<a>hello</a>');
  assert.equal((await inflateEntry(zip, entries[1])).length, 500);
});

test('zip bomb: a high compression ratio is refused before anything is inflated', () => {
  // 20 MB of zeros compress to about 20 KB (ratio ~1000:1).
  const bomb = zipSync({ 'word/document.xml': new Uint8Array(20 * 1024 * 1024) }, { level: 9 });
  const started = performance.now();
  assert.throws(
    () => readZipDirectory(bomb),
    (error) => error.code === 'ZIP_RATIO'
  );
  assert.ok(performance.now() - started < 50, 'refused from the directory alone');
});

test('zip bomb: a total uncompressed size over 50 MB is refused', () => {
  // Random-ish data does not compress, so the ratio check passes; the sum does not.
  const files = {};
  for (let index = 0; index < 6; index += 1) {
    const data = new Uint8Array(9 * 1024 * 1024);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 2654435761 + index) >>> 24;
    files[`part${index}.bin`] = [data, { level: 0 }];
  }
  const zip = zipSync(files);
  assert.throws(
    () => readZipDirectory(zip, { maxFileBytes: Infinity }),
    (error) => error.code === 'ZIP_TOO_LARGE'
  );
  assert.throws(
    () => readZipDirectory(zip),
    (error) => error.code === 'FILE_TOO_LARGE'
  );
});

test('zip bomb: an entry that inflates past its declared size is aborted while streaming', async () => {
  const zip = zipSync({ 'word/document.xml': new Uint8Array(4 * 1024 * 1024) }, { level: 9 });
  // Declare a small size (and a matching ratio) so the directory checks pass.
  const lying = patchDirectory(zip, { size: 4096 });
  const { entries } = readZipDirectory(lying);
  const started = performance.now();
  assert.equal(await codeOf(inflateEntry(lying, entries[0])), 'ZIP_SIZE_MISMATCH');
  assert.ok(performance.now() - started < 200);
});

test('zip: too many entries, encryption, zip64 markers, corrupt data and non-zip input are refused', async () => {
  const many = {};
  for (let index = 0; index <= ZIP_LIMITS.maxEntries; index += 1) many[`f${index}`] = strToU8('');
  assert.throws(
    () => readZipDirectory(zipSync(many)),
    (error) => error.code === 'ZIP_TOO_MANY_ENTRIES'
  );

  const zip = zipSync({ 'a.txt': strToU8('hello hello hello') });
  const encrypted = zip.slice();
  const view = new DataView(encrypted.buffer);
  for (let offset = encrypted.length - 22; offset >= 0; offset -= 1)
    if (view.getUint32(offset, true) === 0x06054b50) {
      const directory = view.getUint32(offset + 16, true);
      view.setUint16(directory + 8, view.getUint16(directory + 8, true) | 1, true);
      break;
    }
  assert.throws(
    () => readZipDirectory(encrypted),
    (error) => error.code === 'ZIP_ENCRYPTED'
  );
  assert.throws(
    () => readZipDirectory(patchDirectory(zip, { size: 0xffffffff })),
    (error) => error.code === 'ZIP_UNSUPPORTED'
  );
  assert.throws(
    () => readZipDirectory(strToU8('PK not really a zip file at all, just text')),
    (error) => ['NOT_ZIP', 'ZIP_CORRUPT'].includes(error.code)
  );
  assert.throws(
    () => readZipDirectory(strToU8('plain text, no zip')),
    (error) => error.code === 'NOT_ZIP'
  );
  const truncated = zip.slice(0, zip.length - 10);
  assert.throws(
    () => readZipDirectory(truncated),
    (error) => error.code === 'ZIP_CORRUPT'
  );
  const text = Array.from({ length: 400 }, (_, i) => (i * 7919).toString(36)).join(' ');
  const garbage = zipSync({ 'a.txt': strToU8(text) });
  const { entries } = readZipDirectory(garbage);
  garbage.fill(0xff, entries[0].dataStart, entries[0].dataStart + entries[0].compressedSize);
  assert.equal(await codeOf(inflateEntry(garbage, entries[0])), 'ZIP_CORRUPT');
});

test('import: an oversized file and a zip bomb disguised as .docx are refused fast', async () => {
  const big = new Uint8Array(ZIP_LIMITS.maxFileBytes + 1);
  big.set([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(await codeOf(importDocx(big)), 'FILE_TOO_LARGE');
  const bomb = buildDocx('', { extra: { 'word/media/big.bin': new Uint8Array(30 * 1024 * 1024) } });
  const started = performance.now();
  assert.equal(await codeOf(importDocx(bomb)), 'ZIP_RATIO');
  assert.ok(performance.now() - started < 100);
  assert.equal(await codeOf(importDocx(strToU8('not a zip'))), 'NOT_ZIP');
  assert.equal(
    await codeOf(convertImportFile({ name: 'a.pdf', bytes: PNG }, { parseXml, parseHtml })),
    'UNSUPPORTED_TYPE'
  );
  assert.equal(await codeOf(importDocx(new Uint8Array(0))), 'FILE_EMPTY');
  // A ZIP that is not a Word document.
  assert.equal(await codeOf(importDocx(zipSync({ 'readme.txt': strToU8('hi') }))), 'NOT_DOCX');
});

test('import: XML with a DOCTYPE (entity expansion, external entities) is refused before parsing', async () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(await codeOf(importDocx(buildDocx('', { document: laughs }))), 'XML_INVALID');
  const external = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(await codeOf(importDocx(buildDocx('', { document: external }))), 'XML_INVALID');
  assert.equal(
    await codeOf(importDocx(buildDocx('', { document: '<w:document><unclosed>' }))),
    'XML_INVALID'
  );
});

// ---------------------------------------------------------------------------
// Word reader

test('docx: headings, marks, links, nested lists, table with merges, quote, code and image placeholder', async () => {
  const result = await importDocx(sampleDocx());
  const blocks = clean(result.blocks);
  const types = blocks.map((block) => block.type);
  assert.deepEqual(types, [
    'header',
    'paragraph',
    'header',
    'paragraph',
    'paragraph',
    'header',
    'list',
    'header',
    'table',
    'quote',
    'code',
    'paragraph',
    'paragraph',
  ]);
  assert.deepEqual(blocks[0].data, { text: 'Field report: Example Valley', level: 1 });
  assert.equal(blocks[5].data.level, 2);
  assert.equal(
    blocks[3].data.text,
    'The valley is <b>green</b>, <u class="cdx-underline">quiet</u> and <s class="cdx-strikethrough">old</s>. Water is H<sub>2</sub>O, area 3 km<sup>2</sup>. <mark class="cdx-marker">Key fact</mark>.'
  );
  assert.match(blocks[4].data.text, /<a href="https:\/\/docs\.example\.test\/valley"[^>]*>project docs<\/a>/);
  const list = blocks[6].data;
  assert.equal(list.style, 'ordered');
  assert.deepEqual(
    list.items.map((item) => [item.content, item.items.map((inner) => inner.content)]),
    [
      ['Pack the bag', ['Water', 'Map']],
      ['Walk to the lake', []],
    ]
  );
  const grid = blocks[8].data;
  assert.equal(grid.withHeadings, true);
  assert.deepEqual(grid.content[0], ['Place', 'Height', 'Note']);
  assert.deepEqual(grid.merges, [
    { row: 1, col: 0, rowspan: 2, colspan: 1 },
    { row: 3, col: 0, rowspan: 1, colspan: 2 },
  ]);
  assert.equal(blocks[9].data.text, 'Measure twice, cut once.');
  assert.equal(blocks[10].data.code, 'const height = 120;\nconsole.log(height);');
  assert.equal(blocks[11].data.text, '<i>[Image: A green valley at dawn]</i>');
  assert.equal(result.report.images, 1);
});

test('docx: custom heading styles by outline level, list styles, start numbers, separate lists and line breaks', async () => {
  const body = [
    p('Chapter', { style: 'Kapitel' }),
    p('Bullet by style', { style: 'ListBullet' }),
    p('Second by style', { style: 'ListBullet' }),
    p('Between'),
    p('Fourth', { numId: 3 }),
    p('Fifth', { numId: 3 }),
    p(['Line one', '<w:r><w:br/></w:r>', 'Line two']),
    p(''),
  ].join('');
  const blocks = clean((await importDocx(buildDocx(body))).blocks);
  assert.deepEqual(blocks[0], { ...blocks[0], type: 'header', data: { text: 'Chapter', level: 2 } });
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[1].data.style, 'unordered');
  assert.equal(blocks[1].data.items.length, 2);
  assert.equal(blocks[2].data.text, 'Between');
  assert.equal(blocks[3].data.style, 'ordered');
  assert.equal(blocks[3].data.meta.start, 4);
  assert.match(blocks[4].data.text, /^Line one<br\s*\/?>Line two$/);
  assert.equal(blocks.length, 5, 'empty paragraphs are left out');
});

test('docx: tracked deletions are left out, insertions and HYPERLINK fields kept, bookmarks become text', async () => {
  const body = [
    '<w:p><w:r><w:t>Kept </w:t></w:r><w:del><w:r><w:delText>deleted</w:delText></w:r></w:del><w:ins><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>',
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://field.example.test/a" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field link</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    '<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>to a bookmark</w:t></w:r></w:hyperlink></w:p>',
  ].join('');
  const blocks = clean((await importDocx(buildDocx(body))).blocks);
  assert.equal(blocks[0].data.text, 'Kept inserted');
  assert.match(blocks[1].data.text, /^<a href="https:\/\/field\.example\.test\/a"[^>]*>field link<\/a>$/);
  assert.equal(blocks[2].data.text, 'to a bookmark');
});

test('docx: malicious content is sanitised (javascript: links, script text, markup in text)', async () => {
  const body = [
    p(['Click ', link('rIdJs', 'here'), ' or ', link('rIdData', 'there')]),
    p(r('<script>alert(1)</script> <img src=x onerror=alert(1)>')),
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "javascript:alert(2)" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    p(image('"><img src=x onerror=alert(3)>')),
    table([[{ text: r('<b onclick="x()">cell</b>') }]]),
  ].join('');
  const result = await importDocx(
    buildDocx(body, {
      links: { rIdJs: 'javascript:alert(1)', rIdData: 'data:text/html,<script>alert(1)</script>' },
    })
  );
  const blocks = clean(result.blocks);
  const json = JSON.stringify(blocks);
  // Markup from the file is text: no element, event handler or dangerous URL survives.
  assert.doesNotMatch(json, /<(script|img|iframe|svg)|<[^>]*\son\w+=|href=\\"(javascript|data):/i);
  assert.doesNotMatch(json, /javascript:|data:text/i);
  assert.equal(blocks[0].data.text, 'Click here or there');
  assert.equal(
    blocks[1].data.text,
    '&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;'
  );
  assert.equal(blocks[2].data.text, 'field');
  // The unsanitised converter output is already free of active content.
  assert.doesNotMatch(JSON.stringify(result.blocks), /javascript:|<script|<img/i);
  assert.equal(blocks[4].data.content[0][0], '&lt;b onclick="x()"&gt;cell&lt;/b&gt;');
});

test('docx: the table-of-contents control is skipped and reported', async () => {
  const body = [
    '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>',
    p('Contents entry 1'),
    '</w:sdtContent></w:sdt>',
    p('Body text'),
  ].join('');
  const result = await importDocx(buildDocx(body));
  assert.deepEqual(
    result.blocks.map((block) => block.data.text),
    ['Body text']
  );
  assert.equal(result.report.skipped.toc, 1);
});

test('docx: blocks get unique ids and the reader pauses between steps', async () => {
  let pauses = 0;
  const result = await convertImportFile(
    { name: 'a.DOCX', bytes: buildDocx(p('Same') + p('Same')) },
    { parseXml, parseHtml, pause: async () => (pauses += 1) }
  );
  assert.equal(new Set(result.blocks.map((block) => block.id)).size, 2);
  assert.ok(pauses >= 3);
});

// ---------------------------------------------------------------------------
// Markdown import

test('markdown import: blocks, images as placeholders, encoding and depth guard', async () => {
  const md =
    '﻿# Title\n\nSome **bold** and a [link](https://example.test/x).\n\n![A lake](https://img.example.test/lake.png)\n\n- one\n  - two\n\n```js\nconst a = 1;\n```\n';
  const result = await convertImportFile({ name: 'notes.md', bytes: strToU8(md) }, { parseHtml });
  const blocks = clean(result.blocks);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['header', 'paragraph', 'paragraph', 'list', 'codeFlask']
  );
  assert.equal(blocks[0].data.text, 'Title');
  assert.equal(blocks[2].data.text, '<i>[Image: A lake]</i>');
  assert.equal(result.report.images, 1);
  assert.equal(
    await codeOf(convertImportFile({ name: 'x.markdown', bytes: Uint8Array.of(0xc3, 0x28) }, { parseHtml })),
    'TEXT_ENCODING'
  );
  const deep = `${'>'.repeat(200)} deep\n`;
  assert.equal(
    await codeOf(convertImportFile({ name: 'x.md', bytes: strToU8(deep) }, { parseHtml })),
    'MARKDOWN_TOO_DEEP'
  );
  const malicious = '[x](javascript:alert(1)) <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n';
  const bad = clean(
    (await convertImportFile({ name: 'x.md', bytes: strToU8(malicious) }, { parseHtml })).blocks
  );
  assert.doesNotMatch(JSON.stringify(bad), /javascript:|<script|onerror=/i);
  assert.equal(importKindOf('A.Markdown'), 'markdown');
  assert.equal(importKindOf('file.doc'), null);
});

// ---------------------------------------------------------------------------
// Export

const DOC = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'h1', type: 'header', data: { text: 'Field notes', level: 1 } },
    {
      id: 'p1',
      type: 'paragraph',
      data: {
        text: 'Read <b>bold</b>, <i>italic</i>, <u class="cdx-underline">under</u>, <s class="cdx-strikethrough">gone</s>, H<sub>2</sub>O, x<sup>2</sup>, <code class="inline-code">npm ci</code> and <a href="https://docs.example.test/a">the docs</a>.',
      },
    },
    { id: 'h2', type: 'header', data: { text: 'Steps', level: 2 } },
    {
      id: 'l1',
      type: 'list',
      data: {
        style: 'ordered',
        meta: { start: 1 },
        items: [
          { content: 'First', meta: {}, items: [{ content: 'Nested', meta: {}, items: [] }] },
          { content: 'Second', meta: {}, items: [] },
        ],
      },
    },
    {
      id: 'l2',
      type: 'list',
      data: { style: 'unordered', meta: {}, items: [{ content: 'Bullet', meta: {}, items: [] }] },
    },
    {
      id: 't1',
      type: 'table',
      data: {
        withHeadings: true,
        content: [
          ['Name', 'Value', 'Note'],
          ['A', '1', 'x'],
          ['', '2', 'y'],
        ],
        merges: [{ row: 1, col: 0, rowspan: 2, colspan: 1 }],
      },
    },
    { id: 'q1', type: 'quote', data: { text: 'Measure twice.', caption: '', alignment: 'left' } },
    { id: 'c1', type: 'code', data: { code: 'const a = 1;\nconst b = 2;' } },
    {
      id: 'i1',
      type: 'image',
      data: { file: { url: '/uploads/lake.png', alt: 'A lake' }, caption: 'The lake' },
    },
    {
      id: 'i2',
      type: 'image',
      data: { file: { url: 'https://cdn.example.test/far.png', alt: 'Far' }, caption: '' },
    },
    {
      id: 'e1',
      type: 'embed',
      data: {
        service: 'youtube',
        source: 'https://www.youtube.com/watch?v=abc',
        embed: 'https://www.youtube.com/embed/abc',
        caption: 'A video',
      },
    },
    { id: 'r1', type: 'raw', data: { html: '<script>alert(1)</script>' } },
    { id: 'd1', type: 'delimiter', data: {} },
    {
      id: 'p2',
      type: 'paragraph',
      data: {
        text: 'Internal <a href="/articles/q8n2x" data-mex-uid="api::article.article" data-mex-document-id="q8n2x">earlier</a>.',
      },
    },
  ],
};
const ORIGIN = 'https://cms.example.test';

test('word export: valid .docx that round-trips through the own reader', async () => {
  const requested = [];
  const bytes = await buildDocxFile(DOC, {
    title: 'Field notes',
    origin: ORIGIN,
    labels: LABELS,
    loadImage: async (src) => {
      requested.push(src);
      return src === `${ORIGIN}/uploads/lake.png`
        ? { data: PNG, type: 'png', width: 1200, height: 800 }
        : null;
    },
  });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.deepEqual(requested.sort(), ['https://cdn.example.test/far.png', `${ORIGIN}/uploads/lake.png`]);
  const names = readZipDirectory(bytes).entries.map((entry) => entry.name);
  assert.ok(names.includes('word/document.xml'));
  assert.ok(
    names.some((name) => /^word\/media\/.+\.png$/.test(name)),
    'the same-origin image is embedded'
  );

  const read = await docxToHtml(bytes, { parseXml });
  const html = read.fragments.join('\n');
  assert.match(html, /^<h1>Field notes<\/h1>/);
  assert.match(
    html,
    /<b>bold<\/b>, <i>italic<\/i>, <u>under<\/u>, <s>gone<\/s>, H<sub>2<\/sub>O, x<sup>2<\/sup>, <code>npm ci<\/code>/
  );
  assert.match(html, /<a href="https:\/\/docs\.example\.test\/a">the docs<\/a>/);
  assert.match(html, /<h2>Steps<\/h2>/);
  assert.match(html, /<ol><li>First<ol><li>Nested<\/li><\/ol><\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<ul><li>Bullet<\/li><\/ul>/);
  assert.match(
    html,
    /<table><thead><tr><th>Name<\/th><th>Value<\/th><th>Note<\/th><\/tr><\/thead><tbody><tr><td rowspan="2">A<\/td>/
  );
  assert.match(html, /<pre><code>const a = 1;\nconst b = 2;<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>Measure twice\.<\/p><\/blockquote>/);
  assert.match(html, /Image: Far <a href="https:\/\/cdn\.example\.test\/far\.png">/);
  assert.match(html, /Embedded content: A video <a href="https:\/\/www\.youtube\.com\/watch\?v=abc">/);
  assert.match(html, /HTML block \(not exported\)/);
  assert.doesNotMatch(html, /alert\(1\)/);
  assert.match(html, /<a href="https:\/\/cms\.example\.test\/articles\/q8n2x">earlier<\/a>/);
  assert.equal(read.images, 1, 'the embedded image reads back as one image');

  // And through the whole import into blocks again.
  const again = clean((await importDocx(bytes)).blocks);
  assert.deepEqual(
    again.slice(0, 6).map((block) => block.type),
    ['header', 'paragraph', 'header', 'list', 'list', 'table']
  );
  assert.deepEqual(again[5].data.merges, [{ row: 1, col: 0, rowspan: 2, colspan: 1 }]);
});

test('word export: an empty document and the all-blocks fixture produce valid files', async () => {
  const empty = await buildDocxFile({ blocks: [] }, { labels: LABELS });
  assert.ok(readZipDirectory(empty).entries.length > 3);
  const all = JSON.parse(
    readFileSync(new URL('./fixtures/editor-2x-all-blocks.json', import.meta.url), 'utf8')
  );
  const bytes = await buildDocxFile(all, { origin: ORIGIN, labels: LABELS });
  const html = (await docxToHtml(bytes, { parseXml })).fragments.join('\n');
  assert.match(html, /Field notes from <i>Example Valley<\/i>/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /☑ Done/);
});

test('print and HTML export: standalone document, no scripts or frames, print stylesheet', () => {
  const html = exportHtmlDocument(DOC, {
    title: 'Field <notes>',
    lang: 'de',
    origin: ORIGIN,
    labels: LABELS,
    pageBreaks: true,
  });
  assert.match(html, /^<!doctype html>\n<html lang="de">/);
  assert.match(html, /<title>Field &lt;notes&gt;<\/title>/);
  assert.match(html, /<main><h1[^>]*>Field notes<\/h1>/);
  assert.doesNotMatch(html, /<script|<iframe|alert\(1\)/i);
  assert.match(html, /<img src="https:\/\/cms\.example\.test\/uploads\/lake\.png" alt="A lake"/);
  assert.match(html, /href="https:\/\/cms\.example\.test\/articles\/q8n2x"/);
  assert.match(html, /@page \{ margin: 2cm/);
  assert.match(
    html,
    /a\[href\^="http"\]::after, a\[href\^="mailto:"\]::after \{ content: " \(" attr\(href\) "\)"/
  );
  assert.match(html, /main > h1:not\(:first-child\), main > h2:not\(:first-child\) \{ break-before: page/);
  assert.doesNotMatch(exportStylesheet({ pageBreaks: false }), /break-before: page/);
  assert.equal(
    exportHtmlDocument(DOC, { lang: 'x"><script>', labels: LABELS }).includes('<html lang="en">'),
    true
  );
});

test('markdown export and file names', () => {
  const markdown = exportMarkdown(DOC, { origin: ORIGIN, labels: LABELS });
  assert.match(markdown, /^# Field notes\n/);
  assert.match(markdown, /\[the docs\]\(https:\/\/docs\.example\.test\/a\)/);
  assert.match(markdown, /!\[A lake\]\(https:\/\/cms\.example\.test\/uploads\/lake\.png/);
  assert.match(markdown, /_HTML block \(not exported\)_/);
  assert.doesNotMatch(markdown, /<script/);
  const date = new Date(2026, 10, 24);
  assert.equal(
    exportFileName({ title: 'Über uns: Café!', field: 'body', format: 'docx', date }),
    'uber-uns-cafe-body-2026-11-24.docx'
  );
  assert.equal(
    exportFileName({ title: '', field: 'sections.2.content', format: 'markdown', date }),
    'entry-content-2026-11-24.md'
  );
  assert.equal(
    exportFileName({ title: 'A'.repeat(200), field: 'x', format: 'html', date }).length,
    60 + '-x-2026-11-24.html'.length
  );
});

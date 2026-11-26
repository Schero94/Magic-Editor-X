/**
 * 2.13 Word import with pictures: the reader collects embedded pictures as
 * their own fragments with their bytes (read in memory from the file, no
 * network), detects the type by signature, keeps vector and legacy formats,
 * linked pictures, pictures in lists and tables, oversize pictures and
 * pictures over the count limit as placeholders, and reports why. Word files
 * and pictures are generated in the test (fflate, sharp from @strapi/upload);
 * the content is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { DOCX_IMAGE_LIMITS, docxToHtml, sniffImageType } from '../shared/convert/docx.mjs';
import { convertImportFile } from '../shared/convert/import-file.mjs';
import { parseHtmlWithHtmlparser2 } from '../shared/convert/htmlparser-adapter.mjs';
import { buildDocx, link, p, picture, r, table, vmlPicture } from './fixtures/docx-builder.mjs';
import { STRICT_TIMING } from './helpers/perf-strict.mjs';

const require = createRequire(import.meta.url);
const uploadRequire = createRequire(require.resolve('@strapi/upload/package.json'));
const sharp = uploadRequire('sharp');
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');

const { window } = new JSDOM('');
const parseXml = (xml) => new window.DOMParser().parseFromString(xml, 'application/xml');
const parseHtml = parseHtmlWithHtmlparser2;

const raster = async (format, size = 8) =>
  new Uint8Array(
    await sharp({ create: { width: size, height: size, channels: 3, background: { r: 30, g: 140, b: 60 } } })
      [format]()
      .toBuffer()
  );

/** A PNG signature followed by junk: the type is detected, the data is damaged. */
const corruptPng = () => {
  const bytes = new Uint8Array(400).fill(0x41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

/** Incompressible bytes behind a PNG signature (an "oversize" picture without tripping the ratio check). */
const noisyPng = (length) => {
  const bytes = new Uint8Array(length);
  let seed = 7;
  for (let index = 0; index < length; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    bytes[index] = seed >>> 24;
  }
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

/** An EMF header (vector format from Word drawings). */
const EMF = Uint8Array.from([1, 0, 0, 0, 108, 0, 0, 0, ...new Array(100).fill(0)]);

const imported = (bytes, options = {}) =>
  convertImportFile({ name: 'pictures.docx', bytes }, { parseXml, parseHtml, images: 'collect', ...options });

test('sniffImageType: PNG, JPEG, GIF, WebP by signature; anything else is null', async () => {
  assert.equal(sniffImageType(await raster('png')), 'image/png');
  assert.equal(sniffImageType(await raster('jpeg')), 'image/jpeg');
  assert.equal(sniffImageType(await raster('gif')), 'image/gif');
  assert.equal(sniffImageType(await raster('webp')), 'image/webp');
  assert.equal(sniffImageType(EMF), null);
  assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImageType(new Uint8Array(4)), null);
});

test('docx pictures: PNG and JPEG become their own blocks with bytes and alt text; text around them stays', async () => {
  const png = await raster('png');
  const jpeg = await raster('jpeg');
  const docx = buildDocx(
    [
      p('Field notes'),
      p(['Before ', picture('rIdP1', { descr: 'A green valley at dawn' }), ' after']),
      p(picture('rIdP2', { title: 'Lake at noon' })),
      p('Heading with a picture', { style: 'Heading2' }),
      p([picture('rIdP1', { descr: 'The valley again' })]),
      p(vmlPicture('rIdP2', 'Old style picture')),
    ].join(''),
    {
      pictures: {
        rIdP1: { target: 'media/image1.png', bytes: png },
        rIdP2: { target: 'media/image2.jpeg', bytes: jpeg },
      },
    }
  );
  const result = await imported(docx);
  assert.equal(result.report.images, 4);
  assert.deepEqual(
    result.blocks.map((block) => block.data.text),
    [
      'Field notes',
      'Before',
      '<i>[Image: A green valley at dawn]</i>',
      'after',
      '<i>[Image: Lake at noon]</i>',
      'Heading with a picture',
      '<i>[Image: The valley again]</i>',
      '<i>[Image: Old style picture]</i>',
    ]
  );
  const media = result.report.media;
  assert.equal(media.length, 4);
  assert.deepEqual(
    media.map((item) => [item.alt, item.mime, item.reason, item.name]),
    [
      ['A green valley at dawn', 'image/png', null, 'image1.png'],
      ['Lake at noon', 'image/jpeg', null, 'image2.jpeg'],
      ['The valley again', 'image/png', null, 'image1.png'],
      ['Old style picture', 'image/jpeg', null, 'image2.jpeg'],
    ]
  );
  // Each media entry points at its placeholder block.
  const ids = new Map(result.blocks.map((block) => [block.id, block]));
  for (const item of media) assert.ok(ids.has(item.blockId), 'the placeholder block exists');
  // Read in memory from the file, byte for byte; the same part is read once and shares a key.
  assert.deepEqual([...media[0].bytes], [...png]);
  assert.deepEqual([...media[1].bytes], [...jpeg]);
  assert.equal(media[0].key, media[2].key);
  assert.equal(media[0].bytes, media[2].bytes);
});

test('docx pictures: a corrupt PNG keeps its type (the server refuses it on upload); EMF, linked and missing pictures stay placeholders', async () => {
  const docx = buildDocx(
    [
      p(picture('rIdBad', { descr: 'Damaged' })),
      p(picture('rIdEmf', { descr: 'Chart drawing' })),
      p(picture('rIdLinked', { descr: 'Linked', link: true })),
      p(picture('rIdExternal', { descr: 'External' })),
      p(picture('rIdNone', { descr: 'No part' })),
      p('<w:r><w:object><v:shape xmlns:v="urn:schemas-microsoft-com:vml"/></w:object></w:r>'),
    ].join(''),
    {
      pictures: {
        rIdBad: { target: 'media/image1.png', bytes: corruptPng() },
        rIdEmf: { target: 'media/image2.emf', bytes: EMF },
        rIdLinked: { target: 'https://cdn.example.test/linked.png', external: true },
        rIdExternal: { target: 'https://cdn.example.test/external.png', external: true },
        rIdNone: { target: 'media/missing.png' },
      },
    }
  );
  const result = await imported(docx);
  assert.deepEqual(
    result.report.media.map((item) => [item.alt, item.reason, item.mime || null]),
    [
      ['Damaged', null, 'image/png'],
      ['Chart drawing', 'format', null],
      ['Linked', 'linked', null],
      ['External', 'linked', null],
      ['No part', 'unsupported', null],
      ['', 'embedded', null],
    ]
  );
  // The EMF part is never inflated (no bytes), nothing was fetched for the linked ones.
  assert.equal(result.report.media[1].bytes, undefined);
  assert.equal(result.report.media[2].bytes, undefined);
});

test('docx pictures: pictures in lists, tables and link text stay placeholders and are listed with reason "position"', async () => {
  const png = await raster('png');
  const docx = buildDocx(
    [
      p(['Item ', picture('rIdP1', { descr: 'In a list' })], { numId: 1 }),
      table([['Cell', `${''}`]]).replace(
        '<w:t xml:space="preserve"></w:t>',
        `<w:t xml:space="preserve"></w:t></w:r>${picture('rIdP1', { descr: 'In a table' })}<w:r>`
      ),
      p([
        'See ',
        `<w:hyperlink r:id="rIdL">${picture('rIdP1', { descr: 'In a link' })}${r('the map')}</w:hyperlink>`,
      ]),
      p(picture('rIdP1', { descr: 'Own paragraph' })),
    ].join(''),
    {
      links: { rIdL: 'https://example.test/map' },
      pictures: { rIdP1: { target: 'media/image1.png', bytes: png } },
    }
  );
  const result = await imported(docx);
  assert.deepEqual(
    result.report.media.map((item) => [item.alt, item.reason, Boolean(item.blockId)]),
    [
      ['In a list', 'position', false],
      ['In a table', 'position', false],
      ['In a link', 'position', false],
      ['Own paragraph', null, true],
    ],
    'document order'
  );
  const html = JSON.stringify(result.blocks);
  assert.match(html, /\[Image: In a list\]/);
  assert.match(html, /\[Image: In a link\]/);
  assert.doesNotMatch(html, /\\u0000/, 'no internal marks reach the blocks');
});

test('docx pictures: size and count limits keep the rest as placeholders (no inflate beyond them)', async () => {
  const png = await raster('png');
  const big = noisyPng(64 * 1024);
  const parts = {};
  const body = [];
  for (let index = 1; index <= 4; index += 1) {
    parts[`rIdP${index}`] = { target: `media/image${index}.png`, bytes: index === 2 ? big : png };
    body.push(p(picture(`rIdP${index}`, { descr: `Picture ${index}` })));
  }
  const docx = buildDocx(body.join(''), { pictures: parts });
  const result = await imported(docx, { imageLimits: { maxImageBytes: 32 * 1024, maxImages: 2 } });
  assert.deepEqual(
    result.report.media.map((item) => [item.alt, item.reason]),
    [
      ['Picture 1', null],
      ['Picture 2', 'too-large'],
      ['Picture 3', null],
      ['Picture 4', 'limit'],
    ]
  );
  assert.equal(result.report.media[1].size, big.length);
  assert.equal(result.report.media[1].bytes, undefined);
  assert.ok(DOCX_IMAGE_LIMITS.maxImages >= 2 && DOCX_IMAGE_LIMITS.maxImageBytes === 10 * 1024 * 1024);
});

test('docx pictures: the default mode is unchanged (inline placeholders, no media)', async () => {
  const png = await raster('png');
  const docx = buildDocx(p(['Text ', picture('rIdP1', { descr: 'Kept inline' })]), {
    pictures: { rIdP1: { target: 'media/image1.png', bytes: png } },
  });
  const read = await docxToHtml(docx, { parseXml });
  assert.deepEqual(read.fragments, ['<p>Text <i>[Image: Kept inline]</i></p>']);
  assert.deepEqual(read.media, []);
  const result = await convertImportFile({ name: 'a.docx', bytes: docx }, { parseXml, parseHtml });
  assert.deepEqual(result.report.media, []);
  assert.equal(result.report.images, 1);
});

test('docx pictures: alt text is escaped in the placeholder and survives the sanitiser as text', async () => {
  const png = await raster('png');
  const docx = buildDocx(p(picture('rIdP1', { descr: '"><img src=x onerror=alert(1)>' })), {
    pictures: { rIdP1: { target: 'media/image1.png', bytes: png } },
  });
  const result = await imported(docx);
  const cleaned = cleanEditorValue({ blocks: result.blocks }, { rawHtml: 'disable' }).blocks;
  assert.doesNotMatch(JSON.stringify(cleaned), /<img/);
  assert.equal(result.report.media[0].alt, '"><img src=x onerror=alert(1)>');
});

test('docx pictures: 50 pictures read within the time budget', async () => {
  const png = await raster('png', 64);
  const parts = {};
  const body = [];
  for (let index = 1; index <= 50; index += 1) {
    parts[`rIdP${index}`] = { target: `media/image${index}.png`, bytes: png };
    body.push(p([`Paragraph ${index} `, picture(`rIdP${index}`, { descr: `Picture ${index}` })]));
  }
  const docx = buildDocx(body.join(''), { pictures: parts });
  const started = performance.now();
  const result = await imported(docx);
  const elapsed = performance.now() - started;
  assert.equal(result.report.media.filter((item) => item.mime === 'image/png').length, 50);
  if (STRICT_TIMING) assert.ok(elapsed < 1500, `read in ${Math.round(elapsed)} ms`);
});

test('docx pictures: link() helper still works next to pictures (hyperlink text kept)', async () => {
  const png = await raster('png');
  const docx = buildDocx(
    p(['Open ', link('rIdDocs', 'the docs'), picture('rIdP1', { descr: 'After link' })]),
    {
      links: { rIdDocs: 'https://example.test/docs' },
      pictures: { rIdP1: { target: 'media/image1.png', bytes: png } },
    }
  );
  const result = await imported(docx);
  assert.equal(result.blocks[0].data.text, 'Open <a href="https://example.test/docs">the docs</a>');
  assert.equal(result.report.media[0].reason, null);
});

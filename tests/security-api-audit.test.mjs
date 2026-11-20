import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { sanitizeUrl } from '../shared/sanitize-policy.mjs';

/**
 * Regression tests for the 2.7 API audit (F1, F2, F4, F5, F6). Synthetic data only.
 */

const require = createRequire(import.meta.url);
const register = require('../server/src/register.js');
const createReferences = require('../server/src/services/references.js');
const editorService = require('../server/src/services/editor.js');

const FIELD = 'plugin::magic-editor-x.richtext';
const doc = (blocks) => ({ time: 1, version: '2.31.0', blocks });
const DIRTY = () =>
  doc([
    {
      id: 'p1',
      type: 'paragraph',
      data: {
        text: 'hi <img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>',
      },
    },
    {
      id: 'r1',
      type: 'raw',
      data: { html: '<script>alert(4)</script><iframe src="https://evil.example"></iframe>' },
    },
  ]);
const assertClean = (value) => {
  const text = JSON.stringify(value);
  for (const marker of ['onerror', '<script', 'javascript:', '<iframe'])
    assert.ok(!text.includes(marker), `${marker} must be removed`);
};

const strapiWithEditorField = (pluginConfig = {}) => {
  const middlewares = [];
  const strapi = {
    customFields: { register: () => {} },
    config: { get: (key) => pluginConfig[key] },
    log: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    components: {},
    contentType: () => ({
      uid: 'api::post.post',
      attributes: { title: { type: 'string' }, body: { type: 'json', customField: FIELD } },
    }),
    documents: { use: (fn) => middlewares.push(fn) },
  };
  register({ strapi });
  return { strapi, middlewares };
};

test('F1: the save middleware sanitises Document Service clone data (Content Manager duplicate)', async () => {
  const { middlewares } = strapiWithEditorField();
  assert.deepEqual(register.WRITE_ACTIONS, ['create', 'update', 'clone']);
  let written;
  const ctx = {
    action: 'clone',
    uid: 'api::post.post',
    params: { documentId: 'src1', data: { title: 'copy', body: DIRTY() } },
  };
  await middlewares[0](ctx, async () => {
    written = ctx.params.data;
    return { documentId: 'dst1', entries: [] };
  });
  assert.equal(written.title, 'copy');
  assertClean(written.body);
  assert.equal(written.body.blocks[0].data.text.startsWith('hi '), true);
});

test('F1: publish, unpublish and discardDraft carry no data and pass through untouched', async () => {
  const { middlewares } = strapiWithEditorField();
  for (const action of ['publish', 'unpublish', 'discardDraft']) {
    const params = { documentId: 'doc1' };
    const result = await middlewares[0]({ action, uid: 'api::post.post', params }, async () => 'ok');
    assert.equal(result, 'ok');
    assert.deepEqual(params, { documentId: 'doc1' });
  }
});

const outputStrapi = () => ({
  config: { get: () => undefined },
  log: { debug() {}, warn() {}, error() {}, info() {} },
  contentType: () => undefined,
  getModel: () => undefined,
  auth: { verify: async () => {} },
  contentAPI: { sanitize: { output: async (row) => row } },
  documents: () => ({ findMany: async () => [] }),
  db: { query: () => ({ findMany: async () => [] }) },
  plugin: () => ({ service: () => ({}) }),
});

test('F2: ?mex=json output runs the stored value through the sanitiser', async () => {
  const service = createReferences({ strapi: outputStrapi() });
  const [json, html] = await service.transform(
    [
      { value: DIRTY(), locale: 'en' },
      { value: DIRTY(), locale: 'en', format: 'html' },
    ],
    { format: 'json', auth: { strategy: { name: 'content-api-token' }, credentials: {} } }
  );
  assertClean(json);
  assert.equal(json.blocks[0].id, 'p1');
  assertClean(html);
  // A stored value that is not editor content is never sent as stored.
  const [bad] = await service.transform([{ value: { blocks: 'nope<script>' } }], { format: 'json' });
  assert.ok(!JSON.stringify(bad).includes('<script'));
});

test('F5: sanitizeUrl rejects backslash spellings of protocol-relative URLs', () => {
  for (const url of [
    '/\\evil.example',
    '\\\\evil.example',
    '\\/evil.example',
    '/\\/evil.example',
    'https://ok.example\\@evil.example/',
  ])
    assert.equal(sanitizeUrl(url), '', url);
  assert.equal(sanitizeUrl('/articles/one'), '/articles/one');
  assert.equal(sanitizeUrl('https://example.com/a%5Cb'), 'https://example.com/a%5Cb');
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};
const png = ({ text, breakIdat = false } = {}) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(4, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < 4; y += 1) rows.push(Buffer.from([0, ...Array(16).fill(200)]));
  const idat = chunk('IDAT', zlib.deflateSync(Buffer.concat(rows)));
  if (breakIdat) idat[idat.length - 1] ^= 0xff;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(text ? [chunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1'))] : []),
    idat,
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const uploadHarness = ({ security, uploadError } = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mex-sec-test-'));
  const stored = [];
  const strapi = {
    config: { get: (key) => (key === 'plugin::upload.security' ? security : undefined) },
    log: { debug() {}, warn() {}, error() {}, info() {} },
    plugin: (name) => ({
      service: (service) => {
        if (name === 'upload' && service === 'upload')
          return {
            upload: async ({ files }) => {
              if (uploadError) throw uploadError;
              stored.push(files);
              return [{ id: 1, url: `/uploads/${files.originalFilename}`, mime: files.mimetype }];
            },
          };
        return {};
      },
    }),
  };
  const fetched = { body: null, url: null, mimeType: 'image/png' };
  const service = editorService(
    { strapi },
    {
      fetchBounded: async () => ({ ...fetched, url: new URL(fetched.url), body: fetched.body }),
    }
  );
  const file = (name, buffer) => {
    const filepath = path.join(directory, `f${stored.length}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(filepath, buffer);
    return { image: { filepath, originalFilename: name } };
  };
  return { service, stored, file, fetched, cleanup: () => fs.rmSync(directory, { recursive: true }) };
};

test('F4: image uploads store the extension of the detected type, never the client or URL extension', async () => {
  const h = uploadHarness();
  try {
    const polyglot = png({ text: '<script>document.title=1</script>' });
    for (const name of ['poly.html', 'poly.png.htm', 'poly.svg', 'poly.xhtml', '.htaccess']) {
      const result = await h.service.uploadImageFile(h.file(name, polyglot), { id: 1 });
      assert.match(result.file.url, /\.png$/, name);
    }
    assert.deepEqual(
      h.stored.map((item) => item.originalFilename),
      ['poly.png', 'poly.png', 'poly.png', 'poly.png', 'htaccess.png']
    );
    assert.ok(h.stored.every((item) => item.mimetype === 'image/png'));
    h.fetched.body = polyglot;
    h.fetched.url = 'https://cdn.example.com/x/evil.html';
    await h.service.uploadImageUrl('https://cdn.example.com/x/evil.html', { id: 1 });
    assert.equal(h.stored.at(-1).originalFilename, 'evil.png');
    // Media by URL: the remote extension is replaced as well.
    h.fetched.mimeType = 'video/mp4';
    h.fetched.body = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
    h.fetched.url = 'https://cdn.example.com/v/clip.html';
    await h.service.uploadMediaUrl('https://cdn.example.com/v/clip.html', 'video', { id: 1 });
    assert.equal(h.stored.at(-1).originalFilename, 'clip.mp4');
  } finally {
    h.cleanup();
  }
});

test('F4: the Media Library upload security settings (deniedTypes, allowedTypes) apply', async () => {
  for (const security of [
    { deniedTypes: ['image/png'] },
    { deniedTypes: ['image/*'] },
    { allowedTypes: ['image/jpeg'] },
  ]) {
    const h = uploadHarness({ security });
    try {
      await assert.rejects(h.service.uploadImageFile(h.file('a.png', png()), { id: 1 }), (error) => {
        assert.equal(error.statusCode, 415);
        return true;
      });
      assert.equal(h.stored.length, 0);
    } finally {
      h.cleanup();
    }
  }
  const allowed = uploadHarness({ security: { allowedTypes: ['image/*'], deniedTypes: ['image/svg+xml'] } });
  try {
    await allowed.service.uploadImageFile(allowed.file('a.png', png()), { id: 1 });
    assert.equal(allowed.stored.length, 1);
  } finally {
    allowed.cleanup();
  }
});

test('F6: a damaged image answers 400 with a clear message instead of 500', async () => {
  const h = uploadHarness();
  try {
    await assert.rejects(
      h.service.uploadImageFile(h.file('bad.png', png({ breakIdat: true })), { id: 1 }),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, 'The image file is damaged');
        return true;
      }
    );
    assert.equal(h.stored.length, 0);
    assert.equal(editorService.isIntactPng(png()), true);
    assert.equal(editorService.isIntactPng(png().subarray(0, 40)), false);
  } finally {
    h.cleanup();
  }
  // Strapi's own refusal of a faulty image (ApplicationError) is a 400 as well, for every image type.
  const refused = uploadHarness({
    uploadError: Object.assign(new Error('File is not a valid image'), { name: 'ApplicationError' }),
  });
  try {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    await assert.rejects(
      refused.service.uploadImageFile(refused.file('bad.jpg', jpeg), { id: 1 }),
      (error) => {
        assert.equal(error.statusCode, 400);
        return true;
      }
    );
  } finally {
    refused.cleanup();
  }
  // Any other failure (provider down) stays a server error.
  const down = uploadHarness({ uploadError: new Error('provider unavailable') });
  try {
    await assert.rejects(down.service.uploadImageFile(down.file('ok.png', png()), { id: 1 }), (error) => {
      assert.equal(error.statusCode, undefined);
      return true;
    });
  } finally {
    down.cleanup();
  }
});

/**
 * Damaged JPEG, GIF and WebP files are refused with 400 on the three upload
 * routes (image by file, image by URL, attachment), like PNG (2.7 API
 * re-audit). The check is the Media Library's own `image-manipulation`
 * service (sharp), loaded from the installed @strapi/upload; synthetic images
 * are made with the same sharp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const editorService = require('../server/src/services/editor.js');
const uploadRequire = createRequire(require.resolve('@strapi/upload/package.json'));
const sharp = uploadRequire('sharp');
// The service reads `plugin::upload.sharp` from the global Strapi instance.
globalThis.strapi = globalThis.strapi || { config: { get: () => ({}) } };
const imageManipulation = uploadRequire('./dist/server/services/image-manipulation.js');

const harness = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mex-integrity-'));
  const stored = [];
  const strapi = {
    config: { get: () => undefined },
    log: { debug() {}, warn() {}, error() {}, info() {} },
    plugin: (name) => ({
      service: (service) => {
        if (name === 'upload' && service === 'image-manipulation') return imageManipulation;
        if (name === 'upload' && service === 'upload')
          return {
            upload: async ({ files }) => {
              stored.push(files);
              return [{ id: stored.length, url: `/uploads/${files.originalFilename}`, mime: files.mimetype }];
            },
          };
        return {};
      },
    }),
  };
  const fetched = { body: null, url: 'https://cdn.example.com/x/a.jpg', mimeType: 'image/jpeg' };
  const service = editorService(
    { strapi },
    { fetchBounded: async () => ({ ...fetched, url: new URL(fetched.url) }) }
  );
  const file = (field, name, buffer) => {
    const filepath = path.join(directory, `f-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(filepath, buffer);
    return { [field]: { filepath, originalFilename: name } };
  };
  return { service, stored, file, fetched, cleanup: () => fs.rmSync(directory, { recursive: true }) };
};

const image = (format) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    [format]()
    .toBuffer();

// The re-audit's samples: a valid signature followed by junk.
const DAMAGED = {
  jpeg: Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0'),
    Buffer.alloc(300, 0x41),
  ]),
  gif: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100, 0x41)]),
  webp: Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x40, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
    Buffer.alloc(60, 0x41),
  ]),
};
const EXT = { jpeg: 'jpg', gif: 'gif', webp: 'webp' };
const MIME = { jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const rejects400 = (promise, message) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.message, message);
    return true;
  });

for (const format of ['jpeg', 'gif', 'webp']) {
  test(`${format}: a damaged file answers 400 on all three upload routes`, async () => {
    const h = harness();
    try {
      const name = `damaged.${EXT[format]}`;
      await rejects400(
        h.service.uploadImageFile(h.file('image', name, DAMAGED[format]), { id: 1 }),
        'The image file is damaged'
      );
      h.fetched.body = DAMAGED[format];
      h.fetched.mimeType = MIME[format];
      await rejects400(
        h.service.uploadImageUrl(`https://cdn.example.com/x/${name}`, { id: 1 }),
        'The image file is damaged'
      );
      await rejects400(
        h.service.uploadAttachment(h.file('file', name, DAMAGED[format]), { id: 1 }),
        'The file is damaged or not a valid file of its type'
      );
      // A real image whose data is cut off is refused as well.
      const truncated = (await image(format)).subarray(0, -8);
      await rejects400(
        h.service.uploadImageFile(h.file('image', name, truncated), { id: 1 }),
        'The image file is damaged'
      );
      assert.equal(h.stored.length, 0);
    } finally {
      h.cleanup();
    }
  });

  test(`${format}: an intact file is stored on all three upload routes`, async () => {
    const h = harness();
    try {
      const body = await image(format);
      const name = `ok.${EXT[format]}`;
      await h.service.uploadImageFile(h.file('image', name, body), { id: 1 });
      h.fetched.body = body;
      h.fetched.mimeType = MIME[format];
      await h.service.uploadImageUrl(`https://cdn.example.com/x/${name}`, { id: 1 });
      await h.service.uploadAttachment(h.file('file', name, body), { id: 1 });
      assert.deepEqual(
        h.stored.map((item) => item.mimetype),
        [MIME[format], MIME[format], MIME[format]]
      );
    } finally {
      h.cleanup();
    }
  });
}

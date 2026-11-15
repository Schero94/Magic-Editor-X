/**
 * 2.5 media: private upload providers (signed Media Library URLs, file ids,
 * the file id migration's matching rules) and dropped files (block planning).
 * Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  urlBase,
  fileSlots,
  collectFiles,
  indexRows,
  matchFile,
  withRowUrls,
  rewriteFiles,
  hasSignatureTrace,
  hashCandidates,
  rowUrlFor,
} from '../shared/media-urls.mjs';
import {
  droppedBlock,
  dropPosition,
  dropTypesFor,
  imageBlockData,
} from '../admin/src/editor/drop-insert.mjs';
import { BLOCK_POLICIES } from '../shared/sanitize-policy.mjs';
import { renderHtml } from '../shared/render/index.mjs';

const require = createRequire(import.meta.url);
const mediaService = require('../server/src/services/media.js');
const { registerMediaSigning } = require('../server/src/utils/media-signing.js');

const FILES = 'https://files.example.test/bucket';
const row = (id, name, extra = {}) => ({
  id,
  documentId: `doc${id}abc`,
  url: `${FILES}/${name}.png`,
  hash: name,
  ext: '.png',
  mime: 'image/png',
  provider: 'private-test',
  formats: { thumbnail: { url: `${FILES}/thumbnail_${name}.png`, hash: `thumbnail_${name}` } },
  ...extra,
});
const ROWS = [row(1, 'one_a1'), row(2, 'two_b2'), row(3, 'three_c3', { provider: 'local' })];
const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });
const image = (file) => ({ id: `i${file.id || 'x'}`, type: 'image', data: { file, caption: '' } });

test('urlBase drops query and fragment, also for site-relative URLs', () => {
  assert.equal(urlBase('https://x.example.test/a.png?sig=1&exp=2#f'), 'https://x.example.test/a.png');
  assert.equal(urlBase('/uploads/a.png?x=1'), '/uploads/a.png');
  assert.equal(urlBase('/uploads/a.png'), '/uploads/a.png');
  assert.equal(urlBase(null), '');
});

test('file slots: image, gallery, video (file, poster, tracks), audio and attaches', () => {
  const blocks = [
    image({ url: `${FILES}/one_a1.png`, id: 1 }),
    { id: 'g', type: 'gallery', data: { images: [{ file: { url: 'a' } }, { file: { url: 'b' } }], _mex: 1 } },
    {
      id: 'v',
      type: 'video',
      data: { file: { url: 'v' }, poster: { url: 'p' }, tracks: [{ file: { url: 't' } }], _mex: 1 },
    },
    { id: 'a', type: 'audio', data: { file: { url: 'au' }, tracks: [], _mex: 1 } },
    { id: 'f', type: 'attaches', data: { file: { url: 'att' }, title: '' } },
    { id: 's', type: 'simpleImage', data: { url: 'simple' } },
  ];
  assert.deepEqual(
    blocks.flatMap((block) => fileSlots(block).map((slot) => slot.file.url)),
    [`${FILES}/one_a1.png`, 'a', 'b', 'v', 'p', 't', 'au', 'att']
  );
  const keys = collectFiles([doc(blocks)]);
  assert.deepEqual(keys.ids, [1]);
  assert.equal(keys.bases.length, 8);
});

test('matchFile uses the id only when its URL is the stored one (foreign ids never swap files)', () => {
  const index = indexRows(ROWS);
  assert.equal(matchFile({ url: `${FILES}/one_a1.png?sig=old`, id: 1 }, index).id, 1);
  // Copied from another project: id 2 is a different file here; the URL decides.
  assert.equal(matchFile({ url: `${FILES}/one_a1.png`, id: 2 }, index).id, 1);
  assert.equal(matchFile({ url: `${FILES}/unknown.png`, id: 2 }, index), null);
  assert.equal(matchFile({ url: `${FILES}/two_b2.png`, documentId: 'doc2abc' }, index).id, 2);
});

test('withRowUrls rewrites the file and matching formats, drops flags and can add ids', () => {
  const stored = {
    url: `${FILES}/one_a1.png?sig=x`,
    isUrlSigned: true,
    alt: 'Kept',
    formats: {
      thumbnail: { url: `${FILES}/thumbnail_one_a1.png?sig=x`, isUrlSigned: true },
      other: { url: 'https://cdn.example.test/other.png' },
    },
  };
  const [one] = ROWS;
  const signed = {
    url: `${one.url}?sig=new`,
    formats: { thumbnail: { url: `${one.formats.thumbnail.url}?sig=new` } },
  };
  const out = withRowUrls(stored, one, signed);
  assert.equal(out.url, `${FILES}/one_a1.png?sig=new`);
  assert.equal(out.formats.thumbnail.url, `${FILES}/thumbnail_one_a1.png?sig=new`);
  assert.equal(out.formats.other.url, 'https://cdn.example.test/other.png');
  assert.equal(out.isUrlSigned, undefined);
  assert.equal(out.formats.thumbnail.isUrlSigned, undefined);
  assert.equal(out.alt, 'Kept');
  assert.equal(out.id, undefined);
  const unsigned = withRowUrls(stored, one, one, { fillIds: true });
  assert.equal(unsigned.url, one.url);
  assert.equal(unsigned.formats.thumbnail.url, one.formats.thumbnail.url);
  assert.equal(unsigned.id, 1);
  assert.equal(unsigned.documentId, 'doc1abc');
  assert.equal(hasSignatureTrace(stored), true);
  assert.equal(hasSignatureTrace(unsigned), false);
});

test('rewriteFiles keeps the identity of values it does not change', () => {
  const value = doc([image({ url: 'x' }), { id: 'p', type: 'paragraph', data: { text: 'Hi' } }]);
  assert.equal(
    rewriteFiles(value, () => null),
    value
  );
  const changed = rewriteFiles(value, (file) => ({ ...file, url: 'y' }));
  assert.notEqual(changed, value);
  assert.equal(changed.blocks[0].data.file.url, 'y');
  assert.equal(changed.blocks[1], value.blocks[1]);
  assert.equal(value.blocks[0].data.file.url, 'x');
});

test('format URLs are found by hash candidates (admin route)', () => {
  assert.deepEqual(hashCandidates(`${FILES}/thumbnail_one_a1.png?sig=1`), ['thumbnail_one_a1', 'one_a1']);
  assert.deepEqual(rowUrlFor(ROWS[0], `${FILES}/thumbnail_one_a1.png`), { key: 'thumbnail' });
  assert.deepEqual(rowUrlFor(ROWS[0], `${FILES}/one_a1.png`), { key: null });
  assert.equal(rowUrlFor(ROWS[0], `${FILES}/two_b2.png`), null);
});

test('attaches keep the Media Library file id; output is unchanged', () => {
  const clean = BLOCK_POLICIES.attaches({
    file: { url: `${FILES}/doc.pdf`, id: 7, documentId: 'abc7', name: 'doc.pdf', extension: 'pdf', size: 10 },
    title: 'Doc',
  });
  assert.equal(clean.file.id, 7);
  assert.equal(clean.file.documentId, 'abc7');
  const block = (file) => doc([{ id: 'f', type: 'attaches', data: { file, title: 'Doc' } }]);
  const { id: _id, documentId: _doc, ...withoutIds } = clean.file;
  assert.equal(renderHtml(block(clean.file)), renderHtml(block(withoutIds)));
});

/**
 * Minimal Strapi for the media service: one upload file table, a provider
 * that signs with `?sig=<n>` and counts its calls.
 */
const fakeStrapi = ({ isPrivate = true, rows = ROWS } = {}) => {
  const calls = { queries: 0, signs: 0 };
  const middlewares = [];
  const fileService = {
    async signFileUrls(file) {
      file.isUrlSigned = false;
      if (file.provider !== 'private-test' || !isPrivate) return file;
      calls.signs += 1;
      const copy = JSON.parse(JSON.stringify(file));
      copy.url = `${copy.url}?sig=${calls.signs}`;
      copy.isUrlSigned = true;
      for (const format of Object.values(copy.formats || {})) format.url = `${format.url}?sig=${calls.signs}`;
      return copy;
    },
  };
  const upload = { provider: { isPrivate: async () => isPrivate }, service: () => fileService };
  const strapi = {
    config: { get: (key) => (key === 'plugin::upload' ? { provider: 'private-test' } : undefined) },
    log: { warn() {}, info() {}, error() {}, debug() {} },
    getModel: () => ({}),
    db: {
      query: () => ({
        async findMany({ where }) {
          calls.queries += 1;
          const match = (r) =>
            where.$or.some(
              (clause) =>
                (clause.id && clause.id.$in.includes(r.id)) ||
                (clause.documentId && clause.documentId.$in.includes(r.documentId)) ||
                (clause.url && clause.url.$in.includes(r.url)) ||
                (clause.hash && clause.hash.$in.includes(r.hash))
            );
          return JSON.parse(JSON.stringify(rows.filter(match)));
        },
      }),
    },
    documents: { use: (fn) => middlewares.push(fn) },
    components: {},
    contentType: () => ({
      uid: 'api::article.article',
      attributes: { body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' } },
    }),
  };
  let service;
  strapi.plugin = (name) =>
    name === 'upload' ? upload : { service: () => service || (service = mediaService({ strapi })) };
  service = mediaService({ strapi });
  return { strapi, service, calls, middlewares };
};

test('public providers: values come back unchanged, without a query', async () => {
  const { service, calls } = fakeStrapi({ isPrivate: false });
  const values = [doc([image({ url: ROWS[0].url, id: 1 })])];
  assert.equal((await service.signValues(values))[0], values[0]);
  assert.equal((await service.unsignValues(values))[0], values[0]);
  assert.deepEqual(await service.signUrls([ROWS[0].url], async () => new Set([1])), {
    private: false,
    urls: {},
  });
  assert.equal(calls.queries, 0);
});

test('private providers: one query and one signature per file for a whole batch', async () => {
  const { service, calls } = fakeStrapi();
  const one = { url: ROWS[0].url, id: 1, formats: { thumbnail: { url: ROWS[0].formats.thumbnail.url } } };
  const values = [
    doc([image(one), image({ url: ROWS[1].url })]),
    doc([image(one), image({ url: ROWS[2].url, id: 3 })]),
    'legacy string',
  ];
  const out = await service.signValues(values);
  assert.equal(calls.queries, 1);
  assert.equal(calls.signs, 2);
  assert.match(out[0].blocks[0].data.file.url, /one_a1\.png\?sig=\d$/);
  assert.match(out[0].blocks[0].data.file.formats.thumbnail.url, /thumbnail_one_a1\.png\?sig=\d$/);
  assert.match(out[0].blocks[1].data.file.url, /two_b2\.png\?sig=\d$/);
  // Another provider's file (local) is not signed.
  assert.equal(out[1].blocks[1].data.file.url, ROWS[2].url);
  assert.equal(out[2], 'legacy string');
  // The input is not changed.
  assert.equal(values[0].blocks[0].data.file.url, ROWS[0].url);
});

test('private providers: writes lose signatures and gain file ids', async () => {
  const { service } = fakeStrapi();
  const value = doc([
    image({ url: `${ROWS[0].url}?sig=9`, isUrlSigned: true }),
    image({ url: ROWS[1].url, id: 2 }),
    image({ url: `${FILES}/not-in-library.png?v=1` }),
  ]);
  const [out] = await service.unsignValues([value]);
  assert.deepEqual(out.blocks[0].data.file, { url: ROWS[0].url, id: 1, documentId: 'doc1abc' });
  assert.equal(out.blocks[1], value.blocks[1]);
  // Not a Media Library file: kept as written.
  assert.equal(out.blocks[2], value.blocks[2]);
});

test('signUrls signs file and format URLs the permission check allows, keyed by URL base', async () => {
  const { service } = fakeStrapi();
  const requested = [`${ROWS[0].formats.thumbnail.url}?sig=old`, ROWS[1].url, `${FILES}/unknown.png`];
  const allowed = await service.signUrls(requested, async (rows) => new Set(rows.map((r) => r.id)));
  assert.equal(allowed.private, true);
  assert.match(allowed.urls[ROWS[0].formats.thumbnail.url], /thumbnail_one_a1\.png\?sig=\d$/);
  assert.match(allowed.urls[ROWS[1].url], /two_b2\.png\?sig=\d$/);
  assert.equal(Object.keys(allowed.urls).length, 2);
  const none = await service.signUrls(requested, async () => new Set());
  assert.deepEqual(none.urls, {});
});

test('the Document Service middleware unsigns writes and signs reads (private only)', async () => {
  const { strapi, middlewares } = fakeStrapi();
  assert.equal(await registerMediaSigning(strapi), true);
  const [middleware] = middlewares;
  const data = { title: 'T', body: doc([image({ url: `${ROWS[0].url}?sig=old` })]) };
  let written;
  const result = await middleware(
    { action: 'update', uid: 'api::article.article', params: { data } },
    async () => {
      written = JSON.parse(JSON.stringify(data));
      return JSON.parse(JSON.stringify(data));
    }
  );
  assert.equal(written.body.blocks[0].data.file.url, ROWS[0].url);
  assert.equal(written.body.blocks[0].data.file.id, 1);
  assert.match(result.body.blocks[0].data.file.url, /\?sig=\d$/);
  const list = await middleware({ action: 'findMany', uid: 'api::article.article', params: {} }, async () => [
    { body: doc([image({ url: ROWS[1].url, id: 2 })]) },
  ]);
  assert.match(list[0].body.blocks[0].data.file.url, /two_b2\.png\?sig=\d$/);
  // Admin requests (Content Manager) keep the stored URLs.
  strapi.requestContext = { get: () => ({ state: { route: { info: { type: 'admin' } } } }) };
  const admin = await middleware(
    { action: 'findOne', uid: 'api::article.article', params: {} },
    async () => ({
      body: doc([image({ url: ROWS[1].url, id: 2 })]),
    })
  );
  assert.equal(admin.body.blocks[0].data.file.url, ROWS[1].url);
  const publicHost = fakeStrapi({ isPrivate: false });
  assert.equal(await registerMediaSigning(publicHost.strapi), false);
  assert.equal(publicHost.middlewares.length, 0);
});

test('dropped files become image, video or audio blocks the field allows', () => {
  const all = { image: true, video: true, audio: true };
  assert.deepEqual(dropTypesFor(all), ['images', 'videos', 'audios']);
  assert.deepEqual(dropTypesFor({ image: true, video: false, audio: false }), ['images']);
  const png = { url: '/uploads/a.png', mime: 'image/png', id: 4, documentId: 'd4', name: 'a.png', width: 2 };
  assert.deepEqual(droppedBlock(png, all), { type: 'image', data: imageBlockData(png) });
  assert.equal(droppedBlock(png, all).data.file.id, 4);
  const mp4 = { url: '/uploads/v.mp4', mime: 'video/mp4', id: 5, ext: '.mp4' };
  assert.equal(droppedBlock(mp4, all).type, 'video');
  assert.equal(droppedBlock(mp4, all).data.file.id, 5);
  assert.equal(droppedBlock(mp4, { ...all, video: false }), null);
  assert.equal(droppedBlock({ url: '/uploads/a.mp3', mime: 'audio/mpeg' }, all).type, 'audio');
  assert.equal(droppedBlock({ url: '/uploads/a.pdf', mime: 'application/pdf' }, all), null);
  assert.equal(droppedBlock({ mime: 'image/png' }, all), null);
});

test('dropped blocks go after the block under the pointer or replace an empty paragraph', () => {
  assert.deepEqual(dropPosition({ index: 1, empty: false }, 4), { index: 2, replace: false });
  assert.deepEqual(dropPosition({ index: 1, empty: true }, 4), { index: 1, replace: true });
  assert.deepEqual(dropPosition(null, 4), { index: 4, replace: false });
  assert.deepEqual(dropPosition({ index: 9, empty: false }, 4), { index: 4, replace: false });
});

test('CLI: media-file-ids is a dry run unless --apply', async () => {
  const { parseCommand } = await import('../bin/magic-editor-x.mjs');
  assert.deepEqual(parseCommand(['media-file-ids']), {
    help: false,
    command: 'media-file-ids',
    json: false,
    options: { dryRun: true },
  });
  assert.equal(parseCommand(['media-file-ids', '--apply', '--batch', '50']).options.batchSize, 50);
  assert.equal(parseCommand(['media-file-ids', '--apply']).options.dryRun, false);
  assert.throws(() => parseCommand(['media-file-ids', '--uid', 'api::a.a']), /not an option/);
});

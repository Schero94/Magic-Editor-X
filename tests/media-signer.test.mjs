/**
 * 2.5 private upload providers: the editor renders signed media URLs and
 * save() returns the stored (unsigned) ones again (admin/src/editor/media-signer.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSigner } from '../admin/src/editor/media-signer.mjs';

const S = 'http://files.example.test/files';
const value = () => ({
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'img1', type: 'image', data: { file: { id: 1, url: `${S}/a.png` }, caption: '' } },
    {
      id: 'gal1',
      type: 'gallery',
      data: {
        images: [{ file: { id: 2, url: `${S}/b.png`, formats: { small: { url: `${S}/small_b.png` } } } }],
        _mex: 1,
      },
    },
    { id: 'img2', type: 'image', data: { file: { url: 'https://cdn.example.test/public.png' } } },
    { id: 'p1', type: 'paragraph', data: { text: 'Text' } },
  ],
});

const fakeRequest = (calls) => async (urls) => {
  calls.push(urls);
  return Object.fromEntries(urls.filter((u) => u.startsWith(S)).map((u) => [u, `${u}?exp=9&sig=abc`]));
};

test('prewarm signs every media URL of the content in one request', async () => {
  const signer = createMediaSigner();
  const calls = [];
  await signer.prewarm(signer.basesOf(value()), fakeRequest(calls));
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].sort(),
    [`${S}/a.png`, `${S}/b.png`, `${S}/small_b.png`, 'https://cdn.example.test/public.png'].sort()
  );
  await signer.prewarm(signer.basesOf(value()), fakeRequest(calls));
  assert.equal(calls.length, 2, 'unsigned (public) URLs are asked again, signed ones are cached');
  assert.deepEqual(calls[1], ['https://cdn.example.test/public.png']);
});

test('signValue for display, unsignValue back to the stored value', async () => {
  const signer = createMediaSigner();
  await signer.prewarm(signer.basesOf(value()), fakeRequest([]));
  const shown = signer.signValue(value());
  assert.equal(shown.blocks[0].data.file.url, `${S}/a.png?exp=9&sig=abc`);
  assert.equal(shown.blocks[1].data.images[0].file.formats.small.url, `${S}/small_b.png?exp=9&sig=abc`);
  assert.equal(
    shown.blocks[2].data.file.url,
    'https://cdn.example.test/public.png',
    'not signed by the server: unchanged'
  );
  assert.deepEqual(signer.unsignValue(shown), value());
  // Editor.js escapes & in URL strings on save.
  const escaped = structuredClone(shown);
  escaped.blocks[0].data.file.url = `${S}/a.png?exp=9&amp;sig=abc`;
  assert.equal(signer.unsignValue(escaped).blocks[0].data.file.url, `${S}/a.png`);
  const untouched = value();
  assert.equal(signer.unsignValue(untouched), untouched, 'nothing signed: same object');
});

test('a failed request leaves the content as it is', async () => {
  const signer = createMediaSigner();
  await signer.prewarm(signer.basesOf(value()), async () => {
    throw new Error('offline');
  });
  const original = value();
  assert.equal(signer.signValue(original), original);
});

test('expired signatures are not used for display', async () => {
  const signer = createMediaSigner({ ttlMs: 1 });
  await signer.prewarm([`${S}/a.png`], fakeRequest([]));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(signer.signValue(value()).blocks[0].data.file.url, `${S}/a.png`);
});

/**
 * 2.7 API audit regressions against a running host (F1, F2, F4, F6):
 * the Content Manager "Duplicate" (Document Service `clone` with data) runs the
 * save sanitiser, `?mex=json` output is clean, image uploads store the
 * extension of the detected type, a damaged PNG answers 400.
 *
 * Host requirements: `api::article.article` (Draft & Publish) with `title`,
 * `slug` (uid of `title`) and `body` (Magic Editor X), the Public role allowed
 * to `find`/`findOne` articles, the local upload provider. Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, makePng, HOST } from './helpers.mjs';

const CM = '/content-manager/collection-types/api::article.article';
const RUN = Date.now().toString(36);
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const dirty = () =>
  doc([
    {
      id: 'p1',
      type: 'paragraph',
      data: {
        text: `sec ${RUN} <img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>`,
      },
    },
    {
      id: 'r1',
      type: 'raw',
      data: { html: '<script>alert(4)</script><iframe src="https://evil.example"></iframe>' },
    },
    { id: 'l1', type: 'paragraph', data: { text: '<a href="/\\evil.example">bs</a>' } },
  ]);
const assertClean = (value, label) => {
  const text = JSON.stringify(value);
  for (const marker of ['onerror', '<script', 'javascript:', '<iframe', 'evil.example'])
    assert.ok(!text.includes(marker), `${label}: ${marker} must be removed`);
};

test('F1/F2: a duplicated entry is sanitised on save and its ?mex=json output is clean', async () => {
  const token = await tokenFor('admin');
  const created = await call('POST', CM, {
    token,
    body: { title: `sec-src-${RUN}`, slug: `sec-src-${RUN}`, body: dirty() },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  assertClean(created.body.data.body, 'create');

  const cloned = await call('POST', `${CM}/clone/${created.body.data.documentId}`, {
    token,
    body: { title: `sec-dst-${RUN}`, slug: `sec-dst-${RUN}`, body: dirty() },
  });
  assert.ok([200, 201].includes(cloned.status), JSON.stringify(cloned.body).slice(0, 300));
  const clone = cloned.body.data.documentId;
  const stored = await call('GET', `${CM}/${clone}`, { token });
  assert.equal(stored.status, 200);
  assertClean(stored.body.data.body, 'clone');
  assert.match(stored.body.data.body.blocks[0].data.text, new RegExp(`sec ${RUN}`));

  const published = await call('POST', `${CM}/${clone}/actions/publish`, { token, body: {} });
  assert.equal(published.status, 200);
  for (const query of ['', '?mex=json', '?mex=html']) {
    const response = await call('GET', `/api/articles/${clone}${query}`);
    assert.equal(response.status, 200, query);
    assertClean(response.body.data.body, `public${query}`);
  }
});

test('F4: image uploads keep the detected extension; F6: a damaged PNG answers 400', async () => {
  const token = await tokenFor('admin');
  for (const name of ['poly.html', 'poly.png.htm', 'poly.svg', 'poly.xhtml']) {
    const form = new FormData();
    form.append('image', new Blob([makePng(8)], { type: 'image/png' }), name);
    const response = await call('POST', '/magic-editor-x/image/byFile', { token, body: form });
    assert.equal(response.status, 200, `${name}: ${JSON.stringify(response.body).slice(0, 200)}`);
    assert.match(response.body.file.url, /\.png$/, name);
    const served = await fetch(HOST + response.body.file.url);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('content-type') || '', /^image\/png/, name);
  }
  const broken = makePng(8);
  broken[broken.length - 12 - 1] ^= 0xff; // last byte of the IDAT CRC
  const form = new FormData();
  form.append('image', new Blob([broken], { type: 'image/png' }), 'broken.png');
  const response = await call('POST', '/magic-editor-x/image/byFile', { token, body: form });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { success: 0, message: 'The image file is damaged' });
});

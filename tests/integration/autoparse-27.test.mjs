/**
 * 2.7 API audit F3 against a running host: `api.autoParseJSON` (default on)
 * parses 1.x JSON strings only in Magic Editor X fields. A string field that
 * holds an Editor.js-looking JSON string is returned as stored.
 *
 * Host requirements: `api::article.article` with `title` (string), `slug`
 * (uid) and `body` (Magic Editor X); `creds['full-access']` is a full-access
 * API token (seed script). Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, creds } from './helpers.mjs';

test('F3: autoParseJSON leaves non-editor fields alone and keeps editor fields as objects', async () => {
  const token = creds['full-access'];
  assert.ok(token, 'creds.json needs a full-access API token (full-access)');
  const text = JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'not editor content' } }] });
  const body = {
    time: 1,
    version: '2.31.7',
    blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'editor' } }],
  };
  const created = await call('POST', '/api/articles?status=published', {
    token,
    body: { data: { title: text, slug: `autoparse-${Date.now().toString(36)}`, body } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  const id = created.body.data.documentId;
  for (const path of [`/api/articles/${id}`, `/api/articles?filters[documentId]=${id}`]) {
    const response = await call('GET', path, { token });
    assert.equal(response.status, 200, path);
    const entry = Array.isArray(response.body.data) ? response.body.data[0] : response.body.data;
    assert.equal(typeof entry.title, 'string', `${path}: title stays a string`);
    assert.equal(entry.title, text);
    assert.equal(typeof entry.body, 'object');
    assert.equal(entry.body.blocks[0].data.text, 'editor');
  }
});

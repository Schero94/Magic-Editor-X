/**
 * Internal-link picker routes against a running host (see helpers.mjs):
 * GET /magic-editor-x/links/types and GET /magic-editor-x/links/search.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

const UID = 'api::article.article';
const RUN = Date.now()
  .toString(36)
  .replace(/[^a-z0-9]/g, '');
const search = (params) => `/magic-editor-x/links/search?${new URLSearchParams(params)}`;

test('links: anonymous calls are rejected', async () => {
  for (const path of ['/magic-editor-x/links/types', search({ uid: UID })]) {
    const response = await call('GET', path);
    assert.equal(response.status, 401, path);
  }
});

test('links: a role without plugin access gets 403', async () => {
  const author = await tokenFor('author');
  for (const path of ['/magic-editor-x/links/types', search({ uid: UID, q: 'x' })]) {
    const response = await call('GET', path, { token: author });
    assert.equal(response.status, 403, path);
  }
});

test('links: the editor finds a created article by title with a usable href', async () => {
  const editor = await tokenFor('editor');
  const title = `Linkable ${RUN}`;
  const created = await createArticle(editor, { title });
  const types = await call('GET', '/magic-editor-x/links/types', { token: editor });
  assert.equal(types.status, 200);
  const article = types.body.data.find((type) => type.uid === UID);
  assert.ok(article, 'article is linkable');
  assert.equal(typeof article.localized, 'boolean');

  const response = await call('GET', search({ uid: UID, q: title }), { token: editor });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  const hit = response.body.data.find((item) => item.documentId === created.documentId);
  assert.ok(hit, 'created article is found');
  assert.equal(hit.title, title);
  assert.equal(hit.uid, UID);
  assert.match(hit.href, /^(\/|https?:\/\/)/);
  assert.doesNotMatch(hit.href, /[{}]/, 'href is rendered');
  assert.deepEqual(
    Object.keys(hit)
      .filter((key) => key !== 'status')
      .sort(),
    ['documentId', 'href', 'locale', 'title', 'uid']
  );
  assert.ok(response.body.data.length <= 20);
  assert.equal(response.body.meta.pagination.pageSize, 20);
  assert.ok(response.body.meta.pagination.total >= 1);

  const wildcard = await call('GET', search({ uid: UID, q: `%_${RUN}%` }), { token: editor });
  assert.equal(wildcard.status, 200);
  assert.equal(wildcard.body.data.length, 0, 'LIKE wildcards are matched literally');
});

test('links: the reviewer only sees types and entries it can read', async () => {
  const admin = await tokenFor('admin');
  const reviewer = await tokenFor('reviewer');
  const editor = await tokenFor('editor');
  const title = `Reviewer visible ${RUN}`;
  const created = await createArticle(editor, { title });

  const all = await call('GET', '/magic-editor-x/links/types', { token: admin });
  const own = await call('GET', '/magic-editor-x/links/types', { token: reviewer });
  assert.equal(own.status, 200);
  const ownUids = own.body.data.map((type) => type.uid);
  assert.ok(ownUids.includes(UID), 'reviewer can read articles');
  for (const uid of ownUids)
    assert.ok(
      all.body.data.some((type) => type.uid === uid),
      `${uid} is readable by the admin too`
    );

  const found = await call('GET', search({ uid: UID, q: title }), { token: reviewer });
  assert.equal(found.status, 200);
  assert.ok(found.body.data.some((item) => item.documentId === created.documentId));

  const hidden = all.body.data.find((type) => !ownUids.includes(type.uid));
  if (hidden) {
    const denied = await call('GET', search({ uid: hidden.uid }), { token: reviewer });
    assert.equal(denied.status, 404, `${hidden.uid} is not readable by the reviewer`);
  }
});

test('links: invalid input answers 400, unknown types 404', async () => {
  const editor = await tokenFor('editor');
  const tooLong = await call('GET', search({ uid: UID, q: 'x'.repeat(101) }), { token: editor });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error.name, 'ValidationError');
  assert.doesNotMatch(JSON.stringify(tooLong.body), /xxxxxxxxxx/, 'input is not echoed');

  for (const params of [
    { uid: 'plugin::users-permissions.user' },
    { uid: 'admin::user' },
    { uid: UID, page: '0' },
    { uid: UID, pageSize: '1000' },
  ]) {
    const response = await call('GET', search(params), { token: editor });
    assert.equal(response.status, 400, JSON.stringify(params));
  }

  const unknown = await call('GET', search({ uid: 'api::doesnotexist.doesnotexist' }), { token: editor });
  assert.equal(unknown.status, 404);
});

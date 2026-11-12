import test from 'node:test';
import assert from 'node:assert/strict';
import { call, creds, tokenFor, createArticle } from './helpers.mjs';

/**
 * Block comments (2.3) against a real host. Roles (see CONTRIBUTING.md):
 * `editor` (Editor role + access, comments.read, comments.write),
 * `reviewer` (reads articles: title, body and sections, locales en/de; access,
 * comments.read, comments.write; no update right), `reader` (reads articles;
 * access + comments.read only), `author` (no plugin action), `admin` (Super
 * Admin, has comments.moderate).
 */

const ARTICLE = 'api::article.article';
const cm = (path) => `/content-manager/collection-types/${ARTICLE}${path}`;
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const target = (documentId, extra = {}) => ({
  uid: ARTICLE,
  documentId,
  locale: 'en',
  field: 'body',
  ...extra,
});
const query = (t) =>
  `/magic-editor-x/comments?uid=${encodeURIComponent(t.uid)}&documentId=${t.documentId}&locale=${t.locale}&field=${encodeURIComponent(t.field)}`;
const list = (token, t) => call('GET', query(t), { token });
const comment = (token, t, blockId, body, excerpt) =>
  call('POST', '/magic-editor-x/comments', { token, body: { ...t, blockId, body, excerpt } });

/**
 * Creates an article with two paragraphs in `en`.
 * @param {string} token - Editor token.
 * @param {string} title - Title.
 * @returns {Promise<object>} Document.
 */
const article = (token, title) =>
  createArticle(token, { title, body: doc([p('blk1', 'First paragraph'), p('blk2', 'Second paragraph')]) });

test('an editor and a reviewer without update rights comment on the same block', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const entry = await article(editor, 'Comments together');
  const t = target(entry.documentId);

  const created = await comment(editor, t, 'blk1', 'Please check the first sentence.', 'First paragraph');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const thread = created.body.data;
  assert.equal(thread.blockId, 'blk1');
  assert.equal(thread.status, 'open');
  assert.equal(thread.comments[0].author.own, true);
  assert.equal(thread.comments[0].author.name, 'Anna Beispiel');
  assert.doesNotMatch(JSON.stringify(created.body), /authorId|resolvedById|"id":\d/);

  const seen = await list(reviewer, t);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.data.length, 1);
  assert.equal(seen.body.data[0].comments[0].author.own, false);
  assert.deepEqual(seen.body.meta.counts, { open: 1, resolved: 0, comments: 1 });
  assert.equal(seen.body.meta.canWrite, true);
  assert.equal(seen.body.meta.canModerate, false);

  const reply = await call('POST', `/magic-editor-x/comments/${thread.id}/replies`, {
    token: reviewer,
    body: { body: 'Looks fine to me.' },
  });
  assert.equal(reply.status, 201);
  const resolved = await call('POST', `/magic-editor-x/comments/${thread.id}/resolve`, { token: reviewer });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.status, 'resolved');
  assert.equal(resolved.body.data.resolvedBy.name, 'Cora Prüfer');
  const reopened = await call('POST', `/magic-editor-x/comments/${thread.id}/reopen`, { token: editor });
  assert.equal(reopened.body.data.status, 'open');
  const own = await comment(reviewer, t, 'blk2', 'A second thread.');
  assert.equal(own.status, 201);

  // The reviewer still cannot change the content itself.
  const edit = await call('PUT', cm(`/${entry.documentId}?plugins[i18n][locale]=en`), {
    token: reviewer,
    body: { title: 'Changed', body: doc([p('blk1', 'Changed')]) },
  });
  assert.equal(edit.status, 403);

  // Comments never end up in the field value.
  const stored = await call('GET', cm(`/${entry.documentId}?plugins[i18n][locale]=en`), { token: editor });
  assert.equal(stored.status, 200);
  assert.doesNotMatch(JSON.stringify(stored.body), /check the first sentence|Looks fine|second thread/);
  const after = await list(editor, t);
  assert.deepEqual(after.body.meta.counts, { open: 2, resolved: 0, comments: 3 });
});

test('comment access: anonymous, no comments.read, read-only commenters, validation', async () => {
  const editor = await tokenFor('editor');
  const author = await tokenFor('author');
  const reader = await tokenFor('reader');
  const entry = await article(editor, 'Comment access');
  const t = target(entry.documentId);
  const created = await comment(editor, t, 'blk1', 'Editor note');
  const id = created.body.data.id;

  assert.equal((await call('GET', query(t))).status, 401);
  assert.equal((await list(author, t)).status, 403);
  assert.equal((await comment(author, t, 'blk1', 'x')).status, 403);
  assert.equal((await call('DELETE', `/magic-editor-x/comments/${id}`, { token: author })).status, 403);

  const readable = await list(reader, t);
  assert.equal(readable.status, 200);
  assert.equal(readable.body.data[0].comments[0].body, 'Editor note');
  assert.equal(readable.body.meta.canWrite, false);
  assert.equal((await comment(reader, t, 'blk1', 'x')).status, 403);
  for (const [method, path, body] of [
    ['POST', `/magic-editor-x/comments/${id}/replies`, { body: 'x' }],
    ['PUT', `/magic-editor-x/comments/${id}`, { body: 'x' }],
    ['POST', `/magic-editor-x/comments/${id}/resolve`, undefined],
    ['DELETE', `/magic-editor-x/comments/${id}`, undefined],
  ]) {
    assert.equal((await call(method, path, { token: reader, body })).status, 403, `${method} ${path}`);
  }

  const unknown = await list(editor, target('zzzzzzzzzzzzzzzzzzzzzzzz'));
  assert.equal(unknown.status, 404);
  assert.equal((await list(editor, target(entry.documentId, { field: 'title' }))).status, 404);
  for (const body of [
    { ...t, blockId: 'blk1', body: 'x', authorId: 1 },
    { ...t, blockId: 'not a block id', body: 'x' },
    { ...t, blockId: 'blk1', body: '' },
    { ...t, blockId: 'blk1', body: 'x'.repeat(4001) },
    { ...t, blockId: 'blk1', body: String.fromCharCode(1, 2, 3) },
  ]) {
    const response = await call('POST', '/magic-editor-x/comments', { token: editor, body });
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(response.body.error.name, 'ValidationError');
  }
});

test('only authors edit their comments; deleting others needs comments.moderate', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const admin = await tokenFor('admin');
  const entry = await article(editor, 'Comment ownership');
  const t = target(entry.documentId);
  const thread = (await comment(editor, t, 'blk1', 'Original text')).body.data;

  assert.equal(
    (
      await call('PUT', `/magic-editor-x/comments/${thread.id}`, {
        token: reviewer,
        body: { body: 'Hijacked' },
      })
    ).status,
    403
  );
  assert.equal(
    (await call('DELETE', `/magic-editor-x/comments/${thread.id}`, { token: reviewer })).status,
    403
  );
  const edited = await call('PUT', `/magic-editor-x/comments/${thread.id}`, {
    token: editor,
    body: { body: 'Edited text' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.body, 'Edited text');
  assert.ok(edited.body.data.editedAt);

  const reply = await call('POST', `/magic-editor-x/comments/${thread.id}/replies`, {
    token: reviewer,
    body: { body: 'My reply' },
  });
  // The author cannot remove a thread somebody else answered...
  assert.equal(
    (await call('DELETE', `/magic-editor-x/comments/${thread.id}`, { token: editor })).status,
    403
  );
  // ...but the reviewer can remove their own reply, and a moderator can remove anything.
  const ownReply = await call('DELETE', `/magic-editor-x/comments/${reply.body.data.id}`, {
    token: reviewer,
  });
  assert.equal(ownReply.status, 200);
  const again = await call('POST', `/magic-editor-x/comments/${thread.id}/replies`, {
    token: reviewer,
    body: { body: 'Another reply' },
  });
  assert.equal(again.status, 201);
  const moderated = await call('DELETE', `/magic-editor-x/comments/${thread.id}`, { token: admin });
  assert.equal(moderated.status, 200);
  assert.equal(moderated.body.data.removed, 2);
  assert.equal((await list(editor, t)).body.data.length, 0);
  assert.equal(
    (await call('POST', `/magic-editor-x/comments/${thread.id}/resolve`, { token: editor })).status,
    404
  );
});

test('comments do not leak across documents, locales and unreadable fields', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  // The built-in Editor role was created before the `de` locale existed; the super admin writes German.
  const admin = await tokenFor('admin');
  const first = await article(editor, 'Leak A');
  const second = await article(editor, 'Leak B');
  const de = await call('PUT', cm(`/${first.documentId}?locale=de`), {
    token: admin,
    body: { title: 'Leck A', body: doc([p('blk1', 'Erster Absatz')]) },
  });
  assert.equal(de.status, 200, JSON.stringify(de.body).slice(0, 200));

  await comment(editor, target(first.documentId), 'blk1', 'English only');
  assert.equal((await list(admin, target(first.documentId, { locale: 'de' }))).body.data.length, 0);
  assert.equal((await list(reviewer, target(first.documentId, { locale: 'de' }))).body.data.length, 0);
  assert.equal((await list(editor, target(second.documentId))).body.data.length, 0);
  await comment(admin, target(first.documentId, { locale: 'de' }), 'blk1', 'Nur Deutsch');
  assert.equal((await list(editor, target(first.documentId, { locale: 'de' }))).status, 404, 'no de access');
  const german = await list(reviewer, target(first.documentId, { locale: 'de' }));
  assert.deepEqual(
    german.body.data.map((thread) => thread.comments[0].body),
    ['Nur Deutsch']
  );
  const english = await list(editor, target(first.documentId));
  assert.deepEqual(
    english.body.data.map((thread) => thread.comments[0].body),
    ['English only']
  );

  // The reviewer role cannot read the `teaser` field: its comments stay hidden, ids included.
  const hidden = await comment(editor, target(first.documentId, { field: 'teaser' }), 'blk1', 'Teaser note');
  assert.equal(hidden.status, 201);
  assert.equal((await list(reviewer, target(first.documentId, { field: 'teaser' }))).status, 404);
  for (const [method, path, body] of [
    ['POST', `/magic-editor-x/comments/${hidden.body.data.id}/replies`, { body: 'peek' }],
    ['POST', `/magic-editor-x/comments/${hidden.body.data.id}/resolve`, undefined],
    ['DELETE', `/magic-editor-x/comments/${hidden.body.data.id}`, undefined],
  ]) {
    assert.equal((await call(method, path, { token: reviewer, body })).status, 404, `${method} ${path}`);
  }
});

test('deleting a locale or a whole entry deletes its comments', async () => {
  const editor = await tokenFor('editor');
  const admin = await tokenFor('admin');
  const entry = await article(editor, 'Retention');
  const de = await call('PUT', cm(`/${entry.documentId}?locale=de`), {
    token: admin,
    body: { title: 'Aufbewahrung', body: doc([p('blk1', 'Absatz')]) },
  });
  assert.equal(de.status, 200);
  await comment(editor, target(entry.documentId), 'blk1', 'Keep me');
  await comment(admin, target(entry.documentId, { locale: 'de' }), 'blk1', 'Delete me');
  const deThreads = await list(admin, target(entry.documentId, { locale: 'de' }));
  const deId = deThreads.body.data[0].id;

  const removed = await call('DELETE', cm(`/${entry.documentId}?locale=de`), { token: admin });
  assert.equal(removed.status, 200, JSON.stringify(removed.body).slice(0, 200));
  // A new German version of the same document starts without the old comments.
  const recreated = await call('PUT', cm(`/${entry.documentId}?locale=de`), {
    token: admin,
    body: { title: 'Neu', body: doc([p('blk1', 'Neu')]) },
  });
  assert.equal(recreated.status, 200);
  assert.equal((await list(admin, target(entry.documentId, { locale: 'de' }))).body.data.length, 0);
  assert.equal(
    (await call('POST', `/magic-editor-x/comments/${deId}/resolve`, { token: admin })).status,
    404
  );
  assert.equal((await list(editor, target(entry.documentId))).body.data.length, 1, 'other locale kept');

  const enId = (await list(editor, target(entry.documentId))).body.data[0].id;
  const all = await call('DELETE', cm(`/${entry.documentId}?locale=*`), { token: admin });
  assert.ok([200, 204].includes(all.status), String(all.status));
  // The comment row is gone (a remaining row of a deleted document would also answer 404, so the
  // host check in CONTRIBUTING.md counts rows directly).
  assert.equal(
    (await call('POST', `/magic-editor-x/comments/${enId}/resolve`, { token: admin })).status,
    404
  );
});

test('a deleted admin user keeps their comments as "Deleted user"; new comments are rate limited', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const roles = (await call('GET', '/admin/roles', { token: admin })).body.data;
  const editorRole = roles.find((role) => role.code === 'strapi-editor');
  const email = `temp-${Date.now()}@example.test`;
  const created = await call('POST', '/admin/users', {
    token: admin,
    body: { firstname: 'Temp', lastname: 'Kommentar', email, roles: [editorRole.id] },
  });
  assert.equal(created.status, 201);
  const password = `Tmp1!${Math.random().toString(36).slice(2)}${Date.now()}`;
  const registered = await call('POST', '/admin/register', {
    body: {
      registrationToken: created.body.data.registrationToken,
      userInfo: { firstname: 'Temp', lastname: 'Kommentar', password },
    },
  });
  assert.equal(registered.status, 200);
  const temp = (await call('POST', '/admin/login', { body: { email, password } })).body.data.token;

  const entry = await article(editor, 'Deleted author');
  const t = target(entry.documentId);
  const thread = (await comment(temp, t, 'blk1', 'Written by a temporary admin')).body.data;
  await call('POST', `/magic-editor-x/comments/${thread.id}/resolve`, { token: temp });
  // Rate limit: 30 new comments per admin and minute, shared by all processes.
  // (Up to 62 attempts so a minute boundary during the loop cannot hide the limit.)
  let limited = null;
  for (let index = 0; index < 62 && limited === null; index += 1) {
    const response = await comment(temp, t, 'blk2', `Note ${index}`);
    if (response.status === 429) limited = index;
    else assert.equal(response.status, 201);
  }
  assert.ok(limited !== null && limited <= 60, 'more than 30 comments within a minute are refused');

  const deleted = await call('DELETE', `/admin/users/${created.body.data.id}`, { token: admin });
  assert.equal(deleted.status, 200);
  const threads = (await list(editor, t)).body.data;
  const kept = threads.find((item) => item.id === thread.id);
  assert.equal(kept.comments[0].body, 'Written by a temporary admin');
  assert.deepEqual(kept.comments[0].author, { name: null, own: false, deleted: true });
  assert.deepEqual(kept.resolvedBy, { name: null });
  assert.doesNotMatch(JSON.stringify(threads), /Temp Kommentar/);
  assert.ok(creds.users.reader, 'creds.json has the reader account');
});

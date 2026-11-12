import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Y from 'yjs';
import { call, tokenFor, createArticle } from './helpers.mjs';
import { applyEditorDataToDoc } from '../../shared/ydoc.mjs';
import { buildQuote, htmlTextMap, textRangeToSource } from '../../shared/comment-anchor.mjs';
import { encodeRange, sharedTextAt } from '../../shared/comment-relpos.mjs';

/**
 * Range comments, @mentions and notifications (2.4) against a real host.
 * Roles (CONTRIBUTING.md): `editor` Anna (comments.read + write, updates articles), `reviewer` Cora
 * (reads articles, comments.read + write), `reader` Dana (reads articles, comments.read only),
 * `author` Ben (no plugin action), `outsider` Fynn (comments.read + write, reads only the homepage),
 * `admin` (Super Admin).
 *
 * Mention e-mails: set MEX_MAIL_LOG to the fake SMTP log (JSON lines) and MEX_MAIL_EXPECTED to `on` or
 * `off` (host started with `comments.notifications.email` true or false).
 */

const ARTICLE = 'api::article.article';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const target = (documentId) => ({ uid: ARTICLE, documentId, locale: 'en', field: 'body' });
const qs = (params) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
const mentionable = (token, t, q) =>
  call('GET', `/magic-editor-x/comments/mentionable?${qs({ ...t, q })}`, { token });
const list = (token, t) => call('GET', `/magic-editor-x/comments?${qs(t)}`, { token });
const notifications = (token, query = {}) =>
  call('GET', `/magic-editor-x/notifications?${qs(query)}`, { token });
const TEXT = 'Hello <b>brave</b> new &amp; shiny world';

/**
 * Article with two paragraphs; returns it with a range anchor on "brave new".
 * @param {string} token - Editor token.
 * @param {string} title - Title.
 * @returns {Promise<{ entry: object, anchor: object }>} Article and anchor.
 */
const articleWithAnchor = async (token, title) => {
  const entry = await createArticle(token, { title, body: doc([p('blk1', TEXT), p('blk2', 'Second')]) });
  // Relative positions as the admin builds them from the live room (any Y.Doc with this content).
  const room = new Y.Doc();
  applyEditorDataToDoc(room, doc([p('blk1', TEXT)]));
  const ytext = sharedTextAt(room, 'blk1', 'text');
  const map = htmlTextMap(ytext.toString());
  const start = map.text.indexOf('brave new');
  const source = textRangeToSource(map, start, start + 9);
  const range = encodeRange(ytext, source.start, source.end);
  return {
    entry,
    anchor: { path: 'text', ...range, quote: buildQuote(map.text, start, start + 9) },
  };
};

test('range comment: the anchor is stored with the thread and served back; block comments unchanged', async () => {
  const editor = await tokenFor('editor');
  const reader = await tokenFor('reader');
  const { entry, anchor } = await articleWithAnchor(editor, 'Range comments');
  const t = target(entry.documentId);
  const created = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: { ...t, blockId: 'blk1', body: 'Is "brave new" right?', excerpt: 'brave new', anchor },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.data.anchor, anchor);
  assert.equal(created.body.data.excerpt, 'brave new');
  const block = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: { ...t, blockId: 'blk2', body: 'Whole block' },
  });
  assert.equal(block.status, 201);
  assert.equal(block.body.data.anchor, null);
  const seen = await list(reader, t);
  assert.equal(seen.status, 200);
  const byBlock = Object.fromEntries(seen.body.data.map((thread) => [thread.blockId, thread]));
  assert.deepEqual(byBlock.blk1.anchor, anchor);
  assert.equal(byBlock.blk2.anchor, null);
  // Invalid anchors are refused.
  for (const bad of [
    { ...anchor, path: '__proto__..x' },
    { ...anchor, start: 'not base64' },
    { ...anchor, quote: { ...anchor.quote, exact: 'x'.repeat(501) } },
    { ...anchor, extra: true },
  ]) {
    const refused = await call('POST', '/magic-editor-x/comments', {
      token: editor,
      body: { ...t, blockId: 'blk1', body: 'x', anchor: bad },
    });
    assert.equal(refused.status, 400, JSON.stringify(bad).slice(0, 60));
  }
});

test('mention picker: people who can read the field, opaque ids, no e-mail; RBAC 403/404', async () => {
  const editor = await tokenFor('editor');
  const { entry } = await articleWithAnchor(editor, 'Picker');
  const t = target(entry.documentId);
  const found = await mentionable(editor, t, '');
  assert.equal(found.status, 200);
  const names = found.body.data.map((person) => person.name);
  assert.ok(names.includes('Cora Prüfer'), names.join());
  assert.ok(names.includes('Dana Leserin'), 'readers can be mentioned');
  assert.ok(!names.includes('Anna Beispiel'), 'not the caller');
  assert.ok(!names.includes('Ben Muster'), 'no comments.read');
  assert.ok(!names.includes('Fynn Fremd'), 'cannot read articles');
  for (const person of found.body.data) {
    assert.deepEqual(Object.keys(person).sort(), ['id', 'name']);
    assert.match(person.id, /^[a-z0-9]+$/);
  }
  assert.doesNotMatch(JSON.stringify(found.body), /example\.test/);
  const search = await mentionable(editor, t, 'cor');
  assert.deepEqual(
    search.body.data.map((person) => person.name),
    ['Cora Prüfer']
  );
  assert.equal((await mentionable(editor, t, 'reviewer@example')).body.data.length, 0, 'no e-mail search');
  // Readers cannot mention (no comments.write), Ben has no plugin rights, Fynn cannot read the article.
  assert.equal((await mentionable(await tokenFor('reader'), t, '')).status, 403);
  assert.equal((await mentionable(await tokenFor('author'), t, '')).status, 403);
  assert.equal((await mentionable(await tokenFor('outsider'), t, '')).status, 404);
  assert.equal((await mentionable(editor, { ...t, documentId: 'doesnotexist' }, '')).status, 404);
  assert.equal((await mentionable(editor, t, 'x'.repeat(51))).status, 400);
});

test('mentions are re-checked on the server; notifications are created, listed and marked read', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const admin = await tokenFor('admin');
  const { entry, anchor } = await articleWithAnchor(editor, 'Mention notifications');
  const t = target(entry.documentId);
  const people = (await mentionable(editor, t, '')).body.data;
  const cora = people.find((person) => person.name === 'Cora Prüfer');
  // Opaque ids of people without access, taken from an admin view (super admin lists all users).
  const users = await call('GET', '/admin/users?pageSize=50', { token: admin });
  const idOf = (email) => users.body.data.results.find((user) => user.email === email).documentId;
  const ben = idOf('author@example.test');
  const fynn = idOf('outsider@example.test');
  const before = (await notifications(reviewer)).body.meta.unread;

  const created = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: {
      ...t,
      blockId: 'blk1',
      body: 'Please look, @Cora Prüfer (and @Ben Muster, @Fynn Fremd)',
      anchor,
      mentions: [cora.id, ben, fynn],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.meta.droppedMentions, 2);
  assert.deepEqual(created.body.data.comments[0].mentions, [
    { id: cora.id, name: 'Cora Prüfer', you: false },
  ]);
  // Ben and Fynn got nothing (they cannot see the notification route either way).
  assert.equal((await notifications(await tokenFor('author'))).status, 403);
  assert.equal((await notifications(await tokenFor('outsider'))).body.data.length, 0);

  const listed = await notifications(reviewer);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.meta.unread, before + 1);
  const item = listed.body.data.find((note) => note.threadId === created.body.data.id);
  assert.ok(item, 'listed');
  assert.equal(item.kind, 'mention');
  assert.equal(item.read, false);
  assert.equal(item.actor.name, 'Anna Beispiel');
  assert.equal(item.target.title, 'Mention notifications');
  assert.equal(item.target.kind, 'collectionType');
  assert.equal(item.target.documentId, entry.documentId);
  assert.doesNotMatch(JSON.stringify(listed.body), /"(recipientId|authorId|email)"|example\.test/);

  // The field's comments panel sees it too.
  const field = await list(reviewer, t);
  assert.ok(field.body.meta.notifications.some((note) => note.threadId === created.body.data.id));

  // Someone else cannot change it; mark read, unread, read all.
  assert.equal(
    (await call('POST', `/magic-editor-x/notifications/${item.id}/read`, { token: editor })).status,
    404
  );
  assert.equal(
    (await call('POST', `/magic-editor-x/notifications/${item.id}/read`, { token: reviewer })).status,
    200
  );
  let unread = await notifications(reviewer, { unread: 'true' });
  assert.ok(!unread.body.data.some((note) => note.id === item.id));
  assert.equal(
    (await call('POST', `/magic-editor-x/notifications/${item.id}/unread`, { token: reviewer })).status,
    200
  );
  unread = await notifications(reviewer, { unread: 'true' });
  assert.ok(unread.body.data.some((note) => note.id === item.id));
  const all = await call('POST', '/magic-editor-x/notifications/read-all', { token: reviewer, body: {} });
  assert.equal(all.status, 200);
  assert.equal((await notifications(reviewer)).body.meta.unread, 0);
  assert.equal((await notifications(reviewer, { pageSize: '51' })).status, 400);

  // A reply notifies the thread's other participants (Anna), replying reads your own (Cora).
  await call('POST', `/magic-editor-x/notifications/${item.id}/unread`, { token: reviewer });
  const reply = await call('POST', `/magic-editor-x/comments/${created.body.data.id}/replies`, {
    token: reviewer,
    body: { body: 'Done.' },
  });
  assert.equal(reply.status, 201);
  const anna = await notifications(editor);
  assert.ok(anna.body.data.some((note) => note.threadId === created.body.data.id && note.kind === 'reply'));
  const cora2 = await notifications(reviewer, { unread: 'true' });
  assert.ok(!cora2.body.data.some((note) => note.threadId === created.body.data.id));
});

test('deleting the entry removes its notifications; the thread link stops working', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const { entry } = await articleWithAnchor(editor, 'Retention');
  const t = target(entry.documentId);
  const cora = (await mentionable(editor, t, 'cora')).body.data[0];
  const created = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: { ...t, blockId: 'blk1', body: '@Cora Prüfer bye', mentions: [cora.id] },
  });
  assert.equal(created.status, 201);
  assert.ok((await notifications(reviewer)).body.data.some((note) => note.threadId === created.body.data.id));
  const removed = await call(
    'DELETE',
    `/content-manager/collection-types/${ARTICLE}/${entry.documentId}?locale=en`,
    { token: await tokenFor('admin') }
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.ok(
    !(await notifications(reviewer)).body.data.some((note) => note.threadId === created.body.data.id)
  );
});

test(
  'mention e-mails follow comments.notifications.email',
  { skip: !process.env.MEX_MAIL_LOG && 'set MEX_MAIL_LOG' },
  async () => {
    const log = process.env.MEX_MAIL_LOG;
    const expected = process.env.MEX_MAIL_EXPECTED === 'on';
    const editor = await tokenFor('editor');
    const { entry } = await articleWithAnchor(editor, 'Mail check');
    const t = target(entry.documentId);
    const cora = (await mentionable(editor, t, 'cora')).body.data[0];
    const lines = () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
    const before = lines().length;
    const secret = `Secret body ${Date.now()}`;
    const created = await call('POST', '/magic-editor-x/comments', {
      token: editor,
      body: { ...t, blockId: 'blk1', body: `${secret} @Cora Prüfer`, mentions: [cora.id] },
    });
    assert.equal(created.status, 201);
    let mails = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      mails = lines().slice(before);
      if (mails.length || !expected) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!expected) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(lines().length, before, 'no e-mail when turned off');
      return;
    }
    assert.equal(mails.length, 1);
    const [mail] = mails;
    assert.deepEqual(mail.to, ['<reviewer@example.test>']);
    assert.match(mail.data, /^Subject: Anna Beispiel mentioned you in a comment$/m);
    assert.ok(!mail.data.includes(secret), 'the comment text is not sent');
    assert.match(mail.data, /"Mail check" \(Article\)/);
    assert.match(
      mail.data.replace(/=\r\n/g, ''),
      /content-manager\/collection-types\/api%3A%3Aarticle\.article\//
    );
  }
);

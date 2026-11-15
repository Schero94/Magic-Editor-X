/**
 * Entry panel, presence and widgets (2.5) against a running host (SQLite or PostgreSQL):
 * POST /presence, GET /entry-summary, GET /widgets/open-threads, GET /widgets/broken-links.
 * Deny cases: anonymous, no plugin access, Content Manager read denied, another locale, a type
 * without editor fields; field-level permissions; socket presence of field rooms (also a positional
 * field) next to entry heartbeats; the shared rate limit.
 *
 * The host config must allow the fake link server as a private origin of the scheduled link check:
 * qualityChecks.externalLinks.allowPrivateOrigins: ['http://127.0.0.1:<MEX_ENTRY_LINK_PORT, default 2515>'],
 * and have a collection type without editor fields `api::tag.tag` (field `name`) unless
 * MEX_ENTRY_PLAIN_UID names another one.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { call, tokenFor, createArticle, openSession, connect } from './helpers.mjs';

const LINK_PORT = Number(process.env.MEX_ENTRY_LINK_PORT || 2515);
const PLAIN_UID = process.env.MEX_ENTRY_PLAIN_UID || 'api::tag.tag';
const ORIGIN = `http://127.0.0.1:${LINK_PORT}`;
const RUN = Date.now().toString(36);
const UID = 'api::article.article';
let server;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/gone')) res.writeHead(404).end();
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<p>ok</p>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(LINK_PORT, '127.0.0.1', resolve);
  });
});
after(() => server?.close());

const tab = (who) => `${who}-${RUN}-tab-000000`.slice(0, 40);
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const presence = (token, who, target, extra = {}) =>
  call('POST', '/magic-editor-x/presence', { token, body: { ...target, tabId: tab(who), ...extra } });
const summary = (token, target) =>
  call(
    'GET',
    `/magic-editor-x/entry-summary?uid=${encodeURIComponent(target.uid)}&documentId=${target.documentId}${
      target.locale ? `&locale=${target.locale}` : ''
    }`,
    { token }
  );

/**
 * Starts a scheduled link check and waits for it.
 * @param {string} admin - Super admin token.
 * @returns {Promise<object>} lastRun.
 */
const runLinkCheck = async (admin) => {
  const before = await call('GET', '/magic-editor-x/quality/link-schedule', { token: admin });
  const previous = before.body.data.lastRun?.finishedAt || '';
  let started = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: admin });
  for (let i = 0; started.status === 409 && i < 100; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    started = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: admin });
  }
  assert.equal(started.status, 202);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const status = await call('GET', '/magic-editor-x/quality/link-schedule', { token: admin });
    const lastRun = status.body.data.lastRun;
    if (!status.body.data.running && lastRun && lastRun.finishedAt !== previous) return lastRun;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('link check did not finish');
};

let article;
let target;

test('setup: an article with a broken link, an empty link, a section and comments', async () => {
  const admin = await tokenFor('admin');
  article = await createArticle(
    admin,
    {
      title: `Panel ${RUN}`,
      body: doc([
        {
          id: 'pa1',
          type: 'paragraph',
          data: { text: `See <a href="${ORIGIN}/gone/${RUN}">the brief</a>.` },
        },
        { id: 'pa2', type: 'paragraph', data: { text: 'Empty <a href="">link</a> here.' } },
      ]),
      sections: [
        {
          heading: 'One',
          body: doc([
            {
              id: 'ps1',
              type: 'paragraph',
              data: { text: `Also <a href="${ORIGIN}/gone/s${RUN}">gone</a>.` },
            },
          ]),
        },
      ],
    },
    'en'
  );
  target = { uid: UID, documentId: article.documentId, locale: 'en' };
  assert.ok(article.documentId);
});

test('presence: deny cases answer 401/403/404 and write nothing', async () => {
  assert.equal((await presence(undefined, 'anon', target)).status, 401);
  assert.equal((await presence(await tokenFor('author'), 'author', target)).status, 403);
  assert.equal((await presence(await tokenFor('outsider'), 'outsider', target)).status, 404);
  assert.equal((await presence(await tokenFor('editor'), 'editor', { ...target, locale: 'de' })).status, 404);
  assert.equal(
    (await presence(await tokenFor('editor'), 'editor', { ...target, documentId: 'nosuchdoc' })).status,
    404
  );
  const admin = await tokenFor('admin');
  const plain = await call('POST', `/content-manager/collection-types/${PLAIN_UID}`, {
    token: admin,
    body: { name: `Plain ${RUN}` },
  });
  assert.equal(plain.status, 201);
  assert.equal(
    (await presence(admin, 'admin', { uid: PLAIN_UID, documentId: plain.body.data.documentId })).status,
    404
  );
  assert.equal((await presence(admin, 'admin', { ...target, tabId: undefined, extra: 1 })).status, 400);
  // Nobody of the refused calls shows up.
  const seen = await presence(admin, 'admin', target);
  assert.deepEqual(seen.body.data.editors, []);
  await presence(admin, 'admin', target, { leave: true });
});

test('presence: two editors see each other by name; a reader sees both and is not listed', async () => {
  const editor = await tokenFor('editor');
  const admin = await tokenFor('admin');
  const reviewer = await tokenFor('reviewer');
  let response = await presence(editor, 'editor', target);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.body.data.editors, []);
  assert.equal(response.body.data.canEdit, true);
  assert.equal(response.body.data.softLock, false);
  response = await presence(admin, 'admin', target);
  assert.deepEqual(
    response.body.data.editors.map((e) => e.name),
    ['Anna B.']
  );
  response = await presence(reviewer, 'reviewer', target);
  assert.equal(response.body.data.canEdit, false);
  assert.deepEqual(response.body.data.editors.map((e) => e.name).sort(), ['Anna B.', 'Review A.']);
  assert.ok(!JSON.stringify(response.body).includes('@'), 'no e-mail addresses');
  assert.equal((await presence(editor, 'editor', target, { idle: true })).status, 200);
  response = await presence(admin, 'admin', target);
  assert.equal(response.body.data.editors[0].idle, true);
  // The reader is never listed (no update right).
  assert.ok(!response.body.data.editors.some((e) => e.name.startsWith('Cora')));
  await presence(editor, 'editor', target, { leave: true });
  response = await presence(admin, 'admin', target);
  assert.deepEqual(response.body.data.editors, []);
  await presence(admin, 'admin', target, { leave: true });
});

test('presence: live sockets of field rooms count, a positional field included', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const read = await call(
    'GET',
    `/content-manager/collection-types/${UID}/${article.documentId}?locale=en&populate=*`,
    { token: admin }
  );
  const fieldKey = read.body.data.sections[0].body.fieldKey;
  assert.match(fieldKey, /^[A-Za-z0-9_-]{16,32}$/);
  const session = await openSession(admin, { ...target, field: 'sections.0.body', fieldKey });
  const client = await connect(session);
  assert.equal(client.errors.length, 0);
  let editors = [];
  for (let i = 0; i < 20 && !editors.length; i += 1) {
    editors = (await presence(editor, 'editor', target)).body.data.editors;
    if (!editors.length) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(editors.length, 1);
  assert.equal(editors[0].name, 'Review A.');
  assert.equal(editors[0].live, true);
  client.socket.disconnect();
  let gone = false;
  for (let i = 0; i < 30 && !gone; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    gone = (await presence(editor, 'editor', target)).body.data.editors.length === 0;
  }
  assert.ok(gone, 'a closed socket leaves the list');
  await presence(editor, 'editor', target, { leave: true });
});

test('entry summary: comments, quality and links per readable field; deny cases', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const writer = await tokenFor('writer');
  let response = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: { ...target, field: 'body', blockId: 'pa1', body: `Please fix ${RUN}` },
  });
  assert.equal(response.status, 201);
  const threadId = response.body.data.id;
  await runLinkCheck(admin);
  response = await summary(editor, target);
  assert.equal(response.status, 200);
  const data = response.body.data;
  const body = data.fields.find((f) => f.path === 'body');
  assert.equal(body.openThreads, 1);
  assert.deepEqual(body.issues, { errors: 1, warnings: 0 });
  assert.deepEqual(body.brokenLinks, { draft: 1, published: 0 });
  const section = data.fields.find((f) => f.path === 'sections.0.body');
  assert.equal(section.label, 'sections 1 › body');
  assert.match(section.field, /^sections\.body#/);
  assert.equal(section.brokenLinks.draft, 1);
  assert.deepEqual(data.comments, { enabled: true, open: 1 });
  assert.equal(data.links.enabled, true);
  assert.ok(data.links.lastRun && data.links.lastRun.finishedAt);
  assert.equal(data.links.draft, 2);

  // Field-level permissions: the reviewer may read title, body and sections.* only.
  response = await summary(reviewer, target);
  assert.deepEqual(
    response.body.data.fields.map((f) => f.path),
    ['body', 'sections.0.body']
  );
  // No comments.read: no counts.
  response = await summary(writer, target);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.comments, { enabled: false, open: null });
  assert.ok(response.body.data.fields.every((f) => f.openThreads === null));

  assert.equal((await summary(undefined, target)).status, 401);
  assert.equal((await summary(await tokenFor('author'), target)).status, 403);
  assert.equal((await summary(await tokenFor('outsider'), target)).status, 404);
  assert.equal((await summary(editor, { ...target, locale: 'de' })).status, 404);
  assert.equal(
    (
      await call(
        'GET',
        `/magic-editor-x/entry-summary?uid=${UID}&documentId=${article.documentId}&field=body`,
        { token: editor }
      )
    ).status,
    400
  );

  // Resolving the thread clears the count.
  assert.equal(
    (await call('POST', `/magic-editor-x/comments/${threadId}/resolve`, { token: editor })).status,
    200
  );
  response = await summary(editor, target);
  assert.equal(response.body.data.comments.open, 0);
});

test('widget open threads: started and mentioned threads, resolved ones gone, access filtered', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const users = await call('GET', '/admin/users?pageSize=50', { token: await tokenFor('admin') });
  const cora = users.body.data.results.find((u) => u.email === 'reviewer@example.test');
  let response = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: {
      ...target,
      field: 'body',
      blockId: 'pa2',
      body: `Who owns this ${RUN}?`,
      mentions: [cora.documentId],
    },
  });
  assert.equal(response.status, 201);
  const threadId = response.body.data.id;
  response = await call('GET', '/magic-editor-x/widgets/open-threads', { token: editor });
  assert.equal(response.status, 200);
  const mine = response.body.data.find((item) => item.threadId === threadId);
  assert.ok(mine);
  assert.equal(mine.started, true);
  assert.equal(mine.target.documentId, article.documentId);
  assert.equal(mine.target.title, `Panel ${RUN}`);
  response = await call('GET', '/magic-editor-x/widgets/open-threads', { token: reviewer });
  const mentioned = response.body.data.find((item) => item.threadId === threadId);
  assert.ok(mentioned);
  assert.equal(mentioned.mentioned, true);
  assert.equal(mentioned.started, false);
  response = await call('GET', '/magic-editor-x/widgets/open-threads?pageSize=1', { token: editor });
  assert.ok(response.body.data.length <= 1);
  assert.equal(
    (await call('GET', '/magic-editor-x/widgets/open-threads?pageSize=99', { token: editor })).status,
    400
  );
  assert.equal((await call('GET', '/magic-editor-x/widgets/open-threads', {})).status, 401);
  assert.equal(
    (await call('GET', '/magic-editor-x/widgets/open-threads', { token: await tokenFor('writer') })).status,
    403
  );
  response = await call('GET', '/magic-editor-x/widgets/open-threads', { token: await tokenFor('outsider') });
  assert.equal(response.status, 200);
  assert.ok(!response.body.data.some((item) => item.target.documentId === article.documentId));
  await call('POST', `/magic-editor-x/comments/${threadId}/resolve`, { token: editor });
  response = await call('GET', '/magic-editor-x/widgets/open-threads', { token: reviewer });
  assert.ok(!response.body.data.some((item) => item.threadId === threadId));
});

test('widget broken links: entries of the last run the caller can read', async () => {
  const editor = await tokenFor('editor');
  let response = await call('GET', '/magic-editor-x/widgets/broken-links?pageSize=20', { token: editor });
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.enabled, true);
  assert.ok(response.body.meta.lastRun);
  const entry = response.body.data.find((item) => item.target.documentId === article.documentId);
  assert.ok(entry, 'the article with broken links is listed');
  assert.equal(entry.problems, 2);
  assert.equal(entry.target.locale, 'en');
  assert.ok(!JSON.stringify(response.body).includes(ORIGIN), 'no URLs in the widget');
  response = await call('GET', '/magic-editor-x/widgets/broken-links?pageSize=20', {
    token: await tokenFor('outsider'),
  });
  assert.equal(response.status, 200);
  assert.ok(!response.body.data.some((item) => item.target.documentId === article.documentId));
  assert.equal(
    (await call('GET', '/magic-editor-x/widgets/broken-links', { token: await tokenFor('author') })).status,
    403
  );
  assert.equal((await call('GET', '/magic-editor-x/widgets/broken-links', {})).status, 401);
});

test('presence: the per-admin limit is shared and answers 429', async () => {
  const writer = await tokenFor('writer');
  const statuses = [];
  // Fixed one-minute windows: at most 30 per window, so 429 comes within 61 calls.
  for (let i = 0; i < 61 && !statuses.includes(429); i += 1)
    statuses.push((await presence(writer, 'writer', target)).status);
  assert.ok(statuses.includes(429), statuses.join(','));
  assert.ok(statuses.every((status) => status === 200 || status === 429));
});

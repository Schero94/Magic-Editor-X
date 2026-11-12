import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, openSession, connect } from './helpers.mjs';
import { applyEditorDataToDoc } from '../../shared/ydoc.mjs';

/**
 * 2.2 features against a real host: field presets on save, over the live
 * channel and for AI; named versions; the link check; the publish guard.
 *
 * Host fields (see CONTRIBUTING.md): `summary` has
 * `{ preset: 'basic', requireAlt: true, maxCharacters: 400, linkTargets: 'internal', disableAi: true, disableCollaboration: true, publishGuard: true }`,
 * `teaser` has `{ preset: 'minimal' }`.
 */

const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const ARTICLE = 'api::article.article';
const cm = (path) => `/content-manager/collection-types/${ARTICLE}${path}`;
const save = (token, documentId, data) =>
  call('PUT', cm(`/${documentId}?plugins[i18n][locale]=en`), { token, body: data });
const send = (client, update) =>
  new Promise((resolve) =>
    client.socket
      .timeout(5000)
      .emit('mx:update', update, (error, reply) => resolve(error ? { timeout: true } : reply))
  );

test('field presets are enforced on save with rule codes and no content', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Preset' });
  const cases = [
    [doc([{ id: 'r1', type: 'raw', data: { html: '<b>secret words</b>' } }]), 'BLOCK_NOT_ALLOWED'],
    [doc([{ id: 'h1', type: 'header', data: { text: 'Big', level: 1 } }]), 'HEADING_LEVEL'],
    [
      doc([{ id: 'i1', type: 'image', data: { file: { url: 'https://cdn.example.test/a.png' } } }]),
      'ALT_REQUIRED',
    ],
    [doc([p('l1', 'See <a href="https://www.example.test">this</a>')]), 'LINK_NOT_ALLOWED'],
    [doc([p('c1', 'x'.repeat(401))]), 'TOO_MANY_CHARACTERS'],
  ];
  for (const [summary, code] of cases) {
    const response = await save(editor, article.documentId, { title: 'Preset', summary });
    assert.equal(response.status, 400, code);
    assert.equal(response.body.error.details.code, 'PRESET_VIOLATION', code);
    assert.equal(response.body.error.details.violations[0].code, code);
    assert.equal(response.body.error.details.violations[0].field, 'summary');
    assert.doesNotMatch(JSON.stringify(response.body), /secret words/);
  }
  const ok = await save(editor, article.documentId, {
    title: 'Preset',
    summary: doc([
      { id: 'h2', type: 'header', data: { text: 'Fine', level: 2 } },
      p('m1', '<mark class="cdx-marker">marked</mark> <b>bold</b>'),
      {
        id: 'i2',
        type: 'image',
        data: { file: { url: 'https://cdn.example.test/a.png' }, decorative: true },
      },
      {
        id: 'i3',
        type: 'image',
        data: { file: { url: 'https://cdn.example.test/b.png', alt: 'A red bike' } },
      },
      p(
        'n1',
        '<a href="/articles/x" data-mex-uid="api::article.article" data-mex-document-id="abc123" data-mex-locale="en">entry</a>'
      ),
    ]),
    // A field without options keeps everything.
    body: doc([{ id: 'r2', type: 'raw', data: { html: '<b>raw</b>' } }]),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  const blocks = ok.body.data.summary.blocks;
  // The basic preset has no marker: its formatting is unwrapped, the text stays.
  assert.equal(blocks[1].data.text, 'marked <b>bold</b>');
  assert.equal(blocks[2].data.decorative, true);
  assert.equal(blocks[3].data.file.alt, 'A red bike');
  assert.equal(ok.body.data.body.blocks[0].type, 'raw');
});

test('the AI assistant and live collaboration can be turned off per field', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Off' });
  const ai = await call('POST', '/magic-editor-x/ai/improve', {
    token: editor,
    body: { text: 'x', target: { uid: ARTICLE, field: 'summary' } },
  });
  // Strapi answers 403 errors with a generic body; the admin never offers AI for such a field.
  assert.equal(ai.status, 403);
  const noTarget = await call('POST', '/magic-editor-x/ai/improve', { token: editor, body: { text: 'x' } });
  assert.equal(noTarget.status, 400);
  const unknown = await call('POST', '/magic-editor-x/ai/improve', {
    token: editor,
    body: { text: 'x', target: { uid: ARTICLE, field: 'title' } },
  });
  assert.equal(unknown.status, 404);
  const session = await call('POST', '/magic-editor-x/collaboration/session', {
    token: editor,
    body: { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'summary' },
  });
  assert.equal(session.status, 403);
});

test('the realtime server refuses new blocks a preset does not allow', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Live preset', teaser: doc([p('t1', 'hello')]) });
  const target = { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'teaser' };
  const client = await connect(await openSession(editor, target));
  const edit = (blocks) => {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(client.ydoc));
    const before = Y.encodeStateVector(scratch);
    applyEditorDataToDoc(scratch, doc(blocks));
    return Y.encodeStateAsUpdate(scratch, before);
  };
  const refused = await send(
    client,
    edit([p('t1', 'hello'), { id: 'h1', type: 'header', data: { text: 'H', level: 2 } }])
  );
  assert.deepEqual(refused, { ok: false, code: 'INVALID_UPDATE' });
  client.socket.disconnect();
  const again = await connect(await openSession(editor, target));
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, Y.encodeStateAsUpdate(again.ydoc));
  const before = Y.encodeStateVector(scratch);
  applyEditorDataToDoc(scratch, doc([p('t1', 'hello there'), p('t2', 'more')]));
  const accepted = await send(again, Y.encodeStateAsUpdate(scratch, before));
  assert.equal(accepted.ok, true);
  again.socket.disconnect();
});

test('named versions: label on save, rename, list; viewers cannot rename', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const article = await createArticle(editor, { title: 'Named', body: doc([p('v1', 'one')]) });
  const target = { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'body' };
  const created = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target, content: doc([p('v1', 'one')]), label: 'First draft' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.label, 'First draft');
  const same = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target, content: doc([p('v1', 'one')]), label: 'Reviewed' },
  });
  assert.equal(same.status, 200);
  assert.equal(same.body.meta.created, false);
  const id = created.body.data.id;
  const renamed = await call('PUT', `/magic-editor-x/history/${id}`, {
    token: editor,
    body: { label: 'Final' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.label, 'Final');
  const list = await call('GET', `/magic-editor-x/history?${new URLSearchParams(target)}`, { token: editor });
  assert.equal(list.body.data[0].label, 'Final');
  const denied = await call('PUT', `/magic-editor-x/history/${id}`, {
    token: reviewer,
    body: { label: 'x' },
  });
  assert.equal(denied.status, 403);
  const invalid = await call('PUT', `/magic-editor-x/history/${id}`, {
    token: editor,
    body: { label: 'x', extra: true },
  });
  assert.equal(invalid.status, 400);
});

test('link check: readable entries, missing ones, no information for unreadable types', async () => {
  const editor = await tokenFor('editor');
  const author = await tokenFor('author');
  const article = await createArticle(editor, { title: 'Target' });
  const body = {
    internal: [
      { uid: ARTICLE, documentId: article.documentId, locale: 'en' },
      { uid: ARTICLE, documentId: 'doesnotexist00000000000', locale: 'en' },
      { uid: 'api::secret.secret', documentId: 'abc' },
    ],
    external: ['https://www.example.test/'],
  };
  const response = await call('POST', '/magic-editor-x/quality/links', { token: editor, body });
  assert.equal(response.status, 200);
  const statuses = response.body.data.internal.map((item) => item.status);
  assert.equal(statuses[0], 'draft');
  assert.ok(['missing', 'unknown'].includes(statuses[1]));
  assert.equal(statuses[2], 'unknown');
  assert.equal(response.body.data.external[0].status, 'skipped');
  const forbidden = await call('POST', '/magic-editor-x/quality/links', { token: author, body });
  assert.equal(forbidden.status, 403);
  const tooMany = await call('POST', '/magic-editor-x/quality/links', {
    token: editor,
    body: { external: Array.from({ length: 21 }, (_, i) => `https://www.example.test/${i}`) },
  });
  assert.equal(tooMany.status, 400);
});

test('publish guard: errors block publishing, warnings do not', async () => {
  // Publishing needs the publish action on every field: the Super Admin publishes.
  const editor = await tokenFor('admin');
  const article = await createArticle(editor, {
    title: 'Guarded',
    summary: doc([
      p(
        'g1',
        'Read <a href="/articles/x" data-mex-uid="api::article.article" data-mex-document-id="abc123"></a>'
      ),
    ]),
  });
  const blocked = await call('POST', cm(`/${article.documentId}/actions/publish?plugins[i18n][locale]=en`), {
    token: editor,
    body: {},
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.details.code, 'QUALITY_GATE');
  assert.equal(blocked.body.error.details.issues[0].rule, 'empty-link');
  const fixed = await save(editor, article.documentId, {
    title: 'Guarded',
    summary: doc([
      p(
        'g1',
        'Read <a href="/articles/x" data-mex-uid="api::article.article" data-mex-document-id="abc123">here</a>'
      ),
    ]),
  });
  assert.equal(fixed.status, 200);
  const published = await call(
    'POST',
    cm(`/${article.documentId}/actions/publish?plugins[i18n][locale]=en`),
    {
      token: editor,
      body: {},
    }
  );
  assert.equal(published.status, 200, JSON.stringify(published.body).slice(0, 300));
});

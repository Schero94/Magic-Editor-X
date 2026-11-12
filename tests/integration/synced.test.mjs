/**
 * Synced blocks (2.3) against a real host: managers create, change and
 * delete sources (`kind: 'synced'` templates); editors store only a
 * reference; Content API `?mex=` expands it for the containing field with the
 * caller's permissions; editing the source changes the output of every
 * entry; deleting it leaves nothing; authors without plugin access get 403.
 *
 * Roles (CONTRIBUTING.md): `admin` (Super Admin, templates.manage), `editor`
 * (Editor role + access, no templates.manage), `author` (no plugin action).
 * Host: article `body` full preset, `summary` basic preset, a category type
 * with Draft & Publish, `links.urlPattern` `/{locale}/{collection}/{slug}`.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ARTICLE = 'api::article.article';
const CATEGORY = 'api::category.category';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const SHARED_V1 = `Shared footer one ${RUN}`;
const SHARED_V2 = `Shared footer two ${RUN}`;
const CATEGORY_SLUG = `synced-cat-${RUN}`;
const state = { sources: [], tokens: {} };

const publish = async (uid, documentId) => {
  const response = await call(
    'POST',
    `/content-manager/collection-types/${uid}/${documentId}/actions/publish`,
    { token: await tokenFor('admin'), body: {} }
  );
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
};

const apiToken = async (name, type, permissions) => {
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: {
      name: `mex-synced-${name}-${RUN}`,
      type,
      lifespan: null,
      description: 'integration',
      ...(permissions ? { permissions } : {}),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  return { key: response.body.data.accessKey, id: response.body.data.id };
};

const sourceBody = (text, extra = []) => ({
  name: `Footer ${RUN}`,
  description: 'Shared footer',
  kind: 'synced',
  blocks: doc([
    { id: 'h', type: 'header', data: { text: 'Shared title', level: 1 } },
    p('s', text),
    { id: 't', type: 'table', data: { withHeadings: false, content: [[`cell ${RUN}`]] } },
    ...extra,
  ]),
  scope: { all: true },
});

const output = async (documentId, format, token) =>
  call('GET', `/api/articles/${documentId}?mex=${format}`, { token });

before(async () => {
  const admin = await tokenFor('admin');
  // A published category that a token without category access cannot read.
  const category = await call('POST', `/content-manager/collection-types/${CATEGORY}`, {
    token: admin,
    body: { name: `Synced cat ${RUN}`, slug: CATEGORY_SLUG },
  });
  assert.equal(category.status, 201, JSON.stringify(category.body).slice(0, 300));
  state.category = category.body.data.documentId;
  await publish(CATEGORY, state.category);
  state.tokens.readOnly = await apiToken('ro', 'read-only');
  state.tokens.articlesOnly = await apiToken('articles', 'custom', [`${ARTICLE}.find`, `${ARTICLE}.findOne`]);
});

after(async () => {
  const admin = await tokenFor('admin');
  for (const id of state.sources)
    await call('DELETE', `/magic-editor-x/templates/${id}`, { token: admin }).catch(() => {});
  for (const token of Object.values(state.tokens))
    await call('DELETE', `/admin/api-tokens/${token.id}`, { token: admin }).catch(() => {});
});

test('managers create and update sources; nesting and kind changes are refused; others get 403', async () => {
  const admin = await tokenFor('admin');
  const mention = `<a href="/x" data-mex-uid="${CATEGORY}" data-mex-document-id="${state.category}" data-mex-locale="en" data-mex-mention="true">Cat mention ${RUN}</a>`;
  const created = await call('POST', '/magic-editor-x/templates', {
    token: admin,
    body: sourceBody(`${SHARED_V1} ${mention}`),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.kind, 'synced');
  state.source = created.body.data.id;
  state.sources.push(state.source);

  const nested = await call('POST', '/magic-editor-x/templates', {
    token: admin,
    body: sourceBody('x', [{ id: 'n', type: 'synced', data: { ref: state.source } }]),
  });
  assert.equal(nested.status, 400);
  assert.match(JSON.stringify(nested.body.error.details), /cannot contain another synced block/);

  const kind = await call('PUT', `/magic-editor-x/templates/${state.source}`, {
    token: admin,
    body: { ...sourceBody(SHARED_V1), kind: 'pattern' },
  });
  assert.equal(kind.status, 400);
  assert.match(JSON.stringify(kind.body.error.details), /cannot be changed/);

  const editor = await tokenFor('editor');
  const denied = await call('POST', '/magic-editor-x/templates', { token: editor, body: sourceBody('x') });
  assert.equal(denied.status, 403);
  assert.equal(
    (await call('GET', `/magic-editor-x/templates/${state.source}/usage`, { token: editor })).status,
    403
  );
  // Editors read the source (the editor view shows it).
  const read = await call('GET', `/magic-editor-x/templates/${state.source}`, { token: editor });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.kind, 'synced');

  const author = await tokenFor('author');
  for (const [method, path] of [
    ['GET', `/magic-editor-x/templates/${state.source}`],
    ['GET', `/magic-editor-x/templates/${state.source}/usage`],
    ['POST', '/magic-editor-x/templates'],
    ['DELETE', `/magic-editor-x/templates/${state.source}`],
  ]) {
    const response = await call(method, path, {
      token: author,
      body: method === 'POST' ? sourceBody('x') : undefined,
    });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
});

test('editors are offered the source in full fields only and store just the reference', async () => {
  const editor = await tokenFor('editor');
  const list = async (field) =>
    (
      await call('GET', `/magic-editor-x/templates?uid=${ARTICLE}&field=${field}`, { token: editor })
    ).body.data.filter((item) => item.id === state.source);
  assert.equal((await list('body')).length, 1);
  assert.equal((await list('summary')).length, 0);

  const reference = { id: 'ref1', type: 'synced', data: { ref: state.source, blocks: [p('x', 'copied')] } };
  const a = await createArticle(editor, {
    title: `Synced A ${RUN}`,
    slug: `synced-a-${RUN}`,
    body: doc([p('a', `Intro A ${RUN}`), reference]),
  });
  const b = await createArticle(editor, {
    title: `Synced B ${RUN}`,
    slug: `synced-b-${RUN}`,
    body: doc([{ id: 'ref2', type: 'synced', data: { ref: state.source } }]),
  });
  state.a = a.documentId;
  state.b = b.documentId;
  // Stored: the reference only, extra keys dropped.
  assert.deepEqual(a.body.blocks[1].data, { ref: state.source });

  // A basic field does not allow synced blocks: the save is refused.
  const refused = await call('POST', `/content-manager/collection-types/${ARTICLE}`, {
    token: editor,
    body: { title: `Synced C ${RUN}`, slug: `synced-c-${RUN}`, summary: doc([reference]) },
  });
  assert.equal(refused.status, 400);
  assert.match(JSON.stringify(refused.body), /PRESET_VIOLATION/);
  assert.match(JSON.stringify(refused.body), /BLOCK_NOT_ALLOWED/);

  await publish(ARTICLE, state.a);
  await publish(ARTICLE, state.b);
});

test('?mex= expands the reference in both entries; without it the stored reference is returned', async () => {
  const token = state.tokens.readOnly.key;
  for (const id of [state.a, state.b]) {
    const html = await output(id, 'html', token);
    assert.equal(html.status, 200, JSON.stringify(html.body).slice(0, 300));
    assert.match(html.body.data.body, new RegExp(SHARED_V1));
    assert.match(html.body.data.body, /<h1[^>]*>Shared title<\/h1>/);
    assert.match(html.body.data.body, new RegExp(`cell ${RUN}`));
  }
  const json = await output(state.a, 'json', token);
  const copies = json.body.data.body.blocks.filter((block) => block.syncedFrom === state.source);
  assert.equal(copies.length, 3);
  assert.ok(copies.every((block) => block.id.startsWith('ref1-')));
  assert.ok(!json.body.data.body.blocks.some((block) => block.type === 'synced'));

  const plain = await call('GET', `/api/articles/${state.a}`, { token });
  assert.deepEqual(plain.body.data.body.blocks[1], {
    id: 'ref1',
    type: 'synced',
    data: { ref: state.source },
  });

  const text = await output(state.b, 'text', token);
  assert.match(text.body.data.body, new RegExp(SHARED_V1));
  const markdown = await output(state.b, 'markdown', token);
  assert.match(markdown.body.data.body, /# Shared title/);
});

test('mentions inside a source resolve with the caller: no category access, plain text', async () => {
  const full = await output(state.a, 'html', state.tokens.readOnly.key);
  assert.match(full.body.data.body, new RegExp(`href="/categories/${CATEGORY_SLUG}"`));
  const limited = await output(state.a, 'html', state.tokens.articlesOnly.key);
  assert.equal(limited.status, 200);
  assert.match(limited.body.data.body, new RegExp(SHARED_V1));
  assert.match(limited.body.data.body, new RegExp(`Cat mention ${RUN}`));
  assert.doesNotMatch(limited.body.data.body, new RegExp(CATEGORY_SLUG));
  assert.doesNotMatch(limited.body.data.body, new RegExp(state.category));
});

test('editing the source changes the output of every entry that uses it', async () => {
  const admin = await tokenFor('admin');
  const updated = await call('PUT', `/magic-editor-x/templates/${state.source}`, {
    token: admin,
    body: sourceBody(SHARED_V2),
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  for (const id of [state.a, state.b]) {
    const html = await output(id, 'html', state.tokens.readOnly.key);
    assert.match(html.body.data.body, new RegExp(SHARED_V2));
    assert.doesNotMatch(html.body.data.body, new RegExp(SHARED_V1));
  }
  // A disabled source is no longer offered but still rendered.
  const disabled = await call('PUT', `/magic-editor-x/templates/${state.source}`, {
    token: admin,
    body: { ...sourceBody(SHARED_V2), enabled: false },
  });
  assert.equal(disabled.status, 200);
  const editor = await tokenFor('editor');
  assert.equal(
    (await call('GET', `/magic-editor-x/templates/${state.source}`, { token: editor })).status,
    200
  );
  const offered = await call('GET', `/magic-editor-x/templates?uid=${ARTICLE}&field=body`, { token: editor });
  assert.ok(!offered.body.data.some((item) => item.id === state.source));
  assert.match(
    (await output(state.a, 'html', state.tokens.readOnly.key)).body.data.body,
    new RegExp(SHARED_V2)
  );
});

test('usage counts the referencing entries; deleting the source leaves nothing', async () => {
  const admin = await tokenFor('admin');
  const usage = await call('GET', `/magic-editor-x/templates/${state.source}/usage`, { token: admin });
  assert.equal(usage.status, 200);
  // Entries A and B, each as draft and published field value.
  assert.deepEqual(usage.body.data, { entries: 2, fields: 4, templates: 0, complete: true });

  const removed = await call('DELETE', `/magic-editor-x/templates/${state.source}`, { token: admin });
  assert.equal(removed.status, 200);
  const html = await output(state.a, 'html', state.tokens.readOnly.key);
  assert.equal(html.status, 200);
  assert.match(html.body.data.body, new RegExp(`Intro A ${RUN}`));
  assert.doesNotMatch(html.body.data.body, /Shared title|Shared footer/);
  const onlyRef = await output(state.b, 'text', state.tokens.readOnly.key);
  assert.equal(onlyRef.body.data.body, '');
  const editor = await tokenFor('editor');
  assert.equal(
    (await call('GET', `/magic-editor-x/templates/${state.source}`, { token: editor })).status,
    404
  );
  assert.equal(
    (await call('GET', `/magic-editor-x/templates/${state.source}/usage`, { token: admin })).status,
    404
  );
});

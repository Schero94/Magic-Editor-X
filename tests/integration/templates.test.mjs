import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

/**
 * Templates and block patterns (2.3) against a real host. Roles (see
 * CONTRIBUTING.md): `admin` (Super Admin, has templates.manage), `editor`
 * (Editor role + access, no templates.manage), `reader` (reads articles,
 * access only), `author` (no plugin action). Field presets of the host:
 * article `body` full, `summary` basic, `teaser` minimal, `sections.body`
 * full; homepage `intro` full (the reader cannot read the homepage).
 */

const ARTICLE = 'api::article.article';
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const created = [];

/**
 * Creates a template as the Super Admin.
 * @param {object} overrides - Definition fields.
 * @returns {Promise<object>} Template DTO.
 */
const createTemplate = async (overrides = {}) => {
  const admin = await tokenFor('admin');
  const response = await call('POST', '/magic-editor-x/templates', {
    token: admin,
    body: {
      name: `Tpl ${run}`,
      kind: 'pattern',
      blocks: doc([p('a', 'Pattern text')]),
      scope: { all: true },
      ...overrides,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  created.push(response.body.data.id);
  return response.body.data;
};

const listFor = (token, uid, field) =>
  call('GET', `/magic-editor-x/templates?uid=${encodeURIComponent(uid)}&field=${encodeURIComponent(field)}`, {
    token,
  });
const mine = (response) =>
  response.body.data.filter((item) => item.name.endsWith(run)).map((item) => item.name);

test('a manager creates, updates, duplicates, reorders and deletes templates', async () => {
  const admin = await tokenFor('admin');
  const a = await createTemplate({ name: `Launch ${run}`, kind: 'template', description: 'Hero and FAQ' });
  assert.equal(a.kind, 'template');
  assert.equal(a.blockCount, 1);
  assert.ok(a.createdBy && typeof a.createdBy.name === 'string');
  assert.doesNotMatch(JSON.stringify(a), /example\.test/);

  const updated = await call('PUT', `/magic-editor-x/templates/${a.id}`, {
    token: admin,
    body: {
      name: `Launch v2 ${run}`,
      kind: 'template',
      blocks: doc([p('a', 'One'), { id: 'h', type: 'header', data: { text: 'Two', level: 2 } }]),
      scope: { all: false, presets: ['basic'], fields: [{ uid: ARTICLE, field: 'sections.body' }] },
      enabled: true,
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.blockCount, 2);
  assert.deepEqual(updated.body.data.scope, {
    all: false,
    presets: ['basic'],
    fields: [{ uid: ARTICLE, field: 'sections.body' }],
  });

  const got = await call('GET', `/magic-editor-x/templates/${a.id}`, { token: admin });
  assert.equal(got.status, 200);
  assert.equal(got.body.data.name, `Launch v2 ${run}`);

  const copy = await call('POST', `/magic-editor-x/templates/${a.id}/duplicate`, { token: admin, body: {} });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.data.enabled, false);
  created.push(copy.body.data.id);

  const all = await call('GET', '/magic-editor-x/templates?all=true', { token: admin });
  assert.equal(all.status, 200);
  const ids = all.body.data.map((item) => item.id);
  const reordered = [copy.body.data.id, ...ids.filter((id) => id !== copy.body.data.id)];
  const order = await call('PUT', '/magic-editor-x/templates/order', {
    token: admin,
    body: { ids: reordered },
  });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  assert.equal(order.body.data[0].id, copy.body.data.id);
  const partial = await call('PUT', '/magic-editor-x/templates/order', {
    token: admin,
    body: { ids: [a.id] },
  });
  assert.equal(partial.status, 400);

  const targets = await call('GET', '/magic-editor-x/templates/targets', { token: admin });
  assert.equal(targets.status, 200);
  const fields = targets.body.data
    .filter((item) => item.uid === ARTICLE)
    .map((item) => `${item.field}:${item.preset}`);
  for (const expected of ['body:full', 'summary:basic', 'teaser:minimal', 'sections.body:full'])
    assert.ok(fields.includes(expected), expected);

  const removed = await call('DELETE', `/magic-editor-x/templates/${copy.body.data.id}`, { token: admin });
  assert.equal(removed.status, 200);
  const again = await call('DELETE', `/magic-editor-x/templates/${copy.body.data.id}`, { token: admin });
  assert.equal(again.status, 404);
  assert.equal((await call('GET', '/magic-editor-x/templates/zzzz', { token: admin })).status, 404);
  assert.equal((await call('DELETE', `/magic-editor-x/templates/${a.id}`, { token: admin })).status, 200);
});

test('the editor list is filtered by scope and preset; disabled templates stay hidden', async () => {
  const editor = await tokenFor('editor');
  await createTemplate({ name: `Everywhere ${run}` });
  await createTemplate({ name: `Basic ${run}`, scope: { all: false, presets: ['basic'] } });
  await createTemplate({
    name: `Sections ${run}`,
    scope: { all: false, fields: [{ uid: ARTICLE, field: 'sections.body' }] },
  });
  const hidden = await createTemplate({ name: `Hidden ${run}`, enabled: false });

  const body = await listFor(editor, ARTICLE, 'body');
  assert.equal(body.status, 200, JSON.stringify(body.body));
  assert.deepEqual(mine(body).sort(), [`Everywhere ${run}`].sort());
  assert.deepEqual(
    mine(await listFor(editor, ARTICLE, 'summary')).sort(),
    [`Basic ${run}`, `Everywhere ${run}`].sort()
  );
  assert.deepEqual(
    mine(await listFor(editor, ARTICLE, 'sections.0.body')).sort(),
    [`Everywhere ${run}`, `Sections ${run}`].sort()
  );
  const item = body.body.data.find((entry) => entry.name === `Everywhere ${run}`);
  assert.equal(item.blocks.blocks[0].data.text, 'Pattern text');

  assert.equal((await listFor(editor, ARTICLE, 'title')).status, 404);
  assert.equal((await listFor(editor, 'api::nope.nope', 'body')).status, 404);
  assert.equal((await call('GET', `/magic-editor-x/templates/${hidden.id}`, { token: editor })).status, 404);
  assert.equal((await call('GET', '/magic-editor-x/templates?uid=x', { token: editor })).status, 400);

  // The reader can read articles but not the homepage: the homepage list answers 404.
  const reader = await tokenFor('reader');
  assert.equal((await listFor(reader, ARTICLE, 'body')).status, 200);
  assert.equal((await listFor(reader, 'api::homepage.homepage', 'intro')).status, 404);
});

test('roles: no plugin access is 403, editing templates needs templates.manage', async () => {
  const author = await tokenFor('author');
  const editor = await tokenFor('editor');
  assert.equal((await listFor(author, ARTICLE, 'body')).status, 403);
  assert.equal((await call('GET', '/magic-editor-x/templates?all=true', { token: author })).status, 403);
  assert.equal((await call('GET', '/magic-editor-x/templates?all=true', { token: editor })).status, 403);
  assert.equal((await call('GET', '/magic-editor-x/templates/targets', { token: editor })).status, 403);
  const body = { name: 'Nope', kind: 'pattern', blocks: doc([p('a', 'x')]), scope: { all: true } };
  assert.equal((await call('POST', '/magic-editor-x/templates', { token: editor, body })).status, 403);
  assert.equal((await call('POST', '/magic-editor-x/templates', { token: author, body })).status, 403);
  const target = await createTemplate({ name: `Locked ${run}` });
  assert.equal(
    (await call('PUT', `/magic-editor-x/templates/${target.id}`, { token: editor, body })).status,
    403
  );
  assert.equal(
    (await call('DELETE', `/magic-editor-x/templates/${target.id}`, { token: editor })).status,
    403
  );
  assert.equal(
    (await call('POST', `/magic-editor-x/templates/${target.id}/duplicate`, { token: editor, body: {} }))
      .status,
    403
  );
  assert.equal((await call('GET', '/magic-editor-x/templates?all=true')).status, 401);
});

test('stored template blocks are sanitised and XSS payloads stay inert', async () => {
  const admin = await tokenFor('admin');
  const template = await createTemplate({
    name: `XSS ${run}`,
    blocks: doc([
      p('x1', 'Hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a>'),
      {
        id: 'x2',
        type: 'raw',
        data: {
          html: '<p onclick="steal()">raw</p><script>bad()</script><iframe src="https://evil.example.test"></iframe>',
        },
      },
      { id: 'x3', type: 'header', data: { text: '<svg onload=alert(1)>T', level: 2 } },
      { id: 'x4', type: 'linkTool', data: { link: 'javascript:alert(1)', meta: {} } },
    ]),
  });
  const stored = await call('GET', `/magic-editor-x/templates/${template.id}`, { token: admin });
  const text = JSON.stringify(stored.body.data.blocks);
  assert.doesNotMatch(text, /<script|onerror|onclick|onload|javascript:|<iframe|<svg/i);
  assert.match(text, /Hi/);

  const reject = async (body, field) => {
    const response = await call('POST', '/magic-editor-x/templates', {
      token: admin,
      body: {
        name: `Bad ${run}`,
        kind: 'pattern',
        blocks: doc([p('a', 'x')]),
        scope: { all: true },
        ...body,
      },
    });
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(response.body.error.name, 'ValidationError');
    if (field)
      assert.ok(
        Object.keys(response.body.error.details.fieldErrors).some((key) => key.startsWith(field)),
        field
      );
    assert.doesNotMatch(JSON.stringify(response.body), /x{100}/);
  };
  await reject({ blocks: doc([]) }, 'blocks');
  await reject({ blocks: doc([p('a', 'x'.repeat(300 * 1024))]) }, 'blocks');
  await reject({ blocks: doc(Array.from({ length: 201 }, (_, i) => p(`b${i}`, 'x'))) }, 'blocks');
  await reject({ blocks: 'not editor content' }, 'blocks');
  await reject({ scope: { all: false, fields: [{ uid: ARTICLE, field: 'title' }] } }, 'scope');
  await reject({ createdByName: 'Mallory' });
  await reject({ name: 'x'.repeat(101) }, 'name');
});

test('template content saved into a field is checked against that field preset by the server', async () => {
  const editor = await tokenFor('editor');
  const template = await createTemplate({
    name: `Into field ${run}`,
    blocks: doc([
      p('a', 'From template'),
      { id: 't', type: 'table', data: { withHeadings: false, content: [['x']] } },
    ]),
  });
  // The editor leaves the table out for the basic `summary` field; a client that does not is refused.
  const refused = await call('POST', `/content-manager/collection-types/${ARTICLE}`, {
    token: editor,
    body: { title: `Template refused ${run}`, summary: template.blocks },
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.details.code, 'PRESET_VIOLATION');
  const ok = await createArticle(editor, { title: `Template ok ${run}`, body: template.blocks });
  assert.equal(ok.body.blocks[1].type, 'table');
});

test('cleanup', async () => {
  const admin = await tokenFor('admin');
  for (const id of created) await call('DELETE', `/magic-editor-x/templates/${id}`, { token: admin });
});

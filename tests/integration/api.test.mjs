import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io } from 'socket.io-client';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, makePng, HOST } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

const RUN = Date.now()
  .toString(36)
  .replace(/[^a-z0-9]/g, '');
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });

test('anonymous calls are rejected on every admin route', async () => {
  for (const [method, path] of [
    ['GET', '/magic-editor-x/config'],
    ['GET', '/magic-editor-x/custom-blocks'],
    ['POST', '/magic-editor-x/collaboration/session'],
    ['GET', '/magic-editor-x/settings'],
    ['POST', '/magic-editor-x/ai/improve'],
    ['GET', '/magic-editor-x/history?uid=api::article.article&documentId=x&field=body'],
  ]) {
    const response = await call(method, path, { body: method === 'POST' ? {} : undefined });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('license and 1.x routes are gone', async () => {
  const admin = await tokenFor('admin');
  for (const path of [
    '/magic-editor-x/license/status',
    '/magic-editor-x/custom-blocks/limits',
    '/magic-editor-x/collaboration/permissions',
  ]) {
    const response = await call('GET', path, { token: admin });
    assert.ok(
      [404, 405].includes(response.status) || (response.status === 400 && path.includes('custom-blocks')),
      `${path} -> ${response.status}`
    );
  }
});

test('config reports capabilities per role without secrets', async () => {
  const admin = await call('GET', '/magic-editor-x/config', { token: await tokenFor('admin') });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.permissions.settingsRead, true);
  assert.equal(admin.body.data.collaboration.enabled, true);
  const reviewer = await call('GET', '/magic-editor-x/config', { token: await tokenFor('reviewer') });
  assert.equal(reviewer.status, 200);
  assert.equal(reviewer.body.data.permissions.upload, false);
  assert.equal(reviewer.body.data.permissions.ai, false);
  assert.doesNotMatch(JSON.stringify(admin.body), /apiKey"|encrypt/i);
  const author = await call('GET', '/magic-editor-x/config', { token: await tokenFor('author') });
  assert.equal(author.status, 403, 'author role has no plugin access');
});

test('content is normalised and sanitised on every write and returned as an object', async () => {
  const editor = await tokenFor('editor');
  const created = await createArticle(editor, {
    title: 'Sanitize',
    body: JSON.stringify(
      doc([
        p(
          's1',
          'Hi <script>alert(1)</script><b>bold</b> <a href="javascript:alert(1)">x</a> <img src=x onerror=alert(1)>'
        ),
        {
          id: 's2',
          type: 'raw',
          data: { html: '<iframe src="https://example.test"></iframe><p onclick="x()">ok</p>' },
        },
        {
          id: 's3',
          type: 'embed',
          data: { service: 'youtube', embed: 'javascript:alert(1)', source: 'https://example.test' },
        },
      ])
    ),
  });
  const body = created.body;
  assert.equal(typeof body, 'object', 'stored as an object');
  assert.equal(body.blocks[0].data.text, 'Hi <b>bold</b> <a>x</a> ');
  assert.equal(body.blocks[1].data.html, '<p>ok</p>');
  assert.equal(body.blocks[2].data.embed, '');
  const rejected = await call('POST', '/content-manager/collection-types/api::article.article', {
    token: editor,
    body: {
      title: 'Too deep',
      body: { blocks: [{ type: 'paragraph', data: JSON.parse('{"a":'.repeat(40) + '1' + '}'.repeat(40)) }] },
    },
  });
  assert.equal(rejected.status, 400);
});

test('custom blocks: validation, CRUD, duplicate, order, export and import', async () => {
  const admin = await tokenFor('admin');
  const reserved = await call('POST', '/magic-editor-x/custom-blocks', {
    token: admin,
    body: { name: 'paragraph', label: 'X', blockType: 'simple' },
  });
  assert.equal(reserved.status, 400);
  assert.ok(reserved.body.error.details.fieldErrors.name);
  const extra = await call('POST', '/magic-editor-x/custom-blocks', {
    token: admin,
    body: { name: `promo${RUN}`, label: 'Promo', blockType: 'simple', createdByUser: 1 },
  });
  assert.equal(extra.status, 400, 'unknown keys are rejected');
  const created = await call('POST', '/magic-editor-x/custom-blocks', {
    token: admin,
    body: {
      name: `promo${RUN}`,
      label: 'Promo box',
      blockType: 'simple',
      icon: '<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M1 1h2" onload="x()"/></svg>',
      template:
        '<div class="promo"><h3 data-field="title">{{title}}</h3><img src="javascript:alert(1)" onerror="x()"></div>',
      fields: [{ name: 'title', label: 'Title', type: 'text', required: true }],
    },
  });
  assert.equal(created.status, 201);
  const block = created.body.data;
  assert.doesNotMatch(block.icon, /script|onload/);
  assert.match(block.icon, /viewBox/);
  assert.doesNotMatch(block.template, /javascript|onerror/);
  const dup = await call('POST', `/magic-editor-x/custom-blocks/${block.id}/duplicate`, { token: admin });
  assert.equal(dup.status, 201);
  assert.equal(dup.body.data.name, `promo${RUN}Copy`);
  const all = await call('GET', '/magic-editor-x/custom-blocks?all=true', { token: admin });
  const ids = all.body.data.map((item) => item.id);
  const reordered = await call('PUT', '/magic-editor-x/custom-blocks/order', {
    token: admin,
    body: { ids: [...ids].reverse() },
  });
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.data.map((item) => item.id),
    [...ids].reverse()
  );
  const disabled = await call('PUT', `/magic-editor-x/custom-blocks/${dup.body.data.id}`, {
    token: admin,
    body: {
      ...Object.fromEntries(Object.entries(dup.body.data).filter(([k]) => !['id', 'updatedAt'].includes(k))),
      enabled: false,
    },
  });
  assert.equal(disabled.status, 200);
  const enabledOnly = await call('GET', '/magic-editor-x/custom-blocks', { token: await tokenFor('editor') });
  assert.ok(!enabledOnly.body.data.some((item) => item.id === dup.body.data.id));
  const exported = await call('GET', '/magic-editor-x/custom-blocks/export', { token: admin });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.data.format, 'magic-editor-x/custom-blocks');
  const importResult = await call('POST', '/magic-editor-x/custom-blocks/import', {
    token: admin,
    body: {
      ...exported.body.data,
      blocks: [
        ...exported.body.data.blocks,
        {
          name: `imported${RUN}`,
          label: 'Imported',
          blockType: 'embedded-entry',
          contentType: 'api::article.article',
        },
        { name: 'bad name' },
      ],
    },
  });
  assert.equal(importResult.status, 200);
  assert.deepEqual(importResult.body.data.created, [`imported${RUN}`]);
  assert.equal(importResult.body.data.skipped.length, exported.body.data.blocks.length + 1);
  const editorDenied = await call('POST', '/magic-editor-x/custom-blocks', {
    token: await tokenFor('editor'),
    body: { name: 'x1', label: 'x', blockType: 'simple' },
  });
  assert.equal(editorDenied.status, 403);
  const removed = await call('DELETE', `/magic-editor-x/custom-blocks/${dup.body.data.id}`, { token: admin });
  assert.equal(removed.status, 200);
  const missing = await call('DELETE', `/magic-editor-x/custom-blocks/${dup.body.data.id}`, { token: admin });
  assert.equal(missing.status, 404);
});

test('version history follows Content Manager permissions and deduplicates', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'History', body: doc([p('h1', 'one')]) });
  const target = { uid: 'api::article.article', documentId: article.documentId, locale: 'en', field: 'body' };
  const first = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target, content: doc([p('h1', 'one')]) },
  });
  assert.equal(first.status, 201);
  const same = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target, content: doc([p('h1', 'one')]) },
  });
  assert.equal(same.status, 200);
  assert.equal(same.body.meta.created, false);
  const second = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target, content: doc([p('h1', 'two <script>x</script>')]) },
  });
  assert.equal(second.body.data.version, 2);
  const query = new URLSearchParams(target).toString();
  const list = await call('GET', `/magic-editor-x/history?${query}`, { token: editor });
  assert.deepEqual(
    list.body.data.map((item) => item.version),
    [2, 1]
  );
  const item = await call('GET', `/magic-editor-x/history/${second.body.data.id}`, { token: editor });
  assert.equal(item.body.data.content.blocks[0].data.text, 'two ');
  const reviewerList = await call('GET', `/magic-editor-x/history?${query}`, {
    token: await tokenFor('reviewer'),
  });
  assert.equal(reviewerList.status, 200);
  assert.equal(reviewerList.body.meta.canRestore, false);
  const reviewerCreate = await call('POST', '/magic-editor-x/history', {
    token: await tokenFor('reviewer'),
    body: { ...target, content: doc([]) },
  });
  assert.equal(reviewerCreate.status, 403);
  const otherField = await call(
    'GET',
    `/magic-editor-x/history?${new URLSearchParams({ ...target, field: 'title' })}`,
    { token: editor }
  );
  assert.equal(otherField.status, 404, 'only Magic Editor X fields');
  const unknownDoc = await call(
    'GET',
    `/magic-editor-x/history?${new URLSearchParams({ ...target, documentId: 'doesnotexist00000000000' })}`,
    { token: editor }
  );
  assert.equal(unknownDoc.status, 404);
});

test('collaboration: access per document, two editors converge, viewers cannot write, tokens are single-use', async () => {
  const editor = await tokenFor('editor');
  const admin = await tokenFor('admin');
  const article = await createArticle(editor, { title: 'Live', body: doc([p('l1', 'Hello world')]) });
  const target = { uid: 'api::article.article', documentId: article.documentId, locale: 'en', field: 'body' };
  const authorDenied = await call('POST', '/magic-editor-x/collaboration/session', {
    token: await tokenFor('author'),
    body: target,
  });
  assert.equal(authorDenied.status, 403, 'author has no collaborate action');
  const titleField = await call('POST', '/magic-editor-x/collaboration/session', {
    token: editor,
    body: { ...target, field: 'title' },
  });
  assert.equal(titleField.status, 404);

  const session = async (token, initialValue) => {
    const response = await call('POST', '/magic-editor-x/collaboration/session', {
      token,
      body: { ...target, initialValue },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.data;
  };
  const connect = (sessionData, options = {}) =>
    new Promise((resolve, reject) => {
      const ydoc = new Y.Doc();
      const socket = io(HOST, {
        path: sessionData.path,
        transports: ['websocket'],
        auth: { token: sessionData.token },
        reconnection: false,
        ...options,
      });
      const state = { ydoc, socket, welcome: null, errors: [] };
      socket.on('mx:error', (error) => state.errors.push(error.code));
      socket.on('mx:welcome', (welcome) => (state.welcome = welcome));
      socket.on('mx:sync', ({ update }) => {
        Y.applyUpdate(ydoc, new Uint8Array(update), 'remote');
        resolve(state);
      });
      socket.on('mx:update', (update) => Y.applyUpdate(ydoc, new Uint8Array(update), 'remote'));
      socket.on('disconnect', () => resolve(state));
      socket.on('connect_error', reject);
      setTimeout(() => resolve(state), 5000);
    });

  const a = await connect(await session(editor, doc([p('l1', 'Hello world')])));
  const b = await connect(await session(admin));
  assert.equal(docToEditorData(a.ydoc).blocks[0].data.text, 'Hello world');
  assert.equal(a.welcome.canEdit, true);
  const send = (client) => (update, origin) => {
    if (origin !== 'remote') client.socket.emit('mx:update', update, () => {});
  };
  a.ydoc.on('update', send(a));
  b.ydoc.on('update', send(b));
  applyEditorDataToDoc(a.ydoc, doc([p('l1', 'Hello brave world')]));
  applyEditorDataToDoc(b.ydoc, doc([p('l1', 'Hello world!'), p('l2', 'from B')]));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.deepEqual(docToEditorData(a.ydoc).blocks, docToEditorData(b.ydoc).blocks);
  assert.equal(docToEditorData(a.ydoc).blocks[0].data.text, 'Hello brave world!');

  const viewerSession = await session(await tokenFor('reviewer'));
  assert.equal(viewerSession.canEdit, false);
  const viewer = await connect(viewerSession);
  const ack = await new Promise((resolve) =>
    viewer.socket.emit('mx:update', Y.encodeStateAsUpdate(new Y.Doc()), resolve)
  );
  assert.deepEqual(ack, { ok: false, code: 'READ_ONLY' });
  assert.equal(docToEditorData(viewer.ydoc).blocks.length, 2);

  const replay = await connect({ ...viewerSession });
  assert.ok(replay.errors.includes('INVALID_TOKEN'), 'a token works once');
  const forged = await connect({ ...viewerSession, token: `${viewerSession.token.split('.')[0]}.AAAA` });
  assert.ok(forged.errors.includes('INVALID_TOKEN'));
  await assert.rejects(
    connect(await session(editor), { extraHeaders: { origin: 'https://evil.example' } }),
    'foreign browser origins are refused'
  );
  for (const client of [a, b, viewer, replay, forged]) client.socket.disconnect();
});

test('uploads check magic bytes and the SSRF guard blocks private URLs', async () => {
  const editor = await tokenFor('editor');
  const image = new FormData();
  image.append('image', new Blob([makePng(8)], { type: 'image/png' }), 'pixel.png');
  const ok = await call('POST', '/magic-editor-x/image/byFile', { token: editor, body: image });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.success, 1);
  assert.match(ok.body.file.url, /\.png$/);
  const fake = new FormData();
  fake.append('image', new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }), 'evil.png');
  const rejected = await call('POST', '/magic-editor-x/image/byFile', { token: editor, body: fake });
  assert.equal(rejected.status, 400);
  const pdf = new FormData();
  pdf.append('file', new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), 'doc.pdf');
  const attached = await call('POST', '/magic-editor-x/file/upload', { token: editor, body: pdf });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  const disguised = new FormData();
  disguised.append('file', new Blob(['MZ executable'], { type: 'application/pdf' }), 'doc.pdf');
  assert.equal(
    (await call('POST', '/magic-editor-x/file/upload', { token: editor, body: disguised })).status,
    400
  );
  const reviewerUpload = await call('POST', '/magic-editor-x/image/byFile', {
    token: await tokenFor('reviewer'),
    body: image,
  });
  assert.equal(reviewerUpload.status, 403);
  for (const url of [
    'http://127.0.0.1:1/x.png',
    'http://169.254.169.254/latest',
    'http://[::1]/x',
    'http://localhost/x',
    'javascript:alert(1)',
    'http://user:pw@example.test/x',
  ]) {
    const byUrl = await call('POST', '/magic-editor-x/image/byUrl', { token: editor, body: { url } });
    assert.equal(byUrl.status, 400, url);
    const link = await call('GET', `/magic-editor-x/link?url=${encodeURIComponent(url)}`, { token: editor });
    assert.equal(link.status, 400, url);
  }
});

test('AI assistant: owner provider, encrypted key never returned, permissions, rate limit', async () => {
  const requests = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const json = JSON.parse(body);
      requests.push({ path: req.url, headers: req.headers, json });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/messages') {
        res.end(
          JSON.stringify({
            content: [
              { type: 'thinking', thinking: '' },
              { type: 'text', text: 'Improved <b>text</b><script>x</script>' },
            ],
            stop_reason: 'end_turn',
          })
        );
      } else {
        res.end(
          JSON.stringify({ choices: [{ message: { content: '```\nSummary\n```' }, finish_reason: 'stop' }] })
        );
      }
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fake.address().port}`;
  const admin = await tokenFor('admin');
  try {
    const before = await call('POST', '/magic-editor-x/ai/improve', {
      token: await tokenFor('editor'),
      body: { text: 'Hello' },
    });
    assert.equal(before.status, 503);
    const saved = await call('PUT', '/magic-editor-x/settings', {
      token: admin,
      body: {
        ai: {
          enabled: true,
          provider: 'anthropic',
          baseUrl: base,
          model: 'claude-opus-5-5',
          maxInputChars: 2000,
          maxOutputTokens: 512,
          apiKey: 'sk-test-synthetic-key',
        },
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.ai.hasApiKey, true);
    assert.doesNotMatch(JSON.stringify(saved.body), /sk-test-synthetic-key|apiKeyEncrypted/);
    const read = await call('GET', '/magic-editor-x/settings', { token: admin });
    assert.doesNotMatch(JSON.stringify(read.body), /sk-test-synthetic-key|v1:/);
    const switched = await call('PUT', '/magic-editor-x/settings', {
      token: admin,
      body: {
        ai: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: base,
          model: 'local-model',
          maxInputChars: 2000,
          maxOutputTokens: 512,
        },
      },
    });
    assert.equal(switched.status, 400, 'changing the endpoint requires the key again');
    assert.ok(switched.body.error.details.fieldErrors['ai.apiKey']);
    const improved = await call('POST', '/magic-editor-x/ai/improve', {
      token: await tokenFor('editor'),
      body: { text: 'Helo <b>wrld</b>' },
    });
    assert.equal(improved.status, 200, JSON.stringify(improved.body));
    assert.equal(improved.body.data.text, 'Improved <b>text</b>');
    const sent = requests.at(-1);
    assert.equal(sent.headers['x-api-key'], 'sk-test-synthetic-key');
    assert.equal(sent.headers['anthropic-version'], '2026-10-21');
    assert.equal(sent.json.model, 'claude-opus-5-5');
    assert.equal(sent.json.max_tokens, 512);
    assert.match(sent.json.messages[0].content, /<text>\nHelo <b>wrld<\/b>\n<\/text>/);
    const tooLong = await call('POST', '/magic-editor-x/ai/shorten', {
      token: await tokenFor('editor'),
      body: { text: 'x'.repeat(2001) },
    });
    assert.equal(tooLong.status, 413);
    const badLanguage = await call('POST', '/magic-editor-x/ai/translate', {
      token: await tokenFor('editor'),
      body: { text: 'x', language: 'Klingon' },
    });
    assert.equal(badLanguage.status, 400);
    const unknown = await call('POST', '/magic-editor-x/ai/jailbreak', {
      token: await tokenFor('editor'),
      body: { text: 'x' },
    });
    assert.equal(unknown.status, 404);
    const reviewer = await call('POST', '/magic-editor-x/ai/improve', {
      token: await tokenFor('reviewer'),
      body: { text: 'x' },
    });
    assert.equal(reviewer.status, 403);
    const compatible = await call('PUT', '/magic-editor-x/settings', {
      token: admin,
      body: {
        ai: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: base,
          model: 'local-model',
          maxInputChars: 2000,
          maxOutputTokens: 300,
          apiKey: '',
        },
      },
    });
    assert.equal(compatible.status, 200);
    const summary = await call('POST', '/magic-editor-x/ai/summarize', {
      token: admin,
      body: { text: 'Long text' },
    });
    assert.equal(summary.body.data.text, 'Summary');
    assert.equal(requests.at(-1).path, '/v1/chat/completions');
    assert.equal(requests.at(-1).json.max_tokens, 300);
    assert.equal(requests.at(-1).headers.authorization, undefined);
    const test = await call('POST', '/magic-editor-x/settings/ai/test', {
      token: admin,
      body: {
        ai: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: base,
          model: 'local-model',
          maxInputChars: 2000,
          maxOutputTokens: 300,
        },
      },
    });
    assert.equal(test.status, 200);
    let limited = 0;
    for (let i = 0; i < 25; i += 1) {
      const response = await call('POST', '/magic-editor-x/ai/grammar', {
        token: admin,
        body: { text: 'x' },
      });
      if (response.status === 429) limited += 1;
    }
    assert.ok(limited > 0, 'the per-admin rate limit applies');
    const settingsAsEditor = await call('GET', '/magic-editor-x/settings', {
      token: await tokenFor('editor'),
    });
    assert.equal(settingsAsEditor.status, 403);
  } finally {
    await call('PUT', '/magic-editor-x/settings', {
      token: admin,
      body: {
        ai: {
          enabled: false,
          provider: 'anthropic',
          baseUrl: '',
          model: 'claude-opus-5-5',
          maxInputChars: 8000,
          maxOutputTokens: 4096,
          apiKey: '',
        },
      },
    });
    fake.close();
  }
});

test('Content API returns editor fields as objects', async () => {
  const admin = await tokenFor('admin');
  const token = await call('POST', '/admin/api-tokens', {
    token: admin,
    body: { name: `mex-read-${Date.now()}`, type: 'read-only', lifespan: null, description: 'integration' },
  });
  assert.equal(token.status, 201);
  const article = await createArticle(admin, { title: 'Public', body: doc([p('pub1', 'Visible')]) });
  const published = await call(
    'POST',
    `/content-manager/collection-types/api::article.article/${article.documentId}/actions/publish`,
    { token: admin, body: {} }
  );
  assert.equal(published.status, 200);
  const response = await call('GET', `/api/articles/${article.documentId}`, {
    token: token.body.data.accessKey,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.body.blocks[0].data.text, 'Visible');
});

/**
 * 2.4 AI against a running host: block actions (`POST /ai/blocks/:action`)
 * with a fake provider (structure kept, hostile answers refused or cleaned,
 * field preset, disableAi, RBAC, limits, nothing sent when refused) and alt
 * text from private image storage (`ai.altText.allowPrivateOrigins`).
 *
 * Host setup (CONTRIBUTING.md acceptance host plus):
 * - the fake AI provider listens on 127.0.0.1:MEX_FAKE_AI_PORT (default 1589)
 *   and the fake private image storage on 127.0.0.1:MEX_FAKE_STORAGE_PORT
 *   (default 1590); the host's `ai.allowPrivateBaseUrl` is true;
 * - `ai.altText.allowPrivateOrigins: ['http://127.0.0.1:1590']` unless the
 *   host runs with MEX_ALT_PRIVATE=false (then set MEX_ALT_PRIVATE=false here
 *   too: the default must refuse every private URL);
 * - Media Library rows named `mex24-private-<case>.png` whose `url` points at
 *   the fake storage (the acceptance host creates them in its bootstrap, the
 *   way an S3/MinIO upload provider on a private network stores files):
 *   ok, signed, redirect, same-redirect, scheme (https), port (the fake AI
 *   provider's port, not listed) and host (localhost instead of 127.0.0.1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { call, tokenFor } from './helpers.mjs';
import { collectSegments } from '../../shared/ai-fields.mjs';

const AI_PORT = Number(process.env.MEX_FAKE_AI_PORT || 1589);
const STORAGE_PORT = Number(process.env.MEX_FAKE_STORAGE_PORT || 1590);
const ALT_PRIVATE = process.env.MEX_ALT_PRIVATE !== 'false';
const BODY = { uid: 'api::article.article', field: 'body' };
const TEASER = { uid: 'api::article.article', field: 'teaser' };
const AI_OFF_FIELD = { uid: 'api::article.article', field: 'summary' };
const AI_BASE = {
  enabled: true,
  provider: 'anthropic',
  baseUrl: `http://127.0.0.1:${AI_PORT}`,
  model: 'claude-opus-5-5',
  maxInputChars: 2000,
  maxOutputTokens: 512,
};
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

/**
 * Starts a server on 127.0.0.1:<port> that records every request.
 * @param {number} port - Port.
 * @param {(req: { path: string, method: string, body: string }) => { status: number, headers?: object, body: string|Buffer }} handler - Reply.
 * @returns {Promise<{ requests: Array<object>, close: () => Promise<void> }>} Server.
 */
const listen = async (port, handler) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const entry = { path: req.url, method: req.method, body };
      requests.push(entry);
      const out = handler(entry);
      res.writeHead(out.status, out.headers || { 'content-type': 'application/json' });
      res.end(out.body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { requests, close: () => new Promise((resolve) => server.close(resolve)) };
};

/** How the fake provider answers JSON segment requests (changed by the tests). */
let mode = 'good';

const segmentAnswer = (payload) => {
  const list = payload.segments;
  switch (mode) {
    case 'missing':
      return { segments: list.slice(1) };
    case 'extra':
      return { segments: [...list, { id: String(list.length), html: 'extra' }] };
    case 'duplicate':
      return { segments: list.map((segment) => ({ ...segment, id: '0' })) };
    case 'script':
      return { segments: list.map((segment) => ({ id: segment.id, html: '<script>alert(1)</script>' })) };
    case 'huge':
      return { segments: list.map((segment) => ({ id: segment.id, html: 'x'.repeat(60000) })) };
    case 'prose':
      return 'Sure, here is the improved text.';
    case 'markup':
      return {
        segments: list.map((segment) => ({
          id: segment.id,
          html: `New <b>bold</b> <mark>marked</mark> <u>under</u> ${segment.html}`,
        })),
      };
    default:
      return {
        segments: list.map((segment) => ({
          id: segment.id,
          html: `Better ${segment.html}<img src=x onerror=alert(1)><a href="https://evil.example.com">more</a><script>alert(1)</script>`,
        })),
      };
  }
};

const providerHandler = ({ path, body }) => {
  if (path !== '/v1/messages') return { status: 404, body: '{}' };
  const json = JSON.parse(body);
  const user = json.messages[0].content;
  let text;
  if (Array.isArray(user)) text = 'A synthetic test image with a blue area';
  else if (user.includes('<json>')) {
    const answer = segmentAnswer(JSON.parse(user.split('<json>\n')[1].split('\n</json>')[0]));
    text = typeof answer === 'string' ? answer : JSON.stringify(answer);
  } else text = 'Better text';
  return {
    status: 200,
    body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  };
};

const storageHandler = ({ path }) => {
  if (path.startsWith('/bucket/ok.png'))
    return { status: 200, headers: { 'content-type': 'image/png' }, body: PNG };
  if (path === '/bucket/redirect.png')
    return { status: 302, headers: { location: `http://127.0.0.1:${AI_PORT}/bucket/ok.png` }, body: '' };
  if (path === '/bucket/same-redirect.png')
    return { status: 302, headers: { location: '/bucket/ok.png' }, body: '' };
  return { status: 404, body: '' };
};

const putSettings = (token, body) => call('PUT', '/magic-editor-x/settings', { token, body });

const sample = {
  time: 1,
  version: '2.31.7',
  blocks: [
    {
      id: 'h1',
      type: 'header',
      data: { text: 'Synthetic <b>title</b>', level: 2 },
      tunes: { alignmentTune: { alignment: 'center' } },
    },
    {
      id: 'p1',
      type: 'paragraph',
      data: { text: 'Read <a href="https://example.com/guide">the <i>guide</i></a> first.' },
    },
    { id: 'l1', type: 'list', data: { style: 'unordered', items: [{ content: 'One item', items: [] }] } },
  ],
};

test('2.4 block actions: structure kept, hostile answers, preset, disableAi, RBAC, limits', async () => {
  const provider = await listen(AI_PORT, providerHandler);
  const admin = await tokenFor('admin');
  // The writer (access + ai.use, no Media Library) keeps the editor's per-minute AI budget for the
  // other AI tests of the suite; `ai.use` is all a block action needs.
  const editor = await tokenFor('writer');
  const segments = collectSegments(sample);
  const blocks = (token, action, body) =>
    call('POST', `/magic-editor-x/ai/blocks/${action}`, { token, body });
  try {
    // AI off: 503 and nothing reaches the provider.
    let r = await putSettings(admin, { ai: { ...AI_BASE, enabled: false, apiKey: '' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await blocks(editor, 'improve', { target: BODY, segments });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.details.code, 'DISABLED');

    // AI on, whole-field actions off: block actions still work (selection-scoped).
    r = await putSettings(admin, {
      ai: { ...AI_BASE, apiKey: 'sk-test-synthetic-key', allowFieldActions: false, allowImages: true },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.ai.allowFieldActions, false);

    // Refusals before anything is sent.
    assert.equal((await blocks(editor, 'improve', { target: AI_OFF_FIELD, segments })).status, 403);
    assert.equal(
      (await blocks(editor, 'improve', { target: { ...BODY, field: 'nope' }, segments })).status,
      404
    );
    assert.equal((await blocks(editor, 'summarize', { target: BODY, segments })).status, 404);
    assert.equal((await blocks(editor, 'improve', { target: BODY, segments: [] })).status, 400);
    const many = Array.from({ length: 201 }, (_, i) => ({ blockId: `b${i}`, path: 'text', html: 'x' }));
    assert.equal((await blocks(editor, 'improve', { target: BODY, segments: many })).status, 400);
    assert.equal(
      (await blocks(editor, 'improve', { target: BODY, segments: [...segments, segments[0]] })).status,
      400
    );
    assert.equal((await blocks(editor, 'improve', { target: BODY, segments, extra: 1 })).status, 400);
    assert.equal(
      (await blocks(editor, 'translate', { target: BODY, segments, language: 'Klingon' })).status,
      400
    );
    r = await blocks(editor, 'improve', {
      target: BODY,
      segments: [{ blockId: 'big', path: 'text', html: '<b>y</b>'.repeat(2001) }],
    });
    assert.equal(r.status, 413);
    for (const who of ['author', 'reviewer', 'reader']) {
      assert.equal(
        (await blocks(await tokenFor(who), 'improve', { target: BODY, segments })).status,
        403,
        who
      );
    }
    assert.equal(provider.requests.length, 0, 'nothing was sent for refused requests');

    // Improve: same segments back, hostile markup removed, new links unwrapped, only strings sent.
    mode = 'good';
    r = await blocks(editor, 'improve', { target: BODY, segments });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      r.body.data.segments.map((s) => `${s.blockId}:${s.path}`),
      segments.map((s) => `${s.blockId}:${s.path}`)
    );
    assert.doesNotMatch(JSON.stringify(r.body.data), /<img|onerror|<script|evil\.example/);
    assert.equal(
      r.body.data.segments[1].html,
      'Better Read <a href="https://example.com/guide">the <i>guide</i></a> first.more'
    );
    const sent = JSON.parse(provider.requests.at(-1).body);
    assert.doesNotMatch(JSON.stringify(sent), /alignmentTune|"h1"|"p1"|"level"|unordered/);
    assert.match(sent.messages[0].content, /^Improve the writing/);

    // Translate and tone carry their option; shorten works.
    r = await blocks(editor, 'translate', {
      target: BODY,
      segments: segments.slice(0, 1),
      language: 'German',
    });
    assert.equal(r.status, 200);
    assert.match(JSON.parse(provider.requests.at(-1).body).messages[0].content, /into German/);
    r = await blocks(editor, 'tone', { target: BODY, segments: segments.slice(0, 1), tone: 'friendly' });
    assert.equal(r.status, 200);
    assert.match(JSON.parse(provider.requests.at(-1).body).messages[0].content, /friendly tone/);
    r = await blocks(editor, 'shorten', { target: BODY, segments: segments.slice(0, 1) });
    assert.equal(r.status, 200);

    // Field preset: the teaser (minimal: bold, italic, link) loses <mark> and <u>.
    mode = 'markup';
    r = await blocks(editor, 'improve', { target: TEASER, segments: segments.slice(0, 1) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.segments[0].html, 'New <b>bold</b> marked under Synthetic <b>title</b>');
    r = await blocks(editor, 'improve', { target: BODY, segments: segments.slice(0, 1) });
    assert.match(r.body.data.segments[0].html, /<mark>marked<\/mark> <u>under<\/u>/);

    // Hostile answers: 502 BAD_RESPONSE, nothing returned.
    for (const hostile of ['missing', 'extra', 'duplicate', 'script', 'huge', 'prose']) {
      mode = hostile;
      r = await blocks(editor, 'improve', { target: BODY, segments });
      assert.equal(r.status, 502, hostile);
      assert.equal(r.body.error.details.code, 'BAD_RESPONSE', hostile);
      assert.equal(r.body.data, null);
    }
  } finally {
    mode = 'good';
    await putSettings(admin, {
      ai: { ...AI_BASE, enabled: false, apiKey: '', allowImages: false, allowFieldActions: false },
    });
    await provider.close();
  }
});

test('2.4 alt text from private image storage: listed exact origin only, no redirects', async () => {
  const provider = await listen(AI_PORT, providerHandler);
  const storage = await listen(STORAGE_PORT, storageHandler);
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  try {
    const settings = await call('GET', '/magic-editor-x/settings', { token: admin });
    assert.deepEqual(
      settings.body.data.environment.altTextPrivateOrigins,
      ALT_PRIVATE ? [`http://127.0.0.1:${STORAGE_PORT}`] : []
    );
    let r = await putSettings(admin, {
      ai: { ...AI_BASE, apiKey: 'sk-test-synthetic-key', allowImages: true },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const files = await call(
      'GET',
      '/upload/files?filters[name][$startsWith]=mex24-private-&pagination[pageSize]=50',
      { token: admin }
    );
    assert.equal(files.status, 200, JSON.stringify(files.body));
    const list = Array.isArray(files.body) ? files.body : files.body.results;
    const id = (key) => {
      const file = list.find((item) => item.name === `mex24-private-${key}.png`);
      assert.ok(file, key);
      return file.id;
    };
    const altText = (key) =>
      call('POST', '/magic-editor-x/ai/image/alt-text', {
        token: editor,
        body: { target: BODY, fileId: id(key), locale: 'en' },
      });

    for (const key of ['ok', 'signed']) {
      r = await altText(key);
      if (ALT_PRIVATE) {
        assert.equal(r.status, 200, `${key} ${JSON.stringify(r.body)}`);
        assert.equal(r.body.data.text, 'A synthetic test image with a blue area');
      } else {
        assert.equal(r.body.error.details.code, 'IMAGE_UNREADABLE', key);
      }
    }
    const providerCalls = provider.requests.filter((item) => item.path === '/v1/messages').length;
    assert.equal(providerCalls, ALT_PRIVATE ? 2 : 0);
    assert.equal(storage.requests.length, ALT_PRIVATE ? 2 : 0, 'the default never contacts private storage');
    if (ALT_PRIVATE) assert.match(storage.requests[1].path, /X-Amz-Signature=synthetic/);

    // Redirects (to another origin or the same one), another scheme, port or host name: refused.
    for (const key of ['redirect', 'same-redirect', 'scheme', 'port', 'host']) {
      r = await altText(key);
      assert.notEqual(r.status, 200, key);
      assert.equal(r.body.error.details.code, 'IMAGE_UNREADABLE', key);
    }
    assert.deepEqual(
      storage.requests.slice(ALT_PRIVATE ? 2 : 0).map((item) => item.path),
      ALT_PRIVATE ? ['/bucket/redirect.png', '/bucket/same-redirect.png'] : []
    );
    assert.equal(
      provider.requests.filter((item) => item.path.startsWith('/bucket')).length,
      0,
      'the redirect target and the unlisted port were never contacted'
    );
    assert.equal(provider.requests.filter((item) => item.path === '/v1/messages').length, providerCalls);
  } finally {
    await putSettings(admin, { ai: { ...AI_BASE, enabled: false, apiKey: '', allowImages: false } });
    await provider.close();
    await storage.close();
  }
});

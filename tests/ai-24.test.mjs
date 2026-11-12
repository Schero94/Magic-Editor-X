/**
 * 2.4 AI: block actions (rewrite, shorten, translate, tone of chosen blocks
 * with the JSON segment protocol, preset-aware sanitising, hostile provider
 * answers), the selection action's link and preset restriction, the admin
 * apply helpers, and alt text from private image storage
 * (`ai.altText.allowPrivateOrigins`) against real local HTTP servers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import { collectSegments } from '../shared/ai-fields.mjs';
import { blockSegments, applyBlockResult } from '../shared/ai-blocks.mjs';
import { resolveFieldPreset } from '../shared/presets.mjs';

const require = createRequire(import.meta.url);
const aiService = require('../server/src/services/ai.js');
const settingsService = require('../server/src/services/settings.js');
const aiController = require('../server/src/controllers/ai.js');
const { loadImage } = require('../server/src/utils/media-image.js');
const urlSecurity = require('../server/src/utils/url-security.js');
const config = require('../server/src/config/index.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS } = require('../server/src/permissions.js');

const KEY = 'k'.repeat(40);

const fakeStrapi = ({ config: conf = {}, stored = {}, files = {}, hits } = {}) => {
  const state = { settings: stored, counters: new Map(), logs: [] };
  const strapi = {
    config: {
      get: (key) => {
        if (key === 'plugin::magic-editor-x.encryptionKey') return KEY;
        if (key === 'middlewares') return [];
        return key.startsWith('plugin::magic-editor-x.') ? conf[key.slice(23)] : undefined;
      },
    },
    dirs: { static: { public: os.tmpdir() } },
    log: { warn: (...args) => state.logs.push(args), error: (...args) => state.logs.push(args) },
    store: () => ({
      get: async () => state.settings,
      set: async ({ value }) => {
        state.settings = value;
      },
    }),
    service: (name) => {
      if (name === 'admin::permission')
        return {
          createPermissionsManager: () => ({
            isAllowed: true,
            action: 'plugin::upload.read',
            ability: { cannot: () => false },
            toSubject: (subject) => subject,
          }),
        };
      if (name === 'admin::user') return { findOne: async () => ({ id: 1, roles: [] }) };
      return null;
    },
    plugin: (name) => ({
      service: (service) => {
        if (name === 'upload' && service === 'upload') return { findOne: async (id) => files[id] || null };
        if (name === 'upload' && service === 'file') return { signFileUrls: async (file) => file };
        if (service === 'settings') return settings;
        if (service === 'store')
          return {
            hit: async (key) => {
              if (hits) hits.push(key);
              const count = (state.counters.get(key) || 0) + 1;
              state.counters.set(key, count);
              return { count };
            },
          };
        return null;
      },
    }),
  };
  const settings = settingsService({ strapi });
  return { strapi, state };
};

const aiSettings = (overrides = {}) => ({
  ai: {
    enabled: true,
    provider: 'anthropic',
    baseUrl: '',
    model: 'claude-opus-5-5',
    maxInputChars: 8000,
    maxOutputTokens: 4096,
    apiKeyEncrypted: null,
    allowImages: true,
    allowFieldActions: false,
    ...overrides,
  },
});

const reply = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

/** Provider stub: `answer(payload, call)` returns the JSON object (or a raw string) to send back. */
const provider = (answer) => {
  const calls = [];
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    const payload = content.includes('<json>')
      ? JSON.parse(content.split('<json>\n')[1].split('\n</json>')[0])
      : null;
    calls.push({ url: String(url), body, payload });
    const out = answer(payload, calls.at(-1));
    return {
      statusCode: 200,
      body: Buffer.from(JSON.stringify(reply(typeof out === 'string' ? out : JSON.stringify(out)))),
      mimeType: 'application/json',
    };
  };
  return { calls, fetch };
};

const doc = () => ({
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'h1', type: 'header', data: { text: 'Synthetic <b>title</b>', level: 2 } },
    {
      id: 'p1',
      type: 'paragraph',
      data: { text: 'Read <a href="https://example.test/a">the <i>guide</i></a> first.' },
      tunes: { alignmentTune: { alignment: 'center' } },
    },
    { id: 'img', type: 'image', data: { file: { url: '/uploads/a.png', id: 3 }, caption: 'A caption' } },
    {
      id: 'l1',
      type: 'list',
      data: { style: 'unordered', items: [{ content: 'One', items: [{ content: 'Nested', items: [] }] }] },
    },
    { id: 'p2', type: 'paragraph', data: { text: 'Untouched <mark>text</mark>.' } },
  ],
});

/* ------------------------------------------------------- block actions (service) */

test('block action: only the chosen segments travel, ids checked, output sanitised and links restricted', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = blockSegments(doc(), ['p1', 'l1']);
  assert.deepEqual(
    segments.map((s) => `${s.blockId}:${s.path}`),
    ['p1:text', 'l1:items.0.content', 'l1:items.0.items.0.content']
  );
  const { calls, fetch } = provider((payload) => ({
    segments: payload.segments.map((s) => ({
      id: s.id,
      html:
        s.id === '0'
          ? 'Lies <a href="https://example.test/a">die <i>Anleitung</i></a> <a href="https://evil.example.test">x</a><img src=x onerror=alert(1)><script>alert(1)</script>'
          : `Neu ${s.html}`,
    })),
  }));
  const service = aiService({ strapi }, { fetchBounded: fetch });
  const result = await service.blockAction({ action: 'improve', segments }, { id: 7 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.system, /JSON object/);
  assert.match(calls[0].body.messages[0].content, /^Improve the writing/);
  const sent = JSON.stringify(calls[0].body);
  assert.doesNotMatch(sent, /Synthetic|Untouched|A caption|alignmentTune|uploads|"p1"|"l1"/);
  assert.deepEqual(
    result.segments.map((s) => `${s.blockId}:${s.path}`),
    segments.map((s) => `${s.blockId}:${s.path}`)
  );
  assert.equal(result.segments[0].html, 'Lies <a href="https://example.test/a">die <i>Anleitung</i></a> x');
  assert.equal(result.segments[1].html, 'Neu One');
});

test('block action: actions, language and tone are checked before anything is sent', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = blockSegments(doc(), ['p1']);
  const { calls, fetch } = provider((payload) => payload);
  const service = aiService({ strapi }, { fetchBounded: fetch });
  for (const action of ['summarize', 'continue', 'grammar', 'expand', '__proto__', 'constructor']) {
    await assert.rejects(service.blockAction({ action, segments }, { id: 1 }), { name: 'NotFoundError' });
  }
  await assert.rejects(
    service.blockAction({ action: 'translate', segments, language: 'Klingon' }, { id: 1 }),
    { name: 'ValidationError' }
  );
  await assert.rejects(service.blockAction({ action: 'tone', segments, tone: 'angry' }, { id: 1 }), {
    name: 'ValidationError',
  });
  assert.equal(calls.length, 0);
  await service.blockAction({ action: 'translate', segments, language: 'German' }, { id: 1 });
  assert.match(
    calls[0].body.messages[0].content,
    /^Translate the text into German\. Translate every segment\./
  );
  await service.blockAction({ action: 'tone', segments, tone: 'friendly' }, { id: 1 });
  assert.match(calls[1].body.messages[0].content, /friendly tone/);
  await service.blockAction({ action: 'shorten', segments }, { id: 1 });
  assert.match(calls[2].body.messages[0].content, /shorter/);
});

test('block action: owner switch, limit (413) and rate limit; whole-field switch not needed', async () => {
  const segments = blockSegments(doc(), ['p1', 'h1']);
  {
    const { strapi } = fakeStrapi({ stored: aiSettings({ enabled: false }) });
    const { calls, fetch } = provider((payload) => payload);
    const service = aiService({ strapi }, { fetchBounded: fetch });
    await assert.rejects(
      service.blockAction({ action: 'improve', segments }, { id: 1 }),
      (error) => error.code === 'DISABLED' && error.status === 503
    );
    assert.equal(calls.length, 0);
  }
  {
    const { strapi } = fakeStrapi({ stored: aiSettings({ maxInputChars: 200 }) });
    const { calls, fetch } = provider((payload) => payload);
    const service = aiService({ strapi }, { fetchBounded: fetch });
    const long = [
      { blockId: 'a', path: 'text', html: '<b>x</b>'.repeat(60) },
      { blockId: 'b', path: 'text', html: 'y'.repeat(141) },
    ];
    await assert.rejects(service.blockAction({ action: 'improve', segments: long }, { id: 1 }), {
      name: 'PayloadTooLargeError',
    });
    assert.equal(calls.length, 0);
  }
  {
    const hits = [];
    const { strapi } = fakeStrapi({
      stored: aiSettings({ allowFieldActions: false }),
      config: { 'ai.apiKey': 'sk-test', 'ai.requestsPerMinute': 2 },
      hits,
    });
    const { calls, fetch } = provider((payload) => payload);
    const service = aiService({ strapi }, { fetchBounded: fetch });
    await service.blockAction({ action: 'improve', segments }, { id: 9 });
    await service.blockAction({ action: 'improve', segments }, { id: 9 });
    await assert.rejects(service.blockAction({ action: 'improve', segments }, { id: 9 }), {
      name: 'RateLimitError',
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(hits, ['ai:9', 'ai:9', 'ai:9']);
  }
});

test('block action refuses hostile answers: missing, extra, duplicate ids, empty text, huge output, prose', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = blockSegments(doc(), ['h1', 'p1']);
  const answers = [
    { segments: [{ id: '0', html: 'x' }] },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '1', html: 'y' },
        { id: '2', html: 'z' },
      ],
    },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '0', html: 'y' },
      ],
    },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '01', html: 'y' },
      ],
    },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '1', html: '<script>alert(1)</script>' },
      ],
    },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '1', html: 'z'.repeat(5000) },
      ],
    },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '1', html: 12 },
      ],
    },
    'Sure! Here is the improved text: ...',
    { segments: 'nope' },
  ];
  for (const answer of answers) {
    const { fetch } = provider(() => answer);
    const service = aiService({ strapi }, { fetchBounded: fetch });
    await assert.rejects(
      service.blockAction({ action: 'improve', segments }, { id: 3 }),
      (error) => error.code === 'BAD_RESPONSE' && error.status === 502,
      JSON.stringify(answer).slice(0, 80)
    );
  }
});

test('block action: the field preset limits inline tags (tools the preset leaves out are unwrapped)', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = [{ blockId: 'p1', path: 'text', html: 'Plain <b>bold</b> text' }];
  const { fetch } = provider((payload) => ({
    segments: payload.segments.map((s) => ({
      id: s.id,
      html: 'New <b>bold</b> <mark>marked</mark> <code>c</code> <u>u</u>',
    })),
  }));
  const service = aiService({ strapi }, { fetchBounded: fetch });
  const inlineTags = ['b', 'br', 'i', 'strong', 'em', 'a'];
  const result = await service.blockAction({ action: 'shorten', segments, inlineTags }, { id: 1 });
  assert.equal(result.segments[0].html, 'New <b>bold</b> marked c u');
});

test('block action: long selections are chunked, one rate limit hit per provider call', async () => {
  const hits = [];
  const { strapi } = fakeStrapi({
    stored: aiSettings({ maxOutputTokens: 300 }),
    config: { 'ai.apiKey': 'sk-test' },
    hits,
  });
  const segments = Array.from({ length: 6 }, (_, i) => ({
    blockId: `b${i}`,
    path: 'text',
    html: 'y'.repeat(200),
  }));
  const { calls, fetch } = provider((payload) => payload);
  const service = aiService({ strapi }, { fetchBounded: fetch });
  const result = await service.blockAction({ action: 'improve', segments }, { id: 4 });
  assert.equal(result.segments.length, 6);
  assert.equal(calls.length, 3);
  assert.equal(hits.length, 3);
});

test('block action log lines carry the action and code only', async () => {
  const { strapi, state } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = [{ blockId: 'p1', path: 'text', html: 'Secret synthetic sentence' }];
  const { fetch } = provider(() => 'not json at all');
  const service = aiService({ strapi }, { fetchBounded: fetch });
  await assert.rejects(service.blockAction({ action: 'improve', segments }, { id: 1 }));
  const logged = JSON.stringify(state.logs);
  assert.match(logged, /blocks-improve/);
  assert.doesNotMatch(logged, /Secret|sk-test|p1/);
});

/* ------------------------------------------------------- selection action (2.4 restriction) */

test('selection action: links the selection did not hold are unwrapped; preset tags only', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const fetch = async () => ({
    statusCode: 200,
    body: Buffer.from(
      JSON.stringify(
        reply(
          'Better <a href="https://example.test/a">guide</a> and <a href="https://evil.example.test">here</a> <mark>m</mark>'
        )
      )
    ),
  });
  const service = aiService({ strapi }, { fetchBounded: fetch });
  const input = { action: 'improve', text: 'Read <a href="https://example.test/a">the guide</a> now' };
  const all = await service.run(input, { id: 1 });
  assert.equal(all.text, 'Better <a href="https://example.test/a">guide</a> and here <mark>m</mark>');
  const restricted = await service.run({ ...input, inlineTags: ['a', 'b', 'br'] }, { id: 1 });
  assert.equal(restricted.text, 'Better <a href="https://example.test/a">guide</a> and here m');
});

/* ------------------------------------------------------- controller and route */

test('block route: strict body, 1-200 segments, disableAi 403, unknown field 404, nothing sent', async () => {
  const field = (options) => ({ type: 'json', customField: 'plugin::magic-editor-x.richtext', options });
  const received = [];
  const strapi = {
    components: {},
    contentType: (uid) =>
      uid === 'api::article.article'
        ? {
            attributes: {
              body: field({ preset: 'full' }),
              teaser: field({ preset: 'minimal' }),
              summary: field({ preset: 'basic', disableAi: true }),
              title: { type: 'string' },
            },
          }
        : undefined,
    plugin: () => ({
      service: () => ({
        blockAction: async (input) => {
          received.push(input);
          return { segments: input.segments };
        },
      }),
    }),
  };
  const controller = aiController({ strapi });
  const segment = { blockId: 'b1', path: 'text', html: 'Text' };
  const call = async (action, body) => {
    const ctx = { params: { action }, request: { body }, state: { user: { id: 1 } } };
    await controller.blocks(ctx);
    return ctx;
  };
  const target = { uid: 'api::article.article', field: 'body' };
  await assert.rejects(call('improve', { target: { ...target, field: 'summary' }, segments: [segment] }), {
    name: 'ForbiddenError',
  });
  await assert.rejects(call('improve', { target: { ...target, field: 'title' }, segments: [segment] }), {
    name: 'NotFoundError',
  });
  for (const body of [
    { target, segments: [] },
    { target, segments: Array.from({ length: 201 }, (_, i) => ({ ...segment, blockId: `b${i}` })) },
    { target, segments: [segment, segment] },
    { target, segments: [{ ...segment, blockId: 'bad id' }] },
    { target, segments: [{ ...segment, extra: 1 }] },
    { target, segments: [segment], extra: true },
    { target, segments: [segment], language: 'x'.repeat(41) },
  ]) {
    await assert.rejects(call('improve', body), { name: 'ValidationError' });
  }
  assert.equal(received.length, 0);
  const ok = await call('improve', {
    target,
    segments: Array.from({ length: 200 }, (_, i) => ({ ...segment, blockId: `b${i}` })),
  });
  assert.equal(ok.body.data.segments.length, 200);
  assert.equal(received[0].inlineTags, null);
  await call('shorten', { target: { ...target, field: 'teaser' }, segments: [segment] });
  assert.deepEqual(received[1].inlineTags, ['a', 'b', 'br', 'em', 'i', 'strong']);
});

test('block route is an admin route with access + ai.use', () => {
  const route = routes.admin.routes.find((item) => item.path === '/ai/blocks/:action');
  assert.equal(route.method, 'POST');
  assert.equal(route.handler, 'ai.blocks');
  assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
  assert.deepEqual(route.config.policies[1].config.actions, [ACTIONS.access, ACTIONS.ai]);
});

/* ------------------------------------------------------- admin apply helpers */

test('applyBlockResult writes the strings back only while the blocks still hold the sent strings', () => {
  const data = doc();
  const sent = blockSegments(data, ['p1', 'l1']);
  const result = sent.map((segment) => ({ ...segment, html: `X ${segment.html}` }));
  const applied = applyBlockResult(data, sent, result, resolveFieldPreset({ preset: 'full' }));
  assert.equal(applied.ok, true);
  assert.equal(applied.data.blocks[1].data.text, `X ${data.blocks[1].data.text}`);
  assert.deepEqual(applied.data.blocks[1].tunes, data.blocks[1].tunes);
  assert.equal(applied.data.blocks[3].data.items[0].items[0].content, 'X Nested');
  assert.equal(applied.data.blocks[0], data.blocks[0]);
  assert.equal(applied.data.blocks[4], data.blocks[4]);
  assert.equal(applied.changed, 3);

  const edited = doc();
  edited.blocks[3].data.items[0].content = 'One!';
  assert.deepEqual(applyBlockResult(edited, sent, result, resolveFieldPreset({})), {
    ok: false,
    reason: 'CHANGED',
  });
  const removed = doc();
  removed.blocks.splice(1, 1);
  assert.equal(applyBlockResult(removed, sent, result, resolveFieldPreset({})).reason, 'CHANGED');
  // A result that names other strings than the sent ones is refused.
  assert.equal(
    applyBlockResult(
      data,
      sent,
      [...result.slice(1), { blockId: 'h1', path: 'text', html: 'x' }],
      resolveFieldPreset({})
    ).reason,
    'MISMATCH'
  );
  assert.equal(applyBlockResult(data, sent, result.slice(1), resolveFieldPreset({})).reason, 'MISMATCH');
});

test('applyBlockResult fixes only the changed blocks against the preset', () => {
  const data = {
    blocks: [
      { id: 'a', type: 'paragraph', data: { text: 'Go <a href="https://example.test">out</a>' } },
      { id: 'b', type: 'paragraph', data: { text: 'Other <a href="https://example.test">link</a>' } },
    ],
  };
  const preset = resolveFieldPreset({ preset: 'full', linkTargets: 'internal' });
  const sent = blockSegments(data, ['a']);
  const applied = applyBlockResult(
    data,
    sent,
    [{ ...sent[0], html: 'Gone <a href="https://example.test">out</a>' }],
    preset
  );
  assert.equal(applied.ok, true);
  assert.equal(applied.data.blocks[0].data.text, 'Gone out');
  assert.equal(applied.data.blocks[1], data.blocks[1], 'blocks that were not sent stay as they are');
});

test('blockSegments keeps document order, skips unknown ids and blocks without text', () => {
  const data = doc();
  assert.deepEqual(
    blockSegments(data, ['l1', 'img', 'nope', 'h1']).map((s) => s.blockId),
    ['h1', 'img', 'l1', 'l1']
  );
  assert.deepEqual(blockSegments(data, []), []);
  assert.deepEqual(blockSegments(null, ['h1']), []);
  assert.equal(
    collectSegments(data).length,
    blockSegments(
      data,
      data.blocks.map((b) => b.id)
    ).length
  );
});

/* ------------------------------------------------------- private image storage (item 14) */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

/** Local image server: `/ok.png`, `/redirect` (to `target`), `/same` (to `/ok.png`). */
const imageServer = async (redirectTarget = '') => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, host: req.headers.host });
    if (req.url.startsWith('/ok.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: redirectTarget });
      res.end();
    } else if (req.url === '/same') {
      res.writeHead(302, { location: '/ok.png' });
      res.end();
    } else if (req.url === '/svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, port: server.address().port, requests, close: () => server.close() };
};

const imageFile = (url) => ({ url, mime: 'image/png', width: 16, height: 16, size: 0.04 });

test('private storage: refused by default, allowed for a listed exact origin with every cap', async () => {
  const storage = await imageServer();
  try {
    await assert.rejects(
      loadImage({ file: imageFile(`${storage.origin}/ok.png`), publicDir: os.tmpdir() }),
      (error) => error.code === 'IMAGE_UNREADABLE'
    );
    assert.equal(storage.requests.length, 0, 'the default never connects to a private address');
    const image = await loadImage({
      file: imageFile(`${storage.origin}/ok.png?X-Amz-Signature=synthetic`),
      publicDir: os.tmpdir(),
      allowPrivateOrigins: [storage.origin],
    });
    assert.equal(image.mediaType, 'image/png');
    assert.equal(storage.requests.length, 1);
    // The type cap stays: SVG is refused even from a listed origin.
    await assert.rejects(
      loadImage({
        file: { ...imageFile(`${storage.origin}/svg`) },
        publicDir: os.tmpdir(),
        allowPrivateOrigins: [storage.origin],
      }),
      (error) => error.code === 'IMAGE_UNREADABLE'
    );
  } finally {
    storage.close();
  }
});

test('private storage: another port, scheme or host name of the same machine is refused', async () => {
  const storage = await imageServer();
  const other = await imageServer();
  try {
    for (const url of [
      `${other.origin}/ok.png`,
      `https://127.0.0.1:${storage.port}/ok.png`,
      `http://localhost:${storage.port}/ok.png`,
    ]) {
      await assert.rejects(
        loadImage({ file: imageFile(url), publicDir: os.tmpdir(), allowPrivateOrigins: [storage.origin] }),
        (error) => error.code === 'IMAGE_UNREADABLE',
        url
      );
    }
    assert.equal(other.requests.length, 0);
    assert.equal(storage.requests.length, 0);
  } finally {
    storage.close();
    other.close();
  }
});

test('private storage: redirects are never followed (to another origin or the same one)', async () => {
  const other = await imageServer();
  const storage = await imageServer(`${other.origin}/ok.png`);
  try {
    for (const pathname of ['/redirect', '/same']) {
      await assert.rejects(
        loadImage({
          file: imageFile(`${storage.origin}${pathname}`),
          publicDir: os.tmpdir(),
          allowPrivateOrigins: [storage.origin],
        }),
        (error) => error.code === 'IMAGE_UNREADABLE',
        pathname
      );
    }
    assert.equal(other.requests.length, 0, 'the redirect target was never contacted');
    assert.deepEqual(
      storage.requests.map((request) => request.url),
      ['/redirect', '/same']
    );
  } finally {
    storage.close();
    other.close();
  }
});

test('private storage: metadata and link-local addresses stay refused, also when listed or resolved', async () => {
  for (const origin of [
    'http://169.254.169.254',
    'http://[fe80::1]',
    'http://[::ffff:169.254.169.254]',
    'http://[fd00:ec2::254]',
    'http://100.100.100.200',
    'http://metadata.google.internal',
    'http://0.0.0.0:9000',
  ]) {
    assert.equal(urlSecurity.isListablePrivateOrigin(origin), false, origin);
    // Listed in its normalised form (`URL.origin`), the address is still refused at request time.
    const listed = new URL(origin).origin;
    assert.throws(
      () => urlSecurity.privateOriginOptions(`${listed}/latest`, [listed]),
      /not allowed/,
      origin
    );
    const conf = JSON.parse(JSON.stringify(config.default));
    conf.ai.altText.allowPrivateOrigins = [origin];
    assert.throws(() => config.validator(conf), /ai\.altText\.allowPrivateOrigins/, origin);
  }
  for (const origin of ['http://minio.internal:9000', 'https://10.0.0.5', 'http://127.0.0.1:1590']) {
    assert.equal(urlSecurity.isListablePrivateOrigin(origin), true, origin);
  }
  for (const bad of ['http://127.0.0.1:1590/', 'ftp://10.0.0.5', 'http://user:pw@10.0.0.5', 'nope']) {
    assert.equal(urlSecurity.isListablePrivateOrigin(bad), false, bad);
  }
  const conf = JSON.parse(JSON.stringify(config.default));
  assert.deepEqual(conf.ai.altText.allowPrivateOrigins, []);
  conf.ai.altText.allowPrivateOrigins = ['http://minio.internal:9000'];
  config.validator(conf);

  // A listed host name that resolves to a metadata address is refused before connecting.
  let fetched = 0;
  await assert.rejects(
    loadImage({
      file: imageFile('http://storage.example.test:9000/a.png'),
      publicDir: os.tmpdir(),
      allowPrivateOrigins: ['http://storage.example.test:9000'],
      resolve: async () => [
        { address: '10.0.0.5', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
      fetch: (url, options) => {
        fetched += 1;
        return urlSecurity.fetchBounded(url, { ...options, request: async () => assert.fail('connected') });
      },
    }),
    (error) => error.code === 'IMAGE_UNREADABLE'
  );
  assert.equal(fetched, 1);
});

test('private storage: a listed host name is resolved once and the connection is pinned (no DNS rebinding)', async () => {
  const storage = await imageServer();
  try {
    const lookups = [];
    const answers = [[{ address: '127.0.0.1', family: 4 }], [{ address: '169.254.169.254', family: 4 }]];
    const image = await loadImage({
      file: imageFile(`http://storage.example.test:${storage.port}/ok.png`),
      publicDir: os.tmpdir(),
      allowPrivateOrigins: [`http://storage.example.test:${storage.port}`],
      resolve: async (hostname, options) => {
        lookups.push({ hostname, options });
        return answers[lookups.length - 1];
      },
    });
    assert.equal(image.mediaType, 'image/png');
    assert.equal(lookups.length, 1, 'one lookup; the socket uses the checked address');
    assert.equal(storage.requests[0].host, `storage.example.test:${storage.port}`);
  } finally {
    storage.close();
  }
});

test('alt text service passes the configured private origins to the image loader', async () => {
  const storage = await imageServer();
  try {
    const files = { 5: imageFile(`${storage.origin}/ok.png`) };
    const providerCalls = [];
    const fetch = async (url, options) => {
      if (String(url).startsWith(storage.origin)) return urlSecurity.fetchBounded(url, options);
      providerCalls.push(url);
      return { statusCode: 200, body: Buffer.from(JSON.stringify(reply('A synthetic test image'))) };
    };
    {
      const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' }, files });
      const service = aiService({ strapi }, { fetchBounded: fetch });
      await assert.rejects(
        service.altText({ fileId: 5, userAbility: {} }, { id: 1 }),
        (error) => error.code === 'IMAGE_UNREADABLE'
      );
      assert.equal(storage.requests.length, 0);
    }
    {
      const { strapi } = fakeStrapi({
        stored: aiSettings(),
        config: { 'ai.apiKey': 'sk-test', 'ai.altText.allowPrivateOrigins': [storage.origin] },
        files,
      });
      const service = aiService({ strapi }, { fetchBounded: fetch });
      const { text } = await service.altText({ fileId: 5, userAbility: {} }, { id: 1 });
      assert.equal(text, 'A synthetic test image');
      assert.equal(storage.requests.length, 1);
      assert.equal(providerCalls.length, 1);
    }
  } finally {
    storage.close();
  }
});

test('settings expose the private storage origins read-only; quality checks share the helper', async () => {
  const { strapi } = fakeStrapi({
    stored: aiSettings(),
    config: { 'ai.altText.allowPrivateOrigins': ['http://minio.internal:9000'] },
  });
  const dto = await settingsService({ strapi }).get();
  assert.deepEqual(dto.environment.altTextPrivateOrigins, ['http://minio.internal:9000']);
  const options = urlSecurity.privateOriginOptions('http://minio.internal:9000/a.png?sig=1', [
    'http://minio.internal:9000',
  ]);
  assert.equal(options.allowPrivate, true);
  assert.equal(options.maxRedirects, 0);
  assert.equal(options.request, urlSecurity.requestWithoutRedirect);
  assert.equal(
    urlSecurity.privateOriginOptions('http://minio.internal:9001/a.png', ['http://minio.internal:9000']),
    null
  );
  assert.equal(urlSecurity.privateOriginOptions('http://minio.internal:9000/a.png', []), null);
  assert.equal(urlSecurity.privateOriginOptions('not a url', ['http://minio.internal:9000']), null);
});

/**
 * 2.3 AI extras and grammar check: segment collection and write-back,
 * translation validation and sanitising, offset mapping, LanguageTool
 * request building and match mapping, alt text image handling and the
 * settings (switches, LanguageTool validation and encryption).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applySegments,
  chunkSegments,
  collectSegments,
  joinTexts,
  languageToolLanguage,
  locateInJoined,
  readSegment,
  replaceInSegment,
  restrictLinks,
  segmentText,
} from '../shared/ai-fields.mjs';
import {
  toDraft,
  toPayload,
  validateLanguageTool,
  sameDraft,
} from '../admin/src/pages/ConfigurationPage/configForm.mjs';

const require = createRequire(import.meta.url);
const aiService = require('../server/src/services/ai.js');
const grammarService = require('../server/src/services/grammar.js');
const settingsService = require('../server/src/services/settings.js');
const { sniffImageType, pickVariant, loadImage } = require('../server/src/utils/media-image.js');
const { segmentsSchema } = require('../server/src/controllers/ai.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS, ACTION_DEFINITIONS } = require('../server/src/permissions.js');

const KEY = 'k'.repeat(40);

const doc = () => ({
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
      data: { text: 'Read <a href="https://example.test/a">the guide</a> first.' },
    },
    {
      id: 'img',
      type: 'image',
      data: { file: { url: '/uploads/a.png', id: 3, alt: 'x' }, caption: 'A caption', withBorder: true },
    },
    {
      id: 'l1',
      type: 'list',
      data: { style: 'unordered', items: [{ content: 'One', items: [{ content: 'Nested', items: [] }] }] },
    },
    { id: 'c1', type: 'code', data: { code: 'const secret = 1;' } },
    { id: 'e1', type: 'paragraph', data: { text: '   ' } },
  ],
});

/* ------------------------------------------------------------ segments */

test('collectSegments lists inline text strings only (no code, no empty, no URLs)', () => {
  const segments = collectSegments(doc());
  assert.deepEqual(
    segments.map((s) => `${s.blockId}:${s.path}`),
    ['h1:text', 'p1:text', 'img:caption', 'l1:items.0.content', 'l1:items.0.items.0.content']
  );
  assert.ok(!JSON.stringify(segments).includes('/uploads/a.png'));
  assert.ok(!JSON.stringify(segments).includes('secret'));
});

test('applySegments keeps block ids, types, tunes and non-text data', () => {
  const data = doc();
  const segments = collectSegments(data).map((s) => ({ ...s, html: `T:${s.html}` }));
  const { data: next, changed, missing } = applySegments(data, segments);
  assert.equal(changed, 5);
  assert.equal(missing, 0);
  assert.deepEqual(
    next.blocks.map((b) => [b.id, b.type]),
    data.blocks.map((b) => [b.id, b.type])
  );
  assert.deepEqual(next.blocks[0].tunes, data.blocks[0].tunes);
  assert.equal(next.blocks[0].data.level, 2);
  assert.deepEqual(next.blocks[2].data.file, data.blocks[2].data.file);
  assert.equal(next.blocks[2].data.withBorder, true);
  assert.equal(next.blocks[3].data.items[0].items[0].content, 'T:Nested');
  assert.equal(next.blocks[4], data.blocks[4]);
  assert.equal(readSegment(next.blocks[1].data, 'text').startsWith('T:'), true);
  // Unknown block or a path that is not a string slot is never created.
  const odd = applySegments(data, [
    { blockId: 'nope', path: 'text', html: 'x' },
    { blockId: 'img', path: 'file', html: 'x' },
    { blockId: 'p1', path: 'extra', html: 'x' },
  ]);
  assert.equal(odd.changed, 0);
  assert.equal(odd.missing, 3);
  assert.deepEqual(odd.data.blocks[1].data, data.blocks[1].data);
});

test('restrictLinks unwraps links the original did not contain', () => {
  const out = restrictLinks(
    'Lies <a href="https://example.test/a">die Anleitung</a> und <a href="https://evil.example.test">hier</a>',
    ['https://example.test/a']
  );
  assert.match(out, /<a href="https:\/\/example.test\/a">die Anleitung<\/a>/);
  assert.doesNotMatch(out, /evil/);
  assert.match(out, /und hier$/);
});

test('chunkSegments splits by plain text length', () => {
  const segments = ['aaaa', 'bbbb', 'cccc'].map((html, i) => ({ blockId: `b${i}`, path: 'text', html }));
  assert.deepEqual(
    chunkSegments(segments, 8).map((c) => c.length),
    [2, 1]
  );
  assert.equal(chunkSegments(segments, 2).length, 3);
});

test('segment schema rejects duplicates and bad ids', () => {
  const ok = { blockId: 'a1', path: 'items.0.content', html: 'x' };
  assert.equal(segmentsSchema.safeParse([ok]).success, true);
  assert.equal(segmentsSchema.safeParse([ok, ok]).success, false);
  assert.equal(segmentsSchema.safeParse([{ ...ok, blockId: 'a b' }]).success, false);
  assert.equal(segmentsSchema.safeParse([{ ...ok, path: '__proto__.x' }]).success, false);
  assert.equal(segmentsSchema.safeParse([{ ...ok, html: 'x'.repeat(20001) }]).success, false);
  assert.equal(segmentsSchema.safeParse([]).success, false);
});

/* ------------------------------------------------------- offset mapping */

test('segmentText maps text nodes and line breaks', () => {
  const { text, pieces } = segmentText('Ein <b>Fehlr</b> hier<br>und &amp; da');
  assert.equal(text, 'Ein Fehlr hier\nund & da');
  assert.deepEqual(
    pieces.map((p) => [p.start, p.end]),
    [
      [0, 4],
      [4, 9],
      [9, 14],
      [15, 23],
    ]
  );
});

test('replaceInSegment replaces inside one text node only', () => {
  const html = 'Ein <b>Fehlr</b> hier und &amp; da';
  const ok = replaceInSegment(html, { offset: 4, length: 5, expected: 'Fehlr', replacement: 'Fehler' });
  assert.equal(ok.reason, null);
  assert.equal(ok.html, 'Ein <b>Fehler</b> hier und &amp; da');
  const escaped = replaceInSegment(html, { offset: 15, length: 3, expected: 'und', replacement: '<i>&' });
  assert.equal(escaped.html, 'Ein <b>Fehlr</b> hier &lt;i&gt;&amp; &amp; da');
  assert.equal(
    replaceInSegment(html, { offset: 0, length: 9, expected: 'Ein Fehlr', replacement: 'x' }).reason,
    'CROSSES_FORMATTING'
  );
  assert.equal(
    replaceInSegment(html, { offset: 4, length: 5, expected: 'Other', replacement: 'x' }).reason,
    'CHANGED'
  );
  assert.equal(
    replaceInSegment('a<br>b', { offset: 0, length: 3, expected: 'a\nb', replacement: 'x' }).reason,
    'CROSSES_FORMATTING'
  );
  assert.equal(
    replaceInSegment(html, { offset: 99, length: 1, expected: 'x', replacement: 'y' }).reason,
    'CHANGED'
  );
});

test('joined texts map offsets back and drop separator matches', () => {
  const parts = [{ text: 'Hello wrld' }, { text: 'Second one' }];
  const joined = joinTexts(parts);
  assert.equal(joined.text, 'Hello wrld\n\nSecond one');
  assert.deepEqual(locateInJoined(joined, parts, 6, 4), { part: 0, offset: 6 });
  assert.deepEqual(locateInJoined(joined, parts, 12, 6), { part: 1, offset: 0 });
  assert.equal(locateInJoined(joined, parts, 8, 5), null);
  assert.equal(locateInJoined(joined, parts, -1, 1), null);
  assert.equal(locateInJoined(joined, parts, 1.5, 1), null);
});

test('LanguageTool language from the content locale', () => {
  assert.equal(languageToolLanguage('de'), 'de-DE');
  assert.equal(languageToolLanguage('en'), 'en-US');
  assert.equal(languageToolLanguage('en-gb'), 'en-GB');
  assert.equal(languageToolLanguage('fr'), 'fr');
  assert.equal(languageToolLanguage(null), 'auto');
  assert.equal(languageToolLanguage('x;y'), 'auto');
});

/* ------------------------------------------------------- fake strapi */

const fakeStrapi = ({ config = {}, stored = {}, files = {}, can = true, hits } = {}) => {
  const state = { settings: stored, counters: new Map(), logs: [] };
  const strapi = {
    config: {
      get: (key) => {
        if (key === 'plugin::magic-editor-x.encryptionKey') return KEY;
        if (key === 'middlewares') return [];
        return key.startsWith('plugin::magic-editor-x.') ? config[key.slice(23)] : undefined;
      },
    },
    dirs: { static: { public: config.publicDir || os.tmpdir() } },
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
            isAllowed: can,
            action: 'plugin::upload.read',
            ability: { cannot: () => !can },
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
  return { strapi, state, settings };
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
    allowFieldActions: true,
    ...overrides,
  },
});

const providerReply = (provider, text) =>
  provider === 'anthropic'
    ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
    : { choices: [{ message: { content: text }, finish_reason: 'stop' }] };

const recorder = (answer) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });
    const text = typeof answer === 'function' ? answer(calls.at(-1)) : answer;
    return { statusCode: 200, body: Buffer.from(JSON.stringify(text)), mimeType: 'application/json' };
  };
  return { calls, fetch };
};

/* ------------------------------------------------------- field actions */

test('whole-field translate: ids checked, output sanitised, links restricted', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = collectSegments(doc());
  const { calls, fetch } = recorder((call) => {
    const payload = JSON.parse(call.body.messages[0].content.split('<json>\n')[1].split('\n</json>')[0]);
    const out = payload.segments.map((s) => ({
      id: s.id,
      html:
        s.id === '1'
          ? 'Lesen <a href="https://example.test/a">die Anleitung</a> <a href="https://evil.example.test">x</a><img src=x onerror=alert(1)><script>alert(1)</script>'
          : `DE ${s.html}`,
    }));
    return providerReply('anthropic', '```json\n' + JSON.stringify({ segments: out }) + '\n```');
  });
  const service = aiService({ strapi }, { fetchBounded: fetch });
  const result = await service.fieldAction({ action: 'translate', segments, language: 'German' }, { id: 7 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.system.includes('JSON'), true);
  assert.deepEqual(
    result.segments.map((s) => `${s.blockId}:${s.path}`),
    segments.map((s) => `${s.blockId}:${s.path}`)
  );
  const second = result.segments[1].html;
  assert.match(second, /href="https:\/\/example.test\/a"/);
  assert.doesNotMatch(second, /evil|<img|<script|onerror/);
  assert.equal(result.segments[0].html, 'DE Synthetic <b>title</b>');
});

test('whole-field translate refuses answers that do not match the sent segments', async () => {
  const { strapi } = fakeStrapi({ stored: aiSettings(), config: { 'ai.apiKey': 'sk-test' } });
  const segments = collectSegments(doc()).slice(0, 2);
  for (const bad of [
    { segments: [{ id: '0', html: 'x' }] },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '0', html: 'y' },
      ],
    },
    {
      segments: [
        { id: '0', html: 'x' },
        { id: '7', html: 'y' },
      ],
    },
    { other: true },
    'not json',
  ]) {
    const { fetch } = recorder(
      providerReply('anthropic', typeof bad === 'string' ? bad : JSON.stringify(bad))
    );
    const service = aiService({ strapi }, { fetchBounded: fetch });
    await assert.rejects(
      service.fieldAction({ action: 'translate', segments, language: 'German' }, { id: 7 }),
      (error) => error.code === 'BAD_RESPONSE'
    );
  }
});

test('whole-field actions: switch off sends nothing, limits and summarize', async () => {
  const segments = collectSegments(doc());
  {
    const { strapi } = fakeStrapi({ stored: aiSettings({ allowFieldActions: false }) });
    const { calls, fetch } = recorder({});
    const service = aiService({ strapi }, { fetchBounded: fetch });
    await assert.rejects(
      service.fieldAction({ action: 'summarize', segments }, { id: 1 }),
      (error) => error.code === 'FIELD_ACTIONS_DISABLED' && error.status === 503
    );
    assert.equal(calls.length, 0);
  }
  {
    const { strapi } = fakeStrapi({ stored: aiSettings({ maxInputChars: 200 }) });
    const { calls, fetch } = recorder({});
    const service = aiService({ strapi }, { fetchBounded: fetch });
    const long = [{ blockId: 'a', path: 'text', html: 'x'.repeat(201) }];
    await assert.rejects(
      service.fieldAction({ action: 'summarize', segments: long }, { id: 1 }),
      (error) => error.name === 'PayloadTooLargeError'
    );
    await assert.rejects(
      service.fieldAction({ action: 'rewrite', segments }, { id: 1 }),
      (e) => e.name === 'NotFoundError'
    );
    assert.equal(calls.length, 0);
  }
  {
    const { strapi } = fakeStrapi({
      stored: aiSettings({ provider: 'openai' }),
      config: { 'ai.apiKey': 'sk-test' },
    });
    const { calls, fetch } = recorder(providerReply('openai', '"A <b>short</b>\u0007 summary."'));
    const service = aiService({ strapi }, { fetchBounded: fetch });
    const result = await service.fieldAction({ action: 'summarize', segments }, { id: 1 });
    assert.equal(result.text, 'A short summary.');
    assert.match(calls[0].url, /\/v1\/chat\/completions$/);
    assert.match(calls[0].body.messages[1].content, /<text>\nSynthetic title\n\nRead the guide first\./);
    assert.doesNotMatch(calls[0].body.messages[1].content, /href|uploads/);
  }
});

test('translation is chunked by the output budget and counts each call', async () => {
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
  const { calls, fetch } = recorder((call) => {
    const payload = JSON.parse(call.body.messages[0].content.split('<json>\n')[1].split('\n</json>')[0]);
    return providerReply('anthropic', JSON.stringify(payload));
  });
  const service = aiService({ strapi }, { fetchBounded: fetch });
  const result = await service.fieldAction({ action: 'translate', segments, language: 'French' }, { id: 4 });
  assert.equal(result.segments.length, 6);
  assert.equal(calls.length, 3);
  assert.equal(hits.length, 3);
  assert.ok(hits.every((key) => key === 'ai:4'));
});

/* ------------------------------------------------------- alt text */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

test('image type comes from the bytes; variants respect edge and size', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('RIFF0000WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="x"></svg>')), null);
  const file = {
    url: '/uploads/big.jpg',
    mime: 'image/jpeg',
    width: 4000,
    height: 3000,
    size: 5000,
    formats: {
      large: { url: '/uploads/large_big.jpg', mime: 'image/jpeg', width: 1000, height: 750, size: 200 },
      small: { url: '/uploads/small_big.jpg', mime: 'image/jpeg', width: 500, height: 375, size: 50 },
    },
  };
  assert.equal(pickVariant(file).url, '/uploads/large_big.jpg');
  assert.equal(pickVariant({ url: '/uploads/a.svg', mime: 'image/svg+xml', size: 1 }), null);
});

test('local images are read only from public/uploads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mex-ai-'));
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.writeFileSync(path.join(dir, 'uploads', 'a.png'), PNG);
  fs.writeFileSync(path.join(dir, 'secret.png'), PNG);
  fs.symlinkSync(path.join(dir, 'secret.png'), path.join(dir, 'uploads', 'link.png'));
  const file = (url) => ({ url, mime: 'image/png', width: 10, height: 10, size: 0.04 });
  const image = await loadImage({ file: file('/uploads/a.png'), publicDir: dir });
  assert.equal(image.mediaType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').equals(PNG), true);
  for (const url of [
    '/uploads/../secret.png',
    '/uploads/%2e%2e/secret.png',
    '/uploads/link.png',
    '/secret.png',
  ]) {
    await assert.rejects(
      loadImage({ file: file(url), publicDir: dir }),
      (e) => e.code === 'IMAGE_UNREADABLE',
      url
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('alt text: Anthropic image block, OpenAI image_url, switch and permission checks', async () => {
  const files = {
    3: {
      id: 3,
      url: 'https://cdn.example.test/a.png?sig=1',
      mime: 'image/png',
      width: 20,
      height: 20,
      size: 0.04,
    },
  };
  const remote = async (url, options) => {
    assert.deepEqual(options.allowedMimeTypes, ['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    return { statusCode: 200, body: PNG, mimeType: 'image/png' };
  };
  for (const provider of ['anthropic', 'openai', 'openai-compatible']) {
    const { strapi } = fakeStrapi({
      stored: aiSettings({
        provider,
        baseUrl: provider === 'openai-compatible' ? 'https://llm.example.test' : '',
      }),
      config: { 'ai.apiKey': 'sk-test' },
      files,
    });
    const calls = [];
    const fetch = async (url, options) => {
      if (String(url).startsWith('https://cdn.')) return remote(url, options);
      calls.push(JSON.parse(options.body));
      return {
        statusCode: 200,
        body: Buffer.from(
          JSON.stringify(
            providerReply(provider === 'anthropic' ? 'anthropic' : 'openai', `"${'Ein Hund '.repeat(30)}"`)
          )
        ),
      };
    };
    const service = aiService({ strapi }, { fetchBounded: fetch });
    const { text } = await service.altText({ fileId: 3, locale: 'de', userAbility: {} }, { id: 2 });
    assert.ok(text.length <= 150 && text.startsWith('Ein Hund'), text);
    assert.doesNotMatch(text, /"/);
    const body = calls[0];
    if (provider === 'anthropic') {
      const [image, prompt] = body.messages[0].content;
      assert.deepEqual(Object.keys(image.source).sort(), ['data', 'media_type', 'type']);
      assert.equal(image.type, 'image');
      assert.equal(image.source.type, 'base64');
      assert.equal(image.source.media_type, 'image/png');
      assert.equal(prompt.type, 'text');
      assert.match(prompt.text, /German/);
      assert.ok(body.max_tokens <= 400);
    } else {
      const [image, prompt] = body.messages[1].content;
      assert.equal(image.type, 'image_url');
      assert.match(image.image_url.url, /^data:image\/png;base64,/);
      assert.equal(prompt.type, 'text');
    }
  }
  {
    const { strapi } = fakeStrapi({ stored: aiSettings({ allowImages: false }), files });
    let called = 0;
    const service = aiService({ strapi }, { fetchBounded: async () => called++ });
    await assert.rejects(
      service.altText({ fileId: 3, userAbility: {} }, { id: 2 }),
      (e) => e.code === 'IMAGES_DISABLED'
    );
    assert.equal(called, 0);
  }
  {
    const { strapi } = fakeStrapi({ stored: aiSettings(), files, can: false });
    let called = 0;
    const service = aiService({ strapi }, { fetchBounded: async () => called++ });
    await assert.rejects(
      service.altText({ fileId: 3, userAbility: {} }, { id: 2 }),
      (e) => e.name === 'NotFoundError'
    );
    await assert.rejects(
      service.altText({ fileId: 99, userAbility: {} }, { id: 2 }),
      (e) => e.name === 'NotFoundError'
    );
    assert.equal(called, 0);
  }
});

/* ------------------------------------------------------- grammar */

const ltSettings = (overrides = {}) => ({
  ...aiSettings(),
  languageTool: {
    enabled: true,
    baseUrl: 'https://lt.example.test',
    username: '',
    level: 'default',
    apiKeyEncrypted: null,
    ...overrides,
  },
});

test('grammar check maps matches to strings and drops separator matches', async () => {
  const { strapi } = fakeStrapi({ stored: ltSettings() });
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options, form: new URLSearchParams(options.body) });
    const text = calls.at(-1).form.get('text');
    const at = (needle) => text.indexOf(needle);
    return {
      statusCode: 200,
      body: Buffer.from(
        JSON.stringify({
          matches: [
            {
              offset: at('Fehlr'),
              length: 5,
              message: 'Spelling',
              replacements: [{ value: 'Fehler' }, ...Array(9).fill({ value: 'z' })],
              rule: { id: 'R1', category: { id: 'TYPOS', name: 'Typos' } },
            },
            {
              offset: at('hier\n') + 2,
              length: 5,
              message: 'Across',
              replacements: [],
              rule: { id: 'R2', category: {} },
            },
            { offset: at('Zweit'), length: 5, message: 'Second', replacements: [], rule: { id: 'R3' } },
          ],
        })
      ),
    };
  };
  const service = grammarService({ strapi }, { fetchBounded: fetch });
  const segments = [
    { blockId: 'a', path: 'text', html: 'Ein <b>Fehlr</b> hier' },
    { blockId: 'b', path: 'items.0.content', html: 'Zweiter Satz' },
  ];
  const result = await service.check({ segments, locale: 'de' }, { id: 5 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://lt.example.test/v2/check');
  assert.equal(calls[0].form.get('language'), 'de-DE');
  assert.equal(calls[0].form.get('text'), 'Ein Fehlr hier\n\nZweiter Satz');
  assert.equal(calls[0].form.has('apiKey'), false);
  assert.equal(calls[0].options.allowPrivate, false);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    { ...result.matches[0], replacements: result.matches[0].replacements.length },
    {
      blockId: 'a',
      path: 'text',
      offset: 4,
      length: 5,
      text: 'Fehlr',
      message: 'Spelling',
      shortMessage: '',
      replacements: 5,
      rule: { id: 'R1', issueType: '', category: { id: 'TYPOS', name: 'Typos' } },
    }
  );
  assert.deepEqual([result.matches[1].blockId, result.matches[1].offset], ['b', 0]);
});

test('grammar check: off sends nothing, credentials only with a stored key, errors mapped', async () => {
  {
    const { strapi } = fakeStrapi({ stored: ltSettings({ enabled: false }) });
    let called = 0;
    const service = grammarService({ strapi }, { fetchBounded: async () => called++ });
    await assert.rejects(
      service.check({ segments: [{ blockId: 'a', path: 'text', html: 'x' }] }, { id: 1 }),
      (e) => e.code === 'DISABLED' && e.status === 503
    );
    assert.equal(called, 0);
  }
  {
    const crypto = require('../server/src/utils/crypto.js');
    const key = crypto.encryptSecret('lt-key', KEY, 'magic-editor-x:languagetool-credentials');
    const { strapi } = fakeStrapi({
      stored: ltSettings({ username: 'editor@example.test', apiKeyEncrypted: key, level: 'picky' }),
      config: { 'languageTool.allowPrivateBaseUrl': true },
    });
    let form;
    const service = grammarService(
      { strapi },
      {
        fetchBounded: async (url, options) => {
          form = new URLSearchParams(options.body);
          assert.equal(options.allowPrivate, true);
          return { statusCode: 401, body: Buffer.from('{}') };
        },
      }
    );
    await assert.rejects(
      service.check({ segments: [{ blockId: 'a', path: 'text', html: 'x' }] }, { id: 1 }),
      (e) => e.code === 'AUTH_FAILED'
    );
    assert.equal(form.get('apiKey'), 'lt-key');
    assert.equal(form.get('username'), 'editor@example.test');
    assert.equal(form.get('level'), 'picky');
    // A connection test with another base URL never receives the stored key.
    let testForm;
    const tester = grammarService(
      { strapi },
      {
        fetchBounded: async (url, options) => {
          testForm = new URLSearchParams(options.body);
          return { statusCode: 200, body: Buffer.from('{"matches":[]}') };
        },
      }
    );
    await tester.test({
      enabled: true,
      baseUrl: 'https://other.example.test',
      username: 'editor@example.test',
      level: 'default',
    });
    assert.equal(testForm.has('apiKey'), false);
  }
  {
    const { strapi } = fakeStrapi({ stored: ltSettings() });
    const service = grammarService(
      { strapi },
      { fetchBounded: async () => ({ statusCode: 200, body: Buffer.from('{}') }) }
    );
    const big = Array.from({ length: 4 }, (_, i) => ({
      blockId: `b${i}`,
      path: 'text',
      html: 'w '.repeat(9000),
    }));
    await assert.rejects(
      service.check({ segments: big }, { id: 1 }),
      (e) => e.name === 'PayloadTooLargeError'
    );
  }
});

/* ------------------------------------------------------- settings */

test('settings: switches default off, LanguageTool URL policy, key encryption and re-entry', async () => {
  const { settings, state } = fakeStrapi({ stored: {} });
  const base = {
    enabled: false,
    provider: 'anthropic',
    baseUrl: '',
    model: 'claude-opus-5-5',
    maxInputChars: 8000,
    maxOutputTokens: 4096,
  };
  const dto = await settings.get();
  assert.equal(dto.ai.allowImages, false);
  assert.equal(dto.ai.allowFieldActions, false);
  assert.equal(dto.languageTool.enabled, false);
  // 2.2 clients (ai only) keep the switches.
  await settings.update({ ai: { ...base, allowImages: true } });
  await settings.update({ ai: base });
  assert.equal(state.settings.ai.allowImages, true);

  // `.test` hosts count as local for the SSRF policy, so public examples use example.com.
  const lt = { enabled: true, baseUrl: 'https://lt.example.com', username: '', level: 'default' };
  const reject = async (input, field) =>
    assert.rejects(settings.update({ ai: base, languageTool: input }), (e) =>
      Boolean(e.details.fieldErrors[field])
    );
  await reject({ ...lt, baseUrl: 'http://127.0.0.1:8081' }, 'languageTool.baseUrl');
  await reject({ ...lt, baseUrl: 'http://lt.example.com' }, 'languageTool.baseUrl');
  await reject({ ...lt, baseUrl: 'https://lt.example.com/?token=1' }, 'languageTool.baseUrl');
  await reject({ ...lt, baseUrl: '' }, 'languageTool.baseUrl');
  await reject({ ...lt, apiKey: 'k' }, 'languageTool.username');
  await assert.rejects(settings.update({ ai: base, languageTool: { ...lt, extra: 1 } }));

  const saved = await settings.update({
    ai: base,
    languageTool: { ...lt, username: 'editor@example.test', apiKey: 'lt-secret' },
  });
  assert.equal(saved.languageTool.hasApiKey, true);
  assert.ok(!JSON.stringify(saved).includes('lt-secret'));
  assert.ok(!JSON.stringify(state.settings).includes('lt-secret'));
  assert.match(state.settings.languageTool.apiKeyEncrypted, /^v1:/);
  assert.equal((await settings.runtimeLanguageTool()).apiKey, 'lt-secret');
  await reject(
    { ...lt, username: 'editor@example.test', baseUrl: 'https://other.example.com' },
    'languageTool.apiKey'
  );
  // ai-only updates keep LanguageTool.
  await settings.update({ ai: base });
  assert.equal((await settings.runtimeLanguageTool()).apiKey, 'lt-secret');

  const local = fakeStrapi({ stored: {}, config: { 'languageTool.allowPrivateBaseUrl': true } });
  const ok = await local.settings.update({
    ai: base,
    languageTool: { ...lt, baseUrl: 'http://127.0.0.1:8081' },
  });
  assert.equal(ok.languageTool.baseUrl, 'http://127.0.0.1:8081');
});

test('settings form: switches and LanguageTool draft, payload and validation', () => {
  const ai = {
    enabled: true,
    provider: 'anthropic',
    baseUrl: '',
    model: 'm',
    maxInputChars: 8000,
    maxOutputTokens: 4096,
    allowImages: false,
    allowFieldActions: true,
  };
  const languageTool = {
    enabled: false,
    baseUrl: '',
    username: '',
    level: 'default',
    hasApiKey: false,
    canStoreApiKey: true,
  };
  const draft = toDraft(ai, languageTool);
  assert.equal(sameDraft(draft, toDraft(ai, languageTool)), true);
  assert.equal(sameDraft({ ...draft, allowImages: true }, draft), false);
  assert.equal(sameDraft({ ...draft, languageTool: { ...draft.languageTool, enabled: true } }, draft), false);
  const payload = toPayload({
    ...draft,
    languageTool: { ...draft.languageTool, baseUrl: 'https://lt.example.test/' },
  });
  assert.equal(payload.ai.allowFieldActions, true);
  assert.deepEqual(payload.languageTool, {
    enabled: false,
    baseUrl: 'https://lt.example.test',
    username: '',
    level: 'default',
  });
  const env = { languageTool: { allowPrivateBaseUrl: false } };
  const check = (patch, ctx = {}) =>
    validateLanguageTool(
      { ...draft.languageTool, ...patch },
      { saved: draft.languageTool, dto: languageTool, environment: env, ...ctx }
    );
  assert.deepEqual(check({}), {});
  assert.equal(check({ enabled: true })['languageTool.baseUrl'], 'required');
  assert.equal(check({ baseUrl: 'http://127.0.0.1' })['languageTool.baseUrl'], 'httpsLanguageTool');
  assert.equal(check({ baseUrl: 'https://x.example.test/?a=1' })['languageTool.baseUrl'], 'url');
  assert.equal(check({ apiKeyMode: 'replace', apiKey: 'k' })['languageTool.username'], 'required');
  assert.equal(
    check({ baseUrl: 'https://new.example.test' }, { dto: { ...languageTool, hasApiKey: true } })[
      'languageTool.apiKey'
    ],
    'reenterLanguageTool'
  );
});

test('grammar route: disableGrammar 403 and unknown field 404 before anything is sent', async () => {
  const grammarController = require('../server/src/controllers/grammar.js');
  const field = (options) => ({ type: 'json', customField: 'plugin::magic-editor-x.richtext', options });
  let sent = 0;
  const strapi = {
    components: {},
    contentType: (uid) =>
      uid === 'api::article.article'
        ? {
            attributes: {
              body: field({ preset: 'full', disableAi: true }),
              summary: field({ preset: 'basic', disableAi: true, disableGrammar: true }),
              title: { type: 'string' },
            },
          }
        : undefined,
    plugin: () => ({
      service: () => ({
        check: async () => {
          sent += 1;
          return { language: 'en-US', matches: [], truncated: false };
        },
      }),
    }),
  };
  const controller = grammarController({ strapi });
  const call = async (target) => {
    const ctx = {
      request: { body: { target, segments: [{ blockId: 'b1', path: 'text', html: 'Teh text' }] } },
      state: { user: { id: 1 } },
    };
    await controller.check(ctx);
    return ctx;
  };
  await assert.rejects(call({ uid: 'api::article.article', field: 'summary' }), (error) => {
    assert.equal(error.name, 'ForbiddenError');
    assert.equal(error.message, 'The grammar check is turned off for this field');
    return true;
  });
  await assert.rejects(call({ uid: 'api::article.article', field: 'title' }), { name: 'NotFoundError' });
  await assert.rejects(call({ uid: 'api::nope.nope', field: 'body' }), { name: 'NotFoundError' });
  assert.equal(sent, 0);
  // disableAi alone does not turn the grammar check off.
  const ok = await call({ uid: 'api::article.article', field: 'body' });
  assert.equal(ok.body.data.language, 'en-US');
  assert.equal(sent, 1);
});

test('2.3 routes are admin routes with their actions; grammar.use is registered', () => {
  const byPath = new Map(routes.admin.routes.map((route) => [`${route.method} ${route.path}`, route]));
  const expect = {
    'POST /ai/image/alt-text': [ACTIONS.access, ACTIONS.ai],
    'POST /ai/field/:action': [ACTIONS.access, ACTIONS.ai],
    'POST /grammar/check': [ACTIONS.access, ACTIONS.grammar],
    'POST /settings/language-tool/test': [ACTIONS.settingsRead, ACTIONS.settingsUpdate],
  };
  for (const [key, actions] of Object.entries(expect)) {
    const route = byPath.get(key);
    assert.ok(route, key);
    assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
    assert.deepEqual(route.config.policies[1].config.actions, actions);
  }
  assert.ok(ACTION_DEFINITIONS.some((action) => action.uid === 'grammar.use'));
});

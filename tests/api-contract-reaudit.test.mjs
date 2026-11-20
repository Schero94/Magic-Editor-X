/**
 * API contract fixes from the 2.7 API re-audit: `?mex=` leaves routes of
 * other plugins untouched, provider answers that are too large or not JSON
 * get their own codes, a listed private upload origin that resolves to a
 * metadata or link-local address is refused, and `data-strapi-source` has no
 * `locale` for entries of types without i18n. Synthetic hosts and data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const renderOutput = require('../server/src/middlewares/render-output.js');
const aiService = require('../server/src/services/ai.js');
const settingsService = require('../server/src/services/settings.js');
const { sendProviderError } = require('../server/src/controllers/ai.js');
const editorService = require('../server/src/services/editor.js');
const { walkOutput } = require('../server/src/utils/output-walk.js');

/* ------------------------------------------------------- ?mex= scope */

const ARTICLE = 'api::article.article';
const RICH = { type: 'customField', customField: 'plugin::magic-editor-x.richtext' };

const middlewareStrapi = (transformed) => ({
  config: { get: (key, fallback) => fallback },
  contentType: (uid) => (uid === ARTICLE ? { uid, attributes: { body: RICH } } : null),
  components: {},
  getModel: () => null,
  log: { error() {}, warn() {}, info() {} },
  plugin: () => ({
    service: () => ({
      transform: async (items, options) => {
        transformed.push(options);
        return items.map(() => `<p>${options.format}</p>`);
      },
    }),
  }),
});

/**
 * Runs the global middleware like Koa does: the router sets `ctx.state.route`
 * inside `next()`, after this middleware started.
 */
const request = async (mw, { path, query, route, body }) => {
  const ctx = { method: 'GET', path, query, headers: {}, status: 200, state: {} };
  await mw(ctx, async () => {
    ctx.state.route = route;
    ctx.body = body;
  });
  return ctx;
};

test('?mex= with an invalid value leaves routes of other plugins untouched; api routes answer 400', async () => {
  const transformed = [];
  const mw = renderOutput({}, { strapi: middlewareStrapi(transformed) });
  const upload = {
    handler: 'plugin::upload.content-api.find',
    info: { type: 'content-api', pluginName: 'upload' },
  };
  const files = [{ id: 1, name: 'photo.png' }];
  for (const query of [
    { mex: 'bogus' },
    { mex: ['html', 'text'] },
    { mex: '' },
    { mex: 'html', mexBlockIds: 'yes' },
  ]) {
    const ctx = await request(mw, { path: '/api/upload/files', query, route: upload, body: files });
    assert.equal(ctx.status, 200);
    assert.equal(ctx.body, files, `untouched for ${JSON.stringify(query)}`);
  }
  const i18n = {
    handler: 'plugin::i18n.locales.listLocales',
    info: { type: 'content-api', pluginName: 'i18n' },
  };
  const locales = await request(mw, {
    path: '/api/i18n/locales',
    query: { mex: 'bogus' },
    route: i18n,
    body: [],
  });
  assert.equal(locales.status, 200);

  const article = { handler: 'api::article.article.findOne', info: { type: 'content-api' } };
  for (const query of [{ mex: 'xml' }, { mex: 'html', mexBlockIds: 'yes' }]) {
    await assert.rejects(
      request(mw, { path: '/api/articles/abc', query, route: article, body: { data: { body: {} } } }),
      (error) => error.name === 'ValidationError' && ['mex', 'mexBlockIds'].includes(error.details.param)
    );
  }
  const ok = await request(mw, {
    path: '/api/articles/abc',
    query: { mex: 'html' },
    route: article,
    body: { data: { body: { blocks: [] } } },
  });
  assert.equal(ok.body.data.body, '<p>html</p>');
  assert.equal(transformed.length, 1);
});

/* ------------------------------------------------------- AI errors */

const aiStrapi = () => {
  const state = {
    ai: {
      enabled: true,
      provider: 'anthropic',
      baseUrl: '',
      model: 'claude-opus-5-5',
      maxInputChars: 8000,
      maxOutputTokens: 1024,
      apiKeyEncrypted: null,
    },
  };
  const strapi = {
    config: {
      get: (key) => (key === 'plugin::magic-editor-x.ai.apiKey' ? 'sk-env-SYNTHETIC' : undefined),
    },
    log: { warn() {}, error() {}, info() {} },
    store: () => ({ get: async () => state, set: async () => {} }),
    plugin: () => ({
      service: (name) => {
        if (name === 'settings') return settings;
        if (name === 'store') return { hit: async () => ({ count: 1 }) };
        return null;
      },
    }),
  };
  const settings = settingsService({ strapi });
  return strapi;
};

const providerFailure = async (statusCode) => {
  const service = aiService(
    { strapi: aiStrapi() },
    {
      fetchBounded: async () => {
        throw Object.assign(new Error('Remote response rejected'), { statusCode, code: 'URL_REJECTED' });
      },
    }
  );
  try {
    await service.run({ action: 'improve', text: 'Synthetic text' }, { id: 1 });
  } catch (error) {
    const ctx = {};
    assert.equal(sendProviderError(ctx, error), true);
    return ctx;
  }
  throw new Error('expected a provider error');
};

test('AI: an answer over the size limit or not JSON has its own code and message', async () => {
  const large = await providerFailure(413);
  assert.equal(large.status, 502);
  assert.equal(large.body.error.details.code, 'RESPONSE_TOO_LARGE');
  assert.equal(large.body.error.message, 'The AI provider answer is too large');
  const html = await providerFailure(415);
  assert.equal(html.body.error.details.code, 'BAD_RESPONSE');
  const down = await providerFailure(502);
  assert.equal(down.body.error.details.code, 'UNREACHABLE');
  assert.equal(down.body.error.message, 'The AI provider could not be reached');
  const slow = await providerFailure(504);
  assert.deepEqual([slow.status, slow.body.error.details.code], [504, 'TIMEOUT']);
});

/* ------------------------------------------------------- private upload origins */

const pngBytes = () => {
  const crc = (buffer) => zlib.crc32(buffer);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

test('uploads.allowPrivateOrigins: a listed host that resolves to a metadata address is refused; loopback works', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(pngBytes());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://media.internal:${port}`;
  const stored = [];
  let answer = [{ address: '169.254.169.254', family: 4 }];
  const strapi = {
    config: {
      get: (key) => (key === 'plugin::magic-editor-x.uploads.allowPrivateOrigins' ? [origin] : undefined),
    },
    log: { warn() {}, error() {}, info() {}, debug() {} },
    plugin: () => ({
      service: (name) =>
        name === 'upload'
          ? {
              upload: async ({ files }) => {
                stored.push(files.originalFilename);
                return [{ id: 1, url: `/uploads/${files.originalFilename}` }];
              },
            }
          : {},
    }),
  };
  const service = editorService({ strapi }, { lookup: async () => answer });
  try {
    await assert.rejects(service.uploadImageUrl(`${origin}/a.png`, { id: 1 }), (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    });
    answer = [{ address: 'fe80::1', family: 6 }];
    await assert.rejects(service.uploadMediaUrl(`${origin}/a.mp4`, 'video', { id: 1 }), (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    });
    assert.deepEqual(stored, []);
    // The same listed name on loopback (a test or intranet media server) still works, pinned to that address.
    answer = [{ address: '127.0.0.1', family: 4 }];
    const result = await service.uploadImageUrl(`${origin}/a.png`, { id: 1 });
    assert.equal(result.success, 1);
    assert.deepEqual(stored, ['a.png']);
  } finally {
    server.close();
  }
});

/* ------------------------------------------------------- data-strapi-source */

test('the source entry of a related type without i18n has no locale', () => {
  const CATEGORY = 'api::category.category';
  const strapi = {
    components: {},
    getModel: (uid) =>
      uid === CATEGORY ? { uid: CATEGORY, kind: 'collectionType', attributes: { body: RICH } } : null,
  };
  const schema = {
    uid: ARTICLE,
    kind: 'collectionType',
    pluginOptions: { i18n: { localized: true } },
    attributes: { body: RICH, category: { type: 'relation', target: CATEGORY } },
  };
  const seen = [];
  walkOutput(
    strapi,
    schema,
    { documentId: 'a1', locale: 'de', body: {}, category: { documentId: 'c1', body: {} } },
    (_holder, _key, _attribute, locale, where) =>
      seen.push([where.entry.documentId, where.entry.locale, locale])
  );
  // The reference lookup still knows the request's locale; the source map does not claim one.
  assert.deepEqual(seen, [
    ['a1', 'de', 'de'],
    ['c1', null, 'de'],
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const editorService = require('../server/src/services/editor.js');
const { validateHttpUrl, fetchBounded } = require('../server/src/utils/url-security.js');
const crypto = require('../server/src/utils/crypto.js');
const { createRateLimiter } = require('../server/src/utils/rate-limit.js');
const { cleanEditorValue, sanitizeInlineHtml } = require('../server/src/utils/sanitizer.js');
const { blockSchema } = require('../server/src/services/custom-blocks.js');
const config = require('../server/src/config/index.js');

const fakeStrapi = (pluginConfig = {}) => ({
  config: {
    get: (key) => (key.startsWith('plugin::magic-editor-x.') ? pluginConfig[key.slice(23)] : undefined),
  },
});

test('link preview reads Open Graph data through the bounded fetcher', async () => {
  const html =
    '<html><head><meta property="og:title" content="Synthetic title"><meta property="og:image" content="/og.png"></head></html>';
  const service = editorService(
    { strapi: fakeStrapi() },
    {
      fetchBounded: async (url, options) => {
        assert.deepEqual(options.allowedMimeTypes, ['text/html', 'application/xhtml+xml']);
        return { url: new URL(url), body: Buffer.from(html), mimeType: 'text/html' };
      },
    }
  );
  const result = await service.linkPreview('https://example.com/page');
  assert.equal(result.success, 1);
  assert.equal(result.meta.title, 'Synthetic title');
  assert.equal(result.meta.image.url, 'https://example.com/og.png');
});

test('link preview can be turned off', async () => {
  const service = editorService({ strapi: fakeStrapi({ 'linkPreview.enabled': false }) });
  await assert.rejects(service.linkPreview('https://example.com'), (error) => error.statusCode === 404);
});

test('URL policy rejects private, local and credential URLs', () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/',
    'http://[::ffff:10.0.0.1]/',
    'http://a.localhost/',
    'ftp://example.com/',
    'http://u:p@example.com/',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => validateHttpUrl(url), /URL|allowed|addresses/, url);
  }
  assert.equal(validateHttpUrl('https://example.com/x').hostname, 'example.com');
  assert.equal(validateHttpUrl('http://127.0.0.1:11434/', { allowPrivate: true }).port, '11434');
});

test('redirects to private addresses are refused', async () => {
  await assert.rejects(
    fetchBounded('https://example.com/start', {
      maxBytes: 100,
      resolve: async (host) => [
        { address: host === 'example.com' ? '93.184.216.34' : '10.0.0.5', family: 4 },
      ],
      request: async () => ({
        statusCode: 302,
        headers: { location: 'http://internal.example/' },
        body: Buffer.alloc(0),
      }),
    }),
    /public addresses/
  );
});

test('secrets: AES-GCM round trip, wrong key and tampering fail, tokens expire', () => {
  const key = 'k'.repeat(40);
  const sealed = crypto.encryptSecret('sk-synthetic', key);
  assert.match(sealed, /^v1:/);
  assert.equal(crypto.decryptSecret(sealed, key), 'sk-synthetic');
  assert.equal(crypto.decryptSecret(sealed, 'x'.repeat(40)), null);
  // Tamper with the last character (always to a different one; replacing it
  // with a fixed letter was a no-op in 1 of 64 runs).
  const tampered = sealed.slice(0, -1) + (sealed.endsWith('A') ? 'B' : 'A');
  assert.equal(crypto.decryptSecret(tampered, key), null);
  const tokenKey = Buffer.alloc(32, 1);
  const token = crypto.signToken({ room: 'r', exp: Date.now() + 1000 }, tokenKey);
  assert.equal(crypto.verifyToken(token, tokenKey).room, 'r');
  assert.equal(crypto.verifyToken(token, Buffer.alloc(32, 2)), null);
  assert.equal(crypto.verifyToken(token, tokenKey, Date.now() + 5000), null);
});

test('rate limiter counts per key and window', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limiter.hit('a', 0).allowed, true);
  assert.equal(limiter.hit('a', 1).allowed, true);
  assert.equal(limiter.hit('a', 2).allowed, false);
  assert.equal(limiter.hit('b', 2).allowed, true);
  assert.equal(limiter.hit('a', 1001).allowed, true);
});

test('server sanitiser keeps editor markup and removes active content', () => {
  assert.equal(
    sanitizeInlineHtml(
      '<b>x</b><img src=x onerror=alert(1)><a href="javascript:1">y</a><a href="//evil.example">z</a><mark class="cdx-marker evil">m</mark>'
    ),
    '<b>x</b><a>y</a><a>z</a><mark class="cdx-marker">m</mark>'
  );
  const clean = cleanEditorValue(
    { blocks: [{ id: 'a', type: 'raw', data: { html: '<p>ok</p><script>x</script>' } }] },
    { rawHtml: 'sanitize' }
  );
  assert.equal(clean.blocks[0].data.html, '<p>ok</p>');
  const allowed = cleanEditorValue(
    { blocks: [{ id: 'a', type: 'raw', data: { html: '<script>x</script>' } }] },
    { rawHtml: 'allow' }
  );
  assert.equal(allowed.blocks[0].data.html, '<script>x</script>');
});

test('sanitising is idempotent and fast on adversarial input', () => {
  const once = sanitizeInlineHtml('<b><i>a</b></i> & <u class="cdx-underline">u</u>');
  assert.equal(sanitizeInlineHtml(once), once);
  const started = Date.now();
  sanitizeInlineHtml('<'.repeat(50000) + 'a'.repeat(50000));
  assert.ok(Date.now() - started < 1000);
});

test('custom block schema rejects reserved names, unknown keys and duplicate fields', () => {
  assert.equal(blockSchema.safeParse({ name: 'header', label: 'x', blockType: 'simple' }).success, false);
  assert.equal(
    blockSchema.safeParse({ name: 'card', label: 'x', blockType: 'simple', extra: 1 }).success,
    false
  );
  assert.equal(
    blockSchema.safeParse({
      name: 'card',
      label: 'x',
      blockType: 'simple',
      fields: [
        { name: 'a', label: 'A', type: 'text' },
        { name: 'a', label: 'B', type: 'text' },
      ],
    }).success,
    false
  );
  assert.equal(blockSchema.safeParse({ name: 'card', label: 'Card', blockType: 'simple' }).success, true);
});

test('config defaults pass the validator and wrong types fail', () => {
  config.validator(config.default);
  assert.throws(
    () =>
      config.validator({
        ...config.default,
        collaboration: { ...config.default.collaboration, pollIntervalMs: 1 },
      }),
    /collaboration.pollIntervalMs/
  );
});

test('upload signatures: images and attachments are recognised by content', () => {
  const { detectImageMime, matchesAttachmentSignature, safeFilename } = editorService;
  assert.equal(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(detectImageMime(Buffer.from('<svg')), null);
  assert.equal(matchesAttachmentSignature('.pdf', 'application/pdf', Buffer.from('%PDF-1.4')), true);
  assert.equal(matchesAttachmentSignature('.pdf', 'application/pdf', Buffer.from('MZ')), false);
  assert.equal(safeFilename('../../etc/passwd', 'x'), 'passwd');
});

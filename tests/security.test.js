'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const adminRoutes = require('../server/src/routes/admin');
const contentApiRoutes = require('../server/src/routes/content-api');
const { isPublicAddress, validateHttpUrl, fetchBounded } = require('../server/src/utils/url-security');

const endpointHandlers = [
  'editor.fetchLinkMeta',
  'editor.uploadByFile',
  'editor.uploadByUrl',
  'editor.uploadFile',
];

test('all preview and upload endpoints are authenticated admin routes', () => {
  const moved = adminRoutes.routes.filter(({ handler }) => endpointHandlers.includes(handler));
  assert.equal(moved.length, endpointHandlers.length);

  for (const route of moved) {
    assert.ok(route.config.policies.includes('admin::isAuthenticatedAdmin'), `${route.handler} must require an admin`);
    assert.notEqual(route.config.auth, false, `${route.handler} must not disable authentication`);
    if (route.handler !== 'editor.fetchLinkMeta') {
      assert.ok(route.config.policies.some((policy) => policy.name === 'admin::hasPermissions'
        && policy.config.actions.includes('plugin::upload.assets.create')), `${route.handler} must require media-create permission`);
    }
  }

  assert.equal(contentApiRoutes.routes.length, 0, 'public Content API routes must not expose these handlers');
});

test('public address check rejects local, private, link-local, and reserved ranges', () => {
  for (const address of [
    '127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1',
    '::ffff:127.0.0.1', '64:ff9b:1::1',
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} must not be reachable through URL fetches`);
  }

  for (const address of ['1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, `${address} is a public unicast address`);
  }
});

test('URL validation accepts only scalar HTTP(S) URLs without credentials or local literals', () => {
  assert.equal(validateHttpUrl('https://example.com/article').hostname, 'example.com');
  for (const url of [
    ['https://example.com'],
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'http://127.0.0.1/',
    'https://localhost/',
    'https://service.internal/',
    'http://2130706433/',
  ]) {
    assert.throws(() => validateHttpUrl(url));
  }
});

test('bounded fetch revalidates redirect destinations and never follows private targets', async () => {
  const requests = [];
  const fakeRequest = async (url, { address }) => {
    requests.push(url.href);
    assert.equal(address, '93.184.216.34');
    return requests.length === 1
      ? { statusCode: 302, headers: { location: 'http://127.0.0.1/admin' }, body: Buffer.alloc(0) }
      : { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('ok') };
  };

  await assert.rejects(
    fetchBounded('https://example.com/start', {
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      request: fakeRequest,
      maxBytes: 16,
      allowedMimeTypes: ['text/plain'],
    }),
    /private|local|public/i,
  );
  assert.deepEqual(requests, ['https://example.com/start']);
});

test('bounded fetch rejects oversized and disallowed response bodies', async () => {
  const options = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ statusCode: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.alloc(8) }),
    maxBytes: 4,
    allowedMimeTypes: ['text/plain'],
  };

  await assert.rejects(fetchBounded('https://example.com/', options), /size|large|limit/i);
});

test('bounded fetch pins each validated DNS result and checks response MIME', async () => {
  let requestedAddress;
  const result = await fetchBounded('https://example.com/', {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (_url, options) => {
      requestedAddress = options.address;
      return { statusCode: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: Buffer.from('ok') };
    },
    maxBytes: 16,
    allowedMimeTypes: ['text/plain'],
  });
  assert.equal(requestedAddress, '93.184.216.34');
  assert.equal(result.mimeType, 'text/plain');

  await assert.rejects(fetchBounded('https://example.com/', {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
    request: async () => assert.fail('must reject mixed public/private DNS results before request'),
    maxBytes: 16,
    allowedMimeTypes: ['text/plain'],
  }), /public addresses/i);
});

test('bounded fetch resolves and rejects a private DNS answer at a redirect target', async () => {
  const resolvedHosts = [];
  const requestedUrls = [];
  await assert.rejects(fetchBounded('https://public.example/start', {
    resolve: async (hostname) => {
      resolvedHosts.push(hostname);
      return [{ address: hostname === 'private-target.example' ? '10.1.2.3' : '93.184.216.34', family: 4 }];
    },
    request: async (url) => {
      requestedUrls.push(url.href);
      return { statusCode: 302, headers: { location: 'https://private-target.example/metadata' }, body: Buffer.alloc(0) };
    },
    maxBytes: 16,
    allowedMimeTypes: ['text/plain'],
  }), /public addresses/i);
  assert.deepEqual(resolvedHosts, ['public.example', 'private-target.example']);
  assert.deepEqual(requestedUrls, ['https://public.example/start']);
});

test('editor services require an admin before fetching or uploading', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  let calls = 0;
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({ upload: async () => { calls += 1; return []; } }) }),
  };
  const service = createEditorService({ strapi }, { fetchBounded: async () => { calls += 1; } });

  await assert.rejects(service.fetchLinkMeta('https://example.com/'), /authenticated Strapi admin/i);
  await assert.rejects(service.uploadByUrl('https://example.com/image.png'), /authenticated Strapi admin/i);
  await assert.rejects(service.uploadByFile({ request: { files: {} } }), /authenticated Strapi admin/i);
  assert.equal(calls, 0);
});

test('image uploads require matching raster signatures and remote fetches never contact real hosts in tests', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-x-test-'));
  const imagePath = path.join(directory, 'fake.png');
  await fs.writeFile(imagePath, Buffer.from('not an image'));
  let uploadCalls = 0;
  let fetchCalls = 0;
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({ upload: async () => { uploadCalls += 1; return [{ url: '/uploads/fake.png' }]; } }) }),
  };
  const service = createEditorService({ strapi }, {
    fetchBounded: async () => {
      fetchCalls += 1;
      return { url: new URL('https://example.com/image.png'), mimeType: 'image/png', body: Buffer.from('invalid') };
    },
  });
  const ctx = { state: { user: { id: 4 } }, request: { files: { 'files.image': { path: imagePath, name: 'fake.png', type: 'image/png' } } } };

  try {
    await assert.rejects(service.uploadByFile(ctx), /raster image/i);
    await assert.rejects(service.uploadByUrl('https://example.com/image.png', { state: { user: { id: 4 } } }), /raster image/i);
    assert.equal(uploadCalls, 0);
    assert.equal(fetchCalls, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('authorized link previews parse the bounded HTML result without letting the scraper fetch URLs', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  let fetchedUrl;
  let parsedHtml;
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({}) }),
  };
  const service = createEditorService({ strapi }, {
    fetchBounded: async (url, options) => {
      fetchedUrl = { url, options };
      return { body: Buffer.from('<html><head><meta property="og:title" content="Local preview"></head></html>') };
    },
    ogs: async (options) => {
      parsedHtml = options.html;
      return { error: false, result: { ogTitle: 'Local preview', ogUrl: 'https://example.com/article' } };
    },
  });
  const result = await service.fetchLinkMeta('https://example.com/article', { state: { user: { id: 2 } } });

  assert.equal(fetchedUrl.url, 'https://example.com/article');
  assert.deepEqual(fetchedUrl.options.allowedMimeTypes, ['text/html', 'application/xhtml+xml']);
  assert.match(parsedHtml, /Local preview/);
  assert.equal(result.success, 1);
  assert.equal(result.meta.title, 'Local preview');
});

test('image file size honors plugin config and rejects over-limit files before media upload', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-x-size-test-'));
  const imagePath = path.join(directory, 'image.png');
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
  let uploadCalls = 0;
  const strapi = {
    config: { get: () => ({ maxImageSize: 4 }) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({ upload: async () => { uploadCalls += 1; return []; } }) }),
  };
  const service = createEditorService({ strapi });
  try {
    await assert.rejects(service.uploadByFile({
      state: { user: { id: 1 } },
      request: { files: { 'files.image': { path: imagePath, name: 'image.png', type: 'image/png' } } },
    }), (error) => error.statusCode === 413);
    assert.equal(uploadCalls, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('URL upload removes its private temporary directory after an upload failure', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-x-cleanup-test-'));
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({ upload: async ({ files }) => {
      assert.equal((await fs.stat(files.filepath)).isFile(), true);
      throw new Error('simulated local upload failure');
    } }) }),
  };
  const service = createEditorService({ strapi }, {
    tempRoot,
    fetchBounded: async () => ({ url: new URL('https://example.com/image.png'), mimeType: 'image/png', body: validPng }),
  });

  try {
    await assert.rejects(service.uploadByUrl('https://example.com/image.png', { state: { user: { id: 4 } } }), /simulated local upload failure/);
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('successful admin image upload assigns the Strapi creator and preserves the EditorJS response', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-x-owner-test-'));
  const imagePath = path.join(directory, 'image.png');
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]));
  const admin = { id: 27 };
  let uploadOptions;
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({ upload: async (request, options) => {
      uploadOptions = { request, options };
      return [{ url: '/uploads/image.png', name: 'image.png', size: 12, width: 1, height: 1, mime: 'image/png' }];
    } }) }),
  };
  const service = createEditorService({ strapi });

  try {
    const result = await service.uploadByFile({
      state: { user: admin },
      request: { files: { 'files.image': { path: imagePath, name: 'image.png', type: 'image/png' } } },
    });
    assert.equal(uploadOptions.options.user, admin);
    assert.equal(uploadOptions.request.files.filepath, imagePath);
    assert.deepEqual(result.file, {
      url: '/uploads/image.png', name: 'image.png', size: 12, width: 1, height: 1, mime: 'image/png', formats: undefined,
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('attachment upload requires an allowlisted extension, MIME, and matching file signature', async () => {
  const createEditorService = require('../server/src/services/editor-service');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-x-attachment-test-'));
  const filePath = path.join(directory, 'document.pdf');
  await fs.writeFile(filePath, Buffer.from('%PDF-1.7 local fixture'));
  let uploadCalls = 0;
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: () => ({ upload: async (_request, options) => {
      uploadCalls += 1;
      assert.equal(options.user.id, 9);
      return [{ url: '/uploads/document.pdf', name: 'document.pdf', size: 1 }];
    } }) }),
  };
  const service = createEditorService({ strapi });
  const ctx = (name, type) => ({
    state: { user: { id: 9 } },
    request: { files: { file: { path: filePath, name, type } } },
  });

  try {
    await assert.rejects(service.uploadAttachment(ctx('document.pdf', 'text/plain')), /type is not supported/i);
    await assert.rejects(service.uploadAttachment(ctx('document.html', 'application/pdf')), /type is not supported/i);
    assert.equal(uploadCalls, 0);
    const result = await service.uploadAttachment(ctx('document.pdf', 'application/pdf'));
    assert.equal(uploadCalls, 1);
    assert.equal(result.file.url, '/uploads/document.pdf');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('collaboration session creation denies anonymous and unapproved admins before issuing a token', async () => {
  const createRealtimeController = require('../server/src/controllers/realtime-controller');
  let issueCalls = 0;
  let allowed = false;
  const strapi = {
    config: { get: () => ({}) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    plugin: () => ({ service: (name) => {
      if (name === 'accessService') return { canUseCollaboration: async () => ({ allowed, reason: 'permission-required' }) };
      return { issueSession: () => { issueCalls += 1; return { token: 'fake-session' }; } };
    } }),
  };
  const controller = createRealtimeController({ strapi });
  const context = (user) => ({
    request: { body: { roomId: 'api::article.article|doc-1|body', fieldName: 'body' }, header: {} },
    state: { user },
    unauthorized: (message) => ({ status: 401, message }),
    forbidden: (message) => ({ status: 403, message }),
  });

  assert.equal((await controller.createSession(context(null))).status, 401);
  const denied = await controller.createSession(context({ id: 7, email: 'admin@example.test' }));
  assert.equal(denied.status, 403);
  assert.equal(issueCalls, 0);

  allowed = true;
  const authorized = context({ id: 7, email: 'admin@example.test' });
  await controller.createSession(authorized);
  assert.equal(issueCalls, 1);
  assert.equal(authorized.body.token, 'fake-session');
});

test('custom block limits enforce both per-type and total caps', () => {
  const createCustomBlockService = require('../server/src/services/custom-block-service');
  const service = createCustomBlockService({ strapi: {} });
  const config = { maxSimple: 2, maxEmbedded: 1, maxTotal: 3 };

  assert.equal(service._canCreateBlockType('simple', { simple: 1, 'embedded-entry': 1, total: 2 }, config), true);
  assert.equal(service._canCreateBlockType('simple', { simple: 2, 'embedded-entry': 0, total: 2 }, config), false);
  assert.equal(service._canCreateBlockType('embedded-entry', { simple: 1, 'embedded-entry': 1, total: 2 }, config), false);
  assert.equal(service._canCreateBlockType('simple', { simple: 2, 'embedded-entry': 1, total: 3 }, config), false);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createParseEditorFieldsMiddleware = require('../server/src/middlewares/parse-editor-fields');

const makeMiddleware = () => createParseEditorFieldsMiddleware({}, {
  strapi: {
    config: { get: (_key, fallback) => fallback },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  },
});

test('does not rewrite the Strapi admin static file stream as a JSON object', async () => {
  const fileHandle = {
    path: '/admin/index.html',
    _readableState: { buffer: [], length: 0 },
    close() {},
  };
  const ctx = {
    method: 'GET',
    status: 200,
    path: '/admin',
    request: { path: '/admin' },
    response: { type: 'text/html' },
    body: fileHandle,
  };

  await makeMiddleware()(ctx, async () => {});

  assert.strictEqual(ctx.body, fileHandle);
});

test('parses Editor.js fields only in JSON Content API responses', async () => {
  const ctx = {
    method: 'GET',
    status: 200,
    path: '/api/articles/1',
    request: { path: '/api/articles/1' },
    response: { type: 'application/json' },
    body: { data: { editor: '{"time":123,"blocks":[]}' } },
  };

  await makeMiddleware()(ctx, async () => {});

  assert.deepEqual(ctx.body.data.editor, { time: 123, blocks: [] });
});

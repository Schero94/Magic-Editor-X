/**
 * MCP integration (2.5) against the host's `/mcp` endpoint (Strapi's MCP
 * server, Streamable HTTP, stateless): raw JSON-RPC over HTTP POST, the
 * transport Strapi uses. The host runs with `server.mcp.enabled: true` and the
 * plugin option `mcp.enabled: true`; with `MEX_MCP_EXPECT=off` (host started
 * with `mcp.enabled: false`) the suite checks that nothing is exposed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, HOST } from './helpers.mjs';

const RUN = Date.now().toString(36);
const EXPECT_OFF = process.env.MEX_MCP_EXPECT === 'off';
const MEX_TOOLS = ['mex_from_html', 'mex_from_markdown', 'mex_render', 'mex_validate'];
const SECRET = 'Synthetic secret sentence';
const created = { admin: [], api: [] };
let rpcId = 0;

/**
 * Sends one JSON-RPC request to /mcp and parses the JSON or SSE answer.
 * @param {string|null} key - Bearer token.
 * @param {string} method - JSON-RPC method.
 * @param {object} [params] - Params.
 * @returns {Promise<{ status: number, message: any }>} HTTP status and the JSON-RPC message.
 */
const rpc = async (key, method, params) => {
  rpcId += 1;
  const response = await fetch(`${HOST}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, ...(params ? { params } : {}) }),
  });
  const text = await response.text();
  let message;
  if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .pop();
    message = data ? JSON.parse(data) : null;
  } else {
    try {
      message = JSON.parse(text);
    } catch {
      message = text;
    }
  }
  return { status: response.status, message };
};

/**
 * Creates an admin token with the given admin permissions (removed after the run).
 * @param {string} name - Name part.
 * @param {Array<object>} permissions - Admin permissions.
 * @returns {Promise<string>} Access key.
 */
const adminToken = async (name, permissions) => {
  const response = await call('POST', '/admin/admin-tokens', {
    token: await tokenFor('admin'),
    body: {
      name: `mex-mcp-${name}-${RUN}`,
      description: 'integration',
      lifespan: null,
      adminPermissions: permissions,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  created.admin.push(response.body.data.id);
  return response.body.data.accessKey;
};

const P = (action, subject = null) => ({ action, subject, properties: {}, conditions: [] });
const MCP_USE = P('plugin::magic-editor-x.mcp.use');

const keys = {};

test.before(async () => {
  keys.mcp = await adminToken('use', [MCP_USE]);
  keys.other = await adminToken('cm-only', [
    P('plugin::content-manager.explorer.read', 'api::article.article'),
  ]);
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: { name: `mex-mcp-content-${RUN}`, type: 'full-access', lifespan: null, description: 'integration' },
  });
  assert.equal(response.status, 201);
  created.api.push(response.body.data.id);
  keys.contentApi = response.body.data.accessKey;
});

test.after(async () => {
  const token = await tokenFor('admin');
  for (const id of created.admin) await call('DELETE', `/admin/admin-tokens/${id}`, { token });
  for (const id of created.api) await call('DELETE', `/admin/api-tokens/${id}`, { token });
});

/**
 * Calls a tool and returns the JSON-RPC result.
 * @param {string} key - Token.
 * @param {string} name - Tool.
 * @param {object} args - Arguments.
 * @returns {Promise<any>} Result.
 */
const tool = async (key, name, args) => {
  const { status, message } = await rpc(key, 'tools/call', { name, arguments: args });
  assert.equal(status, 200);
  return message;
};

test('no token, an invalid token and a Content API token are rejected', async () => {
  for (const key of [null, 'not-a-token', keys.contentApi]) {
    const { status, message } = await rpc(key, 'tools/list');
    assert.equal(status, 401);
    assert.equal(message.error.code, -32000);
    assert.equal(message.error.message, 'Authentication required');
  }
});

test('initialize advertises tools, resources and prompts', async () => {
  const { status, message } = await rpc(keys.mcp, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mex-integration', version: '1' },
  });
  assert.equal(status, 200);
  assert.ok(message.result.capabilities.tools);
  if (!EXPECT_OFF) {
    assert.ok(message.result.capabilities.resources);
    assert.ok(message.result.capabilities.prompts);
  }
});

test(
  'a token with mcp.use lists exactly the Magic Editor X tools, resources and prompt',
  { skip: EXPECT_OFF },
  async () => {
    const tools = (await rpc(keys.mcp, 'tools/list')).message.result.tools;
    assert.deepEqual(tools.map((entry) => entry.name).sort(), MEX_TOOLS);
    const markdown = tools.find((entry) => entry.name === 'mex_from_markdown');
    assert.equal(markdown.inputSchema.properties.markdown.maxLength, 1000000);
    assert.deepEqual(markdown.inputSchema.properties.preset.enum, ['full', 'article', 'basic', 'minimal']);
    assert.equal(markdown.inputSchema.additionalProperties, false);
    assert.ok(markdown.outputSchema);
    const resources = (await rpc(keys.mcp, 'resources/list')).message.result.resources;
    assert.deepEqual(
      resources.map((entry) => entry.uri).sort(),
      ['article', 'basic', 'full', 'minimal'].map((name) => `magic-editor-x://presets/${name}/schema`)
    );
    const prompts = (await rpc(keys.mcp, 'prompts/list')).message.result.prompts;
    assert.deepEqual(
      prompts.map((entry) => entry.name),
      ['mex_content_guide']
    );
  }
);

test(
  'tools convert, validate and render without reading or writing entries',
  { skip: EXPECT_OFF },
  async () => {
    const admin = await tokenFor('admin');
    const count = async () =>
      (
        await call('GET', '/content-manager/collection-types/api::article.article?page=1&pageSize=1', {
          token: admin,
        })
      ).body.pagination.total;
    const before = await count();
    const converted = await tool(keys.mcp, 'mex_from_markdown', {
      markdown: `# Title\n\n${SECRET} with **bold** <script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |`,
      preset: 'basic',
    });
    const value = converted.result.structuredContent.value;
    assert.equal(converted.result.isError, undefined);
    assert.equal(value.blocks[0].type, 'header');
    assert.equal(value.blocks[0].data.level, 2);
    assert.ok(value.blocks.every((block) => block.type !== 'table'));
    assert.doesNotMatch(JSON.stringify(value), /<script/);
    assert.ok(converted.result.structuredContent.fixed >= 1);

    const html = await tool(keys.mcp, 'mex_from_html', { html: '<h2>Hi</h2><p onclick="x()">there</p>' });
    assert.deepEqual(
      html.result.structuredContent.value.blocks.map((block) => block.type),
      ['header', 'paragraph']
    );
    assert.doesNotMatch(JSON.stringify(html.result.structuredContent), /onclick/);

    const valid = await tool(keys.mcp, 'mex_validate', { value, preset: 'basic' });
    assert.equal(valid.result.structuredContent.valid, true);
    assert.deepEqual(valid.result.structuredContent.issues, []);
    const invalid = await tool(keys.mcp, 'mex_validate', {
      value: { blocks: [{ id: 'w', type: 'warning', data: { title: SECRET, message: 'x' } }] },
      preset: 'minimal',
    });
    assert.equal(invalid.result.structuredContent.valid, false);
    assert.equal(invalid.result.structuredContent.issues.at(-1).code, 'BLOCK_NOT_ALLOWED');
    assert.ok(!JSON.stringify(invalid.result.structuredContent.issues).includes(SECRET));

    const rendered = await tool(keys.mcp, 'mex_render', { value, format: 'markdown' });
    assert.match(rendered.result.structuredContent.output, /^## Title/);
    const htmlOut = await tool(keys.mcp, 'mex_render', { value });
    assert.match(htmlOut.result.structuredContent.output, /^<h2 class="mex-header">Title<\/h2>/);
    assert.equal(await count(), before);
  }
);

test('invalid and oversized arguments are refused', { skip: EXPECT_OFF }, async () => {
  const strict = await tool(keys.mcp, 'mex_from_markdown', { markdown: 'x', extra: 1 });
  assert.equal(strict.result.isError, true);
  assert.match(strict.result.content[0].text, /Input validation error|Invalid/i);
  const preset = await tool(keys.mcp, 'mex_validate', { value: null, preset: 'nope' });
  assert.equal(preset.result.isError, true);
  const tooMany = await tool(keys.mcp, 'mex_render', {
    value: { time: 0, blocks: [{}, {}], version: '1' },
    format: 'pdf',
  });
  assert.equal(tooMany.result.isError, true);
  // Above the plugin limit (1,000,000 characters) and Strapi's JSON body limit: never a success.
  const big = await rpc(keys.mcp, 'tools/call', {
    name: 'mex_from_markdown',
    arguments: { markdown: 'x'.repeat(1000001) },
  });
  assert.ok(
    big.status !== 200 || big.message.error || big.message.result.isError === true,
    `status ${big.status}`
  );
  const host = await fetch(`${HOST}/_health`);
  assert.equal(host.status, 204);
});

test('a slow input is stopped after 10 s while the host keeps answering', { skip: EXPECT_OFF }, async () => {
  const started = Date.now();
  // Long emphasis delimiter runs take super-linear time in marked; the call runs in a worker thread.
  const slow = rpc(keys.mcp, 'tools/call', {
    name: 'mex_from_markdown',
    arguments: { markdown: '_a_'.repeat(150000) },
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const healthStarted = Date.now();
  const health = await fetch(`${HOST}/_health`);
  assert.equal(health.status, 204);
  assert.ok(Date.now() - healthStarted < 1000, `health took ${Date.now() - healthStarted} ms`);
  const { message } = await slow;
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /^TIMEOUT: /);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 9000 && elapsed < 20000, `elapsed ${elapsed} ms`);
  const after = await tool(keys.mcp, 'mex_render', { value: null });
  assert.equal(after.result.structuredContent.output, '');
});

test(
  'preset resources hold the JSON Schema and the prompt explains the workflow',
  { skip: EXPECT_OFF },
  async () => {
    const read = await rpc(keys.mcp, 'resources/read', { uri: 'magic-editor-x://presets/minimal/schema' });
    const content = read.message.result.contents[0];
    assert.equal(content.mimeType, 'application/schema+json');
    const schema = JSON.parse(content.text);
    assert.deepEqual(schema.$defs.block.properties.type.enum, ['paragraph', 'list']);
    assert.equal(schema['x-mex-preset'].name, 'minimal');
    const prompt = await rpc(keys.mcp, 'prompts/get', {
      name: 'mex_content_guide',
      arguments: { preset: 'basic' },
    });
    assert.match(prompt.message.result.messages[0].content.text, /Preset "basic"/);
    assert.match(prompt.message.result.messages[0].content.text, /mex_validate/);
  }
);

test('a token without mcp.use sees and runs none of the Magic Editor X capabilities', async () => {
  const tools = (await rpc(keys.other, 'tools/list')).message.result.tools.map((entry) => entry.name);
  assert.ok(tools.length > 0, 'the Content Manager tools of the token are listed');
  for (const name of MEX_TOOLS) assert.ok(!tools.includes(name), name);
  const called = await rpc(keys.other, 'tools/call', { name: 'mex_validate', arguments: { value: null } });
  assert.ok(called.message.error || called.message.result.isError === true);
  const resources = await rpc(keys.other, 'resources/list');
  const listed = resources.message.result ? resources.message.result.resources : [];
  assert.ok(listed.every((entry) => !entry.uri.startsWith('magic-editor-x://')));
  const read = await rpc(keys.other, 'resources/read', { uri: 'magic-editor-x://presets/full/schema' });
  assert.ok(read.message.error, 'resource read is refused');
  const prompt = await rpc(keys.other, 'prompts/get', { name: 'mex_content_guide' });
  assert.ok(prompt.message.error, 'prompt is refused');
});

test(
  'with mcp.enabled off nothing is exposed, even to a token with mcp.use',
  { skip: !EXPECT_OFF },
  async () => {
    const tools = (await rpc(keys.mcp, 'tools/list')).message.result.tools.map((entry) => entry.name);
    for (const name of MEX_TOOLS) assert.ok(!tools.includes(name), name);
    const called = await rpc(keys.mcp, 'tools/call', { name: 'mex_validate', arguments: { value: null } });
    assert.ok(called.message.error || called.message.result.isError === true);
    const settings = await call('GET', '/magic-editor-x/settings', { token: await tokenFor('admin') });
    assert.equal(settings.status, 200);
    assert.deepEqual(settings.body.data.environment.mcp, {
      enabled: false,
      serverEnabled: true,
      active: false,
      path: '/mcp',
    });
  }
);

test('Settings > Configuration reports the MCP status without secrets', { skip: EXPECT_OFF }, async () => {
  const settings = await call('GET', '/magic-editor-x/settings', { token: await tokenFor('admin') });
  assert.equal(settings.status, 200);
  assert.deepEqual(settings.body.data.environment.mcp, {
    enabled: true,
    serverEnabled: true,
    active: true,
    path: '/mcp',
  });
});

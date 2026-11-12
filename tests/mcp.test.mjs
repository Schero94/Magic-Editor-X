import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildPresetSchema } from '../shared/preset-schema.mjs';
import { buildEditorSchema, BLOCK_DATA_SCHEMAS } from '../shared/schema.mjs';
import { resolveFieldPreset, PRESET_NAMES } from '../shared/presets.mjs';
import { validate } from '../shared/json-schema-check.mjs';

const require = createRequire(import.meta.url);
const tools = require('../server/src/utils/mcp-tools.js');
const { registerMcp, mcpStatus, resetMcp, TOOLS } = require('../server/src/mcp.js');
const { createRunner } = require('../server/src/utils/mcp-runner.js');
const { ACTIONS, ACTION_DEFINITIONS } = require('../server/src/permissions.js');
const config = require('../server/src/config/index.js');

const handlers = tools.createHandlers({ rawHtml: () => 'sanitize' });
const SECRET = 'Synthetic secret sentence';

/**
 * Parses tool arguments the way the MCP SDK does before calling a handler.
 * @param {string} key - Tool key.
 * @param {object} args - Raw arguments.
 * @returns {object} Parsed arguments.
 */
const parse = (key, args) => tools.INPUT_SCHEMAS[key].parse(args);

/**
 * Runs a handler and checks its structured output against the advertised output schema.
 * @param {string} key - Tool key.
 * @param {object} args - Raw arguments.
 * @returns {object} Tool result.
 */
const call = (key, args) => {
  const result = handlers[key](parse(key, args));
  if (!result.isError) tools.OUTPUT_SCHEMAS[key].parse(result.structuredContent);
  return result;
};

const MARKDOWN = [
  '# Title',
  '',
  'Hello **world** with a [link](https://example.test/a) and <script>alert(1)</script>.',
  '',
  '- one',
  '- two',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '![A cat](https://example.test/cat.png)',
].join('\n');

test('mex_from_markdown converts with the save-path sanitiser and keeps the full preset as is', () => {
  const result = call('fromMarkdown', { markdown: MARKDOWN });
  const { value, violations, fixed, removed, notes, stats } = result.structuredContent;
  assert.deepEqual(
    value.blocks.map((block) => block.type),
    ['header', 'paragraph', 'list', 'codeFlask', 'image']
  );
  assert.equal(value.blocks[0].data.level, 1);
  assert.doesNotMatch(JSON.stringify(value), /<script/);
  assert.deepEqual(violations, []);
  assert.equal(fixed, 0);
  assert.equal(removed, 0);
  assert.ok(notes.some((note) => note.startsWith('images-not-uploaded')));
  assert.equal(stats.blocks, 5);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test('mex_from_markdown applies the automatic preset fixes and reports what is left', () => {
  const fixedResult = call('fromMarkdown', { markdown: MARKDOWN, preset: 'basic' }).structuredContent;
  assert.ok(fixedResult.fixed > 0);
  assert.deepEqual(fixedResult.violations, []);
  assert.equal(fixedResult.value.blocks[0].type, 'header');
  assert.equal(fixedResult.value.blocks[0].data.level, 2);
  assert.ok(
    fixedResult.value.blocks.every((block) =>
      ['paragraph', 'header', 'list', 'quote', 'image', 'delimiter'].includes(block.type)
    )
  );
  const unfixed = call('fromMarkdown', { markdown: MARKDOWN, preset: 'basic', fix: false }).structuredContent;
  assert.equal(unfixed.fixed, 0);
  assert.deepEqual(unfixed.violations.map((violation) => violation.code).sort(), [
    'BLOCK_NOT_ALLOWED',
    'HEADING_LEVEL',
  ]);
  // Field options on top of the preset: alt text required, links not allowed.
  const strict = call('fromMarkdown', {
    markdown: 'See [x](https://example.test)\n\n![](https://example.test/a.png)',
    fieldOptions: { requireAlt: true, linkTargets: 'none' },
  }).structuredContent;
  assert.doesNotMatch(strict.value.blocks[0].data.text, /<a/);
  assert.deepEqual(
    strict.violations.map((violation) => violation.code),
    ['ALT_REQUIRED']
  );
});

test('mex_from_html drops unsafe markup and unknown elements', () => {
  const { value, notes } = call('fromHtml', {
    html: `<h2 onclick="x()">Heading</h2><p>${SECRET} <a href="javascript:alert(1)">bad</a></p><iframe src="https://example.test"></iframe>`,
  }).structuredContent;
  assert.deepEqual(
    value.blocks.map((block) => block.type),
    ['header', 'paragraph']
  );
  assert.doesNotMatch(JSON.stringify(value), /onclick|javascript:/);
  assert.ok(notes.every((note) => !note.includes(SECRET)));
  assert.deepEqual(call('fromHtml', { html: '   ' }).structuredContent.value, null);
});

test('mex_validate: converted content is valid and stays unchanged', () => {
  for (const preset of PRESET_NAMES) {
    const { value } = call('fromMarkdown', { markdown: MARKDOWN, preset }).structuredContent;
    const result = call('validate', { value, preset }).structuredContent;
    assert.equal(result.valid, true, preset);
    assert.deepEqual(result.issues, [], preset);
    assert.deepEqual(result.value, value, preset);
  }
});

test('mex_validate reports invalid blocks, content policy changes and preset rules without echoing content', () => {
  const result = call('validate', {
    value: {
      blocks: [
        { id: 'h1', type: 'header', data: { text: `<script>x</script>${SECRET}`, level: 1 } },
        { type: '1bad', data: {} },
        { id: 'p1', type: 'paragraph', data: { text: 'ok', extra: 1 } },
        { id: 'w1', type: 'warning', data: { title: 'T', message: 'M' } },
      ],
    },
    preset: 'basic',
  }).structuredContent;
  assert.equal(result.valid, false);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('BLOCK_DROPPED'));
  assert.ok(codes.includes('HEADING_LEVEL'));
  assert.ok(codes.includes('BLOCK_NOT_ALLOWED'));
  assert.ok(codes.includes('CHANGED_ON_SAVE'));
  // One issue per preset violation, not an extra schema error for the same block.
  assert.equal(codes.filter((code) => code === 'SCHEMA').length, 0);
  assert.ok(result.issues.every((issue) => !JSON.stringify(issue).includes(SECRET)));
  assert.equal(result.value.blocks.length, 3);
  assert.ok(result.issues.find((issue) => issue.code === 'CHANGED_ON_SAVE').severity === 'warning');
});

test('mex_validate: limits, invalid shapes and the character limit', () => {
  const tooMany = call('validate', {
    value: { blocks: [1, 2, 3].map((n) => ({ id: `b${n}`, type: 'paragraph', data: { text: 'abc' } })) },
    fieldOptions: { maxBlocks: 2, maxCharacters: 5 },
  }).structuredContent;
  assert.deepEqual(
    tooMany.issues.map((issue) => issue.code),
    ['SCHEMA', 'TOO_MANY_BLOCKS', 'TOO_MANY_CHARACTERS']
  );
  assert.equal(tooMany.issues[0].path, '/blocks');
  const shape = call('validate', { value: '[not json' }).structuredContent;
  assert.equal(shape.valid, true, 'plain text is a 1.x value and becomes a paragraph');
  const invalid = handlers.validate({ value: 42 });
  assert.equal(invalid.structuredContent.valid, false);
  assert.equal(invalid.structuredContent.issues[0].code, 'INVALID_SHAPE');
  assert.equal(call('validate', { value: null }).structuredContent.valid, true);
});

test('mex_render renders html, text and markdown with the package renderers', () => {
  const { value } = call('fromMarkdown', { markdown: '## Hi\n\nSome **bold** text' }).structuredContent;
  assert.equal(
    call('render', { value }).structuredContent.output,
    '<h2 class="mex-header">Hi</h2>\n<p class="mex-paragraph">Some <b>bold</b> text</p>'
  );
  assert.equal(call('render', { value, format: 'text' }).structuredContent.output, 'Hi\n\nSome bold text');
  assert.equal(
    call('render', { value, format: 'markdown' }).structuredContent.output,
    '## Hi\n\nSome **bold** text'
  );
  assert.deepEqual(call('render', { value: null }).structuredContent, {
    format: 'html',
    output: '',
    blocks: 0,
  });
  const xss = call('render', {
    value: { blocks: [{ id: 'a', type: 'paragraph', data: { text: '<img src=x onerror=alert(1)>hi' } }] },
  }).structuredContent.output;
  assert.doesNotMatch(xss, /onerror|<img/);
  const tooLarge = handlers.render({ value: { blocks: Array.from({ length: 5001 }, () => ({})) } });
  assert.equal(tooLarge.isError, true);
  assert.match(tooLarge.content[0].text, /^TOO_MANY_BLOCKS: /);
});

test('input schemas are strict and bounded', () => {
  const big = 'x'.repeat(tools.MAX_TEXT + 1);
  assert.throws(() => parse('fromMarkdown', { markdown: big }));
  assert.throws(() => parse('fromHtml', { html: '<p>x</p>', extra: true }));
  assert.throws(() => parse('fromMarkdown', { markdown: 'x', preset: 'nope' }));
  assert.throws(() =>
    parse('fromMarkdown', { markdown: 'x', fieldOptions: { allowedBlocks: 'a'.repeat(2001) } })
  );
  assert.throws(() => parse('fromMarkdown', { markdown: 'x', fieldOptions: { unknown: 1 } }));
  assert.throws(() => parse('validate', { value: { blocks: Array.from({ length: 5001 }, () => ({})) } }));
  assert.throws(() => parse('render', { value: null, format: 'pdf' }));
  for (const schema of Object.values(tools.INPUT_SCHEMAS))
    assert.equal(typeof schema['~standard'].validate, 'function');
});

test('preset schemas narrow the published schema without changing it', () => {
  const published = JSON.stringify(buildEditorSchema());
  const headerBefore = JSON.stringify(BLOCK_DATA_SCHEMAS.header);
  const basic = buildPresetSchema(resolveFieldPreset({ preset: 'basic' }));
  assert.deepEqual(basic.$defs.block.properties.type.enum, [
    'paragraph',
    'header',
    'list',
    'quote',
    'image',
    'delimiter',
  ]);
  assert.deepEqual(basic.$defs.data_header.properties.level, { type: 'integer', enum: [2, 3] });
  assert.equal(basic.$defs.data_table, undefined);
  assert.equal(basic.$id, undefined);
  assert.deepEqual(basic['x-mex-preset'].inlineTools, [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'hyperlink',
  ]);
  const minimal = buildPresetSchema(resolveFieldPreset({ preset: 'minimal' }));
  assert.equal(minimal.$defs.data_header, undefined);
  const full = buildPresetSchema(resolveFieldPreset({ preset: 'full' }));
  assert.equal(full.$defs.block.properties.type.pattern, '^[A-Za-z][A-Za-z0-9_-]{0,63}$');
  assert.equal(JSON.stringify(buildEditorSchema()), published);
  assert.equal(JSON.stringify(BLOCK_DATA_SCHEMAS.header), headerBefore);
  const value = {
    time: 0,
    version: '2.31.0',
    blocks: [{ id: 'a', type: 'header', data: { text: 'x', level: 4 } }],
  };
  assert.equal(validate(full, full, value).length, 0);
  assert.deepEqual(validate(basic, basic, value), ['/blocks/0/data/level: enum 4']);
  assert.equal(
    JSON.parse(JSON.stringify(tools.presetSchemaOf('article'))).title,
    'Magic Editor X field value (preset "article")'
  );
});

test('content guide names the preset rules and the workflow', () => {
  const guide = tools.contentGuide('minimal');
  assert.match(guide, /Preset "minimal": blocks paragraph, list; heading levels none/);
  assert.match(guide, /mex_from_markdown/);
  assert.match(guide, /magic-editor-x:\/\/presets\/minimal\/schema/);
  assert.match(tools.contentGuide(), /Preset "full"/);
});

/**
 * Fake `strapi.ai.mcp` service recording registrations (Strapi 5.61 contract).
 * @param {{ enabled?: boolean, pluginEnabled?: boolean, missing?: boolean }} options - Switches.
 * @returns {{ strapi: object, registered: { tools: object[], resources: object[], prompts: object[] }, logs: string[] }} Fake.
 */
const fakeStrapi = ({ enabled = true, pluginEnabled = true, missing = false } = {}) => {
  const registered = { tools: [], resources: [], prompts: [] };
  const logs = [];
  const values = {
    'plugin::magic-editor-x.mcp.enabled': pluginEnabled,
    'plugin::magic-editor-x.rawHtml': 'sanitize',
  };
  const mcp = {
    isEnabled: () => enabled,
    registerTool: (tool) => registered.tools.push(tool),
    registerResource: (resource) => registered.resources.push(resource),
    registerPrompt: (prompt) => registered.prompts.push(prompt),
  };
  const strapi = {
    config: { get: (key) => values[key] },
    log: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
      debug: () => {},
    },
    ai: missing ? undefined : { mcp },
  };
  return { strapi, registered, logs };
};

test('registerMcp is off by default and needs Strapi MCP', async () => {
  await resetMcp();
  assert.equal(config.default.mcp.enabled, false);
  const off = fakeStrapi({ pluginEnabled: false });
  assert.equal(registerMcp(off.strapi), false);
  assert.equal(off.registered.tools.length, 0);
  const serverOff = fakeStrapi({ enabled: false });
  assert.equal(registerMcp(serverOff.strapi), false);
  assert.match(serverOff.logs.join('\n'), /server\.mcp\.enabled/);
  const old = fakeStrapi({ missing: true });
  assert.equal(registerMcp(old.strapi), false);
  assert.deepEqual(mcpStatus(serverOff.strapi), {
    enabled: true,
    available: true,
    serverEnabled: false,
    active: false,
    path: '/mcp',
    tools: ['mex_from_markdown', 'mex_from_html', 'mex_validate', 'mex_render'],
  });
});

test('registerMcp registers four tools, four preset resources and one prompt behind mcp.use', async () => {
  await resetMcp();
  const { strapi, registered } = fakeStrapi();
  assert.equal(registerMcp(strapi), true);
  assert.equal(mcpStatus(strapi).active, true);
  assert.deepEqual(
    registered.tools.map((tool) => tool.name),
    TOOLS.map((tool) => tool.name)
  );
  assert.deepEqual(
    registered.resources.map((resource) => resource.uri),
    PRESET_NAMES.map((name) => `magic-editor-x://presets/${name}/schema`)
  );
  assert.equal(registered.prompts[0].name, 'mex_content_guide');
  const all = [...registered.tools, ...registered.resources, ...registered.prompts];
  for (const definition of all) {
    assert.deepEqual(definition.auth, { policies: [{ action: 'plugin::magic-editor-x.mcp.use' }] });
    assert.equal(definition.devModeOnly, undefined);
  }
  for (const tool of registered.tools) {
    assert.match(tool.name, /^[a-z_]{1,64}$/);
    assert.ok(tool.title && tool.description);
    assert.equal(typeof tool.resolveInputSchema({}).safeParse, 'function');
  }
  const handler = registered.tools[0].createHandler(strapi, { userAbility: null, user: { id: 1 } });
  const result = await handler({ args: parse('fromMarkdown', { markdown: 'Hi' }), extra: {} });
  assert.equal(result.structuredContent.value.blocks[0].data.text, 'Hi');
  const read = await registered.resources[2].createHandler(strapi)(new URL(registered.resources[2].uri), {});
  assert.equal(read.contents[0].mimeType, 'application/schema+json');
  assert.equal(JSON.parse(read.contents[0].text)['x-mex-preset'].name, 'basic');
  const prompt = await registered.prompts[0].createHandler(strapi)({ preset: 'article' }, {});
  assert.match(prompt.messages[0].content.text, /Preset "article"/);
  await resetMcp();
  assert.equal(mcpStatus(strapi).active, false);
});

test('mcp.use is a registered RBAC action and the config validator accepts the mcp key', () => {
  assert.equal(ACTIONS.mcpUse, 'plugin::magic-editor-x.mcp.use');
  assert.ok(ACTION_DEFINITIONS.some((action) => action.uid === 'mcp.use'));
  assert.match('mcp.use', /^[a-z]([a-z|.|-]+)[a-z]$/);
  const merged = config.default;
  assert.doesNotThrow(() => config.validator({ ...merged, mcp: { enabled: true } }));
  assert.throws(() => config.validator({ ...merged, mcp: { enabled: 'yes' } }), /mcp\.enabled/);
});

test('deeply nested Markdown fails with TOO_DEEP instead of a stack overflow', () => {
  const result = handlers.fromMarkdown(parse('fromMarkdown', { markdown: '> '.repeat(400000) }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^TOO_DEEP: /);
});

test('the runner converts in a worker, keeps the event loop free and stops slow calls', async () => {
  const warnings = [];
  const runner = createRunner({
    timeoutMs: 1500,
    logger: { warn: (message, meta) => warnings.push({ message, meta }) },
  });
  try {
    const quick = await runner.run('fromMarkdown', { markdown: '## Hi' }, 'sanitize');
    assert.equal(quick.structuredContent.value.blocks[0].type, 'header');
    // Long emphasis delimiter runs take super-linear time in marked: the call is stopped, the loop stays free.
    let ticks = 0;
    const interval = setInterval(() => (ticks += 1), 50);
    const started = Date.now();
    const slow = runner.run('fromMarkdown', { markdown: `_a_`.repeat(80000) }, 'sanitize');
    const next = runner.run(
      'render',
      { value: { blocks: [{ id: 'a', type: 'paragraph', data: { text: SECRET } }] } },
      'sanitize'
    );
    const stopped = await slow;
    clearInterval(interval);
    assert.equal(stopped.isError, true);
    assert.match(stopped.content[0].text, /^TIMEOUT: /);
    assert.ok(Date.now() - started < 4000);
    assert.ok(ticks >= 10, `event loop ticks ${ticks}`);
    assert.equal((await next).structuredContent.output, `<p class="mex-paragraph">${SECRET}</p>`);
    assert.equal(warnings.length, 1);
    assert.ok(!JSON.stringify(warnings).includes(SECRET));
    assert.match((await runner.run('nope', {}, 'sanitize')).content[0].text, /^INTERNAL: /);
  } finally {
    await runner.stop();
  }
});

test('the runner refuses calls beyond the queue limit', async () => {
  const runner = createRunner({ timeoutMs: 5000, maxQueue: 2 });
  try {
    const calls = [1, 2, 3, 4].map(() => runner.run('fromMarkdown', { markdown: 'x' }, 'sanitize'));
    const results = await Promise.all(calls);
    assert.equal(results.filter((result) => result.isError).length, 1);
    assert.match(results[3].content[0].text, /^BUSY: /);
  } finally {
    await runner.stop();
  }
});

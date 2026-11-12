'use strict';

/**
 * MCP integration (2.5): registers the Magic Editor X tools, preset schema
 * resources and the content guide prompt with Strapi's MCP server
 * (`strapi.ai.mcp`, Strapi 5.47+, GA in 5.49). Off by default: it runs only
 * when the plugin option `mcp.enabled` is true AND Strapi's MCP server is on
 * (`server.mcp.enabled`). Strapi authenticates every `/mcp` request with an
 * admin token; each capability below is listed and callable only when the
 * token's permissions include `plugin::magic-editor-x.mcp.use`.
 *
 * Tool names use underscores (`mex_from_markdown`): the MCP spec allows dots,
 * but Strapi's own tools use `[a-z0-9_-]` and common LLM tool APIs reject dots
 * in tool names, so clients would have to rename them.
 */

const { ACTIONS } = require('./permissions');
const { createLogger } = require('./utils/logger');
const { PRESET_NAMES } = require('../../shared/presets.mjs');
const { z } = require('zod');
const { INPUT_SCHEMAS, OUTPUT_SCHEMAS, contentGuide, presetSchemaOf } = require('./utils/mcp-tools');
const { createRunner } = require('./utils/mcp-runner');

const AUTH = Object.freeze({ policies: [{ action: ACTIONS.mcpUse }] });
const TELEMETRY_SOURCE = 'magic-editor-x';

/** Tool definitions: name -> { key, title, description }. */
const TOOLS = Object.freeze([
  {
    name: 'mex_from_markdown',
    key: 'fromMarkdown',
    title: 'Markdown to Magic Editor X',
    description:
      'Converts Markdown into a Magic Editor X field value (Editor.js JSON) with the same sanitiser and field preset checks as a save. Pure transformation: reads and writes nothing.',
  },
  {
    name: 'mex_from_html',
    key: 'fromHtml',
    title: 'HTML to Magic Editor X',
    description:
      'Converts HTML into a Magic Editor X field value (Editor.js JSON) with the same sanitiser and field preset checks as a save. Scripts, styles and unknown markup are dropped. Pure transformation.',
  },
  {
    name: 'mex_validate',
    key: 'validate',
    title: 'Validate Magic Editor X content',
    description:
      'Checks a Magic Editor X value against a field preset: normalising, content policy, JSON Schema and preset rules. Returns issues (errors and warnings) and the value as it would be stored.',
  },
  {
    name: 'mex_render',
    key: 'render',
    title: 'Render Magic Editor X content',
    description:
      'Renders a Magic Editor X value to HTML, plain text or Markdown with the package renderers (internal links are not resolved; raw HTML blocks are left out).',
  },
]);

let state = { registered: false, tools: 0, resources: 0, prompts: 0 };
/** Worker runner of the tool calls (created on registration, stopped in destroy). */
let runner = null;

/**
 * The MCP service of this Strapi version, or null (older Strapi or no AI namespace).
 * @param {object} strapi - Strapi instance.
 * @returns {object|null} `strapi.ai.mcp`.
 */
const mcpServiceOf = (strapi) => {
  try {
    const mcp = strapi.ai && strapi.ai.mcp;
    return mcp && typeof mcp.registerTool === 'function' && typeof mcp.isEnabled === 'function' ? mcp : null;
  } catch {
    return null;
  }
};

/**
 * Status for the read-only line in Settings > Configuration. No secrets.
 * @param {object} strapi - Strapi instance.
 * @returns {{ enabled: boolean, available: boolean, serverEnabled: boolean, active: boolean, path: string, tools: string[] }} Status.
 */
const mcpStatus = (strapi) => {
  const mcp = mcpServiceOf(strapi);
  let serverEnabled;
  try {
    serverEnabled = Boolean(mcp && mcp.isEnabled());
  } catch {
    serverEnabled = false;
  }
  return {
    enabled: strapi.config.get('plugin::magic-editor-x.mcp.enabled') === true,
    available: Boolean(mcp),
    serverEnabled,
    active: state.registered,
    path: '/mcp',
    tools: TOOLS.map((tool) => tool.name),
  };
};

/**
 * Registers the tools, resources and prompt (plugin register phase, before
 * Strapi starts the MCP server). No-op when off or unsupported.
 * @param {object} strapi - Strapi instance.
 * @returns {boolean} True when the capabilities were registered.
 */
const registerMcp = (strapi) => {
  const logger = createLogger(strapi);
  if (strapi.config.get('plugin::magic-editor-x.mcp.enabled') !== true) return false;
  const mcp = mcpServiceOf(strapi);
  if (!mcp) {
    logger.warn('mcp.enabled is on, but this Strapi version has no MCP server (needs 5.47 or later)');
    return false;
  }
  if (!mcp.isEnabled()) {
    logger.warn("mcp.enabled is on, but Strapi's MCP server is off (server.mcp.enabled in config/server)");
    return false;
  }
  // Tool calls run in a worker thread with a time limit (utils/mcp-runner.js), off the event loop.
  if (runner) runner.stop();
  runner = createRunner({ logger });
  const calls = runner;
  for (const tool of TOOLS) {
    mcp.registerTool({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      auth: AUTH,
      telemetry: { source: TELEMETRY_SOURCE, name: tool.name },
      resolveInputSchema: () => INPUT_SCHEMAS[tool.key],
      resolveOutputSchema: () => OUTPUT_SCHEMAS[tool.key],
      createHandler:
        () =>
        async ({ args }) =>
          calls.run(tool.key, args, strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize'),
    });
  }
  for (const name of PRESET_NAMES) {
    const uri = `magic-editor-x://presets/${name}/schema`;
    mcp.registerResource({
      name: `mex-preset-${name}`,
      uri,
      metadata: {
        title: `Magic Editor X preset "${name}" (JSON Schema)`,
        description: `JSON Schema of the values a Magic Editor X field with the "${name}" preset accepts (blocks, heading levels, limits).`,
        mimeType: 'application/schema+json',
      },
      auth: AUTH,
      telemetry: { source: TELEMETRY_SOURCE, name: 'preset-schema' },
      createHandler: () => async () => ({
        contents: [{ uri, mimeType: 'application/schema+json', text: JSON.stringify(presetSchemaOf(name)) }],
      }),
    });
  }
  mcp.registerPrompt({
    name: 'mex_content_guide',
    title: 'Write Magic Editor X content',
    description:
      'Explains the Magic Editor X block types of a field preset and how to produce valid content with the mex_ tools.',
    argsSchema: z.object({ preset: z.enum(PRESET_NAMES).optional() }),
    auth: AUTH,
    telemetry: { source: TELEMETRY_SOURCE, name: 'content-guide' },
    createHandler: () => async (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: contentGuide(args && args.preset) } }],
    }),
  });
  state = { registered: true, tools: TOOLS.length, resources: PRESET_NAMES.length, prompts: 1 };
  logger.info('MCP tools registered', { tools: TOOLS.length, resources: PRESET_NAMES.length, prompts: 1 });
  return true;
};

/**
 * Stops the tool worker and resets the registration state (destroy and tests).
 * @returns {Promise<void>}
 */
const resetMcp = async () => {
  state = { registered: false, tools: 0, resources: 0, prompts: 0 };
  if (runner) {
    const stopping = runner;
    runner = null;
    await stopping.stop();
  }
};

module.exports = { TOOLS, registerMcp, mcpStatus, resetMcp };

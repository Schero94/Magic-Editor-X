'use strict';

/**
 * MCP tools, resources and the prompt of Magic Editor X (2.5), as pure
 * functions. They only transform what the caller sends: no document reads or
 * writes, no outgoing requests, no secrets, no logging of content. The same
 * code as the save path runs (`cleanEditorValue` + `checkPreset`), so a value
 * a tool returns is stored unchanged by the Document Service middleware.
 * Registration with Strapi's MCP server is in `server/src/mcp.js`.
 */

const { z } = require('zod');
const { cleanEditorValue } = require('./sanitizer');
const {
  PRESET_NAMES,
  LINK_TARGETS,
  resolveFieldPreset,
  allowedInlineTags,
  checkPreset,
  fixPresetViolations,
} = require('../../../shared/presets.mjs');
const { computeStats, normalizeEditorData } = require('../../../shared/editor-data.mjs');
const {
  markdownToBlocks,
  htmlToBlocks,
  parseHtmlWithHtmlparser2,
  toDocument,
} = require('../../../shared/convert/index.mjs');
const { renderHtml, renderText, renderMarkdown } = require('../../../shared/render/index.mjs');
const { renderMath } = require('../../../shared/math/index.mjs');
const { buildPresetSchema, describePreset } = require('../../../shared/preset-schema.mjs');
const { validate: validateSchema } = require('../../../shared/json-schema-check.mjs');

/** Largest Markdown or HTML text a tool accepts (characters). Strapi's JSON body limit (1 MB by default) applies first. */
const MAX_TEXT = 1000000;
/** Most issues the validate tool returns. */
const MAX_ISSUES = 100;
const RENDER_FORMATS = Object.freeze(['html', 'text', 'markdown']);

/** Field options a caller may pass instead of (or on top of) a preset name. Same meaning as the custom field options. */
const fieldOptionsSchema = z
  .strictObject({
    allowedBlocks: z
      .string()
      .max(2000)
      .optional()
      .describe('Comma list of block types; replaces the preset list.'),
    headingLevels: z.string().max(100).optional().describe('Heading levels such as "2-4" or "2,3".'),
    maxBlocks: z.number().int().min(0).max(10000000).optional().describe('Block limit, 0 = none.'),
    maxCharacters: z.number().int().min(0).max(10000000).optional().describe('Character limit, 0 = none.'),
    requireAlt: z.boolean().optional().describe('Images need an alternative text or the decorative flag.'),
    linkTargets: z.enum(LINK_TARGETS).optional().describe('Allowed link destinations.'),
  })
  .describe('Field options from the Content-Type Builder (optional).');

const presetShape = {
  preset: z
    .enum(PRESET_NAMES)
    .optional()
    .describe('Field preset of the target field: full (default), article, basic or minimal.'),
  fieldOptions: fieldOptionsSchema.optional(),
};

/** A stored value: an Editor.js document (or a 1.x JSON string). Shape details are checked by the tools. */
const valueSchema = z
  .union([z.looseObject({ blocks: z.array(z.unknown()).max(5000) }), z.string().max(MAX_TEXT), z.null()])
  .describe('Magic Editor X value: { time, blocks: [{ id, type, data, tunes? }], version }.');

const violationSchema = z.object({
  code: z.string(),
  blockId: z.string().nullable(),
  index: z.number().nullable(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const statsSchema = z.object({ blocks: z.number(), words: z.number(), characters: z.number() });

const INPUT_SCHEMAS = Object.freeze({
  fromMarkdown: z.strictObject({
    markdown: z.string().max(MAX_TEXT).describe('Markdown (GitHub flavoured).'),
    ...presetShape,
    fix: z
      .boolean()
      .optional()
      .describe(
        'Apply the automatic preset fixes (default true): headings move to allowed levels, disallowed text blocks become paragraphs.'
      ),
  }),
  fromHtml: z.strictObject({
    html: z.string().max(MAX_TEXT).describe('HTML. Scripts, styles and unknown markup are dropped.'),
    ...presetShape,
    fix: z.boolean().optional().describe('Apply the automatic preset fixes (default true).'),
  }),
  validate: z.strictObject({ value: valueSchema, ...presetShape }),
  render: z.strictObject({
    value: valueSchema,
    format: z.enum(RENDER_FORMATS).optional().describe('Output format: html (default), text or markdown.'),
  }),
});

const convertOutput = z.object({
  value: z.record(z.string(), z.unknown()).nullable(),
  violations: z.array(violationSchema),
  fixed: z.number(),
  removed: z.number(),
  notes: z.array(z.string()),
  stats: statsSchema,
});

const OUTPUT_SCHEMAS = Object.freeze({
  fromMarkdown: convertOutput,
  fromHtml: convertOutput,
  validate: z.object({
    valid: z.boolean(),
    issues: z.array(
      z.object({
        severity: z.enum(['error', 'warning']),
        code: z.string(),
        message: z.string(),
        path: z.string().optional(),
        blockId: z.string().nullable().optional(),
        index: z.number().nullable().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    ),
    value: z.record(z.string(), z.unknown()).nullable(),
    stats: statsSchema,
  }),
  render: z.object({ format: z.enum(RENDER_FORMATS), output: z.string(), blocks: z.number() }),
});

const MESSAGES = Object.freeze({
  TOO_LARGE: 'The value is larger than 5 MiB.',
  TOO_MANY_BLOCKS: 'The value has more than the allowed number of blocks.',
  TOO_DEEP: 'The value is nested too deeply.',
  INVALID_SHAPE: 'The value is not an Editor.js document.',
  SCHEMA: 'The value does not match the JSON Schema of the preset.',
  BLOCK_DROPPED: 'A block without a valid type or data object is dropped on save.',
  REMOVED_ON_SAVE: 'The block is removed on save by the content policy.',
  CHANGED_ON_SAVE:
    'The block is changed on save by the content policy (unsafe markup, unknown keys or defaults).',
  BLOCK_NOT_ALLOWED: 'The preset does not allow this block type.',
  HEADING_LEVEL: 'The preset does not allow this heading level.',
  LINK_NOT_ALLOWED: 'The preset does not allow this kind of link.',
  ALT_REQUIRED: 'The image needs an alternative text or the decorative flag.',
  PRESET_TOO_MANY_BLOCKS: 'The value has more blocks than the preset allows.',
  TOO_MANY_CHARACTERS: 'The value has more characters than the preset allows.',
  TIMEOUT: 'The input took longer than 10 seconds to process. Send smaller parts.',
  BUSY: 'Too many tool calls are waiting. Try again shortly.',
  INTERNAL: 'The tool could not process the input.',
});

/**
 * Resolves the preset of a tool call.
 * @param {{ preset?: string, fieldOptions?: object }} args - Tool arguments.
 * @returns {import('../../../shared/presets.mjs').FieldPreset} Preset.
 */
const presetOf = (args) =>
  resolveFieldPreset({ ...(args.fieldOptions || {}), preset: args.preset || 'full' });

/**
 * Converter report as short notes without content (same notes as the migration report).
 * @param {{ skipped?: Array<{ reason: string, tag?: string }>, images?: Array<object> }} report - Converter report.
 * @returns {string[]} Notes such as `unsupported-element:iframe`.
 */
const notesOf = (report) => {
  const notes = (report.skipped || []).map((entry) => {
    const tag =
      typeof entry.tag === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(entry.tag) ? `:${entry.tag}` : '';
    return `${entry.reason}${tag}`;
  });
  if (Array.isArray(report.images) && report.images.length)
    notes.push('images-not-uploaded: image URLs are kept as given; nothing is copied into the Media Library');
  return notes.slice(0, 50);
};

/**
 * Tool result with text and structured content.
 * @param {object} structured - Structured content.
 * @returns {{ content: Array<{ type: 'text', text: string }>, structuredContent: object }} Result.
 */
const ok = (structured) => ({
  content: [{ type: 'text', text: JSON.stringify(structured) }],
  structuredContent: structured,
});

/**
 * Error result with a fixed message (never input text or internal details).
 * @param {string} code - Error code.
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError: true }} Result.
 */
const fail = (code) => ({
  content: [{ type: 'text', text: `${code}: ${MESSAGES[code] || 'The request could not be handled.'}` }],
  isError: true,
});

/**
 * Cleans a value exactly as the save path does for a field with this preset.
 * @param {unknown} value - Value.
 * @param {object} preset - Preset.
 * @param {string} rawHtml - Raw HTML policy (plugin config `rawHtml`).
 * @returns {object|null} Clean value.
 * @throws {Error} EditorDataError for invalid or too large values.
 */
const cleanFor = (value, preset, rawHtml) =>
  cleanEditorValue(value, { rawHtml, inlineTags: allowedInlineTags(preset) });

/**
 * Shared part of the two converters: clean, optional fixes, preset check.
 * @param {{ blocks: Array<object>, report: object }} result - Converter result.
 * @param {object} args - Tool arguments.
 * @param {string} rawHtml - Raw HTML policy.
 * @returns {object} Tool result.
 */
const finishConversion = (result, args, rawHtml) => {
  const preset = presetOf(args);
  let value = result.blocks.length ? cleanFor(toDocument(result.blocks), preset, rawHtml) : null;
  let fixed = 0;
  let removed = 0;
  if (value && preset.restricted && args.fix !== false) {
    const outcome = fixPresetViolations(value, preset);
    value = outcome.data;
    fixed = outcome.fixed;
    removed = outcome.removed;
  }
  const violations = preset.restricted ? checkPreset(value, preset) : [];
  return ok({ value, violations, fixed, removed, notes: notesOf(result.report), stats: computeStats(value) });
};

/**
 * Turns `path: reason` messages of the schema check into issues.
 * @param {string[]} messages - Messages.
 * @returns {Array<object>} Issues.
 */
const schemaIssues = (messages) =>
  messages.map((text) => {
    const at = text.indexOf(': ');
    return {
      severity: 'error',
      code: 'SCHEMA',
      message: `${MESSAGES.SCHEMA} ${at >= 0 ? text.slice(at + 2) : text}`.slice(0, 300),
      path: (at >= 0 ? text.slice(0, at) : '').slice(0, 300) || '/',
    };
  });

/**
 * Tool handlers. `rawHtml` is the plugin's raw HTML policy, read per call.
 * @param {{ rawHtml: () => string }} deps - Dependencies.
 * @returns {{ fromMarkdown: Function, fromHtml: Function, validate: Function, render: Function }} Handlers taking the parsed arguments.
 */
const createHandlers = (deps) => {
  const rawHtml = () => deps.rawHtml() || 'sanitize';
  const guard = (run) => (args) => {
    try {
      return run(args);
    } catch (error) {
      if (error && error.name === 'EditorDataError') return fail(error.code || 'INVALID_SHAPE');
      // marked recurses per nesting level (e.g. thousands of "> "), which can exhaust the stack.
      if (error instanceof RangeError) return fail('TOO_DEEP');
      throw error;
    }
  };
  return {
    fromMarkdown: guard((args) => {
      const converted = markdownToBlocks(args.markdown, { parse: parseHtmlWithHtmlparser2 });
      // Lists or quotes nested deeper than the converter reads (refused before marked runs).
      if (converted.report.skipped.some((entry) => entry.reason === 'too-deep')) return fail('TOO_DEEP');
      return finishConversion(converted, args, rawHtml());
    }),
    fromHtml: guard((args) =>
      finishConversion(htmlToBlocks(args.html, { parse: parseHtmlWithHtmlparser2 }), args, rawHtml())
    ),
    validate: (args) => {
      const preset = presetOf(args);
      const issues = [];
      const push = (issue) => {
        if (issues.length < MAX_ISSUES) issues.push(issue);
      };
      let normalized;
      try {
        normalized = normalizeEditorData(args.value);
      } catch (error) {
        const code = (error && error.code) || 'INVALID_SHAPE';
        if (!error || error.name !== 'EditorDataError') throw error;
        push({ severity: 'error', code, message: MESSAGES[code] || MESSAGES.INVALID_SHAPE });
        return ok({ valid: false, issues, value: null, stats: computeStats(null) });
      }
      const rawBlocks =
        args.value && typeof args.value === 'object' && Array.isArray(args.value.blocks)
          ? args.value.blocks.length
          : null;
      if (normalized && rawBlocks !== null && rawBlocks > normalized.blocks.length)
        push({
          severity: 'error',
          code: 'BLOCK_DROPPED',
          message: MESSAGES.BLOCK_DROPPED,
          params: { count: rawBlocks - normalized.blocks.length },
        });
      const clean = cleanFor(normalized, preset, rawHtml());
      const violations = preset.restricted ? checkPreset(clean, preset) : [];
      if (clean) {
        // The schema describes stored values, so it checks what the save would store. Blocks with
        // a preset violation are reported once, by the preset rule.
        const schema = buildPresetSchema(preset);
        const covered = new Set(violations.filter((v) => v.index !== null).map((v) => `/blocks/${v.index}/`));
        for (const issue of schemaIssues(validateSchema(schema, schema, clean))) {
          const block = /^\/blocks\/\d+\//.exec(issue.path);
          if (!block || !covered.has(block[0])) push(issue);
        }
      }
      if (normalized && clean) {
        const cleanById = new Map(clean.blocks.map((block) => [block.id, block]));
        normalized.blocks.forEach((block, index) => {
          const after = cleanById.get(block.id);
          if (!after)
            push({
              severity: 'error',
              code: 'REMOVED_ON_SAVE',
              message: MESSAGES.REMOVED_ON_SAVE,
              blockId: block.id,
              index,
            });
          else if (JSON.stringify(after) !== JSON.stringify(block))
            push({
              severity: 'warning',
              code: 'CHANGED_ON_SAVE',
              message: MESSAGES.CHANGED_ON_SAVE,
              blockId: block.id,
              index,
            });
        });
      }
      for (const violation of violations) {
        const key = violation.code === 'TOO_MANY_BLOCKS' ? 'PRESET_TOO_MANY_BLOCKS' : violation.code;
        push({ severity: 'error', ...violation, message: MESSAGES[key] || violation.code });
      }
      return ok({
        valid: !issues.some((issue) => issue.severity === 'error'),
        issues,
        value: clean,
        stats: computeStats(clean),
      });
    },
    render: guard((args) => {
      const format = args.format || 'html';
      const clean = cleanEditorValue(args.value, { rawHtml: rawHtml() });
      let output = '';
      if (clean) {
        if (format === 'text') output = renderText(clean);
        else if (format === 'markdown') output = renderMarkdown(clean);
        else output = renderHtml(clean, { math: renderMath });
      }
      return ok({ format, output, blocks: clean ? clean.blocks.length : 0 });
    }),
  };
};

/**
 * Text of the content guide prompt for a preset.
 * @param {string} [presetName] - Preset name.
 * @returns {string} Guide (English, no secrets, no content).
 */
const contentGuide = (presetName) => {
  const preset = resolveFieldPreset({ preset: presetName || 'full' });
  const summary = describePreset(preset);
  const blocks = summary.blocks ? summary.blocks.join(', ') : 'every built-in block and custom blocks';
  return [
    'You write content for a Magic Editor X field in Strapi. A field value is an Editor.js document:',
    '{ "time": 0, "blocks": [{ "id": "<letters, digits, _ or -; 1-64>", "type": "<block type>", "data": { ... } }], "version": "2.31.0" }.',
    '',
    `Preset "${summary.name}": blocks ${blocks}; heading levels ${summary.headingLevels.join(', ') || 'none'}; inline tools ${summary.inlineTools.join(', ')}; links ${summary.linkTargets}${summary.requireAlt ? '; images need alt text or decorative: true' : ''}.`,
    `The exact JSON Schema is the resource magic-editor-x://presets/${summary.name}/schema.`,
    '',
    'Common blocks:',
    '- paragraph { text } and header { text, level }: text is inline HTML.',
    '- list { style: "unordered"|"ordered", items: [{ content, items: [] }] }; checklist { items: [{ text, checked }] }.',
    '- quote { text, caption, alignment: "left" }, code { code }, codeFlask { code, language }, delimiter {}, table { content: [[cells]], withHeadings }.',
    '- image { file: { url, alt }, caption }: use an existing Media Library URL; tools never upload files.',
    'Inline HTML allows only b, i, u, s, mark, code, a (href), br, sub, sup with the attributes of the content policy; anything else is removed on save.',
    '',
    'How to produce valid content:',
    '1. Write Markdown or HTML and convert it with mex_from_markdown or mex_from_html, passing the preset of the target field. Prefer this over writing JSON by hand.',
    '2. Check any JSON you wrote or changed with mex_validate; fix every issue with severity "error".',
    '3. Preview with mex_render (html, text or markdown) if needed.',
    '4. Save the returned value with the Content Manager tools of the entry (the field takes the JSON object). The server cleans and checks every save again and rejects values that break the field preset.',
    'These tools never read or write entries themselves.',
  ].join('\n');
};

module.exports = {
  MAX_TEXT,
  RENDER_FORMATS,
  INPUT_SCHEMAS,
  OUTPUT_SCHEMAS,
  createHandlers,
  fail,
  contentGuide,
  presetSchemaOf: (name) => buildPresetSchema(resolveFieldPreset({ preset: name })),
};

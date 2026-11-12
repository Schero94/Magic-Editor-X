/**
 * Field presets: per-field rules set in the Content-Type Builder (custom field
 * options) and enforced in three places with the same code: the editor (tool
 * set), the realtime server (structural rules on every update) and the
 * Document Service middleware (every rule on every write).
 *
 * Options (all optional, `attribute.options.<name>`):
 * - `preset`: 'full' (default) | 'article' | 'basic' | 'minimal'
 * - `allowedBlocks`: comma-separated block names; replaces the preset's list
 * - `headingLevels`: "2-4" or "2,3,4"; replaces the preset's levels
 * - `maxBlocks`, `maxCharacters`: positive integers (0 or empty = no limit)
 * - `requireAlt`: images need an alternative text or the "decorative" flag
 * - `linkTargets`: 'all' (default) | 'internal' | 'external' | 'none'
 * - `disableAi`, `disableCollaboration`, `publishGuard`: booleans
 */

import { isPlainObject, computeStats } from './editor-data.mjs';
import { parseInline } from './render/inline.mjs';

/** Built-in block types (stored names). `mediaLib` only inserts `image` blocks. */
export const BUILTIN_BLOCKS = Object.freeze([
  'paragraph',
  'header',
  'list',
  'checklist',
  'quote',
  'warning',
  'alert',
  'toggle',
  'code',
  'codeFlask',
  'delimiter',
  'toc',
  'table',
  'embed',
  'raw',
  'image',
  'simpleImage',
  'gallery',
  'video',
  'audio',
  'linkTool',
  'attaches',
  'personality',
  'button',
]);

/** Inline tools and the tags they produce. Tags of tools a preset leaves out are unwrapped on save. */
export const INLINE_TOOL_TAGS = Object.freeze({
  bold: ['b', 'strong'],
  italic: ['i', 'em'],
  hyperlink: ['a'],
  marker: ['mark'],
  underline: ['u'],
  strikethrough: ['s'],
  inlineCode: ['code'],
  tooltip: ['span'],
});

export const INLINE_TOOLS = Object.freeze(Object.keys(INLINE_TOOL_TAGS));

/** The named presets. `blocks: null` means every block, custom blocks included. */
export const PRESETS = Object.freeze({
  full: Object.freeze({ blocks: null, inline: null, headingLevels: [1, 2, 3, 4, 5, 6] }),
  article: Object.freeze({
    blocks: Object.freeze([
      'paragraph',
      'header',
      'list',
      'checklist',
      'quote',
      'warning',
      'alert',
      'toggle',
      'code',
      'codeFlask',
      'delimiter',
      'toc',
      'table',
      'embed',
      'image',
      'gallery',
      'video',
      'audio',
      'linkTool',
      'attaches',
      'button',
    ]),
    inline: null,
    headingLevels: [2, 3, 4],
  }),
  basic: Object.freeze({
    blocks: Object.freeze(['paragraph', 'header', 'list', 'quote', 'image', 'delimiter']),
    inline: Object.freeze(['bold', 'italic', 'underline', 'strikethrough', 'hyperlink']),
    headingLevels: [2, 3],
  }),
  minimal: Object.freeze({
    blocks: Object.freeze(['paragraph', 'list']),
    inline: Object.freeze(['bold', 'italic', 'hyperlink']),
    headingLevels: [],
  }),
});

export const PRESET_NAMES = Object.freeze(Object.keys(PRESETS));
export const LINK_TARGETS = Object.freeze(['all', 'internal', 'external', 'none']);

const BLOCK_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_LIMIT = 10000000;

/**
 * Parses a heading level list ("2-4", "2,3", "1, 3-5"). Invalid parts are ignored.
 * @param {unknown} value - Option value.
 * @returns {number[]|null} Sorted levels, or null when the option is empty or has no valid level.
 */
export const parseHeadingLevels = (value) => {
  if (typeof value === 'number' && Number.isInteger(value)) value = String(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const levels = new Set();
  for (const part of value.slice(0, 100).split(',')) {
    const range = /^\s*([1-6])\s*(?:-\s*([1-6])\s*)?$/.exec(part);
    if (!range) continue;
    const from = Number(range[1]);
    const to = range[2] ? Number(range[2]) : from;
    for (let level = Math.min(from, to); level <= Math.max(from, to); level += 1) levels.add(level);
  }
  return levels.size ? [...levels].sort((a, b) => a - b) : null;
};

/**
 * Parses a comma-separated list of block names.
 * @param {unknown} value - Option value.
 * @returns {string[]|null} Names, or null when the option is empty.
 */
export const parseBlockList = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const names = value
    .slice(0, 2000)
    .split(/[\s,;]+/)
    .map((name) => name.trim())
    .filter((name) => BLOCK_NAME.test(name));
  return names.length ? [...new Set(names)] : null;
};

/**
 * Bounded positive integer option (0 and empty mean "no limit").
 * @param {unknown} value - Option value.
 * @returns {number|null} Limit or null.
 */
const limitOf = (value) => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isInteger(number) && number > 0 && number <= MAX_LIMIT ? number : null;
};

/**
 * @typedef {object} FieldPreset
 * @property {string} name - Preset name.
 * @property {string[]|null} blocks - Allowed block types, or null for all.
 * @property {string[]|null} inline - Allowed inline tools, or null for all.
 * @property {number[]} headingLevels - Allowed heading levels.
 * @property {number|null} maxBlocks - Block limit.
 * @property {number|null} maxCharacters - Character limit (visible text, as in the toolbar).
 * @property {boolean} requireAlt - Images need an alternative text or the decorative flag.
 * @property {'all'|'internal'|'external'|'none'} linkTargets - Allowed link destinations.
 * @property {boolean} ai - AI assistant allowed.
 * @property {boolean} collaboration - Live collaboration allowed.
 * @property {boolean} publishGuard - Quality errors block publishing.
 * @property {boolean} restricted - True when any rule differs from the full preset.
 */

/**
 * Resolves the field options of a Magic Editor X attribute into a preset.
 * Unknown or invalid values fall back to the defaults, so a typo never locks
 * a field.
 * @param {unknown} options - `attribute.options`.
 * @returns {FieldPreset} Preset.
 */
export const resolveFieldPreset = (options) => {
  const source = isPlainObject(options) ? options : {};
  const name = PRESET_NAMES.includes(source.preset) ? source.preset : 'full';
  const base = PRESETS[name];
  const listed = parseBlockList(source.allowedBlocks);
  let blocks = listed || (base.blocks ? [...base.blocks] : null);
  // A paragraph is the default block: it is always allowed.
  if (blocks && !blocks.includes('paragraph')) blocks = ['paragraph', ...blocks];
  let headingLevels = parseHeadingLevels(source.headingLevels) || [...base.headingLevels];
  if (blocks && !blocks.includes('header')) headingLevels = [];
  const linkTargets = LINK_TARGETS.includes(source.linkTargets) ? source.linkTargets : 'all';
  let inline = base.inline ? [...base.inline] : null;
  if (linkTargets === 'none') inline = (inline || [...INLINE_TOOLS]).filter((tool) => tool !== 'hyperlink');
  const preset = {
    name,
    blocks,
    inline,
    headingLevels,
    maxBlocks: limitOf(source.maxBlocks),
    maxCharacters: limitOf(source.maxCharacters),
    requireAlt: source.requireAlt === true,
    linkTargets,
    ai: source.disableAi !== true,
    collaboration: source.disableCollaboration !== true,
    publishGuard: source.publishGuard === true,
  };
  preset.restricted = Boolean(
    preset.blocks ||
    preset.inline ||
    preset.headingLevels.length !== 6 ||
    preset.maxBlocks ||
    preset.maxCharacters ||
    preset.requireAlt ||
    preset.linkTargets !== 'all'
  );
  return preset;
};

/**
 * True when the preset allows a block type.
 * @param {FieldPreset} preset - Preset.
 * @param {string} type - Block type.
 * @returns {boolean} Allowed.
 */
export const isBlockAllowed = (preset, type) =>
  type === 'paragraph' || !preset.blocks || preset.blocks.includes(type);

/**
 * Inline tags a preset allows (for the sanitiser). `null` = every inline tag.
 * @param {FieldPreset} preset - Preset.
 * @returns {string[]|null} Tags.
 */
export const allowedInlineTags = (preset) => {
  if (!preset.inline) return null;
  const tags = new Set(['br']);
  for (const tool of preset.inline) for (const tag of INLINE_TOOL_TAGS[tool] || []) tags.add(tag);
  return [...tags].sort();
};

/**
 * Collects the strings of a block's data that hold inline HTML (for link checks).
 * @param {unknown} value - Data value.
 * @param {string[]} out - Collector.
 * @param {number} [depth=0] - Depth.
 * @returns {string[]} Strings.
 */
const collectStrings = (value, out, depth = 0) => {
  if (depth > 12 || out.length > 5000) return out;
  if (typeof value === 'string') {
    if (value.includes('<a')) out.push(value);
  } else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out, depth + 1));
  else if (isPlainObject(value)) Object.values(value).forEach((item) => collectStrings(item, out, depth + 1));
  return out;
};

/**
 * Lists the links of one block: inline `<a>` elements plus link fields of link
 * blocks. Internal links carry `data-mex-uid`.
 * @param {{ type: string, data: object }} block - Block.
 * @returns {Array<'internal'|'external'>} Link kinds.
 */
export const blockLinkKinds = (block) => {
  const kinds = [];
  const visit = (nodes, depth = 0) => {
    if (depth > 30) return;
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tag === 'a') kinds.push(node.attrs['data-mex-uid'] ? 'internal' : 'external');
      visit(node.children, depth + 1);
    }
  };
  for (const html of collectStrings(block.data, [])) visit(parseInline(html));
  const data = isPlainObject(block.data) ? block.data : {};
  if (
    ['linkTool', 'button', 'personality'].includes(block.type) &&
    typeof data.link === 'string' &&
    data.link
  )
    kinds.push('external');
  return kinds;
};

/**
 * True when an image block (or every image of a gallery) has an alternative text or is marked decorative.
 * @param {{ type: string, data: object }} block - Block.
 * @returns {boolean|null} Result, or null when the block is not an image.
 */
export const imageHasAlt = (block) => {
  const data = isPlainObject(block.data) ? block.data : {};
  if (block.type === 'image') {
    if (data.decorative === true) return true;
    const file = isPlainObject(data.file) ? data.file : {};
    return typeof file.alt === 'string' && file.alt.trim() !== '';
  }
  if (block.type === 'simpleImage') {
    if (data.decorative === true) return true;
    return typeof data.alt === 'string' && data.alt.trim() !== '';
  }
  if (block.type === 'gallery' && Array.isArray(data.images))
    return data.images.every(
      (item) =>
        !isPlainObject(item) ||
        item.decorative === true ||
        (isPlainObject(item.file) && typeof item.file.alt === 'string' && item.file.alt.trim() !== '')
    );
  return null;
};

/**
 * Checks the structural rules of one block (used on every realtime update and on save).
 * @param {FieldPreset} preset - Preset.
 * @param {{ type: string, data: object }} block - Block.
 * @returns {{ code: string, params?: object }|null} First violation or null.
 */
export const checkBlockStructure = (preset, block) => {
  if (!block || typeof block.type !== 'string') return null;
  if (!isBlockAllowed(preset, block.type)) return { code: 'BLOCK_NOT_ALLOWED', params: { type: block.type } };
  if (block.type === 'header') {
    const level = Number(block.data && block.data.level);
    if (!preset.headingLevels.includes(level)) return { code: 'HEADING_LEVEL', params: { level } };
  }
  if (preset.linkTargets !== 'all') {
    for (const kind of blockLinkKinds(block)) {
      if (preset.linkTargets === 'none' || kind !== preset.linkTargets)
        return { code: 'LINK_NOT_ALLOWED', params: { kind } };
    }
  }
  return null;
};

/**
 * @typedef {object} PresetViolation
 * @property {string} code - BLOCK_NOT_ALLOWED | HEADING_LEVEL | LINK_NOT_ALLOWED | ALT_REQUIRED | TOO_MANY_BLOCKS | TOO_MANY_CHARACTERS.
 * @property {string|null} blockId - Block id, or null for document-level rules.
 * @property {number|null} index - Block index.
 * @property {object} [params] - Values for the message (type, level, kind, max, count).
 */

/**
 * Checks a normalised document against a preset. Deterministic; at most 200
 * violations are returned.
 * @param {{ blocks: Array<{ id: string, type: string, data: object }> }|null} data - Normalised, sanitised document.
 * @param {FieldPreset} preset - Preset.
 * @returns {PresetViolation[]} Violations (empty when the content matches).
 */
export const checkPreset = (data, preset) => {
  const violations = [];
  if (!data || !Array.isArray(data.blocks)) return violations;
  data.blocks.forEach((block, index) => {
    if (violations.length >= 200) return;
    const structural = checkBlockStructure(preset, block);
    if (structural) violations.push({ ...structural, blockId: block.id, index });
    else if (preset.requireAlt && imageHasAlt(block) === false)
      violations.push({ code: 'ALT_REQUIRED', blockId: block.id, index });
  });
  if (preset.maxBlocks && data.blocks.length > preset.maxBlocks)
    violations.push({
      code: 'TOO_MANY_BLOCKS',
      blockId: null,
      index: null,
      params: { max: preset.maxBlocks, count: data.blocks.length },
    });
  if (preset.maxCharacters) {
    const { characters } = computeStats(data);
    if (characters > preset.maxCharacters)
      violations.push({
        code: 'TOO_MANY_CHARACTERS',
        blockId: null,
        index: null,
        params: { max: preset.maxCharacters, count: characters },
      });
  }
  return violations.slice(0, 200);
};

/**
 * Nearest allowed heading level (the deeper one on a tie).
 * @param {number} level - Level.
 * @param {number[]} levels - Allowed levels (sorted).
 * @returns {number|null} Level, or null when no heading is allowed.
 */
export const nearestHeadingLevel = (level, levels) => {
  if (!levels.length) return null;
  let best = levels[0];
  for (const candidate of levels) {
    const distance = Math.abs(candidate - level);
    const bestDistance = Math.abs(best - level);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) best = candidate;
  }
  return best;
};

/**
 * Unwraps `<a>` elements whose kind is not allowed (keeps their text).
 * @param {string} html - Inline HTML (already sanitised).
 * @param {(internal: boolean) => boolean} keep - Whether to keep a link.
 * @returns {string} HTML.
 */
const unwrapLinks = (html, keep) =>
  html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) =>
    keep(/\bdata-mex-uid=/.test(attrs)) ? match : inner
  );

/**
 * Applies the automatic fixes for structural violations: headings move to the
 * nearest allowed level (or become paragraphs), text blocks of disallowed types
 * become paragraphs, other disallowed blocks are removed, links that are not
 * allowed keep only their text. Limits and missing alternative texts need the
 * author and are left alone.
 * @param {{ time?: number, version?: string, blocks: Array<{ id: string, type: string, data: object, tunes?: object }> }} data - Normalised document.
 * @param {FieldPreset} preset - Preset.
 * @returns {{ data: object, fixed: number, removed: number }} New document and counts.
 */
export const fixPresetViolations = (data, preset) => {
  if (!data || !Array.isArray(data.blocks)) return { data, fixed: 0, removed: 0 };
  let fixed = 0;
  let removed = 0;
  const keepLink = (internal) =>
    preset.linkTargets === 'all' ||
    (preset.linkTargets === 'internal' && internal) ||
    (preset.linkTargets === 'external' && !internal);
  const fixStrings = (value, depth = 0) => {
    if (depth > 12) return value;
    if (typeof value === 'string') return value.includes('<a') ? unwrapLinks(value, keepLink) : value;
    if (Array.isArray(value)) return value.map((item) => fixStrings(item, depth + 1));
    if (isPlainObject(value)) {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = fixStrings(item, depth + 1);
      return out;
    }
    return value;
  };
  const blocks = [];
  for (const block of data.blocks) {
    const violation = checkBlockStructure(preset, block);
    if (!violation) {
      blocks.push(block);
      continue;
    }
    fixed += 1;
    let next = { ...block, data: fixStrings(block.data) };
    if (violation.code === 'HEADING_LEVEL') {
      const level = nearestHeadingLevel(Number(block.data && block.data.level) || 2, preset.headingLevels);
      next =
        level === null
          ? { id: block.id, type: 'paragraph', data: { text: (next.data && next.data.text) || '' } }
          : { ...next, data: { ...next.data, level } };
    } else if (violation.code === 'BLOCK_NOT_ALLOWED') {
      const text = textOfBlock(next);
      if (text === null) {
        removed += 1;
        continue;
      }
      next = { id: block.id, type: 'paragraph', data: { text } };
    } else if (['linkTool', 'button', 'personality'].includes(block.type) && !keepLink(false)) {
      removed += 1;
      continue;
    }
    if (checkBlockStructure(preset, next)) {
      removed += 1;
      continue;
    }
    blocks.push(next);
  }
  return { data: { ...data, blocks }, fixed, removed };
};

/**
 * Inline text of a block that can become a paragraph, or null.
 * @param {{ type: string, data: object }} block - Block.
 * @returns {string|null} Inline HTML.
 */
const textOfBlock = (block) => {
  const data = isPlainObject(block.data) ? block.data : {};
  if (['header', 'quote', 'toggle'].includes(block.type) && typeof data.text === 'string') return data.text;
  if (block.type === 'warning') return [data.title, data.message].filter(Boolean).join('<br>');
  if (block.type === 'alert' && typeof data.message === 'string') return data.message;
  if ((block.type === 'code' || block.type === 'codeFlask') && typeof data.code === 'string')
    return data.code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  if (block.type === 'list' || block.type === 'checklist') {
    const items = [];
    const walk = (list, depth = 0) => {
      if (!Array.isArray(list) || depth > 12) return;
      for (const item of list) {
        if (typeof item === 'string') items.push(item);
        else if (isPlainObject(item)) {
          const text = typeof item.content === 'string' ? item.content : item.text;
          if (typeof text === 'string') items.push(text);
          walk(item.items, depth + 1);
        }
      }
    };
    walk(data.items);
    return items.join('<br>');
  }
  return null;
};

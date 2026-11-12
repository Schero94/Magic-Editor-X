/**
 * Content quality checks for Magic Editor X documents (accessibility lint and
 * link extraction). Pure and deterministic: used by the editor's quality panel,
 * the server publish guard and the link check route.
 *
 * Inline HTML is read with the strict inline parser of the renderers, so
 * untrusted markup never reaches a DOM here.
 */

import { isPlainObject, normalizeEditorDataSafe } from './editor-data.mjs';
import { parseInline, nodesToText } from './render/inline.mjs';
import { sanitizeUrl, isBuiltInBlock, registeredBlockOf } from './sanitize-policy.mjs';
import { mediaSlots } from './resolve-references.mjs';
import { tocRange } from './toc.mjs';

/** Rule ids and their default severity. */
export const QUALITY_RULES = Object.freeze({
  'image-alt-missing': 'warning',
  'heading-order': 'warning',
  'multiple-h1': 'warning',
  'empty-heading': 'warning',
  'empty-link': 'error',
  'ambiguous-link-text': 'warning',
  'table-no-header': 'warning',
  'low-contrast': 'warning',
  'video-no-captions': 'warning',
  'toc-no-headings': 'warning',
});

/** Most links returned by `extractLinks` per kind. */
export const MAX_EXTRACTED_LINKS = 200;

/** Link texts that do not describe their target (whole text, case-insensitive), en/de/fr/es/pt. */
const AMBIGUOUS_LINK_TEXTS = new Set([
  // en
  'click here',
  'click',
  'here',
  'more',
  'read more',
  'learn more',
  'more info',
  'link',
  'this',
  'this link',
  'continue',
  // de
  'hier',
  'hier klicken',
  'klicken sie hier',
  'klick hier',
  'mehr',
  'weiter',
  'weiterlesen',
  'mehr lesen',
  'mehr erfahren',
  'mehr infos',
  'dieser link',
  // fr
  'ici',
  'cliquez ici',
  'clique ici',
  'plus',
  'en savoir plus',
  'lire la suite',
  'lien',
  'ce lien',
  'suite',
  // es
  'aquí',
  'aqui',
  'haz clic aquí',
  'haz clic aqui',
  'haga clic aquí',
  'haga clic aqui',
  'más',
  'mas',
  'leer más',
  'leer mas',
  'saber más',
  'saber mas',
  'enlace',
  'este enlace',
  // pt
  'clique aqui',
  'mais',
  'leia mais',
  'saiba mais',
  'ler mais',
  'este link',
  'esse link',
]);

/** Data keys of custom blocks that hold a text colour and a background colour. */
const TEXT_COLOR_KEYS = ['color', 'textColor', 'foreground', 'textColour', 'colour'];
const BACKGROUND_COLOR_KEYS = ['background', 'backgroundColor', 'bg', 'backgroundColour', 'bgColor'];

/**
 * Normalises a link text for comparison.
 * @param {string} text - Link text.
 * @returns {string} Lower-case text without surrounding punctuation and repeated spaces.
 */
const normalizeLinkText = (text) =>
  String(text)
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'«»„“”‚‘’([{<>-]+|[\s"'«»„“”‚‘’)\]}<>.,:;!?…→-]+$/g, '')
    .trim();

/**
 * True when a link text is ambiguous on its own ("click here", "mehr").
 * @param {string} text - Link text.
 * @returns {boolean} Result.
 */
export const isAmbiguousLinkText = (text) => AMBIGUOUS_LINK_TEXTS.has(normalizeLinkText(text));

/**
 * Parses a CSS colour (#rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with numbers or percentages).
 * Colours with transparency are not rated (their effective colour depends on what is behind).
 * @param {unknown} value - Colour.
 * @returns {[number, number, number] | null} sRGB channels 0-255, or null.
 */
export const parseColor = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length === 8 && hex.slice(6) !== 'ff') return null;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  match = /^rgba?\(\s*([^)]{1,80})\)$/.exec(text);
  if (!match) return null;
  const parts = match[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  if (parts.length === 4) {
    const alpha = parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 1) return null;
  }
  const channels = parts.slice(0, 3).map((part) => {
    const number = part.endsWith('%') ? (Number(part.slice(0, -1)) * 255) / 100 : Number(part);
    return Number.isFinite(number) ? Math.min(255, Math.max(0, number)) : NaN;
  });
  return channels.some(Number.isNaN) ? null : channels;
};

/**
 * WCAG 2.x relative luminance of an sRGB colour.
 * @param {[number, number, number]} rgb - Channels 0-255.
 * @returns {number} Luminance 0-1.
 */
export const relativeLuminance = ([r, g, b]) => {
  const linear = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/**
 * WCAG 2.x contrast ratio of two colours.
 * @param {[number, number, number]} a - First colour.
 * @param {[number, number, number]} b - Second colour.
 * @returns {number} Ratio between 1 and 21.
 */
export const contrastRatio = (a, b) => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/**
 * Collects the inline HTML strings of one block with their data path.
 * @param {{ type: string, data: object }} block - Block.
 * @returns {Array<{ path: string, html: string }>} Inline strings.
 */
const inlineStrings = (block) => {
  const d = isPlainObject(block.data) ? block.data : {};
  const out = [];
  const add = (path, value) => {
    if (typeof value === 'string' && value) out.push({ path, html: value });
  };
  // Code-registered blocks (custom block SDK): the inline fields of their schema.
  const definition = registeredBlockOf(block);
  if (definition) {
    for (const field of definition.fields(d))
      if (field.kind === 'html') add(field.path.join('.'), field.value);
    return out;
  }
  const listItems = (items, path, depth = 0) => {
    if (!Array.isArray(items) || depth > 12) return;
    items.forEach((item, index) => {
      if (typeof item === 'string') add(`${path}.${index}`, item);
      else if (isPlainObject(item)) {
        add(`${path}.${index}.content`, item.content);
        listItems(item.items, `${path}.${index}.items`, depth + 1);
      }
    });
  };
  // Custom blocks (also ones written before 2.3 under a name 2.3 now uses) take the default branch.
  switch (isBuiltInBlock(block) ? block.type : '') {
    case 'paragraph':
    case 'header':
    case 'toggle':
      add('text', d.text);
      break;
    case 'quote':
      add('text', d.text);
      add('caption', d.caption);
      break;
    case 'list':
      listItems(d.items, 'items');
      break;
    case 'checklist':
      if (Array.isArray(d.items))
        d.items.forEach((item, index) => isPlainObject(item) && add(`items.${index}.text`, item.text));
      break;
    case 'warning':
      add('title', d.title);
      add('message', d.message);
      break;
    case 'alert':
      add('message', d.message);
      break;
    case 'table':
      if (Array.isArray(d.content))
        d.content.forEach(
          (row, r) => Array.isArray(row) && row.forEach((cell, c) => add(`content.${r}.${c}`, cell))
        );
      break;
    case 'image':
    case 'simpleImage':
    case 'embed':
    case 'video':
    case 'audio':
      add('caption', d.caption);
      break;
    case 'gallery':
      if (Array.isArray(d.images))
        d.images.forEach(
          (item, index) => isPlainObject(item) && add(`images.${index}.caption`, item.caption)
        );
      add('caption', d.caption);
      break;
    default:
      if (!isBuiltInBlock(block)) {
        const walk = (value, path, depth) => {
          if (depth > 6) return;
          if (typeof value === 'string') add(path, value);
          else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}.${i}`, depth + 1));
          else if (isPlainObject(value))
            for (const [key, child] of Object.entries(value)) {
              if (/^(url|href|link|src|photo|source|embed)$/i.test(key)) continue;
              walk(child, path ? `${path}.${key}` : key, depth + 1);
            }
        };
        walk(d, '', 0);
      }
  }
  return out;
};

/**
 * Finds the links of a parsed inline tree.
 * @param {Array<object>} nodes - Parsed nodes.
 * @param {Array<{ attrs: Record<string, string>, text: string }>} [out] - Accumulator.
 * @returns {Array<{ attrs: Record<string, string>, text: string }>} Links.
 */
const findLinks = (nodes, out = []) => {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.tag === 'a') out.push({ attrs: node.attrs, text: nodesToText(node.children) });
    else findLinks(node.children, out);
  }
  return out;
};

/**
 * Plain text of inline HTML.
 * @param {unknown} html - Inline HTML.
 * @returns {string} Trimmed text.
 */
const textOf = (html) =>
  nodesToText(parseInline(html))
    .replace(/\u00a0/g, ' ')
    .trim();

/**
 * True when an image-like object carries a usable alternative text.
 * @param {unknown} alt - Alt value.
 * @returns {boolean} Result.
 */
const hasAlt = (alt) => typeof alt === 'string' && alt.trim() !== '';

/**
 * Finds image values (`{ url, alt }`) inside custom block data.
 * @param {unknown} value - Data.
 * @param {string} path - Path of `value`.
 * @param {Array<{ path: string, alt: unknown }>} out - Accumulator.
 * @param {number} depth - Depth.
 * @returns {Array<{ path: string, alt: unknown }>} Images.
 */
const customImages = (value, path, out, depth = 0) => {
  if (depth > 6) return out;
  if (Array.isArray(value)) value.forEach((item, i) => customImages(item, `${path}.${i}`, out, depth + 1));
  else if (isPlainObject(value)) {
    if (
      typeof value.url === 'string' &&
      value.url &&
      (Object.prototype.hasOwnProperty.call(value, 'alt') ||
        (typeof value.mime === 'string' && value.mime.startsWith('image/')))
    ) {
      out.push({ path, alt: value.alt });
      return out;
    }
    for (const [key, child] of Object.entries(value))
      customImages(child, path ? `${path}.${key}` : key, out, depth + 1);
  }
  return out;
};

/**
 * Lints a document for accessibility problems.
 * @param {unknown} value - Stored or editor value (normalised internally).
 * @param {{ requireAlt?: boolean, locale?: string }} [options] - `requireAlt` makes missing alt texts errors (field preset).
 * @returns {{ issues: Array<{ rule: string, severity: 'error'|'warning', blockId: string, blockIndex: number, path?: string, params?: object }>, stats: { errors: number, warnings: number, blocks: number, links: number, images: number } }} Issues in document order.
 */
export const lintDocument = (value, options = {}) => {
  const data = normalizeEditorDataSafe(value);
  const blocks = data ? data.blocks : [];
  const issues = [];
  let links = 0;
  let images = 0;
  let previousLevel = 0;
  let h1Count = 0;
  const headingLevels = [];
  const tocs = [];
  const altSeverity = options.requireAlt === true ? 'error' : 'warning';
  const push = (rule, block, blockIndex, extra = {}) =>
    issues.push({
      rule,
      severity: extra.severity || QUALITY_RULES[rule],
      blockId: block.id,
      blockIndex,
      ...(extra.path ? { path: extra.path } : {}),
      ...(extra.params ? { params: extra.params } : {}),
    });

  blocks.forEach((block, index) => {
    const d = isPlainObject(block.data) ? block.data : {};

    if (block.type === 'header') {
      const level = Number.isInteger(d.level) && d.level >= 1 && d.level <= 6 ? d.level : 2;
      if (!textOf(d.text)) push('empty-heading', block, index, { params: { level } });
      else headingLevels.push(level);
      if (level === 1) {
        h1Count += 1;
        if (h1Count === 2) push('multiple-h1', block, index);
      }
      if (previousLevel && level > previousLevel + 1)
        push('heading-order', block, index, { params: { level, previous: previousLevel } });
      else if (!previousLevel && level > 2)
        push('heading-order', block, index, { params: { level, previous: 0 } });
      previousLevel = level;
    }

    if (block.type === 'image') {
      images += 1;
      const file = isPlainObject(d.file) ? d.file : {};
      if (d.decorative !== true && !hasAlt(file.alt))
        push('image-alt-missing', block, index, { severity: altSeverity, path: 'file.alt' });
    } else if (block.type === 'simpleImage') {
      images += 1;
      if (d.decorative !== true && !hasAlt(d.alt))
        push('image-alt-missing', block, index, { severity: altSeverity, path: 'alt' });
    } else if (block.type === 'gallery' && isBuiltInBlock(block)) {
      (Array.isArray(d.images) ? d.images : []).forEach((item, itemIndex) => {
        if (!isPlainObject(item)) return;
        images += 1;
        const file = isPlainObject(item.file) ? item.file : {};
        if (item.decorative !== true && !hasAlt(file.alt))
          push('image-alt-missing', block, index, {
            severity: altSeverity,
            path: `images.${itemIndex}.file.alt`,
          });
      });
    } else if (block.type === 'video' && isBuiltInBlock(block)) {
      const tracks = Array.isArray(d.tracks) ? d.tracks : [];
      const captioned = tracks.some(
        (track) => isPlainObject(track) && (track.kind === 'captions' || track.kind === 'subtitles')
      );
      if (isPlainObject(d.file) && d.file.url && !captioned) push('video-no-captions', block, index);
    } else if (!isBuiltInBlock(block)) {
      for (const image of customImages(d, '', [])) {
        images += 1;
        if (!hasAlt(image.alt))
          push('image-alt-missing', block, index, {
            severity: altSeverity,
            path: image.path ? `${image.path}.alt` : 'alt',
          });
      }
      const fg = TEXT_COLOR_KEYS.map((key) => parseColor(d[key])).find(Boolean);
      const bg = BACKGROUND_COLOR_KEYS.map((key) => parseColor(d[key])).find(Boolean);
      if (fg && bg) {
        const ratio = contrastRatio(fg, bg);
        if (ratio < 4.5)
          push('low-contrast', block, index, { params: { ratio: Math.floor(ratio * 100) / 100 } });
      }
    }

    if (block.type === 'toc') tocs.push({ block, index, range: tocRange(d) });

    if (block.type === 'table') {
      const rows = Array.isArray(d.content) ? d.content : [];
      if (rows.length > 1 && d.withHeadings !== true) push('table-no-header', block, index);
    }

    for (const { path, html } of inlineStrings(block)) {
      if (!html.includes('<')) continue;
      for (const link of findLinks(parseInline(html))) {
        links += 1;
        const text = link.text.replace(/\u00a0/g, ' ').trim();
        if (!text || !link.attrs.href) push('empty-link', block, index, { path });
        else if (isAmbiguousLinkText(text))
          push('ambiguous-link-text', block, index, {
            path,
            params: { text: normalizeLinkText(text).slice(0, 40) },
          });
      }
    }
  });

  // A table of contents lists the headings of the whole document, so it is checked after the walk.
  for (const { block, index, range } of tocs) {
    if (!headingLevels.some((level) => level >= range.minLevel && level <= range.maxLevel))
      push('toc-no-headings', block, index, { params: range });
  }
  if (tocs.length) issues.sort((a, b) => a.blockIndex - b.blockIndex);

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    issues,
    stats: { errors, warnings: issues.length - errors, blocks: blocks.length, links, images },
  };
};

/**
 * Extracts the links and media references of a document for the link check.
 * Results are de-duplicated and capped at MAX_EXTRACTED_LINKS per kind; each
 * entry carries the id of the first block that uses it.
 * @param {unknown} value - Stored or editor value.
 * @returns {{ internal: Array<{ uid: string, documentId: string, locale: string|null, blockId: string }>, external: Array<{ url: string, blockId: string }>, media: Array<{ id: number|string, blockId: string }> }} References.
 */
export const extractLinks = (value) => {
  const data = normalizeEditorDataSafe(value);
  const internal = new Map();
  const external = new Map();
  const media = new Map();
  if (!data) return { internal: [], external: [], media: [] };

  const addExternal = (url, blockId) => {
    const clean = sanitizeUrl(url, { schemes: ['http', 'https'], allowRelative: false });
    if (clean && !external.has(clean) && external.size < MAX_EXTRACTED_LINKS)
      external.set(clean, { url: clean, blockId });
  };
  const addMedia = (id, blockId) => {
    const valid =
      (Number.isSafeInteger(id) && id > 0) || (typeof id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(id));
    const key = String(id);
    if (valid && !media.has(key) && media.size < MAX_EXTRACTED_LINKS) media.set(key, { id, blockId });
  };

  for (const block of data.blocks) {
    const d = isPlainObject(block.data) ? block.data : {};
    for (const { html } of inlineStrings(block)) {
      if (!html.includes('<')) continue;
      for (const { attrs } of findLinks(parseInline(html))) {
        if (attrs['data-mex-uid'] && attrs['data-mex-document-id']) {
          const locale = attrs['data-mex-locale'] || null;
          const key = `${attrs['data-mex-uid']}|${attrs['data-mex-document-id']}|${locale || ''}`;
          if (!internal.has(key) && internal.size < MAX_EXTRACTED_LINKS)
            internal.set(key, {
              uid: attrs['data-mex-uid'],
              documentId: attrs['data-mex-document-id'],
              locale,
              blockId: block.id,
            });
        } else if (attrs.href) addExternal(attrs.href, block.id);
      }
    }
    const definition = registeredBlockOf(block);
    if (definition) {
      // URL fields of a code-registered block; its data has no Media Library files.
      for (const { value } of definition.urls(d)) addExternal(value, block.id);
      continue;
    }
    switch (block.type) {
      case 'linkTool':
      case 'button':
      case 'personality':
        addExternal(d.link, block.id);
        break;
      case 'embed':
        addExternal(d.source, block.id);
        break;
      case 'attaches':
        if (isPlainObject(d.file)) addExternal(d.file.url, block.id);
        break;
      case 'image':
      case 'gallery':
      case 'video':
      case 'audio':
        for (const slot of mediaSlots(block)) addMedia(slot.file.id, block.id);
        if (isBuiltInBlock(block)) break;
      // falls through: a custom block written before 2.3 under one of these names
      default:
        if (!isBuiltInBlock(block))
          for (const value of Object.values(d))
            if (isPlainObject(value) && value.id !== undefined && typeof value.url === 'string')
              addMedia(value.id, block.id);
    }
  }
  return {
    internal: [...internal.values()],
    external: [...external.values()],
    media: [...media.values()],
  };
};

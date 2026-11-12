/**
 * HTML to Editor.js blocks: clipboard HTML from Microsoft Word, Google Docs and
 * LibreOffice, and generic HTML (CMS exports, CKEditor/Tiptap fields).
 *
 * The converter works on a minimal node tree so the admin can use the
 * browser's DOMParser (`dom-adapter.mjs`) and the server htmlparser2
 * (`htmlparser-adapter.mjs`):
 *
 *   { type: 'element', name, attribs, children } | { type: 'text', data } | { type: 'comment', data }
 *
 * Output markup is built only from the converter's own tags (see MARKS in
 * common.mjs) with escaped text and validated URLs. Styles, classes, scripts,
 * comments and unknown elements are never copied.
 */

import { TABLE_ALIGNS, TABLE_LIMITS, cleanTableAlign, normalizeMerges } from '../table.mjs';
import {
  MAX_CONVERTED_BLOCKS,
  classifyImageSource,
  codeBlock,
  embedBlock,
  escapeText,
  imageBlock,
  isBlankInline,
  listBlock,
  tidyInline,
  withIds,
  wrapLink,
  wrapMark,
} from './common.mjs';
import { escapeHtml } from '../editor-data.mjs';
import { FOOTNOTE_ID, MAX_MEDIA_TRACKS, TRACK_KINDS, sanitizeUrl } from '../sanitize-policy.mjs';
import { canonicalInlineExtras } from '../render/inline.mjs';

/** Longest HTML input the converter reads (characters). */
export const MAX_HTML_LENGTH = 5 * 1024 * 1024;

const MAX_DEPTH = 64;

/** Elements that are removed with their content. */
const DROP = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'picture',
  'button',
  'input',
  'select',
  'option',
  'textarea',
  'frame',
  'frameset',
  'map',
  'xml',
]);

/** Elements that only group other blocks. */
const CONTAINERS = new Set([
  'html',
  'body',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'center',
  'form',
  'fieldset',
  'details',
  'summary',
  'dl',
  'dd',
  'dt',
  'address',
  'li',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'figcaption',
  'legend',
  'label',
  'hgroup',
]);

/** Elements that start a block of their own. */
const BLOCK_ELEMENTS = new Set([
  ...CONTAINERS,
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'table',
  'hr',
  'figure',
  'iframe',
]);

const isElement = (node) => node && node.type === 'element';
const attr = (node, name) =>
  isElement(node) && node.attribs && typeof node.attribs[name] === 'string' ? node.attribs[name] : '';
const styleOf = (node) => attr(node, 'style').toLowerCase();

/**
 * True for Word's list markers (`mso-list:Ignore`) and hidden elements.
 * @param {object} node - Element.
 * @returns {boolean} Result.
 */
const isHidden = (node) => {
  const style = styleOf(node);
  return /mso-list\s*:\s*ignore/.test(style) || /display\s*:\s*none/.test(style);
};

/**
 * Children without comments, without Word's conditional list markers
 * (`<!--[if !supportLists]-->…<!--[endif]-->`) and without hidden elements.
 * @param {Array<object>} nodes - Child nodes.
 * @returns {Array<object>} Visible nodes.
 */
const visible = (nodes) => {
  const out = [];
  let skipping = false;
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.type === 'comment') {
      const data = String(node.data || '');
      if (/^\s*\[if\s+!support(?:Lists|LineBreakNewLine|Annotations|Footnotes)\]/i.test(data))
        skipping = true;
      else if (/\[endif\]\s*$/i.test(data)) skipping = false;
      continue;
    }
    if (skipping) continue;
    if (node.type === 'text') out.push(node);
    else if (isElement(node) && !isHidden(node)) out.push(node);
  }
  return out;
};

/**
 * Text of a subtree (for code blocks and Word list markers); `<br>` becomes a line break.
 * @param {object} node - Node.
 * @param {number} [depth=0] - Depth.
 * @returns {string} Text.
 */
const textOf = (node, depth = 0) => {
  if (!node || depth > MAX_DEPTH) return '';
  if (node.type === 'text') return String(node.data || '');
  if (!isElement(node) || DROP.has(node.name)) return '';
  if (node.name === 'br') return '\n';
  return (node.children || [])
    .map((child) => (child.type === 'comment' ? '' : textOf(child, depth + 1)))
    .join('');
};

/**
 * True when an element contains block-level children (an inline element used
 * as a wrapper, such as the `<b id="docs-internal-guid-…">` of Google Docs).
 * @param {object} node - Element.
 * @returns {boolean} Result.
 */
const hasBlockChild = (node) =>
  (node.children || []).some((child) => isElement(child) && BLOCK_ELEMENTS.has(child.name));

/**
 * Inline marks from a style attribute (Google Docs and Word use styled spans).
 * @param {string} style - Lower-case style attribute.
 * @returns {string[]} Mark names.
 */
const marksFromStyle = (style) => {
  const marks = [];
  if (!style) return marks;
  const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style);
  if (weight && (/^(bold|bolder)$/.test(weight[1]) || Number(weight[1]) >= 600)) marks.push('bold');
  if (/font-style\s*:\s*(italic|oblique)/.test(style)) marks.push('italic');
  const decoration = /text-decoration(?:-line)?\s*:\s*([^;]+)/.exec(style);
  if (decoration && /underline/.test(decoration[1])) marks.push('underline');
  if (decoration && /line-through/.test(decoration[1])) marks.push('strike');
  const align = /vertical-align\s*:\s*(super|sub)/.exec(style);
  if (align) marks.push(align[1] === 'super' ? 'sup' : 'sub');
  return marks;
};

const TAG_MARKS = Object.freeze({
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  cite: 'italic',
  dfn: 'italic',
  var: 'italic',
  u: 'underline',
  ins: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  mark: 'mark',
  sub: 'sub',
  sup: 'sup',
});

/**
 * Renders inline content. Images are not rendered inline: they are collected
 * in `state.images` and become image blocks after the current block.
 * @param {Array<object>} nodes - Nodes.
 * @param {{ images: Array<object> }} state - Collected images.
 * @param {number} [depth=0] - Depth.
 * @returns {string} Inline HTML (built from the converter's own tags only).
 */
const inlineOf = (nodes, state, depth = 0) => {
  if (depth > MAX_DEPTH) return '';
  let html = '';
  let previousBlock = false;
  for (const node of visible(nodes)) {
    if (node.type === 'text') {
      html += escapeText(node.data || '');
      previousBlock = false;
      continue;
    }
    const name = node.name;
    if (DROP.has(name) && name !== 'video' && name !== 'audio') continue;
    if (name === 'br') {
      html += '<br>';
      continue;
    }
    if (name === 'img' || name === 'video' || name === 'audio') {
      // Videos and audio only become blocks with `media: 'collect'` (see pushMedia).
      state.images.push(node);
      continue;
    }
    if (name === 'iframe' || name === 'hr') continue;
    if (BLOCK_ELEMENTS.has(name) && name !== 'span') {
      // A paragraph inside a list item or a table cell: keep it on its own line.
      const inner = tidyInline(inlineOf(node.children, state, depth + 1));
      if (inner) {
        if (html && !previousBlock && !/<br>$/.test(html)) html += '<br>';
        else if (html && previousBlock) html += '<br>';
        html += inner;
        previousBlock = true;
      }
      continue;
    }
    previousBlock = false;
    // 2.4: inline math and footnote markers copied from a Magic Editor X field keep their
    // stored form (rebuilt through the strict inline parser, never copied markup).
    if (name === 'span' && Object.prototype.hasOwnProperty.call(node.attribs || {}, 'data-mex-math')) {
      const tex = textOf(node).replace(/\u200b/g, '');
      if (tex.trim()) html += `<span data-mex-math="true">${escapeText(tex)}</span>`;
      continue;
    }
    if (name === 'sup' && FOOTNOTE_ID.test(attr(node, 'data-mex-footnote'))) {
      html += canonicalInlineExtras(
        `<sup data-mex-footnote="${escapeHtml(attr(node, 'data-mex-footnote'))}" data-mex-note="${escapeHtml(attr(node, 'data-mex-note'))}">*</sup>`
      );
      continue;
    }
    if (name === 'code' || name === 'kbd' || name === 'samp' || name === 'tt') {
      html += wrapMark(escapeText(textOf(node)), 'code');
      continue;
    }
    let inner = inlineOf(node.children, state, depth + 1);
    if (name === 'a') {
      html += wrapLink(inner, attr(node, 'href'));
      continue;
    }
    const style = styleOf(node);
    const marks = [];
    const tagMark = TAG_MARKS[name];
    // Google Docs wraps the whole clipboard in <b style="font-weight:normal">.
    if (tagMark && !(tagMark === 'bold' && /font-weight\s*:\s*(normal|400)/.test(style))) marks.push(tagMark);
    for (const mark of marksFromStyle(style)) if (!marks.includes(mark)) marks.push(mark);
    for (const mark of marks) inner = wrapMark(inner, mark);
    html += inner;
  }
  return html;
};

/**
 * Collects the conversion result.
 * @param {{ dataImages?: 'skip'|'placeholder' }} options - Options.
 * @returns {object} Context.
 */
const createContext = (options) => ({
  blocks: [],
  images: [],
  media: options.media === 'collect' ? [] : null,
  skipped: new Map(),
  dataImages: options.dataImages === 'placeholder' ? 'placeholder' : 'skip',
  full: false,
});

const skip = (ctx, reason, tag) => {
  const key = `${reason}|${tag || ''}`;
  const entry = ctx.skipped.get(key) || { reason, ...(tag ? { tag } : {}), count: 0 };
  entry.count += 1;
  ctx.skipped.set(key, entry);
};

const push = (ctx, block) => {
  if (!block) return;
  if (ctx.blocks.length >= MAX_CONVERTED_BLOCKS) {
    if (!ctx.full) skip(ctx, 'too-many-blocks');
    ctx.full = true;
    return;
  }
  ctx.blocks.push(block);
};

/**
 * Adds an image block for an `<img>` element (or reports why it was left out).
 * @param {object} ctx - Context.
 * @param {object} node - `<img>` element.
 * @param {string} [caption=''] - Caption HTML.
 */
const pushImage = (ctx, node, caption = '') => {
  const src = attr(node, 'src');
  const { kind, url } = classifyImageSource(src);
  const width = Number(attr(node, 'width'));
  const height = Number(attr(node, 'height'));
  const extra = {
    alt: attr(node, 'alt').trim(),
    caption,
    ...(Number.isInteger(width) && width > 0 ? { width } : {}),
    ...(Number.isInteger(height) && height > 0 ? { height } : {}),
  };
  if (kind === 'remote' || kind === 'relative') {
    ctx.images.push({ index: ctx.blocks.length, src: url, kind });
    push(ctx, imageBlock(url, extra));
  } else if (kind === 'data' && ctx.dataImages === 'placeholder') {
    ctx.images.push({ index: ctx.blocks.length, src, kind });
    push(ctx, imageBlock('', extra));
  } else {
    // file:, blob: and other local sources cannot be read; their path is never reported.
    ctx.images.push({ index: -1, src: kind === 'data' ? src : '', kind });
    skip(ctx, 'image', kind);
  }
};

const pushImages = (ctx, images) =>
  images.forEach((node) => {
    if (node.name === 'video' || node.name === 'audio') {
      // Without `media: 'collect'` inline videos and audio are left out silently (2.3 behaviour).
      if (ctx.media) pushMedia(ctx, node);
    } else pushImage(ctx, node);
  });

/**
 * An http(s) URL of a pasted media element, or '' (data:, blob:, file:,
 * relative and other sources are never fetched).
 * @param {string} value - Attribute value.
 * @returns {string} URL.
 */
const remoteMediaUrl = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^https?:/i.test(text)
    ? sanitizeUrl(text, { schemes: ['http', 'https'], allowRelative: false })
    : '';
};

const hasAttr = (node, name) =>
  Boolean(node.attribs && Object.prototype.hasOwnProperty.call(node.attribs, name));

/**
 * Collects a pasted `<video>` or `<audio>` (2.4, `media: 'collect'`): the
 * file URL (`src`, else the first `<source src>` with a matching or no
 * `type`), the poster, up to 8 `<track>` elements, title, loop and muted.
 * The block made here is a placeholder; the caller copies the files into the
 * Media Library and builds the block (`report.media[].index`). A media
 * element without a usable http(s) URL is reported with `index: -1`.
 * @param {object} ctx - Context.
 * @param {object} node - `<video>` or `<audio>`.
 * @param {string} [caption=''] - Caption HTML (from a figure).
 */
const pushMedia = (ctx, node, caption = '') => {
  const kind = node.name;
  const children = (node.children || []).filter(isElement);
  let src = remoteMediaUrl(attr(node, 'src'));
  if (!src) {
    const sources = children.filter((child) => child.name === 'source');
    const typed = sources.find((child) => attr(child, 'type').toLowerCase().startsWith(`${kind}/`));
    const candidate = typed || sources.find((child) => !attr(child, 'type')) || sources[0];
    src = candidate ? remoteMediaUrl(attr(candidate, 'src')) : '';
  }
  if (!src) {
    ctx.media.push({ index: -1, kind, src: '' });
    skip(ctx, 'media', kind);
    return;
  }
  const tracks = children
    .filter((child) => child.name === 'track')
    .map((child) => {
      const trackKind = attr(child, 'kind').toLowerCase() || 'subtitles';
      return {
        src: remoteMediaUrl(attr(child, 'src')),
        kind: TRACK_KINDS.includes(trackKind) ? trackKind : 'subtitles',
        srclang: attr(child, 'srclang').trim().slice(0, 35),
        label: attr(child, 'label').trim().slice(0, 100),
        default: hasAttr(child, 'default'),
      };
    })
    .filter((track) => track.src)
    .slice(0, MAX_MEDIA_TRACKS);
  const title = (attr(node, 'title') || attr(node, 'aria-label')).replace(/\s+/g, ' ').trim().slice(0, 200);
  const entry = {
    index: ctx.blocks.length,
    kind,
    src,
    title,
    caption,
    loop: hasAttr(node, 'loop'),
    tracks,
  };
  if (kind === 'video') {
    entry.muted = hasAttr(node, 'muted');
    entry.poster = remoteMediaUrl(attr(node, 'poster'));
  }
  ctx.media.push(entry);
  push(ctx, {
    type: kind,
    data: {
      file: { url: '' },
      title,
      caption,
      loop: entry.loop,
      ...(kind === 'video' ? { muted: entry.muted } : {}),
      tracks: [],
    },
  });
};

/**
 * Adds a paragraph (and the images found in it).
 * @param {object} ctx - Context.
 * @param {Array<object>} nodes - Inline nodes.
 */
const pushParagraph = (ctx, nodes) => {
  const state = { images: [] };
  const text = tidyInline(inlineOf(nodes, state));
  if (!isBlankInline(text)) push(ctx, { type: 'paragraph', data: { text } });
  pushImages(ctx, state.images);
};

/**
 * Heading level from a Word paragraph class (MsoTitle, MsoSubtitle, MsoHeading3 …).
 * @param {object} node - `<p>` element.
 * @returns {number|null} Level.
 */
const wordHeadingLevel = (node) => {
  const className = attr(node, 'class');
  if (/\bMsoTitle\b/i.test(className)) return 1;
  if (/\bMsoSubtitle\b/i.test(className)) return 2;
  const match = /\bMsoHeading([1-9])\b/i.exec(className);
  return match ? Math.min(Number(match[1]), 6) : null;
};

/**
 * Word list paragraph info (`mso-list:l0 level2 lfo1`).
 * @param {object} node - Element.
 * @returns {{ list: string, level: number } | null} Info.
 */
const wordListInfo = (node) => {
  if (!isElement(node) || !/^(p|h[1-6]|div)$/.test(node.name)) return null;
  const match = /mso-list\s*:\s*(l\d+)\s+level(\d+)/.exec(styleOf(node));
  return match ? { list: match[1], level: Math.max(1, Math.min(Number(match[2]), 9)) } : null;
};

/**
 * Text of Word's list marker ("1.", "a)", "·") of a list paragraph.
 * @param {object} node - List paragraph.
 * @returns {string} Marker text.
 */
const wordMarker = (node) => {
  let inside = false;
  let text = '';
  for (const child of node.children || []) {
    if (child.type === 'comment') {
      if (/^\s*\[if\s+!supportLists\]/i.test(String(child.data))) inside = true;
      else if (/\[endif\]\s*$/i.test(String(child.data))) inside = false;
      continue;
    }
    if (inside) text += textOf(child);
    else if (isElement(child) && /mso-list\s*:\s*ignore/.test(styleOf(child))) text += textOf(child);
  }
  return text.replace(/\s+/g, ' ').trim();
};

/**
 * Builds nested items from a flat list of `{ level, content }`.
 * @param {Array<{ level: number, content: string, items?: Array }>} flat - Items with levels.
 * @returns {Array<{ content: string, items: Array }>} Nested items (other keys of each entry are kept).
 */
const nestByLevel = (flat) => {
  const root = { items: [], level: 0 };
  const stack = [root];
  for (const entry of flat) {
    const item = { ...entry, items: entry.items ? [...entry.items] : [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= entry.level) stack.pop();
    stack[stack.length - 1].items.push(item);
    stack.push({ items: item.items, level: entry.level });
  }
  return root.items;
};

/**
 * Converts a run of Word list paragraphs into one list block.
 * @param {object} ctx - Context.
 * @param {Array<object>} paragraphs - List paragraphs of one list.
 */
const pushWordList = (ctx, paragraphs) => {
  const state = { images: [] };
  const flat = paragraphs.map((node) => ({
    level: wordListInfo(node).level,
    content: tidyInline(inlineOf(node.children, state)),
  }));
  const marker = wordMarker(paragraphs[0]);
  const ordered = /^\(?[0-9a-zA-Z]{1,4}[.)]$/.test(marker);
  const start = ordered && /^\d+/.test(marker) ? parseInt(marker, 10) : 1;
  push(ctx, listBlock(ordered, nestByLevel(flat), start));
  pushImages(ctx, state.images);
};

/**
 * Reads the items of an HTML list, including nested lists, task checkboxes and
 * Google Docs' `aria-level`.
 * @param {object} node - `<ul>` or `<ol>`.
 * @param {{ images: Array<object> }} state - Collected images.
 * @param {number} [depth=0] - Depth.
 * @returns {Array<{ content: string, items: Array, task: boolean, checked: boolean, level: number }>} Items.
 */
const listItemsOf = (node, state, depth = 0) => {
  if (depth > 12) return [];
  const items = [];
  for (const child of visible(node.children)) {
    if (!isElement(child)) continue;
    if (child.name === 'ul' || child.name === 'ol') {
      // A nested list placed directly in the list belongs to the previous item.
      const nested = listItemsOf(child, state, depth + 1);
      if (items.length) items[items.length - 1].items.push(...nested);
      else items.push(...nested);
      continue;
    }
    if (child.name !== 'li') continue;
    const content = [];
    const nested = [];
    let task = /\btask-list-item\b/.test(attr(child, 'class'));
    let checked = false;
    const findCheckbox = (nodes, level = 0) => {
      for (const inner of nodes || []) {
        if (!isElement(inner) || level > 3) continue;
        if (inner.name === 'input' && attr(inner, 'type').toLowerCase() === 'checkbox') {
          task = true;
          checked = checked || Object.prototype.hasOwnProperty.call(inner.attribs || {}, 'checked');
        } else if (/^(p|label|span|div)$/.test(inner.name)) findCheckbox(inner.children, level + 1);
      }
    };
    findCheckbox(child.children);
    for (const inner of visible(child.children)) {
      if (isElement(inner) && (inner.name === 'ul' || inner.name === 'ol'))
        nested.push(...listItemsOf(inner, state, depth + 1));
      else content.push(inner);
    }
    const level = Number(attr(child, 'aria-level'));
    items.push({
      content: tidyInline(inlineOf(content, state)),
      items: nested,
      task,
      checked: checked || attr(child, 'aria-checked') === 'true',
      level: Number.isInteger(level) && level > 0 && level < 10 ? level : 1,
    });
  }
  // Google Docs keeps nested items flat and marks them with aria-level.
  if (items.some((item) => item.level > 1)) {
    return nestByLevel(items);
  }
  return items;
};

const flattenItems = (items) => items.flatMap((item) => [item, ...flattenItems(item.items || [])]);

/**
 * Converts `<ul>`/`<ol>` into a list or checklist block.
 * @param {object} ctx - Context.
 * @param {object} node - List element.
 */
const pushList = (ctx, node) => {
  const state = { images: [] };
  const items = listItemsOf(node, state);
  if (!items.length) return;
  const flat = flattenItems(items);
  if (flat.every((item) => item.task)) {
    push(ctx, {
      type: 'checklist',
      data: { items: flat.map((item) => ({ text: item.content, checked: Boolean(item.checked) })) },
    });
  } else {
    const start = Number(attr(node, 'start'));
    push(ctx, listBlock(node.name === 'ol', items, Number.isInteger(start) ? start : 1));
  }
  pushImages(ctx, state.images);
};

/**
 * Explicit alignment of a cell: `text-align` or `align` on the cell, else the
 * one alignment all its paragraphs share (Word and Google Docs align the
 * paragraph inside the cell).
 * @param {object} cell - `<td>`/`<th>`.
 * @returns {'left'|'center'|'right'|null} Alignment.
 */
const cellAlign = (cell) => {
  const read = (node) => {
    const match = /(?:^|;)\s*text-align\s*:\s*([a-z]+)/.exec(styleOf(node));
    const value = match ? match[1] : attr(node, 'align').toLowerCase();
    return TABLE_ALIGNS.includes(value) ? value : null;
  };
  const own = read(cell);
  if (own) return own;
  const paragraphs = visible(cell.children).filter(
    (node) => isElement(node) && /^(p|div|h[1-6])$/.test(node.name)
  );
  const values = paragraphs.map(read);
  return values.length && values.every((value) => value && value === values[0]) ? values[0] : null;
};

/** A `colspan`/`rowspan` value, 1 when missing or invalid, at most `max`. */
const spanOf = (value, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 1 ? Math.min(number, Math.max(max, 1)) : 1;
};

/**
 * Converts a table. The first row is a header row when it is in `<thead>` or
 * uses only `<th>`; the first column is a header column when every body row
 * starts with a `<th>` and the body has data cells. `colspan`/`rowspan`
 * become merged cells (a rowspan ends with its row group), `text-align`/`align`
 * shared by a column's body cells becomes its alignment, `<caption>` the caption.
 * @param {object} ctx - Context.
 * @param {object} node - `<table>`.
 */
const pushTable = (ctx, node) => {
  const rows = [];
  const state = { images: [] };
  let caption = '';
  let group = 0;
  const collect = (nodes, inHead, depth = 0) => {
    for (const child of visible(nodes)) {
      if (!isElement(child) || depth > 3) continue;
      if (child.name === 'tr') {
        const cells = visible(child.children).filter(
          (cell) => isElement(cell) && (cell.name === 'td' || cell.name === 'th')
        );
        if (cells.length && rows.length < TABLE_LIMITS.rows) rows.push({ cells, head: inHead, group });
      } else if (/^(thead|tbody|tfoot)$/.test(child.name)) {
        group += 1;
        collect(child.children, child.name === 'thead', depth + 1);
        group += 1;
      } else if (child.name === 'caption' && depth === 0 && !caption)
        caption = tidyInline(inlineOf(child.children, state));
    }
  };
  collect(node.children, false);
  if (!rows.length) return;
  // Grid of anchor cells (the HTML table model, bounded): covered slots hold COVERED.
  const COVERED = {};
  const grid = rows.map(() => []);
  const merges = [];
  rows.forEach((row, r) => {
    let groupEnd = r;
    while (groupEnd + 1 < rows.length && rows[groupEnd + 1].group === row.group) groupEnd += 1;
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c]) c += 1;
      if (c >= TABLE_LIMITS.cols) break;
      const colspan = spanOf(attr(cell, 'colspan'), TABLE_LIMITS.cols - c);
      const rowspan = spanOf(attr(cell, 'rowspan'), groupEnd - r + 1);
      for (let rr = 0; rr < rowspan; rr += 1)
        for (let cc = 0; cc < colspan; cc += 1) grid[r + rr][c + cc] = rr || cc ? COVERED : cell;
      if (rowspan * colspan > 1) merges.push({ row: r, col: c, rowspan, colspan });
      c += colspan;
    }
  });
  const width = Math.max(...grid.map((row) => row.length));
  const anchor = (r, c) => (grid[r][c] && grid[r][c] !== COVERED ? grid[r][c] : null);
  const content = grid.map((row, r) =>
    Array.from({ length: width }, (_, c) => {
      const cell = anchor(r, c);
      return cell ? tidyInline(inlineOf(cell.children, state)) : '';
    })
  );
  const withHeadings = rows[0].head || rows[0].cells.every((cell) => cell.name === 'th');
  const data = { withHeadings, stretched: false, content };
  const body = rows.map((_, r) => r).slice(withHeadings ? 1 : 0);
  const starts = body.map((r) => anchor(r, 0)).filter(Boolean);
  if (
    starts.length &&
    starts.every((cell) => cell.name === 'th') &&
    body.some((r) => grid[r].some((cell) => cell && cell !== COVERED && cell.name === 'td'))
  )
    data.headerColumn = true;
  const alignRows = body.length ? body : [0];
  const align = cleanTableAlign(
    Array.from({ length: width }, (_, c) => {
      const values = alignRows
        .map((r) => anchor(r, c))
        .filter(
          (cell) => cell && spanOf(attr(cell, 'colspan'), 2) === 1 && cell.children && cell.children.length
        )
        .map(cellAlign);
      return values.length && values.every((value) => value && value === values[0]) ? values[0] : null;
    }),
    width
  );
  if (align) data.align = align;
  const valid = normalizeMerges(merges, content.length, width, { headerRow: withHeadings });
  if (valid.length) data.merges = valid;
  if (caption && !isBlankInline(caption)) data.caption = caption;
  push(ctx, { type: 'table', data });
  pushImages(ctx, state.images);
};

/**
 * Converts `<pre>` (optionally with `<code class="language-x">`).
 * @param {object} ctx - Context.
 * @param {object} node - `<pre>`.
 */
const pushCode = (ctx, node, filename) => {
  const code = visible(node.children).find((child) => isElement(child) && child.name === 'code');
  const className = `${attr(node, 'class')} ${code ? attr(code, 'class') : ''}`;
  const language = (/\b(?:language|lang)-([a-z0-9+#-]{1,32})\b/i.exec(className) || [])[1];
  const text = textOf(node);
  if (text.trim()) push(ctx, codeBlock(text, language, filename));
};

/**
 * Converts `<figure>` with an image, a video frame or code (2.4) and an optional caption.
 * @param {object} ctx - Context.
 * @param {object} node - `<figure>`.
 */
const pushFigure = (ctx, node) => {
  const children = visible(node.children);
  const captionNode = children.find((child) => isElement(child) && child.name === 'figcaption');
  const caption = captionNode ? tidyInline(inlineOf(captionNode.children, { images: [] })) : '';
  const find = (nodes, name, depth = 0) => {
    for (const child of nodes || []) {
      if (!isElement(child) || depth > 4) continue;
      if (child.name === name) return child;
      const found = find(child.children, name, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const img = find(children, 'img');
  if (img) {
    pushImage(ctx, img, caption);
    return;
  }
  const media = ctx.media ? find(children, 'video') || find(children, 'audio') : null;
  if (media) {
    pushMedia(ctx, media, caption);
    return;
  }
  const frame = find(children, 'iframe');
  if (frame) {
    const embed = embedBlock(attr(frame, 'src'), caption);
    if (embed) push(ctx, embed);
    else skip(ctx, 'unsupported-element', 'iframe');
    return;
  }
  // 2.4: code with a file name (`<figure><figcaption>name</figcaption><pre>`, the renderers' output).
  const body = children.filter((child) => isElement(child) && child.name !== 'figcaption');
  const pre = body.length === 1 ? (body[0].name === 'pre' ? body[0] : find(body[0].children, 'pre')) : null;
  if (pre) {
    pushCode(ctx, pre, captionNode ? textOf(captionNode) : '');
    return;
  }
  walkBlocks(ctx, children, 1);
};

/**
 * Walks block-level content.
 * @param {object} ctx - Context.
 * @param {Array<object>} nodes - Nodes.
 * @param {number} depth - Depth.
 */
const walkBlocks = (ctx, nodes, depth) => {
  if (depth > MAX_DEPTH || ctx.full) return;
  const list = visible(nodes);
  let pending = [];
  const flush = () => {
    if (pending.length) pushParagraph(ctx, pending);
    pending = [];
  };
  for (let index = 0; index < list.length; index += 1) {
    const node = list[index];
    if (node.type === 'text') {
      pending.push(node);
      continue;
    }
    const name = node.name;
    if (ctx.media && (name === 'video' || name === 'audio')) {
      flush();
      pushMedia(ctx, node);
      continue;
    }
    if (DROP.has(name)) {
      if (!/^(head|meta|link|style|title|base|xml)$/.test(name)) skip(ctx, 'unsupported-element', name);
      continue;
    }
    const wordList = wordListInfo(node);
    if (wordList) {
      flush();
      const run = [node];
      while (index + 1 < list.length) {
        const next = list[index + 1];
        if (next.type === 'text' && !String(next.data).trim()) {
          index += 1;
          continue;
        }
        const info = wordListInfo(next);
        if (!info || info.list !== wordList.list) break;
        run.push(next);
        index += 1;
      }
      pushWordList(ctx, run);
      continue;
    }
    if (/^h[1-6]$/.test(name) || (name === 'p' && wordHeadingLevel(node))) {
      flush();
      const state = { images: [] };
      const text = tidyInline(inlineOf(node.children, state));
      const level = name === 'p' ? wordHeadingLevel(node) : Number(name[1]);
      if (!isBlankInline(text)) push(ctx, { type: 'header', data: { text, level } });
      pushImages(ctx, state.images);
      continue;
    }
    switch (name) {
      case 'p':
        flush();
        if (hasBlockChild(node)) walkBlocks(ctx, node.children, depth + 1);
        else pushParagraph(ctx, node.children);
        continue;
      case 'ul':
      case 'ol':
        flush();
        pushList(ctx, node);
        continue;
      case 'blockquote': {
        flush();
        const state = { images: [] };
        const text = tidyInline(inlineOf(node.children, state));
        if (!isBlankInline(text))
          push(ctx, { type: 'quote', data: { text, caption: '', alignment: 'left' } });
        pushImages(ctx, state.images);
        continue;
      }
      case 'pre':
        flush();
        pushCode(ctx, node);
        continue;
      case 'table':
        flush();
        pushTable(ctx, node);
        continue;
      case 'hr':
        flush();
        push(ctx, { type: 'delimiter', data: {} });
        continue;
      case 'img':
        flush();
        pushImage(ctx, node);
        continue;
      case 'figure':
        flush();
        pushFigure(ctx, node);
        continue;
      case 'iframe': {
        flush();
        const embed = embedBlock(attr(node, 'src'));
        if (embed) push(ctx, embed);
        else skip(ctx, 'unsupported-element', 'iframe');
        continue;
      }
      default:
        break;
    }
    if (CONTAINERS.has(name) || hasBlockChild(node)) {
      flush();
      walkBlocks(ctx, node.children, depth + 1);
      continue;
    }
    pending.push(node);
  }
  flush();
};

/**
 * Converts HTML into Editor.js blocks.
 * @param {string} html - Untrusted HTML.
 * @param {{ parse: (html: string) => Array<object>, dataImages?: 'skip'|'placeholder', media?: 'skip'|'collect' }} options - `parse` turns HTML into the node tree (see the adapters); `dataImages: 'placeholder'` keeps an empty image block for each `data:` image so a caller can upload it; `media: 'collect'` (2.4) turns `<video>`/`<audio>` with an http(s) source into placeholder `video`/`audio` blocks listed in `report.media` (`[{ index, kind, src, title, caption, loop, muted?, poster?, tracks: [{ src, kind, srclang, label, default }] }]`, `index: -1` and reason `media` when there is no usable URL) so a caller can copy the files into the Media Library; by default they are skipped as before.
 * @returns {{ blocks: Array<{id: string, type: string, data: object}>, report: { skipped: Array<{reason: string, tag?: string, count: number}>, images: Array<{index: number, src: string, kind: 'remote'|'relative'|'data'|'unsupported'}> } }} Blocks and what was left out. `images[].index` is the block index, -1 when no block was made; `src` is '' for local files.
 * @throws {TypeError} When `parse` is missing.
 */
export const htmlToBlocks = (html, options = {}) => {
  if (typeof options.parse !== 'function') throw new TypeError('htmlToBlocks needs a parse function');
  const ctx = createContext(options);
  const source = typeof html === 'string' ? html : '';
  if (source.length > MAX_HTML_LENGTH) {
    skip(ctx, 'too-large');
  } else if (source.trim()) {
    const nodes = options.parse(source);
    walkBlocks(ctx, Array.isArray(nodes) ? nodes : [], 0);
  }
  return {
    blocks: withIds(ctx.blocks),
    report: {
      skipped: Array.from(ctx.skipped.values()),
      images: ctx.images,
      ...(ctx.media ? { media: ctx.media } : {}),
    },
  };
};

/**
 * Converts inline HTML (one text field) with the same rules as htmlToBlocks.
 * @param {string} html - Untrusted inline HTML.
 * @param {(html: string) => Array<object>} parse - Parser (see the adapters).
 * @returns {string} Inline HTML built from the converter's own tags.
 */
export const htmlToInline = (html, parse) =>
  tidyInline(inlineOf(parse(typeof html === 'string' ? html : ''), { images: [] }));

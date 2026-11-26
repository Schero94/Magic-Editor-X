/**
 * Magic Editor X (Editor.js) data to Strapi 5 Blocks JSON (2.13, `?mex=blocks`, GraphQL
 * `<field>Blocks`).
 *
 * Target format: the one Strapi's Blocks field stores and `@strapi/blocks-react-renderer` 1.0.2
 * renders, checked against the installed Strapi 5.63/5.64 server validator
 * (`@strapi/core/dist/services/entity-validator/blocks-validator.js`):
 * - root nodes `paragraph`, `heading` (`level` 1-6), `quote`, `code` (`language`, text children
 *   only), `list` (`format` `ordered`|`unordered`, children `list-item` and nested `list`),
 *   `image` (`image` = Media Library file, children `[{ type: 'text', text: '' }]`);
 * - inline nodes `text` (`text`, optional `bold`, `italic`, `underline`, `strikethrough`, `code`)
 *   and `link` (`url` with http, https, ftp, mailto or tel, or a path starting with `/`;
 *   children text nodes only). Paragraph, heading and quote need at least one child.
 *
 * The supported subset maps without loss. Every other block gets a documented fallback (see
 * `BLOCKS_FALLBACKS` and the README table): plain paragraphs, a link, a code block or nothing.
 * With `extensions: true` those blocks become extension nodes instead,
 * `{ type: 'magic-editor-x/<block>', data, children: [{ type: 'text', text: <plain text> }] }`,
 * which a site renders with its own `blocks` component (the renderer skips unknown types with a
 * console warning). `data` is the block data as the API serves it (references resolved).
 *
 * Pure and bounded: input is the cleaned, resolved value of the output pipeline
 * (services/references.js); this module never fetches anything.
 */

import { isPlainObject, normalizeEditorDataSafe } from '../editor-data.mjs';
import { parseInline, isMathNode, isFootnoteNode } from '../render/inline.mjs';
import { renderText } from '../render/text.mjs';
import { isBuiltInBlock } from '../sanitize-policy.mjs';

/** Prefix of extension node types. */
export const EXTENSION_PREFIX = 'magic-editor-x/';

/** Link protocols the Strapi Blocks validator accepts (relative paths start with `/`). */
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'mailto:', 'tel:']);
const MARK_TAGS = Object.freeze({
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
  s: 'strikethrough',
  del: 'strikethrough',
  strike: 'strikethrough',
  code: 'code',
});
const MARK_ORDER = Object.freeze(['bold', 'italic', 'underline', 'strikethrough', 'code']);
const MAX_LIST_DEPTH = 12;
const MAX_INLINE_DEPTH = 32;
const BLOCK_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Fallback of every block type that Strapi Blocks cannot hold (without `extensions`). The keys
 * are the documented contract (README "Strapi Blocks output"); `tests/to-strapi-blocks.test.mjs`
 * checks each one.
 */
export const BLOCKS_FALLBACKS = Object.freeze({
  checklist: 'list (unordered; the checked state is lost)',
  table: 'one paragraph per row, cells separated by " | " (header row bold)',
  warning: 'quote (title bold, then the message)',
  alert: 'quote',
  toggle: 'paragraph (the toggle title; the blocks inside follow as usual)',
  delimiter: 'left out',
  toc: 'left out',
  embed: 'paragraph with a link to the source (caption as link text)',
  linkTool: 'paragraph with a link (title as link text)',
  button: 'paragraph with a link',
  attaches: 'paragraph with a link to the file',
  video: 'paragraph with a link to the file',
  audio: 'paragraph with a link to the file',
  gallery: 'one image node per image',
  math: 'code block with language "latex"',
  columns: 'the column items in reading order (paragraphs, headings, lists)',
  personality: 'paragraph (name bold, description, link)',
  raw: 'left out (also with extensions)',
  component: 'left out',
  custom: 'paragraphs with the plain text of the block',
});

/**
 * Safe link URL for Strapi Blocks, or null when the validator would refuse it.
 * @param {unknown} href - Link target.
 * @returns {string|null} URL.
 */
export const blocksLinkUrl = (href) => {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (!value || value.length > 2048) return null;
  if (value.startsWith('/')) return value.startsWith('//') ? null : value;
  try {
    return LINK_PROTOCOLS.has(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Text node with the active marks (only `true` flags are written).
 * @param {string} text - Text.
 * @param {Record<string, boolean>} marks - Active marks.
 * @returns {{ type: 'text', text: string }} Node.
 */
const textNode = (text, marks) => {
  const node = { type: 'text', text };
  for (const mark of MARK_ORDER) if (marks[mark]) node[mark] = true;
  return node;
};

const sameMarks = (a, b) => MARK_ORDER.every((mark) => Boolean(a[mark]) === Boolean(b[mark]));

/**
 * Appends a text node, merging it with the previous one when the marks are equal.
 * @param {Array<object>} out - Inline nodes.
 * @param {string} text - Text.
 * @param {Record<string, boolean>} marks - Marks.
 */
const pushText = (out, text, marks) => {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text' && sameMarks(last, marks)) last.text += text;
  else out.push(textNode(text, marks));
};

/**
 * Converts parsed inline nodes into Blocks inline nodes.
 * @param {Array<object>} nodes - `parseInline` nodes.
 * @param {{ marks: Record<string, boolean>, out: Array<object>, inLink: boolean, depth: number, lossy: Set<string> }} state - Walk state.
 */
const walkInline = (nodes, state) => {
  if (state.depth > MAX_INLINE_DEPTH) return;
  for (const node of nodes) {
    if (node.type === 'text') {
      pushText(state.out, node.value, state.marks);
      continue;
    }
    if (node.type !== 'element') continue;
    if (node.tag === 'br') {
      pushText(state.out, '\n', state.marks);
      continue;
    }
    // Footnote markers have no Blocks form: the marker goes, the note is lost.
    if (isFootnoteNode(node)) {
      state.lossy.add('footnote');
      continue;
    }
    // Inline math keeps its TeX source as inline code.
    if (isMathNode(node)) {
      state.lossy.add('inline-math');
      const tex = node.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
      pushText(state.out, tex, { ...state.marks, code: true });
      continue;
    }
    if (node.tag === 'a' && !state.inLink) {
      const url = blocksLinkUrl(node.attrs && node.attrs.href);
      if (url) {
        const children = [];
        walkInline(node.children, { ...state, out: children, inLink: true, depth: state.depth + 1 });
        if (children.length) state.out.push({ type: 'link', url, children });
        continue;
      }
      if (node.attrs && node.attrs.href) state.lossy.add('link');
    }
    const mark = MARK_TAGS[node.tag];
    if (!mark && !['a', 'span', 'p'].includes(node.tag)) state.lossy.add('inline-format');
    else if (node.tag === 'span' && node.attrs && Object.keys(node.attrs).length)
      state.lossy.add('inline-format');
    walkInline(node.children, {
      ...state,
      marks: mark ? { ...state.marks, [mark]: true } : state.marks,
      depth: state.depth + 1,
    });
  }
};

/**
 * Inline HTML to Blocks inline nodes.
 * @param {unknown} html - Inline HTML (stored form).
 * @param {Set<string>} [lossy] - Collects what could not be kept.
 * @param {Record<string, boolean>} [marks] - Marks applied to everything.
 * @returns {Array<object>} Inline nodes (possibly empty).
 */
export const inlineToBlocks = (html, lossy = new Set(), marks = {}) => {
  const out = [];
  walkInline(parseInline(typeof html === 'string' ? html : ''), {
    marks,
    out,
    inLink: false,
    depth: 0,
    lossy,
  });
  return out;
};

/**
 * Plain text of inline HTML (line breaks kept as `\n`).
 * @param {unknown} html - Inline HTML.
 * @returns {string} Text.
 */
const plainOf = (html) =>
  inlineToBlocks(html)
    .map((node) => (node.type === 'link' ? node.children.map((child) => child.text).join('') : node.text))
    .join('');

/** At least one child, as the validator requires for paragraphs, headings and quotes. */
const filled = (children) => (children.length ? children : [{ type: 'text', text: '' }]);

const paragraph = (children) => ({ type: 'paragraph', children: filled(children) });

/**
 * Paragraph holding one link (or its text when the URL is not allowed).
 * @param {string} label - Link text.
 * @param {unknown} href - URL.
 * @returns {object|null} Paragraph, or null with neither text nor URL.
 */
const linkParagraph = (label, href) => {
  const url = blocksLinkUrl(href);
  const text = String(label || '').trim() || (url ? url : '');
  if (!text) return null;
  return paragraph(
    url ? [{ type: 'link', url, children: [{ type: 'text', text }] }] : [{ type: 'text', text }]
  );
};

/**
 * Editor.js list items (2.x objects or 1.x strings) to Blocks list children.
 * @param {Array<unknown>} items - Items.
 * @param {'ordered'|'unordered'} format - List format.
 * @param {Set<string>} lossy - Lossy notes.
 * @param {number} depth - Nesting depth.
 * @returns {Array<object>} `list-item` and nested `list` nodes.
 */
const listChildren = (items, format, lossy, depth) => {
  const out = [];
  if (!Array.isArray(items) || depth > MAX_LIST_DEPTH) return out;
  for (const item of items) {
    const content = typeof item === 'string' ? item : isPlainObject(item) ? item.content : '';
    out.push({ type: 'list-item', children: filled(inlineToBlocks(content, lossy)) });
    const nested = isPlainObject(item) && Array.isArray(item.items) ? item.items : [];
    if (nested.length) {
      const children = listChildren(nested, format, lossy, depth + 1);
      if (children.length) out.push({ type: 'list', format, children });
    }
  }
  return out;
};

/**
 * Media Library file of an image block as the Blocks `image` object. Keys the API does not know
 * are left out (no invented hash, size or provider); the renderer needs `url` and uses
 * `alternativeText`, `width` and `height`.
 * @param {object} file - Stored (resolved) file.
 * @param {{ caption?: string, decorative?: boolean }} extra - Caption (plain text) and decorative flag.
 * @returns {object|null} Image object, or null without a URL.
 */
const imageObject = (file, extra = {}) => {
  if (!isPlainObject(file) || typeof file.url !== 'string') return null;
  // Images load from http(s) or a site path only (no javascript:, data: or protocol-relative URLs).
  const url = blocksLinkUrl(file.url);
  if (!url || !/^(?:https?:|\/)/i.test(url)) return null;
  const image = { url };
  const name =
    typeof file.name === 'string' && file.name ? file.name : file.url.split(/[?#]/)[0].split('/').pop();
  if (name) image.name = name;
  image.alternativeText = extra.decorative ? '' : typeof file.alt === 'string' ? file.alt : null;
  image.caption = extra.caption ? extra.caption : null;
  for (const key of ['width', 'height', 'size'])
    if (typeof file[key] === 'number' && Number.isFinite(file[key])) image[key] = file[key];
  for (const key of ['hash', 'ext', 'mime'])
    if (typeof file[key] === 'string' && file[key]) image[key] = file[key];
  // Always an object: older Strapi Blocks validators (5.38) require `formats`; `{}` = no formats.
  image.formats = isPlainObject(file.formats) ? file.formats : {};
  if (file.id !== undefined) image.id = file.id;
  if (typeof file.documentId === 'string') image.documentId = file.documentId;
  return image;
};

const imageNode = (image) => ({ type: 'image', image, children: [{ type: 'text', text: '' }] });

/**
 * Plain text of one block through the text renderer (fallback for custom and unknown blocks).
 * @param {object} block - Block.
 * @param {object} document - Whole value (time and version for the renderer).
 * @returns {string} Text.
 */
const blockText = (block, document) => {
  try {
    return renderText({ time: document.time || 0, version: document.version || '', blocks: [block] }).trim();
  } catch {
    return '';
  }
};

/**
 * Paragraphs from plain text (blank lines separate paragraphs, single line breaks stay).
 * @param {string} text - Text.
 * @returns {Array<object>} Paragraphs.
 */
const textParagraphs = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => paragraph([{ type: 'text', text: part }]));

/**
 * Converts one built-in block of the supported subset or its fallback.
 * @param {object} block - Block (`{ id, type, data }`).
 * @param {object} document - Whole value.
 * @param {Set<string>} lossy - Lossy notes of this block.
 * @returns {Array<object>} Root nodes (0..n).
 */
const convertBlock = (block, document, lossy) => {
  const data = isPlainObject(block.data) ? block.data : {};
  const builtIn = isBuiltInBlock(block);
  switch (builtIn ? block.type : 'custom') {
    case 'paragraph':
      return [paragraph(inlineToBlocks(data.text, lossy))];
    case 'header': {
      const level = Number.isInteger(data.level) && data.level >= 1 && data.level <= 6 ? data.level : 2;
      return [{ type: 'heading', level, children: filled(inlineToBlocks(data.text, lossy)) }];
    }
    case 'list': {
      if (data.style === 'checklist') lossy.add('checklist');
      const format = data.style === 'ordered' ? 'ordered' : 'unordered';
      if (
        format === 'ordered' &&
        isPlainObject(data.meta) &&
        Number.isInteger(data.meta.start) &&
        data.meta.start !== 1
      )
        lossy.add('list-start');
      const children = listChildren(data.items, format, lossy, 0);
      return children.length ? [{ type: 'list', format, children }] : [];
    }
    case 'checklist': {
      lossy.add('checklist');
      const items = Array.isArray(data.items) ? data.items : [];
      const children = items.map((item) => ({
        type: 'list-item',
        children: filled(inlineToBlocks(isPlainObject(item) ? item.text : '', lossy)),
      }));
      return children.length ? [{ type: 'list', format: 'unordered', children }] : [];
    }
    case 'quote': {
      const children = inlineToBlocks(data.text, lossy);
      const caption = plainOf(data.caption).trim();
      if (caption) {
        lossy.add('quote-caption');
        pushText(children, `\n— ${caption}`, {});
      }
      return [{ type: 'quote', children: filled(children) }];
    }
    case 'code':
    case 'codeFlask': {
      const code = typeof data.code === 'string' ? data.code : '';
      if (typeof data.filename === 'string' && data.filename) lossy.add('code-filename');
      const language = typeof data.language === 'string' && data.language ? data.language : null;
      return [{ type: 'code', language, children: [{ type: 'text', text: code }] }];
    }
    case 'image': {
      const image = imageObject(data.file, {
        caption: plainOf(data.caption).trim(),
        decorative: data.decorative,
      });
      return image ? [imageNode(image)] : [];
    }
    case 'simpleImage': {
      const image = imageObject(
        { url: data.url, alt: data.alt },
        { caption: plainOf(data.caption).trim(), decorative: data.decorative }
      );
      return image ? [imageNode(image)] : [];
    }
    case 'gallery': {
      lossy.add('gallery-layout');
      const images = Array.isArray(data.images) ? data.images : [];
      return images
        .map((entry) =>
          isPlainObject(entry)
            ? imageObject(entry.file, {
                caption: plainOf(entry.caption).trim(),
                decorative: entry.decorative,
              })
            : null
        )
        .filter(Boolean)
        .map(imageNode);
    }
    case 'table': {
      lossy.add('table');
      const rows = Array.isArray(data.content) ? data.content : [];
      return rows
        .map((row, index) => {
          const cells = Array.isArray(row) ? row : [];
          const marks = index === 0 && data.withHeadings ? { bold: true } : {};
          const children = [];
          cells.forEach((cell, cellIndex) => {
            if (cellIndex > 0) pushText(children, ' | ', marks);
            for (const node of inlineToBlocks(cell, lossy, marks)) {
              if (node.type === 'text') pushText(children, node.text, node);
              else children.push(node);
            }
          });
          return children.some((node) => node.type !== 'text' || node.text.replace(/[\s|]/g, ''))
            ? paragraph(children)
            : null;
        })
        .filter(Boolean);
    }
    case 'warning': {
      lossy.add('callout');
      const children = inlineToBlocks(data.title, lossy, { bold: true });
      const message = inlineToBlocks(data.message, lossy);
      if (children.length && message.length) pushText(children, '\n', {});
      for (const node of message) {
        if (node.type === 'text') pushText(children, node.text, node);
        else children.push(node);
      }
      return children.length ? [{ type: 'quote', children }] : [];
    }
    case 'alert': {
      lossy.add('callout');
      const children = inlineToBlocks(data.message, lossy);
      return children.length ? [{ type: 'quote', children }] : [];
    }
    case 'toggle': {
      lossy.add('toggle');
      const children = inlineToBlocks(data.text, lossy);
      return children.length ? [paragraph(children)] : [];
    }
    case 'math': {
      lossy.add('math');
      const tex = typeof data.tex === 'string' ? data.tex : '';
      return tex ? [{ type: 'code', language: 'latex', children: [{ type: 'text', text: tex }] }] : [];
    }
    case 'embed': {
      lossy.add('embed');
      const node = linkParagraph(plainOf(data.caption), data.source || data.embed);
      return node ? [node] : [];
    }
    case 'linkTool': {
      lossy.add('link-preview');
      const meta = isPlainObject(data.meta) ? data.meta : {};
      const node = linkParagraph(typeof meta.title === 'string' ? meta.title : '', data.link);
      return node ? [node] : [];
    }
    case 'button': {
      lossy.add('button');
      const node = linkParagraph(typeof data.text === 'string' ? data.text : '', data.link);
      return node ? [node] : [];
    }
    case 'attaches': {
      lossy.add('file');
      const file = isPlainObject(data.file) ? data.file : {};
      const label =
        (typeof data.title === 'string' && data.title) || (typeof file.name === 'string' && file.name) || '';
      const node = linkParagraph(label, file.url);
      return node ? [node] : [];
    }
    case 'video':
    case 'audio': {
      lossy.add('media');
      const file = isPlainObject(data.file) ? data.file : {};
      const label = (typeof data.title === 'string' && data.title) || plainOf(data.caption).trim();
      const node = linkParagraph(label, file.url);
      return node ? [node] : [];
    }
    case 'personality': {
      lossy.add('personality');
      const children = [];
      if (typeof data.name === 'string' && data.name) pushText(children, data.name, { bold: true });
      if (typeof data.description === 'string' && data.description)
        pushText(children, `${children.length ? '\n' : ''}${data.description}`, {});
      const url = blocksLinkUrl(data.link);
      if (url) {
        if (children.length) pushText(children, '\n', {});
        children.push({ type: 'link', url, children: [{ type: 'text', text: url }] });
      }
      return children.length ? [paragraph(children)] : [];
    }
    case 'columns': {
      lossy.add('columns');
      const out = [];
      for (const column of Array.isArray(data.columns) ? data.columns : []) {
        const items = isPlainObject(column) && Array.isArray(column.items) ? column.items : [];
        let list = null;
        for (const item of items) {
          if (!isPlainObject(item)) continue;
          if (item.type === 'list') {
            const format = item.style === 'ordered' ? 'ordered' : 'unordered';
            if (!list || list.format !== format) {
              list = { type: 'list', format, children: [] };
              out.push(list);
            }
            list.children.push({ type: 'list-item', children: filled(inlineToBlocks(item.text, lossy)) });
            continue;
          }
          list = null;
          const children = inlineToBlocks(item.text, lossy);
          if (!children.length) continue;
          if (item.type === 'heading') {
            const level = Number.isInteger(item.level) && item.level >= 1 && item.level <= 6 ? item.level : 3;
            out.push({ type: 'heading', level, children });
          } else out.push(paragraph(children));
        }
      }
      return out;
    }
    case 'delimiter':
    case 'toc':
      lossy.add(block.type);
      return [];
    case 'raw':
    case 'component':
    case 'synced':
      lossy.add(block.type);
      return [];
    default: {
      // Custom blocks (Settings, block SDK) and unknown types: an embedded entry becomes its
      // link; everything else its plain text.
      lossy.add('custom');
      const entry = isPlainObject(data.entry) ? data.entry : null;
      if (entry && (typeof entry.title === 'string' || typeof entry.href === 'string')) {
        const node = linkParagraph(entry.title, entry.href);
        return node ? [node] : [];
      }
      return textParagraphs(blockText(block, document));
    }
  }
};

/** Blocks that are never output, also not as extension nodes. */
const NEVER_EXTENDED = new Set(['raw', 'synced']);

/**
 * Supported subset: these blocks map to Strapi Blocks without loss of content (the extension
 * option does not change them unless the converter reported a loss).
 */
export const LOSSLESS_BLOCKS = Object.freeze([
  'paragraph',
  'header',
  'list',
  'quote',
  'code',
  'codeFlask',
  'image',
  'simpleImage',
]);

/**
 * Converts a Magic Editor X value into Strapi Blocks JSON.
 * @param {object|null} value - Normalised, cleaned (and for API output resolved) editor value.
 * @param {{ extensions?: boolean }} [options] - `extensions`: blocks without a Blocks form become `magic-editor-x/<type>` nodes instead of their fallback.
 * @returns {{ blocks: Array<object>, report: { lossy: Array<{ blockId: string, type: string, notes: string[] }> } }} Root nodes and what could not be kept.
 */
export const editorToStrapiBlocks = (value, options = {}) => {
  const extensions = options.extensions === true;
  const blocks = [];
  const lossy = [];
  const list = value && Array.isArray(value.blocks) ? value.blocks : [];
  for (const block of list) {
    if (!isPlainObject(block) || typeof block.type !== 'string') continue;
    const notes = new Set();
    const nodes = convertBlock(block, value, notes);
    // Only blocks that got a fallback become extension nodes; a paragraph with a footnote stays a
    // paragraph (its inline losses are reported).
    const fallback =
      !LOSSLESS_BLOCKS.includes(block.type) ||
      !isBuiltInBlock(block) ||
      (block.type === 'list' && isPlainObject(block.data) && block.data.style === 'checklist');
    if (extensions && fallback && !NEVER_EXTENDED.has(block.type) && BLOCK_NAME.test(block.type)) {
      const text = nodes
        .map((node) => blockPlainText(node))
        .filter(Boolean)
        .join('\n');
      blocks.push({
        type: `${EXTENSION_PREFIX}${block.type}`,
        ...(typeof block.id === 'string' ? { id: block.id } : {}),
        data: isPlainObject(block.data) ? block.data : {},
        children: [{ type: 'text', text }],
      });
      continue;
    }
    blocks.push(...nodes);
    if (notes.size)
      lossy.push({
        blockId: typeof block.id === 'string' ? block.id : '',
        type: block.type,
        notes: [...notes].sort(),
      });
  }
  return { blocks, report: { lossy } };
};

/**
 * Plain text of a Blocks root node (for the extension node's fallback text).
 * @param {object} node - Root node.
 * @returns {string} Text.
 */
const blockPlainText = (node) => {
  if (!isPlainObject(node)) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'image') return (node.image && (node.image.alternativeText || node.image.caption)) || '';
  return (Array.isArray(node.children) ? node.children : [])
    .map(blockPlainText)
    .join(node.type === 'list' ? '\n' : '');
};

/**
 * Public helper (`magic-editor-x/render`): a stored or API (`?mex=json`) value as Strapi Blocks
 * JSON, for sites that already hold Magic Editor X JSON and render with
 * `@strapi/blocks-react-renderer`. Invalid input gives `[]`.
 * @param {unknown} value - Field value.
 * @param {{ extensions?: boolean }} [options] - See `editorToStrapiBlocks`.
 * @returns {Array<object>} Root nodes.
 */
export const renderStrapiBlocks = (value, options = {}) => {
  const data = normalizeEditorDataSafe(value);
  return data ? editorToStrapiBlocks(data, options).blocks : [];
};

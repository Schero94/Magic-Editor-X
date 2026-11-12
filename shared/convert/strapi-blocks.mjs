/**
 * Strapi 5 Blocks field (JSON) to Editor.js blocks.
 *
 * Strapi Blocks nodes: `paragraph`, `heading` (`level`), `list` (`format`
 * `ordered` | `unordered`, children `list-item` and nested `list`), `quote`,
 * `code` (`language`), `image` (`image` = Media Library file). Inline nodes:
 * `text` with `bold`, `italic`, `underline`, `strikethrough`, `code`, and
 * `link` (`url`, children). Text is escaped; URLs go through the link policy.
 */

import { isPlainObject } from '../editor-data.mjs';
import {
  MAX_CONVERTED_BLOCKS,
  classifyImageSource,
  codeBlock,
  escapeText,
  imageBlock,
  isBlankInline,
  listBlock,
  tidyInline,
  withIds,
  wrapLink,
  wrapMark,
} from './common.mjs';

const MAX_DEPTH = 32;

/**
 * Renders inline children.
 * @param {unknown} children - Inline nodes.
 * @param {number} [depth=0] - Depth.
 * @returns {string} Inline HTML.
 */
const inlineOf = (children, depth = 0) => {
  if (!Array.isArray(children) || depth > MAX_DEPTH) return '';
  let html = '';
  for (const node of children) {
    if (!isPlainObject(node)) continue;
    if (node.type === 'text') {
      let text = escapeText(typeof node.text === 'string' ? node.text : '').replace(/\r?\n/g, '<br>');
      if (node.code === true) text = wrapMark(text, 'code');
      if (node.bold === true) text = wrapMark(text, 'bold');
      if (node.italic === true) text = wrapMark(text, 'italic');
      if (node.underline === true) text = wrapMark(text, 'underline');
      if (node.strikethrough === true) text = wrapMark(text, 'strike');
      html += text;
    } else if (node.type === 'link') {
      html += wrapLink(inlineOf(node.children, depth + 1), node.url);
    } else if (Array.isArray(node.children)) {
      html += inlineOf(node.children, depth + 1);
    }
  }
  return html;
};

/**
 * Plain text of a node (for code blocks).
 * @param {unknown} node - Node.
 * @param {number} [depth=0] - Depth.
 * @returns {string} Text.
 */
const textOf = (node, depth = 0) => {
  if (!isPlainObject(node) || depth > MAX_DEPTH) return '';
  if (typeof node.text === 'string') return node.text;
  return Array.isArray(node.children) ? node.children.map((child) => textOf(child, depth + 1)).join('') : '';
};

/**
 * Reads list items; a nested `list` belongs to the item before it.
 * @param {object} list - List node.
 * @param {number} [depth=0] - Depth.
 * @returns {Array<{ content: string, items: Array }>} Items.
 */
const listItemsOf = (list, depth = 0) => {
  const items = [];
  if (depth > 12 || !Array.isArray(list.children)) return items;
  for (const child of list.children) {
    if (!isPlainObject(child)) continue;
    if (child.type === 'list') {
      const nested = listItemsOf(child, depth + 1);
      if (items.length) items[items.length - 1].items.push(...nested);
      else items.push(...nested);
    } else {
      items.push({ content: tidyInline(inlineOf(child.children)), items: [] });
    }
  }
  return items;
};

/**
 * Converts a Strapi Blocks value into Editor.js blocks.
 * @param {unknown} value - Strapi Blocks JSON (array of nodes, or its JSON string).
 * @returns {{ blocks: Array<{id: string, type: string, data: object}>, report: { skipped: Array<object>, images: Array<object> } }} Blocks and what was left out.
 */
export const strapiBlocksToEditor = (value) => {
  let nodes = value;
  if (typeof nodes === 'string') {
    try {
      nodes = JSON.parse(nodes);
    } catch {
      nodes = [];
    }
  }
  const blocks = [];
  const skipped = new Map();
  const images = [];
  const skip = (reason, tag) => {
    const key = `${reason}|${tag || ''}`;
    const entry = skipped.get(key) || { reason, ...(tag ? { tag } : {}), count: 0 };
    entry.count += 1;
    skipped.set(key, entry);
  };
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (blocks.length >= MAX_CONVERTED_BLOCKS) {
      skip('too-many-blocks');
      break;
    }
    if (!isPlainObject(node)) continue;
    switch (node.type) {
      case 'paragraph': {
        const text = tidyInline(inlineOf(node.children));
        if (!isBlankInline(text)) blocks.push({ type: 'paragraph', data: { text } });
        break;
      }
      case 'heading': {
        const text = tidyInline(inlineOf(node.children));
        const level = Number.isInteger(node.level) ? Math.min(Math.max(node.level, 1), 6) : 2;
        if (!isBlankInline(text)) blocks.push({ type: 'header', data: { text, level } });
        break;
      }
      case 'list': {
        const items = listItemsOf(node);
        if (items.length) blocks.push(listBlock(node.format === 'ordered', items, 1));
        break;
      }
      case 'quote': {
        const text = tidyInline(inlineOf(node.children));
        if (!isBlankInline(text))
          blocks.push({ type: 'quote', data: { text, caption: '', alignment: 'left' } });
        break;
      }
      case 'code': {
        const code = textOf(node);
        if (code.trim()) blocks.push(codeBlock(code, typeof node.language === 'string' ? node.language : ''));
        break;
      }
      case 'image': {
        const image = isPlainObject(node.image) ? node.image : {};
        const { kind, url } = classifyImageSource(image.url);
        if (kind === 'remote' || kind === 'relative') {
          images.push({ index: blocks.length, src: url, kind });
          blocks.push(
            imageBlock(url, {
              alt: typeof image.alternativeText === 'string' ? image.alternativeText : '',
              caption: typeof image.caption === 'string' ? escapeText(image.caption) : '',
              width: image.width,
              height: image.height,
              mime: image.mime,
              id: image.id,
              documentId: image.documentId,
              formats: isPlainObject(image.formats) ? image.formats : undefined,
            })
          );
        } else {
          images.push({ index: -1, src: '', kind });
          skip('image', kind);
        }
        break;
      }
      default:
        skip('unsupported-node', typeof node.type === 'string' ? node.type.slice(0, 40) : 'unknown');
    }
  }
  return { blocks: withIds(blocks), report: { skipped: Array.from(skipped.values()), images } };
};

/**
 * True when a value looks like Strapi Blocks JSON.
 * @param {unknown} value - Candidate.
 * @returns {boolean} Result.
 */
export const isStrapiBlocks = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((node) => isPlainObject(node) && typeof node.type === 'string' && Array.isArray(node.children));

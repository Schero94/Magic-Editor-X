/**
 * Markdown (CommonMark + GitHub Flavored Markdown) to Editor.js blocks, using
 * marked's lexer only (marked's HTML renderer is not used, so no markup from
 * the input reaches the output). Raw HTML inside Markdown is not trusted: block
 * HTML goes through `htmlToBlocks` when a parser is given, otherwise it is kept
 * as escaped text; inline HTML is escaped (only `<br>` is kept).
 */

import { cleanTableAlign } from '../table.mjs';
import { lexer } from 'marked';
import {
  MAX_CONVERTED_BLOCKS,
  classifyImageSource,
  codeBlock,
  decodeEntities,
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
import { htmlToBlocks } from './html.mjs';

/** Longest Markdown input the converter reads (characters). */
export const MAX_MARKDOWN_LENGTH = 5 * 1024 * 1024;

const MAX_DEPTH = 64;

/**
 * Renders inline tokens. Images are collected in `state.images`.
 * @param {Array<object>} tokens - Inline tokens.
 * @param {{ images: Array<object> }} state - Collected images.
 * @param {number} [depth=0] - Depth.
 * @returns {string} Inline HTML built from the converter's own tags.
 */
const inlineOf = (tokens, state, depth = 0) => {
  if (!Array.isArray(tokens) || depth > MAX_DEPTH) return '';
  let html = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        html +=
          Array.isArray(token.tokens) && token.tokens.length
            ? inlineOf(token.tokens, state, depth + 1)
            : escapeText(decodeEntities(token.text || '')).replace(/\n/g, ' ');
        break;
      case 'escape':
        html += escapeText(token.text || '');
        break;
      case 'strong':
        html += wrapMark(inlineOf(token.tokens, state, depth + 1), 'bold');
        break;
      case 'em':
        html += wrapMark(inlineOf(token.tokens, state, depth + 1), 'italic');
        break;
      case 'del':
        html += wrapMark(inlineOf(token.tokens, state, depth + 1), 'strike');
        break;
      case 'codespan':
        html += wrapMark(escapeText(token.text || ''), 'code');
        break;
      case 'br':
        html += '<br>';
        break;
      case 'link': {
        const href = token.autolink ? token.href : decodeEntities(token.href || '');
        html += wrapLink(inlineOf(token.tokens, state, depth + 1), href);
        break;
      }
      case 'image':
        state.images.push(token);
        break;
      case 'html':
        html += /^<br\s*\/?>$/i.test(String(token.text).trim()) ? '<br>' : escapeText(token.text || '');
        break;
      case 'checkbox':
        break;
      default:
        if (typeof token.text === 'string') html += escapeText(token.text);
    }
  }
  return html;
};

/**
 * Collects blocks while walking the token tree.
 * @param {{ parse?: Function }} options - Options.
 * @returns {object} Context.
 */
const createContext = (options) => ({
  blocks: [],
  images: [],
  skipped: new Map(),
  parse: typeof options.parse === 'function' ? options.parse : null,
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
 * Adds an image block for an image token (or reports why it was left out).
 * @param {object} ctx - Context.
 * @param {object} token - Image token.
 */
const pushImage = (ctx, token) => {
  const href = decodeEntities(token.href || '');
  const embed = embedBlock(href);
  if (embed) {
    push(ctx, embed);
    return;
  }
  const { kind, url } = classifyImageSource(href);
  const alt = decodeEntities(token.text || '').trim();
  const caption = token.title ? escapeText(decodeEntities(token.title)) : '';
  if (kind === 'remote' || kind === 'relative') {
    ctx.images.push({ index: ctx.blocks.length, src: url, kind });
    push(ctx, imageBlock(url, { alt, caption }));
  } else {
    ctx.images.push({ index: -1, src: kind === 'data' ? href : '', kind });
    skip(ctx, 'image', kind);
  }
};

/**
 * Reads list items (nested lists become nested items).
 * @param {object} list - List token.
 * @param {{ images: Array<object> }} state - Collected images.
 * @param {number} [depth=0] - Depth.
 * @returns {Array<{ content: string, items: Array, task: boolean, checked: boolean }>} Items.
 */
const listItemsOf = (list, state, depth = 0) => {
  if (depth > 12) return [];
  return (list.items || []).map((item) => {
    const parts = [];
    const nested = [];
    for (const token of item.tokens || []) {
      if (token.type === 'list') nested.push(...listItemsOf(token, state, depth + 1));
      else if (token.type === 'text' || token.type === 'paragraph')
        parts.push(inlineOf(token.tokens || [token], state));
      else if (token.type === 'code') parts.push(wrapMark(escapeText(token.text || ''), 'code'));
      else if (token.type === 'blockquote' || token.type === 'heading')
        parts.push(inlineOf(token.tokens || [], state));
    }
    return {
      content: tidyInline(parts.filter(Boolean).join('<br>')),
      items: nested,
      task: Boolean(item.task),
      checked: Boolean(item.checked),
    };
  });
};

const flattenItems = (items) => items.flatMap((item) => [item, ...flattenItems(item.items || [])]);

/**
 * Text of a blockquote: paragraphs joined by line breaks.
 * @param {Array<object>} tokens - Tokens inside the quote.
 * @param {{ images: Array<object> }} state - Collected images.
 * @param {number} depth - Depth.
 * @returns {string} Inline HTML.
 */
const quoteText = (tokens, state, depth) =>
  (tokens || [])
    .map((token) => {
      if (token.type === 'blockquote') return quoteText(token.tokens, state, depth + 1);
      if (token.type === 'list')
        return flattenItems(listItemsOf(token, state))
          .map((item) => item.content)
          .join('<br>');
      if (token.type === 'code') return wrapMark(escapeText(token.text || ''), 'code');
      return tidyInline(inlineOf(token.tokens || [], state));
    })
    .filter((part) => part && !isBlankInline(part))
    .join('<br>');

/**
 * Walks block tokens.
 * @param {object} ctx - Context.
 * @param {Array<object>} tokens - Block tokens.
 * @param {number} depth - Depth.
 */
const walk = (ctx, tokens, depth) => {
  if (depth > MAX_DEPTH) return;
  for (const token of tokens || []) {
    if (ctx.full) return;
    const state = { images: [] };
    switch (token.type) {
      case 'heading': {
        const text = tidyInline(inlineOf(token.tokens, state));
        if (!isBlankInline(text))
          push(ctx, { type: 'header', data: { text, level: Math.min(Math.max(token.depth || 2, 1), 6) } });
        break;
      }
      case 'paragraph':
      case 'text': {
        const text = tidyInline(inlineOf(token.tokens || [token], state));
        if (!isBlankInline(text)) push(ctx, { type: 'paragraph', data: { text } });
        break;
      }
      case 'list': {
        const items = listItemsOf(token, state);
        const flat = flattenItems(items);
        if (flat.length && flat.every((item) => item.task)) {
          push(ctx, {
            type: 'checklist',
            data: { items: flat.map((item) => ({ text: item.content, checked: item.checked })) },
          });
        } else if (items.length) {
          push(
            ctx,
            listBlock(Boolean(token.ordered), items, Number.isInteger(token.start) ? token.start : 1)
          );
        }
        break;
      }
      case 'blockquote': {
        const text = quoteText(token.tokens, state, depth);
        if (text) push(ctx, { type: 'quote', data: { text, caption: '', alignment: 'left' } });
        break;
      }
      case 'code':
        push(ctx, codeBlock(token.text || '', token.lang ? String(token.lang).split(/\s+/)[0] : ''));
        break;
      case 'table': {
        const header = (token.header || [])
          .slice(0, 100)
          .map((cell) => tidyInline(inlineOf(cell.tokens, state)));
        const rows = (token.rows || [])
          .slice(0, 499)
          .map((row) => row.slice(0, 100).map((cell) => tidyInline(inlineOf(cell.tokens, state))));
        const width = Math.max(header.length, ...rows.map((row) => row.length));
        const pad = (row) => [...row, ...Array(width - row.length).fill('')];
        const data = { withHeadings: true, stretched: false, content: [pad(header), ...rows.map(pad)] };
        // GFM alignment row (2.4): `:---`, `:---:`, `---:`.
        const align = cleanTableAlign(token.align, width);
        if (align) data.align = align;
        push(ctx, { type: 'table', data });
        break;
      }
      case 'hr':
        push(ctx, { type: 'delimiter', data: {} });
        break;
      case 'html': {
        if (ctx.parse) {
          const converted = htmlToBlocks(token.text || '', { parse: ctx.parse });
          converted.blocks.forEach((block) => push(ctx, { type: block.type, data: block.data }));
          converted.report.skipped.forEach((entry) => skip(ctx, entry.reason, entry.tag));
        } else {
          const text = tidyInline(escapeText(token.text || '').replace(/\n/g, '<br>'));
          if (!isBlankInline(text)) push(ctx, { type: 'paragraph', data: { text } });
        }
        break;
      }
      case 'space':
      case 'def':
        break;
      default:
        if (Array.isArray(token.tokens)) walk(ctx, token.tokens, depth + 1);
    }
    state.images.forEach((image) => pushImage(ctx, image));
  }
};

/**
 * Converts Markdown into Editor.js blocks.
 * @param {string} markdown - Untrusted Markdown.
 * @param {{ parse?: (html: string) => Array<object> }} [options] - `parse` converts raw HTML blocks with htmlToBlocks; without it they become escaped text.
 * @returns {{ blocks: Array<{id: string, type: string, data: object}>, report: { skipped: Array<object>, images: Array<object> } }} Blocks and what was left out (same report shape as htmlToBlocks).
 */
export const markdownToBlocks = (markdown, options = {}) => {
  const ctx = createContext(options);
  const source = typeof markdown === 'string' ? markdown.replace(/\r\n?/g, '\n') : '';
  if (source.length > MAX_MARKDOWN_LENGTH) skip(ctx, 'too-large');
  else if (source.trim()) walk(ctx, lexer(source, { gfm: true }), 0);
  return {
    blocks: withIds(ctx.blocks),
    report: { skipped: Array.from(ctx.skipped.values()), images: ctx.images },
  };
};

const LINE_RULES = [
  { name: 'heading', test: /^#{1,6}\s+\S/, strong: true },
  { name: 'fence', test: /^(```|~~~)/, strong: true },
  { name: 'tableRule', test: /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/, strong: true },
  { name: 'task', test: /^\s*[-*+]\s+\[[ xX]\]\s+\S/, strong: true },
  { name: 'bullet', test: /^\s*[-*+]\s+\S/ },
  { name: 'ordered', test: /^\s*\d{1,3}[.)]\s+\S/ },
  { name: 'quote', test: /^>\s?\S/ },
];

/**
 * Tells whether plain text is probably Markdown (used before converting a
 * paste). Needs at least two non-empty lines and a clear signal: a heading, a
 * code fence, a table rule or task item, two list or quote lines, or a
 * Markdown link or bold text together with another Markdown line.
 * @param {string} text - Plain text.
 * @returns {boolean} Result.
 */
export const looksLikeMarkdown = (text) => {
  if (typeof text !== 'string' || text.length > MAX_MARKDOWN_LENGTH) return false;
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim());
  if (lines.length < 2) return false;
  let structural = 0;
  for (const line of lines.slice(0, 2000)) {
    const rule = LINE_RULES.find((entry) => entry.test.test(line));
    if (!rule) continue;
    if (rule.strong) return true;
    structural += 1;
  }
  if (structural >= 2) return true;
  const inline =
    /\[[^\]\n]{1,200}\]\((?:https?:\/\/|\/|#|mailto:)[^)\s]{1,500}\)/.test(text) ||
    /(^|\s)\*\*[^*\n]{1,200}\*\*(?=\s|[.,;:!?]|$)/m.test(text) ||
    /(^|\s)`[^`\n]{1,200}`(?=\s|[.,;:!?]|$)/m.test(text);
  return inline && structural >= 1;
};

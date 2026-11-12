/**
 * Find and replace on the stored document model (not the DOM), so it works
 * across every block, keeps inline formatting, and reaches collaboration as a
 * normal edit. Matches are searched in the text of each inline text node and
 * in plain-text fields (code); markup, URLs and ids are never touched. A match
 * cannot span two differently formatted pieces of text.
 *
 * Regular expressions are off by default. When on, the pattern is length
 * limited, compiled once and run on bounded text only.
 */

import { isPlainObject } from './editor-data.mjs';
import { parseInline, nodesToHtml } from './render/inline.mjs';

export const MAX_QUERY_LENGTH = 200;
export const MAX_MATCHES = 5000;
const MAX_FIELD_LENGTH = 200000;

/**
 * @typedef {object} FindOptions
 * @property {boolean} [matchCase] - Case-sensitive.
 * @property {boolean} [wholeWord] - Only whole words.
 * @property {boolean} [regex] - Treat the query as a regular expression.
 */

/**
 * Escapes a string for use in a RegExp.
 * @param {string} text - Text.
 * @returns {string} Escaped text.
 */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compiles the search pattern.
 * @param {string} query - Query.
 * @param {FindOptions} [options] - Options.
 * @returns {{ regex: RegExp|null, error: string|null }} Global RegExp, or an error code (`EMPTY`, `TOO_LONG`, `INVALID`).
 */
export const compileQuery = (query, options = {}) => {
  if (typeof query !== 'string' || query === '') return { regex: null, error: 'EMPTY' };
  if (query.length > MAX_QUERY_LENGTH) return { regex: null, error: 'TOO_LONG' };
  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return { regex: new RegExp(source, `gu${options.matchCase ? '' : 'i'}`), error: null };
  } catch {
    return { regex: null, error: 'INVALID' };
  }
};

/** Block data keys that hold inline HTML, per block type (`*` = every string in arrays). */
const HTML_FIELDS = {
  paragraph: ['text'],
  header: ['text'],
  quote: ['text', 'caption'],
  warning: ['title', 'message'],
  alert: ['message'],
  toggle: ['text'],
  image: ['caption'],
  simpleImage: ['caption'],
  gallery: ['caption'],
  video: ['caption'],
  audio: ['caption'],
  embed: ['caption'],
};
const PLAIN_FIELDS = { code: ['code'], codeFlask: ['code'] };

/**
 * Lists the searchable fields of a block as `{ path, kind, value }`.
 * @param {{ type: string, data: object }} block - Block.
 * @returns {Array<{ path: Array<string|number>, kind: 'html'|'plain', value: string }>} Fields.
 */
export const searchableFields = (block) => {
  const data = isPlainObject(block && block.data) ? block.data : {};
  const out = [];
  for (const key of HTML_FIELDS[block.type] || [])
    if (typeof data[key] === 'string') out.push({ path: [key], kind: 'html', value: data[key] });
  for (const key of PLAIN_FIELDS[block.type] || [])
    if (typeof data[key] === 'string') out.push({ path: [key], kind: 'plain', value: data[key] });
  if (block.type === 'list') {
    const walk = (items, path, depth) => {
      if (!Array.isArray(items) || depth > 12) return;
      items.forEach((item, index) => {
        if (typeof item === 'string') out.push({ path: [...path, index], kind: 'html', value: item });
        else if (isPlainObject(item)) {
          if (typeof item.content === 'string')
            out.push({ path: [...path, index, 'content'], kind: 'html', value: item.content });
          walk(item.items, [...path, index, 'items'], depth + 1);
        }
      });
    };
    walk(data.items, ['items'], 0);
  }
  if (block.type === 'gallery' && Array.isArray(data.images))
    data.images.forEach((item, index) => {
      if (isPlainObject(item) && typeof item.caption === 'string')
        out.push({ path: ['images', index, 'caption'], kind: 'html', value: item.caption });
    });
  if (block.type === 'checklist' && Array.isArray(data.items))
    data.items.forEach((item, index) => {
      if (isPlainObject(item) && typeof item.text === 'string')
        out.push({ path: ['items', index, 'text'], kind: 'html', value: item.text });
    });
  if (block.type === 'table' && Array.isArray(data.content))
    data.content.forEach((row, r) => {
      if (Array.isArray(row))
        row.forEach((cell, c) => {
          if (typeof cell === 'string') out.push({ path: ['content', r, c], kind: 'html', value: cell });
        });
    });
  return out;
};

/**
 * Runs the regex over a text and returns match ranges (zero-length matches skipped).
 * @param {RegExp} regex - Global RegExp.
 * @param {string} text - Text.
 * @param {number} budget - Remaining matches allowed.
 * @returns {Array<{ start: number, end: number }>} Ranges.
 */
const rangesIn = (regex, text, budget) => {
  const ranges = [];
  if (!text || budget <= 0) return ranges;
  regex.lastIndex = 0;
  const source = text.slice(0, MAX_FIELD_LENGTH);
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match[0] === '') {
      regex.lastIndex += 1;
      if (regex.lastIndex > source.length) break;
      continue;
    }
    ranges.push({ start: match.index, end: match.index + match[0].length });
    if (ranges.length >= budget) break;
  }
  return ranges;
};

/**
 * Text pieces of a field: one per inline text node (html) or the whole value (plain).
 * @param {{ kind: 'html'|'plain', value: string }} field - Field.
 * @returns {string[]} Texts.
 */
const textsOf = (field) => {
  if (field.kind === 'plain') return [field.value];
  const texts = [];
  const walk = (nodes, depth = 0) => {
    if (depth > 40) return;
    for (const node of nodes) {
      if (node.type === 'text') texts.push(node.value);
      else walk(node.children, depth + 1);
    }
  };
  walk(parseInline(field.value));
  return texts;
};

/**
 * @typedef {object} FindMatch
 * @property {string} blockId - Block id.
 * @property {number} blockIndex - Block index.
 * @property {string} path - Dotted field path (`text`, `items.0.content`, `content.1.2`).
 * @property {number} node - Index of the text piece in the field.
 * @property {number} start - Start offset in the text piece.
 * @property {number} end - End offset.
 * @property {string} text - Matched text.
 * @property {number} occurrence - How many earlier matches of the same block have the same text (case folded unless matchCase), for locating it in the rendered block.
 */

/**
 * Finds every match in a document (in document order).
 * @param {{ blocks: Array<{ id: string, type: string, data: object }> }|null} data - Normalised document.
 * @param {string} query - Query.
 * @param {FindOptions} [options] - Options.
 * @returns {{ matches: FindMatch[], error: string|null, truncated: boolean }} Result.
 */
export const findMatches = (data, query, options = {}) => {
  const { regex, error } = compileQuery(query, options);
  if (!regex || !data || !Array.isArray(data.blocks)) return { matches: [], error, truncated: false };
  const matches = [];
  data.blocks.forEach((block, blockIndex) => {
    const seen = new Map();
    for (const field of searchableFields(block)) {
      textsOf(field).forEach((text, node) => {
        for (const range of rangesIn(regex, text, MAX_MATCHES - matches.length)) {
          const matched = text.slice(range.start, range.end);
          const key = options.matchCase ? matched : matched.toLowerCase();
          const occurrence = seen.get(key) || 0;
          seen.set(key, occurrence + 1);
          matches.push({
            blockId: block.id,
            blockIndex,
            path: field.path.join('.'),
            node,
            start: range.start,
            end: range.end,
            text: matched,
            occurrence,
          });
        }
      });
    }
  });
  return { matches, error: null, truncated: matches.length >= MAX_MATCHES };
};

/**
 * Replacement text for one match. With regex on, `$1`..`$9` and `$&` refer to
 * the match; otherwise the replacement is literal.
 * @param {RegExp} regex - Compiled query.
 * @param {string} matched - Matched text.
 * @param {string} replacement - Replacement.
 * @param {boolean} useGroups - Expand group references.
 * @returns {string} Text.
 */
const replacementFor = (regex, matched, replacement, useGroups) => {
  if (!useGroups) return replacement;
  const single = new RegExp(regex.source, regex.flags.replace('g', ''));
  return matched.replace(single, replacement);
};

/**
 * Sets a value at a path inside a copy of `data`.
 * @param {object} data - Block data.
 * @param {Array<string|number>} path - Path.
 * @param {string} value - New value.
 * @returns {object} New data.
 */
const setPath = (data, path, value) => {
  const [head, ...rest] = path;
  const copy = Array.isArray(data) ? [...data] : { ...data };
  copy[head] = rest.length ? setPath(data[head], rest, value) : value;
  return copy;
};

/**
 * Replaces matches in a document. Without `only`, every match is replaced;
 * with `only`, just that match (as returned by `findMatches`).
 * @param {{ blocks: Array<{ id: string, type: string, data: object }> }} data - Normalised document.
 * @param {string} query - Query.
 * @param {string} replacement - Replacement text (plain text; escaped in HTML fields).
 * @param {FindOptions} [options] - Options.
 * @param {{ only?: FindMatch }} [scope] - Replace one match only.
 * @returns {{ data: object, count: number, blockIds: string[], error: string|null }} New document, number of replacements and changed blocks.
 */
export const replaceMatches = (data, query, replacement, options = {}, scope = {}) => {
  const { regex, error } = compileQuery(query, options);
  if (!regex || !data || !Array.isArray(data.blocks)) return { data, count: 0, blockIds: [], error };
  const text = typeof replacement === 'string' ? replacement.slice(0, 10000) : '';
  const only = scope.only || null;
  let count = 0;
  const blockIds = [];
  const blocks = data.blocks.map((block) => {
    if (only && block.id !== only.blockId) return block;
    let nextData = block.data;
    for (const field of searchableFields(block)) {
      const path = field.path.join('.');
      if (only && path !== only.path) continue;
      let changed = false;
      const replaceText = (value, nodeIndex) => {
        let out = '';
        let last = 0;
        for (const range of rangesIn(regex, value, MAX_MATCHES - count)) {
          if (only && (nodeIndex !== only.node || range.start !== only.start || range.end !== only.end))
            continue;
          out += value.slice(last, range.start);
          out += replacementFor(regex, value.slice(range.start, range.end), text, Boolean(options.regex));
          last = range.end;
          count += 1;
          changed = true;
        }
        return out + value.slice(last);
      };
      let value;
      if (field.kind === 'plain') value = replaceText(field.value, 0);
      else {
        const nodes = parseInline(field.value);
        let index = 0;
        const walk = (list, depth = 0) => {
          if (depth > 40) return;
          for (const node of list) {
            if (node.type === 'text') {
              node.value = replaceText(node.value, index);
              index += 1;
            } else walk(node.children, depth + 1);
          }
        };
        walk(nodes);
        value = changed ? nodesToHtml(nodes) : field.value;
      }
      if (changed) nextData = setPath(nextData, field.path, value);
    }
    if (nextData === block.data) return block;
    blockIds.push(block.id);
    return { ...block, data: nextData };
  });
  return { data: { ...data, blocks }, count, blockIds, error: null };
};

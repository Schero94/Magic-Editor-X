/**
 * Plain-text renderer for Magic Editor X content (search indexes, previews,
 * e-mail fallbacks, reading time). Tags are removed, entities decoded, blocks
 * separated by blank lines.
 */

import { inlineToText } from './inline.mjs';
import { prepareBlocks, overrideFor, scalarFields } from './common.mjs';

/**
 * Plain text of list items with bullets and two-space indentation per level.
 * @param {Array} items - Clean items.
 * @param {string} style - List style.
 * @param {number} start - First number of an ordered list.
 * @param {number} depth - Nesting depth.
 * @returns {string[]} Lines.
 */
const listLines = (items, style, start, depth) => {
  const lines = [];
  items.forEach((item, index) => {
    const content = typeof item === 'string' ? item : item.content;
    let marker = '-';
    if (style === 'ordered') marker = `${start + index}.`;
    else if (style === 'checklist') marker = item.meta && item.meta.checked ? '[x]' : '[ ]';
    const indent = '  '.repeat(depth);
    const text = inlineToText(content).trim().replace(/\n/g, `\n${indent}  `);
    lines.push(`${indent}${marker} ${text}`);
    if (typeof item !== 'string' && Array.isArray(item.items) && item.items.length && depth < 12)
      lines.push(...listLines(item.items, style, 1, depth + 1));
  });
  return lines;
};

const t = (html) => inlineToText(html).trim();

/**
 * Text of a video or audio block: title and caption, or the file URL.
 * @param {object} b - Prepared block.
 * @returns {string} Text.
 */
const mediaText = (b) => {
  if (!b.data.file.url) return '';
  const parts = [b.data.title.trim(), t(b.data.caption)].filter(Boolean);
  return parts.length ? parts.join('\n') : b.data.file.url;
};

/** @type {Record<string, (block: object, options: object, render: Function) => string>} */
const RENDERERS = {
  paragraph: (b) => t(b.data.text),
  header: (b) => t(b.data.text),
  quote: (b) =>
    [t(b.data.text), t(b.data.caption) ? `— ${t(b.data.caption)}` : ''].filter(Boolean).join('\n'),
  list: (b) =>
    listLines(
      b.data.items,
      b.data.style,
      Number.isInteger(b.data.meta && b.data.meta.start) ? b.data.meta.start : 1,
      0
    ).join('\n'),
  checklist: (b) => b.data.items.map((item) => `${item.checked ? '[x]' : '[ ]'} ${t(item.text)}`).join('\n'),
  warning: (b) => [t(b.data.title), t(b.data.message)].filter(Boolean).join('\n'),
  alert: (b) => t(b.data.message),
  toggle: (b, _o, render) => [t(b.data.text), render(b.children)].filter(Boolean).join('\n\n'),
  code: (b) => b.data.code,
  codeFlask: (b) => b.data.code,
  raw: () => '',
  table: (b) =>
    b.data.content.map((row) => row.map((cell) => t(cell).replace(/\s+/g, ' ')).join('\t')).join('\n'),
  image: (b) => t(b.data.caption) || (b.raw.decorative === true ? '' : (b.data.file.alt || '').trim()),
  simpleImage: (b) => t(b.data.caption),
  gallery: (b) =>
    [
      ...b.data.images.map((image) =>
        image.file.url ? t(image.caption) || (image.decorative ? '' : (image.file.alt || '').trim()) : ''
      ),
      t(b.data.caption),
    ]
      .filter(Boolean)
      .join('\n'),
  video: (b) => mediaText(b),
  audio: (b) => mediaText(b),
  linkTool: (b) => [b.data.meta.title, b.data.link].filter(Boolean).join('\n'),
  attaches: (b) =>
    b.data.file.url ? b.data.title || b.data.file.title || b.data.file.name || b.data.file.url : '',
  embed: (b) => [t(b.data.caption), b.data.source || b.data.embed].filter(Boolean).join('\n'),
  personality: (b) => [b.data.name, b.data.description, b.data.link].filter(Boolean).join('\n'),
  button: (b) => (b.data.link ? `${b.data.text} (${b.data.link})` : b.data.text),
  delimiter: () => '---',
};

/**
 * Renders Magic Editor X content to plain text.
 * @param {unknown} value - Stored field value.
 * @param {import('../../types/render').RenderOptions} [options] - Options (`overrides` receive `(block, helpers)` and return text).
 * @returns {string} Text ('' for empty or invalid input).
 */
export const renderText = (value, options = {}) => {
  const opts = options && typeof options === 'object' ? options : {};
  const render = (blocks) =>
    blocks
      .map((block) => {
        const override = overrideFor(opts, block.type);
        if (override) {
          const out = override(
            {
              id: block.id,
              type: block.type,
              data: block.data,
              tunes: block.tunes,
              children: block.children,
            },
            { text: (html) => inlineToText(html), renderChildren: render }
          );
          if (typeof out === 'string') return out;
        }
        if (block.known) return RENDERERS[block.type](block, opts, render);
        return scalarFields(block.data)
          .map(([, v]) => inlineToText(v).trim())
          .filter(Boolean)
          .join('\n');
      })
      .map((text) => String(text).replace(/\u00a0/g, ' '))
      .filter((text) => text.trim() !== '')
      .join('\n\n');
  return render(prepareBlocks(value, opts));
};

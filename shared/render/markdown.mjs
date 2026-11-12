/**
 * Markdown (CommonMark + GFM tables and task lists) renderer for Magic Editor
 * X content. Text is escaped so stored content cannot create Markdown or HTML
 * structure; raw HTML blocks are omitted unless explicitly allowed.
 */

import { parseInline, resolveLinkAttributes, inlineToText } from './inline.mjs';
import { prepareBlocks, resolveMedia, overrideFor, scalarFields } from './common.mjs';

/**
 * Escapes Markdown punctuation in text.
 * @param {string} text - Plain text.
 * @returns {string} Escaped text.
 */
export const escapeMarkdown = (text) =>
  String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[\\`*_[\]<>|~&{}]/g, (char) => `\\${char}`)
    .replace(
      /(^|\n)(\s*)([#>+=-]|\d{1,9}[.)])/g,
      (_m, nl, space, mark) => `${nl}${space}${mark.replace(/^(\d*)([#>+=.)-])$/, '$1\\$2')}`
    );

/**
 * URL inside `( )` of a link or image.
 * @param {string} url - Clean URL.
 * @returns {string} Encoded URL.
 */
const linkUrl = (url) =>
  String(url).replace(
    /[ ()<>\\]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );

/**
 * Link title in double quotes.
 * @param {string} title - Text.
 * @returns {string} ` "title"` or ''.
 */
const linkTitle = (title) => {
  const clean = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? ` "${clean.replace(/[\\"<>]/g, (char) => `\\${char}`)}"` : '';
};

/**
 * Wraps content in an emphasis marker, keeping outer whitespace outside.
 * @param {string} marker - `**`, `_` or `~~`.
 * @param {string} inner - Markdown.
 * @returns {string} Markdown.
 */
const wrap = (marker, inner) => {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match[2]) return inner;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
};

/**
 * Code span with a fence longer than any backtick run inside.
 * @param {string} code - Code text.
 * @returns {string} Markdown.
 */
const codeSpan = (code) => {
  const text = code.replace(/\n/g, ' ');
  if (!text) return '';
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad =
    text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ')) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
};

/**
 * Text of nodes without escaping (for code spans).
 * @param {Array} nodes - Parsed nodes.
 * @returns {string} Text.
 */
const rawText = (nodes) =>
  nodes.map((n) => (n.type === 'text' ? n.value : n.tag === 'br' ? '\n' : rawText(n.children))).join('');

/**
 * Markdown of parsed inline nodes.
 * @param {Array} nodes - Parsed nodes.
 * @param {object} options - Render options (`links`).
 * @returns {string} Markdown.
 */
const nodesToMarkdown = (nodes, options) =>
  nodes
    .map((node) => {
      if (node.type === 'text') return escapeMarkdown(node.value);
      const inner = () => nodesToMarkdown(node.children, options);
      switch (node.tag) {
        case 'br':
          return '\\\n';
        case 'b':
        case 'strong':
          return wrap('**', inner());
        case 'i':
        case 'em':
          return wrap('_', inner());
        case 's':
          return wrap('~~', inner());
        case 'code':
          return codeSpan(rawText(node.children));
        case 'a': {
          const attrs = resolveLinkAttributes(node.attrs, options.links);
          const text = inner();
          if (!attrs || !attrs.href) return text;
          return `[${text || escapeMarkdown(attrs.href)}](${linkUrl(attrs.href)}${linkTitle(attrs.title)})`;
        }
        default:
          return inner();
      }
    })
    .join('');

/**
 * Markdown of inline HTML.
 * @param {unknown} html - Inline HTML.
 * @param {object} options - Render options.
 * @returns {string} Markdown (trimmed).
 */
const md = (html, options) => nodesToMarkdown(parseInline(html), options).trim();

/** One line: line breaks become spaces (headings, table cells). */
const oneLine = (text) => text.replace(/\\\n/g, ' ').replace(/\n/g, ' ');

/**
 * Prefixes every line.
 * @param {string} text - Markdown.
 * @param {string} prefix - Prefix.
 * @returns {string} Prefixed text.
 */
const prefixLines = (text, prefix) =>
  text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');

/**
 * Markdown list lines; nested lists are indented to the content column.
 * @param {Array} items - Clean items.
 * @param {string} style - List style.
 * @param {number} start - First number.
 * @param {object} options - Render options.
 * @param {string} indent - Indentation of this level.
 * @param {number} depth - Depth.
 * @returns {string[]} Lines.
 */
const listLines = (items, style, start, options, indent, depth) => {
  const lines = [];
  items.forEach((item, index) => {
    const content = typeof item === 'string' ? item : item.content;
    let marker = '-';
    if (style === 'ordered') marker = `${start + index}.`;
    else if (style === 'checklist') marker = `- [${item.meta && item.meta.checked ? 'x' : ' '}]`;
    const childIndent = `${indent}${' '.repeat((style === 'checklist' ? 2 : marker.length) + 1)}`;
    const text = md(content, options).replace(/\n/g, `\n${childIndent}`);
    lines.push(`${indent}${marker} ${text}`.trimEnd());
    if (typeof item !== 'string' && Array.isArray(item.items) && item.items.length && depth < 12)
      lines.push(...listLines(item.items, style, 1, options, childIndent, depth + 1));
  });
  return lines;
};

/**
 * Code fence longer than any backtick run in the code.
 * @param {string} code - Code.
 * @param {string} [language] - Info string.
 * @returns {string} Fenced block.
 */
const fence = (code, language) => {
  const longest = Math.max(2, ...(code.match(/`{3,}/g) || []).map((run) => run.length));
  const marks = '`'.repeat(longest + 1);
  const info = language && /^[a-z0-9+#-]{1,32}$/i.test(language) && language !== 'plaintext' ? language : '';
  return `${marks}${info}\n${code.replace(/\n$/, '')}\n${marks}`;
};

/** GFM table cell. */
const cell = (html, options) => oneLine(md(html, options)) || ' ';

/** @type {Record<string, (block: object, options: object, render: Function) => string>} */
const RENDERERS = {
  paragraph: (b, o) => md(b.data.text, o),
  header: (b, o) => {
    const text = oneLine(md(b.data.text, o));
    return text ? `${'#'.repeat(b.data.level)} ${text}` : '';
  },
  quote: (b, o) => {
    const text = md(b.data.text, o);
    const caption = md(b.data.caption, o);
    if (!text && !caption) return '';
    return prefixLines(caption ? `${text}\n\n— ${caption}` : text, '> ');
  },
  list: (b, o) =>
    listLines(
      b.data.items,
      b.data.style,
      Number.isInteger(b.data.meta && b.data.meta.start) ? b.data.meta.start : 1,
      o,
      '',
      0
    ).join('\n'),
  checklist: (b, o) =>
    b.data.items
      .map((item) => `- [${item.checked ? 'x' : ' '}] ${oneLine(md(item.text, o))}`.trimEnd())
      .join('\n'),
  warning: (b, o) => {
    const title = md(b.data.title, o);
    const message = md(b.data.message, o);
    return prefixLines([title ? `**${oneLine(title)}**` : '', message].filter(Boolean).join('\n\n'), '> ');
  },
  alert: (b, o) => {
    const message = md(b.data.message, o);
    return message ? prefixLines(message, '> ') : '';
  },
  toggle: (b, o, render) =>
    [b.data.text ? `**${oneLine(md(b.data.text, o))}**` : '', render(b.children)]
      .filter(Boolean)
      .join('\n\n'),
  code: (b) => (b.data.code ? fence(b.data.code) : ''),
  codeFlask: (b) => (b.data.code ? fence(b.data.code, b.data.language) : ''),
  raw: (b, o) => {
    if (o.rawHtml !== 'allow' || typeof o.sanitizeRaw !== 'function') return '';
    const html = o.sanitizeRaw(String(b.raw.html || ''));
    return typeof html === 'string' ? html.trim() : '';
  },
  table: (b, o) => {
    const rows = b.data.content.filter((row) => row.length);
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row) => `| ${Array.from({ length: width }, (_, i) => cell(row[i] || '', o)).join(' | ')} |`;
    const head = b.data.withHeadings ? rows[0] : [];
    const body = b.data.withHeadings ? rows.slice(1) : rows;
    return [
      line(head),
      `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
      ...body.map(line),
    ].join('\n');
  },
  image: (b, o) => {
    const file = resolveMedia(b.data.file, b, o);
    if (!file.url) return '';
    const alt = b.raw.decorative === true ? '' : escapeMarkdown(oneLine(file.alt || ''));
    const caption = inlineToText(b.data.caption);
    return `![${alt}](${linkUrl(file.url)}${linkTitle(caption)})`;
  },
  simpleImage: (b) => {
    if (!b.data.url) return '';
    const text =
      typeof b.data.alt === 'string' && b.data.alt.trim() ? b.data.alt : inlineToText(b.data.caption);
    const alt = b.data.decorative === true ? '' : escapeMarkdown(oneLine(text));
    return `![${alt}](${linkUrl(b.data.url)})`;
  },
  gallery: (b, o) => {
    const lines = b.data.images
      .map((image) => {
        const file = resolveMedia(image.file, b, o);
        if (!file.url) return '';
        const alt = image.decorative ? '' : escapeMarkdown(oneLine(file.alt || ''));
        return `![${alt}](${linkUrl(file.url)}${linkTitle(inlineToText(image.caption))})`;
      })
      .filter(Boolean);
    if (!lines.length) return '';
    const caption = oneLine(md(b.data.caption, o));
    return [lines.join('\n'), caption].filter(Boolean).join('\n\n');
  },
  video: (b, o) => mediaLink('video', b, o),
  audio: (b, o) => mediaLink('audio', b, o),
  linkTool: (b) =>
    b.data.link ? `[${escapeMarkdown(b.data.meta.title || b.data.link)}](${linkUrl(b.data.link)})` : '',
  attaches: (b) => {
    const file = b.data.file;
    if (!file.url) return '';
    return `[${escapeMarkdown(b.data.title || file.title || file.name || file.url)}](${linkUrl(file.url)})`;
  },
  embed: (b, o) => {
    const href = b.data.source || b.data.embed;
    if (!href) return '';
    return `[${oneLine(md(b.data.caption, o)) || escapeMarkdown(b.data.service || href)}](${linkUrl(href)})`;
  },
  personality: (b) => {
    const d = b.data;
    return [
      d.name ? `**${escapeMarkdown(d.name)}**` : '',
      d.description ? escapeMarkdown(d.description) : '',
      d.link ? `[${escapeMarkdown(d.link)}](${linkUrl(d.link)})` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  },
  button: (b) => {
    if (!b.data.text) return '';
    return b.data.link
      ? `[${escapeMarkdown(b.data.text)}](${linkUrl(b.data.link)})`
      : escapeMarkdown(b.data.text);
  },
  delimiter: () => '---',
};

/**
 * Markdown of a video or audio block: a link to the file plus the caption.
 * @param {'video'|'audio'} kind - Block kind.
 * @param {object} b - Prepared block.
 * @param {object} o - Render options.
 * @returns {string} Markdown.
 */
function mediaLink(kind, b, o) {
  const file = resolveMedia(b.data.file, b, o, { mimePrefix: `${kind}/` });
  if (!file.url) return '';
  const caption = oneLine(md(b.data.caption, o));
  const link = `[${escapeMarkdown(oneLine(b.data.title || file.name || file.url))}](${linkUrl(file.url)})`;
  return [link, caption].filter(Boolean).join('\n\n');
}

/**
 * Renders Magic Editor X content to Markdown.
 * @param {unknown} value - Stored field value.
 * @param {import('../../types/render').RenderOptions} [options] - Options (`overrides` return Markdown).
 * @returns {string} Markdown ('' for empty or invalid input).
 */
export const renderMarkdown = (value, options = {}) => {
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
            { escape: escapeMarkdown, inline: (html) => md(html, opts), renderChildren: render }
          );
          if (typeof out === 'string') return out;
        }
        if (block.known) return RENDERERS[block.type](block, opts, render);
        return scalarFields(block.data)
          .map(([, v]) => md(v, opts))
          .filter(Boolean)
          .join('\n\n');
      })
      .filter((text) => text && text.trim() !== '')
      .join('\n\n');
  return render(prepareBlocks(value, opts));
};

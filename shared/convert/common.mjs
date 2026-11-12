/**
 * Helpers shared by the converters in this folder (HTML, Markdown and Strapi
 * Blocks to Editor.js data).
 *
 * Converters never copy markup from their input. They build inline HTML only
 * from the tags below, with escaped text and validated URLs, so their output is
 * safe before the sanitiser runs (and the sanitiser still runs on every save).
 */

import { escapeHtml, hashString } from '../editor-data.mjs';
import { cleanCodeFilename, sanitizeUrl } from '../sanitize-policy.mjs';

/** Highest number of blocks a converter returns (same as the stored-value limit). */
export const MAX_CONVERTED_BLOCKS = 5000;

/** Inline marks the converters emit, mapped to the markup the editor tools write. */
export const MARKS = Object.freeze({
  bold: ['<b>', '</b>'],
  italic: ['<i>', '</i>'],
  underline: ['<u class="cdx-underline">', '</u>'],
  strike: ['<s class="cdx-strikethrough">', '</s>'],
  code: ['<code class="inline-code">', '</code>'],
  mark: ['<mark class="cdx-marker">', '</mark>'],
  sub: ['<sub>', '</sub>'],
  sup: ['<sup>', '</sup>'],
});

const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
});

/**
 * Decodes HTML character references in Markdown text (named ones from a short
 * list, decimal and hexadecimal). Unknown references stay as they are.
 * @param {string} text - Text with character references.
 * @returns {string} Decoded text.
 */
export const decodeEntities = (text) =>
  String(text).replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (match, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return '�';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named === undefined ? match : named;
  });

/**
 * Escapes text for inline HTML; non-breaking spaces become normal spaces.
 * @param {string} text - Plain text.
 * @returns {string} Escaped HTML.
 */
export const escapeText = (text) => escapeHtml(String(text).replace(/\u00a0/g, ' '));

/**
 * Wraps inline HTML in a mark; empty content stays empty.
 * @param {string} html - Inline HTML.
 * @param {keyof typeof MARKS} mark - Mark name.
 * @returns {string} Wrapped HTML.
 */
export const wrapMark = (html, mark) => {
  if (!html || !html.replace(/<br>/g, '').trim()) return html;
  const [open, close] = MARKS[mark];
  return `${open}${html}${close}`;
};

/**
 * Builds a link around inline HTML when the URL passes the link policy;
 * otherwise only the content is kept.
 * @param {string} html - Link content.
 * @param {unknown} href - Candidate URL.
 * @returns {string} Inline HTML.
 */
export const wrapLink = (html, href) => {
  const url = sanitizeUrl(typeof href === 'string' ? href.trim() : '');
  if (!url || !html) return html;
  return `<a href="${escapeHtml(url)}">${html}</a>`;
};

/**
 * Tidies inline HTML of one text field: collapses whitespace, removes leading
 * and trailing spaces and line breaks.
 * @param {string} html - Inline HTML built by a converter.
 * @returns {string} Tidy HTML.
 */
export const tidyInline = (html) =>
  String(html)
    .replace(/[ \t\r\n\f]+/g, ' ')
    .replace(/ ?<br> ?/g, '<br>')
    .replace(/^(?:\s|<br>)+/, '')
    .replace(/(?:\s|<br>)+$/, '');

/**
 * True when inline HTML has no visible text.
 * @param {string} html - Inline HTML.
 * @returns {boolean} Result.
 */
export const isBlankInline = (html) =>
  String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|\u00a0|\s/g, '') === '';

/**
 * Gives every block a deterministic id from its position, type and data, so
 * converting the same input twice gives the same document.
 * @param {Array<{type: string, data: object}>} blocks - Blocks without ids.
 * @param {string} [prefix='cv'] - Id prefix.
 * @returns {Array<{id: string, type: string, data: object}>} Blocks with ids.
 */
export const withIds = (blocks, prefix = 'cv') =>
  blocks.map((block, index) => ({
    id: `${prefix}${hashString(`${index}:${block.type}:${JSON.stringify(block.data)}`)}${index}`,
    type: block.type,
    data: block.data,
  }));

/**
 * Builds an Editor.js document from converted blocks.
 * @param {Array<{id: string, type: string, data: object}>} blocks - Blocks.
 * @returns {{ time: number, blocks: Array<object>, version: string }} Document; `time` is 0 so output is deterministic.
 */
export const toDocument = (blocks) => ({ time: 0, blocks, version: '2.31.0' });

/** Languages the highlighted code tool accepts as a name. */
export const CODE_LANGUAGE = /^[a-z0-9+#-]{1,32}$/i;

/**
 * Builds a code block; a known language name gives a highlighted code block.
 * @param {string} code - Code text.
 * @param {string} [language] - Language name.
 * @returns {{ type: string, data: object }} Block.
 */
export const codeBlock = (code, language, filename) => {
  const text = String(code).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const lang = typeof language === 'string' ? language.trim().toLowerCase() : '';
  const name = cleanCodeFilename(filename);
  const valid = lang && CODE_LANGUAGE.test(lang);
  // 2.4: a file name needs the highlighted code block (the plain `code` block has no label).
  if (name)
    return { type: 'codeFlask', data: { code: text, language: valid ? lang : 'plaintext', filename: name } };
  if (valid) return { type: 'codeFlask', data: { code: text, language: lang } };
  return { type: 'code', data: { code: text } };
};

/**
 * Reads a fenced code block's info string (2.4): the language (first word,
 * unless it is an attribute) and the file name from `title="..."`,
 * `title='...'`, `title=name` or `filename=...` (backslash escapes in double
 * quotes). ```` ```js title="src/app.js" ```` -> `{ language: 'js', filename: 'src/app.js' }`.
 * @param {unknown} info - Info string.
 * @returns {{ language: string, filename: string }} Parts ('' when absent).
 */
export const parseFenceInfo = (info) => {
  const text = typeof info === 'string' ? info.trim().slice(0, 1000) : '';
  if (!text) return { language: '', filename: '' };
  const first = text.split(/\s+/, 1)[0];
  const language = first.includes('=') ? '' : first;
  // Markdown parsers apply backslash escapes to the info string (CommonMark), so a
  // quoted name runs to the last double quote; raw `\"` and `\\` are unescaped too.
  const match = /(?:^|\s)(?:title|filename)=(?:"(.*)"|'([^']*)'|(\S+))/i.exec(text);
  let filename = '';
  if (match) {
    if (match[1] !== undefined) filename = match[1].replace(/\\(["\\])/g, '$1');
    else filename = match[2] !== undefined ? match[2] : match[3];
  }
  return { language, filename: cleanCodeFilename(filename) };
};

/**
 * Builds a list block (Editor.js list 2 data) from nested items.
 * @param {boolean} ordered - Numbered list.
 * @param {Array<{content: string, items: Array}>} items - Items.
 * @param {number} [start] - First number of a numbered list.
 * @returns {{ type: 'list', data: object }} Block.
 */
export const listBlock = (ordered, items, start) => {
  const clean = (list) =>
    list.map((item) => ({ content: tidyInline(item.content), meta: {}, items: clean(item.items || []) }));
  const meta = ordered
    ? { start: Number.isInteger(start) && start >= 0 && start <= 100000 ? start : 1, counterType: 'numeric' }
    : {};
  return { type: 'list', data: { style: ordered ? 'ordered' : 'unordered', meta, items: clean(items) } };
};

/**
 * Builds an image block.
 * @param {string} url - Image URL (already validated).
 * @param {{ alt?: string, caption?: string, width?: number, height?: number, id?: number|string, documentId?: string, formats?: object, mime?: string }} [extra] - Media data.
 * @returns {{ type: 'image', data: object }} Block.
 */
export const imageBlock = (url, extra = {}) => {
  const file = { url };
  if (extra.alt) file.alt = String(extra.alt).slice(0, 500);
  for (const key of ['width', 'height']) if (Number.isFinite(extra[key])) file[key] = extra[key];
  if (typeof extra.mime === 'string') file.mime = extra.mime.slice(0, 100);
  if (extra.id !== undefined && (Number.isInteger(extra.id) || typeof extra.id === 'string'))
    file.id = extra.id;
  if (typeof extra.documentId === 'string') file.documentId = extra.documentId.slice(0, 64);
  if (extra.formats && typeof extra.formats === 'object' && !Array.isArray(extra.formats))
    file.formats = extra.formats;
  return {
    type: 'image',
    data: {
      file,
      caption: extra.caption || '',
      withBorder: false,
      withBackground: false,
      stretched: false,
    },
  };
};

/**
 * Classifies an image source.
 * @param {unknown} src - Image source.
 * @returns {{ kind: 'remote'|'relative'|'data'|'unsupported', url: string }} Kind and usable URL ('' when not usable as is).
 */
export const classifyImageSource = (src) => {
  const value = typeof src === 'string' ? src.trim() : '';
  if (/^data:image\//i.test(value)) return { kind: 'data', url: '' };
  if (/^https?:/i.test(value)) {
    const url = sanitizeUrl(value, { schemes: ['http', 'https'], allowRelative: false });
    return url ? { kind: 'remote', url } : { kind: 'unsupported', url: '' };
  }
  if (/^\/(?!\/)/.test(value)) {
    const url = sanitizeUrl(value, { schemes: ['http', 'https'] });
    return url ? { kind: 'relative', url } : { kind: 'unsupported', url: '' };
  }
  return { kind: 'unsupported', url: '' };
};

const EMBEDS = [
  {
    service: 'youtube',
    match: (url) => {
      if (!/^(?:www\.|m\.)?youtube(?:-nocookie)?\.com$/.test(url.hostname) && url.hostname !== 'youtu.be')
        return null;
      const id =
        url.hostname === 'youtu.be'
          ? url.pathname.slice(1)
          : (/^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname) || [])[1] || url.searchParams.get('v');
      return id && /^[A-Za-z0-9_-]{6,20}$/.test(id)
        ? { embed: `https://www.youtube.com/embed/${id}`, source: `https://www.youtube.com/watch?v=${id}` }
        : null;
    },
  },
  {
    service: 'vimeo',
    match: (url) => {
      if (!/^(?:www\.|player\.)?vimeo\.com$/.test(url.hostname)) return null;
      const id = (/^\/(?:video\/)?(\d{1,15})(?:\/|$)/.exec(url.pathname) || [])[1];
      return id ? { embed: `https://player.vimeo.com/video/${id}`, source: `https://vimeo.com/${id}` } : null;
    },
  },
];

/**
 * Builds an embed block for an allow-listed video URL (YouTube, Vimeo).
 * @param {unknown} src - Frame or page URL.
 * @param {string} [caption] - Caption HTML.
 * @returns {{ type: 'embed', data: object } | null} Block, or null for other hosts.
 */
export const embedBlock = (src, caption = '') => {
  if (typeof src !== 'string') return null;
  let url;
  try {
    url = new URL(src.trim().replace(/^\/\//, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  for (const entry of EMBEDS) {
    const found = entry.match(url);
    if (found) {
      return {
        type: 'embed',
        data: {
          service: entry.service,
          source: found.source,
          embed: found.embed,
          width: 580,
          height: 320,
          caption,
        },
      };
    }
  }
  return null;
};

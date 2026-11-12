/**
 * Render tree builder: turns a stored Magic Editor X value into
 * framework-neutral nodes (see `nodes.mjs`). `renderHtml` serialises this
 * tree; the React and Vue components turn the same tree into elements.
 *
 * Adding a block type is a one-place change for HTML, React and Vue: add an
 * entry to `RENDERERS` below (plus `text.mjs` and `markdown.mjs` for those
 * formats, and the shared policy/schema/types for stored data).
 *
 * Every node is built from known tags with escaped text and validated URLs.
 * Stored inline HTML goes through the strict parser in `inline.mjs`. No
 * inline styles (CSP friendly); layout comes from stable `mex-` classes.
 */

import { sanitizeUrl, LINK_SCHEMES } from '../sanitize-policy.mjs';
import { isPlainObject } from '../editor-data.mjs';
import { inlineToNodes, inlineToHtml, inlineToText } from './inline.mjs';
import {
  el,
  textNode,
  toNodes,
  escapeHtml,
  serializeNodes,
  TAG_NAME,
  isSafeAttributeName,
} from './nodes.mjs';
import {
  prepareBlocks,
  imageCandidates,
  resolveMedia,
  DEFAULT_EMBED_HOSTS,
  embedFrameUrl,
  overrideFor,
  scalarFields,
  formatSize,
  annotateHeadings,
} from './common.mjs';
import { buildTocTree } from '../toc.mjs';
import { tableLayout } from '../table.mjs';

/**
 * @typedef {import('./nodes.mjs').RenderNode} RenderNode
 * @typedef {{ id: string, type: string, data: object, tunes: object|undefined, children: PublicBlock[] }} PublicBlock
 * @typedef {{ type: 'block', block: PublicBlock, children: Array<RenderNode|BlockNode> }} BlockNode
 */

const COUNTER_TYPES = Object.freeze({
  'lower-roman': 'i',
  'upper-roman': 'I',
  'lower-alpha': 'a',
  'upper-alpha': 'A',
});

/** Code blocks with more lines than this are rendered without line numbers. */
export const MAX_NUMBERED_LINES = 20000;

/**
 * Class list of a block with its tunes.
 * @param {string[]} base - Block classes.
 * @param {object|undefined} tunes - Clean tunes.
 * @returns {string} Class attribute value.
 */
const classes = (base, tunes) => {
  const list = [...base];
  if (tunes && tunes.alignmentTune && tunes.alignmentTune.alignment !== 'left')
    list.push(`mex-align-${tunes.alignmentTune.alignment}`);
  if (tunes && tunes.textVariant) list.push(`mex-variant-${tunes.textVariant}`);
  if (tunes && tunes.indentTune && tunes.indentTune.indentLevel > 0)
    list.push(`mex-indent-${tunes.indentTune.indentLevel}`);
  return list.join(' ');
};

/**
 * Renders list items (nested lists, checklists, legacy string items).
 * @param {Array} items - Clean items.
 * @param {string} style - List style.
 * @param {object} options - Render options.
 * @param {number} depth - Nesting depth.
 * @returns {RenderNode[]} `<li>` nodes.
 */
const listItems = (items, style, options, depth) =>
  items.map((item) => {
    if (typeof item === 'string') return el('li', {}, inlineToNodes(item, options));
    const checked = Boolean(item.meta && item.meta.checked);
    const check =
      style === 'checklist'
        ? [
            el('input', {
              type: 'checkbox',
              disabled: true,
              checked,
              'aria-label': checked ? 'done' : 'open',
            }),
            ' ',
          ]
        : [];
    const nested =
      Array.isArray(item.items) && item.items.length && depth < 12
        ? listElement(item.items, style, {}, options, depth + 1, [])
        : null;
    return el(
      'li',
      style === 'checklist' ? { class: 'mex-checklist-item', 'data-checked': String(checked) } : {},
      [check, inlineToNodes(item.content, options), nested]
    );
  });

/**
 * Renders an `<ol>`/`<ul>`.
 * @param {Array} items - Items.
 * @param {string} style - `ordered`, `unordered` or `checklist`.
 * @param {object} meta - List meta (`start`, `counterType`).
 * @param {object} options - Render options.
 * @param {number} depth - Nesting depth.
 * @param {string[]} base - Classes.
 * @param {object} [tunes] - Tunes.
 * @returns {RenderNode} List node.
 */
const listElement = (items, style, meta, options, depth, base, tunes) => {
  const tag = style === 'ordered' ? 'ol' : 'ul';
  const attrs = {};
  if (base.length) attrs.class = classes(base, tunes);
  if (style === 'ordered' && meta) {
    if (Number.isInteger(meta.start) && meta.start !== 1) attrs.start = meta.start;
    if (COUNTER_TYPES[meta.counterType]) attrs.type = COUNTER_TYPES[meta.counterType];
  }
  return el(tag, attrs, listItems(items, style, options, depth));
};

/**
 * Renders an image figure.
 * @param {string} url - Clean URL.
 * @param {object} img - Extra `<img>` attributes.
 * @param {RenderNode[]} caption - Caption nodes.
 * @param {string} cls - Class attribute.
 * @returns {RenderNode} Figure node.
 */
const figure = (url, img, caption, cls) =>
  el('figure', { class: cls }, [
    el('img', { src: url, ...img, loading: 'lazy', decoding: 'async' }),
    caption.length ? el('figcaption', {}, caption) : null,
  ]);

/**
 * Adds a focal point to an `<img>` node: `data-mex-focal-x`/`-y` (0..1) by
 * default; with `options.focalPoint: 'style'` also `object-position` as an
 * inline style (the only style the renderer ever writes). Media Library
 * formats are resized, not cropped, so the point is valid for every srcset
 * candidate.
 * @param {RenderNode} img - `<img>` node.
 * @param {{ x: number, y: number }|undefined} point - Clean focal point.
 * @param {object} o - Render options.
 * @returns {RenderNode} The same node.
 */
const withFocalPoint = (img, point, o) => {
  if (!point || img.type !== 'element') return img;
  img.attrs['data-mex-focal-x'] = String(point.x);
  img.attrs['data-mex-focal-y'] = String(point.y);
  if (o.focalPoint === 'style')
    img.style = { 'object-position': `${Math.round(point.x * 100)}% ${Math.round(point.y * 100)}%` };
  return img;
};

/**
 * `<img>` attributes of a Media Library image (alt, size, srcset from formats).
 * @param {object} file - Clean file.
 * @param {boolean} decorative - Empty alt.
 * @param {object} o - Render options.
 * @returns {Record<string, unknown>} Attributes (without src/loading/decoding).
 */
const libraryImageAttrs = (file, decorative, o) => {
  const candidates = imageCandidates(file);
  const img = {
    alt: decorative ? '' : file.alt || '',
    width: Number.isInteger(file.width) && file.width > 0 ? file.width : undefined,
    height: Number.isInteger(file.height) && file.height > 0 ? file.height : undefined,
  };
  if (candidates.length > 1) {
    img.srcset = candidates.map((c) => `${c.url} ${c.width}w`).join(', ');
    img.sizes =
      typeof o.imageSizes === 'string' && /^[\w\s(),.:%-]{1,200}$/.test(o.imageSizes)
        ? o.imageSizes
        : '100vw';
  }
  return img;
};

/**
 * `<track>` nodes of a video or audio block.
 * @param {object} b - Prepared block.
 * @param {object} o - Render options.
 * @returns {RenderNode[]} Track nodes.
 */
const trackNodes = (b, o) =>
  b.data.tracks
    .map((track) => {
      const file = resolveMedia(track.file, b, o, { vtt: true });
      if (!file.url) return null;
      return el('track', {
        kind: track.kind,
        src: file.url,
        srclang: track.srclang || undefined,
        label: track.label || undefined,
        default: track.default === true,
      });
    })
    .filter(Boolean);

/**
 * Video or audio figure.
 * @param {'video'|'audio'} tag - Element.
 * @param {object} b - Prepared block.
 * @param {object} o - Render options.
 * @returns {RenderNode|null} Figure or null without a file.
 */
const mediaFigure = (tag, b, o) => {
  const file = resolveMedia(b.data.file, b, o, { mimePrefix: `${tag}/` });
  if (!file.url) return null;
  const caption = inlineToNodes(b.data.caption, o);
  const attrs = {
    src: file.url,
    controls: true,
    preload: 'metadata',
    'aria-label': b.data.title || undefined,
    loop: b.data.loop === true,
  };
  if (tag === 'video') {
    const poster = b.data.poster ? resolveMedia(b.data.poster, b, o) : null;
    Object.assign(attrs, {
      playsinline: true,
      muted: b.data.muted === true,
      poster: poster && poster.url ? poster.url : undefined,
      width: Number.isInteger(file.width) && file.width > 0 ? file.width : undefined,
      height: Number.isInteger(file.height) && file.height > 0 ? file.height : undefined,
    });
  }
  return el('figure', { class: classes([`mex-${tag}`], b.tunes) }, [
    el(tag, attrs, [
      trackNodes(b, o),
      // Fallback for browsers without media support.
      el('a', { href: file.url }, b.data.title || file.name || file.url),
    ]),
    caption.length ? el('figcaption', {}, caption) : null,
  ]);
};

/**
 * Short UI label from an option, or the default.
 * @param {unknown} value - Candidate label.
 * @param {string} fallback - Default label.
 * @returns {string} Label (1 to 80 characters).
 */
const label = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean && clean.length <= 80 ? clean : fallback;
};

/**
 * Accessible name of a table of contents without a title (`options.toc.label`).
 * @param {object} options - Render options.
 * @returns {string} Label.
 */
const tocLabel = (options) =>
  label(isPlainObject(options.toc) ? options.toc.label : undefined, 'Table of contents');

/**
 * Normalised `options.code`.
 * @param {object} options - Render options.
 * @returns {{ lineNumbers: 'all'|'block'|'none', copy: null | { label: string, copied: string, failed: string } }} Code options.
 */
export const codeOptions = (options) => {
  const code = isPlainObject(options.code) ? options.code : {};
  const lineNumbers = code.lineNumbers === true ? 'all' : code.lineNumbers === 'block' ? 'block' : 'none';
  const button = code.copyButton;
  const copy =
    button === true || isPlainObject(button)
      ? {
          label: label(isPlainObject(button) ? button.label : undefined, 'Copy code'),
          copied: label(isPlainObject(button) ? button.copiedLabel : undefined, 'Copied'),
          failed: label(isPlainObject(button) ? button.failedLabel : undefined, 'Copy failed'),
        }
      : null;
  return { lineNumbers, copy };
};

/**
 * Code split into one `<span class="mex-code-line">` per line, separated by
 * line breaks (so copying the text keeps them). Numbers come from CSS counters.
 * @param {string} code - Code text.
 * @returns {Array<RenderNode|string>} Children of `<code>`.
 */
const numberedLines = (code) => {
  const parts = code.split('\n');
  const trailing = parts.length > 1 && parts[parts.length - 1] === '';
  if (trailing) parts.pop();
  const out = [];
  parts.forEach((line, index) => {
    if (index) out.push('\n');
    out.push(el('span', { class: 'mex-code-line' }, line));
  });
  if (trailing) out.push('\n');
  return out;
};

/**
 * Code block (`code` and `codeFlask`) with optional line numbers and copy button.
 * @param {object} b - Prepared block.
 * @param {string|undefined} language - Validated language (codeFlask only).
 * @param {object} o - Render options.
 * @returns {RenderNode} `<pre>` or, with a copy button, `<div class="mex-code-block">`.
 */
const codeBlock = (b, language, o) => {
  const { lineNumbers, copy } = codeOptions(o);
  const code = String(b.data.code);
  // 'block' follows the editor: codeFlask shows line numbers unless they were switched off.
  const wantNumbers =
    lineNumbers === 'all' ||
    (lineNumbers === 'block' && b.type === 'codeFlask' && b.data.showlinenumbers !== false);
  const numbers = wantNumbers && code.split('\n').length <= MAX_NUMBERED_LINES;
  const pre = el(
    'pre',
    {
      class: classes(['mex-code', ...(numbers ? ['mex-code-lines'] : [])], b.tunes),
      'data-language': language,
    },
    el('code', language ? { class: `language-${language}` } : {}, numbers ? numberedLines(code) : code)
  );
  if (!copy) return pre;
  return el('div', { class: 'mex-code-block', 'data-mex-code': 'copy' }, [
    pre,
    el(
      'button',
      {
        type: 'button',
        class: 'mex-code-copy',
        'data-mex-copy': 'code',
        'data-mex-copied': copy.copied,
        'data-mex-failed': copy.failed,
      },
      copy.label
    ),
    el('span', { class: 'mex-code-copy-status', role: 'status', 'aria-live': 'polite' }),
  ]);
};

/**
 * Default nodes per block type. Each entry returns a node, an array of nodes,
 * or null to omit the block. This is the single place to add a block type
 * for HTML, React and Vue.
 * @type {Record<string, (block: object, options: object, renderList: (blocks: object[]) => Array<RenderNode|BlockNode>) => RenderNode | RenderNode[] | null>}
 */
const RENDERERS = {
  paragraph: (b, o) => el('p', { class: classes(['mex-paragraph'], b.tunes) }, inlineToNodes(b.data.text, o)),
  header: (b, o) =>
    el(
      `h${b.data.level}`,
      { id: b.anchor, class: classes(['mex-header'], b.tunes) },
      inlineToNodes(b.data.text, o)
    ),
  quote: (b, o) => {
    const caption = inlineToNodes(b.data.caption, o);
    return el(
      'figure',
      {
        class: classes(
          ['mex-quote', ...(b.data.alignment === 'center' ? ['mex-align-center'] : [])],
          b.tunes
        ),
      },
      [
        el('blockquote', {}, inlineToNodes(b.data.text, o)),
        caption.length ? el('figcaption', {}, caption) : null,
      ]
    );
  },
  list: (b, o) =>
    listElement(
      b.data.items,
      b.data.style,
      b.data.meta,
      o,
      0,
      b.data.style === 'checklist' ? ['mex-list', 'mex-checklist'] : ['mex-list'],
      b.tunes
    ),
  checklist: (b, o) =>
    listElement(
      b.data.items.map((item) => ({ content: item.text, meta: { checked: item.checked }, items: [] })),
      'checklist',
      {},
      o,
      0,
      ['mex-list', 'mex-checklist'],
      b.tunes
    ),
  warning: (b, o) => {
    const title = inlineToNodes(b.data.title, o);
    return el('aside', { class: classes(['mex-warning'], b.tunes), role: 'note' }, [
      title.length ? el('p', { class: 'mex-warning-title' }, el('strong', {}, title)) : null,
      el('p', { class: 'mex-warning-message' }, inlineToNodes(b.data.message, o)),
    ]);
  },
  alert: (b, o) =>
    el(
      'div',
      {
        class: classes(
          [
            'mex-alert',
            `mex-alert-${b.data.type}`,
            ...(b.data.align !== 'left' ? [`mex-align-${b.data.align}`] : []),
          ],
          b.tunes
        ),
        role: 'note',
      },
      inlineToNodes(b.data.message, o)
    ),
  toggle: (b, o, renderList) =>
    el('details', { class: classes(['mex-toggle'], b.tunes), open: b.data.status !== 'closed' }, [
      el('summary', {}, inlineToNodes(b.data.text, o)),
      renderList(b.children),
    ]),
  code: (b, o) => codeBlock(b, undefined, o),
  codeFlask: (b, o) => codeBlock(b, b.data.language, o),
  raw: (b, o) => {
    if (o.rawHtml !== 'allow' || typeof o.sanitizeRaw !== 'function') return null;
    const html = o.sanitizeRaw(String(b.raw.html || ''));
    return typeof html === 'string' && html
      ? el('div', { class: classes(['mex-raw'], b.tunes) }, { type: 'raw', html })
      : null;
  },
  // Header row: <thead> with <th scope="col">; header column (2.4): <th scope="row">;
  // merged cells: colspan/rowspan (covered cells are left out); alignment: a class.
  table: (b, o) => {
    const rows = tableLayout(b.data);
    if (!rows.length) return null;
    const cell = (item) =>
      el(
        item.header ? 'th' : 'td',
        {
          ...(item.header ? { scope: item.header } : {}),
          ...(item.colspan > 1 ? { colspan: String(item.colspan) } : {}),
          ...(item.rowspan > 1 ? { rowspan: String(item.rowspan) } : {}),
          ...(item.align ? { class: `mex-align-${item.align}` } : {}),
        },
        inlineToNodes(item.html, o)
      );
    const tr = (row) => el('tr', {}, row.map(cell));
    const head = b.data.withHeadings ? el('thead', {}, tr(rows[0])) : null;
    const body = (b.data.withHeadings ? rows.slice(1) : rows).map(tr);
    const caption = b.data.caption ? el('caption', {}, inlineToNodes(b.data.caption, o)) : null;
    return el(
      'table',
      { class: classes(['mex-table', ...(b.data.stretched ? ['mex-stretched'] : [])], b.tunes) },
      [caption, head, body.length ? el('tbody', {}, body) : null]
    );
  },
  image: (b, o) => {
    const file = resolveMedia(b.data.file, b, o);
    if (!file.url) return null;
    const img = libraryImageAttrs(file, b.raw.decorative === true, o);
    const cls = ['mex-image'];
    if (b.data.withBorder) cls.push('mex-image-border');
    if (b.data.withBackground) cls.push('mex-image-background');
    if (b.data.stretched) cls.push('mex-stretched');
    const node = figure(file.url, img, inlineToNodes(b.data.caption, o), classes(cls, b.tunes));
    withFocalPoint(node.children[0], b.data.focalPoint, o);
    return node;
  },
  simpleImage: (b, o) => {
    if (!b.data.url) return null;
    const cls = ['mex-image'];
    if (b.data.withBorder) cls.push('mex-image-border');
    if (b.data.withBackground) cls.push('mex-image-background');
    if (b.data.stretched) cls.push('mex-stretched');
    return figure(
      b.data.url,
      {
        alt:
          b.data.decorative === true
            ? ''
            : typeof b.data.alt === 'string' && b.data.alt.trim()
              ? b.data.alt
              : inlineToText(b.data.caption),
      },
      inlineToNodes(b.data.caption, o),
      classes(cls, b.tunes)
    );
  },
  gallery: (b, o) => {
    const items = b.data.images
      .map((image) => {
        const file = resolveMedia(image.file, b, o);
        if (!file.url) return null;
        const caption = inlineToNodes(image.caption, o);
        const img = el('img', {
          src: file.url,
          ...libraryImageAttrs(file, image.decorative === true, o),
          loading: 'lazy',
          decoding: 'async',
        });
        withFocalPoint(img, image.focalPoint, o);
        return el(
          'li',
          { class: 'mex-gallery-item' },
          el('figure', { class: 'mex-gallery-figure' }, [
            img,
            caption.length ? el('figcaption', {}, caption) : null,
          ])
        );
      })
      .filter(Boolean);
    if (!items.length) return null;
    const { layout, columns } = b.data;
    const caption = inlineToNodes(b.data.caption, o);
    return el(
      'figure',
      {
        class: classes(['mex-gallery', `mex-gallery-${layout}`, `mex-gallery-cols-${columns}`], b.tunes),
        'data-mex-layout': layout,
        'data-mex-columns': String(columns),
      },
      [el('ul', { class: 'mex-gallery-items' }, items), caption.length ? el('figcaption', {}, caption) : null]
    );
  },
  video: (b, o) => mediaFigure('video', b, o),
  audio: (b, o) => mediaFigure('audio', b, o),
  linkTool: (b) => {
    if (!b.data.link) return null;
    const meta = b.data.meta;
    return el(
      'div',
      { class: classes(['mex-link-preview'], b.tunes) },
      el('a', { href: b.data.link, rel: 'nofollow noopener noreferrer' }, [
        meta.image && meta.image.url
          ? el('img', { class: 'mex-link-image', src: meta.image.url, alt: '', loading: 'lazy' })
          : null,
        el('span', { class: 'mex-link-title' }, meta.title || b.data.link),
        meta.description ? el('span', { class: 'mex-link-description' }, meta.description) : null,
        meta.site_name ? el('span', { class: 'mex-link-site' }, meta.site_name) : null,
      ])
    );
  },
  attaches: (b) => {
    const file = b.data.file;
    if (!file.url) return null;
    const text = b.data.title || file.title || file.name || file.url;
    const details = [file.extension ? file.extension.toUpperCase() : '', formatSize(file.size)]
      .filter(Boolean)
      .join(', ');
    return el('p', { class: classes(['mex-attachment'], b.tunes) }, [
      el('a', { href: file.url, download: true }, text),
      details ? [' ', el('span', { class: 'mex-attachment-meta' }, `(${details})`)] : null,
    ]);
  },
  embed: (b, o) => {
    const hosts = Array.isArray(o.embedHosts)
      ? o.embedHosts.map((h) => String(h).toLowerCase())
      : DEFAULT_EMBED_HOSTS;
    const frame = embedFrameUrl(b.data.embed, hosts);
    const caption = inlineToNodes(b.data.caption, o);
    const title = inlineToText(b.data.caption) || b.data.service || 'Embedded content';
    if (!frame) {
      const href = b.data.source || b.data.embed;
      if (!href) return null;
      return el(
        'p',
        { class: classes(['mex-embed', 'mex-embed-link'], b.tunes) },
        el('a', { href, rel: 'nofollow noopener noreferrer' }, caption.length ? caption : href)
      );
    }
    return el(
      'figure',
      {
        class: classes(
          ['mex-embed', b.data.service ? `mex-embed-${b.data.service}` : ''].filter(Boolean),
          b.tunes
        ),
      },
      [
        el('iframe', {
          src: frame,
          title,
          width: b.data.width,
          height: b.data.height,
          loading: 'lazy',
          referrerpolicy: 'strict-origin-when-cross-origin',
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation',
          allow: 'fullscreen; picture-in-picture; encrypted-media',
          allowfullscreen: true,
        }),
        caption.length ? el('figcaption', {}, caption) : null,
      ]
    );
  },
  personality: (b) => {
    const d = b.data;
    if (!d.name && !d.description) return null;
    return el('div', { class: classes(['mex-personality'], b.tunes) }, [
      d.photo ? el('img', { class: 'mex-personality-photo', src: d.photo, alt: '', loading: 'lazy' }) : null,
      el('div', { class: 'mex-personality-body' }, [
        d.name ? el('p', { class: 'mex-personality-name' }, d.name) : null,
        d.description ? el('p', { class: 'mex-personality-description' }, d.description) : null,
        d.link ? el('a', { class: 'mex-personality-link', href: d.link }, d.link) : null,
      ]),
    ]);
  },
  button: (b) => {
    const d = b.data;
    if (!d.text) return null;
    const cls = `mex-button mex-button-${d.style}`;
    const inner = d.link
      ? el(
          'a',
          {
            class: cls,
            href: d.link,
            target: d.openInNewTab ? '_blank' : undefined,
            rel: d.openInNewTab ? 'noopener noreferrer' : undefined,
          },
          d.text
        )
      : el('span', { class: cls }, d.text);
    return el('p', { class: classes(['mex-button-block'], b.tunes) }, inner);
  },
  delimiter: (b) => el('hr', { class: classes(['mex-delimiter'], b.tunes) }),
  toc: (b, o) => {
    const tree = buildTocTree(b.headings || [], b.data);
    if (!tree.length) return null;
    const tag = b.data.style === 'ordered' ? 'ol' : 'ul';
    const list = (nodes) =>
      el(
        tag,
        { class: 'mex-toc-list' },
        nodes.map((node) =>
          el('li', { class: 'mex-toc-item' }, [
            b.linkHeadings && node.id ? el('a', { href: `#${node.id}` }, node.text) : node.text,
            node.children.length ? list(node.children) : null,
          ])
        )
      );
    const title = b.data.title.trim();
    return el(
      'nav',
      {
        class: classes(['mex-toc', `mex-toc-${b.data.style}`], b.tunes),
        'aria-label': title || tocLabel(o),
      },
      [title ? el('p', { class: 'mex-toc-title' }, title) : null, list(tree)]
    );
  },
};

/**
 * Neutral rendering of a custom or unknown block: escaped top-level values.
 * @param {object} b - Prepared block.
 * @returns {RenderNode} Node.
 */
const neutral = (b) =>
  el(
    'div',
    { class: classes(['mex-block', `mex-${b.type}`], b.tunes), 'data-mex-block': b.type },
    scalarFields(b.data).map(([key, value]) =>
      el('div', { class: 'mex-field', 'data-mex-field': key }, inlineToText(value))
    )
  );

/**
 * Default rendering of a code-registered block without a `render` function:
 * the top-level fields in schema order (text, enum, number and boolean as
 * text, inline HTML through the inline parser, URLs as links; empty values,
 * arrays and objects are left out).
 * @param {object} b - Prepared block (with `definition`).
 * @param {object} o - Render options.
 * @returns {RenderNode} Node.
 */
const registeredDefault = (b, o) => {
  const children = [];
  for (const [key, field] of Object.entries(b.definition.schema)) {
    const value = b.data[key];
    if (value === undefined || value === null || value === '') continue;
    const attrs = { class: 'mex-field', 'data-mex-field': key };
    if (field.type === 'inline') children.push(el('div', attrs, inlineToNodes(value, o)));
    else if (field.type === 'url') children.push(el('div', attrs, el('a', { href: value }, value)));
    else if (['text', 'enum', 'number', 'boolean'].includes(field.type))
      children.push(el('div', attrs, String(value)));
  }
  return el(
    'div',
    { class: classes(['mex-block', `mex-${b.type}`], b.tunes), 'data-mex-block': b.type },
    children
  );
};

/* ------------------------------------------------------- override nodes */

/** Tags an override may not output (script, style, document-level and plugin containers). */
const DENIED_TAGS = new Set([
  'script',
  'style',
  'base',
  'meta',
  'link',
  'head',
  'html',
  'body',
  'title',
  'object',
  'embed',
  'applet',
  'frame',
  'frameset',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'svg',
  'math',
  'xmp',
  'plaintext',
  'form',
]);

/** Attributes holding one URL. */
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'cite',
  'data',
  'background',
  'longdesc',
  'manifest',
  'ping',
  'xmlns',
]);

/** URL attributes that load a resource: http(s) or relative only. */
const RESOURCE_ATTRIBUTES = new Set(['src', 'poster', 'data', 'background', 'manifest', 'ping']);

/**
 * Validated URL attribute value or ''.
 * @param {string} name - Attribute name.
 * @param {string} value - Value.
 * @returns {string} Clean value.
 */
const cleanUrlAttribute = (name, value) => {
  if (name === 'srcset' || name === 'imagesrcset') {
    const parts = value.split(',').map((part) => part.trim());
    const clean = [];
    for (const part of parts) {
      const [url, descriptor, extra] = part.split(/\s+/);
      if (extra !== undefined || (descriptor && !/^\d+(?:\.\d+)?[wx]$/.test(descriptor))) return '';
      const safe = sanitizeUrl(url, { schemes: ['http', 'https'] });
      if (!safe) return '';
      clean.push(descriptor ? `${safe} ${descriptor}` : safe);
    }
    return clean.join(', ');
  }
  return sanitizeUrl(value, { schemes: RESOURCE_ATTRIBUTES.has(name) ? ['http', 'https'] : LINK_SCHEMES });
};

const MAX_OVERRIDE_DEPTH = 64;
const MAX_OVERRIDE_NODES = 50000;

/**
 * Validates nodes returned by an override: known node types only, safe tag
 * and attribute names (no `on*`, `style`, `srcdoc`), URL attributes checked
 * with `sanitizeUrl`, raw nodes dropped (raw HTML only enters through
 * `sanitizeRaw`). Block nodes made by this builder (from `helpers.childNodes`)
 * are kept as they are.
 * @param {unknown} input - Override result.
 * @param {WeakSet<object>} trusted - Nodes produced by this builder.
 * @returns {Array<RenderNode|BlockNode>} Clean nodes.
 */
const cleanOverrideNodes = (input, trusted) => {
  let budget = MAX_OVERRIDE_NODES;
  const visit = (value, depth) => {
    const list = Array.isArray(value) ? value.flat(Infinity) : [value];
    const out = [];
    for (const node of list) {
      if (budget <= 0 || depth > MAX_OVERRIDE_DEPTH) break;
      if (typeof node === 'string' || typeof node === 'number') {
        if (node !== '') out.push(textNode(node));
        continue;
      }
      if (!isPlainObject(node)) continue;
      if (trusted.has(node)) {
        out.push(node);
        continue;
      }
      budget -= 1;
      if (node.type === 'text') {
        out.push(textNode(typeof node.value === 'string' ? node.value : ''));
        continue;
      }
      if (node.type !== 'element' || typeof node.tag !== 'string') continue;
      const tag = node.tag;
      if (!TAG_NAME.test(tag) || DENIED_TAGS.has(tag)) continue;
      /** @type {Record<string, string | true>} */
      const attrs = {};
      for (const [name, raw] of Object.entries(isPlainObject(node.attrs) ? node.attrs : {})) {
        if (!isSafeAttributeName(name)) continue;
        if (raw === true) {
          if (!URL_ATTRIBUTES.has(name)) attrs[name] = true;
          continue;
        }
        if (!['string', 'number'].includes(typeof raw)) continue;
        const text = String(raw).slice(0, 10000);
        if (URL_ATTRIBUTES.has(name) || name === 'srcset' || name === 'imagesrcset') {
          const url = cleanUrlAttribute(name, text);
          if (url) attrs[name] = url;
        } else if (text !== '' || name === 'alt') attrs[name] = text;
      }
      if (tag === 'iframe' && !attrs.src) continue;
      out.push({
        type: 'element',
        tag,
        attrs,
        children: visit(Array.isArray(node.children) ? node.children : [], depth + 1),
      });
    }
    return out;
  };
  return visit(input, 0);
};

/* ------------------------------------------------------------- builder */

/**
 * Whether raw HTML (raw blocks, string overrides in a tree) may be used.
 * @param {object} options - Render options.
 * @returns {boolean} True with `rawHtml: 'allow'` and a `sanitizeRaw` function.
 */
const rawAllowed = (options) => options.rawHtml === 'allow' && typeof options.sanitizeRaw === 'function';

/**
 * Creates a tree builder for one value. Used by `renderTree`, `renderHtml`
 * and the framework components.
 *
 * Overrides (`options.overrides[type](block, helpers)`):
 * - return a node or an array of nodes (`helpers.h`, `helpers.textNode`,
 *   `helpers.inlineNodes`, `helpers.childNodes`): validated and used;
 * - return a string: HTML from the caller's code. With `overrideHtml` (only
 *   `renderHtml`, the 2.2 contract) it is written as it is. In a tree it is
 *   used only when `rawHtml: 'allow'` and `sanitizeRaw` are set: the
 *   sanitised HTML becomes the only child of
 *   `<div class="mex-override" data-mex-block="<type>">`; otherwise the
 *   default output is used;
 * - return anything else (undefined): default output.
 * @param {unknown} value - Stored field value.
 * @param {object} [options] - Render options.
 * @param {{ overrideHtml?: boolean }} [mode] - Internal mode.
 * @returns {{ nodes: Array<RenderNode|BlockNode>, renderBlocks: (blocks: PublicBlock[]) => Array<RenderNode|BlockNode>, helpers: object }} Builder result.
 */
export const createTreeBuilder = (value, options, mode = {}) => {
  const opts = options && typeof options === 'object' ? options : {};
  /** @type {WeakMap<object, PublicBlock>} */
  const publicOf = new WeakMap();
  /** @type {WeakMap<object, object>} */
  const preparedOf = new WeakMap();
  /** @type {WeakSet<object>} */
  const trusted = new WeakSet();

  const toPublic = (block) => {
    const known = publicOf.get(block);
    if (known) return known;
    const pub = {
      id: block.id,
      type: block.type,
      data: block.data,
      tunes: block.tunes,
      children: block.children.map(toPublic),
    };
    publicOf.set(block, pub);
    preparedOf.set(pub, block);
    return pub;
  };

  /** @param {object} block - Prepared block. @returns {Array<RenderNode|BlockNode>} Nodes of the block. */
  const blockContent = (block) => {
    const override = overrideFor(opts, block.type);
    if (override) {
      const out = override(toPublic(block), helpers);
      if (typeof out === 'string') {
        if (mode.overrideHtml) return out ? [{ type: 'raw', html: out }] : [];
        if (rawAllowed(opts)) {
          const html = opts.sanitizeRaw(out);
          return typeof html === 'string' && html
            ? [el('div', { class: 'mex-override', 'data-mex-block': block.type }, { type: 'raw', html })]
            : [];
        }
      } else if (out && typeof out === 'object') {
        return cleanOverrideNodes(out, trusted);
      }
    }
    if (block.known) return toNodes(RENDERERS[block.type](block, opts, renderList));
    if (block.definition) return registeredContent(block);
    return [neutral(block)];
  };

  /**
   * Output of a code-registered block: its `render(block, helpers)` result as
   * validated nodes (same rules as overrides). A string is used only with the
   * raw opt-in (`rawHtml: 'allow'` + `sanitizeRaw`), also in `renderHtml`; an
   * empty array renders nothing. A function that throws or returns
   * null/undefined gives the default rendering.
   * @param {object} block - Prepared block with `definition`.
   * @returns {Array<RenderNode|BlockNode>} Nodes.
   */
  const registeredContent = (block) => {
    const render = block.definition.render;
    if (render) {
      let out;
      try {
        out = render(toPublic(block), helpers);
      } catch {
        out = undefined;
      }
      if (typeof out === 'string') {
        if (rawAllowed(opts)) {
          const html = opts.sanitizeRaw(out);
          if (typeof html === 'string' && html)
            return [
              el('div', { class: 'mex-override', 'data-mex-block': block.type }, { type: 'raw', html }),
            ];
        }
      } else if (out && typeof out === 'object') {
        return cleanOverrideNodes(out, trusted);
      }
    }
    return [registeredDefault(block, opts)];
  };

  /** @param {object[]} blocks - Prepared blocks. @returns {Array<RenderNode|BlockNode>} Block nodes separated by line breaks. */
  function renderList(blocks) {
    const out = [];
    for (const block of blocks) {
      const children = blockContent(block);
      if (!children.length) continue;
      /** @type {BlockNode} */
      const node = { type: 'block', block: toPublic(block), children };
      trusted.add(node);
      if (out.length) out.push(textNode('\n'));
      out.push(node);
    }
    return out;
  }

  /** @param {PublicBlock[]} blocks - Blocks handed to an override. @returns {Array<RenderNode|BlockNode>} Nodes. */
  const renderBlocks = (blocks) =>
    renderList((Array.isArray(blocks) ? blocks : []).map((b) => preparedOf.get(b)).filter(Boolean));

  const helpers = {
    escape: escapeHtml,
    inline: (html) => inlineToHtml(html, opts),
    text: (html) => inlineToText(html),
    url: (input, schemes) => sanitizeUrl(input, schemes ? { schemes } : undefined),
    renderChildren: (blocks) => serializeNodes(renderBlocks(blocks)),
    h: (tag, attrs, children) => el(String(tag), attrs, children),
    textNode,
    inlineNodes: (html) => inlineToNodes(html, opts),
    childNodes: renderBlocks,
  };

  const nodes = renderList(annotateHeadings(prepareBlocks(value, opts), opts));
  return { nodes, renderBlocks, helpers };
};

/**
 * Removes the internal block wrappers.
 * @param {Array<RenderNode|BlockNode>} nodes - Nodes.
 * @returns {RenderNode[]} Plain render nodes.
 */
export const flattenBlocks = (nodes) => {
  /** @type {RenderNode[]} */
  const out = [];
  for (const node of nodes) {
    if (node.type === 'block') out.push(...flattenBlocks(node.children));
    else if (node.type === 'element') {
      /** @type {RenderNode} */
      const element = {
        type: 'element',
        tag: node.tag,
        attrs: node.attrs,
        children: flattenBlocks(node.children),
      };
      if (node.style) element.style = node.style;
      out.push(element);
    } else out.push(node);
  }
  return out;
};

/**
 * Renders Magic Editor X content to framework-neutral nodes. Blocks are
 * separated by `\n` text nodes (as in `renderHtml`).
 * @param {unknown} value - Stored field value.
 * @param {import('../../types/render').RenderOptions} [options] - Options.
 * @returns {RenderNode[]} Nodes ([] for empty or invalid input).
 */
export const renderTree = (value, options) => flattenBlocks(createTreeBuilder(value, options).nodes);

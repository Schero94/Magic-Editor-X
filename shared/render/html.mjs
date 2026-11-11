/**
 * HTML renderer for Magic Editor X content.
 *
 * Output is built only from known elements with escaped text and validated
 * URLs. Stored inline HTML goes through the strict parser in `inline.mjs`.
 * No inline styles are written (CSP friendly); layout comes from stable
 * `mex-` class names.
 */

import { sanitizeUrl } from '../sanitize-policy.mjs';
import { escapeHtml, inlineToHtml, inlineToText } from './inline.mjs';
import {
  prepareBlocks,
  imageCandidates,
  resolveMedia,
  DEFAULT_EMBED_HOSTS,
  embedFrameUrl,
  overrideFor,
  scalarFields,
  formatSize,
} from './common.mjs';

const COUNTER_TYPES = Object.freeze({
  'lower-roman': 'i',
  'upper-roman': 'I',
  'lower-alpha': 'a',
  'upper-alpha': 'A',
});

/**
 * Builds an element. Attribute values are escaped; `undefined`, `null`, `false`
 * and '' attributes are skipped; `true` writes a boolean attribute.
 * @param {string} tag - Tag name (trusted, from this module).
 * @param {Record<string, unknown>} attrs - Attributes.
 * @param {string} [inner] - Inner HTML (already safe), omitted for void elements.
 * @returns {string} HTML.
 */
const el = (tag, attrs, inner) => {
  const attributes = Object.entries(attrs || {})
    .filter(
      ([name, value]) =>
        value !== undefined && value !== null && value !== false && (value !== '' || name === 'alt')
    )
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join('');
  return inner === undefined ? `<${tag}${attributes}>` : `<${tag}${attributes}>${inner}</${tag}>`;
};

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
 * @returns {string} HTML of the `<li>` elements.
 */
const listItems = (items, style, options, depth) =>
  items
    .map((item) => {
      if (typeof item === 'string') return el('li', {}, inlineToHtml(item, options));
      const checked = Boolean(item.meta && item.meta.checked);
      const check =
        style === 'checklist'
          ? `${el('input', { type: 'checkbox', disabled: true, checked, 'aria-label': checked ? 'done' : 'open' })} `
          : '';
      const nested =
        Array.isArray(item.items) && item.items.length && depth < 12
          ? listElement(item.items, style, {}, options, depth + 1, [])
          : '';
      return el(
        'li',
        style === 'checklist' ? { class: 'mex-checklist-item', 'data-checked': String(checked) } : {},
        check + inlineToHtml(item.content, options) + nested
      );
    })
    .join('');

/**
 * Renders an `<ol>`/`<ul>`.
 * @param {Array} items - Items.
 * @param {string} style - `ordered`, `unordered` or `checklist`.
 * @param {object} meta - List meta (`start`, `counterType`).
 * @param {object} options - Render options.
 * @param {number} depth - Nesting depth.
 * @param {string[]} base - Classes.
 * @param {object} [tunes] - Tunes.
 * @returns {string} HTML.
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
 * @param {string} caption - Safe caption HTML.
 * @param {string} cls - Class attribute.
 * @returns {string} HTML.
 */
const figure = (url, img, caption, cls) =>
  el(
    'figure',
    { class: cls },
    el('img', { src: url, ...img, loading: 'lazy', decoding: 'async' }) +
      (caption ? el('figcaption', {}, caption) : '')
  );

/**
 * Default HTML per block type.
 * @type {Record<string, (block: object, options: object, render: Function) => string>}
 */
const RENDERERS = {
  paragraph: (b, o) => el('p', { class: classes(['mex-paragraph'], b.tunes) }, inlineToHtml(b.data.text, o)),
  header: (b, o) =>
    el(`h${b.data.level}`, { class: classes(['mex-header'], b.tunes) }, inlineToHtml(b.data.text, o)),
  quote: (b, o) => {
    const caption = inlineToHtml(b.data.caption, o);
    return el(
      'figure',
      {
        class: classes(
          ['mex-quote', ...(b.data.alignment === 'center' ? ['mex-align-center'] : [])],
          b.tunes
        ),
      },
      el('blockquote', {}, inlineToHtml(b.data.text, o)) + (caption ? el('figcaption', {}, caption) : '')
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
    const title = inlineToHtml(b.data.title, o);
    return el(
      'aside',
      { class: classes(['mex-warning'], b.tunes), role: 'note' },
      (title ? el('p', { class: 'mex-warning-title' }, el('strong', {}, title)) : '') +
        el('p', { class: 'mex-warning-message' }, inlineToHtml(b.data.message, o))
    );
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
      inlineToHtml(b.data.message, o)
    ),
  toggle: (b, o, render) =>
    el(
      'details',
      { class: classes(['mex-toggle'], b.tunes), open: b.data.status !== 'closed' },
      el('summary', {}, inlineToHtml(b.data.text, o)) + render(b.children)
    ),
  code: (b) => el('pre', { class: classes(['mex-code'], b.tunes) }, el('code', {}, escapeHtml(b.data.code))),
  codeFlask: (b) =>
    el(
      'pre',
      { class: classes(['mex-code'], b.tunes), 'data-language': b.data.language },
      el('code', { class: `language-${b.data.language}` }, escapeHtml(b.data.code))
    ),
  raw: (b, o) => {
    if (o.rawHtml !== 'allow' || typeof o.sanitizeRaw !== 'function') return '';
    const html = o.sanitizeRaw(String(b.raw.html || ''));
    return typeof html === 'string' && html ? el('div', { class: classes(['mex-raw'], b.tunes) }, html) : '';
  },
  table: (b, o) => {
    const rows = b.data.content;
    if (!rows.length) return '';
    const cells = (row, tag) =>
      el(
        'tr',
        {},
        row.map((cell) => el(tag, tag === 'th' ? { scope: 'col' } : {}, inlineToHtml(cell, o))).join('')
      );
    const head = b.data.withHeadings ? el('thead', {}, cells(rows[0], 'th')) : '';
    const body = (b.data.withHeadings ? rows.slice(1) : rows).map((row) => cells(row, 'td')).join('');
    return el(
      'table',
      { class: classes(['mex-table', ...(b.data.stretched ? ['mex-stretched'] : [])], b.tunes) },
      head + (body ? el('tbody', {}, body) : '')
    );
  },
  image: (b, o) => {
    const file = resolveMedia(b.data.file, b, o);
    if (!file.url) return '';
    const decorative = b.raw.decorative === true;
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
    const cls = ['mex-image'];
    if (b.data.withBorder) cls.push('mex-image-border');
    if (b.data.withBackground) cls.push('mex-image-background');
    if (b.data.stretched) cls.push('mex-stretched');
    return figure(file.url, img, inlineToHtml(b.data.caption, o), classes(cls, b.tunes));
  },
  simpleImage: (b, o) => {
    if (!b.data.url) return '';
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
      inlineToHtml(b.data.caption, o),
      classes(cls, b.tunes)
    );
  },
  linkTool: (b) => {
    if (!b.data.link) return '';
    const meta = b.data.meta;
    const image =
      meta.image && meta.image.url
        ? el('img', { class: 'mex-link-image', src: meta.image.url, alt: '', loading: 'lazy' })
        : '';
    const inner =
      image +
      el('span', { class: 'mex-link-title' }, escapeHtml(meta.title || b.data.link)) +
      (meta.description ? el('span', { class: 'mex-link-description' }, escapeHtml(meta.description)) : '') +
      (meta.site_name ? el('span', { class: 'mex-link-site' }, escapeHtml(meta.site_name)) : '');
    return el(
      'div',
      { class: classes(['mex-link-preview'], b.tunes) },
      el('a', { href: b.data.link, rel: 'nofollow noopener noreferrer' }, inner)
    );
  },
  attaches: (b) => {
    const file = b.data.file;
    if (!file.url) return '';
    const label = b.data.title || file.title || file.name || file.url;
    const details = [file.extension ? file.extension.toUpperCase() : '', formatSize(file.size)]
      .filter(Boolean)
      .join(', ');
    return el(
      'p',
      { class: classes(['mex-attachment'], b.tunes) },
      el('a', { href: file.url, download: true }, escapeHtml(label)) +
        (details ? ` ${el('span', { class: 'mex-attachment-meta' }, `(${escapeHtml(details)})`)}` : '')
    );
  },
  embed: (b, o) => {
    const hosts = Array.isArray(o.embedHosts)
      ? o.embedHosts.map((h) => String(h).toLowerCase())
      : DEFAULT_EMBED_HOSTS;
    const frame = embedFrameUrl(b.data.embed, hosts);
    const caption = inlineToHtml(b.data.caption, o);
    const title = inlineToText(b.data.caption) || b.data.service || 'Embedded content';
    if (!frame) {
      const href = b.data.source || b.data.embed;
      if (!href) return '';
      return el(
        'p',
        { class: classes(['mex-embed', 'mex-embed-link'], b.tunes) },
        el('a', { href, rel: 'nofollow noopener noreferrer' }, caption || escapeHtml(href))
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
      el(
        'iframe',
        {
          src: frame,
          title,
          width: b.data.width,
          height: b.data.height,
          loading: 'lazy',
          referrerpolicy: 'strict-origin-when-cross-origin',
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation',
          allow: 'fullscreen; picture-in-picture; encrypted-media',
          allowfullscreen: true,
        },
        ''
      ) + (caption ? el('figcaption', {}, caption) : '')
    );
  },
  personality: (b) => {
    const d = b.data;
    if (!d.name && !d.description) return '';
    return el(
      'div',
      { class: classes(['mex-personality'], b.tunes) },
      (d.photo ? el('img', { class: 'mex-personality-photo', src: d.photo, alt: '', loading: 'lazy' }) : '') +
        el(
          'div',
          { class: 'mex-personality-body' },
          (d.name ? el('p', { class: 'mex-personality-name' }, escapeHtml(d.name)) : '') +
            (d.description
              ? el('p', { class: 'mex-personality-description' }, escapeHtml(d.description))
              : '') +
            (d.link ? el('a', { class: 'mex-personality-link', href: d.link }, escapeHtml(d.link)) : '')
        )
    );
  },
  button: (b) => {
    const d = b.data;
    if (!d.text) return '';
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
          escapeHtml(d.text)
        )
      : el('span', { class: cls }, escapeHtml(d.text));
    return el('p', { class: classes(['mex-button-block'], b.tunes) }, inner);
  },
  delimiter: (b) => el('hr', { class: classes(['mex-delimiter'], b.tunes) }),
};

/**
 * Neutral rendering of a custom or unknown block: escaped top-level values.
 * @param {object} b - Prepared block.
 * @returns {string} HTML.
 */
const neutral = (b) =>
  el(
    'div',
    { class: classes(['mex-block', `mex-${b.type}`], b.tunes), 'data-mex-block': b.type },
    scalarFields(b.data)
      .map(([key, value]) =>
        el('div', { class: 'mex-field', 'data-mex-field': key }, escapeHtml(inlineToText(value)))
      )
      .join('')
  );

/**
 * Helpers handed to `options.overrides[type](block, helpers)`.
 * @param {object} options - Render options.
 * @param {(blocks: object[]) => string} render - Renders child blocks.
 * @returns {object} Helpers.
 */
const helpersFor = (options, render) => ({
  escape: escapeHtml,
  inline: (html) => inlineToHtml(html, options),
  text: (html) => inlineToText(html),
  url: (value, schemes) => sanitizeUrl(value, schemes ? { schemes } : undefined),
  renderChildren: (blocks) => render(blocks),
});

/**
 * Renders Magic Editor X content to HTML.
 * @param {unknown} value - Stored field value.
 * @param {import('../../types/render').RenderOptions} [options] - Options.
 * @returns {string} HTML ('' for empty or invalid input).
 */
export const renderHtml = (value, options = {}) => {
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
            helpersFor(opts, render)
          );
          if (typeof out === 'string') return out;
        }
        if (block.known) return RENDERERS[block.type](block, opts, render);
        return neutral(block);
      })
      .filter(Boolean)
      .join('\n');
  return render(prepareBlocks(value, opts));
};

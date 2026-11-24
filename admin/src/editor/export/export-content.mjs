/**
 * "Export…" (2.11): shared pieces of the Word, PDF, Markdown and HTML
 * exports. Pure functions over the public renderers (`shared/render`), so
 * `node --test` covers them.
 *
 * - Every export renders the content as the editor shows it (unsaved
 *   changes included), with synced blocks expanded from their sources.
 * - Third-party content is never loaded: an embed becomes a labelled link,
 *   a component block a label, a raw HTML block a note (raw HTML is not
 *   exported; it may hold scripts and the print view is same-origin).
 * - Relative URLs (Media Library files on the local provider, internal
 *   links) are made absolute against the admin origin, so the exported file
 *   still links to them.
 */

import { renderHtml, renderMarkdown } from '../../../../shared/render/index.mjs';

/** Export formats in the order the dialog offers them. */
export const EXPORT_FORMATS = Object.freeze(['docx', 'pdf', 'markdown', 'html']);

const EXTENSIONS = Object.freeze({ docx: 'docx', pdf: 'pdf', markdown: 'md', html: 'html' });

/** MIME types of the downloaded files. */
export const EXPORT_MIME = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  markdown: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
});

/**
 * File name part: lower case ASCII letters, digits and hyphens (accents folded), at most 60 characters.
 * @param {unknown} value - Text.
 * @returns {string} Slug ('' when nothing usable is left).
 */
export const fileSlug = (value) =>
  String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

/**
 * Name of an exported file: entry title, field and date, for example
 * `field-report-body-2026-11-24.docx`.
 * @param {{ title?: string, field?: string, format: string, date?: Date }} options - Parts.
 * @returns {string} File name.
 */
export const exportFileName = ({ title, field, format, date = new Date() }) => {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  // The field path of a field in a component (`sections.2.body`) keeps its last name.
  const fieldName = String(field || '')
    .split('.')
    .filter((part) => !/^\d+$/.test(part))
    .pop();
  const parts = [fileSlug(title) || 'entry', fileSlug(fieldName), day].filter(Boolean);
  return `${parts.join('-')}.${EXTENSIONS[format] || 'txt'}`;
};

/**
 * Makes a URL absolute against the admin origin (http(s) origins only).
 * @param {string} url - URL from the render tree (already validated).
 * @param {string} [origin] - Admin origin (`location.origin`).
 * @returns {string} Absolute URL, or the input when it cannot be resolved.
 */
export const absoluteUrl = (url, origin) => {
  if (typeof url !== 'string' || !url || url.startsWith('#')) return url;
  if (!origin || !/^https?:\/\//i.test(origin)) return url;
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
};

/**
 * Render options of every export format.
 * @param {{ origin?: string, synced?: Map<string, object[]>, labels: { embed: string, component: string, raw: string } }} options - Admin origin, synced block sources and translated labels.
 * @returns {object} Options for `renderTree`/`renderHtml`.
 */
export const exportRenderOptions = ({ origin, synced, labels }) => ({
  rawHtml: 'omit',
  headingIds: true,
  footnotes: { prefix: 'mex-export-' },
  synced: synced || undefined,
  links: (ref) => (ref && ref.href ? absoluteUrl(ref.href, origin) : null),
  media: (file) => (file && file.url ? { ...file, url: absoluteUrl(file.url, origin) } : file),
  overrides: {
    embed: (block, h) => {
      const source = h.url(block.data.source || block.data.embed, ['https', 'http']);
      const caption = h.text(block.data.caption || '');
      return h.h('p', { class: 'mex-export-note' }, [
        h.textNode(`${labels.embed}${caption ? `: ${caption}` : ''} `),
        ...(source ? [h.h('a', { href: source }, [h.textNode(source)])] : []),
      ]);
    },
    raw: (_block, h) => h.h('p', { class: 'mex-export-note' }, [h.textNode(labels.raw)]),
    component: (block, h) =>
      h.h('p', { class: 'mex-export-note' }, [
        h.textNode(`${labels.component}: ${String((block.data && block.data.uid) || '')}`),
      ]),
  },
});

/**
 * Markdown export.
 * @param {unknown} value - Editor document.
 * @param {{ origin?: string, synced?: Map<string, object[]>, labels: object }} options - See `exportRenderOptions`.
 * @returns {string} Markdown (ends with a newline).
 */
export const exportMarkdown = (value, { origin, synced, labels }) => {
  const markdown = renderMarkdown(value, {
    synced: synced || undefined,
    links: (ref) => (ref && ref.href ? absoluteUrl(ref.href, origin) : null),
    media: (file) => (file && file.url ? { ...file, url: absoluteUrl(file.url, origin) } : file),
    overrides: {
      raw: () => `_${labels.raw}_`,
      component: (block) => `_${labels.component}: ${String((block.data && block.data.uid) || '')}_`,
    },
  });
  return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
};

/** Escapes text for the document head. */
const escapeHead = (text) =>
  String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Stylesheet of the exported HTML and the print view: readable typography,
 * page margins, tables, code, images that fit the page, no page break inside
 * figures, tables rows and code, and the URL after each external link in
 * print. CSS named colours (black text on white, grey rules): the page is
 * printed or opened outside the admin, so Design System tokens do not apply.
 * @param {{ pageBreaks?: boolean }} [options] - `pageBreaks`: start every H1 and H2 (except the first block) on a new page.
 * @returns {string} CSS.
 */
export const exportStylesheet = ({ pageBreaks = false } = {}) => `
@page { margin: 2cm 2cm 2.2cm; }
:root { color-scheme: light; }
html { font-size: 100%; }
body { margin: 0 auto; max-width: 46rem; padding: 2rem 1.5rem; color: black; background: white;
  font: 11.5pt/1.55 Georgia, "Times New Roman", serif; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.25;
  margin: 1.4em 0 0.5em; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4, h5, h6 { font-size: 1.05em; }
.mex-export-title { margin-top: 0; }
p, ul, ol, figure, blockquote, pre, table, aside, details { margin: 0 0 0.9em; }
a { color: mediumblue; }
img { max-width: 100%; height: auto; }
figure { margin-inline: 0; break-inside: avoid; page-break-inside: avoid; }
figcaption, caption { font-size: 0.9em; color: dimgray; margin-top: 0.3em; }
blockquote { margin-inline: 0; padding-left: 1em; border-left: 3px solid silver; color: black; }
pre, code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 0.9em; }
pre { padding: 0.75em 1em; background: whitesmoke; border: 1px solid gainsboro; white-space: pre-wrap;
  break-inside: avoid; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid silver; padding: 0.35em 0.6em; text-align: left; vertical-align: top; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
hr { border: 0; border-top: 1px solid silver; margin: 1.5em 0; }
aside, .mex-alert { border: 1px solid gainsboro; padding: 0.6em 0.9em; }
.mex-export-note { font-style: italic; color: dimgray; }
.mex-align-center { text-align: center; } .mex-align-right { text-align: right; }
.mex-checklist { list-style: none; padding-left: 0.4em; }
.mex-footnotes { font-size: 0.9em; border-top: 1px solid silver; margin-top: 2em; }
@media print {
  body { max-width: none; padding: 0; }
  a { color: inherit; }
  a[href^="http"]::after, a[href^="mailto:"]::after { content: " (" attr(href) ")"; font-size: 0.85em;
    color: dimgray; overflow-wrap: anywhere; }
  .mex-export-note a::after { content: ""; }
${
  pageBreaks
    ? '  main > h1:not(:first-child), main > h2:not(:first-child) { break-before: page; page-break-before: always; }\n'
    : ''
}}
`;

/**
 * A standalone HTML document of the content (HTML export and print view).
 * The body is the plugin's own `renderHtml` output (escaped text, validated
 * URLs, no raw HTML, no iframes); no script is written.
 * @param {unknown} value - Editor document.
 * @param {{ title?: string, lang?: string, dir?: 'ltr'|'rtl', origin?: string, synced?: Map<string, object[]>, labels: object, pageBreaks?: boolean }} options - Document title, language, direction, render options, page breaks before H1/H2 in print.
 * @returns {string} HTML document.
 */
export const exportHtmlDocument = (value, options) => {
  const { title, lang, dir, pageBreaks } = options;
  const body = renderHtml(value, exportRenderOptions(options));
  const language = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang || '') ? lang : 'en';
  return [
    '<!doctype html>',
    `<html lang="${language}"${dir === 'rtl' ? ' dir="rtl"' : ''}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHead(title || 'Export')}</title>`,
    `<style>${exportStylesheet({ pageBreaks })}</style>`,
    '</head>',
    '<body>',
    `<main>${body}</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
};

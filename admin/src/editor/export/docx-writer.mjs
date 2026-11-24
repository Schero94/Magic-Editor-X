/**
 * Word export (2.11): Magic Editor X content to a .docx file with the `docx`
 * package (MIT, dolanmiu/docx). Loaded with `import()` only when an editor
 * exports to Word, so the package is its own chunk and not part of the admin
 * entry.
 *
 * The writer walks the plugin's render tree (`renderTree`, the same output
 * as `renderHtml`), so every block type that renders, including code
 * registered blocks, synced blocks, footnotes and the table of contents,
 * reaches the document without a second mapping per block type:
 * headings -> Word headings; paragraphs with alignment; bold, italic,
 * underline, strike, highlight, inline code, superscript, subscript, line
 * breaks; links -> hyperlinks (absolute http(s)/mailto; same-page anchors
 * become text); bulleted, numbered (start number, numbering style) and check
 * lists with nesting; tables with header row, colspan and rowspan; code
 * blocks in a monospace style; quotes, callouts and captions in their own
 * paragraph styles; delimiters as a rule. Images are embedded when the
 * caller's `loadImage` returns their bytes (same-origin files), else written
 * as a link. Embeds, components and raw HTML arrive as labelled notes (see
 * `export-content.mjs`).
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { renderTree } from '../../../../shared/render/index.mjs';
import { absoluteUrl, exportRenderOptions } from './export-content.mjs';

/** Widest embedded image (pixels at 96 dpi; the page body is about 6.3 inches). */
export const MAX_IMAGE_WIDTH = 600;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'dd',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'iframe',
  'li',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'ul',
  'video',
  'audio',
  'caption',
]);

const MONO = 'Consolas';

/** Text of a node tree. */
const textOf = (node) => {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
};

const classesOf = (node) => String((node.attrs && node.attrs.class) || '').split(/\s+/);

/** An element child that is a block. */
const hasBlockChild = (node) =>
  node.children.some(
    (child) =>
      child.type === 'element' && (BLOCK_TAGS.has(child.tag) || (child.tag === 'img' && node.tag !== 'a'))
  );

const BULLETS = ['\u2022', '\u25e6', '\u25aa'];
const ORDER_FORMATS = {
  1: LevelFormat.DECIMAL,
  a: LevelFormat.LOWER_LETTER,
  A: LevelFormat.UPPER_LETTER,
  i: LevelFormat.LOWER_ROMAN,
  I: LevelFormat.UPPER_ROMAN,
};
const NESTED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

/** Paragraph indent of a list level (twips). */
const levelIndent = (level) => ({ left: 720 * (level + 1), hanging: 360 });

/**
 * Builds the document.
 * @param {unknown} value - Editor document (as shown in the editor).
 * @param {{ title?: string, origin?: string, synced?: Map<string, object[]>, labels: { embed: string, component: string, raw: string, image: string, video: string, audio: string }, loadImage?: (src: string) => Promise<{ data: Uint8Array, type: 'png'|'jpg'|'gif'|'bmp', width: number, height: number }|null> }} options - Title, admin origin, synced sources, translated labels and the image loader.
 * @returns {Promise<Document>} docx Document.
 */
export const buildWordDocument = async (value, options) => {
  const { title, origin, labels, loadImage } = options;
  const nodes = renderTree(value, exportRenderOptions(options));

  // Images first (in parallel, at most four at a time), then one synchronous walk.
  const sources = [];
  const collect = (list) => {
    for (const node of list) {
      if (node.type !== 'element') continue;
      if (node.tag === 'img' && typeof node.attrs.src === 'string') sources.push(node.attrs.src);
      collect(node.children);
    }
  };
  collect(nodes);
  const images = new Map();
  if (typeof loadImage === 'function') {
    const unique = [...new Set(sources)];
    for (let index = 0; index < unique.length; index += 4) {
      const batch = unique.slice(index, index + 4);
      const loaded = await Promise.all(
        batch.map((src) => loadImage(absoluteUrl(src, origin)).catch(() => null))
      );
      batch.forEach((src, position) => {
        if (loaded[position]) images.set(src, loaded[position]);
      });
    }
  }

  const numbering = new Map();
  let listInstance = 0;
  const orderedReference = (type, start) => {
    const reference = `mex-ol-${type}-${start}`;
    if (!numbering.has(reference))
      numbering.set(reference, {
        reference,
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: level === 0 ? ORDER_FORMATS[type] || LevelFormat.DECIMAL : NESTED_FORMATS[level % 3],
          text: `%${level + 1}.`,
          start: level === 0 ? start : 1,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: levelIndent(level) } },
        })),
      });
    return reference;
  };
  numbering.set('mex-bullet', {
    reference: 'mex-bullet',
    levels: Array.from({ length: 9 }, (_, level) => ({
      level,
      format: LevelFormat.BULLET,
      text: BULLETS[level % 3],
      alignment: AlignmentType.START,
      style: { paragraph: { indent: levelIndent(level) } },
    })),
  });

  /** Hyperlink target for Word: absolute http(s) or mailto, else null (the text stays). */
  const linkOf = (href) => {
    if (typeof href !== 'string' || href.startsWith('#')) return null;
    const resolved = absoluteUrl(href, origin);
    return /^(https?:|mailto:)/i.test(resolved) ? resolved : null;
  };

  /**
   * Runs of inline nodes.
   * @param {Array<object>} list - Nodes.
   * @param {object} marks - Active marks.
   * @param {{ pre?: boolean }} [mode] - Keep whitespace (code).
   * @returns {Array<object>} Paragraph children.
   */
  const inline = (list, marks = {}, mode = {}) => {
    const out = [];
    for (const node of list) {
      if (node.type === 'text') {
        const text = mode.pre ? node.value : node.value.replace(/\s+/g, ' ');
        if (!text) continue;
        if (mode.pre && text.includes('\n')) {
          text
            .split('\n')
            .forEach((line, index) => out.push(new TextRun({ text: line, break: index ? 1 : 0, ...marks })));
        } else out.push(new TextRun({ text, ...marks }));
        continue;
      }
      if (node.type !== 'element') continue;
      const { tag } = node;
      if (tag === 'br') out.push(new TextRun({ text: '', break: 1, ...marks }));
      else if (tag === 'img' || tag === 'iframe' || tag === 'video' || tag === 'audio') continue;
      else if (tag === 'input')
        out.push(new TextRun({ text: node.attrs.checked ? '\u2611' : '\u2610', ...marks }));
      else if (tag === 'span' && /\bmex-link-(description|site)\b/.test(node.attrs.class || '')) {
        // Link preview: title, description and site on their own lines.
        out.push(new TextRun({ text: '', break: 1, ...marks }), ...inline(node.children, marks, mode));
      } else if (tag === 'b' || tag === 'strong')
        out.push(...inline(node.children, { ...marks, bold: true }, mode));
      else if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn')
        out.push(...inline(node.children, { ...marks, italics: true }, mode));
      else if (tag === 'u' || tag === 'ins')
        out.push(...inline(node.children, { ...marks, underline: {} }, mode));
      else if (tag === 's' || tag === 'del' || tag === 'strike')
        out.push(...inline(node.children, { ...marks, strike: true }, mode));
      else if (tag === 'mark') out.push(...inline(node.children, { ...marks, highlight: 'yellow' }, mode));
      else if (tag === 'code' || tag === 'kbd' || tag === 'samp')
        out.push(...inline(node.children, { ...marks, font: MONO }, mode));
      else if (tag === 'sup') out.push(...inline(node.children, { ...marks, superScript: true }, mode));
      else if (tag === 'sub') out.push(...inline(node.children, { ...marks, subScript: true }, mode));
      else if (tag === 'a') {
        const link = linkOf(node.attrs.href);
        const runs = inline(node.children, link ? { ...marks, style: 'Hyperlink' } : marks, mode);
        if (link && runs.length) out.push(new ExternalHyperlink({ link, children: runs }));
        else out.push(...runs);
      } else out.push(...inline(node.children, marks, mode));
    }
    return out;
  };

  const alignmentOf = (node) => {
    const classes = classesOf(node);
    if (classes.includes('mex-align-center')) return AlignmentType.CENTER;
    if (classes.includes('mex-align-right')) return AlignmentType.RIGHT;
    return undefined;
  };

  /** A paragraph of inline nodes (nothing when it has no runs). */
  const paragraph = (list, properties = {}, marks = {}) => {
    const children = inline(list, marks);
    if (!children.length) return [];
    return [new Paragraph({ ...properties, children })];
  };

  /** Image paragraph, or a link to the image when it was not loaded. */
  const imageBlock = (node, properties = {}) => {
    const src = node.attrs.src;
    const loaded = images.get(src);
    const alt = String(node.attrs.alt || '');
    if (loaded) {
      const width = Math.max(1, Number(loaded.width) || MAX_IMAGE_WIDTH);
      const height = Math.max(1, Number(loaded.height) || Math.round(width * 0.66));
      const scale = width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / width : 1;
      return [
        new Paragraph({
          ...properties,
          children: [
            new ImageRun({
              type: loaded.type,
              data: loaded.data,
              transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
              altText: { name: alt.slice(0, 100) || 'image', description: alt, title: alt },
            }),
          ],
        }),
      ];
    }
    const link = linkOf(src);
    const label = `${labels.image}${alt ? `: ${alt}` : ''}`;
    return [
      new Paragraph({
        ...properties,
        style: 'ExportNote',
        children: link
          ? [
              new TextRun({ text: `${label} ` }),
              new ExternalHyperlink({ link, children: [new TextRun({ text: link, style: 'Hyperlink' })] }),
            ]
          : [new TextRun({ text: label })],
      }),
    ];
  };

  /**
   * List items.
   * @param {object} node - ul/ol.
   * @param {number} level - Nesting level.
   * @param {number} instance - List instance (restarts numbering).
   * @returns {Array<object>} Paragraphs.
   */
  const listParagraphs = (node, level, instance) => {
    const ordered = node.tag === 'ol';
    const reference = ordered
      ? orderedReference(String(node.attrs.type || '1'), Math.max(1, Number(node.attrs.start) || 1))
      : 'mex-bullet';
    const out = [];
    for (const item of node.children) {
      if (item.type !== 'element' || item.tag !== 'li') continue;
      const own = [];
      const nested = [];
      for (const child of item.children) {
        if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) nested.push(child);
        else if (child.type === 'element' && child.tag === 'p')
          own.push(...child.children, { type: 'element', tag: 'br', attrs: {}, children: [] });
        else own.push(child);
      }
      while (own.length && own[own.length - 1].tag === 'br') own.pop();
      const children = inline(own);
      out.push(
        new Paragraph({
          numbering: { reference, level: Math.min(level, 8), instance },
          children: children.length ? children : [new TextRun('')],
        })
      );
      for (const child of nested) out.push(...listParagraphs(child, level + 1, instance));
    }
    return out;
  };

  /** Table with header rows, spans and a caption after it. */
  const table = (node) => {
    const rows = [];
    let caption = null;
    const addRows = (container, header) => {
      for (const child of container.children) {
        if (child.type !== 'element') continue;
        if (child.tag === 'tr') {
          const cells = child.children
            .filter((cell) => cell.type === 'element' && (cell.tag === 'td' || cell.tag === 'th'))
            .map((cell) => {
              const content = blocks(cell.children, { bold: cell.tag === 'th' });
              return new TableCell({
                children: content.length
                  ? content.filter((item) => item instanceof Paragraph || item instanceof Table)
                  : [new Paragraph('')],
                columnSpan: Math.max(1, Number(cell.attrs.colspan) || 1),
                rowSpan: Math.max(1, Number(cell.attrs.rowspan) || 1),
              });
            });
          if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: header }));
        } else if (child.tag === 'thead') addRows(child, true);
        else if (child.tag === 'tbody' || child.tag === 'tfoot') addRows(child, false);
        else if (child.tag === 'caption') caption = child;
      }
    };
    addRows(node, false);
    if (!rows.length) return [];
    const out = [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
    if (caption) out.push(...paragraph(caption.children, { style: 'Caption' }));
    // Word needs a paragraph between two tables, or it joins them.
    out.push(new Paragraph(''));
    return out;
  };

  /**
   * Block-level nodes to paragraphs and tables.
   * @param {Array<object>} list - Nodes.
   * @param {{ style?: string, bold?: boolean }} [context] - Paragraph style and marks of the container.
   * @returns {Array<object>} Document children.
   */
  const blocks = (list, context = {}) => {
    const out = [];
    let pending = [];
    const marks = context.bold ? { bold: true } : {};
    const props = context.style ? { style: context.style } : {};
    const flush = () => {
      if (pending.length) out.push(...paragraph(pending, props, marks));
      pending = [];
    };
    for (const node of list) {
      if (node.type !== 'element' || !(BLOCK_TAGS.has(node.tag) || node.tag === 'img')) {
        pending.push(node);
        continue;
      }
      flush();
      const { tag } = node;
      if (/^h[1-6]$/.test(tag)) {
        out.push(
          ...paragraph(node.children, { heading: HEADINGS[Number(tag[1]) - 1], alignment: alignmentOf(node) })
        );
      } else if (tag === 'ul' || tag === 'ol') {
        listInstance += 1;
        out.push(...listParagraphs(node, 0, listInstance));
      } else if (tag === 'pre') {
        // Whitespace and line breaks of code are kept (one paragraph, line breaks between lines).
        const runs = inline([{ type: 'text', value: textOf(node).replace(/\n$/, '') }], {}, { pre: true });
        out.push(new Paragraph({ style: 'Code', children: runs.length ? runs : [new TextRun('')] }));
      } else if (tag === 'table') out.push(...table(node));
      else if (tag === 'hr')
        out.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 } },
          })
        );
      else if (tag === 'img') out.push(...imageBlock(node, props));
      else if (tag === 'iframe' || tag === 'video' || tag === 'audio') {
        const source =
          node.attrs.src ||
          (node.children.find((child) => child.tag === 'source') || { attrs: {} }).attrs.src;
        const link = linkOf(source);
        const label = tag === 'video' ? labels.video : tag === 'audio' ? labels.audio : labels.embed;
        out.push(
          new Paragraph({
            style: 'ExportNote',
            children: link
              ? [
                  new TextRun(`${label} `),
                  new ExternalHyperlink({
                    link,
                    children: [new TextRun({ text: link, style: 'Hyperlink' })],
                  }),
                ]
              : [new TextRun(label)],
          })
        );
      } else if (tag === 'blockquote') out.push(...blocks(node.children, { ...context, style: 'Quote' }));
      else if (tag === 'figcaption' || tag === 'caption')
        out.push(...paragraph(node.children, { style: 'Caption' }));
      else if (tag === 'summary') out.push(...paragraph(node.children, props, { bold: true }));
      else if (tag === 'aside' || classesOf(node).includes('mex-alert')) {
        if (hasBlockChild(node)) out.push(...blocks(node.children, { ...context, style: 'Note' }));
        else out.push(...paragraph(node.children, { style: 'Note' }));
      } else if (hasBlockChild(node)) out.push(...blocks(node.children, context));
      else if (classesOf(node).includes('mex-export-note'))
        out.push(...paragraph(node.children, { style: 'ExportNote' }));
      else out.push(...paragraph(node.children, { ...props, alignment: alignmentOf(node) }, marks));
    }
    flush();
    return out;
  };

  const children = blocks(nodes);
  return new Document({
    title: title || undefined,
    creator: 'Magic Editor X',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Quote',
          name: 'Quote',
          basedOn: 'Normal',
          next: 'Normal',
          run: { italics: true },
          paragraph: {
            indent: { left: 567 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'A0A0A0', space: 8 } },
          },
        },
        {
          id: 'Code',
          name: 'Code',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: MONO, size: 19 },
          paragraph: { spacing: { before: 120, after: 120 } },
        },
        {
          id: 'Caption',
          name: 'Caption',
          basedOn: 'Normal',
          next: 'Normal',
          run: { italics: true, size: 19, color: '555555' },
        },
        {
          id: 'Note',
          name: 'Note',
          basedOn: 'Normal',
          next: 'Normal',
          paragraph: { indent: { left: 284 }, shading: { fill: 'F2F2F2' } },
        },
        {
          id: 'ExportNote',
          name: 'Export note',
          basedOn: 'Normal',
          next: 'Normal',
          run: { italics: true, color: '555555' },
        },
      ],
    },
    numbering: { config: [...numbering.values()] },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });
};

/**
 * Builds the .docx file.
 * @param {unknown} value - Editor document.
 * @param {object} options - See `buildWordDocument`.
 * @returns {Promise<Uint8Array>} File bytes.
 */
export const buildDocxFile = async (value, options) =>
  new Uint8Array(await Packer.toArrayBuffer(await buildWordDocument(value, options)));

/**
 * Word (.docx, Office Open XML WordprocessingML) to HTML (2.11), for the
 * "Import file…" tool. Own reader instead of mammoth (whose dependency tree
 * is unmaintained): the bounded ZIP reader in `zip.mjs` and an XML parser the
 * caller passes (the browser's DOMParser; jsdom's in the tests).
 *
 * What is read: `word/document.xml` (the main part named in `_rels/.rels`),
 * its relationships (hyperlink targets), `styles.xml` (headings by style name
 * or outline level, quote and code styles, list styles) and `numbering.xml`
 * (bulleted vs numbered lists, start numbers). The output is HTML built only
 * from this module's own tags with escaped text; it then goes through the
 * shared `htmlToBlocks` converter and the editor's sanitiser like a paste, so
 * every href and every inline tag is checked again there.
 *
 * Mapping: headings (Title, Heading 1-6, outline levels), paragraphs, bold,
 * italic, underline, strike, superscript, subscript, highlight, line breaks,
 * hyperlinks (relationship targets and HYPERLINK fields; internal bookmarks
 * become plain text), bulleted and numbered lists with nesting and start
 * numbers, tables (header rows, gridSpan -> colspan, vMerge -> rowspan),
 * quote and code paragraph styles. Images: by default each one becomes a
 * visible placeholder text (`imageLabel`), and the report counts them. With
 * `images: 'collect'` (2.13, the import dialog) a picture in a paragraph or
 * heading becomes its own fragment `{ image: index }` and `media[index]`
 * carries its bytes (PNG, JPEG, GIF, WebP, detected by signature, within
 * `DOCX_IMAGE_LIMITS`) or the reason it stays a placeholder. Nothing is
 * uploaded here; the dialog uploads only after the user confirms.
 * Deleted text of tracked changes is left out, inserted text is kept; the
 * table-of-contents content control is skipped (its entries are generated).
 *
 * XML safety: a part with a DOCTYPE (DTD) is refused before it is parsed, so
 * no internal or external entity can be declared; WordprocessingML never has
 * one. Browsers' DOMParser does not fetch external entities either.
 */

import { ImportError, ZIP_LIMITS, inflateEntry, readZipDirectory } from './zip.mjs';
import { escapeText } from './common.mjs';

/** Limits of the Word reader. */
export const DOCX_LIMITS = Object.freeze({
  /** Largest XML part (bytes) that is parsed. */
  maxXmlBytes: ZIP_LIMITS.maxEntryBytes,
  /** Most top-level fragments (paragraphs, lists, tables) read from a document. */
  maxFragments: 20000,
  /** Deepest nesting of content controls, tables and custom XML. */
  maxDepth: 16,
});

/**
 * Limits for pictures read from one Word file (2.13). Pictures beyond them stay placeholders.
 * The ZIP limits apply first (`ZIP_LIMITS`: 10 MiB file, 20 MiB per part, 50 MiB in all).
 */
export const DOCX_IMAGE_LIMITS = Object.freeze({
  /** Different pictures imported from one file. */
  maxImages: 50,
  /** Largest picture (bytes); the dialog lowers it to the server's `uploads.maxImageBytes`. */
  maxImageBytes: 10 * 1024 * 1024,
  /** All pictures of one file together (bytes). */
  maxTotalBytes: 40 * 1024 * 1024,
});

/** Picture types that are imported (by signature); everything else stays a placeholder. */
export const DOCX_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Vector and legacy picture formats that are never read (EMF, WMF and their compressed forms, SVG, TIFF, BMP). */
const VECTOR_EXTENSION = /\.(emf|wmf|emz|wmz|svg|svgz|tif|tiff|bmp|pict|eps)$/i;

/**
 * Picture type by its first bytes (never by file name).
 * @param {Uint8Array} bytes - Picture bytes.
 * @returns {string|null} `image/png`, `image/jpeg`, `image/gif`, `image/webp` or null.
 */
export const sniffImageType = (bytes) => {
  if (!bytes || bytes.length < 12) return null;
  const at = (offset, values) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61)
    return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
};

/** Marks a collected picture inside paragraph HTML (XML text cannot contain U+0000). */
// eslint-disable-next-line no-control-regex -- U+0000 is the picture mark on purpose (XML text cannot contain it)
const IMAGE_MARK = /\u0000(\d+)\u0000/g;

const MAIN_TYPE = /\/officeDocument$/;
const REL_STYLES = /\/styles$/;
const REL_NUMBERING = /\/numbering$/;
const REL_HYPERLINK = /\/hyperlink$/;
const REL_IMAGE = /\/image$/;

const xmlDecoder = new TextDecoder('utf-8');

/**
 * Resolves a relationship target against the folder of its source part.
 * @param {string} base - Folder of the source part (`word/`), '' for the package root.
 * @param {string} target - Relationship target.
 * @returns {string} Package path without a leading slash.
 */
const resolvePart = (base, target) => {
  const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
};

/**
 * Parses one XML part after the size and DOCTYPE checks.
 * @param {Uint8Array} bytes - Part bytes.
 * @param {(xml: string) => Document} parseXml - XML parser.
 * @returns {Document} Parsed document.
 * @throws {ImportError} `XML_TOO_LARGE`, `XML_INVALID`.
 */
const parsePart = (bytes, parseXml) => {
  if (bytes.length > DOCX_LIMITS.maxXmlBytes) throw new ImportError('XML_TOO_LARGE');
  const text = xmlDecoder.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ImportError('XML_INVALID', 'doctype');
  let doc;
  try {
    doc = parseXml(text);
  } catch {
    throw new ImportError('XML_INVALID', 'parse');
  }
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length)
    throw new ImportError('XML_INVALID', 'parse');
  return doc;
};

/** First attribute with this local name (prefixes differ between transitional and strict files). */
const attr = (element, local) => {
  if (!element || !element.attributes) return null;
  for (const attribute of element.attributes) if (attribute.localName === local) return attribute.value;
  return null;
};

/** Relationship id attribute (`r:id`, `r:embed`): the attribute in a relationships namespace. */
const relAttr = (element, local) => {
  if (!element || !element.attributes) return null;
  for (const attribute of element.attributes)
    if (attribute.localName === local && /relationships$/.test(attribute.namespaceURI || ''))
      return attribute.value;
  return null;
};

/** Element children. */
const childrenOf = (element) => {
  const out = [];
  for (let child = element ? element.firstElementChild : null; child; child = child.nextElementSibling)
    out.push(child);
  return out;
};

/** First child element with this local name. */
const child = (element, local) => {
  for (let node = element ? element.firstElementChild : null; node; node = node.nextElementSibling)
    if (node.localName === local) return node;
  return null;
};

/** First descendant with this local name (bounded walk). */
const descendant = (element, local, budget = { count: 0 }) => {
  for (let node = element ? element.firstElementChild : null; node; node = node.nextElementSibling) {
    budget.count += 1;
    if (budget.count > 5000) return null;
    if (node.localName === local) return node;
    const found = descendant(node, local, budget);
    if (found) return found;
  }
  return null;
};

/** On/off property: `<w:b/>` is on, `w:val="0|false|off|none"` is off. */
const isOn = (element) => {
  if (!element) return false;
  const value = attr(element, 'val');
  return value === null || !/^(0|false|off|none)$/i.test(value);
};

/**
 * Relationship map of a `.rels` part.
 * @param {Document|null} doc - Parsed relationships part.
 * @returns {Map<string, { type: string, target: string, external: boolean }>} By id.
 */
const readRels = (doc) => {
  const rels = new Map();
  if (!doc) return rels;
  for (const rel of childrenOf(doc.documentElement)) {
    if (rel.localName !== 'Relationship') continue;
    const id = attr(rel, 'Id');
    if (!id) continue;
    rels.set(id, {
      type: attr(rel, 'Type') || '',
      target: attr(rel, 'Target') || '',
      external: /^external$/i.test(attr(rel, 'TargetMode') || ''),
    });
  }
  return rels;
};

/**
 * Paragraph and character styles.
 * @param {Document|null} doc - Parsed styles part.
 * @returns {Map<string, { name: string, basedOn: string|null, outline: number|null, numId: string|null, ilvl: number, bold: boolean, italic: boolean }>} By style id.
 */
const readStyles = (doc) => {
  const styles = new Map();
  if (!doc) return styles;
  for (const style of childrenOf(doc.documentElement)) {
    if (style.localName !== 'style') continue;
    const id = attr(style, 'styleId');
    if (!id) continue;
    const pPr = child(style, 'pPr');
    const rPr = child(style, 'rPr');
    const numPr = child(pPr, 'numPr');
    const outline = attr(child(pPr, 'outlineLvl'), 'val');
    styles.set(id, {
      name: String(attr(child(style, 'name'), 'val') || '').toLowerCase(),
      basedOn: attr(child(style, 'basedOn'), 'val'),
      outline: outline !== null && /^\d$/.test(outline) ? Number(outline) : null,
      numId: numPr ? attr(child(numPr, 'numId'), 'val') : null,
      ilvl: numPr ? Number(attr(child(numPr, 'ilvl'), 'val')) || 0 : 0,
      bold: isOn(child(rPr, 'b')),
      italic: isOn(child(rPr, 'i')),
    });
  }
  return styles;
};

/**
 * List definitions: per numId and level, ordered or not and the start number.
 * @param {Document|null} doc - Parsed numbering part.
 * @returns {(numId: string, ilvl: number) => { ordered: boolean, start: number }} Lookup.
 */
const readNumbering = (doc) => {
  const abstracts = new Map();
  const nums = new Map();
  if (doc) {
    for (const node of childrenOf(doc.documentElement)) {
      if (node.localName === 'abstractNum') {
        const levels = new Map();
        for (const lvl of childrenOf(node)) {
          if (lvl.localName !== 'lvl') continue;
          const format = attr(child(lvl, 'numFmt'), 'val') || 'decimal';
          levels.set(Number(attr(lvl, 'ilvl')) || 0, {
            ordered: !/^(bullet|none)$/i.test(format),
            start: Number(attr(child(lvl, 'start'), 'val')) || 1,
          });
        }
        abstracts.set(attr(node, 'abstractNumId'), levels);
      } else if (node.localName === 'num') {
        const overrides = new Map();
        for (const override of childrenOf(node)) {
          if (override.localName !== 'lvlOverride') continue;
          const start = attr(child(override, 'startOverride'), 'val');
          if (start !== null) overrides.set(Number(attr(override, 'ilvl')) || 0, Number(start) || 1);
        }
        nums.set(attr(node, 'numId'), { abstract: attr(child(node, 'abstractNumId'), 'val'), overrides });
      }
    }
  }
  return (numId, ilvl) => {
    const num = nums.get(numId);
    const level = num && abstracts.get(num.abstract) ? abstracts.get(num.abstract).get(ilvl) : null;
    const start = num && num.overrides.has(ilvl) ? num.overrides.get(ilvl) : level ? level.start : 1;
    // Without a definition Word shows a bullet.
    return { ordered: level ? level.ordered : false, start };
  };
};

const HEADING_NAME = /^heading ([1-9])$/;
const MONOSPACE = /consolas|courier|menlo|monaco|mono|source code/i;
const QUOTE_NAMES = new Set(['quote', 'intense quote']);
const CODE_NAMES = new Set(['code', 'html preformatted', 'source code', 'macro text']);

/**
 * Walks a style and its `basedOn` chain (bounded) and returns the first non-null result.
 * @param {Map<string, object>} styles - Styles.
 * @param {string|null} id - Style id.
 * @param {(style: object) => any} pick - Picker.
 * @returns {any} First result, or null.
 */
const fromStyle = (styles, id, pick) => {
  let current = id;
  for (let step = 0; current && step < 12; step += 1) {
    const style = styles.get(current);
    if (!style) return null;
    const value = pick(style);
    if (value !== null && value !== undefined) return value;
    current = style.basedOn;
  }
  return null;
};

/** Safe link target: absolute http(s) or mailto only (the sanitiser checks it again). */
const linkTarget = (target) => {
  const value = String(target || '').trim();
  return /^(https?:\/\/|mailto:)/i.test(value) && value.length <= 2048 ? value : null;
};

/** Target of a HYPERLINK field instruction, without `\l` bookmark-only fields. */
const fieldLink = (instruction) => {
  const match = /^\s*HYPERLINK\s+"([^"]*)"/i.exec(instruction);
  return match ? linkTarget(match[1]) : null;
};

/**
 * Wraps text with the marks of a run (innermost first, same order the editor writes).
 * @param {string} html - Escaped text.
 * @param {object} marks - Mark flags.
 * @returns {string} HTML.
 */
const wrapMarks = (html, marks) => {
  let out = html;
  if (marks.sup) out = `<sup>${out}</sup>`;
  else if (marks.sub) out = `<sub>${out}</sub>`;
  if (marks.code) out = `<code>${out}</code>`;
  if (marks.strike) out = `<s>${out}</s>`;
  if (marks.underline) out = `<u>${out}</u>`;
  if (marks.italic) out = `<i>${out}</i>`;
  if (marks.bold) out = `<b>${out}</b>`;
  if (marks.mark) out = `<mark>${out}</mark>`;
  return out;
};

const escapeAttribute = (value) => escapeText(value).replace(/"/g, '&quot;');

/**
 * Creates the reader for one document.
 * @param {{ rels: Map<string, object>, styles: Map<string, object>, numbering: Function, imageLabel: (alt: string) => string, collect?: boolean, folder?: string }} env - Parts; `collect` keeps pictures as their own fragments (2.13), `folder` is the main part's folder.
 * @returns {{ body: (element: Element) => { fragments: Array<string|{ image: number }>, images: number, media: Array<object>, skipped: Record<string, number>, truncated: boolean } }} Reader.
 */
const createReader = ({ rels, styles, numbering, imageLabel, collect = false, folder = '' }) => {
  const report = { images: 0, skipped: {}, truncated: false };
  // 2.13: pictures found while reading (`collect`), in document order.
  const media = [];

  /** Alt text of a picture: DrawingML `docPr` description or title, VML shape `alt`. */
  const imageAlt = (node) => {
    const properties = descendant(node, 'docPr');
    const shape = properties ? null : descendant(node, 'shape');
    return String(attr(properties, 'descr') || attr(properties, 'title') || attr(shape, 'alt') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  };

  /**
   * Package part of a picture, or the reason it cannot be imported.
   * @param {Element} node - `w:drawing`, `w:pict` or `w:object`.
   * @returns {{ part: string|null, reason: string|null }} Part path or reason.
   */
  const imageSource = (node) => {
    // An embedded OLE object (chart, equation, other program) shows only a preview picture.
    if (node.localName === 'object') return { part: null, reason: 'embedded' };
    const blip = node.localName === 'drawing' ? descendant(node, 'blip') : descendant(node, 'imagedata');
    if (!blip) return { part: null, reason: 'unsupported' };
    const id = relAttr(blip, node.localName === 'drawing' ? 'embed' : 'id');
    if (!id) return { part: null, reason: relAttr(blip, 'link') ? 'linked' : 'unsupported' };
    const rel = rels.get(id);
    if (!rel || !REL_IMAGE.test(rel.type)) return { part: null, reason: 'unsupported' };
    if (rel.external) return { part: null, reason: 'linked' };
    return { part: resolvePart(folder, rel.target), reason: null };
  };

  /** Placeholder HTML of a collected picture that cannot stand on its own (in a list, table or link text). */
  const placeholderOf = (index) => {
    const item = media[index];
    if (!item) return '';
    if (!item.reason) item.reason = 'position';
    item.placeholder = true;
    return `<i>${escapeText(imageLabel(item.alt))}</i>`;
  };
  const skip = (reason) => {
    report.skipped[reason] = (report.skipped[reason] || 0) + 1;
  };
  // Complex fields (fldChar begin/separate/end) may span paragraphs; their state is document-wide.
  const fields = [];

  /** Character style marks (Strong, Emphasis and styles with bold/italic). */
  const styleMarks = (id) => ({
    bold: Boolean(fromStyle(styles, id, (s) => (s.name === 'strong' || s.bold ? true : null))),
    italic: Boolean(fromStyle(styles, id, (s) => (s.name === 'emphasis' || s.italic ? true : null))),
  });

  /** Marks of a run's properties. */
  const runMarks = (rPr) => {
    if (!rPr) return {};
    const style = attr(child(rPr, 'rStyle'), 'val');
    const fromCharStyle = style ? styleMarks(style) : {};
    const underline = child(rPr, 'u');
    const vertical = attr(child(rPr, 'vertAlign'), 'val');
    const highlight = child(rPr, 'highlight');
    const fonts = child(rPr, 'rFonts');
    return {
      code: Boolean(fonts && MONOSPACE.test(attr(fonts, 'ascii') || attr(fonts, 'hAnsi') || '')),
      bold: child(rPr, 'b') ? isOn(child(rPr, 'b')) : fromCharStyle.bold,
      italic: child(rPr, 'i') ? isOn(child(rPr, 'i')) : fromCharStyle.italic,
      underline: Boolean(underline && isOn(underline)),
      strike: isOn(child(rPr, 'strike')) || isOn(child(rPr, 'dstrike')),
      sup: vertical === 'superscript',
      sub: vertical === 'subscript',
      mark: Boolean(highlight && isOn(highlight)),
    };
  };

  /** Inside the instruction part of a field: run text is the field code, not content. */
  const inInstruction = () => fields.some((field) => field.phase === 'instruction');

  /**
   * HTML of one run.
   * @param {Element} run - `w:r`.
   * @param {{ html: string }} out - Paragraph output buffer.
   * @param {boolean} code - Code paragraph (marks are not written).
   */
  const readRun = (run, out, code) => {
    const marks = code ? {} : runMarks(child(run, 'rPr'));
    let text = '';
    const flushText = () => {
      if (text) out.html += wrapMarks(escapeText(text), marks);
      text = '';
    };
    for (const node of childrenOf(run)) {
      switch (node.localName) {
        case 'fldChar': {
          flushText();
          const type = attr(node, 'fldCharType');
          if (type === 'begin') fields.push({ phase: 'instruction', instruction: '', link: null, start: -1 });
          else if (type === 'separate' && fields.length) {
            const field = fields[fields.length - 1];
            field.phase = 'result';
            field.link = fieldLink(field.instruction);
            field.out = out;
            field.start = out.html.length;
          } else if (type === 'end' && fields.length) {
            const field = fields.pop();
            if (field.link && field.out === out && field.start >= 0 && out.html.length > field.start) {
              const inner = out.html.slice(field.start);
              out.html = `${out.html.slice(0, field.start)}<a href="${escapeAttribute(field.link)}">${inner}</a>`;
            }
          }
          break;
        }
        case 'instrText':
          if (fields.length) fields[fields.length - 1].instruction += node.textContent || '';
          break;
        case 't':
          if (!inInstruction()) text += node.textContent || '';
          break;
        case 'tab':
        case 'ptab':
          if (!inInstruction()) text += ' ';
          break;
        case 'noBreakHyphen':
          if (!inInstruction()) text += '-';
          break;
        case 'br':
        case 'cr': {
          const type = attr(node, 'type');
          if (inInstruction() || type === 'page' || type === 'column') break;
          flushText();
          out.html += '<br>';
          break;
        }
        case 'drawing':
        case 'pict':
        case 'object': {
          if (inInstruction()) break;
          flushText();
          const alt = imageAlt(node);
          report.images += 1;
          if (!collect) {
            out.html += `<i>${escapeText(imageLabel(alt))}</i>`;
            break;
          }
          const index = media.length;
          media.push({ index, alt, ...imageSource(node) });
          out.html += `\u0000${index}\u0000`;
          break;
        }
        default:
          break;
      }
    }
    flushText();
  };

  /**
   * Inline content of a paragraph or a container inside it.
   * @param {Element} element - Paragraph or inline container.
   * @param {{ html: string }} out - Output buffer.
   * @param {boolean} code - Code paragraph.
   * @param {number} depth - Nesting.
   */
  const readInline = (element, out, code, depth) => {
    if (depth > DOCX_LIMITS.maxDepth) return;
    for (const node of childrenOf(element)) {
      switch (node.localName) {
        case 'r':
          readRun(node, out, code);
          break;
        case 'hyperlink': {
          const rel = rels.get(relAttr(node, 'id') || '');
          const href = rel && rel.external && REL_HYPERLINK.test(rel.type) ? linkTarget(rel.target) : null;
          if (!href || code) {
            readInline(node, out, code, depth + 1);
            break;
          }
          const inner = { html: '' };
          readInline(node, inner, code, depth + 1);
          if (inner.html) out.html += `<a href="${escapeAttribute(href)}">${inner.html}</a>`;
          break;
        }
        case 'fldSimple': {
          const href = code ? null : fieldLink(attr(node, 'instr') || '');
          const inner = { html: '' };
          readInline(node, inner, code, depth + 1);
          out.html +=
            href && inner.html ? `<a href="${escapeAttribute(href)}">${inner.html}</a>` : inner.html;
          break;
        }
        case 'ins':
        case 'moveTo':
        case 'smartTag':
        case 'customXml':
        case 'dir':
        case 'bdo':
          readInline(node, out, code, depth + 1);
          break;
        case 'sdt':
          readInline(child(node, 'sdtContent') || node, out, code, depth + 1);
          break;
        default:
          // del, moveFrom (deleted text), pPr, bookmarks, comments, proofing marks.
          break;
      }
    }
  };

  /**
   * Reads one paragraph.
   * @param {Element} paragraph - `w:p`.
   * @returns {{ kind: 'heading'|'paragraph'|'quote'|'code'|'list', level?: number, list?: { numId: string, ilvl: number, ordered: boolean, start: number }, html: string, text?: string }} Paragraph.
   */
  const readParagraph = (paragraph) => {
    const pPr = child(paragraph, 'pPr');
    const styleId = attr(child(pPr, 'pStyle'), 'val');
    const styleName = fromStyle(styles, styleId, (s) => s.name || null) || '';
    const numPr = child(pPr, 'numPr');
    let numId = numPr ? attr(child(numPr, 'numId'), 'val') : null;
    let ilvl = numPr ? Number(attr(child(numPr, 'ilvl'), 'val')) || 0 : 0;
    if (numId === null) {
      const fromList = fromStyle(styles, styleId, (s) => (s.numId ? s : null));
      if (fromList) {
        numId = fromList.numId;
        ilvl = fromList.ilvl;
      }
    }
    if (CODE_NAMES.has(styleName)) return { kind: 'code', html: '', text: readPlain(paragraph) };
    const out = { html: '' };
    readInline(paragraph, out, false, 0);
    const direct = attr(child(pPr, 'outlineLvl'), 'val');
    const outline =
      direct !== null && /^\d$/.test(direct) ? Number(direct) : fromStyle(styles, styleId, (s) => s.outline);
    const named = HEADING_NAME.exec(styleName);
    let level = styleName === 'title' ? 1 : named ? Number(named[1]) : outline !== null ? outline + 1 : 0;
    if (level > 6) level = 0;
    if (level) return { kind: 'heading', level, html: out.html };
    if (numId && numId !== '0') {
      const definition = numbering(numId, ilvl);
      return { kind: 'list', list: { numId, ilvl: Math.min(ilvl, 8), ...definition }, html: out.html };
    }
    if (QUOTE_NAMES.has(styleName)) return { kind: 'quote', html: out.html };
    return { kind: 'paragraph', html: out.html };
  };

  /** Plain text of a code paragraph (tabs and breaks kept). */
  const readPlain = (paragraph) => {
    let text = '';
    const walk = (element, depth) => {
      if (depth > DOCX_LIMITS.maxDepth) return;
      for (const node of childrenOf(element)) {
        if (node.localName === 't') text += node.textContent || '';
        else if (node.localName === 'tab') text += '\t';
        else if (node.localName === 'br' || node.localName === 'cr') text += '\n';
        else if (!/^(del|moveFrom|instrText|pPr|rPr)$/.test(node.localName)) walk(node, depth + 1);
      }
    };
    walk(paragraph, 0);
    return text;
  };

  const isBlank = (html) =>
    !html
      .replace(/<(?!br)[^>]+>/g, '')
      .replace(/<br>/g, '')
      .trim();

  /**
   * HTML of a run of list paragraphs (nesting by level, a new list when the numbering changes).
   * @param {Array<{ list: object, html: string }>} items - Consecutive list paragraphs.
   * @returns {string} HTML.
   */
  const listHtml = (items) => {
    let html = '';
    const stack = [];
    const close = () => {
      const top = stack.pop();
      html += `</li></${top.ordered ? 'ol' : 'ul'}>`;
    };
    for (const item of items) {
      const level = item.list.ilvl;
      while (stack.length > level + 1) close();
      if (stack.length === level + 1) {
        const top = stack[stack.length - 1];
        if (top.ordered !== item.list.ordered || (level === 0 && top.numId !== item.list.numId)) close();
        else html += '</li>';
      }
      while (stack.length < level + 1) {
        const depth = stack.length;
        const ordered = depth === level ? item.list.ordered : false;
        const start =
          depth === level && ordered && item.list.start !== 1 ? ` start="${item.list.start}"` : '';
        html += `<${ordered ? 'ol' : 'ul'}${start}>`;
        stack.push({ ordered, numId: item.list.numId });
        if (stack.length < level + 1) html += '<li>';
      }
      html += `<li>${item.html}`;
    }
    while (stack.length) close();
    return html;
  };

  /**
   * HTML of a table (header rows, merged cells). Cell content is inline: paragraphs are joined with line breaks.
   * @param {Element} table - `w:tbl`.
   * @param {number} depth - Nesting.
   * @returns {string} HTML.
   */
  const tableHtml = (table, depth) => {
    const rows = childrenOf(table).filter((node) => node.localName === 'tr');
    const grid = [];
    const header = [];
    const body = [];
    let headerOpen = true;
    rows.forEach((row) => {
      const trPr = child(row, 'trPr');
      const isHeader = headerOpen && Boolean(trPr && isOn(child(trPr, 'tblHeader')));
      if (!isHeader) headerOpen = false;
      const cells = [];
      let column = Number(attr(child(trPr, 'gridBefore'), 'val')) || 0;
      for (const cell of childrenOf(row)) {
        if (cell.localName !== 'tc') continue;
        const tcPr = child(cell, 'tcPr');
        const span = Math.min(Math.max(Number(attr(child(tcPr, 'gridSpan'), 'val')) || 1, 1), 64);
        const vMerge = child(tcPr, 'vMerge');
        const merge = vMerge ? attr(vMerge, 'val') || 'continue' : null;
        if (merge === 'continue' && grid[column]) {
          grid[column].rowspan += 1;
          column += span;
          continue;
        }
        const lines = [];
        for (const node of childrenOf(cell)) {
          if (node.localName === 'p') {
            const paragraph = readParagraph(node);
            const html = paragraph.kind === 'code' ? escapeText(paragraph.text) : paragraph.html;
            if (!isBlank(html))
              lines.push(
                paragraph.kind === 'heading'
                  ? `<b>${html}</b>`
                  : paragraph.kind === 'list'
                    ? `• ${html}`
                    : html
              );
          } else if (node.localName === 'tbl' && depth < DOCX_LIMITS.maxDepth) {
            // A nested table becomes its rows as text lines.
            for (const inner of node.getElementsByTagNameNS('*', 'tr')) {
              const text = (inner.textContent || '').trim();
              if (text) lines.push(escapeText(text));
            }
          }
        }
        let html = lines.join('<br>');
        // A header cell that is bold as a whole: the header row is bold anyway.
        if (isHeader && /^<b>(?:(?!<\/?b>).)*<\/b>$/.test(html)) html = html.slice(3, -4);
        const entry = { html, colspan: span, rowspan: 1 };
        cells.push(entry);
        for (let offset = 0; offset < span; offset += 1)
          grid[column + offset] = merge === 'restart' ? entry : null;
        column += span;
      }
      (isHeader ? header : body).push({ cells, isHeader });
    });
    const cellHtml = (cell, tag) =>
      `<${tag}${cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''}${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}>${cell.html}</${tag}>`;
    const rowsHtml = (list, tag) =>
      list.map((row) => `<tr>${row.cells.map((cell) => cellHtml(cell, tag)).join('')}</tr>`).join('');
    // A rowspan from the header into the body is cut at the header (htmlToBlocks ends it with its row group).
    return `<table>${header.length ? `<thead>${rowsHtml(header, 'th')}</thead>` : ''}<tbody>${rowsHtml(body, 'td')}</tbody></table>`;
  };

  const isTocControl = (sdt) => {
    const gallery = descendant(child(sdt, 'sdtPr'), 'docPartGallery');
    return Boolean(gallery && /table of contents/i.test(attr(gallery, 'val') || ''));
  };

  /**
   * Reads the body into top-level HTML fragments.
   * @param {Element} body - `w:body`.
   * @returns {{ fragments: Array<string|{ image: number }>, images: number, media: Array<object>, skipped: Record<string, number>, truncated: boolean }} Result.
   */
  const body = (element) => {
    const fragments = [];
    let list = [];
    let code = [];
    const push = (html) => {
      if (fragments.length >= DOCX_LIMITS.maxFragments) {
        report.truncated = true;
        return;
      }
      // A picture inside a list, a table or a link stays a placeholder (blocks cannot nest there).
      fragments.push(
        typeof html === 'string' && html.includes('\u0000')
          ? html.replace(IMAGE_MARK, (_, index) => placeholderOf(Number(index)))
          : html
      );
    };
    /**
     * Pushes a paragraph, heading or quote; collected pictures in it become their own fragments
     * (the text before and after stays in the block type).
     * @param {string} html - Inline HTML.
     * @param {(inner: string) => string} wrap - Block wrapper.
     */
    const pushSplit = (html, wrap) => {
      if (!html.includes('\u0000')) {
        push(wrap(html));
        return;
      }
      // Split only outside links (text is escaped, so `<a ` and `</a>` are this module's own tags);
      // a picture inside link text stays a placeholder (push replaces its mark).
      let depth = 0;
      let last = 0;
      const flush = (end) => {
        const part = html.slice(last, end);
        // A mark left in the part (inside link text) counts as content.
        if (!isBlank(part.replace(IMAGE_MARK, 'x'))) push(wrap(part));
      };
      // eslint-disable-next-line no-control-regex -- U+0000 is the picture mark on purpose (see IMAGE_MARK)
      for (const match of html.matchAll(/<a\s|<\/a>|\u0000(\d+)\u0000/g)) {
        if (match[0] === '</a>') depth = Math.max(0, depth - 1);
        else if (match[1] === undefined) depth += 1;
        else if (depth === 0) {
          flush(match.index);
          push({ image: Number(match[1]) });
          last = match.index + match[0].length;
        }
      }
      flush(html.length);
    };
    const flushList = () => {
      if (list.length) push(listHtml(list));
      list = [];
    };
    const flushCode = () => {
      if (code.length) push(`<pre><code>${escapeText(code.join('\n'))}</code></pre>`);
      code = [];
    };
    const walk = (container, depth) => {
      if (depth > DOCX_LIMITS.maxDepth) {
        skip('too-deep');
        return;
      }
      for (const node of childrenOf(container)) {
        if (report.truncated) return;
        switch (node.localName) {
          case 'p': {
            const paragraph = readParagraph(node);
            if (paragraph.kind === 'code') {
              flushList();
              code.push(paragraph.text);
              break;
            }
            flushCode();
            if (paragraph.kind === 'list') {
              if (!isBlank(paragraph.html)) list.push(paragraph);
              break;
            }
            flushList();
            if (isBlank(paragraph.html)) break;
            if (paragraph.kind === 'heading')
              pushSplit(paragraph.html, (inner) => `<h${paragraph.level}>${inner}</h${paragraph.level}>`);
            else if (paragraph.kind === 'quote')
              pushSplit(paragraph.html, (inner) => `<blockquote><p>${inner}</p></blockquote>`);
            else pushSplit(paragraph.html, (inner) => `<p>${inner}</p>`);
            break;
          }
          case 'tbl':
            flushList();
            flushCode();
            push(tableHtml(node, depth + 1));
            break;
          case 'sdt':
            if (isTocControl(node)) {
              flushList();
              flushCode();
              skip('toc');
              break;
            }
            walk(child(node, 'sdtContent') || node, depth + 1);
            break;
          case 'customXml':
          case 'ins':
          case 'moveTo':
            walk(node, depth + 1);
            break;
          default:
            // sectPr, bookmarks, del, altChunk (embedded foreign content) are left out.
            if (node.localName === 'altChunk') skip('embedded');
            break;
        }
      }
    };
    walk(element, 0);
    flushList();
    flushCode();
    // Pictures whose fragment was cut by the fragment limit are not imported.
    const kept = new Set(fragments.filter((item) => typeof item === 'object').map((item) => item.image));
    for (const item of media) if (!kept.has(item.index) && !item.placeholder) item.reason = 'truncated';
    return {
      fragments,
      images: report.images,
      media,
      skipped: report.skipped,
      truncated: report.truncated,
    };
  };

  return { body };
};

/** Default placeholder text of an image. */
const defaultImageLabel = (alt) => (alt ? `[Image: ${alt}]` : '[Image]');

/**
 * Reads the pictures the reader collected (2.13): checks the limits, inflates
 * each different part once through the bounded ZIP reader and detects the type
 * by signature. Fills `bytes`, `mime`, `size`, `name` or `reason` in place.
 * @param {Array<object>} media - Collected pictures (`part`, `reason`).
 * @param {(entry: object) => Promise<Uint8Array>} inflate - Bounded inflate of one ZIP entry.
 * @param {Map<string, object>} byName - ZIP entries by name.
 * @param {Partial<typeof DOCX_IMAGE_LIMITS>} [limits] - Overrides (the dialog passes the server's image size).
 * @returns {Promise<void>}
 * @throws {ImportError} Codes of `inflateEntry` (a corrupt part fails the whole file, like any other part).
 */
const readImages = async (media, inflate, byName, limits = {}) => {
  const max = { ...DOCX_IMAGE_LIMITS, ...limits };
  const parts = new Map();
  let count = 0;
  let total = 0;
  for (const item of media) {
    if (!item.part || item.reason) continue;
    let found = parts.get(item.part);
    if (!found) {
      const entry = byName.get(item.part);
      const name = item.part.slice(item.part.lastIndexOf('/') + 1).slice(0, 120);
      if (!entry) found = { reason: 'unsupported' };
      else if (VECTOR_EXTENSION.test(name)) found = { reason: 'format', name };
      else if (entry.size > max.maxImageBytes) found = { reason: 'too-large', name, size: entry.size };
      else if (count >= max.maxImages || total + entry.size > max.maxTotalBytes)
        found = { reason: 'limit', name, size: entry.size };
      else {
        const data = await inflate(entry);
        const mime = sniffImageType(data);
        if (!mime) found = { reason: 'format', name };
        else {
          count += 1;
          total += data.length;
          found = { reason: null, name, mime, size: data.length, bytes: data };
        }
      }
      parts.set(item.part, found);
    }
    Object.assign(item, found);
  }
};

/**
 * Reads a .docx file into HTML fragments.
 * @param {Uint8Array} bytes - File bytes.
 * @param {{ parseXml: (xml: string) => Document, imageLabel?: (alt: string) => string, pause?: () => Promise<void>, limits?: object, images?: 'placeholder'|'collect', imageLimits?: Partial<typeof DOCX_IMAGE_LIMITS> }} options - XML parser (DOMParser), placeholder text, a pause between steps (keeps the page responsive), limit overrides for tests; `images: 'collect'` (2.13) returns pictures as fragments plus `media`.
 * @returns {Promise<{ fragments: Array<string|{ image: number }>, images: number, media: Array<{ index: number, alt: string, part: string|null, reason: string|null, name?: string, mime?: string, size?: number, bytes?: Uint8Array }>, skipped: Record<string, number>, truncated: boolean }>} Result; `media` is empty without `collect`.
 * @throws {ImportError} Codes of `zip.mjs` plus `NOT_DOCX`, `XML_TOO_LARGE`, `XML_INVALID`.
 */
export const docxToHtml = async (bytes, options) => {
  const {
    parseXml,
    imageLabel = defaultImageLabel,
    pause,
    limits,
    images = 'placeholder',
    imageLimits,
  } = options || {};
  const collect = images === 'collect';
  if (typeof parseXml !== 'function') throw new TypeError('docxToHtml needs parseXml');
  const directory = readZipDirectory(bytes, limits);
  const byName = new Map(directory.entries.map((entry) => [entry.name, entry]));
  const read = async (name) => {
    const entry = byName.get(name);
    if (!entry) return null;
    const data = await inflateEntry(bytes, entry, { ...(limits || {}), pause });
    if (pause) await pause();
    return parsePart(data, parseXml);
  };
  const packageRels = readRels(await read('_rels/.rels'));
  let mainPath = 'word/document.xml';
  for (const rel of packageRels.values())
    if (MAIN_TYPE.test(rel.type) && !rel.external) mainPath = resolvePart('', rel.target);
  if (!byName.has(mainPath)) throw new ImportError('NOT_DOCX');
  const folder = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';
  const relsPath = `${folder}_rels/${mainPath.slice(folder.length)}.rels`;
  const rels = readRels(await read(relsPath));
  const partOf = (pattern, fallback) => {
    for (const rel of rels.values())
      if (pattern.test(rel.type) && !rel.external) return resolvePart(folder, rel.target);
    return fallback;
  };
  const styles = readStyles(await read(partOf(REL_STYLES, `${folder}styles.xml`)));
  const numbering = readNumbering(await read(partOf(REL_NUMBERING, `${folder}numbering.xml`)));
  const main = await read(mainPath);
  const bodyElement = child(main.documentElement, 'body');
  if (main.documentElement.localName !== 'document' || !bodyElement) throw new ImportError('NOT_DOCX');
  const reader = createReader({ rels, styles, numbering, imageLabel, collect, folder });
  const result = reader.body(bodyElement);
  if (collect && result.media.length)
    await readImages(
      result.media,
      async (entry) => {
        const data = await inflateEntry(bytes, entry, { ...(limits || {}), pause });
        if (pause) await pause();
        return data;
      },
      byName,
      imageLimits
    );
  return result;
};

/**
 * "Import file…" (2.11): a Word (.docx) or Markdown (.md, .markdown) file to
 * Editor.js blocks. The caller (the import dialog) passes the parsers of its
 * environment and then sanitises the blocks like a paste (the editor's
 * `prepareEditorValue`), checks them against the field preset and inserts
 * them through the normal change path.
 *
 * - Word: `docx.mjs` (bounded ZIP reader, DOCTYPE refusal) produces HTML
 *   fragments, which `htmlToBlocks` converts in chunks of at most
 *   `HTML_CHUNK` characters, with a pause between chunks.
 * - Markdown: strict UTF-8, then `markdownToBlocks` (with its 2.7.7 depth
 *   guard).
 * - Images are never fetched or uploaded here: each one becomes a visible
 *   placeholder paragraph (`imageLabel`) and is counted, so the editor sees
 *   where to add it. 2.13: with `images: 'collect'` a Word picture's
 *   placeholder is listed in `report.media` with its bytes (read in memory
 *   from the file, see `docx.mjs`) or the reason it stays a placeholder; the
 *   import dialog shows the pictures as a preview and uploads them only when
 *   the user confirms, then replaces the placeholders with image blocks.
 *
 * Runs on the main thread: DOMParser, which the Word reader needs, is not
 * available in Web Workers. The limits keep each synchronous step short, and
 * `pause` yields between steps.
 */

import { htmlToBlocks } from './html.mjs';
import { MAX_MARKDOWN_LENGTH, markdownToBlocks } from './markdown.mjs';
import { escapeText, withIds } from './common.mjs';
import { DOCX_IMAGE_LIMITS, DOCX_IMAGE_TYPES, docxToHtml } from './docx.mjs';
import { ImportError, ZIP_LIMITS } from './zip.mjs';

export { DOCX_IMAGE_LIMITS, DOCX_IMAGE_TYPES, ImportError, ZIP_LIMITS };

/** Largest file the import reads (bytes). */
export const MAX_IMPORT_BYTES = ZIP_LIMITS.maxFileBytes;
/** Largest Markdown file (bytes); the Markdown converter reads at most 5 Mi characters. */
export const MAX_MARKDOWN_BYTES = MAX_MARKDOWN_LENGTH;
/** HTML handed to `htmlToBlocks` at once (characters). */
export const HTML_CHUNK = 256 * 1024;
/** `accept` attribute of the file input. */
export const IMPORT_ACCEPT =
  '.docx,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown';

/**
 * Kind of an import file by its name.
 * @param {string} name - File name.
 * @returns {'docx'|'markdown'|null} Kind, or null when the type is not supported.
 */
export const importKindOf = (name) => {
  const value = String(name || '').toLowerCase();
  if (value.endsWith('.docx')) return 'docx';
  if (value.endsWith('.md') || value.endsWith('.markdown')) return 'markdown';
  return null;
};

const defaultImageLabel = (alt) => (alt ? `[Image: ${alt}]` : '[Image]');

/** Placeholder paragraph for an image block that is not imported. */
const placeholder = (label) => ({ type: 'paragraph', data: { text: `<i>${escapeText(label)}</i>` } });

/** Counts skipped entries by reason into a plain object. */
const addSkipped = (target, skipped) => {
  for (const entry of skipped || []) {
    const key = entry.reason || 'unsupported';
    target[key] = (target[key] || 0) + (entry.count || 1);
  }
};

/**
 * Converts an import file into blocks.
 * @param {{ name: string, bytes: Uint8Array }} file - File name and content.
 * @param {{ parseXml: (xml: string) => Document, parseHtml: (html: string) => Array<object>, imageLabel?: (alt: string) => string, pause?: () => Promise<void>, images?: 'placeholder'|'collect', imageLimits?: Partial<typeof DOCX_IMAGE_LIMITS> }} options - Parsers (browser: DOMParser for XML, `parseHtmlWithDom` for HTML), image placeholder text, a pause between steps; `images: 'collect'` (2.13, Word only) lists the pictures in `report.media`.
 * @returns {Promise<{ kind: 'docx'|'markdown', blocks: Array<{ id: string, type: string, data: object }>, report: { images: number, media: Array<{ blockId: string, alt: string, reason: string|null, name?: string, mime?: string, size?: number, bytes?: Uint8Array, key: string }>, skipped: Record<string, number>, truncated: boolean } }>} Unsanitised blocks (the caller sanitises) and what was left out. `media[].blockId` is the id of the picture's placeholder block; `key` is equal for the same picture used twice.
 * @throws {ImportError} `UNSUPPORTED_TYPE`, `FILE_EMPTY`, `FILE_TOO_LARGE`, `TEXT_ENCODING`, `MARKDOWN_TOO_DEEP`, `TOO_LARGE`, and the codes of the Word reader.
 */
export const convertImportFile = async (file, options) => {
  const {
    parseXml,
    parseHtml,
    imageLabel = defaultImageLabel,
    pause,
    images = 'placeholder',
    imageLimits,
  } = options || {};
  if (typeof parseHtml !== 'function') throw new TypeError('convertImportFile needs parseHtml');
  const kind = importKindOf(file && file.name);
  if (!kind) throw new ImportError('UNSUPPORTED_TYPE');
  const bytes = file.bytes;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('file.bytes must be a Uint8Array');
  if (!bytes.length) throw new ImportError('FILE_EMPTY');
  const report = { images: 0, media: [], skipped: {}, truncated: false };
  let blocks = [];
  // 2.13: block index of each collected picture's placeholder -> its media entry.
  const pictureAt = new Map();
  let collected = [];
  if (kind === 'docx') {
    if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError('FILE_TOO_LARGE');
    const read = await docxToHtml(bytes, { parseXml, imageLabel, pause, images, imageLimits });
    report.images = read.images;
    report.truncated = read.truncated;
    collected = read.media || [];
    Object.assign(report.skipped, read.skipped);
    let chunk = '';
    const convert = async () => {
      if (!chunk) return;
      const result = htmlToBlocks(chunk, { parse: parseHtml });
      addSkipped(report.skipped, result.report.skipped);
      blocks.push(...result.blocks);
      chunk = '';
      if (pause) await pause();
    };
    for (const fragment of read.fragments) {
      if (typeof fragment === 'object') {
        // A picture: its own placeholder block, replaced by an image block after the upload.
        await convert();
        const item = read.media[fragment.image];
        if (!item) continue;
        pictureAt.set(blocks.length, item);
        blocks.push(placeholder(imageLabel(item.alt)));
        continue;
      }
      if (chunk && chunk.length + fragment.length > HTML_CHUNK) await convert();
      chunk += fragment;
    }
    await convert();
  } else {
    if (bytes.length > MAX_MARKDOWN_BYTES) throw new ImportError('FILE_TOO_LARGE');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ImportError('TEXT_ENCODING');
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const result = markdownToBlocks(text, { parse: parseHtml });
    const reasons = new Set(result.report.skipped.map((entry) => entry.reason));
    if (reasons.has('too-deep')) throw new ImportError('MARKDOWN_TOO_DEEP');
    if (reasons.has('too-large')) throw new ImportError('TOO_LARGE');
    addSkipped(report.skipped, result.report.skipped);
    const images = new Map(
      result.report.images.filter((image) => image.index >= 0).map((image) => [image.index, image])
    );
    report.images = result.report.images.length;
    blocks = result.blocks.map((block, index) => {
      if (!images.has(index)) return block;
      const alt = String((block.data && block.data.file && block.data.file.alt) || '').trim();
      return placeholder(imageLabel(alt));
    });
    // Images that made no block (data: or local sources) still get their placeholder count.
  }
  if (blocks.length > 5000) {
    blocks = blocks.slice(0, 5000);
    report.truncated = true;
  }
  const withId = withIds(blocks, 'imp');
  const placed = new Set();
  for (const [index, item] of pictureAt) {
    if (index >= withId.length) continue;
    placed.add(item);
    report.media.push({
      order: item.index,
      blockId: withId[index].id,
      alt: item.alt,
      reason: item.reason || null,
      key: item.part || `missing-${item.index}`,
      ...(item.name ? { name: item.name } : {}),
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
      ...(item.mime ? { mime: item.mime, bytes: item.bytes } : {}),
    });
  }
  // Pictures without a block of their own (in a list, a table or link text, or cut by a limit)
  // stay placeholders; they are listed so the dialog can say why.
  for (const item of collected)
    if (!placed.has(item))
      report.media.push({
        order: item.index,
        blockId: null,
        alt: item.alt,
        reason: item.reason || 'position',
        key: item.part || `missing-${item.index}`,
      });
  // Document order; `order` is internal.
  report.media = report.media.sort((a, b) => a.order - b.order).map(({ order: _order, ...item }) => item);
  return { kind, blocks: withId, report };
};

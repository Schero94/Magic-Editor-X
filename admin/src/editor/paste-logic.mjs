/**
 * Decisions of the paste cleanup (admin/src/editor/paste.js) without DOM or
 * Editor.js, so they can be unit tested: when a paste is converted, which
 * blocks a field accepts and how disallowed blocks fall back.
 */

import { escapeHtml } from '../../../shared/editor-data.mjs';
import { looksLikeMarkdown } from '../../../shared/convert/markdown.mjs';

/** Blocks whose content is code, raw HTML or table cells: pastes there stay untouched. */
export const PROTECTED_TOOLS = Object.freeze(['code', 'codeFlask', 'raw', 'table', 'math']);

/** Media types the editor uploads from pasted `data:` images. */
export const PASTE_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

/** Largest pasted `data:` image that is uploaded (bytes). */
export const MAX_PASTED_IMAGE_BYTES = 5 * 1024 * 1024;

/** Most remote images uploaded from one paste. */
export const MAX_REMOTE_IMAGES = 10;

/** Most pasted videos and audio files copied into the Media Library from one paste (2.4). */
export const MAX_REMOTE_MEDIA = 3;

/** Largest clipboard content that is converted (characters). */
export const MAX_PASTE_LENGTH = 2 * 1024 * 1024;

const OFFICE =
  /urn:schemas-microsoft-com:office|class="?Mso|mso-[a-z-]+\s*:|docs-internal-guid|<meta[^>]+content="?LibreOffice|<meta[^>]+name="?generator"?[^>]+(?:Word|LibreOffice|OpenOffice|Google)/i;
const BLOCK_TAG = /<(p|h[1-6]|ul|ol|table|blockquote|pre|hr|figure|img|li|div)\b/gi;

/**
 * Tells whether clipboard HTML comes from an office suite (Word, Google Docs, LibreOffice).
 * @param {string} html - Clipboard HTML.
 * @returns {boolean} Result.
 */
export const isOfficeHtml = (html) => typeof html === 'string' && OFFICE.test(html.slice(0, 20000));

/**
 * True when clipboard HTML contains a `<video>` or `<audio>` element (2.4).
 * @param {string} html - Clipboard HTML.
 * @returns {boolean} Result.
 */
export const hasMediaTags = (html) => typeof html === 'string' && /<(?:video|audio)\b/i.test(html);

/**
 * Data of a pasted video or audio block (2.4) from the collected element
 * (`htmlToBlocks` `report.media` entry) and the Media Library files copied
 * from its URLs. Tracks whose file could not be copied are left out; at most
 * one track stays the default. The result still goes through the sanitising
 * policy (`prepareEditorValue`).
 * @param {{ kind: 'video'|'audio', title?: string, caption?: string, loop?: boolean, muted?: boolean, tracks?: Array<object> }} entry - Collected element.
 * @param {{ file: object, poster?: object|null, tracks?: Array<object|null> }} files - Copied files (`tracks` in the order of `entry.tracks`, null for failures).
 * @returns {object} Block data.
 */
export const mediaBlockData = (entry, files) => {
  let hasDefault = false;
  const tracks = (entry.tracks || [])
    .map((track, index) => {
      const file = files.tracks && files.tracks[index];
      if (!file) return null;
      const isDefault = Boolean(track.default) && !hasDefault;
      if (isDefault) hasDefault = true;
      return {
        file,
        kind: track.kind,
        srclang: track.srclang || '',
        label: track.label || '',
        ...(isDefault ? { default: true } : {}),
      };
    })
    .filter(Boolean);
  const data = {
    file: files.file,
    title: entry.title || '',
    caption: entry.caption || '',
    loop: Boolean(entry.loop),
    tracks,
  };
  if (entry.kind === 'video') {
    data.muted = Boolean(entry.muted);
    if (files.poster) data.poster = files.poster;
  }
  return data;
};

/**
 * Counts block-level start tags (rough; used only to decide whether to convert).
 * @param {string} html - Clipboard HTML.
 * @param {number} [stopAt=2] - Stop counting at this number.
 * @returns {number} Count, at most `stopAt`.
 */
export const countBlockTags = (html, stopAt = 2) => {
  if (typeof html !== 'string') return 0;
  let count = 0;
  BLOCK_TAG.lastIndex = 0;
  while (count < stopAt && BLOCK_TAG.exec(html)) count += 1;
  return count;
};

/**
 * Decides how a paste is handled.
 * @param {{ html?: string, text?: string, plainOnly?: boolean, protectedTarget?: boolean, hasFiles?: boolean, editorBlocks?: boolean, media?: boolean }} input - Clipboard content and context; `editorBlocks`: the clipboard holds Editor.js blocks (`application/x-editor-js`); `media` (2.4): pasted videos and audio can become blocks, so one `<video>`/`<audio>` is enough to convert.
 * @returns {'html'|'markdown'|'plain'|null} `html`/`markdown` convert into blocks, `plain` inserts plain text, null leaves the paste to Editor.js.
 */
export const decidePaste = ({
  html = '',
  text = '',
  plainOnly = false,
  protectedTarget = false,
  hasFiles = false,
  editorBlocks = false,
  media = false,
}) => {
  if (protectedTarget) return null;
  // Blocks copied from an editor (also another Magic Editor X field) keep their data: Editor.js
  // inserts them itself (math blocks, footnotes and every other block type survive the copy).
  if (editorBlocks && !plainOnly) return null;
  if (plainOnly) return text ? 'plain' : null;
  if (
    html &&
    html.length <= MAX_PASTE_LENGTH &&
    (isOfficeHtml(html) || countBlockTags(html) >= 2 || (media && hasMediaTags(html)))
  )
    return 'html';
  // Files without HTML (a copied image) are handled by the image tool.
  if (!html && !hasFiles && text && text.length <= MAX_PASTE_LENGTH && looksLikeMarkdown(text))
    return 'markdown';
  return null;
};

/**
 * Picks the allowed heading level nearest to `level` (the deeper one on a tie).
 * @param {number} level - Heading level.
 * @param {number[]|undefined} allowed - Allowed levels (empty or missing: all).
 * @returns {number} Level.
 */
export const clampHeadingLevel = (level, allowed) => {
  const levels = Array.isArray(allowed)
    ? allowed.filter((value) => Number.isInteger(value) && value >= 1 && value <= 6)
    : [];
  if (!levels.length || levels.includes(level)) return level;
  return levels.reduce((best, candidate) => {
    const distance = Math.abs(candidate - level);
    const bestDistance = Math.abs(best - level);
    return distance < bestDistance || (distance === bestDistance && candidate > best) ? candidate : best;
  });
};

const flattenListItems = (items, depth = 0) =>
  depth > 12 || !Array.isArray(items)
    ? []
    : items.flatMap((item) =>
        typeof item === 'string'
          ? [item]
          : [String((item && item.content) || ''), ...flattenListItems(item && item.items, depth + 1)]
      );

const paragraph = (text) => ({ type: 'paragraph', data: { text } });

/**
 * Turns a block the field does not accept into paragraphs (or nothing for
 * media and delimiters).
 * @param {{ type: string, data: object }} block - Block.
 * @param {(type: string) => boolean} isAllowed - Accepted block types.
 * @returns {Array<{ type: string, data: object }>} Replacement blocks.
 */
const fallback = (block, isAllowed) => {
  const data = block.data || {};
  switch (block.type) {
    case 'header':
    case 'quote':
      return data.text ? [paragraph(data.text)] : [];
    case 'checklist':
      if (isAllowed('list'))
        return [
          {
            type: 'list',
            data: {
              style: 'unordered',
              meta: {},
              items: (data.items || []).map((item) => ({ content: item.text || '', meta: {}, items: [] })),
            },
          },
        ];
      return (data.items || []).map((item) => paragraph(item.text || '')).filter((item) => item.data.text);
    case 'list':
      return flattenListItems(data.items).filter(Boolean).map(paragraph);
    case 'code':
    case 'codeFlask':
      if (block.type === 'codeFlask' && isAllowed('code'))
        return [{ type: 'code', data: { code: data.code || '' } }];
      return data.code ? [paragraph(escapeHtml(data.code).replace(/\n/g, '<br>'))] : [];
    case 'table':
      return (data.content || [])
        .filter((row) => Array.isArray(row) && row.some((cell) => String(cell).trim()))
        .map((row) => paragraph(row.join(' | ')));
    default:
      return [];
  }
};

/**
 * Applies a field's block rules to converted blocks: disallowed types fall back
 * to allowed ones, heading levels are moved to the nearest allowed level.
 * Paragraphs are always allowed.
 * @param {Array<{ type: string, data: object }>} blocks - Converted blocks.
 * @param {{ isAllowed?: (type: string) => boolean, allowedHeadingLevels?: number[] }} [rules] - Field rules.
 * @returns {{ blocks: Array<{ type: string, data: object }>, dropped: number }} Accepted blocks and how many could not be kept.
 */
export const filterBlocks = (blocks, rules = {}) => {
  const isAllowed = (type) =>
    type === 'paragraph' || typeof rules.isAllowed !== 'function' || rules.isAllowed(type) === true;
  const out = [];
  let dropped = 0;
  for (const block of blocks || []) {
    if (!block || typeof block.type !== 'string') continue;
    if (isAllowed(block.type)) {
      if (block.type === 'header') {
        const level = clampHeadingLevel(block.data.level, rules.allowedHeadingLevels);
        out.push(level === block.data.level ? block : { ...block, data: { ...block.data, level } });
      } else out.push(block);
      continue;
    }
    const replacement = fallback(block, isAllowed).filter((item) => isAllowed(item.type));
    if (!replacement.length) dropped += 1;
    out.push(...replacement);
  }
  return { blocks: out, dropped };
};

/**
 * Reads a `data:` image URL into bytes when its type and size are allowed.
 * @param {string} src - `data:` URL.
 * @returns {{ type: string, bytes: Uint8Array } | null} Image, or null when it is not accepted.
 */
export const decodeDataImage = (src) => {
  const match = /^data:(image\/[a-z0-9.+-]{1,40});base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(src || ''));
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (!PASTE_IMAGE_TYPES.includes(type)) return null;
  const base64 = match[2].replace(/\s+/g, '');
  if (Math.floor((base64.length * 3) / 4) > MAX_PASTED_IMAGE_BYTES + 3) return null;
  let binary;
  try {
    binary = globalThis.atob(base64);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length > MAX_PASTED_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { type, bytes };
};

/** Longest Editor.js block clipboard that is read (larger ones go through the HTML conversion). */
export const MAX_EDITOR_CLIPBOARD = 2 * 1024 * 1024;

/**
 * True when an Editor.js block clipboard (`application/x-editor-js`) can be
 * left to Editor.js: valid JSON, at most `MAX_EDITOR_CLIPBOARD` long, and
 * every block uses a tool this field has and allows. Otherwise the HTML
 * conversion (with the field's preset filter) handles the paste as before.
 * @param {unknown} json - Clipboard data.
 * @param {(tool: string) => boolean} usable - Tool check.
 * @returns {boolean} Result.
 */
export const editorClipboardFits = (json, usable) => {
  if (typeof json !== 'string' || !json || json.length > MAX_EDITOR_CLIPBOARD) return false;
  let blocks;
  try {
    blocks = JSON.parse(json);
  } catch {
    return false;
  }
  return (
    Array.isArray(blocks) &&
    blocks.length > 0 &&
    blocks.every(
      (block) => block && typeof block === 'object' && typeof block.tool === 'string' && usable(block.tool)
    )
  );
};

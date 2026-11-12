import { parseInline, nodesToHtml, nodesToText } from '../../../../shared/render/inline.mjs';
import { MAX_FOOTNOTE_NOTE } from '../../../../shared/sanitize-policy.mjs';

/**
 * Pure helpers of the footnote tool (2.4), tested in Node.
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * New footnote id: 10 random characters (collision-free in practice, also
 * when two people add footnotes at the same moment).
 * @param {{ getRandomValues?: (array: Uint8Array) => Uint8Array }} [source] - Random source (default `crypto`).
 * @returns {string} Id.
 */
export const newFootnoteId = (source = globalThis.crypto) => {
  const bytes = new Uint8Array(10);
  if (source && typeof source.getRandomValues === 'function') source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let id = 'fn';
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
};

/**
 * Cleans the HTML of a note: the inline policy for notes (no footnotes, no
 * entry references) and only the tags the field allows (`null` = all).
 * @param {string} html - Note HTML from the note editor.
 * @param {string[]|null} tags - Allowed inline tags of the field preset.
 * @returns {string} Stored note HTML ('' when it has no text).
 */
export const cleanNoteHtml = (html, tags) => {
  const allowed = Array.isArray(tags) ? new Set(tags) : null;
  const walk = (nodes, depth = 0) =>
    nodes.flatMap((node) => {
      if (node.type !== 'element' || depth > 40) return [node];
      const children = walk(node.children, depth + 1);
      if (allowed && !allowed.has(node.tag)) return children;
      return [{ ...node, children }];
    });
  const nodes = walk(parseInline(String(html || '').slice(0, MAX_FOOTNOTE_NOTE), { inNote: true }));
  if (!nodesToText(nodes).replace(/[\s\u00a0\u200b]/g, '')) return '';
  return nodesToHtml(nodes, { storage: true });
};

/**
 * Plain text of a stored note (for lists and labels).
 * @param {string} html - Note HTML.
 * @param {number} [max=160] - Longest result.
 * @returns {string} Text.
 */
export const noteText = (html, max = 160) => {
  const text = nodesToText(parseInline(String(html || ''), { inNote: true }))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

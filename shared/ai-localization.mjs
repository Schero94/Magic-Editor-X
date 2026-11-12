/**
 * Strapi i18n "AI translations" and Magic Editor X fields (2.4): pure helpers
 * used by the server guard (`server/src/utils/ai-localization-guard.js`).
 *
 * Strapi 5.61 `@strapi/i18n` sends every localized attribute that is not
 * media, relation, boolean or enumeration to the AI provider, so a Magic
 * Editor X value (type `json`) would be translated as a whole: block ids,
 * block types, URLs, `_mex` markers, internal-link attributes and TeX.
 *
 * - `toTranslationPayload(value)` replaces a value with an envelope that only
 *   carries its inline text strings (`collectSegments`) with link targets
 *   replaced by placeholders (`maskInline`), so block ids, types, URLs, files,
 *   markers and internal-link attributes never reach the provider.
 * - `repairLocalizedValue(source, answer, options)` rebuilds the value for a
 *   target locale from the SOURCE structure and takes only translated inline
 *   strings from the answer (envelope or a full Editor.js document).
 * - `repairInline(source, translated)` keeps the translated text but restores
 *   link targets and attributes, inline math (TeX) and footnote ids from the
 *   source string; any mismatch keeps the source string.
 *
 * No DOM and no dependencies.
 */

import { isPlainObject } from './editor-data.mjs';
import { collectSegments, applySegments, readSegment, MAX_SEGMENT_HTML } from './ai-fields.mjs';
import { parseInline, nodesToHtml, isMathNode, isFootnoteNode } from './render/inline.mjs';
import { isValidFieldKey } from './field-identity.mjs';

/** Marker key of the envelope sent to the provider instead of an Editor.js document. */
export const ENVELOPE_KEY = 'magicEditorXTexts';

/**
 * @typedef {{ blockId: string, path: string, html: string }} Segment
 */

/**
 * Envelope that replaces an editor value in the provider payload.
 * @param {object|null} value - Clean editor value.
 * @returns {{ payload: object|null, segments: Segment[] }} Payload (null when there is no text) and the segments.
 */
export const toTranslationPayload = (value) => {
  const segments = collectSegments(value);
  if (!segments.length) return { payload: null, segments };
  return { payload: { [ENVELOPE_KEY]: segments.map((segment) => maskInline(segment.html)) }, segments };
};

/**
 * True for an envelope as written by `toTranslationPayload`.
 * @param {unknown} value - Provider answer.
 * @returns {boolean} Result.
 */
export const isTranslationEnvelope = (value) => isPlainObject(value) && Array.isArray(value[ENVELOPE_KEY]);

const MAX_DEPTH = 40;

/**
 * Elements whose identity comes from the source string.
 * @param {object} node - Parsed element.
 * @returns {'math'|'footnote'|'a'|null} Kind.
 */
const anchorKind = (node) => {
  if (isMathNode(node)) return 'math';
  if (isFootnoteNode(node)) return 'footnote';
  if (node.tag === 'a') return 'a';
  return null;
};

/**
 * Collects the anchored elements of a parsed tree in document order.
 * @param {object[]} nodes - Parsed nodes.
 * @param {{ math: object[], footnote: object[], a: object[] }} out - Accumulator.
 * @param {number} [depth=0] - Depth.
 * @returns {{ math: object[], footnote: object[], a: object[] }} Elements by kind.
 */
const anchors = (nodes, out = { math: [], footnote: [], a: [] }, depth = 0) => {
  if (depth > MAX_DEPTH) return out;
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    const kind = anchorKind(node);
    if (kind) out[kind].push(node);
    if (kind !== 'math' && kind !== 'footnote') anchors(node.children, out, depth + 1);
  }
  return out;
};

const clone = (node) => JSON.parse(JSON.stringify(node));

/** Link target placeholder sent instead of the real target (`#mex-link-<n>`). */
const PLACEHOLDER = /^#mex-link-(\d{1,4})$/;

/**
 * Replaces every link of a parsed tree (and of footnote notes, numbered per
 * note) by `<a href="#mex-link-<n>">`, numbered like `anchors()` lists them.
 * @param {object[]} nodes - Parsed nodes (mutated).
 * @returns {object[]} The same nodes.
 */
const maskNodes = (nodes) => {
  let index = 0;
  const walk = (list, depth = 0) => {
    if (depth > MAX_DEPTH) return;
    for (const node of list) {
      if (node.type !== 'element') continue;
      const kind = anchorKind(node);
      if (kind === 'a') {
        node.attrs = { href: `#mex-link-${index}` };
        index += 1;
      }
      if (kind === 'footnote' && Array.isArray(node.note)) maskNodes(node.note);
      if (kind !== 'math' && kind !== 'footnote') walk(node.children, depth + 1);
    }
  };
  walk(nodes);
  return nodes;
};

/**
 * Inline HTML as sent to the provider: link targets and internal-link
 * attributes are replaced by placeholders (`repairInline` restores them).
 * @param {string} html - Source inline HTML.
 * @returns {string} Masked inline HTML.
 */
export const maskInline = (html) => nodesToHtml(maskNodes(parseInline(html)), { storage: true });

/**
 * Restores the anchored elements of a translated tree from the source tree.
 * Links are matched by placeholder (`#mex-link-<n>`) or href first, then in order; inline math is replaced by
 * the source formula; footnotes keep the source id and get their note
 * repaired the same way. Any element left over or missing fails the repair.
 * @param {object[]} source - Parsed source nodes.
 * @param {object[]} translated - Parsed translated nodes.
 * @returns {object[]|null} Repaired nodes or null.
 */
const repairNodes = (source, translated) => {
  const pool = anchors(source);
  const used = { math: 0, footnote: 0 };
  const links = pool.a.map((node) => ({ node, used: false }));
  // Links keep their target even when the translation reorders them: exact
  // href matches are assigned first, the remaining links in order.
  const assigned = new Map();
  for (const node of anchors(translated).a) {
    const href = node.attrs.href;
    const placeholder = typeof href === 'string' ? PLACEHOLDER.exec(href) : null;
    const exact = placeholder
      ? links[Number(placeholder[1])] && !links[Number(placeholder[1])].used
        ? links[Number(placeholder[1])]
        : null
      : links.find((item) => !item.used && item.node.attrs.href === href);
    if (exact) {
      exact.used = true;
      assigned.set(node, exact.node);
    }
  }
  let failed = false;
  const takeLink = (node) => {
    if (assigned.has(node)) return assigned.get(node);
    const next = links.find((item) => !item.used);
    if (!next) return null;
    next.used = true;
    return next.node;
  };
  const walk = (nodes, depth = 0) => {
    if (depth > MAX_DEPTH) {
      failed = true;
      return [];
    }
    const out = [];
    for (const node of nodes) {
      if (node.type !== 'element') {
        out.push(node);
        continue;
      }
      const kind = anchorKind(node);
      if (kind === 'math') {
        const original = pool.math[used.math];
        used.math += 1;
        if (!original) failed = true;
        else out.push(clone(original));
      } else if (kind === 'footnote') {
        const original = pool.footnote[used.footnote];
        used.footnote += 1;
        if (!original) {
          failed = true;
          continue;
        }
        const copy = clone(original);
        const note = Array.isArray(node.note) ? repairNodes(original.note || [], node.note) : null;
        if (note) copy.note = note;
        out.push(copy);
      } else if (kind === 'a') {
        const original = takeLink(node);
        if (!original) {
          failed = true;
          continue;
        }
        out.push({ ...node, attrs: { ...original.attrs }, children: walk(node.children, depth + 1) });
      } else {
        out.push({ ...node, children: walk(node.children, depth + 1) });
      }
    }
    return out;
  };
  const result = walk(translated);
  if (
    failed ||
    used.math !== pool.math.length ||
    used.footnote !== pool.footnote.length ||
    links.some((item) => !item.used)
  )
    return null;
  return result;
};

/**
 * Keeps the translated text of an inline string and restores everything that
 * is not text from the source string.
 * @param {string} source - Source inline HTML.
 * @param {unknown} translated - Translated inline HTML from the provider.
 * @returns {string|null} Repaired inline HTML, or null when the translation cannot be used.
 */
export const repairInline = (source, translated) => {
  if (typeof source !== 'string' || typeof translated !== 'string') return null;
  if (translated.length > MAX_SEGMENT_HTML) return null;
  const nodes = repairNodes(parseInline(source), parseInline(translated));
  if (!nodes) return null;
  const html = nodesToHtml(nodes, { storage: true });
  return html.trim() ? html : null;
};

/**
 * Translated strings proposed by the provider, by segment index.
 * @param {Segment[]} segments - Source segments.
 * @param {unknown} answer - Provider value for the field.
 * @returns {Array<string|null>} Candidates.
 */
const candidatesOf = (segments, answer) => {
  if (isTranslationEnvelope(answer)) {
    const texts = answer[ENVELOPE_KEY];
    // A different count cannot be aligned safely: keep the source text.
    if (texts.length !== segments.length) return segments.map(() => null);
    return texts.map((text) => (typeof text === 'string' ? text : null));
  }
  if (isPlainObject(answer) && Array.isArray(answer.blocks)) {
    const byId = new Map();
    for (const block of answer.blocks) {
      if (isPlainObject(block) && typeof block.id === 'string' && !byId.has(block.id))
        byId.set(block.id, block);
    }
    return segments.map((segment) => {
      const block = byId.get(segment.blockId);
      return block && isPlainObject(block.data) ? readSegment(block.data, segment.path) : null;
    });
  }
  return segments.map(() => null);
};

/**
 * Rebuilds a target-locale value from the source value and the provider's
 * answer. Block ids, types, tunes, URLs, files, markers, table structure,
 * code, TeX and every other non-text value come from the source; only
 * translated inline strings that pass `repairInline` are taken over.
 * @param {object|null} source - Clean source-locale value.
 * @param {unknown} answer - Provider value for the field (envelope or Editor.js document).
 * @param {{ fieldKey?: string|null }} [options] - `fieldKey` to keep (the target locale's own key).
 * @returns {{ value: object|null, segments: number, translated: number, kept: number }} New value and counts.
 */
export const repairLocalizedValue = (source, answer, options = {}) => {
  if (!isPlainObject(source) || !Array.isArray(source.blocks)) {
    return { value: null, segments: 0, translated: 0, kept: 0 };
  }
  const segments = collectSegments(source);
  const candidates = candidatesOf(segments, answer);
  const updates = [];
  let kept = 0;
  segments.forEach((segment, index) => {
    const html = repairInline(segment.html, candidates[index]);
    if (html === null) kept += 1;
    else updates.push({ blockId: segment.blockId, path: segment.path, html });
  });
  const { data } = applySegments(source, updates);
  const value = { ...data };
  if (isValidFieldKey(options.fieldKey)) value.fieldKey = options.fieldKey;
  return { value, segments: segments.length, translated: updates.length, kept };
};

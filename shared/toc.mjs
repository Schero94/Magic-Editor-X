/**
 * Table of contents (`toc` block) and heading anchors, shared by the
 * renderers (HTML, React, Vue, text, Markdown), the quality lint and the
 * editor's live preview.
 *
 * Anchor scheme: `mex-h-<blockId>`. The Editor.js block id does not change
 * when the heading text is edited, reordered or translated (Strapi copies
 * the field value with its block ids when a locale is filled from another
 * one), so links to a heading keep working across edits and locales. A slug
 * of the text would be more readable but breaks every existing link when a
 * word of the heading changes. Ids that are not `[A-Za-z0-9_-]{1,64}` fall
 * back to `mex-h-<n>` (position of the heading); repeated ids get `-2`, `-3`.
 */

/** Prefix of heading anchors. */
export const HEADING_ID_PREFIX = 'mex-h-';

/** Defaults of a `toc` block. */
export const TOC_DEFAULTS = Object.freeze({ title: '', minLevel: 2, maxLevel: 4, style: 'unordered' });

/** Styles of a `toc` block. */
export const TOC_STYLES = Object.freeze(['unordered', 'ordered']);

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Creates an anchor allocator: same input order gives the same anchors.
 * @returns {(blockId: unknown) => string} Function returning the anchor of the next heading.
 */
export const createAnchorAllocator = () => {
  const used = new Set();
  let position = 0;
  return (blockId) => {
    position += 1;
    const base = `${HEADING_ID_PREFIX}${typeof blockId === 'string' && SAFE_ID.test(blockId) ? blockId : position}`;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
};

/**
 * GitHub-style heading slug (the convention of github-slugger, which GitHub,
 * markdown-it-anchor and rehype-slug follow): lower case, punctuation removed,
 * spaces to hyphens. Used by the Markdown renderer, whose output gets its
 * heading ids from the Markdown pipeline that renders it.
 * @param {string} text - Heading text.
 * @returns {string} Slug ('' when nothing is left).
 */
export const githubSlug = (text) =>
  String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');

/**
 * Creates a GitHub-style slug allocator (repeated slugs get `-1`, `-2`, ...).
 * @returns {(text: string) => string} Function returning the slug of the next heading.
 */
export const createSlugAllocator = () => {
  const seen = new Map();
  return (text) => {
    const base = githubSlug(text);
    let slug = base;
    if (seen.has(base)) {
      let n = seen.get(base);
      do {
        n += 1;
        slug = `${base}-${n}`;
      } while (seen.has(slug));
      seen.set(base, n);
    }
    seen.set(slug, 0);
    return slug;
  };
};

/**
 * Valid level range of toc data.
 * @param {{ minLevel?: unknown, maxLevel?: unknown }} data - Toc data.
 * @returns {{ minLevel: number, maxLevel: number }} Range (1..6, min <= max).
 */
export const tocRange = (data) => {
  const pick = (value, fallback) => (Number.isInteger(value) && value >= 1 && value <= 6 ? value : fallback);
  const a = pick(data && data.minLevel, TOC_DEFAULTS.minLevel);
  const b = pick(data && data.maxLevel, TOC_DEFAULTS.maxLevel);
  return { minLevel: Math.min(a, b), maxLevel: Math.max(a, b) };
};

/**
 * @typedef {{ id: string|null, level: number, text: string, slug?: string }} TocHeading
 * @typedef {TocHeading & { children: TocNode[] }} TocNode
 */

/**
 * Headings of a document within the toc's level range, as a nested tree. A
 * heading nests under the closest previous heading with a lower level;
 * headings with empty text are left out.
 * @param {TocHeading[]} headings - Headings in document order.
 * @param {{ minLevel?: unknown, maxLevel?: unknown }} data - Toc data.
 * @returns {TocNode[]} Top-level entries.
 */
export const buildTocTree = (headings, data) => {
  const { minLevel, maxLevel } = tocRange(data);
  const root = { level: 0, children: [] };
  const stack = [root];
  for (const heading of headings || []) {
    if (!heading || heading.level < minLevel || heading.level > maxLevel) continue;
    const text = String(heading.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop();
    const node = {
      id: heading.id || null,
      slug: heading.slug || null,
      level: heading.level,
      text: text.slice(0, 500),
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
};

/**
 * Number of entries of a toc tree.
 * @param {TocNode[]} nodes - Tree.
 * @returns {number} Count.
 */
export const countTocEntries = (nodes) =>
  (nodes || []).reduce((sum, node) => sum + 1 + countTocEntries(node.children), 0);

/**
 * "Changes since last publish" (2.11): classifies the blocks of the editor
 * against the published version of the same document, locale and field.
 *
 * It reuses the version history diff (`diffDocuments`): blocks are matched by
 * id first, then by type and word similarity, so a block re-created with a
 * new id still counts as changed. The result is only used to draw marks next
 * to the blocks; it never becomes part of the stored value.
 *
 * - `added`: the block is not in the published version.
 * - `changed`: the block exists in both, its content differs, or it moved.
 * - removed blocks are grouped by the place they had: `before` is the id of
 *   the current block they precede, `null` after the last block.
 */

import { diffDocuments } from './diff.mjs';

/** Block ids that are safe in a CSS attribute selector and as a data attribute. */
export const MARKABLE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @typedef {object} PublishedChanges
 * @property {Map<string, { kind: 'added'|'changed', moved: boolean, entry: object }>} marks - Current block id -> mark.
 * @property {Array<{ before: string|null, entries: object[] }>} removed - Removed blocks, grouped by place.
 * @property {{ added: number, changed: number, removed: number }} counts - Counts (a moved block counts as changed).
 */

/**
 * Classifies the current editor content against the published content.
 * @param {unknown} published - Published field value (any stored shape; null = empty field).
 * @param {unknown} current - Current editor value.
 * @returns {PublishedChanges} Marks, removed groups and counts.
 */
export const classifyPublishedChanges = (published, current) => {
  const entries = diffDocuments(published, current);
  const marks = new Map();
  const removed = [];
  let pending = [];
  let changed = 0;
  let added = 0;
  let removedCount = 0;
  for (const entry of entries) {
    if (entry.op === 'removed') {
      pending.push(entry);
      removedCount += 1;
      continue;
    }
    if (pending.length) {
      removed.push({ before: entry.id, entries: pending });
      pending = [];
    }
    if (marks.has(entry.id)) continue;
    if (entry.op === 'added') {
      marks.set(entry.id, { kind: 'added', moved: false, entry });
      added += 1;
    } else if (entry.op === 'changed' || entry.op === 'moved') {
      marks.set(entry.id, { kind: 'changed', moved: entry.op === 'moved', entry });
      changed += 1;
    }
  }
  if (pending.length) removed.push({ before: null, entries: pending });
  return { marks, removed, counts: { added, changed, removed: removedCount } };
};

/**
 * Whether the classification shows any difference.
 * @param {PublishedChanges|null|undefined} changes - Classification.
 * @returns {boolean} True when something was added, changed or removed.
 */
export const hasPublishedChanges = (changes) =>
  Boolean(changes) && changes.counts.added + changes.counts.changed + changes.counts.removed > 0;

/**
 * CSS rules for the block marks: a bar at the inline start of added (success) and changed
 * (warning) blocks, and room above the block that follows removed blocks (the marker sits there).
 * Only ids matching `MARKABLE_ID` are used, so no stored id can break out of the selector.
 * @param {PublishedChanges|null} changes - Classification.
 * @param {{ scope: string, added: string, changed: string, gap: string, width: string }} style - Scope
 *   attribute value and theme values (colours, gap above removed groups, bar width).
 * @returns {string} CSS text ('' without marks).
 */
export const publishedChangesCss = (changes, style) => {
  if (!changes || !style || !MARKABLE_ID.test(String(style.scope))) return '';
  const root = `[data-mex-changes="${style.scope}"]`;
  const added = [];
  const changedIds = [];
  for (const [id, mark] of changes.marks) {
    if (MARKABLE_ID.test(id)) (mark.kind === 'added' ? added : changedIds).push(id);
  }
  const gaps = changes.removed
    .filter((group) => group.before && MARKABLE_ID.test(group.before))
    .map((group) => `${root} .ce-block[data-id="${group.before}"]`);
  const rules = [];
  // The bar sits at the inline start: the left edge, the right edge in right-to-left content.
  const bar = (ids, color) => {
    if (!ids.length) return;
    const content = (id, rtl) =>
      `${root} ${rtl ? '[dir="rtl"] ' : ''}.ce-block[data-id="${id}"] .ce-block__content`;
    rules.push(
      `${ids.map((id) => content(id, false)).join(',\n')} { box-shadow: inset ${style.width} 0 0 0 ${color}; }`
    );
    rules.push(
      `${ids.map((id) => content(id, true)).join(',\n')} { box-shadow: inset -${style.width} 0 0 0 ${color}; }`
    );
  };
  bar(added, style.added);
  bar(changedIds, style.changed);
  if (gaps.length) rules.push(`${gaps.join(',\n')} { margin-block-start: ${style.gap}; }`);
  if (changes.removed.some((group) => group.before === null))
    rules.push(`${root} .codex-editor__redactor { margin-block-end: ${style.gap}; }`);
  return rules.join('\n');
};

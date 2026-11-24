/**
 * One-click fixes for findings of the Quality panel (2.9). Pure: the panel
 * asks which fix a finding has, the field applies it through the Editor.js
 * block API (so it is one undo step and reaches a live collaboration room).
 *
 * Kinds:
 * - `heading`: change a heading level (a heading that skips levels, a second
 *   H1, an H1 in content whose title field is the H1);
 * - `typography`: remove repeated spaces and spaces before punctuation;
 * - `linkText`: the editor types a new text for an ambiguous link ("click
 *   here") in the finding's row; the link keeps its address (no automatic
 *   text is ever written);
 * - `alt`: focus the alternative text field of an image.
 */

import {
  fixTypographyAt,
  headingFixLevel,
  rewriteLinkTextAt,
  setHeadingLevel,
} from '../../../../shared/content-insights.mjs';

/**
 * @typedef {{ kind: 'heading', level: number } | { kind: 'typography' } | { kind: 'linkText', text?: string } | { kind: 'alt', index: number }} FixAction
 */

const ALT_PATH = /^(?:file\.alt|alt|images\.(\d{1,4})\.file\.alt)$/;

/**
 * The fix a finding offers, or null.
 * @param {{ rule: string, blockId: string|null, path?: string, params?: object }} issue - Accessibility issue or hint.
 * @param {{ headingLevels?: number[] }} [context] - Allowed heading levels of the field.
 * @returns {FixAction|null} Fix.
 */
export const fixActionOf = (issue, context = {}) => {
  if (!issue || !issue.blockId) return null;
  const allowed = Array.isArray(context.headingLevels) ? context.headingLevels : [];
  const params = issue.params || {};
  switch (issue.rule) {
    case 'heading-order': {
      const level = headingFixLevel(Number(params.previous) || 0, allowed);
      return level !== null && level !== params.level ? { kind: 'heading', level } : null;
    }
    case 'multiple-h1':
    case 'h1-in-content': {
      const level = headingFixLevel(0, allowed, 1);
      return level !== null && level !== 1 ? { kind: 'heading', level } : null;
    }
    case 'extra-spaces':
      return issue.path ? { kind: 'typography' } : null;
    case 'ambiguous-link-text':
      return issue.path && typeof params.text === 'string' ? { kind: 'linkText' } : null;
    case 'image-alt-missing': {
      const match = ALT_PATH.exec(issue.path || '');
      return match ? { kind: 'alt', index: match[1] ? Number(match[1]) : 0 } : null;
    }
    default:
      return null;
  }
};

/**
 * New block data for a fix that changes content (`heading`, `typography`, and `linkText` with the
 * new text the editor typed in `action.text`).
 * @param {{ type: string, data: object }} block - Current block (fresh from the editor).
 * @param {{ path?: string }} issue - Finding.
 * @param {FixAction} action - Fix.
 * @param {string|null} [language] - Content language (French keeps spaces before ; : ! ?).
 * @returns {object|null} New block data, or null when the block no longer needs the fix.
 */
export const fixedBlockData = (block, issue, action, language = null) => {
  if (!block || !action) return null;
  if (action.kind === 'heading') return setHeadingLevel(block, issue.path, action.level);
  if (action.kind === 'typography') return fixTypographyAt(block, issue.path, language);
  if (action.kind === 'linkText')
    return rewriteLinkTextAt(block, issue.path, issue.params && issue.params.text, action.text);
  return null;
};

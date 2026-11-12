/**
 * Math and footnotes in the renderers (2.4): per-render state that the tree
 * builder, the text renderer and the Markdown renderer share.
 *
 * - Math: `options.math(tex, { display })` returns MathML (string) or render
 *   nodes; the result goes through the strict MathML allow-list
 *   (`mathml.mjs`). Without the option, or when it fails or returns nothing
 *   usable, the TeX source is written between `\(`/`\)` (inline) or
 *   `\[`/`\]` (display) inside `<span|div class="mex-math" data-mex-math>`,
 *   which client-side KaTeX auto-render or Temml's `renderMathInElement`
 *   pick up.
 * - Footnotes: markers are numbered in reading order (the order the
 *   renderer meets them); every marker is its own footnote. Ids are
 *   `<prefix>fn-<id>` / `<prefix>fnref-<id>` (prefix default `mex-`; a
 *   repeated id gets `-2`, `-3`), so two fields on one page stay apart with
 *   different prefixes.
 *
 * No DOM and no dependencies.
 */

import { isPlainObject } from '../editor-data.mjs';
import { el } from './nodes.mjs';
import { cleanMathResult } from './mathml.mjs';

/** Default accessible name of the footnote list. */
export const DEFAULT_FOOTNOTES_LABEL = 'Footnotes';
/** Default label of a back link; `{n}` is the footnote number. */
export const DEFAULT_FOOTNOTE_BACK_LABEL = 'Back to reference {n}';
/** Default id prefix of footnote anchors. */
export const DEFAULT_FOOTNOTE_PREFIX = 'mex-';

const PREFIX = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

/**
 * Short UI label from an option, or the default.
 * @param {unknown} value - Candidate label.
 * @param {string} fallback - Default.
 * @returns {string} Label (1 to 80 characters).
 */
const label = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean && clean.length <= 80 ? clean : fallback;
};

/**
 * Normalised `options.footnotes`.
 * @param {object} options - Render options.
 * @returns {{ label: string, backLabel: string, prefix: string }} Footnote options.
 */
export const footnoteOptions = (options) => {
  const source = isPlainObject(options && options.footnotes) ? options.footnotes : {};
  return {
    label: label(source.label, DEFAULT_FOOTNOTES_LABEL),
    backLabel: label(source.backLabel, DEFAULT_FOOTNOTE_BACK_LABEL),
    prefix:
      typeof source.prefix === 'string' && PREFIX.test(source.prefix)
        ? source.prefix
        : DEFAULT_FOOTNOTE_PREFIX,
  };
};

/**
 * Counts footnotes in reading order and gives each one a unique anchor id.
 * @returns {{ add: (id: string) => { n: number, anchor: string } }} Allocator.
 */
export const createFootnoteNumbers = () => {
  const used = new Map();
  let count = 0;
  return {
    add(id) {
      const seen = (used.get(id) || 0) + 1;
      used.set(id, seen);
      count += 1;
      return { n: count, anchor: seen === 1 ? id : `${id}-${seen}` };
    },
  };
};

/**
 * Calls `options.math` and validates its result.
 * @param {object} options - Render options.
 * @param {string} tex - TeX source.
 * @param {boolean} display - Display style.
 * @returns {Array<object>} `<math>` nodes, or [] for the fallback.
 */
export const renderMathNodes = (options, tex, display) => {
  if (!options || typeof options.math !== 'function' || !tex.trim()) return [];
  let result;
  try {
    result = options.math(tex, { display });
  } catch {
    return [];
  }
  return cleanMathResult(result);
};

/**
 * Render node of one formula: the validated MathML, or the delimited TeX
 * source.
 * @param {object} options - Render options.
 * @param {string} tex - TeX source.
 * @param {{ display: boolean, block: boolean, className?: string }} kind - Display style; `block` renders a `<div>`; `className` replaces the default classes.
 * @returns {object} Element node.
 */
export const mathElement = (options, tex, kind) => {
  const math = renderMathNodes(options, tex, kind.display);
  const attrs = {
    class: kind.className || (kind.display ? 'mex-math mex-math-display' : 'mex-math'),
    'data-mex-math': kind.display ? 'display' : 'inline',
  };
  const children = math.length ? math : kind.display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  return el(kind.block ? 'div' : 'span', attrs, children);
};

/**
 * Footnote state of one tree render: markers become numbered references,
 * `section()` returns the list (or null without footnotes).
 * @param {object} options - Render options.
 * @param {(note: Array<object>) => Array<object>} renderNote - Render nodes of a parsed note.
 * @returns {{ marker: (node: object) => object, section: () => object|null }} State.
 */
export const createFootnoteTree = (options, renderNote) => {
  const { label: listLabel, backLabel, prefix } = footnoteOptions(options);
  const numbers = createFootnoteNumbers();
  const items = [];
  const labelId = `${prefix}footnotes-label`;
  return {
    marker(node) {
      const { n, anchor } = numbers.add(node.attrs['data-mex-footnote']);
      items.push({ n, anchor, note: node.note || [] });
      return el(
        'sup',
        { class: 'mex-footnote-ref' },
        el(
          'a',
          {
            href: `#${prefix}fn-${anchor}`,
            id: `${prefix}fnref-${anchor}`,
            'aria-describedby': labelId,
          },
          String(n)
        )
      );
    },
    section() {
      if (!items.length) return null;
      return el('section', { class: 'mex-footnotes', 'aria-labelledby': labelId }, [
        el('h2', { id: labelId, class: 'mex-footnotes-label' }, listLabel),
        el(
          'ol',
          { class: 'mex-footnotes-list' },
          items.map((item) =>
            el('li', { id: `${prefix}fn-${item.anchor}`, class: 'mex-footnote' }, [
              renderNote(item.note),
              ' ',
              el(
                'a',
                {
                  href: `#${prefix}fnref-${item.anchor}`,
                  class: 'mex-footnote-back',
                  'aria-label': backLabel.replace(/\{n\}/g, String(item.n)),
                },
                '↩'
              ),
            ])
          )
        ),
      ]);
    },
  };
};

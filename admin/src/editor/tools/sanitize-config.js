import {
  INTERNAL_LINK_ATTRIBUTES,
  MATH_ATTRIBUTE,
  FOOTNOTE_ATTRIBUTES,
} from '../../../../shared/sanitize-policy.mjs';

/**
 * Editor.js sanitize rule for `<a>` (HTMLJanitor syntax: attribute -> true
 * keeps it). Editor.js merges the inline tools' rules per tag with
 * `Object.assign`, and a block's own field rules replace them, so every tool
 * that declares `a` must declare the same full rule: otherwise the internal
 * link reference (`data-mex-uid`, `data-mex-document-id`, `data-mex-locale`)
 * and the mention flag (`data-mex-mention`) are dropped when Editor.js saves
 * the block. Values are validated again by `sanitizeInline` and on the server.
 */
export const LINK_SANITIZE = Object.freeze({
  href: true,
  target: true,
  rel: true,
  ...Object.fromEntries(INTERNAL_LINK_ATTRIBUTES.map((name) => [name, true])),
});

/**
 * Editor.js rule for `<span>` (2.4): the tooltip (`class="cdx-tooltip"`,
 * `data-tooltip`) and inline math (`data-mex-math`). Every tool or field rule
 * that declares `span` uses it, for the same reason as `LINK_SANITIZE`.
 */
export const SPAN_SANITIZE = Object.freeze({
  class: 'cdx-tooltip',
  'data-tooltip': true,
  [MATH_ATTRIBUTE]: true,
});

/**
 * Editor.js rule for `<sup>` (2.4): footnote markers keep their id and note.
 * The DOM-only attributes the editor adds to markers (`contenteditable`,
 * `data-mutation-free`) are dropped on save.
 */
export const SUP_SANITIZE = Object.freeze(
  Object.fromEntries(FOOTNOTE_ATTRIBUTES.map((name) => [name, true]))
);

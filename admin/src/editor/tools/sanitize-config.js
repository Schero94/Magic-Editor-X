import {
  INTERNAL_LINK_ATTRIBUTES,
  MATH_ATTRIBUTE,
  FOOTNOTE_ATTRIBUTES,
} from '../../../../shared/sanitize-policy.mjs';
import { COLOR_ATTRIBUTE, HIGHLIGHT_ATTRIBUTE } from '../../../../shared/inline-format.mjs';
import {
  ANNOTATION_ATTRIBUTE,
  ANNOTATION_VALUE_PREFIX,
  ANNOTATION_KEY,
} from '../../../../shared/blocks/annotations.mjs';

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
export const SPAN_SANITIZE = {
  class: 'cdx-tooltip',
  'data-tooltip': true,
  [MATH_ATTRIBUTE]: true,
  // 2.5: text colour token and inline annotation (values are `data-mex-a-<key>`, added per field below).
  [COLOR_ATTRIBUTE]: true,
  [ANNOTATION_ATTRIBUTE]: true,
};

/**
 * 2.5: lets Editor.js keep the value attributes of the annotations a field
 * offers (`data-mex-a-<key>`). HTMLJanitor rules name attributes exactly, so
 * the keys are added to the shared span rule (and kept: every editor on the
 * page reads the same rule; values are validated again by `sanitizeInline`
 * and on the server). Rules are read when Editor.js cleans, so every tool
 * and block rule must reference `SPAN_SANITIZE` itself, not a copy.
 * @param {Iterable<string>} keys - Attribute keys of the enabled annotations.
 */
export const allowAnnotationKeys = (keys) => {
  for (const key of keys)
    if (ANNOTATION_KEY.test(key)) SPAN_SANITIZE[`${ANNOTATION_VALUE_PREFIX}${key}`] = true;
};

/**
 * Editor.js rule for `<mark>` (2.5): the marker (`class="cdx-marker"`) and
 * the highlight token (`data-mex-highlight`). Shared like `SPAN_SANITIZE`.
 */
export const MARK_SANITIZE = Object.freeze({ class: 'cdx-marker', [HIGHLIGHT_ATTRIBUTE]: true });

/**
 * Editor.js rule for `<sup>` (2.4): footnote markers keep their id and note.
 * The DOM-only attributes the editor adds to markers (`contenteditable`,
 * `data-mutation-free`) are dropped on save.
 */
export const SUP_SANITIZE = Object.freeze(
  Object.fromEntries(FOOTNOTE_ATTRIBUTES.map((name) => [name, true]))
);

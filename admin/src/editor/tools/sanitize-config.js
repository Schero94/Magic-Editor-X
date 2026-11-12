import { INTERNAL_LINK_ATTRIBUTES } from '../../../../shared/sanitize-policy.mjs';

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

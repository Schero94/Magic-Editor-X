/**
 * HTML renderer for Magic Editor X content: serialises the render tree from
 * `tree.mjs` (`renderHtml(value) === serializeNodes(renderTree(value))` as
 * long as no override returns a string).
 *
 * Output is built only from known elements with escaped text and validated
 * URLs. Stored inline HTML goes through the strict parser in `inline.mjs`. No
 * inline styles are written (CSP friendly); layout comes from stable `mex-`
 * class names.
 */

import { serializeNodes } from './nodes.mjs';
import { createTreeBuilder } from './tree.mjs';

/**
 * Renders Magic Editor X content to HTML.
 *
 * An override that returns a string is written as it is (the 2.2 contract:
 * the override is the caller's code and escapes what it outputs, for example
 * with `helpers.escape`/`helpers.inline`). Overrides may also return nodes,
 * which are validated like in `renderTree`.
 * @param {unknown} value - Stored field value.
 * @param {import('../../types/render').RenderOptions} [options] - Options.
 * @returns {string} HTML ('' for empty or invalid input).
 */
export const renderHtml = (value, options = {}) =>
  serializeNodes(createTreeBuilder(value, options, { overrideHtml: true }).nodes);

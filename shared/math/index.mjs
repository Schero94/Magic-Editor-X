/**
 * Math helper (`magic-editor-x/math`, 2.4): renders TeX to MathML with Temml
 * for the renderers' `math` option, and checks TeX for the editor.
 *
 * ```js
 * import { renderHtml } from 'magic-editor-x/render';
 * import { renderMath } from 'magic-editor-x/math';
 * const html = renderHtml(value, { math: renderMath });
 * ```
 *
 * Temml (MIT, MathML only, no dependencies, no eval) runs with safe settings:
 * `trust: false` (no `\class`, `\id`, `\style`, `\data`, `\includegraphics`;
 * Temml has no `\href`/`\url`), sizes capped (`maxSize`), macro expansion
 * capped (`maxExpand`), errors thrown instead of rendered. The renderers
 * still parse the result through their MathML allow-list, so the output of
 * this helper is never trusted as HTML. MathML Core renders natively in
 * current Chromium, Firefox and Safari; no stylesheet or font is required
 * (Temml's optional CSS and fonts improve some glyphs).
 */

import temml from 'temml';
import { MAX_MATH_TEX } from '../sanitize-policy.mjs';

/** Temml settings used by `renderMath` and `checkMath`. */
export const MATH_SETTINGS = Object.freeze({
  trust: false,
  throwOnError: true,
  strict: false,
  annotate: true,
  xml: false,
  wrap: 'none',
  // User sizes: at most 20em (relative) and 200pt (absolute), so `\rule{1e6em}{1e6em}` stays small.
  maxSize: Object.freeze([20, 200]),
  // Macro expansions per formula (`\def\a{\a\a}` loops end here).
  maxExpand: 500,
});

/**
 * Temml options for one call (a fresh object: Temml may add macros to it).
 * @param {boolean} display - Display style.
 * @returns {object} Options.
 */
const settings = (display) => ({
  ...MATH_SETTINGS,
  maxSize: [...MATH_SETTINGS.maxSize],
  macros: {},
  displayMode: display === true,
});

/**
 * Renders TeX to a MathML string, or null when the TeX does not parse, is
 * empty or longer than the stored limit. Never throws.
 * @param {unknown} tex - TeX source.
 * @param {{ display?: boolean }} [options] - Display style.
 * @returns {string|null} MathML (`<math>…</math>`) or null.
 */
export const renderMath = (tex, options = {}) => {
  if (typeof tex !== 'string' || !tex.trim() || tex.length > MAX_MATH_TEX) return null;
  try {
    const out = temml.renderToString(tex, settings(Boolean(options && options.display)));
    return typeof out === 'string' && out.startsWith('<math') ? out : null;
  } catch {
    return null;
  }
};

/**
 * Checks whether TeX parses. The message is Temml's plain-text explanation
 * (for the editor; it may quote the TeX).
 * @param {unknown} tex - TeX source.
 * @param {{ display?: boolean }} [options] - Display style.
 * @returns {{ ok: true } | { ok: false, message: string }} Result.
 */
export const checkMath = (tex, options = {}) => {
  if (typeof tex !== 'string' || !tex.trim()) return { ok: true };
  if (tex.length > MAX_MATH_TEX) return { ok: false, message: `Longer than ${MAX_MATH_TEX} characters` };
  try {
    temml.renderToString(tex, settings(Boolean(options && options.display)));
    return { ok: true };
  } catch (error) {
    const message = error && typeof error.message === 'string' ? error.message : 'Invalid TeX';
    // Temml underlines the position with combining low lines (U+0332); plain text reads better.
    const plain = message
      .replace(/\u0332/g, '')
      // eslint-disable-next-line no-control-regex -- control characters are removed from the message on purpose
      .replace(/[\u0000-\u001f]+/g, ' ')
      .trim();
    return { ok: false, message: plain.slice(0, 300) };
  }
};

export default renderMath;

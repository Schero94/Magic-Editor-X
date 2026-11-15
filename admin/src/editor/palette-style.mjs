import { paletteCss, colorClass, highlightClass } from '../../../shared/inline-format.mjs';
import { parseColor, relativeLuminance } from '../../../shared/quality.mjs';

/**
 * Editor display of the colour palette (2.5).
 *
 * The admin shows tokens with the owner's configured `light` or `dark`
 * values, chosen by the admin theme, so editors see roughly what the site
 * shows. Only validated hex colours and token names reach the CSS.
 */

/**
 * True when the Design System theme is dark (its base surface `neutral0` is dark).
 * @param {{ colors?: Record<string, string> }|undefined} theme - styled-components theme.
 * @returns {boolean} Result.
 */
export const isDarkTheme = (theme) => {
  const rgb = parseColor(theme && theme.colors ? theme.colors.neutral0 : '');
  return Boolean(rgb && relativeLuminance(rgb) < 0.4);
};

/**
 * CSS for the editor (stored attributes) and the in-field preview (renderer classes).
 * @param {import('../../../shared/inline-format.mjs').Palette|null} palette - Normalised palette.
 * @param {boolean} dark - Admin theme is dark.
 * @returns {string} CSS ('' without tokens).
 */
export const paletteEditorCss = (palette, dark) => {
  if (!palette || (!palette.colors.length && !palette.highlights.length)) return '';
  return paletteCss(palette, {
    dark: dark ? 'only' : 'none',
    selector: (kind, token) =>
      kind === 'color'
        ? `.mex-editor span[data-mex-color="${token}"], .mex-preview .${colorClass(token)}`
        : `.mex-editor mark[data-mex-highlight="${token}"], .mex-preview .${highlightClass(token)}`,
  });
};

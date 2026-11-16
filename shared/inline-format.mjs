/**
 * Text colour and highlight tokens (2.5).
 *
 * Editors never pick a free colour: the site owner defines a palette of named
 * tokens in the plugin configuration (`config/plugins.js` ->
 * `magic-editor-x.config.palette`), next to the site CSS that styles them.
 * Content stores only the token name:
 * - text colour `<span data-mex-color="accent">…</span>`
 * - highlight `<mark data-mex-highlight="note">…</mark>`
 * never an inline style. The renderers add the classes `mex-color-<token>`
 * and `mex-highlight-<token>`; the site CSS gives them their colours.
 *
 * The colour values of a token (`light`, `dark`) are used only for the
 * editor display and the contrast check. Pure ESM, no dependencies.
 */

/** Token name: lower-case letters, digits and `-`, starting with a letter, at most 32 characters. */
export const TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Attribute of a coloured span. */
export const COLOR_ATTRIBUTE = 'data-mex-color';
/** Attribute of a highlighted mark. */
export const HIGHLIGHT_ATTRIBUTE = 'data-mex-highlight';

/** Bounds of the palette configuration. */
export const PALETTE_LIMITS = Object.freeze({ tokens: 24, label: 60, locales: 20 });

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

/** Default page background and text colours for the contrast check (light and dark site themes). */
export const DEFAULT_SURFACE = Object.freeze({
  background: Object.freeze({ light: '#ffffff', dark: '#121212' }),
  text: Object.freeze({ light: '#1f1f1f', dark: '#f2f2f2' }),
});

/**
 * True for a `#rgb` or `#rrggbb` colour.
 * @param {unknown} value - Candidate.
 * @returns {boolean} Result.
 */
export const isHexColor = (value) => typeof value === 'string' && HEX.test(value);

/**
 * Lower-case `#rrggbb` form of a hex colour.
 * @param {string} value - `#rgb` or `#rrggbb`.
 * @returns {string} Six-digit form.
 */
const longHex = (value) => {
  const hex = value.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
};

/**
 * True for a valid token name.
 * @param {unknown} value - Candidate.
 * @returns {boolean} Result.
 */
export const isToken = (value) => typeof value === 'string' && TOKEN_PATTERN.test(value);

/**
 * Clean label: a string or an object of locale -> string (the editor shows the admin locale, then `en`, then the name).
 * @param {unknown} value - Label.
 * @returns {string|Record<string, string>|null} Label.
 */
const cleanLabel = (value) => {
  if (typeof value === 'string') return value.trim().slice(0, PALETTE_LIMITS.label) || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [locale, text] of Object.entries(value).slice(0, PALETTE_LIMITS.locales))
    if (LOCALE.test(locale) && typeof text === 'string' && text.trim())
      out[locale] = text.trim().slice(0, PALETTE_LIMITS.label);
  return Object.keys(out).length ? out : null;
};

/**
 * @typedef {{ name: string, label: string|Record<string, string>|null, light: string, dark: string }} PaletteToken
 * @typedef {{ background: { light: string, dark: string }, text: { light: string, dark: string }, colors: PaletteToken[], highlights: PaletteToken[] }} Palette
 */

/**
 * Cleans a list of tokens: valid names (first one wins), hex colours (`dark`
 * defaults to `light`), at most `PALETTE_LIMITS.tokens`.
 * @param {unknown} list - Configured tokens.
 * @returns {PaletteToken[]} Tokens.
 */
const cleanTokens = (list) => {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (out.length >= PALETTE_LIMITS.tokens) break;
    if (!item || typeof item !== 'object' || !isToken(item.name) || seen.has(item.name)) continue;
    if (!isHexColor(item.light)) continue;
    seen.add(item.name);
    out.push({
      name: item.name,
      label: cleanLabel(item.label),
      light: longHex(item.light),
      dark: longHex(isHexColor(item.dark) ? item.dark : item.light),
    });
  }
  return out;
};

/**
 * Pair of light and dark colours with defaults.
 * @param {unknown} value - `{ light, dark }`.
 * @param {{ light: string, dark: string }} fallback - Defaults.
 * @returns {{ light: string, dark: string }} Colours.
 */
const cleanPair = (value, fallback) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    light: isHexColor(source.light) ? longHex(source.light) : fallback.light,
    dark: isHexColor(source.dark) ? longHex(source.dark) : fallback.dark,
  };
};

/**
 * Normalises the palette configuration. Invalid tokens are dropped (the
 * config validator refuses them at start, so this only matters for callers
 * outside Strapi).
 * @param {unknown} input - `config.palette`.
 * @returns {Palette} Palette (empty token lists when nothing is configured).
 */
export const normalizePalette = (input) => {
  const source = input && typeof input === 'object' ? input : {};
  return {
    background: cleanPair(source.background, DEFAULT_SURFACE.background),
    text: cleanPair(source.text, DEFAULT_SURFACE.text),
    colors: cleanTokens(source.colors),
    highlights: cleanTokens(source.highlights),
  };
};

/**
 * True when the palette has at least one colour or highlight token.
 * @param {Palette|null|undefined} palette - Palette.
 * @returns {boolean} Result.
 */
export const hasPalette = (palette) =>
  Boolean(
    palette &&
    ((palette.colors && palette.colors.length) || (palette.highlights && palette.highlights.length))
  );

/**
 * Label of a token in a locale: the locale, its language, `en`, the first label, then the name.
 * @param {PaletteToken} token - Token.
 * @param {string} [locale] - Admin locale.
 * @returns {string} Label.
 */
export const tokenLabel = (token, locale) => {
  const { label } = token;
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') {
    const language = typeof locale === 'string' ? locale.split('-')[0] : '';
    return label[locale] || label[language] || label.en || Object.values(label)[0] || token.name;
  }
  return token.name;
};

/** Class a renderer adds to a coloured span. */
export const colorClass = (token) => `mex-color-${token}`;
/** Class a renderer adds to a highlight. */
export const highlightClass = (token) => `mex-highlight-${token}`;

/**
 * CSS for a site (or the editor display): one rule per token, dark values in
 * `prefers-color-scheme: dark`. Values are validated hex colours and token
 * names, so the result is safe to inject.
 * @param {Palette} palette - Normalised palette.
 * @param {{ selector?: (kind: 'color'|'highlight', token: string) => string, dark?: 'media'|'only'|'none' }} [options] - Selector builder (default: the renderer classes); `dark: 'only'` writes the dark values without a media query.
 * @returns {string} CSS.
 */
export const paletteCss = (palette, options = {}) => {
  const selector =
    typeof options.selector === 'function'
      ? options.selector
      : (kind, token) => `.${kind === 'color' ? colorClass(token) : highlightClass(token)}`;
  const mode = options.dark || 'media';
  const rules = (variant) => [
    ...palette.colors.map((token) => `${selector('color', token.name)} { color: ${token[variant]}; }`),
    ...palette.highlights.map(
      (token) =>
        `${selector('highlight', token.name)} { background-color: ${token[variant]}; color: inherit; }`
    ),
  ];
  if (mode === 'only') return rules('dark').join('\n');
  const light = rules('light').join('\n');
  if (mode === 'none' || !light) return light;
  return `${light}\n@media (prefers-color-scheme: dark) {\n${rules('dark')
    .map((rule) => `  ${rule}`)
    .join('\n')}\n}`;
};

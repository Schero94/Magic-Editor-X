'use strict';

const { normalizePalette } = require('../../../shared/inline-format.mjs');
const { resolveFieldPreset, inlinePolicy } = require('../../../shared/presets.mjs');

let cached = { source: undefined, palette: null };

/**
 * The configured colour palette (2.5, `config.palette`), normalised. Cached
 * per config object (the config does not change while Strapi runs).
 * @param {object} strapi - Strapi instance.
 * @returns {import('../../../shared/inline-format.mjs').Palette} Palette.
 */
const paletteOf = (strapi) => {
  const source = strapi.config.get('plugin::magic-editor-x.palette');
  if (cached.source !== source || !cached.palette) cached = { source, palette: normalizePalette(source) };
  return cached.palette;
};

/**
 * Inline policy of a field (2.5): tags of its preset, footnotes, the palette
 * tokens when the field turns colours on, the enabled annotations of the
 * server registry. Pass it as `cleanEditorValue(value, { inline })`.
 * @param {object} strapi - Strapi instance.
 * @param {unknown} options - Field options (`attribute.options`).
 * @returns {object} Policy (see `inlinePolicy`).
 */
const fieldInlinePolicy = (strapi, options) =>
  inlinePolicy(resolveFieldPreset(options), { palette: paletteOf(strapi) });

module.exports = { paletteOf, fieldInlinePolicy };

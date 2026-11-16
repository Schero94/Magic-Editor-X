/**
 * Lazy start of editor fields (2.5, roadmap item 8): pure helpers
 * (tests/drafts.test.mjs). A field creates Editor.js (and with it its live
 * room) only when it comes within `marginPx` of the viewport, is focused or
 * clicked; until then it shows a static render of its content.
 */

/** Default distance (CSS px) above and below the viewport at which fields start (config `lazyInit.marginPx`). */
export const DEFAULT_LAZY_MARGIN_PX = 800;

/**
 * Margin from config (bounded 0..10000, default 800).
 * @param {unknown} value - Config value.
 * @returns {number} Pixels.
 */
export const lazyMarginOf = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 10000 ? number : DEFAULT_LAZY_MARGIN_PX;
};

/**
 * True when a box is inside the viewport extended by `margin` above and below.
 * Collapsed boxes (0 x 0, e.g. inside a hidden panel) are not near.
 * @param {{ top: number, bottom: number, width: number, height: number }} rect - Bounding box.
 * @param {number} viewportHeight - window.innerHeight.
 * @param {number} margin - Pixels.
 * @returns {boolean} Result.
 */
export const isNearViewport = (rect, viewportHeight, margin) =>
  Boolean(rect) &&
  (rect.width > 0 || rect.height > 0) &&
  rect.bottom >= -margin &&
  rect.top <= viewportHeight + margin;

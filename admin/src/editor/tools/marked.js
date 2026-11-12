import { el } from './dom';
import {
  BUILT_IN_MARKER,
  BUILT_IN_MARKER_VERSION,
  isBuiltInBlock,
} from '../../../../shared/sanitize-policy.mjs';

/**
 * Built-in tools of the 2.3 block types a custom block could already use
 * before 2.3 (`MARKED_BLOCKS`: `toc`, `gallery`, `video`, `audio`, `synced`).
 *
 * - Saved data gets the built-in marker (`_mex`), so it stays recognisable as
 *   built-in in every later version and renderer.
 * - Data that is not built-in (custom block data whose Settings definition was
 *   removed) is never taken over: the block shows the Editor.js stub notice
 *   and saves the data exactly as it was loaded. When the site still has the
 *   custom block, its own tool replaces the built-in one (`buildTools`).
 */

/** Inline tags kept in custom block data (the custom block tool's rules). */
const FOREIGN_INLINE_SANITIZE = Object.freeze({
  b: true,
  i: true,
  u: { class: 'cdx-underline' },
  s: { class: 'cdx-strikethrough' },
  mark: { class: 'cdx-marker' },
  code: { class: 'inline-code' },
  a: { href: true, target: true, rel: true },
  br: true,
});

/** Optional Editor.js block tool methods that must not run for kept custom data. */
const OPTIONAL_METHODS = ['rendered', 'updated', 'moved', 'removed', 'renderSettings', 'onPaste'];

/**
 * Deep copy of JSON data.
 * @param {unknown} value - Data.
 * @returns {any} Copy.
 */
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * True when a block's data is custom block data, not built-in data. Empty
 * data is a new block of the built-in tool.
 * @param {string} type - Block type.
 * @param {unknown} data - Data Editor.js passes to the tool.
 * @returns {boolean} Result.
 */
export const isForeignData = (type, data) =>
  Boolean(data) &&
  typeof data === 'object' &&
  !Array.isArray(data) &&
  Object.keys(data).length > 0 &&
  !isBuiltInBlock({ type, data });

/**
 * Adds the built-in marker to saved data.
 * @param {unknown} out - Result of the tool's `save()`.
 * @returns {unknown} Data with the marker.
 */
const withMarker = (out) =>
  out && typeof out === 'object' && !Array.isArray(out)
    ? { ...out, [BUILT_IN_MARKER]: BUILT_IN_MARKER_VERSION }
    : out;

/**
 * Wraps a built-in tool class of a `MARKED_BLOCKS` type.
 * @param {Function} ToolClass - Editor.js block tool class.
 * @param {string} type - Block type.
 * @returns {Function} Subclass.
 */
export const markedTool = (ToolClass, type) => {
  const parent = ToolClass.prototype;

  class MarkedTool extends ToolClass {
    static get sanitize() {
      const own = ToolClass.sanitize;
      // Without own rules Editor.js uses the inline tools' rules for every key; with own
      // rules, keys without a rule (kept custom data) fall back to the whole object.
      return own && Object.keys(own).length ? { ...FOREIGN_INLINE_SANITIZE, ...own } : own;
    }

    constructor(options) {
      const data = options && options.data;
      const foreign = isForeignData(type, data);
      super(foreign ? { ...options, data: {} } : options);
      this.mexForeign = foreign ? copy(data) : null;
      this.mexConfig = (options && options.config) || {};
    }

    render() {
      if (!this.mexForeign) return super.render();
      const t = typeof this.mexConfig.t === 'function' ? this.mexConfig.t : (_id, fallback) => fallback;
      return el('div', {
        className: 'ce-stub',
        attrs: { 'data-mex-kept': type },
        children: [
          el('div', {
            className: 'ce-stub__info',
            children: [
              el('div', { className: 'ce-stub__title', text: type }),
              el('div', {
                className: 'ce-stub__subtitle',
                text: t('tools.ui.stub', 'This block cannot be shown. Its content is kept when you save.'),
              }),
            ],
          }),
        ],
      });
    }

    save(node) {
      if (this.mexForeign) return copy(this.mexForeign);
      const out = super.save(node);
      return out && typeof out.then === 'function' ? out.then(withMarker) : withMarker(out);
    }

    validate(data) {
      if (this.mexForeign) return true;
      return typeof parent.validate === 'function' ? parent.validate.call(this, data) : true;
    }
  }

  for (const name of OPTIONAL_METHODS) {
    if (typeof parent[name] !== 'function') continue;
    Object.defineProperty(MarkedTool.prototype, name, {
      configurable: true,
      writable: true,
      value(...args) {
        if (this.mexForeign) return name === 'renderSettings' ? [] : undefined;
        return parent[name].apply(this, args);
      },
    });
  }
  return MarkedTool;
};

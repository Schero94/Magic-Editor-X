import IndentTune from 'editorjs-indent-tune';

/**
 * editorjs-indent-tune 1.4.4 (the latest release) adds a `window` resize
 * listener in the constructor of every block's tune and never removes it, and
 * Editor.js 2.31 does not call a destroy hook on block tunes (`Block.destroy`
 * only destroys the tool). Each block rendered by an editor that was later
 * destroyed (closing the entry, a remote re-render, the history preview, a
 * suggest session) kept its listener, its detached DOM and a resize timer.
 *
 * `createIndentTune()` returns a subclass, one per editor, whose resize
 * listeners are recorded while the original constructor runs, plus
 * `dispose()`, which removes every listener of that editor (`disposeTools`,
 * called after the editor was destroyed). The documented static `reset()`
 * hook is not usable: Editor.js 2.31 `Tools.destroy` iterates
 * `Object.values()` of a Map and never calls it. A listener of a block that
 * left the page also removes itself on the next resize.
 *
 * 1.4.4 `applyStylesToWrapper` also re-queues itself with `queueMicrotask`
 * for as long as the block (or the redactor) measures 0 px wide. A hidden
 * block, for example a child of a closed toggle (`display: none`), never gets
 * a width, so that loop starved the event loop and froze the tab on the next
 * window resize or when a second editor (Suggest changes) started. The
 * subclass measures first: a block without a width is styled once it gets
 * one (ResizeObserver), and the original method only runs when it cannot loop.
 *
 * 2.10.1: the original measures the block (or the redactor) with
 * `getBoundingClientRect()` every time it styles a wrapper, also while a new
 * block is composed. Each call forces a layout of the whole page when the DOM
 * has just changed, so styling many blocks in a row (a remote update, a paste,
 * undo) cost one full layout per block: 5 s for 10 changed blocks in a
 * 5,000-block document. Every block is as wide as its redactor, so the
 * subclass reads the redactor's width from a ResizeObserver (measured once,
 * then updated after each layout) and hands that width to the original
 * method instead of a fresh measurement.
 * @returns {{ ToolClass: Function, dispose: () => void }} Tune class and cleanup.
 */
export const createIndentTune = () => {
  const listeners = new Set();
  /** @type {Map<HTMLElement, { observer: ResizeObserver, level: number|undefined }>} */
  const waiting = new Map();
  const remove = (entry) => {
    window.removeEventListener('resize', entry.guarded);
    listeners.delete(entry);
  };

  const stopWaiting = (wrapper) => {
    const pending = waiting.get(wrapper);
    if (!pending) return;
    pending.observer.disconnect();
    waiting.delete(wrapper);
  };

  /** Redactor -> border-box width, kept current by one ResizeObserver per tool set. */
  const widths = new Map();
  const widthObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const box = entry.borderBoxSize && entry.borderBoxSize[0];
            widths.set(entry.target, box ? box.inlineSize : entry.target.getBoundingClientRect().width);
          }
        })
      : null;
  /**
   * Width of the redactor that holds `element` (or of `element` itself), without forcing a
   * layout after the first measurement.
   * @param {HTMLElement} element - Block or redactor.
   * @param {string} redactorClass - Editor.js redactor class.
   * @returns {number} Width in CSS px.
   */
  const widthOf = (element, redactorClass) => {
    const redactor = element.closest(`.${redactorClass}`) || element;
    let width = widths.get(redactor);
    if (width === undefined) {
      width = redactor.getBoundingClientRect().width;
      if (widthObserver) {
        widths.set(redactor, width);
        widthObserver.observe(redactor);
      }
    }
    // A redactor without a width (a hidden editor) is rare: the element itself is measured then,
    // so the wait below starts and ends exactly as before.
    if (!width && element !== redactor) width = element.getBoundingClientRect().width;
    return width;
  };

  const dispose = () => {
    for (const entry of [...listeners]) remove(entry);
    for (const wrapper of [...waiting.keys()]) stopWaiting(wrapper);
    if (widthObserver) widthObserver.disconnect();
    widths.clear();
  };

  class ManagedIndentTune extends IndentTune {
    /**
     * Applies the indent padding, or waits until the measured element has a width.
     * Measures the same element as the original: the block of the wrapper, else the redactor.
     * @param {HTMLElement} wrapper Tune wrapper of a block.
     * @param {number} [level] Indent level; the original reads the wrapper attribute when omitted.
     * @returns {void}
     */
    applyStylesToWrapper(wrapper, level) {
      const measured =
        (wrapper && this.getBlockForWrapper(wrapper)) ||
        document.querySelector(`.${this.EditorCSS.redactor}`);
      const width = wrapper && measured ? widthOf(measured, this.EditorCSS.redactor) : 0;
      if (wrapper && measured && width === 0) {
        const pending = waiting.get(wrapper);
        if (pending) {
          if (level !== undefined) pending.level = level;
          return;
        }
        // Without ResizeObserver the padding is applied on the next window resize instead.
        if (typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver((entries) => {
          if (!entries.some((entry) => entry.contentRect.width > 0)) return;
          const latest = waiting.get(wrapper)?.level;
          stopWaiting(wrapper);
          if (wrapper.isConnected) this.applyStylesToWrapper(wrapper, latest);
        });
        waiting.set(wrapper, { observer, level });
        observer.observe(measured);
        return;
      }
      stopWaiting(wrapper);
      // The original reads `getBlockForWrapper(wrapper).getBoundingClientRect().width`; during this
      // call it gets the known width instead (see above).
      this.knownWidth = measured ? { getBoundingClientRect: () => ({ width }) } : null;
      try {
        super.applyStylesToWrapper(wrapper, level);
      } finally {
        this.knownWidth = null;
      }
    }

    /**
     * The block of a wrapper; while `applyStylesToWrapper` runs, an object that reports the
     * known redactor width (the original only reads its width there).
     * @param {HTMLElement} wrapper Tune wrapper of a block.
     * @returns {HTMLElement|{ getBoundingClientRect: () => { width: number } }|null} Block.
     */
    getBlockForWrapper(wrapper) {
      return this.knownWidth || super.getBlockForWrapper(wrapper);
    }

    constructor(options) {
      const captured = [];
      const hadOwn = Object.prototype.hasOwnProperty.call(window, 'addEventListener');
      const original = window.addEventListener;
      // Only for the duration of the original constructor: its resize listener is kept in `captured`.
      window.addEventListener = function addEventListener(type, listener, ...rest) {
        if (type === 'resize' && typeof listener === 'function') {
          captured.push(listener);
          return undefined;
        }
        return original.call(this, type, listener, ...rest);
      };
      try {
        super(options);
      } finally {
        if (hadOwn) window.addEventListener = original;
        else delete window.addEventListener;
      }
      for (const listener of captured) {
        const entry = { connected: false, guarded: null };
        entry.guarded = (event) => {
          const wrapper = this.wrapper;
          if (wrapper && wrapper.isConnected) entry.connected = true;
          else if (entry.connected) {
            remove(entry);
            return;
          }
          listener(event);
        };
        listeners.add(entry);
        window.addEventListener('resize', entry.guarded);
      }
    }
  }

  return { ToolClass: ManagedIndentTune, dispose };
};

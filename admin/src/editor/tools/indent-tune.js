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

  const dispose = () => {
    for (const entry of [...listeners]) remove(entry);
    for (const wrapper of [...waiting.keys()]) stopWaiting(wrapper);
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
      if (wrapper && measured && measured.getBoundingClientRect().width === 0) {
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
      super.applyStylesToWrapper(wrapper, level);
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

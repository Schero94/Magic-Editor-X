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
 * @returns {{ ToolClass: Function, dispose: () => void }} Tune class and cleanup.
 */
export const createIndentTune = () => {
  const listeners = new Set();
  const remove = (entry) => {
    window.removeEventListener('resize', entry.guarded);
    listeners.delete(entry);
  };

  const dispose = () => {
    for (const entry of [...listeners]) remove(entry);
  };

  class ManagedIndentTune extends IndentTune {
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

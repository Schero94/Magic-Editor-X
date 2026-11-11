import { createHistoryStack, historyKey } from './logic.mjs';

/**
 * Undo/redo for an Editor.js instance (replaces editorjs-undo, maintenance ended).
 *
 * The field calls `record()` from its onChange handler; snapshots are taken
 * with `editor.save()` after a short pause in typing. Undo/redo re-render the
 * saved state with `editor.render()`. While collaboration applies remote
 * changes the field calls `pause()`/`resume()` so they are not recorded as
 * local steps; `reset(data)` starts a new history (e.g. after loading a
 * version).
 *
 * Shortcuts (only inside the editor holder): Cmd/Ctrl+Z undo,
 * Shift+Cmd/Ctrl+Z and Ctrl+Y redo.
 *
 * @param {object} editor - Editor.js instance (ready).
 * @param {{ holder?: HTMLElement, maxSteps?: number, debounceMs?: number, onChange?: (state: { canUndo: boolean, canRedo: boolean }) => void }} [options] - Options.
 * @returns {{ record: Function, undo: Function, redo: Function, canUndo: Function, canRedo: Function, pause: Function, resume: Function, reset: Function, destroy: Function }} Manager.
 */
export const createUndoManager = (editor, options = {}) => {
  const stack = createHistoryStack({ maxSteps: options.maxSteps || 50 });
  const debounceMs = options.debounceMs ?? 400;
  const holder = options.holder || null;
  let paused = 0;
  let timer = null;
  let applying = false;
  let destroyed = false;
  const states = new Map();

  const notify = () => {
    if (typeof options.onChange === 'function')
      options.onChange({ canUndo: stack.canUndo(), canRedo: stack.canRedo() });
  };

  const remember = (data) => {
    const key = historyKey(data);
    states.set(key, data);
    return key;
  };

  const snapshot = async () => {
    if (destroyed || paused > 0 || applying) return;
    try {
      const data = await editor.save();
      if (stack.push(remember(data))) notify();
      // Keep only states the stack can still reach.
      if (states.size > (options.maxSteps || 50) * 2 + 4) {
        for (const key of Array.from(states.keys()).slice(0, states.size - (options.maxSteps || 50) * 2)) {
          if (key !== stack.current()) states.delete(key);
        }
      }
    } catch {
      // A block that cannot be saved right now is recorded with the next change.
    }
  };

  const apply = async (key) => {
    if (!key || !states.has(key)) return;
    applying = true;
    try {
      await editor.render(states.get(key));
      // The editor may serialise rendered data slightly differently; keep that as the current state.
      const rendered = await editor.save().catch(() => null);
      if (rendered) stack.replacePresent(remember(rendered));
    } finally {
      applying = false;
      notify();
    }
  };

  const onKeyDown = (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      manager.undo();
    } else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      manager.redo();
    }
  };
  if (holder) holder.addEventListener('keydown', onKeyDown, true);

  const manager = {
    /** Records the current state after the debounce. */
    record() {
      if (destroyed || paused > 0 || applying) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(snapshot, debounceMs);
    },
    /** Steps back. @returns {Promise<boolean>} True when something changed. */
    async undo() {
      window.clearTimeout(timer);
      await snapshot();
      const key = stack.undo();
      if (!key) return false;
      await apply(key);
      return true;
    },
    /** Steps forward. @returns {Promise<boolean>} True when something changed. */
    async redo() {
      const key = stack.redo();
      if (!key) return false;
      await apply(key);
      return true;
    },
    canUndo: () => stack.canUndo(),
    canRedo: () => stack.canRedo(),
    pause() {
      paused += 1;
      window.clearTimeout(timer);
    },
    resume() {
      paused = Math.max(0, paused - 1);
    },
    /** Starts a new history from `data` (or the current editor state). */
    async reset(data) {
      window.clearTimeout(timer);
      states.clear();
      const start = data || (await editor.save().catch(() => ({ blocks: [] })));
      stack.init(remember(start));
      notify();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      if (holder) holder.removeEventListener('keydown', onKeyDown, true);
      states.clear();
      stack.clear();
    },
  };

  manager.reset();
  return manager;
};

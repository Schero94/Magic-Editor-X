/**
 * Save race guard (2.7.4, m12).
 *
 * The field hands typed text to the Content Manager form 40 ms after the last input event, and
 * `editor.save()` is asynchronous. A Save click or the edit view shortcuts (Ctrl/Cmd+Enter,
 * Ctrl/Cmd+S, Ctrl/Cmd+Shift+Enter; `@strapi/content-manager` 5.63
 * `pages/EditView/utils/keyboardShortcuts.mjs`) right after typing used to save the form without
 * the last characters. While the field has a pending or running save, the guard holds such a key
 * press or a button click outside the editor, flushes the editor into the form, waits for React to
 * render the new form state and then replays the same event. Nothing is held when nothing is
 * pending.
 */

/** Events replayed by any field: a field that has nothing pending lets them through. */
const replayed = new WeakSet();

/**
 * True for the Content Manager edit view save and publish shortcuts.
 * @param {KeyboardEvent} event - Key event.
 * @returns {boolean} The event saves or publishes.
 */
export const isSaveShortcut = (event) => {
  if (!event || !(event.metaKey || event.ctrlKey)) return false;
  const key = String(event.key || '').toLowerCase();
  return key === 'enter' || (key === 's' && !event.shiftKey);
};

/** Resolves after React rendered the state set during the flush (a frame, then a task). */
const settle = () =>
  new Promise((resolve) => {
    const next = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(next);
    else next();
  });

/**
 * Holds save shortcuts and button clicks while the editor has unsaved input.
 * @param {object} options - Options.
 * @param {HTMLElement} options.holder - Editor holder; clicks inside it are never held.
 * @param {() => boolean} options.isPending - True while a save is scheduled or running.
 * @param {() => Promise<void>} options.flush - Saves the editor into the form now.
 * @returns {() => void} Removes the listeners.
 */
export const createSubmitGuard = ({ holder, isPending, flush }) => {
  let disposed = false;

  const hold = (event, replay) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve()
      .then(flush)
      .catch(() => null)
      .then(settle)
      .then(() => {
        if (!disposed) replay();
      });
  };

  const onKeyDown = (event) => {
    if (replayed.has(event) && !isPending()) return;
    if (!isSaveShortcut(event) || !isPending()) return;
    const target = event.target && event.target.isConnected ? event.target : window;
    hold(event, () => {
      const copy = new KeyboardEvent('keydown', {
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      replayed.add(copy);
      target.dispatchEvent(copy);
    });
  };

  const onClick = (event) => {
    if (replayed.has(event) && !isPending()) return;
    if (!isPending() || event.button !== 0) return;
    const button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || button.disabled || holder.contains(button)) return;
    hold(event, () => {
      if (!button.isConnected || button.disabled) return;
      const copy = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 });
      replayed.add(copy);
      button.dispatchEvent(copy);
    });
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('click', onClick, true);
  return () => {
    disposed = true;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('click', onClick, true);
  };
};

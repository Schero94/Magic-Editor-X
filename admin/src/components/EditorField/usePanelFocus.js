import { useEffect } from 'react';

/**
 * Moves focus into a field panel opened from More tools (2.7.4, m3). Runs once the panel is
 * rendered (next animation frame, after the menu released focus) and leaves focus alone when
 * something inside the panel already has it (a thread or suggestion a marker asked for, a new
 * comment's text box). The panel's close action returns focus to More tools.
 * @param {boolean} enabled - The panel was opened from the menu.
 * @param {import('react').RefObject<HTMLElement>} targetRef - Focus target (the panel heading, `tabIndex={-1}`).
 * @returns {void}
 */
export const usePanelAutoFocus = (enabled, targetRef) => {
  useEffect(() => {
    if (!enabled) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = targetRef.current;
      if (!target || !target.isConnected) return;
      const panel = target.closest('section') || target.parentElement;
      if (panel && panel.contains(document.activeElement)) return;
      target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, targetRef]);
};

/**
 * Escape inside a field panel closes it (2.7.8). Keys an inner control already handled (an open
 * select, menu or dialog prevents the default) and keys inside a dialog are left alone.
 * @param {KeyboardEvent|import('react').KeyboardEvent} event - Key event.
 * @param {() => void} onClose - Closes the panel (returns focus to More tools).
 * @returns {void}
 */
export const closeOnEscape = (event, onClose) => {
  if (event.key !== 'Escape' || event.defaultPrevented || typeof onClose !== 'function') return;
  const target = event.target;
  if (
    target &&
    typeof target.closest === 'function' &&
    target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  onClose();
};

/**
 * Puts focus back on an element after a dialog closed (2.7.8). Radix restores focus to the
 * element focused before the dialog, which is lost when the dialog was nested in a modal or
 * opened from code; two frames later the element (when still in the page) gets it explicitly.
 * @param {HTMLElement|{ current: HTMLElement|null }|(() => HTMLElement|null)|null|undefined} element - Element to
 *   focus (the opener), a ref or a getter.
 * @returns {void}
 */
export const refocusLater = (element) => {
  if (!element || typeof window === 'undefined') return;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      // A ref is read late: the element may only exist after the next render (a Reply button).
      const target =
        typeof element === 'function' ? element() : 'current' in element ? element.current : element;
      if (target && target.isConnected) target.focus();
    })
  );
};

/**
 * After an action whose button was disabled while busy, focus goes back to that button when it
 * fell to the page body (2.7.8). Focus that moved somewhere on purpose stays there.
 * @param {HTMLElement|{ current: HTMLElement|null }|(() => HTMLElement|null)|null|undefined} element - Button, ref or getter.
 * @returns {void}
 */
export const refocusIfLost = (element) => {
  if (!element || typeof window === 'undefined') return;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target =
        typeof element === 'function' ? element() : 'current' in element ? element.current : element;
      if (target && target.isConnected) target.focus();
    })
  );
};

/**
 * When a panel opens and focus is on the page body (the element that had it was removed, for
 * example the suggest-mode editor after "Send suggestions"), the panel heading takes it (2.7.8).
 * Called as a hook; runs once after mount.
 * @param {import('react').RefObject<HTMLElement>} targetRef - Panel heading (`tabIndex={-1}`).
 * @returns {void}
 */
export const useClaimLostFocus = (targetRef) => {
  useEffect(() => {
    refocusIfLost(targetRef);
  }, [targetRef]);
};

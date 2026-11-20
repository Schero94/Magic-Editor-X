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

import { useEffect, useId, useRef } from 'react';

/**
 * One Escape closes a plugin dialog, also while a tooltip is open.
 *
 * DS `IconButton` (and `Tooltip`) open a Radix tooltip on keyboard focus and
 * on hover. The tooltip is a Radix dismissable layer above the dialog, and
 * Radix gives Escape only to the top layer: the first Escape closed the
 * tooltip, the dialog needed another one (or two, when the tooltip opened
 * again on the focused button). This hook listens on `window` in the capture
 * phase, before Radix's own listener on `document`. When a tooltip is open
 * and focus is inside this dialog (not inside a nested dialog, menu or
 * select), it closes the dialog directly.
 *
 * @param {() => void} onEscape - Closes the dialog (the same handler as its Cancel/Close).
 * @param {boolean} [enabled] - False while the dialog must not close (a request is running).
 * @returns {{ 'data-mex-escape': string }} Spread on `Modal.Content` (the `role="dialog"` element).
 */
export const useTooltipSafeEscape = (onEscape, enabled = true) => {
  const id = useId();
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Without an open tooltip Radix already closes the dialog on the first Escape.
      if (!document.querySelector('[role="tooltip"]')) return;
      const active = document.activeElement;
      const layer = active && active.closest ? active.closest('[role="dialog"], [role="alertdialog"]') : null;
      if (!layer || layer.getAttribute('data-mex-escape') !== id) return;
      event.preventDefault();
      event.stopPropagation();
      handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, id]);
  return { 'data-mex-escape': id };
};

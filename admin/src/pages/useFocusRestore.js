import { useCallback, useEffect, useRef, useState } from 'react';
import { restoreFocus } from './focusTargets.mjs';

/**
 * Focus after the next render (2.7.8). Returns `requestFocus(candidates, options)`: after React
 * has committed the update that follows (a button leaves its loading state, a list reloads, a
 * view is replaced) and the browser has laid it out, focus moves to the first candidate that can
 * take it, see `restoreFocus`. A later commit before that frame postpones the move, so it always
 * runs against the final DOM. Pending moves are cancelled on unmount.
 * @returns {(candidates: Array<unknown>, options?: { force?: boolean }) => void} Request function.
 */
export const useFocusRestore = () => {
  const pending = useRef(null);
  const [, setTick] = useState(0);

  // No dependency list on purpose: every commit re-schedules a pending move for the next frame.
  useEffect(() => {
    if (!pending.current || typeof window === 'undefined') return undefined;
    const job = pending.current;
    const frame = window.requestAnimationFrame(() => {
      if (pending.current === job) pending.current = null;
      restoreFocus(job.candidates, { force: Boolean(job.options && job.options.force) });
    });
    return () => window.cancelAnimationFrame(frame);
  });

  return useCallback((candidates, options) => {
    pending.current = { candidates, options };
    setTick((value) => value + 1);
  }, []);
};

/**
 * The element that has focus now (the control the user just used), or null.
 * @returns {Element|null} Element.
 */
export const activeElement = () =>
  typeof document !== 'undefined' && document.activeElement !== document.body ? document.activeElement : null;

export default useFocusRestore;

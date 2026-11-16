import { useCallback, useLayoutEffect, useState } from 'react';
import { isNearViewport } from '../../editor/lazy-init.mjs';

/**
 * Lazy start of an editor field (2.5): `active` turns true (and stays true)
 * once the element comes within `marginPx` of the viewport
 * (IntersectionObserver), or when `activate()` is called (focus, click,
 * restoring a draft). A field near the viewport when it mounts is active
 * before the first paint, so fields in view start exactly as before.
 * `deferred` is true when the field was not active on its first layout (it
 * shows the static placeholder until the editor is ready).
 * @param {import('react').RefObject<HTMLElement>} elementRef - Field frame.
 * @param {{ enabled: boolean, marginPx: number }} options - Config `lazyInit`.
 * @returns {{ active: boolean, deferred: boolean, activate: () => void }} State.
 */
export const useLazyActivation = (elementRef, { enabled, marginPx }) => {
  const [state, setState] = useState({ active: !enabled, deferred: false });
  const activate = useCallback(
    () => setState((current) => (current.active ? current : { ...current, active: true })),
    []
  );
  useLayoutEffect(() => {
    if (state.active) return undefined;
    const element = elementRef.current;
    if (
      !enabled ||
      !element ||
      typeof IntersectionObserver === 'undefined' ||
      isNearViewport(element.getBoundingClientRect(), window.innerHeight, marginPx)
    ) {
      activate();
      return undefined;
    }
    setState((current) => (current.deferred ? current : { ...current, deferred: true }));
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) activate();
      },
      { rootMargin: `${marginPx}px 0px ${marginPx}px 0px` }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, marginPx, state.active, elementRef, activate]);
  return { active: state.active, deferred: state.deferred, activate };
};

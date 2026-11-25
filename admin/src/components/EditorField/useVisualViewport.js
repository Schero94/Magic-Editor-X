import { useEffect } from 'react';

/** CSS custom properties written on the element (read by the full screen frame and the panel sheets). */
export const VIEWPORT_VARS = ['--mex-vv-height', '--mex-vv-top', '--mex-keyboard-inset'];

/**
 * Visual viewport values for CSS (2.12.1): the height and top of the visual
 * viewport and the part of the layout viewport an on-screen keyboard covers.
 * @param {{ height: number, offsetTop: number }} viewport - `window.visualViewport`.
 * @param {number} layoutHeight - `window.innerHeight`.
 * @returns {{ height: number, top: number, keyboard: number }} Pixels.
 */
export const viewportMetrics = (viewport, layoutHeight) => {
  const height = Math.max(0, Math.round(viewport.height));
  const top = Math.max(0, Math.round(viewport.offsetTop));
  return { height, top, keyboard: Math.max(0, Math.round(layoutHeight - height - top)) };
};

/**
 * Keeps full screen editing and the panel sheets above an on-screen keyboard.
 *
 * Phones open the keyboard over the page: the visual viewport shrinks, the
 * layout viewport (and with it `position: fixed; inset: 0` and `100vh`)
 * does not, so the bottom of a full screen editor or a bottom sheet would sit
 * behind the keyboard. While `active`, this hook writes the visual viewport
 * height, its top and the covered part as CSS custom properties on the
 * element (`--mex-vv-height`, `--mex-vv-top`, `--mex-keyboard-inset`), at most
 * once per frame, and removes them afterwards. The element's styles fall back
 * to the layout viewport where `visualViewport` does not exist.
 * @param {import('react').RefObject<HTMLElement>} ref - Element that receives the properties.
 * @param {boolean} active - Full screen or a panel sheet is shown.
 * @returns {void}
 */
export const useVisualViewport = (ref, active) => {
  useEffect(() => {
    const element = ref.current;
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !element || !viewport) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { height, top, keyboard } = viewportMetrics(viewport, window.innerHeight);
      element.style.setProperty('--mex-vv-height', `${height}px`);
      element.style.setProperty('--mex-vv-top', `${top}px`);
      element.style.setProperty('--mex-keyboard-inset', `${keyboard}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      VIEWPORT_VARS.forEach((name) => element.style.removeProperty(name));
    };
  }, [ref, active]);
};

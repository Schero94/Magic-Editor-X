import { startTransition, useEffect, useRef, useState } from 'react';
import { createInsightsRunner } from '../../../../shared/content-insights.mjs';

/** Pause after the last change before the hints are recomputed. */
const DEBOUNCE_MS = 300;
/** Longest slice of work per idle callback; well below the 50 ms long-task limit. */
const SLICE_MS = 8;

/**
 * Schedules one slice in idle time (with a timeout, so hints still arrive on a busy page).
 * @param {() => void} fn - Slice.
 * @returns {{ idle: boolean, id: number }} Handle.
 */
const scheduleSlice = (fn) =>
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? { idle: true, id: window.requestIdleCallback(fn, { timeout: 500 }) }
    : { idle: false, id: setTimeout(fn, 0) };

const cancelSlice = (handle) => {
  if (!handle) return;
  if (handle.idle) window.cancelIdleCallback(handle.id);
  else clearTimeout(handle.id);
};

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Readability and SEO hints of the current content (2.9). Runs only while
 * `enabled` (the Quality panel is open), waits for a pause in typing and
 * analyses the text in idle-time slices of at most 8 ms, so even 2,000 blocks
 * never cause a long task. Unchanged paragraphs come from a cache.
 * @param {object|null} data - Current editor data.
 * @param {{ enabled: boolean, language: string|null, settings: object, keyphrase: string }} options - Options.
 * @returns {{ result: ReturnType<import('../../../../shared/content-insights.mjs').summarizeInsights>|null, pending: boolean }} Latest result.
 */
export const useContentInsights = (data, { enabled, language, settings, keyphrase }) => {
  const runnerRef = useRef(null);
  // `input` is what the result was computed from; anything newer is still pending.
  const [state, setState] = useState({ result: null, input: null });

  useEffect(() => {
    if (!runnerRef.current)
      runnerRef.current = createInsightsRunner({
        schedule: scheduleSlice,
        cancel: cancelSlice,
        now,
        budgetMs: SLICE_MS,
      });
    const runner = runnerRef.current;
    if (!enabled) {
      runner.cancel();
      return undefined;
    }
    let active = true;
    const input = { data, language, settings, keyphrase };
    const timer = setTimeout(() => {
      runner.run(data, { language, settings, keyphrase }, (result) => {
        if (!active) return;
        startTransition(() => setState({ result, input }));
      });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
      runner.cancel();
    };
  }, [data, enabled, language, settings, keyphrase]);

  if (!enabled) return { result: null, pending: false };
  const input = state.input;
  const pending =
    !input ||
    input.data !== data ||
    input.language !== language ||
    input.settings !== settings ||
    input.keyphrase !== keyphrase;
  return { result: state.result, pending };
};

export default useContentInsights;

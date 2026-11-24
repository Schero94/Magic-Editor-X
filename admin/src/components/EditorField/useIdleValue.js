import { useEffect, useState } from 'react';

/**
 * A value that follows `value` once changes have paused for `delayMs` and the
 * browser is idle (2.10.1). Work that only feeds a summary, such as the
 * problem count on "More tools", reads this copy, so it runs after typing
 * stops instead of after every save of a long document.
 * @template T
 * @param {T} value - Current value.
 * @param {number} [delayMs=600] - Quiet time before the copy follows.
 * @returns {T} The value as of the last pause.
 */
export const useIdleValue = (value, delayMs = 600) => {
  const [idle, setIdle] = useState(value);
  useEffect(() => {
    if (Object.is(value, idle)) return undefined;
    let handle = 0;
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function')
        handle = window.requestIdleCallback(() => setIdle(() => value), { timeout: 2000 });
      else setIdle(() => value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      if (handle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
    };
  }, [value, idle, delayMs]);
  return idle;
};

export default useIdleValue;

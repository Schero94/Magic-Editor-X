import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'styled-components';

/**
 * Turns a DS breakpoint (`@media(min-width: 768px)`) into a matchMedia query.
 * @param {unknown} breakpoint - Theme breakpoint string.
 * @returns {string} Media query without the `@media` prefix.
 */
const toQuery = (breakpoint) =>
  typeof breakpoint === 'string' ? breakpoint.replace(/^\s*@media\s*/i, '').trim() : '';

/**
 * Reads the DS breakpoints (small 520, medium 768, large 1080) from the theme.
 * The fallbacks below are used only when the theme has no breakpoints.
 * @returns {{ isBelowSmall: boolean, isBelowMedium: boolean, isBelowLarge: boolean }} Flags.
 */
export const useBreakpoint = () => {
  const theme = useTheme();
  const queries = useMemo(
    () => ({
      small: toQuery(theme && theme.breakpoints && theme.breakpoints.small) || '(min-width: 520px)',
      medium: toQuery(theme && theme.breakpoints && theme.breakpoints.medium) || '(min-width: 768px)',
      large: toQuery(theme && theme.breakpoints && theme.breakpoints.large) || '(min-width: 1080px)',
    }),
    [theme]
  );
  const read = useMemo(
    () => () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return { small: true, medium: true, large: true };
      }
      return Object.fromEntries(
        Object.entries(queries).map(([key, query]) => [key, window.matchMedia(query).matches])
      );
    },
    [queries]
  );
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const lists = Object.values(queries).map((query) => window.matchMedia(query));
    const update = () => setMatches(read());
    update();
    lists.forEach((list) => list.addEventListener('change', update));
    return () => lists.forEach((list) => list.removeEventListener('change', update));
  }, [queries, read]);
  return { isBelowSmall: !matches.small, isBelowMedium: !matches.medium, isBelowLarge: !matches.large };
};

export default useBreakpoint;

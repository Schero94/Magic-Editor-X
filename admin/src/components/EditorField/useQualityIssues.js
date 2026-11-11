import { useMemo } from 'react';
import { lintDocument } from '../../../../shared/quality.mjs';

/**
 * Accessibility lint of the current editor content (memoised per content and
 * field options). The toolbar uses `stats.errors + stats.warnings` for its
 * badge; the quality panel lists `issues`.
 * @param {object|null} data - Editor data.
 * @param {object} [options] - Field options (`attribute.options`), reads `requireAlt`.
 * @returns {{ issues: Array<object>, stats: { errors: number, warnings: number, blocks: number, links: number, images: number } }} Lint result.
 */
export const useQualityIssues = (data, options) => {
  const requireAlt = Boolean(options && options.requireAlt === true);
  return useMemo(() => lintDocument(data, { requireAlt }), [data, requireAlt]);
};

export default useQualityIssues;

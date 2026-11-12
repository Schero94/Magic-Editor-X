import { useEffect, useMemo, useState } from 'react';
import { lintDocument } from '../../../../shared/quality.mjs';
import { MATH_ATTRIBUTE } from '../../../../shared/sanitize-policy.mjs';
import { loadMath } from '../../editor/math-view';

/**
 * True when the document has math (2.4), so the TeX check is worth loading.
 * @param {object|null} data - Editor data.
 * @returns {boolean} Result.
 */
const hasMath = (data) =>
  Boolean(
    data &&
    Array.isArray(data.blocks) &&
    data.blocks.some(
      (block) =>
        block &&
        (block.type === 'math' || (block.data && JSON.stringify(block.data).includes(MATH_ATTRIBUTE)))
    )
  );

/**
 * Accessibility lint of the current editor content (memoised per content and
 * field options). The toolbar uses `stats.errors + stats.warnings` for its
 * badge; the quality panel lists `issues`. With math in the document the TeX
 * check (`checkMath`, loaded on demand) adds `math-invalid`.
 * @param {object|null} data - Editor data.
 * @param {object} [options] - Field options (`attribute.options`), reads `requireAlt`.
 * @returns {{ issues: Array<object>, stats: { errors: number, warnings: number, blocks: number, links: number, images: number } }} Lint result.
 */
export const useQualityIssues = (data, options) => {
  const requireAlt = Boolean(options && options.requireAlt === true);
  const [checkMath, setCheckMath] = useState(null);
  const needsMath = hasMath(data);
  useEffect(() => {
    if (!needsMath || checkMath) return undefined;
    let active = true;
    loadMath()
      .then((module) => {
        if (active) setCheckMath(() => module.checkMath);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [needsMath, checkMath]);
  return useMemo(
    () => lintDocument(data, { requireAlt, checkMath: checkMath || undefined }),
    [data, requireAlt, checkMath]
  );
};

export default useQualityIssues;

/**
 * Math helper (`magic-editor-x/math`, 2.4): TeX to MathML with Temml, for the
 * `math` render option.
 */

/** Temml settings used by the helper. */
export const MATH_SETTINGS: Readonly<{
  trust: false;
  throwOnError: true;
  strict: false;
  annotate: true;
  xml: false;
  wrap: 'none';
  maxSize: readonly [number, number];
  maxExpand: number;
}>;

/** MathML (`<math>…</math>`) or null when the TeX is empty, too long or does not parse. Never throws. */
export function renderMath(tex: unknown, options?: { display?: boolean }): string | null;

/** Whether the TeX parses; `message` explains the error (plain text, may quote the TeX). */
export function checkMath(
  tex: unknown,
  options?: { display?: boolean }
): { ok: true } | { ok: false; message: string };

export default renderMath;

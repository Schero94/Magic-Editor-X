/**
 * Focus helpers for dialogs: focus goes back to the trigger, or to a stable
 * fallback when the trigger is gone (deleted row) or disabled. Never to <body>.
 */

/**
 * @param {Element|null|undefined} el - Candidate.
 * @returns {boolean} True when the element can take focus.
 */
const canTakeFocus = (el) =>
  Boolean(
    el &&
    el.isConnected &&
    typeof el.focus === 'function' &&
    !el.disabled &&
    (typeof el.getAttribute !== 'function' || el.getAttribute('aria-disabled') !== 'true')
  );

/**
 * Picks the element that should receive focus.
 * @param {Element|null|undefined} opener - Trigger.
 * @param {Element|null|undefined} fallback - Stable fallback.
 * @returns {Element|null} Target.
 */
export const pickFocusTarget = (opener, fallback) => {
  if (canTakeFocus(opener)) return opener;
  if (canTakeFocus(fallback)) return fallback;
  return null;
};

/**
 * Moves focus to the trigger or fallback only when focus was lost to <body>.
 * @param {Element|null|undefined} opener - Trigger.
 * @param {Element|null|undefined} fallback - Stable fallback.
 * @param {Document} [doc] - Document.
 */
export const refocusIfLost = (opener, fallback, doc = globalThis.document) => {
  if (!doc) return;
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  const target = pickFocusTarget(opener, fallback);
  if (target) target.focus();
};

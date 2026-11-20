/**
 * Focus targets of the settings pages (2.7.8). After an action disables, re-renders or replaces
 * the control that had focus (a button in its loading state, a list that reloads, a view that is
 * swapped), focus goes back to that control or to a stable target, never to <body>. No React,
 * so `node --test` covers it with a small DOM.
 */

/** Candidate that stands for the page title (h1 of Layouts.Header). */
export const PAGE_HEADING = Object.freeze({ pageHeading: true });

/**
 * True when nothing useful has focus: <body>, nothing, an element that left the DOM, or a control
 * that is disabled now (Chromium moves focus to <body> then, other engines leave it stranded).
 * @param {Document} doc - Document.
 * @returns {boolean} Lost or not.
 */
export const isFocusLost = (doc) => {
  const active = doc.activeElement;
  return !active || active === doc.body || active.isConnected === false || active.disabled === true;
};

/**
 * @param {Element|null|undefined} el - Candidate.
 * @returns {boolean} True when the element can take focus now.
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
 * The page title: the element `main[aria-labelledby]` points at (PageShell gives the
 * Layouts.Header h1 that id), else the first h1 in main.
 * @param {Document} doc - Document.
 * @returns {HTMLElement|null} Heading.
 */
export const pageHeading = (doc) => {
  const main = doc.querySelector('main[aria-labelledby]');
  const id = main && main.getAttribute('aria-labelledby');
  return (id && doc.getElementById(id)) || doc.querySelector('main h1');
};

/**
 * Focuses the page title. It gets `tabindex="-1"` so it can take focus from script without
 * becoming a tab stop.
 * @param {Document} doc - Document.
 * @returns {boolean} True when the title has focus.
 */
export const focusPageHeading = (doc) => {
  const heading = pageHeading(doc);
  if (!heading) return false;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
  return doc.activeElement === heading;
};

/**
 * Resolves one candidate: an element, a ref object, a function `(doc) => element` or a CSS
 * selector.
 * @param {unknown} candidate - Candidate.
 * @param {Document} doc - Document.
 * @returns {Element|null} Element.
 */
const resolve = (candidate, doc) => {
  if (!candidate) return null;
  if (typeof candidate === 'function') return candidate(doc) || null;
  if (typeof candidate === 'string') return doc.querySelector(candidate);
  if (typeof candidate === 'object' && !('nodeType' in candidate) && 'current' in candidate)
    return candidate.current || null;
  return candidate;
};

/**
 * Moves focus to the first candidate that can take it. Without `force` it only acts when focus
 * was lost (see `isFocusLost`), so it never steals focus the user already moved elsewhere.
 * @param {Array<unknown>} candidates - Elements, refs, `(doc) => element`, selectors or PAGE_HEADING, in order.
 * @param {{ doc?: Document, force?: boolean }} [options] - Document; `force` moves focus even when it is not lost.
 * @returns {Element|null} The element that has focus afterwards, or null when nothing could take it.
 */
export const restoreFocus = (candidates, { doc = globalThis.document, force = false } = {}) => {
  if (!doc) return null;
  if (!force && !isFocusLost(doc)) return doc.activeElement;
  for (const candidate of candidates) {
    if (candidate === PAGE_HEADING) {
      if (focusPageHeading(doc)) return doc.activeElement;
      continue;
    }
    const el = resolve(candidate, doc);
    if (canTakeFocus(el)) {
      el.focus();
      if (doc.activeElement === el) return el;
    }
  }
  return null;
};

/**
 * First field marked invalid inside main (DS Field.Root sets aria-invalid on its input).
 * @param {Document} doc - Document.
 * @returns {Element|null} Field.
 */
export const firstInvalidField = (doc) => doc.querySelector('main [aria-invalid="true"]');

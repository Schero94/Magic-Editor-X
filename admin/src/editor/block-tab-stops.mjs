/**
 * Keyboard path to the controls inside blocks (2.7.8, re-audit major 2).
 *
 * Editor.js handles Tab inside a block: it moves the caret to the next
 * *text input* (`[contenteditable]`, text inputs, textareas) and prevents the
 * default, so buttons, selects, checkboxes and switches that a block renders
 * (audio and video "Choose", person photo, toggle show/hide, column style and
 * layout, the button block's style and "new tab") were never reached.
 *
 * This module computes the tab stops of an editor in document order (text
 * inputs plus those controls) and the next stop for Tab or Shift+Tab. The
 * field steps in only when the next or previous stop is a control, or when
 * focus is on a control; text-to-text moves are left to Editor.js, and tools
 * that use Tab themselves (lists, tables, code) keep it.
 *
 * Pure DOM queries, no Editor.js internals beyond its public class names.
 */

/** Text inputs as Editor.js finds them. */
const TEXT_SELECTOR =
  '[contenteditable="true"], textarea, input:not([type]), input[type="text"], input[type="url"], input[type="email"], input[type="number"], input[type="search"]';

/** Controls a block may render. */
const CONTROL_SELECTOR =
  'button, select, input[type="checkbox"], input[type="radio"], input[type="file"]:not([hidden]), [role="switch"], [role="combobox"], [role="button"][tabindex], [tabindex="0"]:not([contenteditable]), a[href]';

/** Editor chrome that is not part of a block (own keyboard handling or reached otherwise). */
const OUTSIDE_BLOCKS = '.ce-toolbar, .ce-popover, .ce-inline-toolbar, .ce-conversion-toolbar, .ce-settings';

/** Blocks whose tools use Tab themselves (nested lists, table cells, code indentation). */
const OWN_TAB =
  '.cdx-list, .cdx-nested-list, .cdx-checklist, .mex-table, table, .ce-code, .mex-code, textarea';

/**
 * True for an element that can take focus from Tab.
 * @param {Element} element - Candidate.
 * @param {(element: Element) => boolean} isVisible - Visibility check (rendered and not hidden).
 * @returns {boolean} Result.
 */
const focusable = (element, isVisible) => {
  if (!element || element.closest(OUTSIDE_BLOCKS)) return false;
  if (!element.closest('.ce-block')) return false;
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.getAttribute('tabindex') === '-1') return false;
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  return isVisible(element);
};

/**
 * True when the element is a text input (Editor.js moves between these itself).
 * @param {Element|null} element - Element.
 * @returns {boolean} Result.
 */
export const isTextStop = (element) => Boolean(element && element.matches && element.matches(TEXT_SELECTOR));

/**
 * Tab stops of an editor in document order.
 * @param {Element} holder - Editor holder.
 * @param {(element: Element) => boolean} [isVisible] - Visibility check.
 * @returns {Element[]} Stops.
 */
export const tabStops = (holder, isVisible = (element) => element.getClientRects().length > 0) => {
  if (!holder) return [];
  return Array.from(holder.querySelectorAll(`${TEXT_SELECTOR}, ${CONTROL_SELECTOR}`)).filter(
    (element, index, all) =>
      focusable(element, isVisible) &&
      // A control inside a contenteditable (an inline chip) is part of the text.
      !(
        element.matches(CONTROL_SELECTOR) &&
        element.parentElement &&
        element.parentElement.closest('[contenteditable="true"]')
      ) &&
      all.indexOf(element) === index
  );
};

/**
 * The stop to focus for Tab or Shift+Tab, or null to leave the key to Editor.js and the tools.
 * @param {Element} holder - Editor holder.
 * @param {Element|null} active - Focused element.
 * @param {boolean} backwards - Shift+Tab.
 * @param {(element: Element) => boolean} [isVisible] - Visibility check.
 * @returns {{ target: Element|null, handled: boolean }} `handled` false: do nothing; `target` null with
 *   `handled` true: no stop left in this direction (focus leaves the editor the browser's way).
 */
export const nextTabStop = (holder, active, backwards, isVisible) => {
  if (!holder || !active || !holder.contains(active)) return { target: null, handled: false };
  const stops = tabStops(holder, isVisible);
  // The focused stop itself first: a stop can contain another (the clear button inside a combobox).
  const current =
    stops.find((stop) => stop === active) || stops.filter((stop) => stop.contains(active)).pop() || null;
  if (!current) return { target: null, handled: false };
  const onControl = !isTextStop(current);
  // Tools that use Tab themselves keep it while the caret is in their text.
  if (!onControl && current.closest(OWN_TAB)) return { target: null, handled: false };
  const index = stops.indexOf(current);
  const target = stops[backwards ? index - 1 : index + 1] || null;
  if (onControl) return { target, handled: true };
  if (target && !isTextStop(target)) return { target, handled: true };
  // A form input in another block (component blocks render Design System inputs): Editor.js
  // focuses it without preventing the default, so the browser moved one stop further.
  if (
    target &&
    !target.matches('[contenteditable="true"]') &&
    target.closest('.ce-block') !== current.closest('.ce-block')
  )
    return { target, handled: true };
  return { target: null, handled: false };
};

/**
 * Puts focus on a stop; a text stop gets the caret at its start (Tab) or end (Shift+Tab).
 * @param {Element} target - Stop.
 * @param {boolean} backwards - Shift+Tab.
 * @returns {void}
 */
export const focusTabStop = (target, backwards) => {
  target.focus({ preventScroll: false });
  if (!isTextStop(target) || target.getAttribute('contenteditable') !== 'true') return;
  const selection = target.ownerDocument.defaultView.getSelection();
  if (!selection) return;
  const range = target.ownerDocument.createRange();
  range.selectNodeContents(target);
  range.collapse(!backwards);
  selection.removeAllRanges();
  selection.addRange(range);
};

/** Blocks whose controls have their own keyboard entry (the table tools: Alt+F10). */
const OWN_CONTROLS = '.mex-table, table';

/**
 * Controls that Editor.js skipped when an arrow key moved the caret from one text input to another
 * (2.7.8): blocks without text (audio, video) and buttons before or after a block's text (toggle,
 * columns) are otherwise never reached with the arrow keys. Returns the control to focus instead,
 * the nearest one in the direction of the move, or null.
 * @param {Element} holder - Editor holder.
 * @param {Element|null} from - Focused element before the key.
 * @param {Element|null} to - Focused element after Editor.js handled the key.
 * @param {(element: Element) => boolean} [isVisible] - Visibility check.
 * @returns {Element|null} Control.
 */
export const skippedControl = (holder, from, to, isVisible) => {
  if (!holder || !from || !to || from === to || !holder.contains(from) || !holder.contains(to)) return null;
  const fromBlock = from.closest('.ce-block');
  const toBlock = to.closest('.ce-block');
  if (!fromBlock || !toBlock || fromBlock === toBlock) return null;
  const stops = tabStops(holder, isVisible);
  const position = (element) => {
    const exact = stops.indexOf(element);
    if (exact >= 0) return exact;
    let found = -1;
    stops.forEach((stop, index) => {
      if (stop.contains(element)) found = index;
    });
    return found;
  };
  const a = position(from);
  const b = position(to);
  if (a < 0 || b < 0) return null;
  const forward = b > a;
  const between = stops
    .slice(Math.min(a, b) + 1, Math.max(a, b))
    // A select or combobox changes its value with the arrow keys; Tab reaches those.
    .filter(
      (stop) => !isTextStop(stop) && !stop.closest(OWN_CONTROLS) && !stop.matches('select, [role="combobox"]')
    );
  if (!between.length) return null;
  return forward ? between[0] : between[between.length - 1];
};

/**
 * User input tracking for the editor holder.
 *
 * The field reports content to the Content Manager form only after the person
 * has edited it (Editor.js also reports changes when it normalises stored
 * content on the first render, which must not mark the form as modified).
 * Input therefore has to be seen from the moment Editor.js makes the blocks
 * editable, not only once the React effects of the field have run: after the
 * create -> edit redirect of the Content Manager, several fields mount at once
 * and a person (or a test) can type in between, and that text never reached
 * the form (Save stayed disabled).
 */

/** Events that mean a person is editing the field. */
export const USER_INPUT_EVENTS = Object.freeze(['pointerdown', 'keydown', 'input', 'paste', 'drop']);

/** Attribute set on the holder once typing into the field is reported to the form. */
export const READY_ATTRIBUTE = 'data-mex-ready';

/**
 * Calls `onInput` for every user input event inside `holder` (capture phase,
 * so it runs before Editor.js handles the event).
 * @param {EventTarget} holder - Editor holder element.
 * @param {(event: Event) => void} onInput - Called for each input event.
 * @returns {() => void} Removes the listeners.
 */
export const trackUserInput = (holder, onInput) => {
  if (!holder || typeof holder.addEventListener !== 'function') return () => {};
  const listener = (event) => onInput(event);
  const options = { capture: true };
  USER_INPUT_EVENTS.forEach((type) => holder.addEventListener(type, listener, options));
  return () => USER_INPUT_EVENTS.forEach((type) => holder.removeEventListener(type, listener, options));
};

/**
 * Marks the holder as ready for typing (`data-mex-ready="true"`) and returns
 * a function that removes the mark again.
 * @param {{ setAttribute: Function, removeAttribute: Function }|null} holder - Editor holder element.
 * @returns {() => void} Clears the mark.
 */
export const markInputReady = (holder) => {
  if (!holder || typeof holder.setAttribute !== 'function') return () => {};
  holder.setAttribute(READY_ATTRIBUTE, 'true');
  return () => holder.removeAttribute(READY_ATTRIBUTE);
};

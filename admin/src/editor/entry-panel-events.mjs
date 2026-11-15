import { fieldIdentity } from '../../../shared/field-identity.mjs';

/**
 * 2.5: the Magic Editor X side panel asks one editor field to open a panel (comments or quality)
 * with a window event; the field whose identity (or, for a positional field without a saved key,
 * whose path) matches opens it and scrolls into view.
 */
export const OPEN_FIELD_PANEL_EVENT = 'magic-editor-x:open-field-panel';

/** Panels a field can open on request. */
export const FIELD_PANELS = Object.freeze(['comments', 'quality']);

/**
 * Asks the editor field to open one of its panels.
 * The matching field sets `detail.handled`; a field that is not mounted (inside a collapsed
 * repeatable component or dynamic zone entry of the form) does not answer.
 * @param {{ field: string|null, path: string, panel: 'comments'|'quality' }} detail - Field identity (or null), current path and panel.
 * @returns {boolean} True when a field opened the panel.
 */
export const requestFieldPanel = (detail) => {
  if (typeof window === 'undefined' || !detail || !FIELD_PANELS.includes(detail.panel)) return false;
  const payload = { field: detail.field || null, path: detail.path, panel: detail.panel, handled: false };
  window.dispatchEvent(new CustomEvent(OPEN_FIELD_PANEL_EVENT, { detail: payload }));
  return payload.handled === true;
};

/**
 * True when a request names this field.
 * @param {{ field?: string|null, path?: string }|null} detail - Request.
 * @param {{ path: string, savedKey: string|null }} field - The editor field (`target.field` and its saved key).
 * @returns {boolean} Result.
 */
export const matchesFieldRequest = (detail, { path, savedKey }) => {
  if (!detail || typeof path !== 'string') return false;
  if (detail.field) return fieldIdentity(path, savedKey) === detail.field;
  return detail.path === path;
};

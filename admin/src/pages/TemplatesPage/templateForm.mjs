/**
 * Pure form logic of the Templates settings page (tested with node --test):
 * empty values, DTO -> form, validation with the server's bounds, payload,
 * server error mapping and the dirty check.
 */

import { TEMPLATE_LIMITS, isEmptyDocument, normalizeScope } from '../../../../shared/templates.mjs';
import { PRESET_NAMES } from '../../../../shared/presets.mjs';

export { PRESET_NAMES };

/**
 * Key of a scope field option (`uid|field`).
 * @param {{ uid: string, field: string }} entry - Field.
 * @returns {string} Key.
 */
export const fieldKey = (entry) => `${entry.uid}|${entry.field}`;

/**
 * Field from an option key.
 * @param {string} key - `uid|field`.
 * @returns {{ uid: string, field: string }} Field.
 */
export const fieldFromKey = (key) => {
  const [uid, field] = String(key).split('|');
  return { uid, field };
};

/** @returns {object} Values of a new template. */
export const emptyValues = () => ({
  name: '',
  description: '',
  kind: 'template',
  enabled: true,
  scopeMode: 'all',
  presets: [],
  fields: [],
  blocks: null,
});

/**
 * Form values of a stored template.
 * @param {object} dto - Template DTO.
 * @returns {object} Values.
 */
export const fromDto = (dto) => {
  const scope = normalizeScope(dto.scope);
  return {
    name: dto.name || '',
    description: dto.description || '',
    kind: dto.kind === 'pattern' ? 'pattern' : 'template',
    enabled: dto.enabled !== false,
    scopeMode: scope.all ? 'all' : 'limited',
    presets: scope.presets,
    fields: scope.fields.map(fieldKey),
    blocks: dto.blocks && Array.isArray(dto.blocks.blocks) ? dto.blocks : null,
  };
};

/**
 * Validates values with the server's rules.
 * @param {object} values - Form values.
 * @returns {Record<string, string>} Error codes by field (`required`, `tooLong`, `scope`, `content`, `tooManyBlocks`).
 */
export const validateTemplate = (values) => {
  const errors = {};
  const name = String(values.name || '').trim();
  if (!name) errors.name = 'required';
  else if (name.length > TEMPLATE_LIMITS.name) errors.name = 'tooLong';
  if (String(values.description || '').trim().length > TEMPLATE_LIMITS.description)
    errors.description = 'tooLong';
  if (values.scopeMode === 'limited' && !values.presets.length && !values.fields.length)
    errors.scope = 'scope';
  if (isEmptyDocument(values.blocks)) errors.blocks = 'content';
  else if (values.blocks.blocks.length > TEMPLATE_LIMITS.blocks) errors.blocks = 'tooManyBlocks';
  return errors;
};

/**
 * Request body for POST/PUT /templates.
 * @param {object} values - Valid form values.
 * @returns {object} Payload.
 */
export const toPayload = (values) => ({
  name: String(values.name).trim(),
  description: String(values.description || '').trim() || null,
  kind: values.kind,
  enabled: values.enabled !== false,
  blocks: values.blocks,
  scope:
    values.scopeMode === 'all'
      ? { all: true }
      : { all: false, presets: [...values.presets], fields: values.fields.map(fieldFromKey) },
});

/**
 * Full definition of a stored template with `enabled` changed (row switch).
 * @param {object} dto - Template DTO.
 * @param {boolean} enabled - New state.
 * @returns {object} Payload.
 */
export const withEnabled = (dto, enabled) => ({ ...toPayload(fromDto(dto)), enabled });

/**
 * Server `details.fieldErrors` -> form error keys (`scope.fields.0` -> `scope`).
 * @param {object|null} details - ValidationError details.
 * @returns {Record<string, string>} Messages by form field.
 */
export const mapServerErrors = (details) => {
  const out = {};
  const fieldErrors = details && typeof details === 'object' ? details.fieldErrors || {} : {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const message = Array.isArray(messages) ? messages[0] : String(messages || '');
    const field = key.split('.')[0];
    if (message && !out[field]) out[field] = message;
  }
  const formErrors = details && Array.isArray(details.formErrors) ? details.formErrors : [];
  if (formErrors[0]) out._form = formErrors[0];
  return out;
};

/**
 * Comparable form of values (block ids and times are kept; the editor emits
 * new objects for unchanged content, so compare the JSON).
 * @param {object} values - Values.
 * @returns {string} Fingerprint.
 */
export const valuesKey = (values) =>
  JSON.stringify({
    ...values,
    blocks: values.blocks && Array.isArray(values.blocks.blocks) ? values.blocks.blocks : null,
  });

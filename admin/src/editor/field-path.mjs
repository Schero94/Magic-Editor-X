/**
 * Field paths and identities of the Content Manager form.
 *
 * An editor field inside a repeatable component or a dynamic zone has a
 * positional path (`sections.0.body`, `zone.1.body`): the index says where
 * the entry is in the form, not which entry it is. Removing, adding or
 * reordering entries gives the same path to another entry. Since 2.4 such
 * values carry a `fieldKey` (shared/field-identity.mjs); live rooms, version
 * history and block comments use it once the key is saved with the entry.
 * Before that, the field is edited locally and shows a hint instead.
 */
import {
  isPositionalFieldPath,
  basePathOf,
  isValidFieldKey,
  createFieldKey,
} from '../../../shared/field-identity.mjs';

export { isPositionalFieldPath, basePathOf, isValidFieldKey, createFieldKey };

const MAX_DEPTH = 8;

/**
 * Collects the field keys stored at a base path of form values (every entry
 * of the repeatable components and dynamic zones on the way).
 * @param {unknown} values - Form values (`initialValues` of the Content Manager form).
 * @param {string} path - Field path with or without indices (`sections.0.body`).
 * @returns {Set<string>} Keys.
 */
export const fieldKeysAt = (values, path) => {
  const keys = new Set();
  const parts = basePathOf(path).split('.').filter(Boolean);
  const walk = (data, index, depth) => {
    if (!data || typeof data !== 'object' || depth > MAX_DEPTH) return;
    if (Array.isArray(data)) {
      data.forEach((item) => walk(item, index, depth + 1));
      return;
    }
    if (index === parts.length) {
      if (isValidFieldKey(data.fieldKey)) keys.add(data.fieldKey);
      return;
    }
    walk(data[parts[index]], index + 1, depth + 1);
  };
  walk(values, 0, 0);
  return keys;
};

/**
 * The identity part of a request target (2.4): the field path, plus the key
 * for a field inside a repeatable component or dynamic zone whose key is saved.
 * Other agents and features call this to address a field.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string }} target - Field target.
 * @param {string|null} [fieldKey] - Saved key of the value (positional fields only).
 * @returns {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string }} Target.
 */
export const identityTarget = (target, fieldKey) => ({
  uid: target.uid,
  documentId: target.documentId,
  locale: target.locale,
  field: target.field,
  ...(isPositionalFieldPath(target.field) && isValidFieldKey(fieldKey) ? { fieldKey } : {}),
});

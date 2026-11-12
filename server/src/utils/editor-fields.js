'use strict';

/**
 * Finds Magic Editor X fields in content-type and component schemas and walks
 * document data to transform their values (used to sanitise on every write).
 */

const CUSTOM_FIELD_UID = 'plugin::magic-editor-x.richtext';
const MAX_DEPTH = 8;

/**
 * True when the attribute is a Magic Editor X field.
 * @param {object} attribute - Schema attribute.
 * @returns {boolean} Result.
 */
const isEditorAttribute = (attribute) => Boolean(attribute) && attribute.customField === CUSTOM_FIELD_UID;

/**
 * Tells whether a schema (or any component it uses) contains an editor field.
 * Results are cached per schema uid.
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content-type or component schema.
 * @param {Map<string, boolean>} [cache] - Memo cache.
 * @param {number} [depth=0] - Recursion depth.
 * @returns {boolean} Result.
 */
const schemaHasEditorFields = (strapi, schema, cache = new Map(), depth = 0) => {
  if (!schema || depth > MAX_DEPTH) return false;
  const key = schema.uid;
  if (key && cache.has(key)) return cache.get(key);
  if (key) cache.set(key, false);
  let found = false;
  for (const attribute of Object.values(schema.attributes || {})) {
    if (isEditorAttribute(attribute)) found = true;
    else if (attribute.type === 'component') {
      found =
        schemaHasEditorFields(strapi, strapi.components[attribute.component], cache, depth + 1) || found;
    } else if (attribute.type === 'dynamiczone') {
      for (const uid of attribute.components || []) {
        found = schemaHasEditorFields(strapi, strapi.components[uid], cache, depth + 1) || found;
      }
    }
    if (found) break;
  }
  if (key) cache.set(key, found);
  return found;
};

/**
 * Walks write data and replaces every editor field value with
 * `transform(value, attribute, path)`. Mutates and returns `data`. Unknown
 * shapes are left alone.
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Schema of `data`.
 * @param {object} data - Document data being written.
 * @param {(value: unknown, attribute: object, path: string) => unknown} transform - Value transformer.
 * @param {number} [depth=0] - Recursion depth.
 * @param {string} [prefix=''] - Dotted path of `data` (for messages).
 * @returns {object} The same data object.
 */
const transformEditorFields = (strapi, schema, data, transform, depth = 0, prefix = '') => {
  if (!schema || !data || typeof data !== 'object' || depth > MAX_DEPTH) return data;
  for (const [name, attribute] of Object.entries(schema.attributes || {})) {
    if (!Object.prototype.hasOwnProperty.call(data, name)) continue;
    const value = data[name];
    const path = prefix ? `${prefix}.${name}` : name;
    if (isEditorAttribute(attribute)) {
      data[name] = transform(value, attribute, path);
    } else if (attribute.type === 'component') {
      const component = strapi.components[attribute.component];
      if (Array.isArray(value))
        value.forEach((item, index) =>
          transformEditorFields(strapi, component, item, transform, depth + 1, `${path}.${index}`)
        );
      else transformEditorFields(strapi, component, value, transform, depth + 1, path);
    } else if (attribute.type === 'dynamiczone' && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object' && typeof item.__component === 'string') {
          transformEditorFields(
            strapi,
            strapi.components[item.__component],
            item,
            transform,
            depth + 1,
            `${path}.${index}`
          );
        }
      });
    }
  }
  return data;
};

/**
 * Resolves a field path (`body`, `sections.0.text`) to its attribute so the
 * server can check that a collaboration room or snapshot targets a real
 * Magic Editor X field.
 * @param {object} strapi - Strapi instance.
 * @param {object} contentType - Content-type schema.
 * @param {string} path - Dotted field path.
 * @returns {{ topLevel: string, permissionField: string, attribute: object } | null} The editor attribute,
 *   the top-level field name and the field path the Content Manager permissions use
 *   (`sections.body` inside components; the dynamic zone itself for fields inside one).
 */
const resolveEditorField = (strapi, contentType, path) => {
  const parts = String(path).split('.');
  let schema = contentType;
  let attribute = null;
  const topLevel = parts[0];
  const names = [];
  let inZone = false;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\d+$/.test(part)) continue;
    attribute = schema?.attributes?.[part];
    if (!attribute) return null;
    if (!inZone) names.push(part);
    if (i === parts.length - 1) break;
    if (attribute.type === 'component') schema = strapi.components[attribute.component];
    else if (attribute.type === 'dynamiczone') {
      inZone = true;
      const next = parts[i + 2];
      const candidates = (attribute.components || []).map((uid) => strapi.components[uid]).filter(Boolean);
      schema = candidates.find((candidate) => candidate.attributes?.[next]) || null;
      i += 1;
    } else return null;
  }
  return isEditorAttribute(attribute) ? { topLevel, permissionField: names.join('.'), attribute } : null;
};

module.exports = {
  CUSTOM_FIELD_UID,
  isEditorAttribute,
  schemaHasEditorFields,
  transformEditorFields,
  resolveEditorField,
};

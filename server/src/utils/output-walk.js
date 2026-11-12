'use strict';

const { isEditorAttribute, schemaHasEditorFields } = require('./editor-fields');

/**
 * Walks Content API response data along the content-type schema and calls
 * `visit(holder, key, attribute, locale)` for every Magic Editor X value:
 * top-level fields, components, dynamic zones and populated relations, in
 * the default (flat) response format and in the `Strapi-Response-Format: v4`
 * format (`{ id, attributes }`, relations as `{ data }`). Media attributes
 * and unknown keys are never touched. Depth is bounded.
 */

const MAX_DEPTH = 10;

/**
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content-type or component schema of `node`.
 * @param {unknown} node - Response data (object or array).
 * @param {(holder: object, key: string, attribute: object, locale: string|null) => void} visit - Visitor.
 * @param {{ cache?: Map<string, boolean>, locale?: string|null, depth?: number }} [state] - Walk state.
 */
const walkOutput = (strapi, schema, node, visit, state = {}) => {
  const cache = state.cache || new Map();
  const depth = state.depth || 0;
  if (!schema || !node || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (!schemaHasEditorFields(strapi, schema, cache)) return;
  if (Array.isArray(node)) {
    for (const item of node) walkOutput(strapi, schema, item, visit, { cache, locale: state.locale, depth });
    return;
  }
  const attributes = schema.attributes || {};
  // v4 response format: { id, attributes: {...} } (unless the schema itself has an "attributes" field).
  const holder =
    !attributes.attributes &&
    node.attributes &&
    typeof node.attributes === 'object' &&
    !Array.isArray(node.attributes)
      ? node.attributes
      : node;
  const locale = typeof holder.locale === 'string' ? holder.locale : state.locale || null;
  const next = { cache, locale, depth: depth + 1 };
  for (const [name, attribute] of Object.entries(attributes)) {
    if (!attribute || !Object.prototype.hasOwnProperty.call(holder, name)) continue;
    let value = holder[name];
    if (value === null || value === undefined) continue;
    if (isEditorAttribute(attribute)) {
      visit(holder, name, attribute, locale);
      continue;
    }
    if (attribute.type === 'component') {
      walkOutput(strapi, strapi.components[attribute.component], value, visit, next);
    } else if (attribute.type === 'dynamiczone' && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof item.__component === 'string')
          walkOutput(strapi, strapi.components[item.__component], item, visit, next);
      }
    } else if (attribute.type === 'relation' && typeof attribute.target === 'string') {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) value = value.data;
      walkOutput(strapi, strapi.getModel(attribute.target), value, visit, next);
    }
  }
};

/**
 * Content type uid of a Content API route (`api::<api>.<controller>`), from
 * the route handler (`api::article.article.find` or `article.find`).
 * @param {object} route - `ctx.state.route`.
 * @returns {string|null} uid or null.
 */
const routeContentType = (route) => {
  if (!route || !route.info || route.info.type !== 'content-api') return null;
  const handler = typeof route.handler === 'string' ? route.handler : '';
  const full = /^(api::[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.[A-Za-z0-9_]+$/.exec(handler);
  if (full) return full[1];
  const short = /^([A-Za-z0-9_-]+)\.[A-Za-z0-9_]+$/.exec(handler);
  if (short && typeof route.info.apiName === 'string') return `api::${route.info.apiName}.${short[1]}`;
  return null;
};

module.exports = { walkOutput, routeContentType };

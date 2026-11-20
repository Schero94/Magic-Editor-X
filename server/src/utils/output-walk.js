'use strict';

const { isEditorAttribute, schemaHasEditorFields } = require('./editor-fields');

/**
 * Walks Content API response data along the content-type schema and calls
 * `visit(holder, key, attribute, locale)` for every Magic Editor X value:
 * top-level fields, components, dynamic zones and populated relations, in
 * the default (flat) response format and in the `Strapi-Response-Format: v4`
 * format (`{ id, attributes }`, relations as `{ data }`). Media attributes
 * and unknown keys are never touched. Depth is bounded.
 *
 * 2.6: the visitor also receives `{ path, entry }`: the field path relative
 * to the entry that holds it (`body`, `sections.2.body`, Strapi's
 * `rawWithIndices` form) and that entry (`documentId`, `model`, `kind`,
 * `locale`; populated relations start a new entry).
 */

const MAX_DEPTH = 10;

/**
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content-type or component schema of `node`.
 * @param {unknown} node - Response data (object or array).
 * @param {(holder: object, key: string, attribute: object, locale: string|null, where: { path: string, entry: { documentId: string|null, model: string|null, kind: string|null, locale: string|null } }) => void} visit - Visitor.
 * @param {{ cache?: Map<string, boolean>, locale?: string|null, depth?: number, path?: string, entry?: object|null }} [state] - Walk state (`entry` null or absent: `node` is an entry).
 */
const walkOutput = (strapi, schema, node, visit, state = {}) => {
  const cache = state.cache || new Map();
  const depth = state.depth || 0;
  if (!schema || !node || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (!schemaHasEditorFields(strapi, schema, cache)) return;
  if (Array.isArray(node)) {
    for (const item of node)
      walkOutput(strapi, schema, item, visit, {
        cache,
        locale: state.locale,
        depth,
        path: state.path,
        entry: state.entry,
      });
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
  const entry = state.entry || {
    documentId: typeof holder.documentId === 'string' ? holder.documentId : null,
    model: typeof schema.uid === 'string' ? schema.uid : null,
    kind: typeof schema.kind === 'string' ? schema.kind : null,
    // The entry's own locale only: a type without i18n has none (Strapi returns `locale` only for
    // localized types), so a related entry does not inherit the parent's locale in source maps.
    locale: typeof holder.locale === 'string' ? holder.locale : null,
  };
  const prefix = state.entry && state.path ? `${state.path}.` : '';
  const inEntry = (path) => ({ cache, locale, depth: depth + 1, path, entry });
  for (const [name, attribute] of Object.entries(attributes)) {
    if (!attribute || !Object.prototype.hasOwnProperty.call(holder, name)) continue;
    let value = holder[name];
    if (value === null || value === undefined) continue;
    if (isEditorAttribute(attribute)) {
      visit(holder, name, attribute, locale, { path: `${prefix}${name}`, entry });
      continue;
    }
    if (attribute.type === 'component') {
      const component = strapi.components[attribute.component];
      if (Array.isArray(value))
        value.forEach((item, index) =>
          walkOutput(strapi, component, item, visit, inEntry(`${prefix}${name}.${index}`))
        );
      else walkOutput(strapi, component, value, visit, inEntry(`${prefix}${name}`));
    } else if (attribute.type === 'dynamiczone' && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object' && typeof item.__component === 'string')
          walkOutput(
            strapi,
            strapi.components[item.__component],
            item,
            visit,
            inEntry(`${prefix}${name}.${index}`)
          );
      });
    } else if (attribute.type === 'relation' && typeof attribute.target === 'string') {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) value = value.data;
      // A populated relation is another entry: its paths start again at its own fields.
      walkOutput(strapi, strapi.getModel(attribute.target), value, visit, {
        cache,
        locale,
        depth: depth + 1,
      });
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

'use strict';

const { isEditorAttribute } = require('./utils/editor-fields');

/**
 * GraphQL fields for Magic Editor X attributes (only when
 * `@strapi/plugin-graphql` is installed and enabled; the plugin works without it).
 *
 * For every Magic Editor X attribute `body` of a content type or component
 * that is in the GraphQL schema, the type gets:
 * - `bodyRendered(format: MagicEditorXFormat = HTML): String` (HTML, TEXT, MARKDOWN),
 * - `bodyResolved: JSON` (the stored document with resolved references),
 * - 2.13: `bodyBlocks(extensions: Boolean = false): JSON` (Strapi Blocks JSON, the `?mex=blocks`
 *   output; a separate field because `bodyRendered` returns a String).
 *
 * They use the same permission-safe resolution as the Content API `?mex=`
 * parameter (services/references.js) with the locale and publication status
 * of the entry (inside components and dynamic zones: of the entry that holds
 * them, passed down by a nexus plugin middleware) and the request's auth
 * (`context.state.auth`). Values requested in the same tick are resolved in
 * one batch per request, so a list of entries does not cause one lookup per
 * entry. Private attributes, attributes whose output is disabled through
 * `shadowCRUD(...).field(...)`, and names that collide with an existing
 * attribute are skipped.
 */

const ENUM = 'MagicEditorXFormat';
const FORMAT_VALUES = { HTML: 'html', TEXT: 'text', MARKDOWN: 'markdown' };
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Lists the GraphQL fields to add.
 * @param {object} strapi - Strapi instance.
 * @param {{ has: (name: string) => boolean }} typeRegistry - GraphQL type registry.
 * @returns {Array<{ typeName: string, attribute: string, rendered: string, resolved: string }>} Fields.
 */
const plannedFields = (strapi, typeRegistry) => {
  const graphql = strapi.plugin('graphql');
  const { naming } = graphql.service('utils');
  const extension = graphql.service('extension');
  const out = [];
  const schemas = [
    ...Object.values(strapi.contentTypes || {})
      .filter((schema) => typeof schema.uid === 'string' && schema.uid.startsWith('api::'))
      .map((schema) => ({ schema, typeName: naming.getTypeName(schema) })),
    ...Object.values(strapi.components || {}).map((schema) => ({
      schema,
      typeName: naming.getComponentName(schema),
    })),
  ];
  for (const { schema, typeName } of schemas) {
    if (typeof typeName !== 'string' || !NAME.test(typeName) || !typeRegistry.has(typeName)) continue;
    const attributes = schema.attributes || {};
    for (const [name, attribute] of Object.entries(attributes)) {
      if (!isEditorAttribute(attribute) || attribute.private === true || !NAME.test(name)) continue;
      let enabled;
      try {
        enabled = extension.shadowCRUD(schema.uid).field(name).hasOutputEnabled() !== false;
      } catch {
        enabled = true;
      }
      if (!enabled) continue;
      const rendered = `${name}Rendered`;
      const resolved = `${name}Resolved`;
      if (attributes[rendered] || attributes[resolved]) continue;
      // 2.13: the Blocks field is left out alone when its name is taken (older schemas keep working).
      const blocks = attributes[`${name}Blocks`] ? null : `${name}Blocks`;
      out.push({ typeName, attribute: name, rendered, resolved, blocks, options: attribute.options || {} });
    }
  }
  return out;
};

/**
 * Component and dynamic zone fields (`Type.field`) of the types in the schema.
 * Their resolvers tag the returned component objects with the entry's scope.
 * @param {object} strapi - Strapi instance.
 * @param {{ has: (name: string) => boolean }} typeRegistry - GraphQL type registry.
 * @returns {Set<string>} `TypeName.attribute` keys.
 */
const plannedContainers = (strapi, typeRegistry) => {
  const { naming } = strapi.plugin('graphql').service('utils');
  const out = new Set();
  const schemas = [
    ...Object.values(strapi.contentTypes || {})
      .filter((schema) => typeof schema.uid === 'string' && schema.uid.startsWith('api::'))
      .map((schema) => ({ schema, typeName: naming.getTypeName(schema) })),
    ...Object.values(strapi.components || {}).map((schema) => ({
      schema,
      typeName: naming.getComponentName(schema),
    })),
  ];
  for (const { schema, typeName } of schemas) {
    if (typeof typeName !== 'string' || !NAME.test(typeName) || !typeRegistry.has(typeName)) continue;
    for (const [name, attribute] of Object.entries(schema.attributes || {})) {
      if (
        attribute &&
        (attribute.type === 'component' || attribute.type === 'dynamiczone') &&
        NAME.test(name)
      )
        out.add(`${typeName}.${name}`);
    }
  }
  return out;
};

/**
 * Locale and publication status per request: GraphQL context -> component
 * object -> scope of the entry that holds it. Component rows carry neither
 * (Strapi loads them with `db.query().load(parent, attribute)`), so the
 * component and dynamic zone resolvers tag what they return.
 * @type {WeakMap<object, WeakMap<object, { locale: string|null, status: 'draft'|'published' }>>}
 */
const SCOPES = new WeakMap();

/**
 * Scope of an entry: its locale, and `draft` when it was read as a draft
 * (`publishedAt: null`, Strapi 5 status DRAFT).
 * @param {object} entry - Entry object.
 * @returns {{ locale: string|null, status: 'draft'|'published' }} Scope.
 */
const entryScope = (entry) => ({
  locale: typeof entry.locale === 'string' ? entry.locale : null,
  status: entry.publishedAt === null ? 'draft' : 'published',
});

/**
 * Scope of a GraphQL parent object: an entry (it has a `documentId`) has its
 * own; a component inherits the one its resolver was tagged with.
 * @param {unknown} parent - Parent object.
 * @param {object} context - GraphQL context of the request.
 * @returns {{ locale: string|null, status: 'draft'|'published' }} Scope.
 */
const scopeOf = (parent, context) => {
  if (!parent || typeof parent !== 'object') return { locale: null, status: 'published' };
  if (typeof parent.documentId !== 'string') {
    const tagged = context && typeof context === 'object' ? SCOPES.get(context) : null;
    const scope = tagged && tagged.get(parent);
    if (scope) return scope;
  }
  return entryScope(parent);
};

/**
 * Tags component objects returned by a component or dynamic zone field.
 * @param {unknown} value - Resolver result (object, array or null).
 * @param {{ locale: string|null, status: string }} scope - Scope of the parent.
 * @param {object} context - GraphQL context.
 */
const tagScope = (value, scope, context) => {
  if (!value || typeof value !== 'object' || !context || typeof context !== 'object') return;
  let tagged = SCOPES.get(context);
  if (!tagged) {
    tagged = new WeakMap();
    SCOPES.set(context, tagged);
  }
  for (const item of Array.isArray(value) ? value : [value]) {
    if (item && typeof item === 'object') tagged.set(item, scope);
  }
};

/**
 * Creates the per-request batcher: values requested in the same tick are
 * transformed together (one reference lookup per request tick).
 * @param {object} strapi - Strapi instance.
 * @returns {(context: object, item: object) => Promise<unknown>} Loader.
 */
const createLoader = (strapi) => {
  const batches = new WeakMap();
  const flush = async (context, batch) => {
    batches.delete(context);
    const service = strapi.plugin('magic-editor-x').service('references');
    const byStatus = new Map();
    for (const item of batch) {
      if (!byStatus.has(item.status)) byStatus.set(item.status, []);
      byStatus.get(item.status).push(item);
    }
    for (const [status, items] of byStatus) {
      try {
        const output = await service.transform(items, { auth: context.state && context.state.auth, status });
        items.forEach((item, index) => item.resolve(output[index]));
      } catch (error) {
        items.forEach((item) => item.reject(error));
      }
    }
  };
  return (context, item) =>
    new Promise((resolve, reject) => {
      let batch = batches.get(context);
      if (!batch) {
        batch = [];
        batches.set(context, batch);
        setImmediate(() => {
          flush(context, batch);
        });
      }
      batch.push({ ...item, resolve, reject });
    });
};

/**
 * Registers the GraphQL extension when the GraphQL plugin is present.
 * @param {object} strapi - Strapi instance.
 * @returns {boolean} True when the extension was registered.
 */
const registerGraphql = (strapi) => {
  let extension;
  try {
    const graphql = strapi.plugin('graphql');
    extension = graphql ? graphql.service('extension') : null;
  } catch {
    extension = null;
  }
  if (!extension || typeof extension.use !== 'function') return false;
  const load = createLoader(strapi);
  const { createLogger } = require('./utils/logger');
  const logger = createLogger(strapi);

  extension.use(({ typeRegistry, nexus }) => {
    const fields = plannedFields(strapi, typeRegistry);
    if (!fields.length) return {};
    // Component and dynamic zone resolvers pass the entry's locale and status down (nexus plugin
    // middleware: wraps Strapi's resolver without replacing it or its resolversConfig).
    const containers = plannedContainers(strapi, typeRegistry);
    const plugins =
      nexus && typeof nexus.plugin === 'function' && containers.size
        ? [
            nexus.plugin({
              name: 'MagicEditorXEntryScope',
              onCreateFieldResolver(config) {
                const typeName = config && config.parentTypeConfig && config.parentTypeConfig.name;
                const fieldName = config && config.fieldConfig && config.fieldConfig.name;
                if (!containers.has(`${typeName}.${fieldName}`)) return undefined;
                return async (root, args, context, info, next) => {
                  const value = await next(root, args, context, info);
                  tagScope(value, scopeOf(root, context), context);
                  return value;
                };
              },
            }),
          ]
        : [];
    const byType = new Map();
    for (const field of fields) {
      if (!byType.has(field.typeName)) byType.set(field.typeName, []);
      byType.get(field.typeName).push(field);
    }
    const typeDefs = [`enum ${ENUM} { ${Object.keys(FORMAT_VALUES).join(' ')} }`];
    const resolvers = {};
    for (const [typeName, list] of byType) {
      typeDefs.push(
        `extend type ${typeName} {\n${list
          .map(
            (field) =>
              `  ${field.rendered}(format: ${ENUM} = HTML): String\n  ${field.resolved}: JSON` +
              (field.blocks ? `\n  ${field.blocks}(extensions: Boolean = false): JSON` : '')
          )
          .join('\n')}\n}`
      );
      resolvers[typeName] = {};
      for (const field of list) {
        const run = (parent, format, context, render) => {
          const value = parent ? parent[field.attribute] : null;
          if (value === null || value === undefined) return null;
          return load(context, {
            value,
            format,
            // Locale and status of the entry; for components and dynamic zones the entry that holds them
            // (a draft entry, publishedAt null, was requested with status DRAFT: resolve drafts too).
            ...scopeOf(parent, context),
            // Field options: synced content is filtered by the field preset.
            options: field.options,
            ...(render ? { render } : {}),
          }).catch((error) => {
            logger.error('GraphQL output could not be rendered', error);
            throw new Error('Magic Editor X output failed');
          });
        };
        resolvers[typeName][field.rendered] = {
          resolve: (parent, args, context) =>
            run(parent, FORMAT_VALUES[args && args.format] || 'html', context),
        };
        resolvers[typeName][field.resolved] = {
          resolve: (parent, _args, context) => run(parent, 'json', context),
        };
        if (field.blocks)
          resolvers[typeName][field.blocks] = {
            resolve: (parent, args, context) =>
              run(parent, 'blocks', context, { extensions: Boolean(args && args.extensions === true) }),
          };
      }
    }
    return { typeDefs: typeDefs.join('\n'), resolvers, plugins };
  });
  return true;
};

module.exports = { registerGraphql, plannedFields, plannedContainers, createLoader, FORMAT_VALUES };

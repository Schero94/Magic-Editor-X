'use strict';

const { isEditorAttribute } = require('./utils/editor-fields');

/**
 * GraphQL fields for Magic Editor X attributes (only when
 * `@strapi/plugin-graphql` is installed and enabled; the plugin works without it).
 *
 * For every Magic Editor X attribute `body` of a content type or component
 * that is in the GraphQL schema, the type gets:
 * - `bodyRendered(format: MagicEditorXFormat = HTML): String` (HTML, TEXT, MARKDOWN),
 * - `bodyResolved: JSON` (the stored document with resolved references).
 *
 * They use the same permission-safe resolution as the Content API `?mex=`
 * parameter (services/references.js) with the request's auth
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
      out.push({ typeName, attribute: name, rendered, resolved });
    }
  }
  return out;
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

  extension.use(({ typeRegistry }) => {
    const fields = plannedFields(strapi, typeRegistry);
    if (!fields.length) return {};
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
          .map((field) => `  ${field.rendered}(format: ${ENUM} = HTML): String\n  ${field.resolved}: JSON`)
          .join('\n')}\n}`
      );
      resolvers[typeName] = {};
      for (const field of list) {
        const run = (parent, format, context) => {
          const value = parent ? parent[field.attribute] : null;
          if (value === null || value === undefined) return null;
          return load(context, {
            value,
            format,
            locale: parent && typeof parent.locale === 'string' ? parent.locale : null,
            // A draft parent (publishedAt null) was requested with status DRAFT: resolve drafts too.
            status: parent && parent.publishedAt === null ? 'draft' : 'published',
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
      }
    }
    return { typeDefs: typeDefs.join('\n'), resolvers };
  });
  return true;
};

module.exports = { registerGraphql, plannedFields, createLoader, FORMAT_VALUES };

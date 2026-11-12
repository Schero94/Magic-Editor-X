'use strict';

const { errors } = require('@strapi/utils');
const { isEditorAttribute } = require('./editor-fields');
const { createLogger } = require('./logger');
const { formErrorDetails } = require('./form-errors');

/**
 * Optional publish guard of the field preset (`options.publishGuard`).
 *
 * A Document Service middleware on `publish` reads the drafts that are about
 * to be published and runs the accessibility lint on every Magic Editor X
 * field whose options enable the guard (also inside components and dynamic
 * zones). Any issue with severity `error` (an empty link, a missing alt text
 * when the field requires alt texts) stops the publication with a
 * ValidationError (400). Warnings never block. Neither the error nor the log
 * contains content.
 */

const MAX_DEPTH = 8;
const MAX_REPORTED = 50;

const { lintDocument } = require('../../../shared/quality.mjs');

/**
 * True when the attribute is a guarded Magic Editor X field.
 * @param {object} attribute - Schema attribute.
 * @returns {boolean} Result.
 */
const isGuarded = (attribute) =>
  isEditorAttribute(attribute) && Boolean(attribute.options) && attribute.options.publishGuard === true;

/**
 * Builds the `fields`/`populate` query that reads only what the guard needs.
 * Returns null when the schema (with its components) has no guarded field.
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content type or component schema.
 * @param {number} [depth=0] - Recursion depth.
 * @param {(attribute: object) => boolean} [predicate] - Which editor fields to read (default: guarded ones).
 * @returns {{ fields: string[], populate: Record<string, unknown> } | null} Query parts.
 */
const guardQuery = (strapi, schema, depth = 0, predicate = isGuarded) => {
  if (!schema || depth > MAX_DEPTH) return null;
  const fields = [];
  const populate = {};
  for (const [name, attribute] of Object.entries(schema.attributes || {})) {
    if (predicate(attribute)) fields.push(name);
    else if (attribute.type === 'component') {
      const inner = guardQuery(strapi, strapi.components[attribute.component], depth + 1, predicate);
      if (inner) populate[name] = toPopulate(inner);
    } else if (attribute.type === 'dynamiczone') {
      const on = {};
      for (const uid of attribute.components || []) {
        const inner = guardQuery(strapi, strapi.components[uid], depth + 1, predicate);
        if (inner) on[uid] = toPopulate(inner);
      }
      if (Object.keys(on).length) populate[name] = { on };
    }
  }
  if (!fields.length && !Object.keys(populate).length) return null;
  return { fields, populate };
};

/**
 * @param {{ fields: string[], populate: Record<string, unknown> }} query - Inner query.
 * @returns {object} Populate entry for a component.
 */
const toPopulate = (query) => {
  const out = { fields: query.fields.length ? query.fields : ['id'] };
  if (Object.keys(query.populate).length) out.populate = query.populate;
  return out;
};

/**
 * Collects the guarded editor values of one document.
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Schema of `data`.
 * @param {object} data - Document or component data.
 * @param {string} prefix - Path of `data`.
 * @param {Array<{ field: string, value: unknown, options: object }>} out - Accumulator.
 * @param {number} [depth=0] - Recursion depth.
 * @param {(attribute: object) => boolean} [predicate] - Which editor fields to collect (default: guarded ones).
 * @returns {Array<{ field: string, value: unknown, options: object }>} Values.
 */
const collectGuarded = (strapi, schema, data, prefix, out, depth = 0, predicate = isGuarded) => {
  if (!schema || !data || typeof data !== 'object' || depth > MAX_DEPTH) return out;
  for (const [name, attribute] of Object.entries(schema.attributes || {})) {
    if (!Object.prototype.hasOwnProperty.call(data, name)) continue;
    const value = data[name];
    const path = prefix ? `${prefix}.${name}` : name;
    if (predicate(attribute)) out.push({ field: path, value, options: attribute.options || {} });
    else if (attribute.type === 'component') {
      const component = strapi.components[attribute.component];
      if (Array.isArray(value))
        value.forEach((item, index) =>
          collectGuarded(strapi, component, item, `${path}.${index}`, out, depth + 1, predicate)
        );
      else collectGuarded(strapi, component, value, path, out, depth + 1, predicate);
    } else if (attribute.type === 'dynamiczone' && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object' && typeof item.__component === 'string')
          collectGuarded(
            strapi,
            strapi.components[item.__component],
            item,
            `${path}.${index}`,
            out,
            depth + 1,
            predicate
          );
      });
    }
  }
  return out;
};

/**
 * Lints the guarded fields of documents and lists the blocking issues.
 * @param {object} strapi - Strapi instance.
 * @param {object} contentType - Content type schema.
 * @param {object[]} documents - Draft documents (with the guarded fields populated).
 * @returns {Promise<Array<{ field: string, rule: string, blockId: string, locale?: string }>>} Error issues (bounded).
 */
const blockingIssues = async (strapi, contentType, documents) => {
  const issues = [];
  for (const document of documents) {
    for (const { field, value, options } of collectGuarded(strapi, contentType, document, '', [])) {
      const result = lintDocument(value, { requireAlt: options.requireAlt === true });
      for (const issue of result.issues) {
        if (issue.severity !== 'error' || issues.length >= MAX_REPORTED) continue;
        const entry = { field, rule: issue.rule, blockId: issue.blockId };
        if (typeof document.locale === 'string') entry.locale = document.locale;
        issues.push(entry);
      }
    }
  }
  return issues;
};

/**
 * Registers the publish guard middleware.
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi instance.
 */
const registerPublishGuard = (strapi) => {
  const logger = createLogger(strapi);
  const queries = new Map();
  strapi.documents.use(async (ctx, next) => {
    if (ctx.action !== 'publish' || !ctx.params || typeof ctx.params.documentId !== 'string') return next();
    const contentType = ctx.contentType || strapi.contentType(ctx.uid);
    if (!contentType || contentType.options?.draftAndPublish !== true) return next();
    if (!queries.has(contentType.uid)) queries.set(contentType.uid, guardQuery(strapi, contentType));
    const query = queries.get(contentType.uid);
    if (!query) return next();

    const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
    let locales = Array.isArray(ctx.params.locale) ? ctx.params.locale : [ctx.params.locale];
    if (!localized) locales = [undefined];
    else if (locales.includes('*')) {
      const rows = await strapi.db.query(contentType.uid).findMany({
        where: { documentId: ctx.params.documentId, publishedAt: null },
        select: ['locale'],
      });
      locales = [...new Set(rows.map((row) => row.locale).filter((locale) => typeof locale === 'string'))];
    }
    const documents = [];
    for (const locale of locales) {
      const rows = await strapi.documents(contentType.uid).findMany({
        filters: { documentId: ctx.params.documentId },
        ...(locale ? { locale } : {}),
        status: 'draft',
        fields: query.fields.length ? [...query.fields, 'documentId'] : ['documentId'],
        ...(Object.keys(query.populate).length ? { populate: query.populate } : {}),
      });
      documents.push(...rows);
    }
    const issues = await blockingIssues(strapi, contentType, documents);
    if (issues.length) {
      logger.info('publication stopped by the quality checks', { count: issues.length });
      throw new errors.ValidationError(
        'Quality checks failed for a Magic Editor X field',
        formErrorDetails(
          'QUALITY_GATE',
          issues.map((issue) => issue.field),
          { issues }
        )
      );
    }
    return next();
  });
};

module.exports = { registerPublishGuard, guardQuery, collectGuarded, blockingIssues };

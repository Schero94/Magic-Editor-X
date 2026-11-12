'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { errors } = require('@strapi/utils');
const { createLogger } = require('./logger');
const { cleanEditorValue } = require('./sanitizer');
const { isEditorAttribute, schemaHasEditorFields, transformEditorFields } = require('./editor-fields');
const { guardQuery, collectGuarded } = require('./publish-guard');
const { formErrorDetails } = require('./form-errors');
const { resolveFieldPreset, allowedInlineTags } = require('../../../shared/presets.mjs');
const { toTranslationPayload, repairLocalizedValue } = require('../../../shared/ai-localization.mjs');
const { isPlainObject } = require('../../../shared/editor-data.mjs');
const { fieldIdentity } = require('../../../shared/audit.mjs');
const { isPositionalFieldPath, isValidFieldKey } = require('../../../shared/field-identity.mjs');

/**
 * Strapi i18n "AI translations" (Strapi 5.61 `@strapi/i18n`
 * `services/ai-localizations`) and Magic Editor X fields.
 *
 * Strapi sends every localized attribute except media, relations, booleans
 * and enumerations to its AI provider and writes the answer to the other
 * locales with `strapi.documents(uid).update({ documentId, locale, fields: [], data })`.
 * A Magic Editor X value (type `json`) would be translated as a whole. There
 * is no documented way to exclude an attribute, so the plugin:
 *
 * 1. wraps the i18n service `ai-localizations.generateDocumentLocalizations`
 *    (registry `extend`) to mark the job with an AsyncLocalStorage context
 *    `{ uid, documentId, sourceLocale }`;
 * 2. wraps `ai-translations.generateTranslations` so that, inside a job, every
 *    editor value of the payload is replaced by an envelope with only its
 *    inline text strings (block ids, types, URLs, files, markers, TeX and
 *    internal-link attributes never reach the provider);
 * 3. repairs writes (`createRepairMiddleware`, composed in front of the save
 *    middleware in `register.js`, so repaired values are cleaned and checked):
 *    an `update` inside a job, for the job's document and a locale other than
 *    the source locale, gets every editor value rebuilt from the source-locale
 *    value with only translated inline strings taken over
 *    (`repairLocalizedValue`). A value whose source cannot be found is refused
 *    with `ValidationError` `AI_TRANSLATION_UNSAFE`.
 *
 * Writes outside a job (Content Manager, Content API, "Fill in from another
 * locale", scripts) are not touched by this module.
 */

const jobContext = new AsyncLocalStorage();
const WRAPPED = Symbol.for('magic-editor-x.ai-localization-guard');
const LOCALIZATIONS_UID = 'plugin::i18n.ai-localizations';
const TRANSLATIONS_UID = 'plugin::i18n.ai-translations';

/**
 * Inline tags the field preset allows (same cleaning as on save).
 * @param {object} strapi - Strapi instance.
 * @param {object} attribute - Schema attribute.
 * @returns {{ rawHtml: string, inlineTags: string[]|null }} Clean options.
 */
const cleanOptionsFor = (strapi, attribute) => ({
  rawHtml: strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize',
  inlineTags: allowedInlineTags(resolveFieldPreset(attribute && attribute.options)),
});

/**
 * Clean value or null (never throws).
 * @param {object} strapi - Strapi instance.
 * @param {unknown} value - Stored value.
 * @param {object} attribute - Schema attribute.
 * @returns {object|null} Clean value.
 */
const cleanOrNull = (strapi, value, attribute) => {
  try {
    return cleanEditorValue(value, cleanOptionsFor(strapi, attribute));
  } catch {
    return null;
  }
};

/**
 * The job context of the current async execution (null outside a job).
 * @returns {{ uid: string, documentId: string, sourceLocale: string, sources: Map<string, object|null>, storedSource: Map<string, unknown>|null } | null} Context.
 */
const currentJob = () => jobContext.getStore() || null;

/**
 * Runs `fn` inside an AI localisation job context (exported for tests).
 * @param {{ uid: string, documentId: string, sourceLocale: string }} job - Job.
 * @param {() => unknown} fn - Work.
 * @returns {unknown} Result of `fn`.
 */
const runInJob = (job, fn) => jobContext.run({ ...job, sources: new Map(), storedSource: null }, fn);

/**
 * Replaces editor values in a provider payload by text envelopes and keeps
 * the clean source values in the job context.
 * @param {object} strapi - Strapi instance.
 * @param {object} job - Job context.
 * @param {object} content - Payload content (not mutated).
 * @returns {object} New content.
 */
const reducePayload = (strapi, job, content) => {
  const schema = strapi.getModel(job.uid);
  if (!schema || !schemaHasEditorFields(strapi, schema)) return content;
  const copy = structuredClone(content);
  transformEditorFields(strapi, schema, copy, (value, attribute, path) => {
    const clean = cleanOrNull(strapi, value, attribute);
    job.sources.set(path, clean);
    return toTranslationPayload(clean).payload;
  });
  return copy;
};

/**
 * Editor values of one locale's draft, by field path.
 * @param {object} strapi - Strapi instance.
 * @param {object} contentType - Content type.
 * @param {string} documentId - Document.
 * @param {string} locale - Locale.
 * @returns {Promise<Map<string, unknown>>} Values (raw as stored).
 */
const readEditorValues = async (strapi, contentType, documentId, locale) => {
  const query = guardQuery(strapi, contentType, 0, isEditorAttribute);
  const out = new Map();
  if (!query) return out;
  const document = await strapi.documents(contentType.uid).findOne({
    documentId,
    locale,
    status: 'draft',
    fields: query.fields.length ? [...query.fields, 'documentId'] : ['documentId'],
    ...(Object.keys(query.populate).length ? { populate: query.populate } : {}),
  });
  if (!document) return out;
  for (const item of collectGuarded(strapi, contentType, document, '', [], 0, isEditorAttribute)) {
    out.set(item.field, item.value);
  }
  return out;
};

/**
 * Document Service middleware that repairs AI localisation writes.
 * @param {object} strapi - Strapi instance.
 * @param {object} logger - Plugin logger.
 * @returns {Function} Middleware.
 */
const createRepairMiddleware = (strapi, logger) => async (ctx, next) => {
  if (ctx.action !== 'update') return next();
  const job = currentJob();
  if (!job || !ctx.params || !isPlainObject(ctx.params.data) || ctx.uid !== job.uid) return next();
  const { documentId, locale } = ctx.params;
  if (documentId !== job.documentId || typeof locale !== 'string' || locale === job.sourceLocale)
    return next();
  const contentType = ctx.contentType || strapi.contentType(ctx.uid);
  if (!contentType || !schemaHasEditorFields(strapi, contentType)) return next();

  const paths = [];
  transformEditorFields(strapi, contentType, ctx.params.data, (value, attribute, path) => {
    paths.push(path);
    return value;
  });
  if (!paths.length) return next();

  // Source values: the clean values the payload was built from; the stored
  // source draft for anything the payload did not carry.
  const attributes = new Map();
  transformEditorFields(strapi, contentType, ctx.params.data, (value, attribute, path) => {
    attributes.set(path, attribute);
    return value;
  });
  if (paths.some((path) => !job.sources.has(path))) {
    if (!job.storedSource) {
      job.storedSource = await readEditorValues(strapi, contentType, documentId, job.sourceLocale);
    }
    for (const path of paths) {
      if (!job.sources.has(path) && job.storedSource.has(path))
        job.sources.set(path, cleanOrNull(strapi, job.storedSource.get(path), attributes.get(path)));
    }
  }
  // The target locale keeps the field keys of its own entries (versions and comments stay attached).
  const target = paths.some(isPositionalFieldPath)
    ? await readEditorValues(strapi, contentType, documentId, locale)
    : new Map();

  const unknown = [];
  const events = [];
  transformEditorFields(strapi, contentType, ctx.params.data, (value, attribute, path) => {
    if (!job.sources.has(path)) {
      unknown.push(path);
      return value;
    }
    const own = target.get(path);
    const ownKey = isPlainObject(own) && isValidFieldKey(own.fieldKey) ? own.fieldKey : null;
    const result = repairLocalizedValue(job.sources.get(path), value, { fieldKey: ownKey });
    // Fields without text (empty or null) are written from the source without an event.
    if (result.segments > 0)
      events.push({
        event: 'ai.localize',
        target: { uid: contentType.uid, documentId, locale, field: fieldIdentity(path, result.value) },
        counts: { segments: result.segments, translated: result.translated, kept: result.kept },
        meta: { sourceLocale: job.sourceLocale },
      });
    return result.value;
  });
  if (unknown.length) {
    logger.warn('an AI translation was refused: the source of a field could not be read', {
      count: unknown.length,
    });
    throw new errors.ValidationError(
      'An AI translation of a Magic Editor X field could not be checked against the source locale',
      formErrorDetails('AI_TRANSLATION_UNSAFE', unknown)
    );
  }
  const result = await next();
  try {
    await strapi.plugin('magic-editor-x').service('audit').recordMany(events);
  } catch {
    // The audit trail never blocks a write.
  }
  return result;
};

/**
 * Wraps the i18n AI services (call in `bootstrap`). No-op without the i18n
 * plugin or when the services are missing (other Strapi versions); logs a
 * warning when only one of them exists, because then values cannot be guarded.
 * @param {object} strapi - Strapi instance.
 * @returns {'wrapped'|'absent'|'unsupported'} What happened.
 */
const wrapAiLocalizations = (strapi) => {
  const registry = typeof strapi.get === 'function' ? strapi.get('services') : null;
  if (!registry || typeof registry.get !== 'function' || typeof registry.extend !== 'function')
    return 'absent';
  const localizations = registry.get(LOCALIZATIONS_UID);
  const translations = registry.get(TRANSLATIONS_UID);
  if (!localizations && !translations) return 'absent';
  if (
    !localizations ||
    !translations ||
    typeof localizations.generateDocumentLocalizations !== 'function' ||
    typeof translations.generateTranslations !== 'function'
  ) {
    createLogger(strapi).warn(
      'Strapi AI translations have an unknown shape; Magic Editor X fields are not protected from them'
    );
    return 'unsupported';
  }
  if (!localizations[WRAPPED]) {
    registry.extend(LOCALIZATIONS_UID, (current) => {
      const wrapped = { ...current, [WRAPPED]: true };
      wrapped.generateDocumentLocalizations = function generateDocumentLocalizations(params) {
        const document = params && params.document;
        const job = {
          uid: params && params.model,
          documentId: document && document.documentId,
          sourceLocale: document && document.locale,
        };
        // `this` is the wrapped service, so stubs and `isEnabled` resolve on it.
        return runInJob(job, () => current.generateDocumentLocalizations.call(this, params));
      };
      return wrapped;
    });
  }
  if (!translations[WRAPPED]) {
    registry.extend(TRANSLATIONS_UID, (current) => ({
      ...current,
      [WRAPPED]: true,
      generateTranslations(params) {
        const job = currentJob();
        if (!job || !params || !isPlainObject(params.content)) return current.generateTranslations(params);
        return current.generateTranslations({
          ...params,
          content: reducePayload(strapi, job, params.content),
        });
      },
    }));
  }
  return 'wrapped';
};

module.exports = {
  wrapAiLocalizations,
  createRepairMiddleware,
  reducePayload,
  runInJob,
  currentJob,
};

'use strict';

const { errors } = require('@strapi/utils');
const { guardQuery, blockingIssues } = require('./publish-guard');
const { formErrorDetails } = require('./form-errors');
const { isPlainObject } = require('../../../shared/editor-data.mjs');

/**
 * Releases readiness of the publish guard (2.4).
 *
 * Strapi 5.61 Content Releases (`@strapi/content-releases`
 * `server/src/utils/index.ts` `isEntryValid`) marks a release entry "Ready to
 * publish" when `strapi.entityValidator.validateEntityCreation(model, entry,
 * { isDraft: false, ... })` passes. That validator knows nothing about custom
 * fields (a `json` attribute is `yup.mixed()`), so an entry the publish guard
 * would refuse showed as ready and only failed when the release was
 * published. Strapi offers no documented hook for custom field validation,
 * so the plugin wraps `validateEntityCreation` (the one function Releases,
 * and the Document Service when it writes a published version, call): for a
 * draft-and-publish content type and `isDraft: false`, after Strapi's own
 * validation, it runs the same check as the publish guard (`blockingIssues`,
 * errors of guarded fields only; warnings never count) and throws the same
 * `ValidationError` `QUALITY_GATE`.
 *
 * Effects: Releases show such entries as "Not ready to publish" (and become
 * ready once fixed); `documents(uid).create/update({ status: 'published' })`,
 * which publish through the repository without the `publish` middleware, are
 * now checked too. A normal publish is checked twice with the same result.
 */

const ORIGINAL = Symbol.for('magic-editor-x.release-readiness.original');

/**
 * Wraps the entity validator. Idempotent.
 * @param {object} strapi - Strapi instance.
 * @returns {boolean} True when the validator was wrapped by this call.
 */
const registerReleaseReadiness = (strapi) => {
  const validator = strapi.entityValidator;
  if (!validator || typeof validator.validateEntityCreation !== 'function') return false;
  if (validator.validateEntityCreation[ORIGINAL]) return false;
  const original = validator.validateEntityCreation;
  const guarded = new Map();
  const wrapped = async function validateEntityCreation(model, data, options, ...rest) {
    const result = await original.call(this, model, data, options, ...rest);
    if (
      !options ||
      options.isDraft !== false ||
      !model ||
      !model.options ||
      model.options.draftAndPublish !== true ||
      !isPlainObject(data)
    )
      return result;
    if (!guarded.has(model.uid)) guarded.set(model.uid, guardQuery(strapi, model) !== null);
    if (!guarded.get(model.uid)) return result;
    const issues = await blockingIssues(strapi, model, [data]);
    if (issues.length) {
      throw new errors.ValidationError(
        'Quality checks failed for a Magic Editor X field',
        formErrorDetails(
          'QUALITY_GATE',
          issues.map((issue) => issue.field),
          { issues }
        )
      );
    }
    return result;
  };
  wrapped[ORIGINAL] = original;
  validator.validateEntityCreation = wrapped;
  return true;
};

/**
 * Restores the original validator (the validator object is shared by every
 * Strapi instance of the process).
 * @param {object} strapi - Strapi instance.
 */
const unregisterReleaseReadiness = (strapi) => {
  const validator = strapi.entityValidator;
  const current = validator && validator.validateEntityCreation;
  if (current && current[ORIGINAL]) validator.validateEntityCreation = current[ORIGINAL];
};

module.exports = { registerReleaseReadiness, unregisterReleaseReadiness };

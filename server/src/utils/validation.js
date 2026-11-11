'use strict';

const { z } = require('zod');
const { errors } = require('@strapi/utils');

/**
 * Request validation helpers. Every route parses its params, query and body with
 * a strict, bounded zod schema; failures become a Strapi ValidationError (400)
 * with field details and never echo the input.
 */

/** Content type UID such as `api::article.article` or `plugin::x.y`. */
const uidSchema = z
  .string()
  .max(160)
  .regex(/^(api|plugin)::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/);

/** Strapi documentId (cuid2, lowercase alphanumerics). */
const documentIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);

/** Locale code such as `en`, `de-CH`, `zh-Hans-CN`. */
const localeSchema = z.string().regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/);

/** Field path: `body`, `sections.0.text`, `blocks.2.content`. */
const fieldPathSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}(\.(\d{1,4}|[A-Za-z_][A-Za-z0-9_]{0,79})){0,8}$/);

/** Identifies one editor field of one document version. */
const fieldTargetSchema = z.strictObject({
  uid: uidSchema,
  documentId: documentIdSchema,
  locale: localeSchema.nullish(),
  field: fieldPathSchema,
});

/**
 * Turns a zod error into `{ formErrors, fieldErrors }` with dotted paths
 * (`ai.model`, `fields.2.name`) so the admin can show each message next to its field.
 * @param {z.ZodError} error - Zod error.
 * @returns {{ formErrors: string[], fieldErrors: Record<string, string[]> }} Details.
 */
const issueDetails = (error) => {
  const formErrors = [];
  const fieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    if (!path) formErrors.push(issue.message);
    else (fieldErrors[path] = fieldErrors[path] || []).push(issue.message);
  }
  return { formErrors, fieldErrors };
};

/**
 * Parses input or throws a Strapi ValidationError with field details.
 * @template T
 * @param {z.ZodType<T>} schema - Zod schema.
 * @param {unknown} input - Untrusted input.
 * @returns {T} Parsed value.
 * @throws {errors.ValidationError} 400 with `details.errors`.
 */
const parseOrThrow = (schema, input) => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new errors.ValidationError('Validation failed', issueDetails(result.error));
  }
  return result.data;
};

module.exports = {
  z,
  errors,
  uidSchema,
  documentIdSchema,
  localeSchema,
  fieldPathSchema,
  fieldTargetSchema,
  parseOrThrow,
  issueDetails,
};

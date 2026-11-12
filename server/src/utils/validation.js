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

/** API content type UID (`api::article.article`); internal links never point to plugin types. */
const apiUidSchema = z
  .string()
  .max(160)
  .regex(/^api::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/);

/** Internal-link search: GET /links/search?uid&q&locale&page. */
const linkSearchSchema = z.strictObject({
  uid: apiUidSchema,
  q: z
    .string()
    .trim()
    .max(100)
    // eslint-disable-next-line no-control-regex -- control characters are rejected
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .optional(),
  locale: localeSchema.optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
});

/** Identifies one editor field of one document version. */
const fieldTargetSchema = z.strictObject({
  uid: uidSchema,
  documentId: documentIdSchema,
  locale: localeSchema.nullish(),
  field: fieldPathSchema,
});

/** Media Library file reference: numeric id or documentId. */
const mediaIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[A-Za-z0-9]{1,64}$/),
]);

/** Link check: POST /quality/links. */
const qualityLinksSchema = z.strictObject({
  internal: z
    .array(
      z.strictObject({
        uid: apiUidSchema,
        documentId: documentIdSchema,
        locale: localeSchema.nullish(),
      })
    )
    .max(100)
    .optional(),
  media: z.array(mediaIdSchema).max(100).optional(),
  external: z.array(z.string().min(1).max(2048)).max(20).optional(),
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
  apiUidSchema,
  linkSearchSchema,
  qualityLinksSchema,
  parseOrThrow,
  issueDetails,
};

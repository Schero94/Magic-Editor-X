'use strict';

const { service } = require('./helpers');
const { z, parseOrThrow, fieldTargetSchema, errors } = require('../utils/validation');
const { readPositionalEntries } = require('../utils/field-identity');
const { createRateLimiter } = require('../utils/rate-limit');
const { basePathOf } = require('../../../shared/field-identity.mjs');
const { urlBase } = require('../../../shared/media-urls.mjs');

/** Requests per admin and minute (per process); the editor batches and caches. */
const PER_MINUTE = 120;
const MAX_URLS = 100;

const signSchema = z.strictObject({
  target: fieldTargetSchema.optional(),
  urls: z
    .array(
      z
        .string()
        .min(1)
        .max(2048)
        .refine((value) => /^(https?:\/\/|\/(?!\/))/i.test(value), 'Invalid URL')
    )
    .min(1)
    .max(MAX_URLS),
});

/**
 * Reads the stored draft value of a field (by key inside a repeatable
 * component or dynamic zone, else along its path).
 * @param {object} strapi - Strapi instance.
 * @param {{ uid: string, documentId: string, locale?: string|null, field: string, fieldKey?: string }} target - Field.
 * @returns {Promise<unknown>} Stored value or undefined.
 */
const readStoredValue = async (strapi, target) => {
  if (target.fieldKey) {
    const entries = await readPositionalEntries(strapi, {
      uid: target.uid,
      documentId: target.documentId,
      locale: target.locale || undefined,
      basePath: basePathOf(target.field),
    });
    const entry = entries.find((candidate) => candidate.fieldKey === target.fieldKey);
    return entry ? entry.value : undefined;
  }
  const parts = target.field.split('.');
  const attribute = strapi.contentType(target.uid).attributes[parts[0]];
  const populate =
    attribute && ['component', 'dynamiczone'].includes(attribute.type) ? { [parts[0]]: true } : undefined;
  let value = await strapi.documents(target.uid).findOne({
    documentId: target.documentId,
    locale: target.locale || undefined,
    status: 'draft',
    ...(populate ? { populate } : {}),
  });
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[/^\d+$/.test(part) ? Number(part) : part];
  }
  return value;
};

/**
 * Media Library read check per file, like the upload plugin's own: action
 * `plugin::upload.read` with its conditions (creator and roles populated).
 * @param {object} strapi - Strapi instance.
 * @param {object} userAbility - CASL ability.
 * @returns {Promise<object|null>} Permissions manager, or null without the action.
 */
const mediaLibraryReader = async (strapi, userAbility) => {
  if (!userAbility) return null;
  const pm = strapi.service('admin::permission').createPermissionsManager({
    ability: userAbility,
    action: 'plugin::upload.read',
    model: 'plugin::upload.file',
  });
  if (!pm.isAllowed) return null;
  return pm;
};

module.exports = ({ strapi }) => {
  const limiter = createRateLimiter({ max: PER_MINUTE, windowMs: 60000 });

  return {
    /**
     * @route POST /magic-editor-x/media/signed-urls { target?: { uid, documentId, locale?, field, fieldKey? }, urls: string[1..100] }
     * @auth admin; plugin::magic-editor-x.access. A file is signed when the admin may read it in the
     *   Media Library (`plugin::upload.read` with its conditions) or when the target field's stored
     *   draft refers to it and the admin may read that document (Content Manager, 404 otherwise).
     * @returns {{ data: { private: boolean, urls: Record<string, string> } }} Fresh signed URL per requested URL
     *   (key: the URL without query). Public providers: `{ private: false, urls: {} }`.
     * @throws 400 invalid body, 404 document not readable, 429 too many requests.
     */
    async signedUrls(ctx) {
      const input = parseOrThrow(signSchema, ctx.request.body || {});
      ctx.set('Cache-Control', 'no-store');
      const media = service(strapi, 'media');
      const userId = ctx.state.user && ctx.state.user.id;
      const hit = limiter.hit(`media-sign:${userId}`);
      if (!hit.allowed) {
        ctx.set('Retry-After', String(Math.ceil(hit.retryAfterMs / 1000)));
        throw new errors.RateLimitError('Too many requests');
      }
      let referenced = null;
      if (input.target) {
        await service(strapi, 'access').checkField({
          userAbility: ctx.state.userAbility,
          uid: input.target.uid,
          documentId: input.target.documentId,
          locale: input.target.locale || null,
          field: input.target.field,
          fieldKey: input.target.fieldKey,
          allowUnsavedKey: true,
        });
      }
      // Same checks for every provider; a public one has nothing to sign.
      if (!(await media.isPrivate())) {
        ctx.body = { data: { private: false, urls: {} } };
        return;
      }
      if (input.target) referenced = media.referencesOf(await readStoredValue(strapi, input.target));
      const pm = await mediaLibraryReader(strapi, ctx.state.userAbility);
      if (!pm && !referenced) {
        ctx.body = { data: { private: true, urls: {} } };
        return;
      }
      const authors = new Map();
      const allowRows = async (rows) => {
        const allowed = new Set();
        const rest = [];
        for (const row of rows) {
          if (referenced && (referenced.ids.has(row.id) || referenced.bases.has(urlBase(row.url))))
            allowed.add(row.id);
          else rest.push(row.id);
        }
        if (!pm || !rest.length) return allowed;
        const withCreators = await strapi.db.query('plugin::upload.file').findMany({
          where: { id: { $in: rest } },
          populate: { createdBy: { select: ['id'] } },
          limit: rest.length,
        });
        for (const row of withCreators) {
          const creatorId = row.createdBy && row.createdBy.id;
          if (creatorId && !authors.has(creatorId))
            authors.set(creatorId, await strapi.service('admin::user').findOne(creatorId, ['roles']));
          const author = creatorId ? authors.get(creatorId) : null;
          if (pm.ability.can(pm.action, pm.toSubject({ ...row, createdBy: author }))) allowed.add(row.id);
        }
        return allowed;
      };
      ctx.body = { data: await media.signUrls(input.urls, allowRows) };
    },
  };
};

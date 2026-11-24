'use strict';

const { service, identityTarget, positionalReadOnly, recordAudit } = require('./helpers');
const { fieldIdentity } = require('../../../shared/audit.mjs');
const { z, parseOrThrow, fieldTargetSchema, documentIdSchema } = require('../utils/validation');

/** Version name: plain text, at most 120 characters, no control characters; '' or null removes it. */
const labelSchema = z
  .string()
  .trim()
  .max(120)
  // eslint-disable-next-line no-control-regex -- control characters are rejected
  .regex(/^[^\u0000-\u001f\u007f]*$/)
  .nullable();

const createSchema = fieldTargetSchema.extend({ content: z.unknown(), label: labelSchema.optional() });
const renameSchema = z.strictObject({ label: labelSchema });
/** `content=false` asks whether a published version exists, without the field value (2.12). */
const contentFlagSchema = z.enum(['true', 'false']).optional();

/**
 * Version history. Every handler checks Content Manager access to the
 * document, locale and field; a document the caller cannot read answers 404.
 */
module.exports = ({ strapi }) => {
  const access = () => service(strapi, 'access');
  const history = () => service(strapi, 'history');
  const published = () => service(strapi, 'published');

  return {
    /**
     * Versions of one field. Fields inside a repeatable component or dynamic zone are listed by
     * their identity (2.4): versions saved under positional paths before 2.4 are mapped to their
     * entry once by block ids; the ones that cannot be mapped are listed read-only in
     * `meta.positionalVersions` (only when the entry has a key).
     * @route GET /magic-editor-x/history?uid&documentId&locale&field&fieldKey?
     * @auth admin; plugin::magic-editor-x.access; CM read on the document
     * @returns {{ data: object[], meta: { canRestore: boolean, canCreate: boolean, fieldKey: string|null, positionalVersions?: object[] } }} Versions.
     * @sideeffect Moves mappable pre-2.4 positional versions to their entry's identity.
     */
    async list(ctx) {
      const target = parseOrThrow(fieldTargetSchema, { ...ctx.query, locale: ctx.query.locale || null });
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      const where = { uid: target.uid, documentId: target.documentId, locale: result.locale };
      const meta = { canRestore: result.canUpdate, canCreate: result.canUpdate, fieldKey: result.fieldKey };
      if (!result.positional) {
        ctx.body = { data: await history().list({ ...where, field: result.fieldName }), meta };
        return;
      }
      const legacy = await history().adoptLegacy({ ...where, basePath: result.basePath }, result.entries);
      if (!result.fieldName) {
        // No key stored yet: only versions proven to be this entry's, and nothing can be written.
        const own = result.entries.find((entry) => entry.path === target.field);
        ctx.body = {
          data: own ? legacy.byPath.get(own.path) || [] : [],
          meta: { ...meta, canRestore: false, canCreate: false },
        };
        return;
      }
      ctx.body = {
        data: await history().list({ ...where, field: result.fieldName }),
        meta: { ...meta, positionalVersions: legacy.unmapped },
      };
    },

    /**
     * @route GET /magic-editor-x/history/:id
     * @auth admin; plugin::magic-editor-x.access; CM read on the snapshot's document
     */
    async findOne(ctx) {
      const { id } = parseOrThrow(z.strictObject({ id: documentIdSchema }), { id: ctx.params.id });
      const { target, snapshot } = await history().findOne(id);
      const result = await access().checkField({
        userAbility: ctx.state.userAbility,
        ...identityTarget(target),
      });
      // 2.4: `?intent=restore` (sent by the editor's Restore action) records `version.restore`
      // in the audit trail; restoring itself still happens in the browser.
      if (ctx.query && ctx.query.intent === 'restore' && result.canUpdate)
        await recordAudit(strapi, {
          event: 'version.restore',
          target: {
            uid: target.uid,
            documentId: target.documentId,
            locale: result.locale,
            field: result.fieldName || fieldIdentity(target.field),
          },
          counts: { version: Number(snapshot.version) || 0, blocks: snapshot.stats?.blocks || 0 },
        });
      ctx.body = { data: snapshot };
    },

    /**
     * @route POST /magic-editor-x/history { uid, documentId, locale?, field, fieldKey?, content, label? }
     * @auth admin; plugin::magic-editor-x.access; CM update on the document
     * @throws 403 without update rights; 409 `FIELD_KEY_REQUIRED` for a positional field whose stored value has no key yet.
     * @sideeffect Stores a snapshot (skipped when identical to the latest one; a label then names the latest one).
     */
    async create(ctx) {
      const input = parseOrThrow(createSchema, ctx.request.body || {});
      const { content, label, ...target } = input;
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!result.canUpdate) return ctx.forbidden('You cannot edit this document');
      if (!result.fieldName) return positionalReadOnly(ctx, 'FIELD_KEY_REQUIRED');
      const outcome = await history().create(
        { uid: target.uid, documentId: target.documentId, locale: result.locale, field: result.fieldName },
        content,
        { trigger: 'manual', userId: ctx.state.user.id, label: label || null }
      );
      ctx.status = outcome.created ? 201 : 200;
      ctx.body = { data: outcome.snapshot, meta: { created: outcome.created } };
      return undefined;
    },

    /**
     * The published version of one field (2.12, "Changes since last publish"): the editor marks
     * blocks added, changed or removed since then. Read with the Document Service
     * (`status: 'published'`) through the caller's Content Manager read permission query.
     * @route GET /magic-editor-x/published-version?uid&documentId&locale&field&fieldKey?&content?
     * @auth admin; plugin::magic-editor-x.access; CM read on the document, locale and field
     * @access 404 when the type, field or document does not exist or cannot be read (same as GET /history).
     * @returns {{ data: { draftAndPublish: boolean, published: boolean, publishedAt: string|null, content: object|null } }}
     *   `published: false` for types without Draft & Publish, entries never published (or not readable
     *   in their published version); `content` is null with `content=false`, for an empty field or an
     *   entry of a repeatable component or dynamic zone that did not exist when it was published.
     */
    async published(ctx) {
      const { content: contentFlag, ...query } = ctx.query || {};
      const withContent = parseOrThrow(contentFlagSchema, contentFlag) !== 'false';
      const target = parseOrThrow(fieldTargetSchema, { ...query, locale: query.locale || null });
      const result = await access().checkField({ userAbility: ctx.state.userAbility, ...target });
      if (!published().hasDraftAndPublish(target.uid)) {
        ctx.body = { data: { draftAndPublish: false, published: false, publishedAt: null, content: null } };
        return;
      }
      const version = await published().read(
        {
          userAbility: ctx.state.userAbility,
          uid: target.uid,
          documentId: target.documentId,
          locale: result.locale,
          field: target.field,
          fieldKey: result.fieldKey,
          positional: result.positional,
          basePath: result.basePath,
        },
        { content: withContent }
      );
      ctx.body = { data: { draftAndPublish: true, ...version } };
    },

    /**
     * Names, renames or unnames a version.
     * @route PUT /magic-editor-x/history/:id { label }
     * @auth admin; plugin::magic-editor-x.access; CM update on the version's document
     * @access 404 when the version is missing or its document cannot be read; 403 when it can be read but not updated;
     *   409 `POSITIONAL_READ_ONLY` for a version saved by position before 2.4 that could not be mapped to one entry.
     * @sideeffect Updates the version's label.
     */
    async rename(ctx) {
      const { id } = parseOrThrow(z.strictObject({ id: documentIdSchema }), { id: ctx.params.id });
      const { label } = parseOrThrow(renameSchema, ctx.request.body || {});
      const { target } = await history().findOne(id);
      const result = await access().checkField({
        userAbility: ctx.state.userAbility,
        ...identityTarget(target),
      });
      if (!result.canUpdate) return ctx.forbidden('You cannot edit this document');
      // Versions saved by position before 2.4 that belong to no single entry are read-only.
      if (target.legacy) return positionalReadOnly(ctx, 'POSITIONAL_READ_ONLY');
      ctx.body = { data: await history().rename(id, label) };
      await recordAudit(strapi, {
        event: 'version.rename',
        target: {
          uid: target.uid,
          documentId: target.documentId,
          locale: result.locale,
          field: result.fieldName || fieldIdentity(target.field),
        },
        counts: { version: Number(ctx.body.data.version) || 0 },
      });
      return undefined;
    },
  };
};

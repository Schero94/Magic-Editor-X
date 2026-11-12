'use strict';

const { errors } = require('@strapi/utils');
const { resolveEditorField } = require('../utils/editor-fields');
const { readPositionalEntries } = require('../utils/field-identity');
const { fieldIdentity, isValidFieldKey } = require('../../../shared/field-identity.mjs');

/**
 * Entry-level access checks for collaboration and version history.
 *
 * The rule: an admin may read (or edit) a Magic Editor X field of a document
 * through this plugin only when the Content Manager would let them read (or
 * update) that document, locale and field. The check reuses Strapi's own
 * permission checker, including conditions such as "is creator", field-level
 * permissions and locale permissions. A denied or missing document answers
 * 404 so the response does not reveal whether it exists.
 */

const notFound = () => new errors.NotFoundError('Not found');

module.exports = ({ strapi }) => {
  /**
   * Builds the permission checker of the Content Manager.
   * @param {object} userAbility - CASL ability from ctx.state.userAbility.
   * @param {string} uid - Content type uid.
   * @returns {object} Permission checker.
   */
  const checker = (userAbility, uid) =>
    strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model: uid });

  /**
   * Finds the document version if the permission query (with conditions) allows it.
   * @param {object} pc - Permission checker.
   * @param {'read'|'update'} action - CM action.
   * @param {string} uid - Content type uid.
   * @param {string} documentId - Document id.
   * @param {string|undefined} locale - Locale (only for localised types).
   * @returns {Promise<object|null>} Document or null.
   */
  const findAllowed = async (pc, action, uid, documentId, locale) => {
    const query = await pc.sanitizedQuery[action]({});
    const filters = query && query.filters ? { $and: [{ documentId }, query.filters] } : { documentId };
    return strapi.documents(uid).findFirst({ filters, locale, status: 'draft', fields: ['documentId'] });
  };

  return {
    /**
     * Checks access to one editor field of one document and resolves the
     * field's storage identity (2.4): everything keyed by field (versions,
     * comments, rooms, link reports) uses `fieldName`.
     *
     * - Top-level fields and fields in single components: `fieldName` is the path.
     * - Fields in a repeatable component or dynamic zone (positional): with `fieldKey`, the stored
     *   draft of this document and locale must have a value with that key at the same attribute
     *   (any index), else 404; `allowUnsavedKey` (live sessions only) accepts a key that is not
     *   saved yet when the caller can update the document (`unsaved: true`). Without `fieldKey`,
     *   the key is read from the stored value at the path's index; a stored value without a key
     *   (or no entry there) gives `fieldName: null`.
     * @param {{ userAbility: object, uid: string, documentId: string, locale?: string|null, field: string, fieldKey?: string|null, allowUnsavedKey?: boolean }} target - What is accessed.
     * @returns {Promise<{ canRead: true, canUpdate: boolean, locale: string|null, topLevelField: string, fieldName: string|null, fieldKey: string|null, positional: boolean, basePath: string, unsaved: boolean, entries: Array<object>|null }>}
     *   Access and identity; `entries` lists the stored entries of a positional field (path, key, block ids).
     * @throws {errors.NotFoundError} When the type, field, document or keyed entry does not exist or cannot be read.
     */
    async checkField({ userAbility, uid, documentId, locale, field, fieldKey, allowUnsavedKey = false }) {
      if (!userAbility) throw notFound();
      const contentType = strapi.contentType(uid);
      if (!contentType || !uid.startsWith('api::')) throw notFound();
      const resolved = resolveEditorField(strapi, contentType, field);
      if (!resolved) throw notFound();
      if (fieldKey !== undefined && fieldKey !== null && (!resolved.positional || !isValidFieldKey(fieldKey)))
        throw notFound();
      const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
      let effectiveLocale = null;
      if (localized) {
        effectiveLocale =
          locale || (await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.()) || null;
        if (!effectiveLocale) throw notFound();
      }
      const pc = checker(userAbility, uid);
      // Field permissions name component fields with their path (`sections.body`), never the bare component.
      const permissionField = resolved.permissionField || resolved.topLevel;
      if (pc.cannot.read() || pc.cannot.read(null, permissionField)) throw notFound();
      const readable = await findAllowed(pc, 'read', uid, documentId, effectiveLocale || undefined);
      if (!readable) throw notFound();
      let canUpdate = false;
      if (!pc.cannot.update() && !pc.cannot.update(null, permissionField)) {
        canUpdate = Boolean(await findAllowed(pc, 'update', uid, documentId, effectiveLocale || undefined));
      }
      const base = {
        canRead: true,
        canUpdate,
        locale: effectiveLocale,
        topLevelField: resolved.topLevel,
        positional: resolved.positional,
        basePath: resolved.basePath,
      };
      if (!resolved.positional)
        return { ...base, fieldName: field, fieldKey: null, unsaved: false, entries: null };
      const entries = await readPositionalEntries(strapi, {
        uid,
        documentId,
        locale: effectiveLocale,
        basePath: resolved.basePath,
      });
      if (fieldKey) {
        const saved = entries.some((entry) => entry.fieldKey === fieldKey);
        // A key that is not stored yet is accepted only for a live session of someone who can edit:
        // the room is private to whoever generated the key until the entry is saved.
        if (!saved && !(allowUnsavedKey && canUpdate)) throw notFound();
        return {
          ...base,
          fieldName: fieldIdentity(resolved.basePath, fieldKey, true),
          fieldKey,
          unsaved: !saved,
          entries,
        };
      }
      const entry = entries.find((candidate) => candidate.path === field);
      const key = entry ? entry.fieldKey : null;
      return {
        ...base,
        fieldName: key ? fieldIdentity(resolved.basePath, key, true) : null,
        fieldKey: key,
        unsaved: false,
        entries,
      };
    },

    /**
     * Lists the collection types the admin can read in the Content Manager
     * (for the embedded-entry picker and the custom block form).
     * @param {object} userAbility - CASL ability.
     * @returns {Array<{ uid: string, displayName: string, kind: string, attributes: string[] }>} Types.
     */
    readableContentTypes(userAbility) {
      return Object.values(strapi.contentTypes)
        .filter((ct) => ct.uid.startsWith('api::'))
        .filter((ct) => {
          try {
            return !checker(userAbility, ct.uid).cannot.read();
          } catch {
            return false;
          }
        })
        .map((ct) => ({
          uid: ct.uid,
          kind: ct.kind,
          displayName: ct.info?.displayName || ct.info?.singularName || ct.uid,
          attributes: Object.entries(ct.attributes || {})
            .filter(([, attribute]) =>
              [
                'string',
                'text',
                'uid',
                'email',
                'integer',
                'biginteger',
                'decimal',
                'float',
                'date',
                'datetime',
                'enumeration',
              ].includes(attribute.type)
            )
            .map(([name]) => name),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    /**
     * Re-creates the ability of an admin (for long-lived sockets).
     * @param {number} userId - Admin user id.
     * @returns {Promise<object|null>} Ability, or null when the user is gone or inactive.
     */
    async abilityForUser(userId) {
      const user = await strapi.db
        .query('admin::user')
        .findOne({ where: { id: userId }, populate: ['roles'] });
      if (!user || user.isActive === false || user.blocked === true) return null;
      return strapi.service('admin::permission').engine.generateUserAbility(user);
    },
  };
};

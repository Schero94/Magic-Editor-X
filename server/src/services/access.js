'use strict';

const { errors } = require('@strapi/utils');
const { resolveEditorField } = require('../utils/editor-fields');

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
     * Checks access to one editor field of one document.
     * @param {{ userAbility: object, uid: string, documentId: string, locale?: string|null, field: string }} target - What is accessed.
     * @returns {Promise<{ canRead: true, canUpdate: boolean, locale: string|null, topLevelField: string }>} Access.
     * @throws {errors.NotFoundError} When the type, field or document does not exist or cannot be read.
     */
    async checkField({ userAbility, uid, documentId, locale, field }) {
      if (!userAbility) throw notFound();
      const contentType = strapi.contentType(uid);
      if (!contentType || !uid.startsWith('api::')) throw notFound();
      const resolved = resolveEditorField(strapi, contentType, field);
      if (!resolved) throw notFound();
      const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
      let effectiveLocale = null;
      if (localized) {
        effectiveLocale =
          locale || (await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.()) || null;
        if (!effectiveLocale) throw notFound();
      }
      const pc = checker(userAbility, uid);
      if (pc.cannot.read() || pc.cannot.read(null, resolved.topLevel)) throw notFound();
      const readable = await findAllowed(pc, 'read', uid, documentId, effectiveLocale || undefined);
      if (!readable) throw notFound();
      let canUpdate = false;
      if (!pc.cannot.update() && !pc.cannot.update(null, resolved.topLevel)) {
        canUpdate = Boolean(await findAllowed(pc, 'update', uid, documentId, effectiveLocale || undefined));
      }
      return { canRead: true, canUpdate, locale: effectiveLocale, topLevelField: resolved.topLevel };
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

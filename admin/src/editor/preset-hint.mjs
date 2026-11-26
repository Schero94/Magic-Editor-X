/**
 * 2.13: where a field's preset is changed. The "Need more?" entry of a `simple` field's More tools
 * opens the Content-Type Builder page of the content type that holds the field (installed CTB
 * route `content-types/:contentTypeUid` under `/plugins/content-type-builder`). Fields inside
 * components are edited from the same page, so the content type is the target in every case.
 */

const CONTENT_TYPE_UID = /^api::[a-z0-9_-]{1,100}\.[a-z0-9_-]{1,100}$/;

/**
 * Admin path of the Content-Type Builder page of a content type.
 * @param {unknown} uid - Content type uid of the edited entry.
 * @returns {string|null} Router path (relative to the admin base), or null for anything that is not an `api::` content type.
 */
export const presetHintPath = (uid) =>
  typeof uid === 'string' && CONTENT_TYPE_UID.test(uid)
    ? // The pattern allows only [a-z0-9_-:.], which need no escaping in a path.
      `/plugins/content-type-builder/content-types/${uid}`
    : null;

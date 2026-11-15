/**
 * Pure helpers of the Magic Editor X side panel and homepage widgets (2.5).
 */

export const CUSTOM_FIELD_UID = 'plugin::magic-editor-x.richtext';
/** Heartbeat interval while the tab is visible (the server keeps a row for 30 s). */
export const HEARTBEAT_MS = 15000;
/** Longest wait between presence requests after failures. */
export const MAX_BACKOFF_MS = 120000;
/** Without keyboard or pointer input for this long, the admin counts as idle. */
export const IDLE_AFTER_MS = 60000;
const MAX_DEPTH = 8;

/**
 * True when a Content Manager schema (or a component it uses) has a Magic Editor X field.
 * @param {{ attributes?: Record<string, object> }|undefined} schema - Content type or component schema.
 * @param {Record<string, { attributes?: object }>} [components] - Component schemas by uid.
 * @param {number} [depth=0] - Recursion depth.
 * @returns {boolean} Result.
 */
export const hasEditorFields = (schema, components = {}, depth = 0) => {
  if (!schema || !schema.attributes || depth > MAX_DEPTH) return false;
  return Object.values(schema.attributes).some((attribute) => {
    if (!attribute || typeof attribute !== 'object') return false;
    if (attribute.customField === CUSTOM_FIELD_UID) return true;
    if (attribute.type === 'component')
      return hasEditorFields(components[attribute.component], components, depth + 1);
    if (attribute.type === 'dynamiczone' && Array.isArray(attribute.components))
      return attribute.components.some((uid) => hasEditorFields(components[uid], components, depth + 1));
    return false;
  });
};

/**
 * Delay before the next presence request: the heartbeat interval, doubled per failure up to
 * MAX_BACKOFF_MS; a 429 waits at least a minute.
 * @param {number} failures - Consecutive failures.
 * @param {number|null} [status] - HTTP status of the last failure.
 * @returns {number} Milliseconds.
 */
export const nextDelay = (failures, status = null) => {
  if (!failures) return HEARTBEAT_MS;
  const delay = Math.min(MAX_BACKOFF_MS, HEARTBEAT_MS * 2 ** Math.min(failures, 4));
  return status === 429 ? Math.max(60000, delay) : delay;
};

/**
 * Random id of this browser tab (22 characters `[A-Za-z0-9_-]`).
 * @param {{ getRandomValues: (array: Uint8Array) => Uint8Array }} [source] - Crypto source.
 * @returns {string} Tab id.
 */
export const createTabId = (source = globalThis.crypto) => {
  const bytes = source.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Content Manager edit view path of an entry (relative to the admin base URL).
 * @param {{ kind: 'collectionType'|'singleType', uid: string, documentId: string, locale: string|null }} target - Entry.
 * @param {Record<string, string>} [extra] - Extra query parameters.
 * @returns {string} Router path.
 */
export const entryPath = (target, extra = {}) => {
  const value = target || {};
  const uid = encodeURIComponent(String(value.uid || ''));
  const path =
    value.kind === 'singleType'
      ? `/content-manager/single-types/${uid}`
      : `/content-manager/collection-types/${uid}/${encodeURIComponent(String(value.documentId || ''))}`;
  const params = new URLSearchParams();
  if (value.locale) params.set('plugins[i18n][locale]', value.locale);
  for (const [key, item] of Object.entries(extra)) params.set(key, item);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

/**
 * Fields worth listing in a panel section (count above zero), in document order.
 * @param {Array<object>} fields - Summary fields.
 * @param {(field: object) => number} count - Count of a field.
 * @returns {Array<object>} Fields.
 */
export const fieldsWith = (fields, count) =>
  Array.isArray(fields) ? fields.filter((field) => count(field) > 0) : [];

/**
 * Problems of a field for the quality section: lint errors and warnings plus broken links of the draft.
 * @param {{ issues?: { errors: number, warnings: number }, brokenLinks?: { draft: number|null } }} field - Summary field.
 * @returns {number} Count.
 */
export const fieldProblems = (field) =>
  (field && field.issues ? field.issues.errors + field.issues.warnings : 0) +
  (field && field.brokenLinks && field.brokenLinks.draft ? field.brokenLinks.draft : 0);

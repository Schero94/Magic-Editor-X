/**
 * "Changes since last publish" on or off (2.12), remembered per admin user in
 * this browser's localStorage (`magic-editor-x:published-changes:<user id>`).
 * Off by default. Storage that is full, blocked or holds something else reads
 * as off; failures never reach the editor. Nothing is sent anywhere.
 *
 * Every field of the page follows the same choice: the hook reads it with
 * `useSyncExternalStore(subscribePublishedChangesPreference, ...)`.
 */

const PREFIX = 'magic-editor-x:published-changes:';

/** Fields on the page that follow the choice (turning it on in one field turns it on in all). */
const listeners = new Set();
/** Choice per storage key, read from localStorage once (and kept when storage is blocked). */
const cache = new Map();

/**
 * Storage key for an admin user.
 * @param {number|string|null|undefined} owner - Admin user id.
 * @returns {string|null} Key, or null without a user.
 */
const keyOf = (owner) =>
  owner === null || owner === undefined || owner === '' ? null : `${PREFIX}${String(owner).slice(0, 40)}`;

/**
 * Follows changes of the choice made in this page.
 * @param {() => void} listener - Called after every change.
 * @returns {() => void} Unsubscribe.
 */
export const subscribePublishedChangesPreference = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Whether the admin user turned the marks on.
 * @param {number|string|null|undefined} owner - Admin user id.
 * @returns {boolean} True when on.
 */
export const readPublishedChangesPreference = (owner) => {
  const key = keyOf(owner);
  if (!key) return false;
  if (cache.has(key)) return cache.get(key);
  let on;
  try {
    on = window.localStorage.getItem(key) === 'on';
  } catch {
    on = false;
  }
  cache.set(key, on);
  return on;
};

/**
 * Remembers the choice of an admin user (off removes the key) and tells every field.
 * @param {number|string|null|undefined} owner - Admin user id.
 * @param {boolean} on - New state.
 */
export const savePublishedChangesPreference = (owner, on) => {
  const key = keyOf(owner);
  if (!key) return;
  cache.set(key, Boolean(on));
  try {
    if (on) window.localStorage.setItem(key, 'on');
    else window.localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the choice lasts for this page only.
  }
  for (const listener of [...listeners]) listener();
};

/** Test helper: forgets the cached choices (storage is read again). */
export const resetPublishedChangesPreferenceCache = () => cache.clear();

import { isExpired } from './drafts-logic.mjs';

/**
 * Local draft buffers (2.5) in IndexedDB: database `magic-editor-x`, object
 * store `drafts` (keyPath `id`, see drafts-logic.mjs). IndexedDB is used
 * instead of sessionStorage because a buffer must survive a closed tab and a
 * browser crash, and instead of localStorage because field content can be
 * megabytes (localStorage holds about 5 MB per origin, shared with the admin)
 * and writes must not block typing. Every call resolves (never rejects):
 * without IndexedDB (blocked storage, some private modes) nothing is buffered.
 */

const DB_NAME = 'magic-editor-x';
const STORE = 'drafts';

let dbPromise = null;

/**
 * Opens (once) the database.
 * @returns {Promise<IDBDatabase|null>} Database, or null when IndexedDB is unavailable.
 */
const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request;
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading or deleting the database: close and reopen on the next call.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
};

/**
 * Runs one request in a transaction.
 * @param {'readonly'|'readwrite'} mode - Transaction mode.
 * @param {(store: IDBObjectStore) => IDBRequest|void} run - Builds the request.
 * @returns {Promise<unknown>} Request result, or null on any failure.
 */
const withStore = async (mode, run) => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : true);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

/**
 * @param {string} id - Buffer id.
 * @returns {Promise<object|null>} Record or null.
 */
export const getDraft = async (id) => (id ? (await withStore('readonly', (s) => s.get(id))) || null : null);

/**
 * @param {object} record - Record with `id`.
 * @returns {Promise<boolean>} True when written.
 */
export const putDraft = async (record) =>
  Boolean(record && record.id && (await withStore('readwrite', (s) => s.put(record))) !== null);

/**
 * @param {string} id - Buffer id.
 * @returns {Promise<boolean>} True when the delete ran.
 */
export const deleteDraft = async (id) =>
  Boolean(id && (await withStore('readwrite', (s) => s.delete(id))) !== null);

/**
 * Removes every buffer of every admin in this browser (logout).
 * @returns {Promise<boolean>} True when the store was cleared.
 */
export const clearDrafts = async () => (await withStore('readwrite', (s) => s.clear())) !== null;

let pruned = false;

/**
 * Removes expired buffers, once per page load.
 * @param {number} now - Current time (ms).
 * @returns {Promise<void>}
 */
export const pruneDrafts = async (now) => {
  if (pruned) return;
  pruned = true;
  await withStore('readwrite', (store) => {
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      if (isExpired(cursor.value, now)) cursor.delete();
      cursor.continue();
    };
  });
};

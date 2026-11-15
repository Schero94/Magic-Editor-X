/**
 * Local draft buffer (2.5): pure rules, shared by the field hook, the
 * IndexedDB store and the logout watcher (tests/drafts.test.mjs).
 *
 * A buffer is the content of one editor field that differs from what is
 * saved, kept in this browser so a reload, a crash, a closed tab or an ended
 * session does not lose it. It is keyed by the admin user and the field:
 * `<owner>|<uid>|<documentId or "new">|<locale or "-">|<field identity>`.
 * A new entry has no documentId yet, so it is keyed by content type, locale
 * and field. A field inside a repeatable component or dynamic zone uses its
 * saved key (`<base path>#<fieldKey>`), otherwise its path; `baseHash` (the
 * fingerprint of the saved value the buffer was taken against) catches a
 * path that now names another entry or content saved meanwhile.
 */

import { basePathOf, isPositionalFieldPath, isValidFieldKey } from '../../../shared/field-identity.mjs';

export const DRAFT_RECORD_VERSION = 1;
/** Default lifetime of a buffer (config `drafts.ttlHours`). */
export const DEFAULT_DRAFT_TTL_HOURS = 72;
/** Delay between the last change and the write. */
export const DRAFT_WRITE_DELAY_MS = 800;
/** Largest buffer written (characters of JSON); larger content is not buffered. */
export const MAX_DRAFT_CHARS = 6 * 1024 * 1024;
/** A voluntary logout is the RTK `logout` mutation followed by `admin/logout` within this window. */
export const VOLUNTARY_LOGOUT_WINDOW_MS = 60 * 1000;

const MAX_PART = 512;

/**
 * Id of the buffer of one field for one admin user.
 * @param {{ owner: string|number, uid: string, documentId?: string|null, locale?: string|null, field: string, fieldKey?: string|null }} target - Field; `fieldKey` only when it is saved.
 * @returns {string|null} Id, or null when the target is incomplete.
 */
export const draftIdentity = (target) => {
  if (!target || target.owner === undefined || target.owner === null || target.owner === '') return null;
  const { uid, field } = target;
  if (typeof uid !== 'string' || !uid || typeof field !== 'string' || !field) return null;
  const identity =
    isPositionalFieldPath(field) && isValidFieldKey(target.fieldKey)
      ? `${basePathOf(field)}#${target.fieldKey}`
      : field;
  const parts = [
    String(target.owner),
    uid,
    typeof target.documentId === 'string' && target.documentId ? target.documentId : 'new',
    typeof target.locale === 'string' && target.locale ? target.locale : '-',
    identity,
  ];
  if (parts.some((part) => part.length > MAX_PART)) return null;
  return parts.join('|');
};

/**
 * 53-bit FNV-1a style hash of a string (fingerprints only, not security relevant).
 * @param {string} text - Input.
 * @returns {string} Hex hash.
 */
export const hashText = (text) => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2246822519) >>> 0;
  }
  return `${h2.toString(16).padStart(8, '0')}${h1.toString(16).padStart(8, '0')}`;
};

/**
 * True for a record that has the shape this version writes.
 * @param {unknown} record - Stored record.
 * @returns {boolean} Result.
 */
export const isValidDraftRecord = (record) =>
  Boolean(
    record &&
    typeof record === 'object' &&
    record.v === DRAFT_RECORD_VERSION &&
    typeof record.id === 'string' &&
    typeof record.baseHash === 'string' &&
    Number.isFinite(record.savedAt) &&
    Number.isFinite(record.expiresAt) &&
    record.data &&
    typeof record.data === 'object' &&
    Array.isArray(record.data.blocks)
  );

/**
 * @param {{ expiresAt: number }} record - Record.
 * @param {number} now - Current time (ms).
 * @returns {boolean} True when the record is past its lifetime.
 */
export const isExpired = (record, now) => !record || !(record.expiresAt > now);

/**
 * Lifetime in milliseconds from the configured hours (bounded 1..720, default 72).
 * @param {unknown} hours - Config value.
 * @returns {number} Milliseconds.
 */
export const ttlMsOf = (hours) => {
  const number = Number(hours);
  const safe = Number.isFinite(number) && number >= 1 && number <= 720 ? number : DEFAULT_DRAFT_TTL_HOURS;
  return Math.round(safe * 3600 * 1000);
};

/**
 * Builds the record to store.
 * @param {{ id: string, data: object, baseKey: string, now: number, ttlMs: number }} input - Content and its base.
 * @returns {object|null} Record, or null when the content is too large to buffer.
 */
export const buildDraftRecord = ({ id, data, baseKey, now, ttlMs }) => {
  if (!id || !data || !Array.isArray(data.blocks)) return null;
  const copy = { ...data };
  // The key of a positional value is assigned again when the content is restored.
  delete copy.fieldKey;
  let json;
  try {
    json = JSON.stringify(copy);
  } catch {
    return null;
  }
  if (json.length > MAX_DRAFT_CHARS) return null;
  return {
    v: DRAFT_RECORD_VERSION,
    id,
    baseHash: hashText(baseKey),
    savedAt: now,
    expiresAt: now + ttlMs,
    data: JSON.parse(json),
  };
};

/**
 * What the field does with a buffer it finds when it opens.
 * - `none`: nothing stored (or not usable here, e.g. read-only); nothing to show.
 * - `delete`: expired, unreadable, or the same content as what is shown or saved.
 * - `offer`: show the notice; `conflict` when the saved content changed after the buffer was taken.
 * @param {{ record: object|null, now: number, readOnly?: boolean, recordKey?: string, shownKey: string, savedKey: string }} input
 *   Fingerprints (`contentKey` of the normalised content) of the buffer, the editor and the saved value.
 * @returns {{ action: 'none'|'delete'|'offer', conflict?: boolean }} Decision.
 */
export const restoreDecision = ({ record, now, readOnly = false, recordKey, shownKey, savedKey }) => {
  if (!record) return { action: 'none' };
  if (!isValidDraftRecord(record) || isExpired(record, now)) return { action: 'delete' };
  if (readOnly) return { action: 'none' };
  if (recordKey === shownKey || recordKey === savedKey) return { action: 'delete' };
  return { action: 'offer', conflict: record.baseHash !== hashText(savedKey) };
};

/**
 * Whether the field writes, removes or leaves its buffer after a change.
 * Live collaboration that is connected and has nothing unsent already keeps
 * the content in the room, so nothing is buffered then; while the socket is
 * disconnected (reconnecting, offline) or edits are unsent, the buffer covers the gap.
 * @param {{ dirty: boolean, collaboration?: { active: boolean, status: string, pending: boolean } }} input - State.
 * @returns {'write'|'delete'} Action.
 */
export const bufferAction = ({ dirty, collaboration }) => {
  const synced =
    collaboration && collaboration.active && collaboration.status === 'live' && !collaboration.pending;
  return dirty && !synced ? 'write' : 'delete';
};

/**
 * Unit and value for "5 minutes ago" (Intl.RelativeTimeFormat / react-intl formatRelativeTime).
 * @param {number} then - Time of the buffer (ms).
 * @param {number} now - Current time (ms).
 * @returns {{ value: number, unit: 'second'|'minute'|'hour'|'day' }} Negative value in the past.
 */
export const relativeTimeOf = (then, now) => {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return { value: -seconds, unit: 'second' };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { value: -minutes, unit: 'minute' };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { value: -hours, unit: 'hour' };
  return { value: -Math.round(hours / 24), unit: 'day' };
};

/**
 * Redux middleware factory for the admin store (`app.addMiddlewares`): calls
 * `onLogout` when the admin logs out on purpose. In Strapi 5.61 a voluntary
 * logout runs the RTK Query mutation `logout` (POST /admin/logout) and then
 * dispatches `admin/logout`; an ended session (refresh refused) dispatches
 * `admin/logout` without the mutation. Buffers survive an ended session (they
 * belong to that admin and expire with their lifetime) so the work can be
 * restored after logging in again.
 * @param {{ onLogout: () => void, now?: () => number }} options - Callback.
 * @returns {() => (store: object) => (next: Function) => (action: object) => unknown} Middleware factory.
 */
export const createLogoutMiddleware = ({ onLogout, now = () => Date.now() }) => {
  let voluntaryAt = -Infinity;
  return () => () => (next) => (action) => {
    if (action && typeof action === 'object') {
      if (isLogoutMutationStart(action)) voluntaryAt = now();
      else if (action.type === 'admin/logout' && now() - voluntaryAt <= VOLUNTARY_LOGOUT_WINDOW_MS) {
        voluntaryAt = -Infinity;
        try {
          onLogout();
        } catch {
          // never block the logout
        }
      }
    }
    return next(action);
  };
};

/**
 * True for the start of the admin's own logout request (RTK Query mutation `logout`).
 * @param {{ type?: string, meta?: object }} action - Redux action.
 * @returns {boolean} Result.
 */
export const isLogoutMutationStart = (action) =>
  Boolean(
    action &&
    action.type === 'adminApi/executeMutation/pending' &&
    action.meta &&
    action.meta.arg &&
    action.meta.arg.endpointName === 'logout'
  );

/**
 * Value at a dotted form path (`sections.0.body`).
 * @param {unknown} values - Form values.
 * @param {string} path - Path with indices.
 * @returns {unknown} Value or undefined.
 */
export const valueAtPath = (values, path) => {
  let current = values;
  for (const part of String(path || '')
    .split('.')
    .filter(Boolean)
    .slice(0, 24)) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
};

/**
 * The saved value of a field in the loaded entry (the Content Manager form's
 * `initialValues`): for a field inside a repeatable component or dynamic zone
 * with a saved key, the value that carries the key wherever the entry now is;
 * otherwise the value at the path.
 * @param {unknown} initialValues - Saved form values.
 * @param {string} path - Field path.
 * @param {string|null} [fieldKey] - Saved key of the value.
 * @returns {unknown} Saved value (null when there is none).
 */
export const savedValueOf = (initialValues, path, fieldKey = null) => {
  if (isPositionalFieldPath(path) && isValidFieldKey(fieldKey)) {
    const parts = basePathOf(path).split('.').filter(Boolean);
    let found = null;
    const walk = (data, index, depth) => {
      if (found || !data || typeof data !== 'object' || depth > 16) return;
      if (Array.isArray(data)) {
        data.forEach((item) => walk(item, index, depth + 1));
        return;
      }
      if (index === parts.length) {
        if (data.fieldKey === fieldKey) found = data;
        return;
      }
      walk(data[parts[index]], index + 1, depth + 1);
    };
    walk(initialValues, 0, 0);
    if (found) return found;
  }
  const value = valueAtPath(initialValues, path);
  return value === undefined ? null : value;
};

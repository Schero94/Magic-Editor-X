import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../utils/api';
import { SYNCED_REF_PATTERN } from '../../../shared/synced.mjs';

/**
 * Synced block sources in the admin (2.3): one cache for every editor on the
 * page, so several references to one source share a request. A source is
 * loaded with `GET /templates/:id` (needs `access`; disabled synced sources
 * are still returned), so edits made in Settings show up in every open field
 * without reloading the page.
 *
 * Entry states: `loading`, `ready` (with `template`), `missing` (404: the
 * source was deleted) and `error` (network or server error; the last loaded
 * template, if any, stays visible).
 *
 * Mounting a view reuses an entry younger than `MAX_AGE_MS`; window focus,
 * the page becoming visible and the poll always reload.
 */

export const MAX_AGE_MS = 15000;
export const POLL_MS = 30000;

const entries = new Map();
const listeners = new Set();
const inflight = new Map();
let version = 0;

const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Current entry of a reference.
 * @param {string} ref - Source documentId.
 * @returns {{ status: string, template: object|null, loadedAt: number }|undefined} Entry.
 */
export const syncedEntry = (ref) => entries.get(ref);

/**
 * Stores a source the caller already has (e.g. from the insert dialog).
 * @param {object} template - Template DTO of kind `synced`.
 */
export const primeSynced = (template) => {
  if (!template || typeof template.id !== 'string') return;
  entries.set(template.id, { status: 'ready', template, loadedAt: Date.now() });
  emit();
};

/**
 * Loads a source unless a fresh entry exists (requests are shared).
 * @param {Function} get - `useFetchClient().get`.
 * @param {string} ref - Source documentId.
 * @param {{ force?: boolean }} [options] - `force` ignores the age.
 * @returns {Promise<{ status: string, template: object|null }>} Entry.
 */
export const loadSynced = (get, ref, options = {}) => {
  if (typeof ref !== 'string' || !SYNCED_REF_PATTERN.test(ref))
    return Promise.resolve({ status: 'missing', template: null });
  const current = entries.get(ref);
  if (
    !options.force &&
    current &&
    current.status !== 'loading' &&
    current.status !== 'error' &&
    Date.now() - current.loadedAt < MAX_AGE_MS
  )
    return Promise.resolve(current);
  if (inflight.has(ref)) return inflight.get(ref);
  if (!current) {
    entries.set(ref, { status: 'loading', template: null, loadedAt: 0 });
    emit();
  }
  const request = get(API.template(ref))
    .then(
      ({ data }) => {
        const template = data && data.data;
        return template && template.kind === 'synced'
          ? { status: 'ready', template, loadedAt: Date.now() }
          : { status: 'missing', template: null, loadedAt: Date.now() };
      },
      (error) => {
        if (readApiError(error).status === 404)
          return { status: 'missing', template: null, loadedAt: Date.now() };
        const previous = entries.get(ref);
        return {
          status: 'error',
          template: previous ? previous.template : null,
          loadedAt: Date.now(),
        };
      }
    )
    .then((entry) => {
      entries.set(ref, entry);
      inflight.delete(ref);
      emit();
      return entry;
    });
  inflight.set(ref, request);
  return request;
};

/** Forgets every entry (tests, logout). */
export const clearSynced = () => {
  entries.clear();
  inflight.clear();
  emit();
};

const snapshots = new Map();

/**
 * Entries of a reference list, cached per store version (`useSyncExternalStore`
 * needs the same object while nothing changed).
 * @param {string} key - Sorted, comma-joined references.
 * @returns {Map<string, object>} Entries.
 */
const snapshotOf = (key) => {
  const cached = snapshots.get(key);
  if (cached && cached.version === version) return cached.value;
  const value = new Map();
  for (const ref of key ? key.split(',') : [])
    value.set(ref, entries.get(ref) || { status: 'loading', template: null });
  snapshots.set(key, { version, value });
  return value;
};

/**
 * Sources of several references, loaded and kept fresh (window focus, polling while visible).
 * @param {string[]} refs - References.
 * @param {{ poll?: boolean }} [options] - Poll every `POLL_MS` while the page is visible.
 * @returns {{ entries: Map<string, object>, refresh: (force?: boolean) => void }} Entries by reference.
 */
export const useSyncedSources = (refs, options = {}) => {
  const { get } = useFetchClient();
  const key = [...new Set(refs.filter((ref) => SYNCED_REF_PATTERN.test(ref)))].sort().join(',');
  const list = useMemo(() => (key ? key.split(',') : []), [key]);
  const refresh = useCallback(
    (force = false) => {
      for (const ref of list) loadSynced(get, ref, { force });
    },
    [get, list]
  );
  useEffect(() => {
    if (!list.length) return undefined;
    refresh(false);
    // Coming back to the tab (e.g. from "Edit source" in Settings) always reloads.
    const onFocus = () => refresh(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const timer = options.poll
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh(true);
        }, POLL_MS)
      : null;
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [list, refresh, options.poll]);
  const result = useSyncExternalStore(subscribe, () => snapshotOf(key));
  return { entries: result, refresh };
};

/**
 * One source (the synced block view).
 * @param {string} ref - Reference.
 * @returns {{ entry: { status: string, template: object|null }, refresh: (force?: boolean) => void }} State.
 */
export const useSyncedSource = (ref) => {
  const refs = useMemo(() => (ref ? [ref] : []), [ref]);
  const { entries: map, refresh } = useSyncedSources(refs, { poll: true });
  const [fallback] = useState(() => ({ status: 'missing', template: null }));
  return { entry: map.get(ref) || fallback, refresh };
};

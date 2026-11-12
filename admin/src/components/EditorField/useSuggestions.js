import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';

/**
 * Block suggestions of one editor field (2.4).
 *
 * Same refresh rules as comments: the database is the source of truth, the
 * list is fetched again every POLL_MS while the field is on screen and the tab
 * is visible (POLL_OPEN_MS while the panel is open), on window focus and after
 * every own action.
 */

const POLL_MS = 15000;
const POLL_OPEN_MS = 8000;

const EMPTY = { open: 0, accepted: 0, rejected: 0 };

/**
 * @param {object} options - Options.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string }} options.target - Field
 *   request target (`fieldKey` for fields inside a repeatable component or dynamic zone).
 * @param {boolean} options.enabled - Suggestions are on and the caller may use them.
 * @param {boolean} options.panelOpen - The panel is open (faster refresh).
 * @param {{ current: HTMLElement|null }} options.elementRef - Field element (visibility).
 * @returns {object} State and actions.
 */
export const useSuggestions = ({ target, enabled, panelOpen, elementRef }) => {
  const { get, post, del } = useFetchClient();
  const [state, setState] = useState({
    key: null,
    loaded: false,
    error: false,
    suggestions: [],
    counts: EMPTY,
    canCreate: false,
    canReview: false,
  });
  const [newFromOthers, setNewFromOthers] = useState(0);
  const knownIdsRef = useRef(null);
  const requestRef = useRef(0);
  const [visible, setVisible] = useState(true);
  const { uid, documentId, locale, field, fieldKey } = target;
  const currentKey = `${uid}|${documentId}|${locale || '-'}|${fieldKey ? `#${fieldKey}` : field}`;

  const params = useCallback(
    () => ({ uid, documentId, locale: locale || undefined, field, ...(fieldKey ? { fieldKey } : {}) }),
    [uid, documentId, locale, field, fieldKey]
  );

  const refresh = useCallback(() => {
    if (!enabled || !uid || !documentId) return Promise.resolve();
    const id = requestRef.current + 1;
    requestRef.current = id;
    const key = `${uid}|${documentId}|${locale || '-'}|${fieldKey ? `#${fieldKey}` : field}`;
    return get(API.suggestions, { params: params() }).then(
      ({ data }) => {
        if (requestRef.current !== id) return;
        const list = Array.isArray(data.data) ? data.data : [];
        const meta = data.meta || {};
        const ids = new Set(list.map((item) => item.id));
        let fresh = 0;
        if (knownIdsRef.current)
          for (const item of list)
            if (!knownIdsRef.current.has(item.id) && !(item.author && item.author.own)) fresh += 1;
        knownIdsRef.current = ids;
        if (fresh) setNewFromOthers((count) => count + fresh);
        setState({
          key,
          loaded: true,
          error: false,
          suggestions: list,
          counts: meta.counts || EMPTY,
          canCreate: Boolean(meta.canCreate),
          canReview: Boolean(meta.canReview),
        });
      },
      () => {
        if (requestRef.current !== id) return;
        setState((current) => ({ ...current, key, error: true }));
      }
    );
  }, [enabled, uid, documentId, locale, field, fieldKey, get, params]);

  useEffect(() => {
    knownIdsRef.current = null;
    refresh();
  }, [refresh]);

  const current =
    state.key === currentKey
      ? state
      : {
          ...state,
          loaded: false,
          error: false,
          suggestions: [],
          counts: EMPTY,
          canCreate: false,
          canReview: false,
        };

  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !element || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, elementRef]);

  useEffect(() => {
    if (!enabled || !uid || !documentId) return undefined;
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden' || !visible) return;
      timer = setTimeout(
        async () => {
          await refresh();
          schedule();
        },
        panelOpen ? POLL_OPEN_MS : POLL_MS
      );
    };
    const onWake = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer);
        return;
      }
      refresh();
      schedule();
    };
    schedule();
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled, uid, documentId, visible, panelOpen, refresh]);

  /**
   * Runs an API call, then refreshes; failures are re-thrown with the API error info.
   * @param {() => Promise<object>} request - Request.
   * @param {{ again?: boolean }} [options] - `again: false` skips the refresh (several calls in a row).
   * @returns {Promise<object>} Response body (`{ data, meta }`).
   */
  const run = useCallback(
    async (request, { again = true } = {}) => {
      try {
        const { data } = await request();
        if (again) await refresh();
        return data;
      } catch (error) {
        const info = readApiError(error);
        const failure = new Error(info.message || 'Request failed');
        failure.status = info.status;
        failure.code = info.code;
        failure.details = info.details;
        // The list may have changed (decided by someone else): show the current state.
        refresh();
        throw failure;
      }
    },
    [refresh]
  );

  const actions = {
    send: (suggestions, note) =>
      run(() => post(API.suggestions, { ...params(), suggestions, ...(note ? { note } : {}) })),
    accept: (id, outdated = false, options) =>
      run(() => post(API.suggestionAccept(id), { outdated }), options),
    reject: (id) => run(() => post(API.suggestionReject(id), {})),
    withdraw: (id) => run(() => del(API.suggestion(id))),
  };

  return {
    ...current,
    refresh,
    actions,
    newFromOthers,
    clearNew: () => setNewFromOthers(0),
  };
};

export default useSuggestions;

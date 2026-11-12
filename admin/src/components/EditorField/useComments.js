import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';
import { countThreads } from '../../../../shared/comments.mjs';

/**
 * Block comments of one editor field (2.3).
 *
 * The database is the source of truth, so every Strapi process serves the same
 * threads. Other people's comments appear without a reload: the list is
 * fetched again every POLL_MS while the field is on screen and the tab is
 * visible (POLL_OPEN_MS while the panel is open), when the window gets focus
 * again and after every own action. Polling stops when the field is off
 * screen, the tab is hidden or the component unmounts; it fetches comment
 * data the field shows and never keeps the admin session alive on its own.
 */

const POLL_MS = 15000;
const POLL_OPEN_MS = 8000;

const EMPTY = { open: 0, resolved: 0, comments: 0 };

/**
 * @param {object} options - Options.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string }} options.target - Field
 *   (`fieldKey` for fields inside a repeatable component or dynamic zone, 2.4).
 * @param {boolean} options.enabled - Comments are on and the caller may read them.
 * @param {boolean} options.panelOpen - The comments panel is open (faster refresh).
 * @param {{ current: HTMLElement|null }} options.elementRef - Field element (visibility).
 * @returns {object} State and actions.
 */
export const useComments = ({ target, enabled, panelOpen, elementRef }) => {
  const { get, post, put, del } = useFetchClient();
  const [state, setState] = useState({
    key: null,
    loaded: false,
    error: false,
    threads: [],
    counts: EMPTY,
    canWrite: false,
    canModerate: false,
    positionalThreads: [],
  });
  const [newFromOthers, setNewFromOthers] = useState(0);
  const knownIdsRef = useRef(null);
  const requestRef = useRef(0);
  const [visible, setVisible] = useState(true);
  const { uid, documentId, locale, field, fieldKey } = target;

  // 2.4: fields inside a repeatable component or dynamic zone are addressed by their key.
  const params = useCallback(
    () => ({ uid, documentId, locale: locale || undefined, field, ...(fieldKey ? { fieldKey } : {}) }),
    [uid, documentId, locale, field, fieldKey]
  );

  const refresh = useCallback(() => {
    if (!enabled || !uid || !documentId) return Promise.resolve();
    const id = requestRef.current + 1;
    requestRef.current = id;
    const key = `${uid}|${documentId}|${locale || '-'}|${fieldKey ? `#${fieldKey}` : field}`;
    return get(API.comments, { params: params() }).then(
      ({ data }) => {
        if (requestRef.current !== id) return;
        const threads = Array.isArray(data.data) ? data.data : [];
        const meta = data.meta || {};
        // Comments by other people that were not there on the previous fetch (for the live region).
        const ids = new Set();
        let fresh = 0;
        for (const thread of threads) {
          for (const comment of thread.comments || []) {
            ids.add(comment.id);
            if (knownIdsRef.current && !knownIdsRef.current.has(comment.id) && !comment.author?.own)
              fresh += 1;
          }
        }
        knownIdsRef.current = ids;
        if (fresh) setNewFromOthers((count) => count + fresh);
        setState({
          key,
          loaded: true,
          error: false,
          threads,
          counts: meta.counts || countThreads(threads),
          canWrite: Boolean(meta.canWrite),
          canModerate: Boolean(meta.canModerate),
          positionalThreads: Array.isArray(meta.positionalThreads) ? meta.positionalThreads : [],
        });
      },
      () => {
        if (requestRef.current !== id) return;
        setState((current) => ({ ...current, key, error: true }));
      }
    );
  }, [enabled, uid, documentId, locale, field, fieldKey, get, params]);

  // First load and target changes (locale switch); state of another target is not shown.
  useEffect(() => {
    knownIdsRef.current = null;
    refresh();
  }, [refresh]);
  // Moving an entry changes `field` but not `fieldKey`: the list stays (2.4).
  const currentKey = `${uid}|${documentId}|${locale || '-'}|${fieldKey ? `#${fieldKey}` : field}`;
  const current =
    state.key === currentKey
      ? state
      : {
          ...state,
          loaded: false,
          error: false,
          threads: [],
          counts: EMPTY,
          canWrite: false,
          canModerate: false,
          positionalThreads: [],
        };

  // Is the field on screen?
  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !element || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, elementRef]);

  // Polling while visible, plus a refresh on focus and when the tab comes back.
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
   * @returns {Promise<object>} Response data.
   */
  const run = useCallback(
    async (request) => {
      try {
        const { data } = await request();
        await refresh();
        return data && data.data;
      } catch (error) {
        const info = readApiError(error);
        const failure = new Error(info.message || 'Request failed');
        failure.status = info.status;
        failure.code = info.code;
        throw failure;
      }
    },
    [refresh]
  );

  const actions = {
    createThread: ({ blockId, body, excerpt }) =>
      run(() => post(API.comments, { ...params(), blockId, body, excerpt: excerpt || null })),
    reply: (id, body) => run(() => post(API.commentReplies(id), { body })),
    edit: (id, body) => run(() => put(API.comment(id), { body })),
    resolve: (id) => run(() => post(API.commentResolve(id), {})),
    reopen: (id) => run(() => post(API.commentReopen(id), {})),
    remove: (id) => run(() => del(API.comment(id))),
  };

  return {
    ...current,
    refresh,
    actions,
    newFromOthers,
    clearNew: () => setNewFromOthers(0),
  };
};

export default useComments;

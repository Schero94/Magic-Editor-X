import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { classifyPublishedChanges } from '../../../../shared/published-changes.mjs';
import {
  readPublishedChangesPreference,
  savePublishedChangesPreference,
  subscribePublishedChangesPreference,
} from '../../editor/published-preference';
import { API } from '../../utils/api';

/** Pause after the last content change before the marks are computed again. */
export const PUBLISHED_CHANGES_DEBOUNCE_MS = 250;

/**
 * "Changes since last publish" (2.11): loads the published version of the
 * field and classifies the editor blocks against it. Nothing is requested
 * while the marks are off, except one status check when the More tools menu
 * opens (so the menu can explain an entry that was never published). What
 * was loaded belongs to one field and one `baseline`: after the Content
 * Manager reloads the entry (save, publish, unpublish) it is loaded again.
 *
 * The classification runs after a short pause in typing and in an idle
 * callback; it is visual only and never touches the editor value.
 *
 * @param {object} options - Options.
 * @param {boolean} options.available - Draft & Publish type, saved entry, field identity known.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string }} options.target - Field.
 * @param {unknown} options.baseline - Changes when the Content Manager reloads the entry (form initial values).
 * @param {object|null} options.data - Current editor value (updated after each save of the editor).
 * @param {Function} options.get - `useFetchClient().get`.
 * @param {number|string|null} options.owner - Admin user id (the choice is remembered per user).
 * @returns {{ on: boolean, setOn: (on: boolean) => void, status: 'idle'|'loading'|'ready'|'error', published: boolean,
 *   publishedAt: string|null, changes: import('../../../../shared/published-changes.mjs').PublishedChanges|null,
 *   ensureStatus: () => void, retry: () => void }} State and actions.
 */
export const usePublishedChanges = ({ available, target, baseline, data, get, owner }) => {
  const on = useSyncExternalStore(
    subscribePublishedChangesPreference,
    () => readPublishedChangesPreference(owner),
    () => false
  );
  const [result, setResult] = useState(null);
  const [statusRequest, setStatusRequest] = useState(null);
  const [classified, setClassified] = useState(null);
  const { uid, documentId, locale, field, fieldKey } = target || {};
  const key =
    available && uid && documentId ? [uid, documentId, locale || '', field, fieldKey || ''].join('|') : null;

  // Only what was loaded for this field and this version of the entry counts.
  const current = key && result && result.key === key && result.baseline === baseline ? result : null;
  const wantsContent = Boolean(key && on);
  const wantsStatus = Boolean(
    key && statusRequest && statusRequest.key === key && statusRequest.baseline === baseline
  );
  const settled =
    current &&
    (current.status === 'error' || current.hasContent || (current.status === 'ready' && !current.published));
  const fetchMode = !key
    ? null
    : wantsContent && !settled
      ? 'content'
      : wantsStatus && !current
        ? 'status'
        : null;

  useEffect(() => {
    if (!fetchMode) return undefined;
    const controller = new AbortController();
    const withContent = fetchMode === 'content';
    get(API.publishedVersion, {
      params: {
        uid,
        documentId,
        locale: locale || undefined,
        field,
        ...(fieldKey ? { fieldKey } : {}),
        ...(withContent ? {} : { content: 'false' }),
      },
      signal: controller.signal,
    }).then(
      ({ data: body }) => {
        if (controller.signal.aborted) return;
        const answer = (body && body.data) || {};
        setResult({
          key,
          baseline,
          status: 'ready',
          published: answer.published === true,
          publishedAt: typeof answer.publishedAt === 'string' ? answer.publishedAt : null,
          content: withContent ? answer.content || null : null,
          hasContent: withContent,
        });
      },
      () => {
        if (controller.signal.aborted) return;
        setResult({ key, baseline, status: 'error', published: false, publishedAt: null, content: null });
      }
    );
    return () => controller.abort();
  }, [fetchMode, get, key, baseline, uid, documentId, locale, field, fieldKey]);

  // Classify after a pause in typing, in an idle period of the browser.
  const content = on && current && current.hasContent && current.published ? current.content : undefined;
  useEffect(() => {
    if (content === undefined) return undefined;
    let idle = 0;
    const run = () => setClassified({ content, changes: classifyPublishedChanges(content, data) });
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function')
        idle = window.requestIdleCallback(run, { timeout: 300 });
      else run();
    }, PUBLISHED_CHANGES_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
    };
  }, [content, data]);

  const setOn = useCallback((next) => savePublishedChangesPreference(owner, Boolean(next)), [owner]);

  /** Checks once whether a published version exists (More tools opened). */
  const ensureStatus = useCallback(() => {
    if (key && !current) setStatusRequest({ key, baseline });
  }, [key, baseline, current]);

  /** Loads again after an error. */
  const retry = useCallback(() => {
    setResult(null);
    if (key) setStatusRequest({ key, baseline });
  }, [key, baseline]);

  let status = 'idle';
  if (current) status = current.status;
  else if (fetchMode) status = 'loading';
  return {
    on: Boolean(on && key),
    setOn,
    status,
    published: Boolean(current && current.published),
    publishedAt: current ? current.publishedAt : null,
    changes:
      content !== undefined && classified && classified.content === content ? classified.changes : null,
    ensureStatus,
    retry,
  };
};

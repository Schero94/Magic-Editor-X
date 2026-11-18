import { useEffect, useRef, useState } from 'react';
import { getFetchClient, useFetchClient } from '../../utils/fetch-client';
import { isLoggedOut } from '../../editor/session-state.mjs';
import { sessionGuard } from '../../editor/session-guard.mjs';
import { useSessionActive } from '../../editor/useSessionGuard';
import { API, readApiError } from '../../utils/api';
import { IDLE_AFTER_MS, createTabId, nextDelay } from './logic.mjs';

/**
 * Presence of one entry (2.5): sends this tab's heartbeat (`POST /presence`) every 15 s and lists the
 * other admins who edit the entry. One request does both, so an open edit view costs one small request
 * per interval; it waits longer after failures (up to 2 minutes) and stops for good on 404 (no access).
 * The tab counts as idle after a minute without keyboard or pointer input, or while it is hidden.
 * Leaving the entry removes the row at once; a closed tab expires after 30 s.
 * 2.6: no heartbeat while the admin session has ended (signed out); the first
 * one after signing in again is sent at once (on the next task, so a mount that is
 * undone right away, as in React StrictMode, sends neither a heartbeat nor a leave).
 * @param {{ uid: string|null, documentId: string|null, locale: string|null }} target - Entry.
 * @returns {{ status: 'loading'|'ready'|'error'|'unavailable', enabled: boolean, softLock: boolean, canEdit: boolean, editors: Array<{ id: string, name: string, color: string, idle: boolean, live: boolean }> }} Presence.
 */
export const useEntryPresence = ({ uid, documentId, locale }) => {
  const { post } = useFetchClient();
  const [state, setState] = useState({
    status: 'loading',
    enabled: false,
    softLock: false,
    canEdit: false,
    editors: [],
  });
  const [tabId] = useState(createTabId);
  const postRef = useRef(post);
  useEffect(() => {
    postRef.current = post;
  }, [post]);
  const sessionActive = useSessionActive();

  useEffect(() => {
    if (!uid || !documentId || !sessionActive) return undefined;
    let active = true;
    let timer = null;
    let failures = 0;
    let sent = false;
    let lastInput = Date.now();
    const body = (extra = {}) => ({
      uid,
      documentId,
      ...(locale ? { locale } : {}),
      tabId,
      ...extra,
    });
    const isIdle = () => document.visibilityState === 'hidden' || Date.now() - lastInput > IDLE_AFTER_MS;

    const beat = async () => {
      window.clearTimeout(timer);
      sent = true;
      let delay;
      try {
        const { data } = await postRef.current(API.presence, body({ idle: isIdle() }));
        if (!active) return;
        failures = 0;
        const value = (data && data.data) || {};
        setState({
          status: 'ready',
          enabled: value.enabled === true,
          softLock: value.softLock === true,
          canEdit: value.canEdit === true,
          editors: Array.isArray(value.editors) ? value.editors : [],
        });
        if (value.enabled !== true) return;
        delay = nextDelay(0);
      } catch (error) {
        if (!active) return;
        const { status } = readApiError(error);
        if (status === 404 || status === 403) {
          setState((current) => ({ ...current, status: 'unavailable', editors: [] }));
          return;
        }
        failures += 1;
        setState((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'error' }));
        delay = nextDelay(failures, status);
      }
      timer = window.setTimeout(beat, delay);
    };

    const onInput = () => {
      const wasIdle = Date.now() - lastInput > IDLE_AFTER_MS;
      lastInput = Date.now();
      // Coming back from idle: tell the others at once.
      if (wasIdle && failures === 0) beat();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') lastInput = Date.now();
      if (failures === 0) beat();
    };
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('pointerdown', onInput, true);
    document.addEventListener('visibilitychange', onVisibility);
    // The first heartbeat goes out on the next task: an effect cleanup before that (React
    // StrictMode's extra mount, a panel that unmounts at once) cancels it, so neither a
    // heartbeat nor a leave is sent for a mount that never lasted.
    timer = window.setTimeout(beat, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onInput, true);
      window.removeEventListener('pointerdown', onInput, true);
      document.removeEventListener('visibilitychange', onVisibility);
      // useFetchClient aborts its requests on unmount; the leave request must outlive the panel.
      // After a logout there is no session to leave with (the row expires after 30 s).
      if (sent && !isLoggedOut() && sessionGuard.isActive())
        getFetchClient()
          .post(API.presence, body({ leave: true }))
          .catch(() => {});
    };
  }, [uid, documentId, locale, tabId, sessionActive]);

  return state;
};

export default useEntryPresence;

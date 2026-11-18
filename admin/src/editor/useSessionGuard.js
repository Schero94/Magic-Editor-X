import { useSyncExternalStore } from 'react';
import { sessionGuard } from './session-guard.mjs';

/**
 * State of the tab's admin session (2.6, `editor/session-guard.mjs`).
 * @returns {{ status: 'active'|'ended'|'loggedOut', endedAt: number|null, resumedAt: number|null, source: string|null, generation: number }} State.
 */
export const useSessionState = () =>
  useSyncExternalStore(sessionGuard.subscribe, sessionGuard.getState, sessionGuard.getState);

/**
 * True while plugin requests may be sent. Background requests (polling,
 * heartbeats) wait while it is false and start again when it turns true.
 * @returns {boolean} Result.
 */
export const useSessionActive = () => useSessionState().status === 'active';

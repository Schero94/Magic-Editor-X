/**
 * Session-expiry detection (2.6): one state per browser tab that says whether
 * the admin session still works, shared by every editor field, the entry
 * panel and the background requests of the plugin.
 *
 * Strapi 5.62 refreshes an expired access token inside its fetch client
 * (`POST /admin/access-token`, `withTokenRefresh` in `getFetchClient`) and
 * retries the request once. A 401 that reaches the caller therefore means the
 * refresh was refused: the session ended (idle or absolute lifetime, revoked
 * from another device, password changed, admin removed). The state changes to
 * `ended` on the first such answer from any source:
 *
 * - a plugin request (wrapped fetch client, `admin/src/utils/fetch-client.js`:
 *   save-related calls, collaboration tokens, presence heartbeats, polling);
 * - an admin request of Strapi itself, seen as a rejected RTK Query action
 *   with status 401 in the admin store (`app.addMiddlewares`), for example
 *   the Content Manager's own save;
 * - `admin/logout` that was not preceded by the admin's own logout request
 *   (Strapi ended the session, e.g. after its keepalive refresh was refused).
 *
 * It returns to `active` when a new token is stored (`admin/login`,
 * `admin/setToken`: signed in again in this or another tab). A voluntary
 * logout (`logout` mutation, then `admin/logout`) sets `loggedOut`: the page
 * is about to leave and no banner is shown.
 *
 * Nothing here reads or keeps a token, a response body or a URL with a query:
 * only the HTTP status and the RTK endpoint name are inspected.
 */

/** A voluntary logout is the RTK `logout` mutation followed by `admin/logout` within this window. */
export const VOLUNTARY_LOGOUT_WINDOW_MS = 60 * 1000;

/** RTK Query endpoints whose 401 is not a session end (wrong password, expired invitation, ...). */
const AUTH_ENDPOINTS = new Set([
  'login',
  'logout',
  'register',
  'registerAdmin',
  'registrationInfo',
  'getRegistrationInfo',
  'forgotPassword',
  'resetPassword',
  'renewToken',
  'accessToken',
  'getProviders',
  'isSSOLocked',
]);

/**
 * HTTP status of an error thrown by Strapi's fetch client (FetchError) or a
 * plain response-like error. The body is never read beyond `error.status`.
 * @param {unknown} error - Thrown value.
 * @returns {number|null} Status or null.
 */
export const statusOf = (error) => {
  if (!error || typeof error !== 'object') return null;
  if (typeof error.status === 'number') return error.status;
  const response = error.response;
  if (response && typeof response.status === 'number') return response.status;
  const body = response && response.data;
  const apiError = body && body.error;
  if (apiError && typeof apiError.status === 'number') return apiError.status;
  return null;
};

/**
 * True when a failed plugin request means the admin session ended: status 401
 * after the fetch client's own refresh attempt (403, 404, 429, 5xx, network
 * errors and aborted requests do not count).
 * @param {unknown} error - Thrown value.
 * @returns {boolean} Result.
 */
export const isSessionEndError = (error) => {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return false;
  if (error.name === 'TokenRefreshError') return true;
  return statusOf(error) === 401;
};

/**
 * True for a rejected admin request (RTK Query) that answered 401, excluding
 * the authentication endpoints themselves.
 * @param {{ type?: string, payload?: object, meta?: object }} action - Redux action.
 * @returns {boolean} Result.
 */
export const isSessionEndAction = (action) => {
  if (!action || typeof action.type !== 'string' || !action.type.endsWith('/rejected')) return false;
  const payload = action.payload;
  if (!payload || typeof payload !== 'object' || payload.status !== 401) return false;
  const endpoint = action.meta && action.meta.arg && action.meta.arg.endpointName;
  return !(typeof endpoint === 'string' && AUTH_ENDPOINTS.has(endpoint));
};

/**
 * True for the start of the admin's own logout request (RTK Query mutation `logout`).
 * @param {{ type?: string, meta?: object }} action - Redux action.
 * @returns {boolean} Result.
 */
const isLogoutMutationStart = (action) =>
  Boolean(
    action &&
    action.type === 'adminApi/executeMutation/pending' &&
    action.meta &&
    action.meta.arg &&
    action.meta.arg.endpointName === 'logout'
  );

/**
 * Creates a session guard (one per tab in the admin; tests create their own).
 * @param {{ now?: () => number }} [options] - Clock.
 * @returns {object} Guard API (see the returned members).
 */
export const createSessionGuard = ({ now = () => Date.now() } = {}) => {
  let state = { status: 'active', endedAt: null, resumedAt: null, source: null, generation: 0, reports: 0 };
  let voluntaryAt = -Infinity;
  const listeners = new Set();
  const leaders = [];
  const leaderListeners = new Set();

  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // a listener never breaks the others
      }
    }
  };
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  /**
   * Marks the session as ended (once; later reports only count).
   * @param {string} source - What noticed it (`request`, `admin`, `logout`, `collaboration`, ...).
   * @returns {boolean} True when this call changed the state.
   */
  const end = (source) => {
    if (state.status === 'ended') {
      state = { ...state, reports: state.reports + 1 };
      return false;
    }
    if (state.status === 'loggedOut') return false;
    set({ status: 'ended', endedAt: now(), source: String(source || 'request'), reports: state.reports + 1 });
    return true;
  };

  /** Back to a working session (a new token was stored). */
  const resume = () => {
    if (state.status === 'active') return false;
    set({ status: 'active', resumedAt: now(), source: null, generation: state.generation + 1 });
    return true;
  };

  return {
    /** @returns {object} Current state `{ status, endedAt, resumedAt, source, generation, reports }`. */
    getState: () => state,
    /** @returns {boolean} True while the session is known to have ended (signed out, not by the admin). */
    isEnded: () => state.status === 'ended',
    /** @returns {boolean} True while requests may be sent. */
    isActive: () => state.status === 'active',
    /**
     * @param {(state: object) => void} listener - Called on every change.
     * @returns {() => void} Unsubscribe.
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    end,
    resume,
    /**
     * Reports a failed request; a session-end error ends the session.
     * @param {unknown} error - Thrown value.
     * @param {string} [source] - Caller.
     * @returns {boolean} True when the error counts as a session end.
     */
    reportError(error, source = 'request') {
      if (!isSessionEndError(error)) return false;
      end(source);
      return true;
    },
    /**
     * A request that was sent after the session ended succeeded: the session works again
     * (signed in elsewhere, or the 401 was not about the session). Earlier requests do not count.
     * @param {number} startedAt - When the request was sent.
     * @returns {boolean} True when this resumed the session.
     */
    reportSuccess(startedAt) {
      if (state.status !== 'ended' || !(startedAt > state.endedAt)) return false;
      return resume();
    },
    /**
     * Updates the state from an admin store action (Redux middleware).
     * @param {{ type?: string, payload?: unknown, meta?: object }} action - Action.
     */
    observeAction(action) {
      if (!action || typeof action !== 'object') return;
      if (isLogoutMutationStart(action)) {
        voluntaryAt = now();
        return;
      }
      if (action.type === 'admin/logout') {
        if (now() - voluntaryAt <= VOLUNTARY_LOGOUT_WINDOW_MS) {
          voluntaryAt = -Infinity;
          set({ status: 'loggedOut', source: null });
        } else end('logout');
        return;
      }
      if (action.type === 'admin/login' || (action.type === 'admin/setToken' && action.payload !== null)) {
        voluntaryAt = -Infinity;
        resume();
        return;
      }
      if (isSessionEndAction(action)) end('admin');
    },
    /**
     * One banner per page: the first claimant leads until it releases.
     * @param {string} id - Claimant id (a field instance).
     * @returns {() => void} Release.
     */
    claimLeader(id) {
      if (!leaders.includes(id)) leaders.push(id);
      for (const listener of [...leaderListeners]) listener();
      return () => {
        const index = leaders.indexOf(id);
        if (index >= 0) leaders.splice(index, 1);
        for (const listener of [...leaderListeners]) listener();
      };
    },
    /** @returns {string|null} Id of the current leader. */
    leader: () => (leaders.length ? leaders[0] : null),
    /**
     * @param {() => void} listener - Called when the leader changes.
     * @returns {() => void} Unsubscribe.
     */
    subscribeLeader(listener) {
      leaderListeners.add(listener);
      return () => leaderListeners.delete(listener);
    },
  };
};

/** The guard of this admin tab. */
export const sessionGuard = createSessionGuard();

/**
 * Redux middleware for the admin store (`app.addMiddlewares`, entries are factories).
 * @param {object} [guard] - Guard (tests).
 * @returns {() => (next: Function) => (action: object) => unknown} Middleware.
 */
export const createSessionGuardMiddleware =
  (guard = sessionGuard) =>
  () =>
  (next) =>
  (action) => {
    const result = next(action);
    try {
      guard.observeAction(action);
    } catch {
      // never break the admin store
    }
    return result;
  };

/** Window name of the sign-in tab opened from the banner (it closes itself after signing in). */
export const SIGN_IN_WINDOW_NAME = 'magic-editor-x-sign-in';

/**
 * Admin base path from the current location (`/admin` by default, or the
 * configured admin URL): the part before `/content-manager/`, `/plugins/` or
 * `/settings/`.
 * @param {string} pathname - `location.pathname`.
 * @returns {string} Base path without a trailing slash.
 */
export const adminBasePath = (pathname) => {
  const value = typeof pathname === 'string' ? pathname : '';
  for (const marker of ['/content-manager/', '/plugins/', '/settings/', '/auth/']) {
    const index = value.indexOf(marker);
    if (index >= 0) return value.slice(0, index);
  }
  return '/admin';
};

/**
 * Restore rule after signing in again (2.6): within `windowMs` after the
 * session resumed, Strapi resets the edit form from the server (its admin API
 * cache is cleared when another tab signs in), so a field whose form value is
 * back to the saved value while its buffer differs gets the buffer back, but
 * only when the saved value is still the one the buffer was based on
 * (`draftBaseKey`). If someone else saved meanwhile, or the base is unknown,
 * the answer is `offer`: the Restore/Discard notice with the conflict, never a
 * silent replacement of their content.
 * @param {{ sinceResumeMs: number|null, windowMs?: number, valueKey: string, savedKey: string, draftKey: string|null, draftBaseKey?: string|null }} input - Fingerprints.
 * @returns {'restore'|'offer'|'wait'|'done'} `restore` now, `offer` the notice, `wait` (keep watching), `done` (nothing to do any more).
 */
export const recoveryAction = ({
  sinceResumeMs,
  windowMs = 15000,
  valueKey,
  savedKey,
  draftKey,
  draftBaseKey,
}) => {
  if (sinceResumeMs === null || sinceResumeMs === undefined || sinceResumeMs > windowMs) return 'done';
  if (!draftKey || draftKey === savedKey) return 'done';
  if (valueKey === draftKey) return 'wait';
  if (valueKey === savedKey) return draftBaseKey && draftBaseKey === savedKey ? 'restore' : 'offer';
  return 'done';
};

/**
 * Redux middleware (2.6) for the sign-in tab the banner opens: after the admin
 * signed in there (`admin/login`), the tab closes itself so the person is back
 * on the entry, which adopted the new session meanwhile. A tab with another
 * name is never touched; a browser that refuses `close()` keeps the tab open
 * on the admin home page.
 * @param {{ win?: Window|null, delayMs?: number }} [options] - Window (tests) and delay (lets Strapi tell the other tabs first).
 * @returns {() => () => (next: Function) => (action: object) => unknown} Middleware factory.
 */
export const createSignInTabCloser =
  ({ win = typeof window !== 'undefined' ? window : null, delayMs = 800 } = {}) =>
  () =>
  (next) =>
  (action) => {
    const result = next(action);
    if (win && action && action.type === 'admin/login' && win.name === SIGN_IN_WINDOW_NAME) {
      win.name = '';
      win.setTimeout(() => {
        try {
          win.close();
        } catch {
          // the browser keeps the tab
        }
      }, delayMs);
    }
    return result;
  };

/**
 * Restore rule when a field opens (2.6): Strapi reloads the edit view after
 * signing in again, so a field mounts anew and finds its buffer. A buffer
 * written after the session ended (`savedAt >= endedAt`), opened within
 * `windowMs` of signing in again and without a conflict with the saved value
 * is restored without asking; anything else keeps the notice (Restore/Discard).
 * @param {{ conflict: boolean, savedAt: number, session: { endedAt: number|null, resumedAt: number|null, status: string }, now: number, windowMs?: number }} input - Buffer and session.
 * @returns {boolean} True to restore at once.
 */
export const autoRestoreOnOpen = ({ conflict, savedAt, session, now, windowMs = 15000 }) =>
  Boolean(
    !conflict &&
    session &&
    session.status === 'active' &&
    Number.isFinite(session.endedAt) &&
    Number.isFinite(session.resumedAt) &&
    session.resumedAt >= session.endedAt &&
    now - session.resumedAt <= windowMs &&
    Number.isFinite(savedAt) &&
    savedAt >= session.endedAt
  );

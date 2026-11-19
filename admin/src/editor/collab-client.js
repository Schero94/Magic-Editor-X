import * as Y from 'yjs';
import { io } from 'socket.io-client';
import { createReplica } from '../../../shared/collab-replica.mjs';
import { docToEditorData } from '../../../shared/ydoc.mjs';

/**
 * Browser side of live collaboration for one editor field (protocol 4).
 *
 * Protocol (see server/src/services/collaboration.js and AGENTS.md):
 * - handshake `auth: { token, protocol: 4 }`; refusals arrive as
 *   `connect_error` with `data.code` (INVALID_TOKEN, SESSION_ENDED (2.6), UPGRADE_REQUIRED,
 *   TOO_MANY_CONNECTIONS, UNAVAILABLE);
 * - `mx:welcome { canEdit, presenceId, color, name, epoch }`;
 * - `mx:sync { update, stateVector, epoch }`; the client answers with what the
 *   server is missing;
 * - `mx:update <bytes>` both ways; the server acknowledges stored updates;
 * - `mx:presence [peers]`, `mx:cursor { blockId, anchor, focus, idle }`,
 *   `mx:role { canEdit }`, `mx:error { code }`.
 *
 * Connection lifecycle: one update in flight at a time (later edits are
 * merged and sent after the acknowledgement), unacknowledged edits are kept
 * across disconnects and sent again, reconnects use exponential backoff with
 * jitter and a fresh one-time token, the browser's online/offline and
 * visibility events trigger an immediate reconnect and resync. A new room
 * generation (epoch) or a refused update makes the client start over from
 * the server state instead of merging, so content is never duplicated.
 *
 * Signed out (2.6): `pause()` closes the socket and stops every reconnect
 * while the admin session has ended (status `paused`); local edits stay
 * pending (and in the field's draft buffer). `resume()` after signing in
 * again reconnects with a fresh token and sends the pending edits. A token
 * request answered 401 (session ended) pauses the client by itself.
 *
 * What the editor shows is the base of every local diff. Until the editor has
 * rendered the room, that is NOT the room state: it is the content the editor
 * was created with (`getInitialView`), or what it showed before the client
 * started over. Edits made before a sync are kept and applied on top of the
 * room state when it arrives (three-way, by block and field), so typing
 * before the first `mx:sync` or between a sync and the first render never
 * drops the edit and never reverts content the editor has not shown yet.
 */

export const PROTOCOL = 4;
const RESYNC_MS = 20000;
const ACK_TIMEOUT_MS = 10000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15000;
const IDLE_AFTER_MS = 60000;
const SERVER_LOG_BATCH = 100;

/**
 * HTTP status of a failed token request (Strapi FetchError: `status`, or `response.status`).
 * @param {unknown} error - Thrown value.
 * @returns {number|null} Status.
 */
const statusOfError = (error) => {
  if (!error || typeof error !== 'object') return null;
  if (typeof error.status === 'number') return error.status;
  return error.response && typeof error.response.status === 'number' ? error.response.status : null;
};

/** Empty Yjs update (no structs, no deletes). */
const isEmptyUpdate = (update) => !update || update.byteLength <= 2;

/**
 * Backoff with jitter: half of the exponential cap plus a random half.
 * @param {number} attempt - Attempt number (0-based).
 * @param {() => number} [random=Math.random] - Random source.
 * @returns {number} Delay in ms.
 */
export const backoffDelay = (attempt, random = Math.random) => {
  const cap = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempt, 10));
  return Math.round(cap / 2 + (random() * cap) / 2);
};

/**
 * Creates a collaboration client.
 * @param {object} options - Options.
 * @param {() => Promise<{ token: string, path: string, canEdit: boolean, seeded?: boolean }>} options.requestSession - Gets a fresh one-time token.
 * @param {string} options.url - Backend URL.
 * @param {() => void} options.onRemoteData - Called (debounced) when the editor should show the shared state.
 * @param {(seeded: boolean) => Promise<void>|void} [options.onFirstSync] - Called once after the first sync.
 * @param {(state: object) => void} options.onState - Called with `{ status, canEdit, peers, error, presenceId, color, pending }`.
 * @param {(state: { canUndo: boolean, canRedo: boolean }) => void} [options.onUndoState] - Undo availability.
 * @param {() => object|null} [options.getInitialView] - What the editor shows before it rendered the room (read once, on the first edit or sync); defaults to an empty editor.
 * @param {Function} [options.socketFactory] - Replaces socket.io-client (tests).
 * @param {Window|null} [options.win] - Window for online/visibility events (tests).
 * @param {() => void} [options.onSessionEnded] - 2.6: the server reports that the admin session behind the
 *   socket ended (`SESSION_ENDED`); the client pauses, keeps its edits and calls this.
 * @returns {object} Client API.
 */
export const createCollabClient = ({
  requestSession,
  url,
  onSessionEnded,
  onRemoteData,
  onFirstSync,
  onState,
  onUndoState = () => {},
  getInitialView = () => null,
  socketFactory = io,
  win = typeof window !== 'undefined' ? window : null,
}) => {
  let replica = null;
  let socket = null;
  let destroyed = false;
  let pending = null;
  let inFlight = false;
  let state = {
    status: 'connecting',
    canEdit: false,
    peers: [],
    error: null,
    presenceId: null,
    color: null,
    pending: false,
  };
  let resyncTimer = null;
  let idleTimer = null;
  let notifyTimer = null;
  let retryTimer = null;
  let flushTimer = null;
  let firstToken = null;
  let synced = false;
  let seededBySelf = false;
  let epoch = null;
  let attempt = 0;
  // What the server has acknowledged or sent (as Yjs updates, merged in
  // batches): the base for re-applying unsent edits after a new room
  // generation, so only the unsent edits are re-applied, never remote ones.
  let serverState = null;
  let serverLog = [];
  // What the editor shows while the replica is not synced (the base of edits
  // made before the sync), and the latest editor content pushed in that time.
  let restoreView = null;
  let unsynced = null;
  let rescue = null;
  let lastActivity = Date.now();
  let lastCursor = null;
  let idle = false;
  // 2.6: the admin session ended; nothing is sent until resume().
  let paused = false;
  let needsConnect = false;
  // The room content the server had acknowledged when the client paused: the base of a later merge.
  let pausedBase = null;

  const setState = (patch) => {
    // Without access the field saves through the form only: nothing is waiting for the room.
    if (patch.status === 'denied' || patch.status === 'error') unsynced = null;
    state = { ...state, ...patch, pending: Boolean(pending) || inFlight || Boolean(unsynced) };
    onState({ ...state });
  };

  const notifyRemote = () => {
    if (notifyTimer || destroyed) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      // 2.6.2: never render a document that is not synced (after a start over it is empty until the
      // resync arrives; an edit of that empty view would delete every block for everyone). The
      // first sync renders again.
      if (!destroyed && synced) onRemoteData();
    }, 30);
  };

  const undoState = () => {
    if (replica) onUndoState({ canUndo: replica.canUndo(), canRedo: replica.canRedo() });
  };

  let startOver = () => {};

  /** What the editor shows while not synced (read from the field once). */
  const viewBeforeSync = () => {
    if (!restoreView) {
      const initial = getInitialView();
      restoreView = initial && Array.isArray(initial.blocks) ? initial : { blocks: [] };
    }
    return restoreView;
  };

  const flush = () => {
    if (!socket || !socket.connected || !pending || inFlight || !state.canEdit || !synced) return;
    const update = pending;
    pending = null;
    inFlight = true;
    const sentWith = replica;
    socket.timeout(ACK_TIMEOUT_MS).emit('mx:update', update, (error, reply) => {
      inFlight = false;
      if (sentWith !== replica || destroyed) return;
      if (!error && reply && reply.ok) {
        recordServer(update);
        setState({});
        flush();
        return;
      }
      const code = reply && reply.code;
      if (code === 'READ_ONLY') {
        setState({ canEdit: false });
        startOver(false);
        return;
      }
      if (code === 'SESSION_ENDED') {
        // 2.6: the admin session ended: keep the edit and send it after signing in again.
        pending = pending ? Y.mergeUpdates([update, pending]) : update;
        sessionEnded();
        return;
      }
      if (code === 'INVALID_UPDATE') {
        startOver(false);
        return;
      }
      // Keep the edit and try again (timeout, RETRY, RATE_LIMITED, STORE_FAILED, disconnect).
      pending = pending ? Y.mergeUpdates([update, pending]) : update;
      setState({});
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, code === 'RATE_LIMITED' ? 2000 : 400);
    });
    setState({});
  };

  const recordServer = (update) => {
    serverLog.push(update);
    if (serverLog.length >= SERVER_LOG_BATCH) {
      serverState = Y.mergeUpdates(serverState ? [serverState, ...serverLog] : serverLog);
      serverLog = [];
    }
  };

  /** Content the server is known to hold (acknowledged and received updates). */
  const serverContent = () => {
    const doc = new Y.Doc();
    try {
      for (const update of serverState ? [serverState, ...serverLog] : serverLog) Y.applyUpdate(doc, update);
      return docToEditorData(doc);
    } finally {
      doc.destroy();
    }
  };

  const createDocs = () => {
    if (replica) replica.destroy();
    replica = createReplica({
      onLocalUpdate: (update) => {
        pending = pending ? Y.mergeUpdates([pending, update]) : update;
        flush();
        undoState();
      },
      onShouldRender: notifyRemote,
    });
    replica.undoManager.on('stack-item-added', undoState);
    replica.undoManager.on('stack-item-popped', undoState);
    pending = null;
    inFlight = false;
    synced = false;
    serverState = null;
    serverLog = [];
    undoState();
  };

  /**
   * Starts over from the server state: new documents and a full sync. When
   * `keepUnsent` is true, edits that were never acknowledged are applied
   * again on top of the new state (three-way, by block and field).
   * @param {boolean} keepUnsent - Re-apply unacknowledged edits.
   */
  startOver = (keepUnsent) => {
    // Unsent edits = what this replica holds beyond what the server holds.
    const unsent = keepUnsent && (pending || inFlight) && replica ? replica.read() : null;
    const base = unsent ? serverContent() : null;
    // What the editor shows: the next local diff starts from it, so content the
    // editor has not rendered yet (the new state) is never taken for a deletion.
    const view = synced && replica ? replica.view() : viewBeforeSync();
    clearTimeout(notifyTimer);
    notifyTimer = null;
    createDocs();
    epoch = null;
    rescue = unsent ? { base, local: unsent } : null;
    restoreView = view;
    if (socket && socket.connected) socket.emit('mx:resync', new Uint8Array([0]));
  };

  const scheduleReconnect = () => {
    if (destroyed || paused || !socket || socket.connected || socket.active || state.status === 'denied')
      return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!destroyed && socket && !socket.connected) socket.connect();
    }, backoffDelay(attempt));
    attempt += 1;
  };

  const offline = () => Boolean(win && win.navigator && win.navigator.onLine === false);

  const sendPresence = () => {
    if (socket && socket.connected) socket.emit('mx:cursor', { ...(lastCursor || {}), idle });
  };

  const onOnline = () => {
    attempt = 0;
    if (!socket || paused || state.status === 'denied') return;
    if (!socket.connected) socket.connect();
    else if (replica) socket.emit('mx:resync', Y.encodeStateVector(replica.doc));
  };
  const onOffline = () => setState({ status: 'offline' });
  const onVisibility = () => {
    if (!win || !win.document) return;
    const hidden = win.document.visibilityState === 'hidden';
    if (!hidden) {
      lastActivity = Date.now();
      onOnline();
    }
    if (hidden !== idle) {
      idle = hidden;
      sendPresence();
    }
  };
  const onPageHide = () => {
    if (socket) socket.disconnect();
  };

  createDocs();

  const connect = async () => {
    const session = await requestSession();
    if (destroyed) return;
    if (paused) {
      // Signed out while the token was requested: connect on resume().
      needsConnect = true;
      return;
    }
    firstToken = session.token;
    seededBySelf = session.seeded === true;
    setState({ canEdit: session.canEdit });
    socket = socketFactory(url, {
      path: session.path,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: RETRY_BASE_MS,
      reconnectionDelayMax: RETRY_MAX_MS,
      randomizationFactor: 0.5,
      auth: (callback) => {
        if (firstToken) {
          const token = firstToken;
          firstToken = null;
          callback({ token, protocol: PROTOCOL });
          return;
        }
        requestSession()
          .then((next) => {
            setState({ canEdit: next.canEdit });
            callback({ token: next.token, protocol: PROTOCOL });
          })
          .catch((error) => {
            const status = statusOfError(error);
            if (status === 403 || status === 404) setState({ status: 'denied', error: `HTTP_${status}` });
            if (status === 401) {
              // Signed out: stop here instead of retrying with an empty token every few seconds.
              paused = true;
              if (socket) socket.disconnect();
              setState({ status: 'paused', peers: [] });
              return;
            }
            callback({ token: '', protocol: PROTOCOL });
          });
      },
    });
    socket.on('connect', () => {
      attempt = 0;
      setState({ status: 'syncing', error: null });
    });
    socket.on('disconnect', () => {
      inFlight = false;
      if (paused) {
        setState({ status: 'paused', peers: [] });
        return;
      }
      if (state.status !== 'denied') setState({ status: offline() ? 'offline' : 'reconnecting', peers: [] });
      scheduleReconnect();
    });
    socket.on('connect_error', (error) => {
      const code = (error && error.data && error.data.code) || null;
      if (code === 'UPGRADE_REQUIRED') {
        setState({ status: 'error', error: code });
        return;
      }
      if (code === 'SESSION_ENDED') {
        sessionEnded();
        return;
      }
      if (state.status === 'denied' || paused) return;
      setState({ status: offline() ? 'offline' : 'reconnecting', error: code });
      scheduleReconnect();
    });
    socket.on('mx:welcome', (welcome = {}) => {
      if (epoch !== null && welcome.epoch !== epoch) startOver(true);
      setState({
        canEdit: Boolean(welcome.canEdit),
        presenceId: welcome.presenceId,
        color: welcome.color,
      });
      sendPresence();
    });
    socket.on('mx:sync', (message) => {
      if (!message || !message.update) return;
      if (epoch !== null && message.epoch !== undefined && message.epoch !== epoch) startOver(true);
      const update = new Uint8Array(message.update);
      recordServer(update);
      replica.applyRemote(update);
      epoch = message.epoch !== undefined ? message.epoch : replica.epoch();
      if (message.stateVector && state.canEdit) {
        const missing = Y.encodeStateAsUpdate(replica.doc, new Uint8Array(message.stateVector));
        if (!isEmptyUpdate(missing)) pending = pending ? Y.mergeUpdates([pending, missing]) : missing;
      }
      const first = !synced;
      synced = true;
      if (first) {
        const shown = replica.snapshot();
        replica.markShown(shown.catchUp);
      }
      if (rescue) {
        const { base, local } = rescue;
        rescue = null;
        if (state.canEdit) replica.rebase(base, local);
      }
      if (first) {
        // The editor still shows what it showed before the sync, not the room:
        // edits made since are applied on top of the room state, and the next
        // local diff starts from the editor content, so content the editor has
        // not rendered yet is never taken for a deletion.
        const view = viewBeforeSync();
        const local = unsynced;
        unsynced = null;
        restoreView = null;
        if (local && state.canEdit) replica.rebase(view, local);
        replica.setView(local || view);
      }
      setState({ status: 'live' });
      // Later syncs render only when they changed something (the replica
      // reports that through onShouldRender).
      Promise.resolve(first && typeof onFirstSync === 'function' ? onFirstSync(seededBySelf) : null)
        .catch(() => null)
        .then(() => {
          if (first) notifyRemote();
          flush();
        });
    });
    socket.on('mx:update', (update) => {
      if (!replica) return;
      const bytes = new Uint8Array(update);
      recordServer(bytes);
      replica.applyRemote(bytes);
    });
    socket.on('mx:presence', (peers) => {
      setState({
        peers: Array.isArray(peers) ? peers.filter((peer) => peer && peer.id !== state.presenceId) : [],
      });
    });
    socket.on('mx:role', ({ canEdit } = {}) => {
      setState({ canEdit: Boolean(canEdit) });
      if (canEdit) flush();
      else if (pending || inFlight) startOver(false);
    });
    socket.on('mx:error', ({ code } = {}) => {
      if (code === 'SESSION_ENDED') {
        sessionEnded();
        return;
      }
      if (code === 'ACCESS_REVOKED') {
        setState({ status: 'denied', error: code, canEdit: false, peers: [] });
        if (socket) socket.disconnect();
        return;
      }
      if (code === 'ROOM_RESET') startOver(true);
      if (code === 'INVALID_UPDATE') startOver(false);
      setState({ error: code });
    });
    resyncTimer = setInterval(() => {
      if (socket && socket.connected && replica) socket.emit('mx:resync', Y.encodeStateVector(replica.doc));
    }, RESYNC_MS);
    idleTimer = setInterval(() => {
      if (!idle && Date.now() - lastActivity > IDLE_AFTER_MS) {
        idle = true;
        sendPresence();
      }
    }, 5000);
  };

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('online', onOnline);
    win.addEventListener('offline', onOffline);
    win.addEventListener('pagehide', onPageHide);
    if (win.document) win.document.addEventListener('visibilitychange', onVisibility);
  }

  const onConnectFailed = (error) => {
    if (destroyed) return;
    const status = statusOfError(error);
    if (status === 401 || paused) {
      // Signed out before the first connection: connect again on resume().
      paused = true;
      needsConnect = true;
      setState({ status: 'paused', peers: [] });
      return;
    }
    setState({
      status: status === 404 || status === 403 ? 'denied' : 'error',
      error: status ? `HTTP_${status}` : 'NETWORK',
    });
  };
  connect().catch(onConnectFailed);

  /** 2.6: signed out: close the socket, stop reconnecting, keep pending edits. */
  const pauseNow = () => {
    if (destroyed || paused) return;
    paused = true;
    pausedBase = synced && replica ? serverContent() : null;
    clearTimeout(retryTimer);
    inFlight = false;
    if (socket && (socket.connected || socket.active)) socket.disconnect();
    if (state.status !== 'denied') setState({ status: 'paused', peers: [] });
  };

  /** 2.6: the server says the admin session behind the socket ended. */
  const sessionEnded = () => {
    pauseNow();
    if (typeof onSessionEnded === 'function') {
      try {
        onSessionEnded();
      } catch {
        // the caller's handler must not break the client
      }
    }
  };

  return {
    /**
     * Applies the editor content: only the difference to what the editor showed is written.
     * @param {object} data - Editor content now.
     */
    pushLocal(data) {
      if (destroyed || !data || !Array.isArray(data.blocks)) return;
      lastActivity = Date.now();
      if (idle) {
        idle = false;
        sendPresence();
      }
      if (!synced) {
        // Kept until the room state arrives, then applied on top of it.
        viewBeforeSync();
        unsynced = data;
        setState({});
        return;
      }
      if (!state.canEdit) return;
      replica.pushLocal(data);
    },
    /**
     * Reads what the editor should show and a token for `markShown`.
     * @returns {{ data: object, catchUp: Uint8Array }} Snapshot.
     */
    snapshot: () => replica.snapshot(),
    /**
     * Records that the editor now shows a snapshot.
     * @param {Uint8Array} catchUp - Token from `snapshot()`.
     * @param {object} [shown] - The editor's own output right after rendering.
     */
    markShown(catchUp, shown) {
      if (replica) replica.markShown(catchUp, shown);
    },
    /**
     * Shares the caret (block and character offsets) with the room.
     * @param {{ blockId: string, anchor: number, focus: number }|null} cursor - Caret or null.
     */
    sendCursor(cursor) {
      lastCursor = cursor;
      lastActivity = Date.now();
      idle = false;
      sendPresence();
    },
    /** Undoes the last own change. @returns {boolean} True when something was undone. */
    undo: () => Boolean(replica && state.canEdit && replica.undo()),
    /** Redoes the last undone own change. @returns {boolean} True when something was redone. */
    redo: () => Boolean(replica && state.canEdit && replica.redo()),
    /** Starts a new undo step. */
    stopCapturing: () => replica && replica.stopCapturing(),
    canUndo: () => Boolean(replica && replica.canUndo()),
    canRedo: () => Boolean(replica && replica.canRedo()),
    /** Current shared document. */
    getData: () => (replica ? replica.read() : docToEditorData(new Y.Doc())),
    /**
     * 2.4: the shared Y.Doc once the first sync is done (range comment anchors resolve their
     * relative positions in it), else null. Read only: never write to it outside `pushLocal`.
     * @returns {Y.Doc|null} Document.
     */
    getDoc: () => (replica && synced ? replica.doc : null),
    /** True when the room has content (it was seeded). */
    hasContent() {
      return Boolean(
        replica && (replica.doc.getArray('order').length > 0 || replica.doc.getMap('blocks').size > 0)
      );
    },
    /**
     * 2.6: the admin session ended. Closes the socket and sends nothing until
     * `resume()`; edits made meanwhile stay pending.
     */
    pause() {
      pauseNow();
    },
    /** 2.6: signed in again. Reconnects with a fresh token and sends pending edits. */
    resume() {
      if (destroyed || !paused) return;
      paused = false;
      attempt = 0;
      if (state.status === 'denied') return;
      if (needsConnect || !socket) {
        needsConnect = false;
        setState({ status: 'connecting', error: null });
        connect().catch(onConnectFailed);
        return;
      }
      setState({ status: 'reconnecting', error: null });
      if (!socket.connected) socket.connect();
    },
    /** @returns {boolean} True while paused (signed out). */
    isPaused: () => paused,
    /**
     * 2.6: the acknowledged room content when the client paused (null when it was not synced).
     * @returns {object|null} Editor data.
     */
    pausedBase: () => pausedBase,
    /**
     * 2.6: applies an edit made against an older room state (`from` -> `data`, e.g. text typed
     * while signed out, kept in the draft buffer) to the current room: only what changed between
     * the two is applied, so edits others made meanwhile stay. The editor then shows the result.
     * @param {object} from - Room content the edit started from.
     * @param {object} data - Edited content.
     * @returns {boolean} True when something changed.
     */
    mergeLocal(from, data) {
      if (destroyed || !replica || !synced || !state.canEdit || !from || !data) return false;
      const changed = replica.rebase(from, data);
      setState({});
      if (changed) {
        notifyRemote();
        flush();
      }
      return changed;
    },
    /** Disconnects and frees the documents. */
    destroy() {
      destroyed = true;
      clearInterval(resyncTimer);
      clearInterval(idleTimer);
      clearTimeout(notifyTimer);
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      if (win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('online', onOnline);
        win.removeEventListener('offline', onOffline);
        win.removeEventListener('pagehide', onPageHide);
        if (win.document) win.document.removeEventListener('visibilitychange', onVisibility);
      }
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      if (replica) replica.destroy();
      replica = null;
    },
  };
};

import * as Y from 'yjs';
import { io } from 'socket.io-client';
import { applyLocalChanges, docToEditorData } from '../../../shared/ydoc.mjs';

/**
 * Browser side of live collaboration for one editor field.
 *
 * Protocol (see server/src/services/collaboration.js):
 * - `mx:welcome { canEdit, presenceId, color }` after the token is accepted;
 * - `mx:sync { update, stateVector }` with the room state (or the part the
 *   client is missing after `mx:resync`); the client answers with whatever the
 *   server is missing;
 * - `mx:update <bytes>` both ways; the server acknowledges stored updates;
 * - `mx:presence [peers]`, `mx:cursor { blockId, offset }`, `mx:role`, `mx:error`.
 *
 * Unacknowledged local updates are kept and sent again after a reconnect, so
 * nothing typed during a network or server outage is lost.
 */

const RESYNC_MS = 20000;
const ACK_TIMEOUT_MS = 10000;

/** Empty Yjs update (no structs, no deletes). */
const isEmptyUpdate = (update) => !update || update.byteLength <= 2;

/**
 * Creates a collaboration client.
 * @param {object} options - Options.
 * @param {() => Promise<{ token: string, path: string, canEdit: boolean }>} options.requestSession - Gets a fresh one-time token.
 * @param {string} options.url - Backend URL.
 * @param {(data: object) => void} options.onRemoteData - Called with the merged document after remote changes.
 * @param {(state: object) => void} options.onState - Called with `{ status, canEdit, peers, error }`.
 * @param {Function} [options.socketFactory] - Replaces socket.io-client (tests).
 * @returns {{ pushLocal: (data: object) => void, sendCursor: (cursor: object|null) => void, getData: () => object, hasContent: () => boolean, destroy: () => void }} Client.
 */
export const createCollabClient = ({
  requestSession,
  url,
  onRemoteData,
  onFirstSync,
  onState,
  socketFactory = io,
}) => {
  const doc = new Y.Doc();
  let socket = null;
  let destroyed = false;
  let pending = null;
  let state = { status: 'connecting', canEdit: false, peers: [], error: null, presenceId: null, color: null };
  let resyncTimer = null;
  let notifyTimer = null;
  let firstToken = null;
  let synced = false;
  let seededBySelf = false;
  let base = { blocks: [] };

  const setState = (patch) => {
    state = { ...state, ...patch };
    onState({ ...state });
  };

  const notifyRemote = () => {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      if (!destroyed) onRemoteData(docToEditorData(doc));
    }, 30);
  };

  const flush = () => {
    if (!socket || !socket.connected || !pending || !state.canEdit) return;
    const update = pending;
    pending = null;
    socket.timeout(ACK_TIMEOUT_MS).emit('mx:update', update, (error, reply) => {
      if (error || !reply || !reply.ok) {
        pending = pending ? Y.mergeUpdates([update, pending]) : update;
        if (reply && reply.code === 'READ_ONLY') setState({ canEdit: false });
      }
    });
  };

  doc.on('update', (update, origin) => {
    if (origin === 'remote') {
      notifyRemote();
      return;
    }
    pending = pending ? Y.mergeUpdates([pending, update]) : update;
    flush();
  });

  const connect = async () => {
    const session = await requestSession();
    if (destroyed) return;
    firstToken = session.token;
    seededBySelf = session.seeded === true;
    setState({ canEdit: session.canEdit });
    socket = socketFactory(url, {
      path: session.path,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (callback) => {
        if (firstToken) {
          const token = firstToken;
          firstToken = null;
          callback({ token });
          return;
        }
        requestSession()
          .then((next) => {
            setState({ canEdit: next.canEdit });
            callback({ token: next.token });
          })
          .catch(() => callback({ token: '' }));
      },
    });
    socket.on('connect', () => setState({ status: 'syncing', error: null }));
    socket.on('disconnect', () => setState({ status: 'offline', peers: [] }));
    socket.on('connect_error', () => setState({ status: 'offline' }));
    socket.on('mx:welcome', (welcome) =>
      setState({ canEdit: Boolean(welcome.canEdit), presenceId: welcome.presenceId, color: welcome.color })
    );
    socket.on('mx:sync', ({ update, stateVector }) => {
      const bytes = new Uint8Array(update);
      Y.applyUpdate(doc, bytes, 'remote');
      if (stateVector && state.canEdit) {
        const missing = Y.encodeStateAsUpdate(doc, new Uint8Array(stateVector));
        if (!isEmptyUpdate(missing)) {
          pending = pending ? Y.mergeUpdates([pending, missing]) : missing;
        }
      }
      const first = !synced;
      synced = true;
      if (first) base = docToEditorData(doc);
      setState({ status: 'live' });
      // The person who created the room may have typed before the connection
      // was ready: let the field add those edits before the room is shown.
      Promise.resolve(first && typeof onFirstSync === 'function' ? onFirstSync(seededBySelf) : null)
        .catch(() => null)
        .then(() => {
          notifyRemote();
          flush();
        });
    });
    socket.on('mx:update', (update) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
    socket.on('mx:presence', (peers) => {
      setState({ peers: Array.isArray(peers) ? peers.filter((peer) => peer.id !== state.presenceId) : [] });
    });
    socket.on('mx:role', ({ canEdit }) => setState({ canEdit: Boolean(canEdit) }));
    socket.on('mx:error', ({ code }) =>
      setState({ status: code === 'ACCESS_REVOKED' ? 'denied' : 'error', error: code })
    );
    resyncTimer = setInterval(() => {
      if (socket && socket.connected) socket.emit('mx:resync', Y.encodeStateVector(doc));
    }, RESYNC_MS);
  };

  connect().catch((error) => {
    const status = error && error.response && error.response.status;
    setState({
      status: status === 404 || status === 403 ? 'denied' : 'error',
      error: status ? `HTTP_${status}` : 'NETWORK',
    });
  });

  return {
    /** Applies the local editor content to the shared document. */
    pushLocal(data) {
      if (destroyed || !synced || !state.canEdit) return;
      applyLocalChanges(doc, base, data, 'local');
      base = data;
    },
    /** Records what the editor shows now (after remote content was applied). */
    markShown(data) {
      base = data;
    },
    /** Shares the caret position with the room. */
    sendCursor(cursor) {
      if (socket && socket.connected) socket.emit('mx:cursor', cursor);
    },
    /** Current shared document. */
    getData() {
      return docToEditorData(doc);
    },
    /** True when the room has content (it was seeded). */
    hasContent() {
      return doc.getArray('order').length > 0 || doc.getMap('blocks').size > 0;
    },
    /** Disconnects and frees the document. */
    destroy() {
      destroyed = true;
      clearInterval(resyncTimer);
      clearTimeout(notifyTimer);
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      doc.destroy();
    },
  };
};

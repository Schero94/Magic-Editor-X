import { useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { createCollabClient } from '../../editor/collab-client';
import { API } from '../../utils/api';

const INITIAL = {
  status: 'off',
  canEdit: false,
  peers: [],
  error: null,
  color: null,
  pending: false,
  canUndo: false,
  canRedo: false,
};

/**
 * Connects an editor field to its live collaboration room.
 *
 * Session tokens are requested through the admin fetch client, so an
 * expired admin access token is refreshed by Strapi before a reconnect.
 * @param {object} options - Options.
 * @param {{ uid: string, documentId: string, locale: string|null, field: string }|null} options.target - Field, or null when collaboration is off.
 * @param {() => object|null} options.getLocalData - Current field content (seeds a new room).
 * @param {boolean} options.ready - True once the editor is ready.
 * @param {() => void} options.onRemoteData - Shows the shared document in the editor.
 * @param {(seeded: boolean, client: object) => Promise<void>} [options.onFirstSync] - First sync hook.
 * @returns {{ active: boolean, status: string, canEdit: boolean, peers: object[], error: string|null, pending: boolean, canUndo: boolean, canRedo: boolean, client: object|null }} State.
 */
export const useCollaboration = ({ target, getLocalData, ready, onRemoteData, onFirstSync }) => {
  const { post } = useFetchClient();
  const [state, setState] = useState(INITIAL);
  const [client, setClient] = useState(null);
  const getLocalRef = useRef(getLocalData);
  const onRemoteRef = useRef(onRemoteData);
  const onFirstSyncRef = useRef(onFirstSync);
  useEffect(() => {
    getLocalRef.current = getLocalData;
    onRemoteRef.current = onRemoteData;
    onFirstSyncRef.current = onFirstSync;
  });

  const key =
    target && ready ? `${target.uid}|${target.documentId}|${target.locale || ''}|${target.field}` : null;

  useEffect(() => {
    if (!key) return undefined;
    const [uid, documentId, locale, field] = key.split('|');
    const instance = createCollabClient({
      url: window.strapi.backendURL,
      requestSession: async () => {
        const { data } = await post(API.collaborationSession, {
          uid,
          documentId,
          locale: locale || null,
          field,
          initialValue: getLocalRef.current(),
        });
        return data.data;
      },
      onRemoteData: () => onRemoteRef.current(),
      onFirstSync: (seeded) => (onFirstSyncRef.current ? onFirstSyncRef.current(seeded, instance) : null),
      onState: (next) => setState((previous) => ({ ...previous, ...next })),
      onUndoState: (undo) => setState((previous) => ({ ...previous, ...undo })),
    });
    setClient(instance);
    return () => {
      instance.destroy();
      setClient(null);
      setState(INITIAL);
    };
  }, [key, post]);

  if (!key) return { ...INITIAL, active: false, client: null };
  return {
    active: !['off', 'denied', 'error'].includes(state.status),
    status: state.status === 'off' ? 'connecting' : state.status,
    canEdit: state.canEdit,
    peers: state.peers,
    error: state.error,
    color: state.color,
    pending: state.pending,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    client,
  };
};

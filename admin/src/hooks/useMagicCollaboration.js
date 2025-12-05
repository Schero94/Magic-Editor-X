/**
 * Magic Editor X - Collaboration Hook (Strapi v5)
 * Manages Yjs document sync + Socket.io connection with admin auth
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFetchClient, useAuth } from '@strapi/strapi/admin';
import { io } from 'socket.io-client';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

const pluginId = 'magic-editor-x';
const SOCKET_FALLBACK_PATH = '/magic-editor-x/realtime';

// Predefined colors for cursor awareness (vibrant, distinguishable)
const CURSOR_COLORS = [
  { bg: '#EF4444', text: '#FFFFFF', name: 'Red' },      // Red
  { bg: '#3B82F6', text: '#FFFFFF', name: 'Blue' },     // Blue
  { bg: '#10B981', text: '#FFFFFF', name: 'Green' },    // Green
  { bg: '#F59E0B', text: '#000000', name: 'Amber' },    // Amber
  { bg: '#8B5CF6', text: '#FFFFFF', name: 'Purple' },   // Purple
  { bg: '#EC4899', text: '#FFFFFF', name: 'Pink' },     // Pink
  { bg: '#06B6D4', text: '#FFFFFF', name: 'Cyan' },     // Cyan
  { bg: '#F97316', text: '#FFFFFF', name: 'Orange' },   // Orange
];

// Get a consistent color for a user based on their ID
const getUserColor = (userId) => {
  if (!userId) return CURSOR_COLORS[0];
  // Use a simple hash to get consistent color assignment
  const hash = String(userId).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
};

/**
 * Hook for realtime collaboration on Editor.js documents (Strapi v5)
 * @param {object} config - Configuration object
 * @param {boolean} config.enabled - Whether collaboration is enabled
 * @param {string} config.roomId - Unique room/document identifier
 * @param {string} config.fieldName - Field name for permissions
 * @param {string} config.initialValue - Initial content value
 * @returns {object} Collaboration state and controls
 */
export const useMagicCollaboration = ({
  enabled,
  roomId,
  fieldName,
  initialValue,
  onRemoteUpdate, // Callback when remote update is received
}) => {
  // Strapi v5 hooks
  const { get, post } = useFetchClient();
  const authContext = useAuth('useMagicCollaboration', (state) => state);
  const user = authContext?.user || null;

  const [status, setStatus] = useState(enabled ? 'idle' : 'disabled');
  const [error, setError] = useState(null);
  const [peers, setPeers] = useState([]);
  const [awareness, setAwareness] = useState({}); // { odulerId: { user, cursor, color, lastUpdate } }
  const [collabRole, setCollabRole] = useState(null); // 'viewer' | 'editor' | 'owner'
  const [canEdit, setCanEdit] = useState(null); // null = unknown, true = can edit, false = readonly

  const socketRef = useRef(null);
  const persistenceRef = useRef(null);
  const bootstrappedRef = useRef(false);
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  
  // Keep the callback ref updated
  useEffect(() => {
    onRemoteUpdateRef.current = onRemoteUpdate;
  }, [onRemoteUpdate]);

  // Create Y.Doc + Y.Map for block-level collaboration
  // Using Y.Map instead of Y.Text prevents JSON corruption from character-level CRDT merges
  const { doc, blocksMap, metaMap } = useMemo(() => {
    const yDoc = new Y.Doc();
    return { 
      doc: yDoc, 
      blocksMap: yDoc.getMap('blocks'),  // Each block stored by ID
      metaMap: yDoc.getMap('meta'),      // Metadata (time, version, etc.)
    };
  }, [roomId]);

  // Cleanup Y.Doc on unmount
  useEffect(() => {
    return () => {
      doc.destroy();
    };
  }, [doc]);

  // Reset on roomId change
  useEffect(() => {
    bootstrappedRef.current = false;
    setPeers([]);
    setAwareness({});

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId]);

  // Cleanup stale awareness entries (older than 30 seconds)
  useEffect(() => {
    if (!enabled) return undefined;

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 30000; // 30 seconds

      setAwareness((prev) => {
        const next = { ...prev };
        let changed = false;
        
        Object.keys(next).forEach((key) => {
          if (now - next[key].lastUpdate > staleThreshold) {
            delete next[key];
            changed = true;
          }
        });
        
        return changed ? next : prev;
      });
    }, 10000); // Check every 10 seconds

    return () => clearInterval(cleanupInterval);
  }, [enabled]);

  // Handle enabled state changes
  useEffect(() => {
    if (!enabled) {
      setStatus('disabled');
    } else if (status === 'disabled') {
      setStatus('idle');
    }
  }, [enabled, status]);

  // DON'T bootstrap initial value on client!
  // The server is the single source of truth.
  // Clients must wait for collab:sync to receive the initial state.
  // Bootstrapping locally causes Y.Doc state vector mismatches and CRDT merge failures.
  useEffect(() => {
    if (!enabled || !roomId) {
      return undefined;
    }
    // Just mark as ready, don't bootstrap any content
    bootstrappedRef.current = true;
    console.log('[Magic Collab] [READY] Client ready, waiting for server sync...');
    return undefined;
  }, [enabled, roomId]);

  // IndexedDB persistence - Local cache for faster loading & offline viewing
  // Server remains the source of truth; cache is synced on connect
  useEffect(() => {
    if (!enabled || !roomId || !doc) {
      return undefined;
    }

    // Create IndexedDB persistence with room-specific name
      const persistenceKey = `magic-editor-x::${roomId}`;
    
      try {
      const persistence = new IndexeddbPersistence(persistenceKey, doc);
      persistenceRef.current = persistence;
      
      persistence.on('synced', () => {
        console.log('[Magic Collab] [CACHE] IndexedDB synced for room:', roomId);
      });
      
      console.log('[Magic Collab] [CACHE] IndexedDB persistence initialized:', persistenceKey);
      } catch (e) {
      console.warn('[Magic Collab] IndexedDB persistence failed:', e.message);
    }

    return () => {
      // Cleanup persistence on unmount
      if (persistenceRef.current) {
        try {
          persistenceRef.current.destroy();
          persistenceRef.current = null;
          console.log('[Magic Collab] [CACHE] IndexedDB persistence destroyed');
        } catch (e) {
          // Ignore cleanup errors
      }
    }
    };
  }, [enabled, roomId, doc]);

  // Store initialValue in ref to avoid useEffect re-runs
  const initialValueRef = useRef(initialValue);
  useEffect(() => {
    initialValueRef.current = initialValue;
  }, [initialValue]);

  // Socket.io connection with JWT auth
  // IMPORTANT: Only re-run when roomId/enabled/user changes, NOT on text changes
  useEffect(() => {
    if (!enabled || !roomId || !user) {
      return undefined;
    }

    // Prevent reconnection if already connected
    if (socketRef.current?.connected) {
      return undefined;
    }

    let cancelled = false;
    setError(null);
    setStatus('requesting');

    const startSession = async () => {
      try {
        console.log('[Magic Collab] [SESSION] Requesting session for room:', roomId);
        
        // Use useFetchClient like magic-link - it automatically adds /admin prefix + auth headers
        // Note: Use /collab/session to avoid Socket.io path collision with /realtime
        const { data } = await post(`/${pluginId}/collab/session`, {
          roomId,
          fieldName,
          initialValue: initialValueRef.current || '',
          meta: { roomId, fieldName },
        });
        
        console.log('[Magic Collab] [SUCCESS] Session response:', data);

        if (cancelled) {
          return;
        }

        if (!data || !data.token) {
          throw new Error('Invalid session response: missing token');
        }

        // Store collaboration role from session response
        const userRole = data.role || 'viewer';
        const userCanEdit = data.canEdit !== undefined ? data.canEdit : ['editor', 'owner'].includes(userRole);
        
        setCollabRole(userRole);
        setCanEdit(userCanEdit);
        
        console.log('[Magic Collab] [ROLE] User role:', userRole, '| Can edit:', userCanEdit);

        setStatus('connecting');

        const wsUrl = data.wsUrl || window.location.origin;
        const wsPath = data.wsPath || SOCKET_FALLBACK_PATH;

        console.log('[Magic Collab] [SOCKET] Connecting to Socket.io:', { wsUrl, wsPath });

        // Connect to Socket.io with auth token
        const socket = io(wsUrl, {
          path: wsPath,
          auth: { token: data.token },
          transports: ['websocket', 'polling'], // Add polling as fallback
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
        });

        socketRef.current = socket;

        // Socket event handlers
        socket.on('connect', () => {
          setStatus('connected');
          console.log('[Magic Collab] [SUCCESS] Connected to room:', roomId);
        });

        socket.on('disconnect', (reason) => {
          setStatus('disconnected');
          console.log('[Magic Collab] [WARNING] Disconnected:', reason);
        });

        socket.on('connect_error', (error) => {
          console.error('[Magic Collab] [ERROR] Connection error:', error);
          setStatus('error');
          setError(`Connection failed: ${error.message}`);
        });

        socket.on('collab:error', (payload) => {
          console.error('[Magic Collab] [ERROR] Collaboration error:', payload);
          setError(payload?.message || 'Realtime collaboration error');
        });

        // Sync initial state from server
        // The server sends the FULL Y.Doc state as a binary update
        socket.on('collab:sync', (update) => {
          if (update) {
            console.log('[Magic Collab] [SYNC] Syncing initial state, update size:', update.length, 'bytes');
            try {
              const beforeBlockCount = blocksMap.size;
              console.log('[Magic Collab] [DATA] Y.Map BEFORE sync - block count:', beforeBlockCount);
              
              // Apply the server's state to our Y.Doc
              Y.applyUpdate(doc, new Uint8Array(update), 'remote');
              
              const afterBlockCount = blocksMap.size;
              console.log('[Magic Collab] [DATA] Y.Map AFTER sync - block count:', afterBlockCount);
              console.log('[Magic Collab] [DATA] Y.Map changed:', beforeBlockCount !== afterBlockCount);
              
              // Always call callback after initial sync to render the server's content
              if (onRemoteUpdateRef.current) {
                console.log('[Magic Collab] [CALLBACK] Calling onRemoteUpdate callback after sync');
                setTimeout(() => {
                  onRemoteUpdateRef.current();
                }, 0);
              }
            } catch (err) {
              console.error('[Magic Collab] Failed to apply initial sync:', err);
            }
          }
        });

        // Apply remote updates from other clients
        // Using Y.Map for block-level updates prevents JSON corruption
        socket.on('collab:update', (update) => {
          if (update) {
            console.log('[Magic Collab] [UPDATE] Received remote update:', update.length, 'bytes');
            try {
              const beforeBlockCount = blocksMap.size;
              console.log('[Magic Collab] [DATA] Y.Map BEFORE update - blocks:', beforeBlockCount);
              
              // Apply the update using Yjs CRDT merge (now safe with Y.Map)
              Y.applyUpdate(doc, new Uint8Array(update), 'remote');
              
              const afterBlockCount = blocksMap.size;
              console.log('[Magic Collab] [DATA] Y.Map AFTER update - blocks:', afterBlockCount);
              
              // Always call callback for remote updates
              // Y.js only sends actual changes, so we don't need to check for content changes
              // The old check (comparing block IDs) missed content changes within blocks
              if (onRemoteUpdateRef.current) {
                console.log('[Magic Collab] [CALLBACK] Calling onRemoteUpdate callback');
                setTimeout(() => {
                  onRemoteUpdateRef.current();
                }, 0);
              }
            } catch (err) {
              console.error('[Magic Collab] Failed to apply update:', err);
            }
          }
        });

        // Handle peer presence
        socket.on('collab:presence', ({ type, user: peerUser }) => {
          if (!peerUser?.id) {
            return;
          }

          console.log('[Magic Collab] [PEERS] Peer presence:', type, peerUser.email);

          setPeers((current) => {
            if (type === 'leave') {
              // Also remove from awareness
              setAwareness((prev) => {
                const next = { ...prev };
                delete next[peerUser.id];
                return next;
              });
              return current.filter((peer) => peer.id !== peerUser.id);
            }

            const exists = current.some((peer) => peer.id === peerUser.id);
            if (exists) {
              return current;
            }

            return [...current, peerUser];
          });
        });

        // Handle cursor awareness updates from other users
        socket.on('collab:awareness', ({ user: peerUser, payload }) => {
          if (!peerUser?.id) {
            return;
          }

          // Don't process our own awareness updates
          // (the server might broadcast to all including sender)
          if (user && peerUser.id === user.id) {
            return;
          }

          console.log('[Magic Collab] [CURSOR] Cursor update from:', peerUser.email, payload);

          setAwareness((prev) => ({
            ...prev,
            [peerUser.id]: {
              user: peerUser,
              cursor: payload?.cursor || null,
              blockId: payload?.blockId || null,
              blockIndex: payload?.blockIndex || null,
              selection: payload?.selection || null,
              color: getUserColor(peerUser.id),
              lastUpdate: Date.now(),
            },
          }));
        });
      } catch (err) {
        if (!cancelled) {
          console.error('[Magic Collab] [ERROR] Session error:', err);
          
          const errorMessage = err?.response?.data?.error?.message || err?.message;
          const errorStatus = err?.response?.status;
          
          setStatus('denied');
          
          // Bessere Fehlermeldungen
          if (errorStatus === 403 || errorMessage?.includes('Freigabe') || errorMessage?.includes('forbidden')) {
            setError('[DENIED] Keine Freigabe: Kontaktiere einen Super Admin fuer Zugriff');
          } else if (errorStatus === 401 || errorMessage?.includes('unauthorized')) {
            setError('[AUTH] Authentifizierung fehlgeschlagen');
          } else if (errorMessage?.includes('disabled')) {
            setError('[DISABLED] Echtzeit-Bearbeitung ist deaktiviert');
          } else if (errorStatus === 400) {
            setError(`[ERROR] Ungueltige Anfrage: ${errorMessage}`);
          } else {
            setError(errorMessage || '[ERROR] Keine Berechtigung fuer Live Editing');
          }
        }
      }
    };

    startSession();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        console.log('[Magic Collab] [SOCKET] Disconnecting socket');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setPeers([]);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, post, fieldName, roomId, user]);

  // Broadcast local changes to server
  useEffect(() => {
    if (!enabled) {
      console.log('[Magic Collab] [SKIP] Update handler not registered (disabled)');
      return undefined;
    }

    console.log('[Magic Collab] [HANDLER] Registering update handler on doc');

    const handler = (update, origin) => {
      console.log('[Magic Collab] [DOC] Doc update event - origin:', origin, 'socket:', !!socketRef.current, 'connected:', socketRef.current?.connected);
      
      if (origin === 'remote' || origin === 'bootstrap') {
        console.log('[Magic Collab] [SKIP] Skipping update (origin:', origin, ')');
        return;
      }
      
      if (!socketRef.current) {
        console.log('[Magic Collab] [WARNING] Socket not ready, update not sent');
        return;
      }
      
      if (!socketRef.current.connected) {
        console.log('[Magic Collab] [WARNING] Socket not connected, update not sent');
        return;
      }

      // Convert Uint8Array to Array for Socket.io transmission
      const updateArray = Array.from(update);
      socketRef.current.emit('collab:update', updateArray);
      console.log('[Magic Collab] [SENT] Sent update:', updateArray.length, 'bytes');
    };

    doc.on('update', handler);

    return () => {
      console.log('[Magic Collab] [CLEANUP] Removing update handler');
      doc.off('update', handler);
    };
  }, [doc, enabled]);

  /**
   * Emit awareness/cursor position
   */
  const emitAwareness = useCallback((payload) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('collab:awareness', payload);
    }
  }, []);

  // Get the local user's color
  const localUserColor = useMemo(() => {
    return user ? getUserColor(user.id) : CURSOR_COLORS[0];
  }, [user]);

  return {
    doc,
    blocksMap,     // Y.Map for block-level sync (replaces Y.Text)
    metaMap,       // Y.Map for metadata
    status,
    error,
    peers,
    awareness,
    emitAwareness,
    localUserColor,
    getUserColor,
    // Role-based access control
    collabRole,    // 'viewer' | 'editor' | 'owner' | null
    canEdit,       // true if user can edit (editor/owner), false for viewer
  };
};

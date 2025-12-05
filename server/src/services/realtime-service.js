'use strict';

const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const Y = require('yjs');

const pluginId = 'magic-editor-x';
const DEFAULT_SOCKET_PATH = '/magic-editor-x/realtime';

const DEFAULT_CORS_CONFIG = {
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true,
};

/**
 * Check if strapi-plugin-io is installed and active
 * This helps avoid conflicts when both plugins are enabled
 */
const isPluginIoActive = (strapi) => {
  try {
    return !!strapi.$io;
  } catch {
    return false;
  }
};

module.exports = ({ strapi }) => {
  const rooms = new Map();
  const sessionTokens = new Map();
  let io;

  /** Returns plugin configuration */
  const getConfig = () => strapi.config.get(`plugin::${pluginId}`, {});

  /**
   * Ensures a Y.Doc room exists for the given roomId
   * @param {string} roomId - Unique room identifier
   * @returns {object} Room object with Y.Doc
   */
  const ensureRoom = (roomId) => {
    if (!rooms.has(roomId)) {
      const doc = new Y.Doc();
      rooms.set(roomId, {
        roomId,
        doc,
        initialized: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: {},
      });

      doc.on('update', () => {
        const room = rooms.get(roomId);
        if (room) {
          room.initialized = true;
          room.updatedAt = Date.now();
        }
      });
    }

    return rooms.get(roomId);
  };

  /**
   * Initializes a Y.Doc with initial value using Y.Map for block-level sync
   * Each block is stored by ID to prevent JSON corruption during CRDT merges
   * @param {string} roomId - Room identifier
   * @param {string} initialValue - Initial JSON content (EditorJS format)
   * @returns {object} Room object
   */
  const initializeDoc = (roomId, initialValue) => {
    const room = ensureRoom(roomId);
    if (!initialValue || room.initialized) {
      return room;
    }

    try {
      // Parse initial value and store blocks in Y.Map
      const data = JSON.parse(initialValue);
      const blocks = data?.blocks || [];
      const time = data?.time || Date.now();
      
      room.doc.transact(() => {
        const blocksMap = room.doc.getMap('blocks');
        const metaMap = room.doc.getMap('meta');
        
        // Store each block by ID
        for (const block of blocks) {
          if (block.id) {
            blocksMap.set(block.id, JSON.stringify(block));
          }
        }
        
        // Store metadata
        metaMap.set('time', time);
        metaMap.set('blockOrder', blocks.map(b => b.id));
      }, 'bootstrap');
      
      strapi.log.info(`[Magic Editor X] [INIT] Initialized room ${roomId} with ${blocks.length} blocks`);
    } catch (error) {
      strapi.log.error(`[Magic Editor X] Failed to initialize Y.Doc for room ${roomId}`, error);
    }

    return room;
  };

  /**
   * Encodes Y.Doc state as binary update
   * @param {string} roomId - Room identifier
   * @returns {Uint8Array|null} Encoded state or null on error
   */
  const getStateUpdate = (roomId) => {
    const room = ensureRoom(roomId);
    try {
      return Y.encodeStateAsUpdate(room.doc);
    } catch (error) {
      strapi.log.error(`[Magic Editor X] Failed to encode state for room ${roomId}`, error);
      return null;
    }
  };

  /**
   * Applies a Y.js update to a room's document
   * @param {string} roomId - Room identifier
   * @param {Uint8Array} update - Binary Y.js update
   * @param {string} origin - Update origin (default: 'remote')
   */
  const applyUpdate = (roomId, update, origin = 'remote') => {
    if (!update) {
      return;
    }

    const room = ensureRoom(roomId);

    try {
      Y.applyUpdate(room.doc, update, origin);
    } catch (error) {
      strapi.log.error(`[Magic Editor X] Failed to apply update for room ${roomId}`, error);
    }
  };

  /**
   * Issues a short-lived session token for WebSocket authentication
   * @param {object} params - Session parameters
   * @param {string} params.roomId - Room identifier
   * @param {string} params.fieldName - Editor field name
   * @param {object} params.meta - Additional metadata
   * @param {object} params.user - Admin user object
   * @param {string} params.initialValue - Initial editor content
   * @returns {object} Session token and connection info
   */
  const issueSession = ({ roomId, fieldName, meta = {}, user, initialValue = '' }) => {
    const pluginConfig = getConfig();
    const collabConfig = pluginConfig.collaboration || {};

    // Collaboration ist standardmäßig aktiviert, außer explizit deaktiviert
    if (collabConfig.enabled === false) {
      throw new Error('collaboration-disabled');
    }

    initializeDoc(roomId, initialValue);

    const token = randomUUID();
    const expiresAt = Date.now() + (collabConfig.sessionTTL || 2 * 60 * 1000);

    sessionTokens.set(token, {
      token,
      roomId,
      fieldName,
      meta,
      user: {
        id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        roles: user.roles?.map((role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
        })) || [],
      },
      expiresAt,
    });

    // Use the actual path from the io instance if available
    const actualPath = io?._magicEditorPath || collabConfig.wsPath || DEFAULT_SOCKET_PATH;

    return {
      token,
      roomId,
      expiresAt,
      wsPath: actualPath,
      wsUrl: collabConfig.wsUrl || undefined,
      approvals: {
        roleApproved: true,
      },
    };
  };

  /**
   * Validates and consumes a session token (one-time use)
   * @param {string} token - Session token to validate
   * @returns {object|null} Session data or null if invalid/expired
   */
  const consumeSessionToken = (token) => {
    if (!token) {
      return null;
    }

    const session = sessionTokens.get(token);
    if (!session) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      sessionTokens.delete(token);
      return null;
    }

    sessionTokens.delete(token);
    return session;
  };

  /**
   * Initializes the Socket.io server for realtime collaboration
   * @returns {Server|null} Socket.io server instance or null if disabled
   */
  const initSocketServer = () => {
    const pluginConfig = getConfig();
    const collabConfig = pluginConfig.collaboration || {};

    // Collaboration ist standardmäßig aktiviert, außer explizit deaktiviert
    if (collabConfig.enabled === false) {
      strapi.log.info('[Magic Editor X] Realtime server disabled (collaboration.enabled=false)');
      return null;
    }

    if (io) {
      return io;
    }

    const httpServer = strapi.server.httpServer;
    if (!httpServer) {
      strapi.log.warn('[Magic Editor X] HTTP server not ready. Realtime collaboration skipped.');
      return null;
    }

    // Check for strapi-plugin-io compatibility
    if (isPluginIoActive(strapi)) {
      strapi.log.info('[Magic Editor X] [INFO] strapi-plugin-io detected - using separate namespace');
    }

    // IMPORTANT: Use a unique path to avoid conflicts with strapi-plugin-io
    // strapi-plugin-io uses default '/socket.io' path
    // We use '/magic-editor-x/realtime' to avoid any conflicts
    const wsPath = collabConfig.wsPath || DEFAULT_SOCKET_PATH;
    
    // Validate path doesn't conflict with strapi-plugin-io
    if (wsPath === '/socket.io') {
      strapi.log.warn('[Magic Editor X] [WARNING] wsPath "/socket.io" conflicts with strapi-plugin-io!');
      strapi.log.warn('[Magic Editor X] Using default path instead: ' + DEFAULT_SOCKET_PATH);
    }
    
    const finalPath = wsPath === '/socket.io' ? DEFAULT_SOCKET_PATH : wsPath;
    
    strapi.log.info(`[Magic Editor X] [SOCKET] Starting Socket.io server on path: ${finalPath}`);

    io = new Server(httpServer, {
      path: finalPath,
      cors: collabConfig.cors || DEFAULT_CORS_CONFIG,
      transports: ['websocket', 'polling'],
      allowEIO3: true, // Backward compatibility
      // Avoid conflicts with other Socket.io instances
      serveClient: false, // Don't serve socket.io client files
      connectTimeout: 45000,
    });
    
    // Store the path for session token generation
    io._magicEditorPath = finalPath;

    io.on('connection', (socket) => {
      const token = socket.handshake.auth?.token;
      
      strapi.log.info(`[Magic Editor X] [SOCKET] Client connecting with token: ${token ? 'valid' : 'missing'}`);
      
      const session = consumeSessionToken(token);

      if (!session) {
        strapi.log.warn('[Magic Editor X] [WARNING] Invalid or expired token');
        socket.emit('collab:error', { code: 'INVALID_TOKEN', message: 'Invalid or expired session token' });
        socket.disconnect(true);
        return;
      }

      const { roomId, user } = session;
      socket.data.user = user;
      socket.data.roomId = roomId;
      socket.join(roomId);

      strapi.log.info(`[Magic Editor X] [SUCCESS] User ${user.email} joined room: ${roomId}`);

      // Send initial state as binary data (Uint8Array)
      const initialState = getStateUpdate(roomId);
      if (initialState) {
        // Convert to Array for Socket.io transmission
        const stateArray = Array.from(initialState);
        socket.emit('collab:sync', stateArray);
        strapi.log.info(`[Magic Editor X] [SYNC] Sent initial state (${stateArray.length} bytes)`);
      }

      // Send list of ALL peers already in the room to the new user
      const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
      if (socketsInRoom) {
        const existingPeers = [];
        for (const socketId of socketsInRoom) {
          const peerSocket = io.sockets.sockets.get(socketId);
          if (peerSocket && peerSocket.data.user && peerSocket.id !== socket.id) {
            existingPeers.push(peerSocket.data.user);
          }
        }
        
        // Send all existing peers to the new user
        existingPeers.forEach(peerUser => {
          socket.emit('collab:presence', { type: 'join', user: peerUser });
        });
        
        strapi.log.info(`[Magic Editor X] [PEERS] Sent ${existingPeers.length} existing peers to new user`);
      }

      // Notify other users about the new user
      socket.to(roomId).emit('collab:presence', { type: 'join', user });

      socket.on('collab:update', (update) => {
        try {
          // Convert from Array back to Uint8Array
          const updateBuffer = new Uint8Array(update);
          applyUpdate(roomId, updateBuffer, 'remote');
          
          // Broadcast to other clients in the room
          socket.to(roomId).emit('collab:update', update);
          
          strapi.log.debug(`[Magic Editor X] [BROADCAST] Update broadcast to room ${roomId}`);
        } catch (error) {
          strapi.log.error('[Magic Editor X] Failed to process update:', error);
          socket.emit('collab:error', { code: 'UPDATE_FAILED', message: 'Failed to process update' });
        }
      });

      socket.on('collab:awareness', (payload) => {
        socket.to(roomId).emit('collab:awareness', { user, payload });
      });

      socket.on('disconnect', (reason) => {
        strapi.log.info(`[Magic Editor X] [DISCONNECT] User ${user.email} left room ${roomId} (${reason})`);
        socket.to(roomId).emit('collab:presence', { type: 'leave', user });
      });

      socket.on('error', (error) => {
        strapi.log.error('[Magic Editor X] Socket error:', error);
      });
    });

    strapi.log.info('[Magic Editor X] [SUCCESS] Realtime collaboration server ready');

    return io;
  };

  /**
   * Closes the Socket.io server and cleans up all rooms
   */
  const close = async () => {
    if (io) {
      await io.close();
      io = null;
    }

    sessionTokens.clear();
    rooms.forEach((room) => room.doc.destroy());
    rooms.clear();
  };

  return {
    issueSession,
    consumeSessionToken,
    applyUpdate,
    initSocketServer,
    close,
  };
};



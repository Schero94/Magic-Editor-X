'use strict';

const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const Y = require('yjs');
const { createLogger } = require('../utils');

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
  const logger = createLogger(strapi);
  const rooms = new Map();
  const sessionTokens = new Map();
  let io;
  let cleanupInterval;

  /** Returns plugin configuration */
  const getConfig = () => strapi.config.get(`plugin::${pluginId}`, {});

  /**
   * Cleanup routine to remove stale rooms and free memory
   */
  const cleanupStaleRooms = () => {
    if (!io) return;
    
    const now = Date.now();
    const STALE_THRESHOLD = 60 * 60 * 1000; // 1 hour
    
    let removedCount = 0;
    
    rooms.forEach((room, roomId) => {
      // Check for active connections
      const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
      const connectionCount = socketsInRoom ? socketsInRoom.size : 0;
      
      if (connectionCount === 0) {
        // No connections - check if it's stale
        if (now - room.updatedAt > STALE_THRESHOLD) {
          room.doc.destroy();
          rooms.delete(roomId);
          removedCount++;
        }
      }
    });
    
    if (removedCount > 0) {
      logger.info(`[CLEANUP] Removed ${removedCount} stale rooms`);
    }
  };

  // Start cleanup interval
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupStaleRooms, 15 * 60 * 1000); // Every 15 minutes
  }

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
   * Converts HTML to Y.Text delta format
   * @param {string} html - HTML string
   * @returns {Array} Delta operations
   */
  const htmlToDelta = (html) => {
    if (!html || html === '<br>' || html === '<br/>') return [];
    
    // Simple HTML parser for server-side (no DOMParser available)
    // This handles basic formatting tags
    const delta = [];
    let currentText = '';
    let currentAttrs = {};
    let i = 0;
    
    const tagStack = [];
    
    while (i < html.length) {
      if (html[i] === '<') {
        // Flush current text
        if (currentText) {
          const attrs = Object.keys(currentAttrs).length > 0 ? { ...currentAttrs } : undefined;
          delta.push({ insert: currentText, attributes: attrs });
          currentText = '';
        }
        
        // Find end of tag
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) break;
        
        const tagContent = html.substring(i + 1, tagEnd);
        const isClosing = tagContent.startsWith('/');
        const tagName = isClosing 
          ? tagContent.substring(1).toLowerCase().trim()
          : tagContent.split(/\s/)[0].toLowerCase();
        
        if (isClosing) {
          // Remove attribute from stack
          if (tagStack.length > 0) {
            const lastTag = tagStack.pop();
            delete currentAttrs[lastTag.attr];
          }
        } else if (tagName === 'br') {
          delta.push({ insert: '\n' });
        } else {
          // Opening tag - add attribute
          let attr = null;
          switch (tagName) {
            case 'b':
            case 'strong':
              attr = 'bold';
              currentAttrs.bold = true;
              break;
            case 'i':
            case 'em':
              attr = 'italic';
              currentAttrs.italic = true;
              break;
            case 'u':
              attr = 'underline';
              currentAttrs.underline = true;
              break;
            case 'code':
              attr = 'code';
              currentAttrs.code = true;
              break;
            case 'mark':
              attr = 'mark';
              currentAttrs.mark = true;
              break;
            case 'a':
              attr = 'a';
              // Parse href attribute
              const hrefMatch = tagContent.match(/href=["']([^"']*)["']/);
              const targetMatch = tagContent.match(/target=["']([^"']*)["']/);
              const relMatch = tagContent.match(/rel=["']([^"']*)["']/);
              currentAttrs.a = {
                href: hrefMatch ? hrefMatch[1] : '',
                target: targetMatch ? targetMatch[1] : '_blank',
                rel: relMatch ? relMatch[1] : 'noopener noreferrer'
              };
              break;
          }
          if (attr) {
            tagStack.push({ tagName, attr });
          }
        }
        
        i = tagEnd + 1;
      } else {
        // Regular character
        currentText += html[i];
        i++;
      }
    }
    
    // Flush remaining text
    if (currentText) {
      // Decode HTML entities
      currentText = currentText
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      
      const attrs = Object.keys(currentAttrs).length > 0 ? { ...currentAttrs } : undefined;
      delta.push({ insert: currentText, attributes: attrs });
    }
    
    return delta;
  };

  /**
   * Initializes a Y.Doc with initial value using hybrid structure for CHARACTER-LEVEL SYNC
   * - blocksMap: Y.Map for block metadata (type, tunes)
   * - textMap: Y.Map<blockId, Y.Text> for character-level text content
   * - metaMap: Y.Map for document metadata (time, blockOrder)
   * @param {string} roomId - Room identifier
   * @param {string} initialValue - Initial JSON content (EditorJS format)
   * @returns {object} Room object
   */
  const initializeDoc = (roomId, initialValue) => {
    const room = ensureRoom(roomId);
    
    // Check if doc is already populated
    const blocksMap = room.doc.getMap('blocks');
    const textMap = room.doc.getMap('text');
    const isDocEmpty = blocksMap.size === 0 && textMap.size === 0;

    // Only initialize if we have a value AND the doc is empty
    // This handles server restarts where room is lost but client provides latest DB state
    if (!initialValue || (!isDocEmpty && room.initialized)) {
      return room;
    }

    try {
      // Parse initial value and store using hybrid structure
      const data = JSON.parse(initialValue);
      const blocks = data?.blocks || [];
      const time = data?.time || Date.now();
      
      room.doc.transact(() => {
        const metaMap = room.doc.getMap('meta');
        
        // Store each block with character-level text sync
        for (const block of blocks) {
          if (!block.id) continue;
          
          // Store block metadata (type, tunes, etc.) - NOT text content
          const blockMeta = {
            type: block.type,
            tunes: block.tunes || {},
          };
          blocksMap.set(block.id, JSON.stringify(blockMeta));
          
          // Create Y.Text for block's text content (character-level sync!)
          const ytext = new Y.Text();
          
          // Extract text content from block data
          let textContent = '';
          if (block.data) {
            // Handle different block types
            if (typeof block.data.text === 'string') {
              textContent = block.data.text;
            } else if (typeof block.data.content === 'string') {
              textContent = block.data.content;
            } else if (typeof block.data.code === 'string') {
              textContent = block.data.code;
            } else if (typeof block.data.caption === 'string') {
              textContent = block.data.caption;
            }
          }
          
          // Convert HTML to delta and apply to Y.Text
          if (textContent) {
            const delta = htmlToDelta(textContent);
            if (delta.length > 0) {
              ytext.applyDelta(delta);
            }
          }
          
          textMap.set(block.id, ytext);
        }
        
        // Store metadata (time) and block order
        metaMap.set('time', time);
        metaMap.set('blockOrder', JSON.stringify(blocks.map((b) => b.id)));
      }, 'bootstrap');
      
      room.initialized = true;
      logger.info(`[INIT] Initialized room ${roomId} with ${blocks.length} blocks (character-level sync)`);
    } catch (error) {
      logger.error(`Failed to initialize Y.Doc for room ${roomId}`, error);
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
      logger.error(`Failed to encode state for room ${roomId}`, error);
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
      logger.error(`Failed to apply update for room ${roomId}`, error);
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
      logger.info('Realtime server disabled (collaboration.enabled=false)');
      return null;
    }

    if (io) {
      return io;
    }

    const httpServer = strapi.server.httpServer;
    if (!httpServer) {
      logger.warn('HTTP server not ready. Realtime collaboration skipped.');
      return null;
    }

    // Check for strapi-plugin-io compatibility
    if (isPluginIoActive(strapi)) {
      logger.info('[INFO] strapi-plugin-io detected - using separate namespace');
    }

    // IMPORTANT: Use a unique path to avoid conflicts with strapi-plugin-io
    // strapi-plugin-io uses default '/socket.io' path
    // We use '/magic-editor-x/realtime' to avoid any conflicts
    const wsPath = collabConfig.wsPath || DEFAULT_SOCKET_PATH;
    
    // Validate path doesn't conflict with strapi-plugin-io
    if (wsPath === '/socket.io') {
      logger.warn('[WARNING] wsPath "/socket.io" conflicts with strapi-plugin-io!');
      logger.warn('Using default path instead: ' + DEFAULT_SOCKET_PATH);
    }
    
    const finalPath = wsPath === '/socket.io' ? DEFAULT_SOCKET_PATH : wsPath;
    
    logger.info(`[SOCKET] Starting Socket.io server on path: ${finalPath}`);

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
      
      logger.info(`[SOCKET] Client connecting with token: ${token ? 'valid' : 'missing'}`);
      
      const session = consumeSessionToken(token);

      if (!session) {
        logger.warn('[WARNING] Invalid or expired token');
        socket.emit('collab:error', { code: 'INVALID_TOKEN', message: 'Invalid or expired session token' });
        socket.disconnect(true);
        return;
      }

      const { roomId, user } = session;
      socket.data.user = user;
      socket.data.roomId = roomId;
      socket.join(roomId);

      logger.info(`[SUCCESS] User ${user.email} joined room: ${roomId}`);

      // Send initial state as binary data (Uint8Array)
      const initialState = getStateUpdate(roomId);
      if (initialState) {
        // Convert to Array for Socket.io transmission
        const stateArray = Array.from(initialState);
        socket.emit('collab:sync', stateArray);
        logger.info(`[SYNC] Sent initial state (${stateArray.length} bytes)`);
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
        
        logger.info(`[PEERS] Sent ${existingPeers.length} existing peers to new user`);
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
          
          logger.debug(`[BROADCAST] Update broadcast to room ${roomId}`);
        } catch (error) {
          logger.error('Failed to process update:', error);
          socket.emit('collab:error', { code: 'UPDATE_FAILED', message: 'Failed to process update' });
        }
      });

      socket.on('collab:awareness', (payload) => {
        socket.to(roomId).emit('collab:awareness', { user, payload });
      });

      socket.on('disconnect', (reason) => {
        logger.info(`[DISCONNECT] User ${user.email} left room ${roomId} (${reason})`);
        socket.to(roomId).emit('collab:presence', { type: 'leave', user });
      });

      socket.on('error', (error) => {
        logger.error('Socket error:', error);
      });
    });

    logger.info('[SUCCESS] Realtime collaboration server ready');

    return io;
  };

  /**
   * Closes the Socket.io server and cleans up all rooms
   */
  const close = async () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }

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



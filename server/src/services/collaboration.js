'use strict';

const { randomUUID } = require('node:crypto');
const { Server } = require('socket.io');
const Y = require('yjs');
const { errors } = require('@strapi/utils');
const { createLogger } = require('../utils/logger');
const { getTokenKey, signToken, verifyToken } = require('../utils/crypto');
const { cleanEditorValue } = require('../utils/sanitizer');
const { createSeedUpdate, docToEditorData } = require('../../../shared/ydoc.mjs');

/**
 * Live collaboration for Magic Editor X fields (Socket.IO + Yjs).
 *
 * Works with several Node processes behind a load balancer without sticky
 * sessions:
 * - the browser uses the WebSocket transport only (one HTTP request per
 *   connection, so no sticky routing is needed);
 * - session tokens are HMAC-signed with a key every process derives from the
 *   shared admin JWT secret, and their nonce is consumed once in the database;
 * - every Yjs update is written to `magic_editor_x_collab_updates` before it
 *   is acknowledged or relayed; other processes pick it up by polling the
 *   table (`collaboration.pollIntervalMs`) and relay it to their sockets;
 * - presence lives in `magic_editor_x_collab_presence` with heartbeats;
 * - clients resync with their state vector on (re)connect and every 20 s, so
 *   a restart of any process loses nothing that was acknowledged;
 * - automatic snapshots and compaction run under database leases, so each
 *   happens exactly once across the cluster.
 *
 * Access is checked with the Content Manager permission checker when the
 * session is created and again every few minutes for open sockets. Viewers
 * (read but no update permission) receive updates but cannot send any.
 */

const PROCESS_ID = randomUUID();
const PRESENCE_TTL_MS = 30000;
const HEARTBEAT_MS = 10000;
const REVALIDATE_MS = 5 * 60 * 1000;
const RESEND_WINDOW_MS = 5000;
const COMPACT_THRESHOLD = 200;
const MAX_ROOM_BYTES = 64 * 1024 * 1024;
const COLORS = ['#4945ff', '#d02b20', '#328048', '#ac5e00', '#0c75af', '#8312d1', '#b72b1a', '#2f6846'];

/**
 * Picks a stable presence colour for an admin.
 * @param {number} userId - Admin id.
 * @returns {string} Colour token value.
 */
const colorFor = (userId) => COLORS[Math.abs(Number(userId) || 0) % COLORS.length];

/**
 * Display name for presence (first name and initial of the last name).
 * @param {object} user - Admin user.
 * @returns {string} Name.
 */
const displayName = (user) => {
  const first = (user.firstname || '').trim();
  const last = (user.lastname || '').trim();
  const name = [first, last ? `${last[0]}.` : ''].filter(Boolean).join(' ');
  return (name || user.username || 'Admin').slice(0, 80);
};

/**
 * Converts socket payloads (Buffer, ArrayBuffer, typed array, number array) to bytes.
 * @param {unknown} payload - Payload.
 * @param {number} maxBytes - Size limit.
 * @returns {Uint8Array|null} Bytes or null when invalid.
 */
const toBytes = (payload, maxBytes) => {
  let bytes = null;
  if (payload instanceof Uint8Array) bytes = payload;
  else if (payload instanceof ArrayBuffer) bytes = new Uint8Array(payload);
  else if (
    Array.isArray(payload) &&
    payload.length <= maxBytes &&
    payload.every((n) => Number.isInteger(n) && n >= 0 && n < 256)
  ) {
    bytes = Uint8Array.from(payload);
  }
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
  return bytes;
};

/**
 * Checks that bytes decode as a Yjs update.
 * @param {Uint8Array} update - Update.
 * @returns {boolean} Valid or not.
 */
const isValidUpdate = (update) => {
  try {
    Y.decodeUpdate(update);
    return true;
  } catch {
    return false;
  }
};

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.collaboration.${key}`);
    return value === undefined ? fallback : value;
  };
  const store = () => strapi.plugin('magic-editor-x').service('store');
  const access = () => strapi.plugin('magic-editor-x').service('access');
  const history = () => strapi.plugin('magic-editor-x').service('history');

  /** @type {Server|null} */
  let io = null;
  const timers = [];
  /** room -> { sockets: Set, seen: Map<id, at>, watermark: number, presenceHash: string, lastSnapshotBucket: number } */
  const rooms = new Map();
  let polling = false;

  const roomState = (room) => {
    let state = rooms.get(room);
    if (!state) {
      state = { sockets: new Set(), seen: new Map(), watermark: 0, presenceHash: '', target: null };
      rooms.set(room, state);
    }
    return state;
  };

  /**
   * Merges all stored updates of a room.
   * @param {string} room - Room key.
   * @returns {Promise<{ update: Uint8Array, lastId: number, count: number }>} Merged state.
   */
  const loadRoom = async (room) => {
    const rows = await store().readRoom(room);
    const update = rows.length ? Y.mergeUpdates(rows.map((row) => row.update)) : new Uint8Array([0, 0]);
    return {
      update,
      lastId: rows.length ? rows[rows.length - 1].id : 0,
      count: rows.length,
      ids: rows.map((row) => row.id),
    };
  };

  /**
   * Materialises the room as Editor.js data.
   * @param {Uint8Array} update - Merged update.
   * @returns {object} Editor data.
   */
  const materialize = (update) => {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, update);
      return docToEditorData(doc);
    } finally {
      doc.destroy();
    }
  };

  /**
   * Creates the seed row of a new room exactly once across the cluster.
   * @param {string} room - Room key.
   * @param {object|null} content - Clean editor data from the session creator.
   * @param {number} ttlMs - Lease length (room lifetime).
   * @returns {Promise<void>}
   */
  const ensureSeed = async (room, loadContent, ttlMs) => {
    const stats = await store().roomStats(room);
    if (stats.count > 0) return false;
    const seedKey = `seed:${room}`.slice(0, 255);
    if (await store().acquire(seedKey, PROCESS_ID, ttlMs)) {
      const again = await store().roomStats(room);
      if (again.count === 0) {
        const content = await loadContent();
        await store().appendUpdate(
          room,
          createSeedUpdate(content || { time: Date.now(), blocks: [], version: '2.31.7' }),
          'seed'
        );
        return true;
      }
      return false;
    }
    // Another process is seeding; wait briefly for its row.
    for (let i = 0; i < 40; i += 1) {
      if ((await store().roomStats(room)).count > 0) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };

  /**
   * Reads the stored (draft) value of a field, following component and
   * dynamic-zone paths such as `sections.0.body`.
   * @param {{ uid: string, documentId: string, locale: string|null, field: string }} target - Field.
   * @returns {Promise<unknown>} Stored value or undefined.
   */
  const readStoredValue = async (target) => {
    const parts = target.field.split('.');
    const top = parts[0];
    const contentType = strapi.contentType(target.uid);
    const attribute = contentType && contentType.attributes[top];
    const populate = attribute && ['component', 'dynamiczone'].includes(attribute.type) ? { [top]: true } : undefined;
    const document = await strapi.documents(target.uid).findOne({
      documentId: target.documentId,
      locale: target.locale || undefined,
      status: 'draft',
      ...(populate ? { populate } : {}),
    });
    let value = document;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = value[/^\d+$/.test(part) ? Number(part) : part];
    }
    return value;
  };

  /**
   * Sends presence of a room to its local sockets when it changed.
   * @param {string} room - Room key.
   * @param {Array<object>} rows - Presence rows of the room.
   */
  const emitPresence = (room, rows) => {
    const state = rooms.get(room);
    if (!state || !io) return;
    const peers = rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        canEdit: Boolean(row.can_edit),
        cursor: (() => {
          try {
            return row.cursor ? JSON.parse(row.cursor) : null;
          } catch {
            return null;
          }
        })(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const hash = JSON.stringify(peers);
    if (hash === state.presenceHash) return;
    state.presenceHash = hash;
    io.to(room).emit('mx:presence', peers);
  };

  /**
   * One polling tick: relay updates written by other processes and refresh presence.
   * @returns {Promise<void>}
   */
  const poll = async () => {
    if (polling || rooms.size === 0) return;
    polling = true;
    try {
      const names = Array.from(rooms.keys());
      const now = Date.now();
      const after = Math.min(...names.map((room) => rooms.get(room).watermark));
      const rows = await store().readSince(names, after, 2000);
      for (const row of rows) {
        const state = rooms.get(row.room);
        if (!state || row.id <= state.watermark) continue;
        if (!state.seen.has(row.id)) {
          state.seen.set(row.id, now);
          if (row.kind !== 'compact') io.to(row.room).emit('mx:update', row.update);
        }
      }
      for (const state of rooms.values()) {
        for (const [id, at] of state.seen) {
          if (now - at > RESEND_WINDOW_MS) {
            state.watermark = Math.max(state.watermark, id);
            state.seen.delete(id);
          }
        }
      }
      const presence = await store().listPresence(names, now - PRESENCE_TTL_MS);
      for (const room of names)
        emitPresence(
          room,
          presence.filter((row) => row.room === room)
        );
    } catch (error) {
      logger.warn('collaboration poll failed', { code: error && error.code, name: error && error.name });
    } finally {
      polling = false;
    }
  };

  /**
   * Compacts a room when it has many rows (under a lease).
   * @param {string} room - Room key.
   * @returns {Promise<void>}
   */
  const maybeCompact = async (room) => {
    const stats = await store().roomStats(room);
    if (stats.count < COMPACT_THRESHOLD) return;
    const key = `compact:${room}`.slice(0, 255);
    if (!(await store().acquire(key, PROCESS_ID, 30000))) return;
    try {
      const { update, ids } = await loadRoom(room);
      await store().replaceRows(room, ids, update);
    } finally {
      await store().release(key, PROCESS_ID);
    }
  };

  /**
   * Creates an automatic snapshot of a room once per room and key.
   * @param {string} room - Room key.
   * @param {string} bucketKey - Exactly-once key (time bucket or session end).
   * @returns {Promise<boolean>} True when this process created it.
   */
  const autoSnapshot = async (room, bucketKey) => {
    const state = rooms.get(room);
    const target = state && state.target;
    if (!target) return false;
    const key = `snap:${room}:${bucketKey}`.slice(0, 255);
    if (!(await store().acquire(key, PROCESS_ID, 24 * 60 * 60 * 1000))) return false;
    const { update, count } = await loadRoom(room);
    if (count === 0) return false;
    const result = await history().create(target, materialize(update), { trigger: 'auto', userId: null });
    return result.created;
  };

  const snapshotTick = async () => {
    const minutes = Number(conf('snapshotIntervalMinutes', 10));
    if (!minutes) return;
    const bucket = Math.floor(Date.now() / (minutes * 60000));
    for (const [room, state] of rooms) {
      if (state.sockets.size === 0 || state.lastBucket === bucket) continue;
      state.lastBucket = bucket;
      try {
        const stats = await store().roomStats(room);
        if (stats.lastAt > Date.now() - minutes * 60000) await autoSnapshot(room, `t${bucket}`);
      } catch (error) {
        logger.warn('automatic snapshot failed', { code: error && error.code, name: error && error.name });
      }
    }
  };

  const maintenanceTick = async () => {
    try {
      const ids = [];
      for (const state of rooms.values())
        for (const socket of state.sockets) ids.push(socket.data.presenceId);
      await store().touchPresence(ids);
      if (await store().acquire('maintenance', PROCESS_ID, 55000)) {
        await store().prunePresence(Date.now() - PRESENCE_TTL_MS * 2);
        await store().pruneLocks();
        const ttl = Number(conf('roomTtlMinutes', 30)) * 60000;
        for (const room of await store().staleRooms(Date.now() - ttl)) {
          if (!(await store().hasPresence(room, Date.now() - PRESENCE_TTL_MS)))
            await store().deleteRoom(room);
        }
      }
    } catch (error) {
      logger.warn('collaboration maintenance failed', {
        code: error && error.code,
        name: error && error.name,
      });
    }
  };

  /**
   * Re-checks access of every open socket and updates or ends sessions.
   * @returns {Promise<void>}
   */
  const revalidate = async () => {
    for (const state of rooms.values()) {
      for (const socket of state.sockets) {
        try {
          const ability = await access().abilityForUser(socket.data.userId);
          if (!ability) throw new errors.NotFoundError('gone');
          const result = await access().checkField({ userAbility: ability, ...socket.data.target });
          if (result.canUpdate !== socket.data.canEdit) {
            socket.data.canEdit = result.canUpdate;
            socket.emit('mx:role', { canEdit: result.canUpdate });
          }
        } catch {
          socket.emit('mx:error', { code: 'ACCESS_REVOKED' });
          socket.disconnect(true);
        }
      }
    }
  };

  /**
   * Origin check for the WebSocket upgrade. Browsers always send Origin; it
   * must be the admin or server URL or a configured extra origin. Requests
   * without Origin (server-side clients) still need a valid signed token.
   * @param {import('http').IncomingMessage} req - Upgrade request.
   * @returns {boolean} Allowed or not.
   */
  const originAllowed = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    const allowed = new Set();
    for (const value of [
      strapi.config.get('server.absoluteUrl'),
      strapi.config.get('admin.absoluteUrl'),
      strapi.config.get('server.url'),
    ]) {
      try {
        if (value) allowed.add(new URL(value).origin);
      } catch {
        // ignore malformed URLs in host config
      }
    }
    for (const value of conf('allowedOrigins', []) || []) allowed.add(String(value).replace(/\/+$/, ''));
    return allowed.has(origin);
  };

  /**
   * Handles one authenticated socket.
   * @param {import('socket.io').Socket} socket - Socket.
   * @returns {Promise<void>}
   */
  const onConnection = async (socket) => {
    const maxBytes = Number(conf('maxMessageBytes', 2 * 1024 * 1024));
    const claims = verifyToken(socket.handshake.auth && socket.handshake.auth.token, getTokenKey(strapi));
    if (!claims || typeof claims.nonce !== 'string') {
      socket.emit('mx:error', { code: 'INVALID_TOKEN' });
      socket.disconnect(true);
      return;
    }
    const fresh = await store().acquire(
      `tok:${claims.nonce}`,
      PROCESS_ID,
      Math.max(1000, claims.exp - Date.now() + 60000)
    );
    if (!fresh) {
      socket.emit('mx:error', { code: 'INVALID_TOKEN' });
      socket.disconnect(true);
      return;
    }
    const room = claims.room;
    socket.data.userId = claims.userId;
    socket.data.canEdit = claims.canEdit === true;
    socket.data.target = claims.target;
    socket.data.presenceId = randomUUID();
    const state = roomState(room);
    state.target = claims.target;
    await socket.join(room);
    state.sockets.add(socket);

    const sendSync = async (clientVector) => {
      const { update, lastId } = await loadRoom(room);
      if (state.watermark === 0) state.watermark = lastId;
      let payload = update;
      if (clientVector) {
        try {
          payload = Y.diffUpdate(update, clientVector);
        } catch {
          payload = update;
        }
      }
      socket.emit('mx:sync', { update: payload, stateVector: Y.encodeStateVectorFromUpdate(update) });
    };

    await store().upsertPresence({
      id: socket.data.presenceId,
      room,
      userId: claims.userId,
      name: claims.name,
      color: claims.color,
      canEdit: socket.data.canEdit,
    });
    socket.emit('mx:welcome', {
      canEdit: socket.data.canEdit,
      presenceId: socket.data.presenceId,
      color: claims.color,
    });
    await sendSync(null);
    poll();

    socket.on('mx:update', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!socket.data.canEdit) return reply({ ok: false, code: 'READ_ONLY' });
      const update = toBytes(payload, maxBytes);
      if (!update || !isValidUpdate(update)) return reply({ ok: false, code: 'INVALID_UPDATE' });
      try {
        const stats = await store().roomStats(room);
        if (stats.bytes + update.byteLength > MAX_ROOM_BYTES) return reply({ ok: false, code: 'ROOM_FULL' });
        const id = await store().appendUpdate(room, update, 'update');
        state.seen.set(id, Date.now());
        socket.to(room).emit('mx:update', update);
        reply({ ok: true, id });
        if (stats.count + 1 >= COMPACT_THRESHOLD) maybeCompact(room).catch(() => {});
      } catch (error) {
        logger.warn('collaboration update could not be stored', {
          code: error && error.code,
          name: error && error.name,
        });
        reply({ ok: false, code: 'STORE_FAILED' });
      }
      return undefined;
    });

    socket.on('mx:resync', async (payload) => {
      const vector = toBytes(payload, 64 * 1024);
      try {
        await sendSync(vector);
      } catch (error) {
        logger.warn('collaboration resync failed', { code: error && error.code, name: error && error.name });
      }
    });

    let lastCursorAt = 0;
    socket.on('mx:cursor', async (cursor) => {
      const now = Date.now();
      if (now - lastCursorAt < 150) return;
      lastCursorAt = now;
      const clean =
        cursor &&
        typeof cursor === 'object' &&
        typeof cursor.blockId === 'string' &&
        cursor.blockId.length <= 64
          ? {
              blockId: cursor.blockId,
              offset:
                Number.isInteger(cursor.offset) && cursor.offset >= 0 ? Math.min(cursor.offset, 1e7) : 0,
            }
          : null;
      try {
        await store().upsertPresence({
          id: socket.data.presenceId,
          room,
          userId: claims.userId,
          name: claims.name,
          color: claims.color,
          canEdit: socket.data.canEdit,
          cursor: clean,
        });
        poll();
      } catch {
        // presence is best effort
      }
    });

    socket.on('disconnect', async () => {
      state.sockets.delete(socket);
      try {
        await store().removePresence(socket.data.presenceId);
        if (state.sockets.size === 0) {
          const stats = await store().roomStats(room);
          await autoSnapshot(room, `end${stats.lastId}`).catch(() => false);
          rooms.delete(room);
        }
        poll();
      } catch {
        // cleanup is best effort; heartbeats expire
      }
    });
  };

  return {
    PROCESS_ID,

    /**
     * Issues a one-time session token for a field after checking access.
     * @param {{ userAbility: object, user: object, uid: string, documentId: string, locale?: string|null, field: string, initialValue?: unknown }} input - Request.
     * @returns {Promise<object>} Token and connection details.
     * @throws {errors.NotFoundError|errors.ForbiddenError} When access is denied or collaboration is off.
     */
    async createSession({ userAbility, user, uid, documentId, locale, field, initialValue }) {
      if (conf('enabled', true) === false || !io)
        throw new errors.ForbiddenError('Live collaboration is disabled');
      const result = await access().checkField({ userAbility, uid, documentId, locale, field });
      const target = { uid, documentId, locale: result.locale, field };
      const room = history().fieldKey(target);
      const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
      // New rooms start from the stored draft. The value the browser sends is
      // only used when nothing is stored yet and the caller may edit.
      const seeded = await ensureSeed(
        room,
        async () => {
          let stored;
          try {
            stored = cleanEditorValue(await readStoredValue(target), { rawHtml });
          } catch {
            stored = null;
          }
          if (stored || !result.canUpdate) return stored;
          try {
            return cleanEditorValue(initialValue, { rawHtml });
          } catch {
            return null;
          }
        },
        Number(conf('roomTtlMinutes', 30)) * 60000
      );
      const ttl = Number(conf('tokenTtlSeconds', 60)) * 1000;
      const claims = {
        room,
        target,
        userId: user.id,
        name: displayName(user),
        color: colorFor(user.id),
        canEdit: result.canUpdate,
        nonce: randomUUID(),
        exp: Date.now() + ttl,
      };
      return {
        token: signToken(claims, getTokenKey(strapi)),
        path: conf('path', '/magic-editor-x/realtime'),
        canEdit: result.canUpdate,
        seeded,
        expiresAt: claims.exp,
      };
    },

    /**
     * Starts the Socket.IO server on Strapi's HTTP server and the background ticks.
     * @returns {Promise<void>}
     */
    async start() {
      if (io || conf('enabled', true) === false) return;
      const httpServer = strapi.server && strapi.server.httpServer;
      if (!httpServer) {
        logger.warn('HTTP server not available; live collaboration is off');
        return;
      }
      await store().init();
      io = new Server(httpServer, {
        path: conf('path', '/magic-editor-x/realtime'),
        transports: ['websocket'],
        serveClient: false,
        maxHttpBufferSize: Number(conf('maxMessageBytes', 2 * 1024 * 1024)),
        allowRequest: (req, callback) => callback(null, originAllowed(req)),
        pingInterval: 20000,
        pingTimeout: 20000,
        cors: { origin: false },
      });
      io.on('connection', (socket) => {
        onConnection(socket).catch((error) => {
          logger.warn('collaboration connection failed', {
            code: error && error.code,
            name: error && error.name,
          });
          socket.disconnect(true);
        });
      });
      const every = (fn, ms) => {
        const timer = setInterval(() => {
          Promise.resolve(fn()).catch(() => {});
        }, ms);
        if (typeof timer.unref === 'function') timer.unref();
        timers.push(timer);
      };
      every(poll, Math.max(50, Number(conf('pollIntervalMs', 400))));
      every(maintenanceTick, HEARTBEAT_MS);
      every(snapshotTick, 30000);
      every(revalidate, REVALIDATE_MS);
    },

    /**
     * Stops timers and closes sockets (process shutdown).
     * @returns {Promise<void>}
     */
    async stop() {
      timers.splice(0).forEach((timer) => clearInterval(timer));
      if (io) {
        const sockets = [];
        for (const state of rooms.values()) sockets.push(...state.sockets);
        await Promise.all(
          sockets.map((socket) =>
            store()
              .removePresence(socket.data.presenceId)
              .catch(() => {})
          )
        );
        await new Promise((resolve) => io.close(() => resolve()));
        io = null;
      }
      rooms.clear();
    },

    /** True when the socket server runs in this process. */
    isRunning() {
      return Boolean(io);
    },

    /** Test hook: runs one poll tick. */
    pollNow: poll,
  };
};

module.exports.toBytes = toBytes;
module.exports.displayName = displayName;

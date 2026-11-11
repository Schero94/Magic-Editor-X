'use strict';

const { randomUUID } = require('node:crypto');
const { Server } = require('socket.io');
const Y = require('yjs');
const { errors } = require('@strapi/utils');
const { createLogger } = require('../utils/logger');
const { getTokenKey, signToken, verifyToken } = require('../utils/crypto');
const { cleanEditorValue } = require('../utils/sanitizer');
const { createRateLimiter } = require('../utils/rate-limit');
const {
  createSeedUpdate,
  docToEditorData,
  epochOf,
  getTypes,
  stableStringify,
} = require('../../../shared/ydoc.mjs');
const { applyCheckedUpdate } = require('../../../shared/ydoc-guard.mjs');
const { resolveFieldPreset, checkBlockStructure } = require('../../../shared/presets.mjs');
const { resolveEditorField } = require('../utils/editor-fields');

/**
 * Live collaboration for Magic Editor X fields (Socket.IO + Yjs, protocol 3).
 *
 * Works with several Node processes behind a load balancer without sticky
 * sessions:
 * - the browser uses the WebSocket transport only (one HTTP request per
 *   connection, so no sticky routing is needed);
 * - session tokens are HMAC-signed with a key every process derives from the
 *   shared admin JWT secret, bound to admin, document, locale and field, and
 *   their nonce is consumed once in the database;
 * - every process keeps an in-memory Yjs document per active room. An update
 *   is checked (structure, dependencies, resulting blocks), written to
 *   `magic_editor_x_collab_updates` and only then acknowledged and relayed;
 *   other processes poll the table and relay what they did not write;
 * - presence lives in `magic_editor_x_collab_presence` with heartbeats; names
 *   and colours come from the signed token, never from the client;
 * - clients resync with their state vector on (re)connect and every 20 s, so
 *   a restart of any process loses nothing that was acknowledged;
 * - automatic versions, compaction and room clean-up run under database
 *   leases, so each happens exactly once across the cluster; a room that is
 *   cleaned up with edits nobody saved gets a final version first;
 * - permission changes (roles, permissions, users) raise a cluster-wide
 *   signal; every process re-checks its sockets within about a second.
 */

const PROTOCOL = 3;
const PROCESS_ID = randomUUID();
const PRESENCE_TTL_MS = 30000;
const HEARTBEAT_MS = 10000;
const SIGNAL_CHECK_MS = 1000;
const RESEND_WINDOW_MS = 5000;
const COMPACT_THRESHOLD = 200;
const MAX_ROOM_BYTES = 64 * 1024 * 1024;
const MAX_INVALID_UPDATES = 5;
const MAX_RETIRED_CLIENTS = 10000;
/** Design System colour families for presence; the admin resolves them per theme. */
const COLORS = ['primary', 'danger', 'success', 'warning', 'secondary', 'alternative'];

/**
 * Picks a stable presence colour for an admin.
 * @param {number} userId - Admin id.
 * @returns {string} Colour family name.
 */
const colorFor = (userId) => COLORS[Math.abs(Number(userId) || 0) % COLORS.length];

/**
 * Display name for presence: first name and initial of the last name.
 * Never an e-mail address.
 * @param {object} user - Admin user.
 * @returns {string} Name.
 */
const displayName = (user) => {
  const first = String(user.firstname || '').trim();
  const last = String(user.lastname || '').trim();
  const name = [first, last ? `${last[0]}.` : ''].filter(Boolean).join(' ');
  const username = String(user.username || '').trim();
  return (name || (username && !username.includes('@') ? username : '') || 'Admin').slice(0, 80);
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
 * Validates a presence payload from a client.
 * @param {unknown} cursor - Payload.
 * @returns {{ blockId?: string, anchor?: number, focus?: number, idle: boolean } | null} Clean cursor.
 */
const cleanCursor = (cursor) => {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
  const idle = cursor.idle === true;
  const offset = (value) => (Number.isInteger(value) && value >= 0 ? Math.min(value, 1e7) : 0);
  if (typeof cursor.blockId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(cursor.blockId)) {
    const anchor = offset(cursor.anchor ?? cursor.offset);
    return {
      blockId: cursor.blockId,
      anchor,
      focus: cursor.focus === undefined ? anchor : offset(cursor.focus),
      idle,
    };
  }
  return { idle };
};

/**
 * True when an update writes or deletes items of clients that belong to an
 * older room generation (such updates are answered RETRY; the client moves
 * to the new generation and re-applies its edit there).
 * @param {Uint8Array} update - Yjs update.
 * @param {Set<number>} retired - Client ids of older generations.
 * @returns {boolean} Result.
 */
const touchesRetiredClients = (update, retired) => {
  if (!retired || retired.size === 0) return false;
  try {
    const decoded = Y.decodeUpdate(update);
    if (decoded.structs.some((struct) => retired.has(struct.id.client))) return true;
    for (const client of decoded.ds.clients.keys()) if (retired.has(client)) return true;
    return false;
  } catch {
    return false;
  }
};

/**
 * Parses a room key back into its field target.
 * @param {string} room - `<uid>|<documentId>|<locale or ->|<field>`.
 * @returns {{ uid: string, documentId: string, locale: string|null, field: string } | null} Target.
 */
const targetOfRoom = (room) => {
  const parts = String(room).split('|');
  if (parts.length !== 4) return null;
  return { uid: parts[0], documentId: parts[1], locale: parts[2] === '-' ? null : parts[2], field: parts[3] };
};

/**
 * Error for the Socket.IO middleware; the client reads `data.code`.
 * @param {string} code - Reason.
 * @returns {Error} Error.
 */
const handshakeError = (code) => {
  const error = new Error(code);
  error.data = { code };
  return error;
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

  /**
   * Field preset of a room target (custom field options of its attribute).
   * @param {{ uid: string, field: string }} target - Room target.
   * @returns {import('../../../shared/presets.mjs').FieldPreset} Preset (full when the field cannot be resolved).
   */
  const presetOf = (target) => {
    let options;
    try {
      const contentType = target && strapi.contentType(target.uid);
      const resolved = contentType ? resolveEditorField(strapi, contentType, target.field) : null;
      options = resolved && resolved.attribute && resolved.attribute.options;
    } catch {
      options = undefined;
    }
    return resolveFieldPreset(options);
  };

  /**
   * Structural preset rule applied to every block a realtime update touches
   * (allowed block types, heading levels, link targets). Limits and alternative
   * texts are checked on save only, so typing is never refused half-way.
   * @param {{ uid: string, field: string }} target - Room target.
   * @returns {((block: object) => string|null) | undefined} Rule, or undefined for unrestricted fields.
   */
  const blockRuleFor = (target) => {
    const preset = presetOf(target);
    if (!preset.restricted) return undefined;
    return (block) => (checkBlockStructure(preset, block) ? 'PRESET_VIOLATION' : null);
  };

  /** @type {Server|null} */
  let io = null;
  const timers = [];
  /** room -> { sockets, seen: Map<rowId, at>, watermark, presenceHash, target, doc, loading, lastBucket } */
  const rooms = new Map();
  let polling = false;
  let permissionSignal = null;
  let revalidating = null;
  const sessionLimiter = createRateLimiter({ max: 60, windowMs: 60000 });

  const roomState = (room) => {
    let state = rooms.get(room);
    if (!state) {
      state = {
        sockets: new Set(),
        seen: new Map(),
        watermark: 0,
        presenceHash: '',
        target: null,
        doc: null,
        loading: null,
      };
      rooms.set(room, state);
    }
    return state;
  };

  /**
   * Merges all stored updates of a room.
   * @param {string} room - Room key.
   * @returns {Promise<{ update: Uint8Array, lastId: number, count: number, ids: number[] }>} Merged state.
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
   * Materialises a merged update as Editor.js data.
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
   * Loads the in-memory document of a room from the database (once; shared by
   * concurrent callers). Rows near the end are marked as seen but stay above
   * the watermark, so a row that commits late is still picked up by the poller.
   * @param {string} room - Room key.
   * @returns {Promise<Y.Doc>} Document.
   */
  const ensureDoc = async (room) => {
    const state = roomState(room);
    if (state.doc) return state.doc;
    if (!state.loading) {
      state.loading = (async () => {
        const rows = await store().readRoom(room);
        const doc = new Y.Doc({ gc: true });
        getTypes(doc);
        for (const row of rows) {
          try {
            Y.applyUpdate(doc, row.update);
          } catch {
            // a damaged row is skipped; the rest of the room stays usable
          }
        }
        const now = Date.now();
        const settled = rows.filter((row) => (row.createdAt || 0) < now - RESEND_WINDOW_MS);
        state.watermark = Math.max(state.watermark, settled.length ? settled[settled.length - 1].id : 0);
        for (const row of rows) if (row.id > state.watermark) state.seen.set(row.id, now);
        if (state.doc) state.doc.destroy();
        state.doc = doc;
        state.loadedAt = now;
        if (rows.length) await store().ensureGeneration(room, epochOf(doc));
        return doc;
      })().finally(() => {
        state.loading = null;
      });
    }
    return state.loading;
  };

  /**
   * Throws away the in-memory document of a room (rebuilt from the database on next use).
   * @param {string} room - Room key.
   */
  const dropDoc = (room) => {
    const state = rooms.get(room);
    if (state && state.doc) {
      state.doc.destroy();
      state.doc = null;
    }
  };

  /**
   * Creates the seed row of a new room exactly once across the cluster.
   * Every seed carries a new epoch (room generation).
   * @param {string} room - Room key.
   * @param {() => Promise<object|null>} loadContent - Clean content for the seed.
   * @param {number} ttlMs - Lease length (room lifetime).
   * @returns {Promise<boolean>} True when this call created the seed.
   */
  const ensureSeed = async (room, loadContent, ttlMs) => {
    const stats = await store().roomStats(room);
    if (stats.count > 0) return false;
    const seedKey = `seed:${room}`.slice(0, 255);
    if (await store().acquire(seedKey, PROCESS_ID, ttlMs)) {
      const again = await store().roomStats(room);
      if (again.count === 0) {
        const content = await loadContent();
        const epoch = randomUUID();
        await store().deleteGeneration(room);
        await store().appendUpdate(
          room,
          createSeedUpdate(content || { time: Date.now(), blocks: [], version: '2.31.7' }, epoch),
          'seed'
        );
        await store().ensureGeneration(room, epoch);
        return true;
      }
      return false;
    }
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
    const populate =
      attribute && ['component', 'dynamiczone'].includes(attribute.type) ? { [top]: true } : undefined;
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
   * Only display name, colour, role, idle state and caret leave the server.
   * @param {string} room - Room key.
   * @param {Array<object>} rows - Presence rows of the room.
   */
  const emitPresence = (room, rows) => {
    const state = rooms.get(room);
    if (!state || !io) return;
    const peers = rows
      .map((row) => {
        let cursor;
        try {
          cursor = row.cursor ? cleanCursor(JSON.parse(row.cursor)) : null;
        } catch {
          cursor = null;
        }
        return {
          id: row.id,
          name: row.name,
          color: row.color,
          canEdit: Boolean(row.can_edit),
          idle: Boolean(cursor && cursor.idle),
          cursor:
            cursor && cursor.blockId
              ? { blockId: cursor.blockId, anchor: cursor.anchor, focus: cursor.focus }
              : null,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const hash = JSON.stringify(peers);
    if (hash === state.presenceHash) return;
    state.presenceHash = hash;
    io.to(room).emit('mx:presence', peers);
  };

  /**
   * Ends every socket of a room so clients reconnect (room replaced).
   * @param {string} room - Room key.
   * @param {string} code - Reason sent to the clients.
   */
  const resetRoom = (room, code) => {
    const state = rooms.get(room);
    if (!state) return;
    dropDoc(room);
    for (const socket of Array.from(state.sockets)) {
      socket.emit('mx:error', { code });
      socket.disconnect(true);
    }
  };

  /**
   * Moves a room to the generation stored in the database (after a
   * compaction or a re-seed): the old in-memory document is dropped (its
   * memory is freed), the new one is loaded and every local socket gets the
   * full new state with its epoch. Clients keep their connection; they see
   * the new epoch, start over with fresh documents and re-apply edits that
   * were never acknowledged. When loading fails, the sockets are reset.
   * @param {string} room - Room key.
   * @returns {Promise<void>}
   */
  const switchGeneration = async (room) => {
    const state = rooms.get(room);
    if (!state) return;
    if (state.switching) return state.switching;
    state.switching = (async () => {
      if (state.doc) {
        // Updates from clients of the old generation are never merged into the new one.
        const retired = state.retired || new Set();
        for (const client of Y.decodeStateVector(Y.encodeStateVector(state.doc)).keys()) {
          if (retired.size >= MAX_RETIRED_CLIENTS) break;
          retired.add(client);
        }
        state.retired = retired;
      }
      dropDoc(room);
      try {
        const doc = await ensureDoc(room);
        const payload = {
          update: Y.encodeStateAsUpdate(doc),
          stateVector: Y.encodeStateVector(doc),
          epoch: epochOf(doc),
        };
        for (const socket of state.sockets) socket.emit('mx:sync', payload);
      } catch (error) {
        logger.warn('room generation switch failed', {
          code: error && error.code,
          name: error && error.name,
        });
        resetRoom(room, 'ROOM_RESET');
      }
    })().finally(() => {
      state.switching = null;
    });
    return state.switching;
  };

  /**
   * One polling tick: relay updates written by other processes, keep the
   * in-memory documents current and refresh presence.
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
        if (!state || row.id <= state.watermark || state.seen.has(row.id)) continue;
        state.seen.set(row.id, now);
        if (row.kind === 'seed') {
          // A seed is a whole room generation: it is never relayed as an update.
          // A new epoch (compaction or a room that was cleaned up and seeded
          // again) moves the room and its sockets to the new generation.
          let next = true;
          if (state.doc) {
            const probe = new Y.Doc();
            try {
              Y.applyUpdate(probe, row.update);
              next = epochOf(probe) !== epochOf(state.doc);
            } catch {
              next = true;
            } finally {
              probe.destroy();
            }
          }
          if (next && (state.doc || state.sockets.size > 0)) await switchGeneration(row.room);
          continue;
        }
        if (state.doc) {
          try {
            Y.applyUpdate(state.doc, row.update, 'relay');
          } catch {
            dropDoc(row.room);
          }
        }
        if (row.kind !== 'compact') io.to(row.room).emit('mx:update', row.update);
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
   * Rebuilds a long-lived room as a new generation when it is idle and its
   * Yjs state is much larger than a fresh copy of the same content (Yjs keeps
   * metadata of every deleted character for as long as a document lives).
   * Runs under the room's compaction lease and succeeds at most once per
   * generation across the cluster (`replaceGeneration` checks the epoch and
   * that nothing was written meanwhile).
   * @param {string} room - Room key.
   * @param {{ idleMs: number, minBytes: number, ratio: number, force?: boolean }} limits - Thresholds (`force` skips the size checks, tests only).
   * @returns {Promise<{ compacted: boolean, before?: number, after?: number }>} Result.
   */
  const compactGeneration = async (room, limits) => {
    const state = rooms.get(room);
    if (!state || !state.doc || state.switching) return { compacted: false };
    const stats = await store().roomStats(room);
    if (stats.count === 0 || Date.now() - stats.lastAt < limits.idleMs) return { compacted: false };
    if (!limits.force && stats.bytes < limits.minBytes) return { compacted: false };
    const before = Y.encodeStateAsUpdate(state.doc).byteLength;
    if (!limits.force) {
      if (before < limits.minBytes) return { compacted: false };
      const fresh = createSeedUpdate(docToEditorData(state.doc), 'probe').byteLength;
      if (before < fresh * limits.ratio) return { compacted: false };
    }
    const key = `compact:${room}`.slice(0, 255);
    if (!(await store().acquire(key, PROCESS_ID, 60000))) return { compacted: false };
    try {
      const rows = await store().readRoom(room);
      if (rows.length === 0) return { compacted: false };
      const last = rows[rows.length - 1];
      if (Date.now() - Math.max(...rows.map((row) => row.createdAt || 0)) < limits.idleMs)
        return { compacted: false };
      const doc = new Y.Doc();
      let fromEpoch;
      let data;
      try {
        for (const row of rows) {
          try {
            Y.applyUpdate(doc, row.update);
          } catch {
            // a damaged row is skipped, as when the room is loaded
          }
        }
        fromEpoch = epochOf(doc);
        data = docToEditorData(doc);
      } finally {
        doc.destroy();
      }
      const generation = await store().getGeneration(room);
      if (generation !== null && generation !== fromEpoch) return { compacted: false };
      const toEpoch = randomUUID();
      const seed = createSeedUpdate(data, toEpoch);
      const id = await store().replaceGeneration(room, {
        ids: rows.map((row) => row.id),
        lastId: last.id,
        lastAt: Math.max(...rows.map((row) => row.createdAt || 0)),
        fromEpoch,
        toEpoch,
        seed,
      });
      if (!id) return { compacted: false };
      state.seen.set(id, Date.now());
      await switchGeneration(room);
      logger.info('collaboration room compacted', { before, after: seed.byteLength, rows: rows.length });
      return { compacted: true, before, after: seed.byteLength };
    } finally {
      await store()
        .release(key, PROCESS_ID)
        .catch(() => {});
    }
  };

  /** Checks every live room of this process for compaction. */
  const compactionTick = async () => {
    const options = conf('compaction', {}) || {};
    if (options.enabled === false) return;
    const limits = {
      idleMs: Math.max(15, Number(options.idleSeconds) || 60) * 1000,
      minBytes: Number(options.minBytes) || 256 * 1024,
      ratio: Number(options.ratio) || 4,
    };
    for (const [room, state] of Array.from(rooms)) {
      if (state.sockets.size === 0 || !state.doc) continue;
      try {
        await compactGeneration(room, limits);
      } catch (error) {
        logger.warn('collaboration room compaction failed', {
          code: error && error.code,
          name: error && error.name,
        });
      }
    }
  };

  /**
   * Creates an automatic version of a room exactly once per room and key.
   * When creating the version fails, the lease is released so another
   * process (or the next tick) retries.
   * @param {string} room - Room key.
   * @param {string} bucketKey - Exactly-once key (time bucket or session end).
   * @param {{ skipWhenSaved?: boolean }} [options] - Skip content equal to the saved draft.
   * @returns {Promise<boolean>} True when this process created a version.
   * @throws {Error} When the database or history service fails (lease released).
   */
  const autoSnapshot = async (room, bucketKey, options = {}) => {
    const state = rooms.get(room);
    const target = (state && state.target) || targetOfRoom(room);
    if (!target) return false;
    const key = `snap:${room}:${bucketKey}`.slice(0, 255);
    if (!(await store().acquire(key, PROCESS_ID, 24 * 60 * 60 * 1000))) return false;
    try {
      const { update, count } = await loadRoom(room);
      if (count === 0) return false;
      const content = materialize(update);
      if (options.skipWhenSaved) {
        const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
        const clean = (value) => {
          try {
            return cleanEditorValue(value, { rawHtml });
          } catch {
            return null;
          }
        };
        const blocksOf = (value) => stableStringify(value && Array.isArray(value.blocks) ? value.blocks : []);
        let saved = null;
        try {
          saved = clean(await readStoredValue(target));
        } catch {
          saved = null;
        }
        if (blocksOf(saved) === blocksOf(clean(content))) return false;
      }
      const result = await history().create(target, content, { trigger: 'auto', userId: null });
      return result.created;
    } catch (error) {
      await store()
        .release(key, PROCESS_ID)
        .catch(() => {});
      throw error;
    }
  };

  /**
   * Automatic versions per time bucket: when a bucket ends, the room's state
   * is stored once (lease `snap:<room>:t<bucket>`) if it changed during that
   * bucket. Taking the version at the end of the period keeps the last state
   * of it and does not create a version seconds after someone starts typing.
   */
  const snapshotTick = async () => {
    const minutes = Number(conf('snapshotIntervalMinutes', 10));
    if (!minutes) return;
    const length = minutes * 60000;
    const bucket = Math.floor(Date.now() / length);
    for (const [room, state] of rooms) {
      if (state.sockets.size === 0) continue;
      if (state.lastBucket === undefined) {
        state.lastBucket = bucket;
        continue;
      }
      if (state.lastBucket === bucket) continue;
      const previous = bucket - 1;
      try {
        const stats = await store().roomStats(room);
        if (stats.lastAt >= previous * length) await autoSnapshot(room, `t${previous}`);
        state.lastBucket = bucket;
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
        await store().pruneCounters();
        const ttl = Number(conf('roomTtlMinutes', 30)) * 60000;
        for (const room of await store().staleRooms(Date.now() - ttl)) {
          if (await store().hasPresence(room, Date.now() - PRESENCE_TTL_MS)) continue;
          // Edits nobody saved are kept as a version before the room goes away.
          try {
            const stats = await store().roomStats(room);
            await autoSnapshot(room, `end${stats.lastId}`, { skipWhenSaved: true });
          } catch (error) {
            logger.warn('final version before room clean-up failed', {
              code: error && error.code,
              name: error && error.name,
            });
            continue;
          }
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
   * Re-checks access of every open socket and downgrades or ends sessions.
   * Abilities are computed once per admin per run.
   * @returns {Promise<void>}
   */
  const revalidate = async () => {
    if (revalidating) return revalidating;
    revalidating = (async () => {
      const abilities = new Map();
      for (const state of Array.from(rooms.values())) {
        for (const socket of Array.from(state.sockets)) {
          try {
            const userId = socket.data.userId;
            if (!abilities.has(userId)) abilities.set(userId, await access().abilityForUser(userId));
            const ability = abilities.get(userId);
            if (!ability) throw new errors.NotFoundError('gone');
            const result = await access().checkField({ userAbility: ability, ...socket.data.target });
            if (result.canUpdate !== socket.data.canEdit) {
              socket.data.canEdit = result.canUpdate;
              socket.emit('mx:role', { canEdit: result.canUpdate });
              store()
                .upsertPresence({
                  id: socket.data.presenceId,
                  room: socket.data.room,
                  userId,
                  name: socket.data.name,
                  color: socket.data.color,
                  canEdit: result.canUpdate,
                  cursor: socket.data.cursor,
                })
                .catch(() => {});
            }
          } catch {
            socket.emit('mx:error', { code: 'ACCESS_REVOKED' });
            socket.disconnect(true);
          }
        }
      }
    })().finally(() => {
      revalidating = null;
    });
    return revalidating;
  };

  /** Checks the cluster-wide permission signal and re-checks sockets when it changed. */
  const signalTick = async () => {
    try {
      const value = await store().getSignal('permissions');
      const changed = permissionSignal !== null && value !== permissionSignal;
      permissionSignal = value;
      if (changed && rooms.size > 0) await revalidate();
    } catch (error) {
      logger.warn('permission signal check failed', { code: error && error.code, name: error && error.name });
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
   * Handshake: protocol version, token signature and expiry, one-time nonce,
   * per-admin connection and room limits across the cluster.
   * @param {import('socket.io').Socket} socket - Socket.
   * @param {(error?: Error) => void} next - Continue or refuse.
   * @returns {Promise<void>}
   */
  const authenticate = async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      if (auth.protocol !== PROTOCOL) return next(handshakeError('UPGRADE_REQUIRED'));
      const claims = verifyToken(auth.token, getTokenKey(strapi));
      if (!claims || typeof claims.nonce !== 'string' || claims.protocol !== PROTOCOL)
        return next(handshakeError('INVALID_TOKEN'));
      const fresh = await store().acquire(
        `tok:${claims.nonce}`,
        PROCESS_ID,
        Math.max(1000, claims.exp - Date.now() + 60000)
      );
      if (!fresh) return next(handshakeError('INVALID_TOKEN'));
      const usage = await store().presenceOfUser(claims.userId, Date.now() - PRESENCE_TTL_MS);
      if (usage.sockets >= Number(conf('maxConnectionsPerAdmin', 20)))
        return next(handshakeError('TOO_MANY_CONNECTIONS'));
      if (!usage.rooms.has(claims.room) && usage.rooms.size >= Number(conf('maxRoomsPerAdmin', 20)))
        return next(handshakeError('TOO_MANY_CONNECTIONS'));
      socket.data.claims = claims;
      return next();
    } catch (error) {
      logger.warn('collaboration handshake failed', { code: error && error.code, name: error && error.name });
      return next(handshakeError('UNAVAILABLE'));
    }
  };

  /**
   * Handles one authenticated socket.
   * @param {import('socket.io').Socket} socket - Socket.
   * @returns {Promise<void>}
   */
  const onConnection = async (socket) => {
    const maxBytes = Number(conf('maxMessageBytes', 2 * 1024 * 1024));
    const claims = socket.data.claims;
    const room = claims.room;
    socket.data.userId = claims.userId;
    socket.data.canEdit = claims.canEdit === true;
    socket.data.target = claims.target;
    socket.data.blockRule = blockRuleFor(claims.target);
    socket.data.room = room;
    socket.data.name = claims.name;
    socket.data.color = claims.color;
    socket.data.cursor = null;
    socket.data.presenceId = randomUUID();
    const state = roomState(room);
    state.target = claims.target;
    state.sockets.add(socket);
    await socket.join(room);

    // Per-socket limits (a socket lives in exactly one process).
    const rate = conf('rateLimit', {}) || {};
    const updates = createRateLimiter({
      max: Number(rate.updatesPer10s) || 300,
      windowMs: 10000,
      maxKeys: 4,
    });
    const bytesWindow = { start: Date.now(), bytes: 0 };
    const maxBytesPer10s = Number(rate.bytesPer10s) || 8 * 1024 * 1024;
    let invalid = 0;
    let lastResyncAt = 0;
    let lastCursorAt = 0;

    const sendSync = async (clientVector) => {
      const doc = await ensureDoc(room);
      let payload;
      try {
        payload = clientVector ? Y.encodeStateAsUpdate(doc, clientVector) : Y.encodeStateAsUpdate(doc);
      } catch {
        payload = Y.encodeStateAsUpdate(doc);
      }
      socket.emit('mx:sync', { update: payload, stateVector: Y.encodeStateVector(doc), epoch: epochOf(doc) });
    };

    const doc = await ensureDoc(room);
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
      name: claims.name,
      epoch: epochOf(doc),
      protocol: PROTOCOL,
    });
    await sendSync(null);
    poll();

    socket.on('mx:update', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!socket.data.canEdit) return reply({ ok: false, code: 'READ_ONLY' });
      const update = toBytes(payload, maxBytes);
      if (!update) return reply({ ok: false, code: 'INVALID_UPDATE' });
      const now = Date.now();
      if (now - bytesWindow.start > 10000) {
        bytesWindow.start = now;
        bytesWindow.bytes = 0;
      }
      bytesWindow.bytes += update.byteLength;
      if (!updates.hit('u', now).allowed || bytesWindow.bytes > maxBytesPer10s)
        return reply({ ok: false, code: 'RATE_LIMITED' });
      try {
        if (state.switching) await state.switching;
        const roomDoc = await ensureDoc(room);
        if (state.retired && touchesRetiredClients(update, state.retired))
          return reply({ ok: false, code: 'RETRY' });
        const result = applyCheckedUpdate(roomDoc, update, { checkBlock: socket.data.blockRule });
        if (!result.ok) {
          if (result.dirty) dropDoc(room);
          if (result.code === 'MISSING_DEPENDENCY') return reply({ ok: false, code: 'RETRY' });
          invalid += 1;
          logger.warn('collaboration update refused', { code: result.code });
          reply({ ok: false, code: 'INVALID_UPDATE' });
          if (invalid >= MAX_INVALID_UPDATES) {
            socket.emit('mx:error', { code: 'INVALID_UPDATE' });
            socket.disconnect(true);
          }
          return undefined;
        }
        if (!result.changed) return reply({ ok: true, id: 0 });
        const stats = await store().roomStats(room);
        if (stats.bytes + update.byteLength > MAX_ROOM_BYTES) {
          dropDoc(room);
          return reply({ ok: false, code: 'ROOM_FULL' });
        }
        let id;
        try {
          id = await store().appendUpdate(room, update, 'update', { epoch: epochOf(roomDoc) });
        } catch (error) {
          if (error && error.code === 'STALE_GENERATION') {
            // Another process compacted the room: move to the new generation; the
            // client keeps the edit and re-applies it there.
            switchGeneration(room).catch(() => {});
            return reply({ ok: false, code: 'RETRY' });
          }
          // The in-memory document already holds the update; rebuild it from the database.
          dropDoc(room);
          throw error;
        }
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
      const now = Date.now();
      if (now - lastResyncAt < 1000) return;
      lastResyncAt = now;
      const vector = toBytes(payload, 64 * 1024);
      try {
        await sendSync(vector);
      } catch (error) {
        logger.warn('collaboration resync failed', { code: error && error.code, name: error && error.name });
      }
    });

    socket.on('mx:cursor', async (cursor) => {
      const now = Date.now();
      if (now - lastCursorAt < 50) return;
      lastCursorAt = now;
      socket.data.cursor = cleanCursor(cursor);
      try {
        await store().upsertPresence({
          id: socket.data.presenceId,
          room,
          userId: claims.userId,
          name: claims.name,
          color: claims.color,
          canEdit: socket.data.canEdit,
          cursor: socket.data.cursor,
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
          if (state.sockets.size === 0) {
            dropDoc(room);
            rooms.delete(room);
          }
        }
        poll();
      } catch {
        // cleanup is best effort; heartbeats expire
      }
    });
  };

  /**
   * Raises the cluster-wide permission signal and re-checks local sockets now.
   * @returns {Promise<void>}
   */
  const permissionsChanged = async () => {
    try {
      const value = randomUUID();
      await store().setSignal('permissions', value);
      permissionSignal = value;
    } catch (error) {
      logger.warn('permission signal could not be raised', {
        code: error && error.code,
        name: error && error.name,
      });
    }
    if (rooms.size > 0) await revalidate();
  };

  return {
    PROCESS_ID,
    PROTOCOL,

    /**
     * Issues a one-time session token for a field after checking access.
     * @param {{ userAbility: object, user: object, uid: string, documentId: string, locale?: string|null, field: string, initialValue?: unknown }} input - Request.
     * @returns {Promise<object>} Token and connection details.
     * @throws {errors.NotFoundError|errors.ForbiddenError|errors.RateLimitError} Access denied, collaboration off, too many sessions.
     */
    async createSession({ userAbility, user, uid, documentId, locale, field, initialValue }) {
      if (conf('enabled', true) === false || !io)
        throw new errors.ForbiddenError('Live collaboration is disabled');
      const limit = Number((conf('rateLimit', {}) || {}).sessionsPerMinute) || 60;
      let allowed;
      try {
        allowed = (await store().hit(`session:${user.id}`, 60000)).count <= limit;
      } catch {
        allowed = sessionLimiter.hit(`session:${user.id}`).allowed;
      }
      if (!allowed) throw new errors.RateLimitError('Too many live editing sessions. Try again in a minute.');
      const result = await access().checkField({ userAbility, uid, documentId, locale, field });
      if (!presetOf({ uid, field }).collaboration)
        throw new errors.ForbiddenError('Live collaboration is turned off for this field');
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
        protocol: PROTOCOL,
        nonce: randomUUID(),
        exp: Date.now() + ttl,
      };
      return {
        token: signToken(claims, getTokenKey(strapi)),
        path: conf('path', '/magic-editor-x/realtime'),
        canEdit: result.canUpdate,
        seeded,
        protocol: PROTOCOL,
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
      io.use((socket, next) => {
        authenticate(socket, next);
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
      every(snapshotTick, 5000);
      every(
        compactionTick,
        Math.max(1, Number((conf('compaction', {}) || {}).checkIntervalSeconds) || 30) * 1000
      );
      every(signalTick, SIGNAL_CHECK_MS);
      every(revalidate, Math.max(5, Number(conf('revalidateSeconds', 60))) * 1000);
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
      for (const room of Array.from(rooms.keys())) dropDoc(room);
      rooms.clear();
    },

    /** True when the socket server runs in this process. */
    isRunning() {
      return Boolean(io);
    },

    /** Called by the admin lifecycle subscriber when roles, permissions or users change. */
    permissionsChanged,

    /** Test hook: runs one poll tick. */
    pollNow: poll,
    /** Test hook: runs one maintenance tick. */
    maintenanceNow: maintenanceTick,
    /** Test hook: runs one compaction check. */
    compactionNow: compactionTick,
    /**
     * Test and operations hook: compacts one room now (still under the lease
     * and the generation check).
     * @param {string} room - Room key.
     * @param {{ idleMs?: number, force?: boolean }} [options] - Overrides.
     * @returns {Promise<{ compacted: boolean, before?: number, after?: number }>} Result.
     */
    compactRoom: (room, options = {}) =>
      compactGeneration(room, {
        idleMs: options.idleMs ?? 0,
        minBytes: 0,
        ratio: 1,
        force: options.force === true,
      }),
    /**
     * Memory view of the rooms of this process (no content).
     * @returns {Array<{ room: string, sockets: number, bytes: number, epoch: string }>} Rooms.
     */
    roomsInfo: () =>
      Array.from(rooms.entries()).map(([room, state]) => ({
        room,
        sockets: state.sockets.size,
        bytes: state.doc ? Y.encodeStateAsUpdate(state.doc).byteLength : 0,
        epoch: state.doc ? epochOf(state.doc) : '',
      })),
  };
};

module.exports.toBytes = toBytes;
module.exports.displayName = displayName;
module.exports.cleanCursor = cleanCursor;
module.exports.targetOfRoom = targetOfRoom;
module.exports.PROTOCOL = PROTOCOL;

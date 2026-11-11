'use strict';

const { createLogger } = require('../utils/logger');

/**
 * Plugin-owned tables for live collaboration and cross-process coordination.
 *
 * They are created with the Strapi knex connection (SQLite, PostgreSQL, MySQL/
 * MariaDB) and are not content types, so Strapi's schema sync leaves them
 * alone. Every process of a cluster uses them:
 *
 * - magic_editor_x_collab_updates: append-only Yjs updates per room (base64);
 * - magic_editor_x_collab_presence: who is in which room (heartbeat rows);
 * - magic_editor_x_locks: leases and one-time keys (token nonces, seeding,
 *   snapshot buckets, migrations), made atomic by the primary key, and
 *   cluster-wide signals (permission changes);
 * - magic_editor_x_counters: fixed-window counters shared by every process
 *   (rate limits for sessions and the AI assistant).
 */

const TABLES = Object.freeze({
  updates: 'magic_editor_x_collab_updates',
  presence: 'magic_editor_x_collab_presence',
  locks: 'magic_editor_x_locks',
  counters: 'magic_editor_x_counters',
});

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const db = () => strapi.db.connection;
  const table = (name) => strapi.db.getConnection(name);
  let ready = null;

  /**
   * Creates one table when it does not exist. Concurrent creation by another
   * process is tolerated.
   * @param {string} name - Table name.
   * @param {(t: import('knex').Knex.CreateTableBuilder) => void} build - Column builder.
   * @returns {Promise<void>}
   */
  const ensureTable = async (name, build) => {
    const schema = strapi.db.getSchemaConnection();
    if (await schema.hasTable(name)) return;
    try {
      await strapi.db.getSchemaConnection().createTable(name, build);
    } catch (error) {
      if (!(await strapi.db.getSchemaConnection().hasTable(name))) throw error;
    }
  };

  return {
    TABLES,

    /**
     * Creates the plugin tables (idempotent, safe to call from every process).
     * @returns {Promise<void>}
     */
    async init() {
      if (!ready) {
        ready = (async () => {
          await ensureTable(TABLES.updates, (t) => {
            t.bigIncrements('id').primary();
            t.string('room', 400).notNullable();
            t.string('kind', 16).notNullable().defaultTo('update');
            t.text('data', 'longtext').notNullable();
            t.integer('size').notNullable().defaultTo(0);
            t.bigInteger('created_at').notNullable();
            t.index(['room', 'id'], 'mex_collab_updates_room_id');
          });
          await ensureTable(TABLES.presence, (t) => {
            t.string('id', 64).primary();
            t.string('room', 400).notNullable();
            t.integer('user_id').notNullable();
            t.string('name', 200).notNullable();
            t.string('color', 16).notNullable();
            t.boolean('can_edit').notNullable().defaultTo(false);
            t.text('cursor');
            t.bigInteger('updated_at').notNullable();
            t.index(['room'], 'mex_collab_presence_room');
          });
          await ensureTable(TABLES.locks, (t) => {
            t.string('key', 255).primary();
            t.string('owner', 64).notNullable();
            t.bigInteger('expires_at').notNullable();
          });
          await ensureTable(TABLES.counters, (t) => {
            t.string('key', 255).primary();
            t.integer('count').notNullable().defaultTo(0);
            t.bigInteger('expires_at').notNullable();
          });
        })().catch((error) => {
          ready = null;
          logger.error('collaboration tables could not be created', error);
          throw error;
        });
      }
      return ready;
    },

    /**
     * Acquires a lease or one-time key. Returns true for exactly one caller
     * across all processes until the lease expires.
     * @param {string} key - Lock key (bounded by the caller).
     * @param {string} owner - Owner id (process id).
     * @param {number} ttlMs - Lease length.
     * @returns {Promise<boolean>} True when acquired.
     */
    async acquire(key, owner, ttlMs) {
      const now = Date.now();
      const expiresAt = now + ttlMs;
      try {
        await table(TABLES.locks).insert({ key, owner, expires_at: expiresAt });
        return true;
      } catch {
        const updated = await table(TABLES.locks)
          .where({ key })
          .andWhere('expires_at', '<', now)
          .update({ owner, expires_at: expiresAt });
        return updated === 1;
      }
    },

    /**
     * Extends a lease held by `owner`.
     * @param {string} key - Lock key.
     * @param {string} owner - Owner id.
     * @param {number} ttlMs - New lease length.
     * @returns {Promise<boolean>} True when still held.
     */
    async renew(key, owner, ttlMs) {
      const updated = await table(TABLES.locks)
        .where({ key, owner })
        .update({ expires_at: Date.now() + ttlMs });
      return updated === 1;
    },

    /**
     * Releases a lease held by `owner`.
     * @param {string} key - Lock key.
     * @param {string} owner - Owner id.
     * @returns {Promise<void>}
     */
    async release(key, owner) {
      await table(TABLES.locks).where({ key, owner }).del();
    },

    /**
     * Removes expired lock rows (bounded).
     * @returns {Promise<number>} Rows removed.
     */
    async pruneLocks() {
      const ids = await table(TABLES.locks).where('expires_at', '<', Date.now()).select('key').limit(500);
      if (ids.length === 0) return 0;
      return table(TABLES.locks)
        .whereIn(
          'key',
          ids.map((row) => row.key)
        )
        .andWhere('expires_at', '<', Date.now())
        .del();
    },

    /**
     * Counts one event in a fixed window shared by all processes.
     * @param {string} key - Counter key (bounded by the caller, no personal data besides an admin id).
     * @param {number} windowMs - Window length.
     * @returns {Promise<{ count: number, resetAt: number }>} Events in the current window, including this one.
     */
    async hit(key, windowMs) {
      const now = Date.now();
      const windowKey = `${key}:${Math.floor(now / windowMs)}`.slice(0, 255);
      const expiresAt = (Math.floor(now / windowMs) + 1) * windowMs;
      try {
        await table(TABLES.counters).insert({ key: windowKey, count: 1, expires_at: expiresAt });
      } catch {
        await table(TABLES.counters).where({ key: windowKey }).increment('count', 1);
      }
      const row = await table(TABLES.counters).where({ key: windowKey }).first('count');
      return { count: Number(row?.count || 1), resetAt: expiresAt };
    },

    /**
     * Removes expired counters (bounded).
     * @returns {Promise<number>} Rows removed.
     */
    async pruneCounters() {
      const keys = await table(TABLES.counters).where('expires_at', '<', Date.now()).select('key').limit(500);
      if (keys.length === 0) return 0;
      return table(TABLES.counters)
        .whereIn(
          'key',
          keys.map((row) => row.key)
        )
        .del();
    },

    /**
     * Sets a cluster-wide signal to a new random value (for example after a
     * permission change). Every process compares it on its next tick.
     * @param {string} name - Signal name.
     * @param {string} value - New value.
     * @returns {Promise<void>}
     */
    async setSignal(name, value) {
      const key = `signal:${name}`;
      const expiresAt = Date.now() + 10 * 365 * 24 * 3600 * 1000;
      const updated = await table(TABLES.locks)
        .where({ key })
        .update({ owner: value, expires_at: expiresAt });
      if (updated === 0) {
        try {
          await table(TABLES.locks).insert({ key, owner: value, expires_at: expiresAt });
        } catch {
          await table(TABLES.locks).where({ key }).update({ owner: value, expires_at: expiresAt });
        }
      }
    },

    /**
     * Reads a cluster-wide signal.
     * @param {string} name - Signal name.
     * @returns {Promise<string>} Current value ('' when never set).
     */
    async getSignal(name) {
      const row = await table(TABLES.locks)
        .where({ key: `signal:${name}` })
        .first('owner');
      return row ? String(row.owner) : '';
    },

    /**
     * Live sockets and rooms of one admin across all processes.
     * @param {number} userId - Admin id.
     * @param {number} freshAfter - Heartbeat threshold.
     * @returns {Promise<{ sockets: number, rooms: Set<string> }>} Usage.
     */
    async presenceOfUser(userId, freshAfter) {
      const rows = await table(TABLES.presence)
        .where({ user_id: userId })
        .andWhere('updated_at', '>', freshAfter)
        .select('room');
      return { sockets: rows.length, rooms: new Set(rows.map((row) => row.room)) };
    },

    /**
     * Appends one Yjs update.
     * @param {string} room - Room key.
     * @param {Uint8Array} update - Yjs update.
     * @param {'seed'|'update'|'compact'} [kind='update'] - Row kind.
     * @returns {Promise<number>} The row id.
     */
    async appendUpdate(room, update, kind = 'update') {
      const row = {
        room,
        kind,
        data: Buffer.from(update).toString('base64'),
        size: update.byteLength,
        created_at: Date.now(),
      };
      const result = await table(TABLES.updates).insert(row, ['id']);
      const first = Array.isArray(result) ? result[0] : result;
      return Number(typeof first === 'object' && first !== null ? first.id : first);
    },

    /**
     * Reads every update of a room in insertion order.
     * @param {string} room - Room key.
     * @returns {Promise<Array<{ id: number, kind: string, createdAt: number, update: Uint8Array }>>} Updates.
     */
    async readRoom(room) {
      const rows = await table(TABLES.updates)
        .where({ room })
        .orderBy('id', 'asc')
        .select('id', 'kind', 'data', 'created_at');
      return rows.map((row) => ({
        id: Number(row.id),
        kind: row.kind,
        createdAt: Number(row.created_at),
        update: new Uint8Array(Buffer.from(row.data, 'base64')),
      }));
    },

    /**
     * Room statistics used for limits and compaction.
     * @param {string} room - Room key.
     * @returns {Promise<{ count: number, bytes: number, lastId: number, lastAt: number }>} Stats.
     */
    async roomStats(room) {
      const [row] = await table(TABLES.updates)
        .where({ room })
        .count({ count: 'id' })
        .sum({ bytes: 'size' })
        .max({ lastId: 'id' })
        .max({ lastAt: 'created_at' });
      return {
        count: Number(row?.count || 0),
        bytes: Number(row?.bytes || 0),
        lastId: Number(row?.lastId || 0),
        lastAt: Number(row?.lastAt || 0),
      };
    },

    /**
     * Reads new updates for several rooms.
     * @param {string[]} rooms - Room keys.
     * @param {number} afterId - Exclusive lower id bound.
     * @param {number} [limit=1000] - Max rows.
     * @returns {Promise<Array<{ id: number, room: string, kind: string, update: Uint8Array }>>} Rows.
     */
    async readSince(rooms, afterId, limit = 1000) {
      if (rooms.length === 0) return [];
      const rows = await table(TABLES.updates)
        .whereIn('room', rooms)
        .andWhere('id', '>', afterId)
        .orderBy('id', 'asc')
        .limit(limit)
        .select('id', 'room', 'kind', 'data', 'created_at');
      return rows.map((row) => ({
        id: Number(row.id),
        room: row.room,
        kind: row.kind,
        createdAt: Number(row.created_at),
        update: new Uint8Array(Buffer.from(row.data, 'base64')),
      }));
    },

    /**
     * Replaces the given rows with one merged row in a single transaction.
     * Rows written meanwhile are untouched, so nothing is lost.
     * @param {string} room - Room key.
     * @param {number[]} ids - Rows merged into `update`.
     * @param {Uint8Array} update - Merged update.
     * @returns {Promise<void>}
     */
    async replaceRows(room, ids, update) {
      await db().transaction(async (trx) => {
        await table(TABLES.updates)
          .transacting(trx)
          .insert({
            room,
            kind: 'compact',
            data: Buffer.from(update).toString('base64'),
            size: update.byteLength,
            created_at: Date.now(),
          });
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          await table(TABLES.updates).transacting(trx).whereIn('id', chunk).andWhere({ room }).del();
        }
      });
    },

    /**
     * Deletes all rows of a room (garbage collection after inactivity).
     * @param {string} room - Room key.
     * @returns {Promise<void>}
     */
    async deleteRoom(room) {
      await table(TABLES.updates).where({ room }).del();
      await table(TABLES.locks)
        .where({ key: `seed:${room}` })
        .del();
    },

    /**
     * Rooms whose newest update is older than `before` (candidates for GC).
     * @param {number} before - Timestamp in ms.
     * @param {number} [limit=50] - Max rooms.
     * @returns {Promise<string[]>} Room keys.
     */
    async staleRooms(before, limit = 50) {
      const rows = await table(TABLES.updates)
        .select('room')
        .groupBy('room')
        .havingRaw('max(created_at) < ?', [before])
        .limit(limit);
      return rows.map((row) => row.room);
    },

    /**
     * Inserts or refreshes a presence row.
     * @param {{ id: string, room: string, userId: number, name: string, color: string, canEdit: boolean, cursor?: object|null }} entry - Presence.
     * @returns {Promise<void>}
     */
    async upsertPresence(entry) {
      const row = {
        room: entry.room,
        user_id: entry.userId,
        name: entry.name,
        color: entry.color,
        can_edit: Boolean(entry.canEdit),
        cursor: entry.cursor ? JSON.stringify(entry.cursor) : null,
        updated_at: Date.now(),
      };
      const updated = await table(TABLES.presence).where({ id: entry.id }).update(row);
      if (updated === 0) await table(TABLES.presence).insert({ id: entry.id, ...row });
    },

    /**
     * Refreshes the heartbeat of presence rows.
     * @param {string[]} ids - Presence ids.
     * @returns {Promise<void>}
     */
    async touchPresence(ids) {
      if (ids.length === 0) return;
      await table(TABLES.presence).whereIn('id', ids).update({ updated_at: Date.now() });
    },

    /**
     * Removes a presence row.
     * @param {string} id - Presence id.
     * @returns {Promise<void>}
     */
    async removePresence(id) {
      await table(TABLES.presence).where({ id }).del();
    },

    /**
     * Lists live presence rows for rooms.
     * @param {string[]} rooms - Room keys.
     * @param {number} freshAfter - Only rows refreshed after this time.
     * @returns {Promise<Array<object>>} Rows.
     */
    async listPresence(rooms, freshAfter) {
      if (rooms.length === 0) return [];
      return table(TABLES.presence)
        .whereIn('room', rooms)
        .andWhere('updated_at', '>', freshAfter)
        .select('*');
    },

    /**
     * Removes presence rows that stopped sending heartbeats.
     * @param {number} before - Timestamp in ms.
     * @returns {Promise<void>}
     */
    async prunePresence(before) {
      await table(TABLES.presence).where('updated_at', '<', before).del();
    },

    /**
     * True when anyone is present in the room.
     * @param {string} room - Room key.
     * @param {number} freshAfter - Heartbeat threshold.
     * @returns {Promise<boolean>} Result.
     */
    async hasPresence(room, freshAfter) {
      const row = await table(TABLES.presence)
        .where({ room })
        .andWhere('updated_at', '>', freshAfter)
        .first('id');
      return Boolean(row);
    },
  };
};

'use strict';

const { createHash } = require('node:crypto');
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
 *   (rate limits for sessions and the AI assistant);
 * - magic_editor_x_link_fields / magic_editor_x_link_urls: results of the
 *   scheduled external link check (services/link-schedule.js): one row per
 *   field version with external links, one row per distinct URL.
 */

const TABLES = Object.freeze({
  updates: 'magic_editor_x_collab_updates',
  presence: 'magic_editor_x_collab_presence',
  locks: 'magic_editor_x_locks',
  counters: 'magic_editor_x_counters',
  linkFields: 'magic_editor_x_link_fields',
  linkUrls: 'magic_editor_x_link_urls',
});

const ABORT = 'magic-editor-x:abort-transaction';

/**
 * Lock-table key of a room's generation row.
 * @param {string} room - Room key.
 * @returns {string} Key (max 255 characters; long room keys are hashed).
 */
const generationKey = (room) => {
  const key = `gen:${room}`;
  if (key.length <= 255) return key;
  return `gen#${createHash('sha256').update(room).digest('hex')}`;
};

/** Expiry of rows that must never be pruned (signals, generations). */
const FOREVER = () => Date.now() + 10 * 365 * 24 * 3600 * 1000;

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
          await ensureTable(TABLES.linkFields, (t) => {
            t.string('key', 64).primary();
            t.string('uid', 160).notNullable();
            t.string('document_id', 64).notNullable();
            t.string('locale', 40);
            t.string('field', 200).notNullable();
            t.string('version', 16).notNullable();
            t.text('links').notNullable();
            t.string('run_id', 40).notNullable();
            t.bigInteger('scanned_at').notNullable();
            t.index(['run_id'], 'mex_link_fields_run');
          });
          await ensureTable(TABLES.linkUrls, (t) => {
            t.string('hash', 64).primary();
            t.text('url').notNullable();
            t.string('status', 16);
            t.integer('code');
            t.bigInteger('checked_at').notNullable().defaultTo(0);
            t.string('run_id', 40).notNullable();
            t.index(['run_id', 'checked_at'], 'mex_link_urls_run');
          });
        })().catch((error) => {
          ready = null;
          logger.error('plugin tables could not be created', error);
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
     * Appends one Yjs update. With `options.epoch`, the row is only written
     * while the room is still at that generation: the generation row
     * (`gen:<room>` in the locks table) is read with a shared lock in the same
     * transaction, so a compaction that switches the generation either waits
     * for this write or makes it fail with `code: 'STALE_GENERATION'`.
     * @param {string} room - Room key.
     * @param {Uint8Array} update - Yjs update.
     * @param {'seed'|'update'|'compact'} [kind='update'] - Row kind.
     * @param {{ epoch?: string }} [options] - Generation the update was checked against.
     * @returns {Promise<number>} The row id.
     * @throws {Error} `code: 'STALE_GENERATION'` when the room moved to another generation.
     */
    async appendUpdate(room, update, kind = 'update', options = {}) {
      const row = {
        room,
        kind,
        data: Buffer.from(update).toString('base64'),
        size: update.byteLength,
        created_at: Date.now(),
      };
      const insert = async (trx) => {
        const query = table(TABLES.updates);
        const result = await (trx ? query.transacting(trx) : query).insert(row, ['id']);
        const first = Array.isArray(result) ? result[0] : result;
        return Number(typeof first === 'object' && first !== null ? first.id : first);
      };
      if (typeof options.epoch !== 'string') return insert(null);
      return db().transaction(async (trx) => {
        const generation = await table(TABLES.locks)
          .transacting(trx)
          .where({ key: generationKey(room) })
          .forShare()
          .first('owner');
        if (generation && String(generation.owner) !== options.epoch) {
          const error = new Error('The room moved to a new generation');
          error.code = 'STALE_GENERATION';
          throw error;
        }
        return insert(trx);
      });
    },

    /**
     * Records the generation (epoch) of a room unless one is recorded already.
     * @param {string} room - Room key.
     * @param {string} epoch - Generation of the stored rows.
     * @returns {Promise<void>}
     */
    async ensureGeneration(room, epoch) {
      const key = generationKey(room);
      const existing = await table(TABLES.locks).where({ key }).first('owner');
      if (existing) return;
      try {
        await table(TABLES.locks).insert({ key, owner: String(epoch || ''), expires_at: FOREVER() });
      } catch {
        // another process recorded it first
      }
    },

    /**
     * Forgets the generation of a room (before a new room is seeded).
     * @param {string} room - Room key.
     * @returns {Promise<void>}
     */
    async deleteGeneration(room) {
      await table(TABLES.locks)
        .where({ key: generationKey(room) })
        .del();
    },

    /**
     * Current generation of a room ('' when none is recorded).
     * @param {string} room - Room key.
     * @returns {Promise<string|null>} Epoch, or null when no generation row exists.
     */
    async getGeneration(room) {
      const row = await table(TABLES.locks)
        .where({ key: generationKey(room) })
        .first('owner');
      return row ? String(row.owner) : null;
    },

    /**
     * Replaces a whole room generation with a fresh seed in one transaction
     * (room compaction). Succeeds only when the room is still at generation
     * `fromEpoch` and no row was written after `lastId`; otherwise nothing
     * changes. The new seed keeps `createdAt` of the last old row, so the
     * compaction itself does not count as activity (room TTL, versions).
     * @param {string} room - Room key.
     * @param {{ ids: number[], lastId: number, lastAt: number, fromEpoch: string, toEpoch: string, seed: Uint8Array }} input - Generation switch.
     * @returns {Promise<number>} Id of the new seed row, or 0 when the room changed meanwhile.
     */
    async replaceGeneration(room, { ids, lastId, lastAt, fromEpoch, toEpoch, seed }) {
      return db()
        .transaction(async (trx) => {
          const key = generationKey(room);
          const generation = await table(TABLES.locks)
            .transacting(trx)
            .where({ key })
            .forUpdate()
            .first('owner');
          if (generation && String(generation.owner) !== fromEpoch) return 0;
          if (generation) {
            await table(TABLES.locks)
              .transacting(trx)
              .where({ key })
              .update({ owner: toEpoch, expires_at: FOREVER() });
          } else {
            await table(TABLES.locks).transacting(trx).insert({ key, owner: toEpoch, expires_at: FOREVER() });
          }
          const [newer] = await table(TABLES.updates)
            .transacting(trx)
            .where({ room })
            .andWhere('id', '>', lastId)
            .count({ count: 'id' });
          if (Number(newer?.count || 0) > 0) throw new Error(ABORT);
          const result = await table(TABLES.updates)
            .transacting(trx)
            .insert(
              {
                room,
                kind: 'seed',
                data: Buffer.from(seed).toString('base64'),
                size: seed.byteLength,
                created_at: lastAt || Date.now(),
              },
              ['id']
            );
          let deleted = 0;
          for (let i = 0; i < ids.length; i += 500) {
            const chunk = ids.slice(i, i + 500);
            deleted += await table(TABLES.updates)
              .transacting(trx)
              .whereIn('id', chunk)
              .andWhere({ room })
              .del();
          }
          if (deleted !== ids.length) throw new Error(ABORT);
          const first = Array.isArray(result) ? result[0] : result;
          return Number(typeof first === 'object' && first !== null ? first.id : first);
        })
        .catch((error) => {
          if (error && error.message === ABORT) return 0;
          throw error;
        });
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
      await db()
        .transaction(async (trx) => {
          await table(TABLES.updates)
            .transacting(trx)
            .insert({
              room,
              kind: 'compact',
              data: Buffer.from(update).toString('base64'),
              size: update.byteLength,
              created_at: Date.now(),
            });
          let deleted = 0;
          for (let i = 0; i < ids.length; i += 500) {
            const chunk = ids.slice(i, i + 500);
            deleted += await table(TABLES.updates)
              .transacting(trx)
              .whereIn('id', chunk)
              .andWhere({ room })
              .del();
          }
          // Rows already replaced by a new generation: the merged old state must not be stored.
          if (deleted !== ids.length) throw new Error(ABORT);
        })
        .catch((error) => {
          if (!error || error.message !== ABORT) throw error;
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
        .whereIn('key', [`seed:${room}`.slice(0, 255), generationKey(room)])
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

    /**
     * Writes the link rows of field versions seen in a scheduled run
     * (insert or replace by key).
     * @param {Array<{ key: string, uid: string, documentId: string, locale: string|null, field: string, version: string, links: Array<{ h: string, b: string }>, runId: string, scannedAt: number }>} rows - Rows (bounded by the caller).
     * @returns {Promise<void>}
     */
    async saveLinkFields(rows) {
      if (rows.length === 0) return;
      const keys = rows.map((row) => row.key);
      const existing = new Set(
        (await table(TABLES.linkFields).whereIn('key', keys).select('key')).map((row) => row.key)
      );
      for (const row of rows) {
        const values = {
          uid: row.uid,
          document_id: row.documentId,
          locale: row.locale,
          field: row.field,
          version: row.version,
          links: JSON.stringify(row.links),
          run_id: row.runId,
          scanned_at: row.scannedAt,
        };
        if (existing.has(row.key)) await table(TABLES.linkFields).where({ key: row.key }).update(values);
        else await table(TABLES.linkFields).insert({ key: row.key, ...values });
      }
    },

    /**
     * Reads link rows by key.
     * @param {string[]} keys - Row keys.
     * @returns {Promise<Array<{ key: string, version: string, links: Array<{ h: string, b: string }>, scannedAt: number }>>} Rows.
     */
    async getLinkFields(keys) {
      if (keys.length === 0) return [];
      const rows = await table(TABLES.linkFields)
        .whereIn('key', keys)
        .select('key', 'version', 'links', 'scanned_at');
      return rows.map((row) => {
        let links;
        try {
          links = JSON.parse(row.links);
        } catch {
          links = [];
        }
        return {
          key: row.key,
          version: row.version,
          links: Array.isArray(links) ? links : [],
          scannedAt: Number(row.scanned_at),
        };
      });
    },

    /**
     * Marks URLs as seen in a run; new URLs are inserted unchecked.
     * @param {Array<{ hash: string, url: string }>} urls - Distinct URLs (bounded by the caller).
     * @param {string} runId - Run id.
     * @returns {Promise<void>}
     */
    async markLinkUrls(urls, runId) {
      if (urls.length === 0) return;
      const hashes = urls.map((item) => item.hash);
      const existing = new Set(
        (await table(TABLES.linkUrls).whereIn('hash', hashes).select('hash')).map((row) => row.hash)
      );
      const seen = hashes.filter((hash) => existing.has(hash));
      if (seen.length) await table(TABLES.linkUrls).whereIn('hash', seen).update({ run_id: runId });
      const fresh = urls
        .filter((item) => !existing.has(item.hash))
        .map((item) => ({ hash: item.hash, url: item.url, checked_at: 0, run_id: runId }));
      for (let i = 0; i < fresh.length; i += 100) {
        await table(TABLES.linkUrls).insert(fresh.slice(i, i + 100));
      }
    },

    /**
     * URLs of a run that were not checked since `before`, least recently checked first.
     * @param {string} runId - Run id.
     * @param {number} before - Only URLs checked before this time.
     * @param {number} limit - Max rows.
     * @returns {Promise<Array<{ hash: string, url: string }>>} URLs.
     */
    async linkUrlsToCheck(runId, before, limit) {
      return table(TABLES.linkUrls)
        .where({ run_id: runId })
        .andWhere('checked_at', '<', before)
        .orderBy([
          { column: 'checked_at', order: 'asc' },
          { column: 'hash', order: 'asc' },
        ])
        .limit(limit)
        .select('hash', 'url');
    },

    /**
     * Stores the result of one URL check.
     * @param {string} hash - URL hash.
     * @param {{ status: string, code?: number }} result - Result.
     * @param {number} checkedAt - Time of the check.
     * @returns {Promise<void>}
     */
    async setLinkUrlResult(hash, result, checkedAt) {
      await table(TABLES.linkUrls)
        .where({ hash })
        .update({
          status: result.status,
          code: Number.isInteger(result.code) ? result.code : null,
          checked_at: checkedAt,
        });
    },

    /**
     * Reads URL rows by hash.
     * @param {string[]} hashes - URL hashes.
     * @returns {Promise<Map<string, { url: string, status: string|null, code: number|null, checkedAt: number }>>} Rows by hash.
     */
    async getLinkUrls(hashes) {
      const out = new Map();
      for (let i = 0; i < hashes.length; i += 500) {
        const rows = await table(TABLES.linkUrls)
          .whereIn('hash', hashes.slice(i, i + 500))
          .select('hash', 'url', 'status', 'code', 'checked_at');
        for (const row of rows)
          out.set(row.hash, {
            url: row.url,
            status: row.status || null,
            code: row.code === null || row.code === undefined ? null : Number(row.code),
            checkedAt: Number(row.checked_at),
          });
      }
      return out;
    },

    /**
     * Deletes link rows that a complete run did not see (deleted entries,
     * removed links or fields). Bounded batches.
     * @param {string} runId - Run id of the complete run.
     * @returns {Promise<{ fields: number, urls: number }>} Rows removed.
     */
    async pruneLinkRows(runId) {
      const removed = { fields: 0, urls: 0 };
      for (const [name, column, counter] of [
        [TABLES.linkFields, 'key', 'fields'],
        [TABLES.linkUrls, 'hash', 'urls'],
      ]) {
        for (;;) {
          const rows = await table(name).whereNot({ run_id: runId }).select(column).limit(500);
          if (rows.length === 0) break;
          const deleted = await table(name)
            .whereIn(
              column,
              rows.map((row) => row[column])
            )
            .whereNot({ run_id: runId })
            .del();
          removed[counter] += deleted;
          if (deleted === 0) break;
        }
      }
      return removed;
    },
  };
};

'use strict';

const { z } = require('zod');

/**
 * Plugin configuration (config/plugins.js -> 'magic-editor-x': { config: {...} }).
 *
 * Infrastructure decisions live here (collaboration transport, private AI
 * hosts, raw HTML policy, size limits). Settings an admin may change at
 * runtime (the AI provider) live in the plugin store and are edited in
 * Settings -> Magic Editor X.
 *
 * Arrays have no non-empty defaults because Strapi merges config arrays index
 * by index (lodash defaultsDeep).
 */

const MiB = 1024 * 1024;

const defaults = {
  debug: false,
  /** Raw HTML block: 'sanitize' (default) cleans it on save, 'allow' stores it as typed, 'disable' empties it. */
  rawHtml: 'sanitize',
  /** Normalise and sanitise Magic Editor X fields on every Document Service write. */
  sanitizeOnSave: true,
  /** Master key for stored secrets (AI key). Prefer the MAGIC_EDITOR_X_ENCRYPTION_KEY env var. */
  encryptionKey: undefined,
  uploads: {
    maxImageBytes: 10 * MiB,
    maxFileBytes: 20 * MiB,
  },
  linkPreview: {
    enabled: true,
    timeoutMs: 8000,
  },
  api: {
    /** Parse 1.x JSON strings into objects in Content API responses. */
    autoParseJSON: true,
  },
  ai: {
    /** Allow AI base URLs on private or loopback hosts (local models). Owner opt-in only. */
    allowPrivateBaseUrl: false,
    /** Optional API key from the environment; when set it wins over a key stored in the settings. */
    apiKey: undefined,
    requestsPerMinute: 20,
    timeoutMs: 60000,
  },
  collaboration: {
    enabled: true,
    /** Socket.IO path on the Strapi HTTP server. */
    path: '/magic-editor-x/realtime',
    /** Extra browser origins allowed to open the socket (the admin and server URL are always allowed). */
    allowedOrigins: [],
    /** How often each process checks the database for updates from other processes. */
    pollIntervalMs: 400,
    /** Keep a room's live state this long after the last person left (survives restarts). */
    roomTtlMinutes: 30,
    /** Largest accepted socket message. */
    maxMessageBytes: 2 * MiB,
    /** Automatic version-history snapshot while people edit live. 0 disables. */
    snapshotIntervalMinutes: 10,
    /** Lifetime of the one-time session token that opens the socket. */
    tokenTtlSeconds: 60,
  },
  history: {
    /** Snapshots kept per field and locale; older ones are removed. */
    maxSnapshotsPerField: 50,
  },
};

const positiveInt = (max) => z.number().int().min(1).max(max);

const configSchema = z.looseObject({
  debug: z.boolean(),
  rawHtml: z.enum(['sanitize', 'allow', 'disable']),
  sanitizeOnSave: z.boolean(),
  encryptionKey: z.string().min(32).max(512).optional(),
  uploads: z.looseObject({
    maxImageBytes: positiveInt(200 * MiB),
    maxFileBytes: positiveInt(500 * MiB),
  }),
  linkPreview: z.looseObject({ enabled: z.boolean(), timeoutMs: z.number().int().min(1000).max(30000) }),
  api: z.looseObject({ autoParseJSON: z.boolean() }),
  ai: z.looseObject({
    allowPrivateBaseUrl: z.boolean(),
    apiKey: z.string().min(1).max(500).optional(),
    requestsPerMinute: positiveInt(1000),
    timeoutMs: z.number().int().min(1000).max(300000),
  }),
  collaboration: z.looseObject({
    enabled: z.boolean(),
    path: z.string().regex(/^\/[A-Za-z0-9/_-]{1,100}$/),
    allowedOrigins: z.array(z.string().regex(/^https?:\/\/[^/\s]{1,253}$/)).max(50),
    pollIntervalMs: z.number().int().min(50).max(10000),
    roomTtlMinutes: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60),
    maxMessageBytes: z
      .number()
      .int()
      .min(64 * 1024)
      .max(20 * MiB),
    snapshotIntervalMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    tokenTtlSeconds: z.number().int().min(10).max(600),
  }),
  history: z.looseObject({ maxSnapshotsPerField: positiveInt(1000) }),
});

module.exports = {
  default: defaults,
  /**
   * Validates the merged configuration. Messages name the key, never the value.
   * @param {object} config - Merged plugin config.
   * @throws {Error} When a key has the wrong type or range.
   */
  validator(config) {
    const result = configSchema.safeParse(config);
    if (!result.success) {
      const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
      throw new Error(`[magic-editor-x] invalid configuration for: ${keys}`);
    }
  },
};

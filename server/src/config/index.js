'use strict';

const { z } = require('zod');
const { isTimeZone } = require('../utils/time-zone');
const { isValidLinkPattern, MAX_LINK_PATTERN_LENGTH } = require('../../../shared/link-pattern.mjs');

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
    /** 2.4: size cap of a video or audio file copied from a URL (pasted <video>/<audio>; buffered in memory). */
    maxMediaBytes: 50 * MiB,
    /** 2.4: exact origins the image and media by-URL routes may fetch although they are private or loopback (no redirects). */
    allowPrivateOrigins: [],
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
  languageTool: {
    /** Allow LanguageTool base URLs on private or loopback hosts (self-hosted server in the LAN). Owner opt-in only. */
    allowPrivateBaseUrl: false,
    /** Grammar checks per editor and minute (shared by every process). */
    requestsPerMinute: 30,
    timeoutMs: 20000,
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
    /** Open sockets per admin across all processes. */
    maxConnectionsPerAdmin: 20,
    /** Different fields an admin may have open live at the same time. */
    maxRoomsPerAdmin: 20,
    /** Full permission re-check of open sockets (permission changes are applied within about a second anyway). */
    revalidateSeconds: 60,
    rateLimit: {
      /** Session tokens per admin and minute, shared by all processes. */
      sessionsPerMinute: 60,
      /** Updates per socket in 10 seconds. */
      updatesPer10s: 300,
      /** Update bytes per socket in 10 seconds. */
      bytesPer10s: 8 * MiB,
    },
    /**
     * Room compaction: a long-lived room keeps metadata for every edit (Yjs
     * tombstones). When a room has been idle for `idleSeconds` and its state
     * is `ratio` times larger than a fresh copy of the same content (and at
     * least `minBytes`), it is rebuilt as a new generation once across the
     * cluster; connected editors switch to it without reconnecting.
     */
    compaction: {
      enabled: true,
      idleSeconds: 60,
      minBytes: 256 * 1024,
      ratio: 4,
      checkIntervalSeconds: 30,
    },
  },
  history: {
    /** Snapshots kept per field and locale; older ones are removed. */
    maxSnapshotsPerField: 50,
  },
  comments: {
    /** Block comments in the editor (2.3). Off hides them and the comment routes answer 404. */
    enabled: true,
    /** Comments and replies one admin may post per minute, shared by all processes. */
    perMinute: 30,
  },
  qualityChecks: {
    externalLinks: {
      /** Let the quality panel check external links (outgoing requests through the SSRF-safe fetcher). Owner opt-in. */
      enabled: false,
      /** Time limit per request (and per redirect hop). */
      timeoutMs: 5000,
      /** External URLs one admin may check per minute, shared by all processes. */
      perMinute: 30,
      /**
       * Exact origins (`http://127.0.0.1:8080`) that may be checked although they
       * are private or loopback addresses, for intranet links or a local test
       * server. Redirects from them are not followed. Empty (default) keeps the
       * full SSRF protection for every link.
       */
      allowPrivateOrigins: [],
      /**
       * Scheduled check of every external link in all Magic Editor X fields
       * (needs `externalLinks.enabled`). Runs on one process of a cluster.
       */
      schedule: {
        enabled: false,
        /** Cron rule with five fields (minute hour day month weekday), in `tz` (default: the server time zone). */
        rule: '0 3 * * *',
        // `tz` (2.4, optional, no default): IANA time zone of the rule (`Europe/Berlin`, `UTC`);
        // unset uses the server time zone. Validated with utils/time-zone.js.
        /** Most URLs requested per run; the least recently checked go first. */
        maxUrlsPerRun: 500,
        /** Requests per minute of a run (all hosts). */
        perMinute: 60,
        /** Parallel requests to one host. */
        perHostConcurrency: 2,
      },
    },
  },
  audit: {
    /** Audit trail (2.4): who changed what and when, counts and block ids only, never content. */
    enabled: true,
    /** Days records are kept; older ones are pruned once an hour by one process. 0 keeps them. */
    retentionDays: 180,
  },
  links: {
    /**
     * href of internal links, e.g. '/{locale}/{collection}/{slug}' or 'https://www.example.com/{collection}/{documentId}'.
     * Placeholders: {documentId}, {locale}, {slug}, {collection}, {singular}. Empty uses '/{collection}/{documentId}'.
     */
    urlPattern: '',
  },
};

const positiveInt = (max) => z.number().int().min(1).max(max);

/** Five cron fields (no seconds field, so a run starts at most once a minute). */
const CRON_RULE = /^[0-9A-Za-z*,/?#-]{1,20}(?:[ \t]+[0-9A-Za-z*,/?#-]{1,20}){4}$/;

/**
 * True for a bare http(s) origin such as `http://127.0.0.1:8080`.
 * @param {string} value - Candidate.
 * @returns {boolean} Result.
 */
const isOrigin = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
};

const configSchema = z.looseObject({
  debug: z.boolean(),
  rawHtml: z.enum(['sanitize', 'allow', 'disable']),
  sanitizeOnSave: z.boolean(),
  encryptionKey: z.string().min(32).max(512).optional(),
  uploads: z.looseObject({
    maxImageBytes: positiveInt(200 * MiB),
    maxFileBytes: positiveInt(500 * MiB),
    maxMediaBytes: positiveInt(200 * MiB),
    allowPrivateOrigins: z.array(z.string().max(300).refine(isOrigin)).max(20),
  }),
  linkPreview: z.looseObject({ enabled: z.boolean(), timeoutMs: z.number().int().min(1000).max(30000) }),
  api: z.looseObject({ autoParseJSON: z.boolean() }),
  ai: z.looseObject({
    allowPrivateBaseUrl: z.boolean(),
    apiKey: z.string().min(1).max(500).optional(),
    requestsPerMinute: positiveInt(1000),
    timeoutMs: z.number().int().min(1000).max(300000),
  }),
  languageTool: z.looseObject({
    allowPrivateBaseUrl: z.boolean(),
    requestsPerMinute: positiveInt(1000),
    timeoutMs: z.number().int().min(1000).max(120000),
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
    maxConnectionsPerAdmin: positiveInt(500),
    maxRoomsPerAdmin: positiveInt(500),
    revalidateSeconds: z.number().int().min(5).max(3600),
    rateLimit: z.looseObject({
      sessionsPerMinute: positiveInt(10000),
      updatesPer10s: positiveInt(100000),
      bytesPer10s: positiveInt(200 * MiB),
    }),
    compaction: z.looseObject({
      enabled: z.boolean(),
      idleSeconds: z
        .number()
        .int()
        .min(15)
        .max(24 * 3600),
      minBytes: z
        .number()
        .int()
        .min(1024)
        .max(512 * MiB),
      ratio: z.number().min(1.5).max(1000),
      checkIntervalSeconds: z.number().int().min(1).max(3600),
    }),
  }),
  history: z.looseObject({ maxSnapshotsPerField: positiveInt(1000) }),
  comments: z.looseObject({ enabled: z.boolean(), perMinute: positiveInt(1000) }),
  qualityChecks: z
    .looseObject({
      externalLinks: z.looseObject({
        enabled: z.boolean(),
        timeoutMs: z.number().int().min(1000).max(15000),
        perMinute: positiveInt(1000),
        allowPrivateOrigins: z.array(z.string().max(300).refine(isOrigin)).max(20),
        schedule: z.looseObject({
          enabled: z.boolean(),
          rule: z.string().max(100).regex(CRON_RULE),
          tz: z.string().max(64).refine(isTimeZone).optional(),
          maxUrlsPerRun: positiveInt(10000),
          perMinute: positiveInt(600),
          perHostConcurrency: positiveInt(8),
        }),
      }),
    })
    .refine((value) => !value.externalLinks.schedule.enabled || value.externalLinks.enabled, {
      path: ['externalLinks', 'schedule', 'enabled'],
    }),
  audit: z.looseObject({
    enabled: z.boolean(),
    retentionDays: z
      .number()
      .int()
      .min(0)
      .max(10 * 366),
  }),
  links: z.looseObject({
    urlPattern: z.string().max(MAX_LINK_PATTERN_LENGTH).refine(isValidLinkPattern),
  }),
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

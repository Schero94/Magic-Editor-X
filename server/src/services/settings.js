'use strict';

const { z } = require('zod');
const { issueDetails } = require('../utils/validation');
const { errors } = require('@strapi/utils');
const { getEncryptionKey, encryptSecret, decryptSecret } = require('../utils/crypto');
const { validateHttpUrl } = require('../utils/url-security');
const { inspectCsp } = require('../../../shared/csp.mjs');
const { paletteCss } = require('../../../shared/inline-format.mjs');
const { paletteContrastIssues } = require('../../../shared/quality.mjs');
const { paletteOf } = require('../utils/inline-policy');
const { mcpStatus } = require('../mcp');
const {
  OFFICIAL_BASE_URLS,
  environmentKeyBaseUrls,
  environmentKeyCovers,
} = require('../../../shared/ai-endpoint.mjs');
const {
  ACTION_KEY_PATTERN,
  ACTION_OUTPUTS,
  ACTION_SCOPES,
  MAX_ACTION_INSTRUCTION_CHARS,
  MAX_ACTION_NAME_CHARS,
  MAX_CUSTOM_ACTIONS,
  MAX_STYLE_GUIDE_CHARS,
  RESERVED_ACTION_KEYS,
  cleanActionName,
} = require('../../../shared/ai-actions.mjs');

/**
 * Admin-editable settings, stored in the plugin store under `settings`.
 *
 * Only the AI assistant is editable here; infrastructure options stay in
 * config/plugins.js. The provider key is encrypted at rest and is never
 * returned: reads expose `hasApiKey` and `apiKeyUnreadable` only.
 *
 * Provider defaults (checked 2026-11-11 in the providers' docs):
 * - Anthropic Messages API, model `claude-opus-5-5`
 *   (https://platform.claude.com/docs, anthropic-version 2026-10-21);
 * - OpenAI Chat Completions, model `gpt-6-luna`
 *   (https://developers.openai.com/api/docs/models/gpt-6-luna);
 * - OpenAI-compatible servers: the owner names the model.
 */

const PROVIDERS = ['anthropic', 'openai', 'openai-compatible'];
const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', openai: 'gpt-6-luna', 'openai-compatible': '' };
const DEFAULT_BASE_URLS = OFFICIAL_BASE_URLS;

const DEFAULT_AI = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: '',
  model: DEFAULT_MODELS.anthropic,
  maxInputChars: 8000,
  maxOutputTokens: 4096,
  apiKeyEncrypted: null,
  /** 2.3: alternative text suggestions send images to the provider (owner opt-in). */
  allowImages: false,
  /** 2.3: translate or summarize a whole field (owner opt-in). */
  allowFieldActions: false,
  /** 2.9: owner-defined actions `{ key, name, instruction, scope, output }`. */
  actions: [],
  /** 2.9: style guide sent with the "Style guide" review (and every text action with `styleGuideForAll`). */
  styleGuide: '',
  styleGuideForAll: false,
};

/** 2.3: optional LanguageTool grammar check (self-hosted or the public API). */
const DEFAULT_LANGUAGE_TOOL = {
  enabled: false,
  baseUrl: '',
  username: '',
  level: 'default',
  apiKeyEncrypted: null,
};
const LANGUAGE_TOOL_SECRET = 'magic-editor-x:languagetool-credentials';

// eslint-disable-next-line no-control-regex -- control characters other than tab and newline are rejected
const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

/** 2.9: one owner-defined AI action. The instruction stays on the server (never sent to editors). */
const customActionSchema = z.strictObject({
  key: z
    .string()
    .regex(ACTION_KEY_PATTERN)
    .refine((key) => !RESERVED_ACTION_KEYS.has(key), { message: 'This key is used by a built-in action' }),
  name: z.string().trim().min(1).max(MAX_ACTION_NAME_CHARS).regex(NO_CONTROL),
  instruction: z.string().trim().min(1).max(MAX_ACTION_INSTRUCTION_CHARS).regex(NO_CONTROL),
  scope: z.enum(ACTION_SCOPES),
  output: z.enum(ACTION_OUTPUTS),
});

/** Action list with unique keys (the key is how field presets and requests name an action). */
const customActionsSchema = z
  .array(customActionSchema)
  .max(MAX_CUSTOM_ACTIONS)
  .superRefine((list, ctx) => {
    const seen = new Set();
    list.forEach((action, index) => {
      if (seen.has(action.key))
        ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Each action needs its own key' });
      seen.add(action.key);
    });
  });

const aiInputSchema = z.strictObject({
  enabled: z.boolean(),
  provider: z.enum(PROVIDERS),
  baseUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)]),
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._:/@-]+$/),
  maxInputChars: z.number().int().min(200).max(50000),
  maxOutputTokens: z.number().int().min(64).max(16000),
  /** undefined keeps the stored key, '' removes it, a value replaces it. */
  apiKey: z.string().max(500).optional(),
  /** 2.3 switches; omitted keeps the stored value (2.2 clients). */
  allowImages: z.boolean().optional(),
  allowFieldActions: z.boolean().optional(),
  /** 2.9; omitted keeps the stored value. */
  actions: customActionsSchema.optional(),
  styleGuide: z.string().max(MAX_STYLE_GUIDE_CHARS).regex(NO_CONTROL).optional(),
  styleGuideForAll: z.boolean().optional(),
});

const languageToolInputSchema = z.strictObject({
  enabled: z.boolean(),
  baseUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)]),
  username: z
    .string()
    .trim()
    .max(200)
    // eslint-disable-next-line no-control-regex -- control characters are rejected
    .regex(/^[^\u0000-\u001f\u007f]*$/),
  level: z.enum(['default', 'picky']),
  /** undefined keeps the stored key, '' removes it, a value replaces it. */
  apiKey: z.string().max(500).optional(),
});

const settingsInputSchema = z.strictObject({
  ai: aiInputSchema,
  /** 2.3; omitted keeps the stored LanguageTool settings. */
  languageTool: languageToolInputSchema.optional(),
  /** 2.7 Core Blocks bridge switch; omitted keeps the stored value (or the config default). */
  coreBlocks: z.strictObject({ enabled: z.boolean() }).optional(),
});

/**
 * Validation error with one field message.
 * @param {string} field - Dotted field path.
 * @param {string} message - Fixed message.
 * @returns {errors.ValidationError} Error.
 */
const fieldError = (field, message) =>
  new errors.ValidationError('Validation failed', { formErrors: [], fieldErrors: { [field]: [message] } });

const store = (strapi) => strapi.store({ type: 'plugin', name: 'magic-editor-x' });

/**
 * Stored owner-defined actions, re-validated (a hand-edited store value never reaches a prompt unchecked).
 * @param {object} ai - Stored AI settings.
 * @returns {Array<{ key: string, name: string, instruction: string, scope: string, output: string }>} Actions.
 */
const storedActions = (ai) => {
  const parsed = customActionsSchema.safeParse(ai && Array.isArray(ai.actions) ? ai.actions : []);
  return parsed.success ? parsed.data : [];
};

/**
 * Stored style guide (string, bounded).
 * @param {object} ai - Stored AI settings.
 * @returns {string} Style guide or ''.
 */
const storedStyleGuide = (ai) =>
  ai && typeof ai.styleGuide === 'string' ? ai.styleGuide.slice(0, MAX_STYLE_GUIDE_CHARS) : '';

module.exports = ({ strapi }) => {
  const config = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.${key}`);
    return value === undefined ? fallback : value;
  };

  let cspReport = null;

  /**
   * Reports the admin CSP sources the editor's embeds and external images
   * miss. Middleware config is fixed for the process lifetime, so the result
   * is computed once (at bootstrap) and cached.
   * @returns {{ active: boolean, frameSrcMissing: string[], imgSrcMissing: boolean, snippet: string }} Report.
   */
  const inspectAdminCsp = () => {
    if (!cspReport) cspReport = inspectCsp(strapi.config.get('middlewares'));
    return cspReport;
  };

  const readRaw = async () => {
    const stored = (await store(strapi).get({ key: 'settings' })) || {};
    const ai = { ...DEFAULT_AI, ...(stored.ai || {}) };
    return {
      ...stored,
      ai: {
        ...ai,
        actions: storedActions(ai),
        styleGuide: storedStyleGuide(ai),
        styleGuideForAll: ai.styleGuideForAll === true,
      },
      languageTool: { ...DEFAULT_LANGUAGE_TOOL, ...(stored.languageTool || {}) },
    };
  };

  /**
   * Validates a LanguageTool base URL: public https unless the owner set
   * `languageTool.allowPrivateBaseUrl` (self-hosted server in the LAN).
   * @param {string} url - Base URL.
   * @returns {void}
   * @throws {errors.ValidationError} When the URL is not allowed.
   */
  const assertLanguageToolUrl = (url) => {
    const allowPrivate = config('languageTool.allowPrivateBaseUrl', false) === true;
    try {
      const parsed = validateHttpUrl(url, { allowPrivate });
      if (parsed.protocol !== 'https:' && !allowPrivate) throw new Error('https required');
      if (parsed.search || parsed.hash) throw new Error('no query');
    } catch {
      throw fieldError(
        'languageTool.baseUrl',
        'The base URL must be a public https URL without query (private hosts need languageTool.allowPrivateBaseUrl).'
      );
    }
  };

  /**
   * Validates LanguageTool input (shared by save and the connection test).
   * @param {object} next - Parsed input.
   * @returns {void}
   * @throws {errors.ValidationError} On a missing base URL or key without user name.
   */
  const checkLanguageTool = (next) => {
    if (next.enabled && !next.baseUrl)
      throw fieldError('languageTool.baseUrl', 'A base URL is required to turn on the grammar check.');
    if (next.baseUrl) assertLanguageToolUrl(next.baseUrl);
    if (next.apiKey && !next.username)
      throw fieldError('languageTool.username', 'An API key needs the user name of the account.');
  };

  /**
   * Returns the effective base URL of a provider.
   * @param {{ provider: string, baseUrl: string }} ai - AI settings.
   * @returns {string} Base URL.
   */
  const effectiveBaseUrl = (ai) => (ai.baseUrl || DEFAULT_BASE_URLS[ai.provider] || '').replace(/\/+$/, '');

  /**
   * The provider key from the plugin config (`ai.apiKey`), or null.
   * @returns {string|null} Key.
   */
  const environmentKey = () => {
    const value = config('ai.apiKey', undefined);
    return typeof value === 'string' && value ? value : null;
  };

  /**
   * Base URLs the environment key is configured for: `ai.apiKeyBaseUrl`, else
   * the official Anthropic and OpenAI APIs. Empty without an environment key.
   * @returns {string[]} Normalised base URLs.
   */
  const environmentKeyUrls = () =>
    environmentKey() ? environmentKeyBaseUrls(config('ai.apiKeyBaseUrl', undefined)) : [];

  /**
   * True when the environment key may be sent with these settings. Like the
   * stored key, it is never sent to another base URL: an admin who points the
   * provider elsewhere must enter a key for that endpoint.
   * @param {{ provider: string, baseUrl: string }} ai - Settings.
   * @returns {boolean} Result.
   */
  const environmentKeyApplies = (ai) => environmentKeyCovers(ai, environmentKeyUrls());

  /**
   * Validates a base URL against the SSRF policy without network access.
   * @param {string} url - Base URL.
   * @returns {void}
   * @throws {errors.ValidationError} When the URL is not allowed.
   */
  const assertBaseUrl = (url) => {
    try {
      const parsed = validateHttpUrl(url, { allowPrivate: config('ai.allowPrivateBaseUrl', false) === true });
      if (parsed.protocol !== 'https:' && !config('ai.allowPrivateBaseUrl', false)) {
        throw new Error('https required');
      }
    } catch {
      throw new errors.ValidationError('Validation failed', {
        formErrors: [],
        fieldErrors: {
          'ai.baseUrl': [
            'The base URL must be a public https URL (private hosts need ai.allowPrivateBaseUrl).',
          ],
        },
      });
    }
  };

  /**
   * Shapes stored settings for the admin: secrets become flags.
   * @param {object} raw - Stored settings.
   * @returns {object} DTO.
   */
  /**
   * 2.7: state of the Core Blocks bridge for the settings page (type names only, no content).
   * @returns {object|undefined} DTO part; undefined when the service is missing.
   */
  const coreBlocksDto = () => {
    try {
      return strapi.plugin('magic-editor-x').service('core-blocks').status();
    } catch {
      return undefined;
    }
  };

  const toDto = (raw) => {
    const key = getEncryptionKey(strapi);
    const { apiKeyEncrypted, ...ai } = raw.ai;
    // The environment key counts only for the endpoint it is configured for.
    const envKey = environmentKeyApplies(raw.ai);
    const { apiKeyEncrypted: ltKey, ...languageTool } = raw.languageTool || DEFAULT_LANGUAGE_TOOL;
    return {
      coreBlocks: coreBlocksDto(),
      languageTool: {
        ...languageTool,
        hasApiKey: Boolean(ltKey),
        apiKeyUnreadable:
          Boolean(ltKey) && (!key || decryptSecret(ltKey, key, LANGUAGE_TOOL_SECRET) === null),
        canStoreApiKey: Boolean(key),
      },
      ai: {
        ...ai,
        hasApiKey: envKey || Boolean(apiKeyEncrypted),
        hasStoredApiKey: Boolean(apiKeyEncrypted),
        apiKeyFromEnvironment: envKey,
        // Base URLs the `ai.apiKey` key is sent to ([] without one); no key material.
        apiKeyEnvironmentBaseUrls: environmentKeyUrls(),
        apiKeyUnreadable:
          !envKey && Boolean(apiKeyEncrypted) && (!key || decryptSecret(apiKeyEncrypted, key) === null),
        canStoreApiKey: Boolean(key),
      },
      environment: {
        allowPrivateBaseUrl: config('ai.allowPrivateBaseUrl', false) === true,
        requestsPerMinute: config('ai.requestsPerMinute', 20),
        // 2.4: private image storage origins for alt text (config only, shown read-only).
        altTextPrivateOrigins: (() => {
          const list = config('ai.altText.allowPrivateOrigins', []);
          return Array.isArray(list) ? list.filter((item) => typeof item === 'string').slice(0, 20) : [];
        })(),
        languageTool: {
          allowPrivateBaseUrl: config('languageTool.allowPrivateBaseUrl', false) === true,
          requestsPerMinute: config('languageTool.requestsPerMinute', 30),
        },
        defaults: { models: DEFAULT_MODELS, baseUrls: DEFAULT_BASE_URLS },
        collaboration: {
          enabled: config('collaboration.enabled', true) !== false,
          path: config('collaboration.path', '/magic-editor-x/realtime'),
          pollIntervalMs: config('collaboration.pollIntervalMs', 400),
          snapshotIntervalMinutes: config('collaboration.snapshotIntervalMinutes', 10),
        },
        // 2.4: mention e-mails (config only, shown read-only).
        mentionEmails: {
          enabled: config('comments.notifications.email', false) === true,
          available: (() => {
            try {
              return Boolean(strapi.plugin('email'));
            } catch {
              return false;
            }
          })(),
          perHour: config('comments.notifications.emailPerHour', 10),
        },
        rawHtml: config('rawHtml', 'sanitize'),
        // 2.5: MCP tools for AI clients (config only, shown read-only).
        mcp: (({ enabled, serverEnabled, active, path }) => ({ enabled, serverEnabled, active, path }))(
          mcpStatus(strapi)
        ),
        uploads: {
          maxImageBytes: config('uploads.maxImageBytes', 10 * 1024 * 1024),
          maxFileBytes: config('uploads.maxFileBytes', 20 * 1024 * 1024),
        },
        csp: inspectAdminCsp(),
        // 2.5: colour palette (config only, shown read-only with its contrast problems and the site CSS).
        palette: (() => {
          const palette = paletteOf(strapi);
          return {
            ...palette,
            issues: paletteContrastIssues(palette),
            css: paletteCss(palette),
            annotations: (() => {
              try {
                return strapi
                  .plugin('magic-editor-x')
                  .service('blocks')
                  .annotationSummaries()
                  .map(({ name, label, builtIn, resolves }) => ({ name, label, builtIn, resolves }));
              } catch {
                return [];
              }
            })(),
          };
        })(),
      },
    };
  };

  /**
   * Adds the read-only state of the scheduled link check (counts only, no URLs).
   * @param {object} dto - Settings DTO.
   * @returns {Promise<object>} The same DTO.
   */
  const withLinkSchedule = async (dto) => {
    let state = null;
    try {
      const status = await strapi.plugin('magic-editor-x').service('link-schedule').status();
      state = {
        enabled: status.enabled,
        scheduled: status.scheduled,
        rule: status.rule,
        tz: status.tz || null,
        nextRunAt: status.nextRunAt || null,
        running: status.running === true,
        maxUrlsPerRun: status.maxUrlsPerRun,
        perMinute: status.perMinute,
        lastRun: status.lastRun
          ? {
              finishedAt: status.lastRun.finishedAt,
              complete: status.lastRun.complete === true,
              checked: Number(status.lastRun.checked) || 0,
              problems: Number(status.lastRun.problems) || 0,
            }
          : null,
      };
    } catch {
      // the schedule state is optional information
    }
    dto.environment.linkSchedule = state;
    return dto;
  };

  /**
   * Builds the stored LanguageTool settings from validated input. Changing
   * the base URL or user name while a key is stored requires the key again,
   * so a stored key can never be redirected to another server.
   * @param {object} next - Parsed input.
   * @param {object} current - Stored settings.
   * @returns {object} Settings to store.
   * @throws {errors.ValidationError} On invalid combinations.
   */
  const nextLanguageTool = (next, current) => {
    checkLanguageTool(next);
    const endpointChanged = next.baseUrl !== current.baseUrl || next.username !== current.username;
    let apiKeyEncrypted = current.apiKeyEncrypted;
    if (next.apiKey === '') apiKeyEncrypted = null;
    else if (typeof next.apiKey === 'string') {
      const key = getEncryptionKey(strapi);
      if (!key)
        throw fieldError(
          'languageTool.apiKey',
          'Set MAGIC_EDITOR_X_ENCRYPTION_KEY (32+ characters) to store an API key.'
        );
      apiKeyEncrypted = encryptSecret(next.apiKey.trim(), key, LANGUAGE_TOOL_SECRET);
    } else if (endpointChanged && current.apiKeyEncrypted) {
      throw fieldError(
        'languageTool.apiKey',
        'Enter the API key again when you change the base URL or user name.'
      );
    }
    if (apiKeyEncrypted && !next.username)
      throw fieldError('languageTool.username', 'An API key needs the user name of the account.');
    return {
      enabled: next.enabled,
      baseUrl: next.baseUrl,
      username: next.username,
      level: next.level,
      apiKeyEncrypted,
    };
  };

  return {
    PROVIDERS,
    DEFAULT_MODELS,
    DEFAULT_BASE_URLS,
    effectiveBaseUrl,
    inspectAdminCsp,

    /**
     * Settings for the settings page (no secrets).
     * @returns {Promise<object>} DTO.
     */
    async get() {
      return withLinkSchedule(toDto(await readRaw()));
    },

    /**
     * Validates and stores settings. Changing the provider or base URL
     * requires the key to be entered again, so a stored key can never be
     * redirected to another host.
     * @param {unknown} input - Request body.
     * @returns {Promise<object>} Stored settings DTO.
     * @throws {errors.ValidationError} On invalid input or a missing key re-entry.
     * @sideeffect Writes the plugin store key `settings`; a sent `coreBlocks.enabled` (2.7) installs or
     *   removes the Core Blocks bridge in this process at once (other processes follow within 30 s).
     */
    async update(input) {
      const parsed = settingsInputSchema.safeParse(input);
      if (!parsed.success) throw new errors.ValidationError('Validation failed', issueDetails(parsed.error));
      const next = parsed.data.ai;
      const raw = await readRaw();
      const current = raw.ai;
      const endpointChanged = next.provider !== current.provider || next.baseUrl !== current.baseUrl;
      if (next.provider === 'openai-compatible' && !next.baseUrl) {
        throw new errors.ValidationError('Validation failed', {
          formErrors: [],
          fieldErrors: { 'ai.baseUrl': ['A base URL is required for OpenAI-compatible providers.'] },
        });
      }
      if (next.baseUrl) assertBaseUrl(next.baseUrl);

      let apiKeyEncrypted = current.apiKeyEncrypted;
      if (next.apiKey === '') apiKeyEncrypted = null;
      else if (typeof next.apiKey === 'string') {
        const key = getEncryptionKey(strapi);
        if (!key) {
          throw new errors.ValidationError('Validation failed', {
            formErrors: [],
            fieldErrors: {
              'ai.apiKey': ['Set MAGIC_EDITOR_X_ENCRYPTION_KEY (32+ characters) to store an API key.'],
            },
          });
        }
        apiKeyEncrypted = encryptSecret(next.apiKey.trim(), key);
      } else if (endpointChanged && environmentKeyApplies(next)) {
        // The environment key is used there. A key stored for the previous endpoint is dropped,
        // so it can never reach this one (for example after ai.apiKey is removed from the config).
        apiKeyEncrypted = null;
      } else if (endpointChanged && (current.apiKeyEncrypted || environmentKey())) {
        // Neither the stored key nor the environment key is redirected to another endpoint.
        throw new errors.ValidationError('Validation failed', {
          formErrors: [],
          fieldErrors: {
            'ai.apiKey': [
              current.apiKeyEncrypted
                ? 'Enter the API key again when you change the provider or base URL.'
                : 'Enter an API key for this base URL. The ai.apiKey key is only sent to the base URL it is configured for (ai.apiKeyBaseUrl).',
            ],
          },
        });
      }

      const ai = {
        enabled: next.enabled,
        provider: next.provider,
        baseUrl: next.baseUrl,
        model: next.model,
        maxInputChars: next.maxInputChars,
        maxOutputTokens: next.maxOutputTokens,
        apiKeyEncrypted,
        allowImages: next.allowImages ?? current.allowImages === true,
        allowFieldActions: next.allowFieldActions ?? current.allowFieldActions === true,
        // 2.9: omitted keeps the stored actions and style guide (older admin clients).
        actions: next.actions
          ? next.actions.map((action) => ({ ...action, name: cleanActionName(action.name) }))
          : storedActions(current),
        styleGuide: next.styleGuide !== undefined ? next.styleGuide.trim() : storedStyleGuide(current),
        styleGuideForAll: next.styleGuideForAll ?? current.styleGuideForAll === true,
      };
      const languageTool = parsed.data.languageTool
        ? nextLanguageTool(parsed.data.languageTool, raw.languageTool)
        : raw.languageTool;
      const coreBlocks = parsed.data.coreBlocks
        ? { enabled: parsed.data.coreBlocks.enabled }
        : raw.coreBlocks;
      const value = { ...raw, ai, languageTool, ...(coreBlocks ? { coreBlocks } : {}) };
      await store(strapi).set({ key: 'settings', value });
      // 2.7: this process follows the switch at once, the others within 30 seconds.
      if (parsed.data.coreBlocks)
        await strapi.plugin('magic-editor-x').service('core-blocks').setEnabled(coreBlocks.enabled);
      return withLinkSchedule(toDto(value));
    },

    /**
     * LanguageTool settings with the decrypted key, for the grammar service only.
     * @param {object} [override] - Unsaved, parsed settings for a connection test.
     * @returns {Promise<{ languageTool: object, apiKey: string|null }>} Runtime settings.
     */
    async runtimeLanguageTool(override) {
      const raw = await readRaw();
      const stored = raw.languageTool;
      const languageTool = override ? { ...stored, ...override } : stored;
      let apiKey =
        override && typeof override.apiKey === 'string' && override.apiKey ? override.apiKey : null;
      const sameEndpoint =
        !override || (override.baseUrl === stored.baseUrl && override.username === stored.username);
      // A stored key is only ever sent to the server and account it was saved for.
      if (!apiKey && sameEndpoint && !(override && override.apiKey === '') && stored.apiKeyEncrypted) {
        const key = getEncryptionKey(strapi);
        apiKey = key ? decryptSecret(stored.apiKeyEncrypted, key, LANGUAGE_TOOL_SECRET) : null;
      }
      return { languageTool, apiKey };
    },

    /**
     * Parses LanguageTool input (connection test).
     * @param {unknown} input - Request body part.
     * @returns {object} Parsed settings.
     * @throws {errors.ValidationError} On invalid input.
     */
    parseLanguageToolInput(input) {
      const parsed = languageToolInputSchema.safeParse(input);
      if (!parsed.success) {
        const details = issueDetails(parsed.error);
        const fieldErrors = {};
        for (const [key, value] of Object.entries(details.fieldErrors || {}))
          fieldErrors[`languageTool.${key}`] = value;
        throw new errors.ValidationError('Validation failed', { ...details, fieldErrors });
      }
      if (!parsed.data.baseUrl) throw fieldError('languageTool.baseUrl', 'A base URL is required.');
      checkLanguageTool(parsed.data);
      return parsed.data;
    },

    /**
     * Settings with the decrypted key, for the AI service only. Never returned to a client.
     *
     * Key choice: a key entered for a connection test; else the environment key
     * (`ai.apiKey`) when the endpoint is the one it is configured for; else the
     * stored key when the endpoint is the one it was saved for. No key is ever
     * sent to another endpoint without being entered again.
     * @param {object} [override] - Unsaved settings for a connection test.
     * @returns {Promise<{ ai: object, apiKey: string|null }>} Runtime settings.
     */
    async runtimeAi(override) {
      const raw = await readRaw();
      const ai = override ? { ...raw.ai, ...override } : raw.ai;
      const entered =
        override && typeof override.apiKey === 'string' && override.apiKey.trim()
          ? override.apiKey.trim()
          : null;
      if (entered) return { ai, apiKey: entered };
      const envKey = environmentKey();
      if (envKey && environmentKeyApplies(ai)) return { ai, apiKey: envKey };
      const sameEndpoint =
        !override || (override.provider === raw.ai.provider && override.baseUrl === raw.ai.baseUrl);
      let apiKey = null;
      if (sameEndpoint && !(override && override.apiKey === '') && raw.ai.apiKeyEncrypted) {
        const key = getEncryptionKey(strapi);
        apiKey = key ? decryptSecret(raw.ai.apiKeyEncrypted, key) : null;
      }
      return { ai, apiKey };
    },

    /** Parses settings input (used by the AI connection test). */
    parseAiInput(input) {
      const parsed = aiInputSchema.safeParse(input);
      if (!parsed.success) throw new errors.ValidationError('Validation failed', issueDetails(parsed.error));
      if (parsed.data.provider === 'openai-compatible' && !parsed.data.baseUrl) {
        throw new errors.ValidationError('Validation failed', {
          formErrors: [],
          fieldErrors: { 'ai.baseUrl': ['A base URL is required for OpenAI-compatible providers.'] },
        });
      }
      if (parsed.data.baseUrl) assertBaseUrl(parsed.data.baseUrl);
      return parsed.data;
    },
  };
};

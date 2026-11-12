'use strict';

const { z } = require('zod');
const { issueDetails } = require('../utils/validation');
const { errors } = require('@strapi/utils');
const { getEncryptionKey, encryptSecret, decryptSecret } = require('../utils/crypto');
const { validateHttpUrl } = require('../utils/url-security');
const { inspectCsp } = require('../../../shared/csp.mjs');

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
const DEFAULT_BASE_URLS = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'openai-compatible': '',
};

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
    return {
      ...stored,
      ai: { ...DEFAULT_AI, ...(stored.ai || {}) },
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
  const toDto = (raw) => {
    const key = getEncryptionKey(strapi);
    const { apiKeyEncrypted, ...ai } = raw.ai;
    const envKey = Boolean(config('ai.apiKey', undefined));
    const { apiKeyEncrypted: ltKey, ...languageTool } = raw.languageTool || DEFAULT_LANGUAGE_TOOL;
    return {
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
        apiKeyFromEnvironment: envKey,
        apiKeyUnreadable:
          !envKey && Boolean(apiKeyEncrypted) && (!key || decryptSecret(apiKeyEncrypted, key) === null),
        canStoreApiKey: Boolean(key),
      },
      environment: {
        allowPrivateBaseUrl: config('ai.allowPrivateBaseUrl', false) === true,
        requestsPerMinute: config('ai.requestsPerMinute', 20),
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
        rawHtml: config('rawHtml', 'sanitize'),
        uploads: {
          maxImageBytes: config('uploads.maxImageBytes', 10 * 1024 * 1024),
          maxFileBytes: config('uploads.maxFileBytes', 20 * 1024 * 1024),
        },
        csp: inspectAdminCsp(),
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
      } else if (endpointChanged && current.apiKeyEncrypted) {
        throw new errors.ValidationError('Validation failed', {
          formErrors: [],
          fieldErrors: { 'ai.apiKey': ['Enter the API key again when you change the provider or base URL.'] },
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
      };
      const languageTool = parsed.data.languageTool
        ? nextLanguageTool(parsed.data.languageTool, raw.languageTool)
        : raw.languageTool;
      const value = { ...raw, ai, languageTool };
      await store(strapi).set({ key: 'settings', value });
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
     * @param {object} [override] - Unsaved settings for a connection test.
     * @returns {Promise<{ ai: object, apiKey: string|null }>} Runtime settings.
     */
    async runtimeAi(override) {
      const raw = await readRaw();
      const ai = override ? { ...raw.ai, ...override } : raw.ai;
      const envKey = config('ai.apiKey', undefined);
      let apiKey = typeof envKey === 'string' && envKey ? envKey : null;
      if (!apiKey && override && typeof override.apiKey === 'string' && override.apiKey)
        apiKey = override.apiKey;
      if (!apiKey && ai.apiKeyEncrypted) {
        const key = getEncryptionKey(strapi);
        apiKey = key ? decryptSecret(ai.apiKeyEncrypted, key) : null;
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

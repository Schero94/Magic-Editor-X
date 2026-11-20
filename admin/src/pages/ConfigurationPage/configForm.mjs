/**
 * Pure helpers for the Configuration page: draft shape, validation that mirrors
 * the server schema (server/src/services/settings.js), payload building and the
 * "what did the server change" comparison. No React, so `node --test` covers it.
 */

import { OFFICIAL_BASE_URLS, environmentKeyCovers } from '../../../../shared/ai-endpoint.mjs';

export const PROVIDERS = Object.freeze(['anthropic', 'openai', 'openai-compatible']);
export const MODEL_PATTERN = /^[A-Za-z0-9._:/@-]+$/;
export const LIMITS = Object.freeze({
  maxInputChars: Object.freeze({ min: 200, max: 50000 }),
  maxOutputTokens: Object.freeze({ min: 64, max: 16000 }),
});
const EDITABLE = ['enabled', 'provider', 'baseUrl', 'model', 'maxInputChars', 'maxOutputTokens'];
/** 2.3 owner switches; absent in DTOs of older servers, then never sent. */
const SWITCHES = ['allowImages', 'allowFieldActions'];
const LANGUAGE_TOOL_EDITABLE = ['enabled', 'baseUrl', 'username', 'level'];

/**
 * Builds the LanguageTool draft (2.3) from `data.languageTool`.
 * @param {object|undefined} languageTool - DTO part.
 * @returns {object|undefined} Draft, undefined when the server has no LanguageTool settings.
 */
export const toLanguageToolDraft = (languageTool) =>
  languageTool
    ? {
        enabled: Boolean(languageTool.enabled),
        baseUrl: languageTool.baseUrl || '',
        username: languageTool.username || '',
        level: languageTool.level === 'picky' ? 'picky' : 'default',
        apiKeyMode: 'keep',
        apiKey: '',
      }
    : undefined;

/**
 * Builds the form draft from the server DTO.
 * @param {object} ai - `data.ai` from GET /settings.
 * @param {object} [languageTool] - `data.languageTool` (2.3).
 * @param {object} [coreBlocks] - `data.coreBlocks` (2.7); absent on older servers, then never sent.
 * @returns {object} Draft.
 */
export const toDraft = (ai, languageTool, coreBlocks) => ({
  ...Object.fromEntries(SWITCHES.filter((key) => typeof ai[key] === 'boolean').map((key) => [key, ai[key]])),
  ...(languageTool ? { languageTool: toLanguageToolDraft(languageTool) } : {}),
  ...(coreBlocks && typeof coreBlocks.enabled === 'boolean'
    ? { coreBlocks: { enabled: coreBlocks.enabled } }
    : {}),
  enabled: Boolean(ai.enabled),
  provider: PROVIDERS.includes(ai.provider) ? ai.provider : 'anthropic',
  baseUrl: ai.baseUrl || '',
  model: ai.model || '',
  maxInputChars: ai.maxInputChars ?? 8000,
  maxOutputTokens: ai.maxOutputTokens ?? 4096,
  apiKeyMode: 'keep',
  apiKey: '',
});

/**
 * Applies a provider change: the model follows the provider's default when it
 * still holds the previous provider's default (or is empty).
 * @param {object} draft - Draft.
 * @param {string} provider - New provider.
 * @param {Record<string, string>} defaultModels - environment.defaults.models.
 * @returns {object} New draft.
 */
export const applyProvider = (draft, provider, defaultModels = {}) => {
  const previousDefault = defaultModels[draft.provider] || '';
  const model = !draft.model || draft.model === previousDefault ? defaultModels[provider] || '' : draft.model;
  return { ...draft, provider, model };
};

/**
 * True when the endpoint (provider or base URL) differs from the stored one.
 * @param {object} draft - Draft.
 * @param {object} saved - Stored draft.
 * @returns {boolean} Changed or not.
 */
export const endpointChanged = (draft, saved) =>
  draft.provider !== saved.provider || draft.baseUrl !== saved.baseUrl;

/**
 * True when the server sends the `ai.apiKey` key from config/plugins.js with
 * these settings: only to the base URLs it is configured for
 * (`ai.apiKeyEnvironmentBaseUrls`, the same rule as the server). DTOs of older
 * servers without that list fall back to `apiKeyFromEnvironment`.
 * @param {object} draft - Draft (provider, base URL).
 * @param {object} ai - Stored DTO.
 * @param {{ baseUrls?: Record<string, string> }} [defaults] - environment.defaults.
 * @returns {boolean} Result.
 */
export const environmentKeyApplies = (draft, ai, defaults) => {
  if (!ai) return false;
  if (!Array.isArray(ai.apiKeyEnvironmentBaseUrls)) return Boolean(ai.apiKeyFromEnvironment);
  const baseUrls = { ...OFFICIAL_BASE_URLS, ...((defaults && defaults.baseUrls) || {}) };
  return environmentKeyCovers(draft, ai.apiKeyEnvironmentBaseUrls, baseUrls);
};

/**
 * Validates the draft with the server's rules. Returns error codes per field.
 * @param {object} draft - Draft.
 * @param {{ saved: object, ai: object, environment: object }} context - Stored draft, stored DTO and environment.
 * @returns {Record<string, string>} Field -> error code.
 */
export const validateDraft = (draft, { saved, ai, environment }) => {
  const errors = {};
  if (!PROVIDERS.includes(draft.provider)) errors.provider = 'required';
  const model = String(draft.model || '').trim();
  if (!model) errors.model = 'required';
  else if (model.length > 120 || !MODEL_PATTERN.test(model)) errors.model = 'modelPattern';
  const baseUrl = String(draft.baseUrl || '').trim();
  if (!baseUrl && draft.provider === 'openai-compatible') errors.baseUrl = 'required';
  if (baseUrl) {
    const url = (() => {
      try {
        return new URL(baseUrl);
      } catch {
        return null;
      }
    })();
    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      baseUrl.length > 500
    ) {
      errors.baseUrl = 'url';
    } else if (url.protocol !== 'https:' && !(environment && environment.allowPrivateBaseUrl)) {
      errors.baseUrl = 'https';
    }
  }
  for (const key of ['maxInputChars', 'maxOutputTokens']) {
    const value = draft[key];
    const { min, max } = LIMITS[key];
    if (value === undefined || value === null || value === '') errors[key] = 'required';
    else if (!Number.isInteger(value) || value < min || value > max) errors[key] = 'range';
  }
  if (draft.apiKeyMode === 'replace') {
    const key = String(draft.apiKey || '').trim();
    if (!key) errors.apiKey = 'required';
    else if (key.length > 500) errors.apiKey = 'tooLong';
    else if (ai && !ai.canStoreApiKey) errors.apiKey = 'cannotStore';
  } else if (
    draft.apiKeyMode === 'keep' &&
    saved &&
    endpointChanged(draft, saved) &&
    ai &&
    !environmentKeyApplies(draft, ai, environment && environment.defaults) &&
    (ai.hasApiKey || (Array.isArray(ai.apiKeyEnvironmentBaseUrls) && ai.apiKeyEnvironmentBaseUrls.length > 0))
  ) {
    // Neither the stored key nor the ai.apiKey key is sent to another endpoint.
    errors.apiKey = 'reenter';
  }
  return errors;
};

/**
 * Builds the PUT body. `apiKey` is omitted (keep), '' (remove) or the new value.
 * @param {object} draft - Draft.
 * @param {object} [saved] - Stored draft; `coreBlocks` is sent only when it differs from it.
 * @returns {{ ai: object, languageTool?: object, coreBlocks?: { enabled: boolean } }} Body.
 */
export const toPayload = (draft, saved) => {
  const ai = {
    enabled: Boolean(draft.enabled),
    provider: draft.provider,
    baseUrl: String(draft.baseUrl || '').trim(),
    model: String(draft.model || '').trim(),
    maxInputChars: draft.maxInputChars,
    maxOutputTokens: draft.maxOutputTokens,
  };
  if (draft.apiKeyMode === 'remove') ai.apiKey = '';
  if (draft.apiKeyMode === 'replace') ai.apiKey = String(draft.apiKey || '').trim();
  for (const key of SWITCHES) if (typeof draft[key] === 'boolean') ai[key] = draft[key];
  const languageTool = draft.languageTool ? toLanguageToolPayload(draft.languageTool) : null;
  const body = languageTool ? { ai, languageTool } : { ai };
  // 2.7: sent only when the switch changed, so saving other settings never pins the config default.
  if (
    draft.coreBlocks &&
    saved &&
    (!saved.coreBlocks || draft.coreBlocks.enabled !== saved.coreBlocks.enabled)
  )
    body.coreBlocks = { enabled: Boolean(draft.coreBlocks.enabled) };
  return body;
};

/**
 * LanguageTool part of the PUT body. `apiKey` is omitted (keep), '' (remove) or the new value.
 * @param {object} lt - LanguageTool draft.
 * @returns {object} Body part.
 */
export const toLanguageToolPayload = (lt) => {
  const out = {
    enabled: Boolean(lt.enabled),
    baseUrl: String(lt.baseUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    username: String(lt.username || '').trim(),
    level: lt.level === 'picky' ? 'picky' : 'default',
  };
  if (lt.apiKeyMode === 'remove') out.apiKey = '';
  if (lt.apiKeyMode === 'replace') out.apiKey = String(lt.apiKey || '').trim();
  return out;
};

/**
 * Validates the LanguageTool draft with the server's rules.
 * @param {object|undefined} lt - Draft.
 * @param {{ saved?: object, dto?: object, environment?: object }} context - Stored draft, DTO and environment.
 * @returns {Record<string, string>} `languageTool.<field>` -> error code.
 */
export const validateLanguageTool = (lt, { saved, dto, environment } = {}) => {
  const errors = {};
  if (!lt) return errors;
  const allowPrivate = Boolean(
    environment && environment.languageTool && environment.languageTool.allowPrivateBaseUrl
  );
  const baseUrl = String(lt.baseUrl || '').trim();
  if (!baseUrl && lt.enabled) errors['languageTool.baseUrl'] = 'required';
  if (baseUrl) {
    const url = (() => {
      try {
        return new URL(baseUrl);
      } catch {
        return null;
      }
    })();
    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      baseUrl.length > 500
    )
      errors['languageTool.baseUrl'] = 'url';
    else if (url.protocol !== 'https:' && !allowPrivate) errors['languageTool.baseUrl'] = 'httpsLanguageTool';
  }
  if (String(lt.username || '').length > 200) errors['languageTool.username'] = 'invalid';
  if (lt.apiKeyMode === 'replace') {
    const key = String(lt.apiKey || '').trim();
    if (!key) errors['languageTool.apiKey'] = 'required';
    else if (key.length > 500) errors['languageTool.apiKey'] = 'tooLong';
    else if (dto && !dto.canStoreApiKey) errors['languageTool.apiKey'] = 'cannotStore';
    if (!String(lt.username || '').trim()) errors['languageTool.username'] = 'required';
  } else if (
    lt.apiKeyMode === 'keep' &&
    saved &&
    dto &&
    dto.hasApiKey &&
    (String(lt.baseUrl || '').trim() !== saved.baseUrl || String(lt.username || '').trim() !== saved.username)
  ) {
    errors['languageTool.apiKey'] = 'reenterLanguageTool';
  }
  return errors;
};

/**
 * Errors the form shows (2.7.8). Client errors of a field show once the user left it (`touched`)
 * or after Save or a test (`showErrors`); errors a connection test raised (`testErrors`, for
 * example an empty base URL) show until the field changes; server errors always show.
 * @param {{ errors?: Record<string, string>, serverErrors?: Record<string, string>, testErrors?: Record<string, string>, touched?: Record<string, boolean>, showErrors?: boolean }} state - Form state.
 * @returns {Record<string, string|{ server: string }>} Field -> error code, or `{ server }` for a server message.
 */
export const visibleFormErrors = ({
  errors = {},
  serverErrors = {},
  testErrors = {},
  touched = {},
  showErrors = false,
}) => {
  const merged = {};
  for (const [key, value] of Object.entries(errors)) if (showErrors || touched[key]) merged[key] = value;
  for (const [key, value] of Object.entries(testErrors)) if (!merged[key]) merged[key] = value;
  for (const [key, value] of Object.entries(serverErrors)) merged[key] = { server: value };
  return merged;
};

/**
 * Names the editable fields whose stored value differs from what was sent.
 * @param {object} draft - Sent draft.
 * @param {object} stored - Draft built from the server response.
 * @returns {string[]} Field names.
 */
export const adjustedFields = (draft, stored) =>
  EDITABLE.filter((key) => {
    const sent = key === 'baseUrl' || key === 'model' ? String(draft[key] || '').trim() : draft[key];
    return sent !== stored[key];
  });

/**
 * Maps server `details.fieldErrors` (zod flattenError, keys like `ai.apiKey`)
 * to draft fields. Unknown keys go to `_form`.
 * @param {unknown} details - Error details.
 * @returns {Record<string, string>} Field -> server message.
 */
export const mapServerErrors = (details) => {
  const out = {};
  const fieldErrors = details && typeof details === 'object' ? details.fieldErrors || {} : {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const message = Array.isArray(messages) ? messages[0] : String(messages || '');
    const field = key.startsWith('ai.') ? key.slice(3) : null;
    if (field && EDITABLE.concat(['apiKey'], SWITCHES).includes(field)) out[field] = message;
    else if (/^languageTool\.(enabled|baseUrl|username|level|apiKey)$/.test(key)) out[key] = message;
    else if (key === 'coreBlocks.enabled') out[key] = message;
    else out._form = message;
  }
  if (!Object.keys(out).length && details && Array.isArray(details.formErrors) && details.formErrors[0]) {
    out._form = details.formErrors[0];
  }
  return out;
};

/**
 * Draft comparison for the dirty flag (the API key counts when it is being replaced or removed).
 * @param {object} a - Draft.
 * @param {object} b - Draft.
 * @returns {boolean} Equal or not.
 */
export const sameDraft = (a, b) =>
  EDITABLE.every((key) => a[key] === b[key]) &&
  SWITCHES.every((key) => a[key] === b[key]) &&
  a.apiKeyMode === b.apiKeyMode &&
  (a.apiKeyMode !== 'replace' || a.apiKey === b.apiKey) &&
  sameLanguageTool(a.languageTool, b.languageTool) &&
  Boolean(a.coreBlocks && a.coreBlocks.enabled) === Boolean(b.coreBlocks && b.coreBlocks.enabled);

/**
 * LanguageTool draft comparison.
 * @param {object|undefined} a - Draft.
 * @param {object|undefined} b - Draft.
 * @returns {boolean} Equal or not.
 */
const sameLanguageTool = (a, b) => {
  if (!a || !b) return a === b;
  return (
    LANGUAGE_TOOL_EDITABLE.every((key) => a[key] === b[key]) &&
    a.apiKeyMode === b.apiKeyMode &&
    (a.apiKeyMode !== 'replace' || a.apiKey === b.apiKey)
  );
};

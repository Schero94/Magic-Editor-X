/**
 * Messages for the AI error codes the server answers with (`details.code`), shared by the three
 * AI dialogs (2.7.8). 2.7.7 added UNREACHABLE, BAD_RESPONSE, RESPONSE_TOO_LARGE, EMPTY and
 * PROVIDER_ERROR (server/src/controllers/ai.js); the dialogs showed the generic message for them.
 * Each entry is [translation id, English default].
 */
export const AI_ERROR_MESSAGES = Object.freeze({
  DISABLED: ['editor.ai.error.disabled', 'The AI assistant is turned off.'],
  NOT_CONFIGURED: ['editor.ai.error.notConfigured', 'The AI assistant is not configured yet.'],
  NO_API_KEY: ['editor.ai.error.noKey', 'The AI provider key is missing.'],
  AUTH_FAILED: ['editor.ai.error.auth', 'The AI provider rejected the key.'],
  PROVIDER_RATE_LIMIT: ['editor.ai.error.busy', 'The AI provider is busy. Try again later.'],
  TIMEOUT: ['editor.ai.error.timeout', 'The AI provider did not answer in time.'],
  REFUSED: ['editor.ai.error.refused', 'The AI provider declined this request.'],
  UNREACHABLE: ['editor.ai.error.unreachable', 'The AI provider could not be reached. Try again later.'],
  BAD_RESPONSE: ['editor.ai.error.badResponse', 'The AI answer had an unexpected format. Nothing changed.'],
  RESPONSE_TOO_LARGE: ['editor.ai.error.tooLarge', 'The AI answer is too large. Try a shorter text.'],
  EMPTY: ['editor.ai.error.empty', 'The AI provider answered with no text. Try again.'],
  PROVIDER_ERROR: ['editor.ai.error.provider', 'The AI provider answered with an error. Try again later.'],
});

/**
 * The message entry for a code, with per-dialog entries first.
 * @param {string|null|undefined} code - Server code.
 * @param {Record<string, [string, string]>} [own] - Dialog-specific entries.
 * @returns {[string, string]|null} Entry.
 */
export const aiErrorEntry = (code, own = {}) => {
  if (typeof code !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(own, code)) return own[code];
  return Object.prototype.hasOwnProperty.call(AI_ERROR_MESSAGES, code) ? AI_ERROR_MESSAGES[code] : null;
};

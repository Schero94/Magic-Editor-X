import { API, readApiError } from '../utils/api';
import { el, button } from './tools/dom';

/**
 * Alternative text suggestions (2.3), reusable by every image tool (image
 * block, gallery, ...).
 *
 * - `createAltTextSuggester({ post, getTarget, getLocale })` returns
 *   `suggest(fileId, { signal })`, which asks the server
 *   (`POST /ai/image/alt-text`) and resolves to the suggested plain text.
 *   It rejects with `{ code, status }` (see `altTextErrorText`).
 * - `createAltSuggestion({ t, getFileId, suggest, onUse, readOnly })`
 *   builds the DOM control: a "Suggest alternative text" button, a status
 *   line (live region) and the suggestion with "Use suggestion" and "Dismiss".
 *   Nothing is written until the editor chooses "Use suggestion".
 *
 * The server only answers when the owner turned on "Send images to the AI
 * provider", the field allows AI and the admin may read the file in the
 * Media Library; the editor field passes `suggest` only in that case.
 */

const ERRORS = {
  IMAGES_DISABLED: ['tools.image.aiAlt.error.off', 'Alternative text suggestions are turned off.'],
  DISABLED: ['tools.image.aiAlt.error.off', 'Alternative text suggestions are turned off.'],
  IMAGE_UNSUPPORTED: ['tools.image.aiAlt.error.format', 'Only JPEG, PNG, GIF and WebP can be described.'],
  IMAGE_TOO_LARGE: ['tools.image.aiAlt.error.large', 'The image is too large to send.'],
  IMAGE_UNREADABLE: ['tools.image.aiAlt.error.read', 'The image file could not be read.'],
  REFUSED: ['tools.image.aiAlt.error.refused', 'The AI provider declined this image.'],
  TIMEOUT: ['tools.image.aiAlt.error.timeout', 'The AI provider did not answer in time.'],
};

/**
 * Message for a failed suggestion.
 * @param {Function} t - Translator `(id, defaultMessage, values) => string`.
 * @param {{ code?: string|null, status?: number|null }} info - Error info.
 * @returns {string} Message.
 */
export const altTextErrorText = (t, info) => {
  const entry =
    ERRORS[info && info.code] ||
    (info && info.status === 429
      ? ['tools.image.aiAlt.error.rateLimit', 'You sent many requests. Try again in a minute.']
      : info && info.status === 404
        ? ['tools.image.aiAlt.error.read', 'The image file could not be read.']
        : ['tools.image.aiAlt.error.generic', 'No suggestion is available right now.']);
  return t(entry[0], entry[1]);
};

/**
 * Creates the request function.
 * @param {{ post: Function, getTarget: () => { uid: string|null, field: string }, getLocale?: () => string|null }} options - Admin fetch client `post`, field target and content locale.
 * @returns {(fileId: number, options?: { signal?: AbortSignal }) => Promise<string>} Suggest function.
 */
export const createAltTextSuggester =
  ({ post, getTarget, getLocale }) =>
  async (fileId, { signal } = {}) => {
    const target = getTarget();
    const locale = typeof getLocale === 'function' ? getLocale() : null;
    try {
      const { data } = await post(
        API.aiAltText,
        { target: { uid: target.uid, field: target.field }, fileId, ...(locale ? { locale } : {}) },
        { signal }
      );
      return String((data && data.data && data.data.text) || '');
    } catch (error) {
      const info = readApiError(error);
      throw Object.assign(new Error('suggestion failed'), {
        code: info.code,
        status: info.status,
        aborted: Boolean(signal && signal.aborted),
      });
    }
  };

/**
 * Numeric Media Library id of an image value, or null.
 * @param {unknown} file - `data.file` of an image block (or a gallery item).
 * @returns {number|null} Id.
 */
export const mediaFileId = (file) => {
  const id = file && typeof file === 'object' ? Number(file.id) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/**
 * Builds the suggestion control.
 * @param {object} options - Options.
 * @param {Function} options.t - Translator.
 * @param {() => number|null} options.getFileId - Media Library id of the current image.
 * @param {(fileId: number, options?: { signal?: AbortSignal }) => Promise<string>} options.suggest - From `createAltTextSuggester`.
 * @param {(text: string) => void} options.onUse - Writes the accepted text (the caller updates its input).
 * @param {boolean} [options.readOnly] - Read-only editor (no control).
 * @returns {{ element: HTMLElement, refresh: () => void, destroy: () => void }} Control.
 */
export const createAltSuggestion = ({ t, getFileId, suggest, onUse, readOnly = false }) => {
  const trigger = button(t('tools.image.aiAlt.suggest', 'Suggest alternative text'));
  trigger.classList.add('mex-alt-ai__trigger');
  const status = el('p', { className: 'mex-alt-ai__status', attrs: { 'aria-live': 'polite' } });
  const text = el('p', { className: 'mex-alt-ai__text' });
  const use = button(t('tools.image.aiAlt.use', 'Use suggestion'), { variant: 'primary' });
  const dismiss = button(t('tools.image.aiAlt.dismiss', 'Dismiss'));
  const label = el('p', {
    className: 'mex-alt-ai__label',
    text: t('tools.image.aiAlt.label', 'Suggested alternative text (review before using)'),
  });
  const result = el('div', {
    className: 'mex-alt-ai__result',
    children: [label, text, el('div', { className: 'mex-alt-ai__actions', children: [use, dismiss] })],
  });
  result.hidden = true;
  const element = el('div', { className: 'mex-alt-ai', children: [trigger, status, result] });
  let controller = null;

  const refresh = () => {
    const id = getFileId();
    trigger.disabled = readOnly || !id || Boolean(controller);
    trigger.title = id
      ? ''
      : t('tools.image.aiAlt.noFile', 'Only images from the Media Library can be described.');
  };
  const reset = () => {
    result.hidden = true;
    text.textContent = '';
  };

  // Editor.js would treat Enter or Backspace on these buttons as block actions.
  [trigger, use, dismiss].forEach((node) =>
    node.addEventListener('keydown', (event) => {
      if (['Enter', ' ', 'Backspace', 'Delete', 'Tab'].includes(event.key)) event.stopPropagation();
    })
  );

  trigger.addEventListener('click', async () => {
    const id = getFileId();
    if (!id || controller) return;
    reset();
    controller = new AbortController();
    refresh();
    status.textContent = t('tools.image.aiAlt.working', 'Asking the AI provider for a suggestion');
    element.setAttribute('aria-busy', 'true');
    try {
      const suggestion = await suggest(id, { signal: controller.signal });
      if (!suggestion) throw Object.assign(new Error('empty'), { code: null, status: null });
      text.textContent = suggestion;
      result.hidden = false;
      status.textContent = t('tools.image.aiAlt.ready', 'Suggestion ready. Review it before using it.');
      use.focus();
    } catch (error) {
      if (!(error && error.aborted)) status.textContent = altTextErrorText(t, error || {});
    } finally {
      controller = null;
      element.removeAttribute('aria-busy');
      refresh();
    }
  });
  use.addEventListener('click', () => {
    const value = text.textContent || '';
    if (!value) return;
    onUse(value);
    reset();
    status.textContent = t('tools.image.aiAlt.used', 'Suggestion added. You can still edit it.');
    trigger.focus();
  });
  dismiss.addEventListener('click', () => {
    reset();
    status.textContent = '';
    trigger.focus();
  });
  refresh();
  if (readOnly) element.hidden = true;
  return {
    element,
    refresh,
    destroy: () => {
      if (controller) controller.abort();
    },
  };
};

import { useCallback } from 'react';
import { useFetchClient } from '../../utils/fetch-client';
import { API } from '../../utils/api';
import { collectSegments } from '../../../../shared/ai-fields.mjs';
import { MAX_REVIEW_BLOCKS } from '../../../../shared/ai-actions.mjs';

/**
 * AI review as suggestions (2.9). Sends the chosen blocks (only blocks with
 * text, as the editor shows them now, so the stored base version matches the
 * Suggestions panel's view) to `POST /ai/review/:kind`; the server asks the
 * AI and stores one suggestion per block it would change. Nothing in the
 * field changes. Afterwards the suggestions are loaded again.
 *
 * @param {object} options - Options.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string }} options.target - Field
 *   identity (as for the suggestion routes).
 * @param {() => Promise<object|null>} options.readData - Current normalised content of the field.
 * @param {{ refresh: () => Promise<void> }} options.suggestions - `useSuggestions()` result.
 * @returns {(request: { kind: string, actionKey?: string, scope: 'selection'|'blocks'|'field', blockIds?: string[]|null, signal?: AbortSignal }) => Promise<object>}
 *   Runs a review and resolves to the server's `meta` (`created`, `updated`, `duplicates`, `capped`, `invalid`,
 *   `blocks`); rejects with the request error (`tooManyBlocks: true` above MAX_REVIEW_BLOCKS blocks with text).
 */
export const useAiReview = ({ target, readData, suggestions }) => {
  const { post } = useFetchClient();
  const { refresh } = suggestions;
  const { uid, documentId, locale, field, fieldKey } = target;
  return useCallback(
    async ({ kind, actionKey, scope, blockIds = null, signal }) => {
      const data = await readData();
      const wanted = Array.isArray(blockIds) ? new Set(blockIds) : null;
      const chosen = ((data && data.blocks) || []).filter((block) => !wanted || wanted.has(block.id));
      const withText = new Set(collectSegments({ blocks: chosen }).map((segment) => segment.blockId));
      const blocks = chosen.filter((block) => withText.has(block.id));
      if (!blocks.length) return { created: 0, updated: 0, duplicates: 0, capped: 0, invalid: 0, blocks: 0 };
      if (blocks.length > MAX_REVIEW_BLOCKS)
        throw Object.assign(new Error('too many'), { tooManyBlocks: true });
      const { data: body } = await post(
        API.aiReview(kind),
        {
          uid,
          documentId,
          locale: locale || null,
          field,
          ...(fieldKey ? { fieldKey } : {}),
          scope,
          ...(actionKey ? { actionKey } : {}),
          blocks: blocks.map(({ id, type, data: blockData, tunes }) => ({
            id,
            type,
            data: blockData || {},
            ...(tunes && Object.keys(tunes).length ? { tunes } : {}),
          })),
        },
        { signal }
      );
      await refresh();
      return (body && body.meta) || {};
    },
    [post, uid, documentId, locale, field, fieldKey, readData, refresh]
  );
};

/**
 * Message of a failed review request: [translation id, English default], or null for the generic
 * AI messages (`editor/ai-errors.mjs`).
 * @param {{ status: number|null, code: string|null }} info - `readApiError()` result.
 * @param {{ tooManyBlocks?: boolean }} [error] - Thrown error.
 * @returns {[string, string]|null} Entry.
 */
export const reviewErrorEntry = (info, error) => {
  if (error && error.tooManyBlocks)
    return ['editor.ai.review.error.tooManyBlocks', 'Choose fewer blocks: up to 200 per review.'];
  if (info.code === 'FIELD_KEY_REQUIRED')
    return ['editor.ai.review.error.saveFirst', 'Save the entry once, then try again.'];
  if (info.code === 'TOO_MANY_SUGGESTIONS')
    return [
      'editor.suggest.tooMany',
      'This field has too many open suggestions. Ask a reviewer to decide some first.',
    ];
  if (info.code === 'SUGGESTION_TOO_LARGE')
    return ['editor.ai.review.error.blockTooLarge', 'A selected block is too large to review.'];
  if (info.status === 404)
    return ['editor.ai.review.error.unavailable', 'This review is not available anymore. Reload the page.'];
  return null;
};

export default useAiReview;

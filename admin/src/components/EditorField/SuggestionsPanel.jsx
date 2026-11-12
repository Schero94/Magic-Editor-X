import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  TextButton,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction } from '../ui/ConfirmAction';
import { TextOps, tuneLabel, tuneValueText } from './VersionDiff';
import { prepareEditorValue } from '../../editor/sanitize';
import { blockText, diffDocuments } from '../../../../shared/diff.mjs';
import { relativeTimeParts } from '../../../../shared/comments.mjs';
import { pendingInsertsOf, resolveAnchor, suggestionState } from '../../../../shared/suggestions.mjs';

/**
 * Suggestions panel of one editor field (2.4): the open suggestions in
 * document order with a word diff against the block as it is now, the
 * author, an optional note, and per suggestion "Accept" and "Reject"
 * (reviewers), "Withdraw" (own suggestions) and "Show block". "Accept all"
 * accepts every suggestion that still fits (open state) after a
 * confirmation. Outdated suggestions (the block changed since) show the diff
 * against the current block and ask before they overwrite it. All text is
 * rendered as React text; proposed content is never inserted as HTML here.
 */

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[3]};
`;

const Card = styled(Box)`
  min-width: 0;
  border-inline-start: 4px solid ${({ theme, $tone }) => theme.colors[$tone]};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const Text = styled(Typography)`
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
`;

const Inserted = styled.ins`
  background: ${({ theme }) => theme.colors.success100};
  color: ${({ theme }) => theme.colors.success700};
  text-decoration: underline;
`;

const Deleted = styled.del`
  background: ${({ theme }) => theme.colors.danger100};
  color: ${({ theme }) => theme.colors.danger700};
  text-decoration: line-through;
`;

const MAX_VALUE_CHARS = 200;

const OPS = {
  update: { key: 'editor.suggestions.op.update', text: 'Change', tone: 'warning600' },
  insert: { key: 'editor.suggestions.op.insert', text: 'New block', tone: 'success600' },
  delete: { key: 'editor.suggestions.op.delete', text: 'Remove block', tone: 'danger600' },
};

const STATES = {
  outdated: {
    key: 'editor.suggestions.state.outdated',
    text: 'Outdated',
    help: {
      key: 'editor.suggestions.state.outdatedHelp',
      text: 'The block changed after this suggestion was made. The changes below are compared with the block as it is now; accepting replaces it.',
    },
  },
  missing: {
    key: 'editor.suggestions.state.missing',
    text: 'Block removed',
    help: {
      key: 'editor.suggestions.state.missingHelp',
      text: 'The block is no longer in this field, so this suggestion can only be rejected.',
    },
  },
  applied: {
    key: 'editor.suggestions.state.applied',
    text: 'Already in the field',
    help: {
      key: 'editor.suggestions.state.appliedHelp',
      text: 'The field already has this content. Accept or reject it to close the suggestion.',
    },
  },
};

/**
 * Short text of a value for value diffs.
 * @param {unknown} value - Value.
 * @param {string} empty - Text for missing values.
 * @returns {string} Text.
 */
const valueText = (value, empty) => {
  if (value === undefined || value === null || value === '') return empty;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
};

/**
 * Normalised copy of one block (as the editor would show it), for hashing and diffs.
 * @param {object|null} block - Block.
 * @returns {object|null} Block.
 */
const normalizeBlock = (block) => {
  if (!block) return null;
  const prepared = prepareEditorValue({ time: 0, version: '2.31.7', blocks: [block] }).data;
  return prepared && prepared.blocks[0] ? prepared.blocks[0] : null;
};

/**
 * Word diff of a changed block (fields of `diffDocuments`).
 * @param {{ before: object|null, after: object|null, t: Function }} props - Blocks.
 * @returns {JSX.Element} Diff.
 */
const BlockChange = ({ before, after, t }) => {
  const empty = t('editor.history.diff.empty', '(empty)');
  if (!before && after)
    return (
      <Text tag="p" variant="pi" textColor="neutral800">
        <Inserted>
          <VisuallyHidden>{t('editor.history.diff.inserted', 'Added text:')} </VisuallyHidden>
          {blockText(after) || empty}
        </Inserted>
      </Text>
    );
  if (before && !after)
    return (
      <Text tag="p" variant="pi" textColor="neutral800">
        <Deleted>
          <VisuallyHidden>{t('editor.history.diff.deleted', 'Removed text:')} </VisuallyHidden>
          {blockText(before) || empty}
        </Deleted>
      </Text>
    );
  if (!before || !after) return null;
  const entry = diffDocuments({ blocks: [before] }, { blocks: [{ ...after, id: before.id }] })[0];
  if (!entry || !entry.fields || entry.fields.length === 0)
    return (
      <Text tag="p" variant="pi" textColor="neutral600">
        {t('editor.suggestions.noDifference', 'No difference to the current block.')}
      </Text>
    );
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {entry.fields.map((field) => (
        <Box key={field.path} minWidth={0}>
          {field.kind !== 'tunes' && (entry.fields.length > 1 || field.kind === 'value') ? (
            <Typography variant="sigma" textColor="neutral600">
              {field.path}
            </Typography>
          ) : null}
          {field.kind === 'tunes' ? (
            <Flex tag="ul" direction="column" alignItems="stretch" gap={1}>
              {field.changes.map((change) => (
                <Text key={change.tune} tag="li" variant="pi" textColor="neutral800">
                  {t('editor.history.diff.tune.change', '{tune}: {before} → {after}', {
                    tune: tuneLabel(change.tune, t),
                    before: tuneValueText(change, change.before, t, empty),
                    after: tuneValueText(change, change.after, t, empty),
                  })}
                </Text>
              ))}
            </Flex>
          ) : field.kind === 'text' ? (
            <TextOps ops={field.ops} t={t} />
          ) : (
            <Text tag="p" variant="pi" textColor="neutral800">
              <Deleted>
                <VisuallyHidden>{t('editor.history.diff.deleted', 'Removed text:')} </VisuallyHidden>
                {valueText(field.before, empty)}
              </Deleted>
              {' → '}
              <Inserted>
                <VisuallyHidden>{t('editor.history.diff.inserted', 'Added text:')} </VisuallyHidden>
                {valueText(field.after, empty)}
              </Inserted>
            </Text>
          )}
        </Box>
      ))}
    </Flex>
  );
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object} props.suggestions - `useSuggestions()` result.
 * @param {object|null} props.current - Current editor content.
 * @param {boolean} props.canDecide - The caller may accept and reject now (review right, editor not read-only).
 * @param {(items: Array<{ suggestion: object, outdated: boolean }>) => Promise<number>} props.onAccept - Accepts and applies; returns how many were applied.
 * @param {(blockId: string) => void} props.onSelectBlock - Shows a block in the editor.
 * @param {() => void} props.onClose - Closes the panel.
 * @param {string|null} [props.focusBlockId] - Show the first suggestion of this block (marker click).
 * @param {() => void} [props.onFocusHandled] - Called after focusing it.
 * @param {(message: string) => void} props.fail - Shows an error notification.
 * @returns {JSX.Element} Panel.
 */
export const SuggestionsPanel = ({
  t,
  suggestions,
  current,
  canDecide,
  onAccept,
  onSelectBlock,
  onClose,
  focusBlockId = null,
  onFocusHandled,
  fail,
}) => {
  const { formatDate, formatRelativeTime } = useIntl();
  const [busy, setBusy] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef(null);
  const cardRefs = useRef(new Map());
  const { loaded, error, counts, actions, newFromOthers, clearNew } = suggestions;

  const announce = (message) => {
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  };

  const normalizedCurrent = useMemo(() => prepareEditorValue(current).data || { blocks: [] }, [current]);

  // Open suggestions in document order with their state against the current content.
  const items = useMemo(() => {
    const open = suggestions.suggestions.filter((item) => item.status === 'open');
    const pendingInserts = pendingInsertsOf(open);
    const blocks = normalizedCurrent.blocks;
    const byId = new Map(blocks.map((block, index) => [block.id, { block, index }]));
    return open
      .map((suggestion, order) => {
        const proposed = normalizeBlock(suggestion.proposed);
        const normalized = { ...suggestion, proposed };
        const state = suggestionState(normalized, normalizedCurrent, { pendingInserts });
        const target = byId.get(suggestion.blockId);
        let position = target ? target.index : blocks.length;
        if (suggestion.op === 'insert')
          position = resolveAnchor(suggestion.afterBlockId, blocks, pendingInserts).index + 0.5;
        return { suggestion: normalized, state, current: target ? target.block : null, position, order };
      })
      .sort((a, b) => a.position - b.position || a.order - b.order);
  }, [suggestions.suggestions, normalizedCurrent]);

  const acceptable = items.filter((item) => item.state === 'open');

  useEffect(() => {
    if (!newFromOthers) return undefined;
    const timer = window.setTimeout(() => {
      announce(
        t(
          'editor.suggestions.announce.new',
          '{count, plural, one {# new suggestion} other {# new suggestions}}',
          { count: newFromOthers }
        )
      );
      clearNew();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per batch
  }, [newFromOthers]);

  // Marker click: focus the first suggestion of that block once it is rendered.
  const pendingFocusRef = useRef(null);
  useEffect(() => {
    if (!focusBlockId) return;
    pendingFocusRef.current = focusBlockId;
    if (onFocusHandled) onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a marker asks for a block
  }, [focusBlockId]);
  useEffect(() => {
    const blockId = pendingFocusRef.current;
    if (!blockId) return;
    const item = items.find(
      (entry) =>
        entry.suggestion.blockId === blockId ||
        (entry.suggestion.op === 'insert' && entry.suggestion.afterBlockId === blockId)
    );
    const element = item ? cardRefs.current.get(item.suggestion.id) : null;
    if (!element) return;
    pendingFocusRef.current = null;
    element.scrollIntoView({ block: 'nearest' });
    element.focus();
  });

  /**
   * Runs a decision and reports its result.
   * @param {string} id - Suggestion id (busy marker).
   * @param {() => Promise<string>} task - Returns the announcement.
   * @returns {Promise<void>} Done; throws on failure (keeps a dialog open).
   */
  const run = async (id, task) => {
    setBusy(id);
    try {
      announce(await task());
      window.requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) headingRef.current?.focus();
      });
    } catch (requestError) {
      const decided = requestError && requestError.code === 'ALREADY_DECIDED';
      fail(
        decided
          ? t('editor.suggestions.alreadyDecided', 'Someone else already decided this suggestion.')
          : t('editor.suggestions.failed', 'The suggestion could not be updated. Try again.')
      );
      throw requestError;
    } finally {
      setBusy(null);
    }
  };

  const accept = (item) =>
    run(item.suggestion.id, async () => {
      const applied = await onAccept([{ suggestion: item.suggestion, outdated: item.state === 'outdated' }]);
      return applied
        ? t('editor.suggestions.announce.accepted', 'Suggestion accepted. Save the entry to keep it.')
        : t('editor.suggestions.announce.acceptedNoChange', 'Suggestion accepted. The field did not change.');
    });
  const acceptAll = () =>
    run('all', async () => {
      const applied = await onAccept(
        acceptable.map((item) => ({ suggestion: item.suggestion, outdated: false }))
      );
      return t(
        'editor.suggestions.announce.acceptedAll',
        '{count, plural, one {# suggestion accepted} other {# suggestions accepted}}. Save the entry to keep the changes.',
        { count: applied }
      );
    });
  const reject = (item) =>
    run(item.suggestion.id, async () => {
      await actions.reject(item.suggestion.id);
      return t('editor.suggestions.announce.rejected', 'Suggestion rejected');
    }).catch(() => {});
  const withdraw = (item) =>
    run(item.suggestion.id, async () => {
      await actions.withdraw(item.suggestion.id);
      return t('editor.suggestions.announce.withdrawn', 'Suggestion withdrawn');
    });

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (event.target && event.target.closest && event.target.closest('[role="dialog"],[role="alertdialog"]'))
      return;
    event.stopPropagation();
    onClose();
  };

  const authorName = (suggestion) =>
    suggestion.author.deleted
      ? t('editor.comments.deletedUser', 'Deleted user')
      : suggestion.author.own
        ? t('editor.comments.you', '{name} (you)', { name: suggestion.author.name || '' })
        : suggestion.author.name || t('editor.comments.deletedUser', 'Deleted user');

  let content;
  if (!loaded && error) {
    content = (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography variant="omega" textColor="danger600" role="alert">
          {t('editor.suggestions.error', 'The suggestions could not be loaded.')}
        </Typography>
        <Button variant="secondary" size="S" onClick={suggestions.refresh}>
          {t('editor.comments.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (!loaded) {
    content = <Loader small>{t('editor.suggestions.loading', 'Loading suggestions')}</Loader>;
  } else if (items.length === 0) {
    content = (
      <Typography variant="omega" textColor="neutral600">
        {suggestions.canCreate
          ? t(
              'editor.suggestions.emptyCreate',
              'No open suggestions. Choose "Suggest changes" in the More menu to propose edits without changing the entry.'
            )
          : t('editor.suggestions.empty', 'No open suggestions.')}
      </Typography>
    );
  } else {
    content = (
      <List aria-label={t('editor.suggestions.list', 'Open suggestions')}>
        {items.map((item) => {
          const { suggestion, state } = item;
          const op = OPS[suggestion.op] || OPS.update;
          const extra = STATES[state];
          const { value, unit } = relativeTimeParts(suggestion.createdAt);
          const before = suggestion.op === 'insert' ? null : item.current;
          const after = suggestion.op === 'delete' ? null : suggestion.proposed;
          const decidable = canDecide && state !== 'missing';
          const working = busy === suggestion.id || busy === 'all';
          return (
            <li key={suggestion.id}>
              <Card
                ref={(element) => {
                  if (element) cardRefs.current.set(suggestion.id, element);
                  else cardRefs.current.delete(suggestion.id);
                }}
                tabIndex={-1}
                $tone={op.tone}
                padding={3}
                background="neutral0"
                hasRadius
                borderColor="neutral200"
                data-testid="mex-suggestion"
                data-op={suggestion.op}
                data-state={state}
                data-block-id={suggestion.blockId}
              >
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Flex gap={2} wrap="wrap" alignItems="center">
                    <Badge>{t(op.key, op.text)}</Badge>
                    {extra ? (
                      <Badge
                        backgroundColor={state === 'outdated' ? 'warning100' : 'neutral150'}
                        textColor={state === 'outdated' ? 'warning700' : 'neutral800'}
                      >
                        {t(extra.key, extra.text)}
                      </Badge>
                    ) : null}
                    <Typography variant="pi" textColor="neutral600">
                      {(after || before || {}).type || ''}
                    </Typography>
                  </Flex>
                  <Flex gap={2} wrap="wrap" alignItems="baseline" minWidth={0}>
                    <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                      {authorName(suggestion)}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      <time
                        dateTime={suggestion.createdAt}
                        title={formatDate(suggestion.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                      >
                        {formatRelativeTime(value, unit, { numeric: 'auto' })}
                      </time>
                    </Typography>
                  </Flex>
                  {extra ? (
                    <Typography variant="pi" textColor="neutral600">
                      {t(extra.help.key, extra.help.text)}
                    </Typography>
                  ) : null}
                  <BlockChange before={before} after={after} t={t} />
                  {suggestion.note ? (
                    <Text tag="p" variant="pi" textColor="neutral800">
                      {t('editor.suggestions.note', 'Note: {note}', { note: suggestion.note })}
                    </Text>
                  ) : null}
                  <Flex gap={2} wrap="wrap" alignItems="center">
                    {decidable && state === 'outdated' ? (
                      <ConfirmAction
                        trigger={
                          <Button size="S" variant="success-light" disabled={working}>
                            {t('editor.suggestions.accept', 'Accept')}
                          </Button>
                        }
                        title={t(
                          'editor.suggestions.overwrite.title',
                          'Replace the newer version of this block?'
                        )}
                        body={t(
                          'editor.suggestions.overwrite.body',
                          'The block changed after this suggestion was made. Accepting replaces it with the suggested version. Undo brings the current version back until you save.'
                        )}
                        confirmLabel={t('editor.suggestions.overwrite.confirm', 'Accept and replace')}
                        variant="danger"
                        onConfirm={() => accept(item)}
                        fallbackFocusRef={headingRef}
                      />
                    ) : null}
                    {decidable && state !== 'outdated' ? (
                      <Button
                        size="S"
                        variant="success-light"
                        onClick={() => accept(item).catch(() => {})}
                        loading={busy === suggestion.id}
                        disabled={working}
                        data-testid="mex-suggestion-accept"
                      >
                        {t('editor.suggestions.accept', 'Accept')}
                      </Button>
                    ) : null}
                    {canDecide ? (
                      <Button
                        size="S"
                        variant="danger-light"
                        onClick={() => reject(item)}
                        disabled={working}
                        data-testid="mex-suggestion-reject"
                      >
                        {t('editor.suggestions.reject', 'Reject')}
                      </Button>
                    ) : null}
                    {suggestion.author.own ? (
                      <ConfirmAction
                        trigger={
                          <Button size="S" variant="tertiary" disabled={working}>
                            {t('editor.suggestions.withdraw', 'Withdraw')}
                          </Button>
                        }
                        title={t('editor.suggestions.withdraw.title', 'Withdraw this suggestion?')}
                        body={t(
                          'editor.suggestions.withdraw.body',
                          'The suggestion is deleted. The entry does not change.'
                        )}
                        confirmLabel={t('editor.suggestions.withdraw.confirm', 'Withdraw')}
                        onConfirm={() => withdraw(item)}
                        fallbackFocusRef={headingRef}
                      />
                    ) : null}
                    {state !== 'missing' ? (
                      <TextButton
                        onClick={() =>
                          onSelectBlock(
                            suggestion.op === 'insert'
                              ? suggestion.afterBlockId || (normalizedCurrent.blocks[0] || {}).id
                              : suggestion.blockId
                          )
                        }
                      >
                        {t('editor.suggestions.show', 'Show block')}
                      </TextButton>
                    ) : null}
                  </Flex>
                </Flex>
              </Card>
            </li>
          );
        })}
      </List>
    );
  }

  return (
    <Box
      tag="section"
      aria-labelledby="mex-suggestions-title"
      padding={4}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
      onKeyDown={onKeyDown}
      data-testid="mex-suggestions-panel"
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Typography variant="delta" tag="h3" id="mex-suggestions-title" ref={headingRef} tabIndex={-1}>
              {t('editor.suggestions.title', 'Suggestions')}
            </Typography>
            <Typography variant="pi" textColor="neutral600" data-testid="mex-suggestions-summary">
              {t(
                'editor.suggestions.summary',
                '{open, plural, one {# open suggestion} other {# open suggestions}} · {accepted} accepted · {rejected} rejected',
                counts
              )}
            </Typography>
          </Flex>
          <IconButton
            label={t('editor.suggestions.close', 'Close suggestions')}
            variant="ghost"
            onClick={onClose}
          >
            <Cross />
          </IconButton>
        </Flex>
        {canDecide && acceptable.length > 1 ? (
          <Flex>
            <ConfirmAction
              trigger={
                <Button
                  variant="secondary"
                  size="S"
                  disabled={Boolean(busy)}
                  data-testid="mex-suggestions-accept-all"
                >
                  {t('editor.suggestions.acceptAll', 'Accept all ({count})', { count: acceptable.length })}
                </Button>
              }
              title={t(
                'editor.suggestions.acceptAll.title',
                'Accept {count, plural, one {# suggestion} other {# suggestions}}?',
                { count: acceptable.length }
              )}
              body={t(
                'editor.suggestions.acceptAll.body',
                'The suggested changes replace the current blocks in this field. Outdated suggestions are left for you to check. Undo reverts all of them in one step until you save.'
              )}
              confirmLabel={t('editor.suggestions.acceptAll.confirm', 'Accept all')}
              variant="default"
              onConfirm={acceptAll}
              fallbackFocusRef={headingRef}
            />
          </Flex>
        ) : null}
        {!canDecide && suggestions.canReview ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.suggestions.readOnly',
              'This field is read-only right now, so suggestions cannot be accepted.'
            )}
          </Typography>
        ) : null}
        {loaded && error ? (
          <Typography variant="pi" textColor="danger600" role="status">
            {t(
              'editor.suggestions.refreshFailed',
              'New suggestions could not be loaded. Showing the last known state.'
            )}
          </Typography>
        ) : null}
        {content}
      </Flex>
      <VisuallyHidden aria-live="polite" aria-atomic="true" data-testid="mex-suggestions-live">
        {announcement}
      </VisuallyHidden>
    </Box>
  );
};

export default SuggestionsPanel;

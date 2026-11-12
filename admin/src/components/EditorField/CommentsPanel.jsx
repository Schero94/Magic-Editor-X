import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  IconButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Cross, Plus } from '@strapi/icons';
import styled from 'styled-components';
import { CommentThread } from './CommentThread';
import { MentionTextarea } from './MentionTextarea';
import { MAX_COMMENT_LENGTH, arrangeThreads, normalizeExcerpt } from '../../../../shared/comments.mjs';

/**
 * Comments panel of one editor field (2.3): new thread on a block, the
 * thread list (open first, then detached, resolved on request), and the
 * read-only view for people without `comments.write`. Pattern of the quality
 * and find panels: a section under the toolbar with its own close button.
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

const Excerpt = styled(Typography)`
  overflow-wrap: anywhere;
  min-width: 0;
`;

/** 2.4: the selected text a new range comment is on. */
const Quote = styled(Typography)`
  display: block;
  padding-inline-start: ${({ theme }) => theme.spaces[2]};
  border-inline-start: 3px solid ${({ theme }) => theme.colors.secondary500};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
`;

/** Characters of a block excerpt shown in the block picker. */
const OPTION_EXCERPT = 60;

/**
 * Short form of an excerpt for a select option.
 * @param {string|null} text - Excerpt.
 * @returns {string|null} Shortened text.
 */
const shorten = (text) =>
  text && text.length > OPTION_EXCERPT ? `${text.slice(0, OPTION_EXCERPT - 1).trimEnd()}…` : text;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object} props.comments - `useComments()` result.
 * @param {Array<{ id: string, index: number, excerpt: string|null }>} props.blocks - Blocks of the current document.
 * @param {string|null} props.currentBlockId - Block the caret or pointer was in last.
 * @param {(blockId: string) => void} props.onSelectBlock - Shows a block in the editor.
 * @param {() => void} props.onClose - Closes the panel.
 * @param {string|null} [props.focusThreadId] - Thread to show and focus (marker click).
 * @param {() => void} [props.onFocusHandled] - Called after focusing it.
 * @param {(message: string) => void} props.fail - Shows an error notification.
 * @param {{ blockId: string, anchor: object }|null} [props.rangeDraft] - 2.4: start a thread on selected text.
 * @param {() => void} [props.onRangeDraftHandled] - Called once the draft is taken over.
 * @param {Map<string, string>} [props.anchorStatuses] - 2.4: where the text of each range thread is.
 * @param {((threadId: string) => void)|null} [props.onShowRange] - 2.4: selects a thread's text in the editor.
 * @param {string|null} [props.activeThreadId] - 2.4: thread of the highlight the caret is in.
 * @param {string|null} [props.revealThreadId] - 2.4: thread to scroll into view without moving focus (click on its text).
 * @param {() => void} [props.onRevealHandled] - Called after revealing it.
 * @returns {JSX.Element} Panel.
 */
export const CommentsPanel = ({
  t,
  comments,
  blocks,
  currentBlockId,
  onSelectBlock,
  onClose,
  focusThreadId = null,
  onFocusHandled,
  fail,
  rangeDraft = null,
  onRangeDraftHandled,
  anchorStatuses = null,
  onShowRange = null,
  activeThreadId = null,
  revealThreadId = null,
  onRevealHandled,
}) => {
  const [showResolved, setShowResolved] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ blockId: null, body: '', anchor: null, mentions: [] });
  const [posting, setPosting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef(null);
  const newButtonRef = useRef(null);
  const threadRefs = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const { threads, canWrite, canModerate, actions, loaded, error, counts, newFromOthers, clearNew } =
    comments;
  const positionalThreads = Array.isArray(comments.positionalThreads) ? comments.positionalThreads : [];
  // 2.4: the caller's unread mentions and replies on this field, per thread (mention wins).
  const notifiedThreads = useMemo(() => {
    const map = new Map();
    for (const note of Array.isArray(comments.notifications) ? comments.notifications : []) {
      if (note.kind === 'mention' || !map.has(note.threadId)) map.set(note.threadId, note.kind);
    }
    return map;
  }, [comments.notifications]);
  const mentionCount = Array.from(notifiedThreads.values()).filter((kind) => kind === 'mention').length;
  const replyCount = notifiedThreads.size - mentionCount;
  const searchMentions =
    canWrite && typeof actions.searchMentions === 'function' ? actions.searchMentions : null;

  const blockIds = useMemo(() => blocks.map((block) => block.id), [blocks]);
  const excerpts = useMemo(() => new Map(blocks.map((block) => [block.id, block.excerpt])), [blocks]);
  const arranged = useMemo(() => arrangeThreads(threads, blockIds), [threads, blockIds]);
  const shown = showResolved ? arranged : arranged.filter((thread) => thread.status !== 'resolved');

  const announce = (message) => {
    // Re-set so the same message is announced again.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  };

  // New comments by other people arrived with a refresh.
  useEffect(() => {
    if (!newFromOthers) return undefined;
    const timer = window.setTimeout(() => {
      announce(
        t('editor.comments.announce.new', '{count, plural, one {# new comment} other {# new comments}}', {
          count: newFromOthers,
        })
      );
      clearNew();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per batch of new comments
  }, [newFromOthers]);

  // Marker click, next comment or a notification link: focus that thread (resolved ones are shown for it).
  const [seenFocus, setSeenFocus] = useState(null);
  if (focusThreadId && focusThreadId !== seenFocus) {
    setSeenFocus(focusThreadId);
    if (threads.some((thread) => thread.id === focusThreadId && thread.status === 'resolved'))
      setShowResolved(true);
  }
  useEffect(() => {
    if (!focusThreadId) return;
    pendingFocusRef.current = focusThreadId;
    if (onFocusHandled) onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a marker asks for a thread
  }, [focusThreadId]);

  // 2.4: click on commented text: show the thread, focus stays in the editor.
  const pendingRevealRef = useRef(null);
  useEffect(() => {
    if (!revealThreadId) return;
    pendingRevealRef.current = revealThreadId;
    if (onRevealHandled) onRevealHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a highlight asks for a thread
  }, [revealThreadId]);
  useEffect(() => {
    const id = pendingRevealRef.current;
    if (!id) return;
    const element = threadRefs.current.get(id);
    if (!element) return;
    pendingRevealRef.current = null;
    element.scrollIntoView({ block: 'nearest' });
  });

  // Focus a thread once it is rendered (after a marker click or a new thread).
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    const element = threadRefs.current.get(id);
    if (!element) return;
    pendingFocusRef.current = null;
    element.scrollIntoView({ block: 'nearest' });
    element.focus();
  });

  const startComposing = () => {
    const known = blocks.some((block) => block.id === currentBlockId);
    setDraft({
      blockId: known ? currentBlockId : blocks[0] ? blocks[0].id : null,
      body: '',
      anchor: null,
      mentions: [],
    });
    setComposing(true);
  };

  // 2.4: "Comment" on selected text starts a thread on that text.
  const [seenDraft, setSeenDraft] = useState(null);
  if (rangeDraft && rangeDraft !== seenDraft) {
    setSeenDraft(rangeDraft);
    if (canWrite) {
      setDraft({ blockId: rangeDraft.blockId, body: '', anchor: rangeDraft.anchor, mentions: [] });
      setComposing(true);
    }
  }
  useEffect(() => {
    if (rangeDraft && onRangeDraftHandled) onRangeDraftHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new draft
  }, [rangeDraft]);

  const cancelComposing = () => {
    setComposing(false);
    window.requestAnimationFrame(() => newButtonRef.current && newButtonRef.current.focus());
  };

  const post = async () => {
    if (!draft.blockId || !draft.body.trim() || posting) return;
    setPosting(true);
    try {
      const thread = await actions.createThread({
        blockId: draft.blockId,
        body: draft.body,
        // A range comment's excerpt is the text it is on.
        excerpt: draft.anchor
          ? normalizeExcerpt(draft.anchor.quote.exact)
          : excerpts.get(draft.blockId) || null,
        anchor: draft.anchor || null,
        mentions: draft.mentions,
      });
      setComposing(false);
      setDraft({ blockId: null, body: '', anchor: null, mentions: [] });
      if (thread && thread.id) pendingFocusRef.current = thread.id;
      announce(t('editor.comments.announce.added', 'Comment added'));
      if (thread && thread.droppedMentions)
        fail(
          t(
            'editor.comments.mentions.dropped',
            '{count, plural, one {# person was} other {# people were}} not mentioned: they cannot read this field.',
            { count: thread.droppedMentions }
          )
        );
    } catch (requestError) {
      fail(
        requestError && requestError.status === 429
          ? t('editor.comments.rateLimited', 'Too many comments. Try again in a minute.')
          : t('editor.comments.failed', 'The comment could not be saved.')
      );
    } finally {
      setPosting(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const tag = event.target && event.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (
      event.target &&
      event.target.closest &&
      event.target.closest('[role="listbox"],[role="dialog"],[role="alertdialog"]')
    )
      return;
    event.stopPropagation();
    onClose();
  };

  const optionLabel = (block) =>
    block.excerpt
      ? t('editor.comments.block.option', '{index}. {excerpt}', {
          index: block.index + 1,
          excerpt: shorten(block.excerpt),
        })
      : t('editor.comments.block.empty', '{index}. Block without text', { index: block.index + 1 });

  let content;
  if (!loaded && error) {
    content = (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography variant="omega" textColor="danger600" role="alert">
          {t('editor.comments.error', 'The comments could not be loaded.')}
        </Typography>
        <Button variant="secondary" size="S" onClick={comments.refresh}>
          {t('editor.comments.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (!loaded) {
    content = <Loader small>{t('editor.comments.loading', 'Loading comments')}</Loader>;
  } else if (shown.length === 0) {
    content = (
      <Typography variant="omega" textColor="neutral600">
        {counts.resolved && !showResolved
          ? t('editor.comments.emptyOpen', 'No open threads. Resolved threads are hidden.')
          : canWrite
            ? t(
                'editor.comments.emptyRange',
                'No comments yet. Select text in the editor and choose Comment, or comment on a whole block.'
              )
            : t('editor.comments.emptyReadOnly', 'No comments yet.')}
      </Typography>
    );
  } else {
    content = (
      <List aria-label={t('editor.comments.list', 'Comment threads')}>
        {shown.map((thread) => (
          <li key={thread.id}>
            <CommentThread
              ref={(element) => {
                if (element) threadRefs.current.set(thread.id, element);
                else threadRefs.current.delete(thread.id);
              }}
              thread={thread}
              blockExcerpt={thread.detached ? null : excerpts.get(thread.blockId) || null}
              t={t}
              canWrite={canWrite}
              canModerate={canModerate}
              actions={actions}
              onSelectBlock={onSelectBlock}
              announce={announce}
              fail={fail}
              fallbackFocusRef={headingRef}
              anchorStatus={anchorStatuses ? anchorStatuses.get(thread.id) || null : null}
              onShowRange={onShowRange}
              notification={notifiedThreads.get(thread.id) || null}
              searchMentions={searchMentions}
              active={thread.id === activeThreadId}
            />
          </li>
        ))}
      </List>
    );
  }

  return (
    <Box
      tag="section"
      aria-labelledby="mex-comments-title"
      padding={4}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
      onKeyDown={onKeyDown}
      data-testid="mex-comments-panel"
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Typography variant="delta" tag="h3" id="mex-comments-title" ref={headingRef} tabIndex={-1}>
              {t('editor.comments.title', 'Comments')}
            </Typography>
            <Typography variant="pi" textColor="neutral600" data-testid="mex-comments-summary">
              {t(
                'editor.comments.summary',
                '{open, plural, one {# open thread} other {# open threads}} · {resolved} resolved',
                { open: counts.open, resolved: counts.resolved }
              )}
            </Typography>
          </Flex>
          <IconButton label={t('editor.comments.close', 'Close comments')} variant="ghost" onClick={onClose}>
            <Cross />
          </IconButton>
        </Flex>

        {notifiedThreads.size > 0 ? (
          <Box
            padding={3}
            hasRadius
            background="alternative100"
            borderColor="alternative200"
            data-testid="mex-comments-notified"
          >
            <Flex gap={3} wrap="wrap" alignItems="center" justifyContent="space-between">
              <Typography variant="omega" textColor="neutral800" fontWeight="semiBold">
                {mentionCount
                  ? t(
                      'editor.comments.notified.mentioned',
                      'You were mentioned in {count, plural, one {# thread} other {# threads}}.',
                      { count: mentionCount }
                    )
                  : t(
                      'editor.comments.notified.replies',
                      'New replies in {count, plural, one {# thread} other {# threads}} you are in.',
                      { count: replyCount }
                    )}
              </Typography>
              <Button
                size="S"
                variant="secondary"
                onClick={() =>
                  actions
                    .markThreadsRead(Array.from(notifiedThreads.keys()))
                    .catch(() => fail(t('editor.comments.actionFailed', 'This did not work. Try again.')))
                }
              >
                {t('editor.comments.notified.markRead', 'Mark as read')}
              </Button>
            </Flex>
          </Box>
        ) : null}

        <Flex gap={4} wrap="wrap" alignItems="center" justifyContent="space-between">
          {canWrite ? (
            <Button
              ref={newButtonRef}
              variant="secondary"
              size="S"
              startIcon={<Plus />}
              onClick={startComposing}
              disabled={composing || blocks.length === 0}
            >
              {t('editor.comments.new', 'Comment on a block')}
            </Button>
          ) : (
            <Typography variant="pi" textColor="neutral600">
              {t('editor.comments.readOnly', 'You can read comments but not add any.')}
            </Typography>
          )}
          <Checkbox checked={showResolved} onCheckedChange={(value) => setShowResolved(value === true)}>
            {t('editor.comments.showResolved', 'Show resolved threads')}
          </Checkbox>
        </Flex>

        {canWrite && blocks.length === 0 ? (
          <Typography variant="pi" textColor="neutral600">
            {t('editor.comments.noBlocks', 'This field has no blocks to comment on yet.')}
          </Typography>
        ) : null}

        {composing ? (
          <Box
            padding={3}
            hasRadius
            borderColor="primary200"
            background="neutral0"
            data-testid="mex-comment-new"
          >
            <Flex direction="column" alignItems="stretch" gap={3}>
              {draft.anchor ? (
                <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('editor.comments.thread.onText', 'On selected text')}
                  </Typography>
                  <Quote variant="omega" textColor="neutral800" data-testid="mex-comment-new-quote">
                    {normalizeExcerpt(draft.anchor.quote.exact)}
                  </Quote>
                  <Button
                    size="S"
                    variant="ghost"
                    onClick={() => setDraft((current) => ({ ...current, anchor: null }))}
                    data-testid="mex-comment-whole-block"
                  >
                    {t('editor.comments.wholeBlock', 'Comment on the whole block instead')}
                  </Button>
                </Flex>
              ) : (
                <Field.Root name="mex-comment-block">
                  <Field.Label>{t('editor.comments.block.label', 'Block')}</Field.Label>
                  <SingleSelect
                    value={draft.blockId || undefined}
                    onChange={(value) => setDraft((current) => ({ ...current, blockId: String(value) }))}
                  >
                    {blocks.map((block) => (
                      <SingleSelectOption key={block.id} value={block.id}>
                        {optionLabel(block)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              )}
              <MentionTextarea
                name="mex-comment-body"
                label={t('editor.comments.body.label', 'Comment')}
                hint={
                  searchMentions
                    ? t(
                        'editor.comments.body.hintMentions',
                        'Plain text, up to {max} characters. Type @ to mention someone. Ctrl or Cmd + Enter posts.',
                        { max: MAX_COMMENT_LENGTH }
                      )
                    : t(
                        'editor.comments.body.hint',
                        'Plain text, up to {max} characters. Ctrl or Cmd + Enter posts.',
                        { max: MAX_COMMENT_LENGTH }
                      )
                }
                value={draft.body}
                onChange={(body) => setDraft((current) => ({ ...current, body }))}
                mentions={draft.mentions}
                onMentionsChange={(mentions) => setDraft((current) => ({ ...current, mentions }))}
                search={searchMentions}
                onSubmit={post}
                onCancel={cancelComposing}
                t={t}
                autoFocus
              />
              {!draft.anchor && draft.blockId && excerpts.get(draft.blockId) ? (
                <Excerpt variant="pi" textColor="neutral600">
                  {t('editor.comments.thread.on', 'On: {excerpt}', { excerpt: excerpts.get(draft.blockId) })}
                </Excerpt>
              ) : null}
              <Flex gap={2} wrap="wrap">
                <Button
                  size="S"
                  onClick={post}
                  loading={posting}
                  disabled={!draft.blockId || !draft.body.trim()}
                >
                  {t('editor.comments.post', 'Post comment')}
                </Button>
                <Button size="S" variant="tertiary" onClick={cancelComposing}>
                  {t('editor.comments.cancel', 'Cancel')}
                </Button>
              </Flex>
            </Flex>
          </Box>
        ) : null}

        {loaded && error ? (
          <Typography variant="pi" textColor="danger600" role="status">
            {t(
              'editor.comments.refreshFailed',
              'New comments could not be loaded. Showing the last known state.'
            )}
          </Typography>
        ) : null}

        {content}

        {positionalThreads.length > 0 ? (
          <Flex direction="column" alignItems="stretch" gap={2} data-testid="mex-comments-positional">
            <Typography variant="sigma" tag="h4" textColor="neutral600">
              {t('editor.comments.positional.title', 'Older comments saved by position')}
            </Typography>
            <List aria-label={t('editor.comments.positional.title', 'Older comments saved by position')}>
              {positionalThreads.map((thread) => (
                <li key={thread.id}>
                  <CommentThread
                    thread={thread}
                    blockExcerpt={null}
                    t={t}
                    canWrite={false}
                    canModerate={false}
                    actions={actions}
                    onSelectBlock={onSelectBlock}
                    announce={announce}
                    fail={fail}
                    fallbackFocusRef={headingRef}
                  />
                </li>
              ))}
            </List>
          </Flex>
        ) : null}
      </Flex>
      <VisuallyHidden aria-live="polite" aria-atomic="true" data-testid="mex-comments-live">
        {announcement}
      </VisuallyHidden>
    </Box>
  );
};

export default CommentsPanel;

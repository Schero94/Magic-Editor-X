import { forwardRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Badge, Box, Button, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { ConfirmAction } from '../ui/ConfirmAction';
import { MentionTextarea } from './MentionTextarea';
import { normalizeExcerpt, relativeTimeParts } from '../../../../shared/comments.mjs';
import { mentionSegments } from '../../../../shared/comment-mentions.mjs';

/**
 * One comment thread in the comments panel: the block it belongs to (or
 * "Block removed" when the block is gone), the comments with author and
 * relative time, and the actions the caller may use (reply, resolve or
 * reopen, edit and delete own comments, delete any comment as moderator).
 * Comment text is rendered as React text only.
 */

const Card = styled(Box)`
  min-width: 0;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const Body = styled(Typography)`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
`;

const Wrap = styled(Typography)`
  overflow-wrap: anywhere;
  min-width: 0;
`;

/** 2.4: an @mention in a comment (rendered as text, never HTML). */
const Mention = styled.span`
  display: inline;
  padding: 0 ${({ theme }) => theme.spaces[1]};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.primary100};
  color: ${({ theme }) => theme.colors.primary700};
  font-weight: 600;
  &[data-you='true'] {
    background: ${({ theme }) => theme.colors.alternative100};
    color: ${({ theme }) => theme.colors.alternative700};
  }
`;

/** 2.4: the commented text of a range comment. */
const Quote = styled(Typography)`
  display: block;
  padding-inline-start: ${({ theme }) => theme.spaces[2]};
  border-inline-start: 3px solid ${({ theme }) => theme.colors.secondary500};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
`;

/**
 * Comment text with @mention chips.
 * @param {{ comment: object }} props - Props.
 * @returns {JSX.Element[]} Parts.
 */
const CommentText = ({ comment }) =>
  mentionSegments(comment.body, comment.mentions).map((segment, index) =>
    segment.type === 'mention' ? (
      <Mention key={index} data-you={segment.you ? 'true' : 'false'} data-testid="mex-comment-mention">
        {segment.text}
      </Mention>
    ) : (
      <span key={index}>{segment.text}</span>
    )
  );

/** Longest quote shown in a thread before it is shortened. */
const QUOTE_SHOWN = 280;

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[3]};
`;

/**
 * Author name, relative time (absolute time as tooltip) and "edited".
 * @param {object} props - Props.
 * @param {object} props.comment - Comment.
 * @param {Function} props.t - Translator.
 * @returns {JSX.Element} Meta line.
 */
const CommentMeta = ({ comment, t }) => {
  const { formatRelativeTime, formatDate } = useIntl();
  const name = comment.author.deleted
    ? t('editor.comments.deletedUser', 'Deleted user')
    : comment.author.name || t('editor.comments.deletedUser', 'Deleted user');
  const { value, unit } = relativeTimeParts(comment.createdAt);
  const absolute = formatDate(comment.createdAt, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Flex gap={2} wrap="wrap" alignItems="baseline" minWidth={0}>
      <Wrap variant="omega" fontWeight="bold" textColor="neutral800">
        {comment.author.own ? t('editor.comments.you', '{name} (you)', { name }) : name}
      </Wrap>
      <Typography variant="pi" textColor="neutral600">
        <time dateTime={comment.createdAt} title={absolute}>
          {formatRelativeTime(value, unit, { numeric: 'auto' })}
        </time>
        {comment.editedAt ? ` · ${t('editor.comments.edited', 'edited')}` : ''}
      </Typography>
    </Flex>
  );
};

/**
 * @param {object} props - Props.
 * @param {object} props.thread - Thread (`arrangeThreads` output: `detached`, `position`; `positional` for
 *   read-only threads saved by position before 2.4).
 * @param {string|null} props.blockExcerpt - Current text of the block (null when detached or empty).
 * @param {Function} props.t - Translator.
 * @param {boolean} props.canWrite - Caller may comment, reply and resolve.
 * @param {boolean} props.canModerate - Caller may delete anyone's comment.
 * @param {object} props.actions - `useComments().actions`.
 * @param {(blockId: string) => void} props.onSelectBlock - Shows the block in the editor.
 * @param {(message: string) => void} props.announce - Live-region message.
 * @param {(message: string) => void} props.fail - Error notification.
 * @param {{ current: HTMLElement|null }} props.fallbackFocusRef - Focus target after deleting the thread.
 * @param {'anchored'|'changed'|'detached'|null} [props.anchorStatus] - 2.4: where the commented text of a range
 *   comment is (null for block comments).
 * @param {((threadId: string) => void)|null} [props.onShowRange] - 2.4: selects the commented text in the editor.
 * @param {'mention'|'reply'|null} [props.notification] - 2.4: the caller has an unread notification for this thread.
 * @param {((text: string) => Promise<Array<object>>)|null} [props.searchMentions] - 2.4: people search for @mentions.
 * @param {boolean} [props.active] - 2.4: the thread of the highlight the caret is in.
 * @returns {JSX.Element} Thread.
 */
export const CommentThread = forwardRef(function CommentThread(
  {
    thread,
    blockExcerpt,
    t,
    canWrite,
    canModerate,
    actions,
    onSelectBlock,
    announce,
    fail,
    fallbackFocusRef,
    anchorStatus = null,
    onShowRange = null,
    notification = null,
    searchMentions = null,
    active = false,
  },
  ref
) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [replyMentions, setReplyMentions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const resolved = thread.status === 'resolved';
  // 2.4: a thread written under a positional path before 2.4 that belongs to no single entry (read-only).
  const positional = Boolean(thread.positional);
  const excerpt =
    blockExcerpt || thread.excerpt || t('editor.comments.thread.noExcerpt', 'a block without text');
  // 2.4: range comments show the text they are on.
  const quote = thread.anchor && thread.anchor.quote ? normalizeExcerpt(thread.anchor.quote.exact) : null;
  const shownQuote = quote && quote.length > QUOTE_SHOWN ? `${quote.slice(0, QUOTE_SHOWN - 1)}…` : quote;
  const textChanged = Boolean(quote) && anchorStatus === 'changed' && !thread.detached;

  /** Tells the author when the server left out mentions of people without access. */
  const reportDropped = (result) => {
    if (result && result.droppedMentions)
      fail(
        t(
          'editor.comments.mentions.dropped',
          '{count, plural, one {# person was} other {# people were}} not mentioned: they cannot read this field.',
          { count: result.droppedMentions }
        )
      );
  };
  const headingId = `mex-comment-thread-${thread.id}`;

  const errorMessage = (error) =>
    error && error.status === 429
      ? t('editor.comments.rateLimited', 'Too many comments. Try again in a minute.')
      : t('editor.comments.actionFailed', 'This did not work. Try again.');

  const sendReply = async () => {
    if (!reply.trim() || busy) return;
    setBusy('reply');
    try {
      reportDropped(await actions.reply(thread.id, reply, replyMentions));
      setReply('');
      setReplyMentions([]);
      setReplying(false);
      announce(t('editor.comments.announce.replied', 'Reply added'));
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.value.trim() || busy) return;
    setBusy(`edit:${editing.id}`);
    try {
      reportDropped(await actions.edit(editing.id, editing.value, editing.mentions));
      setEditing(null);
      announce(t('editor.comments.announce.saved', 'Comment saved'));
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const toggleResolved = async () => {
    if (busy) return;
    setBusy('resolve');
    try {
      if (resolved) {
        await actions.reopen(thread.id);
        announce(t('editor.comments.announce.reopened', 'Thread reopened'));
      } else {
        await actions.resolve(thread.id);
        announce(t('editor.comments.announce.resolved', 'Thread resolved'));
      }
    } catch (error) {
      fail(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (comment, isThread) => {
    try {
      await actions.remove(comment.id);
      announce(t('editor.comments.announce.deleted', 'Comment deleted'));
    } catch (error) {
      fail(t('editor.comments.deleteFailed', 'The comment could not be deleted.'));
      throw error;
    }
    if (isThread && fallbackFocusRef && fallbackFocusRef.current) fallbackFocusRef.current.focus();
  };

  return (
    <Card
      ref={ref}
      tag="article"
      tabIndex={-1}
      aria-labelledby={headingId}
      padding={3}
      hasRadius
      borderColor={active ? 'secondary500' : resolved ? 'neutral150' : 'neutral200'}
      background={resolved ? 'neutral100' : 'neutral0'}
      data-testid="mex-comment-thread"
      data-thread-id={thread.id}
      data-status={thread.status}
      data-detached={thread.detached ? 'true' : 'false'}
      data-positional={positional ? 'true' : 'false'}
      data-anchor={quote ? anchorStatus || 'unknown' : 'block'}
      data-active={active ? 'true' : 'false'}
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2} wrap="wrap">
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 16rem">
            <Wrap variant="sigma" tag="h4" id={headingId} textColor="neutral600">
              {quote
                ? t('editor.comments.thread.onText', 'On selected text')
                : t('editor.comments.thread.on', 'On: {excerpt}', { excerpt })}
            </Wrap>
            {quote ? (
              <Quote variant="omega" textColor="neutral800" data-testid="mex-comment-quote">
                {shownQuote}
              </Quote>
            ) : null}
            <Flex gap={2} wrap="wrap">
              {notification ? (
                <Badge
                  backgroundColor="alternative100"
                  textColor="alternative700"
                  data-testid="mex-comment-notified"
                >
                  {notification === 'mention'
                    ? t('editor.comments.notified.mention', 'Mentioned you')
                    : t('editor.comments.notified.reply', 'New reply')}
                </Badge>
              ) : null}
              {textChanged ? (
                <Badge backgroundColor="warning100" textColor="neutral800">
                  {t('editor.comments.textChanged', 'Text changed')}
                </Badge>
              ) : null}
              {positional ? (
                <Badge backgroundColor="neutral150" textColor="neutral800">
                  {t('editor.comments.positional.badge', 'Saved by position')}
                </Badge>
              ) : null}
              {textChanged ? (
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.comments.textChangedHint',
                    'The commented text was changed or deleted. The thread stays on its block.'
                  )}
                </Typography>
              ) : null}
              {thread.detached && !positional ? (
                <Badge backgroundColor="warning100" textColor="neutral800">
                  {t('editor.comments.detached', 'Block removed')}
                </Badge>
              ) : null}
              {resolved ? (
                <Badge backgroundColor="success100" textColor="success700">
                  {t('editor.comments.resolvedBadge', 'Resolved')}
                </Badge>
              ) : null}
            </Flex>
          </Flex>
          {thread.detached || positional ? null : quote && anchorStatus === 'anchored' && onShowRange ? (
            <Button variant="ghost" size="S" onClick={() => onShowRange(thread.id)}>
              {t('editor.comments.showText', 'Show text')}
            </Button>
          ) : (
            <Button variant="ghost" size="S" onClick={() => onSelectBlock(thread.blockId)}>
              {t('editor.comments.showBlock', 'Show block')}
            </Button>
          )}
        </Flex>
        {positional ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.comments.positional.hint',
              'Written before this section had its own comments. It may belong to another entry of this list, so it is read-only.'
            )}
          </Typography>
        ) : null}
        {thread.detached && !positional ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.comments.detachedHint',
              'The block of this thread was deleted. The thread stays readable and can be resolved.'
            )}
          </Typography>
        ) : null}

        <List>
          {thread.comments.map((comment, index) => {
            const isThread = index === 0;
            const own = comment.author.own;
            const canDelete = (own && canWrite) || canModerate;
            const isEditing = editing && editing.id === comment.id;
            return (
              <li key={comment.id} data-testid="mex-comment" data-own={own ? 'true' : 'false'}>
                <Flex direction="column" alignItems="stretch" gap={1}>
                  <CommentMeta comment={comment} t={t} />
                  {isEditing ? (
                    <Flex direction="column" alignItems="stretch" gap={2}>
                      <MentionTextarea
                        name={`edit-${comment.id}`}
                        label={t('editor.comments.editLabel', 'Edit comment')}
                        value={editing.value}
                        onChange={(value) => setEditing((current) => ({ ...current, value }))}
                        mentions={editing.mentions}
                        onMentionsChange={(next) => setEditing((current) => ({ ...current, mentions: next }))}
                        search={searchMentions}
                        onSubmit={saveEdit}
                        onCancel={() => setEditing(null)}
                        t={t}
                        autoFocus
                      />
                      <Flex gap={2} wrap="wrap">
                        <Button
                          size="S"
                          onClick={saveEdit}
                          loading={busy === `edit:${comment.id}`}
                          disabled={!editing.value.trim()}
                        >
                          {t('editor.comments.save', 'Save')}
                        </Button>
                        <Button size="S" variant="tertiary" onClick={() => setEditing(null)}>
                          {t('editor.comments.cancel', 'Cancel')}
                        </Button>
                      </Flex>
                    </Flex>
                  ) : (
                    <Body variant="omega" textColor="neutral800" data-testid="mex-comment-body">
                      <CommentText comment={comment} />
                    </Body>
                  )}
                  {!isEditing && ((own && canWrite) || canDelete) ? (
                    <Flex gap={2} wrap="wrap">
                      {own && canWrite ? (
                        <Button
                          variant="ghost"
                          size="S"
                          onClick={() =>
                            setEditing({
                              id: comment.id,
                              value: comment.body,
                              mentions: (comment.mentions || []).map(({ id, name }) => ({ id, name })),
                            })
                          }
                        >
                          {t('editor.comments.edit', 'Edit')}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="S">
                              {t('editor.comments.delete', 'Delete')}
                            </Button>
                          }
                          title={
                            isThread
                              ? t('editor.comments.delete.threadTitle', 'Delete this thread?')
                              : t('editor.comments.delete.commentTitle', 'Delete this comment?')
                          }
                          body={
                            isThread
                              ? t(
                                  'editor.comments.delete.threadBody',
                                  'The thread and all its replies are deleted for everyone. This cannot be undone.'
                                )
                              : t(
                                  'editor.comments.delete.commentBody',
                                  'The comment is deleted for everyone. This cannot be undone.'
                                )
                          }
                          confirmLabel={t('editor.comments.delete', 'Delete')}
                          onConfirm={() => remove(comment, isThread)}
                          fallbackFocusRef={fallbackFocusRef}
                        />
                      ) : null}
                    </Flex>
                  ) : null}
                </Flex>
              </li>
            );
          })}
        </List>

        {resolved && thread.resolvedBy ? (
          <Typography variant="pi" textColor="neutral600">
            {t('editor.comments.resolvedBy', 'Resolved by {name}', {
              name: thread.resolvedBy.name || t('editor.comments.deletedUser', 'Deleted user'),
            })}
          </Typography>
        ) : null}

        {canWrite ? (
          <Flex direction="column" alignItems="stretch" gap={2}>
            {replying ? (
              <>
                <MentionTextarea
                  name={`reply-${thread.id}`}
                  label={t('editor.comments.replyLabel', 'Reply to this thread')}
                  value={reply}
                  onChange={setReply}
                  mentions={replyMentions}
                  onMentionsChange={setReplyMentions}
                  search={searchMentions}
                  onSubmit={sendReply}
                  onCancel={() => setReplying(false)}
                  t={t}
                  autoFocus
                />
                <Flex gap={2} wrap="wrap">
                  <Button size="S" onClick={sendReply} loading={busy === 'reply'} disabled={!reply.trim()}>
                    {t('editor.comments.reply', 'Reply')}
                  </Button>
                  <Button size="S" variant="tertiary" onClick={() => setReplying(false)}>
                    {t('editor.comments.cancel', 'Cancel')}
                  </Button>
                </Flex>
              </>
            ) : (
              <Flex gap={2} wrap="wrap">
                <Button size="S" variant="secondary" onClick={() => setReplying(true)}>
                  {t('editor.comments.reply', 'Reply')}
                </Button>
                <Button size="S" variant="tertiary" onClick={toggleResolved} loading={busy === 'resolve'}>
                  {resolved ? t('editor.comments.reopen', 'Reopen') : t('editor.comments.resolve', 'Resolve')}
                </Button>
              </Flex>
            )}
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
});

export default CommentThread;

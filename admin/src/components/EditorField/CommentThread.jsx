import { forwardRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Badge, Box, Button, Field, Flex, Textarea, TextButton, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { ConfirmAction } from '../ui/ConfirmAction';
import { MAX_COMMENT_LENGTH, relativeTimeParts } from '../../../../shared/comments.mjs';

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
 * Submits a textarea with Ctrl/Cmd+Enter.
 * @param {KeyboardEvent} event - Key event.
 * @param {() => void} submit - Submit.
 */
const submitOnModEnter = (event, submit) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  }
};

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
 * @param {object} props.thread - Thread (`arrangeThreads` output: `detached`, `position`).
 * @param {string|null} props.blockExcerpt - Current text of the block (null when detached or empty).
 * @param {Function} props.t - Translator.
 * @param {boolean} props.canWrite - Caller may comment, reply and resolve.
 * @param {boolean} props.canModerate - Caller may delete anyone's comment.
 * @param {object} props.actions - `useComments().actions`.
 * @param {(blockId: string) => void} props.onSelectBlock - Shows the block in the editor.
 * @param {(message: string) => void} props.announce - Live-region message.
 * @param {(message: string) => void} props.fail - Error notification.
 * @param {{ current: HTMLElement|null }} props.fallbackFocusRef - Focus target after deleting the thread.
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
  },
  ref
) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const resolved = thread.status === 'resolved';
  const excerpt =
    blockExcerpt || thread.excerpt || t('editor.comments.thread.noExcerpt', 'a block without text');
  const headingId = `mex-comment-thread-${thread.id}`;

  const errorMessage = (error) =>
    error && error.status === 429
      ? t('editor.comments.rateLimited', 'Too many comments. Try again in a minute.')
      : t('editor.comments.actionFailed', 'This did not work. Try again.');

  const sendReply = async () => {
    if (!reply.trim() || busy) return;
    setBusy('reply');
    try {
      await actions.reply(thread.id, reply);
      setReply('');
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
      await actions.edit(editing.id, editing.value);
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
      borderColor={resolved ? 'neutral150' : 'neutral200'}
      background={resolved ? 'neutral100' : 'neutral0'}
      data-testid="mex-comment-thread"
      data-thread-id={thread.id}
      data-status={thread.status}
      data-detached={thread.detached ? 'true' : 'false'}
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2} wrap="wrap">
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 16rem">
            <Wrap variant="sigma" tag="h4" id={headingId} textColor="neutral600">
              {t('editor.comments.thread.on', 'On: {excerpt}', { excerpt })}
            </Wrap>
            <Flex gap={2} wrap="wrap">
              {thread.detached ? (
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
          {thread.detached ? null : (
            <TextButton onClick={() => onSelectBlock(thread.blockId)}>
              {t('editor.comments.showBlock', 'Show block')}
            </TextButton>
          )}
        </Flex>
        {thread.detached ? (
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
                      <Field.Root name={`edit-${comment.id}`}>
                        <Field.Label>{t('editor.comments.editLabel', 'Edit comment')}</Field.Label>
                        <Textarea
                          value={editing.value}
                          maxLength={MAX_COMMENT_LENGTH}
                          onChange={(event) => setEditing({ id: comment.id, value: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.stopPropagation();
                              setEditing(null);
                            } else submitOnModEnter(event, saveEdit);
                          }}
                          autoFocus
                        />
                      </Field.Root>
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
                      {comment.body}
                    </Body>
                  )}
                  {!isEditing && ((own && canWrite) || canDelete) ? (
                    <Flex gap={3} wrap="wrap">
                      {own && canWrite ? (
                        <TextButton onClick={() => setEditing({ id: comment.id, value: comment.body })}>
                          {t('editor.comments.edit', 'Edit')}
                        </TextButton>
                      ) : null}
                      {canDelete ? (
                        <ConfirmAction
                          trigger={<TextButton>{t('editor.comments.delete', 'Delete')}</TextButton>}
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
                <Field.Root name={`reply-${thread.id}`}>
                  <Field.Label>{t('editor.comments.replyLabel', 'Reply to this thread')}</Field.Label>
                  <Textarea
                    value={reply}
                    maxLength={MAX_COMMENT_LENGTH}
                    onChange={(event) => setReply(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setReplying(false);
                      } else submitOnModEnter(event, sendReply);
                    }}
                    autoFocus
                  />
                </Field.Root>
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

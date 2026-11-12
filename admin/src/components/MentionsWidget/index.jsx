import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Flex, IconButton, Typography, VisuallyHidden } from '@strapi/design-system';
import { Bell, Check } from '@strapi/icons';
import { Widget, useFetchClient } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { API } from '../../utils/api';
import { getTranslation } from '../../utils/getTranslation';
import { relativeTimeParts } from '../../../../shared/comments.mjs';
import { notificationPath } from './link.mjs';

/**
 * Homepage widget "Mentions and replies" (2.4): the caller's newest comment
 * notifications (GET /notifications), each linking to the entry with the
 * thread opened; mark one read or unread, or all read. The server lists only
 * notifications of documents the caller can still read. Refreshes every
 * POLL_MS while the tab is visible and when the window gets focus.
 */

const POLL_MS = 60000;
const PAGE_SIZE = 5;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

const Item = styled.li`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
  padding: ${({ theme }) => theme.spaces[2]};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $unread }) => ($unread ? theme.colors.primary100 : 'transparent')};
`;

const Dot = styled.span`
  flex: 0 0 auto;
  width: 0.8rem;
  height: 0.8rem;
  margin-top: 0.6rem;
  border-radius: 50%;
  background: ${({ theme, $unread }) => ($unread ? theme.colors.primary600 : 'transparent')};
`;

const ItemLink = styled(RouterLink)`
  flex: 1 1 auto;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  border-radius: ${({ theme }) => theme.borderRadius};
  &:hover span:first-child {
    text-decoration: underline;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const Wrap = styled(Typography)`
  display: block;
  overflow-wrap: anywhere;
  min-width: 0;
`;

/**
 * @returns {JSX.Element} Widget body.
 */
export const MentionsWidget = () => {
  const { formatMessage, formatRelativeTime } = useIntl();
  const { get, post } = useFetchClient();
  const [state, setState] = useState({ loading: true, error: false, items: [], unread: 0 });
  const [announcement, setAnnouncement] = useState('');
  const requestRef = useRef(0);
  const t = useCallback(
    (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values),
    [formatMessage]
  );

  const load = useCallback(() => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    return get(API.notifications, { params: { pageSize: PAGE_SIZE } }).then(
      ({ data }) => {
        if (requestRef.current !== id) return;
        setState({
          loading: false,
          error: false,
          items: Array.isArray(data.data) ? data.data : [],
          unread: Number(data.meta && data.meta.unread) || 0,
        });
      },
      () => {
        if (requestRef.current !== id) return;
        setState((current) => ({ ...current, loading: false, error: true }));
      }
    );
  }, [get]);

  useEffect(() => {
    let timer = null;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = window.setTimeout(async () => {
        await load();
        schedule();
      }, POLL_MS);
    };
    const onWake = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(timer);
        return;
      }
      load();
      schedule();
    };
    load();
    schedule();
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [load]);

  const act = async (request, message) => {
    try {
      await request();
      setAnnouncement(message);
      await load();
    } catch {
      setAnnouncement(t('widget.mentions.failed', 'This did not work. Try again.'));
    }
  };

  if (state.loading && !state.items.length) {
    return <Widget.Loading>{t('widget.mentions.loading', 'Loading mentions')}</Widget.Loading>;
  }
  if (state.error && !state.items.length) {
    return <Widget.Error>{t('widget.mentions.error', 'Mentions could not be loaded.')}</Widget.Error>;
  }
  if (!state.items.length) {
    return (
      <Widget.NoData>
        {t(
          'widget.mentions.empty',
          'No mentions yet. When someone mentions you in a comment or replies to your thread, it shows up here.'
        )}
      </Widget.NoData>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-testid="mex-mentions-widget">
      <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
        <Typography variant="pi" textColor="neutral600">
          {t('widget.mentions.unread', '{count, plural, =0 {All read} one {# unread} other {# unread}}', {
            count: state.unread,
          })}
        </Typography>
        {state.unread ? (
          <Button
            size="S"
            variant="tertiary"
            onClick={() =>
              act(
                () => post(API.notificationsReadAll, {}),
                t('widget.mentions.allRead', 'All notifications marked as read')
              )
            }
          >
            {t('widget.mentions.markAll', 'Mark all as read')}
          </Button>
        ) : null}
      </Flex>
      <List>
        {state.items.map((item) => {
          const actor =
            item.actor && item.actor.name
              ? item.actor.name
              : t('widget.mentions.deletedUser', 'Deleted user');
          const what =
            item.kind === 'mention'
              ? t('widget.mentions.mentioned', '{name} mentioned you', { name: actor })
              : t('widget.mentions.replied', '{name} replied in a thread you are in', { name: actor });
          const where = item.target.title
            ? t('widget.mentions.where', '{title} ({type})', {
                title: item.target.title,
                type: item.target.typeName,
              })
            : item.target.typeName;
          const { value, unit } = relativeTimeParts(item.createdAt);
          return (
            <Item
              key={item.id}
              $unread={!item.read}
              data-testid="mex-mention-item"
              data-read={item.read ? 'true' : 'false'}
            >
              <Dot $unread={!item.read} aria-hidden="true" />
              <ItemLink to={notificationPath(item)}>
                <Wrap variant="omega" fontWeight={item.read ? 'regular' : 'bold'} textColor="neutral800">
                  {what}
                  {item.read ? null : (
                    <VisuallyHidden>{` (${t('widget.mentions.new', 'unread')})`}</VisuallyHidden>
                  )}
                </Wrap>
                <Wrap variant="pi" textColor="neutral600">
                  {where} · {formatRelativeTime(value, unit, { numeric: 'auto' })}
                </Wrap>
                {item.snippet ? (
                  <Wrap variant="pi" textColor="neutral700">
                    {item.snippet}
                  </Wrap>
                ) : null}
              </ItemLink>
              <Box flex="0 0 auto">
                {item.read ? (
                  <IconButton
                    label={t('widget.mentions.markUnread', 'Mark as unread')}
                    variant="ghost"
                    onClick={() =>
                      act(
                        () => post(API.notificationUnread(item.id), {}),
                        t('widget.mentions.markedUnread', 'Marked as unread')
                      )
                    }
                  >
                    <Bell />
                  </IconButton>
                ) : (
                  <IconButton
                    label={t('widget.mentions.markRead', 'Mark as read')}
                    variant="ghost"
                    onClick={() =>
                      act(
                        () => post(API.notificationRead(item.id), {}),
                        t('widget.mentions.markedRead', 'Marked as read')
                      )
                    }
                  >
                    <Check />
                  </IconButton>
                )}
              </Box>
            </Item>
          );
        })}
      </List>
      <VisuallyHidden aria-live="polite" aria-atomic="true">
        {announcement}
      </VisuallyHidden>
    </Flex>
  );
};

export default MentionsWidget;

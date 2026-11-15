import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { Button, Flex, Typography } from '@strapi/design-system';
import { Widget, useFetchClient } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { API } from '../../utils/api';
import { useT } from '../ui/useT';
import { relativeTimeParts } from '../../../../shared/comments.mjs';
import { entryPath } from '../EntryPanel/logic.mjs';

/**
 * Homepage widgets (2.5): "My open threads" (unresolved threads the admin started or was mentioned
 * in) and "Broken links" (entries with problems in the last scheduled link check). Each lists at most
 * PAGE_SIZE items that link to the entry; the server serves only what the admin can read. Both
 * refresh every POLL_MS while the tab is visible and when the window gets focus.
 */

const POLL_MS = 60000;
const PAGE_SIZE = 5;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[1]};
  min-width: 0;
`;

const ItemLink = styled(RouterLink)`
  display: block;
  min-width: 0;
  padding: ${({ theme }) => theme.spaces[2]};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: inherit;
  text-decoration: none;
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
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
 * Polls one widget route.
 * @param {string} path - API path.
 * @returns {{ loading: boolean, error: boolean, items: Array<object>, meta: object, reload: () => void }} State.
 */
const useWidgetData = (path) => {
  const { get } = useFetchClient();
  const [state, setState] = useState({ loading: true, error: false, items: [], meta: {} });
  const requestRef = useRef(0);
  const load = useCallback(() => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    return get(path, { params: { pageSize: PAGE_SIZE } }).then(
      ({ data }) => {
        if (requestRef.current !== id) return;
        setState({
          loading: false,
          error: false,
          items: Array.isArray(data.data) ? data.data : [],
          meta: data.meta || {},
        });
      },
      () => {
        if (requestRef.current !== id) return;
        setState((current) => ({ ...current, loading: false, error: true }));
      }
    );
  }, [get, path]);
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
  return { ...state, reload: load };
};

/**
 * Error state with a retry button (the Widget helpers take only a string).
 * @param {{ text: string, retry: string, onRetry: () => void }} props - Props.
 * @returns {JSX.Element} Error.
 */
const ErrorState = ({ text, retry, onRetry }) => (
  <Flex direction="column" gap={2} alignItems="center">
    <Widget.Error>{text}</Widget.Error>
    <Button size="S" variant="tertiary" onClick={onRetry}>
      {retry}
    </Button>
  </Flex>
);

/**
 * Entry line: "<title> (<type>)" or the type alone when the title is not readable.
 * @param {Function} t - Translate.
 * @param {{ title: string|null, typeName: string }} target - Entry.
 * @returns {string} Text.
 */
const entryName = (t, target) =>
  target.title
    ? t('widget.openThreads.where', '{title} ({type})', { title: target.title, type: target.typeName })
    : target.typeName;

/**
 * Homepage widget "My open threads".
 * @returns {JSX.Element} Widget body.
 */
export const OpenThreadsWidget = () => {
  const t = useT();
  const { formatRelativeTime } = useIntl();
  const state = useWidgetData(API.widgetOpenThreads);
  if (state.loading && !state.items.length)
    return <Widget.Loading>{t('widget.openThreads.loading', 'Loading threads')}</Widget.Loading>;
  if (state.error && !state.items.length)
    return (
      <ErrorState
        text={t('widget.openThreads.error', 'Threads could not be loaded.')}
        retry={t('widget.retry', 'Try again')}
        onRetry={state.reload}
      />
    );
  if (!state.items.length)
    return (
      <Widget.NoData>
        {t(
          'widget.openThreads.empty',
          'No open threads. Threads you start or are mentioned in stay here until they are resolved.'
        )}
      </Widget.NoData>
    );
  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-testid="mex-open-threads-widget">
      <List>
        {state.items.map((item) => {
          const { value, unit } = relativeTimeParts(item.updatedAt);
          const why = item.started
            ? t('widget.openThreads.started', 'You started this thread')
            : t('widget.openThreads.mentioned', 'You were mentioned');
          return (
            <li key={item.threadId} data-testid="mex-open-thread">
              <ItemLink to={entryPath(item.target, { mexThread: item.threadId })}>
                <Wrap variant="omega" fontWeight="bold" textColor="neutral800">
                  {item.excerpt || item.snippet || entryName(t, item.target)}
                </Wrap>
                <Wrap variant="pi" textColor="neutral600">
                  {entryName(t, item.target)} · {why} · {formatRelativeTime(value, unit, { numeric: 'auto' })}
                </Wrap>
              </ItemLink>
            </li>
          );
        })}
      </List>
      {state.meta.more ? (
        <Typography variant="pi" textColor="neutral600">
          {t('widget.openThreads.more', 'More open threads are not shown. Resolve threads to see the rest.')}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * Homepage widget "Broken links".
 * @returns {JSX.Element} Widget body.
 */
export const BrokenLinksWidget = () => {
  const t = useT();
  const { formatDate } = useIntl();
  const state = useWidgetData(API.widgetBrokenLinks);
  if (state.loading && !state.items.length && !state.meta.lastRun)
    return <Widget.Loading>{t('widget.brokenLinks.loading', 'Loading links')}</Widget.Loading>;
  if (state.error && !state.items.length)
    return (
      <ErrorState
        text={t('widget.brokenLinks.error', 'Broken links could not be loaded.')}
        retry={t('widget.retry', 'Try again')}
        onRetry={state.reload}
      />
    );
  if (state.meta.enabled === false)
    return (
      <Widget.NoData>
        {t('widget.brokenLinks.off', 'The scheduled link check is turned off in the server configuration.')}
      </Widget.NoData>
    );
  if (!state.meta.lastRun)
    return (
      <Widget.NoData>
        {t(
          'widget.brokenLinks.noRun',
          'The scheduled link check has not run yet. Results show up here after it runs.'
        )}
      </Widget.NoData>
    );
  const checked = t('widget.brokenLinks.lastRun', 'Last check {date}', {
    date: formatDate(state.meta.lastRun.finishedAt, { dateStyle: 'medium', timeStyle: 'short' }),
  });
  if (!state.items.length)
    return (
      <Flex direction="column" gap={2} alignItems="center">
        <Widget.NoData>
          {t('widget.brokenLinks.empty', 'No broken links in the entries you can read.')}
        </Widget.NoData>
        <Typography variant="pi" textColor="neutral600">
          {checked}
        </Typography>
      </Flex>
    );
  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-testid="mex-broken-links-widget">
      <List>
        {state.items.map((item) => (
          <li
            key={`${item.target.uid}|${item.target.documentId}|${item.target.locale || ''}`}
            data-testid="mex-broken-entry"
          >
            <ItemLink to={entryPath(item.target)}>
              <Wrap variant="omega" fontWeight="bold" textColor="neutral800">
                {entryName(t, item.target)}
              </Wrap>
              <Wrap variant="pi" textColor="neutral600">
                {t(
                  'widget.brokenLinks.count',
                  '{count, plural, one {# broken link} other {# broken links}}',
                  {
                    count: item.problems,
                  }
                )}
                {item.target.locale ? ` · ${item.target.locale}` : ''}
              </Wrap>
            </ItemLink>
          </li>
        ))}
      </List>
      <Typography variant="pi" textColor="neutral600">
        {state.meta.more
          ? t('widget.brokenLinks.more', 'More entries have broken links. {date}', { date: checked })
          : checked}
      </Typography>
    </Flex>
  );
};

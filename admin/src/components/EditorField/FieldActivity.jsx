import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Badge, Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import { API } from '../../utils/api';
import { actorLabel, changeSummary, eventLabel } from '../audit/auditText';

const PAGE_SIZE = 20;

/**
 * Activity of one field (audit trail, 2.4): who changed it and when, with
 * counts and block ids only. Shown as a tab of the version history for
 * admins with `audit.read`; the server also checks Content Manager read on
 * the document (404 otherwise).
 * @param {{ t: Function, target: { uid: string, documentId: string, locale?: string|null, field: string } }} props - Props.
 * @returns {JSX.Element} Activity list.
 */
export const FieldActivity = ({ t, target }) => {
  const { formatDate } = useIntl();
  const { get } = useFetchClient();
  const [state, setState] = useState({ loading: true, error: false, items: [], page: 0, pageCount: 0 });

  const fetchPage = useCallback(
    (page) =>
      get(API.audit, {
        params: {
          uid: target.uid,
          documentId: target.documentId,
          locale: target.locale || undefined,
          field: target.field,
          page,
          pageSize: PAGE_SIZE,
        },
      }).then(
        ({ data }) =>
          setState((current) => ({
            loading: false,
            error: false,
            items: page === 1 ? data.data || [] : [...current.items, ...(data.data || [])],
            page,
            pageCount: (data.meta && data.meta.pagination && data.meta.pagination.pageCount) || 0,
          })),
        () => setState((current) => ({ ...current, loading: false, error: true }))
      ),
    [get, target.uid, target.documentId, target.locale, target.field]
  );

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  const more = () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    fetchPage(state.page + 1);
  };
  const retry = () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    fetchPage(Math.max(1, state.page || 1));
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3} paddingTop={3}>
      <Typography variant="pi" textColor="neutral600">
        {t(
          'editor.activity.description',
          'Who changed this field and when. Only counts and block ids are kept, never the content.'
        )}
      </Typography>
      {state.error ? (
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography textColor="danger600">
            {t('editor.activity.error', 'The activity could not be loaded.')}
          </Typography>
          <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={retry}>
            {t('editor.history.retry', 'Try again')}
          </Button>
        </Flex>
      ) : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <Typography textColor="neutral600">
          {t('editor.activity.empty', 'No activity recorded for this field yet.')}
        </Typography>
      ) : null}
      {state.items.length > 0 ? (
        <Flex
          tag="ul"
          direction="column"
          alignItems="stretch"
          gap={2}
          aria-label={t('editor.activity.listLabel', 'Activity')}
        >
          {state.items.map((item) => {
            const summary = changeSummary(t, item);
            return (
              <Box
                key={item.id}
                tag="li"
                padding={3}
                hasRadius
                borderColor="neutral200"
                background="neutral0"
              >
                <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                  <Flex gap={2} wrap="wrap" minWidth={0}>
                    <Badge>{eventLabel(t, item.event)}</Badge>
                    <Typography variant="pi" textColor="neutral600">
                      {t('editor.history.byline', '{date} by {name}', {
                        date: formatDate(new Date(item.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                        name: actorLabel(t, item.actor),
                      })}
                    </Typography>
                  </Flex>
                  {summary ? (
                    <Typography variant="pi" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                      {summary}
                    </Typography>
                  ) : null}
                  {item.blockIds && item.blockIds.length ? (
                    <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                      {t('editor.activity.blocks', 'Blocks: {ids}', { ids: item.blockIds.join(', ') })}
                    </Typography>
                  ) : null}
                </Flex>
              </Box>
            );
          })}
        </Flex>
      ) : null}
      {state.loading ? (
        <Flex justifyContent="center" padding={3}>
          <Loader small>{t('editor.activity.loading', 'Loading activity')}</Loader>
        </Flex>
      ) : null}
      {!state.loading && !state.error && state.page < state.pageCount ? (
        <Flex>
          <Button variant="tertiary" onClick={more}>
            {t('editor.activity.more', 'Show older activity')}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
};

export default FieldActivity;

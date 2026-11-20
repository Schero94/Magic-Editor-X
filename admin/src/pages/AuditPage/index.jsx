import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Alert,
  Badge,
  Box,
  Button,
  DatePicker,
  EmptyStateLayout,
  Field,
  Flex,
  Grid,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, Filter } from '@strapi/icons';
import { Page, Pagination, useQueryParams, useRBAC } from '@strapi/strapi/admin';
import { useFetchClient } from '../../utils/fetch-client';
import { PERMISSIONS } from '../../permissions';
import { API } from '../../utils/api';
import { PageShell, SectionCard, useBreakpoint, useT } from '../../components/ui';
import { EVENT_LABELS, actorLabel, changeSummary, eventLabel } from '../../components/audit/auditText';
import { PAGE_HEADING } from '../focusTargets.mjs';
import { activeElement, useFocusRestore } from '../useFocusRestore';
import { fromDateValue, toDateValue } from './auditDates.mjs';

const ALL = '__all__';
const UID_PATTERN = /^(api|plugin)::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/;
const DOCUMENT_ID_PATTERN = /^[a-z0-9]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_KEYS = ['event', 'actor', 'uid', 'documentId', 'from', 'to'];

/**
 * Filters from the URL (only well-formed values are used).
 * @param {Record<string, unknown>} query - URL query.
 * @returns {{ event: string, actor: string, uid: string, documentId: string, from: string, to: string }} Filters.
 */
const readFilters = (query) => {
  const text = (key) => (typeof query[key] === 'string' ? query[key] : '');
  return {
    event: text('event'),
    actor: /^\d{1,10}$/.test(text('actor')) ? text('actor') : '',
    uid: text('uid'),
    documentId: text('documentId'),
    from: DATE_PATTERN.test(text('from')) ? text('from') : '',
    to: DATE_PATTERN.test(text('to')) ? text('to') : '',
  };
};

/** Content types of the plugin itself, shown by name instead of their uid in "Where". */
const PLUGIN_TARGETS = {
  'plugin::magic-editor-x.template': ['settings.audit.target.template', 'Template or synced block'],
};

/**
 * Filter form. Keyed by the applied filters, so it starts from them again
 * after "Apply" or "Reset" (or a URL change).
 * @param {{ t: Function, locale: string, applied: object, actors: Array<{ id: number, name: string|null }>, active: boolean, onApply: (draft: object) => void, onReset: () => void, applyRef: object, formRef: object }} props - Props;
 *   `applyRef` and `formRef` let the page put focus back after the form starts again (2.7.8).
 * @returns {JSX.Element} Section.
 */
const AuditFilters = ({ t, locale, applied, actors, active, onApply, onReset, applyRef, formRef }) => {
  const [draft, setDraft] = useState(applied);
  const uidInvalid = draft.uid !== '' && !UID_PATTERN.test(draft.uid);
  const documentInvalid = draft.documentId !== '' && !DOCUMENT_ID_PATTERN.test(draft.documentId);
  const documentWithoutUid = draft.documentId !== '' && draft.uid === '';
  const rangeInvalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  const canApply = !uidInvalid && !documentInvalid && !documentWithoutUid && !rangeInvalid;
  const apply = (event) => {
    if (event) event.preventDefault();
    if (canApply) onApply(draft);
  };
  const reset = onReset;
  return (
    <SectionCard
      title={t('settings.audit.filters', 'Filters')}
      action={
        active ? (
          <Button variant="tertiary" onClick={reset}>
            {t('settings.audit.reset', 'Reset filters')}
          </Button>
        ) : null
      }
    >
      <Box tag="form" ref={formRef} onSubmit={apply} noValidate>
        <Grid.Root gap={{ initial: 4, medium: 6 }}>
          <Grid.Item col={4} s={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root name="event">
              <Field.Label>{t('settings.audit.filter.event', 'Event')}</Field.Label>
              <SingleSelect
                value={draft.event || ALL}
                onChange={(value) => setDraft({ ...draft, event: value === ALL ? '' : String(value) })}
              >
                <SingleSelectOption value={ALL}>
                  {t('settings.audit.filter.allEvents', 'All events')}
                </SingleSelectOption>
                {Object.keys(EVENT_LABELS).map((event) => (
                  <SingleSelectOption key={event} value={event}>
                    {eventLabel(t, event)}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root name="actor">
              <Field.Label>{t('settings.audit.filter.actor', 'Changed by')}</Field.Label>
              <SingleSelect
                value={draft.actor || ALL}
                onChange={(value) => setDraft({ ...draft, actor: value === ALL ? '' : String(value) })}
              >
                <SingleSelectOption value={ALL}>
                  {t('settings.audit.filter.allActors', 'Everyone')}
                </SingleSelectOption>
                {actors.map((actor) => (
                  <SingleSelectOption key={actor.id} value={String(actor.id)}>
                    {actor.name || t('settings.audit.actor.unnamed', 'Admin without a name')}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root
              name="uid"
              error={
                uidInvalid
                  ? t('settings.audit.filter.uidInvalid', 'Use a uid such as api::article.article.')
                  : undefined
              }
            >
              <Field.Label>{t('settings.audit.filter.uid', 'Content type')}</Field.Label>
              <TextInput
                value={draft.uid}
                placeholder="api::article.article"
                onChange={(event) => setDraft({ ...draft, uid: event.target.value.trim() })}
              />
              <Field.Error />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root
              name="documentId"
              hint={t('settings.audit.filter.documentHint', 'Needs a content type.')}
              error={
                documentInvalid
                  ? t('settings.audit.filter.documentInvalid', 'Use lowercase letters and digits only.')
                  : documentWithoutUid
                    ? t('settings.audit.filter.documentHint', 'Needs a content type.')
                    : undefined
              }
            >
              <Field.Label>{t('settings.audit.filter.document', 'Document id')}</Field.Label>
              <TextInput
                value={draft.documentId}
                onChange={(event) => setDraft({ ...draft, documentId: event.target.value.trim() })}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root name="from">
              <Field.Label>{t('settings.audit.filter.from', 'From')}</Field.Label>
              {/* 2.7.8: the DS date picker shows and reads the date in the admin language's format. */}
              <DatePicker
                locale={locale}
                value={toDateValue(draft.from)}
                onChange={(date) => setDraft({ ...draft, from: fromDateValue(date) })}
                onClear={() => setDraft({ ...draft, from: '' })}
                clearLabel={t('settings.audit.filter.clearFrom', 'Clear the start date')}
              />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root
              name="to"
              error={
                rangeInvalid
                  ? t('settings.audit.filter.rangeInvalid', 'The end is before the start.')
                  : undefined
              }
            >
              <Field.Label>{t('settings.audit.filter.to', 'To')}</Field.Label>
              <DatePicker
                locale={locale}
                value={toDateValue(draft.to)}
                onChange={(date) => setDraft({ ...draft, to: fromDateValue(date) })}
                onClear={() => setDraft({ ...draft, to: '' })}
                clearLabel={t('settings.audit.filter.clearTo', 'Clear the end date')}
              />
              <Field.Error />
            </Field.Root>
          </Grid.Item>
        </Grid.Root>
        <Flex gap={2} wrap="wrap" paddingTop={6}>
          <Button ref={applyRef} type="submit" startIcon={<Filter />} disabled={!canApply}>
            {t('settings.audit.apply', 'Apply filters')}
          </Button>
        </Flex>
      </Box>
    </SectionCard>
  );
};

/**
 * Settings > Magic Editor X > Audit trail (2.4): who changed what and when
 * in editor fields, templates, synced blocks, comments, AI and settings.
 * Counts and block ids only, never content. Needs `audit.read` and
 * `settings.read` (the route checks both). Filters and the page live in the
 * URL, so a filtered view can be shared and survives reloads.
 * @returns {JSX.Element} Page.
 */
const AuditPage = () => {
  const t = useT();
  const { formatDate, locale } = useIntl();
  const { get } = useFetchClient();
  const { isBelowLarge, isBelowMedium } = useBreakpoint();
  const audit = useRBAC(PERMISSIONS.auditRead);
  const settings = useRBAC(PERMISSIONS.settingsRead);
  const [{ query }, setQuery] = useQueryParams();
  const applied = readFilters(query);
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 25;
  const [result, setResult] = useState({
    key: null,
    failed: false,
    items: [],
    pagination: null,
    enabled: true,
  });
  const [nonce, setNonce] = useState(0);
  const [actors, setActors] = useState([]);
  // 2.7.8: Refresh and "Try again" are disabled or replaced while the list loads, Apply and Reset
  // start the filter form again: focus goes back to a stable control, never to <body>.
  const requestFocus = useFocusRestore();
  const refreshRef = useRef(null);
  const applyRef = useRef(null);
  const formRef = useRef(null);
  const focusAfterLoad = useRef(null);
  const allowed = audit.allowedActions.canRead && settings.allowedActions.canRead;
  const appliedKey = JSON.stringify(applied);
  const requestKey = `${appliedKey}|${page}|${pageSize}|${nonce}`;
  const title = t('settings.audit.title', 'Audit trail');
  // The shown result belongs to the current request until a new one finishes.
  const state = {
    ...result,
    status: result.key !== requestKey ? 'loading' : result.failed ? 'error' : 'ready',
  };

  const params = { page, pageSize };
  if (applied.event) params.event = applied.event;
  if (applied.actor) params.actor = applied.actor;
  if (UID_PATTERN.test(applied.uid)) params.uid = applied.uid;
  if (params.uid && DOCUMENT_ID_PATTERN.test(applied.documentId)) params.documentId = applied.documentId;
  if (applied.from) params.from = `${applied.from}T00:00:00`;
  if (applied.to) params.to = `${applied.to}T23:59:59`;
  const paramsKey = JSON.stringify(params);

  // Each effect aborts its own request on cleanup. Strapi's fetch client reads its unmount signal
  // only after an await, so with React 19 StrictMode the first mount's request was not aborted by
  // `useFetchClient` and the list and the actors were requested twice.
  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    get(API.audit, { params: JSON.parse(paramsKey), signal: controller.signal }).then(
      ({ data }) => {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          failed: false,
          items: data.data || [],
          pagination: (data.meta && data.meta.pagination) || null,
          enabled: !(data.meta && data.meta.enabled === false),
        });
      },
      () => {
        if (!controller.signal.aborted)
          setResult((current) => ({ ...current, key: requestKey, failed: true }));
      }
    );
    return () => controller.abort();
  }, [allowed, get, paramsKey, requestKey]);

  const load = () => {
    focusAfterLoad.current = [activeElement(), refreshRef, PAGE_HEADING];
    setNonce((value) => value + 1);
  };

  // Runs the focus move a reload asked for once its result is shown.
  const loading = result.key !== requestKey;
  useEffect(() => {
    if (loading || !focusAfterLoad.current) return;
    const candidates = focusAfterLoad.current;
    focusAfterLoad.current = null;
    requestFocus(candidates);
  }, [loading, requestFocus]);

  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    get(API.auditActors, { signal: controller.signal }).then(
      ({ data }) => {
        if (!controller.signal.aborted) setActors(data.data || []);
      },
      () => {
        if (!controller.signal.aborted) setActors([]);
      }
    );
    return () => controller.abort();
  }, [allowed, get]);

  if (audit.isLoading || settings.isLoading) {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.Loading />
      </>
    );
  }
  if (!allowed) {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.NoPermissions />
      </>
    );
  }

  const firstFilter = () =>
    formRef.current && formRef.current.querySelector('[role="combobox"], input, button');
  const apply = (draft) => {
    const next = { page: 1, pageSize };
    for (const key of FILTER_KEYS) next[key] = draft[key] || undefined;
    setQuery(next);
    requestFocus([applyRef, firstFilter, PAGE_HEADING]);
  };
  // "Reset filters" disappears with the filters it resets: focus goes to the first filter.
  const reset = () => {
    const cleared = Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined]));
    setQuery({ ...cleared, page: 1, pageSize });
    requestFocus([firstFilter, applyRef, PAGE_HEADING]);
  };
  const active = FILTER_KEYS.some((key) => applied[key]);
  const when = (value) => formatDate(new Date(value), { dateStyle: 'medium', timeStyle: 'short' });
  const targetText = (item) => {
    const target = item.target || {};
    if (!target.uid) return t('settings.audit.target.none', 'Plugin settings');
    const own = PLUGIN_TARGETS[target.uid];
    const parts = [own ? t(own[0], own[1]) : target.uid];
    if (target.documentId) parts.push(target.documentId);
    if (target.locale) parts.push(target.locale);
    if (target.field) parts.push(target.field);
    return parts.join(' · ');
  };

  const filters = (
    <AuditFilters
      key={appliedKey}
      t={t}
      locale={locale}
      applyRef={applyRef}
      formRef={formRef}
      applied={applied}
      actors={actors}
      active={active}
      onApply={apply}
      onReset={reset}
    />
  );

  let results;
  if (state.status === 'error') {
    results = (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography textColor="danger600">
          {t('settings.audit.error', 'The audit trail could not be loaded.')}
        </Typography>
        <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={load}>
          {t('settings.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (state.status === 'loading' && state.items.length === 0) {
    results = (
      <Flex justifyContent="center" padding={6}>
        <Loader small>{t('settings.audit.loading', 'Loading the audit trail')}</Loader>
      </Flex>
    );
  } else if (state.items.length === 0) {
    results = (
      <EmptyStateLayout
        content={
          active
            ? t('settings.audit.emptyFiltered', 'No events match these filters.')
            : t('settings.audit.empty', 'No events recorded yet.')
        }
        action={
          active ? (
            <Button variant="secondary" onClick={reset}>
              {t('settings.audit.reset', 'Reset filters')}
            </Button>
          ) : undefined
        }
      />
    );
  } else if (isBelowLarge) {
    results = (
      <Flex tag="ul" direction="column" alignItems="stretch" gap={3} aria-label={title}>
        {state.items.map((item) => {
          const summary = changeSummary(t, item);
          return (
            <Box
              key={item.id}
              tag="li"
              padding={4}
              hasRadius
              borderColor="neutral200"
              background="neutral0"
              minWidth={0}
            >
              <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                <Flex gap={2} wrap="wrap">
                  <Badge>{eventLabel(t, item.event)}</Badge>
                  <Typography variant="pi" textColor="neutral600">
                    {when(item.createdAt)}
                  </Typography>
                </Flex>
                <Typography variant="omega" textColor="neutral800">
                  {actorLabel(t, item.actor)}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                  {targetText(item)}
                </Typography>
                {summary ? (
                  <Typography variant="pi" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                    {summary}
                  </Typography>
                ) : null}
              </Flex>
            </Box>
          );
        })}
      </Flex>
    );
  } else {
    results = (
      <Table colCount={5} rowCount={state.items.length + 1}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">{t('settings.audit.col.time', 'Time')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('settings.audit.col.event', 'Event')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('settings.audit.col.actor', 'Changed by')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('settings.audit.col.target', 'Where')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('settings.audit.col.changes', 'Changes')}</Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {state.items.map((item) => (
            <Tr key={item.id}>
              <Td>
                <Typography textColor="neutral800">{when(item.createdAt)}</Typography>
              </Td>
              <Td>
                <Badge>{eventLabel(t, item.event)}</Badge>
              </Td>
              <Td>
                <Typography textColor="neutral800">{actorLabel(t, item.actor)}</Typography>
              </Td>
              <Td style={{ whiteSpace: 'normal' }}>
                <Typography textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                  {targetText(item)}
                </Typography>
              </Td>
              <Td style={{ whiteSpace: 'normal' }}>
                <Typography textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                  {changeSummary(t, item)}
                </Typography>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  }

  return (
    <PageShell
      title={title}
      subtitle={t(
        'settings.audit.subtitle',
        'Who changed what and when in editor fields, templates, synced blocks, comments, AI actions and settings. Only counts and block ids are kept, never the content.'
      )}
      primaryAction={
        <Button
          ref={refreshRef}
          variant="secondary"
          startIcon={<ArrowClockwise />}
          onClick={load}
          loading={state.status === 'loading'}
        >
          {t('settings.audit.refresh', 'Refresh')}
        </Button>
      }
    >
      {!state.enabled ? (
        <Alert
          variant="warning"
          closeLabel={t('settings.close', 'Close')}
          title={t('settings.audit.offTitle', 'Recording is off')}
        >
          {t(
            'settings.audit.off',
            'The audit trail is turned off in config/plugins.js (audit.enabled). Earlier events are still shown.'
          )}
        </Alert>
      ) : null}
      {filters}
      <SectionCard
        title={t('settings.audit.results', 'Events')}
        subtitle={
          state.pagination
            ? t('settings.audit.total', '{total, plural, one {# event} other {# events}}', {
                total: state.pagination.total,
              })
            : undefined
        }
      >
        {/* aria-busy while a new page or filter loads; the previous rows stay visible meanwhile. */}
        <Box aria-busy={state.status === 'loading'} data-mex-audit-results minWidth={0}>
          {results}
        </Box>
        {state.pagination && state.pagination.total > 0 && !isBelowMedium ? (
          <Pagination.Root
            pageCount={state.pagination.pageCount}
            total={state.pagination.total}
            defaultPageSize={25}
          >
            <Pagination.PageSize options={['10', '25', '50', '100']} />
            <Pagination.Links />
          </Pagination.Root>
        ) : null}
        {/* 2.7.4 (m7): below 768 px page size and page links take one row each and the links show
            fewer pages, so nothing runs off the screen (both read and write the URL query). */}
        {state.pagination && state.pagination.total > 0 && isBelowMedium ? (
          <>
            <Pagination.Root
              pageCount={state.pagination.pageCount}
              total={state.pagination.total}
              defaultPageSize={25}
            >
              <Pagination.PageSize options={['10', '25', '50', '100']} />
            </Pagination.Root>
            <Pagination.Root
              pageCount={state.pagination.pageCount}
              total={state.pagination.total}
              defaultPageSize={25}
            >
              <Pagination.Links boundaryCount={1} siblingCount={0} />
            </Pagination.Root>
          </>
        ) : null}
      </SectionCard>
    </PageShell>
  );
};

export { AuditPage };
export default AuditPage;

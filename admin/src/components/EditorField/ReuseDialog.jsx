import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  Modal,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  TextButton,
  Typography,
} from '@strapi/design-system';
import styled from 'styled-components';
import { API } from '../../utils/api';
import { RenderedContent } from '../RenderedContent';
import { useSyncedSources } from '../../editor/synced-store';
import { blockTypeLabel } from './reuse-labels';
import { scopeFieldOf, filterSyncedForField } from '../../../../shared/templates.mjs';
import { sourceBlocksOf, syncedRefOf, syncedRefsOf } from '../../../../shared/synced.mjs';
import { fieldPathLabel, reuseStatus } from '../../../../shared/reuse.mjs';
import { TouchModalContent } from '../ui/touch';

/**
 * "Insert from another entry" (2.5, More tools > Write): pick an entry (type
 * and language default to the current ones; pickers with one choice are
 * hidden), pick its field when it has several, tick the blocks and insert
 * them after the block the user worked on last. Blocks this field cannot
 * take are shown with the reason and cannot be ticked. The source is the
 * entry as last saved (draft); the dialog says so.
 */

const SEARCH_DELAY_MS = 250;

/** One entry in the result list: a real button, full width. */
const Option = styled.button`
  display: block;
  width: 100%;
  text-align: start;
  cursor: pointer;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[3]}`};
  color: ${({ theme }) => theme.colors.neutral800};
  min-width: 0;
  &:hover {
    background: ${({ theme }) => theme.colors.primary100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const List = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

/** A block row of the preview: checkbox column and the rendered block. */
const Row = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${({ theme }) => theme.spaces[2]};
  padding: ${({ theme }) => theme.spaces[3]};
  border: 1px solid ${({ theme, $checked }) => ($checked ? theme.colors.primary200 : theme.colors.neutral200)};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $disabled }) => ($disabled ? theme.colors.neutral100 : theme.colors.neutral0)};
  min-width: 0;
`;

const PreviewBox = styled(Box)`
  min-width: 0;
  overflow-x: auto;
  /* Images stay small enough to see several blocks at once. */
  img {
    max-height: 16rem;
    max-width: 100%;
    width: auto;
    object-fit: contain;
  }
`;

const Ellipsis = styled(Typography)`
  display: block;
  overflow-wrap: anywhere;
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {Function} props.get - Admin fetch client `get`.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string }} props.target - This field.
 * @param {import('../../../../shared/presets.mjs').FieldPreset} props.preset - This field's preset.
 * @param {(type: string) => boolean} props.hasTool - Whether this editor has a tool for a block type.
 * @param {{ customBlocks?: object[], codeBlocks?: object[] }} props.known - Settings and code blocks (names).
 * @param {(blocks: object[], context: { syncedAvailable: (ref: string) => boolean|undefined, title: string }) => Promise<boolean>} props.onInsert - Inserts; resolves true on success.
 * @param {() => void} props.onClose - Closes the dialog.
 * @param {boolean} props.allowRaw - Preview raw HTML blocks.
 * @param {string} [props.lang] - Content language of this field.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @returns {JSX.Element} Dialog.
 */
export const ReuseDialog = ({
  t,
  get,
  target,
  preset,
  hasTool,
  known,
  onInsert,
  onClose,
  allowRaw,
  lang,
  dir,
}) => {
  const [types, setTypes] = useState({ status: 'loading', items: [] });
  const [typesAttempt, setTypesAttempt] = useState(0);
  const [uid, setUid] = useState(null);
  const [locale, setLocale] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ status: 'idle', items: [], total: 0 });
  const [entry, setEntry] = useState(null);
  const [source, setSource] = useState({ status: 'idle', data: null });
  const [field, setField] = useState(null);
  const [excluded, setExcluded] = useState(() => ({ key: '', ids: new Set() }));
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef(null);
  const searchRef = useRef(null);
  const restricted = preset && preset.restricted ? preset : null;

  // Types (and their readable languages): default to this field's type and language.
  useEffect(() => {
    const controller = new AbortController();
    get(API.reuseTypes, { signal: controller.signal }).then(
      ({ data }) => {
        if (controller.signal.aborted) return;
        const items = Array.isArray(data.data) ? data.data : [];
        setTypes({ status: 'ready', items });
        const own = items.find((item) => item.uid === target.uid) || items[0] || null;
        setUid(own ? own.uid : null);
        const codes = own && Array.isArray(own.locales) ? own.locales.map((item) => item.code) : [];
        setLocale(
          own && own.localized ? (codes.includes(target.locale) ? target.locale : codes[0] || null) : null
        );
      },
      () => {
        if (!controller.signal.aborted) setTypes({ status: 'error', items: [] });
      }
    );
    return () => controller.abort();
  }, [get, target.uid, target.locale, typesAttempt]);

  const type = types.items.find((item) => item.uid === uid) || null;
  const locales = type && Array.isArray(type.locales) ? type.locales : [];
  const localeName = (code) => (locales.find((item) => item.code === code) || {}).name || code || '';

  // Entry search (the internal-link search: Content Manager read permissions apply).
  useEffect(() => {
    if (!uid || entry) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResults((current) => ({ ...current, status: 'loading' }));
      const params = { uid };
      if (query.trim()) params.q = query.trim().slice(0, 100);
      if (locale) params.locale = locale;
      get(API.linkSearch, { params, signal: controller.signal }).then(
        ({ data }) => {
          if (controller.signal.aborted) return;
          setResults({
            status: 'ready',
            items: Array.isArray(data.data) ? data.data : [],
            total: (data.meta && data.meta.pagination && data.meta.pagination.total) || 0,
          });
        },
        () => {
          if (!controller.signal.aborted) setResults({ status: 'error', items: [], total: 0 });
        }
      );
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [get, uid, locale, query, entry]);

  // The chosen entry's fields with their blocks.
  useEffect(() => {
    if (!entry) return undefined;
    const controller = new AbortController();
    const params = { uid: entry.uid, documentId: entry.documentId };
    if (entry.locale) params.locale = entry.locale;
    get(API.reuseSource, { params, signal: controller.signal }).then(
      ({ data }) => {
        if (controller.signal.aborted) return;
        const value = data && data.data ? data.data : null;
        const fields = value && Array.isArray(value.fields) ? value.fields : [];
        setSource({ status: 'ready', data: value });
        const ownBase = scopeFieldOf(target.field);
        const same =
          fields.find((item) => item.field === target.field) ||
          fields.find((item) => scopeFieldOf(item.field) === ownBase) ||
          fields[0] ||
          null;
        setField(same ? same.field : null);
      },
      () => {
        if (!controller.signal.aborted) setSource({ status: 'error', data: null });
      }
    );
    return () => controller.abort();
  }, [get, entry, target.field]);

  const fields = source.data && Array.isArray(source.data.fields) ? source.data.fields : [];
  const current = fields.find((item) => item.field === field) || null;
  const blocks = useMemo(() => (current ? current.blocks : []), [current]);

  // Synced blocks: a source that is gone or no longer offered cannot be inserted.
  const refs = useMemo(() => syncedRefsOf({ blocks }), [blocks]);
  const { entries: syncedEntries } = useSyncedSources(refs);
  const syncedAvailable = useMemo(
    () => (ref) => {
      const value = syncedEntries.get(ref);
      if (!value || value.status === 'loading' || value.status === 'error') return undefined;
      // A disabled source still renders where it is used, but is no longer offered for insertion.
      return value.status === 'ready' && Boolean(value.template) && value.template.enabled !== false;
    },
    [syncedEntries]
  );
  const previewSynced = useMemo(() => {
    const map = new Map();
    for (const [ref, value] of syncedEntries)
      if (value && value.template)
        map.set(ref, filterSyncedForField(sourceBlocksOf(value.template.blocks), restricted).blocks);
    return map;
  }, [syncedEntries, restricted]);

  const statuses = useMemo(
    () => blocks.map((block) => reuseStatus(block, { preset: restricted, hasTool, syncedAvailable })),
    [blocks, restricted, hasTool, syncedAvailable]
  );
  const insertable = useMemo(
    () => blocks.filter((block, index) => statuses[index] && statuses[index].ok).map((block) => block.id),
    [blocks, statuses]
  );

  // Every insertable block starts ticked; unticked ones are remembered per entry and field.
  const fieldKey = current ? `${entry && entry.documentId}|${entry && entry.locale}|${current.field}` : '';
  const unticked = excluded.key === fieldKey ? excluded.ids : null;
  const chosen = insertable.filter((id) => !unticked || !unticked.has(id));
  const setTicked = (ids, on) =>
    setExcluded((value) => {
      const next = new Set(value.key === fieldKey ? value.ids : []);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return { key: fieldKey, ids: next };
    });
  const blocked = blocks.length - insertable.length;

  const pick = (item) => {
    setSource({ status: 'loading', data: null });
    setEntry({
      uid,
      documentId: item.documentId,
      locale: item.locale || locale || null,
      title: item.title,
      status: item.status || null,
    });
    window.requestAnimationFrame(() => summaryRef.current && summaryRef.current.focus());
  };

  const changeEntry = () => {
    setEntry(null);
    setSource({ status: 'idle', data: null });
    setField(null);
    window.requestAnimationFrame(() => {
      const input = searchRef.current && searchRef.current.querySelector('input');
      if (input) input.focus();
    });
  };

  const insert = async () => {
    if (!chosen.length || busy) return;
    const wanted = new Set(chosen);
    setBusy(true);
    try {
      const ok = await onInsert(
        blocks.filter((block) => wanted.has(block.id)),
        { syncedAvailable, title: (entry && entry.title) || '' }
      );
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  const reasonText = (reason) => {
    if (reason === 'notAllowed')
      return t('editor.reuse.reason.notAllowed', 'This field does not allow this block.');
    if (reason === 'unavailable')
      return t('editor.reuse.reason.unavailable', 'This block type is not available in this editor.');
    if (reason === 'syncedMissing')
      return t('editor.reuse.reason.syncedMissing', 'The synced block was removed or is no longer offered.');
    return t('editor.reuse.reason.unfixable', 'This block cannot be adjusted to the settings of this field.');
  };

  let body;
  if (types.status === 'loading') {
    body = (
      <Flex justifyContent="center" padding={6}>
        <Loader small>{t('editor.reuse.loading', 'Loading')}</Loader>
      </Flex>
    );
  } else if (types.status === 'error') {
    body = (
      <Flex direction="column" alignItems="flex-start" gap={3}>
        <Typography variant="omega" textColor="danger600">
          {t('editor.reuse.typesError', 'The list of content types could not be loaded.')}
        </Typography>
        <Button variant="secondary" onClick={() => setTypesAttempt((value) => value + 1)}>
          {t('editor.config.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (!types.items.length) {
    body = (
      <Flex direction="column" alignItems="flex-start" gap={2} data-testid="mex-reuse-empty">
        <Typography variant="omega" textColor="neutral800">
          {t('editor.reuse.noTypes', 'There is no content you can read in other entries yet.')}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {t(
            'editor.reuse.noTypesHint',
            'Write and save content in another entry first, or ask an administrator for read access to it.'
          )}
        </Typography>
      </Flex>
    );
  } else if (!entry) {
    let list;
    if (results.status === 'error') {
      list = (
        <Typography variant="omega" textColor="danger600" role="alert">
          {t('editor.reuse.searchError', 'The entries could not be loaded. Try again.')}
        </Typography>
      );
    } else if (results.status === 'ready' && !results.items.length) {
      list = (
        <Typography variant="omega" textColor="neutral600" role="status" data-testid="mex-reuse-no-results">
          {query.trim()
            ? t('editor.reuse.noResults', 'No entries match. Try another word.')
            : t('editor.reuse.noEntries', 'There are no entries you can read here.')}
        </Typography>
      );
    } else {
      list = (
        <Flex direction="column" alignItems="stretch" gap={2} minWidth={0}>
          <List aria-label={t('editor.reuse.results', 'Entries')} aria-busy={results.status !== 'ready'}>
            {results.items.map((item) => {
              const own = item.documentId === target.documentId && uid === target.uid;
              return (
                <li key={`${item.documentId}|${item.locale || ''}`}>
                  <Option type="button" onClick={() => pick(item)} data-testid="mex-reuse-entry">
                    <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
                      <Ellipsis variant="omega" fontWeight="bold" textColor="neutral800">
                        {item.title || t('editor.reuse.untitled', 'Untitled entry')}
                      </Ellipsis>
                      {own ? <Badge>{t('editor.reuse.thisEntry', 'This entry')}</Badge> : null}
                      {item.status === 'draft' ? (
                        <Badge>{t('editor.reuse.statusDraft', 'Draft')}</Badge>
                      ) : null}
                      {item.status === 'published' ? (
                        <Badge>{t('editor.reuse.statusPublished', 'Published')}</Badge>
                      ) : null}
                    </Flex>
                  </Option>
                </li>
              );
            })}
          </List>
          {results.status === 'ready' && results.total > results.items.length ? (
            <Typography variant="pi" textColor="neutral600">
              {t('editor.reuse.more', 'Showing {shown} of {total} entries. Type to narrow the list.', {
                shown: results.items.length,
                total: results.total,
              })}
            </Typography>
          ) : null}
        </Flex>
      );
    }
    body = (
      <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
        {types.items.length > 1 || locales.length > 1 ? (
          <Flex gap={4} wrap="wrap" alignItems="flex-end">
            {types.items.length > 1 ? (
              <Box minWidth={0} flex="1 1 16rem">
                <Field.Root name="mex-reuse-type">
                  <Field.Label>{t('editor.reuse.type', 'Content type')}</Field.Label>
                  <SingleSelect
                    value={uid || undefined}
                    onChange={(next) => {
                      const nextType = types.items.find((item) => item.uid === String(next));
                      setUid(String(next));
                      const codes =
                        nextType && Array.isArray(nextType.locales)
                          ? nextType.locales.map((item) => item.code)
                          : [];
                      setLocale(
                        nextType && nextType.localized
                          ? codes.includes(locale)
                            ? locale
                            : codes.includes(target.locale)
                              ? target.locale
                              : codes[0] || null
                          : null
                      );
                    }}
                  >
                    {types.items.map((item) => (
                      <SingleSelectOption key={item.uid} value={item.uid}>
                        {item.displayName}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
            ) : null}
            {locales.length > 1 ? (
              <Box minWidth={0} flex="1 1 12rem">
                <Field.Root name="mex-reuse-locale">
                  <Field.Label>{t('editor.reuse.locale', 'Language')}</Field.Label>
                  <SingleSelect value={locale || undefined} onChange={(next) => setLocale(String(next))}>
                    {locales.map((item) => (
                      <SingleSelectOption key={item.code} value={item.code}>
                        {item.name}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
            ) : null}
          </Flex>
        ) : null}
        <Box ref={searchRef}>
          <Searchbar
            name="mex-reuse-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            clearLabel={t('editor.reuse.clear', 'Clear search')}
            placeholder={t('editor.reuse.search', 'Search entries by title')}
          >
            {t('editor.reuse.search', 'Search entries by title')}
          </Searchbar>
        </Box>
        {list}
      </Flex>
    );
  } else {
    const typeName = type ? type.displayName : '';
    let preview;
    if (source.status === 'loading' || source.status === 'idle') {
      preview = (
        <Flex justifyContent="center" padding={6}>
          <Loader small>{t('editor.reuse.loading', 'Loading')}</Loader>
        </Flex>
      );
    } else if (source.status === 'error') {
      preview = (
        <Typography variant="omega" textColor="danger600" role="alert">
          {t('editor.reuse.sourceError', 'The content of this entry could not be loaded.')}
        </Typography>
      );
    } else if (!fields.length) {
      preview = (
        <Flex direction="column" alignItems="flex-start" gap={1} data-testid="mex-reuse-no-content">
          <Typography variant="omega" textColor="neutral800">
            {t('editor.reuse.noContent', 'This entry has no saved content you can insert.')}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {t('editor.reuse.noContentHint', 'Choose another entry, or save this one with content first.')}
          </Typography>
        </Flex>
      );
    } else {
      const allChecked = chosen.length > 0 && chosen.length === insertable.length;
      preview = (
        <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
          {fields.length > 1 ? (
            <Field.Root name="mex-reuse-field">
              <Field.Label>{t('editor.reuse.field', 'Field')}</Field.Label>
              <SingleSelect value={field || undefined} onChange={(next) => setField(String(next))}>
                {fields.map((item) => (
                  <SingleSelectOption key={item.field} value={item.field}>
                    {`${fieldPathLabel(item.field)} (${t('editor.templates.blocks', '{count, plural, one {# block} other {# blocks}}', { count: item.blockCount })})`}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          ) : null}
          <Flex gap={3} wrap="wrap" alignItems="center" justifyContent="space-between">
            <Checkbox
              checked={allChecked ? true : chosen.length ? 'indeterminate' : false}
              disabled={!insertable.length}
              onCheckedChange={(next) => setTicked(insertable, next === true)}
              data-testid="mex-reuse-all"
            >
              {t('editor.reuse.selectAll', 'Select all')}
            </Checkbox>
            <Typography variant="pi" textColor="neutral600" role="status" aria-live="polite">
              {t('editor.reuse.selectedCount', '{count} of {total} selected', {
                count: chosen.length,
                total: insertable.length,
              })}
            </Typography>
          </Flex>
          {blocked ? (
            <Typography variant="pi" textColor="neutral700" data-testid="mex-reuse-blocked">
              {t(
                'editor.reuse.blocked',
                '{count, plural, one {# block cannot} other {# blocks cannot}} be inserted into this field. The reason is shown at the block.',
                { count: blocked }
              )}
            </Typography>
          ) : null}
          <List aria-label={t('editor.reuse.blocks', 'Blocks')} data-testid="mex-reuse-blocks">
            {blocks.map((block, index) => {
              const status = statuses[index] || { ok: false, reason: 'unfixable' };
              const checked = status.ok && chosen.includes(block.id);
              const name = blockTypeLabel(t, block, known);
              const reasonId = `mex-reuse-reason-${index}`;
              const ref = syncedRefOf(block);
              return (
                <Row
                  key={block.id || index}
                  $checked={checked}
                  $disabled={!status.ok}
                  data-testid="mex-reuse-block"
                >
                  <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
                    <Checkbox
                      checked={checked}
                      disabled={!status.ok}
                      aria-describedby={status.ok ? undefined : reasonId}
                      onCheckedChange={(next) => setTicked([block.id], next === true)}
                    >
                      {t('editor.reuse.blockLabel', 'Block {number}: {name}', { number: index + 1, name })}
                    </Checkbox>
                    {status.ok && status.adjusted ? (
                      <Badge>{t('editor.reuse.adjusted', 'Adjusted to this field')}</Badge>
                    ) : null}
                  </Flex>
                  {!status.ok ? (
                    <Typography
                      variant="pi"
                      textColor="danger600"
                      id={reasonId}
                      data-testid="mex-reuse-reason"
                    >
                      {reasonText(status.reason)}
                    </Typography>
                  ) : null}
                  <PreviewBox>
                    {ref && !previewSynced.has(ref) ? (
                      <Typography variant="pi" textColor="neutral600">
                        {t('editor.synced.kind', 'Synced block')}
                      </Typography>
                    ) : (
                      <RenderedContent
                        value={{ blocks: [block] }}
                        t={t}
                        allowRaw={allowRaw}
                        lang={lang}
                        dir={dir}
                        synced={previewSynced}
                      />
                    )}
                  </PreviewBox>
                </Row>
              );
            })}
          </List>
          {current && current.truncated ? (
            <Typography variant="pi" textColor="neutral600">
              {t('editor.reuse.truncated', 'Only the first {shown} of {total} blocks are shown.', {
                shown: blocks.length,
                total: current.blockCount,
              })}
            </Typography>
          ) : null}
        </Flex>
      );
    }
    body = (
      <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
        <Flex direction="column" alignItems="stretch" gap={1} minWidth={0}>
          <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
            <Ellipsis
              variant="delta"
              tag="h3"
              ref={summaryRef}
              tabIndex={-1}
              textColor="neutral800"
              data-testid="mex-reuse-summary"
            >
              {(entry.title || t('editor.reuse.untitled', 'Untitled entry')) +
                (typeName ? ` · ${typeName}` : '') +
                (entry.locale ? ` · ${localeName(entry.locale)}` : '')}
            </Ellipsis>
            <TextButton onClick={changeEntry} data-testid="mex-reuse-change">
              {t('editor.reuse.change', 'Choose another entry')}
            </TextButton>
          </Flex>
          <Typography variant="pi" textColor="neutral600" data-testid="mex-reuse-version">
            {t(
              'editor.reuse.versionHint',
              'Shows the entry as last saved (draft). Changes that are not saved yet are not included. The blocks are inserted after the block you worked on last.'
            )}
          </Typography>
        </Flex>
        {preview}
      </Flex>
    );
  }

  return (
    <Modal.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <TouchModalContent aria-describedby={undefined}>
        <Modal.Header closeLabel={t('editor.reuse.close', 'Close')}>
          <Modal.Title>{t('editor.reuse.title', 'Insert from another entry')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body}</Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.reuse.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Button
            onClick={insert}
            loading={busy}
            disabled={busy || !entry || chosen.length === 0}
            data-testid="mex-reuse-insert"
          >
            {t('editor.reuse.insert', 'Insert {count, plural, one {# block} other {# blocks}}', {
              count: chosen.length,
            })}
          </Button>
        </Modal.Footer>
      </TouchModalContent>
    </Modal.Root>
  );
};

export default ReuseDialog;

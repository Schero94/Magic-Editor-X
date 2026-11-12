import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  IconButton,
  Loader,
  Modal,
  Tabs,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, Eye, Pencil } from '@strapi/icons';
import { ConfirmDialog, useFetchClient, useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { API, readApiError } from '../../utils/api';
import { VersionDiff } from './VersionDiff';
import { FieldActivity } from './FieldActivity';

/**
 * Version history of one field: list snapshots, save (and name) the current
 * content as a version, rename versions, preview a version, compare it with
 * the current editor content and restore the whole version or single blocks.
 * Restoring replaces editor content; the entry is stored when the user saves
 * it in the Content Manager.
 */

const MAX_LABEL_LENGTH = 120;

/**
 * Footer that wraps on narrow screens. Without wrapping, the Design System
 * footer (a non-wrapping Flex) squeezes "Save current version" at 320 px until
 * its label breaks onto a second line that overflows the fixed-height button,
 * so part of the white label is drawn outside the primary background (the
 * low contrast measured in the 2.1 acceptance).
 */
const Footer = styled(Modal.Footer)`
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spaces[2]};
`;

/** Button whose label may wrap without leaving its background. */
const WrappingButton = styled(Button)`
  max-width: 100%;
  height: auto;
  min-height: ${({ theme }) => theme.sizes.button.M.initial || '4.4rem'};
  padding-block: ${({ theme }) => theme.spaces[2]};
  text-align: center;
  ${({ theme }) => theme.breakpoints.medium} {
    min-height: ${({ theme }) => theme.sizes.button.M.medium || '3.6rem'};
  }
`;

const TRIGGERS = {
  manual: { key: 'editor.history.trigger.manual', text: 'Saved' },
  auto: { key: 'editor.history.trigger.auto', text: 'Automatic' },
  restore: { key: 'editor.history.trigger.restore', text: 'Restored' },
  legacy: { key: 'editor.history.trigger.legacy', text: 'From 1.x' },
};

/**
 * Plain-text preview of a snapshot (first blocks only).
 * @param {object|null} content - Editor data.
 * @returns {string[]} Lines.
 */
export const previewLines = (content) => {
  if (!content || !Array.isArray(content.blocks)) return [];
  const parser = new DOMParser();
  return content.blocks.slice(0, 12).map((block) => {
    const data = block.data || {};
    const raw =
      typeof data.text === 'string'
        ? data.text
        : typeof data.code === 'string'
          ? data.code
          : typeof data.message === 'string'
            ? data.message
            : '';
    const text = raw ? parser.parseFromString(raw, 'text/html').body.textContent || '' : '';
    return `${block.type}${text ? `: ${text.slice(0, 160)}` : ''}`;
  });
};

/**
 * @param {object} props - Props.
 * @returns {JSX.Element} Modal.
 */
export const HistoryModal = ({
  t,
  target,
  readContent,
  onRestore,
  onRestoreBlock,
  onClose,
  canEdit,
  canReadActivity = false,
}) => {
  const { formatDate } = useIntl();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [state, setState] = useState({ loading: true, error: false, items: [], meta: {} });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [tab, setTab] = useState('preview');
  const [diff, setDiff] = useState(null);
  const [view, setView] = useState('versions');
  const saveButton = useRef(null);
  const renameButtons = useRef(new Map());

  const fetchList = useCallback(
    () =>
      get(API.history, {
        params: {
          uid: target.uid,
          documentId: target.documentId,
          locale: target.locale || undefined,
          field: target.field,
          ...(target.fieldKey ? { fieldKey: target.fieldKey } : {}),
        },
      }).then(
        ({ data }) =>
          setState({ loading: false, error: false, items: data.data || [], meta: data.meta || {} }),
        () => setState((current) => ({ ...current, loading: false, error: true }))
      ),
    [get, target.uid, target.documentId, target.locale, target.field, target.fieldKey]
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const load = () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    return fetchList();
  };

  const saveVersion = async () => {
    setSaving(true);
    try {
      const content = await readContent();
      const name = label.trim();
      const { data } = await post(API.history, {
        ...target,
        locale: target.locale || null,
        content,
        ...(name ? { label: name } : {}),
      });
      const created = Boolean(data.meta && data.meta.created);
      toggleNotification({
        type: 'success',
        message: created
          ? t('editor.history.saved', 'Version saved.')
          : name
            ? t(
                'editor.history.namedLatest',
                'Nothing changed since the last version, so the name was given to it.'
              )
            : t('editor.history.unchanged', 'Nothing changed since the last version.'),
      });
      setLabel('');
      await load();
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message:
          readApiError(error).message || t('editor.history.saveFailed', 'The version could not be saved.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async (item) => {
    if (preview && preview.item.id === item.id) {
      setPreview(null);
      setDiff(null);
      return;
    }
    setTab('preview');
    setDiff(null);
    setPreview({ item, loading: true, lines: [] });
    try {
      const { data } = await get(API.historyItem(item.id));
      setPreview({
        item,
        loading: false,
        lines: previewLines(data.data.content),
        content: data.data.content,
      });
    } catch {
      setPreview({ item, loading: false, error: true, lines: [] });
    }
  };

  /** Loads the current editor content and shows the changes since the previewed version. */
  const showChanges = async () => {
    setTab('changes');
    if (!preview || !preview.content || (diff && diff.id === preview.item.id)) return;
    setDiff({ id: preview.item.id, loading: true });
    try {
      const current = await readContent();
      setDiff({ id: preview.item.id, loading: false, current: current || { blocks: [] } });
    } catch {
      setDiff({ id: preview.item.id, loading: false, error: true });
    }
  };

  /** Restores one block of the previewed version into the editor. */
  const restoreBlock = async (entry, position) => {
    try {
      const applied = await onRestoreBlock(entry.before, position);
      if (applied === false) throw new Error('not applied');
      toggleNotification({
        type: 'success',
        message: t('editor.history.diff.blockRestored', 'Block restored. Save the entry to keep it.'),
      });
      const current = await readContent();
      setDiff({ id: preview.item.id, loading: false, current: current || { blocks: [] } });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('editor.history.diff.restoreFailed', 'The block could not be restored.'),
      });
    }
  };

  /** Leaves the rename form and puts focus back on the rename button. */
  const endRename = (id) => {
    setRenaming(null);
    window.requestAnimationFrame(() => {
      const button = renameButtons.current.get(id);
      if (button) button.focus();
    });
  };

  const saveRename = async (event) => {
    if (event) event.preventDefault();
    if (!renaming || renameBusy) return;
    if (renaming.value.trim().length > MAX_LABEL_LENGTH) return;
    setRenameBusy(true);
    try {
      await put(API.historyItem(renaming.id), { label: renaming.value.trim() || null });
      toggleNotification({ type: 'success', message: t('editor.history.renamed', 'Version name saved.') });
      const id = renaming.id;
      await load();
      endRename(id);
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message:
          readApiError(error).message || t('editor.history.renameFailed', 'The name could not be saved.'),
      });
    } finally {
      setRenameBusy(false);
    }
  };

  const restore = async () => {
    const item = confirm;
    setRestoring(true);
    try {
      // `intent=restore` records "version restored" in the audit trail (2.4).
      const { data } = await get(API.historyItem(item.id), { params: { intent: 'restore' } });
      const applied = await onRestore(data.data.content);
      if (!applied) throw new Error('empty');
      toggleNotification({
        type: 'success',
        message: t('editor.history.restored', 'Version {version} restored. Save the entry to keep it.', {
          version: item.version,
        }),
      });
      setConfirm(null);
      onClose();
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('editor.history.restoreFailed', 'This version could not be restored.'),
      });
    } finally {
      setRestoring(false);
    }
  };

  const canWrite = canEdit && state.meta.canRestore !== false;
  const canName = canWrite && state.meta.canCreate !== false;
  const labelTooLong = label.trim().length > MAX_LABEL_LENGTH;
  const positionalVersions = Array.isArray(state.meta.positionalVersions)
    ? state.meta.positionalVersions
    : [];

  /**
   * One version in the list. Versions saved by position before 2.4 (`item.positional`) can be
   * viewed and compared but not renamed or restored: they may belong to another entry.
   * @param {object} item - Version.
   * @returns {JSX.Element} List item.
   */
  const renderItem = (item) => {
    const locked = Boolean(item.positional);
    const trigger = TRIGGERS[item.trigger] || TRIGGERS.manual;
    const when = item.createdAt
      ? formatDate(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })
      : '—';
    return (
      <Box tag="li" key={item.id} padding={3} hasRadius borderColor="neutral200" background="neutral0">
        <Flex gap={3} justifyContent="space-between" wrap="wrap">
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Flex gap={2} wrap="wrap" minWidth={0}>
              <Typography variant="omega" fontWeight="bold" style={{ overflowWrap: 'anywhere' }}>
                {item.label || t('editor.history.version', 'Version {version}', { version: item.version })}
              </Typography>
              {item.label ? (
                <Typography variant="pi" textColor="neutral600">
                  {t('editor.history.version', 'Version {version}', { version: item.version })}
                </Typography>
              ) : null}
              <Badge>{t(trigger.key, trigger.text)}</Badge>
            </Flex>
            <Typography variant="pi" textColor="neutral600">
              {item.createdBy
                ? t('editor.history.byline', '{date} by {name}', {
                    date: when,
                    name: item.createdBy,
                  })
                : when}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t(
                'editor.history.stats',
                '{blocks, plural, one {# block} other {# blocks}} · {words, plural, one {# word} other {# words}}',
                {
                  blocks: item.stats.blocks,
                  words: item.stats.words,
                }
              )}
            </Typography>
          </Flex>
          <Flex gap={2}>
            <IconButton
              label={t('editor.history.preview', 'Preview version {version}', {
                version: item.version,
              })}
              variant="tertiary"
              aria-expanded={Boolean(preview && preview.item.id === item.id)}
              onClick={() => showPreview(item)}
            >
              <Eye />
            </IconButton>
            {canName && !locked ? (
              <IconButton
                ref={(node) => {
                  if (node) renameButtons.current.set(item.id, node);
                  else renameButtons.current.delete(item.id);
                }}
                label={t('editor.history.rename', 'Rename version {version}', {
                  version: item.version,
                })}
                variant="tertiary"
                onClick={() => setRenaming({ id: item.id, value: item.label || '' })}
              >
                <Pencil />
              </IconButton>
            ) : null}
            {canWrite && item.restorable && !locked ? (
              <Button variant="secondary" onClick={() => setConfirm(item)}>
                {t('editor.history.restore', 'Restore')}
              </Button>
            ) : null}
          </Flex>
        </Flex>
        {renaming && renaming.id === item.id ? (
          <Box tag="form" marginTop={3} onSubmit={saveRename} noValidate>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Field.Root
                name={`mex-version-label-${item.id}`}
                hint={t('editor.history.renameHint', 'Leave empty to remove the name.')}
                error={
                  renaming.value.trim().length > MAX_LABEL_LENGTH
                    ? t('editor.history.labelTooLong', 'Use 120 characters or fewer.')
                    : undefined
                }
              >
                <Field.Label>{t('editor.history.renameLabel', 'Version name')}</Field.Label>
                <TextInput
                  autoFocus
                  value={renaming.value}
                  onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      endRename(item.id);
                    }
                  }}
                />
                <Field.Hint />
                <Field.Error />
              </Field.Root>
              <Flex gap={2} wrap="wrap">
                <Button type="submit" size="S" loading={renameBusy}>
                  {t('editor.history.renameSave', 'Save name')}
                </Button>
                <Button type="button" size="S" variant="tertiary" onClick={() => endRename(item.id)}>
                  {t('editor.history.renameCancel', 'Cancel')}
                </Button>
              </Flex>
            </Flex>
          </Box>
        ) : null}
        {preview && preview.item.id === item.id ? (
          <Box marginTop={3} padding={3} background="neutral100" hasRadius minWidth={0}>
            {preview.content ? (
              <Tabs.Root
                value={tab}
                onValueChange={(value) => (value === 'changes' ? showChanges() : setTab('preview'))}
              >
                <Tabs.List aria-label={t('editor.history.tabs', 'Version views')}>
                  <Tabs.Trigger value="preview">{t('editor.history.tab.preview', 'Preview')}</Tabs.Trigger>
                  <Tabs.Trigger value="changes">{t('editor.history.tab.changes', 'Changes')}</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="preview">
                  <Box paddingTop={3}>
                    {preview.lines.map((line, index) => (
                      <Typography
                        key={index}
                        tag="p"
                        variant="pi"
                        textColor="neutral800"
                        style={{ overflowWrap: 'anywhere' }}
                      >
                        {line}
                      </Typography>
                    ))}
                  </Box>
                </Tabs.Content>
                <Tabs.Content value="changes">
                  <Box paddingTop={3}>
                    {!diff || diff.loading ? (
                      <Loader small>
                        {t('editor.history.diff.loading', 'Comparing with the current content')}
                      </Loader>
                    ) : null}
                    {diff && diff.error ? (
                      <Typography textColor="danger600">
                        {t('editor.history.diff.error', 'The changes could not be shown.')}
                      </Typography>
                    ) : null}
                    {diff && diff.current ? (
                      <VersionDiff
                        t={t}
                        version={preview.content}
                        current={diff.current}
                        versionNumber={item.version}
                        canRestore={Boolean(canWrite && !locked && typeof onRestoreBlock === 'function')}
                        onRestoreBlock={restoreBlock}
                      />
                    ) : null}
                  </Box>
                </Tabs.Content>
              </Tabs.Root>
            ) : null}
            {preview.loading ? (
              <Loader small>{t('editor.history.previewLoading', 'Loading preview')}</Loader>
            ) : null}
            {preview.error ? (
              <Typography textColor="danger600">
                {t('editor.history.previewError', 'The preview could not be loaded.')}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  };

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header closeLabel={t('editor.history.close', 'Close')}>
          <Modal.Title>{t('editor.history.title', 'Version history')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {canReadActivity ? (
            <Tabs.Root value={view} onValueChange={setView}>
              <Tabs.List aria-label={t('editor.activity.tabs', 'History views')}>
                <Tabs.Trigger value="versions">{t('editor.activity.tab.versions', 'Versions')}</Tabs.Trigger>
                <Tabs.Trigger value="activity">{t('editor.activity.tab.activity', 'Activity')}</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="activity">
                {view === 'activity' ? <FieldActivity t={t} target={target} /> : null}
              </Tabs.Content>
            </Tabs.Root>
          ) : null}
          {view === 'versions' ? (
            <Flex direction="column" alignItems="stretch" gap={4} paddingTop={canReadActivity ? 3 : 0}>
              <Typography variant="omega" textColor="neutral600">
                {t(
                  'editor.history.description',
                  'Versions of this field. Restoring replaces the editor content; save the entry to keep it.'
                )}
              </Typography>
              {canName ? (
                <Field.Root
                  name="mex-version-label"
                  hint={t(
                    'editor.history.labelHint',
                    'Optional. For example "Before legal review". Up to 120 characters.'
                  )}
                  error={
                    labelTooLong
                      ? t('editor.history.labelTooLong', 'Use 120 characters or fewer.')
                      : undefined
                  }
                >
                  <Field.Label>{t('editor.history.labelField', 'Name of the new version')}</Field.Label>
                  <TextInput
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !labelTooLong && !saving) {
                        event.preventDefault();
                        saveVersion();
                      }
                    }}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
              ) : null}
              {state.loading ? (
                <Flex justifyContent="center" padding={4}>
                  <Loader small>{t('editor.history.loading', 'Loading versions')}</Loader>
                </Flex>
              ) : null}
              {state.error ? (
                <Flex direction="column" alignItems="flex-start" gap={2}>
                  <Typography textColor="danger600">
                    {t('editor.history.error', 'Versions could not be loaded.')}
                  </Typography>
                  <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={load}>
                    {t('editor.history.retry', 'Try again')}
                  </Button>
                </Flex>
              ) : null}
              {!state.loading && !state.error && state.items.length === 0 ? (
                <Typography textColor="neutral600">
                  {t('editor.history.empty', 'No versions yet. Save one to start the history.')}
                </Typography>
              ) : null}
              {!state.error && state.items.length > 0 ? (
                <Flex
                  tag="ul"
                  direction="column"
                  alignItems="stretch"
                  gap={2}
                  aria-label={t('editor.history.listLabel', 'Versions')}
                >
                  {state.items.map(renderItem)}
                </Flex>
              ) : null}
              {!state.error && positionalVersions.length > 0 ? (
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography tag="h3" variant="delta">
                    {t('editor.history.positional.title', 'Older versions saved by position')}
                  </Typography>
                  <Typography variant="omega" textColor="neutral600">
                    {t(
                      'editor.history.positional.description',
                      'Saved before this section had its own history. They may belong to another entry of this list, so they can be viewed and compared but not restored.'
                    )}
                  </Typography>
                  <Flex
                    tag="ul"
                    direction="column"
                    alignItems="stretch"
                    gap={2}
                    aria-label={t('editor.history.positional.title', 'Older versions saved by position')}
                  >
                    {positionalVersions.map(renderItem)}
                  </Flex>
                </Flex>
              ) : null}
            </Flex>
          ) : null}
        </Modal.Body>
        <Footer>
          <Modal.Close>
            <WrappingButton variant="tertiary">{t('editor.history.cancel', 'Close')}</WrappingButton>
          </Modal.Close>
          {canWrite && view === 'versions' ? (
            <WrappingButton ref={saveButton} onClick={saveVersion} loading={saving} disabled={labelTooLong}>
              {t('editor.history.save', 'Save current version')}
            </WrappingButton>
          ) : null}
        </Footer>
      </Modal.Content>
      <Dialog.Root open={Boolean(confirm)} onOpenChange={(open) => !open && !restoring && setConfirm(null)}>
        {confirm ? (
          <ConfirmDialog
            title={t('editor.history.confirmTitle', 'Restore version {version}?', {
              version: confirm.version,
            })}
            endAction={
              <Button variant="danger-light" loading={restoring} onClick={restore}>
                {t('editor.history.restore', 'Restore')}
              </Button>
            }
          >
            {t(
              'editor.history.confirmBody',
              'The editor content is replaced with this version. Nothing is stored until you save the entry, so you can still discard the change.'
            )}
          </ConfirmDialog>
        ) : null}
      </Dialog.Root>
    </Modal.Root>
  );
};

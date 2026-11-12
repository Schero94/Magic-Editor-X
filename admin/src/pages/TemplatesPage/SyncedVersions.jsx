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
  Tabs,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, Eye, Pencil } from '@strapi/icons';
import { ConfirmDialog, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';
import { SectionCard, useT } from '../../components/ui';
import { VersionDiff } from '../../components/EditorField/VersionDiff';
import { previewLines } from '../../components/EditorField/HistoryModal';

const MAX_LABEL_LENGTH = 120;

const TRIGGERS = {
  manual: { key: 'settings.syncedVersions.trigger.manual', text: 'Saved' },
  restore: { key: 'settings.syncedVersions.trigger.restore', text: 'Restored' },
};

/**
 * Versions of a synced block source (2.4), in its edit view: list, preview,
 * changes against the content in the form (`shared/diff.mjs` through
 * `VersionDiff`), rename, and restore with a confirmation. Restoring is a
 * normal save on the server (it creates a new version); unsaved changes in
 * the form are discarded by it, which the confirmation says.
 * @param {{ template: object, current: object, dirty: boolean, onRestored: (template: object) => void }} props - The saved source, the form's blocks, whether the form has unsaved changes, and the callback with the updated source.
 * @returns {JSX.Element} Section.
 */
export const SyncedVersions = ({ template, current, dirty, onRestored }) => {
  const t = useT();
  const { formatDate } = useIntl();
  const { get, put, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [state, setState] = useState({ loading: true, error: false, items: [] });
  const [preview, setPreview] = useState(null);
  const [tab, setTab] = useState('preview');
  const [renaming, setRenaming] = useState(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const renameButtons = useRef(new Map());

  const fetchList = useCallback(
    () =>
      get(API.templateVersions(template.id)).then(
        ({ data }) => setState({ loading: false, error: false, items: data.data || [] }),
        () => setState((value) => ({ ...value, loading: false, error: true }))
      ),
    [get, template.id]
  );

  useEffect(() => {
    fetchList();
  }, [fetchList, template.updatedAt]);

  const reload = () => {
    setState((value) => ({ ...value, loading: true, error: false }));
    return fetchList();
  };

  const showPreview = async (item) => {
    if (preview && preview.item.id === item.id) {
      setPreview(null);
      return;
    }
    setTab('preview');
    setPreview({ item, loading: true });
    try {
      const { data } = await get(API.templateVersion(template.id, item.id));
      setPreview({
        item,
        loading: false,
        content: data.data.content,
        lines: previewLines(data.data.content),
      });
    } catch {
      setPreview({ item, loading: false, error: true });
    }
  };

  const endRename = (id) => {
    setRenaming(null);
    window.requestAnimationFrame(() => {
      const button = renameButtons.current.get(id);
      if (button) button.focus();
    });
  };

  const saveRename = async (event) => {
    if (event) event.preventDefault();
    if (!renaming || renameBusy || renaming.value.trim().length > MAX_LABEL_LENGTH) return;
    setRenameBusy(true);
    try {
      await put(API.templateVersion(template.id, renaming.id), { label: renaming.value.trim() || null });
      toggleNotification({
        type: 'success',
        message: t('settings.syncedVersions.renamed', 'Version name saved.'),
      });
      const id = renaming.id;
      await reload();
      endRename(id);
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message:
          readApiError(error).message ||
          t('settings.syncedVersions.renameFailed', 'The name could not be saved.'),
      });
    } finally {
      setRenameBusy(false);
    }
  };

  const restore = async () => {
    const item = confirm;
    setRestoring(true);
    try {
      const { data } = await post(API.templateVersionRestore(template.id, item.id), {});
      toggleNotification({
        type: 'success',
        message: t(
          'settings.syncedVersions.restored',
          'Version {version} restored. Every field that uses this synced block shows it now.',
          { version: item.version }
        ),
      });
      setConfirm(null);
      onRestored(data.data);
    } catch (error) {
      const info = readApiError(error);
      toggleNotification({
        type: 'danger',
        message:
          info.status === 400
            ? t(
                'settings.syncedVersions.restoreInvalid',
                'This version cannot be restored with the current settings (for example a field in "Where it is offered" no longer exists).'
              )
            : t('settings.syncedVersions.restoreFailed', 'This version could not be restored.'),
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SectionCard
      title={t('settings.syncedVersions.title', 'Versions')}
      subtitle={t(
        'settings.syncedVersions.subtitle',
        'Every save of this synced block is kept as a version. Restoring a version saves it again as the newest one.'
      )}
    >
      {state.loading ? (
        <Flex justifyContent="center" padding={4}>
          <Loader small>{t('settings.syncedVersions.loading', 'Loading versions')}</Loader>
        </Flex>
      ) : null}
      {state.error ? (
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography textColor="danger600">
            {t('settings.syncedVersions.error', 'Versions could not be loaded.')}
          </Typography>
          <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={reload}>
            {t('settings.retry', 'Try again')}
          </Button>
        </Flex>
      ) : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <Typography textColor="neutral600">
          {t('settings.syncedVersions.empty', 'No versions yet. They are created when you save.')}
        </Typography>
      ) : null}
      {!state.error && state.items.length > 0 ? (
        <Flex
          tag="ul"
          direction="column"
          alignItems="stretch"
          gap={2}
          aria-label={t('settings.syncedVersions.listLabel', 'Versions of this synced block')}
        >
          {state.items.map((item, index) => {
            const trigger = TRIGGERS[item.trigger] || TRIGGERS.manual;
            const when = item.createdAt
              ? formatDate(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })
              : '';
            const versionText = t('settings.syncedVersions.version', 'Version {version}', {
              version: item.version,
            });
            return (
              <Box
                tag="li"
                key={item.id}
                padding={3}
                hasRadius
                borderColor="neutral200"
                background="neutral0"
              >
                <Flex gap={3} justifyContent="space-between" wrap="wrap">
                  <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 20rem">
                    <Flex gap={2} wrap="wrap" minWidth={0}>
                      <Typography variant="omega" fontWeight="bold" style={{ overflowWrap: 'anywhere' }}>
                        {item.label || versionText}
                      </Typography>
                      {item.label ? (
                        <Typography variant="pi" textColor="neutral600">
                          {versionText}
                        </Typography>
                      ) : null}
                      <Badge>{t(trigger.key, trigger.text)}</Badge>
                      {index === 0 ? (
                        <Badge backgroundColor="success100" textColor="success700">
                          {t('settings.syncedVersions.current', 'Current')}
                        </Badge>
                      ) : null}
                    </Flex>
                    <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                      {item.createdBy
                        ? t('settings.syncedVersions.byline', '{date} by {name}', {
                            date: when,
                            name: item.createdBy.name,
                          })
                        : when}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                      {t(
                        'settings.syncedVersions.details',
                        '{name} · {blocks, plural, one {# block} other {# blocks}}',
                        { name: item.name, blocks: item.blockCount }
                      )}
                    </Typography>
                  </Flex>
                  <Flex gap={2} wrap="wrap">
                    <IconButton
                      label={t('settings.syncedVersions.preview', 'Preview version {version}', {
                        version: item.version,
                      })}
                      variant="tertiary"
                      aria-expanded={Boolean(preview && preview.item.id === item.id)}
                      onClick={() => showPreview(item)}
                    >
                      <Eye />
                    </IconButton>
                    <IconButton
                      ref={(node) => {
                        if (node) renameButtons.current.set(item.id, node);
                        else renameButtons.current.delete(item.id);
                      }}
                      label={t('settings.syncedVersions.rename', 'Rename version {version}', {
                        version: item.version,
                      })}
                      variant="tertiary"
                      onClick={() => setRenaming({ id: item.id, value: item.label || '' })}
                    >
                      <Pencil />
                    </IconButton>
                    {index > 0 ? (
                      <Button variant="secondary" onClick={() => setConfirm(item)}>
                        {t('settings.syncedVersions.restore', 'Restore')}
                      </Button>
                    ) : null}
                  </Flex>
                </Flex>
                {renaming && renaming.id === item.id ? (
                  <Box tag="form" marginTop={3} onSubmit={saveRename} noValidate>
                    <Flex direction="column" alignItems="stretch" gap={2}>
                      <Field.Root
                        name={`mex-synced-version-label-${item.id}`}
                        hint={t('settings.syncedVersions.renameHint', 'Leave empty to remove the name.')}
                        error={
                          renaming.value.trim().length > MAX_LABEL_LENGTH
                            ? t('settings.syncedVersions.labelTooLong', 'Use 120 characters or fewer.')
                            : undefined
                        }
                      >
                        <Field.Label>{t('settings.syncedVersions.renameLabel', 'Version name')}</Field.Label>
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
                          {t('settings.syncedVersions.renameSave', 'Save name')}
                        </Button>
                        <Button type="button" size="S" variant="tertiary" onClick={() => endRename(item.id)}>
                          {t('settings.syncedVersions.renameCancel', 'Cancel')}
                        </Button>
                      </Flex>
                    </Flex>
                  </Box>
                ) : null}
                {preview && preview.item.id === item.id ? (
                  <Box marginTop={3} padding={3} background="neutral100" hasRadius minWidth={0}>
                    {preview.loading ? (
                      <Loader small>{t('settings.syncedVersions.previewLoading', 'Loading preview')}</Loader>
                    ) : null}
                    {preview.error ? (
                      <Typography textColor="danger600">
                        {t('settings.syncedVersions.previewError', 'The preview could not be loaded.')}
                      </Typography>
                    ) : null}
                    {preview.content ? (
                      <Tabs.Root value={tab} onValueChange={setTab}>
                        <Tabs.List aria-label={t('settings.syncedVersions.tabs', 'Version views')}>
                          <Tabs.Trigger value="preview">
                            {t('settings.syncedVersions.tab.preview', 'Preview')}
                          </Tabs.Trigger>
                          <Tabs.Trigger value="changes">
                            {t('settings.syncedVersions.tab.changes', 'Changes')}
                          </Tabs.Trigger>
                        </Tabs.List>
                        <Tabs.Content value="preview">
                          <Box paddingTop={3}>
                            {preview.lines.map((line, lineIndex) => (
                              <Typography
                                key={lineIndex}
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
                            {tab === 'changes' ? (
                              <VersionDiff
                                t={t}
                                version={preview.content}
                                current={current || { blocks: [] }}
                                versionNumber={item.version}
                                canRestore={false}
                              />
                            ) : null}
                          </Box>
                        </Tabs.Content>
                      </Tabs.Root>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Flex>
      ) : null}
      <Dialog.Root open={Boolean(confirm)} onOpenChange={(open) => !open && !restoring && setConfirm(null)}>
        {confirm ? (
          <ConfirmDialog
            title={t('settings.syncedVersions.confirmTitle', 'Restore version {version}?', {
              version: confirm.version,
            })}
            endAction={
              <Button variant="danger-light" loading={restoring} onClick={restore}>
                {t('settings.syncedVersions.restore', 'Restore')}
              </Button>
            }
          >
            {dirty
              ? t(
                  'settings.syncedVersions.confirmBodyDirty',
                  'The synced block is saved with the content of this version, and every field that uses it shows it at once. Your unsaved changes in this form are lost.'
                )
              : t(
                  'settings.syncedVersions.confirmBody',
                  'The synced block is saved with the content of this version, and every field that uses it shows it at once.'
                )}
          </ConfirmDialog>
        ) : null}
      </Dialog.Root>
    </SectionCard>
  );
};

export default SyncedVersions;

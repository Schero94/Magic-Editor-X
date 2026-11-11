import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  Loader,
  Modal,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, Eye } from '@strapi/icons';
import { ConfirmDialog, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';

/**
 * Version history of one field: list snapshots, save the current content as a
 * version, preview and restore. Restoring replaces the editor content; the
 * entry is stored when the user saves it in the Content Manager.
 */

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
const previewLines = (content) => {
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
export const HistoryModal = ({ t, target, readContent, onRestore, onClose, canEdit }) => {
  const { formatDate } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [state, setState] = useState({ loading: true, error: false, items: [], meta: {} });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const saveButton = useRef(null);

  const fetchList = useCallback(
    () =>
      get(API.history, {
        params: {
          uid: target.uid,
          documentId: target.documentId,
          locale: target.locale || undefined,
          field: target.field,
        },
      }).then(
        ({ data }) => setState({ loading: false, error: false, items: data.data || [], meta: data.meta || {} }),
        () => setState((current) => ({ ...current, loading: false, error: true }))
      ),
    [get, target.uid, target.documentId, target.locale, target.field]
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
      const { data } = await post(API.history, { ...target, locale: target.locale || null, content });
      toggleNotification({
        type: 'success',
        message:
          data.meta && data.meta.created
            ? t('editor.history.saved', 'Version saved.')
            : t('editor.history.unchanged', 'Nothing changed since the last version.'),
      });
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

  const restore = async () => {
    const item = confirm;
    setRestoring(true);
    try {
      const { data } = await get(API.historyItem(item.id));
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

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header closeLabel={t('editor.history.close', 'Close')}>
          <Modal.Title>{t('editor.history.title', 'Version history')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Typography variant="omega" textColor="neutral600">
              {t(
                'editor.history.description',
                'Versions of this field. Restoring replaces the editor content; save the entry to keep it.'
              )}
            </Typography>
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
                {state.items.map((item) => {
                  const trigger = TRIGGERS[item.trigger] || TRIGGERS.manual;
                  const when = item.createdAt
                    ? formatDate(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })
                    : '—';
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
                        <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                          <Flex gap={2} wrap="wrap">
                            <Typography variant="omega" fontWeight="bold">
                              {t('editor.history.version', 'Version {version}', { version: item.version })}
                            </Typography>
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
                            onClick={() => showPreview(item)}
                          >
                            <Eye />
                          </IconButton>
                          {canWrite && item.restorable ? (
                            <Button variant="secondary" onClick={() => setConfirm(item)}>
                              {t('editor.history.restore', 'Restore')}
                            </Button>
                          ) : null}
                        </Flex>
                      </Flex>
                      {preview && preview.item.id === item.id ? (
                        <Box marginTop={3} padding={3} background="neutral100" hasRadius>
                          {preview.loading ? (
                            <Loader small>{t('editor.history.previewLoading', 'Loading preview')}</Loader>
                          ) : null}
                          {preview.error ? (
                            <Typography textColor="danger600">
                              {t('editor.history.previewError', 'The preview could not be loaded.')}
                            </Typography>
                          ) : null}
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
                      ) : null}
                    </Box>
                  );
                })}
              </Flex>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.history.cancel', 'Close')}</Button>
          </Modal.Close>
          {canWrite ? (
            <Button ref={saveButton} onClick={saveVersion} loading={saving}>
              {t('editor.history.save', 'Save current version')}
            </Button>
          ) : null}
        </Modal.Footer>
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

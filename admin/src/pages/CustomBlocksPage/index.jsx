import { useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, EmptyStateLayout, Flex, Typography } from '@strapi/design-system';
import { Download, Plus, Upload } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import { Page, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { PERMISSIONS } from '../../permissions';
import { API, readApiError } from '../../utils/api';
import { PageShell, SectionCard, refocusIfLost, useT } from '../../components/ui';
import { mapServerErrors, moveId, toPayload, withEnabled } from './blockForm.mjs';
import { useCustomBlocks } from './useCustomBlocks';
import { BlockList } from './BlockList';
import { BlockFormModal } from './BlockFormModal';
import { CodeBlocksSection } from './CodeBlocksSection';

/**
 * Settings -> Magic Editor X -> Custom blocks.
 * @returns {JSX.Element} Page.
 */
const CustomBlocksPage = () => {
  const t = useT();
  const { post, put, del, get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { allowedActions, isLoading: rbacLoading } = useRBAC(PERMISSIONS.customBlocksManage);
  const data = useCustomBlocks();
  const [modal, setModal] = useState({ open: false, block: null, key: 0 });
  const [busyId, setBusyId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const createRef = useRef(null);
  const fileRef = useRef(null);
  const title = t('settings.blocks.title', 'Custom blocks');

  const otherNames = useMemo(
    () =>
      data.blocks.filter((block) => !modal.block || block.id !== modal.block.id).map((block) => block.name),
    [data.blocks, modal.block]
  );

  if (rbacLoading || data.status === 'loading') {
    return (
      <Page.Main>
        <Page.Title>{title}</Page.Title>
        <Page.Loading />
      </Page.Main>
    );
  }
  if (!allowedActions.canManage) {
    return (
      <Page.Main>
        <Page.Title>{title}</Page.Title>
        <Page.NoPermissions />
      </Page.Main>
    );
  }
  if (data.status === 'error') {
    return (
      <Page.Main>
        <Page.Title>{title}</Page.Title>
        <Page.Error
          content={t('settings.blocks.loadError', 'The custom blocks could not be loaded.')}
          action={
            <Button variant="secondary" onClick={data.reload}>
              {t('settings.retry', 'Try again')}
            </Button>
          }
        />
      </Page.Main>
    );
  }

  const failed = (error, fallback) => {
    const info = readApiError(error);
    toggleNotification({
      type: 'danger',
      message: info.status === 404 ? t('settings.blocks.notFound', 'This block no longer exists.') : fallback,
    });
  };

  const onSubmit = async (values) => {
    const payload = toPayload(values);
    try {
      if (modal.block) await put(API.customBlock(modal.block.id), payload);
      else await post(API.customBlocks, payload);
      toggleNotification({
        type: 'success',
        message: modal.block
          ? t('settings.blocks.saved', 'Block {label} saved.', { label: payload.label })
          : t('settings.blocks.created', 'Block {label} created.', { label: payload.label }),
      });
      setModal((current) => ({ ...current, open: false, block: null }));
      await data.reload();
      return { ok: true };
    } catch (error) {
      const info = readApiError(error);
      if (info.status === 400) {
        toggleNotification({
          type: 'warning',
          message: t(
            'settings.blocks.rejected',
            'The server rejected some values. They are marked in the form.'
          ),
        });
        return { ok: false, errors: mapServerErrors(info.details) };
      }
      failed(
        error,
        t('settings.blocks.saveError', 'The block could not be saved. Your changes are still in the form.')
      );
      return { ok: false };
    }
  };

  const onToggle = async (block, enabled) => {
    setBusyId(block.id);
    try {
      const { data: response } = await put(API.customBlock(block.id), withEnabled(block, enabled));
      data.setBlocks((current) => current.map((item) => (item.id === block.id ? response.data : item)));
      toggleNotification({
        type: 'success',
        message: enabled
          ? t('settings.blocks.enabled', 'Block {label} is shown in the toolbox.', { label: block.label })
          : t('settings.blocks.disabled', 'Block {label} is hidden from the toolbox.', {
              label: block.label,
            }),
      });
    } catch (error) {
      const info = readApiError(error);
      if (info.status === 400) {
        toggleNotification({
          type: 'warning',
          message: t(
            'settings.blocks.toggleInvalid',
            'Block {label} has invalid settings. Edit it to fix them first.',
            { label: block.label }
          ),
        });
      } else failed(error, t('settings.blocks.toggleError', 'The block could not be updated.'));
    } finally {
      setBusyId(null);
    }
  };

  const onDuplicate = async (block) => {
    setBusyId(block.id);
    try {
      const { data: response } = await post(API.customBlockDuplicate(block.id), {});
      toggleNotification({
        type: 'success',
        message: t('settings.blocks.duplicated', 'Copy {label} created.', { label: response.data.label }),
      });
      await data.reload();
    } catch (error) {
      failed(error, t('settings.blocks.duplicateError', 'The block could not be duplicated.'));
    } finally {
      setBusyId(null);
    }
  };

  const onMove = async (block, direction) => {
    const ids = moveId(
      data.blocks.map((item) => item.id),
      block.id,
      direction
    );
    if (!ids) return;
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    setBusyId(block.id);
    try {
      const { data: response } = await put(API.customBlocksOrder, { ids });
      data.setBlocks(response.data);
    } catch (error) {
      failed(error, t('settings.blocks.moveError', 'The order could not be saved.'));
    } finally {
      setBusyId(null);
      requestAnimationFrame(() => refocusIfLost(opener, createRef.current));
    }
  };

  const onDelete = async (block) => {
    try {
      await del(API.customBlock(block.id));
      toggleNotification({
        type: 'success',
        message: t('settings.blocks.deleted', 'Block {label} deleted.', { label: block.label }),
      });
      data.setBlocks((current) => current.filter((item) => item.id !== block.id));
    } catch (error) {
      failed(error, t('settings.blocks.deleteError', 'The block could not be deleted.'));
      throw error;
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const { data: response } = await get(API.customBlocksExport);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'magic-editor-x-custom-blocks.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toggleNotification({
        type: 'success',
        message: t('settings.blocks.exported', 'Exported {count, plural, one {# block} other {# blocks}}.', {
          count: response.data.blocks.length,
        }),
      });
    } catch (error) {
      failed(error, t('settings.blocks.exportError', 'The export could not be created.'));
    } finally {
      setExporting(false);
    }
  };

  const onImportFile = async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    setImporting(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toggleNotification({
          type: 'danger',
          message: t('settings.blocks.importInvalidFile', 'The file is not valid JSON.'),
        });
        return;
      }
      const { data: response } = await post(API.customBlocksImport, parsed);
      const { created, skipped } = response.data;
      setImportReport({ created, skipped });
      toggleNotification({
        type: created.length ? 'success' : 'warning',
        message: t('settings.blocks.imported', 'Import finished: {created} created, {skipped} skipped.', {
          created: created.length,
          skipped: skipped.length,
        }),
      });
      await data.reload();
    } catch (error) {
      const info = readApiError(error);
      toggleNotification({
        type: 'danger',
        message:
          info.status === 400
            ? t('settings.blocks.importRejected', 'The file is not a Magic Editor X custom block export.')
            : t('settings.blocks.importError', 'The import failed. Nothing was imported.'),
      });
    } finally {
      setImporting(false);
    }
  };

  const createButton = (
    <Button
      ref={createRef}
      startIcon={<Plus />}
      onClick={() => setModal((current) => ({ open: true, block: null, key: current.key + 1 }))}
    >
      {t('settings.blocks.create', 'Create block')}
    </Button>
  );

  return (
    <PageShell
      title={title}
      subtitle={t(
        'settings.blocks.subtitle',
        'Define your own blocks for the editor toolbox: simple blocks with fields and an HTML layout, or blocks that embed a Content Manager entry.'
      )}
      primaryAction={createButton}
      secondaryAction={
        <Flex gap={2} wrap="wrap">
          <Button
            variant="tertiary"
            startIcon={<Upload />}
            loading={importing}
            disabled={importing}
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            {t('settings.blocks.import', 'Import')}
          </Button>
          <Button
            variant="tertiary"
            startIcon={<Download />}
            loading={exporting}
            disabled={exporting || data.blocks.length === 0}
            onClick={onExport}
          >
            {t('settings.blocks.export', 'Export')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label={t('settings.blocks.importFile', 'Custom block export file')}
            onChange={onImportFile}
          />
        </Flex>
      }
    >
      {data.refreshError ? (
        <Alert
          variant="danger"
          closeLabel={t('settings.close', 'Close')}
          action={
            <Button variant="tertiary" size="S" onClick={data.reload}>
              {t('settings.retry', 'Try again')}
            </Button>
          }
        >
          {t(
            'settings.blocks.refreshError',
            'The list could not be refreshed. It shows the last loaded state.'
          )}
        </Alert>
      ) : null}
      {importReport && importReport.skipped.length ? (
        <Alert
          variant="warning"
          closeLabel={t('settings.close', 'Close')}
          onClose={() => setImportReport(null)}
          title={t('settings.blocks.importSkippedTitle', 'Some blocks were not imported')}
        >
          <Box tag="ul" paddingTop={1}>
            {importReport.skipped.map((entry, index) => (
              <Typography key={`${entry.name}-${index}`} tag="li" variant="pi" textColor="neutral800">
                {entry.reason === 'exists'
                  ? t(
                      'settings.blocks.importSkippedExists',
                      '{name}: a block with this name already exists.',
                      { name: entry.name || '?' }
                    )
                  : t('settings.blocks.importSkippedInvalid', '{name}: the definition is not valid.', {
                      name: entry.name || '?',
                    })}
              </Typography>
            ))}
          </Box>
        </Alert>
      ) : null}
      {data.blocks.length === 0 ? (
        <SectionCard>
          <EmptyStateLayout
            icon={<EmptyDocuments width="16rem" height="8.8rem" />}
            content={t(
              'settings.blocks.empty',
              'No custom blocks yet. Blocks you create here appear in the editor toolbox of every Magic Editor X field.'
            )}
            action={
              <Button
                variant="secondary"
                startIcon={<Plus />}
                onClick={() => setModal((current) => ({ open: true, block: null, key: current.key + 1 }))}
              >
                {t('settings.blocks.create', 'Create block')}
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <BlockList
          blocks={data.blocks}
          busyId={busyId}
          onEdit={(block) => setModal((current) => ({ open: true, block, key: current.key + 1 }))}
          onDuplicate={onDuplicate}
          onMove={onMove}
          onDelete={onDelete}
          onToggle={onToggle}
          fallbackFocusRef={createRef}
        />
      )}
      <CodeBlocksSection />
      <BlockFormModal
        key={modal.key}
        open={modal.open}
        block={modal.block}
        otherNames={otherNames}
        contentTypes={data.contentTypes}
        onRetryContentTypes={data.reloadContentTypes}
        onSubmit={onSubmit}
        onClose={() => setModal((current) => ({ ...current, open: false, block: null }))}
      />
    </PageShell>
  );
};

export { CustomBlocksPage };
export default CustomBlocksPage;

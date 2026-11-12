import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  EmptyStateLayout,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import { Page, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { PERMISSIONS } from '../../permissions';
import { API, readApiError } from '../../utils/api';
import { PageShell, SectionCard, refocusIfLost, useT } from '../../components/ui';
import { RenderedContent } from '../../components/RenderedContent';
import { resetEditorConfigCache } from '../../hooks/useEditorConfig';
import {
  KIND_FILTERS,
  filterByKind,
  mapServerErrors,
  moveWithin,
  toPayload,
  withEnabled,
} from './templateForm.mjs';
import { useTemplateList } from './useTemplateList';
import { TemplateList } from './TemplateList';
import { TemplateEditor } from './TemplateEditor';

/**
 * Settings -> Magic Editor X -> Templates (2.3): templates, block patterns
 * and synced blocks that editors insert from the editor toolbar. The list and
 * the editor view share this page; the editor view replaces the list while it
 * is open. `?edit=<id>` opens a template directly ("Edit source" of a synced
 * block in the editor links here).
 * @returns {JSX.Element} Page.
 */
const TemplatesPage = () => {
  const t = useT();
  const { post, put, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { allowedActions, isLoading: rbacLoading } = useRBAC(PERMISSIONS.templatesManage);
  const data = useTemplateList();
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const createRef = useRef(null);
  const previewOpenerRef = useRef(null);
  const [kindFilter, setKindFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const editParam = searchParams.get('edit');
  const title = t('settings.templates.title', 'Templates');

  // Deep link from a synced block: open its source once the list is loaded (state adjusted while rendering).
  const [handledEdit, setHandledEdit] = useState(null);
  if (editParam && editParam !== handledEdit && data.status === 'ready') {
    setHandledEdit(editParam);
    const found = data.templates.find((item) => item.id === editParam);
    if (found) setEditing({ template: found, key: editParam });
  }
  // Then drop the parameter, so "Back" and reloads show the list.
  useEffect(() => {
    if (!editParam || editParam !== handledEdit) return;
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [editParam, handledEdit, searchParams, setSearchParams]);

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
          content={t('settings.templates.loadError', 'The templates could not be loaded.')}
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
      message:
        info.status === 404 ? t('settings.templates.notFound', 'This template no longer exists.') : fallback,
    });
  };

  const backToList = () => {
    setEditing(null);
    requestAnimationFrame(() => createRef.current && createRef.current.focus());
  };

  const onSubmit = async (values) => {
    const payload = toPayload(values);
    try {
      if (editing.template) await put(API.template(editing.template.id), payload);
      else await post(API.templates, payload);
      toggleNotification({
        type: 'success',
        message: editing.template
          ? t('settings.templates.saved', 'Template {name} saved.', { name: payload.name })
          : t('settings.templates.created', 'Template {name} created.', { name: payload.name }),
      });
      resetEditorConfigCache();
      await data.reload();
      backToList();
      return { ok: true };
    } catch (error) {
      const info = readApiError(error);
      if (info.status === 400) {
        toggleNotification({
          type: 'warning',
          message: t(
            'settings.templates.rejected',
            'The server rejected some values. They are marked in the form.'
          ),
        });
        return { ok: false, errors: mapServerErrors(info.details) };
      }
      failed(
        error,
        t(
          'settings.templates.saveError',
          'The template could not be saved. Your changes are still in the form.'
        )
      );
      return { ok: false };
    }
  };

  /** A synced source version was restored (2.4): reload and reopen the source with its new content. */
  const onRestored = async (template) => {
    resetEditorConfigCache();
    await data.reload();
    setEditing({ template, key: `${template.id}:${template.updatedAt || Date.now()}` });
  };

  if (editing) {
    return (
      <TemplateEditor
        key={editing.key}
        template={editing.template}
        targets={data.targets}
        onRetryTargets={data.reloadTargets}
        onSubmit={onSubmit}
        onBack={backToList}
        onRestored={onRestored}
      />
    );
  }

  const onToggle = async (template, enabled) => {
    setBusyId(template.id);
    try {
      const { data: response } = await put(API.template(template.id), withEnabled(template, enabled));
      data.setTemplates((current) => current.map((item) => (item.id === template.id ? response.data : item)));
      toggleNotification({
        type: 'success',
        message: enabled
          ? t('settings.templates.enabled', '{name} is offered in the editor.', { name: template.name })
          : t('settings.templates.disabled', '{name} is no longer offered in the editor.', {
              name: template.name,
            }),
      });
    } catch (error) {
      failed(error, t('settings.templates.toggleError', 'The template could not be updated.'));
    } finally {
      setBusyId(null);
    }
  };

  const onDuplicate = async (template) => {
    setBusyId(template.id);
    try {
      const { data: response } = await post(API.templateDuplicate(template.id), {});
      toggleNotification({
        type: 'success',
        message: t('settings.templates.duplicated', 'Copy {name} created. It is off until you turn it on.', {
          name: response.data.name,
        }),
      });
      await data.reload();
    } catch (error) {
      failed(error, t('settings.templates.duplicateError', 'The template could not be duplicated.'));
    } finally {
      setBusyId(null);
    }
  };

  const shownTemplates = filterByKind(data.templates, kindFilter);

  const onMove = async (template, direction) => {
    const ids = moveWithin(
      data.templates.map((item) => item.id),
      shownTemplates.map((item) => item.id),
      template.id,
      direction
    );
    if (!ids) return;
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    setBusyId(template.id);
    try {
      const { data: response } = await put(API.templatesOrder, { ids });
      data.setTemplates(response.data);
    } catch (error) {
      failed(error, t('settings.templates.moveError', 'The order could not be saved.'));
    } finally {
      setBusyId(null);
      requestAnimationFrame(() => refocusIfLost(opener, createRef.current));
    }
  };

  const onDelete = async (template) => {
    try {
      await del(API.template(template.id));
      toggleNotification({
        type: 'success',
        message: t('settings.templates.deleted', 'Template {name} deleted.', { name: template.name }),
      });
      data.setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (error) {
      failed(error, t('settings.templates.deleteError', 'The template could not be deleted.'));
      throw error;
    }
  };

  const openCreate = () => setEditing({ template: null, key: Date.now() });

  return (
    <PageShell
      title={title}
      subtitle={t(
        'settings.templates.subtitle',
        'Reusable starting content and block patterns. Editors insert them with "Insert template" in the editor toolbar.'
      )}
      primaryAction={
        <Button ref={createRef} startIcon={<Plus />} onClick={openCreate} data-testid="mex-template-create">
          {t('settings.templates.create', 'Create template')}
        </Button>
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
            'settings.templates.refreshError',
            'The list could not be refreshed. It shows the last loaded state.'
          )}
        </Alert>
      ) : null}
      {data.templates.length === 0 ? (
        <SectionCard>
          <EmptyStateLayout
            icon={<EmptyDocuments width="16rem" height="8.8rem" />}
            content={t(
              'settings.templates.empty',
              'No templates yet. Templates and patterns you create here appear in the Insert template dialog of the fields they are made for.'
            )}
            action={
              <Button variant="secondary" startIcon={<Plus />} onClick={openCreate}>
                {t('settings.templates.create', 'Create template')}
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Box maxWidth="32rem">
            <Field.Root name="mex-template-kind-filter">
              <Field.Label>{t('settings.templates.filter.label', 'Show')}</Field.Label>
              <SingleSelect
                value={kindFilter}
                onChange={(value) => setKindFilter(KIND_FILTERS.includes(value) ? value : 'all')}
                data-testid="mex-template-filter"
              >
                <SingleSelectOption value="all">
                  {t('settings.templates.filter.all', 'All types')}
                </SingleSelectOption>
                <SingleSelectOption value="template">
                  {t('settings.templates.filter.template', 'Templates')}
                </SingleSelectOption>
                <SingleSelectOption value="pattern">
                  {t('settings.templates.filter.pattern', 'Patterns')}
                </SingleSelectOption>
                <SingleSelectOption value="synced">
                  {t('settings.templates.filter.synced', 'Synced blocks')}
                </SingleSelectOption>
              </SingleSelect>
            </Field.Root>
          </Box>
          {shownTemplates.length === 0 ? (
            <Typography variant="omega" textColor="neutral600" role="status">
              {t('settings.templates.filter.empty', 'Nothing of this type yet.')}
            </Typography>
          ) : (
            <TemplateList
              templates={shownTemplates}
              busyId={busyId}
              onToggle={onToggle}
              onPreview={(template) => {
                previewOpenerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
                setPreview(template);
              }}
              onEdit={(template) => setEditing({ template, key: Date.now() })}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onDelete={onDelete}
              fallbackFocusRef={createRef}
            />
          )}
        </Flex>
      )}
      {preview ? (
        <Modal.Root
          open
          onOpenChange={(next) => {
            if (next) return;
            setPreview(null);
            // The modal is opened from state, not a Dialog trigger: give focus back to the row's preview button.
            requestAnimationFrame(() => refocusIfLost(previewOpenerRef.current, createRef.current));
          }}
        >
          <Modal.Content>
            <Modal.Header closeLabel={t('settings.close', 'Close')}>
              <Modal.Title>
                {t('settings.templates.preview.title', 'Preview of {name}', { name: preview.name })}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Box data-testid="mex-settings-template-preview">
                <RenderedContent value={preview.blocks} t={t} />
              </Box>
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary">{t('settings.close', 'Close')}</Button>
              </Modal.Close>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      ) : null}
    </PageShell>
  );
};

export { TemplatesPage };
export default TemplatesPage;

import { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Loader,
  Modal,
  Searchbar,
  Typography,
} from '@strapi/design-system';
import { ConfirmDialog } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { RenderedContent } from '../RenderedContent';
import { useTemplates } from './useTemplates';
import { filterSyncedForField, prepareInsertion, searchTemplates } from '../../../../shared/templates.mjs';
import { sourceBlocksOf } from '../../../../shared/synced.mjs';

/**
 * "Insert template" dialog (2.3): lists the templates and patterns offered in
 * this field (server-side scope filter), with search and a rendered preview
 * of what would be inserted (blocks the field does not allow are already left
 * out). Using a template on a field with content asks for confirmation
 * first. Managers can save the field's content as a new template from here.
 * Synced blocks (2.3) are listed in their own section: inserting one adds a
 * reference, and the preview shows what this field outputs for it.
 */

/** One selectable template: a real button with aria-pressed, full width. */
const Option = styled.button`
  display: block;
  width: 100%;
  text-align: start;
  cursor: pointer;
  border: 1px solid
    ${({ theme, $selected }) => ($selected ? theme.colors.primary600 : theme.colors.neutral200)};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.primary100 : theme.colors.neutral0)};
  padding: ${({ theme }) => theme.spaces[3]};
  color: ${({ theme }) => theme.colors.neutral800};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

/** Preview pane: bounded height with its own scroll region. */
const PreviewPane = styled(Box)`
  min-width: 0;
  max-height: 50vh;
  overflow: auto;
`;

const List = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ uid: string|null, field: string }} props.target - Field.
 * @param {import('../../../../shared/presets.mjs').FieldPreset} props.preset - Field preset.
 * @param {() => Promise<{ blocks: object[] }|null>} props.readContent - Current editor content.
 * @param {(template: object) => Promise<boolean>} props.onApply - Applies or inserts; resolves true on success.
 * @param {(() => void)|null} props.onSaveCurrent - Opens "Save as template" (managers), else null.
 * @param {() => void} props.onClose - Closes the dialog.
 * @param {boolean} props.allowRaw - Preview raw HTML blocks.
 * @returns {JSX.Element} Dialog.
 */
export const TemplateDialog = ({
  t,
  target,
  preset,
  readContent,
  onApply,
  onSaveCurrent,
  onClose,
  allowRaw,
}) => {
  const { status, items, reload } = useTemplates(target, true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const applyRef = useRef(null);

  const visible = useMemo(() => searchTemplates(items, query), [items, query]);
  const selected = visible.find((item) => item.id === selectedId) || visible[0] || null;

  const plan = useMemo(() => {
    if (!selected) return null;
    const restricted = preset.restricted ? preset : null;
    if (selected.kind === 'synced') {
      // What readers see: the source filtered by this field (the reference itself is one block).
      const shown = filterSyncedForField(sourceBlocksOf(selected.blocks), restricted);
      return { blocks: shown.blocks, omitted: shown.omitted ? [{ type: '', count: shown.omitted }] : [] };
    }
    return prepareInsertion(selected.blocks.blocks, restricted);
  }, [selected, preset]);
  const omitted = plan ? plan.omitted.reduce((sum, entry) => sum + entry.count, 0) : 0;
  const groups = useMemo(
    () =>
      [
        {
          key: 'templates',
          label: t('editor.templates.list', 'Templates and patterns'),
          items: visible.filter((item) => item.kind !== 'synced'),
        },
        {
          key: 'synced',
          label: t('editor.synced.section', 'Synced blocks'),
          items: visible.filter((item) => item.kind === 'synced'),
        },
      ].filter((group) => group.items.length),
    [visible, t]
  );

  const run = async (template) => {
    setBusy(true);
    try {
      const ok = await onApply(template);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    if (!selected) return;
    if (selected.kind === 'template') {
      const current = await readContent();
      const count = current && Array.isArray(current.blocks) ? current.blocks.length : 0;
      if (current && !current.empty && count > 0) {
        setConfirm({ template: selected, count });
        return;
      }
    }
    await run(selected);
  };

  const kindLabel = (kind) => {
    if (kind === 'template') return t('editor.templates.kind.template', 'Template');
    if (kind === 'synced') return t('editor.synced.kind', 'Synced block');
    return t('editor.templates.kind.pattern', 'Pattern');
  };

  let body;
  if (status === 'loading' || status === 'idle') {
    body = (
      <Flex justifyContent="center" padding={6}>
        <Loader small>{t('editor.templates.loading', 'Loading templates')}</Loader>
      </Flex>
    );
  } else if (status === 'error') {
    body = (
      <Flex direction="column" alignItems="flex-start" gap={3} padding={2}>
        <Typography variant="omega" textColor="danger600">
          {t('editor.templates.error', 'The templates could not be loaded.')}
        </Typography>
        <Button variant="secondary" onClick={reload}>
          {t('editor.config.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (items.length === 0) {
    body = (
      <Flex direction="column" alignItems="flex-start" gap={2} padding={2}>
        <Typography variant="omega" textColor="neutral800">
          {t('editor.templates.empty', 'No templates or patterns are available for this field yet.')}
        </Typography>
        {onSaveCurrent ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.templates.emptyManager',
              'Create them in Settings under Magic Editor X, Templates, or save the content of this field as a template.'
            )}
          </Typography>
        ) : null}
      </Flex>
    );
  } else {
    body = (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Searchbar
          name="mex-template-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          clearLabel={t('editor.templates.clear', 'Clear search')}
          placeholder={t('editor.templates.search', 'Search templates')}
        >
          {t('editor.templates.search', 'Search templates')}
        </Searchbar>
        {visible.length === 0 ? (
          <Typography variant="omega" textColor="neutral600" role="status">
            {t('editor.templates.noResults', 'No templates match your search.')}
          </Typography>
        ) : (
          <Grid.Root gap={4}>
            <Grid.Item col={5} s={12} xs={12} direction="column" alignItems="stretch">
              <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
                {groups.map((group) => (
                  <Flex key={group.key} direction="column" alignItems="stretch" gap={2} minWidth={0}>
                    {groups.length > 1 || group.key === 'synced' ? (
                      <Typography
                        variant="sigma"
                        tag="h3"
                        textColor="neutral600"
                        id={`mex-template-group-${group.key}`}
                      >
                        {group.label}
                      </Typography>
                    ) : null}
                    <List
                      aria-label={group.label}
                      data-testid={group.key === 'synced' ? 'mex-synced-options' : undefined}
                    >
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <Option
                            type="button"
                            $selected={selected && selected.id === item.id}
                            aria-pressed={Boolean(selected && selected.id === item.id)}
                            onClick={() => setSelectedId(item.id)}
                            onDoubleClick={() => applyRef.current && applyRef.current.click()}
                            data-testid="mex-template-option"
                          >
                            <Flex direction="column" alignItems="flex-start" gap={1}>
                              <Flex gap={2} wrap="wrap" alignItems="center">
                                <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                                  {item.name}
                                </Typography>
                                <Badge>{kindLabel(item.kind)}</Badge>
                              </Flex>
                              {item.description ? (
                                <Typography variant="pi" textColor="neutral600">
                                  {item.description}
                                </Typography>
                              ) : null}
                              <Typography variant="pi" textColor="neutral600">
                                {t(
                                  'editor.templates.blocks',
                                  '{count, plural, one {# block} other {# blocks}}',
                                  {
                                    count: item.blockCount,
                                  }
                                )}
                              </Typography>
                            </Flex>
                          </Option>
                        </li>
                      ))}
                    </List>
                  </Flex>
                ))}
              </Flex>
            </Grid.Item>
            <Grid.Item col={7} s={12} xs={12} direction="column" alignItems="stretch">
              {selected ? (
                <Flex direction="column" alignItems="stretch" gap={2} minWidth={0}>
                  <Typography variant="sigma" tag="h3" textColor="neutral600">
                    {t('editor.templates.previewHeading', 'Preview of {name}', { name: selected.name })}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {selected.kind === 'template'
                      ? t('editor.templates.hintTemplate', 'A template replaces the content of this field.')
                      : selected.kind === 'synced'
                        ? t(
                            'editor.synced.hint',
                            'A synced block is inserted as a reference after the block you worked on last. When its source changes, every field that uses it shows the new content.'
                          )
                        : t(
                            'editor.templates.hintPattern',
                            'A pattern is inserted after the block you worked on last.'
                          )}
                  </Typography>
                  {omitted ? (
                    <Typography variant="pi" textColor="danger600" data-testid="mex-template-omit">
                      {t(
                        'editor.templates.willOmit',
                        '{count, plural, one {# block is} other {# blocks are}} not allowed in this field and will be left out.',
                        { count: omitted }
                      )}
                    </Typography>
                  ) : null}
                  <PreviewPane
                    hasRadius
                    borderColor="neutral200"
                    padding={4}
                    background="neutral0"
                    data-testid="mex-template-preview"
                  >
                    <RenderedContent value={{ blocks: plan ? plan.blocks : [] }} t={t} allowRaw={allowRaw} />
                  </PreviewPane>
                </Flex>
              ) : null}
            </Grid.Item>
          </Grid.Root>
        )}
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
      <Modal.Content>
        <Modal.Header closeLabel={t('editor.templates.close', 'Close')}>
          <Modal.Title>{t('editor.templates.title', 'Insert a template or pattern')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body}</Modal.Body>
        <Modal.Footer>
          <Flex gap={2} wrap="wrap">
            <Modal.Close>
              <Button variant="tertiary">{t('editor.templates.cancel', 'Cancel')}</Button>
            </Modal.Close>
            {onSaveCurrent ? (
              <Button variant="secondary" onClick={onSaveCurrent} disabled={busy}>
                {t('editor.templates.saveCurrent', 'Save content as template')}
              </Button>
            ) : null}
          </Flex>
          <Button
            ref={applyRef}
            onClick={choose}
            loading={busy}
            disabled={busy || !selected || !plan || plan.blocks.length === 0}
            data-testid="mex-template-apply"
          >
            {selected && selected.kind === 'template'
              ? t('editor.templates.apply', 'Use template')
              : selected && selected.kind === 'synced'
                ? t('editor.synced.insert', 'Insert synced block')
                : t('editor.templates.insert', 'Insert pattern')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      <Dialog.Root
        open={Boolean(confirm)}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirm(null);
        }}
      >
        <ConfirmDialog
          title={t('editor.templates.replace.title', 'Replace the content of this field?')}
          variant="danger"
          endAction={
            <Button
              fullWidth
              variant="danger"
              loading={busy}
              onClick={async () => {
                const template = confirm.template;
                setConfirm(null);
                await run(template);
              }}
            >
              {t('editor.templates.replace.confirm', 'Replace content')}
            </Button>
          }
        >
          {t(
            'editor.templates.replace.body',
            'The template replaces the {count, plural, one {# block} other {# blocks}} in this field. Undo brings the content back, and nothing is stored until you save the entry.',
            { count: confirm ? confirm.count : 0 }
          )}
        </ConfirmDialog>
      </Dialog.Root>
    </Modal.Root>
  );
};

export default TemplateDialog;

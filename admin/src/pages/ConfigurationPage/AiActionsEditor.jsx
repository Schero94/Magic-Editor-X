import { useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Pencil, Plus, Trash } from '@strapi/icons';
import { ConfirmDialog } from '@strapi/strapi/admin';
import { useBreakpoint, useT } from '../../components/ui';
import { keepButtonKeys } from '../tableKeys.mjs';
import { MAX_CUSTOM_ACTIONS } from './configForm.mjs';
import { errorText } from './formParts';
import { ActionModal, scopeLabel } from './AiActionModal';

/**
 * Owner-defined AI actions (2.9) on the Configuration page: a list (DS Table
 * from the large breakpoint up, cards below), a Modal to add or edit one
 * action and a ConfirmDialog to delete one. Changes go into the page draft;
 * the page's Save stores them (and the unsaved-changes guard covers them).
 * The Modal and the ConfirmDialog live at the list level, so switching
 * between table and cards (resizing across the large breakpoint) keeps them open.
 */

/**
 * Label of an output.
 * @param {Function} t - Translate.
 * @param {string} output - Output.
 * @returns {string} Label.
 */
const outputLabel = (t, output) =>
  output === 'suggestions'
    ? t('settings.ai.actions.output.suggestions', 'Adds suggestions')
    : t('settings.ai.actions.output.replace', 'Preview, then replace');

/**
 * Edit and delete buttons of one action (table row or card).
 * @param {{ action: object, onEdit: () => void, onDelete: () => void }} props - Action and handlers.
 * @returns {JSX.Element} Buttons.
 */
const RowActions = ({ action, onEdit, onDelete }) => {
  const t = useT();
  return (
    <Flex gap={1} wrap="wrap" onKeyDown={keepButtonKeys}>
      <IconButton
        label={t('settings.ai.actions.editNamed', 'Edit {name}', { name: action.name })}
        variant="ghost"
        onClick={onEdit}
      >
        <Pencil />
      </IconButton>
      <IconButton
        label={t('settings.ai.actions.deleteNamed', 'Delete {name}', { name: action.name })}
        variant="ghost"
        onClick={onDelete}
      >
        <Trash />
      </IconButton>
    </Flex>
  );
};

/**
 * @param {object} props - Props.
 * @param {object[]} props.actions - Draft actions.
 * @param {(actions: object[]) => void} props.onChange - Replaces the draft actions.
 * @param {boolean} props.readOnly - No settings.update.
 * @param {string|{ server: string }} [props.error] - Error of the list (server or validation).
 * @returns {JSX.Element} Editor.
 */
export const AiActionsEditor = ({ actions, onChange, readOnly, error }) => {
  const t = useT();
  const { isBelowLarge } = useBreakpoint();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const addRef = useRef(null);
  const headingRef = useRef(null);
  const rootRef = useRef(null);
  const full = actions.length >= MAX_CUSTOM_ACTIONS;

  const openNew = () =>
    setEditing({
      index: -1,
      action: { key: '', name: '', instruction: '', scope: 'selection', output: 'replace' },
    });
  const editLabel = (action) => t('settings.ai.actions.editNamed', 'Edit {name}', { name: action.name });
  const submit = (action) => {
    const next = [...actions];
    const adding = editing.index < 0;
    if (adding) next.push(action);
    else next[editing.index] = action;
    onChange(next);
    setEditing(null);
    // Added: "Add action" (still there, or the heading at the limit); edited: the same row's Edit button.
    restoreFocus(adding ? null : editLabel(action));
  };
  const closeModal = () => {
    const label = editing && editing.index >= 0 ? editLabel(editing.action) : null;
    setEditing(null);
    restoreFocus(label);
  };
  /**
   * Focus after the Modal or the confirmation closes: the button with `label` (the same action's
   * Edit or Delete button; it may have been rendered anew in the other layout), else "Add action",
   * else the heading. Never <body>.
   * @param {string|null} label - Accessible name of the button to return to, or null.
   */
  const restoreFocus = (label) =>
    // After the dialog's own focus handling (Radix restores focus on a timer when it unmounts).
    window.setTimeout(() => {
      const active = document.activeElement;
      // Focus already on a control of the page (not <body>, not a closing dialog): leave it there.
      if (active && active !== document.body && !active.closest('[role="dialog"], [role="alertdialog"]'))
        return;
      const buttons = rootRef.current ? [...rootRef.current.querySelectorAll('button[aria-label]')] : [];
      const trigger = label ? buttons.find((button) => button.getAttribute('aria-label') === label) : null;
      const target =
        trigger || (addRef.current && !addRef.current.disabled ? addRef.current : headingRef.current);
      if (target) target.focus();
    }, 50);
  const deleteLabel = (action) =>
    t('settings.ai.actions.deleteNamed', 'Delete {name}', { name: action.name });
  const closeDelete = (open) => {
    if (open) return;
    const label = deleting ? deleteLabel(deleting.action) : null;
    setDeleting(null);
    restoreFocus(label);
  };
  const confirmDelete = () => {
    const { index } = deleting;
    onChange(actions.filter((_, other) => other !== index));
    setDeleting(null);
    restoreFocus(null);
  };
  const errorMessage = error ? errorText(t, error, 'actions') : null;

  const rows = actions.map((action, index) => ({
    action,
    index,
    actionsNode: readOnly ? null : (
      <RowActions
        action={action}
        onEdit={() => setEditing({ index, action })}
        onDelete={() => setDeleting({ index, action })}
      />
    ),
  }));

  let list;
  if (!actions.length) {
    list = (
      <Typography variant="omega" textColor="neutral600">
        {t(
          'settings.ai.actions.empty',
          'No own actions yet. Add one to give editors a named instruction, for example your brand voice.'
        )}
      </Typography>
    );
  } else if (isBelowLarge) {
    list = (
      <Flex tag="ul" direction="column" alignItems="stretch" gap={3} aria-labelledby="mex-ai-actions-title">
        {rows.map(({ action, index, actionsNode }) => (
          <Box tag="li" key={action.key || index} padding={4} hasRadius borderColor="neutral200" minWidth={0}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
                <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                  <Typography fontWeight="bold" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                    {action.name}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                    {action.key}
                  </Typography>
                </Flex>
                {actionsNode}
              </Flex>
              <Flex gap={2} wrap="wrap">
                <Badge>{scopeLabel(t, action.scope)}</Badge>
                <Badge>{outputLabel(t, action.output)}</Badge>
              </Flex>
            </Flex>
          </Box>
        ))}
      </Flex>
    );
  } else {
    list = (
      <Table colCount={readOnly ? 3 : 4} rowCount={actions.length + 1}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">{t('settings.ai.actions.column.name', 'Action')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('settings.ai.actions.column.scope', 'Works on')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('settings.ai.actions.column.output', 'Result')}</Typography>
            </Th>
            {readOnly ? null : (
              <Th>
                <VisuallyHidden>{t('settings.ai.actions.column.actions', 'Actions')}</VisuallyHidden>
              </Th>
            )}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ action, index, actionsNode }) => (
            <Tr key={action.key || index}>
              <Td>
                <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                  <Typography fontWeight="bold" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                    {action.name}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {action.key}
                  </Typography>
                </Flex>
              </Td>
              <Td>
                <Typography textColor="neutral800">{scopeLabel(t, action.scope)}</Typography>
              </Td>
              <Td>
                <Typography textColor="neutral800">{outputLabel(t, action.output)}</Typography>
              </Td>
              {readOnly ? null : <Td>{actionsNode}</Td>}
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3} data-testid="mex-ai-actions" ref={rootRef}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={3} wrap="wrap">
        <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 20rem">
          <Typography variant="delta" tag="h3" id="mex-ai-actions-title" ref={headingRef} tabIndex={-1}>
            {t('settings.ai.actions.title', 'Your AI actions')}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {t(
              'settings.ai.actions.subtitle',
              'Named instructions that appear in the editor AI menu below the built-in actions. Up to {max} actions. A field can limit its actions in the field settings (AI actions).',
              { max: MAX_CUSTOM_ACTIONS }
            )}
          </Typography>
        </Flex>
        {readOnly ? null : (
          <Button
            ref={addRef}
            variant="secondary"
            startIcon={<Plus />}
            onClick={openNew}
            disabled={full}
            data-testid="mex-ai-action-add"
          >
            {t('settings.ai.actions.add', 'Add action')}
          </Button>
        )}
      </Flex>
      {full && !readOnly ? (
        <Typography variant="pi" textColor="neutral600">
          {t('settings.ai.actions.full', 'You reached the limit of {max} actions.', {
            max: MAX_CUSTOM_ACTIONS,
          })}
        </Typography>
      ) : null}
      {list}
      {errorMessage ? (
        <Typography variant="pi" textColor="danger600" role="alert">
          {errorMessage}
        </Typography>
      ) : null}
      <Dialog.Root open={Boolean(deleting)} onOpenChange={closeDelete}>
        {deleting ? (
          <ConfirmDialog
            title={t('settings.ai.actions.delete.title', 'Delete the AI action {name}?', {
              name: deleting.action.name,
            })}
            variant="danger"
            endAction={
              <Button fullWidth variant="danger" onClick={confirmDelete}>
                {t('settings.ai.actions.delete.confirm', 'Delete action')}
              </Button>
            }
          >
            {t(
              'settings.ai.actions.delete.body',
              'Editors no longer see it after you save the settings. Field settings that list the key {key} offer nothing in its place. Suggestions it already made stay in the Suggestions panel.',
              { key: deleting.action.key }
            )}
          </ConfirmDialog>
        ) : null}
      </Dialog.Root>
      {editing ? (
        <ActionModal
          initial={editing.action}
          isNew={editing.index < 0}
          others={actions.filter((_, index) => index !== editing.index)}
          onSubmit={submit}
          onClose={closeModal}
        />
      ) : null}
    </Flex>
  );
};

export default AiActionsEditor;

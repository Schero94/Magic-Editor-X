import { useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
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
import { ConfirmAction, useBreakpoint, useT } from '../../components/ui';
import { keepButtonKeys } from '../tableKeys.mjs';
import { MAX_CUSTOM_ACTIONS } from './configForm.mjs';
import { errorText } from './formParts';
import { ActionModal, scopeLabel } from './AiActionModal';

/**
 * Owner-defined AI actions (2.9) on the Configuration page: a list (DS Table
 * from the large breakpoint up, cards below), a Modal to add or edit one
 * action and a ConfirmDialog to delete one. Changes go into the page draft;
 * the page's Save stores them (and the unsaved-changes guard covers them).
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
 * @param {object} props - Props.
 * @returns {JSX.Element} Buttons.
 */
const RowActions = ({ action, onEdit, onDelete, fallbackFocusRef }) => {
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
      <ConfirmAction
        fallbackFocusRef={fallbackFocusRef}
        trigger={
          <IconButton
            label={t('settings.ai.actions.deleteNamed', 'Delete {name}', { name: action.name })}
            variant="ghost"
          >
            <Trash />
          </IconButton>
        }
        title={t('settings.ai.actions.delete.title', 'Delete the AI action {name}?', { name: action.name })}
        body={t(
          'settings.ai.actions.delete.body',
          'Editors no longer see it after you save the settings. Field settings that list the key {key} offer nothing in its place. Suggestions it already made stay in the Suggestions panel.',
          { key: action.key }
        )}
        confirmLabel={t('settings.ai.actions.delete.confirm', 'Delete action')}
        onConfirm={onDelete}
      />
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
  const addRef = useRef(null);
  const headingRef = useRef(null);
  const full = actions.length >= MAX_CUSTOM_ACTIONS;

  const openNew = () =>
    setEditing({
      index: -1,
      action: { key: '', name: '', instruction: '', scope: 'selection', output: 'replace' },
    });
  const submit = (action) => {
    const next = [...actions];
    if (editing.index < 0) next.push(action);
    else next[editing.index] = action;
    onChange(next);
    setEditing(null);
  };
  const remove = (index) => onChange(actions.filter((_, other) => other !== index));
  const errorMessage = error ? errorText(t, error, 'actions') : null;

  const rows = actions.map((action, index) => ({
    action,
    index,
    actionsNode: readOnly ? null : (
      <RowActions
        action={action}
        onEdit={() => setEditing({ index, action })}
        onDelete={() => remove(index)}
        fallbackFocusRef={full ? headingRef : addRef}
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
    <Flex direction="column" alignItems="stretch" gap={3} data-testid="mex-ai-actions">
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
      {editing ? (
        <ActionModal
          initial={editing.action}
          isNew={editing.index < 0}
          others={actions.filter((_, index) => index !== editing.index)}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Flex>
  );
};

export default AiActionsEditor;

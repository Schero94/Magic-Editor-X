import { useState } from 'react';
import {
  Button,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
} from '@strapi/design-system';
import { useT } from '../../components/ui';
import {
  MAX_ACTION_INSTRUCTION_CHARS,
  MAX_ACTION_NAME_CHARS,
  actionKeyFromName,
  validateAction,
} from './configForm.mjs';
import { SwitchRow, errorText } from './formParts';

/**
 * Modal to add or edit one owner-defined AI action (2.9). It edits a copy;
 * "Add action" / "Apply" hands it to the page draft (the page's Save stores it).
 */

export const SCOPE_LABELS = {
  selection: ['settings.ai.actions.scope.selection', 'Selected text'],
  blocks: ['settings.ai.actions.scope.blocks', 'Selected blocks'],
  field: ['settings.ai.actions.scope.field', 'Whole field'],
};

/**
 * Label of a scope.
 * @param {Function} t - Translate.
 * @param {string} scope - Scope.
 * @returns {string} Label.
 */
export const scopeLabel = (t, scope) => (SCOPE_LABELS[scope] ? t(...SCOPE_LABELS[scope]) : scope);

/**
 * Add or edit one action. Mounted only while open.
 * @param {object} props - Props.
 * @param {object} props.initial - Action draft (empty key for a new action).
 * @param {boolean} props.isNew - Adding instead of editing.
 * @param {object[]} props.others - The other actions (unique keys).
 * @param {(action: object) => void} props.onSubmit - Takes the action into the page draft.
 * @param {() => void} props.onClose - Closes.
 * @returns {JSX.Element} Modal.
 */
export const ActionModal = ({ initial, isNew, others, onSubmit, onClose }) => {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const [keyTouched, setKeyTouched] = useState(!isNew);
  // Errors show after the first "Add action"/"Apply" and then follow the typing. Not on blur: inside
  // the Modal's focus trap, swapping a hint for an error between blur and focus moved focus to the
  // dialog itself (Radix FocusScope refocuses the container when a node goes while <body> is active).
  const [showErrors, setShowErrors] = useState(false);
  const errors = validateAction(draft, { others });
  const visible = (name) => (showErrors ? errors[name] : undefined);
  const set = (name, value) =>
    setDraft((current) => {
      const next = { ...current, [name]: value };
      if (name === 'name' && !keyTouched)
        next.key = actionKeyFromName(
          value,
          others.map((other) => other.key)
        );
      return next;
    });
  const submit = () => {
    setShowErrors(true);
    if (Object.keys(errors).length) return;
    onSubmit({ ...draft, name: draft.name.trim(), instruction: draft.instruction.trim() });
  };
  const keyError = visible('key');

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content aria-describedby={undefined} data-testid="mex-ai-action-modal">
        <Modal.Header closeLabel={t('settings.close', 'Close')}>
          <Modal.Title>
            {isNew
              ? t('settings.ai.actions.add.title', 'Add an AI action')
              : t('settings.ai.actions.edit.title', 'Edit the AI action {name}', { name: initial.name })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root
              name="mex-ai-action-name"
              required
              error={errorText(t, visible('name'), 'name')}
              hint={t(
                'settings.ai.actions.name.hint',
                'Editors see this name in the AI menu. Up to {max} characters.',
                { max: MAX_ACTION_NAME_CHARS }
              )}
            >
              <Field.Label>{t('settings.ai.actions.name.label', 'Name')}</Field.Label>
              <TextInput
                value={draft.name}
                maxLength={MAX_ACTION_NAME_CHARS}
                onChange={(event) => set('name', event.target.value)}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
            <Field.Root
              name="mex-ai-action-key"
              required
              error={errorText(t, keyError, 'key')}
              hint={
                isNew
                  ? t(
                      'settings.ai.actions.key.hint',
                      'Lower-case letters, digits and hyphens. Field settings use it to choose the AI actions of a field. It cannot be changed later.'
                    )
                  : t(
                      'settings.ai.actions.key.hintFixed',
                      'Field settings use this key to choose the AI actions of a field.'
                    )
              }
            >
              <Field.Label>{t('settings.ai.actions.key.label', 'Key')}</Field.Label>
              <TextInput
                value={draft.key}
                disabled={!isNew}
                maxLength={40}
                onChange={(event) => {
                  setKeyTouched(true);
                  set('key', event.target.value.toLowerCase());
                }}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
            <Field.Root
              name="mex-ai-action-instruction"
              required
              error={errorText(t, visible('instruction'), 'instruction')}
              hint={t(
                'settings.ai.actions.instruction.hint',
                'What the AI should do, for example "Rewrite this as a short introduction for search results". It is sent with the text; editors do not see it. {count} of {max} characters.',
                { count: draft.instruction.length, max: MAX_ACTION_INSTRUCTION_CHARS }
              )}
            >
              <Field.Label>{t('settings.ai.actions.instruction.label', 'Instruction')}</Field.Label>
              <Textarea
                value={draft.instruction}
                maxLength={MAX_ACTION_INSTRUCTION_CHARS}
                onChange={(event) => set('instruction', event.target.value)}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
            <Field.Root
              name="mex-ai-action-scope"
              hint={t(
                'settings.ai.actions.scope.hint',
                'Where editors find the action: in the AI dialog of selected text, of selected blocks, or of the whole field (More tools).'
              )}
            >
              <Field.Label>{t('settings.ai.actions.scope.label', 'Works on')}</Field.Label>
              <SingleSelect value={draft.scope} onChange={(value) => set('scope', String(value))}>
                {Object.keys(SCOPE_LABELS).map((scope) => (
                  <SingleSelectOption key={scope} value={scope}>
                    {scopeLabel(t, scope)}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Hint />
            </Field.Root>
            <SwitchRow
              id="mex-ai-action-output"
              t={t}
              label={t('settings.ai.actions.output.label', 'Add the result as suggestions')}
              hint={t(
                'settings.ai.actions.output.hint',
                'On: every changed block becomes a suggestion in the Suggestions panel, for editors who may suggest changes. Off: the editor previews the result and replaces the text.'
              )}
              checked={draft.output === 'suggestions'}
              disabled={false}
              onChange={(checked) => set('output', checked ? 'suggestions' : 'replace')}
            />
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('settings.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Button onClick={submit} data-testid="mex-ai-action-submit">
            {isNew
              ? t('settings.ai.actions.add.submit', 'Add action')
              : t('settings.ai.actions.edit.submit', 'Apply')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ActionModal;

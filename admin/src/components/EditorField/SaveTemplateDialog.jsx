import { useState } from 'react';
import { Button, Field, Flex, Modal, Radio, TextInput, Textarea, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';
import { scopeFieldOf, TEMPLATE_LIMITS } from '../../../../shared/templates.mjs';

/**
 * "Save as template" (2.3, managers only): stores the field's content or the
 * selected blocks as a new template or pattern, offered in this field or in
 * every field. The server sanitises the blocks; the settings page refines
 * the scope later.
 */

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ blocks: object[], kind: 'template'|'pattern' }} props.request - Blocks to save and the suggested kind.
 * @param {{ uid: string|null, field: string }} props.target - Field (for "only this field").
 * @param {string} props.fieldLabel - Field label shown in the scope option.
 * @param {(name: string) => void} props.onSaved - Called after the template was stored.
 * @param {() => void} props.onClose - Closes the dialog.
 * @returns {JSX.Element} Dialog.
 */
export const SaveTemplateDialog = ({ t, request, target, fieldLabel, onSaved, onClose }) => {
  const { post } = useFetchClient();
  const [values, setValues] = useState({
    name: '',
    description: '',
    kind: request.kind,
    scope: target.uid ? 'field' : 'all',
  });
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameError = values.name.trim() ? null : t('editor.saveTemplate.nameRequired', 'Enter a name.');

  const save = async () => {
    setShowErrors(true);
    if (nameError) return;
    setSaving(true);
    setServerError(null);
    try {
      await post(API.templates, {
        name: values.name.trim(),
        description: values.description.trim() || null,
        kind: values.kind,
        blocks: { time: Date.now(), version: '2.31.7', blocks: request.blocks },
        scope:
          values.scope === 'field' && target.uid
            ? { all: false, fields: [{ uid: target.uid, field: scopeFieldOf(target.field) }] }
            : { all: true },
        enabled: true,
      });
      onSaved(values.name.trim());
    } catch (error) {
      const info = readApiError(error);
      setServerError(
        info.status === 400
          ? t(
              'editor.saveTemplate.rejected',
              'The template could not be saved: the content is empty or too large.'
            )
          : t('editor.saveTemplate.error', 'The template could not be saved. Try again.')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <Modal.Content>
        <Modal.Header closeLabel={t('editor.templates.close', 'Close')}>
          <Modal.Title>{t('editor.saveTemplate.title', 'Save as template or pattern')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Typography variant="omega" textColor="neutral800">
              {t(
                'editor.saveTemplate.count',
                '{count, plural, one {# block is} other {# blocks are}} saved. You can change everything later in Settings under Magic Editor X, Templates.',
                { count: request.blocks.length }
              )}
            </Typography>
            {serverError ? (
              <Typography variant="pi" textColor="danger600" role="alert">
                {serverError}
              </Typography>
            ) : null}
            <Field.Root name="mex-template-name" error={showErrors ? nameError : undefined} required>
              <Field.Label>{t('editor.saveTemplate.name', 'Name')}</Field.Label>
              <TextInput
                value={values.name}
                maxLength={TEMPLATE_LIMITS.name}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              />
              <Field.Error />
            </Field.Root>
            <Field.Root name="mex-template-description">
              <Field.Label>{t('editor.saveTemplate.description', 'Description')}</Field.Label>
              <Textarea
                value={values.description}
                maxLength={TEMPLATE_LIMITS.description}
                onChange={(event) =>
                  setValues((current) => ({ ...current, description: event.target.value }))
                }
              />
            </Field.Root>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="pi" fontWeight="bold" textColor="neutral800" id="mex-save-kind">
                {t('editor.saveTemplate.kind', 'Type')}
              </Typography>
              <Radio.Group
                aria-labelledby="mex-save-kind"
                value={values.kind}
                onValueChange={(kind) => setValues((current) => ({ ...current, kind }))}
              >
                <Radio.Item value="template">
                  {t('editor.saveTemplate.kindTemplate', 'Template: starting content for an empty field')}
                </Radio.Item>
                <Radio.Item value="pattern">
                  {t('editor.saveTemplate.kindPattern', 'Pattern: blocks to insert anywhere')}
                </Radio.Item>
              </Radio.Group>
            </Flex>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="pi" fontWeight="bold" textColor="neutral800" id="mex-save-scope">
                {t('editor.saveTemplate.scope', 'Offer it in')}
              </Typography>
              <Radio.Group
                aria-labelledby="mex-save-scope"
                value={values.scope}
                onValueChange={(scope) => setValues((current) => ({ ...current, scope }))}
              >
                {target.uid ? (
                  <Radio.Item value="field">
                    {t('editor.saveTemplate.scopeField', 'Only this field ({field})', { field: fieldLabel })}
                  </Radio.Item>
                ) : null}
                <Radio.Item value="all">
                  {t('editor.saveTemplate.scopeAll', 'Every Magic Editor X field')}
                </Radio.Item>
              </Radio.Group>
            </Flex>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.templates.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Button onClick={save} loading={saving} disabled={saving} data-testid="mex-template-save">
            {t('editor.saveTemplate.save', 'Save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SaveTemplateDialog;

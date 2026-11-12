import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Field,
  Flex,
  Grid,
  MultiSelect,
  MultiSelectOption,
  Radio,
  Switch,
  TextInput,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Check } from '@strapi/icons';
import { Blocker, Form } from '@strapi/strapi/admin';
import { ConfirmAction, DraftSync, PageShell, SectionCard, useT } from '../../components/ui';
import { EditorFieldBody } from '../../components/EditorField';
import { TEMPLATE_LIMITS } from '../../../../shared/templates.mjs';
import {
  PRESET_NAMES,
  emptyValues,
  fieldKey,
  fromDto,
  validateTemplate,
  valuesKey,
} from './templateForm.mjs';

/**
 * Create / edit view of one template, shown in place of the list. The content
 * is written with an embedded Magic Editor X editor (full preset, no
 * collaboration or history: it is not a document field). Unsaved changes are
 * guarded by the admin Blocker and by a confirmation on "Back".
 */

/** Target of the embedded editor: no document, so collaboration, history, comments and template insertion are off. */
const EDITOR_TARGET = Object.freeze({
  uid: null,
  documentId: null,
  locale: null,
  field: 'mexTemplateContent',
});
const EDITOR_ATTRIBUTE = Object.freeze({ options: {} });

const PRESET_LABELS = {
  full: ['settings.templates.preset.full', 'Full'],
  article: ['settings.templates.preset.article', 'Article'],
  basic: ['settings.templates.preset.basic', 'Basic'],
  minimal: ['settings.templates.preset.minimal', 'Minimal'],
};

/**
 * Message for a client-side error code.
 * @param {Function} t - Translator.
 * @param {string|undefined} code - Error code or server message.
 * @returns {string|undefined} Text.
 */
const errorText = (t, code) => {
  if (!code) return undefined;
  if (code === 'required') return t('settings.templates.form.nameRequired', 'Enter a name.');
  if (code === 'tooLong') return t('settings.templates.form.tooLong', 'This text is too long.');
  if (code === 'scope')
    return t('settings.templates.form.scopeRequired', 'Choose at least one preset or field.');
  if (code === 'content') return t('settings.templates.form.contentRequired', 'Add at least one block.');
  if (code === 'nestedSynced')
    return t(
      'settings.templates.form.nestedSynced',
      'A synced block cannot contain another synced block. Remove it or detach it first.'
    );
  if (code === 'tooManyBlocks')
    return t('settings.templates.form.tooManyBlocks', 'A template can have at most {max} blocks.', {
      max: TEMPLATE_LIMITS.blocks,
    });
  return code;
};

/**
 * @param {object} props - Props.
 * @param {object|null} props.template - Template DTO when editing, null when creating.
 * @param {{ status: string, items: Array<{ uid: string, displayName: string, field: string, preset: string }> }} props.targets - Fields for scope selection.
 * @param {() => void} props.onRetryTargets - Reloads the fields.
 * @param {(values: object) => Promise<{ ok: boolean, errors?: object }>} props.onSubmit - Saves.
 * @param {() => void} props.onBack - Returns to the list.
 * @returns {JSX.Element} Page.
 */
export const TemplateEditor = ({ template, targets, onRetryTargets, onSubmit, onBack }) => {
  const t = useT();
  const saved = useMemo(() => (template ? fromDto(template) : emptyValues()), [template]);
  const [values, setValues] = useState(saved);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const errors = useMemo(() => validateTemplate(values), [values]);
  const visible = { ...(showErrors ? errors : {}), ...serverErrors };
  const savedKey = useMemo(() => ({ key: valuesKey(saved) }), [saved]);
  const draftKey = useMemo(() => ({ key: valuesKey(values) }), [values]);
  const dirty = draftKey.key !== savedKey.key;
  const set = (patch) => {
    setValues((current) => ({ ...current, ...patch }));
    setServerErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[key]);
      if (patch.presets || patch.fields || patch.scopeMode) delete next.scope;
      delete next._form;
      return next;
    });
  };

  const submit = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const result = await onSubmit(values);
      if (!result.ok && result.errors) setServerErrors(result.errors);
    } finally {
      setSaving(false);
    }
  };

  const title = template
    ? t('settings.templates.edit.title', 'Edit template {name}', { name: template.name })
    : t('settings.templates.edit.createTitle', 'Create a template');

  const backButton = (
    <Button
      variant="tertiary"
      startIcon={<ArrowLeft />}
      disabled={saving}
      onClick={dirty ? undefined : onBack}
    >
      {t('settings.templates.edit.back', 'Back to templates')}
    </Button>
  );

  const presetLabel = (name) => t(PRESET_LABELS[name][0], PRESET_LABELS[name][1]);
  // References point at synced blocks: a saved synced block stays one, and a template or pattern cannot become one.
  const savedSynced = Boolean(template && template.kind === 'synced');
  const fieldOptions = targets.items.map((target) => ({
    key: fieldKey(target),
    label: t('settings.templates.form.fieldOption', '{type}: {field} ({preset})', {
      type: target.displayName,
      field: target.field,
      preset: PRESET_LABELS[target.preset] ? presetLabel(target.preset) : target.preset,
    }),
  }));
  // Fields stored earlier that no longer exist stay selectable so they can be removed.
  for (const key of values.fields) {
    if (!fieldOptions.some((option) => option.key === key)) fieldOptions.push({ key, label: key });
  }

  return (
    <PageShell
      title={title}
      subtitle={t(
        'settings.templates.edit.subtitle',
        'Templates are starting content for an empty field. Patterns are groups of blocks editors insert anywhere.'
      )}
      primaryAction={
        <Button
          startIcon={<Check />}
          onClick={submit}
          loading={saving}
          disabled={saving}
          data-testid="mex-template-submit"
        >
          {t('settings.templates.edit.save', 'Save template')}
        </Button>
      }
      secondaryAction={
        dirty ? (
          <ConfirmAction
            disabled={saving}
            trigger={backButton}
            title={t('settings.templates.edit.discardTitle', 'Discard your changes?')}
            body={t(
              'settings.templates.edit.discardBody',
              'You go back to the list. Your unsaved changes to this template are lost.'
            )}
            confirmLabel={t('settings.templates.edit.discardConfirm', 'Discard changes')}
            variant="danger-light"
            onConfirm={onBack}
          />
        ) : (
          backButton
        )
      }
    >
      {showErrors && Object.keys(errors).length ? (
        <Typography variant="pi" textColor="danger600" role="status">
          {t('settings.templates.form.invalid', 'Some values need attention. They are marked below.')}
        </Typography>
      ) : null}
      {visible._form ? (
        <Alert variant="danger" closeLabel={t('settings.close', 'Close')} onClose={() => setServerErrors({})}>
          {visible._form}
        </Alert>
      ) : null}
      <SectionCard title={t('settings.templates.form.details', 'Details')}>
        <Grid.Root gap={{ initial: 4, medium: 6 }}>
          <Grid.Item col={6} xs={12} s={12} direction="column" alignItems="stretch">
            <Field.Root
              name="name"
              error={errorText(t, visible.name)}
              hint={t(
                'settings.templates.form.nameHint',
                'Shown in the Insert template dialog of the editor.'
              )}
              required
            >
              <Field.Label>{t('settings.templates.form.name', 'Name')}</Field.Label>
              <TextInput
                value={values.name}
                maxLength={TEMPLATE_LIMITS.name}
                onChange={(event) => set({ name: event.target.value })}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={6} xs={12} s={12} direction="column" alignItems="stretch">
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="pi" fontWeight="bold" textColor="neutral800" id="mex-template-kind">
                {t('settings.templates.form.kind', 'Type')}
              </Typography>
              <Radio.Group
                aria-labelledby="mex-template-kind"
                value={values.kind}
                onValueChange={(kind) => set({ kind })}
              >
                <Radio.Item value="template" disabled={savedSynced}>
                  {t(
                    'settings.templates.form.kindTemplate',
                    'Template: starting content, applied to an empty field or replacing its content after a confirmation'
                  )}
                </Radio.Item>
                <Radio.Item value="pattern" disabled={savedSynced}>
                  {t(
                    'settings.templates.form.kindPattern',
                    'Pattern: a group of blocks inserted after the current block'
                  )}
                </Radio.Item>
                <Radio.Item value="synced" disabled={Boolean(template) && !savedSynced}>
                  {t(
                    'settings.templates.form.kindSynced',
                    'Synced block: inserted as a reference; when you change it here, every field that uses it shows the change'
                  )}
                </Radio.Item>
              </Radio.Group>
              {template ? (
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'settings.templates.form.kindLocked',
                    'A synced block cannot be turned into a template or pattern, or the other way round.'
                  )}
                </Typography>
              ) : null}
            </Flex>
          </Grid.Item>
          <Grid.Item col={12} direction="column" alignItems="stretch">
            <Field.Root
              name="description"
              error={errorText(t, visible.description)}
              hint={t('settings.templates.form.descriptionHint', 'Optional. Helps editors choose.')}
            >
              <Field.Label>{t('settings.templates.form.description', 'Description')}</Field.Label>
              <Textarea
                value={values.description}
                maxLength={TEMPLATE_LIMITS.description}
                onChange={(event) => set({ description: event.target.value })}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={12} direction="column" alignItems="stretch">
            <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
              <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 24rem">
                <Typography
                  variant="omega"
                  fontWeight="bold"
                  textColor="neutral800"
                  id="mex-template-enabled"
                >
                  {t('settings.templates.form.enabled', 'Offer in the editor')}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'settings.templates.form.enabledHint',
                    'When this is off, editors do not see the template. You can keep working on it.'
                  )}
                </Typography>
              </Flex>
              <Switch
                aria-labelledby="mex-template-enabled"
                checked={values.enabled}
                onCheckedChange={(checked) => set({ enabled: checked === true })}
                onLabel={t('settings.switch.on', 'On')}
                offLabel={t('settings.switch.off', 'Off')}
                visibleLabels
              />
            </Flex>
          </Grid.Item>
        </Grid.Root>
      </SectionCard>
      <SectionCard
        title={t('settings.templates.form.scope', 'Where it is offered')}
        subtitle={t(
          'settings.templates.form.scopeHint',
          'Editors see the template in these fields. Blocks a field does not allow are left out when they insert it.'
        )}
      >
        <Radio.Group
          aria-label={t('settings.templates.form.scope', 'Where it is offered')}
          value={values.scopeMode}
          onValueChange={(scopeMode) => set({ scopeMode })}
        >
          <Radio.Item value="all">
            {t('settings.templates.form.scopeAll', 'Every Magic Editor X field')}
          </Radio.Item>
          <Radio.Item value="limited">
            {t('settings.templates.form.scopeLimited', 'Only fields with these presets, and these fields')}
          </Radio.Item>
        </Radio.Group>
        {values.scopeMode === 'limited' ? (
          <Grid.Root gap={{ initial: 4, medium: 6 }}>
            <Grid.Item col={6} xs={12} s={12} direction="column" alignItems="stretch">
              <Field.Root name="presets" error={errorText(t, visible.scope)}>
                <Field.Label>{t('settings.templates.form.presets', 'Presets')}</Field.Label>
                <MultiSelect
                  value={values.presets}
                  onChange={(presets) => set({ presets })}
                  placeholder={t('settings.templates.form.presetsPlaceholder', 'Choose presets')}
                  withTags
                >
                  {PRESET_NAMES.map((name) => (
                    <MultiSelectOption key={name} value={name}>
                      {presetLabel(name)}
                    </MultiSelectOption>
                  ))}
                </MultiSelect>
                <Field.Error />
              </Field.Root>
            </Grid.Item>
            <Grid.Item col={6} xs={12} s={12} direction="column" alignItems="stretch">
              <Field.Root name="fields" error={errorText(t, visible.scope)}>
                <Field.Label>{t('settings.templates.form.fields', 'Fields')}</Field.Label>
                <MultiSelect
                  value={values.fields}
                  onChange={(fields) => set({ fields })}
                  placeholder={t('settings.templates.form.fieldsPlaceholder', 'Choose fields')}
                  disabled={targets.status === 'loading'}
                  withTags
                >
                  {fieldOptions.map((option) => (
                    <MultiSelectOption key={option.key} value={option.key}>
                      {option.label}
                    </MultiSelectOption>
                  ))}
                </MultiSelect>
                <Field.Error />
              </Field.Root>
              {targets.status === 'error' ? (
                <Flex gap={2} wrap="wrap" alignItems="center" paddingTop={2}>
                  <Typography variant="pi" textColor="danger600">
                    {t('settings.templates.form.fieldsError', 'The list of fields could not be loaded.')}
                  </Typography>
                  <Button variant="tertiary" size="S" onClick={onRetryTargets}>
                    {t('settings.retry', 'Try again')}
                  </Button>
                </Flex>
              ) : null}
            </Grid.Item>
          </Grid.Root>
        ) : null}
      </SectionCard>
      <SectionCard
        title={t('settings.templates.form.content', 'Content')}
        subtitle={t(
          'settings.templates.form.contentHint',
          'The blocks the template inserts. Use the preview in the editor toolbar to see the rendered output.'
        )}
      >
        <EditorFieldBody
          target={EDITOR_TARGET}
          name="mexTemplateContent"
          value={values.blocks}
          onChange={(_name, blocks) => set({ blocks })}
          attribute={EDITOR_ATTRIBUTE}
          label={t('settings.templates.form.contentLabel', 'Template content')}
          error={errorText(t, visible.blocks)}
          required
        />
      </SectionCard>
      <Form method="PUT" initialValues={savedKey}>
        <DraftSync values={draftKey} />
        <Blocker />
      </Form>
    </PageShell>
  );
};

export default TemplateEditor;

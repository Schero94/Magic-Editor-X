import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Field,
  Flex,
  Grid,
  Modal,
  MultiSelect,
  MultiSelectOption,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { useT } from '../../components/ui';
import { deriveName, emptyValues, fromDto, TUNES, validateBlock } from './blockForm.mjs';
import { blockErrorText, blockTypeLabel } from './messages';
import { FieldsEditor } from './FieldsEditor';
import { IconPreview, TemplatePreview } from './Preview';

/**
 * Section heading inside the modal (h3 under the modal title).
 * @param {{ title: string, subtitle?: string }} props - Text.
 * @returns {JSX.Element} Heading.
 */
const SubHeading = ({ title, subtitle }) => (
  <Flex direction="column" alignItems="flex-start" gap={1}>
    <Typography variant="delta" tag="h3" textColor="neutral800">
      {title}
    </Typography>
    {subtitle ? (
      <Typography variant="pi" textColor="neutral600">
        {subtitle}
      </Typography>
    ) : null}
  </Flex>
);

/**
 * Create / edit dialog for one custom block.
 * @param {object} props - Props.
 * @param {boolean} props.open - Open state.
 * @param {object|null} props.block - Block DTO when editing, null when creating.
 * @param {string[]} props.otherNames - Names of the other blocks.
 * @param {{ status: string, items: Array<object> }} props.contentTypes - Readable content types.
 * @param {() => void} props.onRetryContentTypes - Reloads content types.
 * @param {(values: object) => Promise<{ ok: boolean, errors?: object }>} props.onSubmit - Saves; resolves with server errors on 400.
 * @param {() => void} props.onClose - Closes (also used after success).
 * @returns {JSX.Element} Modal.
 */
export const BlockFormModal = ({
  open,
  block,
  otherNames,
  contentTypes,
  onRetryContentTypes,
  onSubmit,
  onClose,
}) => {
  const t = useT();
  // The parent remounts this component (key) every time it opens, so state starts fresh.
  const [values, setValues] = useState(() => (block ? fromDto(block) : emptyValues()));
  const [serverErrors, setServerErrors] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const originalName = block ? block.name : null;
  const errors = useMemo(
    () => validateBlock(values, { existingNames: otherNames, originalName }),
    [values, otherNames, originalName]
  );
  const visible = useMemo(
    () => ({ ...(showErrors ? errors : {}), ...serverErrors }),
    [errors, serverErrors, showErrors]
  );
  const err = (path) => blockErrorText(t, visible[path]);

  const set = (patch) => {
    setValues((current) => ({ ...current, ...patch }));
    setServerErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[key]);
      delete next._form;
      return next;
    });
  };

  const onLabel = (label) => {
    if (values.nameTouched) set({ label });
    else set({ label, name: deriveName(label) });
  };

  const selectedType = contentTypes.items.find((ct) => ct.uid === values.contentType);
  const attributeOptions = selectedType
    ? selectedType.attributes
    : Array.from(new Set(contentTypes.items.flatMap((ct) => ct.attributes)));

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

  const title = block
    ? t('settings.blocks.modal.editTitle', 'Edit block {label}', { label: block.label })
    : t('settings.blocks.modal.createTitle', 'Create a custom block');

  return (
    <Modal.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <Modal.Content>
        <Modal.Header closeLabel={t('settings.close', 'Close')}>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            {visible._form ? (
              <Alert
                variant="danger"
                closeLabel={t('settings.close', 'Close')}
                onClose={() => setServerErrors({})}
              >
                {visible._form.server}
              </Alert>
            ) : null}
            {showErrors && Object.keys(errors).length ? (
              <Typography variant="pi" textColor="danger600" role="status">
                {t('settings.blocks.modal.invalid', 'Some values need attention. They are marked below.')}
              </Typography>
            ) : null}

            <Flex direction="column" alignItems="stretch" gap={4}>
              <SubHeading title={t('settings.blocks.modal.basics', 'Basics')} />
              <Grid.Root gap={4}>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root
                    name="label"
                    error={err('label')}
                    hint={t('settings.blocks.form.labelHint', 'Shown in the editor toolbox.')}
                    required
                  >
                    <Field.Label>{t('settings.blocks.form.label', 'Label')}</Field.Label>
                    <TextInput value={values.label} onChange={(event) => onLabel(event.target.value)} />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root
                    name="name"
                    error={err('name')}
                    hint={
                      block
                        ? t(
                            'settings.blocks.form.nameHintEdit',
                            'Stored as the block type in content. Renaming hides existing blocks of the old name.'
                          )
                        : t(
                            'settings.blocks.form.nameHint',
                            'Identifier stored with the content. Filled from the label until you edit it.'
                          )
                    }
                    required
                  >
                    <Field.Label>{t('settings.blocks.form.name', 'Name')}</Field.Label>
                    <TextInput
                      value={values.name}
                      onChange={(event) => set({ name: event.target.value, nameTouched: true })}
                    />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root name="blockType" error={err('blockType')} required>
                    <Field.Label>{t('settings.blocks.form.type', 'Type')}</Field.Label>
                    <SingleSelect
                      value={values.blockType}
                      onChange={(value) => set({ blockType: String(value) })}
                    >
                      <SingleSelectOption value="simple">{blockTypeLabel(t, 'simple')}</SingleSelectOption>
                      <SingleSelectOption value="embedded-entry">
                        {blockTypeLabel(t, 'embedded-entry')}
                      </SingleSelectOption>
                    </SingleSelect>
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item
                  col={6}
                  xs={12}
                  s={12}
                  m={6}
                  direction="column"
                  alignItems="flex-start"
                  minWidth={0}
                >
                  <Flex gap={3} paddingTop={{ initial: 0, medium: 6 }} alignItems="center">
                    <Switch
                      checked={values.enabled}
                      onCheckedChange={(checked) => set({ enabled: checked === true })}
                      aria-label={t('settings.blocks.form.enabled', 'Show in the editor toolbox')}
                      onLabel={t('settings.switch.on', 'On')}
                      offLabel={t('settings.switch.off', 'Off')}
                    />
                    <Typography variant="omega" textColor="neutral800">
                      {t('settings.blocks.form.enabled', 'Show in the editor toolbox')}
                    </Typography>
                  </Flex>
                </Grid.Item>
                <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root name="description" error={err('description')}>
                    <Field.Label>{t('settings.blocks.form.description', 'Description')}</Field.Label>
                    <Textarea
                      value={values.description}
                      onChange={(event) => set({ description: event.target.value })}
                    />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root
                    name="icon"
                    error={err('icon')}
                    hint={t(
                      'settings.blocks.form.iconHint',
                      'Optional SVG markup. Scripts, styles and links are removed.'
                    )}
                  >
                    <Field.Label>{t('settings.blocks.form.icon', 'Icon (SVG)')}</Field.Label>
                    <Flex gap={3} alignItems="flex-start">
                      <Box flex="1 1 auto" minWidth={0}>
                        <Textarea
                          value={values.icon}
                          onChange={(event) => set({ icon: event.target.value })}
                        />
                      </Box>
                      <IconPreview
                        svg={values.icon}
                        label={t('settings.blocks.form.iconPreview', 'Icon preview')}
                      />
                    </Flex>
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
              </Grid.Root>
            </Flex>

            <Divider />

            {values.blockType === 'simple' ? (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <SubHeading
                  title={t('settings.blocks.modal.fields', 'Fields')}
                  subtitle={t(
                    'settings.blocks.modal.fieldsHint',
                    'Inputs editors fill in for each block. Use {example} in the template to show a value.',
                    {
                      example: '{{key}}',
                    }
                  )}
                />
                <FieldsEditor
                  fields={values.fields}
                  errors={visible}
                  onChange={(fields) => set({ fields })}
                />
                <Field.Root
                  name="template"
                  error={err('template')}
                  hint={t(
                    'settings.blocks.form.templateHint',
                    'Optional HTML layout for the block. Allowed: basic text, list, image and link tags.'
                  )}
                >
                  <Field.Label>{t('settings.blocks.form.template', 'HTML template')}</Field.Label>
                  <Textarea
                    value={values.template}
                    onChange={(event) => set({ template: event.target.value })}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                <TemplatePreview
                  template={values.template}
                  fields={values.fields}
                  label={t('settings.blocks.form.templatePreview', 'Preview')}
                  empty={t(
                    'settings.blocks.form.templateEmpty',
                    'No template. The editor shows the fields as a form.'
                  )}
                />
                <Field.Root name="placeholder" error={err('placeholder')}>
                  <Field.Label>{t('settings.blocks.form.placeholder', 'Placeholder')}</Field.Label>
                  <TextInput
                    value={values.placeholder}
                    onChange={(event) => set({ placeholder: event.target.value })}
                  />
                  <Field.Error />
                </Field.Root>
              </Flex>
            ) : (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <SubHeading
                  title={t('settings.blocks.modal.entry', 'Embedded entry')}
                  subtitle={t(
                    'settings.blocks.modal.entryHint',
                    'Editors pick an entry; only entries they can read in the Content Manager are listed.'
                  )}
                />
                {contentTypes.status === 'error' ? (
                  <Alert
                    variant="warning"
                    closeLabel={t('settings.close', 'Close')}
                    action={
                      <Button variant="tertiary" size="S" onClick={onRetryContentTypes}>
                        {t('settings.retry', 'Try again')}
                      </Button>
                    }
                  >
                    {t('settings.blocks.contentTypes.error', 'Content types could not be loaded.')}
                  </Alert>
                ) : null}
                <Grid.Root gap={4}>
                  <Grid.Item
                    col={6}
                    xs={12}
                    s={12}
                    m={6}
                    direction="column"
                    alignItems="stretch"
                    minWidth={0}
                  >
                    <Field.Root
                      name="contentType"
                      hint={t('settings.blocks.form.contentTypeHint', 'Leave empty to let editors choose.')}
                    >
                      <Field.Label>{t('settings.blocks.form.contentType', 'Content type')}</Field.Label>
                      <SingleSelect
                        value={values.contentType}
                        placeholder={t('settings.blocks.form.anyContentType', 'Any content type')}
                        onClear={() => set({ contentType: '' })}
                        clearLabel={t('settings.blocks.form.clearContentType', 'Clear content type')}
                        onChange={(value) => set({ contentType: String(value) })}
                      >
                        {contentTypes.items.map((ct) => (
                          <SingleSelectOption key={ct.uid} value={ct.uid}>
                            {ct.displayName}
                          </SingleSelectOption>
                        ))}
                      </SingleSelect>
                      <Field.Hint />
                    </Field.Root>
                  </Grid.Item>
                  <Grid.Item
                    col={6}
                    xs={12}
                    s={12}
                    m={6}
                    direction="column"
                    alignItems="stretch"
                    minWidth={0}
                  >
                    <Field.Root name="titleField" error={err('titleField')}>
                      <Field.Label>{t('settings.blocks.form.titleField', 'Title field')}</Field.Label>
                      <SingleSelect
                        value={values.titleField}
                        placeholder={t(
                          'settings.blocks.form.titleFieldPlaceholder',
                          'Detected automatically'
                        )}
                        onClear={() => set({ titleField: '' })}
                        clearLabel={t('settings.blocks.form.clearTitleField', 'Clear title field')}
                        onChange={(value) => set({ titleField: String(value) })}
                      >
                        {attributeOptions.map((name) => (
                          <SingleSelectOption key={name} value={name}>
                            {name}
                          </SingleSelectOption>
                        ))}
                      </SingleSelect>
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                  <Grid.Item
                    col={6}
                    xs={12}
                    s={12}
                    m={6}
                    direction="column"
                    alignItems="stretch"
                    minWidth={0}
                  >
                    <Field.Root
                      name="displayFields"
                      error={err('displayFields')}
                      hint={t('settings.blocks.form.displayFieldsHint', 'Stored with the block.')}
                    >
                      <Field.Label>{t('settings.blocks.form.displayFields', 'Stored fields')}</Field.Label>
                      <MultiSelect
                        value={values.displayFields}
                        withTags
                        onChange={(value) => set({ displayFields: value })}
                      >
                        {attributeOptions.map((name) => (
                          <MultiSelectOption key={name} value={name}>
                            {name}
                          </MultiSelectOption>
                        ))}
                      </MultiSelect>
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                  <Grid.Item
                    col={6}
                    xs={12}
                    s={12}
                    m={6}
                    direction="column"
                    alignItems="stretch"
                    minWidth={0}
                  >
                    <Field.Root
                      name="previewFields"
                      error={err('previewFields')}
                      hint={t('settings.blocks.form.previewFieldsHint', 'Shown in the editor card.')}
                    >
                      <Field.Label>{t('settings.blocks.form.previewFields', 'Preview fields')}</Field.Label>
                      <MultiSelect
                        value={values.previewFields}
                        withTags
                        onChange={(value) => set({ previewFields: value })}
                      >
                        {attributeOptions.map((name) => (
                          <MultiSelectOption key={name} value={name}>
                            {name}
                          </MultiSelectOption>
                        ))}
                      </MultiSelect>
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                </Grid.Root>
              </Flex>
            )}

            <Divider />

            <Flex direction="column" alignItems="stretch" gap={4}>
              <SubHeading title={t('settings.blocks.modal.advanced', 'Advanced')} />
              <Flex gap={3} alignItems="center">
                <Switch
                  checked={values.inlineToolbar}
                  onCheckedChange={(checked) => set({ inlineToolbar: checked === true })}
                  aria-label={t(
                    'settings.blocks.form.inlineToolbar',
                    'Allow text formatting (inline toolbar)'
                  )}
                  onLabel={t('settings.switch.on', 'On')}
                  offLabel={t('settings.switch.off', 'Off')}
                />
                <Typography variant="omega" textColor="neutral800">
                  {t('settings.blocks.form.inlineToolbar', 'Allow text formatting (inline toolbar)')}
                </Typography>
              </Flex>
              <Box tag="fieldset" margin={0} padding={0} borderWidth={0}>
                <Typography variant="pi" fontWeight="bold" textColor="neutral800" tag="legend">
                  {t('settings.blocks.form.tunes', 'Block settings')}
                </Typography>
                <Flex gap={4} wrap="wrap" paddingTop={2}>
                  {TUNES.map((tune) => (
                    <Checkbox
                      key={tune}
                      checked={values.tunes.includes(tune)}
                      onCheckedChange={(checked) =>
                        set({
                          tunes:
                            checked === true
                              ? [...values.tunes, tune]
                              : values.tunes.filter((item) => item !== tune),
                        })
                      }
                    >
                      {
                        {
                          alignmentTune: t('settings.blocks.tune.alignment', 'Alignment'),
                          textVariant: t('settings.blocks.tune.textVariant', 'Text variant'),
                          indentTune: t('settings.blocks.tune.indent', 'Indent'),
                        }[tune]
                      }
                    </Checkbox>
                  ))}
                </Flex>
              </Box>
              <Field.Root
                name="shortcut"
                error={err('shortcut')}
                hint={t('settings.blocks.form.shortcutHint', 'Optional, for example CMD+SHIFT+K.')}
              >
                <Field.Label>{t('settings.blocks.form.shortcut', 'Keyboard shortcut')}</Field.Label>
                <TextInput
                  value={values.shortcut}
                  onChange={(event) => set({ shortcut: event.target.value })}
                />
                <Field.Hint />
                <Field.Error />
              </Field.Root>
            </Flex>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary" disabled={saving}>
              {t('settings.cancel', 'Cancel')}
            </Button>
          </Modal.Close>
          <Button onClick={submit} loading={saving} disabled={saving}>
            {block
              ? t('settings.blocks.modal.save', 'Save block')
              : t('settings.blocks.modal.create', 'Create block')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default BlockFormModal;

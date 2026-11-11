import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Grid,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { ArrowDown, ArrowUp, Plus, Trash } from '@strapi/icons';
import { useT } from '../../components/ui';
import { emptyField } from './blockForm.mjs';
import { FIELD_TYPES, blockErrorText, fieldTypeLabel } from './messages';

/**
 * Editor for the input fields of a simple custom block.
 * @param {object} props - Props.
 * @param {Array<object>} props.fields - Field rows.
 * @param {(fields: Array<object>) => void} props.onChange - Replaces the rows.
 * @param {Record<string, string|object>} props.errors - Validation errors by path.
 * @returns {JSX.Element} Fields editor.
 */
export const FieldsEditor = ({ fields, onChange, errors }) => {
  const t = useT();
  const update = (index, patch) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = fields.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const err = (path) => blockErrorText(t, errors[path]);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {fields.length === 0 ? (
        <Typography variant="pi" textColor="neutral600">
          {t(
            'settings.blocks.fields.empty',
            'No fields yet. Without fields the block has one text area named content.'
          )}
        </Typography>
      ) : null}
      {fields.map((field, index) => {
        const name =
          field.label ||
          field.name ||
          t('settings.blocks.fields.unnamed', 'Field {number}', { number: index + 1 });
        return (
          <Box
            key={field.key}
            padding={4}
            hasRadius
            borderColor="neutral200"
            background="neutral100"
            minWidth={0}
          >
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
                <Typography variant="omega" fontWeight="bold" tag="h4" textColor="neutral800">
                  {t('settings.blocks.fields.heading', 'Field {number}', { number: index + 1 })}
                </Typography>
                <Flex gap={1}>
                  <IconButton
                    label={t('settings.blocks.fields.moveUp', 'Move field {name} up', { name })}
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={t('settings.blocks.fields.moveDown', 'Move field {name} down', { name })}
                    variant="ghost"
                    disabled={index === fields.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label={t('settings.blocks.fields.remove', 'Remove field {name}', { name })}
                    variant="ghost"
                    onClick={() => onChange(fields.filter((_, i) => i !== index))}
                  >
                    <Trash />
                  </IconButton>
                </Flex>
              </Flex>
              <Grid.Root gap={4}>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root name={`fields.${index}.label`} error={err(`fields.${index}.label`)} required>
                    <Field.Label>{t('settings.blocks.fields.label', 'Label')}</Field.Label>
                    <TextInput
                      value={field.label}
                      onChange={(event) => update(index, { label: event.target.value })}
                    />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root
                    name={`fields.${index}.name`}
                    error={err(`fields.${index}.name`)}
                    hint={t('settings.blocks.fields.nameHint', 'Stored data key and template placeholder.')}
                    required
                  >
                    <Field.Label>{t('settings.blocks.fields.name', 'Key')}</Field.Label>
                    <TextInput
                      value={field.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                    />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root name={`fields.${index}.type`}>
                    <Field.Label>{t('settings.blocks.fields.type', 'Type')}</Field.Label>
                    <SingleSelect
                      value={field.type}
                      onChange={(value) => update(index, { type: String(value), default: '' })}
                    >
                      {FIELD_TYPES.map((type) => (
                        <SingleSelectOption key={type} value={type}>
                          {fieldTypeLabel(t, type)}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
                  <Field.Root name={`fields.${index}.placeholder`} error={err(`fields.${index}.placeholder`)}>
                    <Field.Label>{t('settings.blocks.fields.placeholder', 'Placeholder')}</Field.Label>
                    <TextInput
                      value={field.placeholder}
                      disabled={['checkbox', 'image', 'select', 'color'].includes(field.type)}
                      onChange={(event) => update(index, { placeholder: event.target.value })}
                    />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                {field.type === 'select' ? (
                  <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
                    <Field.Root
                      name={`fields.${index}.options`}
                      error={err(`fields.${index}.options`)}
                      hint={t(
                        'settings.blocks.fields.optionsHint',
                        'One option per line. Use "value | label" when the label differs.'
                      )}
                      required
                    >
                      <Field.Label>{t('settings.blocks.fields.options', 'Options')}</Field.Label>
                      <Textarea
                        value={field.optionsText}
                        onChange={(event) => update(index, { optionsText: event.target.value })}
                      />
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                ) : null}
                {field.type !== 'image' && field.type !== 'checkbox' ? (
                  <Grid.Item
                    col={6}
                    xs={12}
                    s={12}
                    m={6}
                    direction="column"
                    alignItems="stretch"
                    minWidth={0}
                  >
                    <Field.Root name={`fields.${index}.default`} error={err(`fields.${index}.default`)}>
                      <Field.Label>{t('settings.blocks.fields.default', 'Default value')}</Field.Label>
                      <TextInput
                        value={String(field.default ?? '')}
                        onChange={(event) => update(index, { default: event.target.value })}
                      />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                ) : null}
                {field.type === 'checkbox' ? (
                  <Grid.Item
                    col={6}
                    xs={12}
                    s={12}
                    m={6}
                    direction="column"
                    alignItems="flex-start"
                    minWidth={0}
                  >
                    <Checkbox
                      checked={field.default === true || field.default === 'true'}
                      onCheckedChange={(checked) => update(index, { default: checked === true })}
                    >
                      {t('settings.blocks.fields.defaultChecked', 'Checked by default')}
                    </Checkbox>
                  </Grid.Item>
                ) : null}
                <Grid.Item
                  col={6}
                  xs={12}
                  s={12}
                  m={6}
                  direction="column"
                  alignItems="flex-start"
                  minWidth={0}
                >
                  <Checkbox
                    checked={field.required}
                    onCheckedChange={(checked) => update(index, { required: checked === true })}
                  >
                    {t('settings.blocks.fields.required', 'Required')}
                  </Checkbox>
                </Grid.Item>
              </Grid.Root>
            </Flex>
          </Box>
        );
      })}
      <Box>
        <Button
          variant="secondary"
          startIcon={<Plus />}
          disabled={fields.length >= 20}
          onClick={() => onChange([...fields, emptyField(fields.length)])}
        >
          {t('settings.blocks.fields.add', 'Add field')}
        </Button>
      </Box>
      {errors.fields ? (
        <Typography variant="pi" textColor="danger600">
          {blockErrorText(t, errors.fields)}
        </Typography>
      ) : null}
    </Flex>
  );
};

export default FieldsEditor;

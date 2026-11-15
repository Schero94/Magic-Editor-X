import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Field,
  Flex,
  Grid,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Textarea,
  Typography,
} from '@strapi/design-system';
import styled from 'styled-components';
import { checkComponentValues, defaultValues } from '../../../../shared/components.mjs';

/**
 * Form of a component block (2.5), rendered by the field through a portal
 * into the Editor.js block (`tools/component.js`), so it has the admin theme
 * and translations. One Design System input per supported attribute of the
 * current component schema, with the schema's rules (required, length,
 * min/max, pattern, options) checked as the editor types; the server checks
 * the same rules again on save.
 *
 * When the component is not available (deleted in the Content-Type Builder,
 * not allowed in this field, or with attributes component blocks do not
 * support), the stored values are kept and a read-only notice explains why.
 */

const Frame = styled(Box)`
  min-width: 0;
  border-inline-start: 4px solid ${({ theme }) => theme.colors.primary500};
`;

/** Messages of the rules (`checkComponentValues`). */
const RULES = {
  required: ['editor.component.rule.required', 'This value is required'],
  type: ['editor.component.rule.type', 'Enter a valid value'],
  min: ['editor.component.rule.min', 'Enter {min} or more'],
  max: ['editor.component.rule.max', 'Enter {max} or less'],
  minLength: ['editor.component.rule.minLength', 'Use at least {minLength} characters'],
  maxLength: ['editor.component.rule.maxLength', 'Use at most {maxLength} characters'],
  regex: ['editor.component.rule.regex', 'This value does not have the expected format'],
  enum: ['editor.component.rule.enum', 'Choose one of the options'],
  email: ['editor.component.rule.email', 'Enter a valid e-mail address'],
  date: ['editor.component.rule.date', 'Enter a valid date'],
  datetime: ['editor.component.rule.datetime', 'Enter a valid date and time'],
  time: ['editor.component.rule.time', 'Enter a valid time'],
};

/**
 * `datetime-local` input value (local time, minutes) of a stored ISO date-time.
 * @param {unknown} value - Stored value.
 * @returns {string} Input value.
 */
const toLocalInput = (value) => {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * Stored ISO date-time of a `datetime-local` input value ('' stays '').
 * @param {string} value - Input value.
 * @returns {string} ISO string or the input when it is not a date.
 */
const fromLocalInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

/**
 * One attribute input.
 * @param {object} props - Props.
 * @returns {JSX.Element} Input.
 */
const AttributeInput = ({ field, value, onChange, readOnly, t, inputName }) => {
  const common = { name: inputName, disabled: readOnly };
  if (field.type === 'boolean')
    return (
      <Switch
        {...common}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked === true)}
        onLabel={t('editor.component.on', 'On')}
        offLabel={t('editor.component.off', 'Off')}
        visibleLabels
      />
    );
  if (field.type === 'enumeration')
    return (
      <SingleSelect
        {...common}
        value={typeof value === 'string' ? value : ''}
        onChange={(next) => onChange(next === '' ? '' : String(next))}
        onClear={!field.required && !readOnly ? () => onChange('') : undefined}
        placeholder={t('editor.component.choose', 'Choose an option')}
      >
        {field.enum.map((option) => (
          <SingleSelectOption key={option} value={option}>
            {option}
          </SingleSelectOption>
        ))}
      </SingleSelect>
    );
  if (['integer', 'float', 'decimal'].includes(field.type))
    return (
      <NumberInput
        {...common}
        value={typeof value === 'number' ? value : undefined}
        step={field.type === 'integer' ? 1 : 0.01}
        onValueChange={(next) => onChange(next === undefined ? '' : next)}
      />
    );
  if (field.type === 'text' || field.type === 'richtext')
    return (
      <Textarea
        {...common}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  const types = { email: 'email', date: 'date', time: 'time', datetime: 'datetime-local' };
  const shown =
    field.type === 'datetime'
      ? toLocalInput(value)
      : field.type === 'time' && typeof value === 'string'
        ? value.slice(0, 5)
        : value === undefined || value === null
          ? ''
          : String(value);
  return (
    <TextInput
      {...common}
      type={types[field.type] || 'text'}
      inputMode={field.type === 'biginteger' ? 'numeric' : undefined}
      value={shown}
      onChange={(event) =>
        onChange(field.type === 'datetime' ? fromLocalInput(event.target.value) : event.target.value)
      }
    />
  );
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {string} props.blockId - Editor.js block id.
 * @param {string} props.uid - Component uid.
 * @param {object} props.values - Stored values.
 * @param {boolean} props.fresh - New block (fill in the defaults).
 * @param {boolean} props.readOnly - Read-only field or reviewer.
 * @param {import('../../../../shared/components.mjs').ComponentDescriptor|null} props.descriptor - Current component, null when it does not exist.
 * @param {boolean} props.allowed - The field lists the component.
 * @param {{ name: string, start: number|null, end: number|null }|null} props.focus - Input to focus after a re-render.
 * @param {(values: object) => void} props.onChange - Stores new values.
 * @param {(listener: (values: object) => void) => () => void} [props.subscribe] - Takes collaborators' values in place.
 * @returns {JSX.Element} View.
 */
export const ComponentBlockView = ({
  t,
  blockId,
  uid,
  values: initial,
  fresh,
  readOnly,
  descriptor,
  allowed,
  focus,
  onChange,
  subscribe,
}) => {
  const usable = Boolean(descriptor && descriptor.supported && allowed);
  const [values, setValues] = useState(() =>
    usable && fresh ? { ...defaultValues(descriptor), ...initial } : initial
  );
  const [touched, setTouched] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const rootRef = useRef(null);
  const prefix = `mex-component-${blockId || 'x'}`;

  // A new block stores its defaults once, so the saved value matches what the form shows.
  useEffect(() => {
    if (usable && fresh && !readOnly) onChange(values);
    // Only on mount: later changes are reported by `update`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report the defaults of a new block once
  }, []);

  // A collaborator's change of this block arrives here (the form keeps its DOM, focus and caret).
  useEffect(() => {
    if (typeof subscribe !== 'function') return undefined;
    return subscribe((next) => setValues(next));
  }, [subscribe]);

  // Keep the caret where it was when the block was rendered again (undo, a collaborator's change).
  useEffect(() => {
    if (!focus || !rootRef.current) return;
    const input = rootRef.current.querySelector(`[name="${CSS.escape(focus.name)}"]`);
    if (!input) return;
    input.focus();
    if (typeof input.setSelectionRange === 'function' && focus.start !== null) {
      try {
        input.setSelectionRange(focus.start, focus.end === null ? focus.start : focus.end);
      } catch {
        // Inputs such as date or number have no text selection.
      }
    }
  }, [focus]);

  const errors = useMemo(() => {
    if (!usable) return {};
    const out = {};
    for (const error of checkComponentValues(descriptor, values).errors)
      if (!out[error.field]) out[error.field] = error.rule;
    return out;
  }, [usable, descriptor, values]);

  const name = descriptor ? descriptor.displayName : uid || t('editor.component.unknown', 'Component');

  if (!usable) {
    const reason = !descriptor
      ? t(
          'editor.component.missing',
          'The component "{uid}" no longer exists. Its content is kept but not shown on the site.',
          { uid: uid || '?' }
        )
      : !allowed
        ? t(
            'editor.component.notAllowed',
            'The component "{name}" is not allowed in this field. Remove the block, or ask an administrator to allow it in the field settings.',
            { name }
          )
        : t(
            'editor.component.unsupported',
            'The component "{name}" has fields that component blocks do not support. Its content is kept but cannot be edited here.',
            { name }
          );
    return (
      <Frame
        padding={3}
        hasRadius
        background="neutral100"
        role="group"
        aria-label={t('editor.component.label', 'Component: {name}', { name })}
        data-testid="mex-component-notice"
      >
        <Flex direction="column" alignItems="stretch" gap={2}>
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Badge>{t('editor.component.badge', 'Component')}</Badge>
            <Typography variant="omega" fontWeight="bold" style={{ overflowWrap: 'anywhere' }}>
              {name}
            </Typography>
          </Flex>
          <Typography variant="pi" textColor="neutral600">
            {reason}
          </Typography>
        </Flex>
      </Frame>
    );
  }

  const update = (field, next) => {
    const nextValues = { ...values };
    if (next === '' || next === undefined) delete nextValues[field];
    else nextValues[field] = next;
    setValues(nextValues);
    onChange(nextValues);
  };

  const errorOf = (field) => {
    const rule = errors[field.name];
    if (!rule || (!showAll && !touched.has(field.name))) return undefined;
    const [id, fallback] = RULES[rule] || RULES.type;
    return t(id, fallback, {
      min: field.min,
      max: field.max,
      minLength: field.minLength,
      maxLength: field.maxLength,
    });
  };

  const hintOf = (field) => {
    if (field.maxLength !== undefined && typeof values[field.name] === 'string')
      return t('editor.component.length', '{count} / {max} characters', {
        count: values[field.name].length,
        max: field.maxLength,
      });
    if (field.min !== undefined && field.max !== undefined)
      return t('editor.component.range', 'From {min} to {max}', { min: field.min, max: field.max });
    return undefined;
  };

  return (
    <Frame
      ref={rootRef}
      padding={3}
      hasRadius
      background="neutral100"
      role="group"
      aria-label={t('editor.component.label', 'Component: {name}', { name })}
      data-testid="mex-component-form"
      onBlur={(event) => {
        // Leaving the whole block shows every open problem (for example required values not filled in yet).
        if (!event.currentTarget.contains(event.relatedTarget)) setShowAll(true);
      }}
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex gap={2} alignItems="center" wrap="wrap">
          <Badge>{t('editor.component.badge', 'Component')}</Badge>
          <Typography variant="omega" fontWeight="bold" style={{ overflowWrap: 'anywhere' }}>
            {name}
          </Typography>
        </Flex>
        <Grid.Root gap={3}>
          {descriptor.fields.map((field) => {
            const wide = ['text', 'richtext'].includes(field.type);
            const inputName = `${prefix}-${field.name}`;
            return (
              <Grid.Item
                key={field.name}
                col={wide ? 12 : 6}
                xs={12}
                s={12}
                m={12}
                direction="column"
                alignItems="stretch"
              >
                <Field.Root
                  name={inputName}
                  id={inputName}
                  required={field.required}
                  error={errorOf(field)}
                  hint={hintOf(field)}
                  onBlur={() =>
                    setTouched((current) =>
                      current.has(field.name) ? current : new Set(current).add(field.name)
                    )
                  }
                >
                  <Field.Label>{field.name}</Field.Label>
                  <AttributeInput
                    field={field}
                    value={values[field.name]}
                    onChange={(next) => update(field.name, next)}
                    readOnly={readOnly}
                    t={t}
                    inputName={inputName}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
            );
          })}
        </Grid.Root>
      </Flex>
    </Frame>
  );
};

export default ComponentBlockView;

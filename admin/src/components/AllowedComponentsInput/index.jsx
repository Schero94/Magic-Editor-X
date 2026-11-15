import { useEffect, useMemo, useState } from 'react';
import { Box, Field, Flex, MultiSelect, MultiSelectOption, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { useT } from '../ui/useT';
import { describeComponent, parseComponentList } from '../../../../shared/components.mjs';

/**
 * Content-Type Builder option "Component blocks" of a Magic Editor X field
 * (2.5, `options.allowedComponents`, stored as a comma-separated list of
 * uids). Registered as a CTB form input in the plugin's admin `bootstrap`
 * (`apis.forms.components.add`). Lists the app's components (Content-Type
 * Builder `GET /content-type-builder/components`, which every CTB user may
 * read); components with attributes that component blocks do not support
 * cannot be selected and are listed with the reason.
 */

/** Reasons why a component cannot be used (`describeComponent` `unsupported[].reason`). */
const REASONS = {
  type: ['field.options.allowedComponents.reason.type', '{name} ({type})'],
  private: ['field.options.allowedComponents.reason.private', '{name} (private)'],
  name: ['field.options.allowedComponents.reason.name', '{name} (name)'],
  enum: ['field.options.allowedComponents.reason.enum', '{name} (no options)'],
  tooMany: ['field.options.allowedComponents.reason.tooMany', 'more than 50 fields'],
};

/**
 * @param {object} props - Props of a CTB custom input (GenericInput).
 * @param {string} props.name - `options.allowedComponents`.
 * @param {unknown} props.value - Stored option value.
 * @param {(event: { target: { name: string, value: string } }) => void} props.onChange - CTB form change.
 * @param {{ id: string, defaultMessage: string }} props.intlLabel - Label.
 * @param {{ id: string, defaultMessage: string }} [props.description] - Description.
 * @param {string} [props.error] - Error.
 * @returns {JSX.Element} Input.
 */
export const AllowedComponentsInput = ({ name, value, onChange, intlLabel, description, error }) => {
  const { formatMessage } = useIntl();
  const t = useT();
  const { get } = useFetchClient();
  const [state, setState] = useState({ status: 'loading', components: [] });

  useEffect(() => {
    let active = true;
    get('/content-type-builder/components')
      .then(({ data }) => {
        const list = data && Array.isArray(data.data) ? data.data : [];
        const components = list
          .map((item) =>
            describeComponent(item.uid, {
              info: {
                displayName: item.schema && item.schema.displayName,
                icon: item.schema && item.schema.icon,
              },
              attributes: item.schema && item.schema.attributes,
              category: item.category,
            })
          )
          .filter(Boolean)
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (active) setState({ status: 'ready', components });
      })
      .catch(() => {
        if (active) setState({ status: 'error', components: [] });
      });
    return () => {
      active = false;
    };
  }, [get]);

  const selected = useMemo(() => parseComponentList(value), [value]);
  const supported = state.components.filter((component) => component.supported);
  const unsupported = state.components.filter((component) => !component.supported);
  const known = new Set(state.components.map((component) => component.uid));
  // A listed uid that is unknown here (deleted component) stays selectable so it can be removed.
  const options = [
    ...supported.map((component) => ({
      value: component.uid,
      label: `${component.displayName} (${component.uid})`,
    })),
    ...selected.filter((uid) => !known.has(uid)).map((uid) => ({ value: uid, label: uid })),
  ];
  const label = formatMessage(intlLabel);
  const hint = description ? formatMessage(description) : undefined;

  return (
    <Field.Root name={name} id={name} hint={hint} error={error || undefined}>
      <Field.Label>{label}</Field.Label>
      <MultiSelect
        value={selected}
        onChange={(next) => onChange({ target: { name, value: (next || []).join(',') } })}
        onClear={() => onChange({ target: { name, value: '' } })}
        placeholder={t('field.options.allowedComponents.placeholder', 'No component blocks')}
        withTags
        disabled={state.status === 'loading'}
        data-testid="mex-allowed-components"
      >
        {options.map((option) => (
          <MultiSelectOption key={option.value} value={option.value}>
            {option.label}
          </MultiSelectOption>
        ))}
      </MultiSelect>
      <Field.Hint />
      <Field.Error />
      {state.status === 'error' ? (
        <Typography variant="pi" textColor="danger600">
          {t('field.options.allowedComponents.loadError', 'The components could not be loaded.')}
        </Typography>
      ) : null}
      {state.status === 'ready' && !state.components.length ? (
        <Typography variant="pi" textColor="neutral600">
          {t(
            'field.options.allowedComponents.empty',
            'This app has no components yet. Create one in the Content-Type Builder first.'
          )}
        </Typography>
      ) : null}
      {unsupported.length ? (
        <Box paddingTop={2} data-testid="mex-allowed-components-unsupported">
          <Typography variant="pi" fontWeight="bold" textColor="neutral600" tag="p">
            {t(
              'field.options.allowedComponents.unsupported',
              'Cannot be used as blocks (only text, number, date, choice and on/off fields are supported):'
            )}
          </Typography>
          <Flex tag="ul" direction="column" alignItems="stretch" gap={1} paddingTop={1}>
            {unsupported.map((component) => (
              <Typography key={component.uid} tag="li" variant="pi" textColor="neutral600">
                {`${component.displayName}: `}
                {component.unsupported
                  .map((item) => {
                    const [id, fallback] = REASONS[item.reason] || REASONS.type;
                    return t(id, fallback, { name: item.name, type: item.type });
                  })
                  .join(', ')}
              </Typography>
            ))}
          </Flex>
        </Box>
      ) : null}
    </Field.Root>
  );
};

export default AllowedComponentsInput;

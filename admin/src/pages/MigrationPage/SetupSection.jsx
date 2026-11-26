import {
  Button,
  Field,
  Flex,
  Grid,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Eye } from '@strapi/icons';
import { SectionCard } from '../../components/ui';
import { SwitchRow } from '../ConfigurationPage/formParts';
import { ALL_LOCALES } from './migrationFlow.mjs';

/**
 * Label of a source field: name and kind.
 * @param {Function} t - Translate.
 * @param {{ name: string, type: string }} source - Source field.
 * @returns {string} Label.
 */
const sourceLabel = (t, source) => {
  if (source.type === 'blocks')
    return t('settings.migration.source.blocks', '{name} (Strapi Blocks)', { name: source.name });
  if (source.type === 'richtext')
    return t('settings.migration.source.richtext', '{name} (Markdown rich text)', { name: source.name });
  return t('settings.migration.source.text', '{name} (text or HTML)', { name: source.name });
};

/**
 * Step 1: content type, source field, target field, locales and the overwrite switch.
 * @param {{ t: Function, wizard: object, disabled: boolean }} props - Translate, wizard state, disabled while a run is active.
 * @returns {JSX.Element} Section.
 */
export const SetupSection = ({ t, wizard, disabled }) => {
  const { load, selection, select, type } = wizard;
  const sameField = Boolean(selection.from && selection.from === selection.to);
  return (
    <SectionCard
      title={t('settings.migration.setup.title', '1. Choose the fields')}
      subtitle={t(
        'settings.migration.setup.subtitle',
        'Pick where the content comes from and the Magic Editor X field it goes to. The source field is never changed.'
      )}
    >
      <Grid.Root gap={{ initial: 4, medium: 6 }}>
        <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
          <Field.Root name="uid">
            <Field.Label>{t('settings.migration.field.type', 'Content type')}</Field.Label>
            <SingleSelect
              value={selection.uid || undefined}
              placeholder={t('settings.migration.field.typePlaceholder', 'Choose a content type')}
              onChange={(value) => select({ uid: String(value) })}
              disabled={disabled}
            >
              {load.types.map((entry) => (
                <SingleSelectOption key={entry.uid} value={entry.uid}>
                  {entry.displayName}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Grid.Item>
        {type && type.localized ? (
          <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
            <Field.Root
              name="locale"
              hint={t('settings.migration.field.localeHint', 'Each locale is migrated on its own.')}
            >
              <Field.Label>{t('settings.migration.field.locale', 'Locales')}</Field.Label>
              <SingleSelect
                value={selection.locale}
                onChange={(value) => select({ locale: String(value) })}
                disabled={disabled}
              >
                <SingleSelectOption value={ALL_LOCALES}>
                  {t('settings.migration.field.allLocales', 'All locales')}
                </SingleSelectOption>
                {load.locales.map((locale) => (
                  <SingleSelectOption key={locale.code} value={locale.code}>
                    {locale.isDefault
                      ? t('settings.migration.field.defaultLocale', '{name} (default)', { name: locale.name })
                      : locale.name}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Hint />
            </Field.Root>
          </Grid.Item>
        ) : null}
        <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
          <Field.Root name="from">
            <Field.Label>{t('settings.migration.field.from', 'Source field')}</Field.Label>
            <SingleSelect
              value={selection.from || undefined}
              placeholder={t('settings.migration.field.fromPlaceholder', 'Choose the field to copy from')}
              onChange={(value) => select({ from: String(value) })}
              disabled={disabled || !type}
            >
              {(type ? type.sources : []).map((source) => (
                <SingleSelectOption key={source.name} value={source.name}>
                  {sourceLabel(t, source)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
          <Field.Root
            name="to"
            error={
              sameField
                ? t('settings.migration.field.same', 'Choose a target that differs from the source.')
                : undefined
            }
          >
            <Field.Label>{t('settings.migration.field.to', 'Magic Editor X field')}</Field.Label>
            <SingleSelect
              value={selection.to || undefined}
              placeholder={t('settings.migration.field.toPlaceholder', 'Choose the field to fill')}
              onChange={(value) => select({ to: String(value) })}
              disabled={disabled || !type}
            >
              {(type ? type.targets : []).map((target) => (
                <SingleSelectOption key={target.name} value={target.name}>
                  {t('settings.migration.target', '{name} (preset {preset})', {
                    name: target.name,
                    preset: target.preset,
                  })}
                </SingleSelectOption>
              ))}
            </SingleSelect>
            <Field.Error />
          </Field.Root>
        </Grid.Item>
      </Grid.Root>
      <SwitchRow
        id="mex-migration-overwrite"
        t={t}
        label={t('settings.migration.overwrite.label', 'Replace content that is already in the target field')}
        hint={t(
          'settings.migration.overwrite.hint',
          'Off: entries whose target field has content are skipped. On: their current content is saved as the version "Before migration" first.'
        )}
        checked={selection.overwrite}
        disabled={disabled}
        onChange={(checked) => select({ overwrite: checked })}
      />
      <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
        <Typography variant="pi" textColor="neutral600">
          {!type
            ? null
            : type.draftAndPublish
              ? t(
                  'settings.migration.drafts',
                  'Only drafts are changed. Published entries keep their published version until you publish them again.'
                )
              : t(
                  'settings.migration.noDrafts',
                  'Entries are changed directly; this type has no draft and publish.'
                )}
        </Typography>
        <Button
          startIcon={<Eye />}
          onClick={wizard.runPreview}
          loading={wizard.preview.status === 'loading'}
          disabled={disabled || !wizard.ready}
        >
          {t('settings.migration.preview.button', 'Preview')}
        </Button>
      </Flex>
    </SectionCard>
  );
};

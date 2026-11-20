import { useRef, useState } from 'react';
import { Alert, Button } from '@strapi/design-system';
import { Blocker, Form, Page, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Check } from '@strapi/icons';
import { PERMISSIONS } from '../../permissions';
import { ConfirmAction, DraftSync, PageShell, useT } from '../../components/ui';
import { useConfigurationForm } from './useConfigurationForm';
import { AiSection } from './AiSection';
import { EnvironmentSection } from './EnvironmentSection';
import { CspSection } from './CspSection';
import { PaletteSection } from './PaletteSection';
import { LanguageToolSection } from './LanguageToolSection';
import { LinkScheduleSection } from './LinkScheduleSection';
import { CoreBlocksSection } from './CoreBlocksSection';
import { PAGE_HEADING, firstInvalidField } from '../focusTargets.mjs';
import { activeElement, useFocusRestore } from '../useFocusRestore';

const RBAC = [...PERMISSIONS.settingsRead, ...PERMISSIONS.settingsUpdate];

/**
 * Error messages for provider test codes (server/src/controllers/ai.js).
 * @param {Function} t - Translate.
 * @param {string|null} code - Error code.
 * @returns {string} Message.
 */
const testErrorText = (t, code) => {
  switch (code) {
    case 'NOT_CONFIGURED':
      return t('settings.test.notConfigured', 'Connection failed: the provider is not configured.');
    case 'NO_API_KEY':
      return t('settings.test.noKey', 'Connection failed: no API key is available.');
    case 'AUTH_FAILED':
      return t('settings.test.auth', 'Connection failed: the provider rejected the API key.');
    case 'PROVIDER_RATE_LIMIT':
      return t('settings.test.rateLimit', 'Connection failed: the provider is busy or rate limited.');
    case 'TIMEOUT':
      return t('settings.test.timeout', 'Connection failed: the provider did not answer in time.');
    case 'REFUSED':
      return t('settings.test.refused', 'The provider answered but declined the test request.');
    default:
      return t('settings.test.failed', 'Connection failed. Check the provider, base URL, model and key.');
  }
};

/**
 * Error messages for LanguageTool test codes (server/src/controllers/grammar.js).
 * @param {Function} t - Translate.
 * @param {string|null} code - Error code.
 * @returns {string} Message.
 */
const languageToolErrorText = (t, code) => {
  switch (code) {
    case 'AUTH_FAILED':
      return t(
        'settings.languageTool.test.auth',
        'Connection failed: LanguageTool rejected the user name or key.'
      );
    case 'PROVIDER_RATE_LIMIT':
      return t(
        'settings.languageTool.test.rateLimit',
        'Connection failed: LanguageTool is busy or rate limited.'
      );
    case 'TIMEOUT':
      return t(
        'settings.languageTool.test.timeout',
        'Connection failed: LanguageTool did not answer in time.'
      );
    default:
      return t(
        'settings.languageTool.test.failed',
        'Connection failed. Check the base URL and, for hosted accounts, the user name and key.'
      );
  }
};

/**
 * Settings -> Magic Editor X -> Configuration.
 * @returns {JSX.Element} Page.
 */
const ConfigurationPage = () => {
  const t = useT();
  const { toggleNotification } = useNotification();
  const { allowedActions, isLoading: rbacLoading } = useRBAC(RBAC);
  const form = useConfigurationForm({ enabled: !rbacLoading && Boolean(allowedActions.canRead) });
  const title = t('settings.configuration.title', 'Configuration');
  // Latest link schedule status reported by the "Run now" section, so the read-only environment row
  // shows the same last run instead of the one from page load.
  const [liveSchedule, setLiveSchedule] = useState(null);
  // 2.7.8: Save, Discard, the connection tests and "Try again" disable or replace the control that
  // had focus; focus goes back to it, or to the page title, never to <body>.
  const requestFocus = useFocusRestore();
  const saveRef = useRef(null);
  const retry = async () => {
    await form.reload();
    requestFocus([PAGE_HEADING]);
  };

  if (rbacLoading || (allowedActions.canRead && form.status === 'loading')) {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.Loading />
      </>
    );
  }
  if (!allowedActions.canRead) {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.NoPermissions />
      </>
    );
  }
  if (form.status === 'error') {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.Error
          content={t(
            'settings.configuration.loadError',
            'The settings could not be loaded. Nothing can be saved until they load.'
          )}
          action={
            <Button variant="secondary" onClick={retry}>
              {t('settings.retry', 'Try again')}
            </Button>
          }
        />
      </>
    );
  }

  const readOnly = !allowedActions.canUpdate;

  const onSave = async () => {
    const result = await form.save();
    // Saved: the Save button is disabled again (nothing to save), so the page title takes focus.
    // Invalid: the first highlighted field. Failed: Save is enabled again and keeps it.
    if (result.invalid) requestFocus([firstInvalidField, saveRef], { force: true });
    else requestFocus([saveRef, PAGE_HEADING]);
    if (result.ok) {
      toggleNotification({
        type: 'success',
        message: result.adjusted.length
          ? t('settings.save.adjusted', 'Settings saved. The server adjusted: {fields}.', {
              fields: result.adjusted.join(', '),
            })
          : t('settings.save.success', 'Settings saved.'),
      });
    } else if (result.invalid) {
      toggleNotification({
        type: 'warning',
        message: t('settings.save.invalid', 'Some values need attention before saving.'),
      });
    } else {
      toggleNotification({
        type: 'danger',
        message: t(
          'settings.save.error',
          'The settings could not be saved. Your changes are still in the form.'
        ),
      });
    }
  };

  const onTest = async () => {
    const opener = activeElement();
    const result = await form.test();
    if (result.invalid) requestFocus([firstInvalidField, opener], { force: true });
    else requestFocus([opener, PAGE_HEADING]);
    if (result.ok) {
      toggleNotification({
        type: 'success',
        message: t('settings.test.success', 'Connection works. The provider answered.'),
      });
    } else if (result.invalid) {
      toggleNotification({
        type: 'warning',
        message: t('settings.test.invalid', 'Fix the highlighted fields before testing.'),
      });
    } else {
      toggleNotification({ type: 'danger', message: testErrorText(t, result.code) });
    }
  };

  const onTestLanguageTool = async () => {
    const opener = activeElement();
    const result = await form.testLanguageTool();
    if (result.invalid) requestFocus([firstInvalidField, opener], { force: true });
    else requestFocus([opener, PAGE_HEADING]);
    if (result.ok) {
      toggleNotification({
        type: 'success',
        message: t('settings.languageTool.test.success', 'Connection works. LanguageTool answered.'),
      });
    } else if (result.invalid) {
      toggleNotification({
        type: 'warning',
        message: t('settings.test.invalid', 'Fix the highlighted fields before testing.'),
      });
    } else {
      toggleNotification({ type: 'danger', message: languageToolErrorText(t, result.code) });
    }
  };

  return (
    <PageShell
      title={title}
      subtitle={
        readOnly
          ? t(
              'settings.configuration.readOnly',
              'You can view these settings. Changing them needs the "Update settings" permission.'
            )
          : t(
              'settings.configuration.subtitle',
              'Choose an AI provider for the editor assistant and review the server options.'
            )
      }
      primaryAction={
        readOnly ? null : (
          <Button
            ref={saveRef}
            startIcon={<Check />}
            onClick={onSave}
            loading={form.saving}
            disabled={form.saving || !form.dirty}
          >
            {t('settings.save', 'Save')}
          </Button>
        )
      }
      secondaryAction={
        readOnly ? null : (
          <ConfirmAction
            disabled={!form.dirty || form.saving}
            trigger={
              <Button variant="tertiary" disabled={!form.dirty || form.saving}>
                {t('settings.discard', 'Discard changes')}
              </Button>
            }
            title={t('settings.discard.title', 'Discard your changes?')}
            body={t(
              'settings.discard.body',
              'The form goes back to the stored settings. Your unsaved changes are lost.'
            )}
            confirmLabel={t('settings.discard.confirm', 'Discard changes')}
            variant="danger-light"
            onConfirm={() => {
              form.discard();
              // Discard leaves nothing to save or discard: both buttons are disabled again.
              requestFocus([PAGE_HEADING]);
            }}
          />
        )
      }
    >
      {form.errors._form ? (
        <Alert
          variant="danger"
          closeLabel={t('settings.close', 'Close')}
          onClose={form.clearServerErrors}
          title={t('settings.save.rejected', 'The server rejected the settings')}
        >
          {typeof form.errors._form === 'object' ? form.errors._form.server : form.errors._form}
        </Alert>
      ) : null}
      <AiSection form={form} readOnly={readOnly} onTest={onTest} />
      <LanguageToolSection form={form} readOnly={readOnly} onTest={onTestLanguageTool} />
      <CoreBlocksSection form={form} readOnly={readOnly} />
      <EnvironmentSection
        environment={
          liveSchedule && form.dto.environment
            ? {
                ...form.dto.environment,
                linkSchedule: { ...form.dto.environment.linkSchedule, ...liveSchedule },
              }
            : form.dto.environment
        }
      />
      <LinkScheduleSection
        initial={(form.dto.environment && form.dto.environment.linkSchedule) || null}
        canRun={!readOnly}
        onStatus={setLiveSchedule}
      />
      <CspSection csp={form.dto.environment && form.dto.environment.csp} />
      <PaletteSection palette={form.dto.environment && form.dto.environment.palette} />
      <Form method="PUT" initialValues={form.saved}>
        <DraftSync values={form.draft} />
        <Blocker />
      </Form>
    </PageShell>
  );
};

export { ConfigurationPage };
export default ConfigurationPage;

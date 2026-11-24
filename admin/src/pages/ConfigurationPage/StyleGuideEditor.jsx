import { Field, Flex, Textarea, Typography } from '@strapi/design-system';
import { useT } from '../../components/ui';
import { MAX_STYLE_GUIDE_CHARS } from './configForm.mjs';
import { SwitchRow, errorText } from './formParts';

/**
 * Style guide (2.9) on the Configuration page: a Textarea sent as context with
 * the "Check the style guide" review and, when the switch is on, with every AI
 * text action. Part of the page draft; the page's Save stores it.
 * @param {object} props - Props.
 * @param {object} props.form - useConfigurationForm() result.
 * @param {boolean} props.readOnly - No settings.update.
 * @param {string} props.providerName - Provider name for the disclosure.
 * @returns {JSX.Element} Editor.
 */
export const StyleGuideEditor = ({ form, readOnly, providerName }) => {
  const t = useT();
  const { draft, errors, setField, touch } = form;
  const text = draft.styleGuide || '';
  return (
    <Flex direction="column" alignItems="stretch" gap={4} data-testid="mex-ai-style-guide">
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Typography variant="delta" tag="h3">
          {t('settings.ai.styleGuide.title', 'Style guide')}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {t(
            'settings.ai.styleGuide.subtitle',
            'Your rules for wording, spelling and tone. Editors can check text against them with "Check the style guide", which adds suggestions.'
          )}
        </Typography>
      </Flex>
      <Field.Root
        name="styleGuide"
        onBlur={() => touch('styleGuide')}
        error={errorText(t, errors.styleGuide, 'styleGuide')}
        hint={t(
          'settings.ai.styleGuide.hint',
          'For example: "Address readers formally. Write numbers up to twelve as words." {count} of {max} characters. Empty turns the style guide review off.',
          { count: text.length, max: MAX_STYLE_GUIDE_CHARS }
        )}
      >
        <Field.Label>{t('settings.ai.styleGuide.label', 'Style guide text')}</Field.Label>
        <Textarea
          value={text}
          disabled={readOnly}
          maxLength={MAX_STYLE_GUIDE_CHARS}
          onChange={(event) => setField('styleGuide', event.target.value)}
        />
        <Field.Hint />
        <Field.Error />
      </Field.Root>
      {typeof draft.styleGuideForAll === 'boolean' ? (
        <SwitchRow
          id="mex-ai-style-guide-all"
          t={t}
          label={t('settings.ai.styleGuide.all.label', 'Send the style guide with every AI action')}
          hint={t(
            'settings.ai.styleGuide.all.hint',
            'The style guide then goes to {provider} with every text an editor sends, not only with the style guide review. Off by default.',
            { provider: providerName }
          )}
          checked={draft.styleGuideForAll}
          disabled={readOnly || !text.trim()}
          onChange={(checked) => setField('styleGuideForAll', checked)}
        />
      ) : null}
    </Flex>
  );
};

export default StyleGuideEditor;

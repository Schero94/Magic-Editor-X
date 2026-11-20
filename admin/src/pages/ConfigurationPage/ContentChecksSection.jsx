import {
  Accordion,
  Box,
  Checkbox,
  Field,
  Flex,
  Grid,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { useT, SectionCard } from '../../components/ui';
import { SwitchRow } from './AiSection';
import {
  BLOCKABLE_SETTINGS,
  CONTENT_CHECK_LIMITS,
  CONTENT_CHECK_NUMBERS,
  INSIGHT_SETTINGS,
  toggleContentCheck,
} from './contentChecksForm.mjs';

/**
 * Label and explanation of each rule setting (one row per setting).
 * @param {Function} t - Translate.
 * @returns {Record<string, { label: string, hint: string }>} Texts.
 */
const ruleTexts = (t) => ({
  'reading-ease': {
    label: t('settings.contentChecks.rule.readingEase', 'Reading score'),
    hint: t(
      'settings.contentChecks.rule.readingEase.hint',
      'Flesch (English), Amstad (German) and Szigriszt-Pazos (Spanish). Other languages get no score.'
    ),
  },
  'sentence-long': {
    label: t('settings.contentChecks.rule.sentenceLong', 'Long sentences'),
    hint: t(
      'settings.contentChecks.rule.sentenceLong.hint',
      'When more than a quarter of the sentences are longer than the limit.'
    ),
  },
  'paragraph-long': {
    label: t('settings.contentChecks.rule.paragraphLong', 'Long paragraphs'),
    hint: t('settings.contentChecks.rule.paragraphLong.hint', 'Paragraphs longer than the limit.'),
  },
  'passive-voice': {
    label: t('settings.contentChecks.rule.passive', 'Passive voice'),
    hint: t(
      'settings.contentChecks.rule.passive.hint',
      'English and German only. A heuristic, so it is shown as a hint and cannot block publishing.'
    ),
  },
  'complex-words': {
    label: t('settings.contentChecks.rule.complexWords', 'Complex words'),
    hint: t(
      'settings.contentChecks.rule.complexWords.hint',
      'Paragraphs with many long words (English, German, Spanish).'
    ),
  },
  'repeated-starts': {
    label: t('settings.contentChecks.rule.repeatedStarts', 'Repeated sentence starts'),
    hint: t(
      'settings.contentChecks.rule.repeatedStarts.hint',
      'Three or more sentences in a row that start with the same word.'
    ),
  },
  'extra-spaces': {
    label: t('settings.contentChecks.rule.extraSpaces', 'Spacing'),
    hint: t(
      'settings.contentChecks.rule.extraSpaces.hint',
      'Repeated spaces and a space before punctuation. Editors can fix them with one click.'
    ),
  },
  h1: {
    label: t('settings.contentChecks.rule.h1', 'Page heading (H1)'),
    hint: t('settings.contentChecks.rule.h1.hint', 'Checked as chosen under "Page heading" above.'),
  },
  'section-long': {
    label: t('settings.contentChecks.rule.sectionLong', 'Long sections without a subheading'),
    hint: t(
      'settings.contentChecks.rule.sectionLong.hint',
      'Text longer than the section limit without a heading in between.'
    ),
  },
  'internal-links': {
    label: t('settings.contentChecks.rule.internalLinks', 'Internal links'),
    hint: t(
      'settings.contentChecks.rule.internalLinks.hint',
      'Links to entries and relative links, fewer than the minimum.'
    ),
  },
  'content-short': {
    label: t('settings.contentChecks.rule.contentShort', 'Content length'),
    hint: t('settings.contentChecks.rule.contentShort.hint', 'Fewer words than the minimum.'),
  },
  keyphrase: {
    label: t('settings.contentChecks.rule.keyphrase', 'Focus keyphrase'),
    hint: t(
      'settings.contentChecks.rule.keyphrase.hint',
      'Editors may enter a keyphrase in the panel. It stays in their browser and cannot block publishing.'
    ),
  },
});

/**
 * Label and hint of each number field.
 * @param {Function} t - Translate.
 * @returns {Record<string, { label: string, hint: string }>} Texts.
 */
const numberTexts = (t) => ({
  minWords: {
    label: t('settings.contentChecks.minWords.label', 'Minimum words'),
    hint: t('settings.contentChecks.minWords.hint', '0 turns the length hint off. Default 300.'),
  },
  minInternalLinks: {
    label: t('settings.contentChecks.minInternalLinks.label', 'Minimum internal links'),
    hint: t('settings.contentChecks.minInternalLinks.hint', '0 turns the hint off. Default 1.'),
  },
  sentenceWords: {
    label: t('settings.contentChecks.sentenceWords.label', 'Sentence length limit (words)'),
    hint: t(
      'settings.contentChecks.sentenceWords.hint',
      '0 uses the language default: 20 words, 25 for Spanish and Portuguese.'
    ),
  },
  paragraphWords: {
    label: t('settings.contentChecks.paragraphWords.label', 'Paragraph length limit (words)'),
    hint: t('settings.contentChecks.paragraphWords.hint', 'Default 150.'),
  },
  sectionWords: {
    label: t('settings.contentChecks.sectionWords.label', 'Section length limit (words)'),
    hint: t('settings.contentChecks.sectionWords.hint', 'Default 300.'),
  },
});

/**
 * Translates an error of a number field.
 * @param {Function} t - Translate.
 * @param {string|{ server: string }|undefined} error - Error.
 * @param {string} key - Field.
 * @returns {string|undefined} Message.
 */
const numberError = (t, error, key) => {
  if (!error) return undefined;
  if (typeof error === 'object') return error.server;
  if (error === 'required') return t('settings.validation.required', 'This field is required.');
  return t(
    'settings.validation.range',
    'Enter a whole number from {min} to {max}.',
    CONTENT_CHECK_LIMITS[key]
  );
};

/**
 * Readability and SEO hints (2.9): whether the editor's Quality panel shows them, where the page
 * heading comes from, the thresholds and, per rule, whether it is shown and whether it may block
 * publishing. Saved with the page's Save button like every other setting.
 * @param {object} props - Props.
 * @param {object} props.form - useConfigurationForm() result.
 * @param {boolean} props.readOnly - True without settings.update.
 * @returns {JSX.Element|null} Section, or null when the server has no such settings.
 */
export const ContentChecksSection = ({ form, readOnly }) => {
  const t = useT();
  const { draft, errors, setContentChecks, touch } = form;
  const checks = draft.contentChecks;
  if (!checks) return null;
  const off = !checks.enabled;
  const rules = ruleTexts(t);
  const numbers = numberTexts(t);
  const update = (fn, errorKey) => setContentChecks(fn, errorKey);

  return (
    <SectionCard
      title={t('settings.contentChecks.title', 'Readability and SEO hints')}
      subtitle={t(
        'settings.contentChecks.subtitle',
        "Hints in the editor's Quality panel about sentence and paragraph length, headings, links and length. They run in the browser and never block saving or publishing unless you choose a rule below."
      )}
    >
      <SwitchRow
        id="mex-content-checks-enabled"
        t={t}
        label={t('settings.contentChecks.enabled.label', 'Show readability and SEO hints')}
        hint={t(
          'settings.contentChecks.enabled.hint',
          'On by default. A field can turn them off in the Content-Type Builder.'
        )}
        checked={checks.enabled}
        disabled={readOnly}
        onChange={(checked) => update((current) => ({ ...current, enabled: checked }))}
      />
      {errors.contentChecks ? (
        <Typography variant="pi" textColor="danger600" role="alert">
          {typeof errors.contentChecks === 'object' ? errors.contentChecks.server : errors.contentChecks}
        </Typography>
      ) : null}
      <Grid.Root gap={{ initial: 4, medium: 5 }}>
        <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="contentChecks.h1"
            hint={t(
              'settings.contentChecks.h1.hint',
              'Most content types show their title field as the page heading, so the editor content starts at level 2.'
            )}
          >
            <Field.Label>{t('settings.contentChecks.h1.label', 'Page heading')}</Field.Label>
            <SingleSelect
              value={checks.h1}
              disabled={readOnly || off}
              onChange={(value) =>
                update((current) => ({ ...current, h1: value === 'content' ? 'content' : 'title' }))
              }
            >
              <SingleSelectOption value="title">
                {t('settings.contentChecks.h1.title', 'The title field is the H1 (no H1 in the content)')}
              </SingleSelectOption>
              <SingleSelectOption value="content">
                {t('settings.contentChecks.h1.content', 'The content has its own H1')}
              </SingleSelectOption>
            </SingleSelect>
            <Field.Hint />
          </Field.Root>
        </Grid.Item>
        {CONTENT_CHECK_NUMBERS.map((key) => {
          const name = `contentChecks.${key}`;
          return (
            <Grid.Item
              key={key}
              col={4}
              xs={12}
              s={12}
              m={6}
              direction="column"
              alignItems="stretch"
              minWidth={0}
            >
              <Field.Root
                name={name}
                onBlur={() => touch(name)}
                error={numberError(t, errors[name], key)}
                hint={numbers[key].hint}
                required
              >
                <Field.Label>{numbers[key].label}</Field.Label>
                <NumberInput
                  value={checks[key] ?? null}
                  disabled={readOnly || off}
                  onValueChange={(value) => update((current) => ({ ...current, [key]: value ?? null }), name)}
                />
                <Field.Hint />
                <Field.Error />
              </Field.Root>
            </Grid.Item>
          );
        })}
      </Grid.Root>
      <Accordion.Root>
        <Accordion.Item value="rules">
          <Accordion.Header>
            <Accordion.Trigger
              description={t(
                'settings.contentChecks.rules.description',
                'Turn single rules off, or let them block publishing'
              )}
            >
              {t('settings.contentChecks.rules.title', 'Rules')}
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <Box padding={4} minWidth={0}>
              <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
                <Typography variant="pi" textColor="neutral600" tag="p">
                  {t(
                    'settings.contentChecks.rules.publishHint',
                    'A rule that blocks publishing does so only in fields with "Block publishing while quality checks report errors". Heuristic rules and the focus keyphrase cannot block.'
                  )}
                </Typography>
                <Box tag="ul" minWidth={0}>
                  {INSIGHT_SETTINGS.map((rule, index) => {
                    const shown = !checks.disabled.includes(rule);
                    const blockable = BLOCKABLE_SETTINGS.includes(rule);
                    return (
                      <Box
                        tag="li"
                        key={rule}
                        paddingTop={3}
                        paddingBottom={3}
                        borderColor={index ? 'neutral150' : undefined}
                        borderStyle={index ? 'solid none none none' : undefined}
                        borderWidth={index ? '1px 0 0 0' : undefined}
                        minWidth={0}
                      >
                        <Flex
                          gap={4}
                          alignItems="flex-start"
                          justifyContent="space-between"
                          wrap="wrap"
                          minWidth={0}
                        >
                          <Flex
                            direction="column"
                            alignItems="flex-start"
                            gap={1}
                            minWidth={0}
                            flex="1 1 24rem"
                          >
                            <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                              {rules[rule].label}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {rules[rule].hint}
                            </Typography>
                          </Flex>
                          <Flex gap={4} wrap="wrap" alignItems="center">
                            <Checkbox
                              checked={shown}
                              disabled={readOnly || off}
                              aria-label={t('settings.contentChecks.rules.showLabel', 'Show: {rule}', {
                                rule: rules[rule].label,
                              })}
                              onCheckedChange={(checked) =>
                                update((current) =>
                                  toggleContentCheck(current, 'disabled', rule, checked !== true)
                                )
                              }
                            >
                              {t('settings.contentChecks.rules.show', 'Show')}
                            </Checkbox>
                            {blockable ? (
                              <Checkbox
                                checked={shown && checks.blockPublish.includes(rule)}
                                disabled={readOnly || off || !shown}
                                aria-label={t(
                                  'settings.contentChecks.rules.blockLabel',
                                  'Block publishing: {rule}',
                                  {
                                    rule: rules[rule].label,
                                  }
                                )}
                                onCheckedChange={(checked) =>
                                  update((current) =>
                                    toggleContentCheck(current, 'blockPublish', rule, checked === true)
                                  )
                                }
                              >
                                {t('settings.contentChecks.rules.block', 'Block publishing')}
                              </Checkbox>
                            ) : null}
                          </Flex>
                        </Flex>
                      </Box>
                    );
                  })}
                </Box>
              </Flex>
            </Box>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </SectionCard>
  );
};

export default ContentChecksSection;

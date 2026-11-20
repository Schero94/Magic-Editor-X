import { useRef, useState } from 'react';
import { Alert, Box, Flex, IconButton, Typography } from '@strapi/design-system';
import { Duplicate } from '@strapi/icons';
import { useIntl } from 'react-intl';
import { useClipboard } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { useT, SectionCard } from '../../components/ui';
import { isHexColor, tokenLabel } from '../../../../shared/inline-format.mjs';

/**
 * Colour sample of a configured token. The value is a validated hex colour
 * from the plugin configuration (shown as the owner defined it).
 */
const Swatch = styled.span`
  display: inline-block;
  flex: 0 0 auto;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.colors.neutral300};
  background: ${({ $color }) => (isHexColor($color) ? $color : 'transparent')};
`;

const CodeBlock = styled.pre`
  margin: 0;
  max-width: 100%;
  max-height: 24rem;
  overflow: auto;
  padding: ${({ theme }) => theme.spaces[4]};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, Consolas, monospace;
  font-size: ${({ theme }) => theme.fontSizes[1]};
  line-height: 1.6;
  white-space: pre;

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const TokenList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  gap: ${({ theme }) => theme.spaces[3]};
`;

/**
 * One token row: light and dark samples, label and name.
 * @param {{ token: object, locale: string, t: Function }} props - Props.
 * @returns {JSX.Element} Row.
 */
const TokenItem = ({ token, locale, t }) => (
  <Box tag="li" minWidth={0}>
    <Flex gap={2} alignItems="center" minWidth={0}>
      {/* Decorative samples: the text next to them names both values (2.7.8: no native tooltip). */}
      <Swatch $color={token.light} aria-hidden="true" />
      <Swatch $color={token.dark} aria-hidden="true" />
      <Flex direction="column" alignItems="flex-start" minWidth={0}>
        <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
          {tokenLabel(token, locale)}
        </Typography>
        <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
          {t('settings.palette.values', '{name} · light theme {light}, dark theme {dark}', {
            name: token.name,
            light: token.light,
            dark: token.dark,
          })}
        </Typography>
      </Flex>
    </Flex>
  </Box>
);

/**
 * Settings > Configuration: the colour palette (2.5, read-only: it is defined
 * in config/plugins.js next to the site CSS), its contrast problems, the CSS
 * snippet for the site and the available inline annotations.
 * @param {{ palette?: { colors: object[], highlights: object[], issues: object[], css: string, annotations?: object[] } }} props - `environment.palette` from GET /settings.
 * @returns {JSX.Element|null} Section.
 */
export const PaletteSection = ({ palette }) => {
  const t = useT();
  const { locale } = useIntl();
  const { copy } = useClipboard();
  const codeRef = useRef(null);
  const [alertOpen, setAlertOpen] = useState(true);
  if (!palette) return null;
  const colors = Array.isArray(palette.colors) ? palette.colors : [];
  const highlights = Array.isArray(palette.highlights) ? palette.highlights : [];
  const issues = Array.isArray(palette.issues) ? palette.issues : [];
  const annotations = Array.isArray(palette.annotations) ? palette.annotations : [];
  const empty = !colors.length && !highlights.length;

  const pairText = (issue) =>
    t(
      'settings.palette.issue',
      '{mode, select, dark {Dark theme} other {Light theme}}: {pair} has contrast {ratio}:1 (needs 4.5:1)',
      {
        mode: issue.mode,
        pair: `${issue.color || t('settings.palette.defaultText', 'default text')} / ${
          issue.highlight || t('settings.palette.page', 'page background')
        }`,
        ratio: issue.ratio,
      }
    );

  const onCopy = async () => {
    if (!(await copy(palette.css)) && codeRef.current) {
      const range = document.createRange();
      range.selectNodeContents(codeRef.current);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      codeRef.current.focus();
    }
  };

  return (
    <SectionCard
      title={t('settings.palette.title', 'Text colours and highlights')}
      subtitle={t(
        'settings.palette.subtitle',
        'Defined in the plugin configuration (config/plugins.js, key palette). Fields offer them when the field option "Text colour and highlight" is on.'
      )}
    >
      {empty ? (
        <Typography variant="omega" textColor="neutral600">
          {t(
            'settings.palette.empty',
            'No palette is configured, so editors see no colour tool. Ask your developer to add colour tokens to the plugin configuration.'
          )}
        </Typography>
      ) : (
        <>
          {issues.length && alertOpen ? (
            // The Alert renders its children inside a paragraph: the list follows it (no <ul> in <p>).
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Alert
                variant="warning"
                closeLabel={t('settings.close', 'Close')}
                onClose={() => setAlertOpen(false)}
              >
                {t(
                  'settings.palette.issuesTitle',
                  '{count, plural, one {# combination is} other {# combinations are}} hard to read',
                  { count: issues.length }
                )}
              </Alert>
              <Box tag="ul" paddingLeft={4} margin={0}>
                {issues.slice(0, 20).map((issue) => (
                  <Typography
                    key={`${issue.mode}|${issue.color}|${issue.highlight}`}
                    tag="li"
                    variant="omega"
                  >
                    {pairText(issue)}
                  </Typography>
                ))}
              </Box>
            </Flex>
          ) : null}
          {colors.length ? (
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="sigma" textColor="neutral600" tag="h3">
                {t('settings.palette.colors', 'Text colours')}
              </Typography>
              <TokenList>
                {colors.map((token) => (
                  <TokenItem key={token.name} token={token} locale={locale} t={t} />
                ))}
              </TokenList>
            </Flex>
          ) : null}
          {highlights.length ? (
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="sigma" textColor="neutral600" tag="h3">
                {t('settings.palette.highlights', 'Highlights')}
              </Typography>
              <TokenList>
                {highlights.map((token) => (
                  <TokenItem key={token.name} token={token} locale={locale} t={t} />
                ))}
              </TokenList>
            </Flex>
          ) : null}
          <Flex direction="column" alignItems="stretch" gap={2} minWidth={0}>
            <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
              <Typography variant="sigma" textColor="neutral600" id="mex-palette-css-label" tag="h3">
                {t('settings.palette.css', 'CSS for your site')}
              </Typography>
              <IconButton
                label={t('settings.palette.copy', 'Copy the CSS')}
                variant="tertiary"
                onClick={onCopy}
              >
                <Duplicate />
              </IconButton>
            </Flex>
            <Box minWidth={0}>
              <CodeBlock ref={codeRef} tabIndex={0} aria-labelledby="mex-palette-css-label">
                <code>{palette.css}</code>
              </CodeBlock>
            </Box>
          </Flex>
        </>
      )}
      {annotations.length ? (
        <Typography variant="pi" textColor="neutral600">
          {t('settings.palette.annotations', 'Annotations for the field option "Annotations": {names}', {
            names: annotations.map((item) => item.name).join(', '),
          })}
        </Typography>
      ) : null}
    </SectionCard>
  );
};

export default PaletteSection;

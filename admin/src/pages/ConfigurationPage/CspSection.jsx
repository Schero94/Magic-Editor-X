import { useRef, useState } from 'react';
import { Alert, Box, Flex, IconButton, Typography } from '@strapi/design-system';
import { Duplicate } from '@strapi/icons';
import { useClipboard, useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { useT, SectionCard, PropertyList } from '../../components/ui';

/**
 * Scrollable, keyboard-focusable code block. Colours and sizes come from the
 * theme so it follows light and dark mode; long lines scroll inside the block
 * instead of widening the page.
 */
const CodeBlock = styled.pre`
  margin: 0;
  max-width: 100%;
  overflow-x: auto;
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

/**
 * Selects the text of an element so it can be copied by hand.
 * @param {HTMLElement|null} node - Element.
 * @returns {void}
 */
const selectText = (node) => {
  if (!node || typeof window.getSelection !== 'function') return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  node.focus();
};

/**
 * Notice for admin CSP sources the editor preview misses (embeds, external
 * images). The plugin never changes the CSP; the owner copies the snippet into
 * config/middlewares.js. Renders nothing when nothing is blocked.
 * @param {{ csp?: { active: boolean, frameSrcMissing: string[], imgSrcMissing: boolean, snippet: string } }} props - environment.csp from GET /settings.
 * @returns {JSX.Element|null} Section.
 */
export const CspSection = ({ csp }) => {
  const t = useT();
  const { copy } = useClipboard();
  const { toggleNotification } = useNotification();
  const codeRef = useRef(null);
  const [alertOpen, setAlertOpen] = useState(true);

  const frameMissing = (csp && Array.isArray(csp.frameSrcMissing) && csp.frameSrcMissing) || [];
  const imgMissing = Boolean(csp && csp.imgSrcMissing);
  if (!csp || !csp.active || !csp.snippet || (!frameMissing.length && !imgMissing)) return null;

  const onCopy = async () => {
    const ok = await copy(csp.snippet);
    if (ok) {
      toggleNotification({
        type: 'success',
        message: t('settings.csp.copied', 'Snippet copied to the clipboard.'),
      });
    } else {
      selectText(codeRef.current);
      toggleNotification({
        type: 'warning',
        message: t(
          'settings.csp.copyFailed',
          'The browser did not allow copying. The snippet is selected; copy it with Ctrl+C or Cmd+C.'
        ),
      });
    }
  };

  const allowed = t('settings.csp.allowed', 'Allowed');
  const codeLabel = t('settings.csp.codeLabel', 'Snippet for config/middlewares.js');

  return (
    <SectionCard
      title={t('settings.csp.title', 'Content Security Policy')}
      subtitle={t(
        'settings.csp.subtitle',
        'The admin Content Security Policy is set in config/middlewares.js. The plugin never changes it.'
      )}
    >
      {alertOpen ? (
        <Alert
          variant="warning"
          closeLabel={t('settings.close', 'Close')}
          onClose={() => setAlertOpen(false)}
          title={t('settings.csp.alertTitle', 'Some editor previews are blocked')}
        >
          {t(
            'settings.csp.alertBody',
            'Your Content Security Policy blocks content the editor shows. Stored content is not affected; editors see a placeholder instead. To allow it, add the sources below to the strapi::security middleware and restart Strapi.'
          )}
        </Alert>
      ) : null}
      <PropertyList
        items={[
          {
            key: 'frame',
            label: t('settings.csp.frames', 'Embeds (frame-src)'),
            value: frameMissing.length
              ? t('settings.csp.framesBlocked', 'Blocked: {sources}', { sources: frameMissing.join(', ') })
              : allowed,
          },
          {
            key: 'img',
            label: t('settings.csp.images', 'External images (img-src)'),
            value: imgMissing
              ? t(
                  'settings.csp.imagesBlocked',
                  'Blocked: images from other hosts (for example link previews)'
                )
              : allowed,
            hint: imgMissing
              ? t(
                  'settings.csp.imagesHint',
                  'The snippet adds https:. You can list your image hosts instead.'
                )
              : undefined,
          },
        ]}
      />
      <Flex direction="column" alignItems="stretch" gap={2} minWidth={0}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Typography variant="sigma" textColor="neutral600" id="mex-csp-snippet-label">
            {codeLabel}
          </Typography>
          <IconButton label={t('settings.csp.copy', 'Copy the snippet')} variant="tertiary" onClick={onCopy}>
            <Duplicate />
          </IconButton>
        </Flex>
        <Box minWidth={0}>
          <CodeBlock ref={codeRef} tabIndex={0} aria-labelledby="mex-csp-snippet-label">
            <code>{csp.snippet}</code>
          </CodeBlock>
        </Box>
        <Typography variant="pi" textColor="neutral600">
          {t(
            'settings.csp.mergeHint',
            'Keep your other directives (for example the hosts of your upload provider) and restart Strapi after the change.'
          )}
        </Typography>
      </Flex>
    </SectionCard>
  );
};

export default CspSection;

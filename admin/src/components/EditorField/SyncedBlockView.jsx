import { useMemo } from 'react';
import { Badge, Box, Button, Flex, LinkButton, Loader, Typography } from '@strapi/design-system';
import { ArrowClockwise, Pencil } from '@strapi/icons';
import styled from 'styled-components';
import { RenderedContent } from '../RenderedContent';
import { useSyncedSource } from '../../editor/synced-store';
import { sourceBlocksOf } from '../../../../shared/synced.mjs';
import { filterSyncedForField } from '../../../../shared/templates.mjs';

/**
 * What a synced block shows in the editor (2.3): the source name, the
 * source content rendered with the React renderer exactly as this field
 * outputs it (blocks the field's preset does not allow are left out, as in
 * the Content API), "Edit source" (managers, opens Settings in a new tab) and
 * "Detach" (editors). The content is read-only here; it refreshes on window
 * focus and every 30 seconds while the page is visible. Rendered through a
 * portal into the Editor.js block, so it has the admin theme and providers.
 */

const Frame = styled(Box)`
  min-width: 0;
  border-inline-start: 4px solid ${({ theme }) => theme.colors.primary500};
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {string} props.refId - Source documentId ('' when the block has no valid reference).
 * @param {boolean} props.readOnly - The field is read-only (no Detach).
 * @param {import('../../../../shared/presets.mjs').FieldPreset} props.preset - Field preset.
 * @param {(id: string) => string|null} props.editHref - Settings URL of the source (null without the manage permission).
 * @param {() => void} props.onDetach - Replaces the reference with a copy of the content.
 * @param {boolean} props.allowRaw - Render raw HTML blocks (sanitised).
 * @param {string} [props.lang] - Content language.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @returns {JSX.Element} View.
 */
export const SyncedBlockView = ({ t, refId, readOnly, preset, editHref, onDetach, allowRaw, lang, dir }) => {
  const { entry, refresh } = useSyncedSource(refId);
  const template = entry.template;
  const shown = useMemo(
    () =>
      template
        ? filterSyncedForField(sourceBlocksOf(template.blocks), preset && preset.restricted ? preset : null)
        : null,
    [template, preset]
  );
  const name = template ? template.name : '';
  const href = template && editHref ? editHref(template.id) : null;
  const missing = !refId || entry.status === 'missing';

  let body;
  if (missing) {
    body = (
      <Typography variant="omega" textColor="neutral600" data-testid="mex-synced-removed">
        {t(
          'editor.synced.removed',
          'Synced block removed. Its source was deleted, so this block shows nothing. You can delete the block.'
        )}
      </Typography>
    );
  } else if (!template && entry.status === 'error') {
    body = (
      <Flex gap={2} wrap="wrap" alignItems="center">
        <Typography variant="omega" textColor="danger600">
          {t('editor.synced.error', 'The synced block could not be loaded.')}
        </Typography>
        <Button variant="tertiary" size="S" startIcon={<ArrowClockwise />} onClick={() => refresh(true)}>
          {t('editor.config.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (!template) {
    body = <Loader small>{t('editor.synced.loading', 'Loading the synced block')}</Loader>;
  } else if (shown && shown.blocks.length === 0) {
    body = (
      <Typography variant="omega" textColor="neutral600">
        {t(
          'editor.synced.nothingAllowed',
          'None of its blocks is allowed in this field, so it shows nothing.'
        )}
      </Typography>
    );
  } else {
    body = (
      <RenderedContent value={{ blocks: shown.blocks }} t={t} allowRaw={allowRaw} lang={lang} dir={dir} />
    );
  }

  return (
    <Frame
      padding={3}
      hasRadius
      background="neutral100"
      role="group"
      aria-label={
        missing
          ? t('editor.synced.removedLabel', 'Synced block removed')
          : t('editor.synced.label', 'Synced block: {name}', { name: name || '…' })
      }
      data-testid="mex-synced-view"
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Flex gap={2} alignItems="center" wrap="wrap" minWidth={0}>
            <Badge>{t('editor.synced.badge', 'Synced')}</Badge>
            <Typography
              variant="omega"
              fontWeight="bold"
              textColor="neutral800"
              style={{ overflowWrap: 'anywhere' }}
            >
              {missing
                ? t('editor.synced.removedLabel', 'Synced block removed')
                : t('editor.synced.label', 'Synced block: {name}', { name: name || '…' })}
            </Typography>
          </Flex>
          {template ? (
            <Flex gap={1} wrap="wrap">
              {href ? (
                <LinkButton
                  href={href}
                  isExternal
                  variant="tertiary"
                  size="S"
                  startIcon={<Pencil />}
                  data-testid="mex-synced-edit"
                >
                  {t('editor.synced.edit', 'Edit source')}
                </LinkButton>
              ) : null}
              {!readOnly ? (
                <Button variant="tertiary" size="S" onClick={onDetach} data-testid="mex-synced-detach">
                  {t('editor.synced.detach', 'Detach')}
                </Button>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
        {shown && shown.omitted ? (
          <Typography variant="pi" textColor="neutral600" data-testid="mex-synced-omitted">
            {t(
              'editor.synced.omitted',
              '{count, plural, one {# block of the source is} other {# blocks of the source are}} not allowed in this field and left out.',
              { count: shown.omitted }
            )}
          </Typography>
        ) : null}
        {template && entry.status === 'error' ? (
          <Typography variant="pi" textColor="danger600">
            {t(
              'editor.synced.stale',
              'The latest version could not be loaded. This is the last loaded content.'
            )}
          </Typography>
        ) : null}
        <Box minWidth={0}>{body}</Box>
      </Flex>
    </Frame>
  );
};

export default SyncedBlockView;

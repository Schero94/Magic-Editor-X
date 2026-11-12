import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Badge, Box, Flex, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { API } from '../../utils/api';
import { SectionCard, useT } from '../../components/ui';
import { codeBlocks } from '../../editor/block-registry';
import { mergeCodeBlocks } from '../../editor/block-registry-logic.mjs';

/**
 * Read-only list of the blocks the app registers in code (custom block SDK).
 * Renders nothing when there are none.
 * @returns {JSX.Element|null} Section.
 */
export const CodeBlocksSection = () => {
  const t = useT();
  const { locale } = useIntl();
  const { get } = useFetchClient();
  const [server, setServer] = useState([]);

  useEffect(() => {
    let active = true;
    get(API.config).then(
      ({ data }) => {
        if (active && data && data.data && Array.isArray(data.data.codeBlocks))
          setServer(data.data.codeBlocks);
      },
      () => {
        // Without plugin access the server list stays empty; the admin registrations are still shown.
      }
    );
    return () => {
      active = false;
    };
  }, [get]);

  const rows = useMemo(() => mergeCodeBlocks(server, codeBlocks(), locale), [server, locale]);
  if (!rows.length) return null;

  return (
    <SectionCard
      title={t('settings.blocks.code.title', 'Defined in code')}
      subtitle={t(
        'settings.blocks.code.subtitle',
        'Blocks your app registers in code with the custom block SDK. They are changed in the code and cannot be edited here.'
      )}
    >
      <Box tag="ul" margin={0} padding={0}>
        <Flex direction="column" alignItems="stretch" gap={3}>
          {rows.map((row) => (
            <Box
              key={row.name}
              tag="li"
              padding={4}
              hasRadius
              borderColor="neutral200"
              background="neutral100"
              minWidth={0}
            >
              <Flex direction="column" alignItems="flex-start" gap={2} minWidth={0}>
                <Flex gap={2} wrap="wrap" alignItems="center">
                  <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="h3">
                    {row.title}
                  </Typography>
                  <Badge>{t('settings.blocks.code.badge', 'Defined in code')}</Badge>
                </Flex>
                <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                  {row.name} ·{' '}
                  {t('settings.blocks.code.version', 'Version {version}', { version: row.version })}
                </Typography>
                {row.fields.length ? (
                  <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                    {t('settings.blocks.code.fields', 'Fields: {fields}', {
                      fields: row.fields.map((field) => `${field.key} (${field.type})`).join(', '),
                    })}
                  </Typography>
                ) : null}
                {row.presets.length ? (
                  <Typography variant="pi" textColor="neutral600">
                    {t('settings.blocks.code.presets', 'Also in the presets: {presets}', {
                      presets: row.presets.join(', '),
                    })}
                  </Typography>
                ) : null}
                {!row.inAdmin ? (
                  <Typography variant="pi" textColor="warning600">
                    {t(
                      'settings.blocks.code.noTool',
                      'No editor tool is registered in the admin, so editors cannot insert this block.'
                    )}
                  </Typography>
                ) : null}
                {!row.onServer ? (
                  <Typography variant="pi" textColor="warning600">
                    {t(
                      'settings.blocks.code.noServer',
                      'Not registered on the server: saved content of this block is cleaned with the generic policy.'
                    )}
                  </Typography>
                ) : null}
              </Flex>
            </Box>
          ))}
        </Flex>
      </Box>
    </SectionCard>
  );
};

export default CodeBlocksSection;

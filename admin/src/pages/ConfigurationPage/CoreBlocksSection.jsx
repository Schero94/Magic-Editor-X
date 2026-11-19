import { Badge, Box, Flex, LinkButton, Typography } from '@strapi/design-system';
import { ExternalLink } from '@strapi/icons';
import { useT, SectionCard } from '../../components/ui';
import { SwitchRow } from './AiSection';
import { coreBlockCoverage } from '../../editor/core-blocks-logic.mjs';
import { coreBlockEditorTypes } from '../../editor/core-blocks';

const GUIDE_URL = 'https://github.com/Schero94/Magic-Editor-X#core-blocks-bridge';
const RFC_URL = 'https://github.com/strapi/strapi/discussions/25546';

/**
 * Badge tone, label and explanation per bridge state (`status().state` of the server service).
 * @param {Function} t - Translate.
 * @param {string} state - off, idle, active, native or unavailable.
 * @returns {{ tone: { backgroundColor: string, textColor: string }, label: string, text: string }} Mapping.
 */
const stateInfo = (t, state) => {
  switch (state) {
    case 'active':
      return {
        tone: { backgroundColor: 'success100', textColor: 'success700' },
        label: t('settings.coreBlocks.state.active', 'Active'),
        text: t(
          'settings.coreBlocks.state.active.text',
          'Registered block types are checked against their own rules when an entry is saved or published. Everything else is checked by Strapi as usual.'
        ),
      };
    case 'idle':
      return {
        tone: { backgroundColor: 'neutral150', textColor: 'neutral700' },
        label: t('settings.coreBlocks.state.idle', 'On, no block type registered'),
        text: t(
          'settings.coreBlocks.state.idle.text',
          'The bridge is on but no block type is registered in code yet, so Strapi checks every entry as usual. A developer registers block types (see the developer guide).'
        ),
      };
    case 'native':
      return {
        tone: { backgroundColor: 'neutral150', textColor: 'neutral700' },
        label: t('settings.coreBlocks.state.native', 'Handled by Strapi'),
        text: t(
          'settings.coreBlocks.state.native.text',
          'This Strapi version checks custom blocks itself, so the bridge stays out of the way. Registered block types were handed to Strapi.'
        ),
      };
    case 'unavailable':
      return {
        tone: { backgroundColor: 'warning200', textColor: 'neutral800' },
        label: t('settings.coreBlocks.state.unavailable', 'Not available'),
        text: t(
          'settings.coreBlocks.state.unavailable.text',
          'This Strapi version changed the part of the validation the bridge relies on. The bridge does nothing, so custom blocks are rejected as before. Update Magic Editor X.'
        ),
      };
    default:
      return {
        tone: { backgroundColor: 'neutral150', textColor: 'neutral700' },
        label: t('settings.coreBlocks.state.off', 'Off'),
        text: t(
          'settings.coreBlocks.state.off.text',
          'Strapi rejects custom blocks in Blocks fields when an entry is saved, as it does without this plugin.'
        ),
      };
  }
};

/**
 * One labelled list of block type names.
 * @param {{ label: string, types: string[], emptyText: string }} props - Props.
 * @returns {JSX.Element} Row.
 */
const TypeList = ({ label, types, emptyText }) => (
  <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
    <Typography variant="sigma" textColor="neutral600" tag="h3">
      {label}
    </Typography>
    {types.length ? (
      <Flex gap={2} wrap="wrap" tag="ul" aria-label={label}>
        {types.map((type) => (
          <Box tag="li" key={type} background="neutral150" hasRadius paddingLeft={2} paddingRight={2}>
            {/* Type names are case-sensitive identifiers, so no uppercase badge. */}
            <Typography variant="pi" tag="code" textColor="neutral800">
              {type}
            </Typography>
          </Box>
        ))}
      </Flex>
    ) : (
      <Typography variant="pi" textColor="neutral600">
        {emptyText}
      </Typography>
    )}
  </Flex>
);

/**
 * Core Blocks bridge section (2.7): the switch, the state the server reports and the block types
 * registered in code. Saved with the page's Save button like every other setting.
 * @param {object} props - Props.
 * @param {object} props.form - useConfigurationForm() result.
 * @param {boolean} props.readOnly - True without settings.update.
 * @returns {JSX.Element|null} Section, or null when the server has no Core Blocks bridge.
 */
export const CoreBlocksSection = ({ form, readOnly }) => {
  const t = useT();
  const { draft, dto, saved, setCoreBlocksEnabled } = form;
  const status = dto.coreBlocks;
  if (!status || !draft.coreBlocks) return null;
  const pending = Boolean(saved && saved.coreBlocks && saved.coreBlocks.enabled !== draft.coreBlocks.enabled);
  const info = stateInfo(t, status.state);
  const coverage = coreBlockCoverage(status.types, coreBlockEditorTypes());

  return (
    <SectionCard
      title={t('settings.coreBlocks.title', 'Custom blocks in Strapi Blocks fields')}
      subtitle={t(
        'settings.coreBlocks.subtitle',
        "Strapi's own Blocks field lets developers add custom blocks to its editor, but Strapi rejects them when an entry is saved. This bridge lets block types that a developer registered in code pass that check, each against its own rules."
      )}
    >
      <SwitchRow
        id="mex-core-blocks-enabled"
        t={t}
        label={t('settings.coreBlocks.enabled.label', 'Save registered custom blocks')}
        hint={
          pending
            ? t('settings.coreBlocks.enabled.pending', 'Takes effect when you save. No restart is needed.')
            : t(
                'settings.coreBlocks.enabled.hint',
                'Off by default. Unregistered block types are still rejected, and built-in blocks are checked by Strapi unchanged.'
              )
        }
        checked={draft.coreBlocks.enabled}
        disabled={readOnly}
        onChange={(checked) => setCoreBlocksEnabled(checked)}
      />
      <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
        <Flex gap={2} alignItems="center" wrap="wrap" minWidth={0}>
          <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="h3">
            {t('settings.coreBlocks.state.label', 'Status')}
          </Typography>
          <Badge {...info.tone} data-testid="mex-core-blocks-state">
            {info.label}
          </Badge>
        </Flex>
        <Typography variant="pi" textColor="neutral600" tag="p">
          {info.text}
        </Typography>
        <TypeList
          label={t('settings.coreBlocks.types.label', 'Block types registered on the server')}
          types={status.types.map((entry) => entry.type)}
          emptyText={t('settings.coreBlocks.types.empty', 'None yet. A developer registers them in code.')}
        />
        {coverage.editorOnly.length ? (
          <Box background="warning100" hasRadius padding={3} minWidth={0}>
            <Typography variant="pi" textColor="neutral800" tag="p">
              {t(
                'settings.coreBlocks.editorOnly',
                'The editor offers {types}, but the server has no rules for them, so entries with these blocks are rejected when saved. Register them on the server.',
                { types: coverage.editorOnly.join(', ') }
              )}
            </Typography>
          </Box>
        ) : null}
        <Flex gap={2} wrap="wrap" minWidth={0}>
          <LinkButton href={GUIDE_URL} isExternal variant="tertiary" endIcon={<ExternalLink aria-hidden />}>
            {t('settings.coreBlocks.guide', 'Developer guide: register a block type')}
          </LinkButton>
          <LinkButton href={RFC_URL} isExternal variant="tertiary" endIcon={<ExternalLink aria-hidden />}>
            {t('settings.coreBlocks.rfc', 'Strapi proposal for built-in support')}
          </LinkButton>
        </Flex>
        <Typography variant="pi" textColor="neutral600" tag="p">
          {t(
            'settings.coreBlocks.native',
            'When Strapi checks custom blocks itself, the bridge turns itself off and hands the registered block types to Strapi.'
          )}
        </Typography>
      </Flex>
    </SectionCard>
  );
};

export default CoreBlocksSection;

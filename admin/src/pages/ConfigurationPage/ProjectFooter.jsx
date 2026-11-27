import { Flex, LinkButton, Typography } from '@strapi/design-system';
import { ExternalLink } from '@strapi/icons';
import { useT } from '../../components/ui';

const REPOSITORY_URL = 'https://github.com/Schero94/Magic-Editor-X';

/**
 * One line under the last section of the Configuration page with the link to the repository.
 * A footer, not a SectionCard, so "Server configuration" stays the last heading of the page.
 * @returns {JSX.Element} Footer.
 */
export const ProjectFooter = () => {
  const t = useT();
  return (
    <Flex tag="footer" gap={2} wrap="wrap" alignItems="center" minWidth={0}>
      <Typography variant="pi" textColor="neutral600">
        {t(
          'settings.configuration.footer.text',
          'Magic Editor X is free and open source. If it is useful to you, a star on GitHub helps other Strapi developers find it.'
        )}
      </Typography>
      <LinkButton
        href={REPOSITORY_URL}
        isExternal
        variant="tertiary"
        size="S"
        endIcon={<ExternalLink aria-hidden />}
      >
        {t('settings.configuration.footer.github', 'Magic Editor X on GitHub')}
      </LinkButton>
    </Flex>
  );
};

export default ProjectFooter;

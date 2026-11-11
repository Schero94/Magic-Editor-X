import { useId } from 'react';
import { Flex } from '@strapi/design-system';
import { Layouts, Page } from '@strapi/strapi/admin';

/**
 * Page frame used by every plugin settings screen: Page.Main, Page.Title,
 * Layouts.Header (primary action in the header), optional Layouts.Action and
 * Layouts.Content. No extra horizontal padding: Layouts.Content already applies
 * the Strapi page gutters, so sections align with the page title.
 * @param {object} props - Props.
 * @param {string} props.title - Page title (h1 and browser tab title).
 * @param {import('react').ReactNode} [props.subtitle] - Subtitle under the title.
 * @param {import('react').ReactNode} [props.primaryAction] - Main action.
 * @param {import('react').ReactNode} [props.secondaryAction] - Secondary actions.
 * @param {import('react').ReactNode} [props.startActions] - Layouts.Action start slot.
 * @param {import('react').ReactNode} [props.endActions] - Layouts.Action end slot.
 * @param {import('react').ReactNode} props.children - Sections.
 * @returns {JSX.Element} Page.
 */
export const PageShell = ({
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  startActions,
  endActions,
  children,
}) => {
  const id = `mex-page-title-${useId().replace(/:/g, '')}`;
  return (
    <Page.Main aria-labelledby={id}>
      <Page.Title>{title}</Page.Title>
      <Layouts.Header
        id={id}
        title={title}
        subtitle={subtitle}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
      />
      {startActions || endActions ? (
        <Layouts.Action startActions={startActions} endActions={endActions} />
      ) : null}
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6} paddingBottom={8} minWidth={0}>
          {children}
        </Flex>
      </Layouts.Content>
    </Page.Main>
  );
};

export default PageShell;

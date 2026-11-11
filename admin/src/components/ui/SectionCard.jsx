import { Box, Flex, Typography } from '@strapi/design-system';

/**
 * One section surface (neutral0, radius, table shadow) with an h2 heading.
 * @param {object} props - Props.
 * @param {string} props.title - Heading.
 * @param {import('react').ReactNode} [props.subtitle] - Short description.
 * @param {import('react').ReactNode} [props.action] - Actions on the right of the heading.
 * @param {string} [props.headingTag='h2'] - Heading element.
 * @param {import('react').ReactNode} props.children - Content.
 * @returns {JSX.Element} Section.
 */
export const SectionCard = ({ title, subtitle, action, headingTag = 'h2', children }) => (
  <Box
    tag="section"
    background="neutral0"
    hasRadius
    shadow="tableShadow"
    padding={{ initial: 4, medium: 6 }}
    minWidth={0}
  >
    <Flex direction="column" alignItems="stretch" gap={4}>
      {title || action ? (
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 24rem">
            <Typography variant="delta" tag={headingTag} textColor="neutral800">
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="pi" textColor="neutral600">
                {subtitle}
              </Typography>
            ) : null}
          </Flex>
          {action ? (
            <Flex gap={2} wrap="wrap">
              {action}
            </Flex>
          ) : null}
        </Flex>
      ) : null}
      {children}
    </Flex>
  </Box>
);

export default SectionCard;

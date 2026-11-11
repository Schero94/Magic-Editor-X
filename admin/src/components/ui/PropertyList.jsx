import { Box, Flex, Typography } from '@strapi/design-system';

/**
 * Read-only label/value rows (used for environment information).
 * @param {{ items: Array<{ key: string, label: string, value: import('react').ReactNode, hint?: string }> }} props - Rows.
 * @returns {JSX.Element} Description list.
 */
export const PropertyList = ({ items }) => (
  <Box tag="dl" margin={0}>
    <Flex direction="column" alignItems="stretch" gap={3}>
      {items.map((item) => (
        <Flex
          key={item.key}
          gap={{ initial: 1, medium: 4 }}
          direction={{ initial: 'column', medium: 'row' }}
          alignItems={{ initial: 'flex-start', medium: 'baseline' }}
          minWidth={0}
        >
          <Box tag="dt" minWidth={0} flex={{ initial: '0 0 auto', medium: '0 0 26rem' }}>
            <Typography variant="sigma" textColor="neutral600">
              {item.label}
            </Typography>
          </Box>
          <Box tag="dd" margin={0} minWidth={0} flex="1 1 auto">
            <Typography variant="omega" textColor="neutral800">
              {item.value}
            </Typography>
            {item.hint ? (
              <Box paddingTop={1}>
                <Typography variant="pi" textColor="neutral600">
                  {item.hint}
                </Typography>
              </Box>
            ) : null}
          </Box>
        </Flex>
      ))}
    </Flex>
  </Box>
);

export default PropertyList;

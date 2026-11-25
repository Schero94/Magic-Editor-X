import { Accordion, Box, Flex } from '@strapi/design-system';

/**
 * Advanced or read-only details behind one disclosure (2.12.3). It is the pattern the
 * Configuration page already uses for the readability "Rules": a DS Accordion with a single
 * item, collapsed by default, so long reference content (server options, a configuration
 * snippet, advanced block settings) does not push the everyday settings down.
 * @param {object} props - Props.
 * @param {string} props.value - Item id (unique on the page).
 * @param {string} props.title - Trigger text.
 * @param {import('react').ReactNode} [props.actions] - Controls beside the trigger (DS `Accordion.Actions`).
 * @param {boolean} [props.open] - Controlled open state (with `onOpenChange`).
 * @param {(open: boolean) => void} [props.onOpenChange] - Called when the item opens or closes.
 * @param {boolean} [props.defaultOpen] - Uncontrolled initial state.
 * @param {import('react').ReactNode} props.children - Content.
 * @returns {JSX.Element} Disclosure.
 */
export const CollapsibleDetails = ({
  value,
  title,
  actions,
  open,
  onOpenChange,
  defaultOpen = false,
  children,
}) => {
  const controlled = typeof open === 'boolean';
  const rootProps = controlled
    ? {
        value: open ? value : '',
        onValueChange: (next) => {
          if (typeof onOpenChange === 'function') onOpenChange(next === value);
        },
      }
    : { defaultValue: defaultOpen ? value : undefined };
  return (
    <Accordion.Root {...rootProps}>
      <Accordion.Item value={value}>
        <Accordion.Header>
          <Accordion.Trigger>{title}</Accordion.Trigger>
          {actions ? <Accordion.Actions>{actions}</Accordion.Actions> : null}
        </Accordion.Header>
        <Accordion.Content>
          <Box padding={4} minWidth={0}>
            <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
              {children}
            </Flex>
          </Box>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
};

export default CollapsibleDetails;

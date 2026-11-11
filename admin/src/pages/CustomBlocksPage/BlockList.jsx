import {
  Badge,
  Box,
  Flex,
  IconButton,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowDown, ArrowUp, Duplicate, Pencil, Trash } from '@strapi/icons';
import { ConfirmAction, useBreakpoint, useT } from '../../components/ui';
import { blockTypeLabel } from './messages';
import { IconPreview } from './Preview';

/**
 * Row actions shared by the table and the card list.
 * @param {object} props - Props.
 * @returns {JSX.Element} Actions.
 */
const RowActions = ({
  block,
  index,
  count,
  busy,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
  fallbackFocusRef,
}) => {
  const t = useT();
  const label = block.label || block.name;
  return (
    <Flex gap={1} wrap="wrap">
      <IconButton
        label={t('settings.blocks.action.edit', 'Edit {label}', { label })}
        variant="ghost"
        onClick={() => onEdit(block)}
      >
        <Pencil />
      </IconButton>
      <IconButton
        label={t('settings.blocks.action.duplicate', 'Duplicate {label}', { label })}
        variant="ghost"
        disabled={busy}
        onClick={() => onDuplicate(block)}
      >
        <Duplicate />
      </IconButton>
      <IconButton
        label={t('settings.blocks.action.moveUp', 'Move {label} up', { label })}
        variant="ghost"
        disabled={busy || index === 0}
        onClick={() => onMove(block, -1)}
      >
        <ArrowUp />
      </IconButton>
      <IconButton
        label={t('settings.blocks.action.moveDown', 'Move {label} down', { label })}
        variant="ghost"
        disabled={busy || index === count - 1}
        onClick={() => onMove(block, 1)}
      >
        <ArrowDown />
      </IconButton>
      <ConfirmAction
        fallbackFocusRef={fallbackFocusRef}
        trigger={
          <IconButton
            label={t('settings.blocks.action.delete', 'Delete {label}', { label })}
            variant="ghost"
            disabled={busy}
          >
            <Trash />
          </IconButton>
        }
        title={t('settings.blocks.delete.title', 'Delete the block {label}?', { label })}
        body={t(
          'settings.blocks.delete.body',
          'The block disappears from the editor toolbox. Content that already uses it keeps its data, but the editor shows it as unavailable until a block named {name} exists again. This cannot be undone.',
          { name: block.name }
        )}
        confirmLabel={t('settings.blocks.delete.confirm', 'Delete block')}
        onConfirm={() => onDelete(block)}
      />
    </Flex>
  );
};

/**
 * Enable/disable switch with an accessible name.
 * @param {{ block: object, busy: boolean, onToggle: Function }} props - Props.
 * @returns {JSX.Element} Switch.
 */
const EnabledSwitch = ({ block, busy, onToggle }) => {
  const t = useT();
  return (
    <Switch
      checked={block.enabled}
      disabled={busy}
      onCheckedChange={(checked) => onToggle(block, checked === true)}
      aria-label={t('settings.blocks.action.toggle', 'Show {label} in the editor toolbox', {
        label: block.label || block.name,
      })}
      onLabel={t('settings.switch.on', 'On')}
      offLabel={t('settings.switch.off', 'Off')}
      visibleLabels
    />
  );
};

/**
 * Block identity (icon, label, name).
 * @param {{ block: object }} props - Block.
 * @returns {JSX.Element} Cell content.
 */
const Identity = ({ block }) => {
  const t = useT();
  return (
    <Flex gap={3} alignItems="center" minWidth={0}>
      {block.icon ? (
        <IconPreview
          svg={block.icon}
          label={t('settings.blocks.list.icon', 'Icon of {label}', { label: block.label })}
        />
      ) : null}
      <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
        <Typography
          variant="omega"
          fontWeight="bold"
          textColor="neutral800"
          style={{ overflowWrap: 'anywhere' }}
        >
          {block.label}
        </Typography>
        <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
          {block.name}
        </Typography>
      </Flex>
    </Flex>
  );
};

/**
 * Custom block list: table from the large breakpoint up, cards below.
 * @param {object} props - Props (blocks, busy map and actions).
 * @returns {JSX.Element} List.
 */
export const BlockList = ({
  blocks,
  busyId,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
  onToggle,
  fallbackFocusRef,
}) => {
  const t = useT();
  const { isBelowLarge } = useBreakpoint();
  const actions = { onEdit, onDuplicate, onMove, onDelete, fallbackFocusRef };

  if (isBelowLarge) {
    return (
      <Flex
        tag="ul"
        direction="column"
        alignItems="stretch"
        gap={3}
        aria-label={t('settings.blocks.list.label', 'Custom blocks')}
      >
        {blocks.map((block, index) => (
          <Box
            tag="li"
            key={block.id}
            background="neutral0"
            hasRadius
            shadow="tableShadow"
            padding={4}
            minWidth={0}
          >
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
                <Identity block={block} />
                <EnabledSwitch block={block} busy={busyId === block.id} onToggle={onToggle} />
              </Flex>
              <Flex gap={2} wrap="wrap">
                <Badge>{blockTypeLabel(t, block.blockType)}</Badge>
              </Flex>
              {block.description ? (
                <Typography variant="pi" textColor="neutral600">
                  {block.description}
                </Typography>
              ) : null}
              <RowActions
                block={block}
                index={index}
                count={blocks.length}
                busy={busyId === block.id}
                {...actions}
              />
            </Flex>
          </Box>
        ))}
      </Flex>
    );
  }

  return (
    <Table colCount={5} rowCount={blocks.length + 1}>
      <Thead>
        <Tr>
          <Th>
            <Typography variant="sigma">{t('settings.blocks.list.block', 'Block')}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('settings.blocks.list.type', 'Type')}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('settings.blocks.list.description', 'Description')}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('settings.blocks.list.enabled', 'In toolbox')}</Typography>
          </Th>
          <Th>
            <VisuallyHidden>{t('settings.blocks.list.actions', 'Actions')}</VisuallyHidden>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {blocks.map((block, index) => (
          <Tr key={block.id}>
            <Td>
              <Identity block={block} />
            </Td>
            <Td>
              <Badge>{blockTypeLabel(t, block.blockType)}</Badge>
            </Td>
            <Td>
              <Typography
                textColor={block.description ? 'neutral800' : 'neutral600'}
                style={{ overflowWrap: 'anywhere' }}
              >
                {block.description || t('settings.blocks.list.noDescription', 'No description')}
              </Typography>
            </Td>
            <Td>
              <EnabledSwitch block={block} busy={busyId === block.id} onToggle={onToggle} />
            </Td>
            <Td>
              <Flex justifyContent="flex-end">
                <RowActions
                  block={block}
                  index={index}
                  count={blocks.length}
                  busy={busyId === block.id}
                  {...actions}
                />
              </Flex>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
};

export default BlockList;

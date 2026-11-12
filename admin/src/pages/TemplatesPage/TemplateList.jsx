import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Flex,
  IconButton,
  Loader,
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
import { ArrowDown, ArrowUp, Duplicate, Eye, Pencil, Trash } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import { ConfirmAction, useBreakpoint, useT } from '../../components/ui';
import { normalizeScope } from '../../../../shared/templates.mjs';
import { API } from '../../utils/api';

/**
 * Template list of the settings page: table from the large breakpoint up,
 * cards below (same fields and actions).
 */

/**
 * Type label.
 * @param {Function} t - Translator.
 * @param {string} kind - `template` | `pattern`.
 * @returns {string} Label.
 */
export const kindLabel = (t, kind) => {
  if (kind === 'pattern') return t('settings.templates.kind.pattern', 'Pattern');
  if (kind === 'synced') return t('settings.templates.kind.synced', 'Synced block');
  return t('settings.templates.kind.template', 'Template');
};

/**
 * Body of the delete confirmation of a synced block: loads how often it is
 * used (`GET /templates/:id/usage`, counts only) when the dialog opens.
 * @param {{ template: object }} props - Synced source.
 * @returns {JSX.Element} Text.
 */
const SyncedUsage = ({ template }) => {
  const t = useT();
  const { get } = useFetchClient();
  const [state, setState] = useState({ status: 'loading', usage: null });
  useEffect(() => {
    const controller = new AbortController();
    get(API.templateUsage(template.id), { signal: controller.signal }).then(
      ({ data }) => {
        if (!controller.signal.aborted) setState({ status: 'ready', usage: data.data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error', usage: null });
      }
    );
    return () => controller.abort();
  }, [get, template.id]);
  const { status, usage } = state;
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {status === 'loading' ? (
        <Loader small>{t('settings.templates.usage.loading', 'Counting where it is used')}</Loader>
      ) : null}
      {status === 'error' ? (
        <Typography textColor="danger600">
          {t('settings.templates.usage.error', 'It could not be counted where this synced block is used.')}
        </Typography>
      ) : null}
      {status === 'ready' ? (
        <Typography textColor="neutral800" data-testid="mex-synced-usage">
          {!usage.entries && !usage.templates && usage.complete
            ? t('settings.templates.usage.none', 'It is not used in any entry, template or pattern.')
            : usage.complete
              ? t(
                  'settings.templates.usage.count',
                  'It is used in {entries, plural, one {# entry} other {# entries}} ({fields, plural, one {# field} other {# fields}}) and {templates, plural, one {# template or pattern} other {# templates or patterns}}.',
                  usage
                )
              : t(
                  'settings.templates.usage.countAtLeast',
                  'It is used in at least {entries, plural, one {# entry} other {# entries}} ({fields, plural, one {# field} other {# fields}}) and {templates, plural, one {# template or pattern} other {# templates or patterns}}. Not every entry could be checked.',
                  usage
                )}
        </Typography>
      ) : null}
      <Typography textColor="neutral800">
        {t(
          'settings.templates.delete.syncedBody',
          'After deleting it, these places show nothing where the synced block was, on the website and in the API. Editors see "Synced block removed". This cannot be undone.'
        )}
      </Typography>
    </Flex>
  );
};

/**
 * Where a template is offered, in one short line.
 * @param {Function} t - Translator.
 * @param {object} scope - Template scope.
 * @returns {string} Summary.
 */
const scopeSummary = (t, scope) => {
  const clean = normalizeScope(scope);
  if (clean.all) return t('settings.templates.scope.all', 'Every field');
  return t('settings.templates.scope.limited', 'Selected presets and fields ({count})', {
    count: clean.presets.length + clean.fields.length,
  });
};

/**
 * Row actions shared by the table and the cards.
 * @param {object} props - Props.
 * @returns {JSX.Element} Actions.
 */
const RowActions = ({
  template,
  index,
  count,
  busy,
  onPreview,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
  fallbackFocusRef,
}) => {
  const t = useT();
  const name = template.name;
  return (
    <Flex gap={1} wrap="wrap">
      <IconButton
        label={t('settings.templates.action.preview', 'Preview {name}', { name })}
        variant="ghost"
        onClick={() => onPreview(template)}
      >
        <Eye />
      </IconButton>
      <IconButton
        label={t('settings.templates.action.edit', 'Edit {name}', { name })}
        variant="ghost"
        onClick={() => onEdit(template)}
      >
        <Pencil />
      </IconButton>
      <IconButton
        label={t('settings.templates.action.duplicate', 'Duplicate {name}', { name })}
        variant="ghost"
        disabled={busy}
        onClick={() => onDuplicate(template)}
      >
        <Duplicate />
      </IconButton>
      <IconButton
        label={t('settings.templates.action.moveUp', 'Move {name} up', { name })}
        variant="ghost"
        disabled={busy || index === 0}
        onClick={() => onMove(template, -1)}
      >
        <ArrowUp />
      </IconButton>
      <IconButton
        label={t('settings.templates.action.moveDown', 'Move {name} down', { name })}
        variant="ghost"
        disabled={busy || index === count - 1}
        onClick={() => onMove(template, 1)}
      >
        <ArrowDown />
      </IconButton>
      <ConfirmAction
        fallbackFocusRef={fallbackFocusRef}
        trigger={
          <IconButton
            label={t('settings.templates.action.delete', 'Delete {name}', { name })}
            variant="ghost"
            disabled={busy}
          >
            <Trash />
          </IconButton>
        }
        title={
          template.kind === 'synced'
            ? t('settings.templates.delete.syncedTitle', 'Delete the synced block {name}?', { name })
            : t('settings.templates.delete.title', 'Delete the template {name}?', { name })
        }
        body={
          template.kind === 'synced' ? (
            <SyncedUsage template={template} />
          ) : (
            t(
              'settings.templates.delete.body',
              'Editors can no longer insert it. Content that was created from it stays unchanged. This cannot be undone.'
            )
          )
        }
        confirmLabel={
          template.kind === 'synced'
            ? t('settings.templates.delete.syncedConfirm', 'Delete synced block')
            : t('settings.templates.delete.confirm', 'Delete template')
        }
        onConfirm={() => onDelete(template)}
      />
    </Flex>
  );
};

/**
 * Availability switch with an accessible name.
 * @param {{ template: object, busy: boolean, onToggle: Function }} props - Props.
 * @returns {JSX.Element} Switch.
 */
const EnabledSwitch = ({ template, busy, onToggle }) => {
  const t = useT();
  return (
    <Switch
      checked={template.enabled}
      disabled={busy}
      onCheckedChange={(checked) => onToggle(template, checked === true)}
      aria-label={t('settings.templates.action.toggle', 'Offer {name} in the editor', {
        name: template.name,
      })}
      onLabel={t('settings.switch.on', 'On')}
      offLabel={t('settings.switch.off', 'Off')}
      visibleLabels
    />
  );
};

/**
 * Name and description.
 * @param {{ template: object }} props - Template.
 * @returns {JSX.Element} Cell content.
 */
const Identity = ({ template }) => {
  const t = useT();
  return (
    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
      <Typography
        variant="omega"
        fontWeight="bold"
        textColor="neutral800"
        style={{ overflowWrap: 'anywhere' }}
      >
        {template.name}
      </Typography>
      <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
        {template.description || t('settings.templates.noDescription', 'No description')}
      </Typography>
    </Flex>
  );
};

/**
 * @param {object} props - Props (templates, busy id and actions).
 * @returns {JSX.Element} List.
 */
export const TemplateList = ({ templates, busyId, onToggle, ...actions }) => {
  const t = useT();
  const { isBelowLarge } = useBreakpoint();
  const blocksText = (template) =>
    t('settings.templates.blocks', '{count, plural, one {# block} other {# blocks}}', {
      count: template.blockCount,
    });

  if (isBelowLarge) {
    return (
      <Flex
        tag="ul"
        direction="column"
        alignItems="stretch"
        gap={3}
        aria-label={t('settings.templates.list.label', 'Templates')}
      >
        {templates.map((template, index) => (
          <Box
            tag="li"
            key={template.id}
            background="neutral0"
            hasRadius
            shadow="tableShadow"
            padding={4}
            minWidth={0}
          >
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
                <Identity template={template} />
                <EnabledSwitch template={template} busy={busyId === template.id} onToggle={onToggle} />
              </Flex>
              <Flex gap={2} wrap="wrap">
                <Badge>{kindLabel(t, template.kind)}</Badge>
                <Typography variant="pi" textColor="neutral600">
                  {scopeSummary(t, template.scope)}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {blocksText(template)}
                </Typography>
              </Flex>
              <RowActions
                template={template}
                index={index}
                count={templates.length}
                busy={busyId === template.id}
                {...actions}
              />
            </Flex>
          </Box>
        ))}
      </Flex>
    );
  }

  return (
    <Table colCount={5} rowCount={templates.length + 1}>
      <Thead>
        <Tr>
          <Th>
            <Typography variant="sigma">{t('settings.templates.list.name', 'Name')}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('settings.templates.list.kind', 'Type')}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('settings.templates.list.scope', 'Offered in')}</Typography>
          </Th>
          <Th>
            <Typography variant="sigma">{t('settings.templates.list.enabled', 'In the editor')}</Typography>
          </Th>
          <Th>
            <VisuallyHidden>{t('settings.templates.list.actions', 'Actions')}</VisuallyHidden>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {templates.map((template, index) => (
          <Tr key={template.id}>
            <Td>
              <Identity template={template} />
            </Td>
            <Td>
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Badge>{kindLabel(t, template.kind)}</Badge>
                <Typography variant="pi" textColor="neutral600">
                  {blocksText(template)}
                </Typography>
              </Flex>
            </Td>
            <Td>
              <Typography textColor="neutral800">{scopeSummary(t, template.scope)}</Typography>
            </Td>
            <Td>
              <EnabledSwitch template={template} busy={busyId === template.id} onToggle={onToggle} />
            </Td>
            <Td>
              <Flex justifyContent="flex-end">
                <RowActions
                  template={template}
                  index={index}
                  count={templates.length}
                  busy={busyId === template.id}
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

export default TemplateList;

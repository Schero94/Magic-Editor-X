import { Fragment, forwardRef, useRef } from 'react';
import { Badge, Flex, Menu, Typography } from '@strapi/design-system';
import { Check } from '@strapi/icons';
import styled from 'styled-components';
import { ariaShortcut, badgeText, formatShortcut, groupFieldTools } from '../../editor/field-tools.mjs';

/**
 * "More tools": the one menu that holds every secondary tool of an editor
 * field, grouped into Review, Write and View. The entries come from the
 * field tool registry (`editor/field-tools.mjs`); this component only renders
 * them.
 */

/**
 * Section heading of a group.
 * @param {Function} t - Translator.
 * @param {string} group - Group id.
 * @returns {string} Label.
 */
const groupLabel = (t, group) => {
  if (group === 'review') return t('editor.tools.group.review', 'Review');
  if (group === 'write') return t('editor.tools.group.write', 'Write');
  return t('editor.tools.group.view', 'View');
};

// The DS menu caps its height at 15rem (150 px); the grouped list may use the room Radix reports.
const CONTENT_MAX_HEIGHT = 'min(48rem, var(--radix-dropdown-menu-content-available-height, 48rem))';
const CONTENT_MAX_WIDTH = 'min(36rem, var(--radix-dropdown-menu-content-available-width, 36rem))';

const Shortcut = styled(Typography)`
  white-space: nowrap;
`;

/**
 * End slot of an item: count badge, on-state check and keyboard shortcut (all decorative; the
 * accessible name, `aria-checked` and `aria-keyshortcuts` carry the same information).
 * @param {{ entry: object }} props - Props.
 * @returns {JSX.Element|null} End slot.
 */
const ItemEnd = ({ entry }) => {
  const count = entry.badge && entry.badge.count > 0 ? entry.badge.count : 0;
  const shortcut = formatShortcut(entry.shortcut);
  if (!count && !entry.pressed && !shortcut) return null;
  return (
    <Flex gap={2} alignItems="center">
      {count ? (
        <Badge
          size="S"
          backgroundColor={
            entry.badge.tone === 'danger'
              ? 'danger100'
              : entry.badge.tone === 'warning'
                ? 'warning100'
                : 'primary100'
          }
          textColor={
            entry.badge.tone === 'danger'
              ? 'danger700'
              : entry.badge.tone === 'warning'
                ? 'neutral800'
                : 'primary700'
          }
        >
          {badgeText(count)}
        </Badge>
      ) : null}
      {entry.pressed ? <Check fill="primary600" /> : null}
      {shortcut ? (
        <Shortcut variant="pi" textColor="neutral600">
          {shortcut}
        </Shortcut>
      ) : null}
    </Flex>
  );
};

/**
 * ARIA attributes of an item. Only defined keys are returned: the DS item passes its props to the
 * Radix slot, where an explicit `role: undefined` would replace Radix's own `menuitem` role.
 * @param {object} entry - Registry entry.
 * @param {boolean} toggle - The entry is a toggle.
 * @param {number} count - Badge count.
 * @returns {object} Attributes.
 */
const itemAria = (entry, toggle, count) => {
  const attributes = {};
  if (toggle) {
    attributes.role = 'menuitemcheckbox';
    attributes['aria-checked'] = Boolean(entry.pressed);
  }
  const keys = ariaShortcut(entry.shortcut);
  if (keys) attributes['aria-keyshortcuts'] = keys;
  if (count && entry.badge.label) attributes['aria-label'] = entry.badge.label;
  return attributes;
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {Array<object>} props.tools - Field tool registry entries.
 * @param {boolean} [props.disabled] - Disables the trigger (editor not ready).
 * @param {import('react').Ref<HTMLButtonElement>} ref - Trigger ref (focus returns here when a panel closes).
 * @returns {JSX.Element|null} Menu, or nothing without visible tools.
 */
export const FieldToolsMenu = forwardRef(({ t, tools, disabled = false }, ref) => {
  const sections = groupFieldTools(tools);
  // The chosen tool runs after the menu has closed and released focus (Radix traps focus inside an
  // open menu, so a panel that focuses its input while the menu is still open loses focus to <body>).
  const pendingRef = useRef(null);
  if (!sections.length) return null;
  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) pendingRef.current = null;
      }}
    >
      <Menu.Trigger ref={ref} size="S" variant="ghost" disabled={disabled} data-testid="mex-tools-menu">
        {t('editor.toolbar.more', 'More tools')}
      </Menu.Trigger>
      <Menu.Content
        popoverPlacement="bottom-start"
        maxHeight={CONTENT_MAX_HEIGHT}
        maxWidth={CONTENT_MAX_WIDTH}
        minWidth="24rem"
        onCloseAutoFocus={(event) => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (!pending) return;
          // A tool that moves focus itself (panel input, dialog) keeps it; others return to the trigger.
          if (pending.movesFocus) event.preventDefault();
          pending.onSelect();
        }}
      >
        {sections.map((section, sectionIndex) => (
          <Fragment key={section.group}>
            {sectionIndex > 0 ? <Menu.Separator /> : null}
            <Menu.Label>{groupLabel(t, section.group)}</Menu.Label>
            {section.items.map((entry) => {
              const toggle = typeof entry.pressed === 'boolean';
              const count = entry.badge && entry.badge.count > 0 ? entry.badge.count : 0;
              return (
                <Menu.Item
                  key={entry.id}
                  onSelect={() => {
                    pendingRef.current = entry;
                  }}
                  disabled={Boolean(entry.disabled)}
                  startIcon={entry.icon || undefined}
                  endIcon={<ItemEnd entry={entry} />}
                  data-testid={`mex-tool-${entry.id}`}
                  {...itemAria(entry, toggle, count)}
                >
                  {entry.label}
                </Menu.Item>
              );
            })}
          </Fragment>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
});

FieldToolsMenu.displayName = 'FieldToolsMenu';

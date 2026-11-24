import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Box, Flex, Popover, Tooltip, Typography } from '@strapi/design-system';
import { Minus, Pencil } from '@strapi/icons';
import styled, { useTheme } from 'styled-components';
import { MARKABLE_ID, publishedChangesCss } from '../../../../shared/published-changes.mjs';
import { blockText } from '../../../../shared/diff.mjs';
import { Deleted, DiffText, EntryFields } from './VersionDiff';

/**
 * "Changes since last publish" marks (2.11).
 *
 * - Added and changed blocks get a bar at the inline start (success and warning colour) from a
 *   scoped style sheet that selects the blocks by `data-id`. Editor.js' own DOM is never touched,
 *   so nothing reaches the saved value, the undo history or collaboration.
 * - A changed block gets a marker at the inline end (next to comment and suggestion markers) that
 *   opens a read-only word diff in a popover.
 * - Removed blocks are collapsed into one "n removed blocks" marker at the place they had; it opens
 *   their text read-only in a popover.
 *
 * Markers sit in a layer next to the Editor.js holder (like the comment markers) and follow the
 * blocks on content changes, resizes and scrolling.
 */

/** Markers drawn at most per kind (the counts in the bar stay complete). */
const MAX_MARKERS = 200;
/** Removed blocks listed at most in one popover. */
const MAX_REMOVED_SHOWN = 50;
/** Room above a block that follows removed blocks; the marker sits in it. */
const GAP = '4rem';

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
`;

const ChangedMarker = styled.button`
  position: absolute;
  inset-inline-end: ${({ theme, $column }) =>
    $column ? `calc(${theme.spaces[1]} + ${$column} * (3.2rem + ${theme.spaces[1]}))` : theme.spaces[1]};
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.2rem;
  height: 3.2rem;
  padding: 0;
  border: 1px solid ${({ theme }) => theme.colors.warning200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.warning100};
  color: ${({ theme }) => theme.colors.warning700};
  cursor: pointer;
  svg {
    width: 1.4rem;
    height: 1.4rem;
    fill: currentColor;
  }
  &:hover {
    background: ${({ theme }) => theme.colors.warning200};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const RemovedMarker = styled.button`
  position: absolute;
  inset-inline-start: ${({ theme }) => theme.spaces[1]};
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spaces[1]};
  min-height: 3.2rem;
  max-width: calc(100% - ${({ theme }) => theme.spaces[2]});
  padding: 0 ${({ theme }) => theme.spaces[2]};
  border: 1px dashed ${({ theme }) => theme.colors.neutral500};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  svg {
    flex: none;
    width: 1.2rem;
    height: 1.2rem;
    fill: currentColor;
  }
  &:hover {
    background: ${({ theme }) => theme.colors.neutral150};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

/** Stable empty state (no re-render when there is nothing to place). */
const NO_POSITIONS = { changed: [], removed: [] };

const PopoverBody = styled(Box)`
  min-width: 0;
  width: min(48rem, calc(100vw - 3.2rem));
  max-height: min(40rem, 60vh);
  overflow: auto;
`;

/**
 * Read-only text of the blocks removed at one place.
 * @param {{ entries: object[], t: Function }} props - Removed diff entries and translator.
 * @returns {JSX.Element} List.
 */
const RemovedList = ({ entries, t }) => {
  const empty = t('editor.history.diff.empty', '(empty)');
  const shown = entries.slice(0, MAX_REMOVED_SHOWN);
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Flex tag="ol" direction="column" alignItems="stretch" gap={2}>
        {shown.map((entry, index) => (
          <Box tag="li" key={`${entry.id}-${index}`} minWidth={0}>
            <Typography variant="sigma" textColor="neutral600">
              {entry.type}
            </Typography>
            <DiffText tag="p" variant="pi" textColor="neutral800">
              <Deleted>{blockText(entry.before) || empty}</Deleted>
            </DiffText>
          </Box>
        ))}
      </Flex>
      {entries.length > shown.length ? (
        <Typography variant="pi" textColor="neutral600">
          {t(
            'editor.publishedChanges.moreRemoved',
            '{count, plural, one {# more removed block is} other {# more removed blocks are}} not shown.',
            { count: entries.length - shown.length }
          )}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * @param {object} props - Props.
 * @param {string} props.scope - Value of `data-mex-changes` on the editor area (scopes the style sheet).
 * @param {{ current: HTMLElement|null }} props.containerRef - Positioned element around the holder.
 * @param {{ current: HTMLElement|null }} props.holderRef - Editor.js holder.
 * @param {import('../../../../shared/published-changes.mjs').PublishedChanges|null} props.changes - Classification.
 * @param {string[]} props.blockIds - Current block ids in document order (for "Block n" labels).
 * @param {(blockId: string) => number} [props.columnOf] - Markers already at the inline end of a block (comments, suggestions).
 * @param {number} props.version - Changes when the content changed.
 * @param {Function} props.t - Translator.
 * @returns {JSX.Element|null} Style sheet and marker layer.
 */
export const PublishedChangeMarks = ({
  scope,
  containerRef,
  holderRef,
  changes,
  blockIds,
  columnOf,
  version,
  t,
}) => {
  const theme = useTheme();
  const [positions, setPositions] = useState(NO_POSITIONS);
  const frame = useRef(0);
  const css = useMemo(
    () =>
      publishedChangesCss(changes, {
        scope,
        added: theme.colors.success600,
        changed: theme.colors.warning700,
        gap: GAP,
        width: '3px',
      }),
    [changes, scope, theme]
  );

  useLayoutEffect(() => {
    // The container is a parent of this layer: its ref is attached after this effect runs, so the
    // refs are read in the next frame (React 19 does not run the effect a second time).
    let holder = null;
    let observer = null;
    let disposed = false;
    const find = (id) => (MARKABLE_ID.test(id) ? holder.querySelector(`.ce-block[data-id="${id}"]`) : null);
    const measure = () => {
      const container = containerRef.current;
      if (!container || !holder || !changes) {
        setPositions(NO_POSITIONS);
        return;
      }
      const origin = container.getBoundingClientRect();
      const changed = [];
      for (const [id, mark] of changes.marks) {
        if (mark.kind !== 'changed' || changed.length >= MAX_MARKERS) continue;
        const block = find(id);
        if (!block) continue;
        changed.push({ id, mark, top: block.getBoundingClientRect().top - origin.top });
      }
      const removed = [];
      const blocks = holder.querySelectorAll('.ce-block');
      const last = blocks.length ? blocks[blocks.length - 1] : null;
      changes.removed.slice(0, MAX_MARKERS).forEach((group, index) => {
        let top = null;
        if (group.before) {
          const block = find(group.before);
          if (block) top = block.getBoundingClientRect().top - origin.top;
        } else if (last) top = last.getBoundingClientRect().bottom - origin.top;
        // The marker sits in the room the style sheet opens above the block (or below the last one).
        if (top !== null) removed.push({ key: `${group.before || 'end'}-${index}`, group, top });
      });
      setPositions({ changed, removed });
    };
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    const start = requestAnimationFrame(() => {
      if (disposed) return;
      holder = holderRef.current;
      if (holder) {
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(update);
          observer.observe(holder);
        }
        holder.addEventListener('scroll', update, true);
      }
      measure();
    });
    window.addEventListener('resize', update);
    return () => {
      disposed = true;
      cancelAnimationFrame(start);
      cancelAnimationFrame(frame.current);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', update);
      if (holder) holder.removeEventListener('scroll', update, true);
    };
  }, [containerRef, holderRef, changes, version, css]);

  if (!changes) return null;
  const indexOf = (id) => blockIds.indexOf(id) + 1;
  const empty = t('editor.history.diff.empty', '(empty)');
  return (
    <>
      {css ? <style data-mex-changes-style={scope}>{css}</style> : null}
      {positions.changed.length || positions.removed.length ? (
        <Layer data-testid="mex-published-marks">
          {positions.changed.map(({ id, mark, top }) => {
            const label = mark.moved
              ? t(
                  'editor.publishedChanges.movedMarker',
                  'Show how block {index} changed since the last publish (moved)',
                  {
                    index: indexOf(id),
                  }
                )
              : t(
                  'editor.publishedChanges.changedMarker',
                  'Show what changed in block {index} since the last publish',
                  {
                    index: indexOf(id),
                  }
                );
            return (
              <Popover.Root key={id}>
                <Tooltip label={label}>
                  <Popover.Trigger>
                    <ChangedMarker
                      type="button"
                      style={{ top }}
                      $column={columnOf ? columnOf(id) : 0}
                      aria-label={label}
                      data-block-id={id}
                      data-testid="mex-published-changed"
                    >
                      <Pencil aria-hidden="true" focusable="false" />
                    </ChangedMarker>
                  </Popover.Trigger>
                </Tooltip>
                <Popover.Content
                  side="bottom"
                  align="end"
                  aria-label={t('editor.publishedChanges.diffTitle', 'Changes since the last publish')}
                >
                  <PopoverBody padding={3} data-testid="mex-published-diff">
                    <Flex direction="column" alignItems="stretch" gap={2}>
                      <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="h3">
                        {t('editor.publishedChanges.diffTitle', 'Changes since the last publish')}
                      </Typography>
                      <Flex gap={2} wrap="wrap">
                        {mark.moved ? <Badge>{t('editor.history.diff.op.moved', 'Moved')}</Badge> : null}
                        {mark.entry.fields ? (
                          <Badge>{t('editor.history.diff.op.changed', 'Changed')}</Badge>
                        ) : null}
                        {mark.entry.formattingOnly ? (
                          <Badge>{t('editor.history.diff.formatting', 'Formatting only')}</Badge>
                        ) : null}
                      </Flex>
                      {mark.entry.fields ? (
                        <EntryFields entry={mark.entry} t={t} empty={empty} />
                      ) : (
                        <Typography variant="pi" textColor="neutral600">
                          {t(
                            'editor.publishedChanges.movedOnly',
                            'This block moved. Its content is the same as in the published version.'
                          )}
                        </Typography>
                      )}
                    </Flex>
                  </PopoverBody>
                </Popover.Content>
              </Popover.Root>
            );
          })}
          {positions.removed.map(({ key, group, top }) => {
            const text = t(
              'editor.publishedChanges.removedMarker',
              '{count, plural, one {# removed block} other {# removed blocks}}',
              { count: group.entries.length }
            );
            return (
              <Popover.Root key={key}>
                <Popover.Trigger>
                  <RemovedMarker
                    type="button"
                    style={{
                      top: group.before ? `calc(${top}px - ${GAP} + 0.4rem)` : `calc(${top}px + 0.4rem)`,
                    }}
                    data-testid="mex-published-removed"
                    aria-label={t(
                      'editor.publishedChanges.removedLabel',
                      'Show {count, plural, one {# block} other {# blocks}} removed since the last publish',
                      { count: group.entries.length }
                    )}
                  >
                    <Minus aria-hidden="true" focusable="false" />
                    <span>{text}</span>
                  </RemovedMarker>
                </Popover.Trigger>
                <Popover.Content
                  side="bottom"
                  align="start"
                  aria-label={t('editor.publishedChanges.removedTitle', 'Removed since the last publish')}
                >
                  <PopoverBody padding={3} data-testid="mex-published-removed-list">
                    <Flex direction="column" alignItems="stretch" gap={2}>
                      <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="h3">
                        {t('editor.publishedChanges.removedTitle', 'Removed since the last publish')}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600">
                        {t(
                          'editor.publishedChanges.readOnly',
                          'Read only. Version history can bring a block back.'
                        )}
                      </Typography>
                      <RemovedList entries={group.entries} t={t} />
                    </Flex>
                  </PopoverBody>
                </Popover.Content>
              </Popover.Root>
            );
          })}
        </Layer>
      ) : null}
    </>
  );
};

export default PublishedChangeMarks;

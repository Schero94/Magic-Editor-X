import { useMemo } from 'react';
import { Badge, Box, Button, Flex, Typography, VisuallyHidden } from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import styled from 'styled-components';
import { blockText, diffDocuments, summarizeDiff } from '../../../../shared/diff.mjs';

/**
 * "Changes" view of a version: what changed in the editor since this version.
 *
 * Everything is rendered as React text nodes. Old versions are untrusted
 * input and are never inserted as HTML here. Added and removed text is marked with
 * colour, underline/strike-through and visually hidden labels, so the change
 * is not conveyed by colour alone.
 */

/** Entries shown at most; the rest is counted. */
const MAX_ENTRIES = 200;
const MAX_VALUE_CHARS = 200;

const OPS = {
  added: { key: 'editor.history.diff.op.added', text: 'Added since this version', border: 'success600' },
  removed: { key: 'editor.history.diff.op.removed', text: 'Removed since this version', border: 'danger600' },
  changed: { key: 'editor.history.diff.op.changed', text: 'Changed', border: 'warning600' },
  moved: { key: 'editor.history.diff.op.moved', text: 'Moved', border: 'neutral500' },
};

const Inserted = styled.ins`
  background: ${({ theme }) => theme.colors.success100};
  color: ${({ theme }) => theme.colors.success700};
  text-decoration: underline;
`;

const Deleted = styled.del`
  background: ${({ theme }) => theme.colors.danger100};
  color: ${({ theme }) => theme.colors.danger700};
  text-decoration: line-through;
`;

const Entry = styled(Box)`
  min-width: 0;
  border-inline-start: 4px solid ${({ theme, $tone }) => theme.colors[$tone]};
`;

const Text = styled(Typography)`
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

/**
 * Short, single-line text of a value for value diffs.
 * @param {unknown} value - Value.
 * @param {string} empty - Text for missing values.
 * @returns {string} Text.
 */
const valueText = (value, empty) => {
  if (value === undefined || value === null || value === '') return empty;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
};

/** Labels of the built-in tunes. */
const TUNE_LABELS = {
  alignmentTune: { key: 'editor.history.diff.tune.alignmentTune', text: 'Alignment' },
  textVariant: { key: 'editor.history.diff.tune.textVariant', text: 'Text variant' },
  indentTune: { key: 'editor.history.diff.tune.indentTune', text: 'Indent' },
};

/** Labels of built-in tune values (indent levels are shown as numbers). */
const TUNE_VALUES = {
  alignmentTune: {
    left: { key: 'editor.history.diff.tune.value.left', text: 'left' },
    center: { key: 'editor.history.diff.tune.value.center', text: 'center' },
    right: { key: 'editor.history.diff.tune.value.right', text: 'right' },
    justify: { key: 'editor.history.diff.tune.value.justify', text: 'justified' },
  },
  textVariant: {
    '': { key: 'editor.history.diff.tune.value.none', text: 'none' },
    'call-out': { key: 'editor.history.diff.tune.value.callOut', text: 'call-out' },
    citation: { key: 'editor.history.diff.tune.value.citation', text: 'citation' },
    details: { key: 'editor.history.diff.tune.value.details', text: 'details' },
  },
};

/**
 * Human-readable text of one tune value.
 * @param {{ tune: string, known: boolean }} change - Tune change.
 * @param {string|number|null} value - Value (plain for built-in tunes, canonical JSON otherwise).
 * @param {Function} t - Translator.
 * @param {string} empty - Text for missing values.
 * @returns {string} Text.
 */
export const tuneValueText = (change, value, t, empty) => {
  if (value === null || value === undefined) return empty;
  const label = change.known && TUNE_VALUES[change.tune] && TUNE_VALUES[change.tune][value];
  if (label) return t(label.key, label.text);
  return valueText(String(value), empty);
};

/**
 * Human-readable name of a tune.
 * @param {string} tune - Tune name.
 * @param {Function} t - Translator.
 * @returns {string} Label.
 */
export const tuneLabel = (tune, t) =>
  TUNE_LABELS[tune] ? t(TUNE_LABELS[tune].key, TUNE_LABELS[tune].text) : tune;

/**
 * Finds where a block that no longer exists would go back: after the nearest
 * earlier block that is still in the editor, else before the next one.
 * @param {Array<object>} entries - Diff entries.
 * @param {number} index - Entry index.
 * @returns {{ afterId: string|null, beforeId: string|null }} Neighbours in the current content.
 */
export const neighboursOf = (entries, index) => {
  for (let i = index - 1; i >= 0; i -= 1)
    if (entries[i].after) return { afterId: entries[i].after.id, beforeId: null };
  for (let i = index + 1; i < entries.length; i += 1)
    if (entries[i].after) return { afterId: null, beforeId: entries[i].after.id };
  return { afterId: null, beforeId: null };
};

/**
 * @param {{ ops: Array<{ op: string, text: string }>, t: Function }} props - Text ops.
 * @returns {JSX.Element} Inline diff.
 */
const TextOps = ({ ops, t }) => (
  <Text tag="p" variant="pi" textColor="neutral800">
    {ops.map((op, index) => {
      if (op.op === 'insert')
        return (
          <Inserted key={index}>
            <VisuallyHidden>{t('editor.history.diff.inserted', 'Added text:')} </VisuallyHidden>
            {op.text}
          </Inserted>
        );
      if (op.op === 'delete')
        return (
          <Deleted key={index}>
            <VisuallyHidden>{t('editor.history.diff.deleted', 'Removed text:')} </VisuallyHidden>
            {op.text}
          </Deleted>
        );
      return <span key={index}>{op.text}</span>;
    })}
  </Text>
);

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object} props.version - Version content (older side).
 * @param {object} props.current - Current editor content (newer side).
 * @param {number} props.versionNumber - Version number (for labels).
 * @param {boolean} props.canRestore - Whether blocks can be restored.
 * @param {(entry: object, position: object) => void} props.onRestoreBlock - Restores one block.
 * @returns {JSX.Element} Diff view.
 */
export const VersionDiff = ({ t, version, current, versionNumber, canRestore, onRestoreBlock }) => {
  const entries = useMemo(() => diffDocuments(version, current), [version, current]);
  const counts = useMemo(() => summarizeDiff(entries), [entries]);
  const visible = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.op !== 'equal');
  const shown = visible.slice(0, MAX_ENTRIES);
  const empty = t('editor.history.diff.empty', '(empty)');

  if (visible.length === 0) {
    return (
      <Typography variant="pi" textColor="neutral600">
        {t('editor.history.diff.none', 'This version has the same content as the editor.')}
      </Typography>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Typography variant="pi" textColor="neutral600">
        {t(
          'editor.history.diff.help',
          'Compared with the current editor content: "Added" is new in the editor since this version, "Removed" was in this version only.'
        )}
      </Typography>
      <Typography variant="omega" fontWeight="bold" textColor="neutral800" role="status">
        {t(
          'editor.history.diff.summary',
          '{changed} changed · {added} added · {removed} removed · {moved} moved',
          counts
        )}
      </Typography>
      <Flex tag="ol" direction="column" alignItems="stretch" gap={2}>
        {shown.map(({ entry, index }) => {
          const op = OPS[entry.op] || OPS.changed;
          const restorable =
            canRestore && entry.before && (entry.op === 'removed' || entry.op === 'changed' || entry.changed);
          const position =
            entry.op === 'removed'
              ? neighboursOf(entries, index)
              : { replaceId: entry.after ? entry.after.id : null, afterId: null, beforeId: null };
          return (
            <Entry
              tag="li"
              key={`${entry.op}-${entry.id}-${index}`}
              $tone={op.border}
              padding={3}
              background="neutral0"
              hasRadius
            >
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Flex gap={2} wrap="wrap" alignItems="center">
                  <Badge>{t(op.key, op.text)}</Badge>
                  {entry.op === 'moved' && entry.changed ? (
                    <Badge>{t(OPS.changed.key, OPS.changed.text)}</Badge>
                  ) : null}
                  {entry.formattingOnly ? (
                    <Badge>{t('editor.history.diff.formatting', 'Formatting only')}</Badge>
                  ) : null}
                  <Typography variant="pi" textColor="neutral600">
                    {entry.type}
                  </Typography>
                </Flex>
                {entry.op === 'added' ? (
                  <Text tag="p" variant="pi" textColor="neutral800">
                    <Inserted>{blockText(entry.after) || empty}</Inserted>
                  </Text>
                ) : null}
                {entry.op === 'removed' ? (
                  <Text tag="p" variant="pi" textColor="neutral800">
                    <Deleted>{blockText(entry.before) || empty}</Deleted>
                  </Text>
                ) : null}
                {(entry.fields || []).map((field) => (
                  <Box key={field.path} minWidth={0}>
                    {field.kind !== 'tunes' && (entry.fields.length > 1 || field.kind === 'value') ? (
                      <Typography variant="sigma" textColor="neutral600">
                        {field.path}
                      </Typography>
                    ) : null}
                    {field.kind === 'tunes' ? (
                      <Flex tag="ul" direction="column" alignItems="stretch" gap={1}>
                        {field.changes.map((change) => (
                          <Text key={change.tune} tag="li" variant="pi" textColor="neutral800">
                            {t('editor.history.diff.tune.change', '{tune}: {before} → {after}', {
                              tune: tuneLabel(change.tune, t),
                              before: tuneValueText(change, change.before, t, empty),
                              after: tuneValueText(change, change.after, t, empty),
                            })}
                          </Text>
                        ))}
                      </Flex>
                    ) : field.kind === 'text' ? (
                      <TextOps ops={field.ops} t={t} />
                    ) : (
                      <Text tag="p" variant="pi" textColor="neutral800">
                        <Deleted>
                          <VisuallyHidden>
                            {t('editor.history.diff.deleted', 'Removed text:')}{' '}
                          </VisuallyHidden>
                          {valueText(field.before, empty)}
                        </Deleted>
                        {' → '}
                        <Inserted>
                          <VisuallyHidden>{t('editor.history.diff.inserted', 'Added text:')} </VisuallyHidden>
                          {valueText(field.after, empty)}
                        </Inserted>
                      </Text>
                    )}
                  </Box>
                ))}
                {restorable ? (
                  <Flex>
                    <Button
                      variant="tertiary"
                      size="S"
                      startIcon={<ArrowClockwise />}
                      aria-label={t(
                        'editor.history.diff.restoreBlockLabel',
                        'Restore block {number} from version {version}',
                        { number: (entry.beforeIndex ?? 0) + 1, version: versionNumber }
                      )}
                      onClick={() => onRestoreBlock(entry, position)}
                    >
                      {t('editor.history.diff.restoreBlock', 'Restore this block')}
                    </Button>
                  </Flex>
                ) : null}
              </Flex>
            </Entry>
          );
        })}
      </Flex>
      {visible.length > shown.length ? (
        <Typography variant="pi" textColor="neutral600">
          {t(
            'editor.history.diff.more',
            '{count, plural, one {# more change is} other {# more changes are}} not shown.',
            { count: visible.length - shown.length }
          )}
        </Typography>
      ) : null}
    </Flex>
  );
};

import { useEffect, useState } from 'react';
import { Badge, Box, Flex, IconButton, Typography, VisuallyHidden } from '@strapi/design-system';
import { ArrowRight, Pencil, Trash } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction } from '../ui';
import { FOOTNOTE_SELECTOR } from '../../editor/tools/footnote';
import { noteText } from '../../editor/tools/footnote-logic.mjs';

/**
 * Footnote list under the editor (2.4): the footnotes of the field in
 * reading order, as the readers will see them numbered, with the note text,
 * "Go to", "Edit" and "Remove". It reads the markers from the editor (so it
 * follows typing, undo, paste and collaborators' edits) and is shown only
 * when the field has footnotes.
 */

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[2]};
`;

const Item = styled.li`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

const Number = styled.span`
  flex: none;
  min-width: 2.4rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary700};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  line-height: 3.2rem;
`;

const Text = styled(Typography)`
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-top: ${({ theme }) => theme.spaces[1]};
`;

/**
 * Footnotes currently in the editor.
 * @param {HTMLElement|null} holder - Editor holder.
 * @returns {Array<{ key: string, id: string, note: string, text: string }>} Footnotes in reading order.
 */
export const readFootnotes = (holder) =>
  holder
    ? Array.from(holder.querySelectorAll(FOOTNOTE_SELECTOR)).map((marker, index) => {
        const note = marker.getAttribute('data-mex-note') || '';
        return {
          key: `${marker.getAttribute('data-mex-footnote')}-${index}`,
          id: marker.getAttribute('data-mex-footnote') || '',
          note,
          text: noteText(note),
        };
      })
    : [];

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {string} props.id - Unique id prefix of the field.
 * @param {{ current: HTMLElement|null }} props.holderRef - Editor holder.
 * @param {boolean} props.ready - Editor ready.
 * @param {boolean} props.readOnly - View only.
 * @param {(index: number) => void} props.onEdit - Opens the note of the n-th footnote.
 * @param {(index: number) => void} props.onGoTo - Shows the n-th marker in the editor.
 * @param {(index: number) => void} props.onRemove - Removes the n-th footnote.
 * @returns {JSX.Element|null} Panel.
 */
export const FootnotesPanel = ({ t, id, holderRef, ready, readOnly, onEdit, onGoTo, onRemove }) => {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!ready || !holder || typeof MutationObserver === 'undefined') return undefined;
    let timer = null;
    const refresh = () => {
      const next = readFootnotes(holder);
      setItems((current) =>
        current.length === next.length &&
        current.every((item, i) => item.key === next[i].key && item.note === next[i].note)
          ? current
          : next
      );
    };
    refresh();
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 150);
    });
    observer.observe(holder, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mex-note', 'data-mex-footnote'],
    });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [holderRef, ready]);

  if (!items.length) return null;
  const headingId = `${id}-footnotes`;
  return (
    <Box
      tag="section"
      aria-labelledby={headingId}
      paddingTop={3}
      paddingBottom={3}
      paddingLeft={4}
      paddingRight={4}
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="1px 0 0 0"
      data-testid="mex-footnotes"
    >
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="sigma" textColor="neutral600" tag="h3" id={headingId}>
          {t('editor.footnotes.title', 'Footnotes ({count})', { count: items.length })}
        </Typography>
        <List>
          {items.map((item, index) => (
            <Item key={item.key}>
              <Number aria-hidden="true">{index + 1}</Number>
              <Text variant="omega" textColor={item.text ? 'neutral800' : 'neutral600'}>
                <VisuallyHidden>
                  {t('editor.footnotes.number', 'Footnote {number}:', { number: index + 1 })}{' '}
                </VisuallyHidden>
                {item.text || t('editor.footnotes.noText', 'No text yet')}
                {item.text ? null : (
                  <>
                    {' '}
                    <Badge>{t('editor.footnotes.empty', 'Empty')}</Badge>
                  </>
                )}
              </Text>
              <Flex gap={1} shrink={0}>
                <IconButton
                  label={t('editor.footnotes.goTo', 'Show footnote {number} in the text', {
                    number: index + 1,
                  })}
                  variant="ghost"
                  onClick={() => onGoTo(index)}
                >
                  <ArrowRight />
                </IconButton>
                <IconButton
                  label={
                    readOnly
                      ? t('editor.footnotes.view', 'Read footnote {number}', { number: index + 1 })
                      : t('editor.footnotes.edit', 'Edit footnote {number}', { number: index + 1 })
                  }
                  variant="ghost"
                  onClick={() => onEdit(index)}
                >
                  <Pencil />
                </IconButton>
                {readOnly ? null : (
                  <ConfirmAction
                    trigger={
                      <IconButton
                        label={t('editor.footnotes.remove', 'Remove footnote {number}', {
                          number: index + 1,
                        })}
                        variant="ghost"
                      >
                        <Trash />
                      </IconButton>
                    }
                    title={t('editor.footnotes.removeTitle', 'Remove footnote {number}?', {
                      number: index + 1,
                    })}
                    body={t(
                      'editor.footnotes.removeBody',
                      'The marker and its note are removed from the text. You can undo this.'
                    )}
                    confirmLabel={t('editor.footnotes.removeConfirm', 'Remove footnote')}
                    onConfirm={() => onRemove(index)}
                  />
                )}
              </Flex>
            </Item>
          ))}
        </List>
      </Flex>
    </Box>
  );
};

export default FootnotesPanel;

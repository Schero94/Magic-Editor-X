import { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, Field, Flex, IconButton, Modal, TextInput, Typography } from '@strapi/design-system';
import { Bold, Italic, Link } from '@strapi/icons';
import styled from 'styled-components';
import { sanitizeInline, sanitizeUrl } from '../../editor/sanitize';
import { cleanNoteHtml } from '../../editor/tools/footnote-logic.mjs';
import { MAX_FOOTNOTE_NOTE } from '../../../../shared/sanitize-policy.mjs';

/**
 * Note editor of one footnote (2.4). The note is inline HTML with the
 * formatting the field allows (bold, italic and links when its preset has
 * those tools). Formatting uses Range APIs on a small contenteditable area;
 * the result is cleaned with the note policy before it is written to the
 * marker. Enter adds a line break, Ctrl/Cmd+Enter saves.
 */

const NoteArea = styled.div`
  min-height: 9.6rem;
  max-height: 32rem;
  overflow-y: auto;
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[4]}`};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: ${({ theme }) => theme.fontSizes[2]};
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  &:focus-visible,
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary600};
    box-shadow: ${({ theme }) => theme.colors.primary600} 0px 0px 0px 2px;
  }

  &[aria-readonly='true'] {
    background: ${({ theme }) => theme.colors.neutral100};
  }

  a {
    color: ${({ theme }) => theme.colors.primary700};
  }
`;

/**
 * Closest element with one of the tags inside `root`.
 * @param {Node|null} node - Start node.
 * @param {string[]} tags - Lower-case tag names.
 * @param {HTMLElement} root - Boundary.
 * @returns {HTMLElement|null} Element.
 */
const closestTag = (node, tags, root) => {
  let current = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  while (current && current !== root) {
    if (tags.includes(current.tagName.toLowerCase())) return current;
    current = current.parentElement;
  }
  return null;
};

/**
 * Replaces an element by its children.
 * @param {HTMLElement} element - Element.
 */
const unwrapElement = (element) => {
  const parent = element.parentNode;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {number} props.number - Footnote number (reading order).
 * @param {string} props.html - Current note HTML.
 * @param {boolean} props.readOnly - View only.
 * @param {string[]|null} props.allowedTags - Inline tags of the field preset (null = all).
 * @param {(html: string) => void} props.onSave - Writes the cleaned note.
 * @param {() => void} props.onClose - Closes the dialog (a new footnote without text is removed by the caller).
 * @returns {JSX.Element} Dialog.
 */
export const FootnoteDialog = ({ t, number, html, readOnly, allowedTags, onSave, onClose }) => {
  const areaRef = useRef(null);
  const rangeRef = useRef(null);
  const labelId = useId();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState(null);
  const [tooLong, setTooLong] = useState(false);
  const allows = (tag) => !allowedTags || allowedTags.includes(tag);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    area.innerHTML = sanitizeInline(html || '');
    const remember = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount && area.contains(selection.getRangeAt(0).commonAncestorContainer))
        rangeRef.current = selection.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', remember);
    const timer = window.setTimeout(() => {
      if (readOnly) return;
      area.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(area);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }, 0);
    return () => {
      document.removeEventListener('selectionchange', remember);
      window.clearTimeout(timer);
    };
    // The note is loaded once per dialog; later prop changes would discard typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on mount
  }, []);

  /** Restores the remembered selection inside the area. */
  const restoreRange = () => {
    const area = areaRef.current;
    const range = rangeRef.current;
    if (!area) return null;
    area.focus();
    if (!range || !area.contains(range.commonAncestorContainer)) return null;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  };

  /**
   * Toggles bold or italic on the selection.
   * @param {'b'|'i'} tag - Tag.
   */
  const toggle = (tag) => {
    const area = areaRef.current;
    const range = restoreRange();
    if (!area || !range) return;
    const aliases = tag === 'b' ? ['b', 'strong'] : ['i', 'em'];
    const existing = closestTag(range.commonAncestorContainer, aliases, area);
    if (existing) unwrapElement(existing);
    else if (!range.collapsed) {
      const wrapper = document.createElement(tag);
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      const selection = window.getSelection();
      const next = document.createRange();
      next.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(next);
    }
  };

  const applyLink = () => {
    const area = areaRef.current;
    const range = restoreRange();
    let url = linkValue.trim();
    if (url && !/^[a-z][a-z0-9+.-]*:|^[/#?.]/i.test(url) && /^[^\s/]+\.[^\s]+/.test(url))
      url = `https://${url}`;
    const safe = sanitizeUrl(url);
    if (!safe) {
      setLinkError(
        t('editor.footnotes.linkInvalid', 'Enter a web address (https://…), an e-mail or a path.')
      );
      return;
    }
    if (area && range) {
      const existing = closestTag(range.commonAncestorContainer, ['a'], area);
      if (existing) existing.setAttribute('href', safe);
      else {
        const link = document.createElement('a');
        link.setAttribute('href', safe);
        if (range.collapsed) link.textContent = safe;
        else link.appendChild(range.extractContents());
        range.insertNode(link);
      }
    }
    setLinkOpen(false);
    setLinkValue('');
    setLinkError(null);
  };

  const removeLink = () => {
    const area = areaRef.current;
    const range = restoreRange();
    const existing = area && range ? closestTag(range.commonAncestorContainer, ['a'], area) : null;
    if (existing) unwrapElement(existing);
    setLinkOpen(false);
  };

  const save = () => {
    const area = areaRef.current;
    if (!area) return;
    const raw = area.innerHTML;
    if (raw.length > MAX_FOOTNOTE_NOTE * 2) {
      setTooLong(true);
      return;
    }
    onSave(cleanNoteHtml(sanitizeInline(raw), allowedTags));
  };

  const onKeyDown = (event) => {
    if (readOnly) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter' && mod) {
      event.preventDefault();
      save();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    if (mod && !event.altKey && (event.key === 'b' || event.key === 'B') && allows('b')) {
      event.preventDefault();
      toggle('b');
    } else if (mod && !event.altKey && (event.key === 'i' || event.key === 'I') && allows('i')) {
      event.preventDefault();
      toggle('i');
    }
  };

  /** Toolbar buttons keep the selection of the note area (no focus change on pointer down). */
  const keepSelection = (event) => event.preventDefault();

  return (
    <Modal.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content>
        <Modal.Header closeLabel={t('editor.footnotes.close', 'Close')}>
          <Modal.Title>{t('editor.footnotes.dialogTitle', 'Footnote {number}', { number })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={3}>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" id={labelId}>
              {t('editor.footnotes.note', 'Note')}
            </Typography>
            {!readOnly && (allows('b') || allows('i') || allows('a')) ? (
              <Flex gap={1} role="toolbar" aria-label={t('editor.footnotes.formatting', 'Formatting')}>
                {allows('b') ? (
                  <IconButton
                    label={t('editor.footnotes.bold', 'Bold')}
                    variant="tertiary"
                    onMouseDown={keepSelection}
                    onClick={() => toggle('b')}
                  >
                    <Bold />
                  </IconButton>
                ) : null}
                {allows('i') ? (
                  <IconButton
                    label={t('editor.footnotes.italic', 'Italic')}
                    variant="tertiary"
                    onMouseDown={keepSelection}
                    onClick={() => toggle('i')}
                  >
                    <Italic />
                  </IconButton>
                ) : null}
                {allows('a') ? (
                  <IconButton
                    label={t('editor.footnotes.link', 'Link')}
                    variant={linkOpen ? 'secondary' : 'tertiary'}
                    aria-expanded={linkOpen}
                    onMouseDown={keepSelection}
                    onClick={() => setLinkOpen((value) => !value)}
                  >
                    <Link />
                  </IconButton>
                ) : null}
              </Flex>
            ) : null}
            {linkOpen ? (
              <Flex gap={2} alignItems="flex-end" wrap="wrap">
                <Box flex="1 1 20rem">
                  <Field.Root name="mex-footnote-link" error={linkError || undefined}>
                    <Field.Label>{t('editor.footnotes.linkAddress', 'Link address')}</Field.Label>
                    <TextInput
                      value={linkValue}
                      autoFocus
                      onChange={(event) => {
                        setLinkValue(event.target.value);
                        setLinkError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          applyLink();
                        }
                      }}
                    />
                    <Field.Error />
                  </Field.Root>
                </Box>
                <Button variant="secondary" onClick={applyLink}>
                  {t('editor.footnotes.linkApply', 'Apply link')}
                </Button>
                <Button variant="tertiary" onClick={removeLink}>
                  {t('editor.footnotes.linkRemove', 'Remove link')}
                </Button>
              </Flex>
            ) : null}
            <NoteArea
              ref={areaRef}
              role="textbox"
              aria-multiline="true"
              aria-labelledby={labelId}
              aria-readonly={readOnly ? 'true' : undefined}
              contentEditable={!readOnly}
              suppressContentEditableWarning
              tabIndex={0}
              onKeyDown={onKeyDown}
              data-testid="mex-footnote-note"
            />
            {tooLong ? (
              <Typography variant="pi" textColor="danger600" role="alert">
                {t('editor.footnotes.tooLong', 'This note is too long. Shorten it to save.')}
              </Typography>
            ) : (
              <Typography variant="pi" textColor="neutral600">
                {readOnly
                  ? t('editor.footnotes.readOnly', 'You can read this note but not change it.')
                  : t('editor.footnotes.hint', 'Enter adds a line break. Ctrl+Enter or Cmd+Enter saves.')}
              </Typography>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">
              {readOnly ? t('editor.footnotes.close', 'Close') : t('editor.footnotes.cancel', 'Cancel')}
            </Button>
          </Modal.Close>
          {readOnly ? null : (
            <Button onClick={save} data-testid="mex-footnote-save">
              {t('editor.footnotes.save', 'Save note')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default FootnoteDialog;

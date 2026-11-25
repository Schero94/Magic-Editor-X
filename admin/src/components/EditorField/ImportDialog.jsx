import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Flex,
  Loader,
  Modal,
  TextButton,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Upload } from '@strapi/icons';
import styled from 'styled-components';
import { RenderedContent } from '../RenderedContent';
import { prepareEditorValue } from '../../editor/sanitize';
import { parseHtmlWithDom } from '../../../../shared/convert/dom-adapter.mjs';
import { blockTypeLabel } from './reuse-labels';
import { TouchModalContent } from '../ui/touch';

/**
 * "Import file…" (2.11, More tools > Write): choose a Word (.docx) or
 * Markdown (.md) file, see the blocks it becomes, then replace the field's
 * content or insert the blocks at the cursor (after the block worked on
 * last). The conversion runs in the browser (`shared/convert/import-file.mjs`,
 * loaded on first use): bounded ZIP reader, no DTDs, images as placeholders.
 * The preview shows the sanitised blocks; inserting goes through the field's
 * normal change path (preset check, fresh ids, one undo step, live room).
 */

/** Blocks shown in the preview at most (the import itself keeps all). */
export const PREVIEW_LIMIT = 200;

const PreviewBox = styled(Box)`
  max-height: min(40vh, 36rem);
  overflow: auto;
  min-width: 0;
`;

/** Lets the page paint between conversion steps. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** XML parser for the Word reader (the browser's; no DTDs are passed to it). */
const parseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

/**
 * Message of an import error code.
 * @param {Function} t - Translator.
 * @param {string} code - ImportError code.
 * @returns {string} Message.
 */
const errorMessage = (t, code) => {
  switch (code) {
    case 'UNSUPPORTED_TYPE':
      return t('editor.import.error.type', 'Choose a Word file (.docx) or a Markdown file (.md).');
    case 'FILE_EMPTY':
      return t('editor.import.error.empty', 'The file is empty.');
    case 'FILE_TOO_LARGE':
    case 'TOO_LARGE':
    case 'ENTRY_TOO_LARGE':
    case 'XML_TOO_LARGE':
      return t(
        'editor.import.error.size',
        'The file is too large. Word files can be up to 10 MB, Markdown files up to 5 MB.'
      );
    case 'ZIP_TOO_LARGE':
    case 'ZIP_RATIO':
    case 'ZIP_SIZE_MISMATCH':
    case 'ZIP_TOO_MANY_ENTRIES':
      return t(
        'editor.import.error.unsafe',
        'The file was not opened: it would expand to more than 50 MB or is compressed unusually strongly. Save it again in Word and try once more.'
      );
    case 'ZIP_ENCRYPTED':
      return t(
        'editor.import.error.encrypted',
        'The file is password-protected. Remove the password in Word and try again.'
      );
    case 'TEXT_ENCODING':
      return t('editor.import.error.encoding', 'The Markdown file is not UTF-8 text.');
    case 'MARKDOWN_TOO_DEEP':
      return t('editor.import.error.deep', 'The Markdown file nests lists or quotes too deeply.');
    default:
      return t(
        'editor.import.error.invalid',
        'This is not a Word document (.docx) that can be read. Older .doc files are not supported: save the file as .docx first.'
      );
  }
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {boolean} props.hasContent - The field has content (then both "Replace content" and "Insert at cursor" are offered).
 * @param {(blocks: Array<object>, options: { replace: boolean, title: string }) => Promise<boolean>} props.onImport - Inserts the blocks; resolves true when something was inserted.
 * @param {() => void} props.onClose - Closes the dialog.
 * @param {boolean} [props.allowRaw] - Preview raw HTML blocks.
 * @param {string} [props.lang] - Content language.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @returns {JSX.Element} Dialog.
 */
export const ImportDialog = ({ t, hasContent, onImport, onClose, allowRaw = false, lang, dir }) => {
  const inputRef = useRef(null);
  const chooseRef = useRef(null);
  const summaryRef = useRef(null);
  const runRef = useRef(0);
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  const [notesHidden, setNotesHidden] = useState(false);
  const statusId = useId();

  useEffect(
    () => () => {
      // A conversion that finishes after the dialog closed is ignored.
      runRef.current += 1;
    },
    []
  );

  const read = useCallback(
    async (chosen) => {
      const run = runRef.current + 1;
      runRef.current = run;
      setFile({ name: chosen.name, size: chosen.size });
      setState({ phase: 'reading' });
      setNotesHidden(false);
      try {
        const { convertImportFile } = await import('../../../../shared/convert/import-file.mjs');
        const bytes = new Uint8Array(await chosen.arrayBuffer());
        const result = await convertImportFile(
          { name: chosen.name, bytes },
          {
            parseXml,
            parseHtml: parseHtmlWithDom,
            pause,
            imageLabel: (alt) =>
              alt
                ? t('editor.import.imageAlt', '[Image: {alt}]', { alt })
                : t('editor.import.image', '[Image]'),
          }
        );
        if (runRef.current !== run) return;
        const clean = prepareEditorValue({ blocks: result.blocks }).data;
        const blocks = clean ? clean.blocks : [];
        setState(blocks.length ? { phase: 'ready', blocks, report: result.report } : { phase: 'nothing' });
      } catch (error) {
        if (runRef.current !== run) return;
        setState({ phase: 'error', code: (error && error.code) || 'INVALID' });
      }
    },
    [t]
  );

  // The summary takes focus once the preview is there (screen readers hear the result).
  // After an error the choose button (disabled while reading) gets the focus back.
  useEffect(() => {
    if (state.phase === 'ready' && summaryRef.current) summaryRef.current.focus();
    else if ((state.phase === 'error' || state.phase === 'nothing') && chooseRef.current)
      chooseRef.current.focus();
  }, [state.phase]);

  const choose = () => {
    if (inputRef.current) inputRef.current.click();
  };

  const onFileChange = (event) => {
    const chosen = event.target.files && event.target.files[0];
    // The same file can be chosen again after a change in Word.
    event.target.value = '';
    if (chosen) read(chosen);
  };

  const counts = useMemo(() => {
    if (state.phase !== 'ready') return [];
    const map = new Map();
    for (const block of state.blocks) {
      const label = blockTypeLabel(t, block);
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()];
  }, [state, t]);

  const apply = async (replace) => {
    if (state.phase !== 'ready' || busy) return;
    setBusy(true);
    try {
      const done = await onImport(state.blocks, { replace, title: file ? file.name : '' });
      if (done) onClose();
    } finally {
      setBusy(false);
    }
  };

  const skippedTotal =
    state.phase === 'ready' ? Object.values(state.report.skipped).reduce((sum, count) => sum + count, 0) : 0;

  let body;
  if (state.phase === 'ready') {
    const shown = state.blocks.slice(0, PREVIEW_LIMIT);
    body = (
      <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
        <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
          <Typography
            variant="delta"
            tag="h3"
            ref={summaryRef}
            tabIndex={-1}
            textColor="neutral800"
            data-testid="mex-import-summary"
          >
            {t('editor.import.summary', '{count, plural, one {# block} other {# blocks}} from {name}', {
              count: state.blocks.length,
              name: file.name,
            })}
          </Typography>
          <TextButton onClick={choose} disabled={busy} data-testid="mex-import-another">
            {t('editor.import.chooseAnother', 'Choose another file…')}
          </TextButton>
        </Flex>
        <Typography variant="pi" textColor="neutral600" data-testid="mex-import-types">
          {counts.map(([label, count]) => `${label}: ${count}`).join(' · ')}
        </Typography>
        {!notesHidden && (state.report.images || skippedTotal || state.report.truncated) ? (
          <Alert
            variant="default"
            closeLabel={t('editor.import.dismiss', 'Dismiss')}
            onClose={() => setNotesHidden(true)}
            title={t('editor.import.notesTitle', 'Good to know')}
            data-testid="mex-import-notes"
          >
            {[
              state.report.images
                ? t(
                    'editor.import.images',
                    '{count, plural, one {# image was not imported.} other {# images were not imported.}} A placeholder marks the place; add the image there with the image tool.',
                    { count: state.report.images }
                  )
                : null,
              skippedTotal
                ? t(
                    'editor.import.skipped',
                    '{count, plural, one {# part of the file was left out} other {# parts of the file were left out}} because the editor has no matching block (for example an embedded object or a table of contents).',
                    { count: skippedTotal }
                  )
                : null,
              state.report.truncated
                ? t(
                    'editor.import.truncated',
                    'The file is very long; only the first 5000 blocks are imported.'
                  )
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Alert>
        ) : null}
        <PreviewBox
          padding={4}
          hasRadius
          borderColor="neutral200"
          background="neutral0"
          tabIndex={0}
          role="region"
          aria-label={t('editor.import.preview', 'Preview of the imported content')}
          data-testid="mex-import-preview"
        >
          <RenderedContent value={{ blocks: shown }} t={t} allowRaw={allowRaw} lang={lang} dir={dir} />
        </PreviewBox>
        {state.blocks.length > shown.length ? (
          <Typography variant="pi" textColor="neutral600">
            {t('editor.import.previewLimit', 'The preview shows the first {shown} of {total} blocks.', {
              shown: shown.length,
              total: state.blocks.length,
            })}
          </Typography>
        ) : null}
        {hasContent ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.import.howto',
              '"Insert at cursor" adds the blocks after the block you worked on last. "Replace content" replaces everything in this field; Undo brings it back.'
            )}
          </Typography>
        ) : null}
      </Flex>
    );
  } else {
    body = (
      <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
        <Typography variant="omega" textColor="neutral800">
          {t(
            'editor.import.intro',
            'Turn a Word document (.docx) or a Markdown file (.md) into blocks of this field. Headings, lists, tables, links and text styles are kept; images are not imported.'
          )}
        </Typography>
        <Flex gap={3} wrap="wrap" alignItems="center">
          <Button
            ref={chooseRef}
            variant="secondary"
            startIcon={<Upload />}
            onClick={choose}
            loading={state.phase === 'reading'}
            disabled={state.phase === 'reading'}
            aria-describedby={statusId}
            data-testid="mex-import-choose"
          >
            {file
              ? t('editor.import.chooseAnother', 'Choose another file…')
              : t('editor.import.choose', 'Choose file…')}
          </Button>
          <Typography variant="pi" textColor="neutral600">
            {t('editor.import.limits', 'Word up to 10 MB, Markdown up to 5 MB.')}
          </Typography>
        </Flex>
        <Typography
          variant="pi"
          textColor="neutral600"
          id={statusId}
          aria-live="polite"
          data-testid="mex-import-status"
        >
          {state.phase === 'reading'
            ? t('editor.import.reading', 'Reading {name}…', { name: file ? file.name : '' })
            : file && state.phase !== 'idle'
              ? file.name
              : ''}
        </Typography>
        {state.phase === 'reading' ? (
          <Loader small>{t('editor.import.readingShort', 'Reading the file')}</Loader>
        ) : null}
        {state.phase === 'error' ? (
          <Alert
            variant="danger"
            closeLabel={t('editor.import.dismiss', 'Dismiss')}
            onClose={() => setState({ phase: 'idle' })}
            title={t('editor.import.errorTitle', 'The file could not be imported')}
            data-testid="mex-import-error"
          >
            {errorMessage(t, state.code)}
          </Alert>
        ) : null}
        {state.phase === 'nothing' ? (
          <Alert
            variant="warning"
            closeLabel={t('editor.import.dismiss', 'Dismiss')}
            onClose={() => setState({ phase: 'idle' })}
            title={t('editor.import.nothingTitle', 'Nothing to import')}
            data-testid="mex-import-nothing"
          >
            {t(
              'editor.import.nothing',
              'The file has no text, headings, lists or tables that can be imported.'
            )}
          </Alert>
        ) : null}
      </Flex>
    );
  }

  return (
    <Modal.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <TouchModalContent aria-describedby={undefined}>
        <Modal.Header closeLabel={t('editor.import.close', 'Close')}>
          <Modal.Title>{t('editor.import.title', 'Import file')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <VisuallyHidden>
            <input
              ref={inputRef}
              type="file"
              accept=".docx,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onFileChange}
              data-testid="mex-import-input"
            />
          </VisuallyHidden>
          {body}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.import.cancel', 'Cancel')}</Button>
          </Modal.Close>
          {state.phase === 'ready' ? (
            <Flex gap={2} wrap="wrap" justifyContent="flex-end">
              {hasContent ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => apply(true)}
                    disabled={busy}
                    data-testid="mex-import-replace"
                  >
                    {t('editor.import.replace', 'Replace content')}
                  </Button>
                  <Button
                    onClick={() => apply(false)}
                    loading={busy}
                    disabled={busy}
                    data-testid="mex-import-insert"
                  >
                    {t('editor.import.insertAtCursor', 'Insert at cursor')}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => apply(true)}
                  loading={busy}
                  disabled={busy}
                  data-testid="mex-import-insert"
                >
                  {t('editor.import.insert', 'Insert {count, plural, one {# block} other {# blocks}}', {
                    count: state.blocks.length,
                  })}
                </Button>
              )}
            </Flex>
          ) : null}
        </Modal.Footer>
      </TouchModalContent>
    </Modal.Root>
  );
};

export default ImportDialog;

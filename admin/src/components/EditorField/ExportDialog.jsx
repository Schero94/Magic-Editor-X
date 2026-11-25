import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Flex, Modal, Radio, Typography } from '@strapi/design-system';
import { unstable_useContentManagerContext as useContentManagerContext } from '@strapi/strapi/admin';
import {
  EXPORT_FORMATS,
  EXPORT_MIME,
  exportFileName,
  exportHtmlDocument,
  exportMarkdown,
} from '../../editor/export/export-content.mjs';
import { createImageLoader, downloadFile, openPrintView } from '../../editor/export/browser';
import { TouchModalContent } from '../ui/touch';

/**
 * "Export…" (2.11, More tools > View): the field's content as Word (.docx),
 * PDF (the browser's print dialog, "Save as PDF"), Markdown or HTML. One
 * choice (format), one option for PDF (page breaks), one button. The content
 * is the editor's current content, unsaved changes included. The Word writer
 * (`docx` package) is loaded on first use.
 */

/**
 * Title of the open entry: the value of the content type's main field (list
 * view "entry title"), else the content type's display name.
 * @returns {string} Title ('' outside the Content Manager).
 */
export const useEntryTitle = () => {
  const context = useContentManagerContext();
  const values = context && context.form ? context.form.values : null;
  const settings = context && context.layout && context.layout.edit ? context.layout.edit.settings : null;
  const main = settings && settings.mainField;
  const raw = values && main && main !== 'id' && main !== 'documentId' ? values[main] : null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number') return String(raw);
  const info = context && context.contentType && context.contentType.info;
  return (info && info.displayName) || '';
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {() => Promise<{ value: object|null, synced: Map<string, object[]> }>} props.readContent - Current editor content and synced sources.
 * @param {string} props.field - Field path (file name).
 * @param {string} [props.lang] - Content language (HTML and print).
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @param {(message: string) => void} props.onExported - Success notice (the dialog closes).
 * @param {() => void} props.onClose - Closes the dialog.
 * @returns {JSX.Element} Dialog.
 */
export const ExportDialog = ({ t, readContent, field, lang, dir, onExported, onClose }) => {
  const title = useEntryTitle();
  const [format, setFormat] = useState('docx');
  const [pageBreaks, setPageBreaks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const formatId = useId();
  const errorRef = useRef(null);
  const mounted = useRef(true);
  // StrictMode mounts, cleans up and mounts again: the effect sets the flag on every mount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);

  const fileName = exportFileName({ title, field, format });
  const labels = {
    embed: t('editor.export.embed', 'Embedded content'),
    component: t('editor.export.component', 'Component block'),
    raw: t('editor.export.raw', 'HTML block (not exported)'),
    image: t('editor.export.image', 'Image'),
    video: t('editor.export.video', 'Video'),
    audio: t('editor.export.audio', 'Audio'),
  };
  const names = {
    docx: t('editor.export.format.docx', 'Word document (.docx)'),
    pdf: t('editor.export.format.pdf', 'PDF (print dialog)'),
    markdown: t('editor.export.format.markdown', 'Markdown (.md)'),
    html: t('editor.export.format.html', 'Web page (.html)'),
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { value, synced } = await readContent();
      if (!value || !Array.isArray(value.blocks) || !value.blocks.length) {
        setError('empty');
        return;
      }
      const origin = window.location.origin;
      const common = { title: title || fileName, origin, synced, labels, lang, dir };
      if (format === 'docx') {
        const { buildDocxFile } = await import('../../editor/export/docx-writer.mjs');
        const bytes = await buildDocxFile(value, { ...common, loadImage: createImageLoader({ origin }) });
        downloadFile(bytes, fileName, EXPORT_MIME.docx);
      } else if (format === 'markdown') {
        downloadFile(exportMarkdown(value, common), fileName, EXPORT_MIME.markdown);
      } else if (format === 'html') {
        downloadFile(exportHtmlDocument(value, common), fileName, EXPORT_MIME.html);
      } else {
        await openPrintView(exportHtmlDocument(value, { ...common, pageBreaks }), {
          title: t('editor.export.printFrame', 'Print view'),
        });
      }
      onExported(
        format === 'pdf'
          ? t(
              'editor.export.printed',
              'The print view is open. Choose "Save as PDF" as the printer to get a PDF file.'
            )
          : t('editor.export.done', '{name} was downloaded.', { name: fileName })
      );
      onClose();
    } catch {
      if (mounted.current) setError('failed');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Modal.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <TouchModalContent aria-describedby={undefined}>
        <Modal.Header closeLabel={t('editor.export.close', 'Close')}>
          <Modal.Title>{t('editor.export.title', 'Export')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
            <Typography variant="omega" textColor="neutral800">
              {t(
                'editor.export.intro',
                'Exports the content of this field as it is shown in the editor, including changes that are not saved yet.'
              )}
            </Typography>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="pi" fontWeight="bold" textColor="neutral800" id={formatId}>
                {t('editor.export.format', 'Format')}
              </Typography>
              <Radio.Group
                aria-labelledby={formatId}
                value={format}
                onValueChange={(next) => {
                  setFormat(next);
                  setError(null);
                }}
              >
                {EXPORT_FORMATS.map((id) => (
                  <Radio.Item key={id} value={id} data-testid={`mex-export-format-${id}`}>
                    {names[id]}
                  </Radio.Item>
                ))}
              </Radio.Group>
            </Flex>
            {format === 'pdf' ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.export.pdfHint',
                    'Your browser\'s print dialog opens. Choose "Save as PDF" as the printer. Links are printed with their address.'
                  )}
                </Typography>
                <Checkbox
                  checked={pageBreaks}
                  onCheckedChange={(checked) => setPageBreaks(checked === true)}
                  data-testid="mex-export-pagebreaks"
                >
                  {t('editor.export.pageBreaks', 'Start each main heading (H1, H2) on a new page')}
                </Checkbox>
              </Flex>
            ) : null}
            {format === 'docx' ? (
              <Typography variant="pi" textColor="neutral600">
                {t(
                  'editor.export.docxHint',
                  'Images from the Media Library are embedded. Images from other websites, embeds and components are written as links or labels.'
                )}
              </Typography>
            ) : null}
            {format !== 'pdf' ? (
              <Typography variant="pi" textColor="neutral600" data-testid="mex-export-filename">
                {t('editor.export.fileName', 'File name: {name}', { name: fileName })}
              </Typography>
            ) : null}
            {error ? (
              <Box ref={errorRef} tabIndex={-1}>
                <Alert
                  variant={error === 'empty' ? 'warning' : 'danger'}
                  closeLabel={t('editor.export.dismiss', 'Dismiss')}
                  onClose={() => setError(null)}
                  title={
                    error === 'empty'
                      ? t('editor.export.emptyTitle', 'Nothing to export')
                      : t('editor.export.failedTitle', 'The export failed')
                  }
                  data-testid="mex-export-error"
                >
                  {error === 'empty'
                    ? t('editor.export.empty', 'This field is empty.')
                    : t(
                        'editor.export.failed',
                        'The file could not be created. Try again, or choose another format.'
                      )}
                </Alert>
              </Box>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.export.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Button onClick={run} loading={busy} disabled={busy} data-testid="mex-export-run">
            {format === 'pdf'
              ? t('editor.export.print', 'Open print view')
              : t('editor.export.download', 'Download')}
          </Button>
        </Modal.Footer>
      </TouchModalContent>
    </Modal.Root>
  );
};

export default ExportDialog;

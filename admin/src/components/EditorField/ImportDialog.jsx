import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Flex,
  Loader,
  Modal,
  ProgressBar,
  TextButton,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Upload } from '@strapi/icons';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { RenderedContent } from '../RenderedContent';
import { prepareEditorValue } from '../../editor/sanitize';
import { parseHtmlWithDom } from '../../../../shared/convert/dom-adapter.mjs';
import { blockTypeLabel } from './reuse-labels';
import { TouchModalContent } from '../ui/touch';

/**
 * "Import file" (2.11, More tools > Import and export): choose a Word (.docx) or
 * Markdown (.md) file, see the blocks it becomes, then replace the field's
 * content or insert the blocks at the cursor (after the block worked on
 * last). The conversion runs in the browser (`shared/convert/import-file.mjs`,
 * loaded on first use): bounded ZIP reader, no DTDs. The preview shows the
 * sanitised blocks; inserting goes through the field's normal change path
 * (preset check, fresh ids, one undo step, live room).
 *
 * Word pictures (2.13): the preview is free of side effects. It shows each
 * picture from the file's own bytes through an object URL (no request, no
 * Media Library file) with the alt text from Word. Only "Replace content" or
 * "Insert at cursor" uploads them, one after the other, through the image
 * tool's upload route (`POST /image/byFile`: signature, integrity and size
 * checks, Media Library permission `plugin::upload.assets.create`, the alt
 * text as `alternativeText`, Media Library root folder). A picture that is not
 * uploaded (no permission, a field without images, EMF/WMF and other formats,
 * a limit, a failed upload or "Stop uploading") stays a placeholder and is
 * named in the summary; it never stops the import.
 */

/** Blocks shown in the preview at most (the import itself keeps all). */
export const PREVIEW_LIMIT = 200;

const PreviewBox = styled(Box)`
  max-height: min(40vh, 36rem);
  overflow: auto;
  min-width: 0;
`;

const Thumb = styled.img`
  display: block;
  max-width: min(100%, 24rem);
  max-height: 16rem;
  object-fit: contain;
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
`;

const MB = 1024 * 1024;

/** Picture reasons that keep a placeholder, in the order the notes name them. */
const REASONS = [
  'permission',
  'field',
  'format',
  'linked',
  'embedded',
  'too-large',
  'limit',
  'position',
  'failed',
];

/**
 * Why a picture stays a placeholder, or null when it is uploaded on insert.
 * @param {object} item - `report.media` entry.
 * @param {{ canUpload: boolean, imagesAllowed: boolean }} rights - Permission and field.
 * @returns {string|null} Reason.
 */
export const pictureReason = (item, { canUpload, imagesAllowed }) => {
  if (item.reason === 'unsupported') return 'embedded';
  if (item.reason === 'truncated') return 'limit';
  if (item.reason) return item.reason;
  if (!item.blockId || !item.bytes) return 'position';
  if (!imagesAllowed) return 'field';
  if (!canUpload) return 'permission';
  return null;
};

/**
 * Sentence for a group of pictures that stay placeholders.
 * @param {Function} t - Translator.
 * @param {string} reason - Reason.
 * @param {number} count - Pictures.
 * @param {number} maxMb - Largest picture in MB.
 * @returns {string} Sentence.
 */
const reasonText = (t, reason, count, maxMb) => {
  switch (reason) {
    case 'permission':
      return t(
        'editor.import.pictures.permission',
        'You may not upload files to the Media Library, so {count, plural, one {# picture stays a placeholder} other {# pictures stay placeholders}}.',
        { count }
      );
    case 'field':
      return t(
        'editor.import.pictures.field',
        'This field does not allow images, so {count, plural, one {# picture stays a placeholder} other {# pictures stay placeholders}}.',
        { count }
      );
    case 'format':
      return t(
        'editor.import.pictures.format',
        '{count, plural, one {# picture is} other {# pictures are}} a vector drawing or another format (for example EMF or WMF) that browsers cannot show, so {count, plural, one {it stays a placeholder} other {they stay placeholders}}. Save {count, plural, one {it} other {them}} as PNG or JPEG in Word to import {count, plural, one {it} other {them}}.',
        { count }
      );
    case 'linked':
      return t(
        'editor.import.pictures.linked',
        '{count, plural, one {# picture is} other {# pictures are}} only linked in the Word file, not embedded, so {count, plural, one {it stays a placeholder} other {they stay placeholders}}.',
        { count }
      );
    case 'embedded':
      return t(
        'editor.import.pictures.embedded',
        '{count, plural, one {# picture is} other {# pictures are}} a chart, a shape or an embedded object, so {count, plural, one {it stays a placeholder} other {they stay placeholders}}.',
        { count }
      );
    case 'too-large':
      return t(
        'editor.import.pictures.tooLarge',
        '{count, plural, one {# picture is} other {# pictures are}} larger than {max} MB, so {count, plural, one {it stays a placeholder} other {they stay placeholders}}.',
        { count, max: maxMb }
      );
    case 'limit':
      return t(
        'editor.import.pictures.limit',
        'One import takes up to 50 pictures and 40 MB of pictures; {count, plural, one {# more picture stays a placeholder} other {# more pictures stay placeholders}}.',
        { count }
      );
    case 'position':
      return t(
        'editor.import.pictures.position',
        '{count, plural, one {# picture is} other {# pictures are}} inside a list, a table or a link, where a block cannot go, so {count, plural, one {it stays a placeholder} other {they stay placeholders}}.',
        { count }
      );
    default:
      return '';
  }
};

/**
 * Short status line of one picture in the preview.
 * @param {Function} t - Translator.
 * @param {string|null} reason - From `pictureReason`.
 * @returns {string} Status.
 */
const pictureStatus = (t, reason) =>
  reason
    ? t('editor.import.picture.placeholder', 'Stays a placeholder')
    : t('editor.import.picture.upload', 'Uploaded to the Media Library when you insert');

/**
 * Upload file name of a picture: the Word file's name, a number and the detected type's extension.
 * @param {string} fileName - Word file name.
 * @param {number} number - Picture number (1-based).
 * @param {string} mime - Detected type.
 * @returns {string} File name.
 */
export const pictureFileName = (fileName, number, mime) => {
  const base =
    String(fileName || 'word')
      .replace(/\.docx$/i, '')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60) || 'word';
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[
    mime
  ];
  return `${base}-image-${number}.${extension || 'png'}`;
};

/**
 * One picture of the preview: the thumbnail from the file's bytes (object URL, no request) and its status.
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object} props.item - Picture (`alt`, `url`, `reason`).
 * @returns {JSX.Element} Figure.
 */
const PicturePreview = ({ t, item }) => {
  const [broken, setBroken] = useState(false);
  return (
    <Flex
      tag="figure"
      gap={3}
      wrap="wrap"
      alignItems="flex-start"
      padding={3}
      marginTop={2}
      marginBottom={2}
      hasRadius
      borderColor="neutral200"
      background="neutral100"
      minWidth={0}
      data-testid="mex-import-picture"
      data-reason={item.reason || 'upload'}
    >
      {item.url && !broken ? (
        <Thumb src={item.url} alt={item.alt} onError={() => setBroken(true)} />
      ) : (
        <Box padding={3} hasRadius background="neutral0" borderColor="neutral200">
          <Typography variant="pi" textColor="neutral600">
            {t('editor.import.picture.noPreview', 'No preview')}
          </Typography>
        </Box>
      )}
      <Flex tag="figcaption" direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 16rem">
        <Typography variant="omega" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
          {item.alt || t('editor.import.picture.noAlt', 'No alt text in the Word file')}
        </Typography>
        <Typography variant="pi" textColor={item.reason ? 'neutral600' : 'success600'}>
          {pictureStatus(t, item.reason)}
        </Typography>
      </Flex>
    </Flex>
  );
};

/**
 * Splits the preview blocks into runs of rendered blocks and the pictures between them.
 * @param {Array<object>} blocks - Clean blocks shown in the preview.
 * @param {Map<string, object>} pictureByBlock - Pictures by their placeholder block id.
 * @returns {Array<{ key: string, blocks?: Array<object>, picture?: object }>} Segments.
 */
const previewSegments = (blocks, pictureByBlock) => {
  const segments = [];
  let run = [];
  const flush = () => {
    if (run.length) segments.push({ key: `b-${segments.length}`, blocks: run });
    run = [];
  };
  for (const block of blocks) {
    const picture = pictureByBlock.get(block.id);
    if (picture) {
      flush();
      segments.push({ key: `p-${segments.length}`, picture });
    } else run.push(block);
  }
  flush();
  return segments;
};

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
 * @param {boolean} [props.canUpload] - 2.13: the admin may upload to the Media Library (`plugin::upload.assets.create`).
 * @param {boolean} [props.imagesAllowed] - 2.13: the field has the image tool (its preset allows images).
 * @param {number} [props.maxImageBytes] - 2.13: the server's `uploads.maxImageBytes`.
 * @param {(file: File, alt: string) => Promise<{ success: number, file?: object, message?: string }>} [props.uploadImage] - 2.13: uploads one picture (no notification of its own).
 * @param {(blocks: Array<object>, options: { replace: boolean, title: string }) => Promise<boolean>} props.onImport - Inserts the blocks; resolves true when something was inserted.
 * @param {() => void} props.onClose - Closes the dialog.
 * @param {boolean} [props.allowRaw] - Preview raw HTML blocks.
 * @param {string} [props.lang] - Content language.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @returns {JSX.Element} Dialog.
 */
export const ImportDialog = ({
  t,
  hasContent,
  onImport,
  onClose,
  allowRaw = false,
  lang,
  dir,
  canUpload = false,
  imagesAllowed = false,
  maxImageBytes = 10 * MB,
  uploadImage,
}) => {
  const { formatNumber } = useIntl();
  const inputRef = useRef(null);
  const chooseRef = useRef(null);
  const summaryRef = useRef(null);
  const doneRef = useRef(null);
  const runRef = useRef(0);
  const urlsRef = useRef([]);
  const stopRef = useRef(false);
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState(null);
  const [notesHidden, setNotesHidden] = useState(false);
  const statusId = useId();
  const uploadsAvailable = Boolean(canUpload && imagesAllowed && typeof uploadImage === 'function');

  /** Revokes the object URLs of the previous preview. */
  const releaseUrls = useCallback(() => {
    if (typeof URL.revokeObjectURL === 'function')
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  useEffect(
    () => () => {
      // A conversion or upload that finishes after the dialog closed is ignored.
      runRef.current += 1;
      stopRef.current = true;
      releaseUrls();
    },
    [releaseUrls]
  );

  const read = useCallback(
    async (chosen) => {
      const run = runRef.current + 1;
      runRef.current = run;
      releaseUrls();
      setFile({ name: chosen.name, size: chosen.size });
      setState({ phase: 'reading' });
      setNotesHidden(false);
      try {
        const { convertImportFile, DOCX_IMAGE_LIMITS } =
          await import('../../../../shared/convert/import-file.mjs');
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
            images: 'collect',
            imageLimits: {
              maxImageBytes: Math.min(
                DOCX_IMAGE_LIMITS.maxImageBytes,
                Number(maxImageBytes) > 0 ? Number(maxImageBytes) : DOCX_IMAGE_LIMITS.maxImageBytes
              ),
            },
          }
        );
        if (runRef.current !== run) return;
        const clean = prepareEditorValue({ blocks: result.blocks }).data;
        const blocks = clean ? clean.blocks : [];
        // Thumbnails straight from the file's bytes: object URLs, nothing leaves the browser.
        // One URL per picture part (a picture used twice shares it).
        const urlByKey = new Map();
        const pictures = (result.report.media || []).map((item) => {
          let url = urlByKey.get(item.key) || null;
          if (!url && item.bytes && item.mime && typeof URL.createObjectURL === 'function') {
            url = URL.createObjectURL(new Blob([item.bytes], { type: item.mime }));
            urlsRef.current.push(url);
            urlByKey.set(item.key, url);
          }
          return { ...item, url, reason: pictureReason(item, { canUpload, imagesAllowed }) };
        });
        setState(
          blocks.length ? { phase: 'ready', blocks, report: result.report, pictures } : { phase: 'nothing' }
        );
      } catch (error) {
        if (runRef.current !== run) return;
        setState({ phase: 'error', code: (error && error.code) || 'INVALID' });
      }
    },
    [t, releaseUrls, maxImageBytes, canUpload, imagesAllowed]
  );

  // The summary takes focus once the preview is there (screen readers hear the result).
  // After an error the choose button (disabled while reading) gets the focus back.
  useEffect(() => {
    if (state.phase === 'ready' && summaryRef.current) summaryRef.current.focus();
    else if (state.phase === 'done' && doneRef.current) doneRef.current.focus();
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
    // A picture that will be uploaded counts as an image, not as its placeholder text.
    const uploads = new Set(state.pictures.filter((item) => !item.reason).map((item) => item.blockId));
    for (const block of state.blocks) {
      const label = blockTypeLabel(t, uploads.has(block.id) ? { type: 'image', data: {} } : block);
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()];
  }, [state, t]);

  const pictureByBlock = useMemo(
    () =>
      new Map(
        (state.phase === 'ready' ? state.pictures : [])
          .filter((item) => item.blockId)
          .map((item) => [item.blockId, item])
      ),
    [state]
  );

  /**
   * Uploads the pictures (one after the other, each once), then inserts the blocks: uploaded
   * pictures become image blocks, the others keep their placeholder. Resolves the failures.
   * @param {boolean} replace - Replace the field's content.
   */
  const apply = async (replace) => {
    if (state.phase !== 'ready' || busy) return;
    const run = runRef.current;
    setBusy(true);
    stopRef.current = false;
    try {
      const queue = [];
      const seen = new Set();
      for (const item of state.pictures)
        if (!item.reason && !seen.has(item.key)) {
          seen.add(item.key);
          queue.push(item);
        }
      const results = new Map();
      if (queue.length && uploadsAvailable) {
        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index];
          if (stopRef.current) {
            results.set(item.key, { stopped: true });
            continue;
          }
          setUpload({ current: index + 1, total: queue.length });
          let response = null;
          try {
            response = await uploadImage(
              new File([item.bytes], pictureFileName(file && file.name, index + 1, item.mime), {
                type: item.mime,
              }),
              item.alt
            );
          } catch {
            response = null;
          }
          if (runRef.current !== run) return;
          results.set(
            item.key,
            response && response.success === 1 && response.file && response.file.url
              ? { file: response.file }
              : { message: (response && response.message) || '' }
          );
        }
        setUpload({ current: queue.length, total: queue.length, finished: true });
      }
      const failures = [];
      let uploaded = 0;
      const blocks = state.blocks.map((block) => {
        const item = pictureByBlock.get(block.id);
        if (!item || item.reason) return block;
        const result = results.get(item.key);
        if (result && result.file) {
          uploaded += 1;
          return {
            id: block.id,
            type: 'image',
            data: {
              file: { ...result.file, alt: item.alt || result.file.alt || '' },
              caption: '',
              withBorder: false,
              withBackground: false,
              stretched: false,
            },
          };
        }
        failures.push({
          alt: item.alt,
          stopped: Boolean(result && result.stopped),
          message: (result && result.message) || '',
        });
        return block;
      });
      const done = await onImport(blocks, { replace, title: file ? file.name : '' });
      if (runRef.current !== run) return;
      if (done && !failures.length) onClose();
      else if (failures.length)
        setState((current) => ({ ...current, phase: 'done', failures, uploaded, done }));
    } finally {
      if (runRef.current === run) {
        setBusy(false);
        setUpload(null);
      }
    }
  };

  const skippedTotal =
    state.phase === 'ready' ? Object.values(state.report.skipped).reduce((sum, count) => sum + count, 0) : 0;
  // Largest picture in MB with two significant digits (0.25 for a 256 KiB server limit).
  // Formatted in the admin language (0,25 in German).
  const maxMb = formatNumber(
    Number((Math.min(Number(maxImageBytes) || 10 * MB, 10 * MB) / MB).toPrecision(2))
  );
  const pictureNotes = useMemo(() => {
    if (state.phase !== 'ready') return [];
    const counts = new Map();
    let uploads = 0;
    for (const item of state.pictures) {
      if (!item.reason) uploads += 1;
      else counts.set(item.reason, (counts.get(item.reason) || 0) + 1);
    }
    const notes = [];
    if (uploads)
      notes.push(
        t(
          'editor.import.pictures.upload',
          '{count, plural, one {# picture is uploaded} other {# pictures are uploaded}} to the Media Library when you insert the content, with the alt text from Word.',
          { count: uploads }
        )
      );
    for (const reason of REASONS)
      if (counts.get(reason)) notes.push(reasonText(t, reason, counts.get(reason), maxMb));
    return notes;
  }, [state, t, maxMb]);
  // Markdown imports have no picture list: images there stay placeholders as before.
  const legacyImages = state.phase === 'ready' && !state.pictures.length ? state.report.images : 0;

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
        {upload ? (
          <Flex
            direction="column"
            alignItems="stretch"
            gap={2}
            padding={3}
            hasRadius
            background="neutral100"
            data-testid="mex-import-uploading"
          >
            <Typography variant="omega" textColor="neutral800" role="status">
              {upload.finished
                ? t('editor.import.uploadingDone', 'Pictures uploaded. Inserting the content…')
                : t('editor.import.uploading', 'Uploading picture {current} of {total}…', {
                    current: upload.current,
                    total: upload.total,
                  })}
            </Typography>
            <ProgressBar
              value={Math.round(((upload.finished ? upload.total : upload.current - 1) / upload.total) * 100)}
              aria-label={t('editor.import.uploadProgress', 'Upload progress')}
            />
          </Flex>
        ) : null}
        {!notesHidden && (legacyImages || pictureNotes.length || skippedTotal || state.report.truncated) ? (
          <Alert
            variant="default"
            closeLabel={t('editor.import.dismiss', 'Dismiss')}
            onClose={() => setNotesHidden(true)}
            title={t('editor.import.notesTitle', 'Good to know')}
            data-testid="mex-import-notes"
          >
            {[
              ...pictureNotes,
              legacyImages
                ? t(
                    'editor.import.images',
                    '{count, plural, one {# image was not imported.} other {# images were not imported.}} A placeholder marks the place; add the image there with the image tool.',
                    { count: legacyImages }
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
              .map((note, index) => (
                // The Alert body is a paragraph: one line per note.
                <Box key={index} tag="span" display="block">
                  {note}
                </Box>
              ))}
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
          {previewSegments(shown, pictureByBlock).map((segment) =>
            segment.picture ? (
              <PicturePreview key={segment.key} t={t} item={segment.picture} />
            ) : (
              <RenderedContent
                key={segment.key}
                value={{ blocks: segment.blocks }}
                t={t}
                allowRaw={allowRaw}
                lang={lang}
                dir={dir}
              />
            )
          )}
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
  } else if (state.phase === 'done') {
    body = (
      <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
        <Typography
          variant="delta"
          tag="h3"
          ref={doneRef}
          tabIndex={-1}
          textColor="neutral800"
          data-testid="mex-import-done"
        >
          {state.done
            ? t(
                'editor.import.done.inserted',
                'Content inserted. {uploaded, plural, =0 {No picture was uploaded.} one {# picture was uploaded.} other {# pictures were uploaded.}}',
                { uploaded: state.uploaded }
              )
            : t(
                'editor.import.done.notInserted',
                'The content was not inserted. {uploaded, plural, =0 {No picture was uploaded.} one {# uploaded picture stays in the Media Library.} other {# uploaded pictures stay in the Media Library.}}',
                { uploaded: state.uploaded }
              )}
        </Typography>
        <Alert
          variant="warning"
          closeLabel={t('editor.import.dismiss', 'Dismiss')}
          onClose={onClose}
          title={t(
            'editor.import.failedTitle',
            '{count, plural, one {# picture stays a placeholder} other {# pictures stay placeholders}}',
            { count: state.failures.length }
          )}
          data-testid="mex-import-failures"
        >
          {/* The Alert body is a paragraph: one line per picture (spans), then the hint. */}
          {state.failures.map((failure, index) => (
            <Box key={index} tag="span" display="block" style={{ overflowWrap: 'anywhere' }}>
              {[
                failure.alt || t('editor.import.picture.unnamed', 'Picture {number}', { number: index + 1 }),
                failure.stopped
                  ? t('editor.import.failed.stopped', 'not uploaded (stopped)')
                  : failure.message || t('editor.import.failed.upload', 'the upload failed'),
              ].join(': ')}
            </Box>
          ))}
          <Box tag="span" display="block" marginTop={1}>
            {t(
              'editor.import.failedHint',
              'A placeholder marks each place; add the picture there with the image tool.'
            )}
          </Box>
        </Alert>
      </Flex>
    );
  } else {
    body = (
      <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
        <Typography variant="omega" textColor="neutral800">
          {t(
            'editor.import.introPictures',
            'Turn a Word document (.docx) or a Markdown file (.md) into blocks of this field. Headings, lists, tables, links and text styles are kept. Pictures in Word files (PNG, JPEG, GIF, WebP) are shown first and uploaded to the Media Library only when you insert the content; drawings in EMF or WMF and images in Markdown files stay placeholders.'
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
            {t(
              'editor.import.limitsPictures',
              'Word up to 10 MB with up to 50 pictures of up to {max} MB each, Markdown up to 5 MB.',
              { max: maxMb }
            )}
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
            <Button variant="tertiary" disabled={busy}>
              {state.phase === 'done'
                ? t('editor.import.close', 'Close')
                : t('editor.import.cancel', 'Cancel')}
            </Button>
          </Modal.Close>
          {upload && !upload.finished ? (
            <Button
              variant="secondary"
              onClick={() => {
                stopRef.current = true;
              }}
              data-testid="mex-import-stop"
            >
              {t('editor.import.stop', 'Stop uploading')}
            </Button>
          ) : state.phase === 'ready' ? (
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

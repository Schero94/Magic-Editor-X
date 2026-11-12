import { htmlToBlocks } from '../../../shared/convert/html.mjs';
import { markdownToBlocks } from '../../../shared/convert/markdown.mjs';
import { parseHtmlWithDom } from '../../../shared/convert/dom-adapter.mjs';
import { prepareEditorValue } from './sanitize';
import {
  MAX_REMOTE_IMAGES,
  PROTECTED_TOOLS,
  decidePaste,
  decodeDataImage,
  filterBlocks,
} from './paste-logic.mjs';

/**
 * Paste cleanup: turns clipboard content from Word, Google Docs, LibreOffice,
 * multi-block HTML and Markdown into proper editor blocks.
 *
 * The clipboard HTML is parsed into an inert document (DOMParser; nothing is
 * attached to the page and nothing is loaded), converted by
 * `shared/convert`, sanitised with the shared policy (`prepareEditorValue`)
 * and filtered by the field's block rules. Remote images are copied into the
 * Media Library through the server's SSRF-safe upload route, `data:` images
 * are uploaded as files; `file:` and `blob:` images cannot be read and are
 * reported. Pastes into code, raw HTML, table cells and form inputs are left
 * to the browser and Editor.js. Ctrl/Cmd+Shift+V pastes plain text.
 */

const PLAIN_WINDOW_MS = 1000;
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Creates the paste handler of one editor.
 * @param {object} options - Handler options.
 * @param {HTMLElement} options.holder - Editor holder element.
 * @param {object} options.editor - Editor.js instance (ready).
 * @param {(id: string, defaultMessage: string, values?: object) => string} options.t - Translator.
 * @param {(type: string) => boolean} [options.isAllowed] - Block types the field accepts (paragraph always).
 * @param {number[]} [options.allowedHeadingLevels] - Heading levels the field accepts (empty: all).
 * @param {(url: string) => Promise<{ success: number, file?: object }>} [options.uploadImageByUrl] - Copies a remote image into the Media Library.
 * @param {(file: File) => Promise<{ success: number, file?: object }>} [options.uploadImageFile] - Uploads an image file.
 * @param {boolean} [options.canUpload=false] - The admin may upload files.
 * @param {(notice: { type: 'info'|'warning'|'danger', message: string }) => void} [options.notify] - Shows a notification.
 * @param {() => void} [options.onInserted] - Called after blocks were inserted (save the field).
 * @returns {{ destroy: () => void }} Handle.
 */
export function createPasteHandler(options) {
  const {
    holder,
    editor,
    t,
    isAllowed,
    allowedHeadingLevels,
    uploadImageByUrl,
    uploadImageFile,
    canUpload = false,
    notify = () => {},
    onInserted = () => {},
  } = options;
  const allow = (type) => type === 'paragraph' || typeof isAllowed !== 'function' || isAllowed(type) === true;
  let plainOnlyUntil = 0;

  const onKeyDown = (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.code === 'KeyV' || /^v$/i.test(event.key))
    )
      plainOnlyUntil = Date.now() + PLAIN_WINDOW_MS;
  };

  /** Current block index and API (or the end of the document). */
  const current = () => {
    const index = editor.blocks.getCurrentBlockIndex();
    if (index >= 0) return { index, block: editor.blocks.getBlockByIndex(index) };
    return { index: -1, block: null };
  };

  /** Code, raw HTML, table cells and form inputs keep the default paste. */
  const isProtected = (target, block) => {
    const element = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (
      element &&
      element.closest &&
      element.closest('input, textarea, select, .tc-table, .tc-wrap, .mex-table-tool')
    )
      return true;
    return Boolean(block && PROTECTED_TOOLS.includes(block.name));
  };

  /**
   * Converts the clipboard into blocks and lists the images that need an upload.
   * @param {'html'|'markdown'} mode - Source.
   * @param {string} html - Clipboard HTML.
   * @param {string} text - Clipboard text.
   * @returns {{ entries: Array<object>, dropped: number, skippedImages: number }} Insert plan.
   */
  const plan = (mode, html, text) => {
    const result =
      mode === 'html'
        ? htmlToBlocks(html, { parse: parseHtmlWithDom, dataImages: 'placeholder' })
        : markdownToBlocks(text, { parse: parseHtmlWithDom });
    const images = new Map(
      result.report.images.filter((image) => image.index >= 0).map((image) => [image.index, image])
    );
    let skippedImages = result.report.images.filter((image) => image.index < 0).length;
    const prepared = prepareEditorValue({ blocks: result.blocks }).data;
    const cleanById = new Map(((prepared && prepared.blocks) || []).map((block) => [block.id, block]));
    const entries = [];
    let dropped = 0;
    let remote = 0;
    result.blocks.forEach((block, index) => {
      const image = images.get(index);
      if (image && (image.kind === 'remote' || image.kind === 'data')) {
        if (!allow('image')) dropped += 1;
        else if (!canUpload || (image.kind === 'remote' && remote >= MAX_REMOTE_IMAGES)) skippedImages += 1;
        else {
          if (image.kind === 'remote') remote += 1;
          entries.push({ upload: image, alt: block.data.file.alt || '', caption: block.data.caption || '' });
        }
        return;
      }
      const clean = cleanById.get(block.id);
      if (!clean) return;
      const filtered = filterBlocks([clean], { isAllowed: allow, allowedHeadingLevels });
      dropped += filtered.dropped;
      filtered.blocks.forEach((item) => entries.push({ block: item }));
    });
    return { entries, dropped, skippedImages };
  };

  /** Uploads one pasted image; resolves the stored image data or null. */
  const upload = async (entry) => {
    const { upload: image } = entry;
    let response = null;
    try {
      if (image.kind === 'remote' && typeof uploadImageByUrl === 'function') {
        response = await uploadImageByUrl(image.src);
      } else if (image.kind === 'data' && typeof uploadImageFile === 'function') {
        const decoded = decodeDataImage(image.src);
        if (!decoded) return null;
        const file = new File([decoded.bytes], `pasted-image.${EXTENSIONS[decoded.type]}`, {
          type: decoded.type,
        });
        response = await uploadImageFile(file);
      }
    } catch {
      return null;
    }
    if (!response || response.success !== 1 || !response.file || !response.file.url) return null;
    const prepared = prepareEditorValue({
      blocks: [
        {
          type: 'image',
          data: {
            file: { ...response.file, alt: entry.alt || response.file.alt || '' },
            caption: entry.caption,
            withBorder: false,
            withBackground: false,
            stretched: false,
          },
        },
      ],
    }).data;
    return prepared && prepared.blocks[0] ? prepared.blocks[0].data : null;
  };

  /** Inserts the plan after the current block and uploads its images one by one. */
  const insert = async ({ entries, dropped, skippedImages }, { index, block }) => {
    let at = index >= 0 ? index + 1 : editor.blocks.getBlocksCount();
    let replace = false;
    if (block && block.name === 'paragraph' && block.isEmpty) {
      at = index;
      replace = true;
    }
    const before = at > 0 ? editor.blocks.getBlockByIndex(at - 1) : null;
    const baseId = replace
      ? index > 0
        ? editor.blocks.getBlockByIndex(index - 1).id
        : null
      : before && before.id;
    let position = at;
    let last = null;
    for (const entry of entries) {
      if (!entry.block) continue;
      last = editor.blocks.insert(
        entry.block.type,
        entry.block.data,
        undefined,
        position,
        false,
        replace && position === at
      );
      entry.api = last;
      position += 1;
    }
    if (last) editor.caret.setToBlock(last, 'end');
    onInserted();

    let failed = skippedImages;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry.upload) continue;
      const data = await upload(entry);
      if (!data) {
        failed += 1;
        continue;
      }
      const previous = entries
        .slice(0, i)
        .reverse()
        .find((candidate) => candidate.api);
      const anchorId = previous ? previous.api.id : baseId;
      const anchorIndex = anchorId ? editor.blocks.getBlockIndex(anchorId) : -1;
      entry.api = editor.blocks.insert('image', data, undefined, anchorIndex + 1, false);
      onInserted();
    }
    if (dropped > 0)
      notify({
        type: 'warning',
        message: t(
          'editor.paste.blocksDropped',
          '{count, plural, one {# pasted block is} other {# pasted blocks are}} not allowed in this field and {count, plural, one {was} other {were}} left out.',
          { count: dropped }
        ),
      });
    if (failed > 0)
      notify({
        type: 'warning',
        message: canUpload
          ? t(
              'editor.paste.imagesFailed',
              '{count, plural, one {# image} other {# images}} could not be added. Upload {count, plural, one {it} other {them}} with the image block.',
              { count: failed }
            )
          : t(
              'editor.paste.imagesNoUpload',
              '{count, plural, one {# image was} other {# images were}} left out because you cannot upload files.',
              { count: failed }
            ),
      });
  };

  const onPaste = (event) => {
    if (event.defaultPrevented || !event.clipboardData) return;
    if (editor.readOnly && editor.readOnly.isEnabled) return;
    const plainOnly = Date.now() < plainOnlyUntil;
    plainOnlyUntil = 0;
    const data = event.clipboardData;
    const html = data.getData('text/html') || '';
    const text = data.getData('text/plain') || '';
    const position = current();
    const mode = decidePaste({
      html,
      text,
      plainOnly,
      protectedTarget: isProtected(event.target, position.block),
      hasFiles: Boolean(data.files && data.files.length),
    });
    if (!mode) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'plain') {
      // Inserts text without formatting at the caret; the editor saves on the input event.
      document.execCommand('insertText', false, text);
      return;
    }
    let result;
    try {
      result = plan(mode, html, text);
    } catch {
      notify({
        type: 'danger',
        message: t('editor.paste.failed', 'The pasted content could not be converted.'),
      });
      return;
    }
    if (!result.entries.length) {
      if (text) document.execCommand('insertText', false, text);
      return;
    }
    insert(result, position).catch(() => {
      notify({
        type: 'danger',
        message: t('editor.paste.failed', 'The pasted content could not be converted.'),
      });
    });
  };

  holder.addEventListener('keydown', onKeyDown, true);
  holder.addEventListener('paste', onPaste, true);
  return {
    destroy() {
      holder.removeEventListener('keydown', onKeyDown, true);
      holder.removeEventListener('paste', onPaste, true);
    },
  };
}

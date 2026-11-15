import { renderHtml } from '../../../shared/render/html.mjs';
import { renderText } from '../../../shared/render/text.mjs';
import { EDITOR_CLIPBOARD_TYPE } from '../../../shared/reuse.mjs';

/**
 * Block clipboard (2.5): writes blocks the way Editor.js 2.31 copies selected
 * blocks (`application/x-editor-js`, `[{ id, tool, data, tunes }]`), so a
 * paste into any Magic Editor X field (other entries and browser tabs too)
 * keeps every block with its data, and Editor.js editors elsewhere accept it.
 * For pasting outside the editor it adds `text/plain` and `text/html` from
 * the shared renderers: escaped output without scripts, raw HTML blocks are
 * left out (renderer default), synced blocks render nothing.
 *
 * The data goes through a one-off `copy` listener during
 * `document.execCommand('copy')`, because the asynchronous Clipboard API
 * cannot write custom types. It must run while the click that asked for it
 * still counts as user activation.
 */

/**
 * @param {Array<{ id: string, type: string, data: object, tunes?: object }>} blocks - Saved blocks.
 * @returns {boolean} True when the browser accepted the copy.
 */
export const writeBlocksToClipboard = (blocks) => {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (!list.length || typeof document === 'undefined') return false;
  const doc = { blocks: list };
  let html = '';
  let text = '';
  try {
    html = renderHtml(doc);
    text = renderText(doc);
  } catch {
    // The block format still goes on the clipboard.
  }
  const json = JSON.stringify(
    list.map((block) => ({
      id: block.id,
      tool: block.type,
      data: block.data,
      ...(block.tunes ? { tunes: block.tunes } : {}),
    }))
  );
  let written = false;
  const onCopy = (event) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData(EDITOR_CLIPBOARD_TYPE, json);
    written = true;
  };
  document.addEventListener('copy', onCopy, true);
  try {
    document.execCommand('copy');
  } catch {
    written = false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
  }
  return written;
};

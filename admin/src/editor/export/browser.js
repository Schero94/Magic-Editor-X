/**
 * Browser side of "Export…" (2.11): file download, image loading for the
 * Word export and the print view for PDF.
 *
 * All of it works under Strapi's default admin Content Security Policy
 * (`strapi::security`: `default-src 'self'`, `script-src 'self'`,
 * `style-src 'self' 'unsafe-inline' https:`, `img-src 'self' data: blob:`,
 * no `frame-src`, so frames fall back to `default-src 'self'`):
 * - downloads use an object URL on an `<a download>` (no fetch of `blob:`);
 * - images are fetched only from the admin's own origin (`connect-src 'self'`),
 *   with the admin's cookies, at most 10 MiB each and 40 MiB in total;
 * - the print view is an `about:blank` iframe in the admin's own origin that
 *   inherits the admin's policy. It is sandboxed without `allow-scripts`
 *   (`allow-same-origin` lets this module write into it, `allow-modals` lets
 *   `print()` open the dialog), its document is written from the plugin's
 *   own renderer output and one `<style>` element, and it holds no script.
 */

/** Largest image the Word export embeds (bytes). */
export const MAX_EXPORT_IMAGE_BYTES = 10 * 1024 * 1024;
/** Most image bytes one Word export embeds. */
export const MAX_EXPORT_IMAGES_BYTES = 40 * 1024 * 1024;
/** How long the print view waits for its images (ms). */
const IMAGE_WAIT_MS = 8000;

/**
 * Saves data as a file through the browser's download.
 * @param {Uint8Array|string} data - File content.
 * @param {string} fileName - File name.
 * @param {string} type - MIME type.
 * @returns {void}
 */
export const downloadFile = (data, fileName, type) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download has started from the click; the URL is no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Image type by its first bytes (the types Word embeds directly). */
const sniffImage = (bytes) => {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  return null;
};

/**
 * Image loader for the Word export: same-origin images only, bounded, other
 * formats (WebP, AVIF) converted to PNG through a canvas.
 * @param {{ origin?: string }} [options] - Admin origin (defaults to `location.origin`).
 * @returns {(src: string) => Promise<{ data: Uint8Array, type: string, width: number, height: number }|null>} Loader; null means "keep the URL as a link".
 */
export const createImageLoader = ({ origin = window.location.origin } = {}) => {
  let budget = MAX_EXPORT_IMAGES_BYTES;
  return async (src) => {
    let url;
    try {
      url = new URL(src, origin);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null;
    const response = await fetch(url.href, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_EXPORT_IMAGE_BYTES || declared > budget) return null;
    const blob = await response.blob();
    if (blob.size > MAX_EXPORT_IMAGE_BYTES || blob.size > budget || !/^image\//.test(blob.type || 'image/'))
      return null;
    let bytes = new Uint8Array(await blob.arrayBuffer());
    let type = sniffImage(bytes);
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (!bitmap) return null;
    const { width, height } = bitmap;
    if (!type) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png || png.size > MAX_EXPORT_IMAGE_BYTES) return null;
      bytes = new Uint8Array(await png.arrayBuffer());
      type = 'png';
    }
    if (typeof bitmap.close === 'function') bitmap.close();
    if (bytes.length > budget) return null;
    budget -= bytes.length;
    return { data: bytes, type, width, height };
  };
};

let printFrame = null;

/** Removes the print view (after printing, before the next one, or when the dialog goes away). */
export const closePrintView = () => {
  if (printFrame) printFrame.remove();
  printFrame = null;
};

/**
 * Opens the browser's print dialog for an HTML document ("Save as PDF").
 * @param {string} html - Standalone document (`exportHtmlDocument`).
 * @param {{ title: string }} options - Accessible title of the hidden frame.
 * @returns {Promise<HTMLIFrameElement>} The print frame, once `print()` was called.
 */
export const openPrintView = async (html, { title }) => {
  closePrintView();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('data-mex-print', 'true');
  frame.title = title;
  // CSSOM (not a style attribute), so the admin's CSP does not apply; the frame is laid out but not visible.
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(frame);
  printFrame = frame;
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const pending = Array.from(doc.images || []).filter((img) => !img.complete);
  if (pending.length) {
    // Print once every image loaded or failed, or after IMAGE_WAIT_MS (a slow image prints as its alt text).
    await new Promise((resolve) => {
      let left = pending.length;
      const timer = setTimeout(resolve, IMAGE_WAIT_MS);
      const done = () => {
        left -= 1;
        if (left === 0) {
          clearTimeout(timer);
          resolve();
        }
      };
      pending.forEach((img) => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    });
  }
  if (printFrame !== frame) return frame;
  const view = frame.contentWindow;
  view.addEventListener('afterprint', () => {
    if (printFrame === frame) closePrintView();
  });
  view.focus();
  view.print();
  return frame;
};

import ImageTool from '@editorjs/image';
import { el, field, input } from './dom';
import { createFocalControl } from './focal-point';
import { createAltSuggestion, mediaFileId } from '../ai-alt-text';
import {
  focalFromMediaLibrary,
  mediaDisplayUrl,
  mergeMediaLibraryFile,
} from '../../../../shared/media-library.mjs';

/**
 * Alternative text for image blocks: a labelled input plus a "decorative
 * image" checkbox. Field presets can make the text required (`requireAlt`);
 * the save middleware enforces the same rule on the server.
 */

/** Keys Editor.js would otherwise handle (new block, block menu, merge) while typing in the input. */
const OWN_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * Creates the alternative text controls.
 * @param {{ t: Function, alt?: string, decorative?: boolean, required?: boolean, readOnly?: boolean, onChange: (value: { alt: string, decorative: boolean }) => void, suggest?: Function, getFileId?: () => number|null }} options - Options (`suggest` from `createAltTextSuggester` adds the AI suggestion, 2.3).
 * @returns {{ element: HTMLElement, setAlt: (alt: string) => void, read: () => { alt: string, decorative: boolean }, refresh: () => void }} Control.
 */
export const createAltControl = ({
  t,
  alt = '',
  decorative = false,
  required = false,
  readOnly = false,
  onChange,
  suggest,
  getFileId,
}) => {
  const label = required
    ? t('tools.image.altRequired', 'Alternative text (required)')
    : t('tools.image.alt', 'Alternative text');
  const text = input({
    value: alt,
    placeholder: t('tools.image.altPlaceholder', 'Describe the image for people who cannot see it'),
    readOnly,
  });
  text.maxLength = 500;
  text.classList.add('mex-alt__input');
  const box = el('input', { attrs: { type: 'checkbox', disabled: readOnly } });
  box.checked = decorative;
  const error = el('p', { className: 'mex-tool__error', attrs: { role: 'status' } });
  error.id = `mex-alt-error-${Math.random().toString(36).slice(2, 10)}`;
  const check = el('label', {
    className: 'mex-tool__check',
    children: [
      box,
      el('span', { text: t('tools.image.decorative', 'Decorative image (no alternative text)') }),
    ],
  });
  const row = field(label, text);
  const wrapper = el('div', { className: 'mex-alt', children: [row, check, error] });
  let suggestion = null;

  const read = () => ({ alt: box.checked ? '' : text.value.trim().slice(0, 500), decorative: box.checked });
  const validate = () => {
    const missing = required && !box.checked && !text.value.trim();
    text.setAttribute('aria-invalid', missing ? 'true' : 'false');
    if (missing) text.setAttribute('aria-describedby', error.id);
    else text.removeAttribute('aria-describedby');
    error.textContent = missing
      ? t('tools.image.altMissing', 'Add an alternative text or mark the image as decorative.')
      : '';
  };
  const sync = () => {
    text.disabled = box.checked || readOnly;
    validate();
  };
  text.addEventListener('keydown', (event) => {
    if (OWN_KEYS.has(event.key)) event.stopPropagation();
    if (event.key === 'Enter') event.preventDefault();
  });
  // Editor.js treats paste inside a block as block content; keep it in the input.
  text.addEventListener('paste', (event) => event.stopPropagation());
  text.addEventListener('input', () => {
    validate();
    onChange(read());
  });
  box.addEventListener('change', () => {
    sync();
    onChange(read());
  });
  if (typeof suggest === 'function' && typeof getFileId === 'function' && !readOnly) {
    suggestion = createAltSuggestion({
      t,
      getFileId,
      suggest,
      onUse: (value) => {
        box.checked = false;
        text.value = value.slice(0, 500);
        sync();
        onChange(read());
      },
    });
    wrapper.insertBefore(suggestion.element, check);
  }
  sync();
  return {
    element: wrapper,
    refresh: () => suggestion && suggestion.refresh(),
    read,
    setAlt: (value) => {
      if (text.value.trim() || box.checked) return;
      text.value = typeof value === 'string' ? value.slice(0, 500) : '';
      validate();
    },
  };
};

/**
 * The official image tool plus the alternative text controls. Stored data
 * stays `{ file: { url, alt, ... }, caption, withBorder, withBackground,
 * stretched }` and gains `decorative: true` for decorative images and
 * `focalPoint: { x, y }` (0..1) when a focal point is set.
 */
export class MexImageTool extends ImageTool {
  /**
   * @param {object} options - Editor.js tool options.
   */
  constructor(options) {
    super(options);
    const data = (options && options.data) || {};
    const config = (options && options.config) || {};
    this.mexAlt = createAltControl({
      t: typeof config.t === 'function' ? config.t : (_id, fallback) => fallback,
      alt: (data.file && typeof data.file.alt === 'string' && data.file.alt) || '',
      decorative: data.decorative === true,
      required: config.requireAlt === true,
      readOnly: Boolean(options && options.readOnly),
      suggest: typeof config.suggestAltText === 'function' ? config.suggestAltText : undefined,
      getFileId: () => mediaFileId(this.data && this.data.file),
      onChange: () => {
        if (options && options.block && typeof options.block.dispatchChange === 'function')
          options.block.dispatchChange();
      },
    });
    this.mexAlt.element.classList.add('mex-alt--image');
    const translate = typeof config.t === 'function' ? config.t : (_id, fallback) => fallback;
    this.mexFocal = createFocalControl({
      t: translate,
      url: (data.file && typeof data.file.url === 'string' && data.file.url) || '',
      point: data.focalPoint,
      readOnly: Boolean(options && options.readOnly),
      onChange: () => {
        if (options && options.block && typeof options.block.dispatchChange === 'function')
          options.block.dispatchChange();
      },
    });
    // 2.12: "Edit in Media Library" (crop and focus there), rendered by the field through a portal.
    this.mexBlock = (options && options.block) || null;
    this.mexMountMedia =
      typeof config.mountMediaEdit === 'function' && !(options && options.readOnly)
        ? config.mountMediaEdit
        : null;
    this.mexMediaListeners = new Set();
    this.mexUnmountMedia = null;
    // A new upload or Media Library file brings its own alternative text.
    const ui = this.ui;
    if (ui && typeof ui.fillImage === 'function') {
      const fill = ui.fillImage.bind(ui);
      ui.fillImage = (url) => {
        fill(url);
        const file = this.data && this.data.file;
        if (file && typeof file.alt === 'string') this.mexAlt.setAlt(file.alt);
        this.mexFocal.setUrl(typeof url === 'string' ? url : '');
        this.mexAlt.refresh();
        for (const listener of [...this.mexMediaListeners]) listener();
      };
    }
  }

  /**
   * 2.12: takes the file back from the Media Library after it was edited there (crop, replace).
   * URL, size and formats follow the Media Library; the block keeps its alternative text. The
   * Media Library's focal point (0-100) becomes the block's focal point (0-1) only when the block
   * has none.
   * @param {object} fresh - File from `GET /upload/files/:id`.
   * @returns {boolean} Whether the block changed (then Editor.js is told, so the form saves it).
   */
  mexApplyMediaFile(fresh) {
    const stored = this.data && this.data.file;
    const next = mergeMediaLibraryFile(stored, fresh);
    let changed = false;
    if (next) {
      // `data` is the tool's own object: set the file without the image setter, which would draw a
      // second picture (`fillImage` appends an element every time).
      this.data.file = next;
      const ui = this.ui;
      if (ui && typeof ui.fillImage === 'function') {
        const previous = ui.nodes && ui.nodes.imageEl;
        // Strapi keeps the URL when a file is replaced: show the new file, store the clean URL.
        ui.fillImage(mediaDisplayUrl(next.url, fresh.updatedAt));
        if (previous && ui.nodes.imageEl !== previous) previous.remove();
      }
      changed = true;
    }
    const focal = focalFromMediaLibrary(fresh && fresh.focalPoint);
    if (focal && this.mexFocal.setDefault(focal)) changed = true;
    if (changed && this.mexBlock && typeof this.mexBlock.dispatchChange === 'function')
      this.mexBlock.dispatchChange();
    return changed;
  }

  /**
   * Renders the official tool and appends the alternative text controls.
   * @returns {HTMLElement} Block content.
   */
  render() {
    const wrapper = super.render();
    // The caption is absolutely positioned at the bottom of the wrapper; the
    // alternative text goes before it, in normal flow below the image.
    const caption = this.ui && this.ui.nodes && this.ui.nodes.caption;
    const parts = [this.mexAlt.element, this.mexFocal.element];
    if (this.mexMountMedia) {
      // Marked mutation-free: the React view's own updates are not edits of the block.
      const mount = el('div', { className: 'mex-media-edit', attrs: { 'data-mutation-free': 'true' } });
      mount.addEventListener('keydown', (event) => {
        const target = event.target;
        if (target && target !== mount && target.closest && target.closest('button, a, [tabindex]'))
          event.stopPropagation();
      });
      // Same row as "Set focal point": both act on the picture.
      this.mexFocal.addBeside(mount);
      if (typeof this.mexUnmountMedia === 'function') this.mexUnmountMedia();
      this.mexUnmountMedia = this.mexMountMedia(mount, {
        blockId: this.mexBlock && this.mexBlock.id,
        getFile: () => (this.data && this.data.file) || null,
        subscribe: (listener) => {
          this.mexMediaListeners.add(listener);
          return () => this.mexMediaListeners.delete(listener);
        },
        applyFile: (fresh) => this.mexApplyMediaFile(fresh),
      });
    }
    if (caption && caption.parentNode === wrapper) {
      for (const part of parts) wrapper.insertBefore(part, caption);
    } else wrapper.append(...parts);
    return wrapper;
  }

  /** 2.12: removes the "Edit in Media Library" view (block removed or editor destroyed). */
  destroy() {
    const unmount = this.mexUnmountMedia;
    this.mexUnmountMedia = null;
    this.mexMediaListeners.clear();
    if (typeof unmount === 'function') unmount();
    if (typeof super.destroy === 'function') super.destroy();
  }

  /** Editor.js calls `removed` when the block is deleted. */
  removed() {
    this.destroy();
    if (typeof super.removed === 'function') super.removed();
  }

  /**
   * Adds the alternative text and the decorative flag to the saved data.
   * @returns {object} Block data.
   */
  save() {
    const data = super.save();
    const { alt, decorative } = this.mexAlt.read();
    const out = { ...data, file: { ...(data.file || {}), alt } };
    if (decorative) out.decorative = true;
    else delete out.decorative;
    const focalPoint = this.mexFocal.read();
    if (focalPoint) out.focalPoint = focalPoint;
    else delete out.focalPoint;
    return out;
  }
}

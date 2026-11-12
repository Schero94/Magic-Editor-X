import { ICONS, el, field, input, select, button, editable } from './dom';
import { createAltControl } from './alt-text';
import { createFocalControl } from './focal-point';
import { sanitizeInline, sanitizeUrl } from '../sanitize';
import {
  MAX_GALLERY_IMAGES,
  MAX_MEDIA_TRACKS,
  TRACK_KINDS,
  normalizeGallery,
  normalizeVideo,
  normalizeAudio,
  isImageAsset,
  isVideoAsset,
  isAudioAsset,
  assetToFile,
  addGalleryImages,
  moveItem,
  addTrack,
  hasCaptions,
} from './media-logic.mjs';

/**
 * Media Library blocks of 2.3: `gallery`, `video` and `audio`.
 *
 * Files are chosen in the Strapi Media Library dialog (`config.openMediaLibrary`,
 * which needs `plugin::upload.read`); the blocks store the Media Library file
 * id next to url, size, MIME type and formats. Without read access the tools
 * are not offered and existing blocks say why files cannot be chosen.
 * Untrusted strings reach the DOM only through `textContent`, `value`,
 * `sanitizeInline` (captions) and `sanitizeUrl` (src attributes).
 */

/** Keys Editor.js handles itself (new block, navigation) that must stay inside the tool's inputs. */
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
 * Keeps typing and pasting inside a form control instead of Editor.js.
 * @param {HTMLElement} node - Input or select.
 * @returns {HTMLElement} The node.
 */
const guard = (node) => {
  node.addEventListener('keydown', (event) => {
    if (OWN_KEYS.has(event.key)) event.stopPropagation();
    if (event.key === 'Enter' && node.tagName === 'INPUT' && node.type !== 'checkbox') event.preventDefault();
  });
  node.addEventListener('paste', (event) => event.stopPropagation());
  return node;
};

/**
 * Checkbox with a label.
 * @param {string} label - Label.
 * @param {boolean} checked - State.
 * @param {boolean} disabled - Read only.
 * @returns {{ element: HTMLElement, box: HTMLInputElement }} Control.
 */
const checkbox = (label, checked, disabled) => {
  const box = guard(el('input', { attrs: { type: 'checkbox', disabled } }));
  box.checked = checked;
  return {
    element: el('label', { className: 'mex-tool__check', children: [box, el('span', { text: label })] }),
    box,
  };
};

/**
 * Icon-only button with an accessible name.
 * @param {string} label - Accessible name (also the tooltip).
 * @param {string} icon - Trusted SVG from `ICONS`.
 * @param {string} [variant] - Button variant.
 * @returns {HTMLButtonElement} Button.
 */
const iconButton = (label, icon, variant = 'secondary') => {
  const node = button('', { variant, icon, ariaLabel: label });
  node.classList.add('mex-tool__button--icon');
  node.title = label;
  return node;
};

/**
 * URL a preview may load (http(s) or site-relative), or ''.
 * @param {unknown} url - Stored URL.
 * @returns {string} URL.
 */
const previewUrl = (url) => sanitizeUrl(url, { schemes: ['http', 'https'] });

/**
 * Smallest useful preview of a Media Library image.
 * @param {object} file - Stored file.
 * @param {string[]} [order] - Format names to try first.
 * @returns {string} URL.
 */
const thumbnailOf = (file, order = ['small', 'thumbnail', 'medium']) => {
  const formats = file && file.formats && typeof file.formats === 'object' ? file.formats : {};
  for (const name of order) if (formats[name] && formats[name].url) return previewUrl(formats[name].url);
  return previewUrl(file && file.url);
};

/** Shared base: translation, change notification, Media Library access. */
class MediaBaseTool {
  static get isReadOnlySupported() {
    return true;
  }

  constructor({ data, api, config, readOnly, block }) {
    this.api = api;
    this.guardKeys = (event) => {
      // Buttons, selects and checkboxes of the tool handle Enter/Space/Tab themselves;
      // Editor.js would otherwise add or move blocks. Captions (contenteditable) keep Editor.js keys.
      const target = event.target;
      if (target && target.isContentEditable) return;
      if (['Enter', ' ', 'Tab', 'Backspace', 'Delete'].includes(event.key)) event.stopPropagation();
    };
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.rawData = data || {};
    this.wrapper = null;
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  /** @returns {boolean} True when the Media Library dialog can be opened. */
  canPick() {
    return (
      !this.readOnly && this.config.canBrowse === true && typeof this.config.openMediaLibrary === 'function'
    );
  }

  /**
   * Message for editors without Media Library read access.
   * @returns {HTMLElement|null} Message or null.
   */
  noAccessNotice() {
    if (this.readOnly || this.canPick()) return null;
    return el('p', {
      className: 'mex-tool__muted',
      attrs: { role: 'note' },
      text: this.t(
        'tools.media.noAccess',
        'You cannot choose files: your role has no read access to the Media Library. Ask an administrator for it.'
      ),
    });
  }

  /**
   * Opens the Media Library dialog and returns focus to `trigger` afterwards.
   * @param {{ multiple: boolean, allowedTypes: string[], accept: (asset: object) => boolean }} request - Picker request.
   * @param {HTMLElement} trigger - Button that opened the dialog.
   * @param {(assets: object[]) => void} onPicked - Receives the accepted assets (not called on cancel).
   */
  pick(request, trigger, onPicked) {
    if (!this.canPick()) return;
    this.config.openMediaLibrary({
      ...request,
      onSelect: (assets) => {
        if (Array.isArray(assets) && assets.length) onPicked(assets);
        window.setTimeout(() => {
          const target = this.focusAfterPick || trigger;
          this.focusAfterPick = null;
          if (target && target.isConnected && !target.disabled) target.focus();
        }, 0);
      },
    });
  }

  /**
   * Caption editor (inline HTML).
   * @param {string} html - Stored caption.
   * @param {string} placeholder - Placeholder and accessible name.
   * @param {(html: string) => void} onInput - Receives the new HTML.
   * @returns {HTMLElement} Editable.
   */
  captionEditor(html, placeholder, onInput) {
    const node = editable({
      html: sanitizeInline(html),
      placeholder,
      label: placeholder,
      readOnly: this.readOnly,
      className: 'mex-tool__caption',
    });
    node.classList.add('mex-media__caption');
    node.addEventListener('input', () => {
      onInput(node.innerHTML);
      this.changed();
    });
    return node;
  }
}

/* ---------------------------------------------------------------- gallery */

export class GalleryTool extends MediaBaseTool {
  static get toolbox() {
    return { title: 'Gallery', icon: ICONS.gallery };
  }

  constructor(options) {
    super(options);
    this.data = normalizeGallery(this.rawData);
  }

  render() {
    this.wrapper = el('div', { className: 'mex-gallery-tool' });
    this.wrapper.addEventListener('keydown', this.guardKeys);
    this.draw();
    return this.wrapper;
  }

  /**
   * Redraws the block. `focus` names the control to focus afterwards.
   * @param {{ index: number, action: string }|'add'|null} [focus] - Focus target.
   */
  draw(focus = null) {
    const w = this.wrapper;
    w.replaceChildren();
    const count = this.data.images.length;
    const full = count >= MAX_GALLERY_IMAGES;

    const add = button(this.t('tools.gallery.add', 'Add images'), { variant: 'primary', icon: ICONS.plus });
    add.dataset.mexAction = 'add';
    add.disabled = full || !this.canPick();
    add.addEventListener('click', () =>
      this.pick({ multiple: true, allowedTypes: ['images'], accept: isImageAsset }, add, (assets) => {
        const result = addGalleryImages(this.data.images, assets);
        this.data.images = result.images;
        this.draw('add');
        this.notice(result.skipped);
        this.changed();
      })
    );

    const layout = guard(
      select(
        [
          { value: 'grid', label: this.t('tools.gallery.layoutGrid', 'Grid') },
          { value: 'carousel', label: this.t('tools.gallery.layoutCarousel', 'Carousel') },
        ],
        this.data.layout
      )
    );
    layout.disabled = this.readOnly;
    const columns = guard(
      select(
        [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
        String(this.data.columns)
      )
    );
    columns.disabled = this.readOnly || this.data.layout !== 'grid';
    layout.addEventListener('change', () => {
      this.data.layout = layout.value === 'carousel' ? 'carousel' : 'grid';
      columns.disabled = this.readOnly || this.data.layout !== 'grid';
      this.changed();
    });
    columns.addEventListener('change', () => {
      this.data.columns = Number(columns.value) || 3;
      this.changed();
    });
    const settings = el('div', {
      className: 'mex-media__toolbar',
      children: [
        field(this.t('tools.gallery.layout', 'Layout'), layout),
        field(this.t('tools.gallery.columns', 'Columns (grid)'), columns),
        ...(this.readOnly ? [] : [el('div', { className: 'mex-media__toolbar-action', children: [add] })]),
      ],
    });
    const status = el('p', {
      className: 'mex-tool__muted',
      attrs: { 'aria-live': 'polite' },
      text: count
        ? this.t('tools.gallery.count', '{count, plural, one {# image} other {# images}} (at most {max})', {
            count,
            max: MAX_GALLERY_IMAGES,
          })
        : this.t('tools.gallery.empty', 'No images yet. Add images from the Media Library.'),
    });
    this.status = status;
    w.append(settings, status);
    const notice = this.noAccessNotice();
    if (notice) w.append(notice);

    const list = el('ul', {
      className: 'mex-gallery-tool__items',
      attrs: { 'aria-label': this.t('tools.gallery.list', 'Gallery images') },
    });
    this.data.images.forEach((image, index) => list.appendChild(this.item(image, index, count)));
    if (count) w.append(list);
    w.append(
      this.captionEditor(this.data.caption, this.t('tools.gallery.caption', 'Gallery caption'), (html) => {
        this.data.caption = html;
      })
    );

    if (focus === 'add') add.focus();
    else if (focus && typeof focus === 'object') {
      const target =
        w.querySelector(
          `[data-mex-index="${focus.index}"] [data-mex-action="${focus.action}"]:not(:disabled)`
        ) ||
        w.querySelector(`[data-mex-index="${focus.index}"] [data-mex-action]:not(:disabled)`) ||
        (add.disabled ? null : add);
      if (target) target.focus();
    }
  }

  /**
   * Reports skipped files of a pick (non-images, gallery full).
   * @param {number} skipped - Skipped files.
   */
  notice(skipped) {
    if (!skipped || !this.status) return;
    this.status.textContent = this.t(
      'tools.gallery.skipped',
      '{count, plural, one {# file was} other {# files were}} not added (only images, at most {max}).',
      { count: skipped, max: MAX_GALLERY_IMAGES }
    );
  }

  /**
   * One gallery image card.
   * @param {object} image - Image entry.
   * @param {number} index - Position.
   * @param {number} count - Number of images.
   * @returns {HTMLLIElement} Card.
   */
  item(image, index, count) {
    const position = { index: index + 1, count };
    const thumb = el('img', {
      className: 'mex-gallery-tool__thumb',
      attrs: { src: thumbnailOf(image.file), alt: '', loading: 'lazy' },
    });
    const label = el('p', {
      className: 'mex-gallery-tool__position',
      text: this.t('tools.gallery.position', 'Image {index} of {count}', position),
    });
    const actions = el('div', { className: 'mex-gallery-tool__actions' });
    if (!this.readOnly) {
      const earlier = iconButton(
        this.t('tools.gallery.moveEarlier', 'Move image {index} earlier', position),
        ICONS.arrowLeft
      );
      earlier.dataset.mexAction = 'earlier';
      earlier.disabled = index === 0;
      earlier.addEventListener('click', () => this.move(index, index - 1, 'earlier'));
      const later = iconButton(
        this.t('tools.gallery.moveLater', 'Move image {index} later', position),
        ICONS.arrowRight
      );
      later.dataset.mexAction = 'later';
      later.disabled = index === count - 1;
      later.addEventListener('click', () => this.move(index, index + 1, 'later'));
      const remove = iconButton(
        this.t('tools.gallery.remove', 'Remove image {index}', position),
        ICONS.trash,
        'danger'
      );
      remove.dataset.mexAction = 'remove';
      remove.addEventListener('click', () => {
        this.data.images = this.data.images.filter((_, i) => i !== index);
        const next = Math.min(index, this.data.images.length - 1);
        this.draw(next >= 0 ? { index: next, action: 'remove' } : 'add');
        this.changed();
      });
      actions.append(earlier, later, remove);
    }
    const alt = createAltControl({
      t: (id, fallback, values) => this.t(id, fallback, values),
      alt: (image.file && image.file.alt) || '',
      decorative: image.decorative === true,
      required: this.config.requireAlt === true,
      readOnly: this.readOnly,
      onChange: (value) => {
        image.file = { ...image.file, alt: value.alt };
        if (value.decorative) image.decorative = true;
        else delete image.decorative;
        this.changed();
      },
    });
    const caption = this.captionEditor(image.caption, this.t('tools.common.caption', 'Caption'), (html) => {
      image.caption = html;
    });
    const focal = createFocalControl({
      t: (id, fallback, values) => this.t(id, fallback, values),
      url: thumbnailOf(image.file, ['medium', 'small', 'large']),
      point: image.focalPoint,
      readOnly: this.readOnly,
      onChange: (point) => {
        if (point) image.focalPoint = point;
        else delete image.focalPoint;
        this.changed();
      },
    });
    return el('li', {
      className: 'mex-gallery-tool__item',
      attrs: { 'data-mex-index': String(index) },
      children: [
        el('div', { className: 'mex-gallery-tool__media', children: [thumb] }),
        el('div', { className: 'mex-gallery-tool__head', children: [label, actions] }),
        alt.element,
        caption,
        focal.element,
      ],
    });
  }

  /**
   * Moves an image and keeps focus on the same action.
   * @param {number} from - Index.
   * @param {number} to - Target index.
   * @param {string} action - Action to focus afterwards.
   */
  move(from, to, action) {
    const next = moveItem(this.data.images, from, to);
    if (next === this.data.images) return;
    this.data.images = next;
    this.draw({ index: Math.max(0, Math.min(next.length - 1, to)), action });
    this.changed();
  }

  save() {
    return {
      images: this.data.images.map((image) => {
        const out = { file: image.file, caption: image.caption || '' };
        if (image.decorative) out.decorative = true;
        if (image.focalPoint) out.focalPoint = image.focalPoint;
        return out;
      }),
      layout: this.data.layout,
      columns: this.data.columns,
      caption: this.data.caption || '',
    };
  }

  validate(data) {
    return Array.isArray(data.images) && data.images.length > 0;
  }
}

/* ----------------------------------------------------------- video, audio */

/**
 * Video and audio share one tool; `kind` decides the element, the accepted
 * MIME type and the extra video options (poster, muted).
 */
class PlayerTool extends MediaBaseTool {
  /** @returns {'video'|'audio'} Kind. */
  get kind() {
    return 'video';
  }

  render() {
    this.wrapper = el('div', { className: ['mex-media', `mex-media--${this.kind}`] });
    this.wrapper.addEventListener('keydown', this.guardKeys);
    this.draw();
    return this.wrapper;
  }

  /** Labels per kind. */
  get labels() {
    return this.kind === 'video'
      ? {
          choose: this.t('tools.video.choose', 'Choose a video'),
          replace: this.t('tools.video.replace', 'Replace video'),
          empty: this.t('tools.video.empty', 'No video yet. Choose one from the Media Library.'),
        }
      : {
          choose: this.t('tools.audio.choose', 'Choose an audio file'),
          replace: this.t('tools.audio.replace', 'Replace audio file'),
          empty: this.t('tools.audio.empty', 'No audio file yet. Choose one from the Media Library.'),
        };
  }

  /**
   * Redraws the block.
   * @param {string|null} [focus] - `data-mex-action` of the control to focus.
   */
  draw(focus = null) {
    const w = this.wrapper;
    w.replaceChildren();
    const accept = this.kind === 'video' ? isVideoAsset : isAudioAsset;
    const allowedTypes = [this.kind === 'video' ? 'videos' : 'audios'];
    const url = previewUrl(this.data.file && this.data.file.url);
    const choose = button(url ? this.labels.replace : this.labels.choose, {
      variant: url ? 'secondary' : 'primary',
      icon: ICONS[this.kind],
    });
    choose.dataset.mexAction = 'choose';
    choose.disabled = !this.canPick();
    choose.addEventListener('click', () =>
      this.pick({ multiple: false, allowedTypes, accept }, choose, (assets) => {
        this.data.file = assetToFile(assets[0]);
        if (!this.data.title && typeof assets[0].caption === 'string')
          this.data.title = assets[0].caption.slice(0, 200);
        this.draw('choose');
        this.changed();
      })
    );
    const notice = this.noAccessNotice();

    if (!url) {
      w.append(el('p', { className: 'mex-tool__muted', text: this.labels.empty }));
      if (!this.readOnly) w.append(choose);
      if (notice) w.append(notice);
      return;
    }

    const player = el(this.kind, {
      className: 'mex-media__player',
      attrs: { controls: true, preload: 'metadata', src: url },
    });
    if (this.kind === 'video') {
      player.muted = true;
      const poster = previewUrl(this.data.poster && this.data.poster.url);
      if (poster) player.setAttribute('poster', poster);
      player.setAttribute('playsinline', '');
    }
    for (const track of this.data.tracks) {
      const src = previewUrl(track.file && track.file.url);
      if (!src) continue;
      player.appendChild(
        el('track', {
          attrs: {
            kind: track.kind,
            src,
            srclang: track.srclang || null,
            label: track.label || null,
            default: track.default === true,
          },
        })
      );
    }
    if (this.data.title) player.setAttribute('aria-label', this.data.title);
    const fileName = el('p', {
      className: 'mex-media__file',
      text: (this.data.file && this.data.file.name) || url,
    });

    const title = guard(input({ value: this.data.title, readOnly: this.readOnly }));
    title.maxLength = 200;
    title.addEventListener('input', () => {
      this.data.title = title.value.slice(0, 200);
      this.changed();
    });
    const caption = this.captionEditor(
      this.data.caption,
      this.t('tools.common.caption', 'Caption'),
      (html) => {
        this.data.caption = html;
      }
    );

    const loop = checkbox(this.t('tools.media.loop', 'Play in a loop'), this.data.loop, this.readOnly);
    loop.box.addEventListener('change', () => {
      this.data.loop = loop.box.checked;
      this.changed();
    });
    const flags = el('div', { className: 'mex-media__flags', children: [loop.element] });
    if (this.kind === 'video') {
      const muted = checkbox(this.t('tools.video.muted', 'Start muted'), this.data.muted, this.readOnly);
      muted.box.addEventListener('change', () => {
        this.data.muted = muted.box.checked;
        this.changed();
      });
      flags.append(muted.element);
    }

    w.append(
      el('div', { className: 'mex-media__preview', children: [player] }),
      el('div', {
        className: 'mex-media__toolbar',
        children: [fileName, ...(this.readOnly ? [] : [choose])],
      }),
      field(this.t('tools.media.title', 'Title (accessible name)'), title),
      caption,
      flags
    );
    if (this.kind === 'video') w.append(this.posterSection());
    w.append(this.tracksSection());
    if (notice) w.append(notice);
    if (focus) {
      const target = w.querySelector(`[data-mex-action="${focus}"]:not(:disabled)`);
      if (target) target.focus();
    }
  }

  /** @returns {HTMLElement} Poster controls (video only). */
  posterSection() {
    const url = thumbnailOf(this.data.poster || {}, ['small', 'thumbnail']);
    const choose = button(
      url
        ? this.t('tools.video.posterReplace', 'Replace poster image')
        : this.t('tools.video.poster', 'Choose a poster image'),
      { icon: ICONS.image }
    );
    choose.dataset.mexAction = 'poster';
    choose.disabled = !this.canPick();
    choose.addEventListener('click', () =>
      this.pick({ multiple: false, allowedTypes: ['images'], accept: isImageAsset }, choose, (assets) => {
        this.data.poster = assetToFile(assets[0], { image: true });
        this.draw('poster');
        this.changed();
      })
    );
    const children = [
      el('p', { className: 'mex-tool__label', text: this.t('tools.video.posterLabel', 'Poster image') }),
    ];
    if (url) children.push(el('img', { className: 'mex-media__poster', attrs: { src: url, alt: '' } }));
    else
      children.push(
        el('p', { className: 'mex-tool__muted', text: this.t('tools.video.noPoster', 'No poster image.') })
      );
    if (!this.readOnly) {
      const row = el('div', { className: 'mex-media__row', children: [choose] });
      if (url) {
        const remove = button(this.t('tools.video.posterRemove', 'Remove poster image'), {
          variant: 'danger',
        });
        remove.addEventListener('click', () => {
          delete this.data.poster;
          this.draw('poster');
          this.changed();
        });
        row.append(remove);
      }
      children.push(row);
    }
    return el('div', { className: 'mex-media__section', children });
  }

  /** @returns {HTMLElement} Text track controls. */
  tracksSection() {
    const section = el('div', { className: 'mex-media__section' });
    section.append(
      el('p', {
        className: 'mex-tool__label',
        text: this.t('tools.media.tracks', 'Captions and subtitles (WebVTT)'),
      })
    );
    if (this.kind === 'video' && !hasCaptions(this.data))
      section.append(
        el('p', {
          className: 'mex-tool__muted',
          text: this.t(
            'tools.video.captionsHint',
            'Add captions so people who cannot hear the video can follow it.'
          ),
        })
      );
    const kinds = TRACK_KINDS.map((kind) => ({
      value: kind,
      label: {
        captions: this.t('tools.media.kindCaptions', 'Captions'),
        subtitles: this.t('tools.media.kindSubtitles', 'Subtitles'),
        descriptions: this.t('tools.media.kindDescriptions', 'Descriptions'),
        chapters: this.t('tools.media.kindChapters', 'Chapters'),
      }[kind],
    }));
    const list = el('ul', { className: 'mex-media__tracks' });
    const defaults = [];
    this.data.tracks.forEach((track, index) => {
      const name = (track.file && track.file.name) || (track.file && track.file.url) || '';
      const kind = guard(select(kinds, track.kind));
      kind.disabled = this.readOnly;
      kind.addEventListener('change', () => {
        track.kind = kind.value;
        this.changed();
      });
      const lang = guard(input({ value: track.srclang, placeholder: 'en', readOnly: this.readOnly }));
      lang.maxLength = 35;
      lang.addEventListener('input', () => {
        track.srclang = lang.value.trim();
        this.changed();
      });
      const label = guard(input({ value: track.label, readOnly: this.readOnly }));
      label.maxLength = 100;
      label.addEventListener('input', () => {
        track.label = label.value;
        this.changed();
      });
      const isDefault = checkbox(
        this.t('tools.media.trackDefault', 'Show by default'),
        track.default === true,
        this.readOnly
      );
      defaults.push(isDefault.box);
      isDefault.box.addEventListener('change', () => {
        // At most one default track: unchecking the others keeps focus where it is.
        this.data.tracks.forEach((other) => delete other.default);
        defaults.forEach((box) => {
          if (box !== isDefault.box) box.checked = false;
        });
        if (isDefault.box.checked) track.default = true;
        this.changed();
      });
      const row = el('li', {
        className: 'mex-media__track',
        attrs: { 'data-mex-index': String(index) },
        children: [
          el('p', { className: 'mex-media__file', text: name }),
          el('div', {
            className: 'mex-tool__grid',
            children: [
              field(this.t('tools.media.trackKind', 'Kind'), kind),
              field(this.t('tools.media.trackLanguage', 'Language (for example en, de)'), lang),
              field(this.t('tools.media.trackLabel', 'Label'), label),
            ],
          }),
          isDefault.element,
        ],
      });
      if (!this.readOnly) {
        const remove = button(this.t('tools.media.trackRemove', 'Remove track {name}', { name }), {
          variant: 'danger',
          icon: ICONS.trash,
        });
        remove.addEventListener('click', () => {
          this.data.tracks = this.data.tracks.filter((_, i) => i !== index);
          if (this.data.tracks.length && !this.data.tracks.some((other) => other.default))
            this.data.tracks[0].default = true;
          this.draw('track');
          this.changed();
        });
        row.append(remove);
      }
      list.append(row);
    });
    if (this.data.tracks.length) section.append(list);
    if (!this.readOnly) {
      const add = button(this.t('tools.media.trackAdd', 'Add a WebVTT file'), { icon: ICONS.plus });
      add.dataset.mexAction = 'track';
      add.disabled = !this.canPick() || this.data.tracks.length >= MAX_MEDIA_TRACKS;
      const error = el('p', { className: 'mex-tool__error', attrs: { 'aria-live': 'polite' } });
      add.addEventListener('click', () =>
        this.pick({ multiple: false, allowedTypes: ['files'], accept: () => true }, add, (assets) => {
          const locale = typeof this.config.getLocale === 'function' ? this.config.getLocale() : '';
          const next = addTrack(this.data.tracks, assets[0], typeof locale === 'string' ? locale : '');
          if (!next) {
            error.textContent = this.t('tools.media.trackInvalid', 'Choose a WebVTT file (.vtt).');
            return;
          }
          this.data.tracks = next;
          this.draw('track');
          this.changed();
        })
      );
      section.append(add, error);
    }
    return section;
  }

  save() {
    const out = {
      file: this.data.file,
      title: this.data.title || '',
      caption: this.data.caption || '',
      loop: this.data.loop === true,
      tracks: this.data.tracks.map((track) => {
        const clean = {
          file: track.file,
          kind: track.kind,
          srclang: track.srclang || '',
          label: track.label || '',
        };
        if (track.default) clean.default = true;
        return clean;
      }),
    };
    if (this.kind === 'video') {
      out.muted = this.data.muted === true;
      if (this.data.poster && this.data.poster.url) out.poster = this.data.poster;
    }
    return out;
  }

  validate(data) {
    return Boolean(data.file && data.file.url);
  }
}

export class VideoTool extends PlayerTool {
  static get toolbox() {
    return { title: 'Video', icon: ICONS.video };
  }

  constructor(options) {
    super(options);
    this.data = normalizeVideo(this.rawData);
  }

  get kind() {
    return 'video';
  }
}

export class AudioTool extends PlayerTool {
  static get toolbox() {
    return { title: 'Audio', icon: ICONS.audio };
  }

  constructor(options) {
    super(options);
    this.data = normalizeAudio(this.rawData);
  }

  get kind() {
    return 'audio';
  }
}

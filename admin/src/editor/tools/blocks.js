import { ICONS, el, field, input, select, button, editable } from './dom';
import { createAltControl } from './alt-text';
import { sanitizeInline, sanitizeUrl } from '../sanitize';
import { LINK_SANITIZE, SPAN_SANITIZE, SUP_SANITIZE } from './sanitize-config';
import {
  ALERT_TYPES,
  ALERT_ALIGNMENTS,
  BUTTON_STYLES,
  normalizeAlert,
  normalizeButton,
  normalizeSimpleImage,
  normalizePersonality,
  normalizeLinkTool,
} from './logic.mjs';

/**
 * In-repo block tools that replace unmaintained community packages while
 * reading and writing the same data:
 * alert (editorjs-alert), delimiter (@editorjs/delimiter), simpleImage
 * (@editorjs/simple-image), personality (@editorjs/personality), button (1.x
 * in-repo), linkTool (@editorjs/link) and the Media Library toolbox entry.
 */

const INLINE_SANITIZE = {
  b: true,
  strong: true,
  i: true,
  em: true,
  u: { class: 'cdx-underline' },
  s: { class: 'cdx-strikethrough' },
  mark: { class: 'cdx-marker' },
  code: { class: 'inline-code' },
  a: { ...LINK_SANITIZE },
  span: { ...SPAN_SANITIZE },
  sup: { ...SUP_SANITIZE },
  br: true,
};

/** Base with translation helper. */
class BaseTool {
  static get isReadOnlySupported() {
    return true;
  }

  constructor({ data, api, config, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.rawData = data || {};
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }
}

/* ------------------------------------------------------------------ alert */

export class AlertTool extends BaseTool {
  static get toolbox() {
    return { title: 'Alert', icon: ICONS.alert };
  }

  static get sanitize() {
    return { message: INLINE_SANITIZE, type: false, align: false };
  }

  static get enableLineBreaks() {
    return true;
  }

  static get conversionConfig() {
    return { export: 'message', import: 'message' };
  }

  constructor(options) {
    super(options);
    this.data = normalizeAlert(this.rawData, this.config);
    this.wrapper = null;
    this.message = null;
  }

  render() {
    this.wrapper = el('div', { className: ['mex-alert'], attrs: { role: 'note' } });
    this.message = editable({
      html: sanitizeInline(this.data.message),
      placeholder: this.t('tools.alert.placeholder', 'Write a message'),
      readOnly: this.readOnly,
      className: 'mex-alert__message',
      label: this.t('tools.alert.title', 'Alert'),
    });
    this.wrapper.appendChild(this.message);
    this.apply();
    return this.wrapper;
  }

  apply() {
    if (!this.wrapper) return;
    ALERT_TYPES.forEach((type) =>
      this.wrapper.classList.toggle(`mex-alert--${type}`, this.data.type === type)
    );
    ALERT_ALIGNMENTS.forEach((align) =>
      this.wrapper.classList.toggle(`mex-alert--align-${align}`, this.data.align === align)
    );
  }

  alertTypeLabel(type) {
    const labels = {
      primary: this.t('tools.alert.type.primary', 'Primary'),
      secondary: this.t('tools.alert.type.secondary', 'Secondary'),
      info: this.t('tools.alert.type.info', 'Info'),
      success: this.t('tools.alert.type.success', 'Success'),
      warning: this.t('tools.alert.type.warning', 'Warning'),
      danger: this.t('tools.alert.type.danger', 'Danger'),
      light: this.t('tools.alert.type.light', 'Light'),
      dark: this.t('tools.alert.type.dark', 'Dark'),
    };
    return labels[type] || type;
  }

  alignLabel(align) {
    const labels = {
      left: this.t('tools.alignment.left', 'Align left'),
      center: this.t('tools.alignment.center', 'Align center'),
      right: this.t('tools.alignment.right', 'Align right'),
    };
    return labels[align] || align;
  }

  renderSettings() {
    const types = ALERT_TYPES.map((type) => ({
      icon: ICONS.alert,
      title: this.alertTypeLabel(type),
      toggle: 'mex-alert-type',
      isActive: () => this.data.type === type,
      closeOnActivate: true,
      onActivate: () => {
        this.data.type = type;
        this.apply();
        this.changed();
      },
    }));
    const icons = { left: ICONS.alignLeft, center: ICONS.alignCenter, right: ICONS.alignRight };
    const aligns = ALERT_ALIGNMENTS.map((align) => ({
      icon: icons[align],
      title: this.alignLabel(align),
      toggle: 'mex-alert-align',
      isActive: () => this.data.align === align,
      closeOnActivate: true,
      onActivate: () => {
        this.data.align = align;
        this.apply();
        this.changed();
      },
    }));
    return [...types, { type: 'separator' }, ...aligns];
  }

  save() {
    return {
      type: this.data.type,
      align: this.data.align,
      message: this.message ? this.message.innerHTML : this.data.message,
    };
  }
}

/* -------------------------------------------------------------- delimiter */

export class DelimiterTool extends BaseTool {
  static get toolbox() {
    return { title: 'Delimiter', icon: ICONS.delimiter };
  }

  static get contentless() {
    return true;
  }

  render() {
    return el('div', { className: 'mex-delimiter', attrs: { role: 'separator' } });
  }

  save() {
    return {};
  }
}

/* ------------------------------------------------------------ simpleImage */

const IMAGE_URL = /^https?:\/\/\S+\.(gif|jpe?g|png|webp|avif|svg)(\?\S*)?$/i;

export class SimpleImageTool extends BaseTool {
  static get toolbox() {
    return { title: 'Image by URL', icon: ICONS.image };
  }

  static get sanitize() {
    return { url: false, caption: INLINE_SANITIZE };
  }

  static get pasteConfig() {
    return { patterns: { image: IMAGE_URL } };
  }

  constructor(options) {
    super(options);
    this.data = normalizeSimpleImage(this.rawData);
    this.wrapper = null;
    this.caption = null;
  }

  render() {
    this.wrapper = el('div', { className: 'mex-simple-image' });
    this.draw();
    return this.wrapper;
  }

  draw() {
    this.wrapper.replaceChildren();
    const url = sanitizeUrl(this.data.url, { schemes: ['http', 'https'] });
    if (!url) {
      if (this.readOnly) {
        this.wrapper.appendChild(
          el('p', { className: 'mex-tool__muted', text: this.t('tools.simpleImage.empty', 'No image') })
        );
        return;
      }
      const urlInput = input({ placeholder: 'https://', type: 'url' });
      const error = el('p', { className: 'mex-tool__error', attrs: { role: 'alert' } });
      const apply = () => {
        const value = sanitizeUrl(urlInput.value.trim(), { schemes: ['http', 'https'], allowRelative: true });
        if (!value) {
          error.textContent = this.t('tools.simpleImage.invalid', 'Enter a valid http(s) image URL');
          return;
        }
        this.data.url = value;
        this.draw();
        this.changed();
      };
      urlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          // Stop here: Editor.js would also create a new block for this Enter.
          event.preventDefault();
          event.stopPropagation();
          apply();
        }
      });
      const add = button(this.t('tools.simpleImage.add', 'Add image'), { variant: 'primary' });
      add.addEventListener('click', apply);
      this.wrapper.append(field(this.t('tools.simpleImage.url', 'Image URL'), urlInput), add, error);
      return;
    }
    const img = el('img', {
      className: 'mex-simple-image__img',
      attrs: { src: url, alt: this.data.decorative ? '' : this.data.alt || '', loading: 'lazy' },
    });
    const frame = el('div', { className: 'mex-simple-image__frame', children: [img] });
    this.caption = editable({
      html: sanitizeInline(this.data.caption),
      placeholder: this.t('tools.common.caption', 'Caption'),
      readOnly: this.readOnly,
      className: 'mex-tool__caption',
    });
    const alt = createAltControl({
      t: (id, fallback, values) => this.t(id, fallback, values),
      alt: this.data.alt,
      decorative: this.data.decorative,
      required: this.config.requireAlt === true,
      readOnly: this.readOnly,
      onChange: (value) => {
        this.data.alt = value.alt;
        this.data.decorative = value.decorative;
        img.setAttribute('alt', value.decorative ? '' : value.alt);
        this.changed();
      },
    });
    this.wrapper.append(frame, this.caption, alt.element);
    this.applyFlags();
  }

  applyFlags() {
    this.wrapper.classList.toggle('mex-simple-image--border', this.data.withBorder);
    this.wrapper.classList.toggle('mex-simple-image--background', this.data.withBackground);
    this.wrapper.classList.toggle('mex-simple-image--stretched', this.data.stretched);
    // The block holder exists only after the first render; Editor.js throws if
    // `stretched` is set before that, and then drops the block.
    if (this.block && this.isRendered) this.block.stretched = this.data.stretched;
  }

  rendered() {
    this.isRendered = true;
    if (this.block) this.block.stretched = Boolean(this.data.stretched);
  }

  onPaste(event) {
    if (event.type === 'pattern') {
      this.data.url = event.detail.data;
      this.draw();
    }
  }

  renderSettings() {
    const flags = [
      ['withBorder', ICONS.border, this.t('tools.image.border', 'With border')],
      ['withBackground', ICONS.background, this.t('tools.image.background', 'With background')],
      ['stretched', ICONS.stretch, this.t('tools.image.stretch', 'Stretch image')],
    ];
    return flags.map(([key, icon, title]) => ({
      icon,
      title,
      toggle: true,
      isActive: () => this.data[key],
      onActivate: () => {
        this.data[key] = !this.data[key];
        this.applyFlags();
        this.changed();
      },
    }));
  }

  save() {
    const out = { ...this.data, caption: this.caption ? this.caption.innerHTML : this.data.caption };
    if (!out.decorative) delete out.decorative;
    if (!out.alt) delete out.alt;
    return out;
  }

  validate(data) {
    return Boolean(data.url);
  }
}

/* ------------------------------------------------------------ personality */

export class PersonalityTool extends BaseTool {
  static get toolbox() {
    return { title: 'Person', icon: ICONS.person };
  }

  static get sanitize() {
    return { name: false, description: false, link: false, photo: false };
  }

  constructor(options) {
    super(options);
    this.data = normalizePersonality(this.rawData);
    this.nodes = {};
  }

  render() {
    const wrapper = el('div', { className: 'mex-person' });
    const photo = el('div', { className: 'mex-person__photo' });
    this.nodes.photo = photo;
    this.drawPhoto();
    const body = el('div', { className: 'mex-person__body' });
    if (this.readOnly) {
      body.append(
        el('p', { className: 'mex-person__name', text: this.data.name }),
        el('p', { className: 'mex-person__description', text: this.data.description })
      );
      const link = sanitizeUrl(this.data.link, { schemes: ['http', 'https', 'mailto'] });
      if (link)
        body.appendChild(
          el('a', {
            className: 'mex-person__link',
            text: link,
            attrs: { href: link, target: '_blank', rel: 'noopener noreferrer' },
          })
        );
    } else {
      this.nodes.name = input({
        value: this.data.name,
        placeholder: this.t('tools.personality.name', 'Name'),
      });
      this.nodes.description = input({
        value: this.data.description,
        placeholder: this.t('tools.personality.description', 'Role or description'),
      });
      this.nodes.link = input({
        value: this.data.link,
        placeholder: this.t('tools.personality.link', 'Link (optional)'),
        type: 'url',
      });
      body.append(
        field(this.t('tools.personality.name', 'Name'), this.nodes.name),
        field(this.t('tools.personality.description', 'Role or description'), this.nodes.description),
        field(this.t('tools.personality.link', 'Link (optional)'), this.nodes.link)
      );
      for (const key of ['name', 'description', 'link'])
        this.nodes[key].addEventListener('input', () => this.changed());
    }
    wrapper.append(photo, body);
    return wrapper;
  }

  drawPhoto() {
    const photo = this.nodes.photo;
    photo.replaceChildren();
    const url = sanitizeUrl(this.data.photo, { schemes: ['http', 'https'] });
    if (url)
      photo.appendChild(el('img', { attrs: { src: url, alt: this.data.name || '', loading: 'lazy' } }));
    else
      photo.appendChild(
        el('span', { className: 'mex-person__placeholder', attrs: { 'aria-hidden': 'true' } })
      );
    if (this.readOnly) return;
    const canUpload = this.config.canUpload !== false && typeof this.config.uploadImage === 'function';
    const label = this.t('tools.personality.photo', 'Choose photo');
    const pick = button('', { icon: ICONS.upload, ariaLabel: label });
    pick.classList.add('mex-person__photo-button');
    pick.disabled = !canUpload;
    if (!canUpload)
      pick.title = this.t('tools.common.noUpload', 'You do not have permission to upload files');
    pick.addEventListener('click', () => {
      const file = el('input', {
        attrs: { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp,image/avif' },
      });
      file.addEventListener('change', async () => {
        const chosen = file.files && file.files[0];
        if (!chosen) return;
        pick.disabled = true;
        try {
          const result = await this.config.uploadImage(chosen);
          if (result && result.success && result.file && result.file.url) {
            this.data.photo = result.file.url;
            this.drawPhoto();
            this.changed();
          } else if (this.api.notifier) {
            this.api.notifier.show({
              message: this.t('tools.common.uploadFailed', 'The file could not be uploaded'),
              style: 'error',
            });
          }
        } finally {
          pick.disabled = false;
        }
      });
      file.click();
    });
    photo.appendChild(pick);
  }

  save() {
    if (this.readOnly) return { ...this.data };
    return {
      name: this.nodes.name.value.trim(),
      description: this.nodes.description.value.trim(),
      link: sanitizeUrl(this.nodes.link.value.trim(), { schemes: ['http', 'https', 'mailto'] }),
      photo: this.data.photo,
    };
  }
}

/* ----------------------------------------------------------------- button */

export class ButtonTool extends BaseTool {
  styleLabel(style) {
    const labels = {
      primary: this.t('tools.button.style.primary', 'Primary'),
      secondary: this.t('tools.button.style.secondary', 'Secondary'),
      outline: this.t('tools.button.style.outline', 'Outline'),
      ghost: this.t('tools.button.style.ghost', 'Ghost'),
      danger: this.t('tools.button.style.danger', 'Danger'),
      success: this.t('tools.button.style.success', 'Success'),
    };
    return labels[style] || style;
  }

  static get toolbox() {
    return { title: 'Button', icon: ICONS.button };
  }

  static get sanitize() {
    return { text: false, link: false, style: false };
  }

  constructor(options) {
    super(options);
    this.data = normalizeButton(this.rawData);
    this.nodes = {};
  }

  render() {
    const wrapper = el('div', { className: 'mex-button-block' });
    const preview = el('span', {
      className: ['mex-button-block__preview', `mex-button-block__preview--${this.data.style}`],
    });
    preview.textContent = this.data.text || this.t('tools.button.defaultText', 'Button');
    this.nodes.preview = preview;
    wrapper.appendChild(el('div', { className: 'mex-button-block__stage', children: [preview] }));
    if (this.readOnly) {
      const link = sanitizeUrl(this.data.link);
      if (link) wrapper.appendChild(el('p', { className: 'mex-tool__muted', text: link }));
      return wrapper;
    }
    this.nodes.text = input({
      value: this.data.text,
      placeholder: this.t('tools.button.textPlaceholder', 'Button text'),
    });
    this.nodes.link = input({ value: this.data.link, placeholder: 'https://', type: 'url' });
    this.nodes.style = select(
      BUTTON_STYLES.map((style) => ({
        value: style,
        label: this.styleLabel(style),
      })),
      this.data.style
    );
    this.nodes.newTab = el('input', { attrs: { type: 'checkbox' } });
    this.nodes.newTab.checked = this.data.openInNewTab;
    this.nodes.error = el('p', { className: 'mex-tool__error', attrs: { role: 'alert' } });
    const sync = () => {
      this.data.text = this.nodes.text.value;
      this.data.style = this.nodes.style.value;
      this.data.openInNewTab = this.nodes.newTab.checked;
      const raw = this.nodes.link.value.trim();
      this.data.link = raw;
      this.nodes.error.textContent =
        raw && !sanitizeUrl(raw)
          ? this.t('tools.button.invalidLink', 'Enter a valid link (https://, mailto:, tel: or /path)')
          : '';
      preview.textContent = this.data.text || this.t('tools.button.defaultText', 'Button');
      BUTTON_STYLES.forEach((style) =>
        preview.classList.toggle(`mex-button-block__preview--${style}`, style === this.data.style)
      );
      this.changed();
    };
    ['input', 'change'].forEach((type) => {
      this.nodes.text.addEventListener(type, sync);
      this.nodes.link.addEventListener(type, sync);
      this.nodes.style.addEventListener(type, sync);
      this.nodes.newTab.addEventListener(type, sync);
    });
    const newTabLabel = el('label', {
      className: 'mex-tool__check',
      children: [this.nodes.newTab, el('span', { text: this.t('tools.button.newTab', 'Open in a new tab') })],
    });
    wrapper.append(
      el('div', {
        className: 'mex-tool__grid',
        children: [
          field(this.t('tools.button.text', 'Text'), this.nodes.text),
          field(this.t('tools.button.link', 'Link'), this.nodes.link),
          field(this.t('tools.button.styleLabel', 'Style'), this.nodes.style),
        ],
      }),
      newTabLabel,
      this.nodes.error
    );
    return wrapper;
  }

  save() {
    return { ...this.data, link: sanitizeUrl(this.data.link) };
  }

  validate(data) {
    return Boolean(data.text && data.text.trim());
  }
}

/* --------------------------------------------------------------- linkTool */

export class LinkPreviewTool extends BaseTool {
  static get toolbox() {
    return { title: 'Link preview', icon: ICONS.link };
  }

  static get sanitize() {
    return { link: false, meta: false };
  }

  static get pasteConfig() {
    return { patterns: { link: /^https?:\/\/[^\s]{3,2000}$/i } };
  }

  constructor(options) {
    super(options);
    this.data = normalizeLinkTool(this.rawData);
    this.wrapper = null;
  }

  render() {
    this.wrapper = el('div', { className: 'mex-link' });
    this.draw();
    return this.wrapper;
  }

  draw(error = '') {
    this.wrapper.replaceChildren();
    const link = sanitizeUrl(this.data.link, { schemes: ['http', 'https'], allowRelative: false });
    if (link) {
      const card = el(this.readOnly ? 'a' : 'div', {
        className: 'mex-link__card',
        attrs: this.readOnly ? { href: link, target: '_blank', rel: 'noopener noreferrer' } : {},
      });
      const text = el('div', { className: 'mex-link__text' });
      text.append(
        el('p', { className: 'mex-link__title', text: this.data.meta.title || link }),
        el('p', { className: 'mex-link__description', text: this.data.meta.description || '' }),
        el('p', { className: 'mex-link__site', text: this.data.meta.site_name || new URL(link).hostname })
      );
      card.appendChild(text);
      const image =
        this.data.meta.image &&
        sanitizeUrl(this.data.meta.image.url, { schemes: ['https', 'http'], allowRelative: false });
      if (image)
        card.appendChild(
          el('img', {
            className: 'mex-link__image',
            attrs: { src: image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' },
          })
        );
      this.wrapper.appendChild(card);
      return;
    }
    if (this.readOnly) return;
    const urlInput = input({
      placeholder: this.t('tools.link.placeholder', 'Paste a link and press Enter'),
      type: 'url',
    });
    const status = el('p', {
      className: error ? 'mex-tool__error' : 'mex-tool__muted',
      text: error,
      attrs: { role: error ? 'alert' : 'status' },
    });
    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        // Stop here: Editor.js would also create a new block for this Enter.
        event.preventDefault();
        event.stopPropagation();
        this.fetch(urlInput.value.trim(), status, urlInput);
      }
    });
    if (this.config.linkPreview === false) {
      status.textContent = this.t('tools.link.disabled', 'Link previews are turned off');
      urlInput.disabled = true;
    }
    this.wrapper.append(field(this.t('tools.link.label', 'Link'), urlInput), status);
  }

  async fetch(url, status, urlInput) {
    const safe = sanitizeUrl(url, { schemes: ['http', 'https'], allowRelative: false });
    if (!safe) {
      status.className = 'mex-tool__error';
      status.textContent = this.t('tools.link.invalid', 'Enter a valid http(s) link');
      return;
    }
    status.className = 'mex-tool__muted';
    status.textContent = this.t('tools.link.loading', 'Loading preview');
    urlInput.disabled = true;
    try {
      const { data } = await this.config.fetchClient.get('/magic-editor-x/link', { params: { url: safe } });
      if (!data || !data.success) throw new Error('failed');
      this.data = normalizeLinkTool({ link: data.link || safe, meta: data.meta });
      this.draw();
      this.changed();
    } catch {
      this.draw(
        this.t('tools.link.failed', 'The preview could not be loaded. Check the link and try again.')
      );
    }
  }

  onPaste(event) {
    if (event.type === 'pattern') {
      this.data.link = '';
      this.draw();
      const urlInput = this.wrapper.querySelector('input');
      const status = this.wrapper.querySelector('p');
      if (urlInput && status) {
        urlInput.value = event.detail.data;
        this.fetch(event.detail.data, status, urlInput);
      }
    }
  }

  save() {
    return this.data;
  }

  validate(data) {
    return Boolean(data.link);
  }
}

/* --------------------------------------------------------- media library */

/**
 * Toolbox entry that opens the Strapi Media Library. The placeholder block is
 * never saved (validate returns false); the editor field inserts one `image`
 * block per chosen file and removes the placeholder.
 */
export class MediaLibraryTool extends BaseTool {
  static get toolbox() {
    return { title: 'Media Library', icon: ICONS.media };
  }

  static get isReadOnlySupported() {
    return true;
  }

  render() {
    const wrapper = el('div', { className: 'mex-media-placeholder', attrs: { role: 'status' } });
    wrapper.textContent = this.t('tools.mediaLib.opening', 'Choose images in the Media Library');
    if (!this.readOnly && typeof this.config.openMediaLibrary === 'function') {
      window.setTimeout(() => {
        const blockIndex = this.block
          ? this.api.blocks.getBlockIndex(this.block.id)
          : this.api.blocks.getCurrentBlockIndex();
        this.config.openMediaLibrary({ blockIndex, multiple: true });
      }, 0);
    }
    return wrapper;
  }

  save() {
    return {};
  }

  validate() {
    return false;
  }
}

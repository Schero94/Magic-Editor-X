import { ICONS, el, field, input, select, button, editable } from './dom';
import { sanitizeInline, sanitizeTemplate, sanitizeSvg, sanitizeUrl } from '../sanitize';
import { fillTemplate } from './logic.mjs';
import { EmbeddedEntryTool } from './embedded-entry';

/**
 * Turns custom block definitions (GET /magic-editor-x/custom-blocks) into
 * Editor.js tools.
 *
 * - `embedded-entry` blocks reuse EmbeddedEntryTool with the block's content
 *   type, title field and display fields.
 * - `simple` blocks keep the 1.x data `{ content, ...fieldValues, blockType:
 *   'simple', blockName }`; the optional template is filled with escaped values
 *   and sanitised before it is shown.
 */

const INLINE_SANITIZE = {
  b: true,
  i: true,
  u: { class: 'cdx-underline' },
  s: { class: 'cdx-strikethrough' },
  mark: { class: 'cdx-marker' },
  code: { class: 'inline-code' },
  a: { href: true, target: true, rel: true },
  br: true,
};

/**
 * Value of a field when nothing is stored yet.
 * @param {object} definition - Field definition.
 * @returns {unknown} Default.
 */
const defaultValue = (definition) => {
  if (definition.default !== undefined) return definition.default;
  if (definition.type === 'checkbox') return false;
  if (definition.type === 'image') return null;
  return '';
};

/**
 * Creates the tool class of a simple custom block.
 * @param {object} block - Block definition DTO.
 * @param {object} ctx - Tool context (t, openMediaLibrary).
 * @returns {Function} Tool class.
 */
const createSimpleTool = (block, ctx) => {
  const fields = Array.isArray(block.fields) ? block.fields : [];
  const icon = block.icon ? sanitizeSvg(block.icon) : '';
  return class CustomSimpleBlock {
    static get toolbox() {
      return { title: block.label || block.name, icon: icon || ICONS.block };
    }

    static get isReadOnlySupported() {
      return true;
    }

    static get sanitize() {
      const rules = { content: INLINE_SANITIZE, blockType: false, blockName: false };
      for (const definition of fields) rules[definition.name] = false;
      return rules;
    }

    constructor({ data, readOnly, block: blockApi }) {
      this.readOnly = Boolean(readOnly);
      this.blockApi = blockApi;
      const values = {};
      for (const definition of fields) values[definition.name] = defaultValue(definition);
      this.data = { content: '', ...values, ...(data && typeof data === 'object' ? data : {}) };
      this.nodes = {};
    }

    changed() {
      if (this.blockApi && typeof this.blockApi.dispatchChange === 'function') this.blockApi.dispatchChange();
    }

    render() {
      const wrapper = el('div', { className: ['mex-custom', `mex-custom--${block.name}`] });
      const header = el('div', { className: 'mex-custom__header' });
      const iconEl = el('span', { className: 'mex-custom__icon', attrs: { 'aria-hidden': 'true' } });
      iconEl.innerHTML = icon || ICONS.block;
      header.append(iconEl, el('span', { className: 'mex-custom__label', text: block.label || block.name }));
      wrapper.appendChild(header);
      this.nodes.preview = el('div', { className: 'mex-custom__preview' });
      if (block.template) wrapper.appendChild(this.nodes.preview);
      if (!this.readOnly || !block.template) {
        this.nodes.content = editable({
          html: sanitizeInline(this.data.content),
          placeholder: block.placeholder || ctx.t('tools.custom.placeholder', 'Enter content'),
          readOnly: this.readOnly,
          className: 'mex-custom__content',
          label: block.label || block.name,
        });
        this.nodes.content.addEventListener('input', () => this.paint());
        if (!block.template || fields.length === 0) wrapper.appendChild(this.nodes.content);
      }
      if (!this.readOnly && fields.length) {
        const grid = el('div', { className: 'mex-tool__grid' });
        for (const definition of fields) grid.appendChild(this.renderField(definition));
        wrapper.appendChild(grid);
      }
      this.paint();
      return wrapper;
    }

    renderField(definition) {
      const label = definition.required ? `${definition.label} *` : definition.label;
      const value = this.data[definition.name];
      const update = (next) => {
        this.data[definition.name] = next;
        this.paint();
        this.changed();
      };
      if (definition.type === 'textarea') {
        const area = el('textarea', {
          className: 'mex-tool__input',
          attrs: { rows: 3, placeholder: definition.placeholder || '' },
        });
        area.value = typeof value === 'string' ? value : '';
        area.addEventListener('input', () => update(area.value));
        area.addEventListener('keydown', (event) => event.stopPropagation());
        return field(label, area);
      }
      if (definition.type === 'select') {
        const options = (definition.options || []).map((option) =>
          typeof option === 'string' ? { value: option, label: option } : option
        );
        const control = select(
          [{ value: '', label: '—' }, ...options],
          typeof value === 'string' ? value : ''
        );
        control.addEventListener('change', () => update(control.value));
        return field(label, control);
      }
      if (definition.type === 'checkbox') {
        const box = el('input', { attrs: { type: 'checkbox' } });
        box.checked = value === true;
        box.addEventListener('change', () => update(box.checked));
        return el('label', { className: 'mex-tool__check', children: [box, el('span', { text: label })] });
      }
      if (definition.type === 'image') {
        const wrap = el('div', { className: 'mex-custom__image' });
        const draw = () => {
          wrap.replaceChildren();
          const current = this.data[definition.name];
          const src =
            current && typeof current === 'object'
              ? sanitizeUrl(current.url, { schemes: ['http', 'https'] })
              : '';
          if (src)
            wrap.appendChild(
              el('img', { attrs: { src, alt: (current && current.alt) || '', loading: 'lazy' } })
            );
          const choose = button(ctx.t('tools.custom.chooseImage', 'Choose image'), { icon: ICONS.media });
          choose.disabled = typeof ctx.openMediaLibrary !== 'function' || !ctx.canUpload;
          choose.addEventListener('click', () =>
            ctx.openMediaLibrary({
              multiple: false,
              onSelect: (files) => {
                const file = files && files[0];
                if (!file) return;
                update({
                  url: file.url,
                  alt: file.alternativeText || file.alt || file.name || '',
                  width: file.width,
                  height: file.height,
                  id: file.id,
                  documentId: file.documentId,
                });
                draw();
              },
            })
          );
          wrap.appendChild(choose);
          if (src) {
            const remove = button(ctx.t('tools.custom.removeImage', 'Remove image'), { icon: ICONS.trash });
            remove.addEventListener('click', () => {
              update(null);
              draw();
            });
            wrap.appendChild(remove);
          }
        };
        draw();
        return field(label, wrap);
      }
      const type = { url: 'url', number: 'number', color: 'color' }[definition.type] || 'text';
      const control = input({
        value: value === null || value === undefined ? '' : String(value),
        placeholder: definition.placeholder || '',
        type,
      });
      control.addEventListener('input', () =>
        update(
          definition.type === 'number' ? (control.value === '' ? '' : Number(control.value)) : control.value
        )
      );
      control.addEventListener('keydown', (event) => event.stopPropagation());
      return field(label, control);
    }

    paint() {
      if (!block.template || !this.nodes.preview) return;
      const data = {
        ...this.data,
        content: this.nodes.content ? this.nodes.content.innerHTML : this.data.content,
      };
      this.nodes.preview.innerHTML = sanitizeTemplate(fillTemplate(block.template, data));
    }

    save() {
      const out = { ...this.data, blockType: 'simple', blockName: block.name };
      if (this.nodes.content) out.content = this.nodes.content.innerHTML;
      return out;
    }

    validate(data) {
      return fields.every(
        (definition) =>
          !definition.required ||
          (data[definition.name] !== '' &&
            data[definition.name] !== null &&
            data[definition.name] !== undefined)
      );
    }
  };
};

/**
 * Creates the tool class of an embedded-entry custom block.
 * @param {object} block - Block definition DTO.
 * @returns {Function} Tool class.
 */
const createEntryTool = (block) => {
  const icon = block.icon ? sanitizeSvg(block.icon) : '';
  return class CustomEntryBlock extends EmbeddedEntryTool {
    static get toolbox() {
      return { title: block.label || block.name, icon: icon || ICONS.entry };
    }
  };
};

/**
 * Editor.js tool settings for every enabled custom block.
 * @param {object[]} blocks - Custom block DTOs.
 * @param {object} ctx - Tool context.
 * @param {object} shared - Shared config (t, fetchClient, ...).
 * @returns {Record<string, object>} Tools keyed by block name.
 */
export const buildCustomBlockTools = (blocks, ctx, shared) => {
  const tools = {};
  for (const block of blocks || []) {
    if (!block || typeof block.name !== 'string' || block.enabled === false) continue;
    if (block.blockType === 'embedded-entry') {
      tools[block.name] = {
        class: createEntryTool(block),
        config: {
          ...shared,
          contentType: block.contentType || null,
          titleField: block.titleField || 'title',
          displayFields: block.displayFields || [],
          icon: block.icon || '',
        },
        inlineToolbar: false,
        tunes: block.tunes && block.tunes.length ? block.tunes : undefined,
        shortcut: block.shortcut || undefined,
      };
    } else {
      tools[block.name] = {
        class: createSimpleTool(block, ctx),
        inlineToolbar: block.inlineToolbar !== false,
        tunes: block.tunes && block.tunes.length ? block.tunes : undefined,
        shortcut: block.shortcut || undefined,
      };
    }
  }
  return tools;
};

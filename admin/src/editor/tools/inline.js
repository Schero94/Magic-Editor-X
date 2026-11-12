import { ICONS, el, button } from './dom';
import { sanitizeUrl } from '../sanitize';
import { createLinkPicker } from './link-picker';
import { readInternalLink, internalLinkAttributes } from './logic.mjs';
import { LINK_SANITIZE } from './sanitize-config';

/**
 * Inline tools (Editor.js inline toolbar). Bold and italic come from the
 * Editor.js core (`bold`, `italic`), so these cover the rest with the exact
 * markup 1.x stored:
 * marker `<mark class="cdx-marker">`, underline `<u class="cdx-underline">`,
 * strikethrough `<s class="cdx-strikethrough">`, tooltip
 * `<span class="cdx-tooltip" data-tooltip>`, hyperlink `<a href target rel>`
 * (internal links add `data-mex-uid`, `data-mex-document-id`, `data-mex-locale`),
 * and the AI trigger.
 *
 * Wrapping uses Range APIs (extractContents/insertNode) like the official
 * @editorjs/marker tool instead of document.execCommand.
 */

/**
 * Wraps the range contents in a new element and selects it.
 * @param {object} api - Editor.js API.
 * @param {Range} range - Selection range.
 * @param {string} tag - Tag name.
 * @param {string} [className] - Class name.
 * @returns {HTMLElement} Wrapper.
 */
const wrapRange = (api, range, tag, className) => {
  const wrapper = document.createElement(tag);
  if (className) wrapper.classList.add(className);
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  api.selection.expandToTag(wrapper);
  return wrapper;
};

/**
 * Removes a wrapper element but keeps its contents selected.
 * @param {object} api - Editor.js API.
 * @param {HTMLElement} wrapper - Element to remove.
 */
const unwrap = (api, wrapper) => {
  api.selection.expandToTag(wrapper);
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const contents = range.extractContents();
  if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
  range.insertNode(contents);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Creates a simple toggle-format inline tool class.
 * @param {{ tag: string, className: string, title: string, titleKey: string, icon: string, shortcut?: string }} spec - Tool spec.
 * @returns {Function} Inline tool class.
 */
const createFormatTool = (spec) =>
  class FormatInlineTool {
    static get isInline() {
      return true;
    }

    static get title() {
      return spec.title;
    }

    static get sanitize() {
      return { [spec.tag]: { class: spec.className } };
    }

    constructor({ api }) {
      this.api = api;
      this.button = null;
    }

    get shortcut() {
      return spec.shortcut;
    }

    render() {
      this.button = el('button', { className: this.api.styles.inlineToolButton, attrs: { type: 'button' } });
      this.button.innerHTML = spec.icon;
      return this.button;
    }

    surround(range) {
      if (!range) return;
      const existing = this.api.selection.findParentTag(spec.tag.toUpperCase(), spec.className);
      if (existing) unwrap(this.api, existing);
      else wrapRange(this.api, range, spec.tag, spec.className);
    }

    checkState() {
      const active = Boolean(this.api.selection.findParentTag(spec.tag.toUpperCase(), spec.className));
      if (this.button) this.button.classList.toggle(this.api.styles.inlineToolButtonActive, active);
      return active;
    }
  };

export const MarkerTool = createFormatTool({
  tag: 'mark',
  className: 'cdx-marker',
  title: 'Marker',
  icon: ICONS.marker,
  shortcut: 'CMD+SHIFT+M',
});
export const UnderlineTool = createFormatTool({
  tag: 'u',
  className: 'cdx-underline',
  title: 'Underline',
  icon: ICONS.underline,
  shortcut: 'CMD+U',
});
export const StrikethroughTool = createFormatTool({
  tag: 's',
  className: 'cdx-strikethrough',
  title: 'Strikethrough',
  icon: ICONS.strike,
  shortcut: 'CMD+SHIFT+X',
});

/**
 * Base for inline tools that wrap text and edit one attribute in an input
 * shown in the inline toolbar (tooltip text, link URL).
 */
class AttributeInlineTool {
  static get isInline() {
    return true;
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    this.button = null;
    this.actions = null;
    this.input = null;
    this.current = null;
  }

  /** @returns {{ tag: string, className?: string, icon: string, placeholderKey: string, placeholder: string, labelKey: string, label: string }} Spec. */
  get spec() {
    throw new Error('not implemented');
  }

  t(id, fallback) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback) : fallback;
  }

  render() {
    this.button = el('button', { className: this.api.styles.inlineToolButton, attrs: { type: 'button' } });
    this.button.innerHTML = this.spec.icon;
    return this.button;
  }

  renderActions() {
    const { spec } = this;
    this.input = el('input', {
      className: [this.api.styles.input, 'mex-inline-input'],
      attrs: {
        type: 'text',
        placeholder: this.t(spec.placeholderKey, spec.placeholder),
        'aria-label': this.t(spec.labelKey, spec.label),
      },
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commit();
        this.api.inlineToolbar.close();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.api.inlineToolbar.close();
      }
    });
    this.input.addEventListener('blur', (event) => {
      // Moving to another control of the same actions panel (checkbox, entry picker) is not "done".
      if (this.actions && event.relatedTarget && this.actions.contains(event.relatedTarget)) return;
      this.commit();
    });
    this.actions = el('div', { className: 'mex-inline-actions', children: [this.input] });
    this.actions.hidden = true;
    return this.actions;
  }

  findCurrent() {
    return this.api.selection.findParentTag(this.spec.tag.toUpperCase(), this.spec.className);
  }

  surround(range) {
    if (!range) return;
    const existing = this.findCurrent();
    if (existing) {
      unwrap(this.api, existing);
      this.current = null;
      if (this.actions) this.actions.hidden = true;
      return;
    }
    this.current = wrapRange(this.api, range, this.spec.tag, this.spec.className);
    this.showActions('');
  }

  showActions(value) {
    if (!this.actions || !this.input) return;
    this.actions.hidden = false;
    this.input.value = value || '';
    window.setTimeout(() => this.input && this.input.focus(), 0);
  }

  checkState() {
    const current = this.findCurrent();
    if (this.button) this.button.classList.toggle(this.api.styles.inlineToolButtonActive, Boolean(current));
    if (current) {
      this.current = current;
      this.showActions(this.readValue(current));
    } else if (this.actions) {
      this.actions.hidden = true;
    }
    return Boolean(current);
  }

  /** Applies the input value; an empty or invalid value removes the wrapper. */
  commit() {
    const node = this.current;
    if (!node || !node.isConnected || !this.input) return;
    const applied = this.writeValue(node, this.input.value.trim());
    if (!applied) {
      const parent = node.parentNode;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      this.current = null;
    }
  }

  clear() {
    this.commit();
  }
}

/** Tooltip: `<span class="cdx-tooltip" data-tooltip="…">`. */
export class TooltipTool extends AttributeInlineTool {
  static get title() {
    return 'Tooltip';
  }

  static get sanitize() {
    return { span: { class: 'cdx-tooltip', 'data-tooltip': true } };
  }

  get spec() {
    return {
      tag: 'span',
      className: 'cdx-tooltip',
      icon: ICONS.tooltip,
      placeholderKey: 'tools.tooltip.placeholder',
      placeholder: 'Tooltip text',
      labelKey: 'tools.tooltip.label',
      label: 'Tooltip text',
    };
  }

  readValue(node) {
    return node.getAttribute('data-tooltip') || '';
  }

  writeValue(node, value) {
    if (!value) return false;
    node.setAttribute('data-tooltip', value.slice(0, 300));
    return true;
  }
}

/**
 * Hyperlink: `<a href target rel>` with validated URLs. With a fetch client the
 * actions panel also offers "Link to an entry": the picked entry's `href`
 * comes from the server (config `links.urlPattern`) and the reference is kept
 * in `data-mex-uid`, `data-mex-document-id` and `data-mex-locale`.
 */
export class HyperlinkTool extends AttributeInlineTool {
  static get title() {
    return 'Link';
  }

  static get sanitize() {
    return { a: { ...LINK_SANITIZE } };
  }

  constructor(options) {
    super(options);
    this.internal = null;
    this.picker = null;
    this.pickerToggle = null;
  }

  get shortcut() {
    return 'CMD+K';
  }

  get spec() {
    return {
      tag: 'a',
      icon: ICONS.link,
      placeholderKey: 'tools.hyperlink.placeholder',
      placeholder: 'Paste a link and press Enter',
      labelKey: 'tools.hyperlink.label',
      label: 'Link address',
    };
  }

  renderActions() {
    const actions = super.renderActions();
    const newTabId = `mex-newtab-${Math.random().toString(36).slice(2, 8)}`;
    this.newTab = el('input', { attrs: { type: 'checkbox', id: newTabId } });
    this.newTab.checked = this.config.target === '_blank';
    this.newTab.addEventListener('change', () => this.commit());
    actions.appendChild(
      el('label', {
        className: 'mex-inline-check',
        attrs: { for: newTabId },
        children: [this.newTab, el('span', { text: this.t('tools.hyperlink.newTab', 'Open in a new tab') })],
      })
    );
    const targets = this.config.linkTargets || 'all';
    if (
      targets !== 'external' &&
      this.config.fetchClient &&
      typeof this.config.fetchClient.get === 'function'
    )
      this.renderPicker(actions);
    if (targets === 'internal' && this.input) {
      // Field preset: only links to entries. The address comes from the picked entry.
      this.input.readOnly = true;
      this.input.placeholder = this.t(
        'tools.hyperlink.internalOnly',
        'Choose an entry with "Link to an entry"'
      );
    }
    return actions;
  }

  /**
   * Adds the "Link to an entry" toggle and the picker to the actions panel.
   * @param {HTMLElement} actions - Actions panel.
   */
  renderPicker(actions) {
    this.picker = createLinkPicker({
      t: (id, fallback, values) => this.t(id, fallback, values),
      fetchClient: this.config.fetchClient,
      getLocale: this.config.getLocale,
      onPick: (item) => this.applyInternal(item),
      onClose: () => {
        if (this.pickerToggle) this.pickerToggle.setAttribute('aria-expanded', 'false');
        if (this.input) this.input.focus();
      },
    });
    this.pickerToggle = button(this.t('tools.hyperlink.internal.open', 'Link to an entry'), {
      icon: ICONS.entry,
    });
    this.pickerToggle.classList.add('mex-link-picker__toggle');
    this.pickerToggle.setAttribute('aria-expanded', 'false');
    this.pickerToggle.setAttribute('aria-controls', this.picker.element.id);
    this.pickerToggle.addEventListener('click', () => {
      if (this.picker.isOpen()) {
        this.picker.close();
        return;
      }
      this.pickerToggle.setAttribute('aria-expanded', 'true');
      this.picker.open();
    });
    actions.append(this.pickerToggle, this.picker.element);
  }

  /**
   * Writes a picked entry into the current link and closes the toolbar.
   * @param {{ href: string, uid: string, documentId: string, locale: string|null }} item - Search result.
   */
  applyInternal(item) {
    if (!this.input) return;
    this.internal = { href: item.href, uid: item.uid, documentId: item.documentId, locale: item.locale };
    this.input.value = item.href;
    // Links inside the site open in the same tab.
    if (this.newTab) this.newTab.checked = false;
    this.commit();
    this.api.inlineToolbar.close();
  }

  readValue(node) {
    if (this.newTab) this.newTab.checked = node.getAttribute('target') === '_blank';
    this.internal = readInternalLink(node);
    return node.getAttribute('href') || '';
  }

  writeValue(node, value) {
    let url = value;
    if (url && !/^[a-z][a-z0-9+.-]*:|^[/#?.]/i.test(url) && /^[^\s/]+\.[^\s]+/.test(url))
      url = `https://${url}`;
    const safe = sanitizeUrl(url);
    if (!safe) return false;
    const targets = this.config.linkTargets || 'all';
    if (targets === 'external') this.internal = null;
    if (targets === 'internal' && !(this.internal && this.internal.href === safe)) return false;
    node.setAttribute('href', safe);
    for (const [name, attribute] of Object.entries(internalLinkAttributes(this.internal, safe))) {
      if (attribute) node.setAttribute(name, attribute);
      else node.removeAttribute(name);
    }
    if (this.newTab && this.newTab.checked) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else {
      node.removeAttribute('target');
      node.removeAttribute('rel');
    }
    return true;
  }
}

/**
 * AI assistant trigger. It does not change the text itself: it hands the
 * selection to the editor field (`config.onAiRequest`), which opens the
 * assistant dialog and applies an accepted suggestion.
 */
export class AiInlineTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return 'AI assistant';
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    this.button = null;
  }

  get shortcut() {
    return 'CMD+SHIFT+G';
  }

  render() {
    this.button = el('button', { className: this.api.styles.inlineToolButton, attrs: { type: 'button' } });
    this.button.innerHTML = ICONS.sparkle;
    return this.button;
  }

  surround(range) {
    if (!range || typeof this.config.onAiRequest !== 'function') return;
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    const text = range.toString();
    if (!text.trim()) return;
    this.config.onAiRequest({ text, html: holder.innerHTML, range: range.cloneRange() });
  }

  checkState() {
    return false;
  }
}

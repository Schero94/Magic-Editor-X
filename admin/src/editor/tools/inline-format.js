import { el } from './dom';
import { MARK_SANITIZE, SPAN_SANITIZE, SUP_SANITIZE } from './sanitize-config';
import {
  COLOR_ATTRIBUTE,
  HIGHLIGHT_ATTRIBUTE,
  isHexColor,
  tokenLabel,
} from '../../../../shared/inline-format.mjs';
import {
  ANNOTATION_ATTRIBUTE,
  ANNOTATION_VALUE_PREFIX,
  cleanAnnotationAttributes,
} from '../../../../shared/blocks/annotations.mjs';
import { DS_ICONS } from './ds-icons';

/**
 * Inline formatting of 2.5, all off unless the field turns it on:
 * - "Colour" (`ColorTool`): one inline toolbar button with a small menu of
 *   the configured palette tokens (text colours, then highlights, then
 *   "Remove colour"). Stores `<span data-mex-color="token">` and
 *   `<mark data-mex-highlight="token">`, never a style.
 * - "Superscript" / "Subscript" (`<sup>`, `<sub>`; Ctrl/Cmd+. and
 *   Ctrl/Cmd+Shift+.). Footnote markers (`<sup data-mex-footnote>`) are never
 *   toggled by the superscript tool.
 * - one tool per enabled inline annotation (`createAnnotationTool`): wraps
 *   the selection in `<span data-mex-annotation>` and asks for the
 *   annotation's attributes in a small form with one primary action.
 */

const SVG = (body) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const FORMAT_ICONS = Object.freeze({
  color: DS_ICONS.color,
  superscript: SVG(
    '<path d="m4 8 8 10m0-10L4 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 6.5a2 2 0 1 1 3.5 1.3L15 11h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  subscript: SVG(
    '<path d="m4 6 8 10m0-10L4 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 15.5a2 2 0 1 1 3.5 1.3L15 20h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  clear: SVG(
    '<path d="m6 16 6-12 6 12M8.5 11h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m4 4 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  ),
  annotation: SVG(
    '<path d="M4 4h8l8 8-8 8-8-8V4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>'
  ),
  abbreviation: SVG(
    '<text x="2" y="16.5" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="currentColor">Ab</text><path d="M3 20h18" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2"/>'
  ),
});

/**
 * Swatch icon of a token (the value is a validated hex colour from the config).
 * @param {string} hex - Colour.
 * @param {'color'|'highlight'} kind - Text colour (letter) or highlight (filled square).
 * @returns {string} SVG.
 */
export const swatchIcon = (hex, kind) => {
  const fill = isHexColor(hex) ? hex : 'currentColor';
  return kind === 'color'
    ? SVG(
        `<path d="m6 17 6-12 6 12M8.5 12h7" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    : SVG(
        `<rect x="3" y="5" width="18" height="14" rx="3" fill="${fill}" stroke="currentColor" stroke-width="1"/>`
      );
};

/**
 * Closest element matching a selector from a node, inside the editable area.
 * @param {Node|null} node - Start node.
 * @param {string} selector - CSS selector.
 * @returns {HTMLElement|null} Element.
 */
const closestIn = (node, selector) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  if (!element || typeof element.closest !== 'function') return null;
  const found = element.closest(selector);
  const editable = element.closest('[contenteditable="true"]');
  return found && editable && editable.contains(found) ? found : null;
};

/**
 * Current selection range, if any.
 * @returns {Range|null} Range.
 */
const currentRange = () => {
  const selection = window.getSelection();
  return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
};

/**
 * Replaces an element by its children.
 * @param {HTMLElement} element - Element.
 */
const unwrapElement = (element) => {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
};

/**
 * Tells Editor.js the block changed (attribute changes are not always seen as input).
 * @param {Node} node - Node in the block.
 */
const notifyInput = (node) => {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  const editable = element ? element.closest('[contenteditable="true"]') : null;
  if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
};

/**
 * Selects an element's contents.
 * @param {HTMLElement} element - Element.
 */
const selectContents = (element) => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Wraps a range in a new element; nested elements matching `nested` are unwrapped first.
 * @param {Range} range - Range.
 * @param {string} tag - Tag.
 * @param {Record<string, string>} attrs - Attributes.
 * @param {string} [nested] - Selector of elements of the same kind to unwrap inside the range.
 * @returns {HTMLElement} Wrapper.
 */
export const wrapSelection = (range, tag, attrs, nested) => {
  const wrapper = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) wrapper.setAttribute(name, value);
  const contents = range.extractContents();
  if (nested) for (const inner of Array.from(contents.querySelectorAll(nested))) unwrapElement(inner);
  wrapper.appendChild(contents);
  range.insertNode(wrapper);
  selectContents(wrapper);
  notifyInput(wrapper);
  return wrapper;
};

/**
 * Text offsets of a range inside its editable element. A range object would
 * go stale: Editor.js rewraps the selected text (fake background) while the
 * toolbar menu is open.
 * @param {Range|null} range - Range.
 * @returns {{ root: HTMLElement, start: number, end: number }|null} Offsets.
 */
const saveOffsets = (range) => {
  if (!range || range.collapsed) return null;
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const root = element && element.closest('[contenteditable="true"]');
  if (!root) return null;
  const offset = (container, at) => {
    const probe = document.createRange();
    probe.selectNodeContents(root);
    probe.setEnd(container, at);
    return probe.toString().length;
  };
  return {
    root,
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  };
};

/**
 * Range from saved text offsets (null when the element is gone).
 * @param {{ root: HTMLElement, start: number, end: number }|null} saved - Offsets.
 * @returns {Range|null} Range.
 */
const restoreOffsets = (saved) => {
  if (!saved || !saved.root.isConnected) return null;
  const range = document.createRange();
  const walker = document.createTreeWalker(saved.root, NodeFilter.SHOW_TEXT);
  let position = 0;
  let node;
  let started = false;
  while ((node = walker.nextNode())) {
    const next = position + node.data.length;
    if (!started && saved.start <= next) {
      range.setStart(node, saved.start - position);
      started = true;
    }
    if (started && saved.end <= next) {
      range.setEnd(node, saved.end - position);
      return range;
    }
    position = next;
  }
  return null;
};

/** Text colour and highlight from the configured palette (2.5). */
export class ColorTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return 'Colour';
  }

  static get sanitize() {
    return { span: SPAN_SANITIZE, mark: MARK_SANITIZE };
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    // The selection when the toolbar opened (a click in the menu moves the selection).
    this.saved = saveOffsets(currentRange());
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  /** @returns {Range|null} Selection to format. */
  target() {
    // A click in the menu can move the selection into the popover (or collapse it): then the
    // selection from when the toolbar opened is used.
    const inEditable = (range) => {
      const node = range.commonAncestorContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      return Boolean(element && element.closest('[contenteditable="true"]'));
    };
    const range = currentRange();
    if (range && !range.collapsed && inEditable(range)) return range;
    const restored = restoreOffsets(this.saved);
    if (!restored) return null;
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(restored);
    }
    return restored;
  }

  /**
   * Applies or removes a token.
   * @param {'color'|'highlight'} kind - Kind.
   * @param {string|null} token - Token (null removes).
   */
  apply(kind, token) {
    const range = this.target();
    if (!range) return;
    const tag = kind === 'color' ? 'span' : 'mark';
    const attribute = kind === 'color' ? COLOR_ATTRIBUTE : HIGHLIGHT_ATTRIBUTE;
    const selector = `${tag}[${attribute}]`;
    const existing = closestIn(range.commonAncestorContainer, selector);
    if (existing) {
      if (!token || existing.getAttribute(attribute) === token) unwrapElement(existing);
      else existing.setAttribute(attribute, token);
      notifyInput(range.commonAncestorContainer);
      return;
    }
    if (!token) {
      // Remove every token of this kind inside the selection.
      const contents = range.extractContents();
      for (const inner of Array.from(contents.querySelectorAll(selector))) unwrapElement(inner);
      range.insertNode(contents);
      notifyInput(range.commonAncestorContainer);
      return;
    }
    wrapSelection(range, tag, { [attribute]: token }, selector);
  }

  /**
   * Removes text colour and highlight from the selection. Not named `clear`:
   * Editor.js calls a tool's `clear()` whenever the inline toolbar closes.
   */
  removeAll() {
    this.apply('color', null);
    this.apply('highlight', null);
  }

  /**
   * True when the selection is inside this token.
   * @param {'color'|'highlight'} kind - Kind.
   * @param {string} token - Token.
   * @returns {boolean} Result.
   */
  isActive(kind, token) {
    const range = this.target();
    if (!range) return false;
    const attribute = kind === 'color' ? COLOR_ATTRIBUTE : HIGHLIGHT_ATTRIBUTE;
    const element = closestIn(
      range.commonAncestorContainer,
      `${kind === 'color' ? 'span' : 'mark'}[${attribute}]`
    );
    return Boolean(element && element.getAttribute(attribute) === token);
  }

  render() {
    const palette = this.config.palette || { colors: [], highlights: [] };
    const dark = this.config.isDark && this.config.isDark();
    const locale = this.config.locale;
    const item = (kind, token) => ({
      icon: swatchIcon(dark ? token.dark : token.light, kind),
      title: tokenLabel(token, locale),
      secondaryLabel:
        kind === 'color' ? this.t('tools.color.text', 'Text') : this.t('tools.color.highlight', 'Highlight'),
      name: `${kind}-${token.name}`,
      isActive: () => this.isActive(kind, token.name),
      onActivate: () => this.apply(kind, token.name),
    });
    const items = [
      ...palette.colors.map((token) => item('color', token)),
      ...(palette.colors.length && palette.highlights.length ? [{ type: 'separator' }] : []),
      ...palette.highlights.map((token) => item('highlight', token)),
      { type: 'separator' },
      {
        icon: FORMAT_ICONS.clear,
        title: this.t('tools.color.remove', 'Remove colour'),
        name: 'color-remove',
        onActivate: () => this.removeAll(),
      },
    ];
    // Icon only (the hint shows the translated tool name), like the other inline tools.
    // No `name`: Editor.js names the item after the tool key, which its shortcut looks up.
    return {
      icon: FORMAT_ICONS.color,
      isActive: () =>
        Boolean(
          this.target() &&
          (closestIn(this.target().commonAncestorContainer, `span[${COLOR_ATTRIBUTE}]`) ||
            closestIn(this.target().commonAncestorContainer, `mark[${HIGHLIGHT_ATTRIBUTE}]`))
        ),
      children: { items },
    };
  }
}

/**
 * Superscript or subscript tool class.
 * @param {'sup'|'sub'} tag - Tag.
 * @returns {Function} Inline tool class.
 */
const createScriptTool = (tag) => {
  // Footnote markers are `<sup data-mex-footnote>`: never toggled by this tool.
  const selector = tag === 'sup' ? 'sup:not([data-mex-footnote])' : 'sub';
  return class ScriptTool {
    static get isInline() {
      return true;
    }

    static get title() {
      return tag === 'sup' ? 'Superscript' : 'Subscript';
    }

    static get sanitize() {
      return tag === 'sup' ? { sup: { ...SUP_SANITIZE } } : { sub: {} };
    }

    constructor({ api }) {
      this.api = api;
      this.button = null;
    }

    get shortcut() {
      return tag === 'sup' ? 'CMD+.' : 'CMD+SHIFT+.';
    }

    render() {
      this.button = el('button', { className: this.api.styles.inlineToolButton, attrs: { type: 'button' } });
      this.button.innerHTML = tag === 'sup' ? FORMAT_ICONS.superscript : FORMAT_ICONS.subscript;
      return this.button;
    }

    surround(range) {
      if (!range) return;
      const existing = closestIn(range.commonAncestorContainer, selector);
      if (existing) {
        unwrapElement(existing);
        notifyInput(range.commonAncestorContainer);
        return;
      }
      if (range.collapsed) return;
      // Superscript and subscript exclude each other; a footnote marker inside the selection stays as it is.
      wrapSelection(range, tag, {}, tag === 'sup' ? 'sub' : 'sup:not([data-mex-footnote])');
    }

    checkState() {
      const range = currentRange();
      const active = Boolean(range && closestIn(range.commonAncestorContainer, selector));
      if (this.button) this.button.classList.toggle(this.api.styles.inlineToolButtonActive, active);
      return active;
    }
  };
};

export const SuperscriptTool = createScriptTool('sup');
export const SubscriptTool = createScriptTool('sub');

/**
 * Keeps stored `<sub>` and `<sup>` when the field does not offer the script buttons (2.7.4).
 * Editor.js 2.31 cleans a block with the sanitize rules of the inline tools in its inline toolbar
 * (`BlockToolAdapter.baseSanitizeConfig`), so without the subscript tool every save and paste
 * dropped `<sub>` that the stored content, an import or the API had. This tool only contributes
 * the rules: `render()` returns an empty MenuConfig, so the inline toolbar shows no button.
 */
export class ScriptKeepTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return '';
  }

  static get sanitize() {
    return { sup: { ...SUP_SANITIZE }, sub: {} };
  }

  render() {
    return [];
  }

  surround() {}

  checkState() {
    return false;
  }
}

/**
 * Builds the inline tool of an annotation definition (2.5): a toolbar button
 * that wraps the selection and shows a small form with the attributes
 * (inputs for text and links, a select for a list) and one primary action
 * ("Apply"); "Remove" unwraps an existing annotation. A new annotation whose
 * required values stay empty is removed when the toolbar closes.
 * @param {object} definition - Annotation definition (from the registry or a `GET /config` summary).
 * @returns {Function} Inline tool class.
 */
export const createAnnotationTool = (definition) => {
  const selector = `span[${ANNOTATION_ATTRIBUTE}="${definition.name}"]`;
  return class AnnotationTool {
    static get isInline() {
      return true;
    }

    static get title() {
      return definition.label;
    }

    static get sanitize() {
      return { span: SPAN_SANITIZE };
    }

    constructor({ api, config }) {
      this.api = api;
      this.config = config || {};
      this.button = null;
      this.actions = null;
      this.inputs = {};
      this.current = null;
      this.removeButton = null;
    }

    t(id, fallback, values) {
      return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
    }

    label(key, field) {
      const own = this.config.labels && this.config.labels[key];
      return own || field.label || key;
    }

    render() {
      this.button = el('button', {
        className: this.api.styles.inlineToolButton,
        attrs: { type: 'button' },
      });
      this.button.innerHTML =
        definition.name === 'abbreviation' ? FORMAT_ICONS.abbreviation : FORMAT_ICONS.annotation;
      return this.button;
    }

    renderActions() {
      const rows = [];
      for (const [key, field] of Object.entries(definition.attributes)) {
        const id = `mex-ann-${definition.name}-${key}-${Math.random().toString(36).slice(2, 8)}`;
        let control;
        if (field.type === 'enum') {
          control = el('select', { className: ['mex-tool__select', 'mex-inline-input'], attrs: { id } });
          if (!field.required) control.appendChild(el('option', { text: '', attrs: { value: '' } }));
          for (const value of field.values)
            control.appendChild(el('option', { text: value, attrs: { value } }));
        } else {
          control = el('input', {
            className: [this.api.styles.input, 'mex-inline-input'],
            attrs: {
              id,
              type: field.type === 'url' ? 'url' : 'text',
              maxlength: field.type === 'text' ? field.max : 2048,
              ...(field.required ? { 'aria-required': 'true' } : {}),
            },
          });
        }
        control.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            this.save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            this.api.inlineToolbar.close();
          }
        });
        this.inputs[key] = control;
        rows.push(
          el('label', {
            className: 'mex-annotation-form__row',
            attrs: { for: id },
            children: [el('span', { text: this.label(key, field) }), control],
          })
        );
      }
      const apply = el('button', {
        className: 'mex-annotation-form__apply',
        text: this.t('tools.annotation.apply', 'Apply'),
        attrs: { type: 'button' },
      });
      apply.addEventListener('click', () => this.save());
      this.removeButton = el('button', {
        className: 'mex-annotation-form__remove',
        text: this.t('tools.annotation.remove', 'Remove'),
        attrs: { type: 'button' },
      });
      this.removeButton.addEventListener('click', () => {
        if (this.current) {
          const parent = this.current.parentNode;
          unwrapElement(this.current);
          if (parent) notifyInput(parent);
          this.current = null;
        }
        this.api.inlineToolbar.close();
      });
      this.error = el('p', { className: 'mex-annotation-form__error', attrs: { role: 'alert' } });
      this.error.hidden = true;
      this.actions = el('div', {
        className: ['mex-inline-actions', 'mex-annotation-form'],
        attrs: { role: 'group', 'aria-label': definition.label },
        children: [
          ...rows,
          this.error,
          el('div', { className: 'mex-annotation-form__buttons', children: [this.removeButton, apply] }),
        ],
      });
      this.actions.hidden = true;
      return this.actions;
    }

    /** Values typed in the form, cleaned with the definition (null: a required one is missing). */
    values() {
      const raw = {};
      for (const [key, control] of Object.entries(this.inputs)) raw[key] = control.value;
      return cleanAnnotationAttributes(definition, raw);
    }

    /** Writes the values; keeps the form open with a message when a required one is missing. */
    save() {
      const values = this.values();
      if (!values || !this.current) {
        if (this.error) {
          this.error.textContent = this.t('tools.annotation.required', 'Fill in the required fields.');
          this.error.hidden = false;
        }
        return;
      }
      for (const name of this.current.getAttributeNames())
        if (name.startsWith(ANNOTATION_VALUE_PREFIX)) this.current.removeAttribute(name);
      for (const [key, value] of Object.entries(values))
        this.current.setAttribute(`${ANNOTATION_VALUE_PREFIX}${key}`, value);
      notifyInput(this.current);
      this.api.inlineToolbar.close();
    }

    show(element) {
      this.current = element;
      if (!this.actions) return;
      this.actions.hidden = false;
      for (const [key, control] of Object.entries(this.inputs))
        control.value = element.getAttribute(`${ANNOTATION_VALUE_PREFIX}${key}`) || '';
      if (this.removeButton) this.removeButton.hidden = false;
      const first = Object.values(this.inputs)[0];
      if (first) window.setTimeout(() => first.focus(), 0);
    }

    surround(range) {
      if (!range) return;
      const existing = closestIn(range.commonAncestorContainer, selector);
      if (existing) {
        this.show(existing);
        return;
      }
      if (range.collapsed) return;
      const wrapper = wrapSelection(range, 'span', { [ANNOTATION_ATTRIBUTE]: definition.name }, selector);
      this.show(wrapper);
    }

    checkState() {
      const range = currentRange();
      const existing = range ? closestIn(range.commonAncestorContainer, selector) : null;
      if (this.button)
        this.button.classList.toggle(this.api.styles.inlineToolButtonActive, Boolean(existing));
      if (existing && existing !== this.current) this.show(existing);
      return Boolean(existing);
    }

    /** Toolbar closed: a new annotation without its required values is removed (its text stays). */
    clear() {
      const node = this.current;
      if (!node || !node.isConnected) return;
      const raw = {};
      for (const name of node.getAttributeNames())
        if (name.startsWith(ANNOTATION_VALUE_PREFIX))
          raw[name.slice(ANNOTATION_VALUE_PREFIX.length)] = node.getAttribute(name);
      if (!cleanAnnotationAttributes(definition, raw)) {
        const parent = node.parentNode;
        unwrapElement(node);
        if (parent) notifyInput(parent);
      }
      this.current = null;
    }
  };
};

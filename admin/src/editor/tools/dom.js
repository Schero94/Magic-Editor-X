/**
 * Small DOM helpers shared by the in-repo tools. Text always goes through
 * textContent; markup only through the sanitisers in ../sanitize.js. The SVG
 * icons below are static strings written in this file (trusted).
 */

import { DS_ICONS } from './ds-icons';

/**
 * Creates an element.
 * @param {string} tag - Tag name.
 * @param {{ className?: string|string[], text?: string, attrs?: Record<string, string|number|boolean>, children?: Node[] }} [options] - Options.
 * @returns {HTMLElement} Element.
 */
export const el = (tag, options = {}) => {
  const node = document.createElement(tag);
  const classes = Array.isArray(options.className) ? options.className : [options.className];
  classes.filter(Boolean).forEach((name) => node.classList.add(name));
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  (options.children || []).forEach((child) => child && node.appendChild(child));
  return node;
};

/**
 * Creates a labelled form control row (label + control) for tool forms.
 * @param {string} label - Visible label.
 * @param {HTMLElement} control - Input, select or textarea.
 * @returns {HTMLElement} Row.
 */
export const field = (label, control) => {
  const id = `mex-${Math.random().toString(36).slice(2, 10)}`;
  control.id = id;
  const labelEl = el('label', { className: 'mex-tool__label', text: label, attrs: { for: id } });
  return el('div', { className: 'mex-tool__field', children: [labelEl, control] });
};

/**
 * Creates a text input.
 * @param {{ value?: string, placeholder?: string, type?: string, readOnly?: boolean }} options - Options.
 * @returns {HTMLInputElement} Input.
 */
export const input = ({ value = '', placeholder = '', type = 'text', readOnly = false } = {}) => {
  const node = el('input', {
    className: 'mex-tool__input',
    attrs: { type, placeholder, readonly: readOnly },
  });
  node.value = value;
  return node;
};

/**
 * Creates a select element (a native select, styled like the DS SingleSelect
 * by `.mex-tool__select` in styles.js).
 * @param {Array<{ value: string, label: string }>} options - Options.
 * @param {string} value - Selected value.
 * @returns {HTMLSelectElement} Select.
 */
export const select = (options, value) => {
  const node = el('select', { className: 'mex-tool__select' });
  // Chromium submits the surrounding form when Enter is pressed on a closed
  // select; inside the Content Manager that saved the entry. Enter has no
  // other job on a closed select (an open list handles its own keys).
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  for (const option of options) {
    const opt = el('option', { text: option.label, attrs: { value: option.value } });
    if (option.value === value) opt.selected = true;
    node.appendChild(opt);
  }
  return node;
};

/**
 * Creates a button.
 * @param {string} label - Visible text.
 * @param {{ variant?: 'primary'|'secondary'|'danger', icon?: string, ariaLabel?: string }} [options] - Options.
 * @returns {HTMLButtonElement} Button.
 */
export const button = (label, options = {}) => {
  const node = el('button', {
    className: ['mex-tool__button', `mex-tool__button--${options.variant || 'secondary'}`],
    attrs: { type: 'button', 'aria-label': options.ariaLabel },
  });
  if (options.icon) {
    const icon = el('span', { className: 'mex-tool__button-icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = options.icon;
    node.appendChild(icon);
  }
  if (label) node.appendChild(el('span', { text: label }));
  return node;
};

/**
 * Creates a contenteditable area.
 * @param {{ html?: string, placeholder?: string, readOnly?: boolean, className?: string, label?: string }} options - Options (html must be sanitised).
 * @returns {HTMLElement} Element.
 */
export const editable = ({
  html = '',
  placeholder = '',
  readOnly = false,
  className = '',
  label = '',
} = {}) => {
  const node = el('div', {
    className: ['mex-tool__editable', className],
    attrs: {
      contenteditable: readOnly ? 'false' : 'true',
      'data-placeholder': placeholder,
      role: readOnly ? null : 'textbox',
      'aria-label': label || placeholder || null,
    },
  });
  node.innerHTML = html;
  return node;
};

/**
 * Tool icons. 2.7.8: Strapi Design System icons where @strapi/icons has an equivalent
 * (`ds-icons.js`); the hand-drawn SVGs remain for alignment, columns, borders and the other
 * editor-specific shapes the DS does not have.
 */
export const ICONS = {
  alert: DS_ICONS.alert,
  toggle:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  code: DS_ICONS.code,
  person: DS_ICONS.person,
  image: DS_ICONS.image,
  gallery: DS_ICONS.gallery,
  video: DS_ICONS.video,
  audio: DS_ICONS.audio,
  arrowLeft: DS_ICONS.arrowLeft,
  arrowRight: DS_ICONS.arrowRight,
  delimiter:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 4"/></svg>',
  link: DS_ICONS.link,
  button:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="18" height="10" rx="3" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  entry:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  block:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h6M7 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  media: DS_ICONS.media,
  checklist:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m4 7 2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  marker:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m15 5 4 4L9 19H5v-4L15 5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  underline: DS_ICONS.underline,
  strike: DS_ICONS.strike,
  tooltip:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  sparkle: DS_ICONS.sparkle,
  alignLeft:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M4 10h10M4 14h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  alignCenter:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M7 10h10M4 14h16M7 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  alignRight:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M10 10h10M4 14h16M10 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  alignJustify:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  variant:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 5h14v14H5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 9h6M9 13h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: DS_ICONS.check,
  plus: DS_ICONS.plus,
  minus: DS_ICONS.minus,
  upload: DS_ICONS.upload,
  trash: DS_ICONS.trash,
  border:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="1" stroke="currentColor" stroke-width="2"/></svg>',
  background:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="1" fill="currentColor" opacity=".3"/><rect x="8" y="8" width="8" height="8" stroke="currentColor" stroke-width="2"/></svg>',
  stretch:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12h18m-15-3-3 3 3 3m12-6 3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mention:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  toc: DS_ICONS.toc,
  lineNumbers:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  math: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 5H6l6 7-6 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // 2.5: component block (four squares, like a component of fields).
  component: DS_ICONS.component,
  inlineMath:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 18c3 0 3-12 6-12M5 11h5m4 1 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  footnote:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 18h10M4 13h10M17 4l2-1v6m-2 0h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // 2.5: "Copy block" in the block menu.
  copy: DS_ICONS.copy,
};

/**
 * Small DOM helpers shared by the in-repo tools. Text always goes through
 * textContent; markup only through the sanitisers in ../sanitize.js. The SVG
 * icons below are static strings written in this file (trusted).
 */

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

export const ICONS = {
  alert:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 8v5m0 3h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  toggle:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  code: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  person:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  image:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="2" stroke="currentColor" stroke-width="2"/><path d="m4 18 5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  gallery:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
  video:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="m16 10 6-3v10l-6-3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  audio:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18V6l11-2v12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="2"/></svg>',
  arrowLeft:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 12H5m6-6-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowRight:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delimiter:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 4"/></svg>',
  link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1m2 4a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  button:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="18" height="10" rx="3" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  entry:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  block:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h6M7 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  media:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="16" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M6 6V4h16v13h-4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m3 18 4-4 3 3 3-3 4 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  checklist:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m4 7 2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  marker:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m15 5 4 4L9 19H5v-4L15 5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  underline:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  strike:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12h16M16 6.5C15.3 5 13.8 4 12 4 9.8 4 8 5.3 8 7.3c0 1.3.8 2.2 2 2.7m4 4c1.2.5 2 1.4 2 2.7 0 2-1.8 3.3-4 3.3-1.8 0-3.3-1-4-2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  tooltip:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  sparkle:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
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
  check:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 12 5 5 9-10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  minus:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  upload:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  border:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="1" stroke="currentColor" stroke-width="2"/></svg>',
  background:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="1" fill="currentColor" opacity=".3"/><rect x="8" y="8" width="8" height="8" stroke="currentColor" stroke-width="2"/></svg>',
  stretch:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12h18m-15-3-3 3 3 3m12-6 3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mention:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  toc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h2M4 12h2M4 18h2M9 6h11M12 12h8M12 18h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  lineNumbers:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

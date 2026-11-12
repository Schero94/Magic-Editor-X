import { el, button } from './dom';
import { focalFromPointer, moveFocal, focalPercent } from './media-logic.mjs';

/**
 * Focal point control for image blocks and gallery images: a disclosure
 * button opens a preview; clicking or tapping the preview sets the point, the
 * arrow keys move it (Shift for 10 % steps) and "Reset" removes it. The
 * marker is decorative; the value is announced through a polite live region.
 */

let sequence = 0;
const nextId = (prefix) => {
  sequence += 1;
  return `${prefix}-${sequence}`;
};

/**
 * Creates the focal point control.
 * @param {{ t: Function, url?: string, point?: { x: number, y: number }, readOnly?: boolean, onChange: (point: { x: number, y: number }|undefined) => void }} options - Options.
 * @returns {{ element: HTMLElement, setUrl: (url: string) => void, read: () => ({ x: number, y: number }|undefined) }} Control.
 */
export const createFocalControl = ({ t, url = '', point, readOnly = false, onChange }) => {
  let current = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
  const panelId = nextId('mex-focal-panel');
  const valueId = nextId('mex-focal-value');
  const hintId = nextId('mex-focal-hint');

  const toggle = button('', { variant: 'secondary' });
  toggle.classList.add('mex-focal__toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panelId);

  const img = el('img', {
    className: 'mex-focal__img',
    attrs: { alt: '', draggable: 'false' },
  });
  const marker = el('span', { className: 'mex-focal__marker', attrs: { 'aria-hidden': 'true' } });
  const surface = el('div', {
    className: 'mex-focal__surface',
    attrs: {
      tabindex: readOnly ? null : '0',
      role: 'group',
      'aria-label': t('tools.focal.surface', 'Focal point picker'),
      'aria-describedby': `${valueId} ${hintId}`,
    },
    children: [img, marker],
  });
  const value = el('p', {
    className: 'mex-focal__value',
    attrs: { id: valueId, 'aria-live': 'polite' },
  });
  const hint = el('p', {
    className: 'mex-tool__muted',
    attrs: { id: hintId },
    text: t(
      'tools.focal.hint',
      'Click or tap the image, or focus it and use the arrow keys (Shift for larger steps). Frontends keep this point visible when they crop the image.'
    ),
  });
  const reset = button(t('tools.focal.reset', 'Reset focal point'));
  const actions = el('div', { className: 'mex-focal__actions', children: readOnly ? [] : [reset] });
  const panel = el('div', {
    className: 'mex-focal__panel',
    attrs: { id: panelId, hidden: true },
    children: [surface, value, ...(readOnly ? [] : [hint]), actions],
  });
  const wrapper = el('div', { className: 'mex-focal', children: [toggle, panel] });
  // Enter/Space on the buttons must press them, not create or move Editor.js blocks.
  wrapper.addEventListener('keydown', (event) => {
    if (event.target !== surface && ['Enter', ' ', 'Tab', 'Backspace', 'Delete'].includes(event.key))
      event.stopPropagation();
  });

  const show = () => {
    const percent = focalPercent(current);
    marker.style.left = `${percent.x}%`;
    marker.style.top = `${percent.y}%`;
    marker.hidden = !current;
    const text = current
      ? t('tools.focal.value', 'Focal point: {x} % from the left, {y} % from the top', percent)
      : t('tools.focal.none', 'No focal point set (frontends use the centre).');
    value.textContent = text;
    toggle.textContent = current
      ? t('tools.focal.toggleSet', 'Focal point {x} %, {y} %', percent)
      : t('tools.focal.toggle', 'Set focal point');
    reset.disabled = !current;
  };
  const set = (next) => {
    current = next;
    show();
    onChange(current);
  };

  let source = '';
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    // The preview loads when the picker opens for the first time (a gallery has up to 50 images).
    if (open && source && img.getAttribute('src') !== source) img.setAttribute('src', source);
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !readOnly) surface.focus();
  });
  if (!readOnly) {
    surface.addEventListener('click', (event) => {
      const next = focalFromPointer(surface.getBoundingClientRect(), event.clientX, event.clientY);
      if (next) set(next);
    });
    surface.addEventListener('keydown', (event) => {
      const next = moveFocal(current, event.key, event.shiftKey);
      // Editor.js would move the caret or the block selection on these keys.
      if (next || event.key === 'Enter' || event.key === 'Tab' || event.key === 'Backspace')
        event.stopPropagation();
      if (!next) return;
      event.preventDefault();
      set(next);
    });
    reset.addEventListener('click', () => {
      set(undefined);
      surface.focus();
    });
  }

  const setUrl = (next) => {
    source = typeof next === 'string' ? next : '';
    if (!source) img.removeAttribute('src');
    else if (!panel.hidden) img.setAttribute('src', source);
    wrapper.hidden = !source;
  };
  setUrl(url);
  show();
  return { element: wrapper, setUrl, read: () => current };
};

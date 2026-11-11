import { el, field, select, input } from './dom';
import { moveActiveIndex } from './logic.mjs';
import { API } from '../../utils/api';

/**
 * Internal-link picker shown in the hyperlink tool's inline actions:
 * content type select, search input (ARIA combobox) and a listbox of entries.
 *
 * Types come from GET /magic-editor-x/links/types and entries from
 * GET /magic-editor-x/links/search; both follow Content Manager read
 * permissions on the server, so only readable types and entries appear.
 * Keyboard: ArrowDown/ArrowUp move through the results, Enter picks the
 * active entry (or searches now), Escape closes the picker.
 */

/** Types are loaded once per editor (fetch client) and reused by every link. */
const typeCache = new WeakMap();

let pickerCount = 0;

/**
 * @param {{ get: Function }} fetchClient - Admin fetch client.
 * @returns {Promise<Array<{ uid: string, kind: string, displayName: string, localized: boolean }>>} Types.
 */
const loadTypes = (fetchClient) => {
  if (!typeCache.has(fetchClient)) {
    const promise = fetchClient
      .get(API.linkTypes)
      .then(({ data }) => (data && Array.isArray(data.data) ? data.data : []))
      .catch((error) => {
        typeCache.delete(fetchClient);
        throw error;
      });
    typeCache.set(fetchClient, promise);
  }
  return typeCache.get(fetchClient);
};

/**
 * Creates the picker.
 * @param {{
 *   t: (id: string, fallback: string, values?: object) => string,
 *   fetchClient: { get: Function },
 *   getLocale?: () => string|null,
 *   onPick: (item: { documentId: string, uid: string, locale: string|null, title: string, href: string }) => void,
 *   onClose: () => void,
 * }} options - Options.
 * @returns {{ element: HTMLElement, open: () => Promise<void>, close: () => void, isOpen: () => boolean }} Picker.
 */
export const createLinkPicker = ({ t, fetchClient, getLocale, onPick, onClose }) => {
  pickerCount += 1;
  const id = `mex-link-picker-${pickerCount}`;
  const element = el('div', {
    className: 'mex-link-picker',
    attrs: { id, role: 'group', 'aria-label': t('tools.hyperlink.internal.title', 'Link to an entry') },
  });
  element.hidden = true;

  let types = [];
  let items = [];
  let active = -1;
  let timer = null;
  let requestId = 0;
  let typeSelect = null;
  let search = null;
  const status = el('p', { className: 'mex-tool__muted', attrs: { role: 'status', 'aria-live': 'polite' } });
  const list = el('ul', {
    className: 'mex-link-picker__results',
    attrs: {
      id: `${id}-results`,
      role: 'listbox',
      'aria-label': t('tools.hyperlink.internal.results', 'Entries'),
    },
  });

  const setStatus = (text, isError = false) => {
    status.className = isError ? 'mex-tool__error' : 'mex-tool__muted';
    status.textContent = text;
  };

  const setActive = (index) => {
    active = index;
    Array.from(list.children).forEach((option, i) => {
      option.setAttribute('aria-selected', i === active ? 'true' : 'false');
      if (i === active && typeof option.scrollIntoView === 'function')
        option.scrollIntoView({ block: 'nearest' });
    });
    if (search) {
      if (active >= 0) search.setAttribute('aria-activedescendant', `${id}-option-${active}`);
      else search.removeAttribute('aria-activedescendant');
    }
  };

  const pick = (index) => {
    const item = items[index];
    if (item && item.href) onPick(item);
  };

  const renderResults = () => {
    list.replaceChildren();
    items.forEach((item, index) => {
      const statusLabel =
        item.status === 'published'
          ? t('tools.hyperlink.internal.published', 'Published')
          : item.status === 'draft'
            ? t('tools.hyperlink.internal.draft', 'Draft')
            : '';
      const meta = [statusLabel, item.locale || ''].filter(Boolean).join(' · ');
      const option = el('li', {
        className: 'mex-link-picker__option',
        attrs: {
          id: `${id}-option-${index}`,
          role: 'option',
          'aria-selected': 'false',
          'aria-disabled': item.href ? null : 'true',
        },
        children: [
          el('span', {
            className: 'mex-link-picker__title',
            text: item.title || t('tools.hyperlink.internal.untitled', 'Untitled entry'),
          }),
          meta ? el('span', { className: 'mex-link-picker__meta', text: meta }) : null,
        ],
      });
      // Keep the focus in the search input so the keyboard flow continues.
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => pick(index));
      list.appendChild(option);
    });
    if (search) search.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    setActive(items.length ? 0 : -1);
  };

  const run = async () => {
    window.clearTimeout(timer);
    const current = (requestId += 1);
    const type = types.find((candidate) => candidate.uid === (typeSelect && typeSelect.value));
    if (!type) return;
    const q = search ? search.value.trim().slice(0, 100) : '';
    const locale = type.localized && typeof getLocale === 'function' ? getLocale() : null;
    setStatus(t('tools.hyperlink.internal.searching', 'Searching'));
    list.setAttribute('aria-busy', 'true');
    try {
      const { data } = await fetchClient.get(API.linkSearch, {
        params: { uid: type.uid, ...(q ? { q } : {}), ...(locale ? { locale } : {}) },
      });
      if (current !== requestId) return;
      items = data && Array.isArray(data.data) ? data.data : [];
      renderResults();
      setStatus(items.length ? '' : t('tools.hyperlink.internal.empty', 'No entries match your search'));
    } catch {
      if (current !== requestId) return;
      items = [];
      renderResults();
      setStatus(t('tools.hyperlink.internal.failed', 'Entries could not be loaded'), true);
    } finally {
      if (current === requestId) list.removeAttribute('aria-busy');
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setActive(moveActiveIndex(active, event.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (active >= 0 && items[active]) pick(active);
      else run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const build = () => {
    element.replaceChildren();
    typeSelect = select(
      types.map((type) => ({ value: type.uid, label: type.displayName })),
      types[0].uid
    );
    search = input({
      type: 'search',
      placeholder: t('tools.hyperlink.internal.searchPlaceholder', 'Search by title'),
    });
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-controls', list.id);
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('maxlength', '100');
    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 250);
    });
    typeSelect.addEventListener('change', run);
    typeSelect.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    element.append(
      el('div', {
        className: 'mex-link-picker__controls',
        children: [
          field(t('tools.hyperlink.internal.type', 'Content type'), typeSelect),
          field(t('tools.hyperlink.internal.search', 'Search'), search),
        ],
      }),
      status,
      list
    );
  };

  // Editor.js handles Enter, arrows and Escape in a capture listener on the
  // document (inline toolbar keyboard navigation) and closes the toolbar. A
  // capture listener on window runs first, so keys typed inside the picker
  // stay in the picker.
  const guard = (event) => {
    if (element.hidden || !element.contains(event.target)) return;
    if (!['Enter', 'ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) return;
    event.stopPropagation();
    if (event.key === 'Tab') return;
    if (event.target === search) onKeyDown(event);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const open = async () => {
    window.addEventListener('keydown', guard, true);
    element.hidden = false;
    element.replaceChildren(status);
    setStatus(t('tools.hyperlink.internal.loading', 'Loading content types'));
    try {
      types = await loadTypes(fetchClient);
    } catch {
      setStatus(t('tools.hyperlink.internal.typesFailed', 'Content types could not be loaded'), true);
      return;
    }
    if (element.hidden) return;
    if (!types.length) {
      setStatus(t('tools.hyperlink.internal.noTypes', 'There is no content type you can read'));
      return;
    }
    build();
    search.focus();
    run();
  };

  function close() {
    window.removeEventListener('keydown', guard, true);
    window.clearTimeout(timer);
    requestId += 1;
    element.hidden = true;
    element.replaceChildren();
    items = [];
    active = -1;
    onClose();
  }

  return { element, open, close, isOpen: () => !element.hidden };
};

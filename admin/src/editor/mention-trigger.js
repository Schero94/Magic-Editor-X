import { el } from './tools/dom';
import { loadTypes } from './tools/link-picker';
import { insertMentionChip } from './tools/mention';
import { moveActiveIndex } from './tools/logic.mjs';
import {
  MENTION_SEARCH_DELAY_MS,
  findMentionQuery,
  isMentionTriggerBlock,
  mentionSearchText,
  placePopup,
} from './mention-trigger-logic.mjs';
import { API } from '../utils/api';

/**
 * `@` trigger for mentions (2.4). Typing `@` at the start of a word in a text
 * block (paragraph, heading, list, checklist, quote, toggle, table cell)
 * opens entry suggestions at the caret; the text typed after the `@` filters
 * them. Arrow keys move, Enter (or a click) inserts the mention chip in place
 * of `@query` exactly like the mention tool, Escape closes the suggestions and
 * keeps the typed text. With several content types, Tab moves to the type
 * select and Tab, Enter or Escape there return to the text.
 *
 * Accessibility (WAI-ARIA combobox pattern on the editable): DOM focus stays
 * in the text; while the suggestions are open the editable carries
 * `aria-controls` (the listbox), `aria-expanded`, `aria-autocomplete="list"`
 * and `aria-activedescendant` (the active option); a polite live region
 * announces the number of results.
 *
 * Never in code, raw HTML, form inputs, links or existing chips, never in
 * read-only mode and never while an IME composition is running. Searches are
 * debounced and a new search cancels the one in flight. The chip goes
 * through the normal editor change path (input event -> Editor.js onChange
 * -> form value and collaboration).
 */

const SKIP =
  '.ce-code, .ce-rawtool, .cdx-input--code, .mex-code, input, textarea, select, a, [data-mutation-free]';

let triggerCount = 0;

/**
 * Text from the start of `root` up to the caret.
 * @param {HTMLElement} root - Editable element.
 * @param {Node} node - Caret node.
 * @param {number} offset - Caret offset.
 * @returns {string} Text.
 */
const textBefore = (root, node, offset) => {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString();
};

/**
 * Installs the trigger on an editor.
 * @param {{
 *   holder: HTMLElement,
 *   editor: object,
 *   fetchClient: { get: Function },
 *   getLocale?: () => string|null,
 *   t: (id: string, fallback: string, values?: object) => string,
 * }} options - Options.
 * @returns {{ destroy: () => void, isOpen: () => boolean }} Handle.
 */
export const createMentionTrigger = ({ holder, editor, fetchClient, getLocale, t }) => {
  triggerCount += 1;
  const id = `mex-mention-trigger-${triggerCount}`;
  const container = holder.parentElement || holder;

  const status = el('p', {
    className: 'mex-mention-popup__status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const list = el('ul', {
    className: 'mex-mention-popup__results',
    attrs: {
      id: `${id}-listbox`,
      role: 'listbox',
      'aria-label': t('tools.mention.trigger.results', 'Entries to mention'),
    },
  });
  const typeSelect = el('select', {
    className: 'mex-mention-popup__select',
    attrs: { id: `${id}-type` },
  });
  const typeRow = el('div', {
    className: 'mex-mention-popup__type',
    children: [
      el('label', {
        className: 'mex-mention-popup__label',
        text: t('tools.mention.trigger.type', 'Content type'),
        attrs: { for: `${id}-type` },
      }),
      typeSelect,
    ],
  });
  const hint = el('p', {
    className: 'mex-mention-popup__hint',
    text: t(
      'tools.mention.trigger.hint',
      'Arrow keys choose, Enter inserts, Escape closes. Tab switches the content type.'
    ),
    attrs: { id: `${id}-hint` },
  });
  const popup = el('div', {
    className: 'mex-mention-popup',
    attrs: { 'data-mex-mention-popup': 'true' },
    children: [typeRow, list, status, hint],
  });
  popup.hidden = true;
  container.appendChild(popup);

  /** Open state: the `@` text node, its offset and the query typed after it. */
  let state = null;
  /** `@` positions closed with Escape (not reopened until a new `@` is typed). */
  let dismissed = null;
  let types = null;
  let typeUid = null;
  let items = [];
  let active = -1;
  let timer = null;
  let controller = null;
  let lastQuery = null;
  let ariaBackup = null;
  /** Enter was pressed while a search was pending: insert the first result when it arrives. */
  let pickWhenReady = false;

  const setStatus = (text, isError = false) => {
    status.classList.toggle('mex-mention-popup__status--error', isError);
    status.textContent = text;
  };

  /** Marks the editable as the combobox of the listbox (restored on close). */
  const markEditable = (editable) => {
    if (ariaBackup && ariaBackup.element === editable) return;
    unmarkEditable();
    const names = ['role', 'aria-multiline', 'aria-controls', 'aria-expanded', 'aria-autocomplete'];
    ariaBackup = {
      element: editable,
      values: names.map((name) => [name, editable.getAttribute(name)]),
      activedescendant: editable.getAttribute('aria-activedescendant'),
    };
    // aria-activedescendant needs a role that supports it; a contenteditable is a text box.
    if (!editable.getAttribute('role')) {
      editable.setAttribute('role', 'textbox');
      editable.setAttribute('aria-multiline', 'true');
    }
    editable.setAttribute('aria-controls', list.id);
    editable.setAttribute('aria-expanded', 'true');
    editable.setAttribute('aria-autocomplete', 'list');
  };

  function unmarkEditable() {
    if (!ariaBackup) return;
    const { element, values, activedescendant } = ariaBackup;
    for (const [name, value] of values) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    if (activedescendant === null) element.removeAttribute('aria-activedescendant');
    else element.setAttribute('aria-activedescendant', activedescendant);
    ariaBackup = null;
  }

  const setActive = (index) => {
    active = index;
    Array.from(list.children).forEach((option, i) => {
      option.setAttribute('aria-selected', i === active ? 'true' : 'false');
      // Scroll only the list: scrollIntoView would also scroll the page behind the fixed popup.
      if (i === active) {
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
          list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    });
    if (ariaBackup) {
      if (active >= 0) ariaBackup.element.setAttribute('aria-activedescendant', `${id}-option-${active}`);
      else ariaBackup.element.removeAttribute('aria-activedescendant');
    }
  };

  /** Range of `@query` in the document, or null when the text changed. */
  const queryRange = () => {
    if (!state || !state.node.isConnected) return null;
    const expected = `@${state.query}`;
    if (state.node.data.slice(state.start, state.start + expected.length) !== expected) return null;
    const range = document.createRange();
    range.setStart(state.node, state.start);
    range.setEnd(state.node, state.start + expected.length);
    return range;
  };

  const position = () => {
    if (popup.hidden) return;
    const range = queryRange();
    if (!range) return;
    const rects = range.getClientRects();
    const first = rects[0] || range.getBoundingClientRect();
    const last = rects[rects.length - 1] || first;
    const { top, left } = placePopup(
      { top: first.top, bottom: last.bottom, left: first.left },
      { width: popup.offsetWidth, height: popup.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
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
        className: 'mex-mention-popup__option',
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
      // Keep the focus (and the caret) in the text.
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => pick(index));
      list.appendChild(option);
    });
    setActive(items.length ? 0 : -1);
    position();
  };

  const cancelSearch = () => {
    window.clearTimeout(timer);
    timer = null;
    if (controller) controller.abort();
    controller = null;
  };

  const search = async () => {
    cancelSearch();
    const type = (types || []).find((candidate) => candidate.uid === typeUid);
    if (!state || !type) return;
    const q = mentionSearchText(state.query);
    const locale = type.localized && typeof getLocale === 'function' ? getLocale() : null;
    const current = new AbortController();
    controller = current;
    lastQuery = `${type.uid}|${q}`;
    setStatus(t('tools.hyperlink.internal.searching', 'Searching'));
    list.setAttribute('aria-busy', 'true');
    try {
      const { data } = await fetchClient.get(API.linkSearch, {
        params: { uid: type.uid, ...(q ? { q } : {}), ...(locale ? { locale } : {}) },
        signal: current.signal,
      });
      if (controller !== current || !state) return;
      items = data && Array.isArray(data.data) ? data.data : [];
      renderResults();
      if (pickWhenReady) {
        pickWhenReady = false;
        if (items.length) {
          pick(0);
          return;
        }
      }
      setStatus(
        t(
          'tools.mention.trigger.count',
          '{count, plural, =0 {No entries match} one {# entry} other {# entries}}',
          { count: items.length }
        )
      );
    } catch {
      if (controller !== current || current.signal.aborted || !state) return;
      pickWhenReady = false;
      items = [];
      renderResults();
      setStatus(t('tools.hyperlink.internal.failed', 'Entries could not be loaded'), true);
    } finally {
      if (controller === current) {
        controller = null;
        list.removeAttribute('aria-busy');
      }
    }
  };

  const scheduleSearch = (now = false) => {
    // A newer query replaces the pending and the in-flight search; the shown results are stale until it answers.
    cancelSearch();
    list.setAttribute('aria-busy', 'true');
    if (now) search();
    else timer = window.setTimeout(search, MENTION_SEARCH_DELAY_MS);
  };

  const fillTypes = () => {
    typeSelect.replaceChildren(
      ...types.map((type) => el('option', { text: type.displayName || type.uid, attrs: { value: type.uid } }))
    );
    // Every new `@` starts with the first type (predictable); Tab switches.
    typeUid = types[0].uid;
    typeSelect.value = typeUid;
    typeRow.hidden = types.length < 2;
    hint.textContent =
      types.length < 2
        ? t('tools.mention.trigger.hintSingle', 'Arrow keys choose, Enter inserts, Escape closes.')
        : t(
            'tools.mention.trigger.hint',
            'Arrow keys choose, Enter inserts, Escape closes. Tab switches the content type.'
          );
  };

  function close() {
    cancelSearch();
    pickWhenReady = false;
    list.removeAttribute('aria-busy');
    state = null;
    items = [];
    active = -1;
    lastQuery = null;
    list.replaceChildren();
    setStatus('');
    popup.hidden = true;
    unmarkEditable();
  }

  const open = async (next, editable) => {
    state = next;
    markEditable(editable);
    if (!types) {
      try {
        types = await loadTypes(fetchClient);
      } catch {
        types = null;
        // Without the list of readable types there is nothing to suggest; the text stays as typed.
        close();
        return;
      }
      if (state !== next) return;
    }
    if (!types.length) {
      // No content type the user can read in the Content Manager: no suggestions.
      dismissed = { node: next.node, start: next.start };
      close();
      return;
    }
    if (popup.hidden) {
      fillTypes();
      popup.hidden = false;
      position();
    }
    const q = `${typeUid}|${mentionSearchText(next.query)}`;
    if (q !== lastQuery) scheduleSearch(lastQuery === null);
  };

  /**
   * Block API of the block that contains a node, found by the block element's
   * id (`.ce-block[data-id]`), which stays right after collaborators' edits
   * re-render blocks (the current block index may lag behind then).
   * @param {Node} node - Node inside the editor.
   * @returns {object|null} Block API.
   */
  const blockOf = (node) => {
    const element = node.parentElement && node.parentElement.closest('.ce-block[data-id]');
    if (!element || !holder.contains(element)) return null;
    try {
      return editor.blocks.getById(element.getAttribute('data-id'));
    } catch {
      return null;
    }
  };

  /** Current text block and editable around the caret, or null where `@` must not trigger. */
  const caretContext = () => {
    if (editor.readOnly && editor.readOnly.isEnabled) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
    const node = selection.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !holder.contains(node)) return null;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return null;
    const editable = parent.closest('[contenteditable="true"]');
    if (!editable || !holder.contains(editable)) return null;
    const block = blockOf(node);
    if (!block || !isMentionTriggerBlock(block.name)) return null;
    return { node, offset: selection.anchorOffset, editable };
  };

  /** Re-reads the text before the caret and opens, updates or closes the suggestions. */
  const evaluate = () => {
    if (!popup.hidden && popup.contains(document.activeElement)) return;
    const context = caretContext();
    if (!context) {
      if (state) close();
      return;
    }
    const { node, offset, editable } = context;
    const match = findMentionQuery(textBefore(editable, node, offset));
    const nodeBefore = node.data.slice(0, offset);
    if (!match || !nodeBefore.endsWith(`@${match.query}`)) {
      // The dismissed `@` is gone (or the caret left it): a new `@` opens again.
      if (!match) dismissed = null;
      if (state) close();
      return;
    }
    const start = offset - match.query.length - 1;
    if (dismissed && dismissed.node === node && dismissed.start === start) {
      if (state) close();
      return;
    }
    dismissed = null;
    if (state && (state.node !== node || state.start !== start)) close();
    open({ node, start, query: match.query, offset }, editable);
  };

  const pick = (index) => {
    const item = items[index];
    const range = queryRange();
    if (!item || !item.href || !range) return;
    close();
    insertMentionChip(range, item, {
      untitled: t('tools.hyperlink.internal.untitled', 'Untitled entry'),
    });
  };

  /** Moves the focus back to the text, at the end of `@query`. */
  const returnToText = () => {
    const range = queryRange();
    if (!range || !ariaBackup) return;
    ariaBackup.element.focus({ preventScroll: true });
    const caret = document.createRange();
    caret.setStart(range.endContainer, range.endOffset);
    caret.collapse(true);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
  };

  // Keys while the suggestions are open. A capture listener on window runs
  // before Editor.js, the Markdown shortcuts and the mention chip keys.
  const onKeyDown = (event) => {
    if (popup.hidden || !state || event.isComposing || event.keyCode === 229) return;
    const inSelect = event.target === typeSelect;
    if (inSelect) {
      if (['Escape', 'Enter', 'Tab'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        returnToText();
      } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.stopPropagation();
      }
      return;
    }
    if (!holder.contains(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      setActive(moveActiveIndex(active, event.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (event.key === 'Enter') {
      if (timer || controller) {
        // Results for the latest text are still on their way: take the first one when they arrive.
        event.preventDefault();
        event.stopPropagation();
        pickWhenReady = true;
        if (timer) scheduleSearch(true);
        return;
      }
      if (active < 0 || !items[active]) {
        close();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pick(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissed = { node: state.node, start: state.start };
      close();
    } else if (event.key === 'Tab' && !typeRow.hidden) {
      event.preventDefault();
      event.stopPropagation();
      typeSelect.focus();
    }
  };

  const onInput = (event) => {
    if (event.isComposing) return;
    evaluate();
  };
  const onCompositionEnd = () => window.setTimeout(evaluate, 0);
  const onSelectionChange = () => {
    if (state) evaluate();
  };
  const onFocusIn = (event) => {
    if (!state) return;
    if (holder.contains(event.target) || popup.contains(event.target)) return;
    close();
  };
  const onPointerDown = (event) => {
    if (!state) return;
    if (popup.contains(event.target)) return;
    // A click elsewhere in the text moves the caret; selectionchange decides.
    if (!holder.contains(event.target)) close();
  };
  const onTypeChange = () => {
    typeUid = typeSelect.value;
    if (state) scheduleSearch(true);
  };
  const onViewportChange = () => position();

  holder.addEventListener('input', onInput);
  holder.addEventListener('compositionend', onCompositionEnd);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
  typeSelect.addEventListener('change', onTypeChange);

  return {
    isOpen: () => !popup.hidden,
    destroy() {
      close();
      holder.removeEventListener('input', onInput);
      holder.removeEventListener('compositionend', onCompositionEnd);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      typeSelect.removeEventListener('change', onTypeChange);
      popup.remove();
    },
  };
};

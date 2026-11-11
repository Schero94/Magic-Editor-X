import { ICONS, el, field, input, select, button } from './dom';
import { sanitizeSvg } from '../sanitize';
import { normalizeEmbeddedEntry, summarizeEntry } from './logic.mjs';

/**
 * Embeds a reference to a Strapi entry. Data (unchanged from 1.x):
 * `{ entry: { id, documentId, title, ...displayFields }, contentType, displayMode }`.
 *
 * Content types come from GET /magic-editor-x/content-types (only types the
 * admin can read); entries are searched through the Content Manager admin API,
 * so Content Manager permissions and conditions apply to every result.
 */
export class EmbeddedEntryTool {
  static get toolbox() {
    return { title: 'Embedded entry', icon: ICONS.entry };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get pasteConfig() {
    return false;
  }

  static get sanitize() {
    return { entry: false, contentType: false, displayMode: false };
  }

  constructor({ data, api, config, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.data = normalizeEmbeddedEntry(data, this.config);
    this.wrapper = null;
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  render() {
    this.wrapper = el('div', { className: 'mex-entry' });
    if (this.data.entry) this.drawPreview();
    else if (this.readOnly)
      this.wrapper.appendChild(
        el('p', { className: 'mex-tool__muted', text: this.t('tools.entry.none', 'No entry selected') })
      );
    else this.drawPicker();
    return this.wrapper;
  }

  drawPreview() {
    this.wrapper.replaceChildren();
    const entry = this.data.entry;
    const card = el('div', { className: 'mex-entry__card' });
    const icon = el('span', { className: 'mex-entry__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = this.config.icon ? sanitizeSvg(this.config.icon) : ICONS.entry;
    const text = el('div', { className: 'mex-entry__text' });
    text.appendChild(
      el('p', {
        className: 'mex-entry__title',
        text: String(entry.title || entry.documentId || entry.id || ''),
      })
    );
    const meta = el('p', { className: 'mex-entry__meta', text: this.data.contentType || '' });
    text.appendChild(meta);
    const details = Object.entries(entry).filter(
      ([key, value]) =>
        !['id', 'documentId', 'title'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)
    );
    if (details.length) {
      const list = el('dl', { className: 'mex-entry__fields' });
      for (const [key, value] of details.slice(0, 6))
        list.append(el('dt', { text: key }), el('dd', { text: String(value) }));
      text.appendChild(list);
    }
    card.append(icon, text);
    if (!this.readOnly) {
      const change = button(this.t('tools.entry.change', 'Change'), {
        ariaLabel: this.t('tools.entry.changeLabel', 'Choose another entry'),
      });
      change.addEventListener('click', () => this.drawPicker());
      card.appendChild(change);
    }
    this.wrapper.appendChild(card);
  }

  async loadTypes() {
    const { data } = await this.config.fetchClient.get('/magic-editor-x/content-types');
    const types = ((data && data.data) || []).filter((type) => type.kind === 'collectionType');
    if (this.config.contentType) return types.filter((type) => type.uid === this.config.contentType);
    return types;
  }

  async drawPicker() {
    this.wrapper.replaceChildren();
    const status = el('p', {
      className: 'mex-tool__muted',
      text: this.t('tools.entry.loading', 'Loading content types'),
      attrs: { role: 'status' },
    });
    this.wrapper.appendChild(status);
    let types;
    try {
      types = await this.loadTypes();
    } catch {
      status.className = 'mex-tool__error';
      status.textContent = this.t('tools.entry.typesFailed', 'Content types could not be loaded');
      return;
    }
    if (types.length === 0) {
      status.textContent = this.t('tools.entry.noTypes', 'There is no content type you can read');
      return;
    }
    this.wrapper.replaceChildren();
    const typeSelect = select(
      types.map((type) => ({ value: type.uid, label: type.displayName })),
      this.data.contentType && types.some((type) => type.uid === this.data.contentType)
        ? this.data.contentType
        : types[0].uid
    );
    const search = input({
      placeholder: this.t('tools.entry.searchPlaceholder', 'Search entries'),
      type: 'search',
    });
    const results = el('ul', {
      className: 'mex-entry__results',
      attrs: { role: 'listbox', 'aria-label': this.t('tools.entry.results', 'Entries') },
    });
    const message = el('p', { className: 'mex-tool__muted', attrs: { role: 'status' } });
    let timer = null;
    let requestId = 0;
    const run = async () => {
      const current = (requestId += 1);
      const uid = typeSelect.value;
      message.textContent = this.t('tools.entry.searching', 'Searching');
      results.replaceChildren();
      try {
        const { data } = await this.config.fetchClient.get(
          `/content-manager/collection-types/${encodeURIComponent(uid)}`,
          {
            params: {
              page: 1,
              pageSize: 10,
              ...(search.value.trim() ? { _q: search.value.trim().slice(0, 100) } : {}),
            },
          }
        );
        if (current !== requestId) return;
        const entries = (data && data.results) || [];
        message.textContent = entries.length
          ? ''
          : this.t('tools.entry.empty', 'No entries match your search');
        for (const entry of entries) {
          const summary = summarizeEntry(entry, this.config);
          const option = el('li', { attrs: { role: 'option', 'aria-selected': 'false' } });
          const choose = el('button', {
            className: 'mex-entry__result',
            attrs: { type: 'button' },
            text: summary.title,
          });
          choose.addEventListener('click', () => {
            this.data = { ...this.data, entry: summary, contentType: uid };
            this.drawPreview();
            this.changed();
          });
          option.appendChild(choose);
          results.appendChild(option);
        }
      } catch {
        if (current === requestId)
          message.textContent = this.t('tools.entry.searchFailed', 'Entries could not be loaded');
      }
    };
    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 250);
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        run();
      }
    });
    typeSelect.addEventListener('change', run);
    const row = el('div', {
      className: 'mex-tool__grid',
      children: [
        field(this.t('tools.entry.type', 'Content type'), typeSelect),
        field(this.t('tools.entry.search', 'Search'), search),
      ],
    });
    this.wrapper.append(row, message, results);
    if (this.data.entry) {
      const cancel = button(this.t('tools.common.cancel', 'Cancel'));
      cancel.addEventListener('click', () => this.drawPreview());
      this.wrapper.appendChild(cancel);
    }
    run();
  }

  save() {
    return { entry: this.data.entry, contentType: this.data.contentType, displayMode: this.data.displayMode };
  }

  validate(data) {
    return Boolean(data.entry);
  }
}

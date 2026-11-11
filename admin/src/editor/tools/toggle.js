import { ICONS, el, editable } from './dom';
import { sanitizeInline } from '../sanitize';
import { normalizeToggle, toggleChildIndexes, nextToggleItems } from './logic.mjs';

/**
 * Collapsible section. Replaces editorjs-toggle-block (maintenance ended)
 * with the same block name `toggle` and data `{ text, status, fk, items }`:
 * the `items` blocks right after the toggle are its content. Closing the
 * toggle hides them in the editor; the block menu includes the next block or
 * releases the last one.
 */

const CHILD = 'mex-toggle-child';
const HIDDEN = 'mex-toggle-child--hidden';

export class ToggleTool {
  static get toolbox() {
    return { title: 'Toggle', icon: ICONS.toggle };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      text: {
        b: true,
        i: true,
        u: { class: 'cdx-underline' },
        s: { class: 'cdx-strikethrough' },
        mark: { class: 'cdx-marker' },
        code: { class: 'inline-code' },
        a: { href: true, target: true, rel: true },
        br: true,
      },
      status: false,
      fk: false,
    };
  }

  static get conversionConfig() {
    return { export: 'text', import: 'text' };
  }

  constructor({ data, api, config, readOnly, block }) {
    this.api = api;
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.data = normalizeToggle(data, block ? block.id : '');
    this.marked = [];
    this.timers = [];
  }

  t(id, fallback, values) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback, values) : fallback;
  }

  render() {
    this.wrapper = el('div', { className: 'mex-toggle' });
    this.button = el('button', {
      className: 'mex-toggle__button',
      attrs: { type: 'button', 'aria-label': this.t('tools.toggle.toggle', 'Show or hide the content') },
    });
    this.button.innerHTML = ICONS.toggle;
    this.button.addEventListener('click', () => {
      this.data.status = this.data.status === 'open' ? 'closed' : 'open';
      this.applyChildren();
      this.changed();
    });
    this.title = editable({
      html: sanitizeInline(this.data.text),
      placeholder: this.t('tools.toggle.placeholder', 'Toggle title'),
      readOnly: this.readOnly,
      className: 'mex-toggle__title',
    });
    this.count = el('span', { className: 'mex-toggle__count' });
    this.wrapper.append(this.button, this.title, this.count);
    return this.wrapper;
  }

  rendered() {
    // Child blocks may render after this one; apply again once they exist.
    this.applyChildren();
    this.timers.push(
      window.setTimeout(() => this.applyChildren(), 0),
      window.setTimeout(() => this.applyChildren(), 300)
    );
  }

  updated() {
    this.applyChildren();
  }

  moved() {
    this.applyChildren();
  }

  removed() {
    this.clearMarks();
    this.timers.forEach((timer) => window.clearTimeout(timer));
  }

  index() {
    return this.block ? this.api.blocks.getBlockIndex(this.block.id) : -1;
  }

  clearMarks() {
    for (const holder of this.marked) holder.classList.remove(CHILD, HIDDEN);
    this.marked = [];
  }

  applyChildren() {
    // Every DOM write below is skipped when nothing changes: Editor.js reports
    // DOM mutations inside a block as an update, which calls this again.
    if (!this.wrapper) return;
    const open = this.data.status === 'open';
    const expanded = open ? 'true' : 'false';
    if (this.button.getAttribute('aria-expanded') !== expanded)
      this.button.setAttribute('aria-expanded', expanded);
    if (this.wrapper.classList.contains('mex-toggle--closed') === open)
      this.wrapper.classList.toggle('mex-toggle--closed', !open);
    const indexes = toggleChildIndexes(this.index(), this.data.items, this.api.blocks.getBlocksCount());
    const holders = indexes
      .map((index) => this.api.blocks.getBlockByIndex(index))
      .filter((child) => child && child.holder)
      .map((child) => child.holder);
    for (const holder of this.marked) {
      if (!holders.includes(holder)) holder.classList.remove(CHILD, HIDDEN);
    }
    for (const holder of holders) {
      if (!holder.classList.contains(CHILD)) holder.classList.add(CHILD);
      if (holder.classList.contains(HIDDEN) === open) holder.classList.toggle(HIDDEN, !open);
    }
    this.marked = holders;
    const label = indexes.length
      ? this.t('tools.toggle.count', '{count, plural, one {# block} other {# blocks}}', {
          count: indexes.length,
        })
      : '';
    if (this.count.textContent !== label) this.count.textContent = label;
  }

  changed() {
    if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
  }

  renderSettings() {
    const total = this.api.blocks.getBlocksCount();
    const index = this.index();
    return [
      {
        icon: ICONS.plus,
        title: this.t('tools.toggle.include', 'Include the next block'),
        isDisabled:
          nextToggleItems(index, this.data.items, total, 'include') ===
          toggleChildIndexes(index, this.data.items, total).length,
        closeOnActivate: true,
        onActivate: () => {
          this.data.items = nextToggleItems(index, this.data.items, total, 'include');
          this.applyChildren();
          this.changed();
        },
      },
      {
        icon: ICONS.minus,
        title: this.t('tools.toggle.release', 'Move the last block out'),
        isDisabled: toggleChildIndexes(index, this.data.items, total).length === 0,
        closeOnActivate: true,
        onActivate: () => {
          this.data.items = nextToggleItems(index, this.data.items, total, 'release');
          this.applyChildren();
          this.changed();
        },
      },
    ];
  }

  save() {
    return {
      text: this.title ? this.title.innerHTML : this.data.text,
      status: this.data.status,
      fk: this.data.fk || (this.block ? this.block.id : ''),
      items:
        toggleChildIndexes(this.index(), this.data.items, this.api.blocks.getBlocksCount()).length ||
        this.data.items,
    };
  }

  destroy() {
    this.removed();
  }
}

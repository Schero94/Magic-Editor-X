import { el } from './dom';

/**
 * Synced block (`synced`, 2.3). Stores only `{ ref }`, the documentId of a
 * synced source (Settings > Templates). The block is inserted from the
 * "Insert template" dialog, so the tool has no toolbox entry.
 *
 * The visible part (source name, rendered source content, "Edit source",
 * "Detach") is a React view that the field renders through a portal into the
 * element this tool returns (`config.mount(element, info)`), so it has the
 * admin theme, translations and fetch client. The element is marked
 * `data-mutation-free`, so the view's own updates are not taken for edits of
 * the block, and key presses on its controls do not reach Editor.js (Enter
 * or Backspace there must not create or remove blocks).
 */
export class SyncedTool {
  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return { ref: false };
  }

  /**
   * @param {{ data: object, config: object, readOnly: boolean, block: object }} params - Editor.js tool parameters.
   */
  constructor({ data, config, readOnly, block }) {
    this.config = config || {};
    this.readOnly = Boolean(readOnly);
    this.block = block;
    const ref = data && typeof data.ref === 'string' ? data.ref : '';
    this.data = { ref: /^[a-z0-9]{1,64}$/.test(ref) ? ref : '' };
    this.unmount = null;
  }

  render() {
    const wrapper = el('div', {
      className: 'mex-synced',
      attrs: { 'data-mutation-free': 'true', 'data-mex-synced': this.data.ref || 'none' },
    });
    wrapper.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && target !== wrapper && target.closest && target.closest('button, a, [tabindex]'))
        event.stopPropagation();
    });
    if (typeof this.config.mount === 'function') {
      this.unmount = this.config.mount(wrapper, {
        blockId: this.block && this.block.id,
        ref: this.data.ref,
        readOnly: this.readOnly,
      });
    }
    return wrapper;
  }

  /** @returns {{ ref: string }} Stored data: the reference only. */
  save() {
    return { ref: this.data.ref };
  }

  destroy() {
    const unmount = this.unmount;
    this.unmount = null;
    if (typeof unmount === 'function') unmount();
  }

  removed() {
    this.destroy();
  }
}

export default SyncedTool;

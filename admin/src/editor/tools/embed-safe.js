import Embed from '@editorjs/embed';
import { el } from './dom';

/**
 * Embed tool that survives stored blocks of a service it does not know (2.7.4, m11).
 *
 * @editorjs/embed 2.7.7 `render()` reads `Embed.services[data.service]` without a check, so a block
 * whose service is not configured (an older or newer plugin version, an import, the API) threw,
 * Editor.js logged "Block «embed» skipped because of plugins error" and the block disappeared from
 * the editor. This subclass shows a short note with the source URL instead and saves the stored data
 * unchanged, so the website keeps rendering it the way it did.
 */
export class SafeEmbed extends Embed {
  /**
   * @param {{ data: object, api: object, readOnly: boolean, config?: object }} params - Editor.js tool parameters.
   */
  constructor(params) {
    super(params);
    this.config = (params && params.config) || {};
    this.unknown = null;
  }

  /** @returns {boolean} The stored service is configured. */
  knowsService() {
    const service = this._data && this._data.service;
    return !service || Boolean(Embed.services && Embed.services[service]);
  }

  render() {
    if (this.knowsService()) {
      this.unknown = null;
      return super.render();
    }
    this.unknown = { ...this._data };
    const t =
      typeof this.config.t === 'function'
        ? this.config.t
        : (_id, fallback, values) => fallback.replace('{service}', values.service);
    const box = el('div', {
      className: 'mex-embed-unknown',
      attrs: { role: 'note', 'data-mutation-free': 'true' },
      children: [
        el('p', {
          className: 'mex-embed-unknown__title',
          text: t(
            'tools.embed.unknown',
            'This embed ({service}) is not available in this editor. The block is saved unchanged.',
            { service: String(this.unknown.service).slice(0, 40) }
          ),
        }),
        this.unknown.source
          ? el('p', { className: 'mex-embed-unknown__source', text: String(this.unknown.source) })
          : null,
      ],
    });
    this.element = box;
    return box;
  }

  save() {
    if (this.unknown) return { ...this.unknown };
    return super.save();
  }
}

export default SafeEmbed;

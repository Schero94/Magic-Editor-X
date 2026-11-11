import { ICONS } from './dom';
import { ALIGNMENTS, TEXT_VARIANTS, normalizeAlignment, normalizeTextVariant } from './logic.mjs';

/**
 * Block tunes: alignment (`alignmentTune`, data `{ alignment }`, same as
 * editorjs-text-alignment-blocktune) and text variant (`textVariant`, a
 * string, same as @editorjs/text-variant-tune). Both use the Editor.js
 * MenuConfig API and wrap the block content to apply a CSS class.
 */

const ALIGN_ICONS = {
  left: ICONS.alignLeft,
  center: ICONS.alignCenter,
  right: ICONS.alignRight,
  justify: ICONS.alignJustify,
};

export class AlignmentTune {
  static get isTune() {
    return true;
  }

  constructor({ data, config, block }) {
    this.config = config || {};
    this.block = block;
    const blockDefault = this.config.blocks && block ? this.config.blocks[block.name] : undefined;
    this.data = normalizeAlignment(data, blockDefault || this.config.default || 'left');
    this.wrapper = null;
  }

  t(id, fallback) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback) : fallback;
  }

  wrap(content) {
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add('mex-align');
    this.wrapper.appendChild(content);
    this.apply();
    return this.wrapper;
  }

  apply() {
    if (!this.wrapper) return;
    ALIGNMENTS.forEach((value) =>
      this.wrapper.classList.toggle(`mex-align--${value}`, this.data.alignment === value)
    );
  }

  render() {
    const labels = {
      left: this.t('tools.alignment.left', 'Align left'),
      center: this.t('tools.alignment.center', 'Align center'),
      right: this.t('tools.alignment.right', 'Align right'),
      justify: this.t('tools.alignment.justify', 'Justify'),
    };
    return ALIGNMENTS.map((value) => ({
      icon: ALIGN_ICONS[value],
      title: labels[value],
      toggle: 'mex-alignment',
      isActive: () => this.data.alignment === value,
      closeOnActivate: true,
      onActivate: () => {
        this.data = { alignment: value };
        this.apply();
        if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
      },
    }));
  }

  save() {
    return this.data;
  }
}

export class TextVariantTune {
  static get isTune() {
    return true;
  }

  constructor({ data, config, block }) {
    this.config = config || {};
    this.block = block;
    this.data = normalizeTextVariant(data);
    this.wrapper = null;
  }

  t(id, fallback) {
    return typeof this.config.t === 'function' ? this.config.t(id, fallback) : fallback;
  }

  wrap(content) {
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add('mex-variant');
    this.wrapper.appendChild(content);
    this.apply();
    return this.wrapper;
  }

  apply() {
    if (!this.wrapper) return;
    TEXT_VARIANTS.forEach((value) =>
      this.wrapper.classList.toggle(`mex-variant--${value}`, this.data === value)
    );
  }

  render() {
    const labels = {
      'call-out': this.t('tools.textVariant.callOut', 'Call-out'),
      citation: this.t('tools.textVariant.citation', 'Citation'),
      details: this.t('tools.textVariant.details', 'Details'),
    };
    return TEXT_VARIANTS.map((value) => ({
      icon: ICONS.variant,
      title: labels[value],
      isActive: () => this.data === value,
      closeOnActivate: true,
      onActivate: () => {
        this.data = this.data === value ? '' : value;
        this.apply();
        if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
      },
    }));
  }

  save() {
    return this.data;
  }
}

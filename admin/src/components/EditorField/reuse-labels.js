import { humanizeAttribute } from '../../../../shared/reuse.mjs';

/**
 * Plain-language names of block types for the "Insert from another entry"
 * preview (2.5), from the editor's own toolbox names (`tools.names.*`).
 */
const NAMES = {
  paragraph: ['tools.names.text', 'Text'],
  header: ['tools.names.heading', 'Heading'],
  checklist: ['tools.names.checklist', 'Checklist'],
  quote: ['tools.names.quote', 'Quote'],
  warning: ['tools.names.warning', 'Warning'],
  alert: ['tools.names.alert', 'Alert'],
  toggle: ['tools.names.toggle', 'Toggle'],
  code: ['tools.names.code', 'Code'],
  codeFlask: ['tools.names.codeHighlighted', 'Code (highlighted)'],
  delimiter: ['tools.names.delimiter', 'Delimiter'],
  toc: ['tools.names.toc', 'Table of contents'],
  table: ['tools.names.table', 'Table'],
  raw: ['tools.names.raw', 'Raw HTML'],
  image: ['tools.names.image', 'Image'],
  simpleImage: ['tools.names.simpleImage', 'Image by URL'],
  gallery: ['tools.names.gallery', 'Gallery'],
  video: ['tools.names.video', 'Video'],
  audio: ['tools.names.audio', 'Audio'],
  linkTool: ['tools.names.linkPreview', 'Link preview'],
  attaches: ['tools.names.attachment', 'Attachment'],
  personality: ['tools.names.person', 'Person'],
  button: ['tools.names.button', 'Button'],
  math: ['tools.names.math', 'Math'],
  synced: ['editor.synced.kind', 'Synced block'],
  embed: ['editor.reuse.embed', 'Embedded content'],
};

/**
 * Name of a block's type.
 * @param {Function} t - Translator.
 * @param {{ type: string, data?: object }} block - Block.
 * @param {{ customBlocks?: Array<{ name: string, label?: string }>, codeBlocks?: Array<{ name: string, title?: string }> }} [known] - Settings and code-registered blocks.
 * @returns {string} Name.
 */
export const blockTypeLabel = (t, block, known = {}) => {
  const type = block && typeof block.type === 'string' ? block.type : '';
  if (type === 'list') {
    const ordered = block.data && block.data.style === 'ordered';
    return ordered
      ? t('tools.names.orderedList', 'Numbered list')
      : t('tools.names.unorderedList', 'Bulleted list');
  }
  if (NAMES[type]) return t(NAMES[type][0], NAMES[type][1]);
  const custom = (known.customBlocks || []).find((entry) => entry && entry.name === type);
  if (custom && custom.label) return String(custom.label);
  const code = (known.codeBlocks || []).find((entry) => entry && entry.name === type);
  if (code && code.title) return String(code.title);
  return humanizeAttribute(type) || type;
};

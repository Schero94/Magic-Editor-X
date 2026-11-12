/**
 * Custom block data that a 2.2 site stores under names 2.3 gave to built-in
 * blocks (`toc`, `gallery`, `video`, `audio`, `synced`): simple custom blocks
 * (`{ content, <fields>, blockType: 'simple', blockName }`, fields named like
 * built-in keys on purpose) and embedded-entry blocks
 * (`{ entry, contentType, displayMode }`). The values are what 2.2 stored
 * (already cleaned by its generic policy). Synthetic data only.
 */
export const LEGACY_BLOCKS = Object.freeze([
  {
    id: 'lgtoc1',
    type: 'toc',
    data: {
      content: 'Inhalt mit <b>fett</b> &amp; <a href="https://www.example.test/a?b=1&amp;c=2">Link</a>',
      title: 'Contents &amp; more',
      minLevel: '2',
      maxLevel: 9,
      style: 'fancy',
      blockType: 'simple',
      blockName: 'toc',
    },
  },
  {
    id: 'lgtoc2',
    type: 'toc',
    data: {
      entry: { id: 7, documentId: 'abc123def456', title: 'Linked article' },
      contentType: 'api::article.article',
      displayMode: 'card',
    },
  },
  {
    id: 'lggal1',
    type: 'gallery',
    data: {
      content: '<i>Holiday</i>',
      images: 'Hero image',
      layout: 'masonry',
      columns: '4',
      caption: 'Caption &amp; credit',
      blockType: 'simple',
      blockName: 'gallery',
    },
  },
  {
    id: 'lgvid1',
    type: 'video',
    data: {
      content: '',
      file: 'https://cdn.example.test/v.mp4',
      title: 'Clip',
      loop: true,
      blockType: 'simple',
      blockName: 'video',
    },
  },
  {
    id: 'lgvid2',
    type: 'video',
    data: {
      entry: { id: 9, documentId: 'zyx987wvu654', title: 'Video page' },
      contentType: 'api::article.article',
      displayMode: 'inline',
    },
  },
  {
    id: 'lgaud1',
    type: 'audio',
    data: {
      content: 'Listen',
      file: 'https://cdn.example.test/a.mp3',
      tracks: 'none',
      blockType: 'simple',
      blockName: 'audio',
    },
  },
  {
    id: 'lgsyn1',
    type: 'synced',
    data: { content: 'Shared note', ref: 'Any text', blockType: 'simple', blockName: 'synced' },
  },
]);

/** A whole field value: legacy custom blocks between ordinary blocks. */
export const legacyDocument = () => ({
  time: 1700000000000,
  version: '2.31.7',
  blocks: [
    { id: 'lghead', type: 'header', data: { text: 'Heading', level: 2 } },
    ...LEGACY_BLOCKS.map((block) => JSON.parse(JSON.stringify(block))),
    { id: 'lgpara', type: 'paragraph', data: { text: 'After' } },
  ],
});

import { assetToFile, isAudioAsset, isImageAsset, isVideoAsset } from './tools/media-logic.mjs';

/**
 * Files dropped onto a field (2.5): Strapi's Media Library drop zone
 * (`media-library-file-drop-zone`, Strapi 5.61+) uploads them and hands each
 * uploaded asset back; this module decides which block it becomes.
 * Pure (no DOM, no Editor.js).
 */

/**
 * Image block data of a Media Library asset (same shape as a picked image).
 * @param {object} asset - Uploaded or picked asset.
 * @returns {object} Image block data.
 */
export const imageBlockData = (asset) => ({
  file: {
    url: asset.url,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    alt: asset.alternativeText || asset.name || '',
    formats: asset.formats || undefined,
    id: asset.id,
    documentId: asset.documentId,
  },
  caption: asset.caption || '',
  withBorder: false,
  withBackground: false,
  stretched: false,
});

/**
 * Media Library types the field takes by drop (`allowedTypes` of the drop zone).
 * Images need the image block; videos and audio files their blocks and Media
 * Library read access (like the video and audio tools).
 * @param {{ image: boolean, video: boolean, audio: boolean }} allowed - Blocks the field allows and the admin may fill.
 * @returns {Array<'images'|'videos'|'audios'>} Types.
 */
export const dropTypesFor = (allowed) => [
  ...(allowed.image ? ['images'] : []),
  ...(allowed.video ? ['videos'] : []),
  ...(allowed.audio ? ['audios'] : []),
];

/**
 * The block an uploaded asset becomes, or null when the field does not take it.
 * @param {object} asset - Uploaded asset (`url`, `mime`, `id`, ...).
 * @param {{ image: boolean, video: boolean, audio: boolean }} allowed - Allowed blocks.
 * @returns {{ type: 'image'|'video'|'audio', data: object }|null} Block.
 */
export const droppedBlock = (asset, allowed) => {
  if (!asset || typeof asset !== 'object' || typeof asset.url !== 'string' || !asset.url) return null;
  if (isImageAsset(asset) && allowed.image) return { type: 'image', data: imageBlockData(asset) };
  if (isVideoAsset(asset) && allowed.video)
    return {
      type: 'video',
      data: { file: assetToFile(asset), title: '', caption: '', loop: false, muted: false, tracks: [] },
    };
  if (isAudioAsset(asset) && allowed.audio)
    return {
      type: 'audio',
      data: { file: assetToFile(asset), title: '', caption: '', loop: false, tracks: [] },
    };
  return null;
};

/**
 * Where dropped blocks go: after the block under the pointer, or in its place
 * when it is an empty paragraph; at the end when the drop was not on a block.
 * @param {{ index: number, empty: boolean }|null} target - Block under the pointer.
 * @param {number} count - Blocks in the editor.
 * @returns {{ index: number, replace: boolean }} First insert position and whether the empty block is replaced.
 */
export const dropPosition = (target, count) => {
  if (!target || !Number.isInteger(target.index) || target.index < 0 || target.index >= count)
    return { index: count, replace: false };
  return target.empty ? { index: target.index, replace: true } : { index: target.index + 1, replace: false };
};

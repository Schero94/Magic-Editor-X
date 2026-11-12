/** Types of `magic-editor-x/vue` (Vue 3.3+). */

import type { Component, DefineComponent, VNodeChild } from 'vue';
import type { RenderBlock, RenderNode, RenderOptions } from './render.js';

/** Helpers handed to a block slot or component. */
export interface VueBlockHelpers {
  /** Plain text of stored inline HTML. */
  text(html: unknown): string;
  /** Validated URL or ''. */
  url(value: unknown, schemes?: string[]): string;
  /** Vnodes of stored inline HTML (strict parser, links resolved). */
  inline(html: unknown): VNodeChild[];
  /** Vnodes of child blocks (toggle content), with your slots/components applied. */
  renderBlocks(blocks: RenderBlock[]): VNodeChild[];
}

/** Props of a `block-<type>` scoped slot. */
export interface BlockSlotProps {
  block: RenderBlock;
  helpers: VueBlockHelpers;
  /** The default output of the block. */
  children: VNodeChild[];
}

/**
 * Renders stored content. Overrides: scoped slots `block-<type>` or the
 * `components` prop (components declare the props `block` and `helpers` and
 * get the default output in their default slot).
 */
export declare const MagicEditorXContent: DefineComponent<{
  /** Stored field value (object, JSON string, 1.x shapes). null renders nothing. */
  value?: unknown;
  /** Render options (links, media, embedHosts, imageSizes, code, rawHtml + sanitizeRaw, overrides). */
  options?: RenderOptions;
  /** Per-type components (declare the props `block` and `helpers`). */
  components?: Record<string, Component>;
}>;
/** Vnodes of a `renderTree` result. */
export declare function treeToVue(nodes: RenderNode[]): VNodeChild[];
export default MagicEditorXContent;

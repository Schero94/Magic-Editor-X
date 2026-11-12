/** Types of `magic-editor-x/react` (React 18 and 19; needs `@types/react` for TypeScript). */

import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { RenderBlock, RenderNode, RenderOptions } from './render.js';

/** Helpers handed to a block component. */
export interface ReactBlockHelpers {
  /** Plain text of stored inline HTML. */
  text(html: unknown): string;
  /** Validated URL or ''. */
  url(value: unknown, schemes?: string[]): string;
  /** React nodes of stored inline HTML (strict parser, links resolved). */
  inline(html: unknown): ReactNode[];
  /** React nodes of child blocks (toggle content), with your components applied. */
  renderBlocks(blocks: RenderBlock[]): ReactNode[];
}

/** Props of a block component in `components`. */
export interface BlockComponentProps {
  block: RenderBlock;
  helpers: ReactBlockHelpers;
  /** The default output of the block. */
  children: ReactNode[];
}

export interface MagicEditorXContentProps {
  /** Stored field value (object, JSON string, 1.x shapes). null renders nothing. */
  value: unknown;
  /** Render options (links, media, embedHosts, imageSizes, code, rawHtml + sanitizeRaw, overrides). */
  options?: RenderOptions;
  /** Per-type components; return null to hide a block. */
  components?: Record<string, ComponentType<BlockComponentProps>>;
}

/** Renders stored content as React elements (a fragment, no wrapper element). */
export declare function MagicEditorXContent(props: MagicEditorXContentProps): ReactElement;
/** React nodes of a `renderTree` result. */
export declare function treeToReact(nodes: RenderNode[]): ReactNode[];
export default MagicEditorXContent;

/** Types of `magic-editor-x/render`. */

import type { ImageFile, MagicEditorXTunes } from './index.js';

/** Reference of an internal link (`<a data-mex-uid data-mex-document-id data-mex-locale>`). */
export interface InternalLinkRef {
  uid: string;
  documentId: string;
  locale: string | null;
  /** The href stored when the link was inserted (fallback). */
  href: string | null;
}

/** Block handed to an override. `data` is cleaned for built-in types and as stored for custom blocks. */
export interface RenderBlock {
  id: string;
  type: string;
  data: Record<string, any>;
  tunes?: MagicEditorXTunes;
  /** Toggle content. */
  children: RenderBlock[];
}

export interface HtmlHelpers {
  /** Escapes text for HTML. */
  escape(text: unknown): string;
  /** Safe HTML of stored inline HTML (links resolved with `options.links`). */
  inline(html: unknown): string;
  /** Plain text of stored inline HTML. */
  text(html: unknown): string;
  /** Validated URL or ''. */
  url(value: unknown, schemes?: string[]): string;
  /** Renders toggle children. */
  renderChildren(blocks: RenderBlock[]): string;
}

export interface RenderOptions {
  /**
   * Per-type output. Return a string to replace the default output of that
   * block, or undefined to keep it. HTML overrides are responsible for
   * escaping what they output (use the helpers).
   */
  overrides?: Record<
    string,
    (block: RenderBlock, helpers: HtmlHelpers & Record<string, any>) => string | undefined
  >;
  /**
   * Resolves internal links at render time, so links follow slug changes.
   * Return a URL to use it, `false` to render the link text without a link,
   * or null/undefined to keep the stored href. The result is validated.
   */
  links?: (ref: InternalLinkRef) => string | false | null | undefined;
  /** Refreshes a Media Library file (url, alt, formats) by `file.id`/`documentId`; the result is validated. */
  media?: (file: ImageFile, block: { id: string; type: string }) => ImageFile | null | undefined;
  /** Raw HTML blocks are omitted unless 'allow' and `sanitizeRaw` are both given. */
  rawHtml?: 'omit' | 'allow';
  /** Your HTML sanitiser for raw HTML blocks (for example sanitize-html or DOMPurify). */
  sanitizeRaw?: (html: string) => string;
  /** Hosts allowed in embed iframes (exact match, https only). Defaults to `DEFAULT_EMBED_HOSTS`. */
  embedHosts?: string[];
  /** `sizes` attribute for images with Media Library formats. Default '100vw'. */
  imageSizes?: string;
}

/** Renders a stored value to HTML. Empty or invalid input gives ''. */
export function renderHtml(value: unknown, options?: RenderOptions): string;
/** Renders a stored value to plain text. */
export function renderText(value: unknown, options?: RenderOptions): string;
/** Renders a stored value to Markdown (CommonMark + GFM tables and task lists). */
export function renderMarkdown(value: unknown, options?: RenderOptions): string;
export function escapeHtml(text: unknown): string;
export function escapeMarkdown(text: string): string;
export function inlineToHtml(html: unknown, options?: Pick<RenderOptions, 'links'>): string;
export function inlineToText(html: unknown): string;
export const DEFAULT_EMBED_HOSTS: readonly string[];

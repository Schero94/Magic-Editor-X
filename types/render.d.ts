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

/** Text node of the render tree (escaped on output). */
export interface RenderTextNode {
  type: 'text';
  value: string;
}

/** Element node of the render tree. Attribute names are lower case; `true` is a boolean attribute. */
export interface RenderElementNode {
  type: 'element';
  tag: string;
  attrs: Record<string, string | true>;
  children: RenderNode[];
  /**
   * Inline style, only set by the renderer for `object-position` of images
   * with a focal point when `focalPoint: 'style'` is on. Overrides cannot set it.
   */
  style?: { 'object-position'?: string };
}

/**
 * HTML that went through your `sanitizeRaw` (raw blocks, string overrides in a
 * tree). Only with `rawHtml: 'allow'` and `sanitizeRaw`; always the only child
 * of its element.
 */
export interface RenderRawNode {
  type: 'raw';
  html: string;
}

/** Framework-neutral render node. */
export type RenderNode = RenderElementNode | RenderTextNode | RenderRawNode;

/** What an override may return: a string (HTML), nodes, or undefined/null for the default output. */
export type OverrideResult = string | RenderNode | Array<RenderNode | string> | null | undefined;

export interface HtmlHelpers {
  /** Escapes text for HTML. */
  escape(text: unknown): string;
  /** Safe HTML of stored inline HTML (links resolved with `options.links`). */
  inline(html: unknown): string;
  /** Plain text of stored inline HTML. */
  text(html: unknown): string;
  /** Validated URL or ''. */
  url(value: unknown, schemes?: string[]): string;
  /** Renders toggle children to HTML. */
  renderChildren(blocks: RenderBlock[]): string;
  /** Element node (attributes and URLs are validated when the override returns it). */
  h(tag: string, attrs?: Record<string, unknown>, children?: unknown): RenderElementNode;
  /** Text node. */
  textNode(value: unknown): RenderTextNode;
  /** Nodes of stored inline HTML (strict parser, links resolved). */
  inlineNodes(html: unknown): RenderNode[];
  /** Nodes of toggle children (keeps per-block components in React/Vue). */
  childNodes(blocks: RenderBlock[]): RenderNode[];
}

/** Code block options (HTML, React, Vue; Markdown and text keep plain fences/text). */
export interface CodeRenderOptions {
  /**
   * Line numbers: `true` for every code block, `'block'` only for codeFlask
   * blocks saved with line numbers on. Adds `mex-code-lines` to `<pre>` and
   * wraps each line in `<span class="mex-code-line">`; number them with CSS
   * counters. Default false.
   */
  lineNumbers?: boolean | 'block';
  /**
   * Copy button: wraps the block in `<div class="mex-code-block"
   * data-mex-code="copy">` with `<button type="button" class="mex-code-copy"
   * data-mex-copy="code">` and a `role="status"` live region. React and Vue
   * wire it; for plain HTML call `enhanceCodeBlocks()`. Labels: 1 to 80
   * characters.
   */
  copyButton?: boolean | { label?: string; copiedLabel?: string; failedLabel?: string };
}

export interface RenderOptions {
  /**
   * Per-type output. Return nodes (`helpers.h`, `helpers.inlineNodes`; validated)
   * or a string to replace the default output of that block, or undefined to
   * keep it. A string is HTML: `renderHtml` writes it as it is (the override
   * escapes what it outputs, use the helpers); `renderTree` and the React/Vue
   * components use it only with `rawHtml: 'allow'` + `sanitizeRaw` (as the raw
   * child of `<div class="mex-override">`), otherwise the default output.
   * `renderText`/`renderMarkdown` overrides return text/Markdown.
   */
  overrides?: Record<
    string,
    (block: RenderBlock, helpers: HtmlHelpers & Record<string, any>) => OverrideResult
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
  /** Code block line numbers and copy button. */
  code?: CodeRenderOptions;
  /**
   * Focal point of images (image blocks and gallery images with `focalPoint`).
   * `'data'` (default, CSP friendly): `data-mex-focal-x`/`data-mex-focal-y`
   * (0..1) on `<img>`. `'style'`: also `style="object-position:X% Y%"`
   * (React/Vue: the `style` prop), for pages whose CSP allows inline styles.
   */
  focalPoint?: 'data' | 'style';
}

/** Renders a stored value to HTML. Empty or invalid input gives ''. */
export function renderHtml(value: unknown, options?: RenderOptions): string;
/** Renders a stored value to framework-neutral nodes (blocks separated by `\n` text nodes). */
export function renderTree(value: unknown, options?: RenderOptions): RenderNode[];
/** Serialises render nodes to HTML (text and attributes escaped, raw nodes as they are). */
export function serializeNodes(nodes: ReadonlyArray<RenderNode>): string;
/**
 * Browser helper for plain HTML: wires the code copy buttons below `root`
 * (default `document`) to the Clipboard API. Returns a cleanup function; does
 * nothing without a DOM.
 */
export function enhanceCodeBlocks(root?: ParentNode): () => void;
/** Copies text with the Clipboard API; resolves false when unavailable or denied. */
export function copyText(text: string): Promise<boolean>;
/** Renders a stored value to plain text. */
export function renderText(value: unknown, options?: RenderOptions): string;
/** Renders a stored value to Markdown (CommonMark + GFM tables and task lists). */
export function renderMarkdown(value: unknown, options?: RenderOptions): string;
export function escapeHtml(text: unknown): string;
export function escapeMarkdown(text: string): string;
export function inlineToHtml(html: unknown, options?: Pick<RenderOptions, 'links'>): string;
export function inlineToText(html: unknown): string;
export const DEFAULT_EMBED_HOSTS: readonly string[];

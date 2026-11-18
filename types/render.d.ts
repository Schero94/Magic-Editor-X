/** Types of `magic-editor-x/render`. */

import type { ImageFile, MagicEditorXTunes } from './index.js';

/** Reference of an internal link (`<a data-mex-uid data-mex-document-id data-mex-locale>`). */
export interface InternalLinkRef {
  uid: string;
  documentId: string;
  locale: string | null;
  /** The href stored when the link was inserted (fallback). */
  href: string | null;
  /** Present (true) for a mention (`data-mex-mention="true"`, an inline entry reference rendered with class `mex-mention`). */
  mention?: true;
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
  /**
   * Heading anchors `id="mex-h-<blockId>"` (stable across text edits and
   * locales): `true` on every heading, `false` never (table-of-contents entries
   * are then plain text), default only when the value contains a `toc` block.
   * Markdown has no heading ids: its table-of-contents entries link to the
   * GitHub-style slug of the heading text (`#über-uns`, repeats `-1`, `-2`),
   * which Markdown renderers such as GitHub, markdown-it-anchor and rehype-slug assign.
   */
  headingIds?: boolean;
  /** Table of contents: accessible name of a `toc` block without a title (1 to 80 characters, default 'Table of contents'). */
  toc?: { label?: string };
  /**
   * Code-registered block definitions (`defineBlock` from `magic-editor-x/blocks`):
   * blocks of these types are cleaned by their schema and rendered with their
   * `render`/`text`/`markdown`. Without them such blocks get the neutral
   * rendering. Pass a stable array (compiled once per array). `overrides`
   * still win.
   */
  blocks?: ReadonlyArray<import('./blocks.js').BlockDefinition<any>>;
  /**
   * Component blocks (2.5): renderers per component uid (`category.name`) for
   * `component` blocks, used like `overrides` (nodes; a string only under the
   * override rules) in `renderHtml`, `renderTree` and the React/Vue
   * components. The block's `data` is `{ uid, values }`. Without an entry a
   * component block renders nothing (text and Markdown too; use
   * `overrides.component` there). `overrides.component` wins over this map.
   */
  componentBlocks?: Record<
    string,
    (block: RenderBlock, helpers: HtmlHelpers & Record<string, any>) => OverrideResult
  >;
  /**
   * Synced blocks (2.3): the sources of `synced` reference blocks, as a map
   * `{ [ref]: document | blocks }` (object or Map) or a function
   * `(ref) => document | blocks | null`. A reference is replaced by a copy of
   * its source (nested references inside a source are dropped). Without this
   * option, or for an unknown reference, a synced block renders nothing.
   * Content API output (`?mex=`) and GraphQL `…Rendered`/`…Resolved` already
   * come expanded.
   */
  synced?: SyncedSources;
  /**
   * Math (2.4): renders TeX of math blocks and inline math. Return MathML
   * (string) or render nodes; the result is parsed through a strict MathML
   * allow-list (MathML Core elements, no href, style, id or event
   * attributes). `renderMath` from `magic-editor-x/math` (Temml) fits.
   * Without it, or when it returns nothing usable, the TeX source is written
   * between `\\( \\)` / `\\[ \\]` in `<span|div class="mex-math" data-mex-math>`
   * for client-side auto-render. Text output is the TeX source; Markdown
   * `$…$` / `$$…$$`.
   */
  math?: MathRenderer;
  /**
   * Footnotes (2.4): numbered references `<sup class="mex-footnote-ref"><a href="#<prefix>fn-<id>">n</a></sup>`
   * and a list `<section class="mex-footnotes">` after the content. `label`
   * names the list (default 'Footnotes'), `backLabel` the back links
   * (`{n}` = number, default 'Back to reference {n}'), `prefix` starts every id
   * (default 'mex-'; use one per field when several fields render on a page).
   * Text output: `[n]` and a list; Markdown: GFM `[^n]` footnotes.
   */
  footnotes?: { label?: string; backLabel?: string; prefix?: string };
  /**
   * Inline annotations (2.5, `defineInlineAnnotation` from `magic-editor-x/blocks`):
   * `<span data-mex-annotation="name">` is rendered with the definition's
   * `render` (one validated wrapper element around the text). These
   * definitions replace the bundle's registry for that call; the built-in
   * `abbreviation` (`<abbr title>`) is always known. Unknown annotations get
   * `<span class="mex-annotation mex-annotation-<name>" data-mex-annotation …>`.
   * Pass a stable array. Text and Markdown output keep the text only.
   */
  annotations?: ReadonlyArray<import('./blocks.js').InlineAnnotationDefinition>;
  /**
   * Value of an annotation for its `render` (`resolved`), e.g. a glossary
   * definition looked up by the caller. A string (max 2000 characters) or a
   * plain object; anything else, or a throw, is ignored. Content API output
   * (`?mex=`) and GraphQL `…Rendered` pass the results of the definitions'
   * server-side `resolve`.
   */
  resolveAnnotation?: (annotation: {
    name: string;
    attrs: Record<string, string>;
    text: string;
  }) => string | Record<string, unknown> | null | undefined;
  /**
   * Block source attributes (2.6, off by default): every top-level block
   * element gets `data-mex-block-id="<Editor.js block id>"` (ids matching
   * `^[A-Za-z0-9_-]{1,64}$` only). With `field` (a Content Manager field path
   * such as `body` or `sections.2.body`) also `data-mex-field-path`, and with
   * `strapiSource` also `data-strapi-source` for Strapi's preview highlighting
   * (`documentId=…&type=json&model=…[&kind][&locale]&fieldPath=<field>`, no
   * `path` key). Invalid parts are left out. Raw HTML from string overrides
   * and custom React/Vue components that drop the default output carry no
   * attributes.
   */
  blockIds?: boolean | BlockIdOptions;
}

/** `blockIds` render option (2.6). */
export interface BlockIdOptions {
  /** Field path (`data-mex-field-path`). */
  field?: string;
  /** Entry of the field, for `data-strapi-source` (needs `field`). */
  strapiSource?: StrapiSourceEntry;
}

/** Entry metadata for `data-strapi-source` (2.6). */
export interface StrapiSourceEntry {
  documentId: string;
  /** Content type uid, e.g. `api::article.article`. */
  model: string;
  kind?: 'collectionType' | 'singleType';
  locale?: string | null;
}

/** Click-to-locate request (2.6). */
export interface LocateMessage {
  type: 'magic-editor-x:locate';
  field: string;
  blockId: string | null;
}

/** Renders TeX: MathML markup or render nodes; null/undefined for the fallback. */
export type MathRenderer = (
  tex: string,
  options: { display: boolean }
) => string | RenderNode | ReadonlyArray<RenderNode> | null | undefined;

/** A synced block source: an Editor.js document or its block array. */
export type SyncedSource = { blocks: ReadonlyArray<unknown> } | ReadonlyArray<unknown>;
/** Sources of synced blocks by reference (the source's documentId). */
export type SyncedSources =
  | Readonly<Record<string, SyncedSource>>
  | ReadonlyMap<string, SyncedSource>
  | ((ref: string) => SyncedSource | null | undefined);

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
/** True for an id the renderer writes into `data-mex-block-id` (2.6). */
export function isBlockId(id: unknown): id is string;
/** True for a field path the renderer writes into `data-mex-field-path` (2.6). */
export function isFieldPath(path: unknown): path is string;
/** `data-strapi-source` value of a Magic Editor X field, or null for invalid input (2.6). */
export function strapiSourceValue(source: StrapiSourceEntry, field: string): string | null;
/** `type` of the click-to-locate message (2.6). */
export const LOCATE_MESSAGE_TYPE: 'magic-editor-x:locate';
/** Message a front end in Strapi's preview iframe posts to the admin window, or null for invalid input (2.6). */
export function locateMessage(field: string, blockId?: string | null): LocateMessage | null;
/**
 * Content Manager edit view URL that opens the entry and shows the block
 * (`?mexField=<path>&mexBlock=<id>`), or null for invalid input (2.6).
 */
export function editViewUrl(input: {
  adminUrl: string;
  model: string;
  kind?: 'collectionType' | 'singleType';
  documentId?: string;
  locale?: string | null;
  field: string;
  blockId?: string | null;
}): string | null;
/** `type` of the answer a mounted field posts back to the preview frame (2.6). */
export const LOCATED_MESSAGE_TYPE: 'magic-editor-x:located';
/**
 * From a front end inside Strapi's preview iframe: asks the admin to show the
 * block. Resolves true when a mounted field (Live Preview side editor)
 * answered within `timeoutMs` (default 400), false otherwise (2.6).
 */
export function requestLocate(input: {
  field: string;
  blockId?: string | null;
  adminOrigin: string;
  timeoutMs?: number;
}): Promise<boolean>;

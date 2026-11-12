/**
 * Types of a stored Magic Editor X field value (`magic-editor-x/types`).
 *
 * They match the JSON Schema `magic-editor-x/schema` and the server's
 * sanitising policy. Strings marked `InlineHtml` contain inline HTML limited to
 * b, strong, i, em, u, s, mark, code, a, br, span, sub and sup; render them
 * with `magic-editor-x/render` or your own sanitiser, never as trusted HTML.
 */

/** Inline HTML (see the file header). */
export type InlineHtml = string;
/** http(s), mailto, tel or site-relative URL; '' when the stored URL was not allowed. */
export type Url = string;

export interface MagicEditorXTunes {
  alignmentTune?: { alignment: 'left' | 'center' | 'right' | 'justify' };
  textVariant?: '' | 'call-out' | 'citation' | 'details';
  indentTune?: { indentLevel: number };
}

export type ListCounterType = 'numeric' | 'lower-roman' | 'upper-roman' | 'lower-alpha' | 'upper-alpha';

export interface ListItem {
  content: InlineHtml;
  meta?: { checked?: boolean; start?: number; counterType?: ListCounterType };
  items: Array<ListItem | InlineHtml>;
}

export interface ParagraphData {
  text: InlineHtml;
}
export interface HeaderData {
  text: InlineHtml;
  level: 1 | 2 | 3 | 4 | 5 | 6;
}
export interface QuoteData {
  text: InlineHtml;
  caption: InlineHtml;
  alignment: 'left' | 'center';
}
export interface ListData {
  style: 'ordered' | 'unordered' | 'checklist';
  items: Array<ListItem | InlineHtml>;
  meta?: { start?: number; counterType?: ListCounterType };
}
export interface ChecklistData {
  items: Array<{ text: InlineHtml; checked: boolean }>;
}
export interface WarningData {
  title: InlineHtml;
  message: InlineHtml;
}
export interface AlertData {
  type: 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'danger' | 'light' | 'dark';
  align: 'left' | 'center' | 'right';
  message: InlineHtml;
}
export interface ToggleData {
  text: InlineHtml;
  status: 'open' | 'closed';
  fk?: string;
  /** Number of blocks right after the toggle that form its content. */
  items: number;
}
export interface CodeData {
  code: string;
}
export interface CodeFlaskData {
  code: string;
  language: string;
  showlinenumbers?: boolean;
}
export interface RawData {
  /** Raw HTML, sanitised or emptied according to the server's `rawHtml` option. */
  html: string;
}
export interface TableData {
  withHeadings: boolean;
  stretched: boolean;
  content: InlineHtml[][];
}
export interface MediaFormat {
  url: Url;
  width?: number;
  height?: number;
  [key: string]: unknown;
}
export interface ImageFile {
  url: Url;
  /** Media Library file id. */
  id?: number | string;
  documentId?: string;
  alt?: string;
  mime?: string;
  name?: string;
  hash?: string;
  ext?: string;
  width?: number;
  height?: number;
  size?: number;
  formats?: Record<string, MediaFormat>;
}
export interface ImageData {
  file: ImageFile;
  caption: InlineHtml;
  withBorder: boolean;
  withBackground: boolean;
  stretched: boolean;
  /** True when the image is decorative (rendered with an empty alt). */
  decorative?: boolean;
}
export interface SimpleImageData {
  url: Url;
  caption: InlineHtml;
  withBorder: boolean;
  withBackground: boolean;
  stretched: boolean;
  /** Alternative text. */
  alt?: string;
  /** True when the image is decorative (rendered with an empty alt). */
  decorative?: boolean;
}
export interface LinkToolData {
  link: Url;
  meta: { title: string; description: string; site_name?: string; image?: { url: Url } };
}
export interface AttachesData {
  file: { url: Url; name?: string; extension?: string; size?: number; title?: string };
  title: string;
}
export interface EmbedData {
  service: string;
  source: Url;
  embed: Url;
  width?: number;
  height?: number;
  caption: InlineHtml;
}
export interface PersonalityData {
  name: string;
  description: string;
  link: Url;
  photo: Url;
}
export interface ButtonData {
  text: string;
  link: Url;
  style: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  openInNewTab: boolean;
}
export type DelimiterData = Record<string, never>;
/** Table of contents: entries are built from the headings when the content is rendered. */
export interface TocData {
  /** Plain-text title ('' for none). */
  title: string;
  /** Lowest heading level listed (1 to 6, at most `maxLevel`). */
  minLevel: number;
  /** Highest heading level listed (1 to 6). */
  maxLevel: number;
  style: 'ordered' | 'unordered';
}

/** Data per built-in block type. */
export interface BlockDataMap {
  paragraph: ParagraphData;
  header: HeaderData;
  quote: QuoteData;
  list: ListData;
  checklist: ChecklistData;
  warning: WarningData;
  alert: AlertData;
  toggle: ToggleData;
  code: CodeData;
  codeFlask: CodeFlaskData;
  raw: RawData;
  table: TableData;
  image: ImageData;
  simpleImage: SimpleImageData;
  linkTool: LinkToolData;
  attaches: AttachesData;
  embed: EmbedData;
  personality: PersonalityData;
  button: ButtonData;
  delimiter: DelimiterData;
  toc: TocData;
}

export type BuiltInBlockType = keyof BlockDataMap;

/** A built-in block, discriminated by `type`. */
export type BuiltInBlock = {
  [T in BuiltInBlockType]: { id: string; type: T; data: BlockDataMap[T]; tunes?: MagicEditorXTunes };
}[BuiltInBlockType];

/** A custom block defined in Settings > Magic Editor X > Custom blocks. */
export interface CustomBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: MagicEditorXTunes;
}

export type MagicEditorXBlock = BuiltInBlock | CustomBlock;

/** Stored value of a Magic Editor X field (`null` when empty). */
export interface MagicEditorXData {
  time: number;
  blocks: MagicEditorXBlock[];
  version: string;
}

export type MagicEditorXValue = MagicEditorXData | null;

export type {
  RenderOptions,
  InternalLinkRef,
  RenderBlock,
  HtmlHelpers,
  RenderNode,
  RenderElementNode,
  RenderTextNode,
  RenderRawNode,
  CodeRenderOptions,
  OverrideResult,
  renderHtml,
  renderTree,
  renderText,
  renderMarkdown,
} from './render.js';

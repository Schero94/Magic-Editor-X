/**
 * Custom block SDK (`magic-editor-x/blocks`): one definition per block type
 * for the server, the admin editor tool and the renderers.
 */

import type { HtmlHelpers, RenderNode, RenderBlock } from './render.js';

export type BlockFieldType = 'text' | 'inline' | 'url' | 'enum' | 'number' | 'boolean' | 'array' | 'object';

interface FieldBase {
  /** Human-readable name (JSON Schema `title`, at most 100 characters). */
  label?: string;
}
/** Plain text, cut to `max` (default 1000, at most 100000). Rendering escapes it. */
export interface TextField extends FieldBase {
  type: 'text';
  max?: number;
  multiline?: boolean;
  default?: string;
}
/** Inline HTML through the shared inline policy (input cut to `max`, default 10000). */
export interface InlineField extends FieldBase {
  type: 'inline';
  max?: number;
  default?: string;
}
/** URL checked with `sanitizeUrl` (`schemes` default http/https, site-relative allowed unless `relative: false`); '' when not allowed. */
export interface UrlField extends FieldBase {
  type: 'url';
  schemes?: Array<'http' | 'https' | 'mailto' | 'tel'>;
  relative?: boolean;
}
/** One of `values` (1 to 100 strings); invalid values become `default` (first value). */
export interface EnumField<V extends string = string> extends FieldBase {
  type: 'enum';
  values: readonly V[];
  default?: V;
}
/** Finite number in `min..max`; invalid values become `default` (the key is omitted without one). */
export interface NumberField extends FieldBase {
  type: 'number';
  min?: number;
  max?: number;
  integer?: boolean;
  default?: number;
}
export interface BooleanField extends FieldBase {
  type: 'boolean';
  default?: boolean;
}
/** At most `max` items (default 50, at most 500); items of another type are dropped. */
export interface ArrayField extends FieldBase {
  type: 'array';
  items: BlockField;
  max?: number;
}
export interface ObjectField extends FieldBase {
  type: 'object';
  fields: BlockSchema;
}
export type BlockField =
  TextField | InlineField | UrlField | EnumField | NumberField | BooleanField | ArrayField | ObjectField;

/** Field descriptors by key (1 to 50 keys matching `/^[A-Za-z][A-Za-z0-9_]{0,63}$/`, nesting at most 4 levels). */
export type BlockSchema = Record<string, BlockField>;

/** Stored value type of one field. */
export type FieldValue<F> =
  F extends EnumField<infer V>
    ? V
    : F extends TextField | InlineField | UrlField
      ? string
      : F extends NumberField
        ? number
        : F extends BooleanField
          ? boolean
          : F extends ArrayField
            ? Array<FieldValue<F['items']>>
            : F extends ObjectField
              ? BlockData<F['fields']>
              : unknown;

/** Stored `data` of a block with this schema (numbers without a default may be missing). */
export type BlockData<S extends BlockSchema> = { [K in keyof S]: FieldValue<S[K]> };

export interface BlockTextHelpers {
  /** Plain text of inline HTML. */
  text(html: unknown): string;
}
export interface BlockMarkdownHelpers extends BlockTextHelpers {
  /** Escapes Markdown punctuation. */
  escape(text: unknown): string;
  /** Markdown of inline HTML (links resolved with `options.links`). */
  inline(html: unknown): string;
}

export interface BlockDefinitionInput<S extends BlockSchema = BlockSchema> {
  /** Block type: `/^[A-Za-z][A-Za-z0-9_-]{1,49}$/`, not a built-in tool name (`RESERVED_BLOCK_NAMES`). */
  name: string;
  /** Integer 1 to 1000000 (default 1); shown in Settings > Custom blocks. */
  version?: number;
  title?: string;
  description?: string;
  schema: S;
  /** Extra cleaning after the schema; its result is cleaned by the schema again. A throw keeps the schema-clean data. */
  sanitize?: (
    data: BlockData<S>,
    helpers: {
      sanitizeUrl(value: unknown, options?: { schemes?: string[]; allowRelative?: boolean }): string;
    }
  ) => BlockData<S>;
  /** Plain text (renderText, search snippets); default: text and inline fields, one per line. */
  text?: (data: BlockData<S>, helpers: BlockTextHelpers) => string;
  /** Markdown (renderMarkdown); escape what you output. Default: text and inline fields as paragraphs. */
  markdown?: (data: BlockData<S>, helpers: BlockMarkdownHelpers) => string;
  /**
   * Render-tree output (HTML, React, Vue): return nodes made with `helpers.h`,
   * `helpers.textNode`, `helpers.inlineNodes` (validated like overrides), `[]`
   * for nothing, or null/undefined for the default rendering. A string is used
   * only with `rawHtml: 'allow'` + `sanitizeRaw`.
   */
  render?: (
    block: RenderBlock & { data: BlockData<S> },
    helpers: HtmlHelpers
  ) => RenderNode | Array<RenderNode | string> | string | null | undefined;
  /** Named presets that include the block (`full` always does). */
  presets?: Array<'article' | 'basic' | 'minimal'>;
}

export type BlockDefinition<S extends BlockSchema = BlockSchema> = Readonly<
  Omit<BlockDefinitionInput<S>, 'version' | 'presets'> & {
    version: number;
    presets: ReadonlyArray<'article' | 'basic' | 'minimal'>;
  }
>;

/** Validates and freezes a definition; throws `BlockDefinitionError` with a clear message. */
export function defineBlock<const S extends BlockSchema>(
  definition: BlockDefinitionInput<S>
): BlockDefinition<S>;
/** JSON Schema (2020-12) of the block's stored `data`. */
export function blockJsonSchema(
  definition: BlockDefinition<any> | BlockDefinitionInput<any>
): Record<string, unknown>;
/** Problem with a block name, or null when it can be used. */
export function blockNameProblem(name: unknown): string | null;

export class BlockDefinitionError extends Error {
  name: 'BlockDefinitionError';
  code: 'INVALID_DEFINITION' | 'RESERVED_NAME' | 'NAME_TAKEN' | 'REGISTRY_SEALED';
}

export const BLOCK_FIELD_TYPES: readonly BlockFieldType[];
export const BLOCK_PRESETS: readonly ['article', 'basic', 'minimal'];
export const RESERVED_BLOCK_NAMES: readonly string[];
/** Built-in names that code blocks may still use (2.4: `math`, a built-in added after the SDK shipped). */
export const SDK_COMPATIBLE_NAMES: readonly string[];
export const BLOCK_LIMITS: Readonly<{
  maxFields: number;
  maxDepth: number;
  maxText: number;
  defaultText: number;
  defaultInline: number;
  maxItems: number;
  defaultItems: number;
  maxEnumValues: number;
  maxValues: number;
  maxUrl: number;
}>;

/* ------------------------------------------------------------------ 2.5 */

/** Attribute types of an inline annotation. */
export type InlineAnnotationFieldType = 'text' | 'enum' | 'url';

export interface InlineAnnotationAttributeInput {
  type: InlineAnnotationFieldType;
  label?: string;
  /** Without a required value the annotation is unwrapped on save (its text stays). */
  required?: boolean;
  /** `text`: 1-1000 characters (default 200). */
  max?: number;
  /** `enum`: 1-50 distinct strings. */
  values?: readonly string[];
  /** `url`: subset of http, https, mailto, tel (default http + https). */
  schemes?: ReadonlyArray<'http' | 'https' | 'mailto' | 'tel'>;
  /** `url`: allow site-relative URLs (default true). */
  relative?: boolean;
}

/** What `render` and `resolve` see of one annotation (clean values). */
export interface InlineAnnotationUse {
  name: string;
  attrs: Record<string, string>;
  text: string;
  /** Value from `resolve` (server output) or the `resolveAnnotation` render option. */
  resolved?: string | Record<string, unknown>;
}

/** The one element that wraps the annotated text (validated: allowed tags and attributes only). */
export interface InlineAnnotationWrapper {
  tag:
    | 'abbr'
    | 'dfn'
    | 'span'
    | 'a'
    | 'mark'
    | 'cite'
    | 'q'
    | 'small'
    | 'em'
    | 'strong'
    | 'b'
    | 'i'
    | 'u'
    | 's'
    | 'time'
    | 'data'
    | 'bdi'
    | 'kbd'
    | 'var'
    | 'ins'
    | 'del';
  /** `title`, `class`, `lang`, `dir`, `href` (only on `a`), `datetime`, `value`, `cite`, `aria-label`, `data-*` (not `data-mex-*`). */
  attrs?: Record<string, string | number | null | undefined | false>;
}

/** Context of a server-side `resolve` call (Content API `?mex=`, GraphQL `…Rendered`). */
export interface InlineAnnotationResolveContext {
  status: 'draft' | 'published';
  /**
   * Permission-aware lookup: only `api::` types the caller may `find`, the
   * query sanitised with the caller's auth, the request's publication status,
   * at most 100 rows, every row sanitised for output.
   */
  find(
    uid: string,
    query?: { filters?: Record<string, unknown>; fields?: string[]; locale?: string | null; limit?: number }
  ): Promise<Array<Record<string, unknown>>>;
}

export interface InlineAnnotationDefinitionInput {
  /** `/^[a-z][a-z0-9-]{1,39}$/`; `abbreviation` is built in. */
  name: string;
  label?: string;
  description?: string;
  /** 0-8 attributes, keys `/^[a-z][a-z0-9]{0,23}$/`, stored as `data-mex-a-<key>`. */
  attributes: Record<string, InlineAnnotationAttributeInput>;
  /** Presets that offer the annotation without the field option `inlineAnnotations`. */
  presets?: ReadonlyArray<'full' | 'article' | 'basic' | 'minimal'>;
  /** Keyboard shortcut of the editor tool: one of `ANNOTATION_SHORTCUTS` (Ctrl on Windows/Linux). */
  shortcut?: 'CMD+SHIFT+0' | 'CMD+SHIFT+1' | 'CMD+SHIFT+8';
  /**
   * Server only: one call per response with every distinct use (at most 200);
   * return the values in the same order (string up to 2000 characters or a plain object).
   */
  resolve?: (
    items: ReadonlyArray<{ attrs: Record<string, string>; locale: string | null }>,
    context: InlineAnnotationResolveContext
  ) => Promise<ReadonlyArray<unknown>> | ReadonlyArray<unknown>;
  /** Wrapper of the annotated text; `false` renders the text only; null/undefined/throw = default span. */
  render?: (annotation: InlineAnnotationUse) => InlineAnnotationWrapper | false | null | undefined;
}

export type InlineAnnotationDefinition = Readonly<
  Required<Pick<InlineAnnotationDefinitionInput, 'name' | 'label'>> &
    Omit<InlineAnnotationDefinitionInput, 'name' | 'label' | 'attributes' | 'presets'> & {
      attributes: Readonly<Record<string, Readonly<InlineAnnotationAttributeInput & { required: boolean }>>>;
      presets: readonly string[];
    }
>;

export function defineInlineAnnotation(
  definition: InlineAnnotationDefinitionInput
): InlineAnnotationDefinition;
export function annotationJsonSchema(definition: InlineAnnotationDefinition): Record<string, unknown>;
/** The built-in abbreviation (`title`, required): renders `<abbr title>`. */
export const abbreviationAnnotation: InlineAnnotationDefinition;
export const ANNOTATION_ATTRIBUTE: 'data-mex-annotation';
export const ANNOTATION_VALUE_PREFIX: 'data-mex-a-';
export const ANNOTATION_FIELD_TYPES: readonly InlineAnnotationFieldType[];
export const ANNOTATION_PRESETS: readonly ['full', 'article', 'basic', 'minimal'];
export const ANNOTATION_SHORTCUTS: readonly ['CMD+SHIFT+0', 'CMD+SHIFT+1', 'CMD+SHIFT+8'];
export const ANNOTATION_RENDER_TAGS: readonly InlineAnnotationWrapper['tag'][];
export const ANNOTATION_LIMITS: Readonly<{
  attributes: number;
  text: number;
  textDefault: number;
  values: number;
  registered: number;
  label: number;
  resolveItems: number;
}>;

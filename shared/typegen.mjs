/**
 * TypeScript types per field (`npx magic-editor-x types`).
 *
 * Reads the schemas of a project (content types and components with Magic
 * Editor X fields), resolves each field's preset with the same code the
 * server enforces on save (`resolveFieldPreset`), and writes a `.ts` module:
 *
 * - one discriminated block union per field, holding only the block types the
 *   preset allows (heading levels and component uids narrowed);
 * - typed `data` for the Settings custom blocks (from their field
 *   definitions) and for blocks registered in code with the block SDK (from
 *   their schema descriptors);
 * - a map from content type or component uid and field name to the field's
 *   value type.
 *
 * The built-in block data types are imported from `magic-editor-x/types`, so
 * the output stays in step with the installed plugin version.
 *
 * Pure: no I/O, no Strapi, deterministic output for the same input.
 */

import { resolveFieldPreset, BUILTIN_BLOCKS } from './presets.mjs';
import { SUPPORTED_TYPES } from './components.mjs';

/** Custom field uid of a Magic Editor X attribute. */
export const EDITOR_FIELD_UID = 'plugin::magic-editor-x.richtext';

/** Module the generated file imports the built-in block types from. */
export const DEFAULT_IMPORT_FROM = 'magic-editor-x/types';

/** Largest number of fields the generator writes (a project with more is refused). */
const MAX_FIELDS = 2000;
/** Deepest component nesting followed when `uids` selects content types. */
const MAX_DEPTH = 8;

/** Field types of Settings custom blocks and the TypeScript type of their stored value. */
const CUSTOM_FIELD_TS = Object.freeze({
  // The generic content policy treats every string of custom block data as inline HTML.
  text: 'InlineHtml',
  textarea: 'InlineHtml',
  url: 'Url',
  // An empty number input is stored as ''.
  number: 'number | ""',
  checkbox: 'boolean',
  color: 'string',
  image: 'MexCustomBlockImage | null',
});

/** Keys every simple custom block stores; fields with these names are shadowed. */
const SIMPLE_BLOCK_KEYS = new Set(['content', 'blockType', 'blockName']);

/** Error for an invalid request (unknown uid, too many fields). */
export class TypegenError extends Error {
  /**
   * @param {string} message - Message for people.
   * @param {string} code - Machine-readable code.
   */
  constructor(message, code) {
    super(message);
    this.name = 'TypegenError';
    this.code = code;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * TypeScript string literal (JSON quoting is valid TypeScript).
 * @param {string} value - Text.
 * @returns {string} Literal.
 */
const literal = (value) => JSON.stringify(String(value));

/**
 * Text that is safe inside a `/** … *\/` comment on one line.
 * @param {unknown} value - Text.
 * @returns {string} Cleaned text.
 */
const commentText = (value) =>
  String(value ?? '')
    .replace(/\*\//g, '* /')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, 200);

/**
 * Object key: bare when it is an identifier, quoted otherwise.
 * @param {string} key - Key.
 * @returns {string} Property name.
 */
const propertyName = (key) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : literal(key));

/**
 * PascalCase identifier part from a name or uid segment.
 * @param {string} value - Name.
 * @returns {string} Identifier part (may be '').
 */
const pascal = (value) =>
  String(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');

/**
 * Readable base name of a content type or component uid.
 * `api::article.article` -> Article, `api::blog.post` -> BlogPost,
 * `plugin::shop.product` -> ShopProduct, `shared.seo` -> SharedSeo.
 * @param {string} uid - Uid.
 * @returns {string} Name.
 */
const ownerName = (uid) => {
  const api = /^api::([^.]+)\.(.+)$/.exec(uid);
  if (api) return api[1] === api[2] ? pascal(api[2]) : pascal(api[1]) + pascal(api[2]);
  const scoped = /^([a-z]+)::([^.]+)\.(.+)$/.exec(uid);
  if (scoped) return pascal(scoped[1]) + pascal(scoped[2]) + pascal(scoped[3]);
  return pascal(uid);
};

/**
 * Hands out unique identifiers.
 * @returns {(base: string) => string} Allocator.
 */
const nameAllocator = () => {
  const taken = new Set([
    // Names the generated module itself declares or imports.
    'MexTypedBlock',
    'MexBuiltInBlock',
    'MexFieldValue',
    'MexCustomBlockImage',
    'MexEmbeddedEntry',
    'MagicEditorXFieldValues',
    'MagicEditorXFieldBlock',
    'BlockDataMap',
    'HeaderData',
    'MagicEditorXTunes',
    'InlineHtml',
    'Url',
  ]);
  return (base) => {
    let name = /^[A-Za-z_]/.test(base) ? base : `X${base}`;
    if (!name) name = 'X';
    let candidate = name;
    for (let index = 2; taken.has(candidate); index += 1) candidate = `${name}${index}`;
    taken.add(candidate);
    return candidate;
  };
};

/**
 * Lists the Magic Editor X attributes of content types and components.
 * @param {Record<string, object>} contentTypes - `strapi.contentTypes` (uid -> schema).
 * @param {Record<string, object>} components - `strapi.components` (uid -> schema).
 * @returns {Array<{ owner: string, ownerKind: 'contentType'|'component', field: string, options: object }>} Fields, sorted by owner and field.
 */
export const collectEditorFields = (contentTypes = {}, components = {}) => {
  const fields = [];
  const visit = (map, ownerKind) => {
    for (const uid of Object.keys(map || {}).sort()) {
      const schema = map[uid];
      if (!isObject(schema) || !isObject(schema.attributes)) continue;
      for (const field of Object.keys(schema.attributes).sort()) {
        const attribute = schema.attributes[field];
        if (isObject(attribute) && attribute.customField === EDITOR_FIELD_UID)
          fields.push({
            owner: uid,
            ownerKind,
            field,
            options: isObject(attribute.options) ? attribute.options : {},
          });
      }
    }
  };
  visit(contentTypes, 'contentType');
  visit(components, 'component');
  return fields;
};

/**
 * Owners selected by `uids`: the listed content types and components plus
 * every component they use (components, dynamic zones, nested).
 * @param {string[]} uids - Requested uids.
 * @param {Record<string, object>} contentTypes - Content types.
 * @param {Record<string, object>} components - Components.
 * @returns {Set<string>} Selected uids.
 * @throws {TypegenError} UNKNOWN_UID when a uid is neither a content type nor a component.
 */
const selectOwners = (uids, contentTypes, components) => {
  const selected = new Set();
  const add = (uid, depth) => {
    if (selected.has(uid) || depth > MAX_DEPTH) return;
    const schema = contentTypes[uid] || components[uid];
    if (!schema) return;
    selected.add(uid);
    for (const attribute of Object.values(schema.attributes || {})) {
      if (!isObject(attribute)) continue;
      if (attribute.type === 'component' && typeof attribute.component === 'string')
        add(attribute.component, depth + 1);
      if (attribute.type === 'dynamiczone' && Array.isArray(attribute.components))
        for (const uid of attribute.components) if (typeof uid === 'string') add(uid, depth + 1);
    }
  };
  for (const uid of uids) {
    if (!contentTypes[uid] && !components[uid])
      throw new TypegenError(`Unknown content type or component: ${uid}`, 'UNKNOWN_UID');
    add(uid, 0);
  }
  return selected;
};

/**
 * Type of a block SDK field descriptor (`magic-editor-x/blocks`).
 * @param {object} field - Normalised descriptor.
 * @param {string} indent - Indentation of nested object members.
 * @returns {string} TypeScript type.
 */
const sdkFieldType = (field, indent) => {
  switch (field && field.type) {
    case 'text':
      return 'string';
    case 'inline':
      return 'InlineHtml';
    case 'url':
      return 'Url';
    case 'enum':
      return Array.isArray(field.values) && field.values.length
        ? field.values.map(literal).join(' | ')
        : 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array': {
      const item = sdkFieldType(field.items, indent);
      return /[|&]/.test(item) ? `Array<${item}>` : `${item}[]`;
    }
    case 'object':
      return sdkObjectType(field.fields, indent);
    default:
      return 'unknown';
  }
};

/**
 * Object type of a block SDK field map. Cleaning fills every key (wrong or
 * missing values fall back to the default), so every member is required.
 * @param {Record<string, object>} fields - Field descriptors.
 * @param {string} indent - Indentation of the members.
 * @returns {string} TypeScript object type.
 */
const sdkObjectType = (fields, indent) => {
  const keys = isObject(fields) ? Object.keys(fields) : [];
  if (!keys.length) return 'Record<string, never>';
  const inner = `${indent}  `;
  const members = keys.map((key) => {
    const label =
      fields[key] && fields[key].label ? `${inner}/** ${commentText(fields[key].label)} */\n` : '';
    return `${label}${inner}${propertyName(key)}: ${sdkFieldType(fields[key], inner)};`;
  });
  return `{\n${members.join('\n')}\n${indent}}`;
};

/**
 * Type of one field of a Settings custom block.
 * @param {object} field - Field definition (`{ name, type, options? }`).
 * @returns {string} TypeScript type.
 */
const customFieldType = (field) => {
  if (field.type === 'select') {
    const values = (Array.isArray(field.options) ? field.options : [])
      .map((option) => (isObject(option) ? option.value : option))
      .filter((value) => typeof value === 'string');
    // A select without a stored choice keeps its default or ''.
    return values.length ? [...new Set(['""', ...values.map(literal)])].join(' | ') : 'string';
  }
  return CUSTOM_FIELD_TS[field.type] || 'unknown';
};

/**
 * Builds the declarations of the Settings custom blocks.
 * @param {object[]} definitions - Custom block DTOs (`custom-blocks` service `list()`).
 * @param {(base: string) => string} allocate - Name allocator.
 * @returns {Map<string, { blockType: string, code: string }>} Block type name -> declaration.
 */
const customBlockDeclarations = (definitions, allocate) => {
  const out = new Map();
  const sorted = [...definitions]
    .filter((definition) => isObject(definition) && typeof definition.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const definition of sorted) {
    if (out.has(definition.name) || BUILTIN_BLOCKS.includes(definition.name)) continue;
    const base = pascal(definition.name);
    const dataName = allocate(`${base}BlockData`);
    const blockName = allocate(`${base}Block`);
    const title = commentText(definition.label || definition.name);
    const state = definition.enabled === false ? ' Disabled in Settings; stored blocks keep their data.' : '';
    const lines = [];
    if (definition.blockType === 'embedded-entry') {
      const display = (Array.isArray(definition.displayFields) ? definition.displayFields : [])
        .filter((name) => typeof name === 'string' && name && !['id', 'documentId', 'title'].includes(name))
        .sort();
      const entryMembers = display.map((name) => `    ${propertyName(name)}?: string | number | boolean;`);
      const contentType =
        typeof definition.contentType === 'string' && definition.contentType
          ? literal(definition.contentType)
          : 'string | null';
      lines.push(
        `/** Data of the custom block "${title}" (\`${commentText(definition.name)}\`, embedded entry).${state} */`,
        `export interface ${dataName} {`,
        `  /** The linked entry: id, documentId, title and the block's display fields; null until one is chosen. */`,
        entryMembers.length
          ? `  entry: (MexEmbeddedEntry & {\n${entryMembers.join('\n')}\n  }) | null;`
          : '  entry: MexEmbeddedEntry | null;',
        `  contentType: ${contentType};`,
        '  displayMode: "card" | "inline" | "minimal";',
        '}'
      );
    } else {
      const fields = (Array.isArray(definition.fields) ? definition.fields : []).filter(
        (field) => isObject(field) && typeof field.name === 'string' && !SIMPLE_BLOCK_KEYS.has(field.name)
      );
      lines.push(
        `/** Data of the custom block "${title}" (\`${commentText(definition.name)}\`, simple).${state} */`,
        `export interface ${dataName} {`,
        '  /** Inline HTML typed into the block. */',
        '  content: InlineHtml;',
        '  blockType: "simple";',
        `  blockName: ${literal(definition.name)};`
      );
      for (const field of fields) {
        // Optional: blocks saved before a field was added to the definition do not have it.
        const required = field.required === true ? ' Required in the form.' : '';
        lines.push(
          `  /** ${commentText(field.label || field.name)} (${commentText(field.type)}).${required} */`,
          `  ${propertyName(field.name)}?: ${customFieldType(field)};`
        );
      }
      lines.push('}');
    }
    lines.push(`export type ${blockName} = MexTypedBlock<${literal(definition.name)}, ${dataName}>;`);
    out.set(definition.name, { blockType: blockName, code: lines.join('\n') });
  }
  return out;
};

/**
 * Builds the declarations of the blocks registered with the block SDK.
 * @param {object[]} definitions - Compiled definitions (`blocks` service `list()`).
 * @param {(base: string) => string} allocate - Name allocator.
 * @returns {Map<string, { blockType: string, code: string, presets: string[] }>} Block type -> declaration.
 */
const codeBlockDeclarations = (definitions, allocate) => {
  const out = new Map();
  const sorted = [...definitions]
    .filter((definition) => isObject(definition) && typeof definition.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const definition of sorted) {
    if (out.has(definition.name)) continue;
    const base = pascal(definition.name);
    const dataName = allocate(`${base}BlockData`);
    const blockName = allocate(`${base}Block`);
    const title = commentText(definition.title || definition.name);
    const code = [
      `/** Data of the block "${title}" (\`${commentText(definition.name)}\`, block SDK, version ${Number(definition.version) || 1}). */`,
      `export type ${dataName} = ${sdkObjectType(definition.schema, '')};`,
      `export type ${blockName} = MexTypedBlock<${literal(definition.name)}, ${dataName}>;`,
    ].join('\n');
    out.set(definition.name, {
      blockType: blockName,
      code,
      presets: Array.isArray(definition.presets) ? [...definition.presets] : [],
    });
  }
  return out;
};

/**
 * Builds the component block data declarations a field needs.
 * @param {string[]} uids - Allowed component uids.
 * @param {Record<string, object>} components - Component schemas.
 * @param {Map<string, string>} cache - uid -> declared data type name.
 * @param {string[]} code - Declarations to append to.
 * @param {(base: string) => string} allocate - Name allocator.
 * @returns {string} Union of the data types.
 */
const componentDataUnion = (uids, components, cache, code, allocate) =>
  uids
    .map((uid) => {
      if (cache.has(uid)) return cache.get(uid);
      const name = allocate(`${pascal(uid)}ComponentBlockData`);
      const schema = components[uid];
      const members = [];
      if (isObject(schema) && isObject(schema.attributes)) {
        for (const attributeName of Object.keys(schema.attributes)) {
          const attribute = schema.attributes[attributeName];
          if (!isObject(attribute) || attribute.private === true || attribute.visible === false) continue;
          const kind = SUPPORTED_TYPES[attribute.type];
          if (!kind) continue;
          let type = kind === 'text' ? 'string' : kind;
          if (attribute.type === 'enumeration' && Array.isArray(attribute.enum) && attribute.enum.length)
            type = attribute.enum
              .filter((value) => typeof value === 'string')
              .map(literal)
              .join(' | ');
          members.push(
            `    ${propertyName(attributeName)}${attribute.required === true ? '' : '?'}: ${type};`
          );
        }
      }
      const values = isObject(schema)
        ? members.length
          ? `{\n${members.join('\n')}\n  }`
          : 'Record<string, never>'
        : 'Record<string, string | number | boolean>';
      const note = isObject(schema) ? '' : ' The component was not found in this project.';
      code.push(
        [
          `/** Data of a component block of \`${commentText(uid)}\`. Attributes without a value are left out.${note} */`,
          `export interface ${name} {`,
          `  uid: ${literal(uid)};`,
          `  values: ${values};`,
          '  _mex: number;',
          '}',
        ].join('\n')
      );
      cache.set(uid, name);
      return name;
    })
    .join(' | ');

/**
 * One-line preset summary for the field's doc comment.
 * @param {import('./presets.mjs').FieldPreset} preset - Resolved preset.
 * @returns {string} Summary.
 */
const presetSummary = (preset) => {
  const parts = [`preset "${preset.name}"`];
  if (preset.headingLevels.length && preset.headingLevels.length < 6)
    parts.push(`headings ${preset.headingLevels.join(', ')}`);
  if (preset.maxBlocks) parts.push(`at most ${preset.maxBlocks} blocks`);
  if (preset.maxCharacters) parts.push(`at most ${preset.maxCharacters} characters`);
  if (preset.requireAlt) parts.push('alternative text required');
  if (preset.linkTargets !== 'all') parts.push(`links: ${preset.linkTargets}`);
  return parts.join(', ');
};

/**
 * Generates the TypeScript module.
 * @param {object} input - Project data.
 * @param {Record<string, object>} input.contentTypes - `strapi.contentTypes`.
 * @param {Record<string, object>} input.components - `strapi.components`.
 * @param {object[]} [input.customBlocks] - Settings custom block definitions (DTOs, enabled and disabled).
 * @param {object[]} [input.codeBlocks] - Block SDK definitions (compiled).
 * @param {string[]} [input.uids] - Only these content types or components (and the components they use).
 * @param {object} [options] - Output options.
 * @param {string} [options.importFrom] - Module of the built-in types (default `magic-editor-x/types`).
 * @param {string} [options.version] - Plugin version written into the header.
 * @returns {{ code: string, fields: number, customBlocks: number, codeBlocks: number }} Module text and counts.
 * @throws {TypegenError} UNKNOWN_UID for an unknown `uids` entry, TOO_MANY_FIELDS over the limit.
 */
export const generateTypes = (input, options = {}) => {
  const contentTypes = isObject(input && input.contentTypes) ? input.contentTypes : {};
  const components = isObject(input && input.components) ? input.components : {};
  const importFrom =
    typeof options.importFrom === 'string' && options.importFrom ? options.importFrom : DEFAULT_IMPORT_FROM;
  const allocate = nameAllocator();

  let fields = collectEditorFields(contentTypes, components);
  if (Array.isArray(input.uids) && input.uids.length) {
    const selected = selectOwners(input.uids, contentTypes, components);
    fields = fields.filter((entry) => selected.has(entry.owner));
  }
  if (fields.length > MAX_FIELDS)
    throw new TypegenError(
      `More than ${MAX_FIELDS} Magic Editor X fields; select some with --uid`,
      'TOO_MANY_FIELDS'
    );

  const custom = customBlockDeclarations(
    Array.isArray(input.customBlocks) ? input.customBlocks : [],
    allocate
  );
  const coded = codeBlockDeclarations(Array.isArray(input.codeBlocks) ? input.codeBlocks : [], allocate);

  const header = [
    `// Generated by \`magic-editor-x types\`${options.version ? ` (magic-editor-x ${options.version})` : ''}. Do not edit:`,
    '// run the command again after you change a content type, a field preset or a custom block.',
    '',
    `import type { BlockDataMap, HeaderData, InlineHtml, MagicEditorXTunes, Url } from ${literal(importFrom)};`,
    '',
    '/** A stored block of type `T` with data `D`. */',
    'export interface MexTypedBlock<T extends string, D> {',
    '  id: string;',
    '  type: T;',
    '  data: D;',
    '  tunes?: MagicEditorXTunes;',
    '}',
    '',
    '/** Built-in block of type `T` (a union of types gives a union of blocks). */',
    'export type MexBuiltInBlock<T extends keyof BlockDataMap> = T extends keyof BlockDataMap',
    '  ? MexTypedBlock<T, BlockDataMap[T]>',
    '  : never;',
    '',
    '/** Stored value of a field whose blocks are `B` (`null` when empty). */',
    'export type MexFieldValue<B> = {',
    '  time: number;',
    '  blocks: B[];',
    '  version: string;',
    '  /** Set by the server inside repeatable components and dynamic zones. */',
    '  fieldKey?: string;',
    '} | null;',
    '',
    '/** Media Library image chosen in an image field of a custom block. */',
    'export interface MexCustomBlockImage {',
    '  url: Url;',
    '  alt: string;',
    '  width?: number;',
    '  height?: number;',
    '  id?: number | string;',
    '  documentId?: string;',
    '}',
    '',
    '/** Entry summary stored by an embedded-entry custom block. */',
    'export interface MexEmbeddedEntry {',
    '  id?: number | string;',
    '  documentId: string;',
    '  title: string;',
    '}',
  ];

  const sections = [header.join('\n')];
  if (custom.size)
    sections.push(
      [
        '// Custom blocks (Settings > Magic Editor X > Custom blocks)',
        ...[...custom.values()].map((d) => d.code),
      ].join('\n\n')
    );
  if (coded.size)
    sections.push(
      ['// Blocks registered in code (block SDK)', ...[...coded.values()].map((d) => d.code)].join('\n\n')
    );

  const builtIn = BUILTIN_BLOCKS.filter((type) => type !== 'component');
  const componentCache = new Map();
  const componentCode = [];
  const fieldCode = [];
  const map = new Map();

  for (const entry of fields) {
    const preset = resolveFieldPreset(entry.options);
    let allowed = preset.blocks ? [...preset.blocks] : null;
    // Code blocks join the named presets their definition lists (as on the server).
    if (allowed && !(typeof entry.options.allowedBlocks === 'string' && entry.options.allowedBlocks.trim()))
      for (const [name, declaration] of coded)
        if (declaration.presets.includes(preset.name) && !allowed.includes(name)) allowed.push(name);
    if (allowed && allowed.includes('mediaLib') && !allowed.includes('image')) allowed.push('image');
    const names = (
      allowed
        ? allowed.filter((name) => name !== 'mediaLib' && name !== 'component')
        : [...builtIn, ...custom.keys(), ...coded.keys()]
    ).filter((name) => !(preset.excludedBlocks || []).includes(name));

    const members = [];
    const builtInNames = [];
    const notes = [];
    for (const name of [...new Set(names)]) {
      if (name === 'header') {
        if (!preset.headingLevels.length) continue;
        if (preset.headingLevels.length === 6) builtInNames.push('header');
        else
          members.push(
            `MexTypedBlock<"header", Omit<HeaderData, "level"> & { level: ${preset.headingLevels.join(' | ')} }>`
          );
      } else if (builtIn.includes(name)) builtInNames.push(name);
      else if (custom.has(name)) members.push(custom.get(name).blockType);
      else if (coded.has(name)) members.push(coded.get(name).blockType);
      else {
        members.push(`MexTypedBlock<${literal(name)}, Record<string, unknown>>`);
        notes.push(name);
      }
    }
    if (builtInNames.length) members.unshift(`MexBuiltInBlock<${builtInNames.map(literal).join(' | ')}>`);
    if (preset.components.length)
      members.push(
        `MexTypedBlock<"component", ${componentDataUnion(preset.components, components, componentCache, componentCode, allocate)}>`
      );

    const base = `${ownerName(entry.owner)}${pascal(entry.field)}`;
    const blockName = allocate(`${base}Block`);
    const valueName = allocate(`${base}Value`);
    const unknownNote = notes.length
      ? `\n * No definition found for: ${notes.map(commentText).join(', ')} (typed as unknown data).`
      : '';
    fieldCode.push(
      [
        `/**\n * Block of \`${commentText(entry.owner)}\` > \`${commentText(entry.field)}\` (${presetSummary(preset)}).${unknownNote}\n */`,
        `export type ${blockName} =\n  | ${members.length ? members.join('\n  | ') : 'never'};`,
        `/** Value of \`${commentText(entry.owner)}\` > \`${commentText(entry.field)}\`. */`,
        `export type ${valueName} = MexFieldValue<${blockName}>;`,
      ].join('\n')
    );
    if (!map.has(entry.owner)) map.set(entry.owner, []);
    map.get(entry.owner).push(`    ${propertyName(entry.field)}: ${valueName};`);
  }

  if (componentCode.length) sections.push(['// Component blocks', ...componentCode].join('\n\n'));
  if (fieldCode.length) sections.push(['// Fields', ...fieldCode].join('\n\n'));

  const mapLines = [
    '/** Value type of every Magic Editor X field, by content type or component uid and field name. */',
  ];
  if (map.size) {
    mapLines.push('export interface MagicEditorXFieldValues {');
    for (const [owner, lines] of map) mapLines.push(`  ${literal(owner)}: {\n${lines.join('\n')}\n  };`);
    mapLines.push('}');
  } else mapLines.push('export interface MagicEditorXFieldValues {}');
  mapLines.push(
    '',
    "/** Block union of one field: `MagicEditorXFieldBlock<'api::article.article', 'body'>`. */",
    'export type MagicEditorXFieldBlock<',
    '  U extends keyof MagicEditorXFieldValues,',
    '  F extends keyof MagicEditorXFieldValues[U],',
    '> = NonNullable<MagicEditorXFieldValues[U][F]> extends { blocks: Array<infer B> } ? B : never;'
  );
  sections.push(mapLines.join('\n'));

  return {
    code: `${sections.join('\n\n')}\n`,
    fields: fields.length,
    customBlocks: custom.size,
    codeBlocks: coded.size,
  };
};

/**
 * `magic-editor-x types`: TypeScript types per field preset and custom block.
 *
 * The generator is pure (`shared/typegen.mjs`); these tests feed it a
 * synthetic project (content types, components, Settings custom blocks and a
 * block SDK definition) and check the output as text, then type-check it
 * with the TypeScript compiler of the dev tree, including usages that must
 * fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { generateTypes, collectEditorFields, TypegenError } from '../shared/typegen.mjs';
import { compileBlock } from '../shared/blocks/define.mjs';
import { calloutCard } from './fixtures/callout-card.mjs';
import { BUILTIN_BLOCKS } from '../shared/presets.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const FIELD = 'plugin::magic-editor-x.richtext';

/** Synthetic project: every value is made up for the tests. */
const project = () => ({
  contentTypes: {
    'api::article.article': {
      uid: 'api::article.article',
      attributes: {
        title: { type: 'string' },
        body: { type: 'json', customField: FIELD, options: { preset: 'basic' } },
        summary: { type: 'json', customField: FIELD, options: { preset: 'minimal' } },
        sections: { type: 'dynamiczone', components: ['blocks.text-section'] },
        seo: { type: 'component', component: 'shared.seo' },
      },
    },
    'api::page.page': {
      uid: 'api::page.page',
      attributes: {
        content: { type: 'json', customField: FIELD, options: {} },
        teaser: {
          type: 'json',
          customField: FIELD,
          options: {
            preset: 'article',
            allowedBlocks: 'paragraph, header, hero, legacyBox',
            headingLevels: '3',
            allowedComponents: 'shared.cta',
            maxBlocks: 12,
          },
        },
      },
    },
    'api::blog.post': {
      uid: 'api::blog.post',
      attributes: {
        intro: { type: 'json', customField: FIELD, options: { preset: 'article' } },
      },
    },
    'api::tag.tag': { uid: 'api::tag.tag', attributes: { name: { type: 'string' } } },
  },
  components: {
    'blocks.text-section': {
      uid: 'blocks.text-section',
      attributes: { text: { type: 'json', customField: FIELD, options: { preset: 'basic' } } },
    },
    'shared.seo': { uid: 'shared.seo', attributes: { metaTitle: { type: 'string' } } },
    'shared.cta': {
      uid: 'shared.cta',
      info: { displayName: 'Call to action' },
      attributes: {
        label: { type: 'string', required: true },
        tone: { type: 'enumeration', enum: ['info', 'warning'] },
        weight: { type: 'integer' },
        external: { type: 'boolean' },
        secret: { type: 'string', private: true },
        image: { type: 'media' },
      },
    },
  },
  customBlocks: [
    {
      name: 'hero',
      label: 'Hero */ banner',
      blockType: 'simple',
      enabled: true,
      fields: [
        { name: 'headline', label: 'Headline', type: 'text', required: true },
        { name: 'size', label: 'Size', type: 'select', options: ['s', { value: 'l', label: 'Large' }] },
        { name: 'count', label: 'Count', type: 'number' },
        { name: 'dark', label: 'Dark', type: 'checkbox' },
        { name: 'photo', label: 'Photo', type: 'image' },
        { name: 'content', label: 'Shadowed', type: 'text' },
      ],
    },
    {
      name: 'productCard',
      label: 'Product card',
      blockType: 'embedded-entry',
      contentType: 'api::article.article',
      displayFields: ['title', 'price'],
      enabled: false,
    },
  ],
  codeBlocks: [compileBlock(calloutCard)],
});

const generate = (overrides = {}, options) => generateTypes({ ...project(), ...overrides }, options).code;

/**
 * Text of one exported type declaration.
 * @param {string} code - Module.
 * @param {string} name - Type name.
 * @returns {string} Declaration up to its terminating semicolon.
 */
const declaration = (code, name) => {
  const start = code.indexOf(`export type ${name} =`);
  assert.ok(start >= 0, `missing ${name}`);
  return code.slice(start, code.indexOf(';\n', start) + 1);
};

test('finds Magic Editor X fields in content types and components', () => {
  const { contentTypes, components } = project();
  assert.deepEqual(
    collectEditorFields(contentTypes, components).map((entry) => `${entry.owner}.${entry.field}`),
    [
      'api::article.article.body',
      'api::article.article.summary',
      'api::blog.post.intro',
      'api::page.page.content',
      'api::page.page.teaser',
      'blocks.text-section.text',
    ]
  );
});

test('a preset narrows the block union and the heading levels', () => {
  const code = generate();
  const body = declaration(code, 'ArticleBodyBlock');
  assert.match(body, /MexBuiltInBlock<"paragraph" \| "list" \| "quote" \| "image" \| "delimiter">/);
  assert.match(body, /MexTypedBlock<"header", Omit<HeaderData, "level"> & \{ level: 2 \| 3 \}>/);
  assert.doesNotMatch(body, /table|hero|CalloutCard/);
  // minimal: paragraph and list, no headings at all.
  assert.match(declaration(code, 'ArticleSummaryBlock'), /MexBuiltInBlock<"paragraph" \| "list">;/);
  assert.match(code, /preset "basic", headings 2, 3/);
  // Components get their own types; the dynamic zone component is included.
  assert.match(code, /export type BlocksTextSectionTextValue = MexFieldValue<BlocksTextSectionTextBlock>;/);
});

test('the full preset allows every block, custom blocks and code blocks', () => {
  const code = generate();
  const content = declaration(code, 'PageContentBlock');
  for (const type of BUILTIN_BLOCKS.filter((name) => name !== 'component'))
    assert.ok(content.includes(`"${type}"`), `full preset lists ${type}`);
  assert.match(content, /\| HeroBlock\b/);
  assert.match(content, /\| ProductCardBlock\b/);
  assert.match(content, /\| CalloutCardBlock\b/);
  // No component block unless the field lists components.
  assert.doesNotMatch(content, /"component"/);
});

test('a code block joins the named presets its definition lists', () => {
  const code = generate();
  assert.match(declaration(code, 'BlogPostIntroBlock'), /\| CalloutCardBlock\b/);
  assert.doesNotMatch(declaration(code, 'ArticleBodyBlock'), /CalloutCard/);
});

test('allowed blocks, heading levels and components of a field are typed exactly', () => {
  const code = generate();
  const teaser = declaration(code, 'PageTeaserBlock');
  assert.match(teaser, /MexBuiltInBlock<"paragraph">/);
  assert.match(teaser, /level: 3 \}/);
  assert.match(teaser, /\| HeroBlock\b/);
  assert.match(teaser, /MexTypedBlock<"legacyBox", Record<string, unknown>>/);
  assert.match(teaser, /MexTypedBlock<"component", SharedCtaComponentBlockData>/);
  assert.doesNotMatch(teaser, /CalloutCard/, 'allowedBlocks replaces the preset list');
  assert.match(code, /No definition found for: legacyBox/);
  assert.match(code, /at most 12 blocks/);
  // Component values: scalar attributes only, private and media attributes left out.
  assert.match(code, /uid: "shared\.cta";/);
  assert.match(code, /label: string;/);
  assert.match(code, /tone\?: "info" \| "warning";/);
  assert.match(code, /weight\?: number;/);
  assert.match(code, /external\?: boolean;/);
  assert.doesNotMatch(code, /secret|image\?:/);
});

test('Settings custom blocks get typed data from their field definitions', () => {
  const code = generate();
  assert.match(code, /export interface HeroBlockData \{/);
  assert.match(code, /blockType: "simple";/);
  assert.match(code, /blockName: "hero";/);
  assert.match(code, /headline\?: InlineHtml;/);
  assert.match(code, /size\?: "" \| "s" \| "l";/);
  assert.match(code, /count\?: number \| "";/);
  assert.match(code, /dark\?: boolean;/);
  assert.match(code, /photo\?: MexCustomBlockImage \| null;/);
  // A field named like a stored key does not produce a second `content` member.
  assert.equal(code.match(/^\s+content: InlineHtml;/gm).length, 1);
  // Embedded-entry blocks: fixed content type, display fields, disabled note.
  assert.match(code, /contentType: "api::article\.article";/);
  assert.match(code, /price\?: string \| number \| boolean;/);
  assert.match(code, /Disabled in Settings/);
  // Labels cannot end the comment early.
  assert.ok(!code.includes('Hero */ banner'));
});

test('block SDK definitions are typed from their schema descriptors', () => {
  const code = generate();
  assert.match(code, /export type CalloutCardBlockData = \{/);
  assert.match(code, /title: string;/);
  assert.match(code, /body: InlineHtml;/);
  assert.match(code, /link: Url;/);
  assert.match(code, /tone: "info" \| "success" \| "warning";/);
});

test('the field map covers every field and the output is deterministic', () => {
  const first = generate();
  const shuffled = project();
  shuffled.contentTypes = Object.fromEntries(Object.entries(shuffled.contentTypes).reverse());
  shuffled.customBlocks.reverse();
  assert.equal(generateTypes(shuffled).code, first);
  assert.match(
    first,
    /"api::article\.article": \{\n {4}body: ArticleBodyValue;\n {4}summary: ArticleSummaryValue;/
  );
  assert.match(first, /"blocks\.text-section": \{\n {4}text: BlocksTextSectionTextValue;/);
  assert.match(first, /from "magic-editor-x\/types";/);
  assert.match(
    generate({}, { importFrom: '../types/index.js', version: '9.9.9' }),
    /from "\.\.\/types\/index\.js";[\s\S]*/
  );
  assert.match(generate({}, { version: '9.9.9' }), /\(magic-editor-x 9\.9\.9\)/);
});

test('--uid selects content types with the components they use, and rejects unknown uids', () => {
  const result = generateTypes({ ...project(), uids: ['api::article.article'] });
  assert.equal(result.fields, 3);
  assert.match(result.code, /BlocksTextSectionTextValue/);
  assert.doesNotMatch(result.code, /PageContentValue/);
  assert.throws(
    () => generateTypes({ ...project(), uids: ['api::missing.missing'] }),
    (error) => error instanceof TypegenError && error.code === 'UNKNOWN_UID'
  );
  const empty = generateTypes({ contentTypes: {}, components: {} });
  assert.equal(empty.fields, 0);
  assert.match(empty.code, /export interface MagicEditorXFieldValues \{\}/);
});

test('the types service passes the loaded project to the generator', async () => {
  const createService = require('../server/src/services/types.js');
  const { contentTypes, components, customBlocks, codeBlocks } = project();
  const calls = [];
  const strapi = {
    contentTypes,
    components,
    plugin: (name) => {
      assert.equal(name, 'magic-editor-x');
      return {
        service: (service) =>
          service === 'custom-blocks'
            ? {
                list: async (options) => {
                  calls.push(options);
                  return customBlocks;
                },
              }
            : { list: () => codeBlocks },
      };
    },
  };
  const result = await createService({ strapi }).generate({ uids: ['api::page.page'], version: '1.2.3' });
  assert.deepEqual(calls, [{ enabledOnly: false }]);
  assert.equal(result.fields, 2);
  assert.equal(result.customBlocks, 2);
  assert.equal(result.codeBlocks, 1);
  assert.match(result.code, /magic-editor-x 1\.2\.3/);
});

test('CLI: types command options are parsed strictly', async () => {
  const { parseCommand } = await import('../bin/magic-editor-x.mjs');
  assert.deepEqual(parseCommand(['types']), {
    help: false,
    command: 'types',
    out: undefined,
    options: { uids: [] },
  });
  assert.deepEqual(
    parseCommand(['types', '--uid', 'api::article.article', '--uid', 'shared.seo', '--out', 'types/mex.ts']),
    {
      help: false,
      command: 'types',
      out: 'types/mex.ts',
      options: { uids: ['api::article.article', 'shared.seo'] },
    }
  );
  assert.equal(
    parseCommand(['types', '--import-from', '@acme/mex-types']).options.importFrom,
    '@acme/mex-types'
  );
  assert.throws(() => parseCommand(['types', '--apply']), /not an option of types/);
  assert.throws(() => parseCommand(['types', '--uid', 'not a uid']), /not a content type or component uid/);
  assert.throws(() => parseCommand(['types', '--import-from', 'x y']), /module name/);
  assert.throws(
    () => parseCommand(['migrate', '--uid', 'api::a.a', '--from', 'a', '--to', 'b', '--import-from', 'x']),
    /types only/
  );
  assert.throws(
    () => parseCommand(['migrate', '--uid', 'api::a.a', '--uid', 'api::b.b', '--from', 'a', '--to', 'b']),
    /only once/
  );
});

test('CLI: types blocks fetch() while it runs and restores it', async () => {
  const { blockFetch } = await import('../bin/magic-editor-x.mjs');
  const original = globalThis.fetch;
  const restore = blockFetch();
  try {
    await assert.rejects(
      () => globalThis.fetch('https://registry.npmjs.org/@strapi%2Fcore'),
      /no network requests/
    );
  } finally {
    restore();
  }
  assert.equal(globalThis.fetch, original);
});

/** TypeScript compiler of the dev tree (a dependency of @strapi/sdk-plugin), or null. */
const tscPath = (() => {
  try {
    const pkg = require.resolve('typescript/package.json');
    const bin = path.join(path.dirname(pkg), 'bin', 'tsc');
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
})();

test(
  'the generated module type-checks with tsc --noEmit and rejects blocks a preset does not allow',
  { skip: tscPath ? false : 'typescript is not installed in this tree (it comes with @strapi/sdk-plugin)' },
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mex-typegen-'));
    try {
      writeFileSync(path.join(dir, 'mex-types.ts'), generate());
      writeFileSync(
        path.join(dir, 'usage.ts'),
        `import type {
  ArticleBodyBlock,
  ArticleBodyValue,
  PageTeaserBlock,
  PageContentBlock,
  MagicEditorXFieldBlock,
  MagicEditorXFieldValues,
} from './mex-types';

export const ok: ArticleBodyValue = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'a1', type: 'paragraph', data: { text: 'Hi' } },
    { id: 'a2', type: 'header', data: { text: 'Title', level: 2 } },
  ],
};

export const textOf = (block: ArticleBodyBlock): string => {
  switch (block.type) {
    case 'paragraph':
      return block.data.text;
    case 'header':
      return String(block.data.level satisfies 2 | 3);
    case 'image':
      return block.data.file.url;
    default:
      return '';
  }
};

export const heroOf = (block: PageContentBlock): string =>
  block.type === 'hero' ? (block.data.headline ?? '') + (block.data.size ?? '') : '';

export const ctaOf = (block: PageTeaserBlock): string =>
  block.type === 'component' && block.data.uid === 'shared.cta' ? block.data.values.label : '';

export const calloutTone = (block: MagicEditorXFieldBlock<'api::blog.post', 'intro'>) =>
  block.type === 'calloutCard' ? block.data.tone : null;

export const map: MagicEditorXFieldValues['api::page.page']['teaser'] = null;

// @ts-expect-error a table is not allowed by the "basic" preset
export const noTable: ArticleBodyBlock = { id: 't', type: 'table', data: { withHeadings: false, stretched: false, content: [] } };

// @ts-expect-error heading level 1 is not allowed in this field
export const noH1: ArticleBodyBlock = { id: 'h', type: 'header', data: { text: 'x', level: 1 } };

// @ts-expect-error the select field only has the options "s" and "l"
export const badSize: PageContentBlock = { id: 'x', type: 'hero', data: { content: '', blockType: 'simple', blockName: 'hero', size: 'xl' } };

// @ts-expect-error a component that the field does not list
export const badCta: PageTeaserBlock = { id: 'c', type: 'component', data: { uid: 'shared.seo', values: {}, _mex: 1 } };
`
      );
      writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            skipLibCheck: false,
            baseUrl: '.',
            paths: { 'magic-editor-x/types': [path.join(root, 'types/index.d.ts')] },
          },
          files: ['mex-types.ts', 'usage.ts'],
        })
      );
      const run = spawnSync(process.execPath, [tscPath, '--noEmit', '-p', path.join(dir, 'tsconfig.json')], {
        encoding: 'utf8',
      });
      assert.equal(run.status, 0, `tsc failed:\n${run.stdout}${run.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

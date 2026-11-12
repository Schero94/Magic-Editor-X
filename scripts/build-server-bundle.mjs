import { builtinModules } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
// ESM-only dependencies are bundled so the CommonJS server entry never has to
// require() an ES module (Node 22 before 22.12 cannot).
const BUNDLED = new Set(['marked', 'htmlparser2']);
const externals = new Set(
  [
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ].filter((name) => !BUNDLED.has(name))
);

const commonOptions = {
  entryPoints: ['server/src/index.js'],
  bundle: true,
  platform: 'node',
  target: ['node22'],
  sourcemap: false,
  minify: false,
  external: [...externals],
  logLevel: 'info',
};

await build({
  ...commonOptions,
  format: 'cjs',
  outfile: 'dist/server/index.js',
});

await build({
  ...commonOptions,
  format: 'esm',
  outfile: 'dist/server/index.mjs',
  banner: {
    js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);",
  },
});

// Framework-free renderers (`magic-editor-x/render`): no Node built-ins, no dependencies.
const renderOptions = {
  entryPoints: ['shared/render/index.mjs'],
  bundle: true,
  platform: 'neutral',
  target: ['es2020'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

await build({ ...renderOptions, format: 'esm', outfile: 'dist/render/index.mjs' });
await build({ ...renderOptions, format: 'cjs', outfile: 'dist/render/index.js' });

// Custom block SDK (`magic-editor-x/blocks`): framework-free like the renderers.
const blocksOptions = { ...renderOptions, entryPoints: ['shared/blocks/index.mjs'] };
await build({ ...blocksOptions, format: 'esm', outfile: 'dist/blocks/index.mjs' });
await build({ ...blocksOptions, format: 'cjs', outfile: 'dist/blocks/index.js' });

// Math helper (`magic-editor-x/math`, 2.4): Temml stays external (a dependency of the package),
// the shared policy limit is bundled.
const mathOptions = { ...renderOptions, entryPoints: ['shared/math/index.mjs'], external: ['temml'] };
await build({ ...mathOptions, format: 'esm', outfile: 'dist/math/index.mjs' });
await build({ ...mathOptions, format: 'cjs', outfile: 'dist/math/index.js' });

// Framework components (`magic-editor-x/react`, `magic-editor-x/vue`): the
// framework is the caller's (external), the renderer core is bundled in.
for (const [name, external] of [
  ['react', ['react']],
  ['vue', ['vue']],
]) {
  const frameworkOptions = { ...renderOptions, entryPoints: [`shared/frameworks/${name}.mjs`], external };
  await build({ ...frameworkOptions, format: 'esm', outfile: `dist/${name}/index.mjs` });
  await build({ ...frameworkOptions, format: 'cjs', outfile: `dist/${name}/index.js` });
}

// TypeScript finds these next to the resolved file (`index.d.ts` for require, `index.d.mts` for import).
for (const name of ['render', 'react', 'vue', 'blocks', 'math']) {
  const types = await readFile(new URL(`../types/${name}.d.ts`, import.meta.url), 'utf8');
  const shimmed = types
    .replace("from './index.js'", "from '../../types/index.js'")
    .replace("from './render.js'", "from '../render/index.js'")
    .replace("import('./blocks.js')", "import('../blocks/index.js')");
  await writeFile(new URL(`../dist/${name}/index.d.ts`, import.meta.url), shimmed);
  await writeFile(new URL(`../dist/${name}/index.d.mts`, import.meta.url), shimmed);
}

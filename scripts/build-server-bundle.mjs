import { builtinModules } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const externals = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.peerDependencies || {}),
]);

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

// TypeScript finds these next to the resolved file (`index.d.ts` for require, `index.d.mts` for import).
const renderTypes = await readFile(new URL('../types/render.d.ts', import.meta.url), 'utf8');
const shimmed = renderTypes.replace("from './index.js'", "from '../../types/index.js'");
await writeFile(new URL('../dist/render/index.d.ts', import.meta.url), shimmed);
await writeFile(new URL('../dist/render/index.d.mts', import.meta.url), shimmed);

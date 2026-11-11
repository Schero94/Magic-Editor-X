/**
 * Writes docs/site/llms-full.txt from README.md and AGENTS.md, so the file
 * for AI tools never drifts from the docs. Run with `npm run docs:llms`;
 * `--check` fails when the committed file is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'docs/site/llms-full.txt');
const read = (file) => readFileSync(path.join(root, file), 'utf8').trim();

const content = [
  '# Magic Editor X: full documentation',
  '',
  '> README.md and AGENTS.md of magic-editor-x in one file.',
  '> Source: https://github.com/Schero94/Magic-Editor-X',
  '',
  read('README.md'),
  '',
  '---',
  '',
  read('AGENTS.md'),
  '',
].join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // A missing file counts as out of date.
  }
  if (current !== content) {
    console.error('docs/site/llms-full.txt is out of date. Run: npm run docs:llms');
    process.exit(1);
  }
  console.log('llms-full.txt is up to date');
} else {
  writeFileSync(target, content);
  console.log(`wrote ${path.relative(root, target)}`);
}

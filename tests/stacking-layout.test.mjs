// Full screen layer and block size contract (source level). The browser checks are in
// scripts/bench-browser/regressions.mjs (npm run bench:browser -- --suite regressions).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the full screen frame sits below the DS overlay layer, so DS Modal and Dialog stay visible', () => {
  const field = read('admin/src/components/EditorField/index.jsx');
  const frame = field
    .slice(field.indexOf('const Frame = styled(Box)`'), field.indexOf('const EditorArea'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(frame.includes('position: fixed;'), 'Frame block found');
  // DS 2.3.1 renders Modal.Content and Dialog.Content inside their overlay (z-index: overlay),
  // which is their stacking context: anything at zIndices.modal or higher in the page covers them.
  assert.match(frame, /z-index: \$\{theme\.zIndices\.overlay - 1\};/);
  assert.doesNotMatch(frame, /zIndices\.(modal|dialog|popover|notification|tooltip)/);
});

test('the DS overlay is the stacking context of Modal and Dialog content (installed DS, 2.2.0 to 2.3.1)', () => {
  const ds = read('node_modules/@strapi/design-system/dist/index.mjs');
  // Overlay wraps the content and has its own z-index: the frame must stay below it.
  const overlays =
    ds.match(/Overlay\)`[^`]*?z-index: \$\{\(?(\w+)\)? => \1\.theme\.zIndices\.overlay\};/g) || [];
  assert.ok(overlays.length >= 2, 'Modal and Dialog overlays use zIndices.overlay');
});

test('every block keeps its last size (contain-intrinsic-size auto), also while it has the caret', () => {
  const styles = read('admin/src/editor/tools/styles.js');
  assert.match(styles, /\.codex-editor__redactor > \.ce-block \{\s*contain-intrinsic-size: auto 4rem;\s*\}/);
  const conditional =
    (styles.match(/> \.ce-block:not\(:focus-within\).*?FOOTNOTE_BLOCK_CLASS\}\)\s*\{([^}]*)\}/s) || [])[1] ||
    '';
  assert.match(conditional, /content-visibility: auto;/);
  assert.doesNotMatch(
    conditional,
    /contain-intrinsic-size/,
    'only on the unfocused blocks, the size is dropped while a block has focus'
  );
});

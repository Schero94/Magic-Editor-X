/**
 * Counting wrapper of Yjs 13.6 for the StrictMode tests: re-exports the real module and replaces
 * `Doc` with a subclass that records every document the plugin creates and whether `destroy()`
 * ran (https://docs.yjs.dev/api/y.doc: `doc.destroy()` destroys the document and its
 * listeners). Documents Yjs creates internally (subdocuments, updates) are not counted.
 */
import * as Y from 'yjs';

export * from 'yjs';

/** Live documents with the stack that created them. */
export const liveDocs = new Map();
export const docCounts = { created: 0, destroyed: 0 };

/**
 * Where a document was created (repository frames only).
 * @returns {string} Short stack.
 */
const origin = () =>
  (new Error().stack || '')
    .split('\n')
    .slice(3)
    .filter((line) => !line.includes('node_modules') && !line.includes('/tests/admin/'))
    .slice(0, 2)
    .map((line) =>
      line
        .trim()
        .replace(/^at /, '')
        .replace(/\?.*?(?=:\d+:\d+)/, '')
    )
    .join(' <- ');

export class Doc extends Y.Doc {
  constructor(options) {
    super(options);
    docCounts.created += 1;
    liveDocs.set(this, origin());
  }
  destroy() {
    if (liveDocs.delete(this)) docCounts.destroyed += 1;
    super.destroy();
  }
}

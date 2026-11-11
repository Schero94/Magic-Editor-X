/**
 * Writes the published JSON Schema of a stored field value
 * (`schema/magic-editor-x.schema.json`) from `shared/schema.mjs`.
 * Run `npm run schema` after changing the block policies; the unit tests fail
 * when the committed file is out of date.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { buildEditorSchema } from '../shared/schema.mjs';

const target = new URL('../schema/magic-editor-x.schema.json', import.meta.url);
await mkdir(new URL('../schema/', import.meta.url), { recursive: true });
await writeFile(target, `${JSON.stringify(buildEditorSchema(), null, 2)}\n`);
console.log('schema/magic-editor-x.schema.json written');

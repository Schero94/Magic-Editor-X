#!/usr/bin/env node
/**
 * Performance benchmark of the document pipeline (`npm run bench`).
 *
 * Builds synthetic documents of 500, 2000 and 5000 blocks from the all-blocks
 * fixture (every built-in block type, nested lists, tables, inline formatting,
 * internal and external links) and measures, after a warm-up, the median of
 * several samples per operation:
 *
 *   normalize + sanitize (normalizeEditorData + server cleanEditorValue),
 *   renderHtml / renderText / renderMarkdown (public API only),
 *   diffDocuments, find + replace, Yjs seed + apply (shared/ydoc.mjs),
 *   quality lint, preset check, audit change summary (2.4).
 *
 * 2.5: whole documents with many editor fields (20 top-level fields, a
 * repeatable component and a dynamic zone with 25, 100 and 250 items, each
 * field 20 blocks) through the server paths that walk every field of a write
 * or a response: the editor field walk (utils/editor-fields.js), the save
 * middleware's normalise + sanitise + preset check per field (register.js),
 * field identity assignment (shared/field-identity.mjs assignFieldKeys) and
 * the `?mex=html` output walk + render (utils/output-walk.js, renderHtml).
 * Checked against `documents` in the thresholds (budget at 250 items,
 * scaling 250/25 items; the work grows with 20 + 2 x items fields, about 7x).
 *
 * Checks (thresholds in scripts/bench-thresholds.json, see CONTRIBUTING.md):
 *   - absolute budget per operation at 5000 blocks (several times a local median);
 *   - scaling: time(5000) / time(500) below a bound per operation (linear work
 *     gives about 10; quadratic work gives about 100);
 *   - deterministic counters (blocks kept, matches found, round trips).
 * Prints a table and exits 1 with a message on any breach.
 *
 * Options: --json (machine-readable output), --samples <n> (default 7).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import * as Y from 'yjs';
import { normalizeEditorData } from '../shared/editor-data.mjs';
import { renderHtml, renderText, renderMarkdown } from '../shared/render/index.mjs';
import { diffDocuments } from '../shared/diff.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { createSeedUpdate, applyLocalChanges, docToEditorData } from '../shared/ydoc.mjs';
import { lintDocument } from '../shared/quality.mjs';
import { resolveFieldPreset, checkPreset } from '../shared/presets.mjs';
import { fieldChanges } from '../shared/audit.mjs';
import { allowedInlineTags } from '../shared/presets.mjs';
import { assignFieldKeys } from '../shared/field-identity.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue } = require('../server/src/utils/sanitizer.js');
const { transformEditorFields } = require('../server/src/utils/editor-fields.js');
const { walkOutput } = require('../server/src/utils/output-walk.js');

const root = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/editor-2x-all-blocks.json'), 'utf8')
);
const thresholds = JSON.parse(fs.readFileSync(path.join(root, 'scripts/bench-thresholds.json'), 'utf8'));

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const samplesArg = args.indexOf('--samples');
const SAMPLES = samplesArg >= 0 ? Math.max(3, Number(args[samplesArg + 1]) || 7) : 7;
const SIZES = [500, 2000, 5000];
/** Each sample repeats the operation until it took at least this long (stable medians for fast operations). */
const MIN_SAMPLE_MS = 25;

/**
 * Synthetic document with `count` blocks: copies of the fixture blocks with
 * unique ids, varied text and a nested list every 25 blocks.
 * @param {number} count - Number of blocks.
 * @returns {object} Editor.js document.
 */
const makeDocument = (count) => {
  const blocks = [];
  for (let i = 0; blocks.length < count; i += 1) {
    const source = fixture.blocks[i % fixture.blocks.length];
    const block = structuredClone(source);
    block.id = `${source.id}-${i}`;
    if (block.type === 'toggle') block.data.fk = block.id;
    if (block.type === 'paragraph')
      block.data.text = `${block.data.text} Section ${i} has <b>bold ${i}</b> and <a href="https://www.example.test/p/${i % 97}">link ${i}</a>.`;
    if (i % 25 === 0)
      blocks.push({
        id: `nl-${i}`,
        type: 'list',
        data: {
          style: 'unordered',
          meta: {},
          items: [
            {
              content: `Outer ${i}`,
              meta: {},
              items: [
                { content: `Inner <i>${i}</i>`, meta: {}, items: [{ content: 'Deep', meta: {}, items: [] }] },
              ],
            },
          ],
        },
      });
    if (blocks.length < count) blocks.push(block);
  }
  return { time: 1762850000000, version: '2.31.7', blocks: blocks.slice(0, count) };
};

/**
 * Edited copy: every 50th paragraph changed, one block removed, one added.
 * @param {object} data - Document.
 * @returns {object} Edited document.
 */
const editDocument = (data) => {
  const blocks = data.blocks.map((block, index) =>
    block.type === 'paragraph' && index % 50 === 0
      ? { ...block, data: { ...block.data, text: `${block.data.text} edited` } }
      : block
  );
  blocks.splice(10, 1);
  blocks.push({ id: 'added-end', type: 'paragraph', data: { text: 'New closing paragraph.' } });
  return { ...data, blocks };
};

/**
 * Median duration of `fn` in milliseconds per call.
 * @param {() => unknown} fn - Operation.
 * @returns {{ median: number, iterations: number }} Result.
 */
const measure = (fn) => {
  for (let i = 0; i < 2; i += 1) fn();
  const start = performance.now();
  fn();
  const once = Math.max(performance.now() - start, 0.01);
  const iterations = Math.max(1, Math.ceil(MIN_SAMPLE_MS / once));
  const samples = [];
  for (let s = 0; s < SAMPLES; s += 1) {
    const t0 = performance.now();
    for (let i = 0; i < iterations; i += 1) fn();
    samples.push((performance.now() - t0) / iterations);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], iterations };
};

/**
 * The measured operations. Each returns a deterministic counter.
 * @param {object} data - Normalised document.
 * @param {object} edited - Edited document.
 * @returns {Record<string, () => number>} Operations.
 */
const operations = (data, edited) => {
  const preset = resolveFieldPreset({
    preset: 'full',
    maxBlocks: 10000,
    maxCharacters: 100000000,
    requireAlt: true,
  });
  const json = JSON.stringify(data);
  return {
    'normalize+sanitize': () => {
      const normalized = normalizeEditorData(json);
      return cleanEditorValue(normalized).blocks.length;
    },
    renderHtml: () => (renderHtml(data).length > 0 ? 1 : 0),
    renderText: () => (renderText(data).length > 0 ? 1 : 0),
    renderMarkdown: () => (renderMarkdown(data).length > 0 ? 1 : 0),
    diffDocuments: () => diffDocuments(data, edited).length,
    'find+replace': () => {
      const found = findMatches(data, 'Section').matches.length;
      const replaced = replaceMatches(data, 'Section', 'Part').count;
      return found === replaced ? found : -1;
    },
    'ydoc seed+apply': () => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, createSeedUpdate(data, 'bench'));
      applyLocalChanges(doc, data, edited);
      return docToEditorData(doc).blocks.length;
    },
    lint: () => lintDocument(data).issues.length,
    presetCheck: () => checkPreset(data, preset).length,
    // Audit trail: counts of one save (block id + fingerprint comparison, no word diff).
    auditChanges: () => {
      const { counts } = fieldChanges(data, edited);
      return counts.added + counts.removed + counts.changed + counts.moved;
    },
  };
};

const results = [];
for (const size of SIZES) {
  const data = normalizeEditorData(makeDocument(size));
  const edited = editDocument(data);
  for (const [name, fn] of Object.entries(operations(data, edited))) {
    const counter = fn();
    const { median, iterations } = measure(fn);
    results.push({ size, name, median, iterations, counter });
  }
}

// 2.5: documents with many editor fields (server paths that walk every field).
const EDITOR = { type: 'customField', customField: 'plugin::magic-editor-x.richtext' };
const benchStrapi = {
  components: {
    'blocks.text-section': {
      uid: 'blocks.text-section',
      attributes: { heading: { type: 'string' }, body: EDITOR },
    },
    'blocks.quote-card': {
      uid: 'blocks.quote-card',
      attributes: { caption: { type: 'string' }, body: { ...EDITOR, options: { preset: 'basic' } } },
    },
  },
  getModel: () => null,
};
const documentSchema = {
  uid: 'api::bench.bench',
  attributes: {
    title: { type: 'string' },
    ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`part${i}`, EDITOR])),
    sections: { type: 'component', repeatable: true, component: 'blocks.text-section' },
    zone: { type: 'dynamiczone', components: ['blocks.text-section', 'blocks.quote-card'] },
  },
};
const DOC_SIZES = [25, 100, 250];
/** Plain-text 20-block field value (paragraphs, headers, a list). */
const fieldValue = (seed) =>
  normalizeEditorData({
    time: 1762850000000,
    version: '2.31.7',
    blocks: Array.from({ length: 20 }, (_, i) =>
      i % 7 === 0
        ? { id: `h${seed}-${i}`, type: 'header', data: { text: `Heading ${seed} ${i}`, level: 2 } }
        : i % 5 === 0
          ? {
              id: `l${seed}-${i}`,
              type: 'list',
              data: { style: 'unordered', meta: {}, items: [{ content: `Item ${i}`, meta: {}, items: [] }] },
            }
          : {
              id: `p${seed}-${i}`,
              type: 'paragraph',
              data: {
                text: `Field ${seed} paragraph ${i} with <b>bold</b> and <a href="https://www.example.test/${i}">a link</a>.`,
              },
            }
    ),
  });
/**
 * Document of 20 top-level editor fields plus `items` repeatable entries and `items` dynamic zone entries.
 * @param {number} items - Entries per list.
 * @returns {object} Write data (fresh objects; the walks mutate).
 */
const makeEntry = (items) => {
  const entry = { title: 'Bench' };
  for (let i = 0; i < 20; i += 1) entry[`part${i}`] = fieldValue(`t${i}`);
  entry.sections = Array.from({ length: items }, (_, i) => ({ heading: `S${i}`, body: fieldValue(`s${i}`) }));
  entry.zone = Array.from({ length: items }, (_, i) =>
    i % 2
      ? { __component: 'blocks.quote-card', caption: `Q${i}`, body: fieldValue(`q${i}`) }
      : { __component: 'blocks.text-section', heading: `Z${i}`, body: fieldValue(`z${i}`) }
  );
  return entry;
};
const documentOperations = (items) => {
  const json = JSON.stringify(makeEntry(items));
  const fresh = () => JSON.parse(json);
  // The walk with an identity transform does not change the data: one parsed copy is reused.
  const shared = fresh();
  return {
    'doc fieldWalk': () => {
      let count = 0;
      transformEditorFields(benchStrapi, documentSchema, shared, (value) => {
        count += 1;
        return value;
      });
      return count;
    },
    'doc saveNormalize': () => {
      let violations = 0;
      let count = 0;
      transformEditorFields(benchStrapi, documentSchema, fresh(), (value, attribute) => {
        const preset = resolveFieldPreset(attribute && attribute.options);
        const clean = cleanEditorValue(value, { rawHtml: 'sanitize', inlineTags: allowedInlineTags(preset) });
        if (preset.restricted) violations += checkPreset(clean, preset).length;
        count += 1;
        return clean;
      });
      return count * 1000 + violations;
    },
    'doc fieldKeys': () => {
      const items = [];
      transformEditorFields(benchStrapi, documentSchema, fresh(), (value, attribute, path, container) => {
        items.push({ path, value, container });
        return value;
      });
      let next = 0;
      assignFieldKeys(items, { create: () => `benchkey${String((next += 1)).padStart(14, '0')}` });
      return next;
    },
    'doc outputRender': () => {
      let length = 0;
      let count = 0;
      walkOutput(benchStrapi, documentSchema, fresh(), (holder, key) => {
        // The copy is parsed in every sample (render-output replaces values in place).
        holder[key] = renderHtml(holder[key]);
        length += holder[key].length > 0 ? 1 : 0;
        count += 1;
      });
      return length === count ? count : -1;
    },
  };
};
for (const items of DOC_SIZES) {
  for (const [name, fn] of Object.entries(documentOperations(items))) {
    const counter = fn();
    const { median, iterations } = measure(fn);
    results.push({ size: items, name, median, iterations, counter, kind: 'document' });
  }
}

const failures = [];
const byKey = new Map(results.map((row) => [`${row.name}@${row.size}`, row]));
const table = [];
for (const name of Object.keys(thresholds.operations)) {
  const limits = thresholds.operations[name];
  const small = byKey.get(`${name}@500`);
  const large = byKey.get(`${name}@5000`);
  if (!small || !large) {
    failures.push(`${name}: not measured`);
    continue;
  }
  const ratio = large.median / Math.max(small.median, 0.001);
  if (large.median > limits.budgetMs5000)
    failures.push(
      `${name}: ${large.median.toFixed(2)} ms at 5000 blocks is above the budget of ${limits.budgetMs5000} ms`
    );
  if (ratio > limits.maxScaling)
    failures.push(
      `${name}: 5000/500 blocks time ratio ${ratio.toFixed(1)} is above ${limits.maxScaling} (super-linear growth)`
    );
  for (const size of SIZES) {
    const expected = limits.counters?.[String(size)];
    const row = byKey.get(`${name}@${size}`);
    if (expected !== undefined && row.counter !== expected)
      failures.push(`${name}: counter at ${size} blocks is ${row.counter}, expected ${expected}`);
  }
  table.push({
    operation: name,
    ...Object.fromEntries(
      SIZES.map((size) => [`${size} ms`, byKey.get(`${name}@${size}`).median.toFixed(2)])
    ),
    ratio: ratio.toFixed(1),
    'max ratio': limits.maxScaling,
    'budget ms': limits.budgetMs5000,
  });
}

const docTable = [];
for (const name of Object.keys(thresholds.documents || {})) {
  const limits = thresholds.documents[name];
  const small = byKey.get(`${name}@${DOC_SIZES[0]}`);
  const large = byKey.get(`${name}@${DOC_SIZES[DOC_SIZES.length - 1]}`);
  if (!small || !large) {
    failures.push(`${name}: not measured`);
    continue;
  }
  const ratio = large.median / Math.max(small.median, 0.001);
  if (large.median > limits.budgetMs250)
    failures.push(
      `${name}: ${large.median.toFixed(2)} ms at 250 items is above the budget of ${limits.budgetMs250} ms`
    );
  if (ratio > limits.maxScaling)
    failures.push(`${name}: 250/25 items time ratio ${ratio.toFixed(1)} is above ${limits.maxScaling}`);
  for (const size of DOC_SIZES) {
    const expected = limits.counters?.[String(size)];
    const row = byKey.get(`${name}@${size}`);
    if (expected !== undefined && row.counter !== expected)
      failures.push(`${name}: counter at ${size} items is ${row.counter}, expected ${expected}`);
  }
  docTable.push({
    operation: name,
    ...Object.fromEntries(
      DOC_SIZES.map((size) => [`${size} items ms`, byKey.get(`${name}@${size}`).median.toFixed(2)])
    ),
    ratio: ratio.toFixed(1),
    'max ratio': limits.maxScaling,
    'budget ms': limits.budgetMs250,
  });
}

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ node: process.version, samples: SAMPLES, results, failures }, null, 2)}\n`
  );
} else {
  process.stdout.write(`Magic Editor X benchmark (node ${process.version}, median of ${SAMPLES} samples)\n`);
  console.table(table);
  process.stdout.write(
    'Documents with many editor fields (20 top-level fields + items in a repeatable component and a dynamic zone, 20 blocks each)\n'
  );
  console.table(docTable);
}
if (failures.length) {
  process.stderr.write(
    `\nBenchmark thresholds breached:\n${failures.map((line) => `  - ${line}`).join('\n')}\n`
  );
  process.exit(1);
}
process.stdout.write(asJson ? '' : 'All benchmark thresholds met.\n');

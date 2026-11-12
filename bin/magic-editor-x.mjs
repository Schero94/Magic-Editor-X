#!/usr/bin/env node
/**
 * Magic Editor X command line.
 *
 *   npx magic-editor-x migrate --uid api::article.article --from body --to content [--apply]
 *
 * Run it from the root of the Strapi project. It loads the project with
 * Strapi's programmatic API (compileStrapi, createStrapi().load(), destroy()),
 * without starting the HTTP server, runs the plugin's `migrate` service and
 * prints the report. Without `--apply` nothing is written (dry run).
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HELP = `Usage: magic-editor-x migrate --uid <uid> --from <field> --to <field> [options]

Copies and converts a Strapi Blocks, Rich text (Markdown), text or JSON field
into a Magic Editor X field of the same content type. The source field is not
changed. Documents whose target field already has content are skipped.

Options:
  --uid <uid>         Content type, for example api::article.article
  --from <field>      Source field (blocks, richtext, text, string or json)
  --to <field>        Target Magic Editor X field (top level)
  --format <format>   auto (default), blocks, markdown or html
  --locale <code>     Locale code, or * for every locale (default: default locale)
  --apply             Write the converted content (default: dry run)
  --overwrite         Also replace target fields that already have content
  --batch <n>         Documents per page, 1-500 (default 50)
  --limit <n>         Stop after n documents
  --json              Print the report as JSON
  --out <file>        Also write the JSON report to a file
  -h, --help          Show this help

Exit code 1 when an option is invalid or a document failed.`;

/**
 * Parses and validates the command line.
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ help: true } | { help: false, json: boolean, out?: string, options: object }} Parsed command.
 * @throws {Error} When an argument is invalid.
 */
export const parseCommand = (argv) => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      uid: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      format: { type: 'string' },
      locale: { type: 'string' },
      apply: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      batch: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return { help: true };
  if (positionals.length !== 1 || positionals[0] !== 'migrate')
    throw new Error('Unknown command (expected "migrate")');
  for (const name of ['uid', 'from', 'to']) if (!values[name]) throw new Error(`--${name} is required`);
  const integer = (name) => {
    if (values[name] === undefined) return undefined;
    if (!/^\d{1,7}$/.test(values[name])) throw new Error(`--${name} must be a positive integer`);
    return Number(values[name]);
  };
  const options = {
    uid: values.uid,
    from: values.from,
    to: values.to,
    format: values.format || 'auto',
    dryRun: !values.apply,
    overwrite: Boolean(values.overwrite),
  };
  if (values.locale) options.locale = values.locale;
  const batch = integer('batch');
  if (batch !== undefined) options.batchSize = batch;
  const limit = integer('limit');
  if (limit !== undefined) options.limit = limit;
  return { help: false, json: Boolean(values.json), out: values.out, options };
};

/**
 * Formats a report for people.
 * @param {object} report - Migration report.
 * @returns {string} Text.
 */
export const formatReport = (report) => {
  const lines = [
    `${report.dryRun ? 'Dry run' : 'Migration'}: ${report.uid} ${report.from} -> ${report.to} (format ${report.format})`,
    `  scanned           ${report.scanned}`,
    `  ${report.dryRun ? 'would convert' : 'converted    '}     ${report.converted}`,
    `  skipped (target)  ${report.skippedExisting}`,
    `  skipped (empty)   ${report.skippedEmpty}`,
    `  failed            ${report.failed.length}`,
    `  lossy             ${report.lossy.length}`,
  ];
  for (const entry of report.failed)
    lines.push(`  failed ${entry.documentId} ${entry.locale || '-'} ${entry.code}`);
  for (const entry of report.lossy)
    lines.push(`  lossy  ${entry.documentId} ${entry.locale || '-'} ${entry.notes.join(', ')}`);
  if (report.dryRun) lines.push('Nothing was written. Run again with --apply to convert.');
  return lines.join('\n');
};

/**
 * Runs the command.
 * @param {string[]} argv - Arguments.
 * @returns {Promise<number>} Exit code.
 */
export const main = async (argv) => {
  let command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}\n`);
    return 1;
  }
  if (command.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const projectRequire = createRequire(join(process.cwd(), 'package.json'));
  let core;
  try {
    core = projectRequire('@strapi/strapi');
  } catch {
    process.stderr.write(
      'Run this command from the root of a Strapi 5 project (@strapi/strapi was not found).\n'
    );
    return 1;
  }
  // Strapi logs to stdout. Keep stdout for the report only (machine-readable
  // with --json): everything Strapi prints goes to stderr.
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  const print = (text) => stdoutWrite(text);
  const appContext = await core.compileStrapi();
  const app = await core.createStrapi(appContext).load();
  let code;
  try {
    const plugin = app.plugin('magic-editor-x');
    if (!plugin)
      throw Object.assign(new Error('Magic Editor X is not installed in this project'), {
        code: 'NO_PLUGIN',
      });
    const report = await plugin.service('migrate').run(command.options);
    if (command.out) writeFileSync(command.out, `${JSON.stringify(report, null, 2)}\n`);
    print(`${command.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
    code = report.failed.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error && error.message ? error.message : 'Migration failed'}\n`);
    code = 1;
  } finally {
    await app.destroy();
    process.stdout.write = stdoutWrite;
  }
  return code;
};

/**
 * True when this file is the entry point (also through the npm bin symlink).
 * @returns {boolean} Result.
 */
const isEntryPoint = () => {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
};

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error && error.message ? error.message : 'Migration failed'}\n`);
      process.exit(1);
    }
  );
}

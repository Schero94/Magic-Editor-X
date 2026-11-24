#!/usr/bin/env node
/**
 * Browser benchmark of the editor field (`npm run bench:browser`).
 *
 * Starts a throw-away Strapi host (scripts/bench-browser/host.mjs: SQLite,
 * random secrets, loopback only, egress blocked), creates articles with
 * 1,000, 2,000 and 5,000 blocks through the Content Manager API and drives
 * the real admin edit view in headless Chromium (Playwright). Measures, per
 * size (scripts/bench-browser/scenarios.mjs explains how):
 *
 *   load        navigation to the editor ready and painted (median of 3)
 *   typing      key press to next paint, p50/p95/max, long tasks while typing
 *   enter       Enter to the new block painted
 *   paste       200 pasted blocks (HTML clipboard) until painted
 *   panels      Quality checks, Comments, Version history, Find and replace:
 *               More tools click to menu painted, item click to panel painted,
 *               longest task from the menu click until 2 s later
 *   save        Content Manager Save: click to request sent and to response
 *   heap        JS heap after forced garbage collection: after load and after
 *               1,000 key presses (2,000 blocks)
 *
 * Checks the results against scripts/bench-browser-budgets.json and prints a
 * table (also to $GITHUB_STEP_SUMMARY). A budget marked `enforce` fails the
 * run (exit 1) when `--enforce` is given; the others are reported only.
 *
 * Options:
 *   --sizes 1000,2000,5000   document sizes
 *   --suite perf|touch|all   perf (default), touch checks (touch.mjs) or both
 *   --tarball <file.tgz>     install the plugin from an npm pack tarball
 *                            (default: the built working copy)
 *   --base-url <url> --creds <file>   use a running host instead (creds.json
 *                            with { email, password } of a Super Admin)
 *   --port <n>               host port (default 1471)
 *   --out <file>             write the results as JSON
 *   --screenshots <dir>      touch suite: write screenshots there
 *   --enforce                exit 1 when an enforced budget fails
 *   --headed is not offered: the run is always headless.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startHost, registerAdmin, loginAdmin, createArticle } from './host.mjs';
import { makeDocument, makePasteHtml } from './documents.mjs';
import { EDITOR_DATA_LIMITS } from '../../shared/editor-data.mjs';
import {
  instrument,
  login,
  editUrl,
  openEditor,
  caretInMiddle,
  typeAndMeasure,
  enterAndMeasure,
  pasteAndMeasure,
  openPanel,
  saveAndMeasure,
  heapAfterGc,
  median,
  round,
} from './scenarios.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const SIZES = option('sizes', '1000,2000,5000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0 && value <= 5000);
const SUITE = option('suite', 'perf');
const PORT = Number(option('port', '1471'));
const PANELS = ['quality', 'comments', 'history', 'find'];
/** Blocks per field. */
const MAX_BLOCKS = EDITOR_DATA_LIMITS.maxBlocks;

const log = (line) => process.stderr.write(`${line}\n`);

/**
 * Value at a dotted path ("2000.typing.p95").
 * @param {object} object - Results.
 * @param {string} dotted - Path.
 * @returns {unknown} Value or undefined.
 */
const at = (object, dotted) =>
  dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);

/**
 * Runs the perf scenarios for one document size.
 * @param {import('playwright').Browser} browser - Browser.
 * @param {{ baseUrl: string, account: object, size: number, storageState: object }} options - Host, admin, size and the logged-in browser state.
 * @returns {Promise<object>} Results of this size.
 */
const runSize = async (browser, { baseUrl, account, size, storageState }) => {
  const document = makeDocument(size);
  // A field holds at most 5,000 blocks (EDITOR_DATA_LIMITS.maxBlocks; the live session refuses
  // more). The document that gets new blocks (Enter, paste) leaves room for them.
  const editSize = Math.min(size, MAX_BLOCKS - 40);
  const readDoc = await createArticle(baseUrl, account.token, {
    title: `Bench ${size} read`,
    body: document,
  });
  const editDoc = await createArticle(baseUrl, account.token, {
    title: `Bench ${size} edit`,
    body: makeDocument(editSize),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    storageState,
  });
  const loopback = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  await context.route(
    (url) => !loopback(url),
    (route) => route.abort()
  );
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 200)}`));
  const cdp = await context.newCDPSession(page);
  const result = { blocks: size };

  log(`[${size}] load`);
  const loads = [];
  for (let i = 0; i < 3; i += 1) loads.push(await openEditor(page, editUrl(baseUrl, readDoc), size));
  result.load = {
    readyMs: median(loads.map((load) => load.readyMs)),
    runs: loads.map((load) => load.readyMs),
    longTasks: {
      count: median(loads.map((load) => load.longTasks.count)),
      max: median(loads.map((load) => load.longTasks.max)),
    },
  };
  // Live regions inside the blocks make every modal menu or dialog (aria-hidden's hideOthers)
  // mark each block, and Editor.js then checks every block against every mutation (2.10.1).
  result.liveRegionsInBlocks = await page.evaluate(
    () => document.querySelectorAll('.codex-editor__redactor [aria-live]').length
  );

  log(`[${size}] panels`);
  result.panels = {};
  for (const name of PANELS) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      try {
        runs.push(await openPanel(page, name));
      } catch (error) {
        runs.push({ error: error.message });
        break;
      }
    }
    const ok = runs.filter((run) => !run.error);
    result.panels[name] = ok.length
      ? {
          menuMs: median(ok.map((run) => run.menuMs)),
          openMs: median(ok.map((run) => run.openMs)),
          longTaskMax: Math.max(...ok.map((run) => run.longTasks.max)),
          longTaskCount: median(ok.map((run) => run.longTasks.count)),
          frames: ok.reduce(
            (worst, run) =>
              run.longTasks.max > worst.max
                ? { max: run.longTasks.max, frames: run.longTasks.frames }
                : worst,
            { max: -1, frames: [] }
          ).frames,
        }
      : { error: runs[0].error };
  }

  log(`[${size}] typing`);
  await openEditor(page, editUrl(baseUrl, editDoc), editSize);
  result.editBlocks = editSize;
  // The live session syncs after the editor is ready; the baseline is taken once it settled.
  await page.waitForTimeout(3000);
  result.heap = { afterLoadMb: await heapAfterGc(cdp) };
  await caretInMiddle(page);
  result.typing = await typeAndMeasure(page, { count: 300, delay: 50 });
  if (size === 2000) {
    log(`[${size}] heap (1,000 key presses)`);
    await typeAndMeasure(page, { count: 700, delay: 30, settleMs: 2000 });
    result.heap.after1000KeysMb = await heapAfterGc(cdp);
    result.heap.growthMb = round(result.heap.after1000KeysMb - result.heap.afterLoadMb);
  }

  log(`[${size}] enter`);
  result.enter = await enterAndMeasure(page, 20);

  if (editSize + 40 + 200 <= MAX_BLOCKS) {
    log(`[${size}] paste`);
    await caretInMiddle(page, 0.3);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // The first pasted block replaces the empty paragraph: 200 pasted blocks add 199.
    result.paste = await pasteAndMeasure(page, makePasteHtml(200), 199);
  }

  log(`[${size}] save`);
  result.save = await saveAndMeasure(page);
  result.pageErrors = consoleErrors;
  await context.close();
  return result;
};

/**
 * Environment notes for the report.
 * @param {import('playwright').Browser} browser - Browser.
 * @returns {object} Metadata.
 */
const metadata = (browser) => {
  let commit = null;
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    // not a checkout
  }
  const pkg = (name) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  return {
    date: new Date().toISOString(),
    commit,
    plugin: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    strapi: pkg('@strapi/strapi'),
    editorjs: pkg('@editorjs/editorjs'),
    chromium: browser.version(),
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: `${os.cpus().length}x ${(os.cpus()[0] && os.cpus()[0].model) || 'unknown'}`,
    ci: Boolean(process.env.CI),
  };
};

/**
 * Compares the results with the budgets.
 * @param {object} results - Results per size (and touch).
 * @returns {Array<{ id: string, metric: string, value: unknown, max: number, pass: boolean|null, enforce: boolean }>} Checks.
 */
const checkBudgets = (results) => {
  const budgets = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'scripts', 'bench-browser-budgets.json'), 'utf8')
  );
  return budgets.budgets
    .filter((budget) => results[budget.metric.split('.')[0]] !== undefined)
    .map((budget) => {
      const value = at(results, budget.metric);
      const pass = typeof value === 'number' ? value <= budget.max : null;
      return {
        id: budget.id,
        metric: budget.metric,
        value: value === undefined ? null : value,
        max: budget.max,
        pass,
        enforce: Boolean(budget.enforce),
      };
    });
};

/**
 * Markdown report.
 * @param {object} report - Full report.
 * @returns {string} Markdown.
 */
const markdown = (report) => {
  const lines = [
    `### Magic Editor X browser benchmark`,
    '',
    `${report.meta.chromium} on ${report.meta.cpu}, ${report.meta.os}, Node ${report.meta.node}, commit ${report.meta.commit}`,
    '',
  ];
  const sizes = Object.keys(report.results).filter((key) => /^\d+$/.test(key));
  if (sizes.length) {
    lines.push(
      `| Measure | ${sizes.map((size) => `${Number(size).toLocaleString('en-US')} blocks`).join(' | ')} |`
    );
    lines.push(`| --- | ${sizes.map(() => '---:').join(' | ')} |`);
    const row = (label, read) =>
      lines.push(
        `| ${label} | ${sizes
          .map((size) => {
            const value = read(report.results[size]);
            return value === undefined || value === null ? '-' : value;
          })
          .join(' | ')} |`
      );
    row('Load until ready (ms)', (r) => r.load && r.load.readyMs);
    row('Typing p50 / p95 (ms)', (r) => r.typing && `${r.typing.p50} / ${r.typing.p95}`);
    row(
      'Long tasks while typing (count, max ms)',
      (r) => r.typing && `${r.typing.longTasks.count}, ${r.typing.longTasks.max}`
    );
    row('Enter p50 / p95 (ms)', (r) => r.enter && `${r.enter.p50} / ${r.enter.p95}`);
    row('Paste 200 blocks (ms)', (r) => r.paste && r.paste.ms);
    for (const name of PANELS)
      row(`Open ${name}: menu / panel (ms), longest task`, (r) => {
        const panel = r.panels && r.panels[name];
        if (!panel) return undefined;
        return panel.error
          ? `error: ${panel.error}`
          : `${panel.menuMs} / ${panel.openMs}, ${panel.longTaskMax}`;
      });
    row('Save: request / response (ms)', (r) => r.save && `${r.save.requestMs} / ${r.save.responseMs}`);
    row('JS heap after load, GC (MB)', (r) => r.heap && r.heap.afterLoadMb);
    row('JS heap growth, 1,000 keys, GC (MB)', (r) => r.heap && r.heap.growthMb);
    row('Live regions inside blocks', (r) => r.liveRegionsInBlocks);
  }
  if (report.results.touch) {
    lines.push('', '| Touch check | Device | Result | Detail |', '| --- | --- | --- | --- |');
    for (const check of report.results.touch.checks)
      lines.push(
        `| ${check.id} | ${check.device} | ${check.pass ? 'pass' : 'FAIL'} | ${String(check.detail || '').replace(/\|/g, '/')} |`
      );
  }
  lines.push('', '| Budget | Value | Max | Result |', '| --- | ---: | ---: | --- |');
  for (const check of report.budgets)
    lines.push(
      `| ${check.id} | ${check.value} | ${check.max} | ${check.pass === null ? 'n/a' : check.pass ? 'pass' : check.enforce ? 'FAIL' : 'over (reported)'} |`
    );
  return `${lines.join('\n')}\n`;
};

const main = async () => {
  let host = null;
  let account;
  let baseUrl = option('base-url', null);
  if (baseUrl) {
    const credsFile = option('creds', null);
    if (!credsFile) throw new Error('--base-url needs --creds <creds.json>');
    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    account = await loginAdmin(baseUrl, creds.admin || creds);
  } else {
    host = await startHost({ port: PORT, tarball: option('tarball', undefined), log });
    baseUrl = host.baseUrl;
    account = await registerAdmin(baseUrl);
  }
  const browser = await chromium.launch({ headless: true });
  const report = {
    meta: {
      ...metadata(browser),
      host: host ? 'throw-away' : baseUrl,
      hostBuildMs: host ? host.buildMs : null,
    },
    results: {},
  };
  try {
    // One login per run (the admin login is rate limited); the browser state (admin token) stays in memory.
    const loginContext = await browser.newContext();
    await login(await loginContext.newPage(), baseUrl, account);
    const storageState = await loginContext.storageState();
    await loginContext.close();
    if (SUITE === 'perf' || SUITE === 'all')
      for (const size of SIZES)
        report.results[size] = await runSize(browser, { baseUrl, account, size, storageState });
    if (SUITE === 'touch' || SUITE === 'all') {
      const { runTouch } = await import('./touch.mjs');
      report.results.touch = await runTouch({
        browser,
        baseUrl,
        account,
        storageState,
        screenshots: option('screenshots', null),
        log,
      });
    }
  } finally {
    await browser.close();
    if (host) await host.destroy();
  }
  report.budgets = checkBudgets(report.results);
  const text = markdown(report);
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  const out = option('out', null);
  if (out) fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  const touchFailed = report.results.touch && report.results.touch.checks.some((check) => !check.pass);
  const enforcedFailed = report.budgets.filter((check) => check.enforce && check.pass === false);
  if (flag('enforce') && (enforcedFailed.length || touchFailed)) {
    log(`Failed: ${enforcedFailed.map((check) => check.id).join(', ')}${touchFailed ? ' touch checks' : ''}`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  log(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

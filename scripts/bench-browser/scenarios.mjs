/**
 * Browser scenarios of `npm run bench:browser`: what is measured and how.
 *
 * Every page gets an init script (`instrument`) that records, with the
 * page's own clock (`performance.now()`, 0 = navigation start):
 *
 *   - long tasks (PerformanceObserver `longtask`, every main-thread task of
 *     50 ms or more) and long animation frames (`long-animation-frame`,
 *     with script attribution, for diagnosis only);
 *   - the moment the editor holder reports `aria-busy="false"` (Editor.js
 *     `onReady`, all blocks rendered) and the next paint after it;
 *   - per key press: the time from the `keydown` event (event.timeStamp) to
 *     the next frame after it was handled (requestAnimationFrame, then a
 *     MessageChannel task, which runs after the frame is presented). This is
 *     input-to-next-paint for a key, including Editor.js, the plugin's input
 *     handlers and any task that ran in between (the field's save);
 *   - `fetch` calls of the Content Manager (save timing).
 *
 * The JS heap is read through the Chrome DevTools Protocol after forcing a
 * garbage collection (`HeapProfiler.collectGarbage`, `Runtime.getHeapUsage`),
 * so the numbers are live objects, not garbage waiting to be collected.
 */

/**
 * Page init script (runs before any page script, in every document).
 * @returns {void}
 */
export const instrument = () => {
  const state = {
    longTasks: [],
    frames: [],
    keys: [],
    readyAt: null,
    readyPaintAt: null,
    fetches: [],
    pointerAt: 0,
  };
  window.__mexBench = state;
  const nextPaint = (callback) =>
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => callback(performance.now());
      channel.port2.postMessage(0);
    });
  state.nextPaint = nextPaint;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        state.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // not supported
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        state.frames.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: entry.blockingDuration,
          scripts: (entry.scripts || [])
            .filter((script) => script.duration >= 5)
            .map((script) => ({
              duration: Math.round(script.duration),
              invoker: script.invoker,
              fn: script.sourceFunctionName,
              source: String(script.sourceURL || '').replace(/^.*\//, '') + ':' + script.sourceCharPosition,
            })),
        });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    // not supported
  }
  window.addEventListener(
    'keydown',
    (event) => {
      const started = event.timeStamp;
      const key = event.key;
      nextPaint((now) =>
        state.keys.push({
          key,
          at: started,
          latency: now - started,
          blocks: document.querySelectorAll('.ce-block').length,
        })
      );
    },
    true
  );
  window.addEventListener('pointerdown', (event) => (state.pointerAt = event.timeStamp), true);
  const observeReady = () => {
    new MutationObserver((records) => {
      if (state.readyAt !== null) return;
      for (const record of records) {
        const target = record.target;
        if (
          target.getAttribute('data-testid') === 'magic-editor-x' &&
          target.getAttribute('aria-busy') === 'false'
        ) {
          state.readyAt = performance.now();
          nextPaint((now) => (state.readyPaintAt = now));
          return;
        }
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  };
  if (document.documentElement) observeReady();
  else document.addEventListener('readystatechange', observeReady, { once: true });
  const originalFetch = window.fetch;
  window.fetch = function benchFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    const entry = {
      url: String(url || ''),
      method: String(method).toUpperCase(),
      start: performance.now(),
      end: null,
      status: 0,
    };
    state.fetches.push(entry);
    const result = originalFetch.apply(this, arguments);
    result.then(
      (response) => {
        entry.end = performance.now();
        entry.status = response.status;
      },
      () => {
        entry.end = performance.now();
      }
    );
    return result;
  };
};

/**
 * Percentile of a list of numbers (nearest rank).
 * @param {number[]} values - Values.
 * @param {number} p - Percentile, 0 to 100.
 * @returns {number|null} Value, or null for an empty list.
 */
export const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

const round = (value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10);
const median = (values) => percentile(values, 50);

/**
 * Long tasks and the worst long animation frames between two page times.
 * @param {import('playwright').Page} page - Page.
 * @param {number} from - Start (page time).
 * @param {number} to - End (page time).
 * @returns {Promise<{ count: number, max: number, total: number, frames: object[] }>} Summary.
 */
const longTasksBetween = async (page, from, to) =>
  page.evaluate(
    ([start, end]) => {
      const state = window.__mexBench;
      const tasks = state.longTasks.filter((task) => task.start >= start && task.start <= end);
      const frames = state.frames
        .filter((frame) => frame.start >= start && frame.start <= end && frame.blocking > 0)
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3);
      return {
        count: tasks.length,
        max: tasks.reduce((max, task) => Math.max(max, task.duration), 0),
        total: tasks.reduce((sum, task) => sum + task.duration, 0),
        frames,
      };
    },
    [from, to]
  );

const now = (page) => page.evaluate(() => performance.now());
const blockCount = (page) => page.evaluate(() => document.querySelectorAll('.ce-block').length);

/**
 * Forces garbage collection and reads the used JS heap.
 * @param {import('playwright').CDPSession} cdp - DevTools session of the page.
 * @returns {Promise<number>} Used heap in MB.
 */
export const heapAfterGc = async (cdp) => {
  for (let i = 0; i < 3; i += 1) await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return Math.round((usedSize / 1048576) * 10) / 10;
};

/**
 * Logs in through the admin login form (the password never leaves this process except into the form).
 * @param {import('playwright').Page} page - Page.
 * @param {string} baseUrl - Host URL.
 * @param {{ email: string, password: string }} account - Credentials.
 * @returns {Promise<void>}
 */
export const login = async (page, baseUrl, account) => {
  await page.goto(`${baseUrl}/admin/auth/login`);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/auth/'), { timeout: 60000 });
};

/**
 * Edit view URL of an article.
 * @param {string} baseUrl - Host URL.
 * @param {string} documentId - Document id.
 * @returns {string} URL.
 */
export const editUrl = (baseUrl, documentId) =>
  `${baseUrl}/admin/content-manager/collection-types/api::article.article/${documentId}`;

/**
 * Opens the edit view and waits until the editor is ready.
 * @param {import('playwright').Page} page - Page.
 * @param {string} url - Edit view URL.
 * @param {number} expectedBlocks - Blocks of the document.
 * @returns {Promise<{ readyMs: number, blocks: number, longTasks: object }>} Load result.
 * @throws {Error} When the editor does not become ready or shows a different number of blocks.
 */
export const openEditor = async (page, url, expectedBlocks) => {
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__mexBench && window.__mexBench.readyPaintAt !== null, null, {
    timeout: 120000,
    polling: 100,
  });
  const result = await page.evaluate(() => ({
    readyMs: window.__mexBench.readyPaintAt,
    blocks: document.querySelectorAll('.ce-block').length,
  }));
  if (result.blocks !== expectedBlocks)
    throw new Error(`editor shows ${result.blocks} blocks, expected ${expectedBlocks}`);
  const longTasks = await longTasksBetween(page, 0, result.readyMs);
  return {
    readyMs: round(result.readyMs),
    blocks: result.blocks,
    longTasks: { count: longTasks.count, max: round(longTasks.max) },
  };
};

/**
 * Puts the caret at the end of the paragraph nearest to the middle of the document.
 * @param {import('playwright').Page} page - Page.
 * @param {number} [fraction=0.5] - Position in the document (0 to 1).
 * @returns {Promise<void>}
 */
export const caretInMiddle = async (page, fraction = 0.5) => {
  const index = await page.evaluate((at) => {
    const blocks = [...document.querySelectorAll('.ce-block')];
    let index = Math.floor(blocks.length * at);
    while (index < blocks.length && !blocks[index].querySelector('.ce-paragraph')) index += 1;
    blocks.forEach((block) => block.removeAttribute('data-bench-target'));
    blocks[index].setAttribute('data-bench-target', 'true');
    return index;
  }, fraction);
  const target = page.locator('[data-bench-target="true"] .ce-paragraph');
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  return index;
};

/**
 * Types `count` characters and measures each key press.
 * @param {import('playwright').Page} page - Page.
 * @param {{ count: number, delay: number, settleMs?: number }} options - Characters, delay between keys (ms), wait after typing.
 * @returns {Promise<{ keys: number, p50: number, p95: number, max: number, longTasks: object, settle: object }>} Result.
 */
export const typeAndMeasure = async (page, { count, delay, settleMs = 1500 }) => {
  const words = 'the valley is quiet in the morning and the river runs slowly ';
  const text = Array.from({ length: count }, (_, i) => words[i % words.length]).join('');
  await page.evaluate(() => (window.__mexBench.keys = []));
  const start = await now(page);
  await page.keyboard.type(text, { delay });
  const end = await now(page);
  await page.waitForTimeout(settleMs);
  const finished = await now(page);
  const latencies = await page.evaluate(() => window.__mexBench.keys.map((key) => key.latency));
  const typing = await longTasksBetween(page, start, end);
  const settle = await longTasksBetween(page, end, finished);
  return {
    keys: latencies.length,
    p50: round(percentile(latencies, 50)),
    p95: round(percentile(latencies, 95)),
    max: round(Math.max(...latencies)),
    longTasks: { count: typing.count, max: round(typing.max), frames: typing.frames },
    settle: { count: settle.count, max: round(settle.max) },
  };
};

/**
 * Presses Enter `count` times (each followed by two letters) and measures Enter to the painted new block.
 * @param {import('playwright').Page} page - Page.
 * @param {number} count - Repetitions.
 * @returns {Promise<{ presses: number, added: number, p50: number, p95: number, max: number, longTasks: object }>} Result.
 */
export const enterAndMeasure = async (page, count) => {
  const before = await blockCount(page);
  await page.evaluate(() => (window.__mexBench.keys = []));
  const start = await now(page);
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    await page.keyboard.type('ab', { delay: 40 });
    await page.waitForTimeout(120);
  }
  const end = await now(page);
  await page.waitForTimeout(800);
  const entries = await page.evaluate(() => window.__mexBench.keys.filter((key) => key.key === 'Enter'));
  const latencies = entries.map((entry) => entry.latency);
  const added = (await blockCount(page)) - before;
  const tasks = await longTasksBetween(page, start, end);
  return {
    presses: entries.length,
    added,
    p50: round(percentile(latencies, 50)),
    p95: round(percentile(latencies, 95)),
    max: round(Math.max(...latencies)),
    longTasks: { count: tasks.count, max: round(tasks.max), frames: tasks.frames },
  };
};

/**
 * Pastes HTML into the focused block (a `paste` event with a DataTransfer, as the browser sends it)
 * and measures until the new blocks are painted. Pasted into an empty paragraph, the first pasted
 * block replaces it, so the count grows by one less than the pasted blocks.
 * @param {import('playwright').Page} page - Page.
 * @param {string} html - Clipboard HTML.
 * @param {number} expected - Blocks the paste should add to the count.
 * @returns {Promise<{ added: number, ms: number, longTasks: object }>} Result.
 */
export const pasteAndMeasure = async (page, html, expected) => {
  const result = await page.evaluate(
    ([clipboardHtml, wanted]) =>
      new Promise((resolve) => {
        const state = window.__mexBench;
        const before = document.querySelectorAll('.ce-block').length;
        const target = document.activeElement;
        const data = new DataTransfer();
        data.setData('text/html', clipboardHtml);
        data.setData('text/plain', 'pasted');
        const start = performance.now();
        target.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
        );
        const deadline = start + 30000;
        const check = () => {
          const added = document.querySelectorAll('.ce-block').length - before;
          if (added >= wanted || performance.now() > deadline)
            state.nextPaint((painted) => resolve({ start, added, ms: painted - start }));
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    [html, expected]
  );
  await page.waitForTimeout(1500);
  const tasks = await longTasksBetween(page, result.start, result.start + result.ms + 1500);
  return {
    added: result.added,
    ms: round(result.ms),
    longTasks: { count: tasks.count, max: round(tasks.max), frames: tasks.frames },
  };
};

const PANELS = {
  quality: { tool: 'quality', selector: 'section[aria-label="Quality checks"]' },
  comments: { tool: 'comments', selector: '[data-testid="mex-comments-panel"]' },
  history: { tool: 'history', selector: '[role="dialog"]' },
  find: { tool: 'find', selector: 'section[aria-label="Find and replace"]' },
};

/**
 * Opens a field panel from "More tools" and measures: menu click to menu painted, item click to
 * panel painted, and long tasks from the menu click until 2 s later.
 * @param {import('playwright').Page} page - Page.
 * @param {keyof typeof PANELS} name - Panel.
 * @returns {Promise<{ menuMs: number, openMs: number, longTasks: object }>} Result.
 * @throws {Error} When the menu item or panel does not appear.
 */
export const openPanel = async (page, name) => {
  const panel = PANELS[name];
  const watch = (selector) =>
    page.evaluate(
      (wanted) =>
        new Promise((resolve) => {
          const state = window.__mexBench;
          const deadline = performance.now() + 15000;
          const check = () => {
            if (document.querySelector(wanted) || performance.now() > deadline)
              state.nextPaint((painted) =>
                resolve({
                  found: Boolean(document.querySelector(wanted)),
                  painted,
                  pointerAt: state.pointerAt,
                })
              );
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }),
      selector
    );
  const start = await now(page);
  const menuSeen = watch('[role="menu"]');
  await page.locator('[data-testid="mex-tools-menu"]').first().click();
  const menu = await menuSeen;
  if (!menu.found) throw new Error('the More tools menu did not open');
  const item = page.locator(`[data-testid="mex-tool-${panel.tool}"]`);
  if (!(await item.count())) throw new Error(`More tools has no ${panel.tool} entry`);
  const panelSeen = watch(panel.selector);
  await item.click();
  const opened = await panelSeen;
  if (!opened.found) throw new Error(`the ${name} panel did not open`);
  await page.waitForTimeout(2000);
  const tasks = await longTasksBetween(page, start, opened.painted + 2000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Panels close with their own button when Escape is taken by an inner control.
  if (await page.locator(panel.selector).count()) {
    const close = page.locator(`${panel.selector} button[aria-label^="Close"]`).first();
    if (await close.count()) await close.click();
  }
  await page.waitForTimeout(500);
  return {
    menuMs: round(menu.painted - menu.pointerAt),
    openMs: round(opened.painted - opened.pointerAt),
    longTasks: { count: tasks.count, max: round(tasks.max), frames: tasks.frames },
  };
};

/**
 * Clicks the Content Manager's Save and measures click to request sent and click to response.
 * @param {import('playwright').Page} page - Page.
 * @returns {Promise<{ requestMs: number, responseMs: number, status: number, bytes: number, longTasks: object }>} Result.
 * @throws {Error} When no save request is seen.
 */
export const saveAndMeasure = async (page) => {
  await page.evaluate(() => (window.__mexBench.fetches = []));
  const responded = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().includes('/content-manager/collection-types/'),
    { timeout: 60000 }
  );
  await page
    .getByRole('button', { name: /^Save$/ })
    .first()
    .click();
  const response = await responded;
  const bytes = (response.request().postData() || '').length;
  await page.waitForTimeout(500);
  const timing = await page.evaluate(() => {
    const state = window.__mexBench;
    const call = state.fetches.find(
      (entry) => entry.method === 'PUT' && entry.url.includes('/content-manager/collection-types/')
    );
    return call
      ? { pointerAt: state.pointerAt, start: call.start, end: call.end, status: call.status }
      : null;
  });
  if (!timing) throw new Error('no Content Manager save request');
  const tasks = await longTasksBetween(page, timing.pointerAt, timing.end || timing.start);
  return {
    requestMs: round(timing.start - timing.pointerAt),
    responseMs: round((timing.end || timing.start) - timing.pointerAt),
    status: timing.status,
    bytes,
    longTasks: { count: tasks.count, max: round(tasks.max), frames: tasks.frames },
  };
};

/**
 * Turns on "Changes since last publish" (2.12) through More tools, so the marker layer and its
 * idle-time classification run in every later measurement of this browser context.
 * @param {import('playwright').Page} page - Page with a ready editor.
 * @returns {Promise<number>} Changed-block marks shown.
 */
export const enablePublishedMarks = async (page) => {
  await page.locator('[data-testid="mex-tools-menu"]').first().click();
  // The entry is enabled once the field knows that a published version exists.
  const item = page.locator('[data-testid="mex-tool-publishedChanges"]:not([data-disabled])');
  await item.waitFor({ timeout: 15000 });
  if ((await item.getAttribute('aria-checked')) !== 'true') await item.click();
  else await page.keyboard.press('Escape');
  await page
    .locator('[data-testid="mex-published-changed"]')
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  return page.locator('[data-testid="mex-published-changed"]').count();
};

export { median, round };

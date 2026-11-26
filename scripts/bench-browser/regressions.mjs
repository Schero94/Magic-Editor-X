/**
 * Browser regression checks of the editor field (`npm run bench:browser -- --suite regressions`).
 *
 * Headless Chromium on the throw-away host, 1440 x 900, en-US:
 *
 *   fullscreen-<dialog>   in full screen, the dialog is painted above the full screen
 *                         frame (hit test with pointer events forced on, so the modal's
 *                         `pointer-events: none` on the page does not hide the frame),
 *                         focus is inside the dialog, Escape closes the dialog only and
 *                         focus comes back into the frame. Dialogs: AI for the selected
 *                         text, keyboard shortcuts, version history, import, export.
 *   fullscreen-menu       More tools opens above the frame.
 *   table-no-jump         when the caret leaves a table, the text below it does not move
 *                         (blocks keep their last size, `contain-intrinsic-size: auto`).
 *   table-triple-click    right after typing in a table cell, a fast triple click on a
 *                         later paragraph selects that paragraph (three runs).
 *
 * The AI dialog needs `ai.enabled`: `GET /magic-editor-x/config` is answered with
 * `ai.enabled: true` (page.route); the dialog is only opened, nothing is sent to a provider.
 */

import { instrument, editUrl, openEditor } from './scenarios.mjs';
import { createArticle } from './host.mjs';

/**
 * Synthetic document: heading, two paragraphs, a table, three paragraphs.
 * @returns {object} Editor.js document.
 */
const tableDocument = () => {
  const paragraph = (id, text) => ({ id, type: 'paragraph', data: { text } });
  return {
    time: 1767225600000,
    version: '2.31.7',
    blocks: [
      { id: 'h0', type: 'header', data: { text: 'Regression sample', level: 2 } },
      paragraph('p0', 'First paragraph: synthetic text before the table.'),
      paragraph('p1', 'Second paragraph: synthetic text before the table.'),
      {
        id: 't0',
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            ['Name', 'Value'],
            ['Alpha', '1'],
            ['Beta', '2'],
            ['Gamma', '3'],
          ],
        },
      },
      paragraph('q0', 'Later paragraph one: synthetic text after the table.'),
      paragraph('q1', 'Later paragraph two: synthetic text after the table.'),
      paragraph('q2', 'Later paragraph three: synthetic text after the table.'),
    ],
  };
};

/**
 * State of the newest open dialog that is not the full screen frame.
 * @param {import('playwright').Page} page - Page.
 * @returns {Promise<{ found: boolean, title?: string, onTop?: boolean, focusInside?: boolean }>} State.
 */
const dialogState = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector('.codex-editor')?.closest('[aria-modal="true"]') || null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(
      (node) => node !== frame && !(frame && frame.contains(node)) && node.getClientRects().length
    );
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return { found: false };
    // An open DS modal sets pointer-events: none on the page, which would hide the frame from
    // elementFromPoint. Forced on, the hit test follows the paint order.
    const style = document.createElement('style');
    style.textContent = '* { pointer-events: auto !important; }';
    document.head.appendChild(style);
    const rect = dialog.getBoundingClientRect();
    const points = [
      [rect.left + rect.width / 2, rect.top + Math.min(24, rect.height / 2)],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    const onTop = points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && dialog.contains(hit));
    });
    style.remove();
    return {
      found: true,
      title: ((dialog.querySelector('h2') || {}).textContent || '').trim(),
      onTop,
      focusInside: dialog.contains(document.activeElement),
    };
  });

/**
 * Where focus is after a dialog closed, and whether full screen is still on.
 * @param {import('playwright').Page} page - Page.
 * @returns {Promise<{ fullscreen: boolean, focusInFrame: boolean }>} State.
 */
const afterClose = (page) =>
  page.evaluate(() => {
    const frame = document.querySelector('.codex-editor')?.closest('[aria-modal="true"]') || null;
    return {
      fullscreen: Boolean(frame),
      focusInFrame: Boolean(frame && frame.contains(document.activeElement)),
    };
  });

/**
 * Runs the regression checks.
 * @param {{ browser: import('playwright').Browser, baseUrl: string, account: object, storageState: object, log?: (line: string) => void }} options - Browser, host, admin and logged-in state.
 * @returns {Promise<{ checks: Array<{ id: string, device: string, pass: boolean, detail: string }> }>} Results.
 */
export const runRegressions = async ({ browser, baseUrl, account, storageState, log = () => {} }) => {
  const checks = [];
  const device = 'Desktop 1440';
  const record = (id, pass, detail = '') => {
    checks.push({ id, device, pass: Boolean(pass), detail });
    log(`[regressions] ${id}: ${pass ? 'pass' : 'FAIL'} ${detail}`);
  };
  const doc = tableDocument();
  const documentId = await createArticle(baseUrl, account.token, { title: 'Regressions', body: doc });
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
  await context.route(
    (url) => url.pathname === '/magic-editor-x/config',
    async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (json && json.data && json.data.ai) json.data.ai.enabled = true;
      await route.fulfill({ response, json });
    }
  );
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const step = async (id, body) => {
    try {
      await body();
    } catch (error) {
      record(id, false, `error: ${String(error.message).split('\n')[0].slice(0, 160)}`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  };
  const open = async () => {
    await openEditor(page, editUrl(baseUrl, documentId), doc.blocks.length);
    await page.waitForTimeout(500);
  };

  // Full screen: dialogs above the frame.
  await open();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.locator('.codex-editor').first().waitFor();
  const checkDialog = async (id, opener, expectedTitle) => {
    await step(`fullscreen-${id}`, async () => {
      await opener();
      await page.waitForFunction(
        () => [...document.querySelectorAll('[role="dialog"] h2')].some((h) => h.getClientRects().length),
        null,
        { timeout: 10000 }
      );
      await page.waitForTimeout(400);
      const state = await dialogState(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const after = await afterClose(page);
      const pass =
        state.found &&
        state.onTop &&
        state.focusInside &&
        (!expectedTitle || state.title === expectedTitle) &&
        after.fullscreen &&
        after.focusInFrame;
      record(
        `fullscreen-${id}`,
        pass,
        `title "${state.title || '-'}", on top ${state.onTop}, focus inside ${state.focusInside}, full screen after Escape ${after.fullscreen}, focus back in the frame ${after.focusInFrame}`
      );
    });
  };
  const moreTools = (tool) => async () => {
    await page.locator('[data-testid="mex-tools-menu"]').first().click();
    await page.locator(`[data-testid="mex-tool-${tool}"]`).click();
  };
  await checkDialog(
    'ai-selection',
    async () => {
      const paragraph = page.locator('.ce-paragraph').first();
      await paragraph.click();
      await paragraph.click({ clickCount: 3 });
      await page.locator('.ce-inline-toolbar [data-item-name="aiAssistant"]').first().click();
    },
    'AI for the selected text'
  );
  await checkDialog('shortcuts', moreTools('shortcuts'));
  await checkDialog('history', moreTools('history'));
  await checkDialog('import', moreTools('import'));
  await checkDialog('export', moreTools('export'));
  await step('fullscreen-menu', async () => {
    await page.locator('[data-testid="mex-tools-menu"]').first().click();
    const onTop = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]');
      if (!menu) return false;
      const rect = menu.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && menu.contains(hit));
    });
    await page.keyboard.press('Escape');
    record('fullscreen-menu', onTop, `More tools menu on top ${onTop}`);
  });

  // Leaving a table: no jump, and a fast triple click selects the clicked paragraph.
  await step('table-no-jump', async () => {
    await open();
    await page.locator('.ce-block table [contenteditable="true"]').nth(3).click();
    await page.keyboard.type(' x');
    const moved = await page.evaluate(() => {
      const target = document.querySelectorAll('.ce-paragraph')[3];
      const before = target.getBoundingClientRect().top;
      target.focus();
      // Read synchronously: the same layout a click right after the focus change hits.
      const after = target.getBoundingClientRect().top;
      return Math.round(after - before);
    });
    record('table-no-jump', moved === 0, `text below the table moved ${moved}px when the caret left it`);
  });
  for (let run = 1; run <= 3; run += 1)
    await step(`table-triple-click-${run}`, async () => {
      await open();
      await page.locator('.ce-block table [contenteditable="true"]').nth(3).click();
      await page.keyboard.type(' typed');
      const target = page.locator('.ce-paragraph').nth(3 + (run % 2));
      const expected = (await target.textContent()).trim();
      await target.click({ clickCount: 3 });
      await page.waitForTimeout(200);
      const selected = await page.evaluate(() => String(window.getSelection()).trim());
      record(
        `table-triple-click-${run}`,
        selected === expected,
        `selected "${selected.slice(0, 48)}", expected "${expected.slice(0, 48)}"`
      );
    });
  await context.close();
  return { checks };
};

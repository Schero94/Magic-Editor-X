/**
 * Touch checks of the editor field (`npm run bench:browser -- --suite touch`).
 *
 * Runs the real admin edit view with Playwright device emulation and taps
 * through the editor, per engine (`--browsers`):
 *
 *   chromium   Pixel 7 and iPhone 13 descriptors in Chromium (viewport, device
 *              scale factor, `isMobile`, `hasTouch`, mobile user agent)
 *   webkit     iPhone 13 and iPad (gen 7) descriptors in Playwright's WebKit
 *              build, the engine of Safari (2.13); WebKit on the runner's
 *              desktop OS, not iOS Safari on a device
 *
 * Checks:
 *
 *   tap-caret        a tap puts the caret into the tapped paragraph
 *   toolbox          the "+" button opens the block toolbox; a tap inserts a heading
 *   block-menu       the block menu ("⋮⋮") opens by tap and Move up moves the block
 *   block-drag       2.13: hold "⋮⋮" and drag moves the block (touch Pointer Events,
 *                    dispatched by the script: Playwright cannot move a finger in WebKit)
 *   inline-toolbar   a text selection shows the inline toolbar; Bold applies by tap
 *   table            a tap edits a table cell; "Add row" works by tap
 *   more-tools       More tools opens inside the viewport, the Quality panel opens
 *                    as a bottom sheet, version history fills the screen
 *   keyboard         full screen editing follows the visual viewport (on-screen
 *                    keyboard): the frame shrinks to it and the caret stays visible
 *   targets          every control of the plugin's own UI is at least 44 x 44 px
 *   overflow         the page never scrolls sideways
 *   scroll           touch scroll through 2,000 blocks: long tasks, slow frames
 *
 * Emulation limits (stated in the report, not hidden): emulation opens no
 * on-screen keyboard, so `keyboard` replaces `window.visualViewport` with one
 * whose height the check controls; long-press text selection is not
 * emulated, so `inline-toolbar` selects text with the Selection API.
 * Scrolling: Chromium synthesises a touch scroll gesture through the
 * DevTools protocol (wheel steps where the headless shell ignores it);
 * Playwright's mobile WebKit has neither (its touchscreen only taps and it
 * refuses the mouse wheel), so `scroll` scrolls the page in steps there.
 */

import { instrument, editUrl, openEditor } from './scenarios.mjs';
import { createArticle } from './host.mjs';
import { makeDocument } from './documents.mjs';

/** Minimum touch target of the plugin's own controls (WCAG 2.5.5 Target Size, enhanced). */
export const TOUCH_TARGET_PX = 44;

/** Device descriptors per engine. */
export const TOUCH_DEVICES = Object.freeze({
  chromium: ['Pixel 7', 'iPhone 13'],
  webkit: ['iPhone 13', 'iPad (gen 7)'],
});

/**
 * Device descriptors of one engine (the iPhone descriptor defaults to WebKit; Chromium runs it too).
 * @param {object} devices - Playwright `devices`.
 * @param {'chromium'|'webkit'} engine - Browser engine.
 * @param {string[]} [names] - Descriptor names (default: the engine's list).
 * @returns {Array<{ name: string, options: object }>} Devices; WebKit names carry "(WebKit)".
 */
const deviceList = (devices, engine, names = TOUCH_DEVICES[engine]) =>
  names.map((name) => {
    if (!devices[name]) throw new Error(`unknown Playwright device "${name}"`);
    const { defaultBrowserType: _ignored, ...options } = devices[name];
    return { name: engine === 'webkit' ? `${name} (WebKit)` : name, options };
  });

/**
 * Scrolls an element to the middle of the viewport. `scrollIntoViewIfNeeded` may leave it at the
 * bottom edge, under the Content Manager's fixed Save/Publish bar on tablets, where a tap hits the bar.
 * @param {Element} element - Element (runs in the page).
 */
const centre = (element) => element.scrollIntoView({ block: 'center' });

/**
 * Taps the centre of the first element matching a selector (scrolls it into view first).
 * @param {import('playwright').Page} page - Page.
 * @param {string} selector - CSS selector.
 * @returns {Promise<boolean>} True when an element was tapped.
 */
const tapFirst = async (page, selector) => {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return false;
  await locator.scrollIntoViewIfNeeded();
  await locator.tap();
  return true;
};

/**
 * Rectangle of the first visible element matching a selector, and whether it fits the viewport.
 * @param {import('playwright').Page} page - Page.
 * @param {string} selector - CSS selector.
 * @returns {Promise<{ found: boolean, inside?: boolean, rect?: object }>} Result.
 */
const fits = (page, selector) =>
  page.evaluate((wanted) => {
    const element = [...document.querySelectorAll(wanted)].find((node) => node.getClientRects().length);
    if (!element) return { found: false };
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
    const inside =
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= viewport.width + 1 &&
      rect.bottom <= viewport.height + 1;
    return {
      found: true,
      inside,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }, selector);

/**
 * Controls of the plugin's own UI inside the field (and its sheets) smaller than the touch target.
 * Editor.js core controls (toolbar "+", "⋮⋮", popover items, inline toolbar) are counted separately.
 * @param {import('playwright').Page} page - Page.
 * @param {number} min - Minimum size in CSS px.
 * @returns {Promise<{ own: string[], core: string[] }>} Too small controls (descriptions).
 */
const smallTargets = (page, min) =>
  page.evaluate((size) => {
    const describe = (element) => {
      const name =
        element.getAttribute('aria-label') || element.textContent.trim().slice(0, 30) || element.className;
      const rect = element.getBoundingClientRect();
      return `${element.tagName.toLowerCase()} "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    };
    const roots = [...document.querySelectorAll('[data-mex-frame], [data-mex-sheet], [role="dialog"]')];
    const controls = new Set();
    for (const root of roots)
      for (const element of root.querySelectorAll(
        'button, [role="button"], a[href], [role="menuitem"], [role="tab"], select'
      ))
        // Links in the text, form toggles (their label is the target) and the gutter markers
        // (fixed 32 px columns, documented exception) are not counted.
        if (
          !element.closest('[contenteditable="true"]') &&
          !element.closest('[data-testid$="-markers"], [data-testid="mex-published-marks"]') &&
          !/^(checkbox|switch|radio)$/.test(element.getAttribute('role') || '')
        )
          controls.add(element);
    for (const element of document.querySelectorAll(
      '[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]'
    ))
      controls.add(element);
    const own = [];
    const core = [];
    for (const element of controls) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || element.closest('[aria-hidden="true"], [inert]')) continue;
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      if (rect.width + 0.5 >= size && rect.height + 0.5 >= size) continue;
      const isCore = element.closest('.ce-toolbar, .ce-popover, .ce-inline-toolbar, .ce-conversion-toolbar');
      (isCore ? core : own).push(describe(element));
    }
    return { own, core };
  }, min);

/**
 * Runs the touch checks.
 * @param {{ browser: import('playwright').Browser, engine?: 'chromium'|'webkit', devices?: string|null, baseUrl: string, account: object, storageState: object, screenshots?: string|null, log?: Function }} options - Browser and its engine, host, login and output.
 * @returns {Promise<{ checks: Array<{ id: string, device: string, pass: boolean, detail: string }>, notes: string[] }>} Results.
 */
export const runTouch = async ({
  browser,
  engine = 'chromium',
  devices: deviceNames = null,
  baseUrl,
  account,
  storageState,
  screenshots = null,
  log = () => {},
}) => {
  const { devices } = await import('playwright');
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
  const checks = [];
  const shortDoc = makeDocument(300);
  const longDoc = makeDocument(2000);

  const names = deviceNames
    ? String(deviceNames)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : undefined;
  for (const device of deviceList(devices, engine, names)) {
    const editId = await createArticle(baseUrl, account.token, {
      title: `Touch ${device.name}`,
      body: shortDoc,
    });
    const scrollId = await createArticle(baseUrl, account.token, {
      title: `Touch scroll ${device.name}`,
      body: longDoc,
    });
    const context = await browser.newContext({ ...device.options, storageState, locale: 'en-US' });
    const loopback = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    await context.route(
      (url) => !loopback(url),
      (route) => route.abort()
    );
    await context.addInitScript(instrument);
    const page = await context.newPage();
    const slug = device.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const shot = async (name) => {
      if (screenshots)
        await page.screenshot({
          path: path.join(screenshots, `touch-${slug}-${name}.png`),
          animations: 'disabled',
          caret: 'hide',
        });
    };
    const record = (id, pass, detail = '') => {
      checks.push({ id, device: device.name, pass: Boolean(pass), detail });
      log(`[touch ${device.name}] ${id}: ${pass ? 'pass' : 'FAIL'} ${detail}`);
    };
    const step = async (id, body) => {
      try {
        await body();
      } catch (error) {
        record(id, false, `error: ${String(error.message).split('\n')[0].slice(0, 160)}`);
        await page.keyboard.press('Escape').catch(() => {});
      }
    };

    await openEditor(page, editUrl(baseUrl, editId), shortDoc.blocks.length);
    await page.waitForTimeout(500);
    await shot('field');

    await step('tap-caret', async () => {
      const target = page.locator('.ce-block .ce-paragraph').nth(3);
      await target.evaluate(centre);
      await target.tap({ position: { x: 20, y: 8 } });
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const selection = window.getSelection();
        const active = document.activeElement;
        return {
          editable: Boolean(active && active.isContentEditable && active.classList.contains('ce-paragraph')),
          caret: Boolean(
            selection &&
            selection.rangeCount &&
            selection.isCollapsed &&
            active.contains(selection.anchorNode)
          ),
        };
      });
      record('tap-caret', state.editable && state.caret, JSON.stringify(state));
    });

    await step('toolbox', async () => {
      const before = await page.locator('.ce-block').count();
      const plus = await fits(page, '.ce-toolbar__plus');
      if (!plus.found) throw new Error('no "+" button after the tap');
      await tapFirst(page, '.ce-toolbar__plus');
      await page.waitForTimeout(300);
      const popover = await fits(page, '.ce-popover--opened .ce-popover__container');
      await shot('toolbox');
      await tapFirst(page, '.ce-popover--opened [data-item-name="header"]');
      await page.waitForTimeout(300);
      const after = await page.locator('.ce-block').count();
      const screen = await page.evaluate(() => ({
        inner: window.innerHeight,
        visual: Math.round(window.visualViewport ? window.visualViewport.height : 0),
      }));
      record(
        'toolbox',
        popover.found && popover.inside && after === before + 1,
        `popover ${JSON.stringify(popover.rect)} inside=${popover.inside}, blocks +${after - before}, viewport ${JSON.stringify(screen)}`
      );
    });

    await step('block-menu', async () => {
      const target = page.locator('.ce-block .ce-paragraph').nth(6);
      await target.evaluate(centre);
      await target.tap({ position: { x: 20, y: 8 } });
      await page.waitForTimeout(300);
      const id = await page.evaluate(() => {
        const block = document.activeElement && document.activeElement.closest('.ce-block');
        return block ? [...document.querySelectorAll('.ce-block')].indexOf(block) : -1;
      });
      await tapFirst(page, '.ce-toolbar__settings-btn');
      await page.waitForTimeout(300);
      const menu = await fits(page, '.ce-popover--opened .ce-popover__container');
      await shot('block-menu');
      const moved = await tapFirst(page, '.ce-popover--opened [data-item-name="move-up"]');
      await page.waitForTimeout(400);
      const text = await page
        .locator('.ce-block')
        .nth(id - 1)
        .innerText();
      await page.keyboard.press('Escape');
      record(
        'block-menu',
        menu.found && menu.inside && moved && /Paragraph/.test(text),
        `menu ${JSON.stringify(menu.rect)} inside=${menu.inside}, moved=${moved}`
      );
    });

    await step('block-drag', async () => {
      const target = page.locator('.ce-block .ce-paragraph').nth(10);
      await target.evaluate(centre);
      await target.tap({ position: { x: 20, y: 8 } });
      await page.waitForTimeout(300);
      const result = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const all = () => [...document.querySelectorAll('.ce-block')];
        const block = document.activeElement && document.activeElement.closest('.ce-block');
        const from = all().indexOf(block);
        // textContent, not innerText: WebKit renders no text for blocks skipped by content-visibility.
        const text = block ? block.textContent.slice(0, 40) : '';
        const handle = document.querySelector('.ce-toolbar__settings-btn');
        if (!handle || from < 0) return { from, error: 'no handle or block' };
        const hr = handle.getBoundingClientRect();
        const below = all()[from + 2].getBoundingClientRect();
        const point = (type, y) =>
          handle.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 41,
              pointerType: 'touch',
              isPrimary: true,
              clientX: hr.left + hr.width / 2,
              clientY: y,
            })
          );
        point('pointerdown', hr.top + hr.height / 2);
        await wait(450);
        const dragging = Boolean(document.querySelector('.ce-block.mex-dragging'));
        point('pointermove', below.top + below.height * 0.75);
        await wait(50);
        const line = Boolean(document.querySelector('.mex-drop-after, .mex-drop-before'));
        point('pointerup', below.top + below.height * 0.75);
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        handle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await wait(400);
        const to = all().findIndex((node) => node.textContent.slice(0, 40) === text);
        return {
          from,
          to,
          dragging,
          line,
          menuOpen: Boolean(
            document.querySelector(
              '.ce-settings .ce-popover--opened, .ce-popover--opened[data-mex-tunes], .ce-toolbar .ce-popover--opened'
            )
          ),
        };
      });
      await shot('block-drag');
      await page.keyboard.press('Escape');
      record(
        'block-drag',
        result.dragging && result.line && result.to === result.from + 2 && !result.menuOpen,
        JSON.stringify(result)
      );
    });

    await step('inline-toolbar', async () => {
      const selected = await page.evaluate(() => {
        const paragraph = document.querySelectorAll('.ce-block .ce-paragraph')[8];
        paragraph.scrollIntoView({ block: 'center' });
        paragraph.focus();
        const text = paragraph.firstChild;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 9);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return selection.toString();
      });
      await page.waitForTimeout(500);
      const toolbar = await fits(page, '.ce-inline-toolbar .ce-popover--opened .ce-popover__container');
      await shot('inline-toolbar');
      const tapped = await tapFirst(page, '.ce-inline-toolbar [data-item-name="bold"]');
      await page.waitForTimeout(300);
      const bold = await page.evaluate(() =>
        /<b>Paragraph<\/b>/.test(document.querySelectorAll('.ce-block .ce-paragraph')[8].innerHTML)
      );
      record(
        'inline-toolbar',
        toolbar.found && toolbar.inside && tapped && bold,
        `selected "${selected}", toolbar ${JSON.stringify(toolbar.rect)} inside=${toolbar.inside}, bold=${bold}`
      );
    });

    const targetsSeen = { own: new Set(), core: 0 };
    const collectTargets = async () => {
      const result = await smallTargets(page, TOUCH_TARGET_PX);
      result.own.forEach((entry) => targetsSeen.own.add(entry));
      targetsSeen.core = Math.max(targetsSeen.core, result.core.length);
    };
    await collectTargets();

    await step('table', async () => {
      const cell = page.locator('.mex-table-tool [contenteditable="true"]').nth(2);
      await cell.evaluate(centre);
      await cell.tap();
      await page.waitForTimeout(300);
      // Reported: whether the first tap focused the cell (WebKit on Linux did not always).
      const focused = await cell.evaluate(
        (node) => node === document.activeElement || node.contains(document.activeElement)
      );
      await page.keyboard.type(' touched');
      const typed = await cell.textContent();
      const rowsBefore = await page.locator('.mex-table-tool').first().locator('tr').count();
      await collectTargets();
      await shot('table');
      const added = await tapFirst(page, '.mex-table-tool button[data-action="rowBelow"]');
      await page.waitForTimeout(300);
      const rowsAfter = await page.locator('.mex-table-tool').first().locator('tr').count();
      record(
        'table',
        /touched/.test(typed) && added && rowsAfter > rowsBefore,
        `focused=${focused}, typed=${/touched/.test(typed)}, rows ${rowsBefore} -> ${rowsAfter}`
      );
    });

    await step('more-tools', async () => {
      const trigger = page.locator('[data-testid="mex-tools-menu"]').first();
      await trigger.scrollIntoViewIfNeeded();
      await trigger.tap();
      await page.waitForTimeout(400);
      const menu = await fits(page, '[role="menu"]');
      await collectTargets();
      await shot('more-tools');
      await tapFirst(page, '[data-testid="mex-tool-quality"]');
      await page.waitForTimeout(800);
      const panel = await fits(page, 'section[aria-label="Quality checks"]');
      const sheet = await page.evaluate(() => {
        const slot = document.querySelector('[data-mex-sheet]');
        if (!slot) return { fixed: false };
        const rect = slot.getBoundingClientRect();
        return {
          fixed: window.getComputedStyle(slot).position === 'fixed',
          bottomGap: Math.round(window.innerHeight - rect.bottom),
          heightShare: Math.round((rect.height / window.innerHeight) * 100) / 100,
        };
      });
      await collectTargets();
      await shot('quality-panel');
      const close = page.getByRole('button', { name: /^Close quality/i }).first();
      const closed = (await close.count()) > 0;
      if (closed) await close.tap();
      await page.waitForTimeout(300);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.tap();
      await page.waitForTimeout(400);
      await tapFirst(page, '[data-testid="mex-tool-history"]');
      await page.waitForTimeout(1200);
      const dialog = await fits(page, '[role="dialog"]');
      await collectTargets();
      await shot('history');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      record(
        'more-tools',
        menu.found &&
          menu.inside &&
          panel.found &&
          panel.inside &&
          // Panels are bottom sheets below the DS small breakpoint (520 px); wider screens show them in the page.
          (sheet.fixed || page.viewportSize().width >= 520) &&
          dialog.found &&
          dialog.inside &&
          closed,
        `menu ${JSON.stringify(menu.rect)} inside=${menu.inside}; quality sheet ${JSON.stringify(sheet)} inside=${panel.inside}; history ${JSON.stringify(dialog.rect)} inside=${dialog.inside}; closed=${closed}`
      );
    });

    await step('targets', async () => {
      await collectTargets();
      const own = [...targetsSeen.own];
      record(
        'targets',
        own.length === 0,
        `own controls below ${TOUCH_TARGET_PX}px (field, table tool, More tools, sheet, dialog): ${own.slice(0, 8).join('; ') || 'none'}; Editor.js core: ${targetsSeen.core}`
      );
    });

    await step('overflow', async () => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      record('overflow', overflow <= 0, `documentOverflow ${overflow}`);
    });

    await step('keyboard', async () => {
      // An on-screen keyboard shrinks the visual viewport, not the layout viewport. Emulation opens
      // no keyboard, so window.visualViewport is replaced by one whose height the check controls.
      await page.evaluate(() => {
        const original = window.visualViewport;
        const fake = new EventTarget();
        fake.keyboard = 0;
        for (const key of ['width', 'offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'scale'])
          Object.defineProperty(fake, key, { get: () => original[key] });
        Object.defineProperty(fake, 'height', { get: () => original.height - fake.keyboard });
        Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
        window.__mexFakeViewport = fake;
      });
      const full = page.getByRole('button', { name: 'Full screen', exact: true }).first();
      await full.scrollIntoViewIfNeeded();
      await full.tap();
      await page.waitForTimeout(400);
      const target = page.locator('[data-mex-frame] .ce-block .ce-paragraph').nth(20);
      await target.evaluate(centre);
      await target.tap({ position: { x: 20, y: 8 } });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const fake = window.__mexFakeViewport;
        fake.keyboard = Math.round(window.innerHeight * 0.42);
        fake.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(400);
      // The caret's block is scrolled into the visible part, as the browser does when it opens a keyboard.
      await page.evaluate(() => {
        const block = document.activeElement && document.activeElement.closest('.ce-block');
        if (block) block.scrollIntoView({ block: 'nearest' });
      });
      await page.waitForTimeout(200);
      const state = await page.evaluate(() => {
        const frame = document.querySelector('[data-mex-frame]');
        const rect = frame.getBoundingClientRect();
        const caret = document.activeElement && document.activeElement.getBoundingClientRect();
        const visible = window.visualViewport.height;
        return {
          frameTop: Math.round(rect.top),
          frameBottom: Math.round(rect.bottom),
          visible: Math.round(visible),
          caretVisible: Boolean(caret && caret.top >= rect.top && caret.bottom <= visible + 1),
        };
      });
      await shot('keyboard');
      await page.getByRole('button', { name: 'Exit full screen', exact: true }).first().tap();
      await page.waitForTimeout(300);
      record('keyboard', state.frameBottom <= state.visible + 1 && state.caretVisible, JSON.stringify(state));
    });

    await step('scroll', async () => {
      await openEditor(page, editUrl(baseUrl, scrollId), longDoc.blocks.length);
      await page.waitForTimeout(800);
      // The DevTools protocol exists in Chromium only.
      const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
      await page.evaluate(() => {
        const state = window.__mexBench;
        // The page scrolls in the document or in the nearest scrollable ancestor of the field.
        let scroller = document.querySelector('[data-mex-frame]');
        while (scroller && scroller !== document.body) {
          const style = window.getComputedStyle(scroller);
          if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
          scroller = scroller.parentElement;
        }
        state.scroller = scroller && scroller !== document.body ? scroller : document.scrollingElement;
        state.scrollTop0 = state.scroller.scrollTop;
        state.frameTimes = [];
        const tick = (time) => {
          state.frameTimes.push(time);
          if (!state.stopFrames) requestAnimationFrame(tick);
        };
        state.stopFrames = false;
        requestAnimationFrame(tick);
        state.scrollStart = performance.now();
      });
      const viewport = page.viewportSize();
      let method = 'touch gesture';
      if (cdp)
        await cdp.send('Input.synthesizeScrollGesture', {
          x: Math.round(viewport.width / 2),
          y: Math.round(viewport.height * 0.7),
          yDistance: -6000,
          speed: 3000,
          gestureSourceType: 'touch',
          repeatCount: 1,
        });
      else {
        // WebKit: no gesture API and no wheel in mobile emulation; 40 steps of 150 px, one per frame.
        method = 'scripted scroll steps (WebKit has no touch scroll gesture in Playwright)';
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const state = window.__mexBench;
              let step = 0;
              const next = () => {
                state.scroller.scrollTop += 150;
                step += 1;
                if (step < 40) requestAnimationFrame(next);
                else setTimeout(resolve, 300);
              };
              requestAnimationFrame(next);
            })
        );
      }
      // chromium-headless-shell (CI) ignores synthesized touch gestures: scroll with wheel steps then.
      const moved = await page.evaluate(() => {
        const state = window.__mexBench;
        return state.scroller.scrollTop - state.scrollTop0;
      });
      if (cdp && moved < 1000) {
        method = 'wheel (touch gesture not supported by this browser build)';
        await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height * 0.6));
        for (let step = 0; step < 40; step += 1) {
          await page.mouse.wheel(0, 150);
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(300);
      }
      const result = await page.evaluate(() => {
        const state = window.__mexBench;
        state.stopFrames = true;
        const end = performance.now();
        const gaps = state.frameTimes
          .slice(1)
          .map((time, index) => time - state.frameTimes[index])
          .sort((a, b) => a - b);
        const tasks = state.longTasks.filter((task) => task.start >= state.scrollStart && task.start <= end);
        return {
          scrolled: Math.round(state.scroller.scrollTop - state.scrollTop0),
          frames: gaps.length,
          p95FrameMs: gaps.length
            ? Math.round(gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)] * 10) / 10
            : null,
          slowFrames: gaps.filter((gap) => gap > 50).length,
          longTasks: tasks.length,
          maxLongTask: Math.round(tasks.reduce((max, task) => Math.max(max, task.duration), 0)),
        };
      });
      result.method = method;
      // Pass: the page scrolls; frame times and long tasks are reported (timing varies by machine).
      record('scroll', result.scrolled > 1000, JSON.stringify(result));
    });

    await context.close();
  }
  return {
    checks,
    notes:
      engine === 'webkit'
        ? [
            "WebKit (Safari's engine) in Playwright with the iPhone 13 and iPad (gen 7) descriptors, on the runner's OS; iOS Safari on real devices is not covered.",
            'WebKit: the scroll check scrolls in scripted steps (Playwright has no touch scroll gesture and no mouse wheel for mobile WebKit).',
          ]
        : [
            'Chromium device emulation (Pixel 7, iPhone 13 descriptors); real devices are not covered.',
            'No on-screen keyboard in emulation: the keyboard check shrinks window.visualViewport.',
            'Long-press selection is not emulated: the inline toolbar check selects text with the Selection API.',
          ],
  };
};

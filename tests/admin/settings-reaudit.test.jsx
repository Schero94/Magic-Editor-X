/**
 * Settings pages re-audit (2.7.8, findings of the independent UI re-audit of 2.7.6): unsaved work
 * in the custom block dialog, focus after actions, the LanguageTool test without a URL, no list
 * requests without permission, inline range errors, the DS date picker in the audit filters and
 * the import report. StrictMode with the real Strapi admin providers (harness/index.jsx).
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { checkStrictEntry, network } from './harness/index.jsx';
import { ALL, pluginRoutes, settingsDto, waitFor } from './fixtures.mjs';
import ConfigurationPage from '../../admin/src/pages/ConfigurationPage';
import CustomBlocksPage from '../../admin/src/pages/CustomBlocksPage';
import TemplatesPage from '../../admin/src/pages/TemplatesPage';
import AuditPage from '../../admin/src/pages/AuditPage';

const CUSTOM_BLOCKS = '/settings/magic-editor-x/custom-blocks';
// Toasts (useNotification) are rendered by sonner inside Strapi's NotificationsProvider; each
// toast listens to visibilitychange until it expires, after the page is gone.
const TOASTS = [{ match: /document:visibilitychange lib:sonner\//, reason: 'admin toasts (sonner)' }];

/** @returns {Element|null} The open (non-alert) dialog. */
const dialog = () => document.querySelector('[role="dialog"]');
/** @returns {Element|null} The open confirmation. */
const alertDialog = () => document.querySelector('[role="alertdialog"]');

/**
 * Button by its visible text or accessible name.
 * @param {string} name - Text.
 * @param {ParentNode} [root] - Scope.
 * @returns {HTMLButtonElement|undefined} Button.
 */
const button = (name, root = document) =>
  [...root.querySelectorAll('button')].find(
    (el) => el.textContent.trim() === name || el.getAttribute('aria-label') === name
  );

const click = (el) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });

const key = (el, name) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });

/**
 * Types into a controlled input or textarea the way React sees it.
 * @param {HTMLInputElement|HTMLTextAreaElement} el - Field.
 * @param {string} value - New value.
 */
const type = (el, value) =>
  act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const focus = (el) =>
  act(async () => {
    el.focus();
  });

const blur = (el) =>
  act(async () => {
    el.blur();
  });

const describedText = (input) =>
  (input.getAttribute('aria-describedby') || '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' | ');

test('custom block dialog: closing typed work asks first, Cancel keeps it, Discard returns focus to the trigger', async () => {
  pluginRoutes();
  await checkStrictEntry(<CustomBlocksPage />, {
    path: CUSTOM_BLOCKS,
    permissions: ALL,
    allowLeaks: TOASTS,
    whileMounted: async () => {
      const create = button('Create block');
      await focus(create);
      await click(create);
      await waitFor(() => dialog(), 'the create dialog');

      // A clean form closes at once on Escape and focus goes back to "Create block".
      await key(document.activeElement, 'Escape');
      await waitFor(() => !dialog(), 'the clean dialog to close');
      await waitFor(() => document.activeElement === create, 'focus back on Create block');

      await click(create);
      await waitFor(() => dialog(), 'the create dialog again');
      const label = dialog().querySelector('input[name="label"]');
      await focus(label);
      await type(label, 'Synthetic block');
      for (const close of ['Escape', 'Close', 'Cancel']) {
        if (close === 'Escape') await key(label, 'Escape');
        else await click(button(close, dialog()));
        await waitFor(() => alertDialog(), `the discard question after ${close}`);
        assert.ok(dialog(), `${close}: the form stays open while the question is shown`);
        assert.match(alertDialog().textContent, /Discard your changes\?/);
        await click(button('Cancel', alertDialog()));
        await waitFor(() => !alertDialog(), 'the question to close');
        assert.equal(dialog().querySelector('input[name="label"]').value, 'Synthetic block');
        await waitFor(() => document.activeElement === label, `${close}: focus back in the label field`);
      }

      await key(label, 'Escape');
      await waitFor(() => alertDialog(), 'the discard question');
      await click(button('Discard changes', alertDialog()));
      await waitFor(() => !dialog() && !alertDialog(), 'both dialogs to close');
      await waitFor(() => document.activeElement === create, 'focus back on Create block');
      assert.equal(
        network.calls.filter(
          (call) => call.method === 'POST' && call.pathname === '/magic-editor-x/custom-blocks'
        ).length,
        0,
        'discarding creates nothing'
      );
    },
  });
});

test('custom block and template switches stay enabled and focused while saving; a second toggle works', async () => {
  const delayed = (body) => () => new Promise((resolve) => setTimeout(() => resolve({ data: body() }), 40));
  const states = { block: true, template: true };
  // unmount() forgets the routes, so each page installs them again.
  const routes = () => {
    pluginRoutes();
    network.on(
      'PUT',
      '/magic-editor-x/custom-blocks/cb-callout',
      delayed(() => ({
        id: 'cb-callout',
        name: 'callout',
        label: 'Callout',
        blockType: 'simple',
        enabled: (states.block = !states.block),
      }))
    );
    network.on(
      'PUT',
      '/magic-editor-x/templates/tpl-1',
      delayed(() => ({
        id: 'tpl-1',
        name: 'Release note',
        kind: 'template',
        enabled: (states.template = !states.template),
        scope: { all: true },
        blocks: { blocks: [] },
        blockCount: 0,
      }))
    );
  };
  for (const [ui, path, name] of [
    [<CustomBlocksPage key="cb" />, CUSTOM_BLOCKS, 'Show Callout in the editor toolbox'],
    [<TemplatesPage key="tpl" />, '/settings/magic-editor-x/templates', 'Offer Release note in the editor'],
  ]) {
    routes();
    await checkStrictEntry(ui, {
      path,
      permissions: ALL,
      allowLeaks: TOASTS,
      whileMounted: async () => {
        const sw = () => document.querySelector(`[role="switch"][aria-label="${name}"]`);
        await waitFor(() => sw(), name);
        await focus(sw());
        await click(sw());
        assert.equal(sw().disabled, false, `${name}: not disabled while the request runs`);
        assert.equal(document.activeElement, sw(), `${name}: focus stays on the switch`);
        await waitFor(() => sw().getAttribute('aria-checked') === 'false', `${name} off`);
        assert.equal(document.activeElement, sw(), `${name}: focus after the answer`);
        await click(sw());
        await waitFor(() => sw().getAttribute('aria-checked') === 'true', `${name} on again`);
        assert.equal(document.activeElement, sw());
      },
    });
  }
});

test('Templates and Custom blocks without permission: no list request (no 403 in the console)', async () => {
  for (const [ui, path, prefix] of [
    [<TemplatesPage key="tpl" />, '/settings/magic-editor-x/templates', '/magic-editor-x/templates'],
    [<CustomBlocksPage key="cb" />, CUSTOM_BLOCKS, '/magic-editor-x/custom-blocks'],
  ]) {
    pluginRoutes();
    const result = await checkStrictEntry(ui, { path, permissions: [] });
    assert.equal(
      result.calls.filter(
        (call) => call.pathname.startsWith(prefix) || call.pathname === '/magic-editor-x/content-types'
      ).length,
      0,
      `${prefix}: nothing requested before the permission check`
    );
    assert.match(result.html, /permissions/i);
  }
});

test('Configuration: Test LanguageTool without a URL marks the field; range errors show on blur; Save keeps focus off <body>', async () => {
  pluginRoutes();
  network.on('PUT', '/magic-editor-x/settings', (call) => {
    const dto = settingsDto();
    Object.assign(dto.ai, call.json().ai);
    return { data: dto };
  });
  await checkStrictEntry(<ConfigurationPage />, {
    path: '/settings/magic-editor-x/configuration',
    permissions: ALL,
    allowLeaks: TOASTS,
    whileMounted: async () => {
      await waitFor(() => button('Test LanguageTool'), 'the configuration form');
      // Out-of-range numbers: the error shows when the field is left, before any Save.
      const maxInput = document.querySelector('input[name="maxInputChars"]');
      await focus(maxInput);
      await type(maxInput, '100');
      assert.notEqual(maxInput.getAttribute('aria-invalid'), 'true', 'no error while typing');
      await blur(maxInput);
      await waitFor(() => maxInput.getAttribute('aria-invalid') === 'true', 'range error on blur');
      assert.match(describedText(maxInput), /Enter a whole number from 200 to 50000\./);
      await type(maxInput, '9000');
      assert.notEqual(maxInput.getAttribute('aria-invalid'), 'true', 'fixed values clear the error at once');

      const urlInput = document.querySelector('input[name="languageTool.baseUrl"]');
      assert.notEqual(urlInput.getAttribute('aria-invalid'), 'true');
      const test = button('Test LanguageTool');
      await focus(test);
      await click(test);
      await waitFor(() => urlInput.getAttribute('aria-invalid') === 'true', 'the base URL marked invalid');
      assert.match(describedText(urlInput), /This field is required\./);
      await waitFor(() => document.activeElement === urlInput, 'focus on the highlighted field');
      assert.equal(
        network.calls.filter((call) => call.pathname.endsWith('/language-tool/test')).length,
        0,
        'nothing is tested without a URL'
      );
      await type(urlInput, 'https://languagetool.example.test');
      assert.notEqual(urlInput.getAttribute('aria-invalid'), 'true', 'the error goes when the URL is typed');
      await type(urlInput, '');

      const save = button('Save');
      await focus(save);
      await click(save);
      await waitFor(
        () =>
          network.calls.some((call) => call.method === 'PUT' && call.pathname === '/magic-editor-x/settings'),
        'the save request'
      );
      await waitFor(() => document.activeElement.tagName === 'H1', 'focus on the page title after Save');
      assert.equal(document.activeElement.getAttribute('tabindex'), '-1', 'the title is no tab stop');
    },
  });
});

test('Audit trail: DS date pickers instead of native date inputs; Refresh keeps focus', async () => {
  pluginRoutes();
  await checkStrictEntry(<AuditPage />, {
    path: '/settings/magic-editor-x/audit',
    permissions: ALL,
    allowLeaks: TOASTS,
    whileMounted: async () => {
      await waitFor(() => button('Refresh') && !button('Refresh').disabled, 'the audit list');
      assert.equal(document.querySelectorAll('input[type="date"]').length, 0, 'no native date input');
      for (const name of ['from', 'to']) {
        const input = document.querySelector(`input[name="${name}"]`);
        assert.ok(input, `${name} date picker`);
        assert.equal(input.getAttribute('role'), 'combobox', `${name}: DS DatePicker input`);
      }
      const refresh = button('Refresh');
      const before = network.calls.filter((call) => call.pathname === '/magic-editor-x/audit').length;
      await focus(refresh);
      await click(refresh);
      await waitFor(
        () => network.calls.filter((call) => call.pathname === '/magic-editor-x/audit').length > before,
        'the reload'
      );
      await waitFor(() => !refresh.disabled, 'the reload to finish');
      await waitFor(() => document.activeElement === refresh, 'focus back on Refresh');
    },
  });
});

test('custom block import report: an entry without a name is described, no literal "?"', async () => {
  pluginRoutes();
  network.on('POST', '/magic-editor-x/custom-blocks/import', {
    data: { created: [], skipped: [{ name: '', reason: 'invalid' }] },
  });
  const result = await checkStrictEntry(<CustomBlocksPage />, {
    path: CUSTOM_BLOCKS,
    permissions: ALL,
    allowLeaks: TOASTS,
    whileMounted: async () => {
      const input = document.querySelector('input[type="file"]');
      const file = new File([JSON.stringify({ version: 1, blocks: [{ x: 1 }] })], 'wrong.json', {
        type: 'application/json',
      });
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(() => /without a name/.test(document.body.textContent), 'the import report');
    },
  });
  assert.match(result.html, /An entry without a name: the definition is not valid\./);
  assert.doesNotMatch(result.html, /\?: the definition/);
});

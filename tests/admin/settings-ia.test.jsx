/**
 * 2.12.3 information architecture of Settings > Magic Editor X > Configuration in React
 * StrictMode with the real Strapi admin providers: sections ordered by what editors use most
 * (AI assistant, AI actions and style guide, readability, grammar), read-only server details
 * last and collapsed, and the AI actions outside the provider card.
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { checkStrictEntry, network } from './harness/index.jsx';
import { ALL, pluginRoutes, settingsDto, waitFor } from './fixtures.mjs';
import ConfigurationPage from '../../admin/src/pages/ConfigurationPage';
import { DEFAULT_CONTENT_CHECKS } from '../../shared/content-insights.mjs';

const h2s = () => [...document.querySelectorAll('section h2')].map((el) => el.textContent.trim());
const sectionOf = (title) =>
  [...document.querySelectorAll('section')].find(
    (el) => el.querySelector('h2')?.textContent.trim() === title
  );

test('Configuration: frequent sections first, AI actions in their own section, server options collapsed', async () => {
  pluginRoutes();
  const dto = settingsDto();
  dto.ai = { ...dto.ai, actions: [], styleGuide: '', styleGuideForAll: false };
  dto.contentChecks = { ...DEFAULT_CONTENT_CHECKS };
  network.on('GET', '/magic-editor-x/settings', { data: dto });
  await checkStrictEntry(<ConfigurationPage />, {
    path: '/settings/magic-editor-x/configuration',
    permissions: ALL,
    whileMounted: async () => {
      await waitFor(() => h2s().includes('AI actions and style guide'), 'the sections');
      const order = h2s();
      const at = (title) => order.indexOf(title);
      assert.ok(at('AI assistant') === 0, `AI assistant first: ${order.join(' | ')}`);
      assert.equal(at('AI actions and style guide'), 1);
      assert.ok(
        at('Readability and SEO hints') > 1 &&
          at('Readability and SEO hints') < at('Grammar check (LanguageTool)')
      );
      assert.equal(order.at(-1), 'Server configuration', 'read-only server details last');
      // The provider card no longer holds the actions editor.
      assert.equal(sectionOf('AI assistant').textContent.includes('Your AI actions'), false);
      assert.ok(sectionOf('AI actions and style guide').textContent.includes('Your AI actions'));
      // Server options are behind a collapsed disclosure.
      const server = sectionOf('Server configuration');
      const trigger = [...server.querySelectorAll('button')].find((el) =>
        el.textContent.includes('Server options')
      );
      assert.ok(trigger, 'the Server options trigger');
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(server.textContent.includes('Live collaboration'), false, 'details hidden until opened');
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      });
      await waitFor(() => server.textContent.includes('Live collaboration'), 'the opened server options');
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    },
  });
});

test('Configuration: a footer after the last section links to the GitHub repository', async () => {
  pluginRoutes();
  network.on('GET', '/magic-editor-x/settings', { data: settingsDto() });
  await checkStrictEntry(<ConfigurationPage />, {
    path: '/settings/magic-editor-x/configuration',
    permissions: ALL,
    whileMounted: async () => {
      await waitFor(() => h2s().includes('Server configuration'), 'the sections');
      const link = document.querySelector('a[href="https://github.com/Schero94/Magic-Editor-X"]');
      assert.ok(link, 'the GitHub link');
      assert.ok(link.textContent.includes('Magic Editor X on GitHub'));
      assert.equal(link.getAttribute('target'), '_blank');
      assert.equal(link.getAttribute('rel'), 'noreferrer noopener');
      const footer = link.closest('footer');
      assert.ok(footer, 'the link sits in a footer');
      assert.equal(footer.closest('section'), null, 'the footer is not a section');
      assert.equal(
        [...document.querySelectorAll('section, footer')].at(-1),
        footer,
        'after the last section'
      );
      assert.equal(h2s().at(-1), 'Server configuration', 'no extra section heading');
    },
  });
});

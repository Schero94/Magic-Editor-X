/**
 * 2.9 Quality panel in React StrictMode: Accessibility, Readability and SEO structure as collapsed
 * DS Accordion sections with counts, "Fix" buttons that hand the right fix to the field, the
 * focus keyphrase kept per entry in this browser, the per-field and server opt-outs, and the
 * grammar panel's one-click "Fix" for a single suggestion. No leaks, no console output.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createIntl } from 'react-intl';
import { checkStrictEntry, settle } from './harness/index.jsx';
import { QualityPanel, keyphraseStorageKey } from '../../admin/src/components/EditorField/QualityPanel.jsx';
import { GrammarPanel } from '../../admin/src/components/EditorField/GrammarPanel.jsx';

// Real ICU formatting (plural and select), as the admin does.
const intl = createIntl({ locale: 'en', messages: {}, onError: () => {} });
const t = (id, text, values) => intl.formatMessage({ id, defaultMessage: text }, values);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const click = async (element) => {
  await act(async () => {
    element.click();
  });
  await settle();
};
const triggers = () => Array.from(document.querySelectorAll('[data-mex-section] h3 button'));
const triggerOf = (id) => document.querySelector(`[data-mex-section="${id}"] h3 button`);
const fetchClient = { post: async () => ({ data: {} }), get: async () => ({ data: {} }) };
const target = { uid: 'api::article.article', documentId: 'doc1example', locale: 'en', field: 'body' };

const data = {
  blocks: [
    { id: 'h1', type: 'header', data: { text: 'Intro', level: 2 } },
    { id: 'h2', type: 'header', data: { text: 'Deep', level: 4 } },
    { id: 'p1', type: 'paragraph', data: { text: 'Two  spaces here.' } },
    { id: 'p2', type: 'paragraph', data: { text: 'Read <a href="https://example.test/">here</a>.' } },
  ],
};

test('quality panel: three collapsed sections with counts; Fix hands the right fix to the field', async () => {
  const fixes = [];
  await checkStrictEntry(
    <QualityPanel
      t={t}
      data={data}
      options={{}}
      fetchClient={fetchClient}
      externalEnabled={false}
      target={target}
      onSelectBlock={() => {}}
      onClose={() => {}}
      contentChecks={{ enabled: true }}
      headingLevels={[1, 2, 3, 4, 5, 6]}
      onFix={async (issue, action, language) => {
        fixes.push({ rule: issue.rule, blockId: issue.blockId, action, language });
        return true;
      }}
    />,
    {
      whileMounted: async () => {
        await act(async () => {
          await wait(450);
        });
        await settle();
        const names = triggers().map((node) => node.textContent);
        assert.equal(names.length, 3, names.join(' | '));
        assert.match(names[0], /^Accessibility/);
        assert.match(names[0], /2 problems/);
        assert.match(names[1], /^Readability/);
        assert.match(names[2], /^SEO structure/);
        // Everything starts collapsed (no errors): no finding is in the DOM yet.
        console.log(
          'DEBUG',
          Array.from(document.querySelectorAll('[data-mex-fix]')).map(
            (n) =>
              n.closest('[data-mex-section]')?.getAttribute('data-mex-section') +
              ':' +
              n.closest('[data-mex-section]')?.getAttribute('data-state')
          )
        );
        assert.equal(document.querySelectorAll('[data-mex-fix]').length, 0);
        assert.match(document.body.textContent, /0 errors · 2 warnings · \d+ hints/);

        // Accessibility: the skipped level gets a heading fix, the "here" link a link-text fix.
        await click(triggerOf('accessibility'));
        const a11yFixes = Array.from(
          document.querySelectorAll('[data-mex-section="accessibility"] [data-mex-fix]')
        );
        assert.equal(a11yFixes.length, 2);
        assert.match(a11yFixes[0].getAttribute('aria-label'), /^Fix: change to heading level 3/);
        assert.equal(a11yFixes[0].textContent.trim(), 'Fix');
        await click(a11yFixes[0]);
        assert.deepEqual(fixes.pop(), {
          rule: 'heading-order',
          blockId: 'h2',
          action: { kind: 'heading', level: 3 },
          language: 'en',
        });
        await click(a11yFixes[1]);
        assert.deepEqual(fixes.pop().action, { kind: 'linkText' });

        // Readability (one section open at a time): spacing has a "Fix".
        await click(triggerOf('readability'));
        // One section open at a time (Radix single accordion).
        assert.equal(triggerOf('accessibility').getAttribute('aria-expanded'), 'false');
        assert.equal(triggerOf('readability').getAttribute('aria-expanded'), 'true');
        const spacing = document.querySelector('[data-mex-section="readability"] [data-mex-fix]');
        assert.ok(spacing, 'spacing fix shown');
        await click(spacing);
        assert.deepEqual(fixes.pop(), {
          rule: 'extra-spaces',
          blockId: 'p1',
          action: { kind: 'typography' },
          language: 'en',
        });

        // SEO: the keyphrase field lives only here and is kept for this entry in this browser.
        assert.equal(document.querySelector('input[name="mex-keyphrase"]'), null);
        await click(triggerOf('seo'));
        const input = document.querySelector('[data-mex-section="seo"] input');
        assert.ok(input, 'keyphrase input in the SEO section');
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'garden tools');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
          await wait(450);
        });
        await settle();
        assert.equal(window.localStorage.getItem(keyphraseStorageKey(target)), 'garden tools');
        assert.match(
          document.querySelector('[data-mex-section="seo"]').textContent,
          /does not mention "garden tools"/
        );
      },
    }
  );
  window.localStorage.clear();
});

test('quality panel: hints off on the server, for the field, and no Fix when read-only', async () => {
  for (const props of [{ contentChecks: null }, { options: { disableContentChecks: true } }]) {
    await checkStrictEntry(
      <QualityPanel
        t={t}
        data={data}
        options={{}}
        fetchClient={fetchClient}
        externalEnabled={false}
        target={target}
        onSelectBlock={() => {}}
        contentChecks={{ enabled: true }}
        onFix={null}
        {...props}
      />,
      {
        whileMounted: async () => {
          await settle();
          const names = triggers().map((node) => node.textContent);
          assert.equal(names.length, 1, names.join(' | '));
          assert.match(names[0], /^Accessibility/);
          assert.doesNotMatch(document.body.textContent, /hints/);
          await click(triggerOf('accessibility'));
          // Read-only: findings, no "Fix".
          console.log(
            'DEBUG',
            Array.from(document.querySelectorAll('[data-mex-fix]')).map(
              (n) =>
                n.closest('[data-mex-section]')?.getAttribute('data-mex-section') +
                ':' +
                n.closest('[data-mex-section]')?.getAttribute('data-state')
            )
          );
          assert.equal(document.querySelectorAll('[data-mex-fix]').length, 0);
          assert.match(document.body.textContent, /Heading level 4 skips a level/);
        },
      }
    );
  }
});

test('quality panel: an error opens Accessibility; empty content says so', async () => {
  await checkStrictEntry(
    <QualityPanel
      t={t}
      data={{
        blocks: [{ id: 'x', type: 'paragraph', data: { text: '<a href="https://example.test/"></a>' } }],
      }}
      options={{}}
      fetchClient={fetchClient}
      externalEnabled={false}
      onSelectBlock={() => {}}
      contentChecks={{ enabled: false }}
    />,
    {
      whileMounted: async () => {
        await settle();
        assert.equal(triggerOf('accessibility').getAttribute('aria-expanded'), 'true');
        assert.match(document.body.textContent, /Link without text or address/);
      },
    }
  );
});

test('grammar panel: one suggestion is a one-click "Fix"; several stay buttons', async () => {
  const applied = [];
  await checkStrictEntry(
    <GrammarPanel
      t={t}
      fetchClient={{
        post: async () => ({
          data: {
            data: {
              matches: [
                {
                  blockId: 'p1',
                  path: 'text',
                  offset: 0,
                  length: 3,
                  text: 'Teh',
                  message: 'Possible typo',
                  replacements: ['The'],
                },
                {
                  blockId: 'p1',
                  path: 'text',
                  offset: 4,
                  length: 3,
                  text: 'cta',
                  message: 'Possible typo',
                  replacements: ['cat', 'act'],
                },
              ],
            },
          },
        }),
      }}
      target={{ uid: 'api::article.article', field: 'body', locale: 'en' }}
      getData={async () => ({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Teh cta sat.' } }] })}
      onApply={async (blockId, path, html) => {
        applied.push(html);
        return true;
      }}
      onSelect={() => {}}
      onClose={() => {}}
    />,
    {
      whileMounted: async () => {
        await settle();
        const run = Array.from(document.querySelectorAll('button')).find(
          (node) => node.textContent.trim() === 'Check grammar'
        );
        await click(run);
        await settle();
        const fix = Array.from(document.querySelectorAll('button')).find(
          (node) => node.textContent.trim() === 'Fix'
        );
        assert.ok(fix, 'Fix button for the single suggestion');
        assert.equal(fix.getAttribute('aria-label'), 'Replace "Teh" with "The"');
        assert.match(document.body.textContent, /Suggestion: The/);
        assert.ok(
          Array.from(document.querySelectorAll('button')).some((node) => node.textContent.trim() === 'act')
        );
        await click(fix);
        assert.deepEqual(applied, ['The cta sat.']);
      },
    }
  );
});

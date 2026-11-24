/**
 * 2.9 AI in React StrictMode with the real Strapi admin providers: "Ask AI…"
 * in the block AI dialog (instruction, recent quick picks, preview), AI review
 * as suggestions (one request, the Suggestions panel shows "AI"), and the
 * owner-defined actions and style guide on the Configuration page (Modal,
 * ConfirmDialog, saved with the page).
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { checkStrictEntry, network } from './harness/index.jsx';
import { ALL, pluginRoutes, settingsDto, waitFor } from './fixtures.mjs';
import { BlockAiDialog } from '../../admin/src/components/EditorField/BlockAiDialog';
import { SuggestionsPanel } from '../../admin/src/components/EditorField/SuggestionsPanel';
import { useAiReview } from '../../admin/src/components/EditorField/useAiReview';
import ConfigurationPage from '../../admin/src/pages/ConfigurationPage';

const TOASTS = [{ match: /document:visibilitychange lib:sonner\//, reason: 'admin toasts (sonner)' }];
const t = (id, text, values) =>
  values
    ? String(text).replace(/\{(\w+)\}/g, (_, name) => (name in values ? values[name] : `{${name}}`))
    : text;

const dialog = () => document.querySelector('[role="dialog"]');
const alertDialog = () => document.querySelector('[role="alertdialog"]');
const button = (name, root = document) =>
  [...root.querySelectorAll('button')].find(
    (el) => el.textContent.trim() === name || el.getAttribute('aria-label') === name
  );
const radio = (label, root = document) =>
  [...root.querySelectorAll('[role="radio"]')].find((el) => {
    const id = el.getAttribute('id');
    const text = id ? document.querySelector(`label[for="${id}"]`)?.textContent : '';
    return (text || el.closest('label')?.textContent || el.parentElement?.textContent || '').includes(label);
  });
const click = (el) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
const type = (el, value) =>
  act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const DATA = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'Ths is synthetic.' } },
    { id: 'p2', type: 'paragraph', data: { text: 'Second paragraph.' } },
    { id: 'img', type: 'image', data: { file: { url: '/uploads/x.png' }, caption: '' } },
  ],
};
const CONFIG = {
  enabled: true,
  languages: ['English', 'German'],
  tones: ['professional'],
  maxInputChars: 8000,
  maxInstructionChars: 500,
  reviews: ['proofread', 'clarity'],
  custom: [{ key: 'brand', name: 'Brand voice', scope: 'blocks', output: 'replace' }],
};
const getData = async () => DATA;

test('Ask AI in the block dialog: an instruction is required, quick picks fill it, the answer is previewed', async () => {
  const used = [];
  network.on('POST', '/magic-editor-x/ai/blocks/ask', (call) => {
    const body = call.json();
    return {
      data: { segments: body.segments.map((segment) => ({ ...segment, html: `${segment.html} Shorter.` })) },
    };
  });
  let closed = 0;
  await checkStrictEntry(
    <BlockAiDialog
      t={t}
      config={CONFIG}
      target={{ uid: 'api::article.article', field: 'body' }}
      blockIds={['p1', 'p2']}
      preset={null}
      getData={getData}
      onApply={async () => {}}
      onClose={() => {
        closed += 1;
      }}
      recent={['Turn this into a short list']}
      onInstructionUsed={(text) => used.push(text)}
    />,
    {
      permissions: ALL,
      whileMounted: async () => {
        await waitFor(() => dialog(), 'the block AI dialog');
        // Built-ins first, then Ask AI, then the own action; no reviews without the right to suggest.
        const labels = [...dialog().querySelectorAll('[role="radio"]')].map(
          (el) => el.parentElement.textContent
        );
        assert.ok(labels.some((text) => text.includes('Ask AI…')));
        assert.ok(labels.some((text) => text.includes('Brand voice')));
        assert.ok(
          !labels.some((text) => text.includes('adds suggestions')),
          'no review without suggest rights'
        );
        await click(radio('Ask AI…'));
        const textarea = await (async () => {
          await waitFor(() => dialog().querySelector('textarea'), 'the instruction field');
          return dialog().querySelector('textarea');
        })();
        assert.equal(textarea.getAttribute('maxlength'), '500');
        await click(button('Send to the AI provider', dialog()));
        await waitFor(
          () => /Write an instruction first\./.test(dialog().textContent),
          'the required message'
        );
        assert.equal(network.calls.filter((call) => call.method === 'POST').length, 0, 'nothing sent');
        await click(button('Use the instruction: Turn this into a short list', dialog()));
        assert.equal(textarea.value, 'Turn this into a short list');
        await type(textarea, 'Make it shorter');
        await click(button('Send to the AI provider', dialog()));
        await waitFor(() => dialog().querySelector('[data-testid="mex-block-ai-preview"]'), 'the preview');
        const posts = network.calls.filter((call) => call.method === 'POST');
        assert.equal(posts.length, 1, 'one request in StrictMode');
        const body = JSON.parse(posts[0].body);
        assert.equal(body.instruction, 'Make it shorter');
        assert.deepEqual(
          body.segments.map((segment) => segment.blockId),
          ['p1', 'p2']
        );
        assert.deepEqual(used, ['Make it shorter']);
        assert.ok(button('Apply to blocks', dialog()));
      },
    }
  );
  assert.equal(closed, 0);
});

/**
 * Block dialog wired to the real review hook.
 * @param {{ onReviewed: Function, onRefresh: Function }} props - Spies.
 * @returns {JSX.Element} Dialog.
 */
const ReviewHarness = ({ onReviewed, onRefresh }) => {
  const review = useAiReview({
    target: { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' },
    readData: getData,
    suggestions: {
      refresh: async () => onRefresh(),
    },
  });
  return (
    <BlockAiDialog
      t={t}
      config={CONFIG}
      target={{ uid: 'api::article.article', field: 'body' }}
      blockIds={['p1', 'img']}
      preset={null}
      getData={getData}
      onApply={async () => {}}
      onClose={() => {}}
      canSuggest
      review={review}
      onReviewed={onReviewed}
    />
  );
};

test('AI review from the block dialog: one request with the blocks as shown, then the suggestions reload', async () => {
  network.on('POST', '/magic-editor-x/ai/review/proofread', {
    status: 201,
    body: { data: [], meta: { created: 1, updated: 0, duplicates: 0, capped: 0, invalid: 0, blocks: 1 } },
  });
  const reviewed = [];
  const refreshed = { count: 0 };
  await checkStrictEntry(
    <ReviewHarness
      onReviewed={(meta) => reviewed.push(meta)}
      onRefresh={() => {
        refreshed.count += 1;
      }}
    />,
    {
      permissions: ALL,
      whileMounted: async () => {
        await waitFor(() => dialog(), 'the block AI dialog');
        await click(radio('Proofread (adds suggestions)'));
        assert.match(dialog().textContent, /Each change appears as a suggestion in the Suggestions panel/);
        await click(button('Add suggestions', dialog()));
        await waitFor(() => reviewed.length === 1, 'the review result');
        const posts = network.calls.filter((call) => call.method === 'POST');
        assert.equal(posts.length, 1);
        const body = JSON.parse(posts[0].body);
        assert.equal(body.scope, 'blocks');
        assert.equal(body.documentId, 'doc1');
        assert.deepEqual(
          body.blocks.map((block) => block.id),
          ['p1'],
          'only chosen blocks with text are sent'
        );
        assert.equal(refreshed.count, 1);
        assert.equal(reviewed[0].created, 1);
      },
    }
  );
});

test('the Suggestions panel marks AI suggestions and names who asked for them', async () => {
  const suggestion = {
    id: 's1',
    op: 'update',
    blockId: 'p1',
    afterBlockId: null,
    proposed: { id: 'p1', type: 'paragraph', data: { text: 'This is synthetic.' } },
    baseHash: '00000000000000',
    note: null,
    status: 'open',
    author: { name: 'Anna Beispiel', own: true, deleted: false },
    ai: { action: 'proofread' },
    decidedAt: null,
    decidedBy: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  };
  const suggestions = {
    loaded: true,
    error: false,
    suggestions: [suggestion],
    counts: { open: 1, accepted: 0, rejected: 0 },
    canCreate: true,
    canReview: true,
    actions: {},
    newFromOthers: 0,
    clearNew: () => {},
    refresh: async () => {},
  };
  await checkStrictEntry(
    <SuggestionsPanel
      t={t}
      suggestions={suggestions}
      current={DATA}
      canDecide
      onAccept={async () => 0}
      onSelectBlock={() => {}}
      onClose={() => {}}
      fail={() => {}}
    />,
    {
      permissions: ALL,
      whileMounted: async () => {
        await waitFor(() => document.querySelector('[data-testid="mex-suggestion-ai"]'), 'the AI badge');
        const card = document.querySelector('[data-testid="mex-suggestion"]');
        assert.match(card.textContent, /AI proofreading/);
        assert.match(card.textContent, /AI, requested by Anna Beispiel \(you\)/);
        assert.ok(
          button('Accept suggestion by AI, requested by Anna Beispiel (you): Change, This is synthetic.')
        );
      },
    }
  );
});

test('Configuration: add an AI action in a Modal, delete one with a ConfirmDialog, save both with the page', async () => {
  pluginRoutes();
  const dto = settingsDto();
  dto.ai = {
    ...dto.ai,
    actions: [
      { key: 'old-one', name: 'Old one', instruction: 'Old.', scope: 'field', output: 'suggestions' },
    ],
    styleGuide: '',
    styleGuideForAll: false,
  };
  network.on('GET', '/magic-editor-x/settings', { data: dto });
  network.on('PUT', '/magic-editor-x/settings', (call) => {
    const body = call.json();
    return { data: { ...dto, ai: { ...dto.ai, ...body.ai } } };
  });
  await checkStrictEntry(<ConfigurationPage />, {
    path: '/settings/magic-editor-x/configuration',
    permissions: ALL,
    allowLeaks: TOASTS,
    whileMounted: async () => {
      await waitFor(() => button('Add action'), 'the actions list');
      assert.match(document.body.textContent, /Old one/);
      await click(button('Add action'));
      await waitFor(() => dialog() && /Add an AI action/.test(dialog().textContent), 'the action modal');
      const inputs = dialog().querySelectorAll('input[type="text"], input:not([type])');
      const [name, key] = inputs;
      await type(name, 'SEO Einleitung');
      assert.equal(key.value, 'seo-einleitung', 'the key follows the name');
      await click(button('Add action', dialog()));
      await waitFor(
        () => /This field is required\./.test(dialog().textContent),
        'the instruction is required'
      );
      await type(dialog().querySelector('textarea'), 'Rewrite as a short intro.');
      await click(button('Add action', dialog()));
      await waitFor(() => !dialog(), 'the modal closes');
      assert.match(document.body.textContent, /SEO Einleitung/);
      // Cancel returns focus to the same Delete button, never to <body>.
      await click(button('Delete Old one'));
      await waitFor(() => alertDialog(), 'the delete confirmation');
      await click(button('Cancel', alertDialog()));
      await waitFor(() => !alertDialog(), 'the confirmation closes');
      await waitFor(
        () =>
          (
            document.activeElement?.textContent ||
            document.activeElement?.getAttribute('aria-label') ||
            ''
          ).trim() === 'Delete Old one',
        'focus back on the Delete button'
      );
      // Delete the old action: ConfirmDialog, then it is gone from the draft.
      await click(button('Delete Old one'));
      await waitFor(() => alertDialog(), 'the delete confirmation');
      assert.match(alertDialog().textContent, /Delete the AI action Old one\?/);
      await click(button('Delete action', alertDialog()));
      await waitFor(() => !alertDialog(), 'the confirmation closes');
      assert.doesNotMatch(document.body.textContent, /Old one/);
      // Style guide.
      const guide = document.querySelector('textarea[name="styleGuide"]');
      await type(guide, 'Address readers formally.');
      await click(button('Save'));
      await waitFor(() => network.calls.some((call) => call.method === 'PUT'), 'the settings request');
      const put = network.calls.find((call) => call.method === 'PUT');
      const body = JSON.parse(put.body);
      assert.deepEqual(body.ai.actions, [
        {
          key: 'seo-einleitung',
          name: 'SEO Einleitung',
          instruction: 'Rewrite as a short intro.',
          scope: 'selection',
          output: 'replace',
        },
      ]);
      assert.equal(body.ai.styleGuide, 'Address readers formally.');
      assert.equal(body.ai.styleGuideForAll, false);
    },
  });
});

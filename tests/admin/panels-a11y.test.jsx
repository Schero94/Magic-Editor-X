/**
 * 2.7.8 re-audit minors (field panels): the grammar panel takes focus when it opens, and Escape
 * closes the grammar and quality panels (their onClose returns focus to More tools).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { renderStrict, settle } from './harness/index.jsx';
import { GrammarPanel } from '../../admin/src/components/EditorField/GrammarPanel.jsx';
import { QualityPanel } from '../../admin/src/components/EditorField/QualityPanel.jsx';

const t = (_id, text, values) =>
  values ? String(text).replace(/\{(\w+)[^}]*\}/g, (_m, key) => (key in values ? values[key] : '')) : text;
const frame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
const escape = async (element) => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
};

test('grammar panel: heading takes focus on open; Escape closes', async () => {
  let closed = 0;
  const handle = await renderStrict(
    <GrammarPanel
      t={t}
      fetchClient={{ post: async () => ({ data: { matches: [] } }) }}
      target={{ uid: 'api::article.article', field: 'body', locale: 'en' }}
      getData={async () => ({ blocks: [] })}
      onApply={async () => true}
      onSelect={() => {}}
      onClose={() => (closed += 1)}
    />
  );
  await frame();
  await settle();
  const panel = document.querySelector('[data-testid="mex-grammar-panel"]');
  assert.equal(document.activeElement && document.activeElement.tagName, 'H3');
  assert.ok(panel.contains(document.activeElement));
  await escape(panel.querySelector('button'));
  assert.equal(closed, 1);
  await handle.unmount();
});

test('quality panel: Escape closes; Escape inside a listbox does not', async () => {
  let closed = 0;
  const handle = await renderStrict(
    <div>
      <QualityPanel
        t={t}
        data={{ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Text' } }] }}
        options={{}}
        fetchClient={{ post: async () => ({ data: {} }), get: async () => ({ data: {} }) }}
        externalEnabled={false}
        onSelectBlock={() => {}}
        onClose={() => (closed += 1)}
      />
    </div>
  );
  await settle();
  const section = document.querySelector('section[aria-label="Quality checks"]');
  const listbox = document.createElement('div');
  listbox.setAttribute('role', 'listbox');
  section.appendChild(listbox);
  await escape(listbox);
  assert.equal(closed, 0);
  listbox.remove();
  await escape(section.querySelector('h3'));
  assert.equal(closed, 1);
  await handle.unmount();
});

const click = async (element) => {
  await act(async () => {
    element.click();
  });
  await settle();
};
const byText = (root, text) =>
  Array.from(root.querySelectorAll('button')).find((node) => node.textContent.trim() === text);
const frames = async (count = 3) => {
  for (let index = 0; index < count; index += 1) await frame();
};

test('comments: contextual names; focus back on Reply after sending and on Edit after cancelling', async () => {
  const { CommentThread } = await import('../../admin/src/components/EditorField/CommentThread.jsx');
  let replies = 0;
  const thread = {
    id: 't1',
    status: 'open',
    blockId: 'b1',
    excerpt: 'Block text',
    comments: [
      {
        id: 'c1',
        body: 'Please check the first sentence of this paragraph again',
        author: { name: 'Ben M.', own: true },
        createdAt: '2026-11-20T10:00:00.000Z',
        mentions: [],
      },
    ],
  };
  const handle = await renderStrict(
    <CommentThread
      thread={thread}
      blockExcerpt="Block text"
      t={t}
      canWrite
      canModerate={false}
      actions={{ reply: async () => (replies += 1), edit: async () => ({}) }}
      onSelectBlock={() => {}}
      announce={() => {}}
      fail={() => {}}
      fallbackFocusRef={{ current: null }}
    />
  );
  const names = Array.from(document.querySelectorAll('button[aria-label]')).map((node) =>
    node.getAttribute('aria-label')
  );
  assert.ok(
    names.includes('Edit comment by Ben M.: Please check the first sentence of this…'),
    names.join(' | ')
  );
  assert.ok(names.some((name) => name.startsWith('Reply to Ben M.: Please check')));
  assert.ok(names.some((name) => name.startsWith('Resolve comment by Ben M.')));
  // Reply, type, send: focus on the Reply button again.
  await click(byText(document.body, 'Reply'));
  const box = document.querySelector('textarea');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(box, 'Done');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  const send = Array.from(document.querySelectorAll('button'))
    .filter((node) => node.textContent.trim() === 'Reply')
    .pop();
  await click(send);
  await frames();
  assert.equal(replies, 1);
  assert.match(document.activeElement.getAttribute('aria-label') || '', /^Reply to Ben M\./);
  // Edit, Cancel: focus on Edit.
  await click(byText(document.body, 'Edit'));
  await click(byText(document.body, 'Cancel'));
  await frames();
  assert.match(document.activeElement.getAttribute('aria-label') || '', /^Edit comment by Ben M\./);
  await handle.unmount();
});

test('comments panel: a failed first load shows the error and Try again, no counts or rights', async () => {
  const { CommentsPanel } = await import('../../admin/src/components/EditorField/CommentsPanel.jsx');
  let retried = 0;
  const comments = {
    loaded: false,
    error: true,
    threads: [],
    counts: { open: 0, resolved: 0 },
    canWrite: false,
    canModerate: false,
    positionalThreads: [],
    notifications: [],
    actions: {},
    newFromOthers: 0,
    clearNew: () => {},
    refresh: () => (retried += 1),
  };
  const handle = await renderStrict(
    <CommentsPanel
      t={t}
      comments={comments}
      blocks={[]}
      onSelectBlock={() => {}}
      onClose={() => {}}
      fail={() => {}}
    />
  );
  const panel = document.querySelector('[data-testid="mex-comments-panel"]');
  assert.match(panel.textContent, /The comments could not be loaded\./);
  assert.equal(panel.querySelector('[data-testid="mex-comments-summary"]'), null);
  assert.doesNotMatch(panel.textContent, /You can read comments but not add any|0 open threads/);
  await click(byText(panel, 'Try again'));
  assert.equal(retried, 1);
  await handle.unmount();
});

test('find and replace: after Replace all focus stays in the panel', async () => {
  const { FindReplacePanel } = await import('../../admin/src/components/EditorField/FindReplacePanel.jsx');
  let data = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'alpha beta alpha' } }] };
  const outside = document.createElement('button');
  document.body.append(outside);
  const handle = await renderStrict(
    <FindReplacePanel
      t={t}
      getData={async () => data}
      onApply={async (next) => {
        data = next;
        outside.focus();
      }}
      onSelect={() => {}}
      onClose={() => {}}
      readOnly={false}
      contentVersion={0}
    />
  );
  const [find, replacement] = document.querySelectorAll('input');
  const type = async (input, value) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(10, 20);
  };
  await type(find, 'alpha');
  await type(replacement, 'gamma');
  const all = byText(document.body, 'Replace all');
  await click(all);
  await settle(10, 20);
  await frames();
  assert.match(data.blocks[0].data.text, /gamma beta gamma/);
  const panel = document.querySelector('section[aria-label="Find and replace"]');
  assert.ok(panel.contains(document.activeElement), `focus on ${document.activeElement.tagName}`);
  outside.remove();
  await handle.unmount();
});

test('quality: only skipped links announce "No links were checked", focus back on Check links', async () => {
  const handle = await renderStrict(
    <QualityPanel
      t={t}
      data={{
        blocks: [
          { id: 'a', type: 'paragraph', data: { text: '<a href="https://www.example.test/x">x</a>' } },
        ],
      }}
      options={{}}
      fetchClient={{
        post: async () => ({ data: { data: { internal: [], media: [], external: [] } } }),
        get: async () => ({ data: {} }),
      }}
      externalEnabled={false}
      onSelectBlock={() => {}}
      onClose={() => {}}
    />
  );
  const button = byText(document.body, 'Check links');
  button.focus();
  await click(button);
  await settle(10, 20);
  await frames();
  const announced = document.querySelector('section[aria-label="Quality checks"]').textContent;
  assert.match(announced, /No links were checked\./);
  assert.doesNotMatch(announced, /no problems/);
  assert.equal(document.activeElement, byText(document.body, 'Check links'));
  await handle.unmount();
});

test('suggestions: Accept, Reject and Show block name the suggestion they act on', async () => {
  const { SuggestionsPanel } = await import('../../admin/src/components/EditorField/SuggestionsPanel.jsx');
  const current = {
    time: 1,
    version: '2.31.7',
    blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Old text' } }],
  };
  const suggestions = {
    loaded: true,
    error: false,
    counts: { open: 1 },
    suggestions: [
      {
        id: 's1',
        status: 'open',
        op: 'update',
        blockId: 'b1',
        baseHash: null,
        proposed: { id: 'b1', type: 'paragraph', data: { text: 'New wording for the first block' } },
        author: { name: 'Ben M.', own: false },
        createdAt: '2026-11-20T10:00:00.000Z',
      },
    ],
    actions: {},
    newFromOthers: 0,
    clearNew: () => {},
    refresh: () => {},
  };
  const handle = await renderStrict(
    <SuggestionsPanel
      t={t}
      suggestions={suggestions}
      current={current}
      canDecide
      onAccept={async () => 1}
      onSelectBlock={() => {}}
      onClose={() => {}}
      fail={() => {}}
    />
  );
  const names = Array.from(
    document.querySelectorAll('[data-testid="mex-suggestion"] button[aria-label]')
  ).map((node) => node.getAttribute('aria-label'));
  assert.ok(
    names.some((name) => /^Accept suggestion by Ben M\.: Change, New wording/.test(name)),
    names.join(' | ')
  );
  assert.ok(names.some((name) => /^Reject suggestion by Ben M\.: Change, New wording/.test(name)));
  assert.ok(names.some((name) => /^Show block of the suggestion by Ben M\./.test(name)));
  await handle.unmount();
});

test('side panel: the Check action is a Design System button with a contextual name', async () => {
  const { ENTRY_PANEL_SECTIONS } = await import('../../admin/src/components/EntryPanel/sections.jsx');
  const Quality = ENTRY_PANEL_SECTIONS.find((section) => section.id === 'quality').Component;
  const summary = {
    data: {
      fields: [
        {
          field: 'body',
          path: 'body',
          label: 'Body',
          issues: { errors: 1, warnings: 0 },
          brokenLinks: { draft: 0 },
        },
      ],
      quality: { errors: 1, warnings: 0 },
      links: { enabled: false, draft: 0, published: 0 },
      comments: { enabled: false },
    },
  };
  const handle = await renderStrict(<Quality t={t} summary={summary} />);
  const button = document.querySelector('[data-testid="mex-panel-quality"] button[aria-label="Check Body"]');
  assert.ok(button, 'Check button');
  assert.equal(button.textContent.trim(), 'Check');
  // The 24 x 24 px target itself is measured in the browser (DS Button size S).
  await handle.unmount();
});

test('nested confirms: refocusLater puts focus back on the opener (ref or element); refocusIfLost only when lost', async () => {
  const { refocusLater, refocusIfLost } =
    await import('../../admin/src/components/EditorField/usePanelFocus.js');
  const opener = document.createElement('button');
  const other = document.createElement('button');
  document.body.append(opener, other);
  document.body.focus();
  refocusLater({ current: opener });
  await frames();
  assert.equal(document.activeElement, opener);
  other.focus();
  refocusIfLost(() => opener);
  await frames();
  assert.equal(document.activeElement, other, 'focus that moved on purpose stays');
  other.blur();
  refocusIfLost(opener);
  await frames();
  assert.equal(document.activeElement, opener);
  opener.remove();
  other.remove();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAlert,
  normalizeAlignment,
  normalizeTextVariant,
  normalizeCodeFlask,
  normalizeLanguage,
  checklistToList,
  listToChecklist,
  normalizeToggle,
  toggleChildIndexes,
  nextToggleItems,
  normalizeButton,
  normalizeSimpleImage,
  normalizeLinkTool,
  summarizeEntry,
  fillTemplate,
  createHistoryStack,
  historyKey,
  dropIndex,
} from '../admin/src/editor/tools/logic.mjs';

test('alert keeps 1.x data and fills defaults', () => {
  assert.deepEqual(normalizeAlert({ type: 'danger', align: 'center', message: '<b>x</b>' }), {
    type: 'danger',
    align: 'center',
    message: '<b>x</b>',
  });
  assert.deepEqual(normalizeAlert({ type: 'nope', text: 'legacy' }), {
    type: 'info',
    align: 'left',
    message: 'legacy',
  });
  assert.deepEqual(normalizeAlert(null, { defaultType: 'warning' }).type, 'warning');
});

test('alignment and text variant tunes default safely', () => {
  assert.deepEqual(normalizeAlignment({ alignment: 'justify' }), { alignment: 'justify' });
  assert.deepEqual(normalizeAlignment({ alignment: 'middle' }, 'center'), { alignment: 'center' });
  assert.deepEqual(normalizeAlignment(undefined), { alignment: 'left' });
  assert.equal(normalizeTextVariant('citation'), 'citation');
  assert.equal(normalizeTextVariant('<x>'), '');
});

test('codeflask data keeps code and maps language aliases', () => {
  assert.deepEqual(normalizeCodeFlask({ code: 'a < b', language: 'js', showlinenumbers: false }), {
    code: 'a < b',
    language: 'javascript',
    showlinenumbers: false,
  });
  assert.equal(normalizeCodeFlask({ code: 'x' }).showlinenumbers, true);
  assert.equal(normalizeLanguage('brainfuck'), 'plaintext');
  assert.equal(normalizeLanguage('HTML'), 'markup');
});

test('checklist converts to list data and back without losing items', () => {
  const legacy = {
    items: [
      { text: 'One', checked: true },
      { text: 'Two', checked: false },
    ],
  };
  const list = checklistToList(legacy);
  assert.equal(list.style, 'checklist');
  assert.deepEqual(list.items[0], { content: 'One', meta: { checked: true }, items: [] });
  assert.deepEqual(listToChecklist(list), legacy);
  const nested = {
    items: [{ content: 'a', meta: { checked: true }, items: [{ content: 'b', meta: {}, items: [] }] }],
  };
  assert.deepEqual(listToChecklist(nested), {
    items: [
      { text: 'a', checked: true },
      { text: 'b', checked: false },
    ],
  });
});

test('toggle child range is clamped to the document', () => {
  assert.deepEqual(normalizeToggle({ text: 'T', status: 'closed', items: 2 }, 'blk1'), {
    text: 'T',
    status: 'closed',
    fk: 'blk1',
    items: 2,
  });
  assert.deepEqual(toggleChildIndexes(1, 2, 10), [2, 3]);
  assert.deepEqual(toggleChildIndexes(8, 5, 10), [9]);
  assert.deepEqual(toggleChildIndexes(9, 3, 10), []);
  assert.equal(nextToggleItems(1, 2, 10, 'include'), 3);
  assert.equal(nextToggleItems(8, 1, 10, 'include'), 1);
  assert.equal(nextToggleItems(1, 0, 10, 'release'), 0);
  assert.equal(nextToggleItems(1, 5, 4, 'release'), 1);
});

test('button, simple image and link preview normalisers keep the 1.x shape', () => {
  assert.deepEqual(normalizeButton({ text: 'Go', link: '/x', style: 'weird', openInNewTab: 'yes' }), {
    text: 'Go',
    link: '/x',
    style: 'primary',
    openInNewTab: false,
  });
  assert.deepEqual(normalizeSimpleImage({ url: 'https://example.test/a.png', stretched: true }), {
    url: 'https://example.test/a.png',
    caption: '',
    withBorder: false,
    withBackground: false,
    stretched: true,
  });
  assert.deepEqual(
    normalizeLinkTool({
      link: 'https://example.test',
      meta: { title: 'T', image: { url: 'https://example.test/i.png' } },
    }),
    {
      link: 'https://example.test',
      meta: { title: 'T', description: '', image: { url: 'https://example.test/i.png' } },
    }
  );
});

test('entry summary keeps only scalar display fields', () => {
  const entry = { id: 3, documentId: 'abc', name: 'Widget', price: 5, tags: [{ id: 1 }], secret: 'x' };
  assert.deepEqual(summarizeEntry(entry, { titleField: 'title', displayFields: ['price', 'tags'] }), {
    id: 3,
    documentId: 'abc',
    title: 'Widget',
    price: 5,
  });
});

test('template placeholders are escaped', () => {
  assert.equal(
    fillTemplate('<p>{{ title }} / {{img}} / {{missing}}</p>', {
      title: '<script>',
      img: { url: 'https://example.test/a.png' },
    }),
    '<p>&lt;script&gt; / https://example.test/a.png / </p>'
  );
});

test('history stack undoes and redoes, drops duplicates and caps its size', () => {
  const stack = createHistoryStack({ maxSteps: 2 });
  stack.init('a');
  assert.equal(stack.push('a'), false);
  stack.push('b');
  stack.push('c');
  stack.push('d');
  assert.equal(stack.undo(), 'c');
  assert.equal(stack.undo(), 'b');
  assert.equal(stack.undo(), null);
  assert.equal(stack.redo(), 'c');
  stack.push('e');
  assert.equal(stack.canRedo(), false);
  assert.equal(
    historyKey({ time: 1, blocks: [{ id: 'x' }] }),
    historyKey({ time: 2, blocks: [{ id: 'x' }] })
  );
});

test('drop index follows the pointer and accounts for the dragged block', () => {
  const rects = [
    { top: 0, bottom: 10 },
    { top: 10, bottom: 20 },
    { top: 20, bottom: 30 },
  ];
  assert.equal(dropIndex(rects, 2, 2), 0);
  assert.equal(dropIndex(rects, 29, 0), 2);
  assert.equal(dropIndex(rects, 16, 0), 1);
  assert.equal(dropIndex([], 5, 0), 0);
});

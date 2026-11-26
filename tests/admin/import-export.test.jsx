/**
 * 2.11 "Import file" and "Export file" in React StrictMode with the real Strapi
 * admin providers: a generated Word file through the hidden file input
 * (preview, notes, focus, "Insert at cursor" / "Replace content"), a zip
 * bomb refused with a readable message, and the export dialog (format
 * choice, file name, Markdown and Word downloads).
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { zipSync } from 'fflate';
import { checkStrictEntry } from './harness/index.jsx';
import { Form } from '@strapi/strapi/admin';
import {
  ALL,
  DOCUMENT_ID,
  EDIT_PATH,
  EDIT_ROUTE,
  FIELD,
  VALUE,
  contentManagerRoutes,
  editorConfig,
  editorRoutes,
  fieldRoutes,
  waitFor,
} from './fixtures.mjs';
import { resetEditorConfigCache } from '../../admin/src/hooks/useEditorConfig';
import EditorField from '../../admin/src/components/EditorField';
import { liveEditors } from './fakes/editorjs.mjs';
import { ImportDialog } from '../../admin/src/components/EditorField/ImportDialog';
import { ExportDialog } from '../../admin/src/components/EditorField/ExportDialog';
import { buildDocx, link, p, sampleDocx } from '../fixtures/docx-builder.mjs';
import { readZipDirectory } from '../../shared/convert/zip.mjs';

const t = (id, text, values) =>
  values
    ? String(text)
        .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) =>
          (values[name] === 1 ? one : other).replace('#', String(values[name]))
        )
        .replace(/\{(\w+)\}/g, (_, name) => (name in values ? values[name] : `{${name}}`))
    : text;

const dialog = () => document.querySelector('[role="dialog"]');
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = (el) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });

/** Puts a file into the hidden input as if the user chose it. */
const chooseFile = (bytes, name, type = '') =>
  act(async () => {
    const input = byTestId('mex-import-input');
    const file = new window.File([bytes], name, { type });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

test('import: a Word file is previewed, then inserted at the cursor (sanitised, focus on the summary)', async () => {
  const imported = [];
  let closed = 0;
  const docx = buildDocx(
    sampleDocx().length ? [p('Synthetic import'), p(['Unsafe ', link('rIdJs', 'link')]), ''].join('') : '',
    { links: { rIdJs: 'javascript:alert(1)' } }
  );
  await checkStrictEntry(
    <ImportDialog
      t={t}
      hasContent
      onImport={async (blocks, options) => {
        imported.push({ blocks, options });
        return true;
      }}
      onClose={() => {
        closed += 1;
      }}
    />,
    {
      permissions: ALL,
      whileMounted: async () => {
        await waitFor(() => dialog(), 'the import dialog');
        assert.equal(dialog().querySelector('h2').textContent, 'Import file');
        const input = byTestId('mex-import-input');
        assert.equal(input.getAttribute('accept').split(',')[0], '.docx');
        assert.equal(input.getAttribute('tabindex'), '-1', 'only the button is in the tab order');
        // No action before a file was read.
        assert.equal(byTestId('mex-import-insert'), null);

        await chooseFile(sampleDocx(), 'field-report.docx');
        await waitFor(() => byTestId('mex-import-summary'), 'the preview');
        assert.equal(byTestId('mex-import-summary').textContent, '13 blocks from field-report.docx');
        assert.equal(document.activeElement, byTestId('mex-import-summary'), 'focus on the result');
        assert.match(
          byTestId('mex-import-notes').textContent,
          /1 picture is a chart, a shape or an embedded object, so it stays a placeholder\./
        );
        const preview = byTestId('mex-import-preview');
        assert.equal(preview.getAttribute('role'), 'region');
        assert.ok(preview.querySelector('table'), 'the table is previewed');
        assert.match(preview.textContent, /Field report: Example Valley/);
        assert.ok(byTestId('mex-import-replace'), 'Replace content is offered for a field with content');

        // A second file replaces the first preview.
        await chooseFile(docx, 'unsafe.docx');
        await waitFor(
          () => /2 blocks from unsafe\.docx/.test(byTestId('mex-import-summary')?.textContent || ''),
          'the second preview'
        );
        assert.doesNotMatch(byTestId('mex-import-preview').innerHTML, /javascript:/);
        await click(byTestId('mex-import-insert'));
        await waitFor(() => imported.length === 1, 'the import');
        assert.deepEqual(imported[0].options, { replace: false, title: 'unsafe.docx' });
        assert.deepEqual(
          imported[0].blocks.map((block) => block.data.text),
          ['Synthetic import', 'Unsafe link']
        );
        assert.equal(closed, 1);
      },
    }
  );
});

test('import: a zip bomb and an unsupported file get a clear message; an empty field offers one Insert button', async () => {
  const imported = [];
  await checkStrictEntry(
    <ImportDialog
      t={t}
      hasContent={false}
      onImport={async (blocks, options) => {
        imported.push(options);
        return true;
      }}
      onClose={() => {}}
    />,
    {
      permissions: ALL,
      whileMounted: async () => {
        await waitFor(() => dialog(), 'the import dialog');
        const bomb = zipSync({ 'word/document.xml': new Uint8Array(8 * 1024 * 1024) }, { level: 9 });
        await chooseFile(bomb, 'bomb.docx');
        await waitFor(() => byTestId('mex-import-error'), 'the error');
        assert.match(byTestId('mex-import-error').textContent, /would expand to more than 50 MB/);
        assert.equal(
          document.activeElement,
          byTestId('mex-import-choose'),
          'focus back on the choose button'
        );
        await chooseFile(new Uint8Array([1, 2, 3]), 'old.doc');
        await waitFor(
          () => /Choose a Word file/.test(byTestId('mex-import-error')?.textContent || ''),
          'the type error'
        );

        await chooseFile(new TextEncoder().encode('# Notes\n\nPlain text.\n'), 'notes.md', 'text/markdown');
        await waitFor(() => byTestId('mex-import-summary'), 'the preview');
        assert.equal(byTestId('mex-import-replace'), null, 'no Replace for an empty field');
        assert.equal(byTestId('mex-import-insert').textContent, 'Insert 2 blocks');
        await click(byTestId('mex-import-insert'));
        await waitFor(() => imported.length === 1, 'the import');
        assert.deepEqual(imported[0], { replace: true, title: 'notes.md' });
      },
    }
  );
});

const DOC = {
  time: 1,
  version: '2.31.7',
  blocks: [
    { id: 'h', type: 'header', data: { text: 'Synthetic export', level: 2 } },
    { id: 'p', type: 'paragraph', data: { text: 'Hello <b>world</b>.' } },
  ],
};

/** Captures downloads (jsdom has no navigation): the blob and the file name. */
const captureDownloads = () => {
  const downloads = [];
  const urls = new Map();
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
    click: window.HTMLAnchorElement.prototype.click,
  };
  let counter = 0;
  URL.createObjectURL = (blob) => {
    counter += 1;
    const url = `blob:test/${counter}`;
    urls.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => urls.delete(url);
  window.HTMLAnchorElement.prototype.click = function captureClick() {
    downloads.push({ name: this.download, blob: urls.get(this.href) });
  };
  return {
    downloads,
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
      window.HTMLAnchorElement.prototype.click = original.click;
    },
  };
};

test('export: format choice, file name, Markdown and Word downloads of the current content', async () => {
  const capture = captureDownloads();
  const notices = [];
  let closed = 0;
  let empty = false;
  contentManagerRoutes();
  try {
    await checkStrictEntry(
      <Form method="PUT" initialValues={{ documentId: DOCUMENT_ID, title: 'Harness article', [FIELD]: DOC }}>
        <ExportDialog
          t={t}
          field={FIELD}
          readContent={async () => ({ value: empty ? { blocks: [] } : DOC, synced: new Map() })}
          onExported={(message) => notices.push(message)}
          onClose={() => {
            closed += 1;
          }}
        />
      </Form>,
      {
        path: EDIT_PATH,
        routePath: EDIT_ROUTE,
        permissions: ALL,
        whileMounted: async () => {
          await waitFor(() => dialog(), 'the export dialog');
          const radios = [...dialog().querySelectorAll('[role="radio"]')];
          assert.equal(radios.length, 4);
          assert.equal(radios[0].getAttribute('aria-checked'), 'true', 'Word is the default');
          // Entry title (main field "title") + field + date.
          await waitFor(
            () => /harness-article/.test(byTestId('mex-export-filename').textContent),
            'the entry title'
          );
          assert.match(
            byTestId('mex-export-filename').textContent,
            new RegExp(`^File name: harness-article-${FIELD}-\\d{4}-\\d{2}-\\d{2}\\.docx$`)
          );
          // PDF shows its option and hint and no file name.
          await click(byTestId('mex-export-format-pdf'));
          assert.ok(byTestId('mex-export-pagebreaks'));
          assert.equal(byTestId('mex-export-filename'), null);
          assert.equal(byTestId('mex-export-run').textContent, 'Open print view');

          empty = true;
          await click(byTestId('mex-export-format-markdown'));
          await click(byTestId('mex-export-run'));
          await waitFor(() => byTestId('mex-export-error'), 'the empty notice');
          assert.match(byTestId('mex-export-error').textContent, /This field is empty\./);
          assert.equal(capture.downloads.length, 0);

          empty = false;
          await click(byTestId('mex-export-run'));
          await waitFor(() => capture.downloads.length === 1, 'the Markdown download');
          const markdown = capture.downloads[0];
          assert.match(markdown.name, /^harness-article-.+-\d{4}-\d{2}-\d{2}\.md$/);
          assert.equal(await markdown.blob.text(), '## Synthetic export\n\nHello **world**.\n');
          assert.equal(closed, 1);

          await click(byTestId('mex-export-format-docx'));
          await click(byTestId('mex-export-run'));
          await waitFor(() => capture.downloads.length === 2, 'the Word download', 20000);
          const word = capture.downloads[1];
          assert.match(word.name, /\.docx$/);
          const bytes = new Uint8Array(await word.blob.arrayBuffer());
          assert.ok(readZipDirectory(bytes).entries.some((entry) => entry.name === 'word/document.xml'));
          assert.equal(notices.length, 2);
          assert.match(notices[1], /\.docx was downloaded\.$/);
        },
      }
    );
  } finally {
    capture.restore();
  }
});

const ATTRIBUTE = { type: 'json', customField: 'plugin::magic-editor-x.richtext', options: {} };
const TOASTS = [{ match: /document:visibilitychange lib:sonner\//, reason: 'admin toasts (sonner)' }];

/**
 * Opens a field tool from the "More tools" menu (Radix dropdown: pointerdown opens it).
 * @param {string} id - Tool id.
 */
const openTool = async (id, inspect) => {
  const trigger = document.querySelector('[data-testid="mex-tools-menu"]');
  await act(async () => {
    trigger.dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    );
  });
  await waitFor(() => byTestId(`mex-tool-${id}`), `menu item ${id}`);
  if (inspect) inspect(document.querySelector('[role="menu"]'));
  await act(async () => {
    byTestId(`mex-tool-${id}`).click();
  });
};

test('editor field: "Import file" and "Export file" (Import and export) in More tools; Replace content changes the field once', async () => {
  resetEditorConfigCache();
  contentManagerRoutes();
  editorRoutes({
    config: editorConfig({ lazyInit: { enabled: false, marginPx: 800 }, collaboration: { enabled: false } }),
  });
  fieldRoutes();
  const changes = [];
  await checkStrictEntry(
    <Form method="PUT" initialValues={{ documentId: DOCUMENT_ID, title: 'Harness article', [FIELD]: VALUE }}>
      <EditorField
        name={FIELD}
        value={VALUE}
        onChange={(name, value) => changes.push({ name, value })}
        attribute={ATTRIBUTE}
        label="Body"
      />
    </Form>,
    {
      path: EDIT_PATH,
      routePath: EDIT_ROUTE,
      permissions: ALL,
      allowLeaks: TOASTS,
      whileMounted: async (handle) => {
        await waitFor(() => /2 blocks/.test(handle.container.textContent), 'Editor.js to render the value');
        await openTool('import', (menu) => {
          // 2.12.3: sections ordered by how often editors need them; import and export together.
          const labels = [...menu.querySelectorAll('[role="group"] > *, [role="menu"] > *')]
            .map((el) => el.textContent.trim())
            .filter((text) => ['Write', 'Review', 'Import and export', 'View'].includes(text));
          assert.deepEqual(labels, ['Write', 'Review', 'Import and export', 'View']);
          const section = (id) =>
            byTestId(`mex-tool-${id}`).compareDocumentPosition(byTestId('mex-tool-import')) &
            window.Node.DOCUMENT_POSITION_FOLLOWING;
          assert.ok(section('find') && section('quality'), 'Write and Review come before Import');
          assert.equal(byTestId('mex-tool-import').textContent.trim(), 'Import file');
          assert.equal(byTestId('mex-tool-export').textContent.trim(), 'Export file');
        });
        assert.equal(
          document.querySelector('[role="menu"]'),
          null,
          'the menu closed before the dialog opened'
        );
        await waitFor(() => dialog(), 'the import dialog');
        await chooseFile(new TextEncoder().encode('# Imported\n\nFirst.\n\nSecond.\n'), 'notes.md');
        await waitFor(() => byTestId('mex-import-replace'), 'Replace content (the field has content)');
        await click(byTestId('mex-import-replace'));
        await waitFor(() => !dialog(), 'the dialog to close');
        await waitFor(() => /3 blocks/.test(handle.container.textContent), 'the replaced content');
        const last = changes[changes.length - 1];
        assert.equal(last.name, FIELD);
        assert.deepEqual(
          last.value.blocks.map((block) => [block.type, block.data.text]),
          [
            ['header', 'Imported'],
            ['paragraph', 'First.'],
            ['paragraph', 'Second.'],
          ]
        );
        await waitFor(() => /The content was replaced/.test(document.body.textContent), 'the notice');
        assert.match(document.body.textContent, /The content was replaced with 3 blocks from notes\.md\./);
        // One undo step brings the previous content back.
        const undoButton = () =>
          [...handle.container.querySelectorAll('button')].find(
            (el) => el.getAttribute('aria-label') === 'Undo' || el.textContent.trim() === 'Undo'
          );
        // The DS IconButton marks a disabled state with aria-disabled.
        await waitFor(
          () => undoButton() && undoButton().getAttribute('aria-disabled') !== 'true',
          'Undo to be available'
        );
        const undo = undoButton();
        await click(undo);
        const editorText = () => handle.container.querySelector('.codex-editor__redactor')?.textContent || '';
        await waitFor(() => /^Release notesSynthetic paragraph/.test(editorText()), 'the previous content');
        assert.doesNotMatch(editorText(), /Imported/);

        await openTool('export');
        await waitFor(() => dialog() && /Format/.test(dialog().textContent), 'the export dialog');
        assert.match(byTestId('mex-export-filename').textContent, /harness-article-body-/);
        await click([...dialog().querySelectorAll('button')].find((el) => el.textContent === 'Cancel'));
        await waitFor(() => !dialog(), 'the export dialog to close');
      },
    }
  );
  assert.equal(liveEditors.size, 0, 'every Editor.js instance was destroyed');
});

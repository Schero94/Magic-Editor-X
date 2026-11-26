/**
 * 2.13 Word import with pictures, in React StrictMode with the real Strapi
 * admin providers: the preview shows the pictures from the file's own bytes
 * (object URLs) and sends no request; "Insert" uploads the pictures one after
 * the other (each once, with the alt text from Word, a progress line) and
 * replaces their placeholders with image blocks; a failed upload keeps its
 * placeholder and is named in the summary; without the upload permission or
 * in a field without images nothing is uploaded; "Stop uploading" keeps the
 * rest as placeholders. Word files and pictures are generated (fflate, sharp).
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { act } from 'react';
import { checkStrictEntry, network } from './harness/index.jsx';
import { ALL, waitFor } from './fixtures.mjs';
import { ImportDialog, pictureFileName } from '../../admin/src/components/EditorField/ImportDialog';
import { buildDocx, p, picture } from '../fixtures/docx-builder.mjs';

const require = createRequire(import.meta.url);
const uploadRequire = createRequire(require.resolve('@strapi/upload/package.json'));
const sharp = uploadRequire('sharp');

const t = (id, text, values) =>
  values
    ? String(text)
        .replace(
          /\{(\w+), plural, (?:=0 \{([^}]*)\} )?one \{([^}]*)\} other \{([^}]*)\}\}/g,
          (_, name, zero, one, other) =>
            (values[name] === 0 && zero !== undefined ? zero : values[name] === 1 ? one : other).replace(
              '#',
              String(values[name])
            )
        )
        .replace(/\{(\w+)\}/g, (_, name) => (name in values ? values[name] : `{${name}}`))
    : text;

const dialog = () => document.querySelector('[role="dialog"]');
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const allByTestId = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const click = (el) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
const chooseFile = (bytes, name) =>
  act(async () => {
    const input = byTestId('mex-import-input');
    const file = new window.File([bytes], name);
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

const raster = async (format) =>
  new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 90, b: 160 } } })
      [format]()
      .toBuffer()
  );

const corruptPng = () => {
  const bytes = new Uint8Array(300).fill(0x41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const EMF = Uint8Array.from([1, 0, 0, 0, 108, 0, 0, 0, ...new Array(100).fill(0)]);

/** A Word file with a PNG (used twice), a JPEG, a damaged PNG and an EMF drawing. */
const picturesDocx = async () =>
  buildDocx(
    [
      p('Synthetic field report'),
      p(picture('rIdPng', { descr: 'Valley at dawn' })),
      p('Between the pictures'),
      p(picture('rIdJpeg', { title: 'Lake at noon' })),
      p(picture('rIdBad', { descr: 'Damaged picture' })),
      p(picture('rIdEmf', { descr: 'Chart drawing' })),
      p(picture('rIdPng', { descr: 'Valley again' })),
    ].join(''),
    {
      pictures: {
        rIdPng: { target: 'media/image1.png', bytes: await raster('png') },
        rIdJpeg: { target: 'media/image2.jpeg', bytes: await raster('jpeg') },
        rIdBad: { target: 'media/image3.png', bytes: corruptPng() },
        rIdEmf: { target: 'media/image4.emf', bytes: EMF },
      },
    }
  );

/** Object URLs (jsdom has none): counted, so the test sees that previews are released. */
const stubObjectUrls = () => {
  const live = new Set();
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let counter = 0;
  URL.createObjectURL = (blob) => {
    counter += 1;
    const url = `blob:mex-test/${counter}`;
    live.add(url);
    assert.ok(blob instanceof Blob);
    return url;
  };
  URL.revokeObjectURL = (url) => live.delete(url);
  return {
    live,
    created: () => counter,
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
};

/**
 * Fake upload route: records each call, refuses the damaged picture like the server (400 message),
 * and checks that uploads never overlap.
 */
const fakeUploader = ({ gate = null } = {}) => {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const upload = async (file, alt) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const bytes = new Uint8Array(await file.arrayBuffer());
    calls.push({ name: file.name, type: file.type, alt, size: bytes.length });
    if (gate) await gate(calls.length);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (bytes[8] === 0x41) return { success: 0, message: 'The image file is damaged' };
    return {
      success: 1,
      file: {
        url: `/uploads/picture_${calls.length}.${file.type === 'image/png' ? 'png' : 'jpg'}`,
        id: calls.length,
        documentId: `doc${calls.length}`,
        name: file.name,
        alt,
        mime: file.type,
        width: 8,
        height: 8,
      },
    };
  };
  return { upload, calls, maxInFlight: () => maxInFlight };
};

test('import pictures: preview without requests, then sequential uploads with alt text; a failed upload stays a placeholder', async () => {
  const urls = stubObjectUrls();
  let resume;
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  // The second upload waits until the test has seen the progress line.
  const uploader = fakeUploader({ gate: (count) => (count === 2 ? paused : null) });
  const imported = [];
  let closed = 0;
  const docx = await picturesDocx();
  try {
    await checkStrictEntry(
      <ImportDialog
        t={t}
        hasContent
        canUpload
        imagesAllowed
        maxImageBytes={10 * 1024 * 1024}
        uploadImage={uploader.upload}
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
          network.clearCalls();
          await chooseFile(docx, 'field-report.docx');
          await waitFor(() => byTestId('mex-import-summary'), 'the preview');

          // Preview: side-effect free. No upload, no request, thumbnails from object URLs.
          assert.equal(uploader.calls.length, 0, 'nothing is uploaded by the preview');
          assert.deepEqual(network.pluginCalls(), [], 'the preview sends no request');
          const figures = allByTestId('mex-import-picture');
          assert.equal(figures.length, 5);
          assert.deepEqual(
            figures.map((figure) => figure.getAttribute('data-reason')),
            ['upload', 'upload', 'upload', 'format', 'upload']
          );
          const images = figures.map((figure) => figure.querySelector('img'));
          assert.equal(images[0].getAttribute('src').startsWith('blob:mex-test/'), true);
          assert.equal(images[0].getAttribute('alt'), 'Valley at dawn');
          assert.equal(images[1].getAttribute('alt'), 'Lake at noon');
          assert.equal(images[3], null, 'the EMF drawing has no thumbnail');
          assert.equal(urls.created(), 3, 'one object URL per different picture part with a raster type');
          const notes = byTestId('mex-import-notes').textContent;
          assert.match(notes, /4 pictures are uploaded to the Media Library when you insert the content/);
          assert.match(notes, /1 picture is a vector drawing or another format \(for example EMF or WMF\)/);
          assert.match(byTestId('mex-import-preview').textContent, /Between the pictures/);

          await click(byTestId('mex-import-insert'));
          await waitFor(() => byTestId('mex-import-uploading'), 'the progress line');
          assert.match(byTestId('mex-import-uploading').textContent, /Uploading picture \d of 3…/);
          assert.ok(byTestId('mex-import-uploading').querySelector('[role="progressbar"]'));
          await waitFor(() => /picture 2 of 3/.test(byTestId('mex-import-uploading').textContent), '2 of 3');
          assert.equal(byTestId('mex-import-insert'), null, 'no second insert while uploading');
          assert.ok(byTestId('mex-import-stop'), 'Stop uploading is offered');
          resume();
          await waitFor(() => imported.length === 1, 'the import');

          // Three different raster parts: each uploaded once, one after the other, with its alt text.
          assert.equal(uploader.maxInFlight(), 1, 'uploads never overlap');
          assert.deepEqual(
            uploader.calls.map((call) => [call.name, call.type, call.alt]),
            [
              ['field-report-image-1.png', 'image/png', 'Valley at dawn'],
              ['field-report-image-2.jpg', 'image/jpeg', 'Lake at noon'],
              ['field-report-image-3.png', 'image/png', 'Damaged picture'],
            ]
          );
          const blocks = imported[0].blocks;
          const summary = blocks.map((block) =>
            block.type === 'image' ? `image ${block.data.file.url} "${block.data.file.alt}"` : block.data.text
          );
          assert.deepEqual(summary, [
            'Synthetic field report',
            'image /uploads/picture_1.png "Valley at dawn"',
            'Between the pictures',
            'image /uploads/picture_2.jpg "Lake at noon"',
            '<i>[Image: Damaged picture]</i>',
            '<i>[Image: Chart drawing]</i>',
            'image /uploads/picture_1.png "Valley again"',
          ]);
          assert.equal(blocks[1].data.file.id, 1, 'the Media Library file id is kept');

          // The failure is reported; the dialog stays open with the summary.
          await waitFor(() => byTestId('mex-import-done'), 'the summary');
          assert.equal(closed, 0);
          assert.match(
            byTestId('mex-import-done').textContent,
            /Content inserted\. 3 pictures were uploaded\./
          );
          assert.match(
            byTestId('mex-import-failures').textContent,
            /1 picture stays a placeholder.*Damaged picture: The image file is damaged/
          );
          assert.equal(document.activeElement, byTestId('mex-import-done'), 'focus on the summary');
        },
      }
    );
    assert.equal(urls.live.size, 0, 'every object URL is revoked when the dialog closes');
  } finally {
    urls.restore();
  }
});

test('import pictures: without the upload permission, or in a field without images, nothing is uploaded', async () => {
  const urls = stubObjectUrls();
  const docx = await picturesDocx();
  try {
    for (const rights of [
      {
        canUpload: false,
        imagesAllowed: true,
        text: /You may not upload files to the Media Library, so 4 pictures stay placeholders\./,
      },
      {
        canUpload: true,
        imagesAllowed: false,
        text: /This field does not allow images, so 4 pictures stay placeholders\./,
      },
    ]) {
      const uploader = fakeUploader();
      const imported = [];
      let closed = 0;
      await checkStrictEntry(
        <ImportDialog
          t={t}
          hasContent={false}
          canUpload={rights.canUpload}
          imagesAllowed={rights.imagesAllowed}
          uploadImage={uploader.upload}
          onImport={async (blocks) => {
            imported.push(blocks);
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
            await chooseFile(docx, 'field-report.docx');
            await waitFor(() => byTestId('mex-import-summary'), 'the preview');
            assert.match(byTestId('mex-import-notes').textContent, rights.text);
            assert.deepEqual(
              allByTestId('mex-import-picture').map((figure) => figure.getAttribute('data-reason')),
              rights.canUpload
                ? ['field', 'field', 'field', 'format', 'field']
                : ['permission', 'permission', 'permission', 'format', 'permission']
            );
            await click(byTestId('mex-import-insert'));
            await waitFor(() => imported.length === 1, 'the import');
            assert.equal(uploader.calls.length, 0);
            assert.equal(imported[0].filter((block) => block.type === 'image').length, 0);
            assert.equal(closed, 1, 'no failure: the dialog closes as before');
          },
        }
      );
    }
  } finally {
    urls.restore();
  }
});

test('import pictures: "Stop uploading" keeps the remaining pictures as placeholders', async () => {
  const urls = stubObjectUrls();
  let release;
  const firstStarted = new Promise((resolve) => {
    release = resolve;
  });
  let continueFirst;
  const hold = new Promise((resolve) => {
    continueFirst = resolve;
  });
  const uploader = fakeUploader({
    gate: async (count) => {
      if (count === 1) {
        release();
        await hold;
      }
    },
  });
  const imported = [];
  const docx = await picturesDocx();
  try {
    await checkStrictEntry(
      <ImportDialog
        t={t}
        hasContent={false}
        canUpload
        imagesAllowed
        uploadImage={uploader.upload}
        onImport={async (blocks) => {
          imported.push(blocks);
          return true;
        }}
        onClose={() => {}}
      />,
      {
        permissions: ALL,
        whileMounted: async () => {
          await waitFor(() => dialog(), 'the import dialog');
          await chooseFile(docx, 'field-report.docx');
          await waitFor(() => byTestId('mex-import-summary'), 'the preview');
          await click(byTestId('mex-import-insert'));
          await firstStarted;
          await waitFor(() => byTestId('mex-import-stop'), 'the stop button');
          await click(byTestId('mex-import-stop'));
          continueFirst();
          await waitFor(() => imported.length === 1, 'the import');
          assert.equal(uploader.calls.length, 1, 'no upload after Stop');
          assert.deepEqual(
            imported[0].map((block) => block.type),
            ['paragraph', 'image', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'image']
          );
          await waitFor(() => byTestId('mex-import-failures'), 'the summary');
          assert.match(byTestId('mex-import-failures').textContent, /Lake at noon: not uploaded \(stopped\)/);
        },
      }
    );
  } finally {
    urls.restore();
  }
});

test('pictureFileName: Word file name, number and the detected type', () => {
  assert.equal(pictureFileName('Field report.docx', 2, 'image/jpeg'), 'Field-report-image-2.jpg');
  assert.equal(pictureFileName('../../etc/passwd.docx', 1, 'image/png'), 'etc-passwd-image-1.png');
  assert.equal(pictureFileName('', 3, 'image/webp'), 'word-image-3.webp');
});

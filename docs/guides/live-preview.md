# Strapi Preview with Magic Editor X fields

Strapi's Preview shows your front end in an iframe next to the entry. Since 2.6 Magic Editor X helps a front end in three ways:

- **Block attributes**: every rendered top-level block can carry its block id and field path, so the page knows which field and block an element comes from, and Strapi's preview highlights the field.
- **Click-to-locate**: a click on a block opens the entry in the Content Manager with the caret in that block.
- **Live updates**: while someone edits the field in Strapi's preview, your page can re-render it on every change.

Real typing inside your page is not possible: Strapi has no API for a front end to send edits back. What Strapi offers, what changed in 5.62 and why is in [docs/live-preview.md](../live-preview.md).

Plans: Preview (full screen) is in every Strapi plan. Strapi documents Live Preview (side editor, double-click editing, experimental) for the Growth and Enterprise plans. Everything below works with the full-screen preview; the message path additionally works with the side editor.

## 1. Turn on Strapi's preview

`config/admin.js` (Strapi's [Preview docs](https://docs.strapi.io/cms/features/preview)):

```js
module.exports = ({ env }) => ({
  // ...
  preview: {
    enabled: true,
    config: {
      allowedOrigins: [env('CLIENT_URL')],
      async handler(uid, { documentId, locale, status }) {
        if (uid !== 'api::article.article') return null;
        return `${env('CLIENT_URL')}/preview/article?${new URLSearchParams({ documentId, locale, status })}`;
      },
    },
  },
});
```

Your front end must allow the admin to frame it (`Content-Security-Policy: frame-ancestors <admin origin>`) and speak Strapi's preview protocol: post `previewReady` to the parent, insert the script from `strapiScript`, reload on `strapiUpdate` (section 4 has the code).

## 2. Render with block attributes

Content API: add `mexBlockIds=true` to `?mex=html`. With Strapi's preview header `strapi-encode-source-maps: true` (send it only for previews, as Strapi recommends), the blocks also get `data-strapi-source`:

```js
const params = new URLSearchParams({ mex: 'html', mexBlockIds: 'true', status: 'draft', locale });
const res = await fetch(`${STRAPI}/api/articles/${documentId}?${params}`, {
  headers: { Authorization: `Bearer ${token}`, 'strapi-encode-source-maps': 'true' },
});
const { data } = await res.json();
// data.body: '<h2 class="mex-header" data-mex-block-id="intro01" data-mex-field-path="body" data-strapi-source="documentId=…&type=json&model=api%3A%3Aarticle.article&kind=collectionType&locale=en&fieldPath=body">…'
```

Renderer (`renderHtml`, `renderTree`, React and Vue components): the option `blockIds`.

```js
import { renderHtml } from 'magic-editor-x/render';

const html = renderHtml(article.body, {
  blockIds: {
    field: 'body', // the Content Manager path, e.g. 'sections.2.body' in a repeatable component
    strapiSource: {
      documentId: article.documentId,
      model: 'api::article.article',
      kind: 'collectionType',
      locale: article.locale,
    },
  },
});
```

`blockIds: true` writes only `data-mex-block-id`. The option is off by default; without it the output does not change. Ids, paths and entry values that do not match strict patterns are left out. Raw HTML from string overrides, and React/Vue `components` that drop the default output, carry no attributes.

Why `data-strapi-source` has no `path` key: Strapi 5.62's preview script replaces the text of every element whose source contains `path=<field>` when a field that is not a Strapi Blocks field changes, which turns a rendered Magic Editor X field into "[object Object]". With `fieldPath` only, the script highlights the field and opens it on double-click, and leaves your DOM alone.

## 3. Click-to-locate

`magic-editor-x/render` exports:

| Helper                                                                           | Use                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editViewUrl({ adminUrl, model, kind?, documentId?, locale?, field, blockId? })` | Edit view URL with `mexField`/`mexBlock`; the field shows the block when the page opens. `null` for invalid input.                                                                           |
| `requestLocate({ field, blockId, adminOrigin, timeoutMs? })`                     | From inside Strapi's preview iframe: asks a mounted field (Live Preview side editor) to show the block. Resolves `true` when a field answered (`magic-editor-x:located`), `false` otherwise. |
| `locateMessage(field, blockId)`                                                  | The message `requestLocate` posts: `{ type: 'magic-editor-x:locate', field, blockId }`.                                                                                                      |
| `isBlockId`, `isFieldPath`, `strapiSourceValue`                                  | The validators and the `data-strapi-source` value the renderer uses.                                                                                                                         |

In the full-screen preview the edit form is not on the page, so the front end opens the edit view (`window.open(href, '_top')`). With the side editor, the field answers the message and nothing navigates. The field also starts when it waits for the viewport (lazy start) and says "This block is no longer in the field." when the block was moved or deleted. Fields inside collapsed repeatable components or dynamic zone entries are not mounted by the Content Manager and cannot be located until expanded.

Strapi's highlight lies above the field and re-dispatches single clicks to the marked block element (after its double-click delay), so listen to `click` on the block, not on a button inside it. Keyboard users get a link per block.

## 4. Example front-end script

Tested on Strapi 5.62.0 (community edition) in Chromium at 1440 and 390 px, light and dark. It assumes the page renders each field inside `<div data-mex-root="<field path>">` from `?mex=html&mexBlockIds=true`.

```js
import { requestLocate, editViewUrl, renderHtml } from 'magic-editor-x/render';

const ADMIN = 'https://cms.example.test'; // admin origin
const entry = { model: 'api::article.article', documentId, locale };
const inPreview = window.parent !== window;

// Strapi's preview protocol (public events).
window.addEventListener('message', (event) => {
  if (event.origin !== ADMIN || !event.data) return;
  if (event.data.type === 'strapiScript') {
    const script = document.createElement('script');
    script.textContent = event.data.payload.script;
    document.head.append(script);
  }
  if (event.data.type === 'strapiUpdate') location.reload();
  // Live update: every change of a field while someone edits it in the preview.
  if (event.data.type === 'strapiFieldChange') {
    const { field, value } = event.data.payload || {};
    const root =
      typeof field === 'string' && document.querySelector(`[data-mex-root="${CSS.escape(field)}"]`);
    if (!root) return;
    root.innerHTML = renderHtml(value, {
      blockIds: { field, strapiSource: { ...entry, kind: 'collectionType' } },
    });
    decorate(root);
  }
});
if (inPreview) window.parent.postMessage({ type: 'previewReady' }, ADMIN);

const hrefOf = (block) =>
  editViewUrl({
    adminUrl: `${ADMIN}/admin`,
    ...entry,
    field: block.dataset.mexFieldPath,
    blockId: block.dataset.mexBlockId,
  });

async function locate(block) {
  const href = hrefOf(block);
  if (!href) return;
  const handled = await requestLocate({
    field: block.dataset.mexFieldPath,
    blockId: block.dataset.mexBlockId,
    adminOrigin: ADMIN,
  });
  if (!handled) window.open(href, '_top');
}

function decorate(scope) {
  for (const block of scope.querySelectorAll('[data-mex-block-id][data-mex-field-path]')) {
    const href = hrefOf(block);
    if (!href) continue;
    // Keyboard: one link per block.
    const link = Object.assign(document.createElement('a'), {
      className: 'mex-edit',
      href,
      target: '_top',
      textContent: 'Edit block',
    });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      locate(block);
    });
    block.prepend(link);
    // Pointer: a click on the block (Strapi re-dispatches it from its highlight).
    if (inPreview)
      block.addEventListener('click', (event) => {
        if (!event.__strapi_redispatched && event.target.closest('a, button, input, summary')) return;
        event.preventDefault();
        locate(block);
      });
  }
}
decorate(document);
```

`renderHtml` treats `value` as untrusted (same output rules as on the server), so re-rendering admin input is safe. The live value is what the editor has typed: internal links, mentions and media are not resolved by the Content API until the entry is saved (`strapiUpdate` then reloads the page).

React or Vue: keep the field value in state, set it from `strapiFieldChange`, and render `MagicEditorXContent` with `options={{ blockIds: { field, strapiSource } }}`.

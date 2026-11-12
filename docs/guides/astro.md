# Render Magic Editor X content in Astro

Magic Editor X stores Editor.js JSON. Your Astro site reads it from the Strapi REST or GraphQL API and renders it with one of these:

| Approach                                 | Use when                                                             | JavaScript in the browser      |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `renderHtml` + `set:html`                | static or server-rendered pages (most sites)                         | none, or the tiny copy helper  |
| React component (`magic-editor-x/react`) | you already use `@astrojs/react` and want per-block React components | only if you hydrate the island |
| Vue component (`magic-editor-x/vue`)     | you already use `@astrojs/vue`                                       | only if you hydrate the island |

All three produce the same HTML from the same render tree: escaped text, validated URLs, no inline styles, stable `mex-` classes. Raw HTML blocks are left out unless you pass `rawHtml: 'allow'` and your own `sanitizeRaw`.

Install the plugin package in the Astro project as well (it is where the renderers live):

```sh
npm install magic-editor-x
```

## 1. `renderHtml` with `set:html`

`set:html` inserts a string without escaping. That is safe here because `renderHtml` builds its output only from known elements with escaped text; do not pass any other untrusted string to `set:html`.

```astro
---
// src/pages/articles/[slug].astro
import { renderHtml } from 'magic-editor-x/render';

const { slug } = Astro.params;
const response = await fetch(
  `${import.meta.env.STRAPI_URL}/api/articles?filters[slug][$eq]=${encodeURIComponent(slug)}`
);
const { data } = await response.json();
const article = data[0];

const html = renderHtml(article.content, {
  // Internal links follow slug changes: build the URL from the stored reference.
  links: ({ uid, documentId, locale }) =>
    uid === 'api::article.article' ? `/${locale ?? 'en'}/articles/${documentId}` : null,
  code: { lineNumbers: 'block', copyButton: { label: 'Copy code', copiedLabel: 'Copied' } },
});
---

<article class="prose" set:html={html} />

<script>
  // Wires the copy buttons (only needed with code.copyButton).
  import { enhanceCodeBlocks } from 'magic-editor-x/render';
  enhanceCodeBlocks();
</script>
```

`renderText(value)` gives a plain-text excerpt (meta descriptions, reading time) and `renderMarkdown(value)` gives Markdown (RSS, `llms.txt`).

## 2. React or Vue as an island or server component

Add the integration first (`npx astro add react` or `npx astro add vue`). Without a `client:*` directive Astro renders the component on the server only and ships no JavaScript; that is the right default for content.

```astro
---
import { MagicEditorXContent } from 'magic-editor-x/react';
// or: import { MagicEditorXContent } from 'magic-editor-x/vue';
const { article } = Astro.props;
---

<!-- Server-rendered, no JavaScript in the browser. -->
<MagicEditorXContent value={article.content} />

<!-- Hydrated island: the copy buttons work through the component. -->
<MagicEditorXContent
  client:visible
  value={article.content}
  options={{ code: { lineNumbers: true, copyButton: true } }}
/>
```

Props of a hydrated island are serialised by Astro, so functions (`links`, `media`, `sanitizeRaw`, `overrides`, `components`) cannot be passed to a `client:*` component. Either render on the server (no directive), or wrap the component in your own React/Vue component that defines those functions and hydrate that wrapper. Without hydration, add the `enhanceCodeBlocks()` script from section 1 to make the copy buttons work.

## 3. Styling

The output has no inline styles, so it works under a strict Content Security Policy. Style the classes, for example:

```css
.mex-align-center {
  text-align: center;
}
.mex-image img {
  max-width: 100%;
  height: auto;
}

/* Code blocks: numbers come from CSS counters, so copying the code never includes them. */
.mex-code-lines code {
  counter-reset: mex-line;
}
.mex-code-line::before {
  counter-increment: mex-line;
  content: counter(mex-line);
  display: inline-block;
  min-width: 3ch;
  margin-right: 1.5ch;
  text-align: right;
  opacity: 0.6;
  user-select: none;
}
.mex-code-block {
  position: relative;
}
.mex-code-copy {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
.mex-code-copy-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
```

Classes: `mex-code-block` (wrapper, `data-mex-code="copy"`, only with a copy button), `mex-code` and `mex-code-lines` on `<pre>`, `language-<lang>` on `<code>` (codeFlask blocks, ready for Prism or Shiki), `mex-code-line` per line, `mex-code-copy` on the `<button type="button">`, `mex-code-copy-status` on the `role="status"` live region.

See also the [React guide](react.md) and the [Vue and Nuxt guide](vue-nuxt.md).

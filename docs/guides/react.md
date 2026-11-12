# Render Magic Editor X content in React

`magic-editor-x/react` exports `MagicEditorXContent`, a component that turns the stored value into React elements. It works with React 18 and 19, in the browser and on the server (`renderToString`, streaming, `renderToStaticMarkup`). It needs no extra package: React is already a peer dependency of the plugin, and your app brings its own React.

```jsx
import { MagicEditorXContent } from 'magic-editor-x/react';

export function Article({ article }) {
  return (
    <article className="prose">
      <MagicEditorXContent
        value={article.content}
        options={{
          links: ({ documentId, locale }) => `/${locale ?? 'en'}/articles/${documentId}`,
          code: { lineNumbers: 'block', copyButton: true },
        }}
      />
    </article>
  );
}
```

- `value`: the stored field value (object, JSON string or a 1.x value). `null` renders nothing.
- `options`: the same options as `renderHtml` (`links`, `media`, `embedHosts`, `imageSizes`, `code`, `rawHtml` + `sanitizeRaw`, `overrides`).
- `components`: per block type, a component that receives `{ block, helpers, children }`. `children` is the default output; return `null` to hide the block.

```jsx
const components = {
  productCard: ({ block, helpers }) => (
    <a className="card" href={helpers.url(block.data.url) || undefined}>
      {helpers.inline(block.data.title)}
    </a>
  ),
  paragraph: ({ children }) => <div className="lead">{children}</div>,
  toggle: ({ block, helpers }) => <section>{helpers.renderBlocks(block.children)}</section>,
};

<MagicEditorXContent value={article.content} components={components} />;
```

`helpers.text(html)` gives plain text, `helpers.url(value, schemes)` a validated URL or `''`, `helpers.inline(html)` React nodes of stored inline HTML (strict allow-list), `helpers.renderBlocks(blocks)` the child blocks of a toggle with your components applied. `block.data` is cleaned for built-in types and as stored for custom blocks: validate what you put into attributes.

Text is rendered as React text. `dangerouslySetInnerHTML` is used only for raw HTML blocks when you opt in with `rawHtml: 'allow'` and a `sanitizeRaw` function (for example DOMPurify or sanitize-html). A string returned from `options.overrides` is HTML and is used only through the same opt-in; return nodes (`helpers.h`) or use `components` instead.

## Copy buttons

With `code.copyButton`, the component renders a `<button type="button">` and a polite `role="status"` region per code block and copies the code with `navigator.clipboard.writeText` (secure contexts only; the status says "Copy failed" otherwise). Labels: `copyButton: { label, copiedLabel, failedLabel }`.

## Next.js App Router and React Server Components

`MagicEditorXContent` uses no hooks and renders in a Server Component, including `components` and function options. The copy button needs state and a click handler: in a Server Component it is rendered as static markup. Either render the component inside a Client Component (`'use client'`), or call `enhanceCodeBlocks()` from `magic-editor-x/render` in a small client effect, which wires the static buttons.

CSS for line numbers and the class list are in the [Astro guide](astro.md#3-styling).

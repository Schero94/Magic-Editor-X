# Custom blocks in code (block SDK)

Magic Editor X 2.3 lets you define a block type in code, once, and use the same definition everywhere: the server cleans and validates the stored data with it, the admin shows your editor tool for it, and the renderers (HTML, text, Markdown, React, Vue, the Content API `?mex=` output and GraphQL `…Rendered`) output it.

Use it when a block needs real code: your own editor UI, strict data rules, or frontend output you control. Blocks created in **Settings > Custom blocks** (fields plus an HTML template) keep working as before; you can use both.

## 1. Define the block

Put the definition in a file that both the server and the admin import, for example `src/blocks/callout-card.mjs`:

```js
import { defineBlock } from 'magic-editor-x/blocks';

export const calloutCard = defineBlock({
  name: 'calloutCard',
  version: 1,
  title: 'Callout card',
  schema: {
    title: { type: 'text', max: 120, label: 'Title' },
    body: { type: 'inline', max: 2000, label: 'Text' },
    link: { type: 'url', schemes: ['http', 'https'], label: 'Link' },
    tone: { type: 'enum', values: ['info', 'success', 'warning'], label: 'Tone' },
  },
  presets: ['article'],
  render: (block, { h, inlineNodes }) =>
    h('aside', { class: `callout-card callout-card-${block.data.tone}`, 'data-mex-block': block.type }, [
      block.data.title ? h('p', { class: 'callout-card-title' }, block.data.title) : null,
      h('div', { class: 'callout-card-body' }, inlineNodes(block.data.body)),
      block.data.link ? h('a', { class: 'callout-card-link', href: block.data.link }, 'Read more') : null,
    ]),
  text: (data, { text }) => [data.title, text(data.body), data.link].filter(Boolean).join('\n'),
  markdown: (data, { escape, inline }) =>
    [
      data.title ? `**${escape(data.title)}**` : '',
      inline(data.body),
      data.link ? `[Read more](<${data.link}>)` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});
```

`magic-editor-x/blocks` is a small ES module and CommonJS bundle without dependencies or Node built-ins, so the same file works in Strapi, the admin and your frontend.

### Definition keys

| Key           | Required | Meaning                                                                                                                       |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `name`        | yes      | Stored block type, `/^[A-Za-z][A-Za-z0-9_-]{1,49}$/`. Not a built-in tool name (`RESERVED_BLOCK_NAMES`), unique ignoring case |
| `version`     | no       | Integer 1 to 1000000 (default 1), shown in Settings > Custom blocks                                                           |
| `title`       | no       | Display name (toolbox fallback, JSON Schema title)                                                                            |
| `schema`      | yes      | The stored data: `{ key: field }` (1 to 50 keys)                                                                              |
| `sanitize`    | no       | `(data, { sanitizeUrl }) => data`: extra cleaning after the schema. The result is cleaned by the schema again                 |
| `render`      | no       | `(block, helpers) => nodes`: HTML, React and Vue output from render-tree nodes                                                |
| `text`        | no       | `(data, { text }) => string`: plain text output                                                                               |
| `markdown`    | no       | `(data, { escape, inline, text }) => string`: Markdown output (escape what you write)                                         |
| `presets`     | no       | Named presets that include the block: `article`, `basic`, `minimal` (the `full` preset includes every block)                  |
| `description` | no       | Free text (at most 500 characters)                                                                                            |

### Field types

| Type      | Options                                                                              | Stored value after cleaning                                                                  |
| --------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `text`    | `max` (default 1000, at most 100000), `multiline`, `default`                         | Plain text cut to `max`. Renderers escape it                                                 |
| `inline`  | `max` (default 10000), `default`                                                     | Inline HTML through the shared inline policy (b, i, u, s, mark, code, a, br, span, sub, sup) |
| `url`     | `schemes` (http, https, mailto, tel; default http, https), `relative` (default true) | `sanitizeUrl` result, `''` when not allowed                                                  |
| `enum`    | `values` (1 to 100 strings), `default` (first value)                                 | One of `values`, else the default                                                            |
| `number`  | `min`, `max`, `integer`, `default`                                                   | A finite number in range, else the default (the key is left out without a default)           |
| `boolean` | `default` (false)                                                                    | `true` or `false`                                                                            |
| `array`   | `items` (a field), `max` (default 50, at most 500)                                   | At most `max` cleaned items; items of another JavaScript type are dropped                    |
| `object`  | `fields` (`{ key: field }`)                                                          | The declared keys only                                                                       |

Every field takes an optional `label`. Arrays and objects nest at most four levels; at most 20000 values are cleaned per block. Cleaning never throws and always gives the same result for the same input: unknown keys are dropped, wrong types become the default. `blockJsonSchema(definition)` returns the JSON Schema (2020-12) of exactly that stored shape, and `types/blocks.d.ts` infers the data type from the schema (`BlockData<typeof schema>`).

## 2. Register it on the server

In the host app's `src/index.js` (or `.ts`), in `register()`:

```js
'use strict';

// Node 22.12+ loads the ES module definition with require().
const { calloutCard } = require('./blocks/callout-card.mjs');

module.exports = {
  register({ strapi }) {
    strapi.plugin('magic-editor-x').service('blocks').register(calloutCard);
  },
  bootstrap() {},
};
```

From then on, on every write through the Document Service (Content Manager, Content API, scripts), the block's data is cleaned with the schema and checked against the field preset; collaboration updates are checked with the same preset rules; `?mex=html|text|markdown|json`, GraphQL `<field>Rendered`, the quality panel, the version diff, find and replace and the AI field actions use the definition.

Rules:

- Register in `register()`. After the plugin's bootstrap the registry is sealed; a later `register` throws `REGISTRY_SEALED`.
- A name that is a built-in tool name, or a name registered twice by different definitions, throws `BlockDefinitionError` (`RESERVED_NAME`, `NAME_TAKEN`) with the block name in the message.
- A block created in Settings > Custom blocks with the same name (ignoring case) stops the start with a `NAME_TAKEN` error naming the block: the code definition and the Settings block cannot both own the name. New Settings blocks and imports cannot take a code-registered name.
- If you remove a definition later, stored blocks of that type are kept: they go back to the generic policy that applies to Settings blocks (every string is treated as inline HTML, keys named like URLs are checked as URLs), so nothing is lost, and frontends render them with the neutral output.

`strapi.plugin('magic-editor-x').service('blocks')` also has `list()`, `get(name)` and `isRegisteredName(name)`.

## 3. Register the editor tool in the admin

In the host app's `src/admin/app.js` (or `.tsx`), call the plugin's admin API (Strapi admin `registerPlugin({ apis })`, read with `app.getPlugin(id).apis`):

```js
import { calloutCard } from '../blocks/callout-card.mjs';
import { CalloutCardTool } from './callout-card-tool';

export default {
  register(app) {
    app.getPlugin('magic-editor-x').apis.registerBlock({
      definition: calloutCard,
      tool: CalloutCardTool,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…</svg>',
      title: { en: 'Callout card', de: 'Hinweiskarte' },
      inlineToolbar: true,
      i18n: { de: { title: 'Titel', body: 'Text', link: 'Link', tone: 'Ton' } },
    });
  },
};
```

| Option          | Meaning                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `definition`    | The same definition as on the server                                                                          |
| `tool`          | An Editor.js block tool class, or `apis.createReactTool(Component)`                                           |
| `title`         | Toolbox title, a string or `{ locale: title }` (default: the definition's title or name)                      |
| `icon`          | SVG for the toolbox (sanitised)                                                                               |
| `i18n`          | `{ locale: { key: text } }`, read by the tool with `config.translate(key, fallback)`                          |
| `inlineToolbar` | Offer bold, italic, links and the other inline tools allowed by the field preset in the tool's editable areas |
| `shortcut`      | Editor.js shortcut such as `CMD+SHIFT+K`                                                                      |

The tool's constructor receives `config` with `definition`, `clean(data)` (the schema cleaning with the admin's DOMPurify sanitiser), `translate(key, fallback)`, `locale` and `t`. Start from `config.clean(data)`: the value may come from another editor or an older version. Only put cleaned inline fields into `innerHTML`. When the tool does not declare `static get sanitize()`, Magic Editor X derives the Editor.js sanitize rules from the schema (inline fields keep the inline tags and internal-link attributes, other strings are kept as typed and cleaned by the schema).

A minimal vanilla tool:

```js
export class CalloutCardTool {
  static get isReadOnlySupported() {
    return true;
  }

  constructor({ data, config, readOnly, block }) {
    this.config = config;
    this.readOnly = readOnly;
    this.block = block;
    this.data = config.clean(data);
  }

  render() {
    this.title = document.createElement('input');
    this.title.value = this.data.title;
    this.title.disabled = this.readOnly;
    this.title.setAttribute('aria-label', this.config.translate('title', 'Title'));
    this.title.addEventListener('input', () => this.block.dispatchChange());
    this.body = document.createElement('div');
    this.body.contentEditable = String(!this.readOnly);
    this.body.innerHTML = this.data.body; // cleaned inline HTML
    const root = document.createElement('div');
    root.append(this.title, this.body);
    return root;
  }

  save() {
    return { ...this.data, title: this.title.value, body: this.body.innerHTML };
  }
}
```

To match the editor in light and dark mode, give form controls the editor's classes: `mex-tool__field` (label plus control), `mex-tool__label`, `mex-tool__input`, `mex-tool__select` and `mex-tool__input mex-tool__editable` for a contenteditable area.

With React, `apis.createReactTool(Component)` mounts the component with `createRoot` into the block and passes `{ data, onChange, readOnly, translate, definition }`; `onChange(next)` cleans the data and notifies Editor.js. The component runs in its own React root, so admin providers (theme, intl) are not available inside it.

Registered blocks appear in the toolbox of every field whose preset allows them (`full`, the presets in `presets`, or `allowedBlocks` listing the name). Undo, version history (with the diff), collaboration and comments work like for built-in blocks. **Settings > Custom blocks** lists code-registered blocks read-only as "Defined in code", with a warning when only the server or only the admin knows a block.

## 4. Render it in your frontend

Pass the definitions with the `blocks` option (use a stable array):

```js
import { renderHtml, renderText, renderMarkdown } from 'magic-editor-x/render';
import { calloutCard } from './blocks/callout-card.mjs';

const blocks = [calloutCard];
const html = renderHtml(article.body, { blocks });
```

```jsx
import { MagicEditorXContent } from 'magic-editor-x/react';

<MagicEditorXContent value={article.body} options={{ blocks }} />;
```

The Vue component takes the same `options`. Without the definition, frontends show the neutral output of unknown blocks (escaped field values in `<div class="mex-block mex-<type>">`). `overrides` and React `components` / Vue slots for the type still win over the definition.

`render(block, helpers)` returns render-tree nodes made with `helpers.h(tag, attrs, children)`, `helpers.textNode(text)` and `helpers.inlineNodes(html)`. They are validated like overrides: `on*`, `style` and `srcdoc` attributes, `script`, `style`, `iframe` without a valid `src` and other dangerous tags are dropped and URL attributes go through `sanitizeUrl`. Return `[]` to render nothing, or `null` for the default output (the fields in schema order). A string is HTML and is used only with `rawHtml: 'allow'` and your `sanitizeRaw`, also in `renderHtml`. A function that throws gives the default output.

The server renders `?mex=` and GraphQL with the registered definitions automatically.

## Security

Definitions are trusted code; block data is not. The schema bounds every value (lengths, array sizes, depth, value budget), checks URLs with `sanitizeUrl`, sends inline HTML through the same inline policy as built-in blocks (server: sanitize-html; admin: DOMPurify; renderers: the strict inline parser), and never stores unknown keys. Render output is built from validated nodes, never from strings, unless you opt into raw HTML. Your `text` and `markdown` functions return strings: use the `escape`, `inline` and `text` helpers for stored values.

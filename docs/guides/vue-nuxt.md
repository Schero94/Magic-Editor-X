# Render Magic Editor X content in Vue and Nuxt

`magic-editor-x/vue` exports `MagicEditorXContent`, a Vue 3 component built with `defineComponent` and `h()` (no SFC compile step). It renders on the server (Nuxt, `vue/server-renderer`) and in the browser. Vue is an optional peer dependency (`^3.5.0`): your app already has it; the plugin never installs it.

```vue
<script setup>
import { MagicEditorXContent } from 'magic-editor-x/vue';

const { data: article } = await useFetch('/api/article'); // your Strapi call
const options = {
  links: ({ documentId, locale }) => `/${locale ?? 'en'}/articles/${documentId}`,
  code: { lineNumbers: 'block', copyButton: true },
};
</script>

<template>
  <article class="prose">
    <MagicEditorXContent :value="article.content" :options="options" />
  </article>
</template>
```

In Nuxt you can register it globally in a plugin (`nuxtApp.vueApp.component('MagicEditorXContent', MagicEditorXContent)`) or import it where you need it.

## Per-block overrides

Use a scoped slot named `block-<type>`. It receives `{ block, helpers, children }`; `children` is the default output.

```vue
<MagicEditorXContent :value="article.content">
  <template #block-productCard="{ block, helpers }">
    <a class="card" :href="helpers.url(block.data.url) || undefined">
      {{ helpers.text(block.data.title) }}
    </a>
  </template>
  <template #block-paragraph="{ children }">
    <div class="lead"><component :is="() => children" /></div>
  </template>
</MagicEditorXContent>
```

Or pass components with the `components` prop. A component declares the props `block` and `helpers` and gets the default output in its default slot:

```js
import { defineComponent, h } from 'vue';

const Card = defineComponent({
  props: { block: Object, helpers: Object },
  setup: (props) => () => h('article', props.helpers.inline(props.block.data.title)),
});
// <MagicEditorXContent :value="article.content" :components="{ productCard: Card }" />
```

Slots win over `components`. Helpers: `text(html)`, `url(value, schemes)`, `inline(html)` (vnodes of stored inline HTML) and `renderBlocks(blocks)` (toggle children with your overrides applied).

Text is rendered as Vue text. `innerHTML` is used only for raw HTML blocks when you opt in with `rawHtml: 'allow'` and a `sanitizeRaw` function; string results of `options.overrides` need the same opt-in.

## Copy buttons

With `code.copyButton` each code block gets a `<button type="button">` and a polite `role="status"` region; a click copies the code with `navigator.clipboard.writeText` (secure contexts only). Nothing touches the DOM during server rendering.

CSS for line numbers and the class list are in the [Astro guide](astro.md#3-styling).

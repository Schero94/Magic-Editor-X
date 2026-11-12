/**
 * Vue 3 component for Magic Editor X content (`magic-editor-x/vue`).
 *
 * Turns the render tree of `magic-editor-x/render` into vnodes with `h()`
 * (no SFC compile step). Text children are escaped by Vue; `innerHTML` is
 * used only for raw nodes, which exist only when the caller opted in with
 * `rawHtml: 'allow'` and a `sanitizeRaw` function. SSR safe (Nuxt,
 * `vue/server-renderer`): nothing touches the DOM outside click handlers.
 */

import { h, defineComponent, ref } from 'vue';
import { createTreeBuilder } from '../render/tree.mjs';
import { VOID_TAGS } from '../render/nodes.mjs';
import { copyText } from '../render/dom.mjs';
import {
  isRenderableElement,
  safeAttributes,
  rawInner,
  isCopyBlock,
  copyBlockParts,
  componentFor,
} from './common.mjs';

/**
 * Vue props of an element node (`true` becomes '' so Vue writes a present attribute).
 * @param {{ attrs: Record<string, string | true> }} node - Element node.
 * @returns {Record<string, string>} Props.
 */
const propsOf = (node) => {
  /** @type {Record<string, string>} */
  const props = {};
  for (const [name, value] of safeAttributes(node.attrs)) props[name] = value === true ? '' : value;
  return props;
};

/** Code block with a working copy button and a polite live status. */
const CodeCopyBlock = defineComponent({
  name: 'MagicEditorXCodeCopy',
  props: { node: { type: Object, required: true }, ctx: { type: Object, required: true } },
  setup(props) {
    const status = ref('');
    return () => {
      const parts = copyBlockParts(props.node);
      const onClick = () => {
        copyText(parts.text).then((ok) => {
          status.value = ok ? parts.copied : parts.failed;
        });
      };
      return h(
        'div',
        propsOf(props.node),
        props.node.children.map((child) => {
          if (child.type === 'element' && child.tag === 'button' && child.attrs['data-mex-copy'])
            return h('button', { ...propsOf(child), onClick }, renderNodes(child.children, props.ctx));
          if (child.type === 'element' && child.attrs.role === 'status')
            return h(child.tag, propsOf(child), status.value);
          return renderNode(child, props.ctx);
        })
      );
    };
  },
});

/**
 * Renders one node.
 * @param {object} node - Render node.
 * @param {object} ctx - Render context (`components`, `slots`, `helpers`).
 * @returns {unknown} Vnode, string, array or null.
 */
const renderNode = (node, ctx) => {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'text') return node.value;
  if (node.type === 'block') {
    const children = renderNodes(node.children, ctx);
    const slot = ctx.slots && ctx.slots[`block-${node.block.type}`];
    if (typeof slot === 'function') return slot({ block: node.block, helpers: ctx.helpers, children });
    const Component = componentFor(ctx.components, node.block.type);
    if (Component)
      return h(Component, { block: node.block, helpers: ctx.helpers }, { default: () => children });
    return children;
  }
  if (node.type !== 'element' || !isRenderableElement(node)) return null;
  if (isCopyBlock(node)) return h(CodeCopyBlock, { node, ctx });
  const props = propsOf(node);
  if (VOID_TAGS.has(node.tag)) return h(node.tag, props);
  const html = rawInner(node);
  if (html !== null) return h(node.tag, { ...props, innerHTML: html });
  return h(node.tag, props, renderNodes(node.children, ctx));
};

/**
 * Renders a node list (raw nodes that are not an only child are dropped).
 * @param {object[]} nodes - Nodes.
 * @param {object} ctx - Render context.
 * @returns {unknown[]} Children for `h()`.
 */
function renderNodes(nodes, ctx) {
  return nodes.map((node) => renderNode(node, ctx)).filter((n) => n !== null);
}

/**
 * Renders stored Magic Editor X content.
 *
 * Per-type overrides: a scoped slot `block-<type>` (receives `{ block,
 * helpers, children }`, `children` being the default vnodes) or a
 * `components` map entry (receives the props `block` and `helpers`, which it
 * must declare, and the default output in its default slot). Slots win over
 * `components`. Helpers: `text(html)`, `url(value, schemes)`, `inline(html)`
 * and `renderBlocks(blocks)` returning vnodes.
 */
export const MagicEditorXContent = defineComponent({
  name: 'MagicEditorXContent',
  props: {
    /** Stored field value (object, JSON string, 1.x shapes); null renders nothing. */
    value: { type: null, default: null },
    /** `renderTree` options (links, media, embedHosts, code, overrides, ...). */
    options: { type: Object, default: undefined },
    /** Map of block type to component. */
    components: { type: Object, default: undefined },
  },
  setup(props, { slots }) {
    return () => {
      const builder = createTreeBuilder(props.value, props.options);
      const ctx = { components: props.components, slots, helpers: {} };
      ctx.helpers = {
        text: builder.helpers.text,
        url: builder.helpers.url,
        inline: (html) => renderNodes(builder.helpers.inlineNodes(html), ctx),
        renderBlocks: (blocks) => renderNodes(builder.renderBlocks(blocks), ctx),
      };
      return renderNodes(builder.nodes, ctx);
    };
  },
});

/**
 * Vnodes of a render tree (from `renderTree`), without overrides.
 * @param {object[]} nodes - Render nodes.
 * @returns {unknown[]} Children for `h()`.
 */
export const treeToVue = (nodes) =>
  renderNodes(Array.isArray(nodes) ? nodes : [], { components: null, slots: null, helpers: {} });

export default MagicEditorXContent;

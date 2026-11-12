/**
 * React component for Magic Editor X content (`magic-editor-x/react`).
 *
 * Turns the render tree of `magic-editor-x/render` into React elements with
 * `createElement` (no JSX build step). Text is passed as React text (escaped
 * by React); `dangerouslySetInnerHTML` is used only for raw nodes, which
 * exist only when the caller opted in with `rawHtml: 'allow'` and a
 * `sanitizeRaw` function. Works with React 18 and 19, on the server
 * (`renderToString`, `renderToStaticMarkup`, streaming) and in the browser.
 * `MagicEditorXContent` uses no hooks; only the code copy block does.
 */

import * as ReactNamespace from 'react';
import { createTreeBuilder } from '../render/tree.mjs';
import { VOID_TAGS, safeStyle } from '../render/nodes.mjs';
import { copyText } from '../render/dom.mjs';
import {
  isRenderableElement,
  safeAttributes,
  rawInner,
  isCopyBlock,
  copyBlockParts,
  componentFor,
} from './common.mjs';

const React =
  ReactNamespace.default && typeof ReactNamespace.default.createElement === 'function'
    ? ReactNamespace.default
    : ReactNamespace;

/** HTML attribute names that React spells differently. */
const PROP_NAMES = Object.freeze({
  class: 'className',
  for: 'htmlFor',
  accesskey: 'accessKey',
  allowfullscreen: 'allowFullScreen',
  autoplay: 'autoPlay',
  colspan: 'colSpan',
  contenteditable: 'contentEditable',
  controlslist: 'controlsList',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  disablepictureinpicture: 'disablePictureInPicture',
  frameborder: 'frameBorder',
  hreflang: 'hrefLang',
  imagesizes: 'imageSizes',
  imagesrcset: 'imageSrcSet',
  itemprop: 'itemProp',
  itemscope: 'itemScope',
  itemtype: 'itemType',
  maxlength: 'maxLength',
  playsinline: 'playsInline',
  readonly: 'readOnly',
  referrerpolicy: 'referrerPolicy',
  rowspan: 'rowSpan',
  spellcheck: 'spellCheck',
  srclang: 'srcLang',
  srcset: 'srcSet',
  tabindex: 'tabIndex',
  usemap: 'useMap',
});

/** Boolean attributes React accepts as `true`; other `true` values become ''. */
const BOOLEAN_PROPS = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'disablepictureinpicture',
  'download',
  'formnovalidate',
  'hidden',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

/**
 * React props of an element node.
 * @param {{ attrs: Record<string, string | true> }} node - Element node.
 * @param {string} key - React key.
 * @returns {Record<string, unknown>} Props.
 */
const propsOf = (node, key) => {
  /** @type {Record<string, unknown>} */
  const props = { key };
  for (const [name, value] of safeAttributes(node.attrs)) {
    props[PROP_NAMES[name] || name] = value === true && !BOOLEAN_PROPS.has(name) ? '' : value;
  }
  const style = safeStyle(node.style);
  if (style.length)
    props.style = Object.fromEntries(
      style.map(([name, value]) => [name.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()), value])
    );
  return props;
};

/**
 * Code block with a working copy button and a polite live status.
 * @param {object} props - Component props.
 * @param {object} props.node - Copy block node (`<div data-mex-code="copy">`).
 * @param {object} props.ctx - Render context.
 * @returns {import('react').ReactElement} Element.
 */
const CodeCopyBlock = ({ node, ctx }) => {
  // React Server Components have no state: render the static markup, which
  // `enhanceCodeBlocks()` can wire in the browser. The condition is fixed per
  // React build, so the hook order never changes between renders.
  if (typeof React.useState !== 'function') {
    const { key: _key, ...props } = propsOf(node, 'root');
    return React.createElement('div', props, ...renderNodes(node.children, ctx));
  }
  const [status, setStatus] = React.useState('');
  const parts = copyBlockParts(node);
  const onClick = () => {
    copyText(parts.text).then((ok) => setStatus(ok ? parts.copied : parts.failed));
  };
  const children = node.children.map((child, index) => {
    const key = `c${index}`;
    if (child.type === 'element' && child.tag === 'button' && child.attrs['data-mex-copy'])
      return React.createElement(
        'button',
        { ...propsOf(child, key), onClick },
        ...renderNodes(child.children, ctx)
      );
    if (child.type === 'element' && child.attrs.role === 'status')
      return React.createElement(child.tag, propsOf(child, key), status);
    return renderNode(child, ctx, key);
  });
  const { key: _key, ...props } = propsOf(node, 'root');
  return React.createElement('div', props, ...children);
};

/**
 * Renders one node.
 * @param {object} node - Render node.
 * @param {object} ctx - Render context (`components`, `helpers`).
 * @param {string} key - React key.
 * @returns {import('react').ReactNode} React node.
 */
const renderNode = (node, ctx, key) => {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'text') return node.value;
  if (node.type === 'block') {
    const children = renderNodes(node.children, ctx);
    const Component = componentFor(ctx.components, node.block.type);
    if (Component)
      return React.createElement(Component, { key, block: node.block, helpers: ctx.helpers, children });
    return React.createElement(React.Fragment, { key }, ...children);
  }
  if (node.type !== 'element' || !isRenderableElement(node)) return null;
  if (isCopyBlock(node)) return React.createElement(CodeCopyBlock, { key, node, ctx });
  const props = propsOf(node, key);
  if (VOID_TAGS.has(node.tag)) return React.createElement(node.tag, props);
  const html = rawInner(node);
  if (html !== null)
    return React.createElement(node.tag, { ...props, dangerouslySetInnerHTML: { __html: html } });
  return React.createElement(node.tag, props, ...renderNodes(node.children, ctx));
};

/**
 * Renders a node list. Raw nodes that are not the only child of an element
 * are dropped (a public tree never contains them).
 * @param {object[]} nodes - Nodes.
 * @param {object} ctx - Render context.
 * @returns {import('react').ReactNode[]} React nodes.
 */
function renderNodes(nodes, ctx) {
  return nodes.map((node, index) => renderNode(node, ctx, `n${index}`)).filter((n) => n !== null);
}

/**
 * Renders stored Magic Editor X content as React elements.
 *
 * `components[type]` replaces the output of one block type. It receives
 * `{ block, helpers, children }`: the block (`id`, `type`, cleaned `data`,
 * `tunes`, toggle `children` blocks), helpers (`text(html)`, `url(value,
 * schemes)`, `inline(html)` and `renderBlocks(blocks)` returning React nodes)
 * and the default output as `children`. Return `null` to hide the block.
 * `options` are the `renderTree` options (links, media, embedHosts, code, ...).
 * In React Server Components everything renders; the copy button
 * (`options.code.copyButton`) is then static markup: render the component in
 * a client component, or call `enhanceCodeBlocks()` in the browser.
 * @param {object} props - Component props.
 * @param {unknown} props.value - Stored field value (object, JSON string, 1.x shapes); null renders nothing.
 * @param {import('../../types/render').RenderOptions} [props.options] - Render options.
 * @param {Record<string, import('react').ComponentType<any>>} [props.components] - Per-type overrides.
 * @returns {import('react').ReactElement} Fragment with the content.
 */
export const MagicEditorXContent = ({ value, options, components }) => {
  const builder = createTreeBuilder(value, options);
  /** @type {{ components: unknown, helpers: object }} */
  const ctx = { components, helpers: {} };
  ctx.helpers = {
    text: builder.helpers.text,
    url: builder.helpers.url,
    inline: (html) => renderNodes(builder.helpers.inlineNodes(html), ctx),
    renderBlocks: (blocks) => renderNodes(builder.renderBlocks(blocks), ctx),
  };
  return React.createElement(React.Fragment, null, ...renderNodes(builder.nodes, ctx));
};

/**
 * React elements of a render tree (from `renderTree`), without overrides.
 * @param {object[]} nodes - Render nodes.
 * @returns {import('react').ReactNode[]} React nodes.
 */
export const treeToReact = (nodes) =>
  renderNodes(Array.isArray(nodes) ? nodes : [], { components: null, helpers: {} });

export default MagicEditorXContent;

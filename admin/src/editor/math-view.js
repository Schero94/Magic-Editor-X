import { cleanMathResult, MATHML_TAGS } from '../../../shared/render/mathml.mjs';

/**
 * Math in the admin (2.4): Temml is loaded on demand (a separate chunk, not
 * in the main admin bundle) the first time a field shows math, and its
 * MathML is turned into DOM nodes through the renderers' MathML allow-list
 * (`createElementNS`, never `innerHTML`).
 */

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const MATHML = new Set(MATHML_TAGS);

let loading = null;

/**
 * Loads the math helper (`renderMath`, `checkMath`) once per page.
 * @returns {Promise<{ renderMath: Function, checkMath: Function }>} Helper module.
 */
export const loadMath = () => {
  if (!loading)
    loading = import('../../../shared/math/index.mjs').catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
};

/**
 * DOM nodes of validated render nodes (MathML elements in the MathML namespace).
 * @param {Array<object>} nodes - Render nodes from `cleanMathResult`.
 * @returns {DocumentFragment} Fragment.
 */
export const nodesToDom = (nodes) => {
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === 'text') fragment.appendChild(document.createTextNode(node.value));
    else if (node.type === 'element' && MATHML.has(node.tag)) {
      const element = document.createElementNS(MATHML_NS, node.tag);
      for (const [name, value] of Object.entries(node.attrs || {}))
        element.setAttribute(name, value === true ? '' : String(value));
      element.appendChild(nodesToDom(node.children || []));
      fragment.appendChild(element);
    }
  }
  return fragment;
};

/**
 * Renders TeX into a container. Returns the error message when the TeX does
 * not parse ('' when it rendered or is empty).
 * @param {HTMLElement} container - Target (its children are replaced).
 * @param {{ renderMath: Function, checkMath: Function }} math - Helper module.
 * @param {string} tex - TeX source.
 * @param {boolean} display - Display style.
 * @returns {string} Error message or ''.
 */
export const renderMathInto = (container, math, tex, display) => {
  if (!tex.trim()) {
    container.replaceChildren();
    return '';
  }
  const nodes = cleanMathResult(math.renderMath(tex, { display }));
  if (nodes.length) {
    container.replaceChildren(nodesToDom(nodes));
    return '';
  }
  container.replaceChildren();
  const check = math.checkMath(tex, { display });
  return check.ok ? '' : check.message;
};

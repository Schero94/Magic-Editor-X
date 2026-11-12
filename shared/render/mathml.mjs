/**
 * Strict MathML allow-list for rendered math (2.4).
 *
 * The renderers never trust markup from a math renderer (`options.math`,
 * for example the `magic-editor-x/math` helper): its result is parsed here
 * into render nodes made only of MathML Core elements with validated
 * attributes. No `href`, no `style` (the only style the helper emits that
 * matters, a colour, becomes `mathcolor`/`mathbackground`), no `id`, no
 * event attributes, no `annotation-xml` and no element outside MathML, so
 * HTML, React and Vue output is identical and cannot carry script.
 *
 * No DOM and no dependencies.
 */

import { decodeEntities } from './inline.mjs';

/** MathML elements the renderers output. */
export const MATHML_TAGS = Object.freeze([
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mn',
  'mo',
  'ms',
  'mtext',
  'mspace',
  'msub',
  'msup',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mfrac',
  'msqrt',
  'mroot',
  'mstyle',
  'merror',
  'mpadded',
  'mphantom',
  'mtable',
  'mtr',
  'mtd',
  'mlabeledtr',
  'mmultiscripts',
  'mprescripts',
  'none',
  'menclose',
]);

const TAGS = new Set(MATHML_TAGS);

/** Attributes allowed on every MathML element (values checked by `ATTRIBUTE_VALUE`). */
const COMMON_ATTRIBUTES = new Set([
  'dir',
  'displaystyle',
  'scriptlevel',
  'mathvariant',
  'mathsize',
  'mathcolor',
  'mathbackground',
]);

/** Attributes allowed on some elements. */
const ELEMENT_ATTRIBUTES = Object.freeze({
  math: ['display'],
  mo: [
    'form',
    'fence',
    'separator',
    'stretchy',
    'symmetric',
    'largeop',
    'movablelimits',
    'lspace',
    'rspace',
    'minsize',
    'maxsize',
    'accent',
  ],
  mspace: ['width', 'height', 'depth'],
  mpadded: ['width', 'height', 'depth', 'lspace', 'voffset'],
  mfrac: ['linethickness'],
  mover: ['accent'],
  munder: ['accentunder'],
  munderover: ['accent', 'accentunder'],
  mtable: [
    'columnalign',
    'rowalign',
    'columnspacing',
    'rowspacing',
    'columnlines',
    'rowlines',
    'frame',
    'framespacing',
    'equalrows',
    'equalcolumns',
    'side',
  ],
  mtr: ['columnalign', 'rowalign'],
  mlabeledtr: ['columnalign', 'rowalign'],
  mtd: ['columnalign', 'rowalign', 'columnspan', 'rowspan'],
  menclose: ['notation'],
  annotation: ['encoding'],
});

/** Plain attribute values: lengths, keywords, numbers, alignment lists. */
const ATTRIBUTE_VALUE = /^[A-Za-z0-9 .%#+-]{0,100}$/;
/** Colours: hex or a CSS colour keyword. */
const COLOR_VALUE = /^(?:#[0-9A-Fa-f]{3,8}|[A-Za-z]{1,30})$/;
/** Class names the math helper writes (Temml). */
const CLASS_TOKEN = /^tml-[a-z0-9-]{1,40}$/;
/** The only annotation kept: the TeX source. */
const TEX_ENCODING = 'application/x-tex';

const MAX_INPUT = 200000;
const MAX_NODES = 20000;
const MAX_DEPTH = 64;

/**
 * Parses the attribute section of a start tag (same rules as the inline parser).
 * @param {string} source - Text between the tag name and `>`.
 * @returns {Record<string, string>} Attributes (lower-case names, decoded values, first wins).
 */
const parseAttributes = (source) => {
  const out = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(out, name)) continue;
    out[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return out;
};

/**
 * Colour from a `style` attribute (`color:` or `background-color:`), the only
 * style information kept (as a MathML attribute, so output has no inline style).
 * @param {string} style - Style attribute.
 * @param {'color'|'background-color'} property - Property.
 * @returns {string} Colour or ''.
 */
const styleColor = (style, property) => {
  const pattern = property === 'color' ? /(?:^|;)\s*color\s*:\s*([^;]+)/i : /background-color\s*:\s*([^;]+)/i;
  const match = pattern.exec(style);
  const value = match ? match[1].trim() : '';
  return COLOR_VALUE.test(value) ? value : '';
};

/**
 * Validated attributes of one MathML element.
 * @param {string} tag - Element name.
 * @param {Record<string, string>} attribs - Parsed or given attributes.
 * @returns {Record<string, string>|null} Clean attributes, or null to drop the element (other annotations).
 */
const cleanAttributes = (tag, attribs) => {
  const out = {};
  const allowed = ELEMENT_ATTRIBUTES[tag] || [];
  for (const [name, raw] of Object.entries(attribs)) {
    if (typeof raw !== 'string' && typeof raw !== 'number' && raw !== true) continue;
    const value = raw === true ? 'true' : String(raw);
    if (name === 'class') {
      const classes = value.split(/\s+/).filter((token) => CLASS_TOKEN.test(token));
      if (classes.length) out.class = classes.slice(0, 8).join(' ');
      continue;
    }
    if (name === 'encoding') {
      if (tag === 'annotation' && value === TEX_ENCODING) out.encoding = value;
      continue;
    }
    if (name === 'mathcolor' || name === 'mathbackground') {
      if (COLOR_VALUE.test(value)) out[name] = value;
      continue;
    }
    if (!COMMON_ATTRIBUTES.has(name) && !allowed.includes(name)) continue;
    if (ATTRIBUTE_VALUE.test(value)) out[name] = value;
  }
  if (typeof attribs.style === 'string') {
    const color = styleColor(attribs.style, 'color');
    const background = styleColor(attribs.style, 'background-color');
    if (color && !out.mathcolor) out.mathcolor = color;
    if (background && !out.mathbackground) out.mathbackground = background;
  }
  if (tag === 'annotation' && out.encoding !== TEX_ENCODING) return null;
  if (tag === 'math' && out.display && out.display !== 'block' && out.display !== 'inline')
    delete out.display;
  return out;
};

/**
 * Parses a MathML string into raw element/text nodes (no validation yet).
 * @param {string} input - Markup.
 * @returns {Array<object>} Nodes.
 */
const tokenize = (input) => {
  const source = input.slice(0, MAX_INPUT);
  const root = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let count = 0;
  let i = 0;
  const pushText = (text) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    const last = parent.children[parent.children.length - 1];
    const value = decodeEntities(text);
    if (last && last.type === 'text') last.value += value;
    else if (count < MAX_NODES) {
      parent.children.push({ type: 'text', value });
      count += 1;
    }
  };
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      pushText(source.slice(i));
      break;
    }
    pushText(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source[lt + 1] === '!' || source[lt + 1] === '?') {
      const end = source.indexOf('>', lt + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    const closing = source[lt + 1] === '/';
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]{0,40}/.exec(source.slice(lt + (closing ? 2 : 1), lt + 45));
    let end = -1;
    let quote = '';
    for (let j = lt + 1; j < source.length; j += 1) {
      const char = source[j];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') {
        end = j;
        break;
      }
    }
    if (!nameMatch || end === -1) {
      // Not a tag: text (escaped on output).
      pushText(source.slice(lt, end === -1 ? source.length : lt + 1));
      i = end === -1 ? source.length : lt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    const body = source.slice(lt + (closing ? 2 : 1) + nameMatch[0].length, end);
    i = end + 1;
    if (closing) {
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tag === tag) {
          stack.length = s;
          break;
        }
      }
      continue;
    }
    if (count >= MAX_NODES) continue;
    const element = { type: 'element', tag, attrs: parseAttributes(body), children: [] };
    stack[stack.length - 1].children.push(element);
    count += 1;
    const selfClosing = /\/\s*$/.test(body);
    if (!selfClosing && stack.length < MAX_DEPTH) stack.push(element);
  }
  return root.children;
};

/**
 * Validates element/text nodes against the allow-list. Elements outside the
 * list are dropped with their content (an HTML element, `annotation-xml`,
 * script); text directly under a token-free container is kept as text.
 * @param {Array<unknown>} nodes - Nodes (parsed or from a math renderer).
 * @param {{ budget: number }} ctx - Remaining node budget.
 * @param {number} depth - Depth.
 * @param {boolean} inAnnotation - Inside the TeX annotation (text only).
 * @returns {Array<object>} Render nodes.
 */
const clean = (nodes, ctx, depth, inAnnotation) => {
  const out = [];
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return out;
  for (const node of nodes) {
    if (ctx.budget <= 0) break;
    if (typeof node === 'string') {
      ctx.budget -= 1;
      if (node) out.push({ type: 'text', value: node });
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    ctx.budget -= 1;
    if (node.type === 'text') {
      if (typeof node.value === 'string' && node.value) out.push({ type: 'text', value: node.value });
      continue;
    }
    if (node.type !== 'element' || typeof node.tag !== 'string' || inAnnotation) continue;
    const tag = node.tag.toLowerCase();
    if (!TAGS.has(tag)) continue;
    const attrs = cleanAttributes(tag, node.attrs && typeof node.attrs === 'object' ? node.attrs : {});
    if (!attrs) continue;
    const children = clean(node.children, ctx, depth + 1, tag === 'annotation');
    out.push({ type: 'element', tag, attrs, children });
  }
  return out;
};

/**
 * Turns the result of a math renderer into safe render nodes: a MathML string
 * is parsed, nodes are validated. Only `<math>` elements at the top level are
 * kept.
 * @param {unknown} result - String (MathML) or render nodes.
 * @returns {Array<object>} `<math>` nodes ([] when nothing usable is left).
 */
export const cleanMathResult = (result) => {
  let nodes;
  if (typeof result === 'string') nodes = tokenize(result);
  else if (Array.isArray(result)) nodes = result;
  else if (result && typeof result === 'object') nodes = [result];
  else return [];
  const top = nodes.filter(
    (node) =>
      node && typeof node === 'object' && node.type === 'element' && String(node.tag).toLowerCase() === 'math'
  );
  return clean(top, { budget: MAX_NODES }, 0, false);
};

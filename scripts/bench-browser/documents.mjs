/**
 * Synthetic documents for the browser benchmark: a realistic text-heavy mix
 * (about 62% paragraphs with inline formatting and links, headings every
 * 12 blocks, lists with nesting, quotes, code, tables, warnings and
 * delimiters). No media blocks: images would need uploads or remote URLs,
 * which the isolated host and browser block. Ids and texts are
 * deterministic, so every run measures the same document.
 */

/**
 * One block of the mix.
 * @param {number} i - Index.
 * @returns {object} Editor.js block.
 */
const blockAt = (i) => {
  const id = `b${i}`;
  if (i % 12 === 0)
    return {
      id,
      type: 'header',
      data: { text: `Section ${i / 12 + 1}: field notes`, level: i % 48 === 0 ? 2 : 3 },
    };
  if (i % 25 === 3)
    return {
      id,
      type: 'list',
      data: {
        style: i % 50 === 3 ? 'ordered' : 'unordered',
        meta: {},
        items: [
          {
            content: `Point ${i} with <b>weight</b>`,
            meta: {},
            items: [{ content: `Nested <i>${i}</i>`, meta: {}, items: [] }],
          },
          { content: `Second point ${i}`, meta: {}, items: [] },
        ],
      },
    };
  if (i % 40 === 7)
    return {
      id,
      type: 'quote',
      data: { text: `A quoted line number ${i}.`, caption: 'Anna Beispiel', alignment: 'left' },
    };
  if (i % 40 === 17)
    return { id, type: 'code', data: { code: `const value${i} = compute(${i});\nconsole.log(value${i});` } };
  if (i % 50 === 29)
    return {
      id,
      type: 'table',
      data: {
        withHeadings: true,
        stretched: false,
        content: [
          ['Name', 'Value'],
          [`Row ${i}`, `<b>${i}</b> cm`],
          ['Total', `${i * 2}`],
        ],
      },
    };
  if (i % 100 === 41)
    return {
      id,
      type: 'warning',
      data: { title: 'Heads up', message: `Check item <b>${i}</b> before publishing.` },
    };
  if (i % 100 === 77) return { id, type: 'delimiter', data: {} };
  return {
    id,
    type: 'paragraph',
    data: {
      text:
        `Paragraph ${i} describes the valley in plain words, with <b>bold ${i}</b>, <i>italic</i> and ` +
        `<a href="https://www.example.test/p/${i % 97}">a link ${i}</a>. Sentences stay short so the text reads well.`,
    },
  };
};

/**
 * Editor.js document with `count` blocks.
 * @param {number} count - Number of blocks.
 * @param {{ changedEvery?: number }} [options] - Change every n-th paragraph (a draft after publishing).
 * @returns {{ time: number, version: string, blocks: object[] }} Document.
 */
export const makeDocument = (count, { changedEvery = 0 } = {}) => ({
  time: 1762850000000,
  version: '2.31.7',
  blocks: Array.from({ length: count }, (_, i) => {
    const block = blockAt(i);
    // A draft that differs from the published version in every n-th paragraph (2.12 marks).
    if (changedEvery && i % changedEvery === 5 && block.type === 'paragraph')
      block.data.text = `${block.data.text} Edited after publishing.`;
    return block;
  }),
});

/**
 * HTML for the paste scenario: `count` blocks (paragraphs, every fifth a heading, every tenth a list).
 * @param {number} count - Number of blocks.
 * @returns {string} HTML.
 */
export const makePasteHtml = (count) =>
  Array.from({ length: count }, (_, i) => {
    if (i % 10 === 9) return `<ul><li>Pasted item ${i}</li><li>Another item</li></ul>`;
    if (i % 5 === 0) return `<h3>Pasted heading ${i}</h3>`;
    return `<p>Pasted paragraph ${i} with <b>bold</b> and <a href="https://www.example.test/x/${i}">a link</a>.</p>`;
  }).join('');

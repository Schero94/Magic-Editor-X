/**
 * Builds minimal Word (.docx) files for the import tests with fflate (the same
 * ZIP library the reader uses): content types, package and document
 * relationships, styles (Title, Heading 1-3, Quote, Code, List Bullet) and a
 * numbering part with one bulleted (numId 1) and one numbered (numId 2) list.
 * Synthetic content only.
 */
import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A run with optional marks. */
export const r = (text, marks = {}) => {
  const props = [
    marks.b ? '<w:b/>' : '',
    marks.i ? '<w:i/>' : '',
    marks.u ? '<w:u w:val="single"/>' : '',
    marks.strike ? '<w:strike/>' : '',
    marks.sup ? '<w:vertAlign w:val="superscript"/>' : '',
    marks.sub ? '<w:vertAlign w:val="subscript"/>' : '',
    marks.highlight ? '<w:highlight w:val="yellow"/>' : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
};

/** A line break run. */
export const br = () => '<w:r><w:br/></w:r>';

/** A paragraph from runs (strings are plain runs). */
export const p = (runs, options = {}) => {
  const props = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.numId
      ? `<w:numPr><w:ilvl w:val="${options.ilvl || 0}"/><w:numId w:val="${options.numId}"/></w:numPr>`
      : '',
  ].join('');
  const content = (Array.isArray(runs) ? runs : [runs])
    .map((run) => (run.startsWith('<') ? run : r(run)))
    .join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
};

/** A hyperlink through a relationship id. */
export const link = (rId, text) => `<w:hyperlink r:id="${rId}">${r(text)}</w:hyperlink>`;

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/**
 * An inline picture run as Word writes it (2.13): `wp:inline` with `wp:docPr`
 * (description and title) and the `a:blip r:embed` that names the picture part.
 * @param {string} rId - Relationship id of the picture (see `docxFiles` `pictures`).
 * @param {{ descr?: string, title?: string, link?: boolean, anchor?: boolean }} [options] - Alt text; `link` writes `r:link` (a linked, not embedded picture); `anchor` a floating picture.
 * @returns {string} Run XML.
 */
export const picture = (rId, options = {}) => {
  const wrapper = options.anchor ? 'wp:anchor' : 'wp:inline';
  const docPr = `<wp:docPr id="7" name="Picture 7"${options.descr !== undefined ? ` descr="${esc(options.descr)}"` : ''}${options.title !== undefined ? ` title="${esc(options.title)}"` : ''}/>`;
  const blip = options.link ? `<a:blip r:link="${rId}"/>` : `<a:blip r:embed="${rId}"/>`;
  return `<w:r><w:drawing><${wrapper}><wp:extent cx="952500" cy="952500"/>${docPr}<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></${wrapper}></w:drawing></w:r>`;
};

/** A legacy VML picture (`w:pict` / `v:imagedata r:id`), as older Word files have. */
export const vmlPicture = (rId, alt = '') =>
  `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" alt="${esc(alt)}"><v:imagedata r:id="${rId}"/></v:shape></w:pict></w:r>`;

/** An inline image run (only the drawing properties the reader looks at). */
export const image = (descr) =>
  `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="${esc(descr)}"/></wp:inline></w:drawing></w:r>`;

/**
 * A table. Cells: string, or { text, span, merge: 'restart'|'continue' }. Header rows first.
 * @param {Array<Array<string|object>>} rows - Rows.
 * @param {{ headerRows?: number }} [options] - Header row count.
 * @returns {string} XML.
 */
export const table = (rows, options = {}) =>
  `<w:tbl><w:tblPr/>${rows
    .map(
      (row, index) =>
        `<w:tr>${index < (options.headerRows || 0) ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${row
          .map((cell) => {
            const c = typeof cell === 'string' ? { text: cell } : cell;
            const tcPr = [
              c.span ? `<w:gridSpan w:val="${c.span}"/>` : '',
              c.merge === 'restart'
                ? '<w:vMerge w:val="restart"/>'
                : c.merge === 'continue'
                  ? '<w:vMerge/>'
                  : '',
            ].join('');
            return `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${p(c.text || '')}</w:tc>`;
          })
          .join('')}</w:tr>`
    )
    .join('')}</w:tbl>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Kapitel"><w:name w:val="Kapitel"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
</w:styles>`;

const level = (ilvl, format, text) =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/></w:lvl>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0">${[0, 1, 2].map((i) => level(i, 'bullet', '•')).join('')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${[0, 1, 2].map((i) => level(i, 'decimal', `%${i + 1}.`)).join('')}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num>
</w:numbering>`;

/**
 * Builds the files of a .docx package.
 * @param {string} body - Body XML (paragraphs and tables).
 * @param {{ links?: Record<string, string>, pictures?: Record<string, { target: string, bytes?: Uint8Array, external?: boolean }>, extra?: Record<string, Uint8Array|string>, document?: string }} [options] - Hyperlink targets by relationship id; pictures by relationship id (target relative to `word/`, bytes stored at `word/<target>`); extra files; a replacement document part.
 * @returns {Record<string, Uint8Array>} Files.
 */
export const docxFiles = (body, options = {}) => {
  const links = options.links || {};
  const pictures = options.pictures || {};
  const relations = [
    `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>`,
    ...Object.entries(links).map(
      ([id, target]) =>
        `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${esc(target)}" TargetMode="External"/>`
    ),
    ...Object.entries(pictures).map(
      ([id, picture]) =>
        `<Relationship Id="${id}" Type="${REL}/image" Target="${esc(picture.target)}"${picture.external ? ' TargetMode="External"' : ''}/>`
    ),
  ].join('');
  const pictureParts = Object.fromEntries(
    Object.values(pictures)
      .filter((picture) => !picture.external && picture.bytes)
      .map((picture) => [`word/${picture.target}`, picture.bytes])
  );
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}</Relationships>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    'word/document.xml':
      options.document ||
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ...pictureParts,
    ...(options.extra || {}),
  };
  return Object.fromEntries(
    Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])
  );
};

/**
 * Builds a .docx file.
 * @param {string} body - Body XML.
 * @param {object} [options] - See `docxFiles`.
 * @returns {Uint8Array} ZIP bytes.
 */
export const buildDocx = (body, options = {}) => zipSync(docxFiles(body, options), { level: 6 });

/**
 * A real-world-like synthetic document: title, headings, marks, links,
 * nested bulleted and numbered lists, a table with a header row and merged
 * cells, a quote, a code paragraph and an image.
 * @returns {Uint8Array} ZIP bytes.
 */
export const sampleDocx = () =>
  buildDocx(
    [
      p('Field report: Example Valley', { style: 'Title' }),
      p(['Written for the ', r('synthetic', { i: true }), ' test team.']),
      p('Overview', { style: 'Heading1' }),
      p([
        'The valley is ',
        r('green', { b: true }),
        ', ',
        r('quiet', { u: true }),
        ' and ',
        r('old', { strike: true }),
        '. Water is H',
        r('2', { sub: true }),
        'O, area 3 km',
        r('2', { sup: true }),
        '. ',
        r('Key fact', { highlight: true }),
        '.',
      ]),
      p(['See the ', link('rIdDocs', 'project docs'), ' for details.']),
      p('Route', { style: 'Heading2' }),
      p('Pack the bag', { numId: 2 }),
      p('Water', { numId: 1, ilvl: 1 }),
      p('Map', { numId: 1, ilvl: 1 }),
      p('Walk to the lake', { numId: 2 }),
      p('Measurements', { style: 'Heading2' }),
      table(
        [
          ['Place', 'Height', 'Note'],
          [{ text: 'North', merge: 'restart' }, '120 m', 'Windy'],
          [{ merge: 'continue' }, '130 m', 'Calm'],
          [{ text: 'Summary row', span: 2 }, 'Done'],
        ],
        { headerRows: 1 }
      ),
      p('Measure twice, cut once.', { style: 'Quote' }),
      p('const height = 120;', { style: 'Code' }),
      p('console.log(height);', { style: 'Code' }),
      p(image('A green valley at dawn')),
      p('Second line follows.'),
    ].join(''),
    { links: { rIdDocs: 'https://docs.example.test/valley' } }
  );

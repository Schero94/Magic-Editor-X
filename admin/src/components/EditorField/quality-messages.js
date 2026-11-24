/**
 * Messages of the Quality panel (2.9: split out of QualityPanel.jsx): accessibility rules
 * (shared/quality.mjs), readability and SEO hints (shared/content-insights.mjs) and field preset
 * violations (shared/presets.mjs). Each entry is a translation key with its English default.
 */

export const RULES = {
  'image-alt-missing': { key: 'editor.quality.rule.imageAlt', text: 'Image without alternative text' },
  'heading-order': { key: 'editor.quality.rule.headingOrder', text: 'Heading level {level} skips a level' },
  'multiple-h1': { key: 'editor.quality.rule.multipleH1', text: 'More than one level 1 heading' },
  'empty-heading': { key: 'editor.quality.rule.emptyHeading', text: 'Empty heading' },
  'empty-link': { key: 'editor.quality.rule.emptyLink', text: 'Link without text or address' },
  'ambiguous-link-text': {
    key: 'editor.quality.rule.ambiguousLink',
    text: 'Link text "{text}" does not say where the link goes',
  },
  'video-no-captions': {
    key: 'editor.quality.rule.videoCaptions',
    text: 'Video without captions or subtitles',
  },
  'table-no-header': {
    key: 'editor.quality.rule.tableHeader',
    text: 'Table without a header row or header column',
  },
  'table-empty-header': {
    key: 'editor.quality.rule.tableEmptyHeader',
    text: '{count, plural, one {# empty header cell} other {# empty header cells}} in a table',
  },
  'low-contrast': {
    key: 'editor.quality.rule.lowContrast',
    text: 'Text colour contrast {ratio}:1 is below 4.5:1',
  },
  'toc-no-headings': {
    key: 'editor.quality.rule.tocNoHeadings',
    text: 'Table of contents without headings between level {minLevel} and {maxLevel}',
  },
  'math-invalid': {
    key: 'editor.quality.rule.mathInvalid',
    text: 'Formula that cannot be rendered (check the TeX)',
  },
  'footnote-empty': {
    key: 'editor.quality.rule.footnoteEmpty',
    text: 'Footnote without text',
  },
  'columns-empty-column': {
    key: 'editor.quality.rule.columnsEmptyColumn',
    text: 'Column {column} of a columns block has no text',
  },
  'color-contrast': {
    key: 'editor.quality.rule.colorContrast',
    text: '{mode, select, dark {Dark theme} other {Light theme}}: text colour / highlight {pair} has contrast {ratio}:1, below 4.5:1',
  },
};

/** 2.9: readability and SEO-structure hints (shared/content-insights.mjs). */
export const HINTS = {
  'reading-ease': {
    key: 'editor.quality.hint.readingEase',
    text: 'Reading ease {score} ({band, select, veryEasy {very easy} easy {easy} fairlyEasy {fairly easy} standard {standard} fairlyDifficult {fairly difficult} difficult {difficult} other {very difficult}}). Aim for {target} or more with shorter sentences and simpler words.',
  },
  'sentence-long': {
    key: 'editor.quality.hint.sentenceLong',
    text: '{count, plural, one {# sentence is} other {# sentences are}} longer than {max} words (longest {longest})',
  },
  'paragraph-long': {
    key: 'editor.quality.hint.paragraphLong',
    text: 'Paragraph of {words} words, more than {max}',
  },
  'passive-voice': {
    key: 'editor.quality.hint.passive',
    text: 'Possibly passive voice in {count, plural, one {# sentence} other {# sentences}}. Check whether an active sentence reads better.',
  },
  'complex-words': {
    key: 'editor.quality.hint.complexWords',
    text: '{percent}% complex words, more than {max}% (for example {words})',
  },
  'repeated-starts': {
    key: 'editor.quality.hint.repeatedStarts',
    text: '{count} sentences in a row start with "{word}"',
  },
  'extra-spaces': {
    key: 'editor.quality.hint.extraSpaces',
    text: '{count, plural, one {# spacing problem} other {# spacing problems}}: repeated spaces or a space before punctuation',
  },
  'h1-in-content': {
    key: 'editor.quality.hint.h1InContent',
    text: 'Level 1 heading in the content. The title field is the page heading, so use level 2 here.',
  },
  'h1-missing': {
    key: 'editor.quality.hint.h1Missing',
    text: 'No level 1 heading. This content provides the page heading, so start with one.',
  },
  'section-long': {
    key: 'editor.quality.hint.sectionLong',
    text: 'Section of {words} words without a subheading (more than {max})',
  },
  'internal-links': {
    key: 'editor.quality.hint.internalLinks',
    text: '{count, plural, =0 {No internal links} one {Only # internal link} other {Only # internal links}}. Link to at least {min} other {min, plural, one {page} other {pages}} of this site.',
  },
  'content-short': {
    key: 'editor.quality.hint.contentShort',
    text: '{words} words, fewer than the {min} recommended',
  },
  'keyphrase-intro': {
    key: 'editor.quality.hint.keyphraseIntro',
    text: 'The first paragraph does not mention "{keyphrase}"',
  },
  'keyphrase-headings': {
    key: 'editor.quality.hint.keyphraseHeadings',
    text: '{count, plural, one {The subheading (level 2 or 3) does not mention "{keyphrase}"} other {None of the # subheadings (level 2 or 3) mentions "{keyphrase}"}}',
  },
  'keyphrase-density': {
    key: 'editor.quality.hint.keyphraseDensity',
    text: '"{keyphrase}" appears {count, plural, one {# time} other {# times}} ({density}%). Aim for {min} to {max}%.',
  },
};

/** Field preset violations (shared/presets.mjs `checkPreset`). */
export const PRESET_RULES = {
  BLOCK_NOT_ALLOWED: {
    key: 'editor.preset.rule.block',
    text: 'Block type "{type}" is not allowed in this field',
  },
  HEADING_LEVEL: {
    key: 'editor.preset.rule.heading',
    text: 'Heading level {level} is not allowed in this field',
  },
  LINK_NOT_ALLOWED: {
    key: 'editor.preset.rule.link',
    text: '{kind, select, internal {Links to entries are} other {Links to web addresses are}} not allowed in this field',
  },
  ALT_REQUIRED: {
    key: 'editor.preset.rule.alt',
    text: 'Image needs an alternative text or must be marked as decorative',
  },
  TOO_MANY_BLOCKS: { key: 'editor.preset.rule.maxBlocks', text: '{count} blocks, at most {max} are allowed' },
  TOO_MANY_CHARACTERS: {
    key: 'editor.preset.rule.maxCharacters',
    text: '{count} characters, at most {max} are allowed',
  },
};

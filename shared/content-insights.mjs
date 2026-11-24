/**
 * Readability and SEO-structure hints (2.9) for Magic Editor X documents.
 *
 * Pure, deterministic and without dependencies: the editor's Quality panel
 * runs it in the browser (in idle-time slices, see `createInsightsRunner`), the
 * server runs it only in the publish guard, and only for rules an
 * administrator opted into (`blockPublish`). Every finding is a hint
 * (severity `hint`): hints never block saving and never count as quality
 * problems in the toolbar.
 *
 * Accessibility checks (heading order, several H1, alt texts, link texts) stay
 * in `quality.mjs`; this module never reports them again.
 *
 * Thresholds and their sources (checked 2026-11-20):
 * - Sentence length 20 words (en, de, fr) and 25 words (es, pt); a hint when
 *   more than 25 % of the sentences are longer. Paragraphs over 150 words.
 *   Sections over 300 words without a subheading. Passive voice in more than
 *   10 % of the sentences. Three or more consecutive sentences that start
 *   with the same word. Keyphrase density 0.5 to 3 % (texts of 100 words or
 *   more). Text length 300 words. Yoast SEO scoring documentation:
 *   https://github.com/Yoast/wordpress-seo/blob/trunk/packages/yoastseo/src/scoring/assessments/SCORING%20READABILITY.md
 *   https://github.com/Yoast/wordpress-seo/blob/trunk/packages/yoastseo/src/scoring/assessments/SCORING%20SEO.md
 * - Flesch Reading Ease (English): 206.835 - 1.015 x words per sentence -
 *   84.6 x syllables per word; 60 to 70 is "standard", lower is "fairly
 *   difficult" or harder. R. Flesch, "A new readability yardstick", Journal of
 *   Applied Psychology 32 (1948) 221-233.
 * - Amstad (German adaptation of Flesch): 180 - words per sentence - 58.5 x
 *   syllables per word, read on the same scale. T. Amstad, "Wie verständlich
 *   sind unsere Zeitungen?", dissertation, University of Zurich, 1978.
 * - Szigriszt-Pazos (Spanish): 206.835 - 62.3 x syllables per word - words per
 *   sentence, rated on the INFLESZ scale (55 to 65 "normal", lower "somewhat
 *   difficult"). F. Szigriszt-Pazos, "Sistemas predictivos de legibilidad del
 *   mensaje escrito", dissertation, Universidad Complutense de Madrid, 1993;
 *   I. M. Barrio-Cantalejo et al., "Validación de la Escala INFLESZ", Anales
 *   del Sistema Sanitario de Navarra 31 (2008) 135-152. Fernández Huerta (1959)
 *   is not used: its published coefficients carry a known transcription error.
 * - French and Portuguese have no score here: the Kandel-Moles and Martins
 *   adaptations depend on syllable rules this module cannot count reliably.
 * - Complex words: R. Gunning, "The Technique of Clear Writing" (1952), counts
 *   words of three or more syllables (English). German and Spanish use four
 *   syllables, because three-syllable words are ordinary there; the 20 %
 *   (English) and 15 % (German, Spanish) paragraph shares are our defaults, not
 *   taken from a study. Yoast flags more than 10 % complex words with its own,
 *   word-list based definition.
 *
 * Syllables are counted with vowel-group heuristics, so scores are estimates.
 * Passive voice is a heuristic for English and German only.
 */

import { isPlainObject, computeStats } from './editor-data.mjs';
import { parseInline, nodesToHtml, isMathNode, isFootnoteNode } from './render/inline.mjs';
import { isBuiltInBlock } from './sanitize-policy.mjs';
import { columnsTextFields } from './columns.mjs';
import { normalizeLinkText } from './quality.mjs';

/** Languages with language-aware rules. Other locales get the language-independent rules only. */
export const INSIGHT_LANGUAGES = Object.freeze(['en', 'de', 'fr', 'es', 'pt']);

/**
 * Rules: section, the setting that turns them on and off, whether an
 * administrator may make them block publishing, the languages they need and
 * whether the editor offers a "Fix".
 */
export const INSIGHT_RULES = Object.freeze({
  'reading-ease': { section: 'readability', setting: 'reading-ease', languages: ['en', 'de', 'es'] },
  'sentence-long': { section: 'readability', setting: 'sentence-long', blockable: true },
  'paragraph-long': { section: 'readability', setting: 'paragraph-long', blockable: true },
  'passive-voice': { section: 'readability', setting: 'passive-voice', languages: ['en', 'de'] },
  'complex-words': { section: 'readability', setting: 'complex-words', languages: ['en', 'de', 'es'] },
  'repeated-starts': { section: 'readability', setting: 'repeated-starts', blockable: true },
  'extra-spaces': { section: 'readability', setting: 'extra-spaces', blockable: true, fixable: true },
  'h1-in-content': { section: 'seo', setting: 'h1', blockable: true, fixable: true },
  'h1-missing': { section: 'seo', setting: 'h1', blockable: true },
  'section-long': { section: 'seo', setting: 'section-long', blockable: true },
  'internal-links': { section: 'seo', setting: 'internal-links', blockable: true },
  'content-short': { section: 'seo', setting: 'content-short', blockable: true },
  'keyphrase-intro': { section: 'seo', setting: 'keyphrase' },
  'keyphrase-headings': { section: 'seo', setting: 'keyphrase' },
  'keyphrase-density': { section: 'seo', setting: 'keyphrase' },
});

/** Setting names that switch rules on and off (one per row in Settings). */
export const INSIGHT_SETTINGS = Object.freeze([
  'reading-ease',
  'sentence-long',
  'paragraph-long',
  'passive-voice',
  'complex-words',
  'repeated-starts',
  'extra-spaces',
  'h1',
  'section-long',
  'internal-links',
  'content-short',
  'keyphrase',
]);

/** Settings an administrator may opt into the publish guard (deterministic, no keyphrase). */
export const BLOCKABLE_SETTINGS = Object.freeze(
  INSIGHT_SETTINGS.filter((name) =>
    Object.values(INSIGHT_RULES).some((rule) => rule.setting === name && rule.blockable)
  )
);

/** Bounds of the numeric settings (Settings form and server validation). */
export const CONTENT_CHECK_LIMITS = Object.freeze({
  minWords: Object.freeze({ min: 0, max: 20000 }),
  minInternalLinks: Object.freeze({ min: 0, max: 50 }),
  sentenceWords: Object.freeze({ min: 0, max: 100 }),
  paragraphWords: Object.freeze({ min: 20, max: 2000 }),
  sectionWords: Object.freeze({ min: 50, max: 5000 }),
});

/** Defaults: everything on, nothing blocks publishing, the CM title field is the page's H1. */
export const DEFAULT_CONTENT_CHECKS = Object.freeze({
  enabled: true,
  h1: 'title',
  disabled: Object.freeze([]),
  blockPublish: Object.freeze([]),
  minWords: 300,
  minInternalLinks: 1,
  sentenceWords: 0,
  paragraphWords: 150,
  sectionWords: 300,
});

/** Per-language thresholds (Yoast sentence length: 20 words by default, 25 for es and pt). */
const LANGUAGE_RULES = Object.freeze({
  en: { sentenceWords: 20, complexSyllables: 3, complexShare: 20, ease: 60, formula: 'flesch' },
  de: { sentenceWords: 20, complexSyllables: 4, complexShare: 15, ease: 60, formula: 'amstad' },
  fr: { sentenceWords: 20 },
  es: { sentenceWords: 25, complexSyllables: 4, complexShare: 15, ease: 55, formula: 'szigriszt' },
  pt: { sentenceWords: 25 },
});
const DEFAULT_SENTENCE_WORDS = 20;
/** More than this share (%) of long sentences gives hints (Yoast: 25 %). */
const LONG_SENTENCE_SHARE = 25;
/** More than this share (%) of passive sentences gives hints (Yoast: 10 %). */
const PASSIVE_SHARE = 10;
/** Consecutive sentences with the same first word (Yoast: 3). */
const REPEATED_STARTS = 3;
/** Keyphrase density range in % (Yoast: 0.5 to 3) and the text length it needs (100 words). */
const DENSITY_MIN = 0.5;
const DENSITY_MAX = 3;
const DENSITY_WORDS = 100;
/** The reading score needs this many words to mean anything. */
const SCORE_WORDS = 100;
/** Complex words are judged per paragraph from this length. */
const COMPLEX_MIN_WORDS = 15;
/** Most cached unit analyses (one per distinct text). */
const CACHE_LIMIT = 20000;

/**
 * Primary language subtag of a content locale, when this module knows it.
 * @param {unknown} locale - Locale such as `de-CH`.
 * @returns {string|null} Language, or null.
 */
export const insightLanguage = (locale) => {
  if (typeof locale !== 'string') return null;
  const language = locale.trim().toLowerCase().split(/[-_]/)[0];
  return INSIGHT_LANGUAGES.includes(language) ? language : null;
};

const clampInt = (value, { min, max }, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

/**
 * Normalises stored or sent content check settings; unknown values fall back to the defaults.
 * @param {unknown} input - Settings.
 * @returns {{ enabled: boolean, h1: 'title'|'content', disabled: string[], blockPublish: string[], minWords: number, minInternalLinks: number, sentenceWords: number, paragraphWords: number, sectionWords: number }} Settings.
 */
export const normalizeContentChecks = (input) => {
  const source = isPlainObject(input) ? input : {};
  const names = (list, allowed) =>
    Array.isArray(list) ? [...new Set(list.filter((name) => allowed.includes(name)))] : [];
  const d = DEFAULT_CONTENT_CHECKS;
  const L = CONTENT_CHECK_LIMITS;
  return {
    enabled: source.enabled !== false,
    h1: source.h1 === 'content' ? 'content' : 'title',
    disabled: names(source.disabled, INSIGHT_SETTINGS),
    blockPublish: names(source.blockPublish, BLOCKABLE_SETTINGS),
    minWords: clampInt(source.minWords, L.minWords, d.minWords),
    minInternalLinks: clampInt(source.minInternalLinks, L.minInternalLinks, d.minInternalLinks),
    sentenceWords: clampInt(source.sentenceWords, L.sentenceWords, d.sentenceWords),
    paragraphWords: clampInt(source.paragraphWords, L.paragraphWords, d.paragraphWords),
    sectionWords: clampInt(source.sectionWords, L.sectionWords, d.sectionWords),
  };
};

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;
const ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'st',
  'nr',
  'no',
  'vs',
  'etc',
  'ca',
  'bzw',
  'usw',
  'vgl',
  'sr',
  'sra',
  'av',
  'p',
  'pp',
  'z',
  'b',
  'e',
  'g',
  'i',
  'd',
]);
/** Sentence end: punctuation, optional closing quotes, space, and a capital or digit next. */
const SENTENCE_END = /[.!?…]+["'”’»)\]]*\s+(?=["'“„«‚([¿¡]?[\p{Lu}\p{N}])/gu;

/**
 * Plain text of inline HTML for reading: math and footnote notes are left out, `<br>` is a line break.
 * @param {Array} nodes - Parsed inline nodes.
 * @param {number} [depth] - Depth.
 * @returns {string} Text.
 */
const readingText = (nodes, depth = 0) => {
  if (depth > 40) return '';
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else if (node.tag === 'br') out += '\n';
    else if (isMathNode(node) || isFootnoteNode(node)) out += ' ';
    else out += readingText(node.children || [], depth + 1);
  }
  return out;
};

/**
 * Splits plain text into sentences (line breaks always end a sentence).
 * @param {string} text - Text.
 * @returns {string[]} Sentences with words.
 */
export const splitSentences = (text) => {
  const out = [];
  for (const line of String(text)
    .replace(/\u00a0/g, ' ')
    .split('\n')) {
    let start = 0;
    SENTENCE_END.lastIndex = 0;
    let match;
    while ((match = SENTENCE_END.exec(line)) !== null) {
      const before = line.slice(start, match.index);
      const last = /([\p{L}]+)$/u.exec(before);
      // "Dr. Smith", "z. B. Ein": a known abbreviation does not end a sentence.
      if (last && ABBREVIATIONS.has(last[1].toLowerCase()) && /^\.\s/.test(match[0])) continue;
      out.push(line.slice(start, match.index + match[0].length).trim());
      start = match.index + match[0].length;
    }
    out.push(line.slice(start).trim());
  }
  return out.filter((sentence) => HAS_WORD.test(sentence));
};

/**
 * Words of a text.
 * @param {string} text - Text.
 * @returns {string[]} Words.
 */
export const wordsOf = (text) => String(text).match(WORD) || [];

/* ------------------------------------------------------------------ */
/* Syllables                                                           */
/* ------------------------------------------------------------------ */

/**
 * English syllables (vowel groups, silent final e/es/ed removed).
 * @param {string} word - Word.
 * @returns {number} Count, at least 1.
 */
const syllablesEn = (word) => {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  if (w.length <= 3) return 1;
  // Silent endings: a final "e" (not "-le"), "-ed" after anything but t/d, "-es" after a consonant
  // that does not make it a syllable ("boxes", "pages" keep it).
  w = w
    .replace(/([^aeiouyl])e$/, '$1')
    .replace(/([^aeiouytd])ed$/, '$1')
    .replace(/([^aeiouysxzcgh])es$/, '$1')
    .replace(/^y/, '');
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 0);
};

/**
 * German syllables (diphthongs and long vowels count once).
 * @param {string} word - Word.
 * @returns {number} Count, at least 1.
 */
const syllablesDe = (word) => {
  const groups = word.toLowerCase().match(/aa|ee|oo|ie|ei|ai|au|eu|äu|[aeiouyäöü]/g);
  return Math.max(1, groups ? groups.length : 0);
};

/**
 * Spanish syllables (diphthongs and triphthongs count once, accented í/ú break them).
 * @param {string} word - Word.
 * @returns {number} Count, at least 1.
 */
const syllablesEs = (word) => {
  const w = word.toLowerCase().replace(/y$/, 'i');
  const groups = w.match(
    /[iuü][aeoáéó][iu](?![aeiouáéíóú])|[aeoáéó][iu](?![aeiouáéíóú])|[iuü][aeoáéó]|[iu][iu]|[aeiouáéíóúü]/g
  );
  return Math.max(1, groups ? groups.length : 0);
};

const SYLLABLES = { en: syllablesEn, de: syllablesDe, es: syllablesEs };

/**
 * Syllables of a word in a language with a counter (en, de, es).
 * @param {string} word - Word.
 * @param {string} language - Language.
 * @returns {number|null} Count, or null without a counter.
 */
export const countSyllables = (word, language) => (SYLLABLES[language] ? SYLLABLES[language](word) : null);

/* ------------------------------------------------------------------ */
/* Passive voice (heuristic, en and de)                                */
/* ------------------------------------------------------------------ */

const EN_BE = new Set([
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
]);
const EN_SKIP = new Set([
  'not',
  'also',
  'never',
  'often',
  'always',
  'already',
  'being',
  'been',
  'usually',
  'still',
  'then',
  'now',
  'just',
]);
const EN_IRREGULAR = new Set(
  'arisen awoken borne born beaten become begun bent bet bitten bled blown broken brought built burnt bought caught chosen come cost crept cut dealt dug done drawn dreamt driven drunk eaten fallen fed felt fought found fled flown forbidden forgotten forgiven frozen got gotten given gone ground grown hung had heard hidden hit held hurt kept known laid led left lent let lain lit lost made meant met paid put quit read ridden rung risen run said seen sought sold sent set shaken shed shot shown shut sung sunk sat slept slid spoken spent spun spread stood stolen stuck stung struck sworn swept swum taken taught torn told thought thrown understood undertaken woken worn woven won withdrawn written'.split(
    ' '
  )
);
const DE_WERDEN = new Set([
  'werde',
  'wirst',
  'wird',
  'werden',
  'werdet',
  'wurde',
  'wurdest',
  'wurden',
  'wurdet',
  'worden',
]);
const DE_NOT_PARTICIPLE = new Set(
  'gegen genug gestern gerne geben gehen gelten genießen gewinnen gehören gefallen gelingen geschehen gestalten gewähren gewöhnen genesen gebären gedeihen gleichen gewesen'.split(
    ' '
  )
);

/**
 * Heuristic: the sentence is (probably) in the passive voice.
 * English: a form of "be" followed by a past participle. German: a form of
 * "werden" together with a past participle (Vorgangspassiv).
 * @param {string[]} words - Words of the sentence.
 * @param {string} language - Language.
 * @returns {boolean} Result.
 */
export const isPassive = (words, language) => {
  const lower = words.map((word) => word.toLowerCase());
  if (language === 'en') {
    for (let i = 0; i < lower.length - 1; i += 1) {
      if (!EN_BE.has(lower[i])) continue;
      let j = i + 1;
      while (j < lower.length && j <= i + 2 && (EN_SKIP.has(lower[j]) || /ly$/.test(lower[j]))) j += 1;
      const next = lower[j];
      if (next && ((next.length > 3 && /[^e]ed$|ied$|eed$/.test(next)) || EN_IRREGULAR.has(next)))
        return true;
    }
    return false;
  }
  if (language === 'de') {
    if (lower.includes('worden')) return true;
    if (!lower.some((word) => DE_WERDEN.has(word))) return false;
    return lower.some(
      (word) =>
        !DE_NOT_PARTICIPLE.has(word) && (/^ge\p{L}{2,}(?:t|en)$/u.test(word) || /^\p{L}{3,}iert$/u.test(word))
    );
  }
  return false;
};

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

const DOUBLE_SPACE = /[ \u00a0]{2,}/g;
const SPACE_BEFORE = /[ \u00a0]+(?=[,.](?![\d.]))/g;
// French puts a (narrow) no-break space before ; : ! ?, so those are left alone there.
const SPACE_BEFORE_MARK = /[ \u00a0]+(?=[;:!?](?=\s|$))/g;

/**
 * Typography problems of one text node: repeated spaces and a space before punctuation.
 * @param {string} text - Text node value.
 * @param {string|null} language - Language.
 * @returns {number} Count.
 */
const spaceProblems = (text, language) => {
  const count = (pattern) => (text.match(pattern) || []).length;
  return count(DOUBLE_SPACE) + count(SPACE_BEFORE) + (language === 'fr' ? 0 : count(SPACE_BEFORE_MARK));
};

/**
 * Fixes repeated spaces and spaces before punctuation in one text node.
 * @param {string} text - Text node value.
 * @param {string|null} language - Language.
 * @returns {string} Fixed text.
 */
const fixSpaces = (text, language) => {
  let out = text.replace(DOUBLE_SPACE, (run) => (/^\u00a0+$/.test(run) ? '\u00a0' : ' '));
  out = out.replace(SPACE_BEFORE, '');
  if (language !== 'fr') out = out.replace(SPACE_BEFORE_MARK, '');
  return out;
};

/** Inline elements whose text must keep every space (code, math, footnote notes). */
const keepsSpaces = (node) =>
  node.tag === 'code' || node.tag === 'kbd' || isMathNode(node) || isFootnoteNode(node);

/**
 * Walks the text nodes outside code, math and footnotes.
 * @param {Array} nodes - Parsed nodes.
 * @param {(node: object) => void} fn - Visitor.
 * @param {number} [depth] - Depth.
 */
const walkProse = (nodes, fn, depth = 0) => {
  if (depth > 40) return;
  for (const node of nodes) {
    if (node.type === 'text') fn(node);
    else if (!keepsSpaces(node)) walkProse(node.children || [], fn, depth + 1);
  }
};

/**
 * Typography problems of inline HTML (outside code, math and footnotes).
 * @param {string} html - Inline HTML.
 * @param {string|null} [language] - Language (`fr` keeps spaces before ; : ! ?).
 * @returns {number} Count.
 */
export const typographyProblems = (html, language = null) => {
  let count = 0;
  walkProse(parseInline(typeof html === 'string' ? html : ''), (node) => {
    count += spaceProblems(node.value, language);
  });
  return count;
};

/**
 * One-click fix: removes repeated spaces and spaces before punctuation. Markup,
 * links, code, math and footnotes stay as they are.
 * @param {string} html - Inline HTML.
 * @param {string|null} [language] - Language.
 * @returns {string} Fixed HTML (the input when nothing changed).
 */
export const fixTypography = (html, language = null) => {
  if (typeof html !== 'string' || !typographyProblems(html, language)) return html;
  const nodes = parseInline(html);
  walkProse(nodes, (node) => {
    node.value = fixSpaces(node.value, language);
  });
  return nodesToHtml(nodes, { storage: true });
};

/* ------------------------------------------------------------------ */
/* Units: the prose of a document                                      */
/* ------------------------------------------------------------------ */

/**
 * @typedef {{ blockId: string, blockIndex: number, path: string, kind: 'paragraph'|'item'|'heading'|'link', html: string, level?: number }} InsightUnit
 */

/**
 * Lists the text units of a document in reading order: paragraphs, list items,
 * headings, and the URLs of link and button blocks (for internal links).
 * Tables, captions, code and custom blocks are not prose and are left out.
 * @param {{ blocks?: Array<{ id: string, type: string, data: object }> }|null} data - Document.
 * @returns {InsightUnit[]} Units.
 */
export const insightUnits = (data) => {
  const out = [];
  if (!data || !Array.isArray(data.blocks)) return out;
  data.blocks.forEach((block, blockIndex) => {
    if (!block || typeof block.id !== 'string' || !isBuiltInBlock(block)) return;
    const d = isPlainObject(block.data) ? block.data : {};
    const add = (kind, path, html, extra = {}) => {
      if (typeof html === 'string' && html)
        out.push({ blockId: block.id, blockIndex, path, kind, html, ...extra });
    };
    const listItems = (items, path, depth = 0) => {
      if (!Array.isArray(items) || depth > 12) return;
      items.forEach((item, index) => {
        if (typeof item === 'string') add('item', `${path}.${index}`, item);
        else if (isPlainObject(item)) {
          add('item', `${path}.${index}.content`, item.content);
          listItems(item.items, `${path}.${index}.items`, depth + 1);
        }
      });
    };
    switch (block.type) {
      case 'paragraph':
      case 'quote':
        add('paragraph', 'text', d.text);
        break;
      case 'header':
        add('heading', 'text', d.text, {
          level: Number.isInteger(d.level) && d.level >= 1 && d.level <= 6 ? d.level : 2,
        });
        break;
      case 'list':
        listItems(d.items, 'items');
        break;
      case 'checklist':
        if (Array.isArray(d.items))
          d.items.forEach(
            (item, index) => isPlainObject(item) && add('item', `items.${index}.text`, item.text)
          );
        break;
      case 'warning':
      case 'alert':
        add('paragraph', 'message', d.message);
        break;
      case 'columns':
        for (const field of columnsTextFields(d)) {
          const type = field.item.type;
          if (type === 'heading')
            add('heading', field.path.join('.'), field.value, {
              level: Number.isInteger(field.item.level) ? field.item.level : 3,
            });
          else add(type === 'list' ? 'item' : 'paragraph', field.path.join('.'), field.value);
        }
        break;
      case 'linkTool':
      case 'button':
        if (typeof d.link === 'string' && d.link)
          out.push({ blockId: block.id, blockIndex, path: 'link', kind: 'link', html: '', href: d.link });
        break;
      default:
    }
  });
  return out;
};

/**
 * True when a link points inside the site: an entry link (link picker, mention) or a relative URL.
 * @param {Record<string, string>} attrs - Link attributes.
 * @returns {boolean} Result.
 */
const isInternalHref = (attrs) =>
  Boolean(attrs['data-mex-uid'] && attrs['data-mex-document-id']) ||
  (typeof attrs.href === 'string' && /^\/(?!\/)/.test(attrs.href));

/**
 * Analysis of one text unit (cached per language, kind and HTML).
 * @param {InsightUnit} unit - Unit.
 * @param {string|null} language - Language.
 * @returns {{ words: string[], sentences: Array<{ words: number, first: string, passive: boolean }>, syllables: number|null, complex: number, examples: string[], spaces: number, internalLinks: number, normalized: string }} Analysis.
 */
export const analyzeUnit = (unit, language) => {
  if (unit.kind === 'link')
    return {
      words: [],
      sentences: [],
      syllables: 0,
      complex: 0,
      examples: [],
      spaces: 0,
      internalLinks: /^\/(?!\/)/.test(unit.href || '') ? 1 : 0,
      normalized: '',
    };
  const nodes = parseInline(unit.html);
  const text = readingText(nodes);
  const words = wordsOf(text);
  let internalLinks = 0;
  const findLinks = (list, depth = 0) => {
    if (depth > 40) return;
    for (const node of list) {
      if (node.type !== 'element') continue;
      if (node.tag === 'a' && isInternalHref(node.attrs || {})) internalLinks += 1;
      findLinks(node.children || [], depth + 1);
    }
  };
  findLinks(nodes);
  let spaces = 0;
  walkProse(nodes, (node) => {
    spaces += spaceProblems(node.value, language);
  });
  const rules = LANGUAGE_RULES[language] || {};
  const counter = SYLLABLES[language];
  let syllables = counter ? 0 : null;
  let complex = 0;
  const examples = [];
  if (counter)
    words.forEach((word, index) => {
      const count = counter(word);
      syllables += count;
      // Gunning leaves out proper names; in English a capital inside a sentence marks one.
      const name = language === 'en' && index > 0 && /^\p{Lu}/u.test(word);
      if (rules.complexSyllables && count >= rules.complexSyllables && !name && !/\d/.test(word)) {
        complex += 1;
        if (examples.length < 3 && !examples.includes(word)) examples.push(word);
      }
    });
  const sentences =
    unit.kind === 'heading'
      ? []
      : splitSentences(text).map((sentence) => {
          const list = wordsOf(sentence);
          return {
            words: list.length,
            first: (list[0] || '').toLowerCase(),
            passive: language === 'en' || language === 'de' ? isPassive(list, language) : false,
          };
        });
  return {
    words,
    sentences,
    syllables,
    complex,
    examples,
    spaces,
    internalLinks,
    normalized: words.map((word) => word.toLowerCase()).join(' '),
  };
};

/**
 * Cache of unit analyses keyed by language, kind and HTML, so a change re-analyses only changed text.
 * @returns {{ get: (unit: InsightUnit, language: string|null) => ReturnType<typeof analyzeUnit>, size: () => number }} Cache.
 */
export const createInsightsCache = () => {
  const map = new Map();
  return {
    get(unit, language) {
      const key = `${language || '-'}|${unit.kind}|${unit.kind === 'link' ? unit.href : unit.html}`;
      let value = map.get(key);
      if (!value) {
        value = analyzeUnit(unit, language);
        if (map.size >= CACHE_LIMIT) map.delete(map.keys().next().value);
        map.set(key, value);
      }
      return value;
    },
    size: () => map.size,
  };
};

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/**
 * Normalised keyphrase (lower case, words joined by single spaces).
 * @param {unknown} keyphrase - Keyphrase.
 * @returns {string} Keyphrase, '' when empty.
 */
export const normalizeKeyphrase = (keyphrase) =>
  typeof keyphrase === 'string'
    ? wordsOf(keyphrase.slice(0, 200))
        .map((word) => word.toLowerCase())
        .join(' ')
    : '';

/**
 * Occurrences of a phrase in normalised text (whole words, not overlapping).
 * @param {string} text - Normalised text.
 * @param {string} phrase - Normalised phrase.
 * @returns {number} Count.
 */
const occurrences = (text, phrase) => {
  if (!phrase || !text) return 0;
  const haystack = ` ${text} `;
  const needle = ` ${phrase} `;
  let count = 0;
  let from = 0;
  let index;
  while ((index = haystack.indexOf(needle, from)) !== -1) {
    count += 1;
    from = index + needle.length - 1;
  }
  return count;
};

/** All words of the phrase occur in the text (any order). */
const containsWords = (text, phrase) => {
  const words = new Set(text.split(' '));
  return phrase.split(' ').every((word) => words.has(word));
};

/**
 * Reading score of a language.
 * @param {string} formula - flesch, amstad or szigriszt.
 * @param {number} wordsPerSentence - Average sentence length.
 * @param {number} syllablesPerWord - Average syllables per word.
 * @returns {number} Score, rounded to one decimal.
 */
export const readingEase = (formula, wordsPerSentence, syllablesPerWord) => {
  let value;
  if (formula === 'flesch') value = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  else if (formula === 'amstad') value = 180 - wordsPerSentence - 58.5 * syllablesPerWord;
  else value = 206.835 - 62.3 * syllablesPerWord - wordsPerSentence;
  return Math.round(value * 10) / 10;
};

/**
 * Band of a reading score: Flesch/Amstad bands, INFLESZ for Spanish.
 * @param {string} formula - Formula.
 * @param {number} score - Score.
 * @returns {'veryEasy'|'easy'|'fairlyEasy'|'standard'|'fairlyDifficult'|'difficult'|'veryDifficult'} Band.
 */
export const easeBand = (formula, score) => {
  if (formula === 'szigriszt') {
    if (score > 80) return 'veryEasy';
    if (score > 65) return 'fairlyEasy';
    if (score >= 55) return 'standard';
    if (score >= 40) return 'fairlyDifficult';
    return 'veryDifficult';
  }
  if (score >= 90) return 'veryEasy';
  if (score >= 80) return 'easy';
  if (score >= 70) return 'fairlyEasy';
  if (score >= 60) return 'standard';
  if (score >= 50) return 'fairlyDifficult';
  if (score >= 30) return 'difficult';
  return 'veryDifficult';
};

/**
 * @typedef {{ rule: string, section: 'readability'|'seo', severity: 'hint', blockId: string|null, blockIndex: number, path?: string, params?: object }} InsightIssue
 */

/**
 * Builds the hints of a document from analysed units.
 * @param {{ units: InsightUnit[], results: Array<ReturnType<typeof analyzeUnit>>, data: object|null }} input - Units, their analyses (same order) and the document.
 * @param {{ language?: string|null, settings?: object, keyphrase?: string, rules?: string[], words?: number }} [options] - Language, settings (`normalizeContentChecks`), focus keyphrase, `rules` to limit the run to some setting names (publish guard), and `words` when the toolbar word count is already known (the runner counts it in a slice of its own).
 * @returns {{ issues: InsightIssue[], score: { formula: string, value: number, band: string } | null, stats: { words: number, sentences: number, hints: number, readability: number, seo: number }, language: string|null }} Result.
 */
export const summarizeInsights = ({ units, results, data }, options = {}) => {
  const settings = normalizeContentChecks(options.settings);
  const language = options.language || null;
  const rules = LANGUAGE_RULES[language] || {};
  const only = Array.isArray(options.rules) ? new Set(options.rules) : null;
  const on = (setting) =>
    settings.enabled && !settings.disabled.includes(setting) && (!only || only.has(setting));
  const issues = [];
  const push = (rule, unit, params, path) =>
    issues.push({
      rule,
      section: INSIGHT_RULES[rule].section,
      severity: 'hint',
      blockId: unit ? unit.blockId : null,
      blockIndex: unit ? unit.blockIndex : -1,
      ...(path ? { path } : {}),
      ...(params ? { params } : {}),
    });

  // Prose statistics.
  const sentenceLimit = settings.sentenceWords || rules.sentenceWords || DEFAULT_SENTENCE_WORDS;
  let sentenceCount = 0;
  let longCount = 0;
  let passiveCount = 0;
  let proseWords = 0;
  let syllables = 0;
  units.forEach((unit, i) => {
    if (unit.kind !== 'paragraph' && unit.kind !== 'item') return;
    const r = results[i];
    sentenceCount += r.sentences.length;
    proseWords += r.words.length;
    if (r.syllables !== null) syllables += r.syllables;
    for (const sentence of r.sentences) {
      if (sentence.words > sentenceLimit) longCount += 1;
      if (sentence.passive) passiveCount += 1;
    }
  });

  // Reading score (needs a formula for the language and enough words).
  let score = null;
  if (rules.formula && proseWords >= SCORE_WORDS && sentenceCount) {
    const value = readingEase(rules.formula, proseWords / sentenceCount, syllables / proseWords);
    score = { formula: rules.formula, value, band: easeBand(rules.formula, value) };
    if (on('reading-ease') && value < rules.ease)
      push('reading-ease', null, {
        score: value,
        formula: rules.formula,
        band: score.band,
        target: rules.ease,
      });
  }

  // Per unit: long sentences, long paragraphs, passive voice, complex words, typography.
  const longShare = sentenceCount ? (longCount / sentenceCount) * 100 : 0;
  const passiveShare = sentenceCount ? (passiveCount / sentenceCount) * 100 : 0;
  units.forEach((unit, i) => {
    const r = results[i];
    if (unit.kind === 'link') return;
    if (on('extra-spaces') && r.spaces) push('extra-spaces', unit, { count: r.spaces }, unit.path);
    if (unit.kind === 'heading') return;
    if (on('sentence-long') && longShare > LONG_SENTENCE_SHARE) {
      const long = r.sentences.filter((sentence) => sentence.words > sentenceLimit);
      if (long.length)
        push(
          'sentence-long',
          unit,
          { count: long.length, max: sentenceLimit, longest: Math.max(...long.map((s) => s.words)) },
          unit.path
        );
    }
    if (on('paragraph-long') && unit.kind === 'paragraph' && r.words.length > settings.paragraphWords)
      push('paragraph-long', unit, { words: r.words.length, max: settings.paragraphWords }, unit.path);
    if (on('passive-voice') && passiveShare > PASSIVE_SHARE && (language === 'en' || language === 'de')) {
      const passive = r.sentences.filter((sentence) => sentence.passive).length;
      if (passive) push('passive-voice', unit, { count: passive }, unit.path);
    }
    if (
      on('complex-words') &&
      rules.complexShare &&
      unit.kind === 'paragraph' &&
      r.words.length >= COMPLEX_MIN_WORDS &&
      (r.complex / r.words.length) * 100 > rules.complexShare
    )
      push(
        'complex-words',
        unit,
        {
          percent: Math.round((r.complex / r.words.length) * 100),
          max: rules.complexShare,
          words: r.examples.join(', '),
        },
        unit.path
      );
  });

  // Repeated sentence starts: runs across consecutive paragraphs, broken by any other block.
  if (on('repeated-starts')) {
    let run = { word: '', count: 0, unit: null, reported: false };
    let previousBlock = -2;
    units.forEach((unit, i) => {
      if (unit.kind !== 'paragraph') {
        run = { word: '', count: 0, unit: null, reported: false };
        return;
      }
      if (unit.blockIndex !== previousBlock + 1 && unit.blockIndex !== previousBlock)
        run = { word: '', count: 0, unit: null, reported: false };
      previousBlock = unit.blockIndex;
      for (const sentence of results[i].sentences) {
        if (sentence.first && sentence.first === run.word) run.count += 1;
        else run = { word: sentence.first, count: 1, unit, reported: false };
        if (run.count >= REPEATED_STARTS && !run.reported) {
          run.reported = true;
          push('repeated-starts', run.unit, { word: run.word, count: run.count }, run.unit.path);
        } else if (run.reported) {
          const last = issues[issues.length - 1];
          if (last && last.rule === 'repeated-starts' && last.params.word === run.word)
            last.params.count = run.count;
        }
      }
    });
  }

  // SEO: the H1 depends on where the page title comes from.
  const headings = units.filter((unit) => unit.kind === 'heading');
  if (on('h1')) {
    const h1 = headings.filter((unit) => unit.level === 1);
    if (settings.h1 === 'title' && h1.length) push('h1-in-content', h1[0], { count: h1.length }, h1[0].path);
    if (settings.h1 === 'content' && !h1.length && units.length) push('h1-missing', null);
  }

  // SEO: long sections without a subheading (the text before the first heading counts too).
  if (on('section-long')) {
    let words = 0;
    let start = null;
    let reported = false;
    units.forEach((unit, i) => {
      if (unit.kind === 'heading') {
        words = 0;
        start = null;
        reported = false;
        return;
      }
      if (unit.kind === 'link') return;
      if (!start) start = unit;
      words += results[i].words.length;
      if (words > settings.sectionWords && !reported) {
        reported = true;
        push('section-long', start, { words, max: settings.sectionWords });
      } else if (reported) {
        const last = issues.findLast((issue) => issue.rule === 'section-long');
        if (last) last.params.words = words;
      }
    });
  }

  // SEO: internal links and length (words counted like the toolbar).
  const totalWords = Number.isInteger(options.words) ? options.words : computeStats(data).words;
  if (on('internal-links') && settings.minInternalLinks > 0 && proseWords > 0) {
    const count = results.reduce((sum, r) => sum + r.internalLinks, 0);
    if (count < settings.minInternalLinks)
      push('internal-links', null, { count, min: settings.minInternalLinks });
  }
  if (on('content-short') && settings.minWords > 0 && totalWords > 0 && totalWords < settings.minWords)
    push('content-short', null, { words: totalWords, min: settings.minWords });

  // SEO: focus keyphrase (entered in the panel; only checked when there is one).
  const keyphrase = normalizeKeyphrase(options.keyphrase);
  if (on('keyphrase') && keyphrase && proseWords > 0) {
    const firstIndex = units.findIndex((unit) => unit.kind === 'paragraph');
    if (firstIndex !== -1 && !containsWords(results[firstIndex].normalized, keyphrase))
      push('keyphrase-intro', units[firstIndex], { keyphrase }, units[firstIndex].path);
    const subheadings = headings.filter((unit) => unit.level === 2 || unit.level === 3);
    if (
      subheadings.length &&
      !subheadings.some((unit) => containsWords(results[units.indexOf(unit)].normalized, keyphrase))
    )
      push('keyphrase-headings', null, { keyphrase, count: subheadings.length });
    if (proseWords >= DENSITY_WORDS) {
      const found = units.reduce(
        (sum, unit, i) => sum + (unit.kind === 'link' ? 0 : occurrences(results[i].normalized, keyphrase)),
        0
      );
      const density = Math.round((found / proseWords) * 1000) / 10;
      if (density < DENSITY_MIN || density > DENSITY_MAX)
        push('keyphrase-density', null, {
          keyphrase,
          count: found,
          density,
          min: DENSITY_MIN,
          max: DENSITY_MAX,
          direction: density < DENSITY_MIN ? 'low' : 'high',
        });
    }
  }

  issues.sort((a, b) => a.blockIndex - b.blockIndex);
  const readability = issues.filter((issue) => issue.section === 'readability').length;
  return {
    issues,
    score,
    stats: {
      words: totalWords,
      sentences: sentenceCount,
      hints: issues.length,
      readability,
      seo: issues.length - readability,
    },
    language,
  };
};

/**
 * Runs every rule at once (server publish guard, tests). The editor uses
 * `createInsightsRunner` instead, which spreads the work over idle time.
 * @param {object|null} data - Normalised document.
 * @param {{ language?: string|null, settings?: object, keyphrase?: string, rules?: string[], cache?: ReturnType<typeof createInsightsCache> }} [options] - Options.
 * @returns {ReturnType<typeof summarizeInsights>} Result.
 */
export const lintInsights = (data, options = {}) => {
  const units = insightUnits(data);
  const cache = options.cache || createInsightsCache();
  const language = options.language || null;
  const results = units.map((unit) => cache.get(unit, language));
  return summarizeInsights({ units, results, data }, options);
};

/**
 * Time-sliced runner for the browser: analyses units in slices of at most
 * `budgetMs` and yields between slices (`schedule`, e.g. requestIdleCallback),
 * so a document of thousands of blocks never blocks the main thread for long.
 * A new `run` cancels the previous one. Unchanged text comes from the cache.
 * @param {{ schedule?: (fn: () => void) => unknown, cancel?: (handle: unknown) => void, now?: () => number, budgetMs?: number }} [options] - Scheduling.
 * @returns {{ run: (data: object|null, options: object, done: (result: ReturnType<typeof summarizeInsights>) => void) => void, cancel: () => void }} Runner.
 */
export const createInsightsRunner = (options = {}) => {
  const schedule = options.schedule || ((fn) => setTimeout(fn, 0));
  const cancelScheduled = options.cancel || ((handle) => clearTimeout(handle));
  const now = options.now || (() => Date.now());
  const budget = options.budgetMs || 8;
  const cache = createInsightsCache();
  let generation = 0;
  let handle = null;
  const cancel = () => {
    generation += 1;
    if (handle !== null) cancelScheduled(handle);
    handle = null;
  };
  return {
    cancel,
    run(data, runOptions, done) {
      cancel();
      const mine = generation;
      const units = insightUnits(data);
      const language = (runOptions && runOptions.language) || null;
      const results = new Array(units.length);
      let index = 0;
      const step = () => {
        handle = null;
        if (mine !== generation) return;
        const start = now();
        while (index < units.length) {
          results[index] = cache.get(units[index], language);
          index += 1;
          if (now() - start >= budget) break;
        }
        if (index < units.length) handle = schedule(step);
        else handle = schedule(count);
      };
      // The word count (like the toolbar) and the summary each get a slice of their own.
      const count = () => {
        handle = null;
        if (mine !== generation) return;
        const words = computeStats(data).words;
        handle = schedule(() => {
          handle = null;
          if (mine === generation)
            done(summarizeInsights({ units, results, data }, { ...runOptions, words }));
        });
      };
      handle = schedule(step);
    },
  };
};

/* ------------------------------------------------------------------ */
/* Fixes                                                               */
/* ------------------------------------------------------------------ */

const splitPath = (path) => path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

/**
 * Copies `data` with the value at `path` replaced (only existing slots).
 * @param {unknown} data - Block data.
 * @param {Array<string|number>} path - Path.
 * @param {(value: unknown) => unknown} update - New value from the old one.
 * @returns {unknown|null} New data, or null when the slot does not exist.
 */
const updateAt = (data, path, update) => {
  const [head, ...rest] = path;
  if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, head)) return null;
  const next = rest.length ? updateAt(data[head], rest, update) : update(data[head]);
  if (next === null || next === undefined) return null;
  const copy = Array.isArray(data) ? [...data] : { ...data };
  copy[head] = next;
  return copy;
};

/**
 * Block data with the typography of one text slot fixed.
 * @param {{ type: string, data: object }} block - Block.
 * @param {string} path - Text slot (`text`, `items.0.content`, ...).
 * @param {string|null} [language] - Language.
 * @returns {object|null} New block data, or null when nothing changes.
 */
export const fixTypographyAt = (block, path, language = null) => {
  if (!block || !isPlainObject(block.data) || typeof path !== 'string') return null;
  const next = updateAt(block.data, splitPath(path), (value) => {
    if (typeof value !== 'string') return null;
    const fixed = fixTypography(value, language);
    return fixed === value ? null : fixed;
  });
  return next;
};

/**
 * The heading level a "Fix" sets for a heading that skips levels or is an H1
 * in content whose title is the H1: the level after the previous heading (2
 * at the start), limited to the levels the field allows.
 * @param {number} previous - Level of the previous heading (0 when none).
 * @param {number[]} [allowed] - Allowed levels (field preset); all when empty.
 * @param {number} [current] - Current level (an H1 that should become a subheading).
 * @returns {number|null} Level, or null when no allowed level fits.
 */
export const headingFixLevel = (previous, allowed = [], current = 0) => {
  const levels = Array.isArray(allowed) && allowed.length ? allowed : [1, 2, 3, 4, 5, 6];
  const target = current === 1 ? 2 : previous ? Math.min(6, previous + 1) : 2;
  const fits = levels.filter((level) => level <= target && level >= 2);
  if (fits.length) return Math.max(...fits);
  const any = levels.filter((level) => level <= target && level !== current);
  return any.length ? Math.max(...any) : null;
};

/**
 * Block data with one heading set to a level: a header block, or a heading
 * item of a columns block (`path` of its text).
 * @param {{ type: string, data: object }} block - Block.
 * @param {string|undefined} path - Text path of a heading item, or empty for a header block.
 * @param {number} level - New level 1-6.
 * @returns {object|null} New block data, or null when the block holds no such heading.
 */
export const setHeadingLevel = (block, path, level) => {
  if (!block || !isPlainObject(block.data) || !Number.isInteger(level) || level < 1 || level > 6) return null;
  if (block.type === 'header') return block.data.level === level ? null : { ...block.data, level };
  if (block.type === 'columns' && typeof path === 'string' && /\.text$/.test(path)) {
    const itemPath = splitPath(path.replace(/\.text$/, ''));
    return updateAt(block.data, itemPath, (item) =>
      isPlainObject(item) && item.type === 'heading' && item.level !== level ? { ...item, level } : null
    );
  }
  return null;
};

/** Longest link text a rewrite accepts. */
export const MAX_LINK_TEXT = 200;

/**
 * Block data with the text of one link rewritten (the "click here" fix): the
 * first link in the text slot whose text matches `oldText` (normalised like
 * the accessibility rule) gets `newText` as its only content. The address,
 * the attributes and everything around the link stay.
 * @param {{ type: string, data: object }} block - Block.
 * @param {string} path - Text slot of the finding.
 * @param {string} oldText - Normalised link text from the finding (`params.text`).
 * @param {string} newText - New link text (trimmed, at most 200 characters).
 * @returns {object|null} New block data, or null when nothing matches or the text is empty.
 */
export const rewriteLinkTextAt = (block, path, oldText, newText) => {
  const text = typeof newText === 'string' ? newText.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_TEXT) : '';
  if (
    !text ||
    !block ||
    !isPlainObject(block.data) ||
    typeof path !== 'string' ||
    typeof oldText !== 'string'
  )
    return null;
  return updateAt(block.data, splitPath(path), (value) => {
    if (typeof value !== 'string') return null;
    const nodes = parseInline(value);
    let done = false;
    const walk = (list, depth = 0) => {
      if (depth > 40 || done) return;
      for (const node of list) {
        if (done || node.type !== 'element') continue;
        if (
          node.tag === 'a' &&
          normalizeLinkText(readingText(node.children || [])).slice(0, 40) === oldText
        ) {
          node.children = [{ type: 'text', value: text }];
          done = true;
          return;
        }
        walk(node.children || [], depth + 1);
      }
    };
    walk(nodes);
    return done ? nodesToHtml(nodes, { storage: true }) : null;
  });
};

/**
 * 2.9 readability and SEO-structure hints (shared/content-insights.mjs), their one-click fixes
 * (admin quality-fixes.mjs), the Configuration form helpers, the settings service and the
 * publish guard opt-in. English and German fixtures, synthetic text only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  BLOCKABLE_SETTINGS,
  DEFAULT_CONTENT_CHECKS,
  INSIGHT_RULES,
  INSIGHT_SETTINGS,
  countSyllables,
  createInsightsRunner,
  easeBand,
  fixTypography,
  fixTypographyAt,
  headingFixLevel,
  insightLanguage,
  insightUnits,
  isPassive,
  lintInsights,
  normalizeContentChecks,
  readingEase,
  setHeadingLevel,
  splitSentences,
  typographyProblems,
  wordsOf,
} from '../shared/content-insights.mjs';
import { fixActionOf, fixedBlockData } from '../admin/src/components/EditorField/quality-fixes.mjs';
import {
  sameContentChecks,
  splitContentCheckErrors,
  toContentChecksDraft,
  toContentChecksPayload,
  toggleContentCheck,
  validateContentChecks,
} from '../admin/src/pages/ConfigurationPage/contentChecksForm.mjs';
import { replaceInSegment } from '../shared/ai-fields.mjs';

const require = createRequire(import.meta.url);
const settingsService = require('../server/src/services/settings.js');
const { registerPublishGuard } = require('../server/src/utils/publish-guard.js');

const doc = (blocks) => ({
  time: 1,
  version: '2.31.7',
  blocks: blocks.map(([type, data], index) => ({ id: `b${index}`, type, data })),
});
const run = (value, options = {}) => lintInsights(value, { language: 'en', ...options });
const rules = (result) => result.issues.map((issue) => `${issue.rule}@${issue.blockId || 'doc'}`);
const only = (rule) => ({ rules: [rule] });
const words = (count, word = 'word') => Array.from({ length: count }, () => word).join(' ');
// Sentences start with a capital, like real text (the splitter needs one after the full stop).
const sentence = (count) => `Cat ${words(count - 2, 'cat')} end.`;

test('rule table: sections, settings and blockable rules are consistent', () => {
  for (const [id, rule] of Object.entries(INSIGHT_RULES)) {
    assert.ok(['readability', 'seo'].includes(rule.section), id);
    assert.ok(INSIGHT_SETTINGS.includes(rule.setting), id);
  }
  // Heuristics and the keyphrase never block publishing.
  for (const name of ['passive-voice', 'reading-ease', 'complex-words', 'keyphrase'])
    assert.equal(BLOCKABLE_SETTINGS.includes(name), false, name);
  assert.deepEqual(normalizeContentChecks(undefined), {
    ...DEFAULT_CONTENT_CHECKS,
    disabled: [],
    blockPublish: [],
  });
});

test('settings: unknown values fall back, lists keep known names only', () => {
  const value = normalizeContentChecks({
    enabled: false,
    h1: 'content',
    disabled: ['passive-voice', 'nope', 'passive-voice'],
    blockPublish: ['h1', 'passive-voice', 'keyphrase'],
    minWords: -1,
    minInternalLinks: 3,
    sentenceWords: 1.5,
    paragraphWords: 10,
    sectionWords: 400,
  });
  assert.equal(value.enabled, false);
  assert.equal(value.h1, 'content');
  assert.deepEqual(value.disabled, ['passive-voice']);
  assert.deepEqual(value.blockPublish, ['h1']);
  assert.equal(value.minWords, 300);
  assert.equal(value.minInternalLinks, 3);
  assert.equal(value.sentenceWords, 0);
  assert.equal(value.paragraphWords, 150);
  assert.equal(value.sectionWords, 400);
});

test('language: primary subtag of the content locale, unknown languages get none', () => {
  assert.equal(insightLanguage('de-CH'), 'de');
  assert.equal(insightLanguage('pt_BR'), 'pt');
  assert.equal(insightLanguage('it'), null);
  assert.equal(insightLanguage(null), null);
});

test('text: sentences, words and syllables (en, de, es)', () => {
  assert.deepEqual(splitSentences('Dr. Smith went home. He slept! Then he woke?\nNew line'), [
    'Dr. Smith went home.',
    'He slept!',
    'Then he woke?',
    'New line',
  ]);
  assert.deepEqual(splitSentences('Das gilt z. B. hier. Neu.'), ['Das gilt z. B. hier.', 'Neu.']);
  assert.deepEqual(wordsOf("It's a well-known fact, 42 times."), [
    "It's",
    'a',
    'well-known',
    'fact',
    '42',
    'times',
  ]);
  assert.deepEqual(
    ['beautiful', 'table', 'readability', 'make', 'jumped'].map((w) => countSyllables(w, 'en')),
    [3, 2, 5, 1, 1]
  );
  assert.deepEqual(
    ['Verständlichkeit', 'beobachten', 'Feuer', 'Zeitung'].map((w) => countSyllables(w, 'de')),
    [4, 4, 2, 2]
  );
  assert.deepEqual(
    ['legibilidad', 'ciudad', 'país', 'hoy'].map((w) => countSyllables(w, 'es')),
    [5, 2, 2, 1]
  );
  assert.equal(countSyllables('maison', 'fr'), null);
});

test('reading score: Flesch (en), Amstad (de), Szigriszt-Pazos (es) and their bands', () => {
  assert.equal(readingEase('flesch', 10, 1.5), 69.8);
  assert.equal(readingEase('amstad', 10, 1.5), 82.3);
  assert.equal(readingEase('szigriszt', 10, 2), 72.2);
  assert.equal(easeBand('flesch', 65), 'standard');
  assert.equal(easeBand('flesch', 45), 'difficult');
  assert.equal(easeBand('szigriszt', 50), 'fairlyDifficult');
  // A hard English text gives a hint; an easy one does not.
  const hard = Array.from(
    { length: 6 },
    () =>
      'Institutional considerations necessitate comprehensive organizational transformation regarding international communication responsibilities.'
  ).join(' ');
  const easy = Array.from({ length: 30 }, () => 'The cat sat on the mat.').join(' ');
  const hardResult = run(doc([['paragraph', { text: `${hard} ${hard}` }]]), only('reading-ease'));
  assert.deepEqual(rules(hardResult), ['reading-ease@doc']);
  assert.equal(hardResult.score.formula, 'flesch');
  const easyResult = run(doc([['paragraph', { text: easy }]]), only('reading-ease'));
  assert.deepEqual(rules(easyResult), []);
  assert.ok(easyResult.score.value > 90);
  // German uses Amstad; French has no formula, so no score and no hint.
  const de = lintInsights(
    doc([['paragraph', { text: Array.from({ length: 30 }, () => 'Die Katze sitzt hier.').join(' ') }]]),
    {
      language: 'de',
    }
  );
  assert.equal(de.score.formula, 'amstad');
  const fr = lintInsights(doc([['paragraph', { text: easy }]]), { language: 'fr' });
  assert.equal(fr.score, null);
  // Fewer than 100 words: no score.
  assert.equal(run(doc([['paragraph', { text: 'Short text.' }]])).score, null);
});

test('long sentences: hints only when more than a quarter is long (20 words en, 25 es)', () => {
  const longOne = sentence(24);
  const value = doc([
    ['paragraph', { text: `${longOne} ${sentence(5)}` }],
    ['paragraph', { text: `${sentence(5)} ${sentence(5)} ${sentence(5)}` }],
  ]);
  // 1 of 5 sentences long (20 %): no hint.
  assert.deepEqual(rules(run(value, only('sentence-long'))), []);
  const many = doc([['paragraph', { text: `${longOne} ${longOne} ${sentence(5)}` }]]);
  const result = run(many, only('sentence-long'));
  assert.deepEqual(rules(result), ['sentence-long@b0']);
  assert.deepEqual(result.issues[0].params, { count: 2, max: 20, longest: 24 });
  // Spanish allows 25 words; a custom limit overrides the language default.
  assert.deepEqual(rules(lintInsights(many, { language: 'es', ...only('sentence-long') })), []);
  assert.deepEqual(
    rules(lintInsights(many, { language: 'es', settings: { sentenceWords: 10 }, ...only('sentence-long') })),
    ['sentence-long@b0']
  );
});

test('long paragraphs, long sections and the H1 policy', () => {
  const value = doc([
    ['header', { text: 'Title', level: 1 }],
    ['paragraph', { text: words(160) }],
    ['paragraph', { text: words(160) }],
    ['header', { text: 'Next', level: 2 }],
    ['paragraph', { text: words(20) }],
  ]);
  assert.deepEqual(rules(run(value, only('paragraph-long'))), ['paragraph-long@b1', 'paragraph-long@b2']);
  const sections = run(value, only('section-long'));
  assert.deepEqual(rules(sections), ['section-long@b1']);
  assert.deepEqual(sections.issues[0].params, { words: 320, max: 300 });
  assert.deepEqual(rules(run(value, only('h1'))), ['h1-in-content@b0']);
  assert.deepEqual(rules(run(value, { settings: { h1: 'content' }, ...only('h1') })), []);
  const noH1 = doc([['paragraph', { text: 'Text' }]]);
  assert.deepEqual(rules(run(noH1, { settings: { h1: 'content' }, ...only('h1') })), ['h1-missing@doc']);
  assert.deepEqual(rules(run(noH1, only('h1'))), []);
  // Headings inside columns count as headings.
  const columns = doc([
    [
      'columns',
      {
        _mex: 1,
        layout: 'equal',
        columns: [{ items: [{ type: 'heading', level: 1, text: 'In a column' }] }, { items: [] }],
      },
    ],
  ]);
  assert.deepEqual(rules(run(columns, only('h1'))), ['h1-in-content@b0']);
});

test('passive voice (en, de) is a hint above 10 % of the sentences', () => {
  assert.equal(isPassive(wordsOf('The house was built in 1900'), 'en'), true);
  assert.equal(isPassive(wordsOf('The report was quickly written'), 'en'), true);
  assert.equal(isPassive(wordsOf('She was happy'), 'en'), false);
  assert.equal(isPassive(wordsOf('Der Bericht wurde gestern geschrieben'), 'de'), true);
  assert.equal(isPassive(wordsOf('Das Haus ist renoviert worden'), 'de'), true);
  assert.equal(isPassive(wordsOf('Er wird morgen gehen'), 'de'), false);
  assert.equal(isPassive(wordsOf('Die Regel wird ab Montag gelten'), 'de'), false);
  const en = doc([
    ['paragraph', { text: 'The page was written by the team. We like it. It was reviewed twice.' }],
  ]);
  const result = run(en, only('passive-voice'));
  assert.deepEqual(rules(result), ['passive-voice@b0']);
  assert.deepEqual(result.issues[0].params, { count: 2 });
  const de = doc([['paragraph', { text: 'Der Text wurde geprüft. Wir lesen ihn. Er ist kurz.' }]]);
  assert.deepEqual(rules(lintInsights(de, { language: 'de', ...only('passive-voice') })), [
    'passive-voice@b0',
  ]);
  // Languages without the heuristic never report it.
  assert.deepEqual(rules(lintInsights(en, { language: 'fr', ...only('passive-voice') })), []);
});

test('complex words per paragraph (en 3+ syllables > 20 %, de 4+ syllables > 15 %)', () => {
  const en = doc([
    [
      'paragraph',
      {
        text: 'Organizational considerations necessitate comprehensive evaluation of the international situation and the cat sat on a mat.',
      },
    ],
  ]);
  const result = run(en, only('complex-words'));
  assert.deepEqual(rules(result), ['complex-words@b0']);
  assert.match(result.issues[0].params.words, /Organizational/);
  const simple = doc([['paragraph', { text: words(20, 'cat') }]]);
  assert.deepEqual(rules(run(simple, only('complex-words'))), []);
  const de = doc([
    [
      'paragraph',
      {
        text: 'Die Verständlichkeitsprüfung der Verwaltungsvorschriften verlangt Aufmerksamkeit und Geduld von allen Beteiligten heute und auch morgen.',
      },
    ],
  ]);
  assert.deepEqual(rules(lintInsights(de, { language: 'de', ...only('complex-words') })), [
    'complex-words@b0',
  ]);
});

test('repeated sentence starts: three in a row, across consecutive paragraphs', () => {
  const value = doc([
    ['paragraph', { text: 'We test. We ship.' }],
    ['paragraph', { text: 'We rest. Then we play.' }],
  ]);
  const result = run(value, only('repeated-starts'));
  assert.deepEqual(rules(result), ['repeated-starts@b0']);
  assert.deepEqual(result.issues[0].params, { word: 'we', count: 3 });
  // A heading between them breaks the run.
  const broken = doc([
    ['paragraph', { text: 'We test. We ship.' }],
    ['header', { text: 'Break', level: 2 }],
    ['paragraph', { text: 'We rest.' }],
  ]);
  assert.deepEqual(rules(run(broken, only('repeated-starts'))), []);
});

test('typography: repeated spaces and a space before punctuation, never in code, math or footnotes', () => {
  assert.equal(typographyProblems('a&nbsp; b , c'), 2);
  assert.equal(typographyProblems('<code>a  b</code> <span data-mex-math="true">x  ,y</span>'), 0);
  assert.equal(fixTypography('Hello  world , fine !'), 'Hello world, fine!');
  // French keeps the space before ; : ! ?
  assert.equal(fixTypography('Bonjour !  Ça va ?', 'fr'), 'Bonjour ! Ça va ?');
  // Markup stays as stored: links, entry links, colours, footnotes.
  const html =
    '<a href="https://x.example.test" target="_blank" rel="noopener noreferrer">ext  link</a> <a href="/x" data-mex-uid="api::article.article" data-mex-document-id="abc123def456ghi789jkl012" data-mex-locale="en">e  ntry</a> <span data-mex-color="brand">red  text</span>';
  assert.equal(
    fixTypography(html),
    '<a href="https://x.example.test" target="_blank" rel="noopener noreferrer">ext link</a> <a href="/x" data-mex-uid="api::article.article" data-mex-document-id="abc123def456ghi789jkl012" data-mex-locale="en">e ntry</a> <span data-mex-color="brand">red text</span>'
  );
  assert.equal(fixTypography('nothing to do'), 'nothing to do');
  const value = doc([
    ['paragraph', { text: 'Two  spaces.' }],
    ['list', { style: 'unordered', items: [{ content: 'Item ,x', items: [] }] }],
  ]);
  const result = run(value, only('extra-spaces'));
  assert.deepEqual(
    result.issues.map((issue) => `${issue.blockId}:${issue.path}`),
    ['b0:text', 'b1:items.0.content']
  );
  assert.deepEqual(fixTypographyAt(value.blocks[1], 'items.0.content'), {
    style: 'unordered',
    items: [{ content: 'Item,x', items: [] }],
  });
  assert.equal(fixTypographyAt(value.blocks[0], 'missing'), null);
});

test('internal links and content length', () => {
  const internal =
    '<a href="/p" data-mex-uid="api::page.page" data-mex-document-id="abc123def456ghi789jkl012">Page</a>';
  const value = doc([['paragraph', { text: `See <a href="https://example.test/">site</a>.` }]]);
  assert.deepEqual(rules(run(value, only('internal-links'))), ['internal-links@doc']);
  assert.deepEqual(
    rules(run(doc([['paragraph', { text: `See ${internal}.` }]]), only('internal-links'))),
    []
  );
  assert.deepEqual(
    rules(run(doc([['paragraph', { text: 'See <a href="/about">about</a>.' }]]), only('internal-links'))),
    []
  );
  assert.deepEqual(
    rules(
      run(
        doc([
          ['paragraph', { text: 'x' }],
          ['button', { link: '/contact', text: 'Go' }],
        ]),
        only('internal-links')
      )
    ),
    []
  );
  assert.deepEqual(rules(run(value, { settings: { minInternalLinks: 0 }, ...only('internal-links') })), []);
  const short = run(value, only('content-short'));
  assert.deepEqual(rules(short), ['content-short@doc']);
  // Counted like the toolbar (computeStats), so the number matches what the editor shows.
  assert.deepEqual(short.issues[0].params, { words: 3, min: 300 });
  assert.deepEqual(rules(run(doc([]), only('content-short'))), []);
  assert.deepEqual(rules(run(value, { settings: { minWords: 0 }, ...only('content-short') })), []);
});

test('focus keyphrase: first paragraph, subheadings and density (0.5 to 3 %)', () => {
  const body = `${words(60, 'text')} garden tools ${words(60, 'more')}`;
  const value = doc([
    ['paragraph', { text: 'An intro about plants.' }],
    ['header', { text: 'Choosing', level: 2 }],
    ['paragraph', { text: body }],
  ]);
  const result = run(value, { keyphrase: 'Garden Tools', ...only('keyphrase') });
  // Document-level hints come first.
  assert.deepEqual(rules(result), ['keyphrase-headings@doc', 'keyphrase-intro@b0']);
  // One occurrence in 126 words is 0.8 %: inside the range.
  const fine = doc([
    ['paragraph', { text: 'Garden tools for small yards.' }],
    ['header', { text: 'Which garden tools?', level: 2 }],
    ['paragraph', { text: body }],
  ]);
  assert.deepEqual(rules(run(fine, { keyphrase: 'garden tools', ...only('keyphrase') })), []);
  const stuffed = doc([
    ['paragraph', { text: Array.from({ length: 40 }, () => 'garden tools rock').join(' ') }],
  ]);
  const high = run(stuffed, { keyphrase: 'garden tools', ...only('keyphrase') });
  assert.deepEqual(rules(high), ['keyphrase-density@doc']);
  assert.equal(high.issues[0].params.direction, 'high');
  // No keyphrase, no keyphrase hints.
  assert.deepEqual(rules(run(value, only('keyphrase'))), []);
});

test('settings turn rules off; disabled checks report nothing', () => {
  const value = doc([
    ['header', { text: 'Title', level: 1 }],
    ['paragraph', { text: 'Two  spaces.' }],
  ]);
  assert.ok(rules(run(value)).includes('h1-in-content@b0'));
  assert.deepEqual(rules(run(value, { settings: { enabled: false } })), []);
  assert.ok(!rules(run(value, { settings: { disabled: ['h1'] } })).includes('h1-in-content@b0'));
  assert.ok(run(value).issues.every((issue) => issue.severity === 'hint'));
});

test('units: prose of built-in blocks only (tables, code and custom blocks are not prose)', () => {
  const units = insightUnits(
    doc([
      ['paragraph', { text: 'P' }],
      ['table', { content: [['cell']] }],
      ['code', { code: 'x  y' }],
      ['myCustom', { text: 'custom' }],
      ['quote', { text: 'Q', caption: 'C' }],
      ['checklist', { items: [{ text: 'C1', checked: false }] }],
    ])
  );
  assert.deepEqual(
    units.map((unit) => `${unit.blockId}:${unit.kind}:${unit.path}`),
    ['b0:paragraph:text', 'b4:paragraph:text', 'b5:item:items.0.text']
  );
});

test('fixes: heading levels stay inside the allowed levels', () => {
  assert.equal(headingFixLevel(2), 3);
  assert.equal(headingFixLevel(0), 2);
  assert.equal(headingFixLevel(2, [2, 4]), 2);
  assert.equal(headingFixLevel(0, [3, 4]), null);
  assert.equal(headingFixLevel(0, [], 1), 2);
  assert.deepEqual(fixActionOf({ rule: 'heading-order', blockId: 'h', params: { level: 4, previous: 2 } }), {
    kind: 'heading',
    level: 3,
  });
  assert.equal(
    fixActionOf(
      { rule: 'heading-order', blockId: 'h', params: { level: 3, previous: 0 } },
      { headingLevels: [3] }
    ),
    null
  );
  assert.deepEqual(fixActionOf({ rule: 'multiple-h1', blockId: 'h' }), { kind: 'heading', level: 2 });
  assert.deepEqual(fixActionOf({ rule: 'h1-in-content', blockId: 'h', path: 'text' }), {
    kind: 'heading',
    level: 2,
  });
  assert.equal(fixActionOf({ rule: 'h1-in-content', blockId: 'h' }, { headingLevels: [1] }), null);
  assert.deepEqual(fixActionOf({ rule: 'extra-spaces', blockId: 'p', path: 'text' }), { kind: 'typography' });
  assert.deepEqual(fixActionOf({ rule: 'ambiguous-link-text', blockId: 'p' }), { kind: 'linkText' });
  assert.deepEqual(fixActionOf({ rule: 'image-alt-missing', blockId: 'i', path: 'file.alt' }), {
    kind: 'alt',
    index: 0,
  });
  assert.deepEqual(fixActionOf({ rule: 'image-alt-missing', blockId: 'g', path: 'images.2.file.alt' }), {
    kind: 'alt',
    index: 2,
  });
  assert.equal(fixActionOf({ rule: 'image-alt-missing', blockId: 'c', path: 'hero.alt' }), null);
  assert.equal(fixActionOf({ rule: 'content-short', blockId: null }), null);
  assert.equal(fixActionOf({ rule: 'table-no-header', blockId: 't' }), null);
  // Applied to block data: a header block, a heading item of a columns block, spacing.
  assert.deepEqual(
    fixedBlockData({ type: 'header', data: { text: 'H', level: 4 } }, {}, { kind: 'heading', level: 3 }),
    { text: 'H', level: 3 }
  );
  const columns = {
    type: 'columns',
    data: { _mex: 1, columns: [{ items: [{ type: 'heading', level: 1, text: 'H' }] }] },
  };
  assert.deepEqual(
    fixedBlockData(columns, { path: 'columns.0.items.0.text' }, { kind: 'heading', level: 2 }).columns[0]
      .items[0],
    { type: 'heading', level: 2, text: 'H' }
  );
  assert.equal(setHeadingLevel({ type: 'header', data: { text: 'H', level: 2 } }, '', 2), null);
  assert.deepEqual(
    fixedBlockData({ type: 'paragraph', data: { text: 'a  b' } }, { path: 'text' }, { kind: 'typography' }),
    { text: 'a b' }
  );
  // A focus fix changes no data.
  assert.equal(fixedBlockData({ type: 'paragraph', data: { text: 'x' } }, {}, { kind: 'linkText' }), null);
});

test('grammar replacement keeps stored markup (no render-only classes)', () => {
  const html = '<span data-mex-color="brand">teh text</span>';
  assert.equal(
    replaceInSegment(html, { offset: 0, length: 3, expected: 'teh', replacement: 'the' }).html,
    '<span data-mex-color="brand">the text</span>'
  );
});

test('runner: 2,000 blocks in slices, no slice near the 50 ms long-task limit', async () => {
  const blocks = [];
  for (let i = 0; i < 2000; i += 1) {
    if (i % 10 === 0) blocks.push(['header', { text: `Section ${i}`, level: 2 }]);
    else
      blocks.push([
        'paragraph',
        {
          text: `Paragraph ${i} was written by the synthetic team.  It explains <a href="/p${i}">things</a> in plain words , and it is long enough to count. ${sentence(22)}`,
        },
      ]);
  }
  const value = doc(blocks);
  const slices = [];
  const queue = [];
  const now = () => performance.now();
  const runner = createInsightsRunner({
    schedule: (fn) => queue.push(fn),
    cancel: () => {},
    now,
    budgetMs: 8,
  });
  let result = null;
  runner.run(value, { language: 'en', keyphrase: 'synthetic team' }, (done) => {
    result = done;
  });
  while (queue.length) {
    const fn = queue.shift();
    const start = now();
    fn();
    slices.push(now() - start);
  }
  assert.ok(result, 'the runner finished');
  assert.ok(slices.length > 1, 'the work was split');
  const longest = Math.max(...slices);
  assert.ok(longest < 50, `longest slice ${longest.toFixed(1)} ms`);
  assert.ok(result.issues.some((issue) => issue.rule === 'extra-spaces'));
  // Second run: unchanged text comes from the cache, so it is fast.
  const again = [];
  runner.run(value, { language: 'en' }, () => {});
  while (queue.length) {
    const fn = queue.shift();
    const start = now();
    fn();
    again.push(now() - start);
  }
  assert.ok(Math.max(...again) < 50);
  // A newer run cancels the older one.
  let first = 0;
  let second = 0;
  runner.run(value, { language: 'en' }, () => (first += 1));
  runner.run(value, { language: 'de' }, () => (second += 1));
  while (queue.length) queue.shift()();
  assert.equal(first, 0);
  assert.equal(second, 1);
});

test('configuration form: draft, validation, payload and dirty check', () => {
  assert.equal(toContentChecksDraft(undefined), undefined);
  const draft = toContentChecksDraft({ ...DEFAULT_CONTENT_CHECKS, blockPublish: ['h1'] });
  assert.deepEqual(validateContentChecks(draft), {});
  assert.deepEqual(validateContentChecks({ ...draft, minWords: null, sectionWords: 10 }), {
    'contentChecks.minWords': 'required',
    'contentChecks.sectionWords': 'contentRange',
  });
  const off = toggleContentCheck(draft, 'disabled', 'h1', true);
  assert.equal(sameContentChecks(draft, off), false);
  assert.equal(sameContentChecks(draft, toContentChecksDraft(draft)), true);
  // A rule that is off cannot block publishing.
  assert.deepEqual(toContentChecksPayload(off).blockPublish, []);
  assert.deepEqual(toContentChecksPayload(draft).blockPublish, ['h1']);
  const split = splitContentCheckErrors({
    fieldErrors: {
      'contentChecks.minWords': ['Too big'],
      'contentChecks.disabled.0': ['Bad'],
      'ai.model': ['x'],
    },
  });
  assert.deepEqual(split.errors, { 'contentChecks.minWords': 'Too big', contentChecks: 'Bad' });
  assert.deepEqual(split.rest.fieldErrors, { 'ai.model': ['x'] });
});

const fakeSettings = (stored = {}) => {
  const state = { settings: stored };
  const strapi = {
    config: { get: (key) => (key === 'middlewares' ? [] : undefined) },
    log: { warn: () => {}, error: () => {}, info: () => {} },
    store: () => ({
      get: async () => state.settings,
      set: async ({ value }) => {
        state.settings = value;
      },
    }),
    plugin: () => ({
      service: (name) => {
        if (name === 'core-blocks') return { status: () => undefined, setEnabled: async () => {} };
        if (name === 'blocks') return { annotationSummaries: () => [] };
        if (name === 'link-schedule') return { status: async () => ({}) };
        return null;
      },
    }),
  };
  return { state, settings: settingsService({ strapi }) };
};
const ai = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: '',
  model: 'claude-opus-5-5',
  maxInputChars: 8000,
  maxOutputTokens: 1024,
};

test('settings service: defaults, validation, storage and omission keeps the stored value', async () => {
  const { state, settings } = fakeSettings();
  assert.deepEqual((await settings.get()).contentChecks, normalizeContentChecks({}));
  const next = {
    ...normalizeContentChecks({}),
    h1: 'content',
    blockPublish: ['h1', 'content-short'],
    minWords: 500,
  };
  const saved = await settings.update({ ai, contentChecks: next });
  assert.equal(saved.contentChecks.h1, 'content');
  assert.deepEqual(state.settings.contentChecks.blockPublish, ['h1', 'content-short']);
  // Omitted (an older admin): the stored value stays.
  await settings.update({ ai });
  assert.equal(state.settings.contentChecks.minWords, 500);
  assert.equal((await settings.contentChecks()).minWords, 500);
  // Heuristics cannot be opted into the guard; bounds and unknown keys are refused.
  for (const bad of [
    { ...next, blockPublish: ['passive-voice'] },
    { ...next, minWords: 100000 },
    { ...next, extra: true },
    { ...next, h1: 'both' },
  ])
    await assert.rejects(settings.update({ ai, contentChecks: bad }), { name: 'ValidationError' });
});

test('publish guard: hints block only when opted in, only in guarded fields, never the keyphrase', async () => {
  const FIELD = 'plugin::magic-editor-x.richtext';
  const middlewares = [];
  let checks = normalizeContentChecks({});
  const draft = {
    documentId: 'd1',
    locale: 'en',
    body: doc([
      ['header', { text: 'Title', level: 1 }],
      ['paragraph', { text: 'Fine text.' }],
    ]),
    teaser: doc([['header', { text: 'Title', level: 1 }]]),
  };
  const strapi = {
    components: {},
    contentType: (uid) => strapi.types[uid],
    types: {
      'api::page.page': {
        uid: 'api::page.page',
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
        attributes: {
          body: { type: 'json', customField: FIELD, options: { publishGuard: true } },
          teaser: {
            type: 'json',
            customField: FIELD,
            options: { publishGuard: true, disableContentChecks: true },
          },
        },
      },
    },
    documents: Object.assign(() => ({ findMany: async () => [draft] }), {
      use: (fn) => middlewares.push(fn),
    }),
    db: { query: () => ({ findMany: async () => [] }) },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    plugin: () => ({ service: () => ({ contentChecks: async () => checks }) }),
  };
  registerPublishGuard(strapi);
  const publish = () =>
    middlewares[0](
      { action: 'publish', uid: 'api::page.page', params: { documentId: 'd1', locale: 'en' } },
      async () => 'published'
    );
  // Default: hints never block.
  assert.equal(await publish(), 'published');
  // Opted in: the H1 hint blocks the guarded field, not the field that turned hints off.
  checks = normalizeContentChecks({ blockPublish: ['h1'] });
  await assert.rejects(publish(), (error) => {
    assert.equal(error.name, 'ValidationError');
    assert.deepEqual(error.details.issues, [
      { field: 'body', rule: 'h1-in-content', blockId: 'b0', locale: 'en' },
    ]);
    assert.doesNotMatch(JSON.stringify(error.details), /Fine text|Title/);
    return true;
  });
  // Hints switched off globally: nothing blocks even when a rule was opted in.
  checks = normalizeContentChecks({ enabled: false, blockPublish: ['h1'] });
  assert.equal(await publish(), 'published');
});

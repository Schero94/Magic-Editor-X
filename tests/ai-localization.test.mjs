import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ENVELOPE_KEY,
  maskInline,
  toTranslationPayload,
  isTranslationEnvelope,
  repairInline,
  repairLocalizedValue,
} from '../shared/ai-localization.mjs';

const require = createRequire(import.meta.url);
const {
  createRepairMiddleware,
  currentJob,
  reducePayload,
  runInJob,
  wrapAiLocalizations,
} = require('../server/src/utils/ai-localization-guard.js');
const {
  registerReleaseReadiness,
  unregisterReleaseReadiness,
} = require('../server/src/utils/release-readiness.js');

const FIELD = 'plugin::magic-editor-x.richtext';
const LINK =
  '<a href="/articles/x" data-mex-uid="api::article.article" data-mex-document-id="abcdefghijklmnopqrstuvwx" data-mex-locale="en">our article</a>';
const PARAGRAPH = `See <a href="https://docs.example.test/guide">the guide</a> and ${LINK}, area <span data-mex-math="true">a^2 + b^2</span> with a note<sup data-mex-footnote="fn1abc" data-mex-note="Source text">1</sup>.`;

/** A realistic stored value with every kind of non-text data. */
const source = () => ({
  time: 1731400000000,
  version: '2.31.0',
  blocks: [
    { id: 'hdr00001', type: 'header', data: { text: 'Release notes', level: 2 } },
    { id: 'par00001', type: 'paragraph', data: { text: PARAGRAPH } },
    {
      id: 'img00001',
      type: 'image',
      data: {
        file: { url: 'https://cdn.example.test/photo.png', width: 8, height: 6 },
        caption: 'Our new bike',
      },
    },
    { id: 'mth00001', type: 'math', data: { tex: '\\frac{a + b}{2}', display: true, _mex: 1 } },
    {
      id: 'tbl00001',
      type: 'table',
      data: {
        withHeadings: true,
        content: [
          ['Name', 'Value'],
          ['Speed', 'Fast'],
        ],
      },
    },
    { id: 'cod00001', type: 'code', data: { code: 'const x = 1;' } },
  ],
});

/** Worst-case provider: prefixes every string, including ids, types, URLs and keys' values. */
const naive = (value) => {
  if (typeof value === 'string') return `[de] ${value}`;
  if (Array.isArray(value)) return value.map(naive);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, naive(v)]));
  return value;
};

test('the provider payload carries only inline text strings', () => {
  const { payload, segments } = toTranslationPayload(source());
  assert.ok(isTranslationEnvelope(payload));
  assert.deepEqual(Object.keys(payload), [ENVELOPE_KEY]);
  assert.equal(payload[ENVELOPE_KEY].length, segments.length);
  const json = JSON.stringify(payload);
  for (const hidden of [
    'hdr00001',
    'img00001',
    'cdn.example.test',
    'docs.example.test',
    'data-mex-uid',
    'abcdefghijklmnopqrstuvwx',
    '\\\\frac',
    'const x',
    '"header"',
    '_mex',
  ])
    assert.ok(!json.includes(hidden), hidden);
  assert.deepEqual(toTranslationPayload({ blocks: [] }), { payload: null, segments: [] });
  assert.equal(toTranslationPayload(null).payload, null);
  assert.ok(json.includes('<a href=\\"#mex-link-0\\">the guide</a>'));
  assert.ok(json.includes('<a href=\\"#mex-link-1\\">our article</a>'));
});

test('masked links come back with their targets, also when the translation reorders them', () => {
  const masked = maskInline(PARAGRAPH);
  const reordered = masked
    .replace('<a href="#mex-link-0">the guide</a>', '<a href="#mex-link-1">unseren Artikel</a>')
    .replace('<a href="#mex-link-1">our article</a>', '<a href="#mex-link-0">die Anleitung</a>');
  const html = repairInline(PARAGRAPH, reordered);
  assert.match(
    html,
    /data-mex-document-id="abcdefghijklmnopqrstuvwx"[^>]*>unseren Artikel<\/a>.*<a href="https:\/\/docs\.example\.test\/guide">die Anleitung<\/a>/
  );
  // an unknown placeholder takes the remaining source link (every source link is used exactly once)
  assert.equal(repairInline(PARAGRAPH, masked.replace('#mex-link-1', '#mex-link-9')), PARAGRAPH);
  assert.equal(repairInline(PARAGRAPH, masked), PARAGRAPH, 'an untouched answer is the source');
});

test('repairInline keeps translated text and restores link targets, math and footnotes', () => {
  const translated =
    '[de] Siehe <a href="https://evil.example.test/">unseren Artikel</a> und <a href="https://docs.example.test/guide" data-mex-uid="api::evil.evil">die Anleitung</a>, Fläche <span data-mex-math="true">a^2 + b^2 = [de]</span> mit Notiz<sup data-mex-footnote="zzz" data-mex-note="Quelle">9</sup>.';
  const html = repairInline(PARAGRAPH, translated);
  assert.ok(html.startsWith('[de] Siehe '));
  // matched by href first: the guide keeps its plain attributes, the other link gets the internal link back
  assert.match(html, /<a href="https:\/\/docs\.example\.test\/guide">die Anleitung<\/a>/);
  assert.match(html, /data-mex-document-id="abcdefghijklmnopqrstuvwx"[^>]*>unseren Artikel<\/a>/);
  assert.ok(!html.includes('evil'));
  assert.ok(html.includes('<span data-mex-math="true">a^2 + b^2</span>'));
  assert.ok(html.includes('data-mex-footnote="fn1abc"'));
  assert.ok(html.includes('data-mex-note="Quelle"'), 'the note is translated text');
});

test('repairInline refuses translations that drop or add structure', () => {
  assert.equal(repairInline(PARAGRAPH, 'Nur Text ohne Links.'), null);
  assert.equal(repairInline('Plain', 'Text <span data-mex-math="true">x</span>'), null);
  assert.equal(repairInline('Plain', 'Text <a href="https://x.example.test/">x</a>'), null);
  assert.equal(repairInline('Plain', 42), null);
  assert.equal(repairInline('Plain', '   '), null);
  assert.equal(repairInline('Plain', 'x'.repeat(30000)), null);
  assert.equal(repairInline('<b>Bold</b>', '<b>Fett</b>'), '<b>Fett</b>');
  assert.equal(repairInline('a', '<script>alert(1)</script>b'), 'b');
});

test('repairLocalizedValue keeps the source structure against a naive provider', () => {
  const value = source();
  const { payload } = toTranslationPayload(value);
  const result = repairLocalizedValue(value, naive(payload));
  assert.equal(result.segments, 7);
  assert.equal(result.translated, 7);
  assert.equal(result.kept, 0);
  const blocks = result.value.blocks;
  assert.deepEqual(
    blocks.map((block) => [block.id, block.type]),
    value.blocks.map((block) => [block.id, block.type])
  );
  assert.equal(blocks[0].data.text, '[de] Release notes');
  assert.equal(blocks[0].data.level, 2);
  assert.deepEqual(blocks[2].data.file, value.blocks[2].data.file);
  assert.deepEqual(blocks[3].data, value.blocks[3].data);
  assert.deepEqual(blocks[4].data.content, [
    ['[de] Name', '[de] Value'],
    ['[de] Speed', '[de] Fast'],
  ]);
  assert.equal(blocks[4].data.withHeadings, true);
  assert.equal(blocks[5].data.code, 'const x = 1;');
  assert.equal(result.value.version, '2.31.0');
  assert.match(blocks[1].data.text, /data-mex-uid="api::article.article"/);
  assert.match(blocks[1].data.text, /<span data-mex-math="true">a\^2 \+ b\^2<\/span>/);
});

test('repairLocalizedValue repairs a whole translated document and misaligned envelopes', () => {
  const value = source();
  // a provider that got the full document (no envelope) and translated everything
  const full = repairLocalizedValue(value, naive(value));
  assert.equal(full.translated, 0, 'translated block ids no longer match: nothing is taken over');
  assert.deepEqual(full.value.blocks, value.blocks);
  const partial = structuredClone(value);
  partial.blocks[0].data.text = 'Versionshinweise';
  partial.blocks[0].type = 'paragraph';
  partial.blocks[2].data.file.url = 'https://evil.example.test/x.png';
  const repaired = repairLocalizedValue(value, partial);
  assert.equal(repaired.value.blocks[0].type, 'header');
  assert.equal(repaired.value.blocks[0].data.text, 'Versionshinweise');
  assert.equal(repaired.value.blocks[2].data.file.url, 'https://cdn.example.test/photo.png');
  const wrongCount = repairLocalizedValue(value, { [ENVELOPE_KEY]: ['one'] });
  assert.equal(wrongCount.kept, 7);
  assert.deepEqual(wrongCount.value.blocks, value.blocks);
  assert.equal(repairLocalizedValue(null, naive(value)).value, null);
  assert.equal(repairLocalizedValue(value, null).kept, 7);
  const keyed = repairLocalizedValue({ ...value, fieldKey: 'sourceKey_000000000' }, null, {
    fieldKey: 'targetKey_000000000',
  });
  assert.equal(keyed.value.fieldKey, 'targetKey_000000000');
  const sourceKeyed = repairLocalizedValue({ ...value, fieldKey: 'sourceKey_000000000' }, null, {
    fieldKey: 'bad',
  });
  assert.equal(sourceKeyed.value.fieldKey, 'sourceKey_000000000');
});

/** Fake Strapi with one localized article type and a repeatable component. */
const fakeStrapi = ({ stored = {}, audit = [] } = {}) => {
  const component = {
    uid: 'blocks.section',
    attributes: { heading: { type: 'string' }, body: { type: 'json', customField: FIELD } },
  };
  const article = {
    uid: 'api::article.article',
    options: { draftAndPublish: true },
    attributes: {
      title: { type: 'string' },
      body: { type: 'json', customField: FIELD },
      summary: { type: 'json', customField: FIELD, options: { publishGuard: true } },
      sections: { type: 'component', repeatable: true, component: 'blocks.section' },
    },
  };
  const reads = [];
  const strapi = {
    components: { 'blocks.section': component },
    getModel: (uid) => (uid === article.uid ? article : null),
    contentType: (uid) => (uid === article.uid ? article : null),
    config: { get: () => undefined },
    documents: () => ({
      findOne: async ({ locale }) => {
        reads.push(locale);
        return stored[locale] || null;
      },
    }),
    plugin: () => ({ service: () => ({ recordMany: async (events) => audit.push(...events) }) }),
    log: { warn() {}, error() {}, info() {}, debug() {} },
  };
  return { strapi, article, reads, audit };
};

test('the repair middleware rebuilds AI writes from the source locale', async () => {
  const audit = [];
  const { strapi, article, reads } = fakeStrapi({
    audit,
    stored: { de: { sections: [{ body: { blocks: [], fieldKey: 'deKey_0000000000000' } }] } },
  });
  const middleware = createRepairMiddleware(strapi, strapi.log);
  const job = { uid: article.uid, documentId: 'doc1', sourceLocale: 'en' };
  const sectionBody = { blocks: [{ id: 'sec00001', type: 'paragraph', data: { text: 'Section text' } }] };
  assert.deepEqual(reducePayload(strapi, { ...job, sources: new Map() }, {}), {});
  let written = null;
  await runInJob(job, async () => {
    const sent = reducePayload(strapi, currentJob(), {
      title: 'Hello',
      body: source(),
      sections: [{ heading: 'Part', body: sectionBody }],
    });
    assert.ok(isTranslationEnvelope(sent.body));
    assert.ok(isTranslationEnvelope(sent.sections[0].body));
    assert.equal(sent.title, 'Hello');
    const ctx = {
      action: 'update',
      uid: article.uid,
      contentType: article,
      params: { documentId: 'doc1', locale: 'de', fields: [], data: naive(sent) },
    };
    await middleware(ctx, async () => {
      written = ctx.params.data;
    });
  });
  assert.equal(written.title, '[de] Hello', "non-editor fields are Strapi's business");
  assert.deepEqual(
    written.body.blocks.map((block) => block.id),
    source().blocks.map((block) => block.id)
  );
  assert.equal(written.body.blocks[0].data.text, '[de] Release notes');
  assert.equal(written.sections[0].body.blocks[0].data.text, '[de] Section text');
  assert.equal(written.sections[0].body.fieldKey, 'deKey_0000000000000');
  assert.deepEqual(reads, ['de'], 'only the target is read for its field keys');
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[0].counts, { segments: 7, translated: 7, kept: 0 });
  assert.equal(audit[0].event, 'ai.localize');
  assert.equal(audit[0].target.locale, 'de');
});

test('the repair middleware reads the stored source when the payload was not reduced, and refuses unknown fields', async () => {
  const { strapi, article, reads } = fakeStrapi({ stored: { en: { body: source(), sections: [] } } });
  const middleware = createRepairMiddleware(strapi, strapi.log);
  const job = { uid: article.uid, documentId: 'doc1', sourceLocale: 'en' };
  await runInJob(job, async () => {
    const ctx = {
      action: 'update',
      uid: article.uid,
      contentType: article,
      params: { documentId: 'doc1', locale: 'de', data: { body: naive(source()) } },
    };
    await middleware(ctx, async () => {});
    // the stored source is cleaned like any write (defaults added); no provider string was usable
    const blocks = ctx.params.data.body.blocks;
    assert.deepEqual(
      blocks.map((block) => [block.id, block.type]),
      source().blocks.map((block) => [block.id, block.type])
    );
    assert.equal(blocks[0].data.text, 'Release notes');
    assert.equal(blocks[2].data.file.url, 'https://cdn.example.test/photo.png');
    assert.deepEqual(reads, ['en']);
    const unknown = {
      action: 'update',
      uid: article.uid,
      contentType: article,
      params: { documentId: 'doc1', locale: 'de', data: { sections: [{ body: naive(source()) }] } },
    };
    let called = false;
    await assert.rejects(
      middleware(unknown, async () => {
        called = true;
      }),
      (error) =>
        error.name === 'ValidationError' &&
        error.details.code === 'AI_TRANSLATION_UNSAFE' &&
        error.details.errors[0].path.join('.') === 'sections.0.body'
    );
    assert.equal(called, false);
  });
});

test('the repair middleware leaves every other write alone', async () => {
  const { strapi, article } = fakeStrapi();
  const middleware = createRepairMiddleware(strapi, strapi.log);
  const data = () => ({ body: naive(source()) });
  const pass = async (ctx) => {
    const before = JSON.stringify(ctx.params.data);
    await middleware(ctx, async () => {});
    assert.equal(JSON.stringify(ctx.params.data), before);
  };
  const base = { uid: article.uid, contentType: article };
  // outside a job
  await pass({ ...base, action: 'update', params: { documentId: 'doc1', locale: 'de', data: data() } });
  const job = { uid: article.uid, documentId: 'doc1', sourceLocale: 'en' };
  await runInJob(job, async () => {
    await pass({ ...base, action: 'update', params: { documentId: 'doc1', locale: 'en', data: data() } });
    await pass({ ...base, action: 'update', params: { documentId: 'other', locale: 'de', data: data() } });
    await pass({ ...base, action: 'create', params: { documentId: 'doc1', locale: 'de', data: data() } });
    await pass({
      ...base,
      uid: 'api::other.other',
      action: 'update',
      params: { documentId: 'doc1', locale: 'de', data: data() },
    });
  });
});

test('wrapAiLocalizations marks jobs and reduces the payload through the services registry', async () => {
  const { strapi, article } = fakeStrapi();
  const services = new Map();
  let sentContent = null;
  let seenThis = null;
  services.set('plugin::i18n.ai-translations', {
    generateTranslations: async ({ content }) => {
      sentContent = content;
      return { localizations: [] };
    },
  });
  services.set('plugin::i18n.ai-localizations', {
    isEnabled: async () => true,
    async generateDocumentLocalizations({ document }) {
      seenThis = this;
      await services
        .get('plugin::i18n.ai-translations')
        .generateTranslations({ content: { body: document.body } });
    },
  });
  strapi.get = (name) =>
    name === 'services'
      ? {
          get: (uid) => services.get(uid),
          extend: (uid, fn) => services.set(uid, fn(services.get(uid))),
        }
      : null;
  assert.equal(wrapAiLocalizations(strapi), 'wrapped');
  assert.equal(wrapAiLocalizations(strapi), 'wrapped', 'idempotent');
  const service = services.get('plugin::i18n.ai-localizations');
  await service.generateDocumentLocalizations({
    model: article.uid,
    document: { documentId: 'd', locale: 'en', body: source() },
  });
  assert.equal(seenThis, service);
  assert.ok(isTranslationEnvelope(sentContent.body));
  // outside a job the payload passes unchanged
  await services.get('plugin::i18n.ai-translations').generateTranslations({ content: { body: source() } });
  assert.deepEqual(sentContent.body, source());
  const empty = { get: () => ({ get: () => undefined, extend() {} }) };
  assert.equal(wrapAiLocalizations({ ...empty, log: strapi.log }), 'absent');
});

test('Releases readiness: the entity validator applies the publish guard to published versions', async () => {
  const { strapi, article } = fakeStrapi();
  const calls = [];
  const original = async (model, data) => {
    calls.push(model.uid);
    return data;
  };
  strapi.entityValidator = { validateEntityCreation: original };
  assert.equal(registerReleaseReadiness(strapi), true);
  assert.equal(registerReleaseReadiness(strapi), false, 'idempotent');
  const validate = strapi.entityValidator.validateEntityCreation;
  const bad = {
    locale: 'en',
    summary: {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x <a href="https://x.example.test/"></a>' } }],
    },
  };
  const good = { locale: 'en', summary: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'ok' } }] } };
  await assert.rejects(validate(article, bad, { isDraft: false, locale: 'en' }, bad), (error) => {
    assert.equal(error.name, 'ValidationError');
    assert.equal(error.details.code, 'QUALITY_GATE');
    assert.deepEqual(error.details.issues, [
      { field: 'summary', rule: 'empty-link', blockId: 'p1', locale: 'en' },
    ]);
    return true;
  });
  assert.equal(await validate(article, good, { isDraft: false }), good);
  assert.equal(await validate(article, bad, { isDraft: true }), bad, 'drafts are never checked');
  // unguarded fields (body) and warnings do not count
  const warning = {
    body: {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x <a href="https://x.example.test/"></a>' } }],
    },
  };
  assert.equal(await validate(article, warning, { isDraft: false }), warning);
  const noDp = { ...article, uid: 'api::nodp.nodp', options: { draftAndPublish: false } };
  assert.equal(await validate(noDp, bad, { isDraft: false }), bad);
  assert.equal(calls.length, 5, "Strapi's own validation always runs first");
  unregisterReleaseReadiness(strapi);
  assert.equal(strapi.entityValidator.validateEntityCreation, original);
});

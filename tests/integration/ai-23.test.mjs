/**
 * 2.3 AI extras and grammar check against a running host: owner switches
 * (nothing is sent while off), per-field `disableAi`, RBAC, alt text with a
 * fake vision provider in the Anthropic and OpenAI shapes, whole-field
 * translation (structure kept, hostile output sanitised), summary, the
 * LanguageTool fake server and the private base URL policy.
 *
 * The host's `languageTool.allowPrivateBaseUrl` must match MEX_LT_PRIVATE
 * (default `true`, the fake LanguageTool server runs on 127.0.0.1); run once
 * more with the host started with MEX_LT_PRIVATE=false to check the refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { call, tokenFor, makePng, creds } from './helpers.mjs';
import { collectSegments } from '../../shared/ai-fields.mjs';

const LT_PRIVATE = process.env.MEX_LT_PRIVATE !== 'false';
const BODY = { uid: 'api::article.article', field: 'body' };
const AI_OFF_FIELD = { uid: 'api::article.article', field: 'summary' };
const AI_BASE = {
  enabled: true,
  provider: 'anthropic',
  baseUrl: '',
  model: 'claude-opus-5-5',
  maxInputChars: 2000,
  maxOutputTokens: 512,
};
const LT_OFF = { enabled: false, baseUrl: '', username: '', level: 'default', apiKey: '' };

/**
 * Starts a JSON server on 127.0.0.1 that records every request.
 * @param {(req: { path: string, headers: object, body: string }) => [number, unknown]} handler - Reply.
 * @returns {Promise<{ base: string, requests: Array<object>, close: () => void }>} Server.
 */
const fakeServer = async (handler) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const entry = { path: req.url, headers: req.headers, body };
      requests.push(entry);
      const [status, json] = handler(entry);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
};

/** Fake vision/text provider: alt text for images, JSON echo for translations, a summary otherwise. */
const providerAnswer = ({ path, body }) => {
  const json = JSON.parse(body);
  const anthropic = path === '/v1/messages';
  const user = anthropic ? json.messages[0].content : json.messages[1].content;
  let text;
  if (Array.isArray(user)) text = '"Ein synthetisches Testbild mit blauer Fläche"';
  else if (user.includes('<json>')) {
    const payload = JSON.parse(user.split('<json>\n')[1].split('\n</json>')[0]);
    text = JSON.stringify({
      segments: payload.segments.map((segment) => ({
        id: segment.id,
        html: `DE ${segment.html}<img src=x onerror=alert(1)><a href="https://evil.example.com">mehr</a><script>alert(1)</script>`,
      })),
    });
  } else text = 'Eine kurze <b>Zusammenfassung</b>.';
  return [
    200,
    anthropic
      ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: text }, finish_reason: 'stop' }] },
  ];
};

/** Fake LanguageTool: flags "Fehlr" with two replacements. */
const languageToolAnswer = ({ body }) => {
  const form = new URLSearchParams(body);
  const text = form.get('text') || '';
  const offset = text.indexOf('Fehlr');
  return [
    200,
    {
      software: { name: 'LanguageTool', version: 'synthetic', apiVersion: 1 },
      language: { name: 'German', code: form.get('language') },
      matches:
        offset === -1
          ? []
          : [
              {
                message: 'Möglicher Tippfehler gefunden.',
                shortMessage: 'Rechtschreibfehler',
                offset,
                length: 5,
                replacements: [{ value: 'Fehler' }, { value: 'Fehl' }],
                rule: {
                  id: 'GERMAN_SPELLER_RULE',
                  issueType: 'misspelling',
                  category: { id: 'TYPOS', name: 'Tippfehler' },
                },
              },
            ],
    },
  ];
};

const putSettings = (token, body) => call('PUT', '/magic-editor-x/settings', { token, body });

const sample = {
  time: 1,
  version: '2.31.7',
  blocks: [
    {
      id: 'h1',
      type: 'header',
      data: { text: 'Synthetic <b>title</b>', level: 2 },
      tunes: { alignmentTune: { alignment: 'center' } },
    },
    {
      id: 'p1',
      type: 'paragraph',
      data: { text: 'Read <a href="https://example.com/guide">the guide</a> with a Fehlr.' },
    },
    { id: 'l1', type: 'list', data: { style: 'unordered', items: [{ content: 'One item', items: [] }] } },
  ],
};

test('2.3 AI extras: switches off send nothing, disableAi, RBAC, alt text, translate, summary', async () => {
  const provider = await fakeServer(providerAnswer);
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const segments = collectSegments(sample);
  try {
    // Everything off: 503 and no request reaches the provider.
    let r = await putSettings(admin, {
      ai: { ...AI_BASE, enabled: false, apiKey: '' },
      languageTool: LT_OFF,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.ai.allowImages, false);
    assert.equal(r.body.data.ai.allowFieldActions, false);
    const upload = new FormData();
    upload.append('image', new Blob([makePng(16)], { type: 'image/png' }), 'synthetic.png');
    const uploaded = await call('POST', '/magic-editor-x/image/byFile', { token: editor, body: upload });
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    const fileId = uploaded.body.file.id;
    assert.ok(Number.isInteger(fileId));
    const altText = (token, body) => call('POST', '/magic-editor-x/ai/image/alt-text', { token, body });
    const field = (token, action, body) =>
      call('POST', `/magic-editor-x/ai/field/${action}`, { token, body });
    r = await altText(editor, { target: BODY, fileId });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.details.code, 'DISABLED');
    r = await putSettings(admin, {
      ai: { ...AI_BASE, baseUrl: provider.base, apiKey: 'sk-test-synthetic-key' },
    });
    assert.equal(r.status, 200);
    r = await altText(editor, { target: BODY, fileId });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.details.code, 'IMAGES_DISABLED');
    r = await field(editor, 'translate', { target: BODY, segments, language: 'German' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.details.code, 'FIELD_ACTIONS_DISABLED');
    assert.equal(provider.requests.length, 0, 'nothing was sent while the switches were off');

    // Switches on (2.2-style bodies without them keep the stored values).
    r = await putSettings(admin, {
      ai: { ...AI_BASE, baseUrl: provider.base, allowImages: true, allowFieldActions: true },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await putSettings(admin, { ai: { ...AI_BASE, baseUrl: provider.base } });
    assert.equal(r.body.data.ai.allowImages, true);
    const config = await call('GET', '/magic-editor-x/config', { token: editor });
    assert.equal(config.body.data.ai.altText, true);
    assert.equal(config.body.data.ai.fieldActions, true);
    assert.equal(config.body.data.permissions.grammar, true);

    // Per-field disableAi (403), unknown field (404), RBAC (403), Media Library permission (404).
    assert.equal((await altText(editor, { target: AI_OFF_FIELD, fileId })).status, 403);
    assert.equal((await field(editor, 'summarize', { target: AI_OFF_FIELD, segments })).status, 403);
    assert.equal((await altText(editor, { target: { ...BODY, field: 'nope' }, fileId })).status, 404);
    for (const who of ['author', 'reviewer', 'reader']) {
      const token = await tokenFor(who);
      assert.equal((await altText(token, { target: BODY, fileId })).status, 403, who);
      assert.equal((await field(token, 'summarize', { target: BODY, segments })).status, 403, who);
    }
    if (creds.users.writer) {
      const writer = await tokenFor('writer');
      assert.equal((await altText(writer, { target: BODY, fileId })).status, 404, 'no upload.read: 404');
    }
    assert.equal((await altText(editor, { target: BODY, fileId: 999999 })).status, 404);
    assert.equal((await altText(editor, { target: BODY, fileId: 'x' })).status, 400);
    assert.equal((await field(editor, 'rewrite', { target: BODY, segments })).status, 404);
    assert.equal(
      (
        await field(editor, 'translate', {
          target: BODY,
          segments: [...segments, segments[0]],
          language: 'German',
        })
      ).status,
      400
    );
    assert.equal(provider.requests.length, 0);

    // Alt text, Anthropic shape.
    r = await altText(editor, { target: BODY, fileId, locale: 'de' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.text, 'Ein synthetisches Testbild mit blauer Fläche');
    let sent = provider.requests.at(-1);
    assert.equal(sent.path, '/v1/messages');
    assert.equal(sent.headers['x-api-key'], 'sk-test-synthetic-key');
    let json = JSON.parse(sent.body);
    const [image, prompt] = json.messages[0].content;
    assert.equal(image.type, 'image');
    assert.equal(image.source.type, 'base64');
    assert.equal(image.source.media_type, 'image/png');
    assert.ok(
      Buffer.from(image.source.data, 'base64')
        .subarray(0, 4)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    );
    assert.match(prompt.text, /German/);

    // Alt text, OpenAI shape.
    r = await putSettings(admin, {
      ai: {
        ...AI_BASE,
        provider: 'openai',
        model: 'gpt-6-luna',
        baseUrl: provider.base,
        apiKey: 'sk-test-synthetic-key',
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await altText(editor, { target: BODY, fileId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    sent = provider.requests.at(-1);
    assert.equal(sent.path, '/v1/chat/completions');
    assert.equal(sent.headers.authorization, 'Bearer sk-test-synthetic-key');
    json = JSON.parse(sent.body);
    assert.equal(json.messages[1].content[0].type, 'image_url');
    assert.match(json.messages[1].content[0].image_url.url, /^data:image\/png;base64,iVBOR/);
    assert.equal(json.messages[1].content[1].type, 'text');

    // Translate: same segments back, hostile markup removed, new links unwrapped, nothing else sent.
    r = await field(editor, 'translate', { target: BODY, segments, language: 'German' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      r.body.data.segments.map((s) => `${s.blockId}:${s.path}`),
      segments.map((s) => `${s.blockId}:${s.path}`)
    );
    const out = JSON.stringify(r.body.data);
    assert.doesNotMatch(out, /<img|onerror|<script|evil\.example/);
    assert.match(
      r.body.data.segments[1].html,
      /^DE Read <a href="https:\/\/example.com\/guide">the guide<\/a>/
    );
    sent = JSON.parse(provider.requests.at(-1).body);
    assert.doesNotMatch(
      JSON.stringify(sent),
      /alignmentTune|"h1"|"p1"|"level"/,
      'only text strings are sent'
    );

    // Summary and the input limit.
    r = await field(editor, 'summarize', { target: BODY, segments });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.text, 'Eine kurze Zusammenfassung.');
    const before = provider.requests.length;
    r = await field(editor, 'summarize', {
      target: BODY,
      segments: [{ blockId: 'big', path: 'text', html: 'x'.repeat(2001) }],
    });
    assert.equal(r.status, 413);
    assert.equal(provider.requests.length, before);
  } finally {
    await putSettings(admin, {
      ai: { ...AI_BASE, enabled: false, apiKey: '', allowImages: false, allowFieldActions: false },
      languageTool: LT_OFF,
    });
    provider.close();
  }
});

test('2.3 grammar check: LanguageTool fake server, switch, RBAC, encrypted key, private URL policy', async () => {
  const languageTool = await fakeServer(languageToolAnswer);
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const segments = collectSegments(sample);
  const check = (token, body) => call('POST', '/magic-editor-x/grammar/check', { token, body });
  try {
    const settings = await call('GET', '/magic-editor-x/settings', { token: admin });
    assert.equal(settings.body.data.environment.languageTool.allowPrivateBaseUrl, LT_PRIVATE);
    let r = await putSettings(admin, { ai: { ...AI_BASE, enabled: false }, languageTool: LT_OFF });
    assert.equal(r.status, 200);
    r = await check(editor, { target: BODY, segments, locale: 'de' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.details.code, 'DISABLED');

    const lt = {
      enabled: true,
      baseUrl: languageTool.base,
      username: 'editor@example.test',
      level: 'picky',
      apiKey: 'lt-synthetic-key',
    };
    r = await putSettings(admin, { ai: { ...AI_BASE, enabled: false }, languageTool: lt });
    const test2 = await call('POST', '/magic-editor-x/settings/language-tool/test', {
      token: admin,
      body: { languageTool: lt },
    });
    if (!LT_PRIVATE) {
      assert.equal(r.status, 400, 'a private LanguageTool URL needs languageTool.allowPrivateBaseUrl');
      assert.ok(r.body.error.details.fieldErrors['languageTool.baseUrl']);
      assert.equal(test2.status, 400);
      assert.equal(languageTool.requests.length, 0);
      return;
    }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.languageTool.hasApiKey, true);
    assert.doesNotMatch(JSON.stringify(r.body), /lt-synthetic-key|apiKeyEncrypted/);
    assert.equal(test2.status, 200, JSON.stringify(test2.body));
    assert.equal(languageTool.requests.length, 1);
    const read = await call('GET', '/magic-editor-x/settings', { token: admin });
    assert.doesNotMatch(JSON.stringify(read.body), /lt-synthetic-key|v1:/);
    const moved = await putSettings(admin, {
      ai: { ...AI_BASE, enabled: false },
      languageTool: { ...lt, apiKey: undefined, baseUrl: `${languageTool.base}/other` },
    });
    assert.equal(moved.status, 400, 'a new base URL needs the key again');
    assert.ok(moved.body.error.details.fieldErrors['languageTool.apiKey']);

    const config = await call('GET', '/magic-editor-x/config', { token: editor });
    assert.equal(config.body.data.grammar.enabled, true);
    for (const who of ['author', 'reviewer', 'reader']) {
      assert.equal((await check(await tokenFor(who), { target: BODY, segments })).status, 403, who);
    }
    assert.equal((await check(editor, { target: { ...BODY, field: 'nope' }, segments })).status, 404);
    assert.equal(languageTool.requests.length, 1);

    r = await check(editor, { target: BODY, segments, locale: 'de' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.language, 'de-DE');
    assert.equal(r.body.data.matches.length, 1);
    const [match] = r.body.data.matches;
    assert.deepEqual(
      [match.blockId, match.path, match.text, match.replacements, match.rule.category.id],
      ['p1', 'text', 'Fehlr', ['Fehler', 'Fehl'], 'TYPOS']
    );
    assert.equal('Read the guide with a Fehlr.'.slice(match.offset, match.offset + match.length), 'Fehlr');
    const form = new URLSearchParams(languageTool.requests.at(-1).body);
    assert.equal(form.get('language'), 'de-DE');
    assert.equal(form.get('level'), 'picky');
    assert.equal(form.get('username'), 'editor@example.test');
    assert.equal(form.get('apiKey'), 'lt-synthetic-key');
    assert.equal(form.get('text'), 'Synthetic title\n\nRead the guide with a Fehlr.\n\nOne item');
    if (creds.users.writer) {
      r = await check(await tokenFor('writer'), { target: BODY, segments });
      assert.equal(r.status, 200, 'grammar.use without Media Library permission');
    }
  } finally {
    await putSettings(admin, { ai: { ...AI_BASE, enabled: false }, languageTool: LT_OFF });
    languageTool.close();
  }
});

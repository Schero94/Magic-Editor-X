/**
 * Media Library blocks (2.3): gallery, video and audio blocks and image focal
 * points survive the save middleware in their sanitised shape, field presets
 * refuse them where they are not allowed, and the Content API output
 * (`?mex=json|html`) refreshes every Media Library file of these blocks only
 * for callers with `plugin::upload.content-api.find`. The link check reports
 * missing Media Library files of the new blocks.
 *
 * The files are synthetic: generated PNGs and a WAV, a WebVTT text and a
 * one-second test-pattern WebM (tests/fixtures/media/clip.webm).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { call, tokenFor, createArticle, makePng } from './helpers.mjs';

const RUN = Date.now().toString(36);
const ARTICLE = 'api::article.article';
const STALE = '/uploads/stale-media';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const state = { files: {}, tokens: {}, ids: {} };

/**
 * A short mono 8 kHz WAV (sine tone).
 * @returns {Buffer} WAV bytes.
 */
const makeWav = () => {
  const samples = 800;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 8000) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

/**
 * Uploads one file to the Media Library through the admin upload route.
 * @param {Buffer|string} bytes - Content.
 * @param {string} name - File name.
 * @param {string} type - MIME type.
 * @param {string} [alternativeText] - Alternative text.
 * @returns {Promise<object>} Stored file.
 */
const upload = async (bytes, name, type, alternativeText) => {
  const form = new FormData();
  form.append('files', new Blob([bytes], { type }), name);
  form.append('fileInfo', JSON.stringify({ name, alternativeText: alternativeText || null, caption: null }));
  const response = await call('POST', '/upload', { token: await tokenFor('admin'), body: form });
  assert.equal(response.status, 201, `upload ${name}: ${JSON.stringify(response.body).slice(0, 300)}`);
  return response.body[0];
};

/**
 * @param {string} name - Token name suffix.
 * @param {'read-only'|'full-access'|'custom'} type - Token type.
 * @param {string[]} [permissions] - Custom permissions.
 * @returns {Promise<string>} Access key.
 */
const apiToken = async (name, type, permissions) => {
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: {
      name: `mex-media-${name}-${RUN}`,
      type,
      lifespan: null,
      description: 'integration',
      ...(permissions ? { permissions } : {}),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  return response.body.data.accessKey;
};

/** Stored file reference of an uploaded file with a stale URL (resolution must refresh it). */
const stale = (file, ext) => ({
  url: `${STALE}${ext}`,
  id: file.id,
  documentId: file.documentId,
  mime: file.mime,
});

const mediaBlocks = () => [
  {
    id: 'g1',
    type: 'gallery',
    data: {
      images: [
        {
          file: { ...stale(state.files.red, '.png'), alt: '' },
          caption: 'Red <b>square</b><script>alert(1)</script>',
          focalPoint: { x: 0.256, y: 0.7 },
        },
        { file: { ...stale(state.files.blue, '.png'), alt: 'Blue square' }, caption: '', decorative: true },
        { file: { url: 'javascript:alert(1)' }, caption: 'dropped' },
        { file: { url: '/uploads/clip.webm', mime: 'video/webm' }, caption: 'not an image' },
      ],
      layout: 'carousel',
      columns: 9,
      caption: 'Synthetic squares',
      extra: 'dropped',
      _mex: 1,
    },
  },
  {
    id: 'v1',
    type: 'video',
    data: {
      file: stale(state.files.clip, '.webm'),
      poster: stale(state.files.red, '.png'),
      title: 'Test pattern',
      caption: 'One second <i>test pattern</i>',
      loop: true,
      muted: true,
      autoplay: true,
      _mex: 1,
      tracks: [
        {
          file: stale(state.files.vtt, '.vtt'),
          kind: 'captions',
          srclang: 'en',
          label: 'English',
          default: true,
        },
        {
          file: { url: '/uploads/x.srt', mime: 'application/x-subrip' },
          kind: 'captions',
          srclang: 'en',
          label: 'x',
        },
      ],
    },
  },
  {
    id: 'a1',
    type: 'audio',
    data: {
      file: stale(state.files.wav, '.wav'),
      title: 'Tone',
      caption: '',
      loop: false,
      muted: true,
      tracks: [],
      _mex: 1,
    },
  },
  {
    id: 'i1',
    type: 'image',
    data: { file: { url: '/uploads/i.png', alt: 'I' }, caption: '', focalPoint: { x: 0.5, y: -1 } },
  },
];

before(async () => {
  state.files = {
    red: await upload(makePng(12), `red-${RUN}.png`, 'image/png', 'Library alt red'),
    blue: await upload(makePng(10), `blue-${RUN}.png`, 'image/png'),
    clip: await upload(
      fs.readFileSync(new URL('../fixtures/media/clip.webm', import.meta.url)),
      `clip-${RUN}.webm`,
      'video/webm'
    ),
    wav: await upload(makeWav(), `tone-${RUN}.wav`, 'audio/wav'),
    vtt: await upload('WEBVTT\n\n00:00.000 --> 00:01.000\nTest pattern\n', `clip-${RUN}.vtt`, 'text/vtt'),
  };
  const admin = await tokenFor('admin');
  const article = await createArticle(admin, {
    title: `Media ${RUN}`,
    slug: `media-${RUN}`,
    body: doc(mediaBlocks()),
  });
  state.ids.article = article.documentId;
  const published = await call(
    'POST',
    `/content-manager/collection-types/${ARTICLE}/${article.documentId}/actions/publish`,
    {
      token: admin,
      body: {},
    }
  );
  assert.equal(published.status, 200, JSON.stringify(published.body).slice(0, 300));
  state.tokens = {
    full: await apiToken('full', 'full-access'),
    noUpload: await apiToken('noupload', 'custom', [`${ARTICLE}.find`, `${ARTICLE}.findOne`]),
  };
});

test('saving stores the sanitised media blocks (bounds, MIME checks, focal points, no unknown keys)', async () => {
  const response = await call('GET', `/content-manager/collection-types/${ARTICLE}/${state.ids.article}`, {
    token: await tokenFor('admin'),
  });
  assert.equal(response.status, 200);
  const [g, v, a, i] = response.body.data.body.blocks;
  assert.equal(g.type, 'gallery');
  assert.equal(g.data.images.length, 2, 'javascript: and non-image entries are dropped');
  assert.equal(g.data.images[0].caption, 'Red <b>square</b>');
  assert.deepEqual(g.data.images[0].focalPoint, { x: 0.26, y: 0.7 });
  assert.equal(g.data.images[1].decorative, true);
  assert.equal(g.data.columns, 3);
  assert.equal(g.data.layout, 'carousel');
  assert.equal(g.data.extra, undefined);
  assert.equal(v.data.autoplay, undefined, 'no autoplay key is stored');
  assert.equal(v.data.tracks.length, 1, 'only WebVTT tracks are kept');
  assert.equal(v.data.caption, 'One second <i>test pattern</i>');
  assert.equal(a.data.muted, undefined);
  assert.deepEqual(Object.keys(a.data).sort(), ['_mex', 'caption', 'file', 'loop', 'title', 'tracks']);
  assert.equal(i.data.focalPoint, undefined, 'an out-of-range focal point is dropped');
});

test('field presets refuse the media blocks where the preset does not allow them', async () => {
  const admin = await tokenFor('admin');
  const response = await call('POST', `/content-manager/collection-types/${ARTICLE}`, {
    token: admin,
    body: {
      title: `Preset ${RUN}`,
      slug: `preset-${RUN}`,
      summary: doc([mediaBlocks()[0]]),
      teaser: doc([mediaBlocks()[2]]),
    },
  });
  assert.equal(response.status, 400, JSON.stringify(response.body).slice(0, 300));
  assert.equal(response.body.error.details.code, 'PRESET_VIOLATION');
  const codes = response.body.error.details.violations.map((v) => `${v.field}:${v.code}`).sort();
  assert.deepEqual(codes, ['summary:BLOCK_NOT_ALLOWED', 'teaser:BLOCK_NOT_ALLOWED']);
  assert.doesNotMatch(JSON.stringify(response.body), /Synthetic squares|uploads/, 'no content in the error');
});

test('?mex=json refreshes gallery, video, poster, track and audio files only with upload find', async () => {
  const get = (token) => call('GET', `/api/articles/${state.ids.article}?mex=json`, { token });
  const full = await get(state.tokens.full);
  assert.equal(full.status, 200, JSON.stringify(full.body).slice(0, 300));
  const [g, v, a] = full.body.data.body.blocks;
  assert.equal(g.data.images[0].file.url, state.files.red.url);
  assert.equal(g.data.images[0].file.alt, 'Library alt red', 'an empty alt is filled from the library');
  assert.equal(g.data.images[1].file.alt, 'Blue square', 'the block alt wins');
  assert.equal(v.data.file.url, state.files.clip.url);
  assert.equal(v.data.file.alt, undefined);
  assert.equal(v.data.poster.url, state.files.red.url);
  assert.equal(v.data.tracks[0].file.url, state.files.vtt.url);
  assert.equal(a.data.file.url, state.files.wav.url);

  const denied = await get(state.tokens.noUpload);
  assert.equal(denied.status, 200);
  const text = JSON.stringify(denied.body.data.body);
  for (const file of Object.values(state.files))
    assert.ok(!text.includes(file.url), `${file.name} not resolved`);
  assert.equal(denied.body.data.body.blocks[1].data.file.url, `${STALE}.webm`, 'stored file kept');
});

test('?mex=html renders the resolved media without inline styles or autoplay', async () => {
  const html = await call('GET', `/api/articles/${state.ids.article}?mex=html`, { token: state.tokens.full });
  assert.equal(html.status, 200);
  const body = html.body.data.body;
  assert.match(body, /<figure class="mex-gallery mex-gallery-carousel mex-gallery-cols-3"/);
  assert.match(body, /data-mex-focal-x="0.26" data-mex-focal-y="0.7"/);
  assert.ok(body.includes(`<video src="${state.files.clip.url}" controls preload="metadata"`));
  assert.ok(
    body.includes(`<track kind="captions" src="${state.files.vtt.url}" srclang="en" label="English" default>`)
  );
  assert.ok(body.includes(`<audio src="${state.files.wav.url}" controls`));
  assert.doesNotMatch(body, /style=|autoplay|<script/);
  const denied = await call('GET', `/api/articles/${state.ids.article}?mex=html`, {
    token: state.tokens.noUpload,
  });
  assert.match(denied.body.data.body, new RegExp(`<video src="${STALE}\\.webm"`));
});

test('the link check reports Media Library files of the media blocks', async () => {
  const editor = await tokenFor('editor');
  const ids = [state.files.clip.id, state.files.vtt.id, state.files.wav.id, 987654321];
  const response = await call('POST', '/magic-editor-x/quality/links', {
    token: editor,
    body: { media: ids },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  const status = Object.fromEntries(response.body.data.media.map((m) => [m.id, m.status]));
  assert.deepEqual(
    ids.map((id) => status[id]),
    ['ok', 'ok', 'ok', 'missing']
  );
});

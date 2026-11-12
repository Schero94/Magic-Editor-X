/**
 * Authoring 2.4: POST /media/byUrl (pasted video/audio and WebVTT tracks copied
 * into the Media Library) and the code block file name through the save
 * middleware and the Content API output.
 *
 * The test starts a fake media server on 127.0.0.1:MEX_MEDIA_PORT (default
 * 1587). The host must list exactly that origin in
 * `uploads.allowPrivateOrigins` (the documented owner opt-in for private
 * origins; redirects from it are never followed) and set
 * `uploads.maxMediaBytes` to 1 MiB (`MEX_MEDIA_MAX` in the acceptance host),
 * so the size cap is checked with a 2 MiB file. Every other private address
 * (10.0.0.1, 169.254.169.254, other loopback ports) must stay refused.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { call, tokenFor, createArticle, makePng } from './helpers.mjs';

const PORT = Number(process.env.MEX_MEDIA_PORT || 1587);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WEBM = fs.readFileSync(new URL('../fixtures/media/clip.webm', import.meta.url));
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.alloc(2048)]);
const VTT = Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nSynthetic caption\n');
const mp4 = (size) => {
  const buffer = Buffer.alloc(size);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftypisom', 4, 'ascii');
  return buffer;
};

const ROUTES = {
  '/clip.webm': ['video/webm', WEBM],
  '/song.mp3': ['audio/mpeg', MP3],
  '/en.vtt': ['text/vtt; charset=utf-8', VTT],
  '/poster.png': ['image/png', makePng(16)],
  '/big.mp4': ['video/mp4', mp4(2 * 1024 * 1024)],
  '/fake.mp4': ['video/mp4', Buffer.from('<html><body>not a video</body></html>')],
  '/page.mp4': ['text/html', Buffer.from('<html></html>')],
  '/fake.vtt': ['text/vtt', Buffer.from('NOT A TRACK')],
};
const hits = [];
let server;

before(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url, ORIGIN).pathname;
    hits.push(path);
    if (path === '/redirect-private')
      return res.writeHead(302, { location: 'http://10.0.0.1/clip.webm' }).end();
    if (path === '/redirect-same') return res.writeHead(302, { location: `${ORIGIN}/clip.webm` }).end();
    const route = ROUTES[path];
    if (!route) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': route[0], 'content-length': route[1].length });
    return res.end(route[1]);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

after(() => new Promise((resolve) => server.close(resolve)));

const byUrl = async (who, body) =>
  call('POST', '/magic-editor-x/media/byUrl', { token: who ? await tokenFor(who) : undefined, body });

test('media by URL stores video, audio and WebVTT files from the listed origin in the Media Library', async () => {
  const video = await byUrl('editor', { url: `${ORIGIN}/clip.webm`, kind: 'video' });
  assert.equal(video.status, 200, JSON.stringify(video.body));
  assert.equal(video.body.success, 1);
  assert.equal(video.body.file.mime, 'video/webm');
  assert.match(video.body.file.url, /^\/uploads\/.+\.webm$/);
  assert.deepEqual(Object.keys(video.body.file).sort(), [
    'documentId',
    'ext',
    'hash',
    'id',
    'mime',
    'name',
    'size',
    'url',
  ]);
  const stored = await call('GET', `/upload/files/${video.body.file.id}`, { token: await tokenFor('admin') });
  assert.equal(stored.status, 200);
  assert.equal(stored.body.mime, 'video/webm');
  const bytes = Buffer.from(
    await (await fetch(process.env.MEX_HOST_URL + video.body.file.url)).arrayBuffer()
  );
  assert.deepEqual(bytes, WEBM);

  const audio = await byUrl('editor', { url: `${ORIGIN}/song.mp3`, kind: 'audio' });
  assert.equal(audio.status, 200, JSON.stringify(audio.body));
  assert.equal(audio.body.file.mime, 'audio/mpeg');
  const track = await byUrl('editor', { url: `${ORIGIN}/en.vtt`, kind: 'track' });
  assert.equal(track.status, 200, JSON.stringify(track.body));
  assert.equal(track.body.file.mime, 'text/vtt');
  // Posters go through the image route, which honours the same listed origin.
  const poster = await call('POST', '/magic-editor-x/image/byUrl', {
    token: await tokenFor('editor'),
    body: { url: `${ORIGIN}/poster.png` },
  });
  assert.equal(poster.status, 200, JSON.stringify(poster.body));
  assert.equal(poster.body.file.mime, 'image/png');
});

test('media by URL refuses private addresses, local schemes and redirects (SSRF)', async () => {
  const before = hits.length;
  for (const url of [
    'http://10.0.0.1/clip.webm',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/clip.webm',
    `http://127.0.0.1:${PORT + 1}/clip.webm`,
    `http://localhost:${PORT}/clip.webm`,
    'data:video/webm;base64,GkXfow==',
    'blob:http://127.0.0.1/1',
    'file:///etc/passwd',
  ]) {
    const response = await byUrl('editor', { url, kind: 'video' });
    assert.equal(response.status, 400, `${url}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.success, 0);
  }
  assert.equal(hits.length, before, 'no refused URL reached the fake server');
  // A redirect from the listed origin is never followed, also to the same origin.
  for (const path of ['/redirect-private', '/redirect-same']) {
    const response = await byUrl('editor', { url: `${ORIGIN}${path}`, kind: 'video' });
    assert.equal(response.status, 502, path);
  }
  assert.ok(!hits.slice(before).includes('/clip.webm'));
});

test('media by URL enforces the size cap, the response type and the file signature', async () => {
  const big = await byUrl('editor', { url: `${ORIGIN}/big.mp4`, kind: 'video' });
  assert.equal(big.status, 413, JSON.stringify(big.body));
  const fake = await byUrl('editor', { url: `${ORIGIN}/fake.mp4`, kind: 'video' });
  assert.equal(fake.status, 415);
  const page = await byUrl('editor', { url: `${ORIGIN}/page.mp4`, kind: 'video' });
  assert.equal(page.status, 415);
  const wrongKind = await byUrl('editor', { url: `${ORIGIN}/song.mp3`, kind: 'video' });
  assert.equal(wrongKind.status, 415);
  const fakeTrack = await byUrl('editor', { url: `${ORIGIN}/fake.vtt`, kind: 'track' });
  assert.equal(fakeTrack.status, 415);
  const missing = await byUrl('editor', { url: `${ORIGIN}/nothing.mp4`, kind: 'video' });
  assert.equal(missing.status, 502);
});

test('media by URL validates its body strictly and needs access plus upload permission', async () => {
  for (const body of [
    { url: `${ORIGIN}/clip.webm` },
    { url: `${ORIGIN}/clip.webm`, kind: 'image' },
    { url: `${ORIGIN}/clip.webm`, kind: 'video', extra: 1 },
    { url: 'x'.repeat(2049), kind: 'video' },
  ]) {
    const response = await byUrl('editor', body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await byUrl(null, { url: `${ORIGIN}/clip.webm`, kind: 'video' })).status, 401);
  // Author: no plugin access. Reviewer: plugin access without Media Library upload.
  for (const who of ['author', 'reviewer']) {
    const response = await byUrl(who, { url: `${ORIGIN}/clip.webm`, kind: 'video' });
    assert.equal(response.status, 403, who);
  }
});

test('code file names are cleaned on save and rendered in the Content API output', async () => {
  const token = await tokenFor('admin');
  const body = {
    time: Date.now(),
    version: '2.31.0',
    blocks: [
      {
        id: 'code1',
        type: 'codeFlask',
        data: { code: 'const a = 1;', language: 'javascript', filename: ' src/‮app\u0000.js\n<b>x</b> ' },
      },
      { id: 'code2', type: 'codeFlask', data: { code: 'plain', language: 'plaintext' } },
      { id: 'code3', type: 'code', data: { code: 'raw', filename: 'dropped.txt' } },
    ],
  };
  const created = await createArticle(token, { title: `Code names ${Date.now()}`, body });
  const read = await call(
    'GET',
    `/content-manager/collection-types/api::article.article/${created.documentId}`,
    { token }
  );
  const blocks = read.body.data.body.blocks;
  assert.equal(blocks[0].data.filename, 'src/app.js <b>x</b>');
  assert.equal('filename' in blocks[1].data, false);
  assert.equal('filename' in blocks[2].data, false);

  const keyResponse = await call('POST', '/admin/api-tokens', {
    token,
    body: {
      name: `mex-authoring-${Date.now()}`,
      type: 'read-only',
      lifespan: null,
      description: 'integration',
    },
  });
  assert.equal(keyResponse.status, 201);
  const key = keyResponse.body.data.accessKey;
  const html = await call('GET', `/api/articles/${created.documentId}?status=draft&mex=html`, { token: key });
  assert.equal(html.status, 200, JSON.stringify(html.body).slice(0, 200));
  assert.match(
    html.body.data.body,
    /<figure class="mex-code-figure"><figcaption class="mex-code-filename">src\/app\.js &lt;b&gt;x&lt;\/b&gt;<\/figcaption><pre class="mex-code" data-language="javascript"><code class="language-javascript">const a = 1;<\/code><\/pre><\/figure>/
  );
  assert.match(
    html.body.data.body,
    /\n<pre class="mex-code" data-language="plaintext"><code class="language-plaintext">plain<\/code><\/pre>/
  );
  const markdown = await call('GET', `/api/articles/${created.documentId}?status=draft&mex=markdown`, {
    token: key,
  });
  assert.match(markdown.body.data.body, /```javascript title="src\/app\.js <b>x<\/b>"\nconst a = 1;\n```/);
  const text = await call('GET', `/api/articles/${created.documentId}?status=draft&mex=text`, { token: key });
  assert.match(text.body.data.body, /src\/app\.js <b>x<\/b>\nconst a = 1;/);
});

test('a pasted video block with Media Library files from the URL route is stored and rendered', async () => {
  const token = await tokenFor('editor');
  const video = (await byUrl('editor', { url: `${ORIGIN}/clip.webm`, kind: 'video' })).body.file;
  const track = (await byUrl('editor', { url: `${ORIGIN}/en.vtt`, kind: 'track' })).body.file;
  const created = await createArticle(token, {
    title: `Pasted media ${Date.now()}`,
    body: {
      time: Date.now(),
      version: '2.31.0',
      blocks: [
        {
          id: 'vid1',
          type: 'video',
          data: {
            file: video,
            title: 'Clip',
            caption: '',
            loop: true,
            muted: true,
            tracks: [{ file: track, kind: 'captions', srclang: 'en', label: 'English', default: true }],
          },
        },
      ],
    },
  });
  const read = await call(
    'GET',
    `/content-manager/collection-types/api::article.article/${created.documentId}`,
    {
      token,
    }
  );
  const data = read.body.data.body.blocks[0].data;
  assert.equal(data.file.url, video.url);
  assert.equal(data.file.mime, 'video/webm');
  assert.equal(data.tracks.length, 1);
  assert.equal(data.tracks[0].file.url, track.url);
  assert.equal(data._mex, 1);
});

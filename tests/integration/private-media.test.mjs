/**
 * Private upload providers (2.5): Media Library files in Magic Editor X
 * values are stored with their file id and the unsigned URL and signed on
 * every Content API read (with and without `?mex=`, GraphQL fields; the
 * Content Manager edit view keeps the stored URLs), the admin route `POST /media/signed-urls` signs only what
 * the caller may see, and the file id migration is idempotent with a dry run.
 *
 * The suite adapts to the host's upload provider (`GET /config` ->
 * `uploads.privateFiles`):
 * - public provider (the default local provider): nothing is signed, values
 *   come back as stored and the route answers `{ private: false }`;
 * - private provider (the 2.5 acceptance host with `MEX_UPLOAD=private`):
 *   also needs `MEX_DB` (SQLite file or PostgreSQL URL) to read raw storage
 *   and `MEX_HOST_DIR` (with the host's environment) to run the CLI.
 * Synthetic data only.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { call, tokenFor, createArticle, makePng } from './helpers.mjs';

const RUN = Date.now().toString(36);
const ARTICLE = 'api::article.article';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const state = { tokens: {}, files: {} };
const SIGNED = /[?&;](?:sig|X-Amz-Signature|signature)=/i; // `;`: `&amp;sig=` in HTML

/**
 * Raw database read (private-provider runs only).
 * @param {string} sql - Query returning one text column.
 * @returns {string} Output.
 */
const rawQuery = (sql) => {
  const target = process.env.MEX_DB;
  assert.ok(target, 'MEX_DB (SQLite file or PostgreSQL URL) is required with a private upload provider');
  if (target.startsWith('postgres'))
    return execFileSync(process.env.MEX_PSQL || 'psql', [target, '-tAc', sql], { encoding: 'utf8' }).trim();
  return execFileSync('sqlite3', [target, sql], { encoding: 'utf8' }).trim();
};

/**
 * Raw write (private-provider runs only): builds legacy rows for the migration test.
 * @param {string} sql - Statement.
 */
const rawWrite = (sql) => {
  const target = process.env.MEX_DB;
  if (target.startsWith('postgres'))
    execFileSync(process.env.MEX_PSQL || 'psql', [target, '-qc', sql], { encoding: 'utf8' });
  else execFileSync('sqlite3', [target, sql], { encoding: 'utf8' });
};

/**
 * Runs `magic-editor-x media-file-ids` in the host (private-provider runs only).
 * @param {string[]} args - Extra arguments.
 * @returns {object} JSON report.
 */
const cli = (args) => {
  const dir = process.env.MEX_HOST_DIR;
  assert.ok(dir, 'MEX_HOST_DIR is required with a private upload provider');
  const out = execFileSync(
    process.execPath,
    [
      path.join(dir, 'node_modules/magic-editor-x/bin/magic-editor-x.mjs'),
      'media-file-ids',
      '--json',
      ...args,
    ],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000 }
  );
  return JSON.parse(out);
};

const uploadImage = async (token, size) => {
  const form = new FormData();
  form.append('image', new Blob([makePng(size)], { type: 'image/png' }), `private-${RUN}-${size}.png`);
  const response = await call('POST', '/magic-editor-x/image/byFile', { token, body: form });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  return response.body.file;
};

const uploadText = async (token) => {
  const form = new FormData();
  form.append('file', new Blob([`Synthetic notes ${RUN}\n`], { type: 'text/plain' }), `notes-${RUN}.txt`);
  const response = await call('POST', '/magic-editor-x/file/upload', { token, body: form });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  return response.body.file;
};

const apiToken = async () => {
  const response = await call('POST', '/admin/api-tokens', {
    token: state.tokens.admin,
    body: { name: `private-media-${RUN}`, type: 'full-access', lifespan: null, permissions: [] },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  return response.body.data.accessKey;
};

const urlsOf = (value) =>
  value.blocks.flatMap((block) => {
    if (block.type === 'image' || block.type === 'attaches') return [block.data.file.url];
    if (block.type === 'gallery') return block.data.images.map((item) => item.file.url);
    return [];
  });

const sign = (who, body) =>
  call('POST', '/magic-editor-x/media/signed-urls', { token: state.tokens[who], body });

before(async () => {
  for (const who of ['admin', 'editor', 'reviewer', 'outsider', 'author'])
    state.tokens[who] = await tokenFor(who);
  const config = await call('GET', '/magic-editor-x/config', { token: state.tokens.admin });
  assert.equal(config.status, 200);
  state.private = config.body.data.uploads.privateFiles === true;
  state.api = await apiToken();
  state.files.a = await uploadImage(state.tokens.admin, 300);
  state.files.b = await uploadImage(state.tokens.admin, 64);
  state.files.c = await uploadImage(state.tokens.admin, 32);
  state.files.text = await uploadText(state.tokens.admin);
  const strip = (file) => ({ ...file, url: file.url });
  state.body = doc([
    { id: `pm-h-${RUN}`, type: 'header', data: { text: 'Private media', level: 2 } },
    {
      id: `pm-i-${RUN}`,
      type: 'image',
      data: {
        file: { ...strip(state.files.a), alt: 'Synthetic' },
        caption: '',
        withBorder: false,
        withBackground: false,
        stretched: false,
      },
    },
    {
      id: `pm-g-${RUN}`,
      type: 'gallery',
      data: {
        images: [{ file: { ...strip(state.files.b), alt: 'One' }, caption: '' }],
        layout: 'grid',
        columns: 2,
        caption: '',
      },
    },
    { id: `pm-f-${RUN}`, type: 'attaches', data: { file: strip(state.files.text), title: 'Notes' } },
  ]);
  const created = await createArticle(
    state.tokens.admin,
    { title: `Private media ${RUN}`, slug: `private-media-${RUN}`, body: state.body },
    'en'
  );
  state.documentId = created.documentId;
  state.target = { uid: ARTICLE, documentId: created.documentId, locale: 'en', field: 'body' };
});

test('uploads answer with the file id (also attachments, 2.5) and, when private, a signed URL', () => {
  for (const file of [state.files.a, state.files.text]) {
    assert.ok(Number.isInteger(file.id), 'file id');
    assert.equal(typeof file.documentId, 'string');
    assert.equal(SIGNED.test(file.url), state.private, file.url.split('?')[0]);
  }
});

test('stored values hold the file ids and never a signature', { skip: false }, () => {
  if (!state.private) {
    assert.equal(state.private, false);
    return;
  }
  const raw = rawQuery(
    `select body from articles where document_id = '${state.documentId}' and published_at is null and locale = 'en'`
  );
  assert.ok(raw.length > 0, 'draft row');
  assert.ok(!SIGNED.test(raw), 'no signature stored');
  assert.ok(!raw.includes('isUrlSigned'), 'no signing flag stored');
  const stored = JSON.parse(raw);
  const attaches = stored.blocks.find((block) => block.type === 'attaches');
  assert.equal(attaches.data.file.id, state.files.text.id, 'attachment file id');
  const image = stored.blocks.find((block) => block.type === 'image');
  assert.equal(image.data.file.id, state.files.a.id);
  assert.equal(image.data.file.url, state.files.a.url.split('?')[0]);
});

test('every read path signs private files (and leaves public ones as stored)', async () => {
  const check = (urls, where) => {
    assert.ok(urls.length >= 3, `${where}: urls`);
    for (const url of urls) assert.equal(SIGNED.test(url), state.private, `${where}: ${url.split('?')[0]}`);
  };
  const auth = { token: state.api };
  const plain = await call('GET', `/api/articles/${state.documentId}?status=draft`, auth);
  assert.equal(plain.status, 200);
  check(urlsOf(plain.body.data.body), 'REST');
  const json = await call('GET', `/api/articles/${state.documentId}?status=draft&mex=json`, auth);
  check(urlsOf(json.body.data.body), 'REST mex=json');
  const html = await call('GET', `/api/articles/${state.documentId}?status=draft&mex=html`, auth);
  assert.equal(typeof html.body.data.body, 'string');
  assert.equal(SIGNED.test(html.body.data.body), state.private, 'REST mex=html');
  const graphql = await call('POST', '/graphql', {
    token: state.api,
    body: {
      query: `query ($id: ID!) { article(documentId: $id, status: DRAFT) { bodyRendered(format: HTML) bodyResolved } }`,
      variables: { id: state.documentId },
    },
  });
  assert.equal(graphql.status, 200, JSON.stringify(graphql.body).slice(0, 300));
  assert.equal(graphql.body.errors, undefined, JSON.stringify(graphql.body.errors));
  check(urlsOf(graphql.body.data.article.bodyResolved), 'GraphQL resolved');
  assert.equal(SIGNED.test(graphql.body.data.article.bodyRendered), state.private, 'GraphQL rendered');
  const admin = await call(
    'GET',
    `/content-manager/collection-types/${ARTICLE}/${state.documentId}?locale=en`,
    {
      token: state.tokens.admin,
    }
  );
  assert.equal(admin.status, 200);
  // The edit view keeps the stored (unsigned) URLs; the editor signs what it shows.
  for (const url of urlsOf(admin.body.data.body))
    assert.ok(!SIGNED.test(url), `Content Manager: ${url.split('?')[0]}`);
  if (!state.private) {
    // Public providers: the value comes back exactly as the Content Manager stored it.
    assert.deepEqual(plain.body.data.body, admin.body.data.body);
    assert.deepEqual(urlsOf(plain.body.data.body), [
      state.files.a.url,
      state.files.b.url,
      state.files.text.url,
    ]);
  }
});

test('POST /media/signed-urls: bounded strict body, plugin access, Content Manager access', async () => {
  const urls = [state.files.a.url.split('?')[0]];
  assert.equal((await sign('admin', { urls: [] })).status, 400);
  assert.equal((await sign('admin', { urls: ['javascript:alert(1)'] })).status, 400);
  assert.equal((await sign('admin', { urls, extra: true })).status, 400);
  assert.equal(
    (await sign('admin', { urls: Array.from({ length: 101 }, (_, i) => `/u/${i}.png`) })).status,
    400
  );
  assert.equal((await sign('author', { urls })).status, 403, 'needs plugin::magic-editor-x.access');
  const outsider = await sign('outsider', { urls, target: state.target });
  assert.equal(outsider.status, 404, 'no Content Manager read on articles');
  const admin = await sign('admin', { urls });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.private, state.private);
  if (!state.private) {
    assert.deepEqual(admin.body.data.urls, {});
    return;
  }
  assert.ok(SIGNED.test(admin.body.data.urls[urls[0]]), 'Media Library readers get any file');
  // A format (thumbnail) URL of the same file.
  const thumbnail = state.files.a.formats && state.files.a.formats.thumbnail;
  if (thumbnail) {
    const base = thumbnail.url.split('?')[0];
    const formats = await sign('admin', { urls: [base] });
    assert.ok(SIGNED.test(formats.body.data.urls[base]), 'format URL');
  }
});

test('without Media Library read, only files of the field itself are signed', async () => {
  const own = state.files.b.url.split('?')[0];
  const other = state.files.c.url.split('?')[0];
  const withTarget = await sign('reviewer', { urls: [own, other], target: state.target });
  assert.equal(withTarget.status, 200, JSON.stringify(withTarget.body).slice(0, 300));
  const withoutTarget = await sign('reviewer', { urls: [own] });
  assert.equal(withoutTarget.status, 200);
  assert.deepEqual(withoutTarget.body.data.urls, {});
  if (!state.private) {
    assert.deepEqual(withTarget.body.data.urls, {});
    return;
  }
  assert.ok(SIGNED.test(withTarget.body.data.urls[own] || ''), 'file of the field');
  assert.equal(withTarget.body.data.urls[other], undefined, 'file the field does not use');
});

test('version snapshots are stored without signatures', async () => {
  const response = await call('POST', '/magic-editor-x/history', {
    token: state.tokens.admin,
    body: { ...state.target, content: state.body, label: `pm-${RUN}` },
  });
  assert.ok([200, 201].includes(response.status), JSON.stringify(response.body).slice(0, 300));
  if (!state.private) return;
  const raw = rawQuery(
    `select json_content from magic_editor_doc_snapshots where entry_id = '${state.documentId}' order by id desc limit 1`
  );
  assert.ok(raw.includes(state.files.a.url.split('?')[0]), 'snapshot content');
  assert.ok(!SIGNED.test(raw), 'snapshot without signature');
});

test('file id migration: dry run, apply, idempotent re-run (private provider)', () => {
  if (!state.private) return;
  const where = `document_id = '${state.documentId}' and locale = 'en'`;
  const raw = rawQuery(`select body from articles where ${where} and published_at is null`);
  const legacy = JSON.parse(raw);
  // Pre-2.5 shapes: no file ids and a stored (expired) signature.
  for (const block of legacy.blocks) {
    const files =
      block.type === 'gallery'
        ? block.data.images.map((item) => item.file)
        : block.data.file
          ? [block.data.file]
          : [];
    for (const file of files) {
      delete file.id;
      delete file.documentId;
      file.url = `${file.url}?exp=1&sig=stale`;
    }
  }
  const literal = JSON.stringify(legacy).replace(/'/g, "''");
  rawWrite(`update articles set body = '${literal}' where ${where} and published_at is null`);
  const dry = cli([]);
  assert.equal(dry.dryRun, true);
  assert.ok(dry.changedValues >= 1, JSON.stringify(dry));
  assert.ok(dry.linked >= 3 && dry.unsigned >= 3, JSON.stringify(dry));
  assert.ok(
    SIGNED.test(rawQuery(`select body from articles where ${where} and published_at is null`)),
    'dry run writes nothing'
  );
  const applied = cli(['--apply']);
  assert.equal(applied.dryRun, false);
  assert.equal(applied.failed, 0);
  assert.ok(applied.changedValues >= 1, JSON.stringify(applied));
  const fixed = rawQuery(`select body from articles where ${where} and published_at is null`);
  assert.ok(!SIGNED.test(fixed), 'signatures removed');
  const value = JSON.parse(fixed);
  assert.equal(value.blocks.find((block) => block.type === 'image').data.file.id, state.files.a.id);
  assert.equal(value.blocks.find((block) => block.type === 'attaches').data.file.id, state.files.text.id);
  const again = cli(['--apply']);
  assert.equal(again.changedValues, 0, 'idempotent');
  assert.equal(again.failed, 0);
});

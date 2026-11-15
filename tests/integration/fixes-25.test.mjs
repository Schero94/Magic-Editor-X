import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { call, tokenFor, createArticle } from './helpers.mjs';

/**
 * 2.5 fixes against a real host (SQLite and PostgreSQL):
 *
 * - "Discard changes" of an entry whose published version predates 2.4 keeps
 *   the field keys of the draft entries, so versions and comments stay with
 *   them. Host requirement: start it with `MEX_PRE24_TITLES=true`; it then
 *   stores articles whose title starts with `[pre-2.4]` the way 2.3 did
 *   (values without `fieldKey`, see CONTRIBUTING.md).
 * - An emptied entry (all blocks deleted, saved) keeps its key: the value is
 *   stored as null, the key is remembered and comes back with new content.
 * - Synced source versions ignore default tune values.
 * - Mention e-mails in the recipient's admin language. Runs when the host
 *   sends mention e-mails (`MEX_MAIL_EXPECTED=on`, host started with
 *   `comments.notifications.email: true`) to the fake SMTP server this file
 *   starts on 127.0.0.1:`MEX_FIXES_SMTP_PORT` (default 2583).
 *
 * Host fields: `sections` (repeatable `blocks.text-section` with `heading` and
 * `body`), `zone` (dynamic zone with `blocks.quote-card` (`caption`, `body`)).
 */

const UID = 'api::article.article';
const CM = `/content-manager/collection-types/${UID}`;
const RUN = randomBytes(4).toString('hex');
const KEY = /^[A-Za-z0-9_-]{16,32}$/;
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const json = (value) => JSON.stringify(value).slice(0, 300);
const qs = (params) => new URLSearchParams(params).toString();

const readDraft = async (token, documentId, status) => {
  const response = await call(
    'GET',
    `${CM}/${documentId}?${qs({ locale: 'en', ...(status ? { status } : {}) })}`,
    {
      token,
    }
  );
  assert.equal(response.status, 200, json(response.body));
  return response.body.data;
};
const saveDraft = async (token, documentId, data) => {
  const response = await call('PUT', `${CM}/${documentId}?locale=en`, { token, body: data });
  assert.equal(response.status, 200, json(response.body));
  return response.body.data;
};
const target = (documentId, field, fieldKey) => ({
  uid: UID,
  documentId,
  locale: 'en',
  field,
  ...(fieldKey ? { fieldKey } : {}),
});
const history = (token, t) => call('GET', `/magic-editor-x/history?${qs(t)}`, { token });
const comments = (token, t) => call('GET', `/magic-editor-x/comments?${qs(t)}`, { token });
const section = ({ id, heading, body }) => ({ id, heading, body });

test('discarding a draft whose published version predates 2.4 keeps the field keys', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  // Written and published "by 2.3": no keys anywhere (the host strips them for [pre-2.4] titles).
  const entry = await createArticle(admin, {
    title: `[pre-2.4] Discard ${RUN}`,
    sections: [
      { heading: 'A', body: doc([p('d24a000001', 'Alpha one'), p('d24a000002', 'Alpha two')]) },
      { heading: 'B', body: doc([p('d24b000001', 'Beta one')]) },
    ],
    zone: [{ __component: 'blocks.quote-card', caption: 'Q', body: doc([p('d24q000001', 'Quote')]) }],
  });
  const id = entry.documentId;
  const stored = await readDraft(admin, id);
  assert.ok(
    stored.sections.every((item) => !item.body.fieldKey),
    'the host must be started with MEX_PRE24_TITLES=true (values stored as 2.3 stored them)'
  );
  const published = await call('POST', `${CM}/${id}/actions/publish?locale=en`, { token: admin, body: {} });
  assert.equal(published.status, 200, json(published.body));
  // 2.5 at work: the editor reorders and edits the draft; the values get keys.
  const draft = await readDraft(editor, id);
  const edited = await saveDraft(editor, id, {
    title: `Discard ${RUN}`,
    sections: [
      section({
        ...draft.sections[1],
        body: doc([p('d24b000001', 'Beta one'), p('d24b000009', 'New beta')]),
      }),
      section(draft.sections[0]),
    ],
    zone: draft.zone.map(({ id: rowId, __component, caption, body }) => ({
      id: rowId,
      __component,
      caption,
      body,
    })),
  });
  const keyB = edited.sections[0].body.fieldKey;
  const keyA = edited.sections[1].body.fieldKey;
  const keyQ = edited.zone[0].body.fieldKey;
  assert.match(keyA, KEY);
  assert.match(keyB, KEY);
  assert.match(keyQ, KEY);
  // History and comments under the keys.
  const version = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target(id, 'sections.0.body', keyB), content: edited.sections[0].body, label: `B ${RUN}` },
  });
  assert.equal(version.status, 201, json(version.body));
  const thread = await call('POST', '/magic-editor-x/comments', {
    token: editor,
    body: { ...target(id, 'sections.1.body', keyA), blockId: 'd24a000001', body: `About alpha ${RUN}` },
  });
  assert.equal(thread.status, 201, json(thread.body));

  const discarded = await call('POST', `${CM}/${id}/actions/discard?locale=en`, { token: admin, body: {} });
  assert.equal(discarded.status, 200, json(discarded.body));
  const restored = await readDraft(admin, id);
  assert.equal(restored.title, `[pre-2.4] Discard ${RUN}`, 'the draft is the published version again');
  assert.notEqual(restored.sections[0].id, edited.sections[1].id, 'Strapi 5.61 creates new component rows');
  // Published order: A, B. Keys follow the entries (block ids), not the positions.
  assert.equal(restored.sections[0].body.fieldKey, keyA);
  assert.equal(restored.sections[1].body.fieldKey, keyB);
  assert.equal(restored.zone[0].body.fieldKey, keyQ);
  assert.deepEqual(
    restored.sections[1].body.blocks.map((block) => block.id),
    ['d24b000001'],
    'content is the published one'
  );
  const live = await readDraft(admin, id, 'published');
  assert.ok(
    live.sections.every((item) => !item.body.fieldKey),
    'the published version is not touched'
  );
  // Versions and comments are still attached, by position and by key.
  const b = await history(editor, target(id, 'sections.1.body'));
  assert.equal(b.status, 200);
  assert.equal(b.body.meta.fieldKey, keyB);
  assert.ok(b.body.data.some((item) => item.label === `B ${RUN}`));
  const a = await comments(editor, target(id, 'sections.0.body', keyA));
  assert.equal(a.status, 200);
  assert.ok(json(a.body.data).includes(`About alpha ${RUN}`));
  // A second discard (draft already equal) changes nothing.
  const again = await call('POST', `${CM}/${id}/actions/discard?locale=en`, { token: admin, body: {} });
  assert.equal(again.status, 200);
  const twice = await readDraft(admin, id);
  assert.deepEqual(
    twice.sections.map((item) => item.body.fieldKey),
    [keyA, keyB]
  );
});

test('an emptied entry keeps its key: stored null, remembered, back with new content', async () => {
  const editor = await tokenFor('editor');
  const entry = await createArticle(editor, {
    title: `Emptied ${RUN}`,
    sections: [
      { heading: 'A', body: doc([p('e25a000001', 'Will be deleted')]) },
      { heading: 'B', body: doc([p('e25b000001', 'Stays')]) },
    ],
  });
  const id = entry.documentId;
  const first = await readDraft(editor, id);
  const keyA = first.sections[0].body.fieldKey;
  const keyB = first.sections[1].body.fieldKey;
  assert.match(keyA, KEY);
  const version = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target(id, 'sections.0.body', keyA), content: first.sections[0].body, label: `Before ${RUN}` },
  });
  assert.equal(version.status, 201, json(version.body));
  // All blocks deleted and saved: the admin sends null.
  const emptied = await saveDraft(editor, id, {
    sections: [section({ ...first.sections[0], body: null }), section(first.sections[1])],
  });
  assert.equal(emptied.sections[0].body, null, 'empty stays null (required checks, renderers, API output)');
  const stored = await readDraft(editor, id);
  assert.equal(stored.sections[0].body, null);
  // While empty, the entry still has its versions (history found by position).
  const whileEmpty = await history(editor, target(id, 'sections.0.body'));
  assert.equal(whileEmpty.status, 200, json(whileEmpty.body));
  assert.equal(whileEmpty.body.meta.fieldKey, keyA);
  assert.ok(whileEmpty.body.data.some((item) => item.label === `Before ${RUN}`));
  assert.equal((await history(editor, target(id, 'sections.0.body', keyA))).status, 200);
  // Saving again while empty keeps everything.
  await saveDraft(editor, id, { sections: [section(stored.sections[0]), section(stored.sections[1])] });
  // New content with a key the admin generated for the empty field: the remembered key wins.
  const refilled = await saveDraft(editor, id, {
    sections: [
      section({
        ...stored.sections[0],
        body: { ...doc([p('e25a000009', 'New text')]), fieldKey: 'Fresh0Key0From0Admin0x' },
      }),
      section(stored.sections[1]),
    ],
  });
  assert.equal(refilled.sections[0].body.fieldKey, keyA);
  assert.equal(refilled.sections[1].body.fieldKey, keyB);
  // Once back, the memory is gone: emptying and refilling without a key also keeps it.
  const again = await saveDraft(editor, id, {
    sections: [section({ ...refilled.sections[0], body: null }), section(refilled.sections[1])],
  });
  const back = await saveDraft(editor, id, {
    sections: [
      section({ ...again.sections[0], body: doc([p('e25a000010', 'Third')]) }),
      section(again.sections[1]),
    ],
  });
  assert.equal(back.sections[0].body.fieldKey, keyA);
  // Publishing works as before (the value is an ordinary non-empty value again).
  const published = await call('POST', `${CM}/${id}/actions/publish?locale=en`, {
    token: await tokenFor('admin'),
    body: {},
  });
  assert.equal(published.status, 200, json(published.body));
});

test('synced source versions ignore default tune values', async () => {
  const admin = await tokenFor('admin');
  const tuned = (text, tunes) => ({
    name: `Synced tunes ${RUN}`,
    description: 'Fixes',
    kind: 'synced',
    blocks: doc([{ ...p('st25000001', text), ...(tunes ? { tunes } : {}) }]),
    scope: { all: true },
  });
  const created = await call('POST', '/magic-editor-x/templates', { token: admin, body: tuned('Footer') });
  assert.equal(created.status, 201, json(created.body));
  const sourceId = created.body.data.id;
  const defaults = { alignmentTune: { alignment: 'left' }, indentTune: { indentLevel: 0 } };
  // Saved from the editor without a change: Editor.js writes the default tunes.
  const saved = await call('PUT', `/magic-editor-x/templates/${sourceId}`, {
    token: admin,
    body: tuned('Footer', defaults),
  });
  assert.equal(saved.status, 200, json(saved.body));
  let list = await call('GET', `/magic-editor-x/templates/${sourceId}/versions`, { token: admin });
  assert.equal(list.body.data.length, 1, 'no version for default tunes');
  await call('PUT', `/magic-editor-x/templates/${sourceId}`, {
    token: admin,
    body: tuned('Footer', { alignmentTune: { alignment: 'center' } }),
  });
  list = await call('GET', `/magic-editor-x/templates/${sourceId}/versions`, { token: admin });
  assert.equal(list.body.data.length, 2, 'a real tune change is a version');
  await call('DELETE', `/magic-editor-x/templates/${sourceId}`, { token: admin });
});

/* ------------------------------------------------ mention e-mail language */

const SMTP_PORT = Number(process.env.MEX_FIXES_SMTP_PORT || 2583);

/** Minimal fake SMTP server on 127.0.0.1 (no TLS, no AUTH); collects raw messages. */
const startSmtp = () =>
  new Promise((resolve, reject) => {
    const mails = [];
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let buffer = '';
      let inData = false;
      const send = (line) => socket.write(`${line}\r\n`);
      send('220 fake-smtp.example.test ESMTP');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          if (inData) {
            const end = buffer.indexOf('\r\n.\r\n');
            if (end === -1) return;
            mails.push(buffer.slice(0, end));
            buffer = buffer.slice(end + 5);
            inData = false;
            send('250 OK');
            continue;
          }
          const eol = buffer.indexOf('\r\n');
          if (eol === -1) return;
          const verb = buffer.slice(0, 4).toUpperCase();
          buffer = buffer.slice(eol + 2);
          if (verb === 'EHLO' || verb === 'HELO')
            socket.write('250-fake-smtp.example.test\r\n250 SMTPUTF8\r\n');
          else if (verb === 'DATA') {
            inData = true;
            send('354 End data with <CR><LF>.<CR><LF>');
          } else if (verb === 'QUIT') {
            send('221 Bye');
            socket.end();
          } else send('250 OK');
        }
      });
      socket.on('error', () => {});
    });
    server.on('error', reject);
    server.listen(SMTP_PORT, '127.0.0.1', () =>
      resolve({
        mails,
        // The host's mail transport may keep its connection open: end it, or the test run never exits.
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      })
    );
  });

/** Decodes RFC 2047 encoded words (UTF-8, B or Q) in a header value. */
const decodeWords = (value) =>
  value.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_, kind, text) =>
    kind.toLowerCase() === 'b'
      ? Buffer.from(text, 'base64').toString('utf8')
      : Buffer.from(
          text
            .replace(/_/g, ' ')
            .replace(/=([0-9A-F]{2})/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16))),
          'latin1'
        ).toString('utf8')
  );
const subjectOf = (raw) => {
  const match = raw.match(/^Subject: (.*(?:\r\n[ \t].*)*)/m);
  return match ? decodeWords(match[1].replace(/\r\n[ \t]/g, ' ')).trim() : null;
};

test(
  'mention e-mails use the recipient admin language',
  { skip: process.env.MEX_MAIL_EXPECTED !== 'on' && 'host without mention e-mails (MEX_MAIL_EXPECTED=on)' },
  async () => {
    const smtp = await startSmtp();
    const editor = await tokenFor('editor');
    const reviewer = await tokenFor('reviewer');
    const setLanguage = async (language) => {
      const response = await call('PUT', '/admin/users/me', {
        token: reviewer,
        body: { preferedLanguage: language },
      });
      assert.equal(response.status, 200, json(response.body));
    };
    try {
      const entry = await createArticle(editor, {
        title: `Mail <b>${RUN}</b>`,
        body: doc([p('ml25000001', 'Text')]),
      });
      const t = target(entry.documentId, 'body');
      const people = await call('GET', `/magic-editor-x/comments/mentionable?${qs({ ...t, q: 'cora' })}`, {
        token: editor,
      });
      const cora = people.body.data[0];
      assert.ok(cora, 'the reviewer can be mentioned');
      const expectations = [
        ['de', 'Anna Beispiel hat Sie in einem Kommentar erwähnt', /Kommentar/],
        ['fr', 'Anna Beispiel vous a mentionné dans un commentaire', /commentaire/],
        ['es', 'Anna Beispiel le ha mencionado en un comentario', /comentario/],
        ['pt-BR', 'Anna Beispiel mencionou você em um comentário', /coment/],
        ['zh-Hans', 'Anna Beispiel mentioned you in a comment', /Open the comment/],
        [null, 'Anna Beispiel mentioned you in a comment', /Open the comment/],
      ];
      for (const [language, subject, body] of expectations) {
        await setLanguage(language);
        const before = smtp.mails.length;
        const secret = `Secret ${language} ${RUN}`;
        const created = await call('POST', '/magic-editor-x/comments', {
          token: editor,
          body: { ...t, blockId: 'ml25000001', body: `${secret} @Cora Prüfer`, mentions: [cora.id] },
        });
        assert.equal(created.status, 201, json(created.body));
        for (let attempt = 0; attempt < 40 && smtp.mails.length === before; attempt += 1)
          await new Promise((resolve) => setTimeout(resolve, 250));
        assert.equal(smtp.mails.length, before + 1, `one mail for ${language}`);
        const raw = smtp.mails[before];
        assert.equal(subjectOf(raw), subject, String(language));
        const flat = raw.replace(/=\r\n/g, '');
        assert.ok(!flat.includes(secret), 'no comment text');
        assert.match(flat, body);
        // The HTML part escapes the title (an admin-controlled value).
        const html = flat.slice(flat.search(/Content-Type: text\/html/i));
        assert.ok(html.includes(`&lt;b&gt;${RUN}&lt;/b&gt;`), 'title escaped in the HTML part');
        assert.ok(!html.includes(`<b>${RUN}`));
      }
    } finally {
      await setLanguage(null).catch(() => {});
      smtp.close();
    }
  }
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sessionIdOf, createSessionCheck } = require('../server/src/utils/admin-session.js');

/**
 * 2.6: collaboration sockets end with their admin session. A fake Strapi with
 * the session manager API of 5.62 (`sessionManager('admin').isSessionActive`,
 * `validateAccessToken`) and `admin::session` rows; synthetic ids only.
 */
const fakeStrapi = (rows, { expired = new Set(), fail = false, noManager = false } = {}) => {
  const queries = [];
  const strapi = {
    db: {
      query: (uid) => {
        assert.equal(uid, 'admin::session');
        return {
          findOne: async ({ where }) => {
            if (fail) throw new Error('db down');
            queries.push(where.sessionId);
            return rows.find((row) => row.sessionId === where.sessionId) || null;
          },
        };
      },
    },
    sessionManager: noManager
      ? undefined
      : (origin) => {
          assert.equal(origin, 'admin');
          return {
            isSessionActive: async (id) => rows.some((row) => row.sessionId === id) && !expired.has(id),
            validateAccessToken: (token) =>
              token === 'good-access-token'
                ? { isValid: true, payload: { sessionId: 'a1b2c3d4e5f60718', userId: '1' } }
                : { isValid: false },
          };
        },
  };
  return { strapi, queries };
};

const S1 = 'aaaaaaaaaaaaaaaa';
const S2 = 'bbbbbbbbbbbbbbbb';
const S3 = 'cccccccccccccccc';

test('session check: an active session is active, a missing or expired one has ended', async () => {
  const { strapi } = fakeStrapi([{ sessionId: S1, status: 'active' }], { expired: new Set([S2]) });
  const check = createSessionCheck(strapi);
  assert.equal(await check(S1), true);
  assert.equal(await check(S3), false, 'deleted (logout, revoked)');
  const expired = fakeStrapi([{ sessionId: S2, status: 'active' }], { expired: new Set([S2]) });
  assert.equal(await createSessionCheck(expired.strapi)(S2), false, 'expired');
});

test('session check follows token rotation to the newest session of the family', async () => {
  // Strapi marks the parent `rotated` and keeps it; isSessionActive alone would call it active.
  const rows = [
    { sessionId: S1, status: 'rotated', childId: S2 },
    { sessionId: S2, status: 'rotated', childId: S3 },
    { sessionId: S3, status: 'active' },
  ];
  const { strapi, queries } = fakeStrapi(rows);
  assert.equal(await createSessionCheck(strapi)(S1), true);
  assert.deepEqual(queries, [S1, S2, S3]);
  // The newest session was revoked: the old socket's session has ended too.
  const revoked = fakeStrapi(rows.slice(0, 2));
  assert.equal(await createSessionCheck(revoked.strapi)(S1), false);
});

test('session check: unknown (null) without a session manager, without an id or when the database fails', async () => {
  assert.equal(await createSessionCheck(fakeStrapi([], { noManager: true }).strapi)(S1), null);
  assert.equal(await createSessionCheck(fakeStrapi([]).strapi)(undefined), null);
  assert.equal(await createSessionCheck(fakeStrapi([]).strapi)('bad id with spaces'), null);
  assert.equal(await createSessionCheck(fakeStrapi([], { fail: true }).strapi)(S1), null);
});

test('session id of a request: from ctx.state.session (5.62) or the access token, else null', () => {
  const { strapi } = fakeStrapi([]);
  assert.equal(sessionIdOf(strapi, { state: { session: { id: S1 } } }), S1);
  assert.equal(
    sessionIdOf(strapi, { state: {}, request: { header: { authorization: 'Bearer good-access-token' } } }),
    'a1b2c3d4e5f60718'
  );
  assert.equal(
    sessionIdOf(strapi, { state: {}, request: { header: { authorization: 'Bearer other' } } }),
    null
  );
  assert.equal(sessionIdOf(strapi, { state: { session: { id: '<script>' } } }), null);
  assert.equal(sessionIdOf(fakeStrapi([], { noManager: true }).strapi, { state: {} }), null);
});

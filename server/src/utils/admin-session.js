'use strict';

/**
 * Admin session checks for live collaboration sockets (2.6).
 *
 * Strapi 5 (session manager, `strapi.sessionManager('admin')`) backs every
 * admin access token with a session row (`admin::session`). The admin auth
 * strategy refuses requests of a session that was revoked, logged out or
 * expired, but a collaboration socket authenticates once with a one-time
 * token. Without these checks an open socket kept accepting edits after its
 * admin session had ended, until the client noticed and paused.
 *
 * The session id goes into the signed collaboration token; the handshake,
 * incoming updates (at most one database check per socket every
 * `SESSION_CHECK_MS`) and the periodic re-check ask `isSessionActive`.
 *
 * Token refresh rotates sessions: Strapi creates a child session and marks
 * the parent `rotated` (with `childId`). `isSessionActive` only looks at the
 * row itself, so a rotated parent counts as active until its own expiry even
 * after the family was revoked. The check therefore follows `childId` to the
 * newest session of the family and asks about that one.
 *
 * Feature detection: on Strapi releases without a session manager, without a
 * session id or when the check itself fails (database error) the answer is
 * "unknown" (`null`), and callers keep the socket; token expiry, permission
 * re-checks and the client's own session detection still apply.
 *
 * Nothing here logs or returns a session id or a token.
 */

/** Longest rotation chain followed (a family rotates once per refresh). */
const MAX_CHAIN = 32;
/** Session ids Strapi generates are hex strings; anything else is ignored. */
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
/** Minimum time between two database checks of one socket's session on incoming updates. */
const SESSION_CHECK_MS = 5000;

/**
 * Validated session id or null.
 * @param {unknown} value - Candidate.
 * @returns {string|null} Session id.
 */
const cleanSessionId = (value) => (typeof value === 'string' && SESSION_ID.test(value) ? value : null);

/**
 * Session id of the admin request (Strapi 5.62 sets `ctx.state.session.id`;
 * older releases with a session manager carry it in the access token).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 * @param {{ state?: object, request?: { header?: object } }} ctx - Koa context.
 * @returns {string|null} Session id, or null when the host has none.
 */
const sessionIdOf = (strapi, ctx) => {
  const fromState = cleanSessionId(ctx && ctx.state && ctx.state.session && ctx.state.session.id);
  if (fromState) return fromState;
  try {
    const manager = strapi && strapi.sessionManager;
    if (typeof manager !== 'function') return null;
    const header = ctx && ctx.request && ctx.request.header && ctx.request.header.authorization;
    const parts = typeof header === 'string' ? header.split(/\s+/) : [];
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
    const result = manager('admin').validateAccessToken(parts[1]);
    return result && result.isValid ? cleanSessionId(result.payload && result.payload.sessionId) : null;
  } catch {
    return null;
  }
};

/**
 * Creates the session check: `true` (active), `false` (ended) or `null`
 * (unknown: no session manager, no id, the check failed, the chain was longer
 * than `MAX_CHAIN` or ended in a rotated row without a child).
 *
 * `isSessionActive` is only asked about a row whose status is `active`: in
 * Strapi 5.62 it deletes an expired row and answers false, and rotated
 * parents expire one idle lifespan after their rotation, so asking about one
 * would end a healthy family (and delete its row).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 * @returns {(sessionId: unknown, onLeaf?: (newest: string) => void) => Promise<boolean|null>} Check; `onLeaf`
 *   receives the newest session id of the family (callers start there next time).
 */
const createSessionCheck = (strapi) => async (sessionId, onLeaf) => {
  const id = cleanSessionId(sessionId);
  const manager = strapi && strapi.sessionManager;
  if (!id || typeof manager !== 'function') return null;
  try {
    let current = id;
    for (let step = 0; step < MAX_CHAIN; step += 1) {
      const row = await strapi.db.query('admin::session').findOne({
        where: { sessionId: current },
        select: ['sessionId', 'childId', 'status'],
      });
      if (!row) return false;
      if (row.status === 'rotated') {
        if (!cleanSessionId(row.childId)) return null;
        current = row.childId;
        continue;
      }
      // Rows of hosts without a status column count as active rows.
      if (row.status !== undefined && row.status !== null && row.status !== 'active') return null;
      if (typeof onLeaf === 'function' && current !== id) onLeaf(current);
      return (await manager('admin').isSessionActive(current)) === true;
    }
    // Longer than MAX_CHAIN: unknown (the socket stays; the newest id found so far is the next start).
    if (typeof onLeaf === 'function' && current !== id) onLeaf(current);
    return null;
  } catch {
    return null;
  }
};

module.exports = { sessionIdOf, createSessionCheck, cleanSessionId, SESSION_CHECK_MS, MAX_CHAIN };

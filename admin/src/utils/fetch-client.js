import { useMemo } from 'react';
import {
  getFetchClient as getStrapiFetchClient,
  useFetchClient as useStrapiFetchClient,
} from '@strapi/strapi/admin';
import { sessionGuard } from '../editor/session-guard.mjs';

/**
 * Strapi's admin fetch client with session-expiry detection (2.6).
 *
 * Every plugin request goes through Strapi's `getFetchClient`, which adds the
 * admin token and refreshes it once on a 401. A 401 that still reaches us
 * means the refresh was refused, so the session ended: the error is reported
 * to the tab's session guard (`editor/session-guard.mjs`) and thrown on
 * unchanged; a request sent after that which succeeds resumes the session.
 * Only the status is looked at; bodies, URLs and tokens are not
 * read or kept. No global (`window.fetch`) is patched.
 */

const METHODS = ['get', 'post', 'put', 'del'];

/**
 * Wraps a fetch client so failed requests are reported.
 * @param {Record<string, Function>} client - Strapi fetch client (`get`, `post`, `put`, `del`).
 * @returns {Record<string, Function>} Same API.
 */
export const withSessionReport = (client) => {
  const wrapped = { ...client };
  for (const method of METHODS) {
    if (typeof client[method] !== 'function') continue;
    wrapped[method] = async (...args) => {
      const startedAt = Date.now();
      try {
        const result = await client[method](...args);
        sessionGuard.reportSuccess(startedAt);
        return result;
      } catch (error) {
        sessionGuard.reportError(error);
        throw error;
      }
    };
  }
  return wrapped;
};

/**
 * `useFetchClient` of `@strapi/strapi/admin` (requests aborted on unmount) with session reports.
 * @returns {{ get: Function, post: Function, put: Function, del: Function }} Client, stable per component.
 */
export const useFetchClient = () => {
  const client = useStrapiFetchClient();
  return useMemo(() => withSessionReport(client), [client]);
};

/**
 * `getFetchClient` of `@strapi/strapi/admin` (not tied to a component) with session reports.
 * @param {object} [options] - Fetch client options.
 * @returns {{ get: Function, post: Function, put: Function, del: Function }} Client.
 */
export const getFetchClient = (options) => withSessionReport(getStrapiFetchClient(options));

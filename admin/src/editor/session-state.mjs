/**
 * Whether this browser tab still has an admin session (2.5). The entry panel
 * sends a last "leave" heartbeat when it unmounts; after a logout (voluntary
 * or an ended session) the token is gone and that request would only answer
 * 401 in the console, so it is skipped. Strapi 5.61 dispatches `admin/logout`
 * before it leaves the edit view, and `admin/login` / `admin/setToken` when a
 * session starts again.
 */

let loggedOut = false;

/** @returns {boolean} True after a logout until the next login. */
export const isLoggedOut = () => loggedOut;

/**
 * Updates the flag from an admin store action.
 * @param {{ type?: string }} action - Redux action.
 */
export const trackSessionAction = (action) => {
  if (!action || typeof action !== 'object') return;
  if (action.type === 'admin/logout') loggedOut = true;
  else if (action.type === 'admin/login' || action.type === 'admin/setToken') loggedOut = false;
};

/**
 * Redux middleware for the admin store (`app.addMiddlewares`).
 * @returns {() => (next: Function) => (action: object) => unknown} Middleware.
 */
export const createSessionMiddleware = () => () => (next) => (action) => {
  trackSessionAction(action);
  return next(action);
};

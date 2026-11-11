/**
 * Content Security Policy helpers shared by the server (which reads the
 * `strapi::security` middleware configuration) and the admin (which reacts to
 * `securitypolicyviolation` events in the editor).
 *
 * The plugin never changes the host's CSP. It only reports which directives
 * the admin would need for the embed services and external images the editor
 * shows, and prints a snippet the owner can copy into config/middlewares.js.
 *
 * Behaviour mirrored from the installed code (checked 2026-11-11):
 * - @strapi/core 5.61.1 `dist/middlewares/security.js`: the middleware config
 *   is merged with `_.defaultsDeep(config, defaults)`, so arrays are merged by
 *   index, and the defaults are `useDefaults: true` plus `CSP_DEFAULTS` from
 *   @strapi/utils (`connect-src`, `img-src`, `media-src`) and
 *   `upgradeInsecureRequests: null`.
 * - helmet 6.2 `normalizeDirectives`: directive names are dashified,
 *   `null` disables a directive, `useDefaults` adds helmet's default
 *   directives (`default-src 'self'`, `img-src 'self' data:`, ...).
 * - CSP Level 3 fallback: `frame-src` -> `child-src` -> `default-src`,
 *   `img-src`/`media-src` -> `default-src`.
 */

/**
 * Editor.js Embed services the editor enables (admin/src/editor/tools/index.js),
 * with the origin of their iframe (`embedUrl` in @editorjs/embed 2.8.0) and a
 * sample URL used for source matching.
 *
 * Not listed: `github` (gist) embeds load a `data:` iframe that inherits the
 * admin CSP and then needs a remote script, which a strict CSP should not
 * allow. Imgur's upstream `embedUrl` uses http and is blocked as mixed content
 * on an https admin whatever the CSP says.
 */
export const EMBED_FRAME_SOURCES = Object.freeze({
  youtube: { origin: 'https://www.youtube.com', sample: 'https://www.youtube.com/embed/x' },
  vimeo: { origin: 'https://player.vimeo.com', sample: 'https://player.vimeo.com/video/1' },
  twitter: {
    origin: 'https://platform.twitter.com',
    sample: 'https://platform.twitter.com/embed/Tweet.html',
  },
  instagram: { origin: 'https://www.instagram.com', sample: 'https://www.instagram.com/p/x/embed' },
  codepen: { origin: 'https://codepen.io', sample: 'https://codepen.io/x/embed/y' },
  imgur: { origin: 'https://imgur.com', sample: 'https://imgur.com/x/embed' },
  pinterest: {
    origin: 'https://assets.pinterest.com',
    sample: 'https://assets.pinterest.com/ext/embed.html',
  },
  miro: { origin: 'https://miro.com', sample: 'https://miro.com/app/live-embed/x' },
  figma: { origin: 'https://www.figma.com', sample: 'https://www.figma.com/embed' },
  facebook: { origin: 'https://www.facebook.com', sample: 'https://www.facebook.com/plugins/post.php' },
});

/** Sample URL standing for "any external image". */
const EXTERNAL_IMAGE_SAMPLE = 'https://images.example.com/picture.png';

/** Hosts in Strapi's own CSP defaults; they do not count as "external images allowed". */
const STRAPI_DEFAULT_HOSTS = new Set(['market-assets.strapi.io', 'strapi.io', 'cdn.jsdelivr.net']);

/** `CSP_DEFAULTS` of @strapi/utils 5.61 plus the security middleware's own default. */
const STRAPI_DEFAULT_DIRECTIVES = Object.freeze({
  'connect-src': ["'self'", 'https:'],
  'img-src': ["'self'", 'data:', 'blob:', 'https://market-assets.strapi.io'],
  'media-src': ["'self'", 'data:', 'blob:'],
  'upgrade-insecure-requests': null,
});

/** helmet 6 default directives (added when `useDefaults` is true). */
const HELMET_DEFAULT_DIRECTIVES = Object.freeze({
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'font-src': ["'self'", 'https:', 'data:'],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", 'https:', "'unsafe-inline'"],
  'upgrade-insecure-requests': [],
});

const FALLBACKS = Object.freeze({
  'frame-src': ['frame-src', 'child-src', 'default-src'],
  'img-src': ['img-src', 'default-src'],
  'media-src': ['media-src', 'default-src'],
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const dashify = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * Finds the `strapi::security` entry in the middleware list.
 * @param {unknown} middlewares - `strapi.config.get('middlewares')`.
 * @returns {{ found: boolean, config: object }} Entry config (`{}` for a string entry).
 */
export const findSecurityMiddleware = (middlewares) => {
  // Without a middleware list Strapi applies its defaults, which include the security middleware.
  if (!Array.isArray(middlewares)) return { found: true, config: {} };
  for (const entry of middlewares) {
    if (entry === 'strapi::security') return { found: true, config: {} };
    if (isObject(entry) && entry.name === 'strapi::security') {
      return { found: true, config: isObject(entry.config) ? entry.config : {} };
    }
  }
  return { found: false, config: {} };
};

/**
 * Merges a user value over a default the way lodash `defaultsDeep` does for
 * directive values: user arrays win index by index, other values win as a whole.
 * @param {unknown} user - User value (undefined when not set).
 * @param {unknown} fallback - Strapi default.
 * @returns {unknown} Merged value.
 */
const mergeDirective = (user, fallback) => {
  if (user === undefined) return Array.isArray(fallback) ? [...fallback] : fallback;
  if (Array.isArray(user) && Array.isArray(fallback)) {
    const merged = [...user];
    for (let index = user.length; index < fallback.length; index += 1) merged.push(fallback[index]);
    return merged;
  }
  return user;
};

/**
 * Computes the directives the admin actually receives.
 * @param {unknown} middlewares - `strapi.config.get('middlewares')`.
 * @returns {{ active: boolean, directives: Map<string, string[]> }} Effective policy; `active` is false when no CSP is enforced.
 */
export const effectiveDirectives = (middlewares) => {
  const { found, config } = findSecurityMiddleware(middlewares);
  const csp = config.contentSecurityPolicy;
  if (!found || csp === false || (isObject(csp) && csp.reportOnly === true)) {
    return { active: false, directives: new Map() };
  }
  const options = isObject(csp) ? csp : {};
  const userDirectives = {};
  if (isObject(options.directives)) {
    for (const [name, value] of Object.entries(options.directives)) {
      userDirectives[dashify(name)] = value;
    }
  }
  const names = new Set([...Object.keys(STRAPI_DEFAULT_DIRECTIVES), ...Object.keys(userDirectives)]);
  const result = new Map();
  const disabled = new Set();
  for (const name of names) {
    const value = mergeDirective(userDirectives[name], STRAPI_DEFAULT_DIRECTIVES[name]);
    if (value === null) disabled.add(name);
    else if (typeof value === 'string') result.set(name, [value]);
    else if (Array.isArray(value))
      result.set(
        name,
        value.filter((item) => typeof item === 'string')
      );
    // Other values (e.g. helmet's dangerouslyDisableDefaultSrc symbol) remove the directive.
    else disabled.add(name);
  }
  if (options.useDefaults !== false) {
    for (const [name, value] of Object.entries(HELMET_DEFAULT_DIRECTIVES)) {
      if (!result.has(name) && !disabled.has(name)) result.set(name, [...value]);
    }
  }
  return { active: true, directives: result };
};

/**
 * Returns the source list that governs a resource type, after CSP fallback.
 * @param {Map<string, string[]>} directives - Effective directives.
 * @param {'frame-src'|'img-src'|'media-src'} directive - Directive.
 * @returns {string[]|null} Source list, or null when nothing restricts it.
 */
export const governingSources = (directives, directive) => {
  for (const name of FALLBACKS[directive] || [directive]) {
    if (directives.has(name)) return directives.get(name);
  }
  return null;
};

const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^:/]+|[^:/*]+)(?::(\d+|\*))?(\/.*)?$/;
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

/**
 * Splits a source list into single source expressions (values like
 * `"https: 'unsafe-inline'"` hold several).
 * @param {string[]} sources - Source list.
 * @returns {string[]} Lower-case expressions.
 */
const expressions = (sources) =>
  sources.flatMap((source) => String(source).trim().toLowerCase().split(/\s+/).filter(Boolean));

/**
 * Checks one source expression against an http(s) URL (CSP Level 3, without
 * `'self'`, which never matches an external origin here).
 * @param {string} expression - Source expression.
 * @param {URL} url - Resource URL.
 * @returns {boolean} True when the expression allows the URL.
 */
const expressionAllows = (expression, url) => {
  const protocol = url.protocol;
  if (expression === '*') return protocol === 'http:' || protocol === 'https:';
  if (expression.startsWith("'")) return false;
  if (/^[a-z][a-z0-9+.-]*:$/.test(expression)) {
    return expression === protocol || (expression === 'http:' && protocol === 'https:');
  }
  const match = HOST_SOURCE.exec(expression);
  if (!match) return false;
  const [, scheme, host, port, path] = match;
  if (scheme) {
    if (`${scheme}:` !== protocol && !(scheme === 'http' && protocol === 'https:')) return false;
  } else if (protocol !== 'http:' && protocol !== 'https:') {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (host !== '*') {
    if (host.startsWith('*.')) {
      if (!hostname.endsWith(host.slice(1))) return false;
    } else if (host !== hostname) {
      return false;
    }
  }
  if (port && port !== '*') {
    const urlPort = url.port || DEFAULT_PORTS[protocol];
    if (port !== urlPort) return false;
  }
  if (path && path !== '/') {
    const pathname = url.pathname.toLowerCase();
    if (path.endsWith('/') ? !pathname.startsWith(path) : pathname !== path) return false;
  }
  return true;
};

/**
 * Checks whether a source list allows a URL.
 * @param {string[]|null} sources - Source list (null means unrestricted).
 * @param {string} url - Absolute http(s) URL.
 * @returns {boolean} True when allowed.
 */
export const sourcesAllow = (sources, url) => {
  if (sources === null) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return expressions(sources).some((expression) => expressionAllows(expression, parsed));
};

/**
 * True when the list names at least one external image host besides Strapi's defaults.
 * @param {string[]} sources - Source list.
 * @returns {boolean} True when an owner-chosen host is allowed.
 */
const hasExplicitExternalHost = (sources) =>
  expressions(sources).some((expression) => {
    if (expression.startsWith("'") || /^[a-z][a-z0-9+.-]*:$/.test(expression)) return false;
    const match = HOST_SOURCE.exec(expression);
    return Boolean(match) && !STRAPI_DEFAULT_HOSTS.has(match[2]);
  });

/**
 * Quotes a value as a JavaScript string literal in the Prettier style.
 * @param {string} value - Value.
 * @returns {string} Literal.
 */
const literal = (value) =>
  value.includes("'") ? JSON.stringify(value) : `'${value.replace(/\\/g, '\\\\')}'`;

const unique = (values) => [...new Set(values)];

/**
 * Builds the config/middlewares.js snippet for the missing sources.
 * @param {Map<string, string[]>} directives - Effective directives.
 * @param {{ frameSrcMissing: string[], imgSrcMissing: boolean }} missing - What is missing.
 * @returns {string} Snippet, or '' when nothing is missing.
 */
export const buildCspSnippet = (directives, missing) => {
  const lines = [];
  const withoutNone = (list) => list.filter((item) => item.trim().toLowerCase() !== "'none'");
  if (missing.frameSrcMissing.length) {
    const base = governingSources(directives, 'frame-src') || ["'self'"];
    lines.push(['frame-src', unique([...withoutNone(base), ...missing.frameSrcMissing])]);
  }
  if (missing.imgSrcMissing) {
    const base = governingSources(directives, 'img-src') || ["'self'", 'data:', 'blob:'];
    lines.push(['img-src', unique([...withoutNone(base), 'https:'])]);
  }
  if (!lines.length) return '';
  const body = lines
    .map(
      ([name, values]) =>
        `          '${name}': [\n${values.map((value) => `            ${literal(value)},`).join('\n')}\n          ],`
    )
    .join('\n');
  return [
    '// config/middlewares.js: merge into your existing strapi::security entry',
    'module.exports = [',
    '  // ...other middlewares',
    '  {',
    "    name: 'strapi::security',",
    '    config: {',
    '      contentSecurityPolicy: {',
    '        useDefaults: true,',
    '        directives: {',
    body,
    '        },',
    '      },',
    '    },',
    '  },',
    '  // ...other middlewares',
    '];',
  ].join('\n');
};

/**
 * Reports which sources the admin CSP misses for embeds and external images.
 * The result holds only CSP source expressions (public: browsers receive them
 * in every response header) and never any other configuration value.
 * @param {unknown} middlewares - `strapi.config.get('middlewares')`.
 * @returns {{ active: boolean, frameSrcMissing: string[], imgSrcMissing: boolean, snippet: string }} Report.
 */
export const inspectCsp = (middlewares) => {
  const { active, directives } = effectiveDirectives(middlewares);
  if (!active) return { active: false, frameSrcMissing: [], imgSrcMissing: false, snippet: '' };
  const frameSources = governingSources(directives, 'frame-src');
  const frameSrcMissing = unique(
    Object.values(EMBED_FRAME_SOURCES)
      .filter((service) => !sourcesAllow(frameSources, service.sample))
      .map((service) => service.origin)
  );
  const imgSources = governingSources(directives, 'img-src');
  const imgSrcMissing =
    imgSources !== null &&
    !sourcesAllow(imgSources, EXTERNAL_IMAGE_SAMPLE) &&
    !hasExplicitExternalHost(imgSources);
  const missing = { frameSrcMissing, imgSrcMissing };
  return { active: true, ...missing, snippet: buildCspSnippet(directives, missing) };
};

/**
 * Checks whether a CSP violation's `blockedURI` refers to an element's URL.
 * Browsers may report the full URL or only its origin.
 * @param {string} elementUrl - `src` of the iframe or image.
 * @param {string} blockedUri - `SecurityPolicyViolationEvent.blockedURI`.
 * @returns {boolean} True when the violation is about this URL.
 */
export const matchesBlockedUri = (elementUrl, blockedUri) => {
  if (typeof elementUrl !== 'string' || typeof blockedUri !== 'string' || !elementUrl || !blockedUri) {
    return false;
  }
  if (elementUrl === blockedUri) return true;
  let element;
  let blocked;
  try {
    element = new URL(elementUrl);
    blocked = new URL(blockedUri);
  } catch {
    return false;
  }
  if (element.origin !== blocked.origin) return false;
  // An origin-only report matches every URL on that origin.
  if (blocked.pathname === '/' && !blocked.search) return true;
  return element.href.split('#')[0] === blocked.href.split('#')[0];
};

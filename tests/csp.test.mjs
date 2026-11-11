/**
 * Admin CSP detection (shared/csp.mjs) against several config/middlewares.js
 * shapes, mirroring @strapi/core 5.61 security middleware defaults and helmet 6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  EMBED_FRAME_SOURCES,
  effectiveDirectives,
  findSecurityMiddleware,
  inspectCsp,
  matchesBlockedUri,
  sourcesAllow,
} from '../shared/csp.mjs';

const require = createRequire(import.meta.url);
const ALL_ORIGINS = Object.values(EMBED_FRAME_SOURCES).map((service) => service.origin);
const DEFAULT_LIST = ['strapi::logger', 'strapi::errors', 'strapi::security', 'strapi::cors', 'strapi::body'];
const withSecurity = (config) => ['strapi::logger', { name: 'strapi::security', config }, 'strapi::cors'];

test('default Strapi middlewares block every embed and external images', () => {
  const report = inspectCsp(DEFAULT_LIST);
  assert.equal(report.active, true);
  assert.deepEqual(report.frameSrcMissing, ALL_ORIGINS);
  assert.equal(report.imgSrcMissing, true);
  assert.match(report.snippet, /'frame-src': \[\n {12}"'self'",\n {12}'https:\/\/www\.youtube\.com',/);
  assert.match(report.snippet, /'img-src': \[[^\]]*'https:\/\/market-assets\.strapi\.io',\n {12}'https:',/);
  assert.match(report.snippet, /name: 'strapi::security'/);
});

test('a missing middleware list means Strapi defaults', () => {
  assert.deepEqual(findSecurityMiddleware(undefined), { found: true, config: {} });
  assert.equal(inspectCsp(undefined).frameSrcMissing.length, ALL_ORIGINS.length);
});

test('no security middleware, CSP disabled or report-only: nothing is blocked', () => {
  for (const middlewares of [
    ['strapi::logger', 'strapi::body'],
    withSecurity({ contentSecurityPolicy: false }),
    withSecurity({ contentSecurityPolicy: { reportOnly: true } }),
  ]) {
    assert.deepEqual(inspectCsp(middlewares), {
      active: false,
      frameSrcMissing: [],
      imgSrcMissing: false,
      snippet: '',
    });
  }
});

test('explicit frame-src and https: images satisfy everything', () => {
  const report = inspectCsp(
    withSecurity({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'frame-src': ["'self'", ...ALL_ORIGINS], 'img-src': ["'self'", 'data:', 'https:'] },
      },
    })
  );
  assert.deepEqual(report.frameSrcMissing, []);
  assert.equal(report.imgSrcMissing, false);
  assert.equal(report.snippet, '');
});

test('camelCase names, wildcard hosts and scheme-less hosts are understood', () => {
  const report = inspectCsp(
    withSecurity({
      contentSecurityPolicy: {
        directives: {
          frameSrc: ['*.youtube.com', 'player.vimeo.com', 'https://*.figma.com:443'],
          'img-src': ["'self'", 'data:', 'my-bucket.s3.example.com'],
        },
      },
    })
  );
  assert.ok(!report.frameSrcMissing.includes('https://www.youtube.com'));
  assert.ok(!report.frameSrcMissing.includes('https://player.vimeo.com'));
  assert.ok(!report.frameSrcMissing.includes('https://www.figma.com'));
  assert.ok(report.frameSrcMissing.includes('https://codepen.io'));
  // An owner-chosen image host counts as a deliberate external image policy.
  assert.equal(report.imgSrcMissing, false);
  assert.doesNotMatch(report.snippet, /'img-src'/);
});

test('child-src and default-src are used as frame-src fallbacks', () => {
  const child = inspectCsp(
    withSecurity({ contentSecurityPolicy: { directives: { 'child-src': ['https:'] } } })
  );
  assert.deepEqual(child.frameSrcMissing, []);
  const defaults = inspectCsp(
    withSecurity({
      contentSecurityPolicy: { useDefaults: false, directives: { 'default-src': ['*'], 'img-src': null } },
    })
  );
  assert.deepEqual(defaults.frameSrcMissing, []);
  assert.equal(defaults.imgSrcMissing, false);
});

test('user arrays merge with Strapi defaults by index like lodash defaultsDeep', () => {
  const { directives } = effectiveDirectives(
    withSecurity({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'https:'] } } })
  );
  assert.deepEqual(directives.get('img-src'), [
    "'self'",
    'https:',
    'blob:',
    'https://market-assets.strapi.io',
  ]);
  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.equal(directives.has('upgrade-insecure-requests'), false);
});

test('a path-restricted source only allows matching paths', () => {
  assert.equal(sourcesAllow(['https://www.youtube.com/embed/'], 'https://www.youtube.com/embed/x'), true);
  assert.equal(sourcesAllow(['https://www.youtube.com/watch'], 'https://www.youtube.com/embed/x'), false);
  assert.equal(sourcesAllow(["'none'"], 'https://www.youtube.com/embed/x'), false);
  assert.equal(sourcesAllow(['http:'], 'https://www.youtube.com/embed/x'), true);
  assert.equal(sourcesAllow(["https: 'unsafe-inline'"], 'https://a.example.com/'), true);
  assert.equal(sourcesAllow(null, 'https://a.example.com/'), true);
});

test('the snippet drops none, keeps existing sources and quotes keywords', () => {
  const report = inspectCsp(
    withSecurity({
      contentSecurityPolicy: { directives: { 'frame-src': ["'none'"], 'img-src': ["'self'", 'data:'] } },
    })
  );
  assert.doesNotMatch(report.snippet, /'none'/);
  assert.match(report.snippet, /"'self'"/);
  assert.match(report.snippet, /'data:'/);
  assert.match(report.snippet, /'https:'/);
});

test('the report holds only CSP sources, never other middleware config', () => {
  const report = inspectCsp(
    withSecurity({
      hsts: { maxAge: 1 },
      secretLooking: 'do-not-return-me',
      contentSecurityPolicy: { directives: { 'connect-src': ['https://api.example.com'] } },
    })
  );
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /do-not-return-me|api\.example\.com|maxAge/);
});

test('violation URIs match full URLs and origin-only reports', () => {
  const src = 'https://www.youtube.com/embed/abc?x=1';
  assert.equal(matchesBlockedUri(src, src), true);
  assert.equal(matchesBlockedUri(src, 'https://www.youtube.com'), true);
  assert.equal(matchesBlockedUri(src, 'https://www.youtube.com/embed/abc?x=1#t'), true);
  assert.equal(matchesBlockedUri(src, 'https://www.youtube.com/embed/other'), false);
  assert.equal(matchesBlockedUri(src, 'https://player.vimeo.com'), false);
  assert.equal(matchesBlockedUri('', 'https://www.youtube.com'), false);
  assert.equal(matchesBlockedUri(src, 'inline'), false);
});

test('every embed service the editor enables is covered or deliberately excluded', () => {
  const tools = readFileSync(new URL('../admin/src/editor/tools/index.js', import.meta.url), 'utf8');
  const block = /services:\s*\{([^}]*)\}/.exec(tools)[1];
  const enabled = [...block.matchAll(/([a-z-]+):\s*true/g)].map((match) => match[1]);
  // github: data: iframe needing a remote script; twitch: not a service key in @editorjs/embed 2.8.
  const excluded = new Set(['github', 'twitch']);
  for (const name of enabled) {
    if (!excluded.has(name)) assert.ok(EMBED_FRAME_SOURCES[name], `${name} has a frame source`);
  }
});

test('the settings service exposes the CSP report in environment', async () => {
  const settingsService = require('../server/src/services/settings.js');
  const fakeStrapi = {
    config: {
      get: (key) => (key === 'middlewares' ? DEFAULT_LIST : undefined),
    },
    store: () => ({ get: async () => null }),
  };
  const service = settingsService({ strapi: fakeStrapi });
  const dto = await service.get();
  assert.deepEqual(dto.environment.csp.frameSrcMissing, ALL_ORIGINS);
  assert.equal(dto.environment.csp.imgSrcMissing, true);
  assert.equal(typeof dto.environment.csp.snippet, 'string');
});

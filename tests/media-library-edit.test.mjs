/**
 * 2.12 "Edit in Media Library" (crop and focus there): version gating (Strapi 5.54+, new Media
 * Library), the deep-link builder, focal point conversion (0-100 -> 0-1), the file refresh merge
 * and the GET /config capability.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ASSET_EDITOR_MIN_VERSION,
  canEditInMediaLibrary,
  focalFromMediaLibrary,
  hasNewMediaLibrary,
  isVersionAtLeast,
  mediaDisplayUrl,
  mediaLibraryAssetHref,
  mediaLibraryFileId,
  mergeMediaLibraryFile,
} from '../shared/media-library.mjs';
import { cleanFocalPoint } from '../shared/sanitize-policy.mjs';

const require = createRequire(import.meta.url);
const configController = require('../server/src/controllers/config.js');

test('version gate: 5.54.0 and later, pre-releases below their release, garbage never', () => {
  assert.equal(ASSET_EDITOR_MIN_VERSION, '5.54.0');
  for (const version of ['5.54.0', '5.54.1', '5.63.0', '5.100.0', '6.0.0', 'v5.60.2', '5.54.0+build.7'])
    assert.equal(isVersionAtLeast(version, ASSET_EDITOR_MIN_VERSION), true, version);
  for (const version of [
    '5.53.9',
    '5.0.0',
    '4.99.99',
    '5.54.0-beta.1',
    '5.54',
    '',
    null,
    undefined,
    554,
    'latest',
  ])
    assert.equal(isVersionAtLeast(version, ASSET_EDITOR_MIN_VERSION), false, String(version));
  assert.equal(isVersionAtLeast('5.54.0-rc.2', '5.54.0-rc.1'), true);
});

test('new Media Library detection: featureFlags present and useLegacyMediaLibrary off', () => {
  const flags = (legacy) => ({
    featureFlags: { isEnabled: (name) => name === 'useLegacyMediaLibrary' && legacy },
  });
  assert.equal(hasNewMediaLibrary(flags(false)), true);
  assert.equal(hasNewMediaLibrary(flags(true)), false, 'legacy Media Library opted back in');
  assert.equal(
    hasNewMediaLibrary({ future: { isEnabled: () => true } }),
    false,
    'before 5.54: no featureFlags'
  );
  assert.equal(hasNewMediaLibrary(undefined), false);
  assert.equal(
    hasNewMediaLibrary({
      featureFlags: {
        isEnabled: () => {
          throw new Error('boom');
        },
      },
    }),
    false
  );
});

test('capability: server version, read + update rights, public files, new Media Library, editable field', () => {
  const strapiGlobal = { featureFlags: { isEnabled: () => false } };
  const config = {
    mediaLibrary: { assetEditor: true },
    permissions: { mediaLibrary: true, mediaLibraryUpdate: true },
    uploads: { privateFiles: false },
  };
  assert.equal(canEditInMediaLibrary({ config, strapiGlobal }), true);
  assert.equal(canEditInMediaLibrary({ config, strapiGlobal, readOnly: true }), false);
  assert.equal(
    canEditInMediaLibrary({ config: { ...config, mediaLibrary: { assetEditor: false } }, strapiGlobal }),
    false
  );
  assert.equal(
    canEditInMediaLibrary({ config: { ...config, permissions: { mediaLibrary: true } }, strapiGlobal }),
    false,
    'no update right: the drawer has no Crop'
  );
  assert.equal(
    canEditInMediaLibrary({ config: { ...config, uploads: { privateFiles: true } }, strapiGlobal }),
    false,
    'private providers answer signed URLs that must not be stored'
  );
  assert.equal(
    canEditInMediaLibrary({ config, strapiGlobal: { featureFlags: { isEnabled: () => true } } }),
    false
  );
  assert.equal(canEditInMediaLibrary({ config: null, strapiGlobal }), false);
});

test('deep link: /admin/plugins/upload?assetId=<id>, only for real ids and the Media Library page', () => {
  assert.equal(mediaLibraryAssetHref('/admin/plugins/upload', 42), '/admin/plugins/upload?assetId=42');
  assert.equal(
    mediaLibraryAssetHref('/cms/admin/plugins/upload/', '7'),
    '/cms/admin/plugins/upload?assetId=7'
  );
  assert.equal(mediaLibraryAssetHref('/admin/plugins/upload', 0), null);
  assert.equal(mediaLibraryAssetHref('/admin/plugins/upload', -1), null);
  assert.equal(mediaLibraryAssetHref('/admin/plugins/upload', '7&x=1'), null);
  assert.equal(mediaLibraryAssetHref('/admin/plugins/upload', 'abc'), null);
  assert.equal(mediaLibraryAssetHref('/admin/plugins/upload?x=1', 5), null);
  assert.equal(mediaLibraryAssetHref('https://evil.example.test/admin/plugins/upload', 5), null);
  assert.equal(mediaLibraryAssetHref('/admin/content-manager', 5), null);
  assert.equal(mediaLibraryFileId({ id: 12 }), 12);
  assert.equal(mediaLibraryFileId({ id: '12' }), 12);
  assert.equal(mediaLibraryFileId({ url: '/uploads/a.png' }), null, 'a pasted URL has no Media Library id');
});

test('focal point: Media Library 0-100 becomes the block scale 0-1 (two decimals)', () => {
  assert.deepEqual(focalFromMediaLibrary({ x: 50, y: 25 }), { x: 0.5, y: 0.25 });
  assert.deepEqual(focalFromMediaLibrary({ x: 0, y: 100 }), { x: 0, y: 1 });
  assert.deepEqual(focalFromMediaLibrary({ x: 33.4, y: 66.6 }), { x: 0.33, y: 0.67 });
  for (const point of [
    null,
    undefined,
    {},
    { x: 101, y: 5 },
    { x: -1, y: 5 },
    { x: '50', y: 50 },
    [50, 50],
    { x: NaN, y: 1 },
  ])
    assert.equal(focalFromMediaLibrary(point), undefined, JSON.stringify(point));
  // The converted value is what the stored-data policy keeps.
  const converted = focalFromMediaLibrary({ x: 12.5, y: 87.5 });
  assert.deepEqual(cleanFocalPoint(converted), converted);
});

test('refresh merge: new URL and formats after a crop, alt kept; unchanged file means no save', () => {
  const stored = {
    url: '/uploads/photo_old.png',
    id: 5,
    alt: 'Synthetic beach',
    hash: 'photo_old',
    width: 1200,
    height: 800,
    formats: { small: { url: '/uploads/small_photo_old.png', width: 500, height: 333, path: null } },
  };
  const fresh = {
    id: 5,
    url: '/uploads/photo_new.png',
    hash: 'photo_new',
    width: 800,
    height: 800,
    alternativeText: 'Media Library text',
    formats: { small: { url: '/uploads/small_photo_new.png', width: 500, height: 500, sizeInBytes: 1 } },
    focalPoint: { x: 40, y: 60 },
  };
  const next = mergeMediaLibraryFile(stored, fresh);
  assert.equal(next.url, '/uploads/photo_new.png');
  assert.equal(next.alt, 'Synthetic beach', 'the block keeps its own alternative text');
  assert.equal(next.width, 800);
  assert.deepEqual(next.formats, { small: { url: '/uploads/small_photo_new.png', width: 500, height: 500 } });
  assert.equal(mergeMediaLibraryFile(next, fresh), null, 'same file again: nothing to save');
  assert.equal(mergeMediaLibraryFile(stored, { ...fresh, id: 6 }), null, 'another file: ignored');
  assert.equal(mergeMediaLibraryFile(stored, { ...fresh, url: 'javascript:alert(1)' }), null);
  assert.equal(mergeMediaLibraryFile({ url: '/uploads/x.png' }, fresh), null, 'no Media Library id');
});

/**
 * Minimal Strapi for GET /config.
 * @param {string} version - `info.strapi`.
 * @returns {object} Strapi.
 */
const configStrapi = (version) => {
  const services = {
    settings: {
      get: async () => ({
        ai: {
          enabled: false,
          hasApiKey: false,
          provider: 'anthropic',
          maxInputChars: 8000,
          actions: [],
          styleGuide: '',
        },
        languageTool: { enabled: false, baseUrl: '' },
        contentChecks: {},
      }),
    },
    ai: { ACTIONS: [], LANGUAGES: [], TONES: [] },
    collaboration: { isRunning: () => false },
    editor: { attachmentTypes: () => [] },
    media: { isPrivate: async () => false },
    'link-schedule': { settings: () => ({ enabled: false }) },
    blocks: { summaries: () => [], annotationSummaries: () => [] },
  };
  return {
    components: {},
    config: { get: (key) => (key === 'info.strapi' ? version : undefined) },
    plugin: (name) => (name === 'upload' ? {} : { service: (service) => services[service] }),
  };
};

test('GET /config: assetEditor follows the Strapi version; mediaLibraryUpdate follows the role', async () => {
  const read = async (version, allowed) => {
    const ctx = { state: { userAbility: { can: (action) => allowed.includes(action) } } };
    await configController({ strapi: configStrapi(version) }).get(ctx);
    return ctx.body.data;
  };
  const both = ['plugin::upload.read', 'plugin::upload.assets.update'];
  const current = await read('5.63.0', both);
  assert.deepEqual(current.mediaLibrary, { assetEditor: true });
  assert.equal(current.permissions.mediaLibraryUpdate, true);
  assert.equal((await read('5.53.0', both)).mediaLibrary.assetEditor, false);
  assert.equal((await read('5.63.0', ['plugin::upload.read'])).permissions.mediaLibraryUpdate, false);
});

test('display URL: cache-busting parameter for a replaced file, stored URL unchanged', () => {
  assert.equal(
    mediaDisplayUrl('/uploads/a.png', '2026-11-24T20:54:54.610Z'),
    '/uploads/a.png?mexv=2026-11-24T20%3A54%3A54.610Z'
  );
  assert.equal(
    mediaDisplayUrl('https://cdn.example.test/a.png?w=1#x', 'v1'),
    'https://cdn.example.test/a.png?w=1&mexv=v1#x'
  );
  assert.equal(mediaDisplayUrl('/uploads/a.png', undefined), '/uploads/a.png');
  assert.equal(mediaDisplayUrl('/uploads/a.png', '"><script>'), '/uploads/a.png');
  assert.equal(mediaDisplayUrl('', 'v1'), '');
});

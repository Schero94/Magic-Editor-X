/**
 * 2.5: @editorjs/embed is pinned to 2.7.x (2.8.0 requires Node 24); the plugin
 * defines the YouTube (with Shorts) and Figma services 2.8.0 added.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMBED_SERVICES, youtubeId } from '../admin/src/editor/tools/embed-services.mjs';

const embedUrl = (service, source) => {
  const { regex, embedUrl: template, id = (groups) => groups.shift() || '' } = EMBED_SERVICES[service];
  const groups = regex.exec(source)?.slice(1);
  return groups ? template.replace(/<%= remote_id %>/g, id(groups)) : null;
};

test('YouTube: watch, short links, Shorts and start times', () => {
  assert.equal(
    embedUrl('youtube', 'https://www.youtube.com/watch?v=abc123XYZ_0'),
    'https://www.youtube.com/embed/abc123XYZ_0'
  );
  assert.equal(
    embedUrl('youtube', 'https://youtu.be/abc123XYZ_0'),
    'https://www.youtube.com/embed/abc123XYZ_0'
  );
  assert.equal(
    embedUrl('youtube', 'https://www.youtube.com/shorts/Sh0rtVid3o1'),
    'https://www.youtube.com/embed/Sh0rtVid3o1'
  );
  assert.equal(youtubeId([undefined, '?v=abc&t=42&list=PL1&LL=x']), 'abc?start=42&list=PL1');
  assert.equal(youtubeId([undefined, '?v=abc&list=RDMMxyz']), 'abc?');
});

test('Figma: only Figma document URLs match (2.8.0 matched any text)', () => {
  const url = 'https://www.figma.com/design/AbC123dEf/Landing-page?node-id=1-2';
  assert.equal(embedUrl('figma', url), `https://www.figma.com/embed?embed_host=share&url=${url}`);
  assert.equal(
    embedUrl('figma', 'https://figma.com/board/Xy9Z/Retro'),
    'https://www.figma.com/embed?embed_host=share&url=https://figma.com/board/Xy9Z/Retro'
  );
  assert.equal(embedUrl('figma', 'just some text'), null);
  assert.equal(embedUrl('figma', 'https://www.figma.com/'), null);
  assert.equal(embedUrl('figma', 'https://evil.example.test/design/https://www.figma.com'), null);
});

test('service definitions pass the checks of @editorjs/embed', () => {
  for (const [name, config] of Object.entries(EMBED_SERVICES)) {
    assert.ok(config.regex instanceof RegExp, name);
    assert.equal(typeof config.embedUrl, 'string', name);
    assert.equal(typeof config.html, 'string', name);
    assert.ok(Number.isFinite(config.height) && Number.isFinite(config.width), name);
    assert.ok(config.id === undefined || typeof config.id === 'function', name);
  }
});

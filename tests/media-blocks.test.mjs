import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { parseDocument } from 'htmlparser2';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
  BLOCK_POLICIES,
  sanitizeEditorData,
  isBuiltInBlock,
  cleanFocalPoint,
  MAX_GALLERY_IMAGES,
} from '../shared/sanitize-policy.mjs';
import { normalizeEditorData } from '../shared/editor-data.mjs';
import { renderHtml, renderText, renderMarkdown, renderTree, inlineToHtml } from '../shared/render/index.mjs';
import { MagicEditorXContent as ReactContent } from '../shared/frameworks/react.mjs';
import { MagicEditorXContent as VueContent } from '../shared/frameworks/vue.mjs';
import { resolveFieldPreset, checkPreset, isBlockAllowed, fixPresetViolations } from '../shared/presets.mjs';
import { lintDocument, extractLinks } from '../shared/quality.mjs';
import { collectReferences, applyReferences, renderResolved } from '../shared/resolve-references.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { blockText, diffDocuments } from '../shared/diff.mjs';
import { createReplica } from '../shared/collab-replica.mjs';
import { createSeedUpdate } from '../shared/ydoc.mjs';
import { applyCheckedUpdate } from '../shared/ydoc-guard.mjs';
import {
  addGalleryImages,
  addTrack,
  assetToFile,
  focalFromPointer,
  focalPercent,
  moveFocal,
  moveItem,
  isVttAsset,
  normalizeGallery,
} from '../admin/src/editor/tools/media-logic.mjs';
import { validateBlock, emptyValues } from '../admin/src/pages/CustomBlocksPage/blockForm.mjs';
import { assertSafeHtml, xssDocument, XSS } from './helpers/xss-corpus.mjs';

const store = (value) =>
  sanitizeEditorData(normalizeEditorData(value), {
    sanitizeInlineHtml: (html) => inlineToHtml(html),
    sanitizeRawHtml: () => '',
  });
const doc = (...blocks) => ({
  time: 1,
  version: '2.31.7',
  blocks: blocks.map((b, i) => ({ id: `m${i}`, ...b })),
});

const image = (n, extra = {}) => ({
  file: {
    url: `/uploads/g${n}.png`,
    id: n,
    documentId: `g${n}`,
    mime: 'image/png',
    alt: `Alt ${n}`,
    width: 800,
    height: 600,
    formats: { small: { url: `/uploads/small_g${n}.png`, width: 400, height: 300 } },
  },
  caption: `Caption ${n}`,
  ...extra,
});
const gallery = (images, extra = {}) => ({
  type: 'gallery',
  data: { images, layout: 'grid', columns: 3, caption: 'Holiday', ...extra },
});
const video = (extra = {}) => ({
  type: 'video',
  data: {
    file: { url: '/uploads/clip.webm', id: 20, documentId: 'v20', mime: 'video/webm', name: 'clip.webm' },
    poster: { url: '/uploads/poster.png', id: 21, mime: 'image/png' },
    title: 'Clip title',
    caption: 'Clip <b>caption</b>',
    loop: false,
    muted: true,
    tracks: [
      {
        file: { url: '/uploads/clip.vtt', id: 22, mime: 'text/vtt', name: 'clip.vtt' },
        kind: 'captions',
        srclang: 'en',
        label: 'English',
        default: true,
      },
    ],
    ...extra,
  },
});
const audio = (extra = {}) => ({
  type: 'audio',
  data: {
    file: { url: '/uploads/tone.wav', id: 30, mime: 'audio/wav', name: 'tone.wav' },
    title: 'Tone',
    caption: '',
    loop: true,
    tracks: [],
    ...extra,
  },
});

/* ----------------------------------------------------------------- policy */

test('policy: gallery is bounded, images need an image URL, focal points are rounded', () => {
  const many = Array.from({ length: MAX_GALLERY_IMAGES + 5 }, (_, i) => image(i + 1));
  const [block] = store(doc(gallery(many, { layout: 'x', columns: 9 }))).blocks;
  assert.equal(block.data.images.length, MAX_GALLERY_IMAGES);
  assert.equal(block.data.layout, 'grid');
  assert.equal(block.data.columns, 3);
  const mixed = store(
    doc(
      gallery([
        image(1, { focalPoint: { x: 0.123456, y: 0.987 } }),
        { file: { url: 'javascript:alert(1)' }, caption: 'x' },
        { file: { url: '/uploads/v.mp4', mime: 'video/mp4' }, caption: 'x' },
        image(2, { focalPoint: { x: 2, y: 0.5 }, decorative: true }),
      ])
    )
  ).blocks[0].data;
  assert.equal(mixed.images.length, 2);
  assert.deepEqual(mixed.images[0].focalPoint, { x: 0.12, y: 0.99 });
  assert.equal(mixed.images[1].focalPoint, undefined);
  assert.equal(mixed.images[1].decorative, true);
  assert.deepEqual(cleanFocalPoint({ x: '0.5', y: 0.5 }), undefined);
  assert.deepEqual(cleanFocalPoint({ x: 0, y: 1 }), { x: 0, y: 1 });
});

test('policy: video/audio MIME and WebVTT checks, track bounds and one default', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => ({
    file: { url: `/uploads/t${i}.vtt` },
    kind: i % 2 ? 'subtitles' : 'evil',
    srclang: i ? 'de-AT' : '<x>',
    label: 'L'.repeat(150),
    default: true,
  }));
  const v = store(doc(video({ tracks }))).blocks[0].data;
  assert.equal(v.tracks.length, 8);
  assert.equal(v.tracks.filter((t) => t.default).length, 1);
  assert.equal(v.tracks[0].kind, 'captions');
  assert.equal(v.tracks[0].srclang, '');
  assert.equal(v.tracks[1].srclang, 'de-AT');
  assert.equal(v.tracks[0].label.length, 100);
  const wrong = store(
    doc(
      video({
        file: { url: '/uploads/x.png', mime: 'image/png' },
        poster: { url: '/uploads/p.mp4', mime: 'video/mp4' },
        tracks: [{ file: { url: '/uploads/a.srt' } }, { file: { url: '/uploads/b.txt', mime: 'text/vtt' } }],
      }),
      audio({ file: { url: '/uploads/x.webm', mime: 'video/webm' } })
    )
  ).blocks;
  assert.equal(wrong[0].data.file.url, '');
  assert.equal(wrong[0].data.poster, undefined);
  assert.equal(wrong[0].data.tracks.length, 1);
  assert.equal(wrong[1].data.file.url, '');
  assert.equal(renderHtml(doc(...wrong)), '');
  assert.deepEqual(Object.keys(store(doc(audio())).blocks[0].data).sort(), [
    '_mex',
    'caption',
    'file',
    'loop',
    'title',
    'tracks',
  ]);
});

test('policy: image focal point is kept; custom blocks written before 2.3 under the new names stay custom', () => {
  const [img] = store(
    doc({
      type: 'image',
      data: { file: { url: '/uploads/i.png' }, caption: '', focalPoint: { x: 0.3, y: 0.4 } },
    })
  ).blocks;
  assert.deepEqual(img.data.focalPoint, { x: 0.3, y: 0.4 });
  const legacy = {
    type: 'video',
    data: { url: 'https://cdn.example.test/v', headline: '<b>Hi</b><script>x</script>' },
  };
  assert.equal(isBuiltInBlock(legacy), false);
  assert.equal(isBuiltInBlock(video()), true);
  const [kept] = store(doc(legacy)).blocks;
  assert.deepEqual(kept.data, { url: 'https://cdn.example.test/v', headline: '<b>Hi</b>' });
  assert.match(renderHtml(doc(legacy)), /data-mex-block="video"/);
  assert.equal(collectReferences(doc(legacy)).refs.size, 0);
  assert.equal(validateBlock({ ...emptyValues(), name: 'video', label: 'V' }).name, 'reserved');
  assert.equal(
    validateBlock({ ...emptyValues(), name: 'video', label: 'V' }, { originalName: 'video' }).name,
    undefined
  );
  assert.equal(
    validateBlock({ ...emptyValues(), name: 'gallery', label: 'G' }, { originalName: 'other' }).name,
    'reserved'
  );
});

/* ----------------------------------------------------------------- render */

test('render: gallery, video and audio HTML with srcset, tracks, no inline style by default', () => {
  const value = doc(
    gallery([image(1, { focalPoint: { x: 0.25, y: 0.7 } }), image(2, { decorative: true })], {
      layout: 'carousel',
      columns: 2,
    }),
    video(),
    audio()
  );
  const html = renderHtml(value, { imageSizes: '50vw' });
  assert.match(
    html,
    /^<figure class="mex-gallery mex-gallery-carousel mex-gallery-cols-2" data-mex-layout="carousel" data-mex-columns="2"><ul class="mex-gallery-items"><li class="mex-gallery-item"><figure class="mex-gallery-figure"><img src="\/uploads\/g1.png" alt="Alt 1" width="800" height="600" srcset="\/uploads\/small_g1.png 400w, \/uploads\/g1.png 800w" sizes="50vw" loading="lazy" decoding="async" data-mex-focal-x="0.25" data-mex-focal-y="0.7"><figcaption>Caption 1<\/figcaption>/
  );
  assert.match(html, /<img src="\/uploads\/g2.png" alt="" /);
  assert.match(
    html,
    /<figure class="mex-video"><video src="\/uploads\/clip.webm" controls preload="metadata" aria-label="Clip title" playsinline muted poster="\/uploads\/poster.png"><track kind="captions" src="\/uploads\/clip.vtt" srclang="en" label="English" default><a href="\/uploads\/clip.webm">Clip title<\/a><\/video><figcaption>Clip <b>caption<\/b><\/figcaption><\/figure>/
  );
  assert.match(
    html,
    /<figure class="mex-audio"><audio src="\/uploads\/tone.wav" controls preload="metadata" aria-label="Tone" loop>/
  );
  assert.doesNotMatch(html, /autoplay|style=/);
  assert.equal(renderText(value), 'Caption 1\nCaption 2\nHoliday\n\nClip title\nClip caption\n\nTone');
  assert.equal(
    renderMarkdown(value),
    '![Alt 1](/uploads/g1.png "Caption 1")\n![](/uploads/g2.png "Caption 2")\n\nHoliday\n\n[Clip title](/uploads/clip.webm)\n\nClip **caption**\n\n[Tone](/uploads/tone.wav)'
  );
});

test("render: focalPoint 'style' writes object-position in HTML, React and Vue alike", async () => {
  const value = doc(
    {
      type: 'image',
      data: { file: { url: '/uploads/i.png', alt: 'I' }, caption: '', focalPoint: { x: 0.33, y: 0.05 } },
    },
    gallery([image(1, { focalPoint: { x: 1, y: 0 } })])
  );
  const options = { focalPoint: 'style' };
  const html = renderHtml(value, options);
  assert.match(html, /data-mex-focal-x="0.33" data-mex-focal-y="0.05" style="object-position:33% 5%"/);
  assert.match(html, /style="object-position:100% 0%"/);
  const tree = renderTree(value, options);
  assert.deepEqual(tree[0].children[0].style, { 'object-position': '33% 5%' });
  const normalize = (markup) => {
    const walk = (nodes) =>
      nodes
        .filter((n) => n.type === 'tag' || n.type === 'text')
        .map((n) =>
          n.type === 'text'
            ? n.data
            : [
                n.name,
                Object.entries(n.attribs)
                  .map(([k, v]) => [k, k === 'style' ? v.replace(/;$/, '').replace(/:\s*/, ':') : v])
                  .sort(),
                walk(n.children),
              ]
        );
    return JSON.stringify(walk(parseDocument(markup.replace(/<!--[[\]]-->/g, '')).children));
  };
  const react = renderToStaticMarkup(React.createElement(ReactContent, { value, options }));
  const vue = await renderToString(createSSRApp({ render: () => h(VueContent, { value, options }) }));
  assert.equal(normalize(react), normalize(html));
  assert.equal(normalize(vue), normalize(html));
  // Overrides cannot smuggle a style attribute or property in.
  const evil = renderHtml(value, {
    overrides: {
      image: (_b, helpers) => ({
        ...helpers.h('img', { src: '/x.png', style: 'x' }),
        style: { color: 'red' },
      }),
    },
  });
  assert.doesNotMatch(evil.split('\n')[0], /style/);
});

test('render: media hook results are re-validated per file kind', () => {
  const value = doc(video(), gallery([image(1)]));
  const html = renderHtml(value, {
    media: (file) =>
      file.url.endsWith('.webm')
        ? { url: 'javascript:alert(1)' }
        : { ...file, url: `https://cdn.example.test${file.url}` },
  });
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /src="https:\/\/cdn.example.test\/uploads\/g1.png"/);
});

test('render: XSS payloads in every media field stay inert in HTML, React and Vue', async () => {
  for (const payload of XSS) {
    const value = xssDocument(payload);
    const html = renderHtml(value, { focalPoint: 'style' });
    assertSafeHtml(html, payload);
    const react = renderToStaticMarkup(React.createElement(ReactContent, { value }));
    assertSafeHtml(react, `react ${payload}`);
  }
});

/* ---------------------------------------------------------------- presets */

test('presets: full and article allow the media blocks, basic does not; requireAlt covers gallery images', () => {
  assert.ok(['gallery', 'video', 'audio'].every((type) => isBlockAllowed(resolveFieldPreset({}), type)));
  assert.ok(
    ['gallery', 'video', 'audio'].every((type) =>
      isBlockAllowed(resolveFieldPreset({ preset: 'article' }), type)
    )
  );
  const basic = resolveFieldPreset({ preset: 'basic' });
  assert.equal(isBlockAllowed(basic, 'gallery'), false);
  const listed = resolveFieldPreset({ allowedBlocks: 'gallery, video' });
  assert.ok(isBlockAllowed(listed, 'video') && !isBlockAllowed(listed, 'audio'));
  const value = store(doc(gallery([image(1), image(2, { file: { url: '/uploads/x.png' } })]), video()));
  const violations = checkPreset(value, resolveFieldPreset({ preset: 'basic', requireAlt: true }));
  assert.deepEqual(
    violations.map((v) => v.code),
    ['BLOCK_NOT_ALLOWED', 'BLOCK_NOT_ALLOWED']
  );
  const alt = checkPreset(value, resolveFieldPreset({ requireAlt: true }));
  assert.deepEqual(
    alt.map((v) => [v.code, v.blockId]),
    [['ALT_REQUIRED', 'm0']]
  );
  const fixed = fixPresetViolations(value, basic);
  assert.equal(fixed.removed, 2);
});

/* ---------------------------------------------------------------- quality */

test('quality: gallery alt, video captions and Media Library references for the link check', () => {
  const value = doc(
    gallery([
      image(1),
      image(2, { file: { url: '/uploads/x.png', id: 9 } }),
      image(3, { file: { url: '/u/y.png' }, decorative: true }),
    ]),
    video({ tracks: [] }),
    video({ tracks: [{ file: { url: '/a.vtt' }, kind: 'chapters', srclang: '', label: '' }] }),
    video(),
    audio()
  );
  const { issues, stats } = lintDocument(value, { requireAlt: true });
  assert.deepEqual(
    issues.map((i) => [i.rule, i.severity, i.blockId, i.path]),
    [
      ['image-alt-missing', 'error', 'm0', 'images.1.file.alt'],
      ['video-no-captions', 'warning', 'm1', undefined],
      ['video-no-captions', 'warning', 'm2', undefined],
    ]
  );
  assert.equal(stats.images, 3);
  assert.deepEqual(
    extractLinks(value).media.map((m) => m.id),
    [1, 9, 20, 21, 22, 30]
  );
});

/* ------------------------------------------------------------- resolution */

test('Content API resolution refreshes gallery, video, poster, track and audio files', () => {
  const value = doc(
    gallery([image(1), image(2, { file: { url: '/old.png', documentId: 'g2', alt: '' } })]),
    video(),
    audio()
  );
  const { data, refs } = collectReferences(value);
  assert.deepEqual([...refs.keys()].sort(), [
    'media|doc|g2',
    'media|id|1',
    'media|id|20',
    'media|id|21',
    'media|id|22',
    'media|id|30',
  ]);
  const resolved = new Map([
    ['media|id|1', { file: { url: '/new1.png', alt: 'Library 1', formats: null, mime: 'image/png' } }],
    ['media|doc|g2', { file: { url: '/new2.png', alt: 'Library 2', width: 10 } }],
    ['media|id|20', { file: { url: '/new.webm', alt: 'ignored', mime: 'video/webm', formats: { x: 1 } } }],
    ['media|id|22', { file: { url: '/new.vtt', mime: 'text/vtt' } }],
  ]);
  const out = applyReferences(data, resolved);
  const [g, v, a] = out.blocks;
  assert.equal(g.data.images[0].file.url, '/new1.png');
  assert.equal(g.data.images[0].file.alt, 'Alt 1', 'the block alt wins');
  assert.equal(g.data.images[0].file.formats, undefined);
  assert.equal(g.data.images[1].file.alt, 'Library 2', 'an empty alt is filled');
  assert.equal(v.data.file.url, '/new.webm');
  assert.equal(v.data.file.alt, undefined);
  assert.equal(v.data.file.formats, undefined);
  assert.equal(v.data.poster.url, '/uploads/poster.png', 'unresolved stays as stored');
  assert.equal(v.data.tracks[0].file.url, '/new.vtt');
  assert.equal(a.data.file.url, '/uploads/tone.wav');
  assert.match(renderResolved(out, 'html'), /<video src="\/new.webm"/);
  assert.deepEqual(value.blocks[0].data.images[0].file.url, '/uploads/g1.png', 'input unchanged');
});

/* ------------------------------------------------------- find, diff, logic */

test('find and replace reaches gallery image captions and media captions; diff text reads them', () => {
  const value = store(doc(gallery([image(1)]), video()));
  const { matches } = findMatches(value, 'caption');
  assert.deepEqual(
    matches.map((m) => m.path),
    ['images.0.caption', 'caption']
  );
  const out = replaceMatches(value, 'Caption 1', 'Beach');
  assert.equal(out.count, 1);
  assert.equal(out.data.blocks[0].data.images[0].caption, 'Beach');
  assert.equal(blockText(value.blocks[0]), 'Holiday Caption 1 Alt 1');
  const changes = diffDocuments(value, out.data);
  assert.equal(changes.filter((c) => c.op !== 'equal').length, 1);
});

test('media logic: focal point by pointer and keyboard, gallery picks, tracks, moves', () => {
  assert.deepEqual(focalFromPointer({ left: 10, top: 20, width: 200, height: 100 }, 60, 95), {
    x: 0.25,
    y: 0.75,
  });
  assert.deepEqual(focalFromPointer({ left: 0, top: 0, width: 100, height: 100 }, -5, 500), { x: 0, y: 1 });
  assert.equal(focalFromPointer({ left: 0, top: 0, width: 0, height: 10 }, 1, 1), null);
  assert.deepEqual(moveFocal(undefined, 'ArrowRight'), { x: 0.51, y: 0.5 });
  assert.deepEqual(moveFocal({ x: 0.95, y: 0.05 }, 'ArrowRight', true), { x: 1, y: 0.05 });
  assert.deepEqual(moveFocal({ x: 0.2, y: 0.05 }, 'ArrowUp', true), { x: 0.2, y: 0 });
  assert.equal(moveFocal({ x: 0.2, y: 0.2 }, 'Enter'), null);
  assert.deepEqual(focalPercent(undefined), { x: 50, y: 50 });
  const assets = [
    { id: 1, url: '/a.png', mime: 'image/png', alternativeText: 'A', formats: { small: { url: '/s.png' } } },
    { id: 2, url: '/b.mp4', mime: 'video/mp4' },
  ];
  const full = Array.from({ length: MAX_GALLERY_IMAGES - 1 }, (_, i) => ({ file: { url: `/x${i}.png` } }));
  const picked = addGalleryImages(full, [...assets, assets[0]]);
  assert.equal(picked.images.length, MAX_GALLERY_IMAGES);
  assert.deepEqual([picked.added, picked.skipped], [1, 2]);
  assert.deepEqual(picked.images.at(-1).file, {
    url: '/a.png',
    mime: 'image/png',
    id: 1,
    alt: 'A',
    formats: { small: { url: '/s.png' } },
  });
  assert.deepEqual(assetToFile(assets[1]), { url: '/b.mp4', mime: 'video/mp4', id: 2 });
  assert.ok(isVttAsset({ name: 'x.VTT' }) && !isVttAsset({ mime: 'text/plain', name: 'x.srt' }));
  const one = addTrack([], { url: '/c.vtt', mime: 'text/vtt', name: 'c.vtt' }, 'de');
  assert.deepEqual(one, [
    {
      file: { url: '/c.vtt', mime: 'text/vtt', name: 'c.vtt' },
      kind: 'captions',
      srclang: 'de',
      label: '',
      default: true,
    },
  ]);
  assert.equal(addTrack([], { url: '/c.srt', name: 'c.srt' }), null);
  assert.equal(addTrack(one, { url: '/d.vtt', ext: '.vtt' }, '-')[1].default, undefined);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(['a', 'b'], 1, -3), ['b', 'a']);
  assert.deepEqual(normalizeGallery({}), { images: [], layout: 'grid', columns: 3, caption: '', _mex: 1 });
  assert.equal(BLOCK_POLICIES.gallery({}, (s) => s, {}).images.length, 0);
});

/* ---------------------------------------------------------- collaboration */

test('collaboration: concurrent gallery and video edits converge and pass the server guard', () => {
  const seed = createSeedUpdate(store(doc(gallery([image(1), image(2), image(3)]), video())), 'epoch-media');
  const server = new Y.Doc();
  Y.applyUpdate(server, seed);
  const clients = [0, 1].map(() => {
    const outbox = [];
    const replica = createReplica({
      onLocalUpdate: (u) => outbox.push(u),
      onShouldRender: () => {},
      captureTimeout: 0,
    });
    replica.applyRemote(seed);
    const c = { replica, outbox, editor: null };
    c.render = () => {
      const { data, catchUp } = replica.snapshot();
      c.editor = JSON.parse(JSON.stringify(data));
      replica.markShown(catchUp, JSON.parse(JSON.stringify(data)));
    };
    c.edit = (fn) => {
      const next = JSON.parse(JSON.stringify(c.editor));
      fn(next);
      c.editor = next;
      replica.pushLocal(JSON.parse(JSON.stringify(next)));
    };
    c.render();
    return c;
  });
  const [a, b] = clients;
  a.edit((d) => {
    const images = d.blocks[0].data.images;
    images.push(images.shift());
    images[0].focalPoint = { x: 0.1, y: 0.9 };
    d.blocks[1].data.tracks[0].label = 'English (CC)';
  });
  b.edit((d) => {
    d.blocks[0].data.images[2].caption = 'Edited by B';
    d.blocks[0].data.layout = 'carousel';
    d.blocks[1].data.muted = false;
  });
  for (const c of clients)
    for (const update of c.outbox.splice(0)) {
      assert.equal(applyCheckedUpdate(server, update).ok, true);
      for (const other of clients) if (other !== c) other.replica.applyRemote(update);
    }
  a.render();
  b.render();
  assert.deepEqual(a.editor, b.editor);
  const g = a.editor.blocks[0].data;
  assert.deepEqual(
    g.images.map((i) => i.file.id),
    [2, 3, 1]
  );
  assert.deepEqual(g.images[0].focalPoint, { x: 0.1, y: 0.9 });
  assert.equal(g.images[1].caption, 'Edited by B');
  assert.equal(g.layout, 'carousel');
  assert.equal(a.editor.blocks[1].data.tracks[0].label, 'English (CC)');
  assert.equal(a.editor.blocks[1].data.muted, false);
  // The stored result is still valid after sanitising.
  assert.equal(store(a.editor).blocks[0].data.images.length, 3);
});

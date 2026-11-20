/**
 * m11 (2.7.4): a stored embed of a service the editor does not configure is shown as a note and
 * saved unchanged, instead of failing in @editorjs/embed render() (Editor.js console error).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SafeEmbed } from '../../admin/src/editor/tools/embed-safe.js';

const api = { styles: { input: 'cdx-input' }, i18n: { t: (text) => text } };

test('unknown service: note with the source, data saved unchanged', () => {
  SafeEmbed.prepare({ config: { services: { vimeo: true } } });
  const data = {
    service: 'retired-video',
    source: 'https://video.example.test/v/1',
    embed: 'https://video.example.test/embed/1',
    width: 600,
    height: 320,
    caption: 'Old <b>caption</b>',
  };
  const tool = new SafeEmbed({ data, api, readOnly: false, config: {} });
  const node = tool.render();
  assert.equal(node.getAttribute('role'), 'note');
  assert.match(node.textContent, /retired-video/);
  assert.match(node.textContent, /video\.example\.test\/v\/1/);
  assert.deepEqual(tool.save(), data);
});

test('known service: the original embed renders', () => {
  SafeEmbed.prepare({ config: { services: { vimeo: true } } });
  const tool = new SafeEmbed({
    data: { service: 'vimeo', source: 'https://vimeo.com/1', embed: 'https://player.vimeo.com/video/1' },
    api,
    readOnly: false,
    config: {},
  });
  const node = tool.render();
  assert.ok(node.querySelector('iframe'), 'iframe of the configured service');
  assert.equal(tool.save().service, 'vimeo');
});

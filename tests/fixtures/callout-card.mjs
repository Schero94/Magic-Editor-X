/**
 * Example code-registered block (custom block SDK): the "callout card" from
 * docs/guides/custom-blocks-sdk.md. Used by the unit tests and the
 * acceptance host.
 */
import { defineBlock } from '../../shared/blocks/index.mjs';

export const calloutCard = defineBlock({
  name: 'calloutCard',
  version: 1,
  title: 'Callout card',
  schema: {
    title: { type: 'text', max: 120, label: 'Title' },
    body: { type: 'inline', max: 2000, label: 'Text' },
    link: { type: 'url', schemes: ['http', 'https'], label: 'Link' },
    tone: { type: 'enum', values: ['info', 'success', 'warning'], label: 'Tone' },
  },
  presets: ['article'],
  render: (block, { h, inlineNodes }) =>
    h('aside', { class: `callout-card callout-card-${block.data.tone}`, 'data-mex-block': block.type }, [
      block.data.title ? h('p', { class: 'callout-card-title' }, block.data.title) : null,
      h('div', { class: 'callout-card-body' }, inlineNodes(block.data.body)),
      block.data.link ? h('a', { class: 'callout-card-link', href: block.data.link }, 'Read more') : null,
    ]),
  text: (data, { text }) => [data.title, text(data.body), data.link].filter(Boolean).join('\n'),
  markdown: (data, { escape, inline }) =>
    [
      data.title ? `**${escape(data.title)}**` : '',
      inline(data.body),
      data.link ? `[Read more](<${data.link}>)` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
});

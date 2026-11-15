/**
 * Example inline annotation (2.5, block SDK): a glossary term whose
 * definition comes from a content type (`api::glossary-term.glossary-term`
 * with `slug` and `definition`). Used by the unit tests and the acceptance
 * host. `resolve` runs on the server for `?mex=` and GraphQL `…Rendered`
 * output: one batched, permission-aware lookup per response.
 */
import { defineInlineAnnotation } from '../../shared/blocks/index.mjs';

export const GLOSSARY_UID = 'api::glossary-term.glossary-term';

export const glossaryAnnotation = defineInlineAnnotation({
  name: 'glossary',
  label: 'Glossary term',
  description: 'Links a word to its definition in the glossary.',
  shortcut: 'CMD+SHIFT+8',
  attributes: {
    term: { type: 'text', max: 80, required: true, label: 'Glossary entry (slug)' },
  },
  resolve: async (items, { find }) => {
    const terms = [...new Set(items.map((item) => item.attrs.term))];
    const rows = await find(GLOSSARY_UID, {
      filters: { slug: { $in: terms } },
      fields: ['slug', 'definition'],
      limit: 100,
    });
    const definitions = new Map(rows.map((row) => [row.slug, row.definition]));
    return items.map((item) => definitions.get(item.attrs.term) || null);
  },
  render: ({ attrs, resolved }) => ({
    tag: 'dfn',
    attrs: {
      class: 'glossary-term',
      'data-term': attrs.term,
      title: typeof resolved === 'string' ? resolved : undefined,
    },
  }),
});

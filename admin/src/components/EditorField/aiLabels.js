/**
 * Labels of the AI menu entries (2.9), shared by the three AI dialogs.
 * Each entry is [translation id, English default].
 */

export const SELECTION_LABELS = {
  improve: ['editor.ai.action.improve', 'Improve writing'],
  grammar: ['editor.ai.action.grammar', 'Fix spelling and grammar'],
  shorten: ['editor.ai.action.shorten', 'Make shorter'],
  expand: ['editor.ai.action.expand', 'Make longer'],
  summarize: ['editor.ai.action.summarize', 'Summarize'],
  simplify: ['editor.ai.action.simplify', 'Simplify'],
  translate: ['editor.ai.action.translate', 'Translate'],
  tone: ['editor.ai.action.tone', 'Change tone'],
  continue: ['editor.ai.action.continue', 'Continue writing'],
};

export const BLOCK_LABELS = {
  improve: ['editor.aiBlocks.action.improve', 'Rewrite (improve writing)'],
  shorten: ['editor.aiBlocks.action.shorten', 'Make shorter'],
  translate: ['editor.aiBlocks.action.translate', 'Translate'],
  tone: ['editor.aiBlocks.action.tone', 'Change tone'],
};

export const FIELD_LABELS = {
  translate: ['editor.aiField.translate', 'Translate the whole field'],
  summarize: ['editor.aiField.summarize', 'Summarize the field'],
};

const REVIEW_LABELS = {
  proofread: ['editor.ai.review.proofread', 'Proofread (adds suggestions)'],
  clarity: ['editor.ai.review.clarity', 'Improve clarity (adds suggestions)'],
  'style-guide': ['editor.ai.review.styleGuide', 'Check the style guide (adds suggestions)'],
};

const BUILTIN = { selection: SELECTION_LABELS, blocks: BLOCK_LABELS, field: FIELD_LABELS };

/**
 * Visible label of an AI menu entry.
 * @param {Function} t - Translator.
 * @param {import('../../editor/ai-menu.mjs').AiMenuEntry} entry - Entry.
 * @param {'selection'|'blocks'|'field'} scope - Dialog scope.
 * @returns {string} Label.
 */
export const entryLabel = (t, entry, scope) => {
  if (entry.type === 'ask') return t('editor.ai.ask.action', 'Ask AI…');
  if (entry.type === 'review') {
    const [key, text] = REVIEW_LABELS[entry.key] || [null, entry.key];
    return key ? t(key, text) : text;
  }
  if (entry.type === 'custom')
    return entry.output === 'suggestions'
      ? t('editor.ai.custom.suggestions', '{name} (adds suggestions)', { name: entry.name })
      : entry.name;
  const pair = BUILTIN[scope][entry.key];
  return pair ? t(pair[0], pair[1]) : entry.key;
};

import List from '@editorjs/list';
import { ICONS } from './dom';
import { checklistToList, listToChecklist } from './logic.mjs';

/**
 * `checklist` block backed by the maintained @editorjs/list tool (which
 * replaced @editorjs/checklist). Stored data stays the 1.x checklist shape
 * `{ items: [{ text, checked }] }`, so frontends that render checklists keep
 * working; the list style menu is hidden because a checklist stays a checklist.
 */
export class ChecklistTool extends List {
  static get toolbox() {
    return { title: 'Checklist', icon: ICONS.checklist };
  }

  static get conversionConfig() {
    return {
      export: (data) => ((data && data.items) || []).map((item) => item.text || '').join(' '),
      import: (content) => ({ items: [{ text: content, checked: false }] }),
    };
  }

  constructor(options) {
    const data = options.data && Object.keys(options.data).length ? checklistToList(options.data) : {};
    super({
      ...options,
      data,
      config: { ...(options.config || {}), defaultStyle: 'checklist', maxLevel: 1 },
    });
  }

  renderSettings() {
    return [];
  }

  save() {
    return listToChecklist(super.save());
  }
}

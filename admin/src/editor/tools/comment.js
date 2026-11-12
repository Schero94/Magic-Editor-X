import { el } from './dom';

/** Speech-bubble icon of the "Comment" inline tool. */
const ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h16v11h-8l-5 4v-4H4V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/**
 * Range comments (2.4): the "Comment" button of the inline toolbar. It does
 * not change the text: it hands the selection to the editor field
 * (`config.onComment`), which builds the anchor and opens the comments panel
 * with a new thread on that text. Registered only when the field offers
 * comments and the admin may write them (`buildTools` ctx `onComment`); the
 * button hides itself while comments are not available for the field yet
 * (`config.isAvailable`, for example before an entry is saved).
 */
export class CommentInlineTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return 'Comment';
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    this.button = null;
  }

  render() {
    this.button = el('button', {
      className: this.api.styles.inlineToolButton,
      attrs: { type: 'button', 'data-mex-comment-tool': 'true' },
    });
    this.button.innerHTML = ICON;
    this.syncAvailability();
    return this.button;
  }

  /** Hides the button while the field cannot take comments. */
  syncAvailability() {
    if (!this.button) return;
    const available = typeof this.config.isAvailable === 'function' ? this.config.isAvailable() : true;
    this.button.hidden = !available;
  }

  surround(range) {
    if (!range || typeof this.config.onComment !== 'function') return;
    if (!range.toString().trim()) return;
    this.config.onComment({ range: range.cloneRange() });
  }

  checkState() {
    this.syncAvailability();
    return false;
  }
}

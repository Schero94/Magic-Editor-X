/**
 * Optional browser helper for plain HTML output of `renderHtml`: wires the
 * code copy buttons (`code.copyButton`) to the Clipboard API. Not needed with
 * the React or Vue components, which wire the buttons themselves.
 *
 * Browser only, no Node built-ins. Calling it without a DOM does nothing.
 */

/**
 * Copies text with the asynchronous Clipboard API.
 * @param {string} text - Text to copy.
 * @returns {Promise<boolean>} True when the browser accepted the text.
 */
export const copyText = async (text) => {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText)
      return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * Enhances the copy buttons below `root`: a click copies the text of the
 * block's `<code>` element (line-number counters are CSS, not text) and
 * writes the `data-mex-copied` or `data-mex-failed` label into the block's
 * `role="status"` element. Already enhanced buttons are skipped, so calling it
 * again after new content was inserted is safe.
 * @param {ParentNode} [root=document] - Container to search.
 * @returns {() => void} Removes the listeners added by this call.
 * @sideeffect Adds click listeners; writes to the clipboard and the status element on click.
 */
export const enhanceCodeBlocks = (root) => {
  const scope = root || (typeof document === 'undefined' ? null : document);
  if (!scope || typeof scope.querySelectorAll !== 'function') return () => {};
  const cleanups = [];
  for (const button of scope.querySelectorAll('[data-mex-code="copy"] button[data-mex-copy]')) {
    if (button.hasAttribute('data-mex-enhanced')) continue;
    const block = button.closest('[data-mex-code="copy"]');
    const code = block && block.querySelector('pre code');
    const status = block && block.querySelector('[role="status"]');
    if (!code) continue;
    const onClick = async () => {
      const ok = await copyText(code.textContent || '');
      if (status)
        status.textContent = ok
          ? button.getAttribute('data-mex-copied') || 'Copied'
          : button.getAttribute('data-mex-failed') || 'Copy failed';
    };
    button.addEventListener('click', onClick);
    button.setAttribute('data-mex-enhanced', '');
    cleanups.push(() => {
      button.removeEventListener('click', onClick);
      button.removeAttribute('data-mex-enhanced');
    });
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
};

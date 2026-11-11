import { matchesBlockedUri } from '../../../../shared/csp.mjs';
import { el, ICONS } from './dom';

/**
 * Shows a placeholder inside a block when the admin Content Security Policy
 * blocks an embed iframe or an image, instead of an empty frame or a broken
 * image.
 *
 * Detection: the document's `securitypolicyviolation` event
 * (SecurityPolicyViolationEvent: `blockedURI`, `effectiveDirective`,
 * `disposition`), plus the image `error` event, which may arrive before or
 * after the violation. Only enforced violations of `frame-src`/`child-src`
 * (iframes) and `img-src` (images) inside this editor are handled.
 *
 * The placeholder is DOM only: it carries `data-mutation-free="true"`, so
 * Editor.js (2.31) does not treat it as a block change, and stored block data
 * is never touched. The blocked element stays in place, hidden by CSS
 * (`.mex-csp-blocked + iframe/img`).
 *
 * @param {HTMLElement} holder - Editor holder.
 * @param {{ t: Function, settingsHref?: string|null, onOpenSettings?: Function }} options - Translate function; settings link (omitted when the user cannot open the settings) and an in-app navigation callback.
 * @returns {{ destroy: Function }} Guard.
 */
export const createCspGuard = (holder, options) => {
  const { t, settingsHref = null, onOpenSettings = null } = options;
  const violations = [];
  const timers = new Set();
  let destroyed = false;

  const kindOf = (directive) => {
    if (directive === 'frame-src' || directive === 'child-src') return 'frame';
    if (directive === 'img-src') return 'image';
    return null;
  };

  const placeholder = (kind, url) => {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      host = '';
    }
    const title =
      kind === 'frame'
        ? t('tools.csp.embedBlocked', 'This embed is blocked by your Content Security Policy.')
        : t('tools.csp.imageBlocked', 'This image is blocked by your Content Security Policy.');
    const body = host
      ? t(
          'tools.csp.hostBlocked',
          'The admin does not allow content from {host}. The block is saved unchanged and still appears on your website.',
          { host }
        )
      : t(
          'tools.csp.blockedGeneric',
          'The admin does not allow this content. The block is saved unchanged and still appears on your website.'
        );
    const icon = el('span', { className: 'mex-csp-blocked__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = ICONS.alert;
    const text = el('div', {
      className: 'mex-csp-blocked__text',
      children: [
        el('p', { className: 'mex-csp-blocked__title', text: title }),
        el('p', { className: 'mex-csp-blocked__body', text: body }),
      ],
    });
    if (settingsHref) {
      const link = el('a', {
        className: 'mex-csp-blocked__link',
        text: t('tools.csp.howTo', 'How to allow it'),
        attrs: { href: settingsHref },
      });
      link.addEventListener('click', (event) => {
        if (!onOpenSettings || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenSettings();
      });
      text.appendChild(link);
    } else {
      text.appendChild(
        el('p', {
          className: 'mex-csp-blocked__body',
          text: t('tools.csp.askAdmin', 'Ask an administrator to allow it in the Content Security Policy.'),
        })
      );
    }
    return el('div', {
      className: 'mex-csp-blocked',
      attrs: { role: 'note', contenteditable: 'false', 'data-mutation-free': 'true' },
      children: [icon, text],
    });
  };

  const mark = (element, kind) => {
    const previous = element.previousElementSibling;
    if (previous && previous.classList.contains('mex-csp-blocked')) return;
    if (!element.parentNode) return;
    element.parentNode.insertBefore(placeholder(kind, element.getAttribute('src') || ''), element);
  };

  const scan = (kind, blockedUri) => {
    const selector = kind === 'frame' ? 'iframe' : 'img';
    holder.querySelectorAll(selector).forEach((element) => {
      if (matchesBlockedUri(element.src, blockedUri)) mark(element, kind);
    });
  };

  const onViolation = (event) => {
    if (destroyed || event.disposition === 'report') return;
    const kind = kindOf(event.effectiveDirective || event.violatedDirective);
    if (!kind || !event.blockedURI) return;
    violations.push({ kind, uri: event.blockedURI });
    if (violations.length > 100) violations.shift();
    scan(kind, event.blockedURI);
  };

  const checkImage = (image) => {
    if (destroyed || !holder.contains(image)) return false;
    const hit = violations.find((entry) => entry.kind === 'image' && matchesBlockedUri(image.src, entry.uri));
    if (hit) mark(image, 'image');
    return Boolean(hit);
  };

  // The violation can be dispatched after the error event; look again shortly.
  const onError = (event) => {
    const image = event.target;
    if (!image || image.tagName !== 'IMG' || checkImage(image)) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      checkImage(image);
    }, 150);
    timers.add(timer);
  };

  document.addEventListener('securitypolicyviolation', onViolation);
  holder.addEventListener('error', onError, true);

  return {
    destroy() {
      destroyed = true;
      document.removeEventListener('securitypolicyviolation', onViolation);
      holder.removeEventListener('error', onError, true);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    },
  };
};

export default createCspGuard;

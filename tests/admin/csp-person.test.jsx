/**
 * 2.7.8 re-audit (minor): a blocked person photo put the CSP notice inside the 72 px photo circle.
 * The notice now takes its own row in the person card (like the link card fix), the photo is hidden.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCspGuard } from '../../admin/src/editor/tools/csp-guard.js';

test('blocked person photo: notice in its own row of the card, photo hidden, once', () => {
  const holder = document.createElement('div');
  holder.innerHTML = `<div class="mex-person"><div class="mex-person__photo"><img src="https://cdn.example.test/p.png"></div><div class="mex-person__body"></div></div>`;
  document.body.append(holder);
  const guard = createCspGuard(holder, { t: (_id, text) => text });
  const fire = () => {
    const event = new Event('securitypolicyviolation');
    Object.assign(event, {
      disposition: 'enforce',
      effectiveDirective: 'img-src',
      blockedURI: 'https://cdn.example.test/p.png',
    });
    document.dispatchEvent(event);
  };
  fire();
  fire();
  const card = holder.querySelector('.mex-person');
  const notices = card.querySelectorAll(':scope > .mex-csp-blocked');
  assert.equal(notices.length, 1);
  assert.equal(holder.querySelector('.mex-person__photo .mex-csp-blocked'), null);
  assert.ok(holder.querySelector('.mex-person__photo img').classList.contains('mex-csp-hidden'));
  guard.destroy();
  holder.remove();
});

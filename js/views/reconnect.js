// Getting a new Life360 session without leaving the map.
//
// Life360 keeps one phone signed in per account, so opening the real app on the phone ends
// the session this server uses. The server renews it by itself with a remembered password;
// otherwise it asks Life360 for a code and we collect it here.

import { post } from '../api.js';
import { busy, clear, h, icon, toast } from '../dom.js';

/** Small centered dialog. Returns { body, close }. */
export function modal(title, { onClose } = {}) {
  const body = h('div', { class: 'stack' });
  const el = h(
    'div',
    { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal' }, h('h2', { text: title }), body),
  );
  const onKey = (e) => e.key === 'Escape' && close();
  function close() {
    document.removeEventListener('keydown', onKey);
    el.remove();
    onClose?.();
  }
  el.addEventListener('click', (e) => e.target === el && close());
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  return { el, body, close };
}

/** Ask for the code Life360 just sent; on success the account is connected again. */
export function codeDialog(app, { sentTo = '', onVerified } = {}) {
  const { body, close } = modal('Life360 sent you a code');
  const err = h('div', { class: 'form-error', role: 'alert' });
  const code = h('input', {
    class: 'input num',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    placeholder: '123456',
    maxlength: 8,
    enterkeyhint: 'done',
    'aria-label': 'Verification code',
  });
  const verifyBtn = h('button', { class: 'btn primary block', type: 'submit', text: 'Verify and continue' });
  const resendBtn = h('button', { class: 'btn ghost block', type: 'button', text: 'Send a new code' });
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    h(
      'div',
      { class: 'notice' },
      icon('info'),
      h('div', {
        text: `Life360 ended this server's session (your phone probably signed in). A code was sent${sentTo ? ` to ${sentTo}` : ''}; enter it to continue.`,
      }),
    ),
    code,
    err,
    verifyBtn,
    resendBtn,
    h('button', { class: 'btn ghost block', type: 'button', text: 'Cancel', onclick: () => close() }),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(verifyBtn, async () => {
      try {
        const res = await post('/api/life360/verify', { code: code.value.trim() });
        app.me.life360 = res.account;
        close();
        toast('Life360 reconnected', 'ok');
        await onVerified?.();
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });
  resendBtn.addEventListener('click', () =>
    busy(resendBtn, async () => {
      err.textContent = '';
      try {
        const res = await post('/api/life360/reconnect', { resend: true });
        if (res.status === 'connected') {
          app.me.life360 = res.account;
          close();
          toast('Life360 reconnected', 'ok');
          await onVerified?.();
        } else toast(`New code sent${res.sentTo ? ` to ${res.sentTo}` : ''}`, 'ok');
      } catch (e2) {
        err.textContent = e2.message;
      }
    }),
  );
  clear(body, form);
  setTimeout(() => code.focus(), 60);
  return close;
}

/**
 * Ask the server for a new session with the saved details. Connected silently with the
 * password, or a code dialog opens; falls back to the full sign-in form.
 */
export async function reconnectFlow(app, { after } = {}) {
  try {
    const res = await post('/api/life360/reconnect');
    if (res.status === 'connected') {
      app.me.life360 = res.account;
      toast('Life360 reconnected', 'ok');
      await after?.();
      return true;
    }
    codeDialog(app, { sentTo: res.sentTo, onVerified: after });
    return false;
  } catch (e) {
    if (e.code === 'reconnect_manual') {
      toast(e.message, 'warn');
      app.showConnect({ fromSettings: true });
    } else toast(e.message, 'error');
    return false;
  }
}

/**
 * Handle the errors an action can get when Life360 ended the session.
 * Returns true when the error was taken care of (dialog opened / sign-in form shown).
 * `retry` runs again once the account is connected.
 */
export function handleLiveError(app, e, retry) {
  if (e?.code === 'reconnect_required') {
    codeDialog(app, { sentTo: e.data?.sentTo, onVerified: retry });
    return true;
  }
  if (e?.code === 'session_lost') {
    reconnectFlow(app, { after: retry });
    return true;
  }
  if (e?.code === 'reconnect_manual') {
    toast(e.message, 'warn');
    app.showConnect({ fromSettings: true });
    return true;
  }
  return false;
}

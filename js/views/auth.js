import { post } from '../api.js';
import { busy, clear, h, icon, toast } from '../dom.js';
import { licenseText } from '../format.js';

export function brand(subtitle) {
  return h(
    'div',
    { class: 'brand' },
    h('div', { class: 'brand-mark' }, icon('logo')),
    h('div', {}, h('h1', { text: 'PosChanger' }), subtitle ? h('p', { text: subtitle }) : null),
  );
}

export function segmented(labels, onChange, active = 0, cls = '') {
  const buttons = labels.map((label, i) =>
    h('button', {
      type: 'button',
      class: `seg-btn${i === active ? ' active' : ''}`,
      text: label,
      onclick: () => {
        set(i);
        onChange(i);
      },
    }),
  );
  const set = (i) => buttons.forEach((b, j) => b.classList.toggle('active', i === j));
  const el = h('div', { class: `seg ${cls}`.trim(), role: 'tablist' }, buttons);
  el.set = set;
  return el;
}

/** Uppercase and group a license key as the user types. */
export function formatKeyInput(input) {
  input.addEventListener('input', () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    const next = (raw.match(/.{1,5}/g) || []).join('-');
    if (next !== input.value) input.value = next;
  });
}

export function renderAuth(root, app, { message = '' } = {}) {
  let mode = 'signin';
  const err = h('div', { class: 'form-error', role: 'alert' });
  const username = h('input', {
    class: 'input',
    name: 'username',
    autocomplete: 'username',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'next',
  });
  const password = h('input', {
    class: 'input',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    enterkeyhint: 'go',
  });
  const license = h('input', {
    class: 'input mono',
    name: 'license',
    autocomplete: 'off',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX',
    enterkeyhint: 'go',
  });
  formatKeyInput(license);
  const licenseField = h('label', { class: 'field hidden' }, h('span', { text: 'License key' }), license);
  const hint = h('p', { class: 'small-print hidden', text: 'You need a license key to create an account. Ask the administrator of this server for one.' });
  const submit = h('button', { class: 'btn primary block', type: 'submit', text: 'Sign in' });

  const seg = segmented(['Sign in', 'Create account'], (i) => {
    mode = i ? 'signup' : 'signin';
    licenseField.classList.toggle('hidden', !i);
    hint.classList.toggle('hidden', !i);
    submit.textContent = i ? 'Create account' : 'Sign in';
    password.autocomplete = i ? 'new-password' : 'current-password';
    password.placeholder = i ? 'At least 8 characters' : '';
    err.textContent = '';
  });

  const form = h(
    'form',
    { class: 'stack lg', novalidate: true },
    seg,
    h('label', { class: 'field' }, h('span', { text: 'Username' }), username),
    h('label', { class: 'field' }, h('span', { text: 'Password' }), password),
    licenseField,
    err,
    submit,
    hint,
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(submit, async () => {
      try {
        const body = { username: username.value.trim(), password: password.value };
        const res =
          mode === 'signup'
            ? await post('/api/auth/register', { ...body, licenseKey: license.value })
            : await post('/api/auth/login', body);
        if (mode === 'signup') toast('Account created', 'ok');
        await app.signedIn(res);
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });

  clear(
    root,
    h(
      'div',
      { class: 'auth' },
      h(
        'div',
        { class: 'auth-box' },
        brand('Control your Life360 location'),
        message ? h('div', { class: 'notice' }, icon('info'), h('div', { text: message })) : null,
        form,
      ),
    ),
  );
  setTimeout(() => username.focus({ preventScroll: true }), 50);
  return { destroy() {} };
}

export function renderExpired(root, app) {
  const err = h('div', { class: 'form-error', role: 'alert' });
  const key = h('input', {
    class: 'input mono',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX',
  });
  formatKeyInput(key);
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Redeem key' });
  const form = h('form', { class: 'stack' }, h('label', { class: 'field' }, h('span', { text: 'New license key' }), key), err, btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(btn, async () => {
      try {
        const res = await post('/api/me/redeem', { licenseKey: key.value });
        app.me.user = res.user;
        toast('License renewed', 'ok');
        await app.refreshMe().catch(() => {});
        app.route();
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });
  clear(
    root,
    h(
      'div',
      { class: 'auth' },
      h(
        'div',
        { class: 'auth-box' },
        brand(app.user ? `Signed in as ${app.user.username}` : ''),
        h(
          'div',
          { class: 'notice warn' },
          icon('warn'),
          h('div', { text: `Your license has expired${app.user ? ` - ${licenseText(app.user.license)}` : ''}. Spoofing is turned off.` }),
        ),
        form,
        h('button', { class: 'btn ghost block', onclick: () => app.signOut() }, icon('logout'), 'Sign out'),
      ),
    ),
  );
  return { destroy() {} };
}

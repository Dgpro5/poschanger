import { post } from '../api.js';
import { busy, clear, h, icon, store, toast } from '../dom.js';
import { brand, segmented } from './auth.js';

// Calling code guessed from the browser language region (editable).
const CALLING_CODES = {
  US: '1', CA: '1', GB: '44', IE: '353', IT: '39', FR: '33', DE: '49', ES: '34', PT: '351', NL: '31', BE: '32',
  CH: '41', AT: '43', SE: '46', NO: '47', DK: '45', FI: '358', PL: '48', AU: '61', NZ: '64', MX: '52', BR: '55',
  AR: '54', IN: '91', ZA: '27', RO: '40', GR: '30', CZ: '420', HU: '36', TR: '90', JP: '81', KR: '82', PH: '63',
};

function guessCallingCode() {
  const region = (navigator.language || '').split('-')[1]?.toUpperCase();
  return CALLING_CODES[region] || '';
}

export function renderConnect(root, app, { fromSettings = false } = {}) {
  let tab = 0;
  let step = 'form';

  const err = h('div', { class: 'form-error', role: 'alert' });

  // --- email / phone + password ---------------------------------------
  const identifier = h('input', {
    class: 'input',
    autocomplete: 'username',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'you@example.com or phone number',
    enterkeyhint: 'next',
  });
  const cc = h('input', { class: 'input num', inputmode: 'numeric', autocomplete: 'tel-country-code', value: guessCallingCode(), placeholder: '39' });
  const ccField = h('label', { class: 'field hidden' }, h('span', { text: 'Country code (+)' }), cc);
  identifier.addEventListener('input', () => {
    const v = identifier.value.trim();
    ccField.classList.toggle('hidden', !(v && !v.includes('@') && /^[+\d\s()-]+$/.test(v)));
  });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', enterkeyhint: 'go' });
  const remember = h('input', { type: 'checkbox', checked: true });
  const rememberRow = h(
    'label',
    { class: 'check hidden' },
    remember,
    h('span', {
      text:
        'Remember the password so PosChanger reconnects by itself. Life360 keeps one phone signed in per account: ' +
        'opening the real app on your phone ends this session. With the password saved (encrypted on the server) it ' +
        'signs in again on its own; without it you are asked for a new code when you switch spoofing on.',
    }),
  );
  password.addEventListener('input', () => rememberRow.classList.toggle('hidden', !password.value));
  const loginBtn = h('button', { class: 'btn primary block', type: 'submit', text: 'Continue' });
  const loginForm = h(
    'form',
    { class: 'stack lg', novalidate: true },
    h('label', { class: 'field' }, h('span', { text: 'Life360 email or phone' }), identifier),
    ccField,
    h('label', { class: 'field' }, h('span', { text: 'Life360 password (optional, recommended)' }), password),
    rememberRow,
    loginBtn,
  );

  // --- one-time code ----------------------------------------------------
  const sentTo = h('div', { class: 'muted' });
  const code = h('input', {
    class: 'input num',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    placeholder: '123456',
    maxlength: 8,
    enterkeyhint: 'done',
  });
  const verifyBtn = h('button', { class: 'btn primary block', type: 'submit', text: 'Verify' });
  const codeForm = h(
    'form',
    { class: 'stack lg hidden', novalidate: true },
    h('div', { class: 'notice' }, icon('info'), sentTo),
    h('label', { class: 'field' }, h('span', { text: 'Verification code' }), code),
    verifyBtn,
    h('button', { type: 'button', class: 'btn ghost block', text: 'Back', onclick: () => setStep('form') }),
  );

  // --- access token -------------------------------------------------------
  const tokenInput = h('textarea', {
    class: 'input',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'Paste the LIFE360_AUTH_TOKEN value',
  });
  const tokenBtn = h('button', { class: 'btn primary block', type: 'submit', text: 'Connect' });
  const tokenForm = h(
    'form',
    { class: 'stack lg hidden', novalidate: true },
    h(
      'ol',
      { class: 'small-print', style: { margin: '0', paddingLeft: '18px' } },
      h('li', {}, 'On a computer, sign in at ', h('a', { href: 'https://life360.com/login', target: '_blank', rel: 'noopener', text: 'life360.com/login' }), '.'),
      h('li', { text: 'Open the developer tools: Application (Storage) > Cookies > life360.com.' }),
      h('li', { text: 'Copy the value of LIFE360_AUTH_TOKEN and paste it below.' }),
    ),
    h('label', { class: 'field' }, h('span', { text: 'Access token' }), tokenInput),
    tokenBtn,
  );

  const seg = segmented(['Email / phone', 'Access token'], (i) => {
    tab = i;
    err.textContent = '';
    render();
  });

  function setStep(s) {
    step = s;
    err.textContent = '';
    render();
    if (s === 'code') setTimeout(() => code.focus(), 50);
  }

  function render() {
    loginForm.classList.toggle('hidden', tab !== 0 || step !== 'form');
    codeForm.classList.toggle('hidden', tab !== 0 || step !== 'code');
    tokenForm.classList.toggle('hidden', tab !== 1);
    seg.classList.toggle('hidden', step === 'code');
  }

  async function connected(res) {
    app.me.life360 = res.account;
    store.remove('pc.skipConnect');
    toast(`Life360 connected as ${res.account.name}`, 'ok');
    app.showMain();
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(loginBtn, async () => {
      try {
        const res = await post('/api/life360/login', {
          identifier: identifier.value.trim(),
          countryCode: cc.value.trim(),
          password: password.value,
          rememberPassword: remember.checked && !!password.value,
        });
        if (res.status === 'code_required') {
          sentTo.textContent = `Life360 sent a verification code${res.sentTo ? ` to ${res.sentTo}` : ''}. Enter it to finish.`;
          setStep('code');
        } else await connected(res);
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });

  codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(verifyBtn, async () => {
      try {
        await connected(await post('/api/life360/verify', { code: code.value.trim() }));
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });

  tokenForm.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(tokenBtn, async () => {
      try {
        await connected(await post('/api/life360/token', { token: tokenInput.value.trim() }));
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  });

  const later = h('button', {
    class: 'btn ghost block',
    text: fromSettings ? 'Cancel' : 'Do it later',
    onclick: () => {
      if (!fromSettings) store.set('pc.skipConnect', true);
      app.showMain();
    },
  });

  clear(
    root,
    h(
      'div',
      { class: 'auth' },
      h(
        'div',
        { class: 'auth-box' },
        brand('Connect your Life360 account'),
        h(
          'p',
          { class: 'small-print' },
          'Enter the e-mail address of your Life360 account (recommended) or your phone number. Like the official ' +
            'app, Life360 sends a one-time code to your verified phone. The server keeps an encrypted session token ' +
            'so it can update your location while your phone is locked, and your e-mail/phone so it can ask for a ' +
            'new code when Life360 ends the session. Add the password if you want it to reconnect without asking you.',
        ),
        seg,
        loginForm,
        codeForm,
        tokenForm,
        err,
        later,
      ),
    ),
  );
  render();
  return { destroy() {} };
}

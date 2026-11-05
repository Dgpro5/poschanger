import { apiBase, del, get, post, put } from '../api.js';
import { busy, clear, h, icon, toast } from '../dom.js';
import * as fmt from '../format.js';
import { formatKeyInput, segmented } from './auth.js';
import { openAdmin } from './admin.js';

/** Full-screen overlay. Returns a close function. */
export function overlay(title, { onClose } = {}) {
  const body = h('div', { class: 'inner' });
  const el = h(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-label': title },
    h(
      'div',
      { class: 'overlay-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('back')),
      h('h2', { text: title }),
    ),
    h('div', { class: 'overlay-body' }, body),
  );
  const onKey = (e) => e.key === 'Escape' && close();
  function close() {
    document.removeEventListener('keydown', onKey);
    el.remove();
    onClose?.();
  }
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  return { el, body, close };
}

function section(title, ...children) {
  return h('section', { class: 'section' }, h('h3', { text: title }), ...children);
}

function row(main, sub, trailing, onclick) {
  return h(
    'div',
    { class: `list-row${onclick ? ' clickable' : ''}`, onclick },
    h('div', { class: 'grow' }, h('div', { text: main }), sub ? h('div', { class: 'sub', text: sub }) : null),
    trailing,
  );
}

function toggle(checked, onChange) {
  const t = h('button', { class: 'toggle', role: 'switch', 'aria-checked': String(checked) });
  t.addEventListener('click', () => {
    const next = t.getAttribute('aria-checked') !== 'true';
    t.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return t;
}

export function openSettings(app, { onSettings } = {}) {
  const { body, close } = overlay('Settings');
  const user = app.user;
  const s = { ...user.settings };

  let saveTimer;
  const save = (patch, { immediate = false } = {}) => {
    Object.assign(s, patch);
    clearTimeout(saveTimer);
    const run = async () => {
      try {
        const res = await put('/api/me/settings', s);
        app.me.user.settings = res.settings;
        onSettings?.();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    if (immediate) run();
    else saveTimer = setTimeout(run, 500);
  };

  // --- account --------------------------------------------------------------
  const licenseRow = row('License', fmt.licenseText(user.license), null);
  const keyInput = h('input', { class: 'input mono', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false' });
  formatKeyInput(keyInput);
  const redeemBtn = h('button', { class: 'btn', text: 'Redeem' });
  redeemBtn.addEventListener('click', () =>
    busy(redeemBtn, async () => {
      try {
        const res = await post('/api/me/redeem', { licenseKey: keyInput.value });
        app.me.user = res.user;
        keyInput.value = '';
        clear(licenseRow.querySelector('.sub'), fmt.licenseText(res.user.license));
        toast('License extended', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    }),
  );
  const canRedeem = !user.license.lifetime;
  const account = section(
    'Account',
    h(
      'div',
      { class: 'list' },
      row(user.username, user.isAdmin ? 'Administrator' : `Member since ${fmt.date(user.createdAt)}`, icon('user')),
      licenseRow,
      canRedeem
        ? h('div', { class: 'list-row column' }, h('div', { class: 'sub', text: 'Extend with a new license key' }), h('div', { class: 'row' }, h('div', { class: 'grow' }, keyInput), redeemBtn))
        : null,
    ),
  );

  // --- life360 ----------------------------------------------------------------
  const l360 = app.me.life360 || { connected: false };
  const l360Box = h('div', { class: 'list' });
  const renderL360 = (acc) => {
    clear(
      l360Box,
      acc.connected
        ? [
            row(
              acc.name || 'Connected',
              [acc.loginHint, acc.platform ? `virtual ${acc.platform === 'ios' ? 'iPhone' : 'Android'}` : '', `since ${fmt.date(acc.connectedAt)}`]
                .filter(Boolean)
                .join(' · '),
              h('span', { class: `pill ${acc.status === 'ok' ? 'ok' : 'bad'}`, text: acc.status === 'ok' ? 'Connected' : 'Session expired' }),
            ),
            acc.status !== 'ok' && acc.lastError ? row('Last error', acc.lastError, null) : null,
            row(
              'Automatic reconnection',
              acc.reconnect === 'password'
                ? 'With the saved password: when your phone signs in to Life360 and ends this session, the server signs in again by itself.'
                : acc.reconnect === 'code'
                  ? 'By code: when Life360 ends the session, switching ON asks Life360 for a code and you type it in. Sign in again with your password to make it fully automatic.'
                  : 'Not available for this connection. Sign in again (e-mail/phone, ideally with the password) to enable it.',
              acc.reconnect === 'password'
                ? h(
                    'button',
                    {
                      class: 'btn sm ghost',
                      onclick: async (e) => {
                        if (!confirm('Forget the saved Life360 password? Reconnecting will then ask for a code.')) return;
                        await busy(e.currentTarget, async () => {
                          try {
                            app.me.life360 = await del('/api/life360/password');
                            renderL360(app.me.life360);
                            toast('Password forgotten', 'ok');
                          } catch (err) {
                            toast(err.message, 'error');
                          }
                        });
                      },
                    },
                    'Forget',
                  )
                : null,
            ),
            h(
              'div',
              { class: 'list-row' },
              h('button', { class: 'btn sm', onclick: () => (close(), app.showConnect({ fromSettings: true })) }, 'Sign in again'),
              h(
                'button',
                {
                  class: 'btn sm danger',
                  onclick: async (e) => {
                    if (!confirm('Disconnect Life360? Spoofing stops and the stored session token is deleted.')) return;
                    await busy(e.currentTarget, async () => {
                      try {
                        await del('/api/life360');
                        app.me.life360 = { connected: false };
                        renderL360(app.me.life360);
                        onSettings?.();
                        toast('Life360 disconnected', 'ok');
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    });
                  },
                },
                'Disconnect',
              ),
            ),
          ]
        : row('Not connected', 'Connect to start changing your location', h('button', { class: 'btn sm primary', onclick: () => (close(), app.showConnect({ fromSettings: true })) }, 'Connect')),
    );
  };
  renderL360(l360);

  // --- preferences ---------------------------------------------------------
  const unitsSeg = segmented(['km/h', 'mph'], (i) => save({ units: i ? 'mph' : 'kmh' }, { immediate: true }), s.units === 'mph' ? 1 : 0, 'small');
  const numInput = (value, min, max, key) => {
    const input = h('input', { class: 'input num', inputmode: 'numeric', value: String(value), style: { width: '92px', textAlign: 'right' } });
    input.addEventListener('change', () => {
      const n = Math.round(Number(input.value));
      if (!Number.isFinite(n)) return;
      const v = Math.min(max, Math.max(min, n));
      input.value = String(v);
      save({ [key]: v });
    });
    return input;
  };
  const batterySeg = segmented(['Auto', 'Fixed', 'Charging'], (i) => save({ batteryMode: ['auto', 'fixed', 'charging'][i] }), ['auto', 'fixed', 'charging'].indexOf(s.batteryMode), 'small');

  const prefs = section(
    'Simulation',
    h(
      'div',
      { class: 'list' },
      h('div', { class: 'list-row' }, h('div', { class: 'grow', text: 'Speed unit' }), h('div', { style: { width: '150px' } }, unitsSeg)),
      row('Update when standing still', 'Seconds between reports to Life360 (10-900)', numInput(s.holdIntervalSec, 10, 900, 'holdIntervalSec')),
      row('Update while driving', 'Seconds between reports to Life360 (1-60). Life360 refreshes members every 10-15 s, so 2-3 s gives a continuous trail', numInput(s.driveIntervalSec, 1, 60, 'driveIntervalSec')),
      row('GPS jitter', 'Small natural wobble when standing still (never while driving)', toggle(s.jitter, (v) => save({ jitter: v }, { immediate: true }))),
      h(
        'div',
        { class: 'list-row column' },
        h('div', {}, 'Battery shown in Life360'),
        h('div', { class: 'sub', text: 'Auto drains slowly and "recharges" at about 20%. Fixed keeps one level.' }),
        batterySeg,
      ),
      row('Battery level', 'Current level (%)', numInput(s.batteryLevel, 1, 100, 'batteryLevel')),
    ),
  );

  // --- activity --------------------------------------------------------------
  const logBox = h('div', { class: 'list log' }, h('div', { class: 'log-item' }, h('span', { class: 'spinner sm' }), h('span', { class: 'faint', text: 'Loading…' })));
  get('/api/activity')
    .then((res) => {
      clear(
        logBox,
        res.items.length
          ? res.items.map((it) =>
              h(
                'div',
                { class: 'log-item' },
                h('span', { class: `dot ${it.level === 'error' ? 'bad' : it.level === 'warn' ? 'warn' : it.level === 'ok' ? 'ok' : ''}` }),
                h('div', { text: it.message }),
                h('time', { text: fmt.dateTime(it.ts) }),
              ),
            )
          : h('div', { class: 'log-item faint', text: 'Nothing yet' }),
      );
    })
    .catch((e) => clear(logBox, h('div', { class: 'log-item faint', text: e.message })));

  // --- phone setup tips ---------------------------------------------------------
  const tips = section(
    'Phone setup',
    h(
      'div',
      { class: 'card stack small-print', style: { color: 'var(--text-2)' } },
      h('div', { text: 'This server acts as a second phone on your Life360 account and reports the fake position for you, even when your phone is locked.' }),
      h(
        'ul',
        { style: { margin: '0', paddingLeft: '18px', display: 'grid', gap: '6px' } },
        h('li', { text: 'Life360 keeps one phone signed in per account: connecting here signs the real app out, and signing in on the real app ends this session. Switch spoofing OFF before using the real app, and ON again afterwards: the session is renewed automatically (with the saved password) or after one code.' }),
        h('li', { text: 'While spoofing is ON, leave the real Life360 app signed out, or it will report your real position in between.' }),
        h('li', { text: 'Life360 marks trips as "drives" only through the driving detection inside the official app, so a simulated drive appears as a moving position, not as a drive report.' }),
      ),
      h('div', { text: 'Life360 does not document what your circle sees in each case, so try your setup once before relying on it.' }),
    ),
  );

  // --- security ----------------------------------------------------------------
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'New password (8+ characters)' });
  const pwBtn = h('button', { class: 'btn', text: 'Change password' });
  pwBtn.addEventListener('click', () =>
    busy(pwBtn, async () => {
      try {
        const res = await post('/api/me/password', { current: cur.value, next: next.value });
        cur.value = '';
        next.value = '';
        toast(res.otherSessionsClosed ? `Password changed - signed out ${res.otherSessionsClosed} other device(s)` : 'Password changed', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    }),
  );
  const security = section('Security', h('div', { class: 'card stack' }, cur, next, pwBtn));

  const signOut = h('button', { class: 'btn block', onclick: () => (close(), app.signOut()) }, icon('logout'), 'Sign out');
  const deleteBtn = h('button', { class: 'btn ghost block', style: { color: '#ff8a8f' } }, icon('trash'), 'Delete my account');
  deleteBtn.addEventListener('click', async () => {
    const pw = prompt('This deletes your account, your Life360 connection and all data on this server. Enter your password to confirm:');
    if (!pw) return;
    try {
      await del('/api/me', { password: pw });
      close();
      toast('Account deleted', 'ok');
      app.signOut();
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  clear(
    body,
    account,
    section('Life360', l360Box),
    prefs,
    tips,
    section('Activity', logBox),
    security,
    user.isAdmin
      ? section('Administration', h('div', { class: 'list' }, row('Admin panel', 'License keys and users', icon('chevron'), () => openAdmin(app))))
      : null,
    h('div', { class: 'stack' }, signOut, deleteBtn),
    h('p', { class: 'small-print', style: { textAlign: 'center' }, text: `PosChanger · server ${apiBase || location.host}` }),
  );
  return close;
}

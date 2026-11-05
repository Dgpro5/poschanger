import { del, get, post, put } from '../api.js';
import { busy, clear, copyText, h, icon, toast } from '../dom.js';
import * as fmt from '../format.js';
import { segmented } from './auth.js';
import { overlay } from './settings.js';

export function openAdmin(app) {
  const { body } = overlay('Admin');

  // --- generate keys -----------------------------------------------------------
  const count = h('input', { class: 'input num', inputmode: 'numeric', value: '1' });
  const days = h('input', { class: 'input num', inputmode: 'numeric', value: '30', placeholder: 'empty = lifetime' });
  const uses = h('input', { class: 'input num', inputmode: 'numeric', value: '1' });
  const note = h('input', { class: 'input', placeholder: 'Note (who is it for?)', maxlength: 200 });
  const genBtn = h('button', { class: 'btn primary block' }, icon('key'), 'Generate keys');
  const generated = h('div', { class: 'stack' });
  genBtn.addEventListener('click', () =>
    busy(genBtn, async () => {
      try {
        const res = await post('/api/admin/licenses', {
          count: Number(count.value) || 1,
          durationDays: days.value.trim() === '' ? null : Number(days.value),
          maxUses: Number(uses.value) || 1,
          note: note.value.trim(),
        });
        const keys = res.licenses.map((l) => l.key);
        clear(
          generated,
          h(
            'div',
            { class: 'list' },
            keys.map((k) => h('div', { class: 'list-row' }, h('div', { class: 'grow key', text: k }), h('button', { class: 'btn sm', onclick: () => copyText(k) }, icon('copy')))),
          ),
          keys.length > 1 ? h('button', { class: 'btn block', onclick: () => copyText(keys.join('\n')) }, icon('copy'), `Copy all ${keys.length} keys`) : null,
        );
        loadKeys();
      } catch (e) {
        toast(e.message, 'error');
      }
    }),
  );

  const genSection = h(
    'section',
    { class: 'section' },
    h('h3', { text: 'New license keys' }),
    h(
      'div',
      { class: 'card stack' },
      h(
        'div',
        { class: 'grid-3' },
        h('label', { class: 'field' }, h('span', { text: 'How many' }), count),
        h('label', { class: 'field' }, h('span', { text: 'Days' }), days),
        h('label', { class: 'field' }, h('span', { text: 'Uses each' }), uses),
      ),
      note,
      h('p', { class: 'small-print', style: { margin: 0 }, text: 'Leave "Days" empty for lifetime keys. A key creates one account (or extends an existing one) per use.' }),
      genBtn,
      generated,
    ),
  );

  // --- keys list ---------------------------------------------------------------
  let filter = 0;
  let allKeys = [];
  const keysBox = h('div', { class: 'list' });
  const keyState = (l) => (l.revoked ? 'revoked' : l.uses >= l.max_uses ? 'used' : 'available');
  const renderKeys = () => {
    const wanted = ['available', 'used', 'revoked', null][filter];
    const list = allKeys.filter((l) => !wanted || keyState(l) === wanted);
    clear(
      keysBox,
      list.length
        ? list.map((l) => {
            const st = keyState(l);
            return h(
              'div',
              { class: 'list-row' },
              h(
                'div',
                { class: 'grow' },
                h('div', { class: 'key', text: l.key }),
                h(
                  'div',
                  { class: 'sub', style: { display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center', marginTop: '4px' } },
                  h('span', { class: `pill ${st === 'available' ? 'ok' : st === 'revoked' ? 'bad' : ''}`, text: st }),
                  [
                    l.duration_days ? `${l.duration_days} days` : 'lifetime',
                    `uses ${l.uses}/${l.max_uses}`,
                    l.redeemed_by ? `by ${l.redeemed_by}` : '',
                    l.note,
                    fmt.date(l.created_at),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              st === 'available' ? h('button', { class: 'btn sm', 'aria-label': 'Copy key', onclick: () => copyText(l.key) }, icon('copy')) : null,
              !l.revoked
                ? h(
                    'button',
                    {
                      class: 'btn sm ghost',
                      'aria-label': 'Revoke key',
                      onclick: async () => {
                        if (!confirm(`Revoke ${l.key}? It can no longer be used to create or extend accounts.`)) return;
                        try {
                          await post(`/api/admin/licenses/${l.id}/revoke`);
                          loadKeys();
                        } catch (e) {
                          toast(e.message, 'error');
                        }
                      },
                    },
                    icon('close'),
                  )
                : l.uses === 0
                  ? h(
                      'button',
                      {
                        class: 'btn sm ghost',
                        'aria-label': 'Delete key',
                        onclick: async () => {
                          try {
                            await del(`/api/admin/licenses/${l.id}`);
                            loadKeys();
                          } catch (e) {
                            toast(e.message, 'error');
                          }
                        },
                      },
                      icon('trash'),
                    )
                  : null,
            );
          })
        : h('div', { class: 'list-row faint', text: 'No keys' }),
    );
  };
  const loadKeys = () =>
    get('/api/admin/licenses')
      .then((res) => {
        allKeys = res.licenses;
        renderKeys();
      })
      .catch((e) => toast(e.message, 'error'));

  const keysSection = h(
    'section',
    { class: 'section stack' },
    h('h3', { text: 'License keys', style: { margin: 0 } }),
    segmented(['Available', 'Used', 'Revoked', 'All'], (i) => ((filter = i), renderKeys()), 0, 'small'),
    keysBox,
  );

  // --- users -------------------------------------------------------------------
  const usersBox = h('div', { class: 'list' });
  const updateUser = async (u, patch, msg) => {
    try {
      await put(`/api/admin/users/${u.id}`, patch);
      toast(msg, 'ok');
      loadUsers();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const loadUsers = () =>
    get('/api/admin/users')
      .then((res) =>
        clear(
          usersBox,
          res.users.map((u) => {
            const lic = u.is_admin
              ? 'admin'
              : u.license_expires_at === null
                ? 'lifetime'
                : u.license_expires_at > Date.now()
                  ? `until ${fmt.date(u.license_expires_at)}`
                  : `expired ${fmt.date(u.license_expires_at)}`;
            return h(
              'div',
              { class: 'list-row column' },
              h(
                'div',
                { class: 'row' },
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { text: u.username }),
                  h('div', {
                    class: 'sub',
                    text: [
                      lic,
                      u.life360_name ? `Life360: ${u.life360_name}${u.life360_status !== 'ok' ? ' (expired)' : ''}` : 'Life360 not connected',
                      u.last_seen_at ? `seen ${fmt.dateTime(u.last_seen_at)}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }),
                ),
                u.spoofing ? h('span', { class: 'pill ok', text: 'live' }) : null,
                u.disabled ? h('span', { class: 'pill bad', text: 'disabled' }) : null,
              ),
              u.is_admin && u.id === app.user.id
                ? null
                : h(
                    'div',
                    { class: 'row wrap' },
                    !u.is_admin && u.license_expires_at !== null
                      ? h('button', { class: 'btn sm', onclick: () => updateUser(u, { addDays: 30 }, `${u.username}: +30 days`) }, '+30 days')
                      : null,
                    !u.is_admin && u.license_expires_at !== null
                      ? h('button', { class: 'btn sm', onclick: () => updateUser(u, { lifetime: true }, `${u.username}: lifetime`) }, 'Lifetime')
                      : null,
                    h(
                      'button',
                      { class: 'btn sm', onclick: () => updateUser(u, { disabled: !u.disabled }, `${u.username} ${u.disabled ? 'enabled' : 'disabled'}`) },
                      u.disabled ? 'Enable' : 'Disable',
                    ),
                    h(
                      'button',
                      {
                        class: 'btn sm ghost',
                        style: { color: '#ff8a8f' },
                        onclick: async () => {
                          if (!confirm(`Delete ${u.username} and all their data?`)) return;
                          try {
                            await del(`/api/admin/users/${u.id}`);
                            loadUsers();
                          } catch (e) {
                            toast(e.message, 'error');
                          }
                        },
                      },
                      'Delete',
                    ),
                  ),
            );
          }),
        ),
      )
      .catch((e) => toast(e.message, 'error'));

  clear(body, genSection, keysSection, h('section', { class: 'section' }, h('h3', { text: 'Users' }), usersBox));
  loadKeys();
  loadUsers();
}

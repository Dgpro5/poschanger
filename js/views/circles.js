// Life360 circles on the map: a chip at the top left to choose the circles, and the
// members of those circles as markers (tap one: teleport there or drive there).
/* global L */

import { get, put } from '../api.js';
import { clear, h, icon, show, toast } from '../dom.js';
import * as fmt from '../format.js';
import { memberMarker } from '../map.js';
import { reconnectFlow } from './reconnect.js';

const POLL_MS = 15_000;

const initials = (m) => `${(m.firstName || '')[0] || ''}${(m.lastName || '')[0] || ''}`.toUpperCase() || '?';

export function avatarEl(m, cls = 'avatar') {
  const el = h('div', { class: cls }, h('span', { text: initials(m) }));
  if (m.avatar) {
    const img = h('img', { src: m.avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('load', () => el.replaceChildren(img));
  }
  return el;
}

/** "Driving · 52 km/h", "Moving", or "Since 10:32 (1 h 20 min)" */
export function whereText(m, units, now = Date.now()) {
  const loc = m.location;
  if (!loc) return m.sharing === false ? 'Not sharing location' : 'No location yet';
  if (loc.driving || loc.inTransit || (loc.speedKmh ?? 0) > 3) {
    return `${loc.driving ? 'Driving' : 'Moving'}${loc.speedKmh ? ` · ${fmt.speed(loc.speedKmh, units)}` : ''}`;
  }
  if (loc.since) return `Since ${fmt.clock(loc.since)} (${fmt.duration((now - loc.since) / 1000).replace(/ \d+ s$/, '')})`;
  return 'Standing still';
}

export class CirclesControl {
  /** @param {import('./main.js').MainView} main */
  constructor(main) {
    this.main = main;
    this.app = main.app;
    this.circles = [];
    this.selected = this.app.user?.settings?.circles ?? null;
    this.members = [];
    this.fetchedAt = 0;
    this.error = '';
    this.open = false;
    this.markers = new Map();
    this.timer = null;
    this.stopped = false;
    this.build();
  }

  build() {
    this.chipText = h('span', { class: 'chip-text', text: 'Circles' });
    this.chipCount = h('span', { class: 'chip-count hidden' });
    this.chip = h(
      'button',
      { class: 'circle-chip', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => this.toggle() },
      icon('people'),
      this.chipText,
      this.chipCount,
      icon('down', 'caret'),
    );
    this.panelBody = h('div', { class: 'circle-panel-body' });
    this.panel = h('div', { class: 'circle-panel hidden' }, this.panelBody);
    this.el = h('div', { class: 'circles' }, this.chip, this.panel);
    this.onDocClick = (e) => {
      if (this.open && !this.el.contains(e.target)) this.toggle(false);
    };
    document.addEventListener('pointerdown', this.onDocClick);
  }

  start() {
    this.refresh(true);
    this.timer = setInterval(() => !document.hidden && this.refresh(), POLL_MS);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    document.removeEventListener('pointerdown', this.onDocClick);
    for (const mk of this.markers.values()) mk.remove();
    this.markers.clear();
  }

  toggle(force) {
    this.open = force ?? !this.open;
    show(this.panel, this.open);
    this.chip.setAttribute('aria-expanded', String(this.open));
    if (this.open) {
      this.renderPanel();
      if (Date.now() - this.fetchedAt > 5000) this.refresh();
    }
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  async refresh(first = false) {
    if (this.refreshing || this.stopped || !this.app.me?.life360?.connected) return;
    this.refreshing = true;
    try {
      if (first || !this.circles.length) {
        const res = await get('/api/circles');
        this.circles = res.circles;
        this.selected = res.selected;
      }
      const res = await get('/api/circles/members');
      if (this.stopped) return;
      this.members = res.members;
      this.fetchedAt = res.fetchedAt || Date.now();
      this.error = res.failed?.length ? 'Some circles could not be loaded' : '';
    } catch (e) {
      if (this.stopped) return;
      if ([401, 402].includes(e.status)) return;
      this.error = e.message;
      this.sessionLost = e.code === 'session_lost';
    } finally {
      this.refreshing = false;
    }
    this.renderChip();
    this.syncMarkers();
    if (this.open) this.renderPanel();
  }

  visibleCircles() {
    return this.selected === null ? this.circles : this.circles.filter((c) => this.selected.includes(c.id));
  }

  async select(next) {
    this.selected = next;
    this.renderChip();
    this.renderPanel();
    try {
      const res = await put('/api/me/settings', { ...this.app.user.settings, circles: next });
      this.app.me.user.settings = res.settings;
      this.selected = res.settings.circles;
      this.fetchedAt = 0;
      await this.refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  renderChip() {
    const vis = this.visibleCircles();
    let text = 'Circles';
    if (this.circles.length) {
      if (this.selected === null || vis.length === this.circles.length) text = this.circles.length === 1 ? this.circles[0].name : 'All circles';
      else if (vis.length === 0) text = 'No circle';
      else if (vis.length === 1) text = vis[0].name;
      else text = `${vis.length} circles`;
    }
    this.chipText.textContent = text;
    const n = this.members.filter((m) => !m.isMe && m.location).length;
    this.chipCount.textContent = String(n);
    show(this.chipCount, n > 0);
    this.chip.classList.toggle('warn', !!this.error);
  }

  renderPanel() {
    const units = this.app.units;
    const now = Date.now();
    const circleRows = this.circles.length
      ? [
          h(
            'div',
            { class: 'list-row clickable', onclick: () => this.select(null) },
            h('div', { class: 'grow', text: 'All circles' }),
            h('span', { class: `radio${this.selected === null ? ' on' : ''}` }),
          ),
          ...this.circles.map((c) =>
            h(
              'div',
              {
                class: 'list-row clickable',
                onclick: () => {
                  const cur = this.selected === null ? this.circles.map((x) => x.id) : [...this.selected];
                  const next = cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id];
                  this.select(next.length === this.circles.length ? null : next);
                },
              },
              h('span', { class: 'circle-dot', style: c.color ? { background: c.color } : {} }),
              h('div', { class: 'grow' }, h('div', { text: c.name }), c.memberCount ? h('div', { class: 'sub', text: `${c.memberCount} members` }) : null),
              h('span', { class: `check-box${this.selected === null || this.selected.includes(c.id) ? ' on' : ''}` }, icon('check')),
            ),
          ),
        ]
      : [h('div', { class: 'list-row faint', text: this.error || 'Loading circles…' })];

    const people = this.members.filter((m) => !m.isMe);
    const me = this.members.find((m) => m.isMe);
    const memberRow = (m) =>
      h(
        'div',
        { class: `list-row clickable member-row${m.location ? '' : ' faint'}`, onclick: () => this.focusMember(m) },
        avatarEl(m),
        h(
          'div',
          { class: 'grow' },
          h(
            'div',
            { class: 'row between' },
            h('span', { class: 'grow', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text: m.isMe ? `${m.firstName || 'You'} (you)` : m.name }),
            m.location?.battery !== null && m.location?.battery !== undefined ? h('span', { class: 'sub num', text: `${m.location.battery}%` }) : null,
          ),
          h('div', {
            class: 'sub',
            text: m.location
              ? [m.isMe ? 'Life360 shows you at' : '', m.location.place || m.location.address, whereText(m, units, now)].filter(Boolean).join(' · ')
              : whereText(m, units, now),
          }),
        ),
        m.location ? icon('chevron') : null,
      );

    clear(
      this.panelBody,
      h('div', { class: 'label', text: 'Show on the map' }),
      h('div', { class: 'list' }, circleRows),
      h(
        'div',
        { class: 'row between' },
        h('div', { class: 'label', text: people.length ? `People (${people.length})` : 'People' }),
        h('button', { class: 'btn sm ghost', 'aria-label': 'Refresh', onclick: () => ((this.fetchedAt = 0), this.refresh(true)) }, icon('refresh')),
      ),
      this.error && this.sessionLost
        ? h(
            'div',
            { class: 'notice error' },
            icon('warn'),
            h('div', { class: 'grow', text: 'Life360 ended the session.' }),
            h('button', { class: 'btn sm', onclick: () => reconnectFlow(this.app, { after: () => this.refresh(true) }) }, 'Reconnect'),
          )
        : this.error
          ? h('div', { class: 'notice warn' }, icon('warn'), h('div', { text: this.error }))
          : null,
      h(
        'div',
        { class: 'list' },
        people.length ? people.map(memberRow) : h('div', { class: 'list-row faint', text: this.circles.length ? 'Nobody else in the selected circles' : '' }),
        me ? memberRow(me) : null,
      ),
      this.fetchedAt ? h('div', { class: 'small-print', text: `Updated ${fmt.ago(this.fetchedAt, now)} · refreshes every 15 s` }) : null,
    );
  }

  // -------------------------------------------------------------------------
  // Map
  // -------------------------------------------------------------------------

  syncMarkers() {
    const map = this.main.map;
    const seen = new Set();
    for (const m of this.members) {
      if (!m.location) continue;
      seen.add(m.id);
      let mk = this.markers.get(m.id);
      if (!mk) {
        mk = memberMarker(m, (mm) => this.showPopup(mm));
        mk.addTo(map);
        this.markers.set(m.id, mk);
      } else mk.setMember(m);
    }
    for (const [id, mk] of this.markers) {
      if (!seen.has(id)) {
        mk.remove();
        this.markers.delete(id);
      }
    }
  }

  focusMember(m) {
    if (!m.location) return toast(`${m.firstName || m.name} is not sharing a location`, 'warn');
    this.toggle(false);
    this.main.setFollow(false);
    this.main.focus(m.location.lat, m.location.lon, Math.max(this.main.map.getZoom(), 15));
    this.showPopup(m);
  }

  showPopup(m) {
    const loc = m.location;
    if (!loc) return;
    const units = this.app.units;
    const place = { lat: loc.lat, lon: loc.lon, name: loc.place || loc.address || `${m.firstName || m.name}'s position`, detail: loc.address || fmt.coords(loc.lat, loc.lon) };
    const content = h(
      'div',
      { class: 'member-pop' },
      h(
        'div',
        { class: 'row' },
        avatarEl(m),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'place-name', text: m.isMe ? `${m.firstName || 'You'} (you)` : m.name }),
          h('div', { class: 'place-detail', text: whereText(m, units) }),
        ),
      ),
      h('div', { class: 'place-detail', text: [loc.place, loc.address].filter(Boolean).join(' · ') || fmt.coords(loc.lat, loc.lon) }),
      h('div', {
        class: 'small-print',
        text: [
          loc.at ? `Updated ${fmt.ago(loc.at)}` : '',
          loc.battery !== null && loc.battery !== undefined ? `Battery ${loc.battery}%${loc.charging ? ' (charging)' : ''}` : '',
          loc.accuracy ? `±${Math.round(loc.accuracy)} m` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      }),
      m.isMe
        ? h('div', { class: 'small-print', text: 'This is where Life360 currently shows you to your circles.' })
        : h(
            'div',
            { class: 'grid-2' },
            h('button', { class: 'btn sm', onclick: () => (this.closePopup(), this.main.teleportTo(place)) }, icon('bolt'), 'Teleport here'),
            h('button', { class: 'btn sm', onclick: () => (this.closePopup(), this.main.driveTo(place)) }, icon('car'), 'Drive here'),
          ),
    );
    this.popup?.remove();
    this.popup = L.popup({ closeButton: true, autoPan: true, autoPanPadding: [40, 120], maxWidth: 300, className: 'dark-popup' })
      .setLatLng([loc.lat, loc.lon])
      .setContent(content)
      .openOn(this.main.map);
  }

  closePopup() {
    this.popup?.remove();
    this.popup = null;
  }
}

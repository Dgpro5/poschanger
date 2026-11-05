/* global L */
import { get, post, put } from '../api.js';
import { batteryIcon, busy, clear, h, icon, show, store, toast } from '../dom.js';
import * as fmt from '../format.js';
import { carMarker, createMap, pinMarker, routeLine } from '../map.js';
import { speedChart } from '../chart.js';
import { driveElapsed, preparePlan, samplePlan } from '../shared/motion.js';
import { segmented } from './auth.js';
import { CirclesControl } from './circles.js';
import { handleLiveError, reconnectFlow } from './reconnect.js';
import { openSettings } from './settings.js';
import { legText, TripPanel } from './trip.js';

const POLL_MS = 2000;

export class MainView {
  constructor(root, app) {
    this.app = app;
    this.state = null;
    this.clockOffset = 0;
    this.tab = store.get('pc.tab', 'teleport') === 'drive' ? 'drive' : 'teleport';
    this.selected = null;
    this.plan = null;
    this.planLayer = null;
    this.activeChart = null;
    this.follow = true;
    this.lastUi = 0;
    this.lastFollow = 0;
    this.lastPosKey = '';
    this.dismissedDrive = store.get('pc.dismissedDrive', '');
    this.dismissedTrip = store.get('pc.dismissedTrip', '');
    this.destroyed = false;

    this.build(root);
    this.initMap();
    this.trip = new TripPanel(this);
    this.drivePanel.append(this.doneBox, this.trip.stayBox, this.activeBox, this.trip.el);
    this.circles = new CirclesControl(this);
    this.root.append(this.circles.el);
    this.render();
    this.refresh(true);
    this.circles.start();
    this.pollTimer = setInterval(() => !document.hidden && this.refresh(), POLL_MS);
    this.onVis = () => !document.hidden && this.refresh();
    document.addEventListener('visibilitychange', this.onVis);
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.pollTimer);
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVis);
    this.circles?.stop();
    this.trip?.destroy();
    this.ro?.disconnect();
    this.map?.remove();
  }

  get units() {
    return this.app.units;
  }

  // =========================================================================
  // DOM
  // =========================================================================

  build(root) {
    this.mapEl = h('div', { class: 'map' });

    this.switchLabel = h('span', { class: 'switch-label', text: 'OFF' });
    this.switchBtn = h(
      'button',
      { class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Spoofing on or off', onclick: () => this.toggle() },
      h('span', { class: 'switch-track' }, h('span', { class: 'switch-knob' })),
      this.switchLabel,
    );
    const topbar = h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'brand-mini' }, h('div', { class: 'brand-mark' }, icon('logo')), h('span', { text: 'PosChanger' })),
      this.switchBtn,
      h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => this.openSettings() }, icon('gear')),
    );

    this.hint = h('div', { class: 'map-hint hidden' });
    this.followBtn = h('button', { class: 'icon-btn on', 'aria-label': 'Center on the fake position', onclick: () => this.recenter() }, icon('target'));
    this.gpsBtn = h('button', { class: 'icon-btn', 'aria-label': 'Use my real GPS position', onclick: () => this.useGps() }, icon('locate'));
    const fabs = h('div', { class: 'map-fabs' }, this.followBtn, this.gpsBtn);

    this.statusDot = h('span', { class: 'dot' });
    this.statusText = h('div', { class: 'status-text', text: 'Loading…' });
    this.batteryEl = h('div', { class: 'battery' });
    const head = h(
      'div',
      { class: 'sheet-head', onclick: () => this.sheet.classList.toggle('collapsed') },
      h('div', { class: 'sheet-handle' }),
      h('div', { class: 'status-line' }, this.statusDot, this.statusText, this.batteryEl),
    );

    this.banner = h('div', { class: 'stack hidden' });
    this.tabs = segmented(['Teleport', 'Drive'], (i) => this.setTab(i ? 'drive' : 'teleport'), this.tab === 'drive' ? 1 : 0);
    this.teleportPanel = this.buildTeleport();
    this.activeBox = h('div', { class: 'stack hidden' });
    this.doneBox = h('div', { class: 'stack hidden' });
    this.drivePanel = h('div', { class: 'stack' });
    this.body = h('div', { class: 'sheet-body' }, this.banner, this.tabs, this.teleportPanel, this.drivePanel);
    this.sheet = h('section', { class: 'sheet', 'aria-label': 'Controls' }, head, this.body);

    this.root = h('main', { class: 'main' }, this.mapEl, topbar, this.hint, fabs, this.sheet);
    clear(root, this.root);

    this.ro = new ResizeObserver(() => this.root.style.setProperty('--sheet-h', `${this.sheet.offsetHeight}px`));
    this.ro.observe(this.sheet);
  }

  searchBox({ placeholder, onPick }) {
    const input = h('input', {
      class: 'input has-lead',
      type: 'search',
      placeholder,
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      enterkeyhint: 'search',
    });
    const results = h('div', { class: 'results' });
    let timer;
    let seq = 0;
    const run = async (q) => {
      const my = ++seq;
      if (q.trim().length < 3) return clear(results);
      clear(results, h('div', { class: 'empty', text: 'Searching…' }));
      try {
        const c = this.map.getCenter();
        const res = await get(`/api/geo/search?q=${encodeURIComponent(q.trim())}&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`);
        if (my !== seq) return;
        clear(
          results,
          res.results.length
            ? res.results.map((r) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'result',
                    onclick: () => {
                      seq++;
                      clear(results);
                      input.value = r.name;
                      input.blur();
                      onPick(r);
                    },
                  },
                  icon('pin'),
                  h('div', { class: 'grow' }, h('div', { class: 'result-name', text: r.name }), h('div', { class: 'result-detail', text: r.detail })),
                ),
              )
            : h('div', { class: 'empty', text: 'No places found' }),
        );
      } catch (e) {
        if (my === seq) clear(results, h('div', { class: 'empty', text: e.message }));
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      if (!input.value.trim()) {
        seq++;
        return clear(results);
      }
      if (this.app.me?.server?.autocomplete !== false) timer = setTimeout(() => run(input.value), 500);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        run(input.value);
      }
    });
    const wrap = h('div', {}, h('div', { class: 'input-wrap' }, icon('search', 'lead'), input), results);
    wrap.input = input;
    wrap.reset = () => {
      seq++;
      input.value = '';
      clear(results);
    };
    return wrap;
  }

  buildTeleport() {
    this.tSearch = this.searchBox({ placeholder: 'Search a place or address', onPick: (r) => this.select(r, true) });
    this.tName = h('div', { class: 'place-name' });
    this.tDetail = h('div', { class: 'place-detail' });
    this.teleportBtn = h('button', { class: 'btn primary block', onclick: () => this.teleport() }, icon('bolt'), 'Teleport here');
    this.tCard = h(
      'div',
      { class: 'card stack hidden' },
      h(
        'div',
        { class: 'place' },
        h('div', { class: 'place-icon' }, icon('pin')),
        h('div', { class: 'grow' }, this.tName, this.tDetail),
        h('button', { class: 'btn sm ghost', 'aria-label': 'Clear', onclick: () => this.clearSelection() }, icon('close')),
      ),
      this.teleportBtn,
    );
    this.tDriveWarn = h('div', { class: 'notice warn hidden' }, icon('warn'), h('div', { text: 'Teleporting cancels the trip in progress.' }));
    return h(
      'div',
      { class: 'stack' },
      this.tSearch,
      this.tCard,
      this.tDriveWarn,
      h('p', {
        class: 'small-print',
        text: 'Tap anywhere on the map, search an address, use the GPS button to start from where you really are, or tap a person from your circles.',
      }),
    );
  }

  // =========================================================================
  // Map
  // =========================================================================

  initMap() {
    this.map = createMap(this.mapEl);
    this.car = carMarker();
    this.pin = pinMarker();
    this.map.on('click', (e) => this.onMapClick(e.latlng));
    this.map.on('dragstart', () => this.setFollow(false));
    setTimeout(() => this.map.invalidateSize(), 100);
  }

  /** Center the map on a point inside the area that is not covered by the sheet. */
  focus(lat, lon, zoom = this.map.getZoom(), { animate = true } = {}) {
    const wide = window.matchMedia('(min-width: 900px)').matches;
    const off = wide ? L.point(-this.sheet.offsetWidth / 2, 0) : L.point(0, Math.max(0, this.sheet.offsetHeight / 2 - 30));
    const center = this.map.unproject(this.map.project([lat, lon], zoom).add(off), zoom);
    if (!animate) this.map.setView(center, zoom, { animate: false });
    else if (zoom !== this.map.getZoom()) this.map.flyTo(center, zoom, { duration: 0.6 });
    else this.map.panTo(center, { animate: true, duration: 0.9, easeLinearity: 1, noMoveStart: true });
  }

  fitPadding() {
    const wide = window.matchMedia('(min-width: 900px)').matches;
    return wide
      ? { paddingTopLeft: [this.sheet.offsetWidth + 40, 80], paddingBottomRight: [40, 40] }
      : { paddingTopLeft: [30, 90], paddingBottomRight: [30, this.sheet.offsetHeight + 30] };
  }

  setFollow(on) {
    this.follow = on;
    this.followBtn.classList.toggle('on', on);
  }

  recenter() {
    this.setFollow(true);
    const p = this.livePosition();
    if (p) this.focus(p.lat, p.lon, Math.max(this.map.getZoom(), 15));
    else toast('No fake position yet - teleport somewhere first');
  }

  livePosition() {
    if (this.plan && this.state?.drive?.status === 'active') {
      return samplePlan(this.plan, driveElapsed(this.state.drive, Date.now() + this.clockOffset));
    }
    return this.state?.position || null;
  }

  /** A drive or trip is running (the planner is hidden). */
  get busyNow() {
    return this.state?.drive?.status === 'active' || this.state?.trip?.status === 'active';
  }

  onMapClick(latlng) {
    // Taps on a repeated world copy or across the 180° line give longitudes outside -180..180.
    const ll = latlng.wrap();
    const p = { lat: ll.lat, lon: ll.lng };
    if (this.tab === 'teleport') return this.select(p);
    if (this.busyNow) return toast('Stop the current trip to plan a new one');
    return this.trip.onMapClick(p);
  }

  /** Fill in the address of a point picked on the map. */
  async describe(p, apply) {
    try {
      const res = await get(`/api/geo/reverse?lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(6)}`);
      if (res.place) apply(res.place);
    } catch {
      /* keep coordinates */
    }
  }

  // =========================================================================
  // Teleport
  // =========================================================================

  select(place, fly = false) {
    const p = { lat: place.lat, lon: place.lon, name: place.name || 'Dropped pin', detail: place.detail || fmt.coords(place.lat, place.lon) };
    this.selected = p;
    this.pin.setLatLng([p.lat, p.lon]).addTo(this.map);
    this.tName.textContent = p.name;
    this.tDetail.textContent = p.detail;
    show(this.tCard, true);
    this.updateHint();
    if (fly) this.focus(p.lat, p.lon, Math.max(this.map.getZoom(), 15));
    if (!place.name) {
      this.describe(p, (d) => {
        if (this.selected !== p) return;
        p.name = d.name;
        p.detail = d.detail || fmt.coords(p.lat, p.lon);
        this.tName.textContent = p.name;
        this.tDetail.textContent = p.detail;
      });
    }
  }

  clearSelection() {
    this.selected = null;
    this.pin.remove();
    show(this.tCard, false);
    this.tSearch.reset();
    this.updateHint();
  }

  async teleport() {
    const p = this.selected;
    if (!p) return;
    const go = async () => {
      const s = await post('/api/teleport', { lat: p.lat, lon: p.lon, address: p.name === 'Dropped pin' ? '' : p.name });
      this.applyState(s);
      this.clearSelection();
      this.clearPlan();
      // A trip preview started from the old position; the server dropped it too.
      if (!this.trip.start) this.trip.invalidatePreview();
      this.setFollow(true);
      this.focus(p.lat, p.lon, Math.max(this.map.getZoom(), 15));
      toast(`Teleported to ${p.name}`, 'ok');
    };
    await busy(this.teleportBtn, async () => {
      try {
        await go();
      } catch (e) {
        if (!handleLiveError(this.app, e, go)) toast(e.message, 'error');
      }
    });
  }

  /** From a member's popup: go there right away. */
  teleportTo(place) {
    this.setTab('teleport');
    this.select(place, true);
    return this.teleport();
  }

  /** From a member's popup: add their position as the next stop of the trip. */
  driveTo(place) {
    if (this.busyNow) return toast('Stop the current trip to plan a new one', 'warn');
    this.setTab('drive');
    this.trip.addStop(place, true);
    this.sheet.classList.remove('collapsed');
    toast(`${place.name} added as stop ${this.trip.stops.length}`, 'ok');
  }

  // =========================================================================
  // Drive in progress (the current leg)
  // =========================================================================

  async loadPlan() {
    try {
      const plan = preparePlan(await get('/api/drive/plan'));
      if (this.destroyed) return;
      this.plan = plan;
      this.planLayer?.remove();
      this.planLayer = null;
      // Legs of a trip are drawn by the trip panel (all of them, with their state).
      if (!this.state?.drive?.tripId) this.planLayer = routeLine(plan.polyline).addTo(this.map);
      this.buildActive();
    } catch (e) {
      if (e.status !== 404) toast(e.message, 'error');
    }
  }

  clearPlan() {
    this.plan = null;
    this.planLayer?.remove();
    this.planLayer = null;
    this.activeChart = null;
    clear(this.activeBox);
    show(this.activeBox, false);
  }

  buildActive() {
    const d = this.state.drive;
    const t = this.state.trip;
    const inTrip = !!d.tripId && t?.id === d.tripId;
    const u = this.units;
    const walk = d.mode === 'walk';
    const leg = inTrip ? t.legs[d.leg] : null;
    const wander = leg?.kind === 'wander';
    this.act = {
      title: h('div', { class: 'place-name' }),
      pill: h('span', { class: 'pill ok', text: 'Live' }),
      bar: h('div'),
      speed: h('div', { class: 'stat-value' }),
      avg: h('div', { class: 'stat-value' }),
      left: h('div', { class: 'stat-value' }),
      eta: h('div', { class: 'stat-value' }),
      pause: h('button', { class: 'btn', onclick: () => this.pauseResume() }),
      stop: h('button', { class: 'btn danger', onclick: () => this.stopDrive() }, icon('stop'), inTrip ? 'Stop trip' : 'Stop here'),
    };
    this.activeChart = speedChart({
      points: this.plan.chart,
      totalKm: d.distance / 1000,
      minKmh: d.minKmh,
      maxKmh: d.maxKmh,
      avgKmh: d.avgKmh,
      units: u,
    });
    const statEl = (label, valueEl) => h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: label }), valueEl);
    const next = inTrip ? t.legs[d.leg + 1] : null;
    const here = inTrip ? t.legs[d.leg] : null;
    clear(
      this.activeBox,
      h(
        'div',
        { class: 'card stack' },
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'place-icon' }, icon(walk ? 'walk' : 'car')),
          h(
            'div',
            { class: 'grow' },
            h('div', {
              class: 'label',
              text: inTrip ? `Step ${d.leg + 1} of ${t.legs.length} · ${wander ? 'walking around' : walk ? 'walking to' : 'driving to'}` : walk ? 'Walking to' : 'Driving to',
            }),
            this.act.title,
          ),
          this.act.pill,
        ),
        h('div', { class: 'progress' }, this.act.bar),
        h(
          'div',
          { class: 'stats' },
          statEl('Speed', this.act.speed),
          statEl('Average so far', this.act.avg),
          statEl('Remaining', this.act.left),
          statEl('Arrival', this.act.eta),
        ),
        this.activeChart.el,
        h('div', { class: 'grid-2' }, this.act.pause, this.act.stop),
        h('div', {
          class: 'small-print',
          text:
            (walk
              ? `Planned: ${fmt.distance(d.distance, u)} on foot · ${fmt.duration(d.duration)} · pace ${fmt.speed(d.targetAvgKmh, u, 1)}`
              : `Planned: ${fmt.distance(d.distance, u)} · ${fmt.duration(d.duration)} · average ${fmt.speed(d.avgKmh, u, 1)} · top ${fmt.speed(d.topKmh, u)}`) +
            (inTrip && next ? ` · then ${here?.stayMin ? `stay ${fmt.duration(here.stayMin * 60)} and ` : ''}${legText(next)}` : ''),
        }),
      ),
    );
    this.act.title.textContent = wander ? leg.wander?.center?.address || fmt.coords(leg.wander.center.lat, leg.wander.center.lon) : d.to?.address || fmt.coords(d.to.lat, d.to.lon);
    this.updatePauseBtn();
    this.render();
  }

  updatePauseBtn() {
    if (!this.act) return;
    const paused = !!this.state?.drive?.pausedAt;
    clear(this.act.pause, icon(paused ? 'play' : 'pause'), paused ? 'Resume' : 'Pause');
    this.act.pill.textContent = paused ? (this.state.enabled ? 'Paused' : 'Off') : 'Live';
    this.act.pill.className = `pill ${paused ? 'warn' : 'ok'}`;
  }

  async pauseResume() {
    const paused = !!this.state?.drive?.pausedAt;
    const go = async () => this.applyState(await post(paused ? '/api/drive/resume' : '/api/drive/pause'));
    await busy(this.act.pause, async () => {
      try {
        await go();
      } catch (e) {
        if (!handleLiveError(this.app, e, go)) toast(e.message, 'error');
      }
    });
    this.updatePauseBtn();
  }

  async stopDrive() {
    await busy(this.act.stop, async () => {
      try {
        const s = await post('/api/drive/stop');
        this.applyState(s);
        this.clearPlan();
        toast(s.trip?.status === 'stopped' ? 'Trip stopped - holding the current position' : 'Drive stopped - holding the current position', 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  updateActive(d, st, tau) {
    const u = this.units;
    const kmh = st.speed * 3.6;
    this.act.speed.replaceChildren(fmt.toDisplaySpeed(kmh, u).toFixed(0), h('small', { text: fmt.unitLabel(u) }));
    const avg = tau > 1 ? (st.s / tau) * 3.6 : 0;
    this.act.avg.replaceChildren(fmt.toDisplaySpeed(avg, u).toFixed(1), h('small', { text: fmt.unitLabel(u) }));
    this.act.left.textContent = fmt.distance(Math.max(0, d.distance - st.s), u);
    this.act.eta.textContent = d.pausedAt ? 'Paused' : fmt.clock(Date.now() + Math.max(0, d.duration - tau) * 1000);
    this.act.bar.style.width = `${(st.progress * 100).toFixed(2)}%`;
    this.activeChart?.setProgress(st.progress, kmh);
  }

  renderDone() {
    const s = this.state;
    const t = s?.trip;
    const d = s?.drive;
    const u = this.units;
    const tripDone = t && t.status !== 'active' && t.id !== this.dismissedTrip;
    const driveDone = !t && d?.status === 'done' && d.id !== this.dismissedDrive;
    const visible = !!(tripDone || driveDone);
    show(this.doneBox, visible);
    const id = tripDone ? `t:${t.id}` : driveDone ? `d:${d.id}` : '';
    if (!visible || this.doneBox.dataset.id === id) return;
    this.doneBox.dataset.id = id;
    let title;
    let detail;
    if (tripDone) {
      const done = t.legs.filter((l) => l.status === 'done').length;
      const last = t.legs[t.legs.length - 1];
      title = t.status === 'done' ? `Trip finished${last?.to?.address ? ` at ${last.to.address}` : ''}` : `Trip stopped after ${done} of ${t.legs.length} step${t.legs.length === 1 ? '' : 's'}`;
      const km = t.legs.filter((l) => l.status === 'done').reduce((a, l) => a + (l.distance || 0), 0);
      const onFoot = t.legs.some((l) => l.mode === 'walk');
      detail = `${t.legs.length} step${t.legs.length === 1 ? '' : 's'} · ${fmt.distance(km, u)} ${onFoot ? 'covered' : 'driven'}${t.finishedAt && t.startedAt ? ` · ${fmt.duration((t.finishedAt - t.startedAt) / 1000)} in all` : ''}`;
    } else {
      title = `Arrived${d.to?.address ? ` at ${d.to.address}` : ''}`;
      detail = `${fmt.distance(d.distance, u)} in ${fmt.duration(d.duration)} · average ${fmt.speed(d.avgKmh, u, 1)} · top ${fmt.speed(d.topKmh, u)}`;
    }
    clear(
      this.doneBox,
      h('div', { class: `notice ${tripDone && t.status !== 'done' ? '' : 'ok'}` }, icon(tripDone && t.status !== 'done' ? 'info' : 'check'), h('div', { class: 'stack', style: { gap: '4px' } }, h('strong', { text: title }), h('div', { text: detail }))),
      h(
        'button',
        {
          class: 'btn block',
          onclick: () => {
            if (tripDone) {
              this.dismissedTrip = t.id;
              store.set('pc.dismissedTrip', t.id);
            } else {
              this.dismissedDrive = d.id;
              store.set('pc.dismissedDrive', d.id);
            }
            this.renderDone();
          },
        },
        'Plan a new trip',
      ),
    );
  }

  // =========================================================================
  // State
  // =========================================================================

  async refresh(first = false) {
    if (this.refreshing || this.destroyed) return;
    this.refreshing = true;
    try {
      const t0 = Date.now();
      const s = await get('/api/state');
      this.clockOffset = s.serverTime - (t0 + Date.now()) / 2;
      this.applyState(s);
      if (first && s.position) {
        this.focus(s.position.lat, s.position.lon, Math.max(this.map.getZoom(), 15), { animate: false });
        if (s.drive?.status === 'active' || s.trip?.status === 'active') this.setTab('drive');
      }
    } catch (e) {
      if (![401, 402].includes(e.status)) this.statusText.textContent = e.message;
    } finally {
      this.refreshing = false;
    }
  }

  applyState(s) {
    if (this.destroyed) return;
    this.state = { ...this.state, ...s };
    if (s.life360) this.app.me.life360 = s.life360;
    const d = this.state.drive;
    if (d?.status === 'active' && this.plan?.id !== d.id && !this.loadingPlan) {
      this.loadingPlan = true;
      this.loadPlan().finally(() => (this.loadingPlan = false));
    } else if (d?.status !== 'active' && this.plan) {
      this.clearPlan();
    }
    this.render();
  }

  render() {
    const s = this.state;
    const u = this.units;
    const on = !!s?.enabled;
    this.switchBtn.setAttribute('aria-checked', String(on));
    this.switchLabel.textContent = on ? 'LIVE' : 'OFF';

    // status line
    const l360 = s?.life360 || this.app.me?.life360;
    const t = s?.trip;
    const staying = t?.status === 'active' && (t.phase === 'wait' || t.phase === 'stay');
    let dot = '';
    let text = [];
    const sent = s?.lastSend ? ` · sent ${fmt.ago(s.lastSend.at, Date.now() + this.clockOffset)}` : '';
    if (!s) text = ['Loading…'];
    else if (!l360?.connected) {
      dot = 'bad';
      text = [b('Not connected'), ' · connect your Life360 account'];
    } else if (!on) {
      text = [b('Off'), ' · Life360 shows your real location'];
    } else if (s.retrying || (s.lastSend && !s.lastSend.ok)) {
      dot = 'warn';
      text = [b('Retrying'), ` · ${s.lastSend?.message || 'waiting for Life360'}`];
    } else if (s.mode === 'drive') {
      dot = 'ok live';
      text = [b(t?.status === 'active' ? `Step ${t.index + 1}/${t.legs.length}` : s.drive?.mode === 'walk' ? 'Walking' : 'Driving'), ` · ${fmt.speed(s.position?.speedKmh || 0, u, s.drive?.mode === 'walk' ? 1 : 0)}`, sent];
    } else if (s.mode === 'paused') {
      dot = 'warn';
      text = [b('Paused'), ' · car stopped', sent];
    } else if (staying) {
      dot = 'ok live';
      text = [b('Staying'), ` · ${s.position?.address || fmt.coords(s.position.lat, s.position.lon)}`, t.phaseUntil ? ` · leaves ${fmt.clock(t.phaseUntil)}` : '', sent];
    } else if (s.position) {
      dot = 'ok live';
      text = [b('Live'), ` · ${s.position.address || fmt.coords(s.position.lat, s.position.lon)}`, sent];
    } else {
      dot = 'warn';
      text = [b('On'), ' · choose a location'];
    }
    this.statusDot.className = `dot ${dot}`;
    this.statusText.replaceChildren(...text);
    if (s?.battery && on) this.batteryEl.replaceChildren(batteryIcon(s.battery.level, s.battery.charging), `${s.battery.level}%`);
    else this.batteryEl.replaceChildren();

    this.renderBanner(l360, s);

    // car marker (static positions; moving positions are animated in frame())
    if (s?.position && !(s.drive?.status === 'active' && this.plan)) {
      const key = `${s.position.lat.toFixed(6)},${s.position.lon.toFixed(6)}`;
      this.car.setLatLng([s.position.lat, s.position.lon]);
      if (!this.car._map) this.car.addTo(this.map);
      this.car.setState({ live: on, moving: false, heading: s.position.heading });
      if (this.lastPosKey && key !== this.lastPosKey && this.follow) this.focus(s.position.lat, s.position.lon);
      this.lastPosKey = key;
    } else if (!s?.position) {
      this.car.remove();
    }

    // panels
    const driving = s?.drive?.status === 'active';
    const busyNow = this.busyNow;
    show(this.teleportPanel, this.tab === 'teleport');
    show(this.drivePanel, this.tab === 'drive');
    show(this.tDriveWarn, busyNow && !!this.selected);
    show(this.trip.el, !busyNow);
    show(this.activeBox, driving && !!this.plan);
    if (driving) this.updatePauseBtn();
    this.trip.render(s);
    this.trip.setVisible(this.tab === 'drive' && !busyNow);
    this.renderDone();
    this.trip.renderList();
    this.updateHint();
  }

  renderBanner(l360, s) {
    const items = [];
    if (s && !l360?.connected) {
      items.push(
        h(
          'div',
          { class: 'notice' },
          icon('link'),
          h('div', { class: 'grow' }, 'Connect your Life360 account to start changing your location.'),
          h('button', { class: 'btn sm primary', onclick: () => this.app.showConnect({ fromSettings: true }) }, 'Connect'),
        ),
      );
    } else if (l360?.status === 'auth_error') {
      const way = l360.reconnect;
      const text =
        way === 'password'
          ? 'Life360 ended the session (your phone signed in?). Switch ON to reconnect automatically.'
          : way === 'code'
            ? 'Life360 ended the session (your phone signed in?). Switch ON or reconnect: a code will be sent.'
            : 'Life360 ended the session (your phone signed in?). Sign in again to continue.';
      items.push(
        h(
          'div',
          { class: 'notice error' },
          icon('warn'),
          h('div', { class: 'grow' }, text),
          h(
            'button',
            {
              class: 'btn sm',
              onclick: (e) => busy(e.currentTarget, () => reconnectFlow(this.app, { after: () => this.refresh() })),
            },
            way === 'none' ? 'Sign in' : 'Reconnect',
          ),
        ),
      );
    }
    const key = items.map((i) => i.textContent).join('|');
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      clear(this.banner, items);
    }
    show(this.banner, items.length > 0);
  }

  updateHint() {
    let text = '';
    if (this.tab === 'teleport' && !this.selected) text = 'Tap the map to choose a spot';
    else if (this.tab === 'drive' && !this.busyNow) text = this.trip.hint();
    this.hint.textContent = text;
    show(this.hint, !!text);
  }

  setTab(tab) {
    this.tab = tab;
    store.set('pc.tab', tab);
    this.tabs.set(tab === 'drive' ? 1 : 0);
    if (tab === 'teleport') this.trip.pickingStart = false;
    this.pin.remove();
    if (tab === 'teleport' && this.selected) this.pin.addTo(this.map);
    this.render();
  }

  // =========================================================================
  // Actions
  // =========================================================================

  async toggle(force) {
    const on = force ?? !this.state?.enabled;
    if (on && !this.state?.life360?.connected) {
      toast('Connect your Life360 account first', 'warn');
      return;
    }
    this.switchBtn.classList.add('busy');
    const go = async () => {
      this.applyState(await put('/api/state/enabled', { enabled: on }));
      toast(on ? 'Spoofing ON - Life360 now sees the fake position' : 'Spoofing OFF - your phone reports your real location again', on ? 'ok' : 'info');
    };
    try {
      await go();
    } catch (e) {
      if (!handleLiveError(this.app, e, go)) toast(e.message, e.code === 'no_position' ? 'warn' : 'error');
    } finally {
      this.switchBtn.classList.remove('busy');
    }
  }

  useGps() {
    if (!navigator.geolocation) return toast('This browser has no GPS access', 'error');
    toast('Getting your real position…', 'info', 2000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          name: 'My real position',
          detail: `Accuracy ±${Math.round(pos.coords.accuracy)} m`,
        };
        this.setFollow(false);
        this.focus(p.lat, p.lon, Math.max(this.map.getZoom(), 16));
        if (this.tab === 'teleport') this.select(p);
        else if (!this.busyNow) this.trip.onGps(p);
      },
      (err) => toast(err.code === 1 ? 'Location permission denied' : 'Could not get your position', 'error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  openSettings() {
    openSettings(this.app, {
      onSettings: () => {
        this.trip.showSpeeds();
        this.trip.invalidatePreview();
        if (this.plan) this.buildActive();
        this.render();
      },
    });
  }

  // =========================================================================
  // Animation
  // =========================================================================

  frame() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const now = Date.now() + this.clockOffset;
    this.trip.tick(now);
    const s = this.state;
    const d = s?.drive;
    if (!d || d.status !== 'active' || !this.plan || this.plan.id !== d.id) return;
    const tau = driveElapsed(d, now);
    const st = samplePlan(this.plan, tau);
    this.car.setLatLng([st.lat, st.lon]);
    if (!this.car._map) this.car.addTo(this.map);
    this.car.setState({ live: s.enabled, moving: !d.pausedAt && st.speed > 0.3, heading: st.heading });
    if (now - this.lastUi > 250 && this.act) {
      this.lastUi = now;
      this.updateActive(d, st, tau);
    }
    if (this.follow && now - this.lastFollow > 1000) {
      this.lastFollow = now;
      this.focus(st.lat, st.lon);
    }
  }
}

function b(text) {
  return h('strong', { text });
}

// Trip builder (Drive tab): a start, an optional wait, and a queue of steps - drive or walk
// to a place (every drive with its own speeds), or walk around an area for a while - each
// followed by a stay. Previews every leg, starts the trip, draws it on the map and shows the
// "staying here" card while the person waits at a stop.
/* global L */

import { get, post } from '../api.js';
import { busy, clear, h, icon, show, store, toast } from '../dom.js';
import * as fmt from '../format.js';
import { areaCircle, routeLine, startMarker, stopMarker } from '../map.js';
import { speedChart } from '../chart.js';
import { segmented } from './auth.js';
import { handleLiveError } from './reconnect.js';

const TRAFFIC = ['auto', 'light', 'normal', 'heavy'];
const DEFAULT_SPEEDS = { min: 30, avg: 50, max: 90 }; // km/h
const DEFAULT_WALK_KMH = 4.5;
const WALK_KMH = { min: 2, max: 8 };
export const MAX_STOPS = 12;
const DEFAULT_STAY_MIN = 10;
const MAX_STAY_MIN = 24 * 60;
const WANDER = { minutes: 30, radiusM: 500, minMin: 1, maxMin: 240, minRadius: 100, maxRadius: 5000 };

const validPlace = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon));
const place = (p) => ({ lat: Number(p.lat), lon: Number(p.lon), name: p.name || 'Dropped pin', detail: p.detail || fmt.coords(Number(p.lat), Number(p.lon)) });
const addressOf = (p) => (p.name === 'Dropped pin' ? '' : p.name);
const coordsOf = (p) => p.address || fmt.coords(p.lat, p.lon);
const isWalk = (s) => s.kind === 'wander' || s.mode === 'walk';

const clampNum = (v, min, max, def) => {
  const raw = String(v ?? '').trim();
  const n = raw === '' ? NaN : Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

function clampStay(v, def = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(MAX_STAY_MIN, Math.round(n * 100) / 100);
}

function minutesInput(value, onChange) {
  const input = h('input', { class: 'input num stay-input', inputmode: 'decimal', value: String(value), 'aria-label': 'Minutes' });
  input.addEventListener('change', () => {
    const v = clampStay(input.value, 0);
    input.value = String(v);
    onChange(v);
  });
  return input;
}

/** "drive to X" / "walk to X" / "walk around X for 20 min" (a leg of a preview or running trip). */
export function legText(l) {
  if (!l) return '';
  if (l.kind === 'wander') return `walk around ${coordsOf(l.wander?.center || l.to)} for ${fmt.duration((l.wander?.minutes || 0) * 60)}`;
  return `${l.mode === 'walk' ? 'walk' : 'drive'} to ${coordsOf(l.to)}`;
}

/** A saved step (any older shape too) -> a complete one. */
function normalizeStep(s, defaults) {
  if (!validPlace(s)) return null;
  const base = { ...place(s), stayMin: clampStay(s.stayMin, DEFAULT_STAY_MIN) };
  const kmh = Math.round(clampNum(s.kmh, WALK_KMH.min, WALK_KMH.max, defaults.kmh) * 10) / 10;
  if (s.kind === 'wander') {
    return {
      ...base,
      kind: 'wander',
      mode: 'walk',
      minutes: clampNum(s.minutes, WANDER.minMin, WANDER.maxMin, WANDER.minutes),
      radiusM: Math.round(clampNum(s.radiusM, WANDER.minRadius, WANDER.maxRadius, WANDER.radiusM)),
      kmh,
      returnToStart: s.returnToStart !== false,
    };
  }
  const sp = s.speeds || {};
  const speeds = ['min', 'avg', 'max'].every((k) => Number.isFinite(Number(sp[k])) && Number(sp[k]) > 0)
    ? { min: Number(sp.min), avg: Number(sp.avg), max: Number(sp.max) }
    : { ...defaults.speeds };
  return { ...base, kind: 'go', mode: s.mode === 'walk' ? 'walk' : 'drive', speeds, kmh };
}

const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value', text: value }));

export class TripPanel {
  /** @param {import('./main.js').MainView} main */
  constructor(main) {
    this.main = main;
    this.app = main.app;
    this.map = main.map;
    this.defaults = {
      speeds: { ...DEFAULT_SPEEDS, ...(store.get('pc.speeds', {}) || {}) },
      kmh: clampNum(store.get('pc.walkKmh'), WALK_KMH.min, WALK_KMH.max, DEFAULT_WALK_KMH),
    };
    const saved = store.get('pc.trip', {}) || {};
    this.stops = (Array.isArray(saved.stops) ? saved.stops : [])
      .map((s) => normalizeStep(s, this.defaults))
      .filter(Boolean)
      .slice(0, MAX_STOPS);
    this.waitMin = clampStay(saved.waitMin, 0);
    this.start = validPlace(saved.start) ? place(saved.start) : null;
    this.traffic = TRAFFIC.includes(store.get('pc.traffic')) ? store.get('pc.traffic') : 'auto';
    this.pickingStart = false;
    this.pickingCenter = -1; // index of the "walk around" step whose centre the next map tap moves
    this.preview = null;
    this.previewLayer = null;
    this.visible = false;
    this.stopMarkers = [];
    this.areas = []; // circles of the "walk around" steps
    this.startMk = startMarker();
    this.route = null; // drawn legs of the running trip
    this.build();
    this.renderList();
    this.syncMarkers();
  }

  destroy() {
    this.clearRoute();
    this.setVisible(false);
  }

  get units() {
    return this.app.units;
  }

  // =========================================================================
  // DOM
  // =========================================================================

  build() {
    this.list = h('div', { class: 'itinerary' });
    this.addSearch = this.main.searchBox({ placeholder: 'Add a stop: search or tap the map', onPick: (r) => this.addStop(r, true) });
    this.wanderBtn = h('button', { class: 'btn block', onclick: () => this.addWander() }, icon('walk'), 'Walk around here for a while');
    this.trafficSeg = segmented(
      ['Auto', 'Light', 'Normal', 'Heavy'],
      (i) => {
        this.traffic = TRAFFIC[i];
        store.set('pc.traffic', this.traffic);
        this.invalidatePreview();
      },
      TRAFFIC.indexOf(this.traffic),
      'small',
    );
    this.previewBtn = h('button', { class: 'btn block', onclick: () => this.previewTrip() }, icon('route'), 'Preview trip');
    this.previewBox = h('div', { class: 'stack hidden' });

    this.el = h(
      'div',
      { class: 'stack' },
      h('div', { class: 'card stack' }, this.list, this.addSearch, this.wanderBtn),
      h('div', { class: 'field' }, h('span', { text: 'Traffic (for the drives)' }), this.trafficSeg),
      h('p', {
        class: 'small-print',
        text:
          'Every drive has its own min / average / max speed: it varies with road type, curves, junctions and rush hour ' +
          'and reaches the stop with the exact average. Walks follow streets and paths at your pace, with the odd pause; ' +
          '"walk around" strolls at random inside the area. After each stay the next step starts by itself.',
      }),
      this.previewBtn,
      this.previewBox,
    );

    // --- staying at a stop -------------------------------------------------
    this.stay = {
      step: h('div', { class: 'label' }),
      title: h('div', { class: 'place-name' }),
      sub: h('div', { class: 'place-detail' }),
      next: h('div', { class: 'small-print' }),
      pill: h('span', { class: 'pill ok', text: 'Live' }),
      leave: h('button', { class: 'btn' }, icon('skip'), 'Leave now'),
      extend: h('button', { class: 'btn' }, icon('clock'), '+10 min'),
      stop: h('button', { class: 'btn danger block' }, icon('stop'), 'Stop trip here'),
    };
    const act = (btn, run) =>
      btn.addEventListener('click', () =>
        busy(btn, async () => {
          try {
            this.main.applyState(await run());
          } catch (e) {
            if (!handleLiveError(this.app, e, run)) toast(e.message, 'error');
          }
        }),
      );
    act(this.stay.leave, () => post('/api/trip/skip'));
    act(this.stay.extend, () => post('/api/trip/extend', { minutes: 10 }));
    act(this.stay.stop, () => post('/api/drive/stop'));
    this.stayBox = h(
      'div',
      { class: 'card stack hidden' },
      h('div', { class: 'row' }, h('div', { class: 'place-icon' }, icon('clock')), h('div', { class: 'grow' }, this.stay.step, this.stay.title, this.stay.sub), this.stay.pill),
      this.stay.next,
      h('div', { class: 'grid-2' }, this.stay.leave, this.stay.extend),
      this.stay.stop,
    );
  }

  renderList() {
    const pos = this.main.state?.position;
    let startName;
    let startDetail;
    if (this.pickingStart) [startName, startDetail] = ['Tap the map to choose the start', 'or use the GPS button'];
    else if (this.start) [startName, startDetail] = [this.start.name, this.start.detail];
    else if (pos) [startName, startDetail] = [pos.address || 'Current fake position', fmt.coords(pos.lat, pos.lon)];
    else [startName, startDetail] = ['No position yet', 'Teleport somewhere or choose a start'];
    const startBtn = h('button', { class: 'btn sm', text: this.pickingStart ? 'Cancel' : this.start ? 'Reset' : 'Change', onclick: () => this.togglePickStart() });
    const rows = [
      h(
        'div',
        { class: 'it-row' },
        h('div', { class: 'it-badge start' }, icon('route')),
        h('div', { class: 'grow' }, h('div', { class: 'label', text: 'From' }), h('div', { class: 'place-name', text: startName }), h('div', { class: 'place-detail', text: startDetail })),
        startBtn,
      ),
      h(
        'div',
        { class: 'it-sub' },
        h('span', { text: 'Wait here' }),
        minutesInput(this.waitMin, (v) => {
          this.waitMin = v;
          this.changed();
        }),
        h('span', { text: 'min before leaving' }),
      ),
    ];
    this.stops.forEach((s, i) => {
      const last = i === this.stops.length - 1;
      const wander = s.kind === 'wander';
      const picking = this.pickingCenter === i;
      rows.push(this.legBlock(s, i));
      const label = wander ? 'Walk around' : last ? (this.stops.length > 1 ? 'Final stop' : 'Destination') : `Stop ${i + 1}`;
      rows.push(
        h(
          'div',
          { class: 'it-row' },
          h('div', { class: `it-badge${isWalk(s) ? ' walk' : ''}`, text: String(i + 1) }),
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'label', text: label }),
            h('div', { class: 'place-name', text: picking ? 'Tap the map to move the centre' : s.name }),
            h('div', { class: 'place-detail', text: picking ? 'of the area to walk around' : wander ? `Area centre · ${s.detail}` : s.detail }),
          ),
          wander ? h('button', { class: 'btn sm ghost', text: picking ? 'Cancel' : 'Centre', 'aria-label': 'Move the area centre', onclick: () => this.togglePickCenter(i) }) : null,
          i > 0 ? h('button', { class: 'btn sm ghost', 'aria-label': 'Move up', onclick: () => this.move(i, -1) }, icon('up')) : null,
          h('button', { class: 'btn sm ghost', 'aria-label': 'Remove step', onclick: () => this.removeStop(i) }, icon('close')),
        ),
      );
      if (!last) {
        rows.push(
          h(
            'div',
            { class: 'it-sub' },
            h('span', { text: 'Stay' }),
            minutesInput(s.stayMin, (v) => {
              s.stayMin = v;
              this.changed();
            }),
            h('span', { text: 'min, then move on' }),
          ),
        );
      }
    });
    if (!this.stops.length) {
      rows.push(
        h('div', {
          class: 'it-empty',
          text: 'No steps yet. Search below, tap the map, or pick a person from your circles. Queue several: drive to a place, stay a while, walk to the next, walk around an area, drive on…',
        }),
      );
    } else if (this.stops.length < MAX_STOPS) {
      rows.push(h('div', { class: 'it-empty', text: 'Add another place, or a walk around, to continue after the last step.' }));
    }
    clear(this.list, rows);
  }

  /** How we get to step i: Drive (with speeds) or Walk (with a pace), or the walk-around settings. */
  legBlock(s, i) {
    const u = this.units;
    const unit = fmt.unitLabel(u);
    const err = h('div', { class: 'form-error' });
    const numInput = (value, { digits = 0, cls = '', label, onChange }) => {
      const input = h('input', {
        class: `input mini${cls ? ` ${cls}` : ''}`,
        inputmode: 'decimal',
        autocomplete: 'off',
        enterkeyhint: 'done',
        value: String(Math.round(value * 10 ** digits) / 10 ** digits),
        'aria-label': label,
      });
      input.addEventListener('change', () => onChange(input));
      return input;
    };
    const readKmh = (input) => fmt.fromDisplaySpeed(Number(String(input.value).replace(',', '.')), u);
    const opts = h('div', { class: 'it-opts' });

    if (s.kind === 'wander') {
      const mins = numInput(s.minutes, {
        label: 'Minutes to walk around',
        onChange: (inp) => {
          s.minutes = clampNum(inp.value, WANDER.minMin, WANDER.maxMin, WANDER.minutes);
          inp.value = String(s.minutes);
          this.changed();
        },
      });
      const radius = numInput(s.radiusM, {
        cls: 'wide',
        label: 'Area radius in metres',
        onChange: (inp) => {
          s.radiusM = Math.round(clampNum(inp.value, WANDER.minRadius, WANDER.maxRadius, WANDER.radiusM));
          inp.value = String(s.radiusM);
          this.changed();
          this.syncMarkers();
        },
      });
      const pace = numInput(fmt.toDisplaySpeed(s.kmh, u), { digits: 1, label: 'Walking speed', onChange: (inp) => this.setPace(s, readKmh(inp), err) });
      const ret = h('input', { type: 'checkbox', checked: s.returnToStart });
      ret.addEventListener('change', () => {
        s.returnToStart = ret.checked;
        this.changed();
      });
      opts.append(icon('walk'), h('span', { text: 'Walk around for' }), mins, h('span', { text: 'min within' }), radius, h('span', { text: 'm, at' }), pace, h('span', { text: unit }));
      return h('div', { class: 'it-leg walk' }, opts, h('label', { class: 'check inline' }, ret, h('span', { text: 'End where it started (back at the car)' })), err);
    }

    const modeSeg = segmented(['Drive', 'Walk'], (k) => this.setMode(s, k === 1 ? 'walk' : 'drive'), s.mode === 'walk' ? 1 : 0, 'small');
    if (s.mode === 'walk') {
      const pace = numInput(fmt.toDisplaySpeed(s.kmh, u), { digits: 1, label: 'Walking speed', onChange: (inp) => this.setPace(s, readKmh(inp), err) });
      opts.append(modeSeg, h('span', { text: 'at' }), pace, h('span', { text: unit }));
      return h('div', { class: 'it-leg walk' }, opts, err);
    }
    const sp = {};
    for (const k of ['min', 'avg', 'max']) {
      sp[k] = numInput(fmt.toDisplaySpeed(s.speeds[k], u), { label: `${k} speed`, onChange: () => this.setSpeeds(s, sp, err) });
    }
    opts.append(modeSeg, h('span', { text: 'min' }), sp.min, h('span', { text: 'avg' }), sp.avg, h('span', { text: 'max' }), sp.max, h('span', { text: unit }));
    return h('div', { class: 'it-leg' }, opts, err);
  }

  // =========================================================================
  // Editing the queue
  // =========================================================================

  persist() {
    store.set('pc.trip', { stops: this.stops, waitMin: this.waitMin, start: this.start });
  }

  /** A value changed: keep it, and the preview no longer matches. */
  changed() {
    this.persist();
    this.invalidatePreview();
  }

  afterEdit() {
    this.persist();
    this.invalidatePreview();
    this.renderList();
    this.syncMarkers();
    this.main.updateHint();
  }

  setMode(s, mode) {
    if (s.mode === mode) return;
    s.mode = mode;
    this.afterEdit();
  }

  setPace(s, kmh, err) {
    if (!Number.isFinite(kmh) || kmh <= 0) {
      err.textContent = 'Enter the walking speed';
      return;
    }
    if (kmh < WALK_KMH.min - 1e-9 || kmh > WALK_KMH.max + 1e-9) {
      err.textContent = `Walking speed between ${fmt.speed(WALK_KMH.min, this.units)} and ${fmt.speed(WALK_KMH.max, this.units)}`;
      return;
    }
    err.textContent = '';
    s.kmh = Math.round(kmh * 10) / 10;
    this.defaults.kmh = s.kmh;
    store.set('pc.walkKmh', s.kmh);
    this.changed();
  }

  setSpeeds(s, inputs, err) {
    const out = {};
    for (const k of ['min', 'avg', 'max']) {
      const n = Number(String(inputs[k].value).replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        err.textContent = 'Enter min, average and max speed';
        return;
      }
      out[k] = fmt.fromDisplaySpeed(n, this.units);
    }
    let msg = '';
    if (out.max > 300) msg = `Max speed can be at most ${fmt.speed(300, this.units)}`;
    else if (out.min >= out.max) msg = 'Max speed must be higher than min speed';
    else if (out.avg < out.min || out.avg > out.max) msg = 'Average must be between min and max';
    err.textContent = msg;
    if (msg) return;
    s.speeds = out;
    this.defaults.speeds = { ...out }; // the next drive starts from these
    store.set('pc.speeds', out);
    this.changed();
  }

  /** First problem with the steps, or null. */
  validate() {
    for (const [i, s] of this.stops.entries()) {
      const label = `Step ${i + 1}`;
      if (s.kind === 'wander') {
        if (!(s.minutes >= WANDER.minMin && s.minutes <= WANDER.maxMin)) return `${label}: walk around for 1 to ${WANDER.maxMin} minutes`;
        if (!(s.radiusM >= WANDER.minRadius && s.radiusM <= WANDER.maxRadius)) return `${label}: area radius between ${WANDER.minRadius} and ${WANDER.maxRadius} m`;
      }
      if (isWalk(s) && !(s.kmh >= WALK_KMH.min && s.kmh <= WALK_KMH.max)) return `${label}: walking speed between ${fmt.speed(WALK_KMH.min, this.units)} and ${fmt.speed(WALK_KMH.max, this.units)}`;
      if (s.kind === 'go' && s.mode === 'drive') {
        const { min, avg, max } = s.speeds;
        if (!(min > 0 && min < max && avg >= min && avg <= max && max <= 300)) return `${label}: check the min / average / max speed`;
      }
    }
    return null;
  }

  /** Where the next step would start from: the last step, the chosen start, or the current fake position. */
  lastPoint() {
    const prev = this.stops[this.stops.length - 1] || this.start;
    if (prev) return prev;
    const pos = this.main.state?.position;
    return pos ? { lat: pos.lat, lon: pos.lon, name: pos.address || 'Current fake position', detail: fmt.coords(pos.lat, pos.lon) } : null;
  }

  addStop(p, fly = false) {
    if (this.stops.length >= MAX_STOPS) return toast(`At most ${MAX_STOPS} steps per trip`, 'warn');
    const lastGo = [...this.stops].reverse().find((x) => x.kind === 'go');
    const s = { ...place(p), kind: 'go', mode: lastGo?.mode || 'drive', stayMin: DEFAULT_STAY_MIN, speeds: { ...this.defaults.speeds }, kmh: this.defaults.kmh };
    this.stops.push(s);
    if (!p.name) {
      this.main.describe(s, (d) => {
        if (!this.stops.includes(s)) return;
        s.name = d.name;
        s.detail = d.detail || fmt.coords(s.lat, s.lon);
        this.persist();
        this.renderList();
      });
    }
    this.addSearch.reset();
    this.afterEdit();
    if (fly) this.main.focus(s.lat, s.lon, Math.max(this.map.getZoom(), 13));
    return s;
  }

  /** A random stroll around the last point (centre movable with "Centre"). */
  addWander() {
    if (this.stops.length >= MAX_STOPS) return toast(`At most ${MAX_STOPS} steps per trip`, 'warn');
    const prev = this.lastPoint();
    if (!prev) return toast('Teleport somewhere or add a stop first: the stroll starts from there', 'warn');
    const s = {
      kind: 'wander',
      mode: 'walk',
      lat: prev.lat,
      lon: prev.lon,
      name: prev.name,
      detail: prev.detail,
      stayMin: 0,
      minutes: WANDER.minutes,
      radiusM: WANDER.radiusM,
      kmh: this.defaults.kmh,
      returnToStart: true,
    };
    this.stops.push(s);
    this.afterEdit();
    this.main.focus(s.lat, s.lon, Math.max(this.map.getZoom(), 15));
    toast('Walk around added: set the minutes and the size of the area', 'ok');
    return s;
  }

  removeStop(i) {
    this.stops.splice(i, 1);
    if (this.pickingCenter === i) this.pickingCenter = -1;
    this.afterEdit();
  }

  move(i, d) {
    const j = i + d;
    if (j < 0 || j >= this.stops.length) return;
    [this.stops[i], this.stops[j]] = [this.stops[j], this.stops[i]];
    this.pickingCenter = -1;
    this.afterEdit();
  }

  clearStops() {
    this.stops = [];
    this.waitMin = 0;
    this.pickingCenter = -1;
    this.afterEdit();
  }

  togglePickStart() {
    if (this.start) return this.setStart(null);
    this.pickingStart = !this.pickingStart;
    this.pickingCenter = -1;
    this.renderList();
    this.main.updateHint();
    if (this.pickingStart) toast('Tap the map or use the GPS button to choose where the trip starts');
  }

  togglePickCenter(i) {
    this.pickingCenter = this.pickingCenter === i ? -1 : i;
    this.pickingStart = false;
    this.renderList();
    this.main.updateHint();
    if (this.pickingCenter >= 0) toast('Tap the map where the stroll should be centred');
  }

  setCenter(i, p) {
    const s = this.stops[i];
    if (!s) return;
    s.lat = Number(p.lat);
    s.lon = Number(p.lon);
    s.name = p.name || 'Dropped pin';
    s.detail = p.detail || fmt.coords(s.lat, s.lon);
    if (!p.name) {
      this.main.describe(s, (d) => {
        if (this.stops[i] !== s) return;
        s.name = d.name;
        s.detail = d.detail || fmt.coords(s.lat, s.lon);
        this.persist();
        this.renderList();
      });
    }
    this.pickingCenter = -1;
    this.afterEdit();
  }

  setStart(p) {
    this.pickingStart = false;
    this.start = p ? place(p) : null;
    if (p && !p.name) {
      const s = this.start;
      this.main.describe(s, (d) => {
        if (this.start !== s) return;
        s.name = d.name;
        s.detail = d.detail || fmt.coords(s.lat, s.lon);
        this.persist();
        this.renderList();
      });
    }
    this.afterEdit();
  }

  /** A tap on the map while the Drive tab is open. */
  onMapClick(p) {
    if (this.pickingStart) this.setStart(p);
    else if (this.pickingCenter >= 0) this.setCenter(this.pickingCenter, p);
    else this.addStop(p);
  }

  onGps(p) {
    if (this.pickingStart) this.setStart(p);
    else if (this.pickingCenter >= 0) this.setCenter(this.pickingCenter, p);
    else this.addStop(p);
  }

  hint() {
    if (this.pickingStart) return 'Tap the map to set the start';
    if (this.pickingCenter >= 0) return 'Tap the map to centre the walk around';
    return this.stops.length ? 'Tap the map to add another stop' : 'Tap the map to add a stop';
  }

  // =========================================================================
  // Map layers of the builder
  // =========================================================================

  syncMarkers() {
    while (this.stopMarkers.length > this.stops.length) this.stopMarkers.pop().remove();
    while (this.areas.length > this.stops.length) this.areas.pop()?.remove();
    this.stops.forEach((s, i) => {
      let mk = this.stopMarkers[i];
      if (!mk) {
        mk = stopMarker(i + 1);
        this.stopMarkers[i] = mk;
      }
      mk.setNumber(i + 1);
      mk.setLatLng([s.lat, s.lon]);
      mk.setState({ walk: isWalk(s) });
      if (this.visible && !mk._map) mk.addTo(this.map);
      // the area of a stroll
      if (s.kind === 'wander') {
        let a = this.areas[i];
        if (!a) {
          a = areaCircle([s.lat, s.lon], s.radiusM);
          this.areas[i] = a;
        }
        a.setLatLng([s.lat, s.lon]);
        a.setRadius(s.radiusM);
        if (this.visible && !a._map) a.addTo(this.map);
      } else if (this.areas[i]) {
        this.areas[i].remove();
        this.areas[i] = null;
      }
    });
    if (this.start) {
      this.startMk.setLatLng([this.start.lat, this.start.lon]);
      if (this.visible && !this.startMk._map) this.startMk.addTo(this.map);
    } else this.startMk.remove();
  }

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    if (v) {
      this.stopMarkers.forEach((mk) => mk.addTo(this.map));
      this.areas.forEach((a) => a?.addTo(this.map));
      if (this.start) this.startMk.addTo(this.map);
      this.previewLayer?.addTo(this.map);
    } else {
      this.stopMarkers.forEach((mk) => mk.remove());
      this.areas.forEach((a) => a?.remove());
      this.startMk.remove();
      this.previewLayer?.remove();
    }
  }

  // =========================================================================
  // Preview and start
  // =========================================================================

  invalidatePreview() {
    this.preview = null;
    this.previewLayer?.remove();
    this.previewLayer = null;
    clear(this.previewBox);
    show(this.previewBox, false);
  }

  stepPayload(s) {
    const base = { lat: s.lat, lon: s.lon, address: addressOf(s), stayMin: s.stayMin };
    if (s.kind === 'wander') return { ...base, kind: 'wander', minutes: s.minutes, radiusM: s.radiusM, kmh: s.kmh, returnToStart: s.returnToStart };
    if (s.mode === 'walk') return { ...base, kind: 'go', mode: 'walk', kmh: s.kmh };
    return { ...base, kind: 'go', mode: 'drive', minKmh: s.speeds.min, avgKmh: s.speeds.avg, maxKmh: s.speeds.max };
  }

  async previewTrip() {
    if (!this.stops.length) return toast('Add at least one stop (search or tap the map)', 'warn');
    const problem = this.validate();
    if (problem) return toast(problem, 'warn');
    if (!this.start && !this.main.state?.position) return toast('Choose where the trip starts first', 'warn');
    await busy(this.previewBtn, async () => {
      try {
        const res = await post('/api/trip/preview', {
          from: this.start ? { lat: this.start.lat, lon: this.start.lon, address: addressOf(this.start) } : undefined,
          waitMin: this.waitMin,
          stops: this.stops.map((s) => this.stepPayload(s)),
          traffic: this.traffic,
          tzOffset: new Date().getTimezoneOffset(),
        });
        this.showPreview(res);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  showPreview(res) {
    this.invalidatePreview();
    this.preview = res;
    this.previewLayer = L.layerGroup([
      ...res.legs.map((l) => routeLine(l.polyline, { preview: true, mode: l.mode })),
      ...res.legs.filter((l) => l.kind === 'wander' && l.wander).map((l) => areaCircle([l.wander.center.lat, l.wander.center.lon], l.wander.radiusM)),
    ]).addTo(this.map);
    this.main.setFollow(false);
    this.map.fitBounds(L.latLngBounds(res.legs.flatMap((l) => l.polyline)), this.main.fitPadding());

    const u = this.units;
    const many = res.legs.length > 1;
    const detail = (l, i) => {
      const parts = [];
      if (l.kind === 'wander') {
        parts.push(`${fmt.duration(l.wander.minutes * 60)} within ${fmt.distance(l.wander.radiusM, u)}`, `${fmt.distance(l.distance, u)} on foot`, l.wander.returnToStart ? 'ends where it started' : '');
      } else if (l.mode === 'walk') parts.push(`${fmt.distance(l.distance, u)} on foot · ${fmt.duration(l.duration)}`, `pace ${fmt.speed(l.targetAvgKmh, u, 1)}`);
      else parts.push(`${fmt.distance(l.distance, u)} · ${fmt.duration(l.duration)}`, `avg ${fmt.speed(l.targetAvgKmh, u)} (${fmt.speed(l.minKmh, u)} to ${fmt.speed(l.maxKmh, u)})`);
      parts.push(`${l.kind === 'wander' ? 'done' : 'arrive'} ${fmt.clock(l.arriveAt)}`);
      if (i < res.legs.length - 1 && l.stayMin) parts.push(`stay ${fmt.duration(l.stayMin * 60)}`);
      if (l.summary) parts.push(`via ${l.summary}`);
      return parts.filter(Boolean).join(' · ');
    };
    const legRows = res.legs.map((l, i) =>
      h(
        'div',
        { class: 'leg-row' },
        h('div', { class: `it-badge sm${l.warning ? ' warn' : l.mode === 'walk' ? ' walk' : ''}`, text: String(i + 1) }),
        h('div', { class: 'leg-ico' }, icon(l.mode === 'walk' ? 'walk' : 'car')),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'place-name', text: l.kind === 'wander' ? `Walk around ${coordsOf(l.wander.center)}` : coordsOf(l.to) }),
          h('div', { class: 'place-detail', text: detail(l, i) }),
        ),
      ),
    );
    const items = [stat('Distance', fmt.distance(res.distance, u))];
    if (res.driving) items.push(stat('Driving', fmt.duration(res.driving)));
    if (res.walking) items.push(stat('Walking', fmt.duration(res.walking)));
    items.push(stat(many || res.waitMin ? 'Whole trip' : 'Duration', fmt.duration(res.total)));
    if (items.length < 4) items.push(stat(many ? 'Last step' : 'Arrive', fmt.clock(res.arriveAt)));
    const stats = h('div', { class: 'stats' }, items);
    // one speed chart for the whole trip, legs one after the other
    const points = [];
    let off = 0;
    for (const l of res.legs) {
      for (const [km, kmh] of l.chart) points.push([off + km, kmh]);
      off += l.distance / 1000;
    }
    const chart = speedChart({ points, totalKm: res.distance / 1000, minKmh: res.minKmh, maxKmh: res.maxKmh, avgKmh: res.targetAvgKmh, units: u });
    const warned = res.legs.filter((l) => l.warning);
    const warn = warned.length
      ? h(
          'div',
          { class: 'notice warn' },
          icon('warn'),
          h('div', {
            text: warned
              .map((l) => {
                const n = res.legs.indexOf(l) + 1;
                return l.warning === 'avg_too_high'
                  ? `Step ${n}: an average of ${fmt.speed(l.targetAvgKmh, u)} is not reachable there with that max speed; the car will drive as fast as the band allows.`
                  : `Step ${n}: an average of ${fmt.speed(l.targetAvgKmh, u)} is too low for that route; it will average a little more.`;
              })
              .join(' '),
          }),
        )
      : null;
    const first = res.legs[0];
    const startLabel = many ? `Start trip · ${res.legs.length} steps` : first.kind === 'wander' ? 'Start walking around' : first.mode === 'walk' ? 'Start walk' : 'Start drive';
    const startBtn = h('button', { class: 'btn primary block', onclick: () => this.startTrip(startBtn) }, icon('play'), startLabel);
    clear(
      this.previewBox,
      h(
        'div',
        { class: 'row between' },
        h('div', { class: 'label', text: many ? 'Trip preview' : 'Route preview' }),
        res.waitMin ? h('div', { class: 'faint', style: { fontSize: '13px' }, text: `Leaves in ${fmt.duration(res.waitMin * 60)}` }) : null,
      ),
      h('div', { class: 'card stack', style: { gap: '10px' } }, legRows),
      stats,
      warn,
      chart.el,
      startBtn,
    );
    show(this.previewBox, true);
    setTimeout(() => this.previewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  async startTrip(btn) {
    if (!this.preview) return;
    const go = async () => {
      const s = await post('/api/trip/start', { previewId: this.preview.previewId });
      this.invalidatePreview();
      this.clearStops();
      this.setStart(null);
      this.main.applyState(s);
      this.main.setFollow(true);
      await this.main.refresh();
      const legs = s.trip?.legs || [];
      toast(legs.length > 1 ? 'Trip started' : legs[0]?.mode === 'walk' ? 'Walk started' : 'Drive started', 'ok');
    };
    await busy(btn, async () => {
      try {
        await go();
      } catch (e) {
        if (handleLiveError(this.app, e, go)) return;
        toast(e.message, 'error');
        if (e.code === 'preview_expired') this.invalidatePreview();
      }
    });
  }

  // =========================================================================
  // The running trip
  // =========================================================================

  /** Called from main.render(). */
  render(state) {
    const t = state?.trip;
    const staying = t?.status === 'active' && (t.phase === 'wait' || t.phase === 'stay');
    show(this.stayBox, !!staying);
    if (staying) this.renderStay(state);
    this.syncRoute(state);
  }

  renderStay(state) {
    const t = state.trip;
    const u = this.units;
    const leg = t.legs[t.index];
    const next = t.legs[t.index + 1];
    const here = t.phase === 'wait' ? t.from : leg?.to;
    this.stay.step.textContent = t.phase === 'wait' ? `Before step 1 of ${t.legs.length}` : `Step ${t.index + 1} of ${t.legs.length}`;
    this.stay.title.textContent = `${t.phase === 'wait' ? 'Waiting at' : 'Staying at'} ${here ? coordsOf(here) : 'the current position'}`;
    this.stay.next.textContent = next ? `Next: ${legText(next)}${next.distance ? ` · ${fmt.distance(next.distance, u)} · about ${fmt.duration(next.duration)}` : ''}` : '';
    const paused = t.phasePaused || !state.enabled;
    this.stay.pill.textContent = paused ? 'Off' : 'Live';
    this.stay.pill.className = `pill ${paused ? 'warn' : 'ok'}`;
    this.tick(Date.now() + this.main.clockOffset, true);
  }

  /** Countdown, about once a second (from the animation loop). */
  tick(now, force = false) {
    const t = this.main.state?.trip;
    if (t?.status !== 'active' || (t.phase !== 'wait' && t.phase !== 'stay')) return;
    if (!force && now - (this.lastTick || 0) < 1000) return;
    this.lastTick = now;
    if (t.phasePaused || !this.main.state.enabled) this.stay.sub.textContent = 'Paused - switch ON to continue the trip';
    else if (t.phaseUntil) {
      const left = Math.max(0, (t.phaseUntil - now) / 1000);
      this.stay.sub.textContent = `Leaving at ${fmt.clock(t.phaseUntil)} · ${fmt.duration(left)} left`;
    } else this.stay.sub.textContent = 'Leaving now';
  }

  async syncRoute(state) {
    const t = state?.trip;
    if (!t || t.status !== 'active') return this.clearRoute();
    const key = `${t.id}:${t.index}:${t.phase}`;
    if (this.route?.key === key || this.loadingRoute) return;
    this.loadingRoute = true;
    try {
      const res = await get('/api/trip/route');
      if (this.main.destroyed || this.main.state?.trip?.id !== t.id) return;
      this.clearRoute();
      const stateOf = (l) => (l.status === 'done' ? 'done' : l.status === 'driving' ? 'current' : 'pending');
      const layer = L.layerGroup([
        ...res.legs.map((l) => routeLine(l.polyline, { state: stateOf(l), mode: l.mode })),
        ...res.legs.filter((l) => l.kind === 'wander' && l.wander).map((l) => areaCircle([l.wander.center.lat, l.wander.center.lon], l.wander.radiusM, { state: stateOf(l) })),
      ]).addTo(this.map);
      const markers = t.legs.map((l, i) => {
        const mk = stopMarker(i + 1);
        const at = l.kind === 'wander' && l.wander?.center ? l.wander.center : l.to;
        mk.setLatLng([at.lat, at.lon]);
        mk.setState({ done: l.status === 'done', current: i === t.index, walk: l.mode === 'walk' });
        return mk.addTo(this.map);
      });
      this.route = { key, layer, markers };
    } catch (e) {
      if (e.status !== 404) console.error(e);
    } finally {
      this.loadingRoute = false;
    }
  }

  clearRoute() {
    this.route?.layer.remove();
    this.route?.markers.forEach((m) => m.remove());
    this.route = null;
  }
}

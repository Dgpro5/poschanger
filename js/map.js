// Leaflet helpers: dark map, markers and route lines.
/* global L */

import { h, store } from './dom.js';

const VIEW_KEY = 'pc.mapView';

export function createMap(el) {
  const cfg = window.APP_CONFIG || {};
  const saved = store.get(VIEW_KEY);
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    worldCopyJump: true,
    tapTolerance: 20,
    maxZoom: cfg.maxZoom || 20,
  }).setView(saved?.center || [30, 10], saved?.zoom || 3);
  // Older config.js files used a single tileUrl.
  const layers = cfg.tiles?.length ? cfg.tiles : [{ url: cfg.tileUrl, subdomains: cfg.tileSubdomains }];
  layers.forEach((t, i) => {
    const layer = L.tileLayer(t.url, {
      subdomains: t.subdomains || 'abc',
      attribution: i === 0 ? cfg.tileAttribution || '' : '',
      maxZoom: cfg.maxZoom || 19,
      maxNativeZoom: t.maxNativeZoom || cfg.maxZoom || 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(map);
    if (t.filter) layer.getContainer().style.filter = t.filter;
  });
  map.attributionControl.setPrefix(false);
  map.on('moveend', () => {
    const c = map.getCenter();
    store.set(VIEW_KEY, { center: [c.lat, c.lng], zoom: map.getZoom() });
  });
  return map;
}

export function carMarker() {
  const heading = h('div', { class: 'heading' });
  const root = h('div', { class: 'mk-car off' }, h('div', { class: 'halo' }), heading, h('div', { class: 'core' }));
  const marker = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: root, iconSize: [44, 44], iconAnchor: [22, 22] }),
    keyboard: false,
    interactive: false,
    zIndexOffset: 1000,
  });
  marker.setState = ({ live, moving, heading: deg }) => {
    root.classList.toggle('off', !live);
    root.classList.toggle('live', !!live);
    root.classList.toggle('moving', !!moving);
    if (Number.isFinite(deg)) heading.style.transform = `rotate(${deg}deg)`;
  };
  return marker;
}

export function pinMarker() {
  return L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: h('div', { class: 'mk-pin' }), iconSize: [30, 30], iconAnchor: [15, 15] }),
    keyboard: false,
    interactive: false,
    zIndexOffset: 500,
  });
}

export function destMarker() {
  return L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: h('div', { class: 'mk-dest' }), iconSize: [26, 26], iconAnchor: [13, 13] }),
    keyboard: false,
    interactive: false,
    zIndexOffset: 600,
  });
}

export function startMarker() {
  return L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: h('div', { class: 'mk-start' }), iconSize: [16, 16], iconAnchor: [8, 8] }),
    keyboard: false,
    interactive: false,
    zIndexOffset: 400,
  });
}

/** Numbered stop of a trip. */
export function stopMarker(n) {
  const label = h('div', { class: 'mk-stop', text: String(n) });
  const marker = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: label, iconSize: [26, 26], iconAnchor: [13, 13] }),
    keyboard: false,
    interactive: false,
    zIndexOffset: 650,
  });
  marker.setNumber = (k) => (label.textContent = String(k));
  marker.setState = ({ done = false, current = false, walk = false } = {}) => {
    label.classList.toggle('done', done);
    label.classList.toggle('current', current);
    label.classList.toggle('walk', walk);
  };
  return marker;
}

const WALK_COLOR = '#7cc4ff';

/** The area of a "walk around" step. */
export function areaCircle(center, radiusM, { state = 'current' } = {}) {
  const done = state === 'done';
  return L.circle(center, {
    radius: radiusM,
    color: done ? '#7c7c86' : WALK_COLOR,
    weight: 1.5,
    opacity: done ? 0.4 : 0.75,
    dashArray: '4 6',
    fillColor: WALK_COLOR,
    fillOpacity: done ? 0.03 : 0.08,
    interactive: false,
  });
}

const initials = (m) => `${(m.firstName || '')[0] || ''}${(m.lastName || '')[0] || ''}`.toUpperCase() || '?';

/** A circle member: photo (or initials) with the first name underneath. */
export function memberMarker(member, onClick) {
  const avatar = h('div', { class: 'mk-avatar' });
  const name = h('div', { class: 'mk-name' });
  const root = h('div', { class: 'mk-member' }, avatar, name);
  const marker = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: root, iconSize: [40, 40], iconAnchor: [20, 20] }),
    keyboard: false,
    zIndexOffset: 800,
  });
  marker.on('click', () => onClick?.(marker.member));
  marker.setMember = (m) => {
    marker.member = m;
    const loc = m.location;
    if (avatar.dataset.src !== (m.avatar || '')) {
      avatar.dataset.src = m.avatar || '';
      avatar.replaceChildren(h('span', { text: initials(m) }));
      if (m.avatar) {
        const img = h('img', { src: m.avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
        img.addEventListener('load', () => avatar.replaceChildren(img));
      }
    }
    name.textContent = m.isMe ? 'You' : m.firstName || m.name;
    root.classList.toggle('me', !!m.isMe);
    root.classList.toggle('moving', !!(loc?.inTransit || loc?.driving || (loc?.speedKmh ?? 0) > 3));
    root.classList.toggle('stale', !!loc?.at && Date.now() - loc.at > 30 * 60_000);
    if (loc) marker.setLatLng([loc.lat, loc.lon]);
  };
  marker.setMember(member);
  return marker;
}

/**
 * A route line with a dark casing so it reads on any tile.
 * state: 'current' (solid), 'pending' (dashed), 'done' (muted). Drives are green, walks
 * (mode 'walk') light blue and dotted.
 */
export function routeLine(latlngs, { preview = false, state = 'current', mode = 'drive' } = {}) {
  const done = state === 'done';
  const walk = mode === 'walk';
  const casing = L.polyline(latlngs, { color: '#000', weight: walk ? 7 : 9, opacity: done ? 0.5 : 0.85, interactive: false, lineJoin: 'round' });
  const line = L.polyline(latlngs, {
    color: done ? '#7c7c86' : walk ? WALK_COLOR : '#36e39c',
    weight: walk ? 3 : 4,
    opacity: preview || state === 'pending' ? (walk ? 0.7 : 0.75) : done ? 0.7 : 0.95,
    dashArray: walk ? '1 6' : preview || state === 'pending' ? '1 9' : null,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  });
  return L.layerGroup([casing, line]);
}

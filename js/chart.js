// Planned speed along the route: a single-series area chart with min / avg / max
// reference lines, a touch-friendly crosshair and an optional progress cursor.

import { h } from './dom.js';
import { toDisplaySpeed, unitLabel } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 132;
const PAD = { l: 4, r: 52, t: 10, b: 20 };

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * @param {object} o
 * @param {[number, number][]} o.points  [km, km/h]
 * @param {number} o.totalKm
 * @param {number} o.minKmh
 * @param {number} o.maxKmh
 * @param {number} o.avgKmh
 * @param {'kmh'|'mph'} o.units
 */
export function speedChart({ points, totalKm, minKmh, maxKmh, avgKmh, units }) {
  const unit = unitLabel(units);
  const conv = (kmh) => toDisplaySpeed(kmh, units);
  const distConv = (km) => (units === 'mph' ? km / 1.609344 : km);
  const distUnit = units === 'mph' ? 'mi' : 'km';
  const top = Math.max(maxKmh, ...points.map((p) => p[1])) * 1.12;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (km) => PAD.l + (totalKm > 0 ? (km / totalKm) * iw : 0);
  const y = (kmh) => PAD.t + ih - (kmh / top) * ih;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Planned speed along the route, ${unit}` });

  // baseline + reference lines (hairline, solid, recessive)
  root.append(svg('line', { x1: PAD.l, x2: PAD.l + iw, y1: y(0), y2: y(0), stroke: '#27272e', 'stroke-width': 1 }));
  const refs = [
    { v: maxKmh, label: `max ${conv(maxKmh).toFixed(0)}` },
    { v: avgKmh, label: `avg ${conv(avgKmh).toFixed(0)}`, strong: true },
    { v: minKmh, label: `min ${conv(minKmh).toFixed(0)}` },
  ];
  // keep labels at least 11px apart
  const ys = refs.map((r) => y(r.v));
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < 11) ys[i] = ys[i - 1] + 11;
  refs.forEach((r, i) => {
    root.append(svg('line', { x1: PAD.l, x2: PAD.l + iw, y1: y(r.v), y2: y(r.v), stroke: r.strong ? '#3a3a43' : '#222228', 'stroke-width': 1 }));
    const t = svg('text', {
      x: PAD.l + iw + 6,
      y: ys[i] + 3.5,
      fill: r.strong ? '#a1a1ab' : '#6c6c76',
      'font-size': 10,
      'font-weight': r.strong ? 600 : 400,
    });
    t.textContent = r.label;
    root.append(t);
  });

  // area + line
  if (points.length > 1) {
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    const area = `${line}L${x(points[points.length - 1][0]).toFixed(1)},${y(0)}L${x(points[0][0]).toFixed(1)},${y(0)}Z`;
    root.append(svg('path', { d: area, fill: '#36e39c', 'fill-opacity': 0.1, stroke: 'none' }));
    root.append(
      svg('path', { d: line, fill: 'none', stroke: '#36e39c', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    );
  }

  // x labels
  const xl = (km, anchor) => {
    const t = svg('text', { x: x(km), y: H - 5, fill: '#6c6c76', 'font-size': 10, 'text-anchor': anchor });
    t.textContent = km === 0 ? '0' : `${distConv(km).toFixed(distConv(km) < 10 ? 1 : 0)} ${distUnit}`;
    root.append(t);
  };
  xl(0, 'start');
  xl(totalKm, 'end');

  // progress cursor
  const prog = svg('line', { y1: PAD.t, y2: y(0), stroke: '#a1a1ab', 'stroke-width': 1, visibility: 'hidden' });
  const progDot = svg('circle', { r: 4, fill: '#ececf1', stroke: '#000', 'stroke-width': 2, visibility: 'hidden' });
  root.append(prog, progDot);

  // crosshair
  const cross = svg('line', { y1: PAD.t, y2: y(0), stroke: '#6c6c76', 'stroke-width': 1, visibility: 'hidden' });
  const crossDot = svg('circle', { r: 4, fill: '#36e39c', stroke: '#000', 'stroke-width': 2, visibility: 'hidden' });
  root.append(cross, crossDot);

  const tip = h('div', { class: 'chart-tip hidden' });
  const title = h(
    'div',
    { class: 'chart-title' },
    h('strong', { text: 'Planned speed' }),
    h('span', { text: unit }),
  );
  const el = h('div', { class: 'chart' }, title, root, tip);

  const speedAt = (km) => {
    let best = points[0];
    for (const p of points) if (Math.abs(p[0] - km) < Math.abs(best[0] - km)) best = p;
    return best;
  };

  const onMove = (e) => {
    const rect = root.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const km = Math.min(totalKm, Math.max(0, ((px - PAD.l) / iw) * totalKm));
    const p = speedAt(km);
    const cx = x(p[0]);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    crossDot.setAttribute('cx', cx);
    crossDot.setAttribute('cy', y(p[1]));
    cross.setAttribute('visibility', 'visible');
    crossDot.setAttribute('visibility', 'visible');
    tip.textContent = `${distConv(p[0]).toFixed(1)} ${distUnit} · ${conv(p[1]).toFixed(0)} ${unit}`;
    tip.style.left = `${((cx / W) * rect.width + (rect.left - el.getBoundingClientRect().left)).toFixed(0)}px`;
    tip.classList.remove('hidden');
  };
  const onLeave = () => {
    cross.setAttribute('visibility', 'hidden');
    crossDot.setAttribute('visibility', 'hidden');
    tip.classList.add('hidden');
  };
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerdown', onMove);
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('pointercancel', onLeave);
  root.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') setTimeout(onLeave, 1200);
  });

  return {
    el,
    /** fraction 0..1 of the route done, or null to hide */
    setProgress(fraction, kmhNow) {
      if (fraction === null || fraction === undefined) {
        prog.setAttribute('visibility', 'hidden');
        progDot.setAttribute('visibility', 'hidden');
        return;
      }
      const cx = x(fraction * totalKm);
      prog.setAttribute('x1', cx);
      prog.setAttribute('x2', cx);
      prog.setAttribute('visibility', 'visible');
      progDot.setAttribute('cx', cx);
      progDot.setAttribute('cy', y(kmhNow ?? speedAt(fraction * totalKm)[1]));
      progDot.setAttribute('visibility', 'visible');
    },
  };
}

// Drive-plan sampling shared by the server (which reports positions to Life360)
// and the browser (which animates the car marker between server polls).
//
// A plan contains:
//   polyline: [[lat, lon], ...]      route geometry
//   stations: { s: [], v: [], t: [] } distance (m), speed (m/s) and time (s) at
//                                     evenly spaced stations along the route.
// Between two stations the car moves with constant acceleration, so position
// and speed at any time are exact and identical on server and client.

import { locate, pointAt, cumulative } from './geo.js';

/** Seconds of driving elapsed for a drive record, excluding paused time. */
export function driveElapsed(drive, nowMs) {
  const pausedNow = drive.pausedAt ? nowMs - drive.pausedAt : 0;
  return Math.max(0, (nowMs - drive.startedAt - (drive.pausedTotal || 0) - pausedNow) / 1000);
}

/** Distance and speed at elapsed time tau (seconds). */
export function sampleStations(stations, tau) {
  const { s, v, t } = stations;
  const n = t.length;
  if (tau <= 0) return { s: 0, v: v[0], done: false };
  if (tau >= t[n - 1]) return { s: s[n - 1], v: 0, done: true };
  const i = locate(t, tau);
  const dt = t[i + 1] - t[i];
  const va = v[i];
  const vb = v[i + 1];
  const a = dt > 0 ? (vb - va) / dt : 0;
  const x = tau - t[i];
  const segLen = s[i + 1] - s[i];
  const ds = Math.min(Math.max(va * x + 0.5 * a * x * x, 0), segLen);
  return { s: s[i] + ds, v: Math.max(0, va + a * x), done: false };
}

/** Prepare a plan received as JSON for fast sampling (adds the cumulative distances). */
export function preparePlan(plan) {
  if (!plan.cum) plan.cum = cumulative(plan.polyline);
  return plan;
}

/** Full kinematic state at elapsed time tau (seconds). */
export function samplePlan(plan, tau) {
  preparePlan(plan);
  const st = sampleStations(plan.stations, tau);
  // Stations were computed on the same polyline, rescale in case of tiny float drift.
  const total = plan.cum[plan.cum.length - 1];
  const sMax = plan.stations.s[plan.stations.s.length - 1] || total;
  const sOnLine = sMax > 0 ? (st.s / sMax) * total : 0;
  const p = pointAt(plan.polyline, plan.cum, sOnLine);
  return {
    lat: p.lat,
    lon: p.lon,
    heading: p.heading,
    speed: st.done ? 0 : st.v,
    s: st.s,
    progress: sMax > 0 ? st.s / sMax : 1,
    done: st.done,
  };
}

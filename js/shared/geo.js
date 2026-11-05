// Geometry helpers shared by the server (Node) and the browser.
// Points are [lat, lon] arrays, distances are metres, bearings are degrees (0 = north).

export const EARTH_RADIUS = 6371008.8;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, normalised to [0, 360). */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest difference b - a in degrees, in (-180, 180]. */
export function angleDiff(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Cumulative distance (m) at every vertex of a polyline of [lat, lon]. */
export function cumulative(points) {
  const cum = new Array(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    cum[i] = cum[i - 1] + haversine(a[0], a[1], b[0], b[1]);
  }
  return cum;
}

/** Largest index i with arr[i] <= x (arr sorted ascending). Clamped to [0, arr.length - 2]. */
export function locate(arr, x) {
  let lo = 0;
  let hi = arr.length - 1;
  if (x <= arr[0]) return 0;
  if (x >= arr[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point at distance s (m) along the polyline, with the heading of the segment it lies on. */
export function pointAt(points, cum, s) {
  if (points.length === 1) return { lat: points[0][0], lon: points[0][1], heading: 0, index: 0 };
  const total = cum[cum.length - 1];
  const d = Math.min(Math.max(s, 0), total);
  let i = locate(cum, d);
  // Skip zero-length segments so the heading stays meaningful.
  while (i < points.length - 2 && cum[i + 1] - cum[i] < 1e-9) i++;
  const segLen = cum[i + 1] - cum[i];
  const f = segLen > 0 ? (d - cum[i]) / segLen : 0;
  const [la1, lo1] = points[i];
  const [la2, lo2] = points[i + 1];
  return {
    lat: la1 + (la2 - la1) * f,
    lon: lo1 + (lo2 - lo1) * f,
    heading: bearing(la1, lo1, la2, lo2),
    index: i,
  };
}

/** Move a point by metres north/east (small offsets only, used for GPS jitter). */
export function offsetMeters(lat, lon, north, east) {
  const dLat = north / EARTH_RADIUS;
  const dLon = east / (EARTH_RADIUS * Math.cos(toRad(lat)));
  return [lat + toDeg(dLat), lon + toDeg(dLon)];
}

export function isValidLatLon(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

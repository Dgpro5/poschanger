// Units and formatting. The API always speaks km/h and metres.

export const KMH_PER_MPH = 1.609344;

export const unitLabel = (units) => (units === 'mph' ? 'mph' : 'km/h');

/** km/h -> display number in the user's unit */
export const toDisplaySpeed = (kmh, units) => (units === 'mph' ? kmh / KMH_PER_MPH : kmh);

/** display number in the user's unit -> km/h */
export const fromDisplaySpeed = (v, units) => (units === 'mph' ? v * KMH_PER_MPH : v);

export function speed(kmh, units, digits = 0) {
  return `${toDisplaySpeed(kmh, units).toFixed(digits)} ${unitLabel(units)}`;
}

export function distance(m, units) {
  if (units === 'mph') {
    const mi = m / 1609.344;
    return mi < 0.2 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function duration(sec) {
  const s = Math.max(0, Math.round(sec));
  const hrs = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (hrs) return `${hrs} h ${String(min).padStart(2, '0')} min`;
  if (min) return `${min} min`;
  return `${s} s`;
}

export function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export function date(ms) {
  return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(ms) {
  return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function coords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function licenseText(lic) {
  if (!lic) return '';
  if (lic.admin) return 'Admin - unlimited';
  if (lic.lifetime) return 'Lifetime license';
  const days = Math.ceil((lic.expiresAt - Date.now()) / 86_400_000);
  if (!lic.active) return `Expired on ${date(lic.expiresAt)}`;
  return `Valid until ${date(lic.expiresAt)} (${days} day${days === 1 ? '' : 's'} left)`;
}

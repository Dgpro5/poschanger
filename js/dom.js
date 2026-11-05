// Tiny DOM helpers. Text is always set with textContent, never parsed as HTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const show = (el, visible = true) => el.classList.toggle('hidden', !visible);

// --------------------------------------------------------------------------
// Icons (static, trusted SVG markup)
// --------------------------------------------------------------------------

const P = {
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  logo: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M9.5 10h5M12.8 8.2 14.6 10l-1.8 1.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  car: '<path d="M5 16.5V12l1.7-4.4A2 2 0 0 1 8.6 6.3h6.8a2 2 0 0 1 1.9 1.3L19 12v4.5"/><path d="M3.5 12h17v4.5h-17z"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>',
  walk: '<circle cx="13.2" cy="4.2" r="1.7"/><path d="M12.3 7.3 9.2 9.6 8.1 13.4M12.3 7.3l2.8 3.4 2.6 1.1M12.3 7.3l-1.4 6.2L7.8 20.5M10.9 13.5l3 2.6.9 4.4"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  target: '<path d="M3 11.5 21 3l-8.5 18-2.2-7.3z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.4"/>',
  warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 19 4M16 7l2.5 2.5M14 9l2 2"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7M9 7V4.5h6V7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.7-3.2 3-5 6-5s5.3 1.8 6 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16 14.3c2.6.2 4.4 1.8 5 4.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  skip: '<path d="M5 5.5v13l9-6.5z"/><path d="M17.5 5.5v13"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export function batteryIcon(level, charging) {
  const w = Math.max(1, Math.round((Math.min(100, Math.max(0, level)) / 100) * 12));
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  const fill = level <= 20 && !charging ? '#ff5d64' : charging ? '#36e39c' : 'currentColor';
  span.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">` +
    `<rect x="2.5" y="7.5" width="17" height="9" rx="2.2"/><path d="M21.5 10.5v3"/>` +
    `<rect x="5" y="10" width="${w}" height="4" rx="0.8" fill="${fill}" stroke="none"/></svg>`;
  return span;
}

// --------------------------------------------------------------------------
// Toasts
// --------------------------------------------------------------------------

export function toast(message, kind = 'info', ms = 3600) {
  const host = document.getElementById('toasts');
  const dot = h('span', { class: `dot ${kind === 'error' ? 'bad' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : ''}` });
  const el = h('div', { class: 'toast', role: kind === 'error' ? 'alert' : 'status' }, dot, h('div', { text: message }));
  host.append(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, ms);
  while (host.children.length > 3) host.firstElementChild.remove();
}

// --------------------------------------------------------------------------
// Buttons with a busy state
// --------------------------------------------------------------------------

export async function busy(btn, fn) {
  if (btn.dataset.busy) return undefined;
  btn.dataset.busy = '1';
  const prev = [...btn.childNodes];
  const width = btn.offsetWidth;
  btn.disabled = true;
  btn.style.minWidth = `${width}px`;
  btn.replaceChildren(h('span', { class: 'spinner' }));
  try {
    return await fn();
  } finally {
    btn.replaceChildren(...prev);
    btn.disabled = false;
    btn.style.minWidth = '';
    delete btn.dataset.busy;
  }
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => toast('Copied', 'ok', 1500),
      () => fallbackCopy(text),
    );
  }
  fallbackCopy(text);
  return Promise.resolve();
}

function fallbackCopy(text) {
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('Copied', 'ok', 1500);
  } catch {
    toast('Copy failed', 'error');
  }
  ta.remove();
}

// --------------------------------------------------------------------------
// Storage (never throws)
// --------------------------------------------------------------------------

export const store = {
  get(key, def = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / blocked storage */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

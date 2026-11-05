import { store } from './dom.js';

const base = String(window.APP_CONFIG?.apiBase || '').replace(/\/+$/, '');
const TOKEN_KEY = 'pc.token';

let token = store.get(TOKEN_KEY);
const listeners = new Set();

export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Notified on 401 (signed out) and 402 (license expired). */
export function onAuthProblem(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const auth = {
  get token() {
    return token;
  },
  set(t) {
    token = t;
    if (t) store.set(TOKEN_KEY, t);
    else store.remove(TOKEN_KEY);
  },
};

export const apiBase = base;

export async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      base ? `Cannot reach the server at ${base}` : 'Cannot reach the server - check your connection',
      0,
      'network',
    );
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new ApiError(data?.error?.message || `Request failed (${res.status})`, res.status, data?.error?.code, data?.error);
    if ((res.status === 401 && token) || res.status === 402 || (res.status === 403 && err.code === 'disabled')) {
      for (const fn of listeners) fn(err);
    }
    throw err;
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p, b) => api('DELETE', p, b);

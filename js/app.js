import { auth, get, onAuthProblem, post } from './api.js';
import { clear, h, store, toast } from './dom.js';
import { renderAuth, renderExpired } from './views/auth.js';
import { renderConnect } from './views/connect.js';
import { MainView } from './views/main.js';

const root = document.getElementById('app');

export const app = {
  me: null, // { user, life360 }
  current: null, // active view { destroy() }

  get user() {
    return this.me?.user;
  },
  get units() {
    return this.me?.user?.settings?.units || 'kmh';
  },

  mount(view) {
    try {
      this.current?.destroy?.();
    } catch (err) {
      console.error(err);
    }
    this.current = view;
  },

  async boot() {
    if (!auth.token) return this.showAuth();
    try {
      this.me = await get('/api/me');
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        auth.set(null);
        return this.showAuth(err.status === 403 ? err.message : '');
      }
      return this.showOffline(err);
    }
    this.route();
  },

  route() {
    if (!this.me) return this.showAuth();
    if (!this.me.user.license.active) return this.showExpired();
    if (!this.me.life360.connected && !store.get('pc.skipConnect')) return this.showConnect();
    return this.showMain();
  },

  async refreshMe() {
    this.me = await get('/api/me');
    return this.me;
  },

  showAuth(message = '') {
    this.mount(renderAuth(root, this, { message }));
  },

  showExpired() {
    this.mount(renderExpired(root, this));
  },

  showConnect({ fromSettings = false } = {}) {
    this.mount(renderConnect(root, this, { fromSettings }));
  },

  showMain() {
    this.mount(new MainView(root, this));
  },

  showOffline(err) {
    this.mount(null);
    clear(
      root,
      h(
        'div',
        { class: 'auth' },
        h(
          'div',
          { class: 'auth-box' },
          h('div', { class: 'notice error' }, err.message || 'Cannot reach the server'),
          h('button', { class: 'btn block', onclick: () => this.boot() }, 'Try again'),
        ),
      ),
    );
  },

  async signedIn({ token, user }) {
    auth.set(token);
    this.me = { user, life360: { connected: false } };
    try {
      await this.refreshMe();
    } catch {
      /* route with what we have */
    }
    this.route();
  },

  async signOut() {
    try {
      await post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    auth.set(null);
    this.me = null;
    store.remove('pc.skipConnect');
    this.showAuth();
  },
};

onAuthProblem((err) => {
  if (err.status === 402) {
    if (app.me) app.me.user.license.active = false;
    app.showExpired();
    return;
  }
  auth.set(null);
  app.me = null;
  app.showAuth(err.code === 'disabled' ? err.message : 'Your session ended, please sign in again.');
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message;
  if (msg) toast(msg, 'error');
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

app.boot();

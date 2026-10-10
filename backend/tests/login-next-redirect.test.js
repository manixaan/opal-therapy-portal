'use strict';

/**
 * login.html — ?next= and the auto-redirect (10 Oct 2026).
 *
 * Two defects, one page:
 *
 *   1. ?next= went straight to location.replace. ?next=javascript:… ran script
 *      on the portal origin with the signed-in clinician's session (the CSP
 *      allows 'unsafe-inline', so javascript: navigations execute), and
 *      ?next=//host was an open redirect. safeNext() now resolves it against
 *      this origin and returns the absolute same-origin href, or '/'.
 *
 *   2. The shell sending a signed-in user here, and this page sending them
 *      straight back, reloaded each other in a / ↔ /login loop. The auto-
 *      redirect now fires at most once per target per ~5 s; after that the
 *      login page stays visible with a link through.
 *
 * The page's real inline script runs in a vm with stubbed browser globals.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LOGIN = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'current', 'login.html'), 'utf8');
const SCRIPT = (() => {
  const m = LOGIN.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('login.html inline script not found');
  return m[1];
})();

const ORIGIN = 'http://localhost:5001';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function stubEl() {
  return {
    value: '', textContent: '', disabled: false, style: {}, children: [], listeners: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); },
  };
}

/** Load the page once. `storage` is shared between loads like a real tab's sessionStorage. */
function loadLoginPage({ search = '', meOk = true, storage = new Map(), loginResponse = null } = {}) {
  const els = {};
  const replace = jest.fn();
  const warn = jest.fn();
  const sandbox = {
    URL, URLSearchParams,   // host globals a vm context lacks
    console: { log() {}, warn, error() {} },
    location: { origin: ORIGIN, search, replace },
    document: {
      getElementById: (id) => (els[id] = els[id] || stubEl()),
      createElement: () => stubEl(),
    },
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async (url) => {
      if (url === '/api/auth/me') return { ok: meOk, status: meOk ? 200 : 401 };
      if (url === '/api/auth/login') return loginResponse;
      throw new Error('unexpected fetch ' + url);
    },
    setTimeout() {}, clearTimeout() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: 'login.html' });
  return { sandbox, els, replace, warn, storage };
}

/** Fill the form and submit it, as a user would. */
async function submitLogin(page) {
  const el = page.sandbox.document.getElementById;
  el('email').value = 'owner@example.test';
  el('password').value = 'not-a-real-password';
  await el('login-form').listeners.submit({ preventDefault() {} });
}

describe('safeNext: only same-origin destinations', () => {
  const { sandbox } = loadLoginPage({ meOk: false });
  const safeNext = sandbox.safeNext;

  test('script and data URLs never navigate', () => {
    for (const raw of [
      "javascript:void(document.title='NEXT-EXECUTED')",
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(safeNext(raw)).toBe('/');
    }
  });

  test('another origin, however it is spelt, falls back to /', () => {
    for (const raw of [
      '//example.com/phish',
      'https://example.com/',
      'http://localhost:5002/',
      '/\\example.com',
      '\\\\example.com',
      'https:example.com',
    ]) {
      const out = safeNext(raw);
      expect(out === '/' || new URL(out).origin === ORIGIN).toBe(true);
    }
    expect(safeNext('//example.com/phish')).toBe('/');
    expect(safeNext('https://example.com/')).toBe('/');
  });

  test('dot-segment tricks stay on this origin (an absolute href, not a //path)', () => {
    // A path-returning version turned these into '//example.com/x', which the
    // next navigation reads as protocol-relative.
    for (const raw of ['/.//example.com/x', '/a/..//evil.com', `${ORIGIN}//evil.com/x`]) {
      const out = safeNext(raw);
      expect(out.startsWith(ORIGIN + '/')).toBe(true);
      expect(new URL(out).origin).toBe(ORIGIN);
    }
  });

  test('the portal\'s own next values are kept', () => {
    expect(safeNext('/')).toBe(ORIGIN + '/');
    expect(safeNext('/assist')).toBe(ORIGIN + '/assist');
    expect(safeNext('/assist?tab=chat')).toBe(ORIGIN + '/assist?tab=chat');
    expect(safeNext('/mockup_v3.html?x=1#calendar/day')).toBe(ORIGIN + '/mockup_v3.html?x=1#calendar/day');
    expect(safeNext(`${ORIGIN}/profile`)).toBe(ORIGIN + '/profile');
  });

  test('empty, missing and self-referencing values go home', () => {
    expect(safeNext(null)).toBe(ORIGIN + '/');
    expect(safeNext('')).toBe(ORIGIN + '/');
    expect(safeNext('/login')).toBe('/');
    expect(safeNext('/login?next=/assist')).toBe('/');
  });
});

describe('both redirect sites use safeNext', () => {
  test('no raw ?next= reaches location.replace', () => {
    expect(LOGIN).not.toContain(".get('next') || '/'");
    expect(LOGIN).toContain("window.location.replace(safeNext(new URLSearchParams(window.location.search).get('next')));");
    expect(LOGIN).toContain("const target = safeNext(new URLSearchParams(window.location.search).get('next'));");
  });

  test('a signed-in visit with a javascript: next goes home, not into the payload', async () => {
    const page = loadLoginPage({ search: "?next=javascript:void(document.title='X')" });
    await flush();
    expect(page.replace).toHaveBeenCalledTimes(1);
    expect(page.replace).toHaveBeenCalledWith('/');
  });

  test('a successful sign-in with a foreign next goes home', async () => {
    const page = loadLoginPage({
      search: '?next=//example.com/phish',
      meOk: false,
      loginResponse: { ok: true, json: async () => ({ ok: true }) },
    });
    await flush();
    await submitLogin(page);
    expect(page.replace).toHaveBeenCalledWith('/');
  });

  test('a successful sign-in keeps a same-origin next', async () => {
    const page = loadLoginPage({
      search: '?next=%2Fassist',
      meOk: false,
      loginResponse: { ok: true, json: async () => ({ ok: true }) },
    });
    await flush();
    await submitLogin(page);
    expect(page.replace).toHaveBeenCalledWith(ORIGIN + '/assist');
  });
});

describe('the auto-redirect cannot loop', () => {
  test('a signed-in session is sent on once, then the login page stays up', async () => {
    const storage = new Map();
    const first = loadLoginPage({ storage });
    await flush();
    expect(first.replace).toHaveBeenCalledWith(ORIGIN + '/');

    // The shell bounced straight back: this load must not redirect again.
    const second = loadLoginPage({ storage });
    await flush();
    expect(second.replace).not.toHaveBeenCalled();
    expect(second.warn).toHaveBeenCalled();
    const info = second.els['info-box'];
    expect(info.textContent).toContain('already signed in');
    expect(info.children).toHaveLength(1);
    expect(info.children[0].href).toBe(ORIGIN + '/');
  });

  test('the window is ~5 s and per target', () => {
    const { sandbox } = loadLoginPage({ meOk: false });
    const allowed = sandbox.autoRedirectAllowed;
    const t0 = 1_000_000;
    expect(allowed(ORIGIN + '/', t0)).toBe(true);
    expect(allowed(ORIGIN + '/', t0 + 300)).toBe(false);
    expect(allowed(ORIGIN + '/', t0 + 4999)).toBe(false);
    expect(allowed(ORIGIN + '/assist', t0 + 5000)).toBe(true);   // a different target
    expect(allowed(ORIGIN + '/', t0 + 11000)).toBe(true);        // window has passed
  });

  test('the form\'s redirect after a real sign-in is never blocked', async () => {
    const storage = new Map();
    loadLoginPage({ storage });
    await flush();
    const page = loadLoginPage({ storage, meOk: false, loginResponse: { ok: true, json: async () => ({ ok: true }) } });
    await flush();
    await submitLogin(page);
    expect(page.replace).toHaveBeenCalledWith(ORIGIN + '/');
  });

  test('storage that throws still lets the redirect through (nothing to count with)', () => {
    const { sandbox } = loadLoginPage({ meOk: false });
    sandbox.sessionStorage.getItem = () => { throw new Error('SecurityError'); };
    expect(sandbox.autoRedirectAllowed(ORIGIN + '/', 1)).toBe(true);
  });
});

'use strict';

/**
 * ONBOARDING FRONTEND GUARDS
 *
 * The portal shell has a set of traps that are invisible until something is
 * silently broken in production: NodeLists captured once at parse time, a view
 * id that must match its data-tab exactly, a role config that default-denies,
 * a route grammar that has to be taught every new tab, and a manual cache-bust
 * with no build step to do it for you.
 *
 * These tests pin each one for the onboarding surface. They are static-source
 * assertions in the same style as frontend-stage3-guards.test.js — no DOM, no
 * browser, just the invariants that a future edit could quietly violate.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const MODULE = fs.readFileSync(path.join(FRONTEND, 'onboarding.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'onboarding.css'), 'utf8');
const NAV = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');
const INVITE = fs.readFileSync(path.join(FRONTEND, 'onboarding-invite.html'), 'utf8');

// ═════════════════════════════════════════════════════════════════════════════

describe('the tab is reachable at all', () => {
  test('the tab button and its view are STATIC markup', () => {
    // `tabs` and `views` are NodeLists captured once when the inline script
    // parses. An element inserted at runtime is invisible to switchTab and
    // never receives a click handler.
    expect(SHELL).toContain('<button class="tab" data-tab="onboarding"');
    expect(SHELL).toContain('<section class="view" id="view-onboarding">');
  });

  test('the view id matches the data-tab exactly', () => {
    // switchTab matches v.id === 'view-' + name. A mismatch produces a tab
    // that highlights but shows nothing, with no error anywhere.
    const tabMatch = SHELL.match(/<button class="tab" data-tab="([a-z-]+)"[^>]*title="Onboarding/);
    expect(tabMatch).toBeTruthy();
    expect(SHELL).toContain(`<section class="view" id="view-${tabMatch[1]}">`);
  });

  test('the module has a container to render into', () => {
    expect(SHELL).toContain('<div id="ob-root"></div>');
    expect(MODULE).toContain("getElementById('ob-root')");
  });

  test('the tab is in ROLE_NAV for every role, or it is invisible to everyone', () => {
    // applyNavRoleVisibility default-denies: a tab absent from ROLE_NAV is
    // hidden for every role AND unreachable programmatically.
    const nav = SHELL.slice(SHELL.indexOf('var ROLE_NAV = {'), SHELL.indexOf('var ACCESS_DENIED_MESSAGE'));
    for (const role of ['owner', 'admin', 'therapist', 'read_only', 'pre_employee']) {
      const start = nav.indexOf(`${role}: {`);
      expect(start).toBeGreaterThan(-1);
      const end = nav.indexOf('\n  },', start) === -1 ? nav.length : nav.indexOf('\n  },', start);
      const block = nav.slice(start, Math.max(end, start + 200));
      expect(`${role}:${block.includes('onboarding')}`).toBe(`${role}:true`);
    }
  });

  test('a pre-employee gets exactly one tab', () => {
    // navAllowedTabs falls back to the THERAPIST config for an unknown role,
    // which would offer a new starter the calendar and case notes.
    const nav = SHELL.slice(SHELL.indexOf('var ROLE_NAV = {'), SHELL.indexOf('var ACCESS_DENIED_MESSAGE'));
    expect(nav).toContain("pre_employee: { primary: ['onboarding'] }");
    const block = nav.slice(nav.indexOf('pre_employee: {'));
    for (const forbidden of ['calendar', 'casenotes', 'contacts', 'billing', 'accounting', 'resources']) {
      expect(`${forbidden}:${block.includes(`'${forbidden}'`)}`).toBe(`${forbidden}:false`);
    }
  });

  test('the module is loaded, and above navigation.js which stays last', () => {
    const obIdx = SHELL.indexOf('src="/onboarding.js?v=');
    const navIdx = SHELL.indexOf('src="/navigation.js?v=');
    expect(obIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(-1);
    expect(obIdx).toBeLessThan(navIdx);
    expect(SHELL).toContain('href="/onboarding.css?v=');
  });

  test('switching to the tab lazily boots the module', () => {
    // navigation.js's restore() calls switchTab but no per-tab loader, so a
    // section whose data loads only from a click would render EMPTY when
    // reached by deep link, Back or Forward.
    expect(SHELL).toContain(
      "if (name === 'onboarding' && window.Onboarding && typeof window.Onboarding.open === 'function') window.Onboarding.open();"
    );
    expect(NAV).toMatch(/t\.tab === 'onboarding' && global\.Onboarding/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the route grammar knows the tab', () => {
  test('onboarding is in KNOWN_TABS', () => {
    // Without this '#onboarding' normalises to '#calendar': the section has no
    // address, and Back skips straight past it.
    const known = NAV.slice(NAV.indexOf('var KNOWN_TABS = ['), NAV.indexOf('var WIZARD_TABS'));
    expect(known).toContain("'onboarding'");
  });

  test('sub-views encode, decode and round-trip', () => {
    const helpers = require(path.join(FRONTEND, 'navigation.js'));
    for (const [hash, expected] of [
      ['#onboarding', '#onboarding'],
      ['#onboarding/packages', '#onboarding/packages'],
      ['#onboarding/start', '#onboarding/start'],
      // Track Onboarding is the bare address, so it degrades to itself.
      ['#onboarding/track', '#onboarding'],
      // The retired sub-view addresses — dashboard, active, employees,
      // compliance, expiring, documents, settings — degrade to the bare
      // address, so an old bookmark lands on Track rather than nothing.
      ['#onboarding/active', '#onboarding'],
      ['#onboarding/dashboard', '#onboarding'],
      ['#onboarding/compliance', '#onboarding'],
      ['#onboarding/settings', '#onboarding'],
      // An unrecognised sub-view never produces an address that renders nothing.
      ['#onboarding/nonsense', '#onboarding'],
      ['#onboarding/', '#onboarding'],
    ]) {
      expect(`${hash} → ${helpers.encodeRoute(helpers.decodeRoute(hash))}`)
        .toBe(`${hash} → ${expected}`);
    }
  });

  test('a hostile hash cannot smuggle anything through', () => {
    const helpers = require(path.join(FRONTEND, 'navigation.js'));
    for (const hash of [
      '#onboarding/../../etc/passwd',
      '#onboarding/' + 'x'.repeat(600),
      '#onboarding/<script>alert(1)</script>',
    ]) {
      const out = helpers.encodeRoute(helpers.decodeRoute(hash));
      expect(out).toBe('#onboarding');
    }
  });

  test('leaving the tab clears its remembered sub-view', () => {
    expect(NAV).toContain("if (name !== 'onboarding') NAV.obView = null;");
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the module follows house conventions', () => {
  test('it is one IIFE publishing one global', () => {
    expect(MODULE).toMatch(/^'use strict';/m);
    expect(MODULE).toMatch(/\(function \(global\) \{/);
    expect(MODULE).toContain('global.Onboarding = api_;');
  });

  test('every function called from an inline onclick is on the namespace', () => {
    // The modules use no event delegation for their own controls, so a handler
    // missing from the namespace is a dead button with a console error.
    const referenced = new Set(
      [...MODULE.matchAll(/Onboarding\.([a-zA-Z_]+)\(/g)].map((m) => m[1])
    );
    const exported = new Set(
      [...MODULE.matchAll(/^ {4}([a-zA-Z_]+):/gm)].map((m) => m[1])
    );
    const missing = [...referenced].filter((r) => !exported.has(r));
    expect(missing).toEqual([]);
    expect(referenced.size).toBeGreaterThan(20);
  });

  test('it uses credentials:include and never throws from api()', () => {
    expect(MODULE).toContain("credentials: 'include'");
    const fn = MODULE.slice(MODULE.indexOf('async function api('), MODULE.indexOf('function toast('));
    expect(fn).toMatch(/catch \(_\) \{/);
    expect(fn).toContain("error: 'Network error");
  });

  test('showToast is called with the two-argument signature', () => {
    // window.showToast is (msg, isError). A third argument, or a subtitle in
    // the second slot, renders a red error toast for a success message.
    const calls = [...MODULE.matchAll(/showToast\(([^)]*)\)/g)].map((m) => m[1]);
    for (const args of calls) {
      expect(args.split(',').length).toBeLessThanOrEqual(2);
    }
  });

  test('all interpolated values are escaped', () => {
    expect(MODULE).toContain('function esc(');
    // Every server value interpolated into MARKUP goes through esc() or
    // jsq(). Only lines that actually build HTML are checked — a fetch
    // Response status inside an error string is not markup.
    const htmlLines = MODULE.split('\n').filter((l) => l.includes("'<") || l.includes('"<'));
    const raw = htmlLines
      .flatMap((l) => l.match(/\+ (?:a|r|d|p|c|e|u|v|i)\.[a-zA-Z_]+ \+/g) || []);
    expect(raw).toEqual([]);
  });

  test('it does not install a second fetch patch', () => {
    // window.fetch is already globally monkey-patched for session expiry.
    expect(MODULE).not.toMatch(/window\.fetch\s*=/);
    expect(MODULE).not.toMatch(/global\.fetch\s*=/);
  });

  test('role gating reads APP_USER and guards currentUserCan', () => {
    // currentUserCan is defined inside the async initAuth IIFE and does not
    // exist until GET /api/auth/me resolves — calling it at load time throws.
    expect(MODULE).toContain("typeof global.currentUserCan === 'function'");
    expect(MODULE).toContain('global.APP_USER');
  });

  test('client gating is described as UI honesty, not the boundary', () => {
    expect(MODULE).toMatch(/never the security boundary|not the security boundary/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('overlays and styling traps', () => {
  test('the modal is appended to document.body, not to the view', () => {
    // A position:fixed overlay authored inside a .view never paints while its
    // tab is inactive, because display:none on an ancestor kills fixed
    // positioning. letter-root, fca-root and assessment-root are body children
    // for exactly this reason.
    expect(MODULE).toContain('doc.body.appendChild(el)');
    expect(SHELL).not.toContain('ob-modal-backdrop');
  });

  test('the hero is a div, not a <header>', () => {
    // The bare `header` element selector is position:sticky with z-index 1000
    // and would float over the nav dropdown.
    expect(MODULE).not.toMatch(/<header/);
    expect(CSS).toContain('.ob-hero');
    expect(CSS).toMatch(/A div, not a <header>/);
  });

  test('no unprefixed global selector is introduced', () => {
    // .status-pill is already declared twice globally with competing cascades.
    const selectors = [...CSS.matchAll(/^([.#][A-Za-z][\w-]*)/gm)].map((m) => m[1]);
    const unprefixed = selectors.filter((s) => !s.startsWith('.ob-') && !s.startsWith('#ob-'));
    expect(unprefixed).toEqual([]);
    // .status-pill is named only in the comment explaining why it is avoided.
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toContain('.status-pill');
  });

  test('colours come from design tokens, not hardcoded hexes', () => {
    // A handful of rgba() shadows and the modal scrim are legitimate.
    const hexes = (CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
    // The remainder are chip border tints, which have no token of their own,
    // and the two #fff values inside gradients. Everything structural is a var.
    expect(hexes.length).toBeLessThan(35);
    expect(CSS).toContain('var(--accent)');
    expect(CSS).toContain('var(--radius-lg)');
    expect(CSS).toContain('var(--border)');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('accessibility', () => {
  test('status is never carried by colour alone', () => {
    // Every chip renders its own text label.
    const fn = MODULE.slice(MODULE.indexOf('function chip('), MODULE.indexOf('function basisChip('));
    expect(fn).toContain('titleCase(status)');
    expect(fn).toContain('esc(label)');
  });

  test('progress bars expose their value to assistive technology', () => {
    const fn = MODULE.slice(MODULE.indexOf('function meter('), MODULE.indexOf('function empty('));
    expect(fn).toContain('role="progressbar"');
    expect(fn).toContain('aria-valuenow');
    expect(fn).toContain('aria-label');
    // …and the same numbers are written out in text beside the bar.
    expect(fn).toContain("' of '");
  });

  test('the modal is a labelled dialog that traps and restores focus', () => {
    expect(MODULE).toContain("setAttribute('role', 'dialog')");
    expect(MODULE).toContain("setAttribute('aria-modal', 'true')");
    expect(MODULE).toContain("aria-labelledby");
    expect(MODULE).toContain("_modalReturnFocus");
    expect(MODULE).toMatch(/e\.key === 'Escape'/);
    expect(MODULE).toMatch(/e\.key !== 'Tab'/);
  });

  test('every form input has a real label', () => {
    const fn = MODULE.slice(MODULE.indexOf('function field('), MODULE.indexOf('function selectField('));
    expect(fn).toContain('<label for="');
    expect(fn).toContain('id="' + "' + id + '" + '"');
  });

  test('errors are announced', () => {
    expect(MODULE).toContain("setAttribute('role', 'alert')");
    expect(MODULE).toContain('aria-describedby');
  });

  test('clickable table rows are keyboard reachable', () => {
    expect(MODULE).toMatch(/tabindex="0" role="link"/);
    expect(MODULE).toMatch(/onkeydown="if\(event\.key===\\?'Enter\\?'\)/);
  });

  test('radio groups are grouped for assistive technology', () => {
    expect(MODULE).toContain('role="radiogroup"');
    expect(MODULE).toContain('aria-labelledby');
  });

  test('the stylesheet respects reduced motion and provides focus rings', () => {
    expect(CSS).toContain('prefers-reduced-motion');
    expect(CSS).toContain(':focus-visible');
    expect(CSS).toContain('var(--focus-ring)');
  });

  test('the stylesheet is responsive and scrolls wide tables rather than the page', () => {
    expect(CSS).toContain('@media (max-width: 640px)');
    expect(CSS).toMatch(/\.ob-table-wrap \{[^}]*overflow-x: auto/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the invitation page', () => {
  test('it is excluded from search indexes', () => {
    expect(INVITE).toContain('name="robots" content="noindex, nofollow"');
  });

  test('the token is stripped from the address bar once read', () => {
    // Otherwise it lingers in history, bookmarks and any screenshot.
    expect(INVITE).toContain('history.replaceState');
    expect(INVITE).toMatch(/window\.location\.pathname/);
  });

  test('it escapes every server value it renders', () => {
    expect(INVITE).toContain('function esc(');
    expect(INVITE).toMatch(/esc\(r\[0\]\)/);
  });

  test('it confirms the password before submitting', () => {
    expect(INVITE).toContain("password !== confirm");
    expect(INVITE).toMatch(/password\.length < 8/);
  });

  test('it tells people not to email sensitive documents', () => {
    expect(INVITE).toMatch(/tax file number/i);
    expect(INVITE).toMatch(/don.t email us/i);
  });

  test('it uses autocomplete tokens a password manager understands', () => {
    expect(INVITE).toContain('autocomplete="new-password"');
    expect(INVITE).toContain('autocomplete="name"');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('what the employee is told', () => {
  test('the two meters are rendered as a pair and never summed', () => {
    const fn = MODULE.slice(MODULE.indexOf('async function renderMine('), MODULE.indexOf('function renderMineSection('));
    expect(fn).toContain("meter('Your progress'");
    expect(fn).toContain("meter('Our review'");
    // The employee's own meter must not be told it is incomplete because
    // somebody else has not finished checking.
    expect(fn).toMatch(/nothing for you to do/i);
  });

  test('sensitive fields say what happens to the value', () => {
    expect(MODULE).toMatch(/encrypted before they are stored/i);
    expect(MODULE).toMatch(/only the last four digits are ever shown/i);
    expect(MODULE).toMatch(/never displayed again/i);
  });

  test('the identity form explains sighting rather than scanning', () => {
    expect(MODULE).toMatch(/sight<\/strong> your document/i);
    expect(MODULE).toMatch(/less of your personal information for us to hold/i);
  });

  test('a correction shows the reason to the person who has to act on it', () => {
    expect(MODULE).toContain('We need a correction');
    expect(MODULE).toContain('r.reviewReason');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('what the owner is told', () => {
  test('an unregistered provider is not told screening is the law', () => {
    expect(MODULE).toMatch(/required by law only for risk-assessed roles of registered/i);
    expect(MODULE).toMatch(/still binds every worker/i);
  });

  test('the WA / national system question is surfaced rather than guessed', () => {
    expect(MODULE).toMatch(/sole trader/i);
    expect(MODULE).toMatch(/state system/i);
  });

  test('missing encryption is surfaced as a blocker, not a warning to ignore', () => {
    expect(MODULE).toMatch(/Encryption is not configured/);
    expect(MODULE).toMatch(/refused rather than storing those values unencrypted/i);
  });

  test('delegation warns that an Admin employee is not an onboarding admin', () => {
    expect(MODULE).toMatch(/An Admin employee is not automatically an onboarding/i);
  });

  test('waiving explains what it cannot do', () => {
    expect(MODULE).toMatch(/cannot be used on registration, screening or work-rights/i);
  });

  test('publishing explains that existing assignments are pinned', () => {
    expect(MODULE).toMatch(/assignments stay pinned to their own version/i);
  });

  test('unwritten policies are explained, not hidden', () => {
    expect(MODULE).toMatch(/deliberately does not write the policies/i);
  });
});

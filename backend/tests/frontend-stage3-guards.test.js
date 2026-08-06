'use strict';

/**
 * STAGE 3 PILOT-LAUNCH-PREP STATIC GUARDS — P1 UX polish pinned against
 * regression (same approach as the Stage 1/2 guards).
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'mockup_v3.html'), 'utf8');

describe('professional shell', () => {
  test('title is professional — no "Mockup"', () => {
    expect(HTML).toContain('<title>Opal Therapy Portal</title>');
    expect(HTML).not.toMatch(/<title>[^<]*Mockup[^<]*<\/title>/);
  });
  test('DOCTYPE is intact standards-mode (corruption repaired)', () => {
    expect(HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(HTML).not.toContain('<!DOCTYP\n');
  });
  test('Outlook-only button lives in the calendar toolbar now', () => {
    const idx = HTML.indexOf('id="btn-outlook-only"');
    expect(idx).toBeGreaterThan(1000); // not spliced into line 1 any more
    expect(HTML.match(/id="btn-outlook-only"/g).length).toBe(1);
  });
});

describe('no hardcoded Ann identity in the UI', () => {
  test('legacy headings and clinic entries are generic', () => {
    expect(HTML).not.toContain('Ann Mary Mathew');
    expect(HTML).not.toContain("schedule — Ann");
    expect(HTML).not.toContain('This week — Ann');
  });
});

describe('dead Travel tab neutralised', () => {
  test('tab is disabled with Coming soon; dead functions no longer referenced', () => {
    expect(HTML).toMatch(/data-tab="travel"[^>]*disabled/);
    expect(HTML).not.toContain('showAddFlightModal()');
    expect(HTML).not.toContain('addManualTravel()');
  });
});

describe('no fake success language', () => {
  const BANNED = [
    "showToast('Booking recorded'",
    "showToast('Case noting scheduled'",
    "showToast('Downloaded', 'Schedule saved as PDF.')",
    "' noted', 'Blocked '",
    'The staff member will be notified',
    'Synced with Splose · 14s ago',
  ];
  for (const b of BANNED) {
    test(`absent: ${b.slice(0, 45)}`, () => { expect(HTML).not.toContain(b); });
  }
  test('honest preview/not-sent wording present', () => {
    expect(HTML).toContain("showToast('Booking not sent'");
    expect(HTML).toContain("Preview only — not saved");
  });
});

describe('frozen mockup dates removed from launch-facing code', () => {
  test('DAY_LABEL is computed from the real week', () => {
    expect(HTML).not.toContain("mon:'Mon 20 Apr'");
    expect(HTML).toContain('const DAY_LABEL = (function () {');
  });
  test('clocks are real', () => {
    expect(HTML).not.toContain("new Date('2026-04-20')");
    expect(HTML).toContain('const TODAY = new Date();');
  });
  test('booking header is dynamic', () => {
    expect(HTML).not.toContain('Ann · Mon 20 Apr – Fri 24 Apr 2026');
    expect(HTML).toContain('id="book-week-sub"');
    expect(HTML).toContain('function setBookingWeekSub()');
  });
});

describe('launch-facing affordances', () => {
  test('PD documents table has a Download action', () => {
    expect(HTML).toContain('href="/api/profile/documents/${d.id}/download"');
  });
  test('resource empty state does not promise the non-existent draft flow', () => {
    expect(HTML).not.toContain('therapist drafts appear after review');
  });
  test('weekend toggle keeps its explanatory copy', () => {
    expect(HTML).toContain('Display Saturday and Sunday in week view');
  });
  test('Outlook settings copy explains connect/disconnect scope', () => {
    expect(HTML).toContain('Disconnect stops sync for your account only');
  });
});

// ── Browser-QA regressions (2026-08-01) ──────────────────────────────────────
describe('browser QA fixes', () => {
  test('cached practice data is cleared on sign-out (cross-role leak fix)', () => {
    expect(HTML).toContain('window.clearCachedPracticeData = function ()');
    expect(HTML).toContain("k.indexOf('splose_swr_') === 0");
    // signOut must call it before redirecting
    const so = HTML.slice(HTML.indexOf('window.signOut = async function'), HTML.indexOf('window.signOut = async function') + 400);
    expect(so).toContain('window.clearCachedPracticeData()');
  });

  test('a different user in the same browser session drops the previous caches', () => {
    expect(HTML).toContain("sessionStorage.getItem('portal_last_user')");
    expect(HTML).toContain("sessionStorage.setItem('portal_last_user'");
  });

  test('role-based nav gating is applied with retry (no silent no-op)', () => {
    expect(HTML).toContain('function applyRoleGatingWhenReady(attempt)');
    expect(HTML).toContain('applyNavRoleVisibility(window.APP_USER.role)');
    // the old unguarded single-shot call must be gone
    expect(HTML).not.toContain("if (typeof initMasterCalendarAccess === 'function') initMasterCalendarAccess();\n");
  });
});

// ── Installable web app (icons + manifest, 2026-08-01) ───────────────────────
describe('installable web app', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');

  test('every served page links the icon set and manifest', () => {
    const pages = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
    expect(pages.length).toBeGreaterThanOrEqual(8);
    for (const page of pages) {
      const html = fs.readFileSync(path.join(FRONTEND, page), 'utf8');
      expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
      expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
      expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
      expect(html).toContain('<meta name="theme-color" content="#00a8cc" />');
    }
  });

  test('manifest is valid and every icon it references exists', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'site.webmanifest'), 'utf8'));
    expect(manifest.name).toBe('Opal Therapy Portal');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    for (const icon of manifest.icons) {
      const buf = fs.readFileSync(path.join(FRONTEND, icon.src.replace(/^\//, '')));
      expect(buf.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    }
  });

  test('favicon.ico exists and is a real ICO (fixes the QA favicon 404)', () => {
    const ico = fs.readFileSync(path.join(FRONTEND, 'favicon.ico'));
    // ICONDIR: reserved=0, type=1 (icon), count >= 1
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
    const touch = fs.readFileSync(path.join(FRONTEND, 'icons', 'apple-touch-icon.png'));
    expect(touch.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });
});

// ── Compact calendar week view (2026-08-06) ──────────────────────────────────
describe('compact calendar week view', () => {
  test('hour height is the compact 48px and all coordinate math uses the constant', () => {
    expect(HTML).toContain('const HOUR_PX = 48;');
    // No stray hardcoded 60px/hour math reintroduced alongside the constant
    expect(HTML).not.toMatch(/const HOUR_PX = 60/);
  });

  test('event tiles truncate with ellipsis instead of growing', () => {
    const sTitle = HTML.slice(HTML.indexOf('.session .s-title {'), HTML.indexOf('.session .s-title {') + 300);
    expect(sTitle).toContain('white-space: nowrap');
    expect(sTitle).toContain('text-overflow: ellipsis');
  });

  test('tiles render a time range line and duration-aware density classes', () => {
    expect(HTML).toContain('class="s-time"');
    expect(HTML).toContain('function applySessionDensity(el, durationMin)');
    expect(HTML).toContain(".session.s-compact .s-time, .session.s-compact .s-sub { display: none; }");
    // resize paths refresh density so a stretched tile regains its time line
    expect(HTML.match(/applySessionDensity\(/g).length).toBeGreaterThanOrEqual(4);
  });

  test('weekday header stays sticky and today keeps a non-heavy highlight', () => {
    const anchor = HTML.indexOf('Day column headers — compact single-line');
    expect(anchor).toBeGreaterThan(-1);
    const head = HTML.slice(anchor, anchor + 600);
    expect(head).toContain('position: sticky');
    expect(HTML).toContain('.cal-col.today { background: rgba(0, 168, 204, 0.035); }');
  });

  test('overlap layout algorithm is unchanged (side-by-side lanes)', () => {
    expect(HTML).toContain('function reflowDayOverlaps(col)');
    expect(HTML).toContain('Greedy lane assignment');
  });

  test('external-calendar-only tiles keep a non-colour indicator', () => {
    expect(HTML).toContain('.session[data-type="outlook"]::before');
    expect(HTML).toContain('External calendar event (Outlook only)');
  });

  test('half-hour guides painted; small screens scroll horizontally', () => {
    expect(HTML).toContain("className = 'hour-line half'");
    expect(HTML).toContain('.cal-grid.view-week { min-width: 700px; }');
  });

  test('no hardcoded Ann identity in reschedule warnings', () => {
    expect(HTML).not.toContain("Ann's working window");
  });
});

// ── RBAC role-based navigation (2026-08-06) ──────────────────────────────────
describe('role-based navigation (RBAC)', () => {
  test('explicit per-role nav config exists with default-deny allowlists', () => {
    expect(HTML).toContain("therapist: { primary: ['profile', 'calendar', 'logbook', 'resources'] }");
    expect(HTML).toContain("read_only: { primary: ['profile', 'calendar', 'resources'] }");
    expect(HTML).toContain("['Practice Management', ['contacts', 'activity', 'billing', 'ndis', 'dormant']]");
    expect(HTML).toContain("['Business', ['resources', 'accounting', 'settings']]");
    // admin gets a Travel menu only — no business/practice groups
    const roleNav = HTML.indexOf('var ROLE_NAV = {');
    expect(roleNav).toBeGreaterThan(-1);
    const adminCfg = HTML.slice(HTML.indexOf('admin: {', roleNav), HTML.indexOf("therapist: { primary", roleNav));
    expect(adminCfg).toContain("label: 'Travel'");
    expect(adminCfg).not.toContain('accounting');
    expect(adminCfg).not.toContain('billing');
  });

  test('switch-time guard blocks unpermitted tabs and lands on Calendar', () => {
    expect(HTML).toContain('window.__navGuardInstalled');
    expect(HTML).toContain("var ACCESS_DENIED_MESSAGE = 'You do not have access to this area. Please contact the practice owner if you believe this is incorrect.'");
    expect(HTML).toContain("name = 'calendar'; // permitted home screen");
  });

  test('the dropdown moves REAL tab buttons (badges/active state keep working)', () => {
    expect(HTML).toContain("wrap.id = 'nav-more-wrap'");
    expect(HTML).toContain("menu.id = 'nav-more-menu'");
    expect(HTML).toContain('function toggleNavMoreMenu(force)');
  });

  test('global search respects the role allowlist (no hidden-area leakage)', () => {
    expect(HTML).toContain('if (!allowedTabs.includes(n.tab)) return;');
    expect(HTML).toContain("(role === 'owner' || role === 'admin') && typeof PATIENTS !== 'undefined'");
    expect(HTML).toContain("!allowedTabs.includes('settings') ? [] :");
  });

  test('header settings gear is gated with the Settings tab rule', () => {
    expect(HTML).toContain('id="hdr-settings-btn"');
    expect(HTML).toContain("gear.style.display = allowed.includes('settings')");
  });

  test('cache clearing extends to practice-adjacent localStorage', () => {
    expect(HTML).toContain("k.indexOf('manual_addr_') === 0");
    expect(HTML).toContain("k.indexOf('session_note_') === 0");
    expect(HTML).toContain("k === 'opal_recent_searches'");
  });
});

// ── My Profile dashboard redesign (2026-08-06) ───────────────────────────────
describe('profile dashboard redesign', () => {
  const view = () => HTML.slice(HTML.indexOf('<section class="view" id="view-profile">'),
                                HTML.indexOf('<!-- ============ BOOK TAB ============ -->'));

  test('compact summary + seven area cards + focused-area host render', () => {
    const v = view();
    expect(v).toContain('class="pf-summary panel panel-pad"');
    expect(v).toContain('id="pf-summary-status"');
    expect(v).toContain('id="pf-dashboard"');
    expect(v).toContain('id="pf-area-host"');
    expect((v.match(/class="pf-card"/g) || []).length).toBe(7);
    // role-dynamic card labels keep their ids so section loaders rename them
    expect(v).toContain('id="pf-nav-leave-label"');
    expect(v).toContain('id="pf-nav-cpd-label"');
  });

  test('cards open focused areas; back returns to the dashboard', () => {
    expect(HTML).toContain('function pfOpenArea(id)');
    expect(HTML).toContain('function pfBackToDashboard()');
    expect(HTML).toContain('function scrollToProfile(id) { pfOpenArea(id); }');
    expect(HTML).toContain("PF_AREA_IDS = ['pf-details', 'pf-location', 'pf-leave', 'pf-cpd', 'pf-pddocs', 'pf-credentials', 'pf-alerts']");
  });

  test('no emojis on the profile dashboard or its panels', () => {
    const v = view();
    for (const e of ['✅', '⚠️', '🏠', '💻', '📎', '👤', '📅']) {
      expect(v).not.toContain(e);
    }
    expect(HTML).not.toContain("'<span style=\"font-size:14px;\">' + (ok ? '✅' : '⚠️') + '</span>'");
  });

  test('long explanatory copy is off the dashboard', () => {
    expect(HTML).not.toContain('Runs the Distance Matrix API');
    expect(HTML).not.toContain('Air-BnB for regional weeks');
    expect(HTML).not.toContain('which can hide real travel costs');
  });

  test('setup card hides once complete; summary shows a subtle status', () => {
    expect(HTML).toContain("if (!pending) { card.style.display = 'none'; return; }");
    expect(HTML).toContain('</span>Setup complete');
    expect(HTML).toContain("' setup step' + (pending === 1 ? '' : 's') + ' remaining'");
  });
});

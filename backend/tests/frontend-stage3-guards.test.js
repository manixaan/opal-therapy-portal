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
      expect(html).toContain('<meta name="theme-color" content="#0f7c6c" />');
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
    expect(HTML).toContain(".session.s-compact .s-time { display: block; order: -1;"); // short events: time first
    // resize paths refresh density so a stretched tile regains its time line
    expect(HTML.match(/applySessionDensity\(/g).length).toBeGreaterThanOrEqual(4);
  });

  test('weekday header stays sticky and today keeps a non-heavy highlight', () => {
    const anchor = HTML.indexOf('Day column headers — compact single-line');
    expect(anchor).toBeGreaterThan(-1);
    const head = HTML.slice(anchor, anchor + 600);
    expect(head).toContain('position: sticky');
    expect(HTML).toContain('.cal-col.today { background: rgba(15, 124, 108, 0.04); }');
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
    expect(adminCfg).toContain("label: 'Menu'");
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

// ── Travel Logbook redesign (2026-08-06) ─────────────────────────────────────
describe('travel logbook redesign', () => {
  test('informal sources legend and emoji markers are gone', () => {
    expect(HTML).not.toContain('<span>Sources:</span>');
    expect(HTML).not.toContain('✅ Splose support items');
    expect(HTML).not.toContain('📅 Calendar-derived (current week)');
    expect(HTML).toContain('.lb-src {'); // style retained for list-level badges
  });

  test('kilometre rate comes from the org setting, not a hardcode', () => {
    expect(HTML).not.toContain('ATO rate: $0.88/km');
    expect(HTML).not.toContain('const ATO_RATE  = 0.88');
    expect(HTML).toContain('Number(data.kilometreRate) || Number(window.ATO_RATE) || 0.88');
    expect(HTML).toContain('id="lb-claim-label"');
  });

  test('rows are clickable + keyboard-focusable and open the detail panel', () => {
    expect(HTML).toContain('class="lb-row" tabindex="0" role="button"');
    expect(HTML).toContain("onkeydown=\"if(event.key==='Enter'||event.key===' ')");
    expect(HTML).toContain('function lbOpenEntry(id, isRestore)');
    expect(HTML).toContain('id="modal-travel-entry"');
    expect(HTML).toContain('.lb-row:focus-visible');
  });

  test('travel breakdown uses explicit labels, one-leg shows one leg', () => {
    expect(HTML).toContain("row('Total travel'");
    expect(HTML).toContain("row('To appointment'");
    expect(HTML).toContain("row('From appointment'");
    expect(HTML).toContain("row('Travel to appointment'");
    expect(HTML).toContain("row('Travel from appointment'");
    // the ambiguous inline "15 + 20 min" cell format is gone
    expect(HTML).not.toContain("${t.toMinutes||0}${t.returnMinutes ? ' + ' + t.returnMinutes : ''} min");
  });

  test('simplified panel: editable addresses + short no-event message', () => {
    expect(HTML).toContain('id="lb-edit-from"');
    expect(HTML).toContain('id="lb-edit-to"');
    expect(HTML).toContain("lbSaveAddresses(");
    expect(HTML).toContain("'/api/travel/logbook/' + encodeURIComponent(id) + '/addresses'");
    expect(HTML).toContain('No linked calendar event is available for this trip.');
    const panel = HTML.slice(HTML.indexOf('function lbOpenEntry(id'), HTML.indexOf('async function lbSaveAddresses'));
    expect(panel).not.toContain('Appointment reference');
    expect(panel).not.toContain('Source system');
    expect(panel).not.toContain('Calculation details');
  });

  test('data comes from the role-scoped backend route with v2 cache', () => {
    expect(HTML).toContain("SploseSync.apiFetch('/api/travel/logbook?fy='");
    expect(HTML).toContain("cached._fy === fy && cached._v === 2");
    expect(HTML).toContain('practitioner_mapping_required');
    // the old direct support-items call is gone from the logbook
    expect(HTML).not.toContain("SploseSync.apiFetch('/api/splose/support-items')");
  });
});

// ── Resource Hub V1 (2026-08-06) ─────────────────────────────────────────────
describe('resource hub v1', () => {
  const view = () => HTML.slice(HTML.indexOf('<section class="view" id="view-resources">'),
                                HTML.indexOf('<!-- ============ ACCOUNTING TAB'));

  test('three functional areas — no Coming Soon, no disabled tabs', () => {
    const v = view();
    expect(v).toContain('>Resource Library</button>');
    expect(v).toContain('>AI Resource Studio</button>');
    expect(v).toContain('Therapy Store &amp; Purchase Requests</button>');
    expect(v).not.toContain('Coming soon');
    expect(v).not.toContain('rh-soon">Not enabled');
  });

  test('library has sections, search, filters, reset and saved view', () => {
    expect(HTML).toContain("{ key: 'saved',     label: 'My Saved Resources' }");
    expect(HTML).toContain("{ key: 'kits',      label: 'Starter Kits' }");
    expect(HTML).toContain("rhSection === 'saved' ? '&saved=1' : ''");
    expect(HTML).toContain('function rhResetFilters()');
    expect(HTML).toContain('function rhOpenResource(id)');
    expect(HTML).toContain("rhFeedback(");
    expect(HTML).toContain("rhReport(");
  });

  test('starter kits are guided workflows with per-user progress', () => {
    expect(HTML).toContain('var RH_KITS = [');
    expect(HTML).toContain("fetch('/api/resources/kits/progress'");
    expect(HTML).toContain('function rhToggleKitStep(kitKey, idx, on)');
  });

  test('AI studio is a local draft workspace — no provider call exists', () => {
    const v = view();
    expect(v).toContain('AI generation is not enabled yet');
    expect(v).toContain('Do not include client-identifying or sensitive clinical information.');
    expect(v).toContain('>Create manual draft</button>');
    expect(HTML).toContain("fetch('/api/resources/ai-drafts/config'");
    expect(HTML).not.toMatch(/fetch\(['"][^'"]*\/api\/(ai|generate|llm)\b/i);
  });

  test('store runs the local purchase workflow only — no accounting calls', () => {
    const v = view();
    expect(HTML).toContain("fetch('/api/purchases'");
    expect(HTML).toContain('function rhSavePurchase(alsoSubmit)');
    expect(HTML).toContain('function rhPurchaseAction(id, action)');
    expect(v).toContain('Tax treatment is an accounting-review field');
    expect(v).toContain('nothing is sent externally from this portal');
    expect(v).not.toMatch(/fetch\([^)]*xero/i);
  });

  test('submit flow keeps the client-privacy reminder; no emojis in hub', () => {
    const v = view();
    expect(v).toContain('Do not upload client-identifying information.');
    expect(HTML).toContain('function rhSubmitResource()');
    for (const e of ['★', '☆', '⚠ ', '📚', '🤖', '🛒']) expect(v).not.toContain(e);
    expect(HTML).toContain("(r.favourited ? 'Saved' : 'Save')");
  });

  test('owner-only moderation stays role-gated in UI (backend enforces separately)', () => {
    expect(HTML).toContain("function rhIsOwner() { return !!(window.APP_USER && window.APP_USER.role === 'owner'); }");
    expect(HTML).toContain("statusSel.style.display = rhIsOwner()");
  });
});

// ── Outlook-style calendar workspace (2026-08-06) ────────────────────────────
describe('calendar workspace redesign', () => {
  test('three-panel structure: sidebar + main, toolbar preserved with its help ids', () => {
    expect(HTML).toContain('class="cal-workspace"');
    expect(HTML).toContain('id="cal-sidebar"');
    expect(HTML).toContain('class="cal-main"');
    // toolbar anchors the help tours rely on are untouched
    for (const id of ['cal-view-tabs', 'cal-today', 'cal-week-label', 'cal-legend', 'cal-sync-strip', 'cal-add-event', 'calendar-grid']) {
      expect(HTML).toContain(`data-help="${id}"`);
    }
  });

  test('mini month drives the existing navigation API', () => {
    expect(HTML).toContain('function renderMiniCal(keepAnchor)');
    expect(HTML).toContain('function miniNav(delta)');
    expect(HTML).toContain("window.gotoWeekOf(ymd);");
    expect(HTML).toContain("switchToCalDay(new Date(ymd + 'T00:00:00Z'))");
    // week header re-render keeps it in sync
    expect(HTML).toContain("if (typeof renderMiniCal === 'function') { try { renderMiniCal(); } catch (_) {} }");
  });

  test('calendar visibility list is presentation-only CSS filtering', () => {
    expect(HTML).toContain('var CAL_VIS_CATS = [');
    expect(HTML).toContain("grid.classList.toggle('hide-cat-' + c.key");
    expect(HTML).toContain('.cal-grid.hide-cat-travel .travel-overlay { display: none !important; }');
    expect(HTML).toContain('All therapists (Master view)');
  });

  test('all-day row exists, hidden when empty, and >=23h events become chips', () => {
    expect(HTML).toContain('class="cal-grid view-week no-allday"');
    expect(HTML).toContain('class="allday-cell" data-day="mon" id="allday-mon"');
    expect(HTML).toContain('function addAllDayChip(day, opts)');
    expect(HTML).toContain('function clearAllDayChips()');
    expect(HTML).toContain('_spanMin >= 23 * 60');
    // chips open the existing detail panel — no new detail system
    expect(HTML).toContain("if (typeof openBlockDetail === 'function') openBlockDetail(id);");
  });

  test('week view shows the full Mon-Sun week by default; Settings can hide weekends', () => {
    expect(HTML).toContain('var showWeekends = s.showWeekends !== false; // full Mon-Sun week by default');
    expect(HTML).toContain('.cal-col[data-day="sat"], .cal-col[data-day="sun"] { background: #fbfaf7; }');
    expect(HTML).toContain('Display Saturday and Sunday in week view'); // setting still there
  });

  test('settings load at boot with a parse-order retry (no silent no-op)', () => {
    expect(HTML).toContain('function loadSettingsWhenReady(attempt)');
    // the old unguarded single-shot call must be gone
    expect(HTML).not.toContain("if (typeof loadUserSettings === 'function') loadUserSettings();\n");
  });

  test('sidebar collapses to a drawer on small screens', () => {
    expect(HTML).toContain('function toggleCalSidebar()');
    expect(HTML).toContain('id="btn-cal-sidebar"');
    expect(HTML).toContain('.cal-sidebar.open { transform: none; }');
  });
});

// ── Travel Logbook journey view (2026-08-06 second pass) ─────────────────────
describe('travel logbook journey view', () => {
  test('journey list replaces the technical table (no Source/Type columns)', () => {
    expect(HTML).toContain('class="lb-j-route"');
    const lbRenderer = HTML.slice(HTML.indexOf('function _renderLogbookFromData'), HTML.indexOf('function lbTravelBreakdownHtml'));
    expect(lbRenderer).not.toContain('<th>');
    expect(lbRenderer).not.toContain('lb-src'); // source label lives in the detail panel only
    expect(HTML).toContain("'Round trip · ' : hasTo ? 'To ' : hasFrom ? 'From '");
  });

  test('selected-journey side panel with modal fallback on small screens', () => {
    expect(HTML).toContain('id="lb-detail-side"');
    expect(HTML).toContain('id="lb-detail-content"');
    expect(HTML).toContain("window.matchMedia('(min-width: 901px)')");
    expect(HTML).toContain('window.__lbSelectedId = id;');
    // returning restores the selection
    expect(HTML).toContain('lbOpenEntry(window.__lbSelectedId, true);');
  });

  test('needs-review flag only when attention is needed; nothing invented', () => {
    expect(HTML).toContain('<span class="lb-j-review">Needs review</span>');
    expect(HTML).toContain("departs ~' + _lbFmtTime"); // estimated, tilde-marked
  });
});

// ── Design tokens (2026-08-06 visual system) ─────────────────────────────────
describe('design token system', () => {
  test('token scales exist and core components consume them', () => {
    expect(HTML).toContain('--radius-lg: 16px;');
    expect(HTML).toContain('--shadow-sm:');
    expect(HTML).toContain('--focus-ring:');
    expect(HTML).toContain('box-shadow: var(--focus-ring);');
    expect(HTML).toContain('--bg: #faf6f0;');
  });
});

// ── Calendar selection coordinate fix (2026-08-07) ───────────────────────────
describe('calendar drag-selection coordinate fix', () => {
  test('one conversion source of truth exists and uses the live grid constants', () => {
    expect((HTML.match(/function calYToMinutes/g) || []).length).toBe(1);
    expect(HTML).toContain('function calMinutesToY(minutesOfDay)');
    const fn = HTML.slice(HTML.indexOf('function calYToMinutes'), HTML.indexOf('function calYToMinutes') + 400);
    expect(fn).toContain('/ HOUR_PX) * 60 + START_H * 60');
    expect(fn).toContain('SLOT_SNAP_MIN) * SLOT_SNAP_MIN');
    expect(fn).toContain('Math.min(END_H * 60'); // clamped to the visible range
  });

  test('pointer paths and the ghost block all consume the shared helpers', () => {
    expect(HTML).toContain('const startMinutes = calYToMinutes(col, e.clientY);');
    expect(HTML).toContain('const yPos = calMinutesToY(startMinutes);');
    expect(HTML).toContain('const hover = calYToMinutes(col, pointerClientY);');
    expect(HTML).toContain("dragState.block.style.top    = `${calMinutesToY(selStart)}px`;");
    // the 60px/hour era is over
    expect(HTML).not.toContain('// 60px per hour');
    expect(HTML).not.toContain('(dragState.startMinutes / 60) * 60');
  });

  test('upward drags produce the reversed range from the anchor slot', () => {
    expect(HTML).toContain('dragState.anchorMinutes = _calDragPending.startMinutes;');
    expect(HTML).toContain('let selStart = Math.min(anchor, hover);');
    expect(HTML).toContain('let selEnd   = Math.max(anchor, hover);');
  });

  test('pointer-up is the final authority for the booked range (rAF-lag safe)', () => {
    const de = HTML.slice(HTML.indexOf('function handleDragEnd(event)'), HTML.indexOf('function handleDragEnd(event)') + 1400);
    expect(de).toContain('const hover = calYToMinutes(dragState.col, event.clientY);');
    expect(de).toContain('dragState.currentMinutes = selEnd - selStart');
  });

  test('no end-time midnight wrap; legacy duplicate handler stays a no-op', () => {
    expect(HTML).not.toContain('Math.floor(_dragEndMin / 60) % 24');
    const legacy = HTML.slice(HTML.indexOf('function attachCalendarSlotHandlers()'), HTML.indexOf('function attachCalendarSlotHandlers()') + 500);
    expect(legacy).toContain('Deliberately a no-op');
    expect(legacy).not.toContain('addEventListener');
  });

  test('text selection is suppressed on day columns during drags', () => {
    expect(HTML).toContain('-webkit-user-select: none; user-select: none; touch-action: pan-y;');
  });
});

// ── Calendar week layout + clean indicators (2026-08-07) ─────────────────────
describe('calendar clean status indicators', () => {
  test('event blocks carry no emoji or dollar-sign chips', () => {
    expect(HTML).not.toContain('.session.bill-full::after');
    expect(HTML).not.toContain('.session.bill-half::after');
    expect(HTML).not.toContain('.session.support::after');
    expect(HTML).not.toContain('>📍</span>');
    expect(HTML).not.toContain('>⚠</span>');
    expect(HTML).not.toContain("'🚗 ' + travelMin");
  });

  test('missing-address indicator is minimal, accessible and actionable', () => {
    expect(HTML).toContain('aria-label="Address required for travel calculation"');
    expect(HTML).toContain('title="Address required for travel calculation."');
    expect(HTML).toContain('Address required for travel calculation. ${locObj.missingReason');
    // valid addresses render a NORMAL tile (no chip at all)
    expect(HTML).toContain("addrClass = ' has-addr'; // valid address: the tile looks normal");
    // fixing the address removes the indicator
    expect(HTML).toContain('if (chip) chip.remove(); // fixed address: indicator disappears');
  });

  test('short events keep a minimum height and never spill', () => {
    expect(HTML).toContain('min-height: 8px;'); // floors lowered so short tiles never eat the 4px gap
    expect(HTML).toContain('.session.s-compact .s-title { flex: 1; min-width: 0; }');
  });

  test('booking-panel preview state survives the legacy-handler removal', () => {
    // The dead-handler cleanup once swallowed this top-level declaration,
    // breaking closeBookingPanel at runtime. Pin declaration + consumers.
    expect(HTML).toContain('const _previewBlocks = []; // { el, col }');
    expect(HTML.indexOf('const _previewBlocks')).toBeLessThan(HTML.indexOf('function clearPreviewBlocks()'));
  });
});

// ── Contextual Smart Booking + interaction pass (2026-08-07) ─────────────────
describe('contextual smart booking + interaction pass', () => {
  test('Smart Booking is no longer a top-level nav destination', () => {
    const roleNav = HTML.slice(HTML.indexOf('var ROLE_NAV = {'), HTML.indexOf('var ACCESS_DENIED_MESSAGE'));
    expect(roleNav).not.toContain("'book'");
    // contextual launch still works for booking-capable roles
    expect(HTML).toContain("(name === 'book' && window.APP_USER && window.APP_USER.role !== 'read_only')");
  });

  test('test/seed therapist records are excluded from the booking selector', () => {
    expect(HTML).toContain('var BSP_TEST_NAME_RE =');
    expect(HTML).toContain('!BSP_TEST_NAME_RE.test(t.displayName');
    expect(HTML).toContain('Booking for:');
  });

  test('stepper: four even steps on desktop, compact label on narrow screens', () => {
    expect(HTML).toContain('id="stepper-compact"');
    expect(HTML).toContain("'Step ' + n + ' of 4: ' + _lbl");
    expect(HTML).toContain(".setAttribute('aria-current', 'step')");
  });

  test('contextual account panel behaves (focus return, Escape, outside click)', () => {
    expect(HTML).toContain('function toggleAccountMenu(forceOrEvent)');
    expect(HTML).toContain('trigger.focus(); // focus returns to the trigger on close');
    expect(HTML).toContain("toggleAccountMenu(false); }");
  });

  test('motion system with reduced-motion support', () => {
    expect(HTML).toContain('--ease-out: cubic-bezier');
    expect(HTML).toContain('@media (prefers-reduced-motion: reduce)');
    expect(HTML).toContain('transition-duration: 0.01ms !important;');
  });

  test('admin purchasing queue view exists and is nav-gated to admin', () => {
    expect(HTML).toContain('id="view-purchases"');
    expect(HTML).toContain('function admLoadPurchases()');
    const roleNav = HTML.slice(HTML.indexOf('var ROLE_NAV = {'), HTML.indexOf('var ACCESS_DENIED_MESSAGE'));
    const adminCfg = roleNav.slice(roleNav.indexOf('admin: {'), roleNav.indexOf('therapist:'));
    expect(adminCfg).toContain("['Operations', ['purchases']]");
    const ownerCfg = roleNav.slice(roleNav.indexOf('owner: {'), roleNav.indexOf('admin: {'));
    expect(ownerCfg).not.toContain('purchases');
  });

  test('calendar/booking emoji sweep held', () => {
    expect(HTML).not.toContain('👁 Outlook-only');
    expect(HTML).not.toContain("owner: '👑'");
    expect(HTML).not.toContain('⚡ Auto-fit');
    expect(HTML).not.toContain('`✅ Synced');
    expect(HTML).not.toContain('📍 Cluster by region');
  });
});

// ── Snapshot Day V1 (2026-08-07) ─────────────────────────────────────────────
describe('snapshot day v1', () => {
  test('reminders + tasks module wired to the snapshot API', () => {
    expect(HTML).toContain("fetch('/api/snapshot/reminders'");
    expect(HTML).toContain("fetch('/api/snapshot/tasks'");
    expect(HTML).toContain('function buildSnapshotWorkHTML()');
    expect(HTML).toContain('return html_prefix + html;');
    expect(HTML).toContain('function snapTaskMove(id, dir)'); // reorder persists via PUT order
    expect(HTML).toContain("'/api/snapshot/tasks/order'");
  });

  test('reminder lifecycle actions exist; delete is a two-step inline confirm', () => {
    for (const a of ["'complete'", "'dismiss'", "'reopen'", "'defer'"]) expect(HTML).toContain('snapReminderAct(');
    // prompt()/confirm() task flows are retired in favour of the inline composer
    expect(HTML).not.toContain("prompt('Task:')");
    expect(HTML).not.toContain("prompt('Reminder title:')");
    expect(HTML).not.toContain("confirm('Delete this task?')");
    expect(HTML).toContain('__swDeleteArm');
  });

  test('inline composer: list-style task entry, no modal, no empty records', () => {
    expect(HTML).toContain('id="sw-task-input"');
    expect(HTML).toContain('id="sw-rem-input"');
    expect(HTML).toContain('swComposerKey(event,');
    expect(HTML).toContain("if (!text) { ev.target.blur(); __swFocus = null; return; }"); // Enter on empty never creates
    expect(HTML).toContain('function snapRenderWork()'); // surgical re-render keeps the caret
    expect(HTML).toContain('function swEditCommit'); // inline title editing
    expect(HTML).toContain('swCircleSvg'); // icon-system circle, not emoji
  });

  test('snapshot/report panel emoji sweep held', () => {
    expect(HTML).not.toContain('🚗 Travel ·');
    expect(HTML).not.toContain('🗺 Travel Logbook');
    expect(HTML).not.toContain('⚠ No address');
  });
});

// ── Scheduler UI refinement (2026-08-07) ─────────────────────────────────────
describe('scheduler ui refinement', () => {
  test('brand is Opa with the organic pebble mark', () => {
    expect(HTML).toContain('<h1 class="brand-opa">Opa</h1>');
    expect(HTML).toContain('.brand-pebble {');
    expect(HTML).not.toContain('Opal Therapy <span class="sub">Scheduler</span>');
  });

  test('calendar toolbar hides integration clutter without removing the sync machinery', () => {
    expect(HTML).toContain('.cal-topbar .tz-label, .cal-topbar #cal-sync-strip { display: none !important; }');
    // the underlying controls still exist in the DOM (functionality intact)
    expect(HTML).toContain('id="cal-sync-strip"');
    expect(HTML).toContain('id="btn-outlook-only"');
  });

  test('Month and Day share the centred content frame; Scheduler uses full width', () => {
    expect(HTML).toContain('--cal-frame: 1060px;');
    expect(HTML).toContain('#month-scroll-area .month-section { max-width: var(--cal-frame) !important');
    expect(HTML).toContain('.cal-grid.view-day { max-width: 860px; margin: 0 auto; width: 100%; }');
    expect(HTML).not.toContain('#master-grid');
  });
});

// ── Calendar polish: separation + title recovery (2026-08-07) ────────────────
describe('calendar polish', () => {
  test('back-to-back events carry a real 4px separation gap', () => {
    expect(HTML).toContain('* HOUR_PX - 4)');
    expect(HTML).not.toContain('* HOUR_PX - 2)');
    expect(HTML).not.toContain('box-shadow: 0 2px 0 0 var(--bg');
  });

  test('missing Outlook titles show a recovery state, never (No subject)', () => {
    expect(HTML).toContain('function scheduleTitleRecovery()');
    expect(HTML).toContain('Syncing title…');
    expect(HTML).toContain("'Untitled event'");
    expect(HTML).not.toContain('>(No subject)</em>');
    // bounded: one delta refresh per session, quiet failure toast
    expect(HTML).toContain('window.__titleRecoveryDone || __titleRecoveryPending');
    expect(HTML).toContain('Event title could not be synced from Outlook');
  });
});

// ── Playful-premium visual pass (2026-08-08) ─────────────────────────────────
describe('playful premium design pass', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');

  test('every served page loads the Plus Jakarta Sans typeface', () => {
    const pages = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
    for (const page of pages) {
      const html = fs.readFileSync(path.join(FRONTEND, page), 'utf8');
      expect(html).toContain('family=Plus+Jakarta+Sans');
    }
  });

  test('legacy purple brand and cyan accent are fully retired', () => {
    const pages = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
    for (const page of pages) {
      const html = fs.readFileSync(path.join(FRONTEND, page), 'utf8');
      expect(html).not.toContain('#5b6af0');
      expect(html).not.toContain('#00a8cc');
    }
  });

  test('token layer defines the dual-accent warm system', () => {
    expect(HTML).toContain('--accent: #0f7c6c;');
    expect(HTML).toContain('--accent-2: #d96f4e;');
    expect(HTML).toContain('--bg: #faf6f0;');
    expect(HTML).toContain('--now: var(--accent-2);');
  });

  test('keyboard focus is visible via a zero-specificity global rule', () => {
    expect(HTML).toContain(':focus-visible');
    expect(HTML).toContain('--focus-ring');
  });

  test('reduced motion support is retained', () => {
    expect(HTML).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('brand pebble has its living-cell idle motion', () => {
    expect(HTML).toContain('@keyframes pebbleMorph');
    expect(HTML).toContain('@keyframes pebbleDrift');
    expect(HTML).toContain('animation: pebbleMorph 8s ease-in-out infinite, pebbleSway 13s ease-in-out infinite;');
    expect(HTML).toContain('@keyframes pebbleSway');
  });
});

// ── Master Scheduler Phase 1 (2026-08-08) ────────────────────────────────────
describe('master scheduler phase 1', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SCHED_JS  = fs.readFileSync(path.join(FRONTEND, 'scheduler.js'), 'utf8');
  const SCHED_CSS = fs.readFileSync(path.join(FRONTEND, 'scheduler.css'), 'utf8');

  test('scheduler assets are linked and the root container exists', () => {
    expect(HTML).toContain('<link rel="stylesheet" href="/scheduler.css" />');
    expect(HTML).toContain('<script src="/scheduler.js" defer></script>');
    expect(HTML).toContain('id="scheduler-root"');
  });

  test('the legacy master week grid is fully retired (no duplicate calendars)', () => {
    ['MASTER_CAL', 'loadMasterCalendar', 'initMasterTimeCol', 'mcol-mon', 'mch-mon',
     'master-grid', 'master-time-col'].forEach((sym) => {
      expect(HTML).not.toContain(sym);
    });
  });

  test('mode wiring delegates to OpalScheduler', () => {
    expect(HTML).toContain('window.OpalScheduler.open()');
    expect(HTML).toContain("window.OpalScheduler.nav('today')");
    expect(HTML).toContain('>Scheduler</button>');
  });

  test('scheduler stays on the aggregated master endpoint (one request per range)', () => {
    expect(SCHED_JS).toContain('/api/calendar/master?startDate=');
    expect((SCHED_JS.match(/fetch\(/g) || []).length).toBe(1);
  });

  test('cross-therapist tiles use safe labels, never raw Outlook subjects', () => {
    expect(SCHED_JS).toContain('safeLabel(it.ev, mode)');
    expect(SCHED_JS).toContain("return TYPE_LABELS[ev.eventType] || 'Busy';");
    // '(No subject)' may appear only inside the placeholder DETECTOR, never as output
    expect(SCHED_JS).toContain('function isPlaceholderTitle');
  });

  test('scheduler visuals stay on design tokens and carry no emojis', () => {
    expect(SCHED_CSS).toContain('var(--accent');
    expect(SCHED_CSS).toContain('var(--c-therapy)');
    expect(SCHED_CSS).toContain('var(--now)');
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(EMOJI.test(SCHED_JS)).toBe(false);
    expect(EMOJI.test(SCHED_CSS)).toBe(false);
  });

  test('back-to-back tiles keep the 4px separation rule in the scheduler too', () => {
    expect(SCHED_JS).toContain('HOUR() - 4)');
  });
});

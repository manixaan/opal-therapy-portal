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
      expect(html).toContain('<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" />');
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
  test('hour height is 72px (readable 15-min slots) and coordinate math uses the constant', () => {
    expect(HTML).toContain('const HOUR_PX = 72;');
    // No stray hardcoded per-hour math reintroduced alongside the constant
    expect(HTML).not.toMatch(/const HOUR_PX = (48|60)/);
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
    // Case Notes (2026-08-10) joined the primary nav for treating clinicians
    expect(HTML).toContain("therapist: { primary: ['profile', 'calendar', 'casenotes', 'logbook', 'resources'] }");
    expect(HTML).toContain("read_only: { primary: ['profile', 'calendar', 'resources'] }");
    expect(HTML).toContain("['Practice Management', ['contacts', 'activity', 'billing', 'ndis', 'dormant']]");
    // Resource Hub R2 promoted 'resources' into the owner's primary nav
    expect(HTML).toContain("primary: ['profile', 'calendar', 'casenotes', 'resources']");
    // Support Tickets (2026-08-09) joined the owner Business group
    expect(HTML).toContain("['Business', ['accounting', 'settings', 'support']]");
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

  test('two live areas; Therapy Store deliberately parked as Coming soon', () => {
    // PRODUCT DECISION 2026-08-09 (Antony): the Therapy Store is parked. The
    // store sub-tab is disabled with a "Coming soon" chip and rhSwitch quietly
    // refuses 'store'. This is UI parking only — the store panel markup, the
    // store/purchase JS and the admin Purchasing queue all remain intact.
    const v = view();
    expect(v).toContain('>Hub</button>'); // R2: the Library panel became the full Hub
    expect(v).toContain('>AI Resource Studio</button>');
    expect(v).toContain('Therapy Store &amp; Purchase Requests<span class="rh-soon">Coming soon</span></button>');
    // Store tab is non-interactive: disabled + aria-disabled, no onclick
    expect(v).toMatch(/data-rh="store"[^>]*\bdisabled\b/);
    expect(v).toMatch(/data-rh="store"[^>]*aria-disabled="true"/);
    expect(v).not.toMatch(/data-rh="store"[^>]*onclick/);
    // The other two tabs remain enabled and clickable
    expect(v).toMatch(/data-rh="shared"[^>]*onclick="rhSwitch\('shared'\)"/);
    expect(v).toMatch(/data-rh="ai"[^>]*onclick="rhSwitch\('ai'\)"/);
    expect(v).not.toMatch(/data-rh="shared"[^>]*\bdisabled\b/);
    expect(v).not.toMatch(/data-rh="ai"[^>]*\bdisabled\b/);
    // Programmatic guard: rhSwitch('store') is a quiet no-op
    expect(HTML).toContain("if (area === 'store') return;");
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

  test('booking is a single form with one Create action — the wizard is retired', () => {
    expect(HTML).toContain('id="create-booking-btn"');
    expect(HTML).toContain('function createBookingNow');
    // no stepper, no session-type step, no suggested-slots step, no confirm step
    expect(HTML).not.toContain('id="stepper"');
    expect(HTML).not.toContain('id="step-2"');
    expect(HTML).not.toContain('id="slot-suggestions"');
    expect(HTML).not.toContain('id="confirm-summary"');
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
    // Support Tickets (2026-08-09) joined the admin Operations group
    expect(adminCfg).toContain("['Operations', ['purchases', 'support']]");
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

// ── Snapshot Day V2 (2026-08-09): one unified To-Do-style work list ──────────
describe('snapshot day unified work list', () => {
  test('one list over both snapshot APIs — presentation unified, origin preserved', () => {
    expect(HTML).toContain("fetch('/api/snapshot/reminders'");
    expect(HTML).toContain("fetch('/api/snapshot/tasks'");
    expect(HTML).toContain('function buildSnapshotWorkHTML()');
    expect(HTML).toContain('return html_prefix + html;');
    expect(HTML).toContain('function swModel()'); // reminders + tasks merged for rendering only
    expect(HTML).toContain("kind === 'task' ? 'tasks/' : 'reminders/'"); // rows call their own endpoints
    expect(HTML).toContain('function swCompare('); // overdue → today → dated → undated ordering
  });

  test('quiet header + composer replace the + Reminder / + Task buttons', () => {
    expect(HTML).not.toContain('>+ Reminder</button>');
    expect(HTML).not.toContain('>+ Task</button>');
    expect(HTML).toContain("' remaining</span>");
    expect(HTML).toContain('id="sw-composer-input"');
    expect(HTML).toContain('swComposerKey(event)');
    expect(HTML).toContain("if (!text) { ev.target.blur(); __swFocus = null; return; }"); // Enter on empty never creates
    expect(HTML).toContain('function snapRenderWork()'); // surgical re-render keeps the caret
    expect(HTML).toContain('function swEditCommit'); // inline title editing (Enter saves, Escape restores)
    expect(HTML).toContain("opIcon('check'"); // icon-system check mark, never a literal character
  });

  test('delete is optimistic with toast undo; no prompt()/confirm() anywhere', () => {
    expect(HTML).toContain('function swDelete(');
    expect(HTML).toContain('function swUndoToast(');
    expect(HTML).toContain('function swRestore('); // hard-delete backend → Undo re-creates the row
    expect(HTML).not.toContain("prompt('Task:')");
    expect(HTML).not.toContain("prompt('Reminder title:')");
    expect(HTML).not.toContain("confirm('Delete this task?')");
    // the reminder-specific '+1h / Dismiss' inline controls are gone from list rows
    expect(HTML).not.toContain("'defer',{minutes:60})\">+1h</button>");
    expect(HTML).toContain('function snapReminderAct('); // dismiss/defer stay for the notification surface
  });

  test('completion + collapsible Completed section persist via API and localStorage', () => {
    expect(HTML).toContain("(done ? 'complete' : 'reopen')"); // completion circle uses the API lifecycle
    expect(HTML).toContain('__swPendingDone'); // ~800ms animation with cancel-on-second-click
    expect(HTML).toContain("localStorage.getItem('sw_completed_collapsed')");
    expect(HTML).toContain('function swToggleCompleted()');
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
    expect(HTML).toContain('<link rel="stylesheet" href="/scheduler.css?v=p9" />');
    expect(HTML).toContain('<script src="/scheduler.js?v=p9" defer></script>');
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

  test('scheduler uses only aggregated endpoints (never one request per therapist)', () => {
    expect(SCHED_JS).toContain('/api/calendar/master?startDate=');
    expect(SCHED_JS).toContain('/api/scheduler/availability?date=');
    expect(SCHED_JS).toContain('/api/scheduler/common-availability');
    expect((SCHED_JS.match(/fetch\(/g) || []).length).toBe(7); // master + availability x2 + common + finder + sdk-url + map-points
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

  test('back-to-back blocks keep the 4px separation rule in the matrix too', () => {
    // horizontal geometry: block width is duration*PPM minus the 4px gap
    expect(SCHED_JS).toContain('* PPM - 4)');
  });
});

// ── Billable/non-billable booking picker (2026-08-08) ────────────────────────
describe('grouped booking-type picker', () => {
  test('billable + non-billable sections with collapsible groups', () => {
    expect(HTML).toContain('class="bk-section-label">Billable<');
    expect(HTML).toContain('>Non-billable<');
    for (const g of ['Direct services', 'Requested reports', 'Non-face-to-face', 'Provider travel']) {
      expect(HTML).toContain('<summary>' + g + '</summary>');
    }
    for (const leaf of ['Therapy session', 'Assessment session', 'Initial assessment consultation',
      'FCA', 'AT report', 'Progress report', 'Case noting', 'Resource preparation',
      'Telehealth', 'Professional development', 'Supervision', 'Lunch']) {
      expect(HTML).toContain('>' + leaf + '</button>');
    }
    expect(HTML).toContain('Bill up to 30 minutes each way');
    expect(HTML).toContain('function selectBookingLeaf');
    expect(HTML).toContain('selectBookingCat(leaf.cat)'); // rides the existing category plumbing
  });
});

// ── Master Scheduler Phase 2: availability layer (2026-08-08) ────────────────
describe('master scheduler phase 2 availability', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SCHED_JS  = fs.readFileSync(path.join(FRONTEND, 'scheduler.js'), 'utf8');
  const SCHED_CSS = fs.readFileSync(path.join(FRONTEND, 'scheduler.css'), 'utf8');

  test('the availability engine drives the matrix itself — always loaded, engine-derived paint', () => {
    expect(SCHED_JS).toContain('function loadAvailability');
    expect(SCHED_JS).toContain('trackPaint(');           // engine segments -> row paint
    expect(SCHED_JS).toContain('slotVerdict(');          // engine segments -> proposed-slot status
    expect(SCHED_JS).not.toContain('SCHED.overlay');     // the optional-overlay era is retired
  });

  test('availability visuals are calm opal tints, not bright green fills', () => {
    expect(SCHED_CSS).toContain('rgba(15, 124, 108, 0.07)'); // common-free wash stays calm
    expect(SCHED_CSS).not.toMatch(/#(00ff00|0f0|4ade80|22c55e)/i);
    expect(SCHED_CSS).toContain('.sm-row.sch-notworking .sm-track'); // not-working rows stay muted
    expect(SCHED_CSS).toContain('.sm-paint-leave');                  // leave keeps its own pattern
  });

  test('default-hours honesty badge and capacity are wired', () => {
    expect(SCHED_JS).toContain("availabilityConfidence === 'default'");
    expect(SCHED_JS).toContain('default hours');
    expect(SCHED_JS).toContain('capacity.availableMin');
  });

  test('common availability highlights the matrix header, server-verified', () => {
    expect(SCHED_JS).toContain('function fetchCommon');            // canonical server intersection
    expect(SCHED_JS).toContain('commonFreeWindows');               // instant client-side mirror
    expect(SCHED_JS).toContain('function jumpToMinute');
    expect(SCHED_JS).toContain('minDurationMin: SCHED.common.minDur');
  });

  test('backend engine and routes exist with privacy-safe payload mapping', () => {
    const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'availability-engine.js'), 'utf8');
    const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'scheduler-routes.js'), 'utf8');
    expect(ENGINE).toContain('function computeDayAvailability');
    expect(ENGINE).toContain('function intersectAvailability');
    expect(ENGINE).toContain('function isEventBlockingAvailability');
    expect(ROUTES).toContain('requireMasterCalendarAccess');
    // the segment mapping exposes times/types/ids only — no content field access
    expect(ROUTES).toContain('startMin: s.startMin, endMin: s.endMin, type: s.type,');
    expect(ROUTES).not.toMatch(/\.title\b|client_name/);
  });
});

// ── Master Scheduler Phase 3: quick availability finder (2026-08-08) ─────────
describe('master scheduler phase 3 finder', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SCHED_JS  = fs.readFileSync(path.join(FRONTEND, 'scheduler.js'), 'utf8');
  const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'scheduler-routes.js'), 'utf8');

  test('availability search consumes the canonical engine — no frontend availability math', () => {
    expect(ROUTES).toContain('engine.classifyCandidate');
    expect(ROUTES).toContain('engine.rangeWindows');
    expect(ROUTES).toContain('engine.nearestAlternatives');
    expect(ROUTES).toContain('/api/scheduler/find-availability'); // capability preserved server-side
    // the matrix itself is now the finder result: toolbar start/duration + band
    expect(SCHED_JS).toContain('/api/scheduler/candidates');
    // stale responses can never overwrite newer criteria
    expect(SCHED_JS).toContain('if (gen !== f.gen) return;');
  });

  test('results are factual — no fit tiers, scores or geographic claims', () => {
    for (const banned of ['Best Fit', 'Good Fit', 'Poor Fit', 'best choice', 'close to client', '% match']) {
      expect(SCHED_JS).not.toContain(banned);
    }
  });

  test('view-calendar and schedule actions integrate with existing surfaces', () => {
    expect(SCHED_JS).toContain('sm-cand');       // candidate cards drive the matrix selection
    expect(SCHED_JS).toContain('jumpToMinute');  // picking a result scrolls + flashes the row
    expect(SCHED_JS).toContain('selectBspTherapist');
    expect(SCHED_JS).toContain('sch-req-slot'); // requested slot emphasised on the time scale
  });

  test('unavailable reasons stay content-free', () => {
    expect(SCHED_JS).toContain("'Busy until '");
    expect(ROUTES).toContain("busy: 'Busy'");
  });
});

// ── Master Scheduler Phase 4: enhanced focus mode (2026-08-08) ───────────────
describe('master scheduler phase 4 focus mode', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SCHED_JS  = fs.readFileSync(path.join(FRONTEND, 'scheduler.js'), 'utf8');
  const SCHED_CSS = fs.readFileSync(path.join(FRONTEND, 'scheduler.css'), 'utf8');

  test('focus header: capacity language is scheduling, never performance', () => {
    expect(SCHED_JS).toContain('sch-fh-stats');
    expect(SCHED_JS).toContain("'</strong> clinical</span>'");
    expect(SCHED_JS).toContain("'</strong> available</span>'");
    expect(SCHED_JS).toContain('Next available ');
    expect(SCHED_JS).toContain('No further availability today');
    for (const banned of ['productivity', 'performance', 'efficiency rating', 'utilisation score']) {
      expect(SCHED_JS.toLowerCase()).not.toContain(banned);
    }
  });

  test('gaps are actionable cards fed by the canonical engine', () => {
    expect(SCHED_JS).toContain('sch-avl-card');
    expect(SCHED_JS).toContain('+ Add appointment');
    expect(SCHED_JS).toContain('snap15(clicked)'); // click-within-gap snapping
    expect(SCHED_JS).toContain("'Buffer time'");   // buffers explained in slot verdicts
    expect(SCHED_CSS).toContain('.sch-avl-card');
  });

  test('therapist details are a contextual inspector over the live matrix', () => {
    expect(SCHED_JS).toContain("openInspector('therapist'");  // row click opens the drawer
    expect(SCHED_JS).toContain('function loadWeekCapacity');  // week capacity strip retained
    expect(SCHED_JS).toContain('buildTherapistInspector');
  });

  test('friendly non-working/leave states in focus', () => {
    expect(SCHED_JS).toContain("isn't scheduled to work this day.");
    expect(SCHED_JS).toContain(' is on leave this day.');
  });
});

// ── Master Scheduler Phases 5+6: map + footprints (2026-08-08) ───────────────
describe('master scheduler phases 5-6 map', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SCHED_JS  = fs.readFileSync(path.join(FRONTEND, 'scheduler.js'), 'utf8');
  const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'scheduler-routes.js'), 'utf8');
  const GEO = fs.readFileSync(path.join(__dirname, '..', 'geo.js'), 'utf8');

  test('map SDK is lazy-loaded via the server-side key proxy only', () => {
    expect(SCHED_JS).toContain("fetch('/api/maps/sdk-url'");
    expect(SCHED_JS).not.toMatch(/key=AIza/);
    expect(SCHED_JS).toContain("m.sdk === 'ready'"); // calendar never blocks on the SDK
  });

  test('map payload is allowlist-built at suburb precision', () => {
    expect(GEO).toContain('function buildSchedulerMapPoint');
    expect(GEO).toContain("precision: 'suburb'");
    expect(ROUTES).toContain('/api/scheduler/map-points');
    expect(ROUTES).toContain('requireMasterCalendarAccess');
    expect(ROUTES).toContain('telehealth += 1');
  });

  test('footprints are derived daily, clustered, and never stored', () => {
    expect(SCHED_JS).toContain('function clusterPoints');
    expect(SCHED_JS).toContain('function convexHull');
    expect(SCHED_JS).toContain('dedupSuburbPoints');
    expect(SCHED_JS).toContain('if (cluster.length < 3) return;'); // 1-2 points: markers only
    expect(SCHED_JS).not.toContain('therapist_daily_footprints');
    expect(SCHED_JS).toContain('Operating areas');
  });

  test('cross-highlighting both directions + viewport respect', () => {
    expect(SCHED_JS).toContain('mapEmphasiseEvent');
    expect(SCHED_JS).toContain('mapHighlightTiles');
    expect(SCHED_JS).toContain('m.userMoved = true');
    expect(SCHED_JS).toContain('View on calendar');
  });
});

// ── Master Scheduler Phases 7+8: candidates + travel (2026-08-08) ────────────
describe('master scheduler phases 7-8 candidates', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SCHED_JS  = fs.readFileSync(path.join(FRONTEND, 'scheduler.js'), 'utf8');
  const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'scheduler-routes.js'), 'utf8');
  const GEO = fs.readFileSync(path.join(__dirname, '..', 'geo.js'), 'utf8');

  test('deterministic tiers with explanations — no percentages, no AI', () => {
    expect(ROUTES).toContain('scorer.scoreCandidate');
    expect(ROUTES).toContain('travelFeas.evaluateTravelFeasibility');
    expect(SCHED_JS).toContain("best: 'Best fit'");
    expect(SCHED_JS).not.toMatch(/\d+% match/);
    expect(SCHED_JS).not.toContain('internalScore'); // score stays server-side
  });

  test('two-stage cost model: routes only for the viable shortlist', () => {
    expect(ROUTES).toContain('ROUTE_STAGE_LIMIT');
    expect(GEO).toContain('function travelMinutesBetween');
    expect(GEO).toContain('_routeCache');
    expect(GEO).toContain('WA Australia'); // suburb strings only to the provider
  });

  test('travel infeasibility is a hard slot exclusion with alternatives', () => {
    expect(ROUTES).toContain("feas.status === 'travel_infeasible'");
    expect(ROUTES).toContain('findFeasibleAlternative');
    expect(SCHED_JS).toContain('Not practical for this location');
    expect(SCHED_JS).toContain('Closest feasible option');
  });

  test('temporary client marker is visually distinct and never persisted', () => {
    expect(SCHED_JS).toContain('mapShowClientPoint');
    expect(SCHED_JS).toContain('not yet booked');
    expect(SCHED_JS).toContain('m.clientMarker.setMap(null)');
  });
});

// ── Outlook-only calendar mirror (2026-08-09) ────────────────────────────────
// Directive: the app and Outlook mirror each other; Splose serves patient/
// client data only and neither feeds nor receives calendar events by default.
describe('outlook-only booking mirror', () => {
  const booking = () => HTML.slice(
    HTML.indexOf('async function confirmBooking()'),
    HTML.indexOf('function resetWizard()'));

  test('confirmBooking never writes to Splose — no Splose endpoints in the booking flow', () => {
    expect(booking()).not.toContain('/api/splose/appointments');
    expect(booking()).not.toContain('/api/splose/busy-times');
    expect(booking()).not.toContain("'Saving to Splose…'");
  });

  test('client sessions use the imported-event conventions (title + category)', () => {
    expect(booking()).toContain('`Client Appointment — ${_patName}`');
    expect(booking()).toContain("'Client Appointments'");
    expect(booking()).toContain("'Creating appointment…'");
  });

  test('no fake Splose reference IDs or false "Written to Splose" claims in the modal', () => {
    expect(booking()).not.toContain('Written to Splose');
    expect(booking()).not.toContain('Math.random()*89999');
  });

  test('Splose scheduling-ID hard-blocks are gone; patient selection is still required', () => {
    expect(booking()).not.toContain('Practitioner or location not configured');
    expect(booking()).not.toContain('No Splose service mapped');
    expect(booking()).not.toContain("Patient's active case hasn't loaded yet");
    expect(booking()).toContain("showToast('No patient selected'");
  });
});

describe('splose calendar decoupling (patients only)', () => {
  test('loadSploseAppointmentsIntoSessions is a no-op unless the backend flag enables it', () => {
    expect(HTML).toContain('window.SPLOSE_CALENDAR_SYNC_ENABLED = false;');
    expect(HTML).toContain("if (window.SPLOSE_CALENDAR_SYNC_ENABLED !== true) return; // Splose: patients only");
  });

  test('header pill reports the honest patients-only state and reads the backend flag', () => {
    expect(HTML).toContain("parts.push('Splose: patients only');");
    expect(HTML).toContain('sp.calendarSyncEnabled === true');
  });

  test('legacy sendToSplose path is gated off with an honest message', () => {
    const fn = HTML.slice(HTML.indexOf('async function sendToSplose()'), HTML.indexOf('function resetAutoFit()'));
    expect(fn).toContain("showToast('Splose calendar sync is off'");
    expect(fn.indexOf('Splose calendar sync is off')).toBeLessThan(fn.indexOf('/api/splose/appointments'));
  });

  test('settings integration card no longer claims Splose syncs the calendar', () => {
    expect(HTML).not.toContain("sloseLastSync.textContent = 'Syncing every 90 seconds'");
    expect(HTML).toContain('Patient data only — calendar sync is Outlook-only');
  });
});

// ── Free-time/gap overlay removed from the calendar (2026-08-09) ─────────────
// Antony's directive: the green hatched "Free window / Idle gap" bands and
// cards crowded the calendar — gone completely. Travel-leg indicators stay.
describe('free-time gap overlay removed', () => {
  test('no gap overlay is rendered and its machinery is gone', () => {
    expect(HTML).not.toContain('function renderGapOverlay');
    expect(HTML).not.toContain("el.className = 'gap-overlay'");
    expect(HTML).not.toContain('dismissGapOverlay');
    expect(HTML).not.toContain('isGapDismissed');
    expect(HTML).not.toContain('GAP_DISMISSED_KEY');
    expect(HTML).not.toContain('gap-qa-btn');
    // the render dispatch explicitly skips gap segments
    expect(HTML).toContain('FREE-TIME/GAP OVERLAY REMOVED');
  });

  test('the hatched gap CSS is gone (travel-overlay CSS remains)', () => {
    expect(HTML).not.toContain('.gap-overlay {');
    expect(HTML).not.toContain('.gap-overlay:hover');
    expect(HTML).not.toContain('.gap-overlay.smart {');
    expect(HTML).toContain('.travel-overlay {');
  });

  test('travel-leg indicators still render on the calendar', () => {
    expect(HTML).toContain("el.className = 'travel-overlay ' + seg.kind;");
    expect(HTML).toContain('function renderSegmentOverlay');
    expect(HTML).toContain('openTravelPanel(seg)');
  });

  test('gap segments are still computed for the Snapshot report and suggestions', () => {
    expect(HTML).toContain('function computeDayTravelSegments');
    expect(HTML).toContain("segs.push({ day, kind: 'gap', fromLoc: {}, toLoc: {},");
  });
});

// ── Event delete: travel-block cascade + styled confirmation (2026-08-09) ────
// Deleting a calendar event also deletes the travel blocks that belong to it.
// Both entry points (detail drawer + right-click menu) share one flow with a
// styled in-app confirmation — browser confirm()/alert() are gone from it.
describe('event delete cascade UX', () => {
  test('styled confirmation modal exists with a danger action and cascade line', () => {
    expect(HTML).toContain('id="modal-del-event"');
    expect(HTML).toContain('id="del-event-cascade"');
    expect(HTML).toContain('function openDeleteEventModal(');
    expect(HTML).toContain('function closeDeleteEventModal(');
    expect(HTML).toContain('background:var(--danger,#c2412e);');
  });

  test('no browser confirm()/alert() anywhere in the delete flow', () => {
    const flow = HTML.slice(
      HTML.indexOf('function ctxDeleteEvent('),
      HTML.indexOf('// ── Location section builder'));
    expect(flow.length).toBeGreaterThan(1000); // slice sanity
    expect(flow).not.toContain('window.confirm');
    expect(flow).not.toMatch(/\bconfirm\(/);
    expect(flow).not.toMatch(/\balert\(/);
  });

  test('both entry points delegate to the shared flow', () => {
    expect(HTML).toContain(`onclick="bdDeleteEvent('\${id}')"`);   // drawer footer button
    expect(HTML).toContain(`onclick="ctxDeleteEvent('\${id}')"`);  // right-click menu item
    const ctx = HTML.slice(HTML.indexOf('function ctxDeleteEvent('), HTML.indexOf('function ctxDeleteEvent(') + 200);
    expect(ctx).toContain('deleteEventFlow(id)');
    const bd = HTML.slice(HTML.indexOf('function bdDeleteEvent('), HTML.indexOf('function bdDeleteEvent(') + 300);
    expect(bd).toContain('deleteEventFlow(id)');
  });

  test('cascade count comes from a dryRun preview and is stated before deletion', () => {
    expect(HTML).toContain('?dryRun=1');
    expect(HTML).toContain('will also be removed.');
    expect(HTML).toContain('travelBlocksDeleted');
  });

  test('confirmed deletes are optimistic with a quiet toast (cascade counted)', () => {
    expect(HTML).toContain('function performDeleteEvent(');
    expect(HTML).toContain("'Event deleted'");
    expect(HTML).toContain('Event deleted (with ');
    expect(HTML).toContain('function __removeSessionTile(');
  });

  test('travel blocks pushed to Outlook carry their appointment linkage', () => {
    expect(HTML).toContain('relatedEventId,');
    expect(HTML).toContain('SESSIONS[seg.toSessionId] || SESSIONS[seg.fromSessionId]');
  });
});

// ── Support popup: floating window + voice dictation (2026-08-09) ────────────
// Support is a top-level launcher tab for EVERY role; clicking it opens a
// floating, draggable window (NOT a modal — the page behind stays fully
// interactive) with a New-issue form and the user's own tickets. The
// /api/support/* contract is unchanged.
describe('support popup', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const SP_JS = fs.readFileSync(path.join(FRONTEND, 'supportpop.js'), 'utf8');
  const SP_CSS = fs.readFileSync(path.join(FRONTEND, 'supportpop.css'), 'utf8');

  test('assets are linked next to the Opa assets', () => {
    expect(HTML).toContain('<link rel="stylesheet" href="/supportpop.css?v=1" />');
    expect(HTML).toContain('<script src="/supportpop.js?v=1" defer></script>');
  });

  test('Support launcher tab exists for every role and never routes through switchTab', () => {
    const at = HTML.indexOf('id="tab-support-pop"');
    expect(at).toBeGreaterThan(-1);
    const btn = HTML.slice(HTML.lastIndexOf('<button', at), HTML.indexOf('</button>', at));
    expect(btn).toContain('window.SupportPop && window.SupportPop.toggle()');
    expect(btn).not.toContain('data-tab='); // launcher, not a view tab
    // role gating: the default-deny loop targets .tab[data-tab] only, and
    // applyNavRoleVisibility re-asserts the launcher explicitly for all roles
    expect(HTML).toContain("var supLauncher = document.getElementById('tab-support-pop');");
    expect(HTML).toContain("if (supLauncher) supLauncher.style.display = '';");
    // shared tab wiring skips launcher buttons without data-tab
    expect(HTML).toContain("tabs.forEach(t => { if (t.dataset.tab) t.addEventListener('click', () => switchTab(t.dataset.tab)); });");
    // the admin/owner Support Tickets CENTRE view is untouched
    expect(HTML).toContain('data-tab="support"');
    expect(HTML).toContain("if (name === 'support' && typeof supOpenCentre === 'function') supOpenCentre();");
  });

  test('popup is a floating window: draggable, resizable, persisted — no page-dimming layer', () => {
    expect(SP_JS).toContain('function supClampRect(rect, vp)');
    expect(SP_JS).toContain('function supDefaultRect(vp)');
    expect(SP_JS).toContain('var SUP_MIN_W = 360, SUP_MIN_H = 420;');
    expect(SP_JS).toContain("localStorage.setItem('support.window.x'");
    expect(SP_JS).toContain("localStorage.setItem('support.window.height'");
    expect(SP_JS).toContain("panel.setAttribute('role', 'dialog');");
    expect(SP_JS).toContain("if (e.key === 'Escape') SupportPop.close();");
    expect(SP_JS).toContain('setPointerCapture');
    expect(SP_JS).not.toMatch(/backdrop/i); // never a modal
    expect(SP_CSS).not.toMatch(/backdrop/i);
    expect(SP_CSS).toContain('z-index: 1150;'); // above header/drawers, below Opa (1500+)
    expect(SP_CSS).toContain('min-width: 360px; min-height: 420px;');
    expect(SP_CSS).toContain('#supportpop.sp-mobile'); // <700px bottom-sheet
    expect(SP_JS).toContain('function isMobile() { return vp().w < 700; }');
    // a hidden/0x0 viewport must never destroy the saved position
    expect(SP_JS).toContain('if (w < 200 || h < 200)');
  });

  test('account-menu entries and the Resource Hub bridge route into the popup', () => {
    expect(HTML).toContain('if (window.SupportPop && window.SupportPop.openReport) { window.SupportPop.openReport(prefill); return; }');
    expect(HTML).toContain('if (window.SupportPop && window.SupportPop.openMyTickets) { window.SupportPop.openMyTickets(ticketId); return; }');
    // account menu still goes through the stable OpalSupport bridge
    expect(HTML).toContain('onclick="toggleAccountMenu();window.OpalSupport.openReport()"');
    expect(HTML).toContain('onclick="toggleAccountMenu();window.OpalSupport.openMyTickets()"');
  });

  test('My tickets rendering is shared with the drawer, not duplicated', () => {
    expect(HTML).toContain('window.supMySetCtx = function (ctx)');
    expect(HTML).toContain('function supMyEls()');
    expect(HTML).toContain('window.supMySetCtx(null); // legacy drawer opener renders into the drawer');
    expect(SP_JS).toContain('global.supMySetCtx({ body: body, title: el(\'sp-mine-title\'), back: el(\'sp-mine-back\') });');
    expect(SP_JS).toContain('global.supMyShowDetail(ticketId)');
    expect(SP_JS).toContain('global.supMyShowList()');
  });

  test('screenshot precheck + upload exist once and both surfaces use them', () => {
    expect(HTML).toContain('window.supPrecheckScreenshot = function (file)');
    expect(HTML).toContain('window.supUploadScreenshot = async function (ticketId, file)');
    expect(HTML).toContain('var precheckError = window.supPrecheckScreenshot(file);');
    expect(SP_JS).toContain('global.supPrecheckScreenshot(file)');
    expect(SP_JS).toContain('global.supUploadScreenshot(d.ticket.id, file)');
  });

  test('New-issue form keeps the exact report contract and privacy notice', () => {
    expect(SP_JS).toContain("global.supApi('/api/support/tickets', { method: 'POST', body: {");
    expect(SP_JS).toContain('expectedBehaviour:');
    expect(SP_JS).toContain('reportedPriority:');
    expect(SP_JS).toContain('technicalContext: technicalContext');
    expect(SP_JS).toContain('global.createIssueContext()');
    expect(SP_JS).toContain('Please do not include participant names, clinical information or other sensitive personal information in technical support tickets.');
    expect(SP_JS).toContain("'Thanks — ticket ' + d.ticket.ticket_number + ' has been created.'");
  });

  test('voice dictation is feature-detected, en-AU, honest, and never auto-submits', () => {
    expect(SP_JS).toContain('global.SpeechRecognition || global.webkitSpeechRecognition || null');
    expect(SP_JS).toContain("rec.lang = 'en-AU';");
    expect(SP_JS).toContain('rec.continuous = true;');
    expect(SP_JS).toContain('rec.interimResults = true;');
    // unsupported browsers render no mic buttons at all
    expect(SP_JS).toContain("if (!SR) return ''; // unsupported browser: no mic buttons at all");
    expect(SP_JS).toContain('Voice input is not available in this browser — you can type as normal.');
    expect(SP_JS).toContain("Voice dictation uses your browser's speech service.");
    // dictation edits the field only; the recogniser callbacks never submit
    const onresult = SP_JS.slice(SP_JS.indexOf('rec.onresult'), SP_JS.indexOf('rec.onerror'));
    expect(onresult.length).toBeGreaterThan(100);
    expect(onresult).not.toContain('submitReport');
    // mic stops on close and on submit
    expect(SP_JS).toContain('stopVoice(); // closing the window always ends dictation');
    expect(SP_JS).toContain('stopVoice(); // submitting always ends dictation; submission is manual only');
  });
});

/**
 * CASE NOTES (portal review surface for Opa-mobile case-note drafts).
 *
 * These guards pin the clinical-safety properties of the surface, not its
 * looks. Every one of them corresponds to a rule the backend also enforces
 * (backend/case-note-routes.js) or a promise the privacy doc makes
 * (docs/mobile/CASE_NOTE_AI_PRIVACY.md): own rows only, drafts stay drafts,
 * server-composed metadata is never presented as editable or AI-authored,
 * and no note content is ever logged.
 */
describe('case notes review surface', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const CN_JS = fs.readFileSync(path.join(FRONTEND, 'casenotes.js'), 'utf8');
  const CN_CSS = fs.readFileSync(path.join(FRONTEND, 'casenotes.css'), 'utf8');
  // Comment-stripped copy: the file's header comment names the banned things
  // in order to forbid them ("no approve", "no console.*"), so the affordance
  // guards below read the executable code only.
  const CN_CODE = CN_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  test('assets are linked next to the other extracted asset pairs', () => {
    expect(HTML).toContain('<link rel="stylesheet" href="/casenotes.css?v=1" />');
    expect(HTML).toContain('<script src="/casenotes.js?v=1" defer></script>');
  });

  test('nav tab + view mount exist and are wired the same way as other tabs', () => {
    expect(HTML).toContain('data-tab="casenotes"');
    expect(HTML).toContain('<section class="view" id="view-casenotes">');
    expect(HTML).toContain('<div id="cn-root"></div>');
    expect(HTML).toContain("if (name === 'casenotes' && window.CaseNotes && typeof window.CaseNotes.open === 'function') window.CaseNotes.open();");
  });

  test('ROLE_NAV gives Case Notes to treating clinicians only (therapist + owner)', () => {
    const nav = HTML.slice(HTML.indexOf('var ROLE_NAV = {'), HTML.indexOf('var ACCESS_DENIED_MESSAGE'));
    expect(nav).toContain("owner: {\n    primary: ['profile', 'calendar', 'casenotes', 'resources'],");
    expect(nav).toContain("therapist: { primary: ['profile', 'calendar', 'casenotes', 'logbook', 'resources'] },");
    // non-clinical admin and read_only must NOT get it
    expect(nav).toContain("admin: {\n    primary: ['profile', 'calendar'],");
    expect(nav).toContain("read_only: { primary: ['profile', 'calendar', 'resources'] },");
    const adminBlock = nav.slice(nav.indexOf('admin: {'), nav.indexOf('therapist: {'));
    expect(adminBlock).not.toContain('casenotes');
    const readOnlyBlock = nav.slice(nav.indexOf('read_only: {'));
    expect(readOnlyBlock).not.toContain('casenotes');
  });

  test('own rows only — no cross-user, therapist-filtered or admin listing', () => {
    // the list call carries no query string at all: there is no user filter
    // to send, and the server 404s anything that is not yours
    expect(CN_JS).toContain("var API_BASE = '/api/mobile/case-note-drafts';");
    expect(CN_JS).toContain('await api(API_BASE)');
    expect(CN_JS).not.toMatch(/case-note-drafts[^'"`\n]*\?/);
    for (const param of ['userId', 'user_id', 'therapistId', 'therapist_id', 'therapistProfileId', 'allUsers', 'scope=']) {
      expect(CN_JS).not.toContain(param);
    }
    // no admin/owner listing wording anywhere on the surface
    for (const wording of ['all drafts', 'All drafts', 'All Drafts', 'everyone', 'team drafts', "team's drafts",
      'other therapists', 'practice drafts', 'all clinicians']) {
      expect(CN_JS).not.toContain(wording);
      expect(HTML.slice(HTML.indexOf('id="view-casenotes"'), HTML.indexOf('id="view-purchases"'))).not.toContain(wording);
    }
    // and no new endpoint was invented — only the five documented routes
    const paths = CN_JS.match(/\/api\/[a-z0-9/\-{}$'+ .()]*/gi) || [];
    for (const p of paths) expect(p.startsWith('/api/mobile/case-note-drafts')).toBe(true);
  });

  test('only noteBody and plan are editable — metadata never sits in a field', () => {
    // the PATCH body is exactly the two editable fields
    expect(CN_JS).toContain('var sent = { noteBody: noteBody, plan: cnNormalisePlan(S.edits.plan) };');
    expect(CN_JS).toContain("await api(draftPath(S.draft.id), { method: 'PATCH', body: sent });");
    expect(CN_JS).toContain("S.edits = draft\n      ? { noteBody: draft.noteBody == null ? '' : String(draft.noteBody), plan: (draft.plan || []).map(String) }");

    // every <textarea>/<input> built by this file is a note or a plan row
    const fields = CN_CODE.match(/<(textarea|input)[^>]*/g) || [];
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(f).toMatch(/data-cn-input="(note|plan)"/);
      for (const banned of ['clientName', 'clientAddress', 'serviceLine', 'sessionDateLabel', 'identify', 'sessionDetails', 'transcript']) {
        expect(f).not.toContain(banned);
      }
    }
    // metadata/narrative/transcript render through read-only sinks
    expect(CN_JS).toContain('cnMetaRows(draft.header)');
    expect(CN_JS).toContain("'<span class=\"cn-meta-value\">' + esc(r.value)");
    expect(CN_JS).toContain("esc(draft.transcript || '')");
    expect(CN_JS).toContain('<pre class="cn-tx-text">');
    // ...and are labelled as appointment metadata, not AI authorship
    expect(CN_JS).toContain('These details come from the linked appointment in your calendar. They are not written by the AI and cannot be edited here.');
    expect(CN_CSS).toContain('.cn-readonly-tag');
    expect(CN_CSS).toContain('.cn-editable-tag');
  });

  test('transcript is labelled honestly and stays read-only', () => {
    expect(CN_JS).toContain('Transcript — what was recorded');
    expect(CN_JS).not.toMatch(/<textarea[^>]*transcript/i);
    expect(CN_CSS).toContain('.cn-transcript.open .cn-tx-body { display: block; }'); // narrow-width collapse
  });

  test('drafts stay drafts — no approve / send / finalise affordance anywhere', () => {
    const CN_VIEW = HTML.slice(HTML.indexOf('id="view-casenotes"'), HTML.indexOf('id="view-purchases"'));
    for (const banned of ['Approve', 'approve', 'Send to Splose', 'send to Splose', 'Finalise', 'finalise',
      'Finalize', 'Sign off', 'sign off', 'Mark documented', 'Publish', 'Submit note']) {
      expect(CN_CODE).not.toContain(banned);
      expect(CN_VIEW).not.toContain(banned);
    }
    // the only writes are the three review actions
    const methods = CN_CODE.match(/method: '[A-Z]+'/g) || [];
    expect(new Set(methods)).toEqual(new Set(["method: 'PATCH'", "method: 'POST'", "method: 'DELETE'"]));
  });

  test('honest draft-only status line is present on the surface', () => {
    expect(CN_JS).toContain("var STATUS_LINE = 'Draft — saved in Opal only. Nothing is sent to Splose or Outlook.';");
    expect(CN_JS).toContain('esc(STATUS_LINE)');
  });

  test('empty state points at the mobile app, not at a portal capability', () => {
    expect(CN_JS).toContain("var EMPTY_STATE = 'No case-note drafts yet. Notes recorded in the Opa mobile app appear here for review.';");
  });

  test('fail-closed regeneration is surfaced honestly and fabricates nothing', () => {
    expect(CN_JS).toContain("var GENERATION_OFF = 'Note generation is not enabled yet — you can still edit and save.';");
    expect(CN_JS).toContain("if (r.code === 'generation_unavailable') text = text + ' ' + GENERATION_OFF;");
    // the failure path only sets a message — it never writes note text
    const regen = CN_JS.slice(CN_JS.indexOf('async function regenerate()'), CN_JS.indexOf('function archiveAsk()'));
    const failBranch = regen.slice(regen.indexOf('if (!r.ok) {'), regen.indexOf('adoptDraft(r.caseNoteDraft)'));
    expect(failBranch).not.toContain('S.edits.noteBody =');
    expect(failBranch).toContain('setMsg(');
  });

  test('save surfaces 409 and 400 truthfully', () => {
    expect(CN_JS).toContain("var NOT_EDITABLE = 'This note is no longer editable';");
    expect(CN_JS).toContain('if (r.status === 409) {');
    expect(CN_JS).toContain('await loadList(true);');
    expect(CN_JS).toContain("setMsg('error', r.error);"); // 400: the server's own message
  });

  test('keystrokes made during a save are not overwritten by the server copy', () => {
    expect(CN_JS).toContain('var typedDuringSave = cnIsDirty(sent, S.edits);');
    expect(CN_JS).toContain('if (typedDuringSave) {\n      S.edits = pending;');
    expect(CN_JS).toContain('Saved — but you kept typing while it saved, so those newer edits are still unsaved.');
  });

  test('archive uses the styled danger-confirm modal, never a browser confirm()', () => {
    expect(HTML).toContain('<div class="modal-backdrop" id="modal-cn-archive"');
    expect(HTML).toContain('id="cn-archive-confirm"');
    expect(HTML).toContain('data-cn="archive-confirm"');
    expect(CN_JS).toContain("var backdrop = el('modal-cn-archive');");
    expect(CN_JS).toContain("backdrop.classList.add('show');");
    expect(CN_JS).not.toMatch(/\bconfirm\s*\(/);
    expect(CN_JS).not.toMatch(/\bprompt\s*\(/);
    expect(CN_JS).not.toMatch(/\balert\s*\(/);
  });

  test('no clinical content is ever logged or put in a URL', () => {
    expect(CN_CODE).not.toMatch(/console\s*\./);
    expect(CN_CODE).not.toMatch(/localStorage|sessionStorage/);
    // ids only in URLs — the note/transcript never travel in a query string
    expect(CN_JS).toContain("function draftPath(id) { return API_BASE + '/' + encodeURIComponent(id); }");
  });

  test('unsaved-changes guard is inline, not a browser dialog', () => {
    expect(CN_JS).toContain("S.guard = { kind: 'select', id: id };");
    expect(CN_JS).toContain("S.guard = { kind: 'leave', tab: tab.dataset.tab };");
    expect(CN_JS).toContain('data-cn="guard-keep"');
    expect(CN_JS).toContain('data-cn="guard-discard"');
    expect(CN_JS).not.toContain('beforeunload');
    expect(CN_JS).not.toContain('onbeforeunload');
  });

  test('clinical content is deliberately kept out of the Cmd+Z undo manager', () => {
    expect(CN_JS).not.toMatch(/pushUndo|undoStack|registerUndo/);
    expect(CN_JS).toContain('Deliberately NOT integrated with the global Cmd+Z undo manager');
  });

  test('accessibility basics: real buttons, tied labels, headings, focus styles', () => {
    expect(CN_JS).not.toMatch(/<a [^>]*data-cn=/);          // actions are buttons, not links
    expect(CN_JS).toContain('<label class="cn-sr-only" for="\' + id + \'">Plan item ');
    expect(CN_JS).toContain('<label for="cn-note">Note</label>');
    expect(CN_JS).toContain('role="status" aria-live="polite"');
    expect(CN_JS).toContain('aria-current="');
    expect(CN_CSS).toContain('.cn-item:focus-visible');
    expect(CN_CSS).toContain('.cn-note:focus-visible');
    expect(CN_CSS).toContain('.cn-input:focus-visible');
  });
});

describe('fca report builder', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const FCA_JS = fs.readFileSync(path.join(FRONTEND, 'fca.js'), 'utf8');
  const FCA_CSS = fs.readFileSync(path.join(FRONTEND, 'fca.css'), 'utf8');
  // Comment-stripped copy: the header comment names the banned things in order
  // to forbid them ("no '|| fallback'", "no console.*"), so the affordance
  // guards below read the executable code only.
  const FCA_CODE = FCA_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  test('assets are linked next to the other extracted asset pairs', () => {
    // ?v= is cache-busting and changes whenever the asset does. Assert that the
    // pair is linked the same way as its neighbours, not which revision it is on.
    expect(HTML).toMatch(/<link rel="stylesheet" href="\/fca\.css\?v=\d+" \/>/);
    expect(HTML).toMatch(/<script src="\/fca\.js\?v=\d+" defer><\/script>/);
  });

  test('the wizard and the hub entry point have their own mounts', () => {
    expect(HTML).toContain('<div id="fca-hub-entry" hidden></div>');
    expect(HTML).toContain('<div id="fca-root" hidden></div>');
    // The entry card is a SIBLING of #rh2-root: resourcehub.js rebuilds that
    // subtree wholesale and would otherwise wipe the card away.
    //
    // It must come AFTER #rh2-root. That element renders the Resource Hub
    // navigation followed by the destination content, so a card placed before
    // it appears between the top-level tabs and the hub navigation — which is
    // the layout bug this ordering exists to prevent.
    expect(HTML.indexOf('id="fca-hub-entry"')).toBeGreaterThan(HTML.indexOf('id="rh2-root"'));
    // The overlay is a direct child of <body>. Inside #view-resources it would
    // sit under display:none whenever another tab is active, and a fixed
    // overlay in a display:none ancestor never paints.
    expect(HTML.indexOf('id="fca-root"')).toBeGreaterThan(HTML.lastIndexOf('</script>'));
    // A direct child of <body>: nothing but sibling full-screen surfaces and
    // whitespace/comments may sit between it and </body>. The assessment
    // surface joined it there for the same reason.
    const tail = HTML.slice(HTML.indexOf('<div id="fca-root" hidden></div>'));
    expect(tail).toMatch(/<\/body>/);
    expect(tail.replace(/<!--[\s\S]*?-->/g, '')).toMatch(
      /<div id="fca-root" hidden><\/div>\s*(?:<div id="assessment-root" class="assess-root" hidden><\/div>\s*)?<\/body>/);
  });

  test('the Resource Hub carries a prominent "Create a new FCA report" action', () => {
    expect(FCA_JS).toContain('Create a new FCA report');
    expect(FCA_JS).toContain('data-fca="start"');
    expect(FCA_JS).toContain('fca-btn-primary fca-entry-cta');
    // …plus the resumable list of the therapist's own drafts.
    expect(FCA_JS).toContain('Your reports in progress');
    expect(FCA_JS).toContain("api(API + '/drafts')");
    expect(FCA_JS).toContain('data-fca="draft-open"');
  });

  // ── The manifest is the single source of truth ──────────────────────────
  test('the preview is built from draft.manifest, never from a local list', () => {
    expect(FCA_JS).toContain('function fcaPreviewModel(draft)');
    expect(FCA_JS).toContain('if (!manifest || !Array.isArray(manifest.sections)) return base;');
    // Not ready = say so. Never reconstruct a section list locally.
    expect(FCA_JS).toContain('The preview appears once the report has been composed on the server.');
  });

  test('no template section list is duplicated in the front end', () => {
    // Every section tag, label and description arrives from GET /api/fca/template.
    // A literal template tag here would be a second source of truth that could
    // silently disagree with the document the generator produces.
    expect(FCA_CODE).not.toContain('OPAL_SECTION_');
    expect(FCA_CODE).not.toContain('OPAL_CLIENT_');
    expect(FCA_CODE).not.toContain('OPAL_THERAPIST_');
    expect(FCA_CODE).not.toContain('OPAL_REPORT_');
    expect(FCA_JS).toContain('templateSections()');
  });

  // ── Required sections cannot be unchecked ───────────────────────────────
  test('required sections render checked, disabled and visibly locked', () => {
    expect(FCA_JS).toContain("(locked ? ' disabled aria-disabled=\"true\"' : '')");
    expect(FCA_JS).toContain('Required by the Opal template — this section cannot be removed');
    expect(FCA_JS).toContain('aria-label="Required section, cannot be removed"');
    expect(FCA_JS).toContain('Always included');
    expect(FCA_JS).toContain('Required report framework');
    // The toggle refuses required tags even if the DOM is tampered with.
    expect(FCA_JS).toContain("if (meta && meta.required === true) return; // required sections never move");
    // Clearing optional selections keeps every required tag.
    expect(FCA_JS).toContain("return s.required === true; })");
    expect(FCA_CSS).toContain('.fca-secitem-locked');
  });

  // ── Source attribution: the contract labels, exactly ────────────────────
  test('source badges use the contract labels and nothing else', () => {
    expect(FCA_JS).toContain("splose: 'Splose',");
    expect(FCA_JS).toContain("client_profile: 'Opal client profile',");
    expect(FCA_JS).toContain("report_override: 'Entered for this report',");
    // What Opal ISSUES rather than looks up — the document id, date, version
    // and status. Reporting those as "Missing" was never a fact.
    expect(FCA_JS).toContain("server: 'Generated by Opal',");
    expect(FCA_JS).toContain("missing: 'Missing',");
    // An origin the server does not name is Missing, never an assumption.
    expect(FCA_JS).toContain("return FCA_SOURCE_LABELS[k] ? k : 'missing';");
    // Badges are rendered from the manifest's own scalarSources.
    expect(FCA_JS).toContain('m.scalarSources && typeof m.scalarSources === \'object\' ? m.scalarSources : {}');
    expect(FCA_JS).toContain('fcaEsc(f.sourceLabel)');
    FCA_CSS.match(/\.fca-badge-[a-z_]+/g).forEach((sel) => {
      expect(['.fca-badge-splose', '.fca-badge-client_profile',
        '.fca-badge-report_override', '.fca-badge-server',
        '.fca-badge-missing']).toContain(sel);
    });
  });

  test('missing is an unmistakable state, never a guessed value', () => {
    expect(FCA_JS).toContain("'<span class=\"fca-missing\">' + icn('alert') + ' No value</span>'");
    expect(FCA_JS).toContain('value: (missing || isExcluded) ? null : String(raw),');
    // The badge still carries the exact contract label for a missing field.
    expect(FCA_JS).toContain("missing: 'Missing',");
    expect(FCA_JS).toContain('Nothing here is guessed.');
    expect(FCA_CSS).toContain('.fca-missing');
  });

  // ── Blank or exclude: the two honest options, in both builders ──────────
  test('the blank-or-exclude note is worded exactly as agreed', () => {
    /* eslint-disable-next-line global-require */
    const fca = require('../../frontend/current/fca.js');
    expect(fca.FCA_BLANK_OR_EXCLUDE_NOTE).toBe(
      'If we do not hold this information, you can leave it blank and complete '
      + 'it in Word after downloading — or exclude it so nothing is inserted.'
    );
    // Rendered, not merely defined — and as a quiet inline note rather than an
    // alarming callout.
    expect(FCA_JS).toContain('fcaEsc(FCA_BLANK_OR_EXCLUDE_NOTE)');
    expect(FCA_JS).toContain('class="fca-inline-note"');
    expect(FCA_CSS).toContain('.fca-inline-note');
  });

  test('every field row carries a keyboard-reachable Exclude control', () => {
    expect(FCA_JS).toContain('data-fca-check="exclude"');
    expect(FCA_JS).toContain('>Exclude<');
    // A real checkbox with a real <label for>, not a styled div.
    expect(FCA_JS).toContain("type=\"checkbox\" id=\"' + fcaEsc(exId)");
    expect(FCA_JS).toContain("<label for=\"' + fcaEsc(exId)");
    expect(FCA_CSS).toContain('.fca-exclude input:focus-visible');
  });

  test('an excluded row de-emphasises, states the effect, and disables its input', () => {
    expect(FCA_JS).toContain('Excluded — nothing will be inserted');
    expect(FCA_JS).toContain('fca-field-excluded');
    expect(FCA_JS).toContain("f.excluded ? ' disabled' : ''");
    expect(FCA_CSS).toContain('.fca-field-excluded');
    expect(FCA_CSS).toContain('text-decoration: line-through');
  });

  test('exclusion is read from the server manifest, never computed locally', () => {
    expect(FCA_JS).toContain('function fcaExcludedSet(manifest)');
    expect(FCA_JS).toContain('m.excludedTags) ? m.excludedTags : []');
    // The PATCH sends the whole set; the server's manifest is what renders.
    expect(FCA_JS).toContain('queuePatch({ excludedFields: next });');
  });

  // ── Save back to the client profile ─────────────────────────────────────
  test('the save-to-profile action exists and is worded exactly as contracted', () => {
    expect(FCA_JS).toContain("Save eligible changes to the client\\'s report profile");
    expect(FCA_JS).toContain("'/save-to-profile'");
    expect(FCA_JS).toContain("method: 'POST', body: { fields: fields },");
  });

  test('saving to the profile is explicit — never automatic, never on Next', () => {
    // The ONLY caller is the button's own click action.
    expect(FCA_JS).toContain("if (a === 'profile-save') { saveToProfile(); return; }");
    expect(FCA_CODE).toContain('async function saveToProfile()');
    // Exactly one call site in the whole file (the declaration excluded).
    expect((FCA_CODE.match(/(?<!function\s)saveToProfile\(\)/g) || []).length).toBe(1);
    // It is not reachable from navigation, autosave or generation.
    expect(FCA_CODE).not.toMatch(/function goStep[\s\S]{0,400}saveToProfile/);
    expect(FCA_CODE).not.toMatch(/function flushPatch[\s\S]{0,600}saveToProfile/);
    expect(FCA_CODE).not.toMatch(/async function generate\(\)[\s\S]{0,600}saveToProfile/);
    // Ticking a box sends nothing on its own.
    expect(FCA_JS).toContain('data-fca-check="profile-pick"');
    // The button is dead until something is actually ticked.
    expect(FCA_JS).toContain("(S.profileBusy || !picked ? ' disabled' : '')");
  });

  test('it states plainly that report-specific fields are excluded', () => {
    expect(FCA_JS).toContain('<strong>Report-specific values are never saved:</strong>');
    ['report date', 'document ID', 'version', 'status', 'reviewer',
      'authorised recipients', 'referral reason', 'conclusions'].forEach((phrase) => {
      expect(FCA_JS).toContain(phrase);
    });
  });

  test('only server-declared eligible fields the therapist entered are offered', () => {
    expect(FCA_JS).toContain('S.template.profileEligibleTags');
    // …and never a field the therapist has excluded: there is nothing to save.
    expect(FCA_JS).toContain("if (f.profileEligible && f.source === 'report_override' && !f.missing && !f.excluded) out.push(f);");
  });

  test('the server\'s answer is reported honestly, including refusals', () => {
    expect(FCA_JS).toContain('savedFields: Array.isArray(r.savedFields) ? r.savedFields : []');
    expect(FCA_JS).toContain('rejected: Array.isArray(r.rejected) ? r.rejected : []');
    expect(FCA_JS).toContain('<strong>Not saved:</strong>');
    expect(FCA_JS).toContain('The server saved nothing and reported no reason.');
  });

  // ── Never fabricate, never leak ─────────────────────────────────────────
  test('no fabricated-value fallbacks anywhere in the builder', () => {
    // The only string-literal '||' defaults in the whole file are an HTTP verb
    // and an empty string. A client field never falls back to invented text.
    const fallbacks = FCA_CODE.match(/\|\|\s*['"][^'"]*['"]/g) || [];
    expect(fallbacks.sort()).toEqual(["|| ''", "|| 'GET'"]);
    expect(FCA_CODE).not.toMatch(/\|\|\s*['"](Unknown|N\/A|Not provided|None|TBC|-{1,2})['"]/i);
  });

  test('no client data is logged, stored or put in a URL', () => {
    expect(FCA_CODE).not.toMatch(/console\s*\./);
    expect(FCA_CODE).not.toMatch(/localStorage|sessionStorage/);
    expect(FCA_CODE).not.toMatch(/analytics|gtag|dataLayer/);
    // Only opaque ids ever travel in a path; the search term is the sole query
    // parameter and it is encoded.
    expect(FCA_JS).toContain("api(API + '/clients?q=' + encodeURIComponent(query))");
    expect(FCA_JS).toContain("'/drafts/' + encodeURIComponent(S.draft.id)");
  });

  test('nothing downloads by itself — one gesture starts a download, and only one', () => {
    // The rule has always been that a clinical document never leaves the portal
    // without the therapist asking for it. The last step now asks in one press
    // instead of two, so the guard pins the PATH rather than banning the verb:
    // exactly one activation exists, it lives in startDownload, and only
    // downloadDocument — the handler for the Download Word document button —
    // can reach it.
    expect(FCA_JS).toContain('Download Word document');
    expect(FCA_JS).toContain('Download the Word document again');

    const activations = FCA_CODE.match(/\.click\(\)/g) || [];
    expect(activations.length).toBe(1);
    const startDownload = FCA_CODE.slice(FCA_CODE.indexOf('function startDownload('));
    expect(startDownload.slice(0, startDownload.indexOf('\n  }'))).toContain('link.click();');

    // startDownload is called from exactly one place, and that place is the
    // Download action's own handler.
    const calls = FCA_CODE.match(/(?<!function )startDownload\(/g) || [];
    expect(calls.length).toBe(1);
    const downloadFn = FCA_CODE.slice(
      FCA_CODE.indexOf('async function downloadDocument()'),
      FCA_CODE.indexOf('function startDownload(')
    );
    expect(downloadFn).toContain('startDownload(r.documentId)');
    expect(FCA_CODE).toContain("if (a === 'download') { downloadDocument(); return; }");

    // No render, save, navigation or preview path may reach it.
    ['function render(', 'function paintSections(', 'async function flushPatch(',
      'function goStep(', 'async function runExactPreview(', 'function ensureExactPreview(']
      .forEach((fn) => {
        const start = FCA_CODE.indexOf(fn);
        expect(start).toBeGreaterThan(-1);
        expect(FCA_CODE.slice(start, start + 2500)).not.toContain('startDownload(');
      });

    expect(FCA_CODE).not.toMatch(/window\.location\s*=/);
    expect(FCA_CODE).not.toMatch(/location\.href\s*=/);
  });

  // ── Accessibility ───────────────────────────────────────────────────────
  test('accessibility basics: labels, live regions, keyboard reordering', () => {
    expect(FCA_JS).toContain('role="status" aria-live="polite"');
    expect(FCA_JS).toContain('aria-current="step"');
    expect(FCA_JS).toContain('<label class="fca-sr-only" for="fca-q">Search clients by name</label>');
    // Reordering is not mouse-only: the buttons and the drag share setOrder().
    expect(FCA_JS).toContain('data-fca="move-up"');
    expect(FCA_JS).toContain('data-fca="move-down"');
    expect(FCA_JS).toContain('Drag to reorder, or use the move buttons');
    expect(FCA_CSS).toContain(':focus-visible');
    expect(FCA_CSS).toContain('.fca-sr-only');
  });

  test('progress is saved as the therapist works, and survives a failure', () => {
    expect(FCA_JS).toContain('patchTimer = setTimeout(flushPatch, 600);');
    expect(FCA_JS).toContain('Your progress is saved as you go');
    // A failed save keeps the work and offers a retry.
    expect(FCA_JS).toContain('data-fca="retry-save"');
    expect(FCA_JS).toContain('pendingPatch = Object.assign({}, body, pendingPatch || {});');
    // Retry re-applies the change it is retrying, rather than re-sending an
    // edit the rollback has already undone.
    expect(FCA_JS).toMatch(/function retryPatch\(\)[\s\S]{0,400}applyPatchLocally\(pendingPatch\)/);
  });

  test('a failed save rolls back the section list — and nothing the therapist typed', () => {
    // The panel must not show an ordering the report does not have, or the
    // download would disagree with the screen. Typed prose is a different
    // matter: a sentence is expensive to lose and a tick is not.
    const rollback = FCA_CODE.slice(FCA_CODE.indexOf('function rollbackSectionEdit('));
    const body = rollback.slice(0, rollback.indexOf('\n  }'));
    expect(body).toContain('S.confirmed.selectedSections');
    expect(body).toContain('S.confirmed.sectionOrder');
    expect(body).toContain('S.confirmed.customSections');
    expect(body).not.toContain('S.overrides');
    expect(body).not.toContain('scalarOverrides');
    expect(body).not.toContain('excludedFields');
    // Scoped to structural patches only.
    expect(FCA_CODE).toMatch(/function patchTouchesSections\(body\)[\s\S]{0,400}selectedSections/);
    expect(FCA_JS).toContain('That change could not be saved');
  });
});

describe('Resource Hub layout hierarchy', () => {
  test('no page-specific panel renders between the top-level tabs and the hub navigation', () => {
    // The shared header is: heading -> top-level tabs -> #rh2-root (which
    // renders the hub nav, then content). Anything mounted before #rh2-root
    // lands in the gap between the tabs and the nav.
    const tabs = HTML.indexOf('data-rh="ai"');            // last top-level tab
    const root = HTML.indexOf('id="rh2-root"');
    expect(tabs).toBeGreaterThan(-1);
    expect(root).toBeGreaterThan(tabs);

    const between = HTML.slice(tabs, root);
    // Only the tab strip's own closing markup and comments may sit here.
    expect(between).not.toMatch(/id="fca-hub-entry"/);
    expect(between).not.toMatch(/id="letter-hub-entry"/);
  });
});

describe('progress note letter builder', () => {
  const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
  const LTR_JS = fs.readFileSync(path.join(FRONTEND, 'letter.js'), 'utf8');
  const LTR_CSS = fs.readFileSync(path.join(FRONTEND, 'letter.css'), 'utf8');
  // Comment-stripped copy: the header comment names the banned things in order
  // to forbid them ("no console.*", "not one '|| fallback'"), so the guards
  // below read the executable code only.
  const LTR_CODE = LTR_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  test('assets are linked next to the other extracted asset pairs', () => {
    // See the FCA equivalent: the revision number is not part of the contract.
    expect(HTML).toMatch(/<link rel="stylesheet" href="\/letter\.css\?v=\d+" \/>/);
    expect(HTML).toMatch(/<script src="\/letter\.js\?v=\d+" defer><\/script>/);
  });

  test('the wizard and the hub entry point have their own mounts', () => {
    expect(HTML).toContain('<div id="letter-hub-entry" hidden></div>');
    expect(HTML).toContain('<div id="letter-root" hidden></div>');
    // The entry card sits beside the FCA card, both AFTER #rh2-root so neither
    // renders above the Resource Hub navigation.
    expect(HTML.indexOf('id="fca-hub-entry"')).toBeLessThan(HTML.indexOf('id="letter-hub-entry"'));
    expect(HTML.indexOf('id="letter-hub-entry"')).toBeGreaterThan(HTML.indexOf('id="rh2-root"'));
    // The overlay is a direct child of <body>: inside #view-resources it would
    // sit under display:none whenever another tab is active, and a fixed
    // overlay in a display:none ancestor never paints.
    expect(HTML.indexOf('id="letter-root"')).toBeGreaterThan(HTML.lastIndexOf('</script>'));
  });

  test('the Resource Hub carries the "Create progress note letter" action beside the FCA one', () => {
    expect(LTR_JS).toContain('Create progress note letter');
    expect(LTR_JS).toContain('data-ltr="start"');
    expect(LTR_JS).toContain('ltr-btn-primary ltr-entry-cta');
    // …plus the resumable list of the therapist's own letter drafts.
    expect(LTR_JS).toContain('Your letters in progress');
    expect(LTR_JS).toContain("api(API + '/drafts')");
    expect(LTR_JS).toContain('data-ltr="draft-open"');
    expect(LTR_JS).toContain("var API = '/api/letters';");
  });

  test('the wizard is five steps and Back never discards input', () => {
    expect(LTR_JS).toContain("{ n: 1, label: 'Participant' }");
    expect(LTR_JS).toContain("{ n: 2, label: 'Addressee' }");
    expect(LTR_JS).toContain("{ n: 3, label: 'Letter details' }");
    expect(LTR_JS).toContain("{ n: 4, label: 'Sections' }");
    expect(LTR_JS).toContain("{ n: 5, label: 'Review' }");
    // ONE state object; going Back only changes S.step.
    expect(LTR_JS).toContain('Your progress is saved as you go');
    expect(LTR_CODE).toMatch(/function goStep\(n\) \{[\s\S]{0,200}S\.step = n;/);
  });

  // ── The manifest is the single source of truth ──────────────────────────
  test('the preview is built from draft.manifest, never from a local block list', () => {
    expect(LTR_JS).toContain('function ltrPreviewModel(draft)');
    expect(LTR_JS).toContain('if (!manifest || !Array.isArray(manifest.sections)) return base;');
    expect(LTR_JS).toContain('The preview appears once the letter has been composed on the server.');
    // renderPreview reads the model and nothing else.
    expect(LTR_CODE).toMatch(/function renderPreview\(\) \{\s*var m = ltrPreviewModel\(S\.draft\);/);
  });

  test('no template block list or merge tag is duplicated in the front end', () => {
    // Every block tag, label and description arrives from
    // GET /api/letters/template; every scalar tag arrives in the manifest. A
    // literal here would be a second source of truth that could silently
    // disagree with the document the generator produces.
    // (The only 'OPAL_' anywhere in the file is one worked example inside a
    // comment explaining how labels are derived — never executable code.)
    expect(LTR_CODE).not.toContain('OPAL_');
    expect((LTR_JS.match(/OPAL_/g) || []).length).toBe(1);
    expect(LTR_JS).toContain('templateSections()');
    // Even the 'portal' source split is done by DERIVED tag group, not by a
    // hard-coded tag prefix string.
    expect(LTR_JS).toContain("return ltrTagGroup(tag) === 'organisation' ? 'portal_organisation' : 'portal_therapist';");
  });

  // ── Required blocks cannot be unchecked ─────────────────────────────────
  test('the two required blocks render checked, disabled and visibly locked', () => {
    expect(LTR_JS).toContain("(locked ? ' disabled aria-disabled=\"true\"' : '')");
    expect(LTR_JS).toContain('Required by the Opal letter template — this section cannot be removed');
    expect(LTR_JS).toContain('aria-label="Required section, cannot be removed"');
    expect(LTR_JS).toContain('Always included');
    expect(LTR_JS).toContain('These sections are the letter itself and cannot be removed.');
    // The toggle refuses required tags even if the DOM is tampered with…
    expect(LTR_JS).toContain('if (meta && meta.required === true) return; // required blocks never move');
    // …and every selection that leaves this file is re-armoured first.
    expect(LTR_JS).toContain('var safe = ltrEnforceRequired(tags, templateSections());');
    expect(LTR_CSS).toContain('.ltr-blockitem-locked');
  });

  test('toggling a template block never drops the therapist\'s custom content', () => {
    // Custom blocks live in customSections, not selectedSections. Reading the
    // selection for them made ticking an unrelated template block silently
    // remove custom content from the manifest — and therefore from the letter.
    expect(LTR_JS).toContain("if (s.kind === 'custom') return;");
    expect(LTR_JS).toContain('customSections, NOT by selectedSections');
  });

  // ── Source attribution: the six contract labels ─────────────────────────
  test('source badges use the six contract labels and nothing else', () => {
    expect(LTR_JS).toContain("splose: 'Splose',");
    expect(LTR_JS).toContain("client_profile: 'Opal client profile',");
    expect(LTR_JS).toContain("portal_therapist: 'Therapist profile',");
    expect(LTR_JS).toContain("portal_organisation: 'Organisation settings',");
    expect(LTR_JS).toContain("report_override: 'Entered for this letter',");
    expect(LTR_JS).toContain("missing: 'Missing',");
    // 'server' is the documented superset member and reads as Opal's own.
    expect(LTR_JS).toContain("server: 'Generated by Opal',");
    // An origin the server does not name is Missing, never an assumption.
    expect(LTR_JS).toContain("return LTR_SOURCE_LABELS[k] ? k : 'missing';");
    // Badges are rendered from the manifest's own scalarSources.
    expect(LTR_JS).toContain("m.scalarSources && typeof m.scalarSources === 'object' ? m.scalarSources : {}");
    expect(LTR_JS).toContain('ltrEsc(f.sourceLabel)');
    LTR_CSS.match(/\.ltr-badge-[a-z_]+/g).forEach((sel) => {
      expect(['.ltr-badge-splose', '.ltr-badge-client_profile', '.ltr-badge-portal_therapist',
        '.ltr-badge-portal_organisation', '.ltr-badge-report_override',
        '.ltr-badge-server', '.ltr-badge-missing']).toContain(sel);
    });
  });

  test('missing is an unmistakable state, never a guessed value', () => {
    expect(LTR_JS).toContain("'<span class=\"ltr-missing\">' + icn('alert') + ' No value</span>'");
    expect(LTR_JS).toContain('value: (missing || isExcluded) ? null : String(raw),');
    expect(LTR_JS).toContain('nothing here is guessed');
    expect(LTR_CSS).toContain('.ltr-missing');
  });

  // ── Blank or exclude: the two honest options, in both builders ──────────
  test('the blank-or-exclude note is worded exactly as agreed, and identically', () => {
    /* eslint-disable-next-line global-require */
    const ltr = require('../../frontend/current/letter.js');
    /* eslint-disable-next-line global-require */
    const fca = require('../../frontend/current/fca.js');
    expect(ltr.LTR_BLANK_OR_EXCLUDE_NOTE).toBe(
      'If we do not hold this information, you can leave it blank and complete '
      + 'it in Word after downloading — or exclude it so nothing is inserted.'
    );
    // The same promise about the same thing — two wordings would read as two
    // different rules.
    expect(ltr.LTR_BLANK_OR_EXCLUDE_NOTE).toBe(fca.FCA_BLANK_OR_EXCLUDE_NOTE);
    expect(LTR_JS).toContain('ltrEsc(LTR_BLANK_OR_EXCLUDE_NOTE)');
    expect(LTR_JS).toContain('class="ltr-inline-note"');
    expect(LTR_CSS).toContain('.ltr-inline-note');
  });

  test('every merged-value row carries a keyboard-reachable Exclude control', () => {
    expect(LTR_JS).toContain('data-ltr-check="exclude"');
    expect(LTR_JS).toContain('>Exclude<');
    expect(LTR_JS).toContain("type=\"checkbox\" id=\"' + ltrEsc(exId)");
    expect(LTR_JS).toContain("<label for=\"' + ltrEsc(exId)");
    expect(LTR_CSS).toContain('.ltr-exclude input:focus-visible');
  });

  test('an excluded row de-emphasises, states the effect, and disables its input', () => {
    expect(LTR_JS).toContain('Excluded — nothing will be inserted');
    expect(LTR_JS).toContain('ltr-field-excluded');
    expect(LTR_CSS).toContain('.ltr-field-excluded');
    expect(LTR_CSS).toContain('text-decoration: line-through');
  });

  test('exclusion is read from the server, never computed locally', () => {
    expect(LTR_JS).toContain('function ltrExcludedSet(manifest)');
    expect(LTR_JS).toContain('m.excludedTags) ? m.excludedTags : []');
    // The addressing preview honours exclusions through the SERVER's own
    // field-name restatement, so this file still names no merge tag.
    expect(LTR_JS).toContain('function ltrExcludedFields(draft)');
    expect(LTR_JS).toContain('d.excludedLetterFields');
    expect(LTR_JS).toContain('queuePatch({ excludedFields: next });');
  });

  test('an excluded value never blocks generation', () => {
    expect(LTR_JS).toContain('!exField.recipientName');
    expect(LTR_JS).toContain('!exField.subject');
    expect(LTR_JS).toContain('!exField.letterDate');
    // A template-required scalar the server reported missing is skipped too.
    expect(LTR_JS).toContain('if (!excluded[String(t)]) missing[String(t)] = true;');
  });

  // ── Australian dates ────────────────────────────────────────────────────
  test('dates are Australian on entry and in the letter — never US order', () => {
    expect(LTR_JS).toContain('placeholder="dd/mm/yyyy"');
    expect(LTR_JS).toContain('Australian order — day, then month, then year.');
    expect(LTR_JS).toContain('for example 03/04/2026 for 3 April 2026');
    // Day-first parse: day is capture 1, month is capture 2.
    expect(LTR_JS).toContain('var d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);');
    expect(LTR_JS).toContain("return ltrPad2(p.day) + '/' + ltrPad2(p.month) + '/' + p.year;");
    // Nothing in this file may format a date through the viewer's locale — a
    // browser set to en-US would otherwise print an Australian clinical letter
    // in US order with nothing on screen saying which reading was meant.
    expect(LTR_CODE).not.toMatch(/toLocaleDateString|toLocaleString|toLocaleTimeString/);
    expect(LTR_JS).not.toContain('mm/dd/yyyy');
    expect(LTR_JS).not.toContain("'en-US'");
  });

  // ── Saving a recipient to the profile is explicit ───────────────────────
  test('the save-recipient action exists and is worded exactly as contracted', () => {
    expect(LTR_JS).toContain("Save this recipient to the participant\\'s report profile");
    expect(LTR_JS).toContain("'/save-recipient-to-profile'");
    expect(LTR_JS).toContain("method: 'POST', body: { target: S.saveTarget },");
  });

  test('it is never automatic — the button is the only caller', () => {
    expect(LTR_JS).toContain("if (a === 'save-recipient') { saveRecipientToProfile(); return; }");
    expect(LTR_CODE).toContain('async function saveRecipientToProfile()');
    // Exactly one call site in the whole file (the declaration excluded).
    expect((LTR_CODE.match(/(?<!function\s)saveRecipientToProfile\(\)/g) || []).length).toBe(1);
    // Not reachable from navigation, autosave or generation.
    expect(LTR_CODE).not.toMatch(/function goStep[\s\S]{0,400}saveRecipientToProfile/);
    expect(LTR_CODE).not.toMatch(/function flushPatch[\s\S]{0,600}saveRecipientToProfile/);
    expect(LTR_CODE).not.toMatch(/async function generate\(\)[\s\S]{0,600}saveRecipientToProfile/);
    // And the step says plainly that nothing else is kept.
    expect(LTR_JS).toContain('<strong>Letter-specific edits are not saved to the participant\\\'s report profile</strong>');
  });

  test('every contact offered is labelled with the source Opal holds it under', () => {
    expect(LTR_JS).toContain("support_coordinator: 'Support coordinator',");
    expect(LTR_JS).toContain("nominee: 'Nominee',");
    expect(LTR_JS).toContain("referrer: 'Referrer',");
    expect(LTR_JS).toContain("saved_contact: 'Saved contact',");
    expect(LTR_JS).toContain("'/clients/' + encodeURIComponent(id) + '/contacts'");
    expect(LTR_JS).toContain('ltrContactSourceLabel(c.source)');
    expect(LTR_JS).toContain('Enter a custom recipient');
  });

  test('the salutation is suggested but never overwrites what the therapist typed', () => {
    expect(LTR_JS).toContain('function ltrSuggestSalutation(recipient)');
    expect(LTR_JS).toContain('if (!S.salutationTouched && (opts && opts.suggest)) {');
    expect(LTR_JS).toContain("if (kind === 'recip-salutation') { S.salutationTouched = true;");
    expect(LTR_JS).toContain('The salutation is suggested from the recipient\\\'s name and stays yours to change.');
  });

  // ── Generation is blocked, confirmed, and never automatic ───────────────
  test('required missing values block generation with a clear message', () => {
    expect(LTR_JS).toContain('function ltrBlockingIssues(draft, template)');
    expect(LTR_JS).toContain('<strong>This letter cannot be generated yet.</strong>');
    expect(LTR_JS).toContain("(issues.length || S.generating ? ' disabled aria-disabled=\"true\"' : '')");
    // The guard is enforced in the action too, not only in the markup.
    expect(LTR_JS).toContain('if (blockingIssues().length) return;');
    expect(LTR_CSS).toContain('.ltr-note-block');
  });

  test('generation is confirmed, and nothing downloads by itself', () => {
    expect(LTR_JS).toContain('<strong>Generate this letter now?</strong>');
    expect(LTR_JS).toContain("if (a === 'generate-confirm') { S.confirming = true; render(); return; }");
    expect(LTR_JS).toContain('Download the Word document');
    expect(LTR_CODE).not.toMatch(/\.click\(\)/);
    expect(LTR_CODE).not.toMatch(/window\.location\s*=/);
  });

  test('the document id is issued by Opal, shown once, and changed in one place', () => {
    // It is ISSUED — never "Missing" — but it is a default, not a decree: a
    // practice that numbers its own correspondence overrides it like any other
    // value. This slot displays it; the merged-values list is the one editor,
    // because two editors for one value on one screen is a way to lose an edit.
    expect(LTR_JS).toContain('readonly aria-readonly="true"');
    expect(LTR_JS).toContain('Issued by Opal when this draft was created');
    expect(LTR_JS).toContain('To use your own reference, change it under');
    expect(LTR_JS).toContain("server: 'Generated by Opal',");
    // Only an EXCLUDED row is uneditable now — there is nothing to type into a
    // field that will not be inserted.
    expect(LTR_JS).toContain('editable: !isExcluded,');
  });

  // ── Custom content stays letter-sized and reorderable by keyboard ───────
  test('custom content is optional, capped and fully keyboard reorderable', () => {
    expect(LTR_JS).toContain('Add custom content');
    expect(LTR_JS).toContain('Keep it letter-sized — this is a page, not a report.');
    expect(LTR_JS).toContain('var LTR_CUSTOM_LABEL_MAX = 120;');
    expect(LTR_JS).toContain('var LTR_CUSTOM_GUIDANCE_MAX = 600;');
    // Reordering is buttons only — there is no mouse-only drag path to miss.
    expect(LTR_JS).toContain('data-ltr="custom-up"');
    expect(LTR_JS).toContain('data-ltr="custom-down"');
    expect(LTR_JS).toContain('data-ltr="custom-edit"');
    expect(LTR_JS).toContain('data-ltr="custom-remove"');
    expect(LTR_CODE).not.toMatch(/draggable="true"/);
  });

  // ── Never fabricate, never leak ─────────────────────────────────────────
  test('no fabricated-value fallbacks anywhere in the builder', () => {
    const fallbacks = LTR_CODE.match(/\|\|\s*['"][^'"]*['"]/g) || [];
    fallbacks.forEach((f) => {
      expect(f).toMatch(/\|\|\s*['"](GET|)['"]/);
    });
    expect(LTR_CODE).not.toMatch(/\|\|\s*['"](Unknown|N\/A|Not provided|None|TBC|-{1,2})['"]/i);
    // A value Opal does not hold says so, in words.
    expect(LTR_JS).toContain("' Not held</span>'");
  });

  test('no participant data is logged, stored, analysed or put in a URL', () => {
    expect(LTR_CODE).not.toMatch(/console\s*\./);
    expect(LTR_CODE).not.toMatch(/localStorage|sessionStorage/);
    expect(LTR_CODE).not.toMatch(/analytics|gtag|dataLayer/);
    // Only opaque ids ever travel in a path; the search term is the sole query
    // parameter and it is encoded.
    expect(LTR_JS).toContain("api(API + '/clients?q=' + encodeURIComponent(query))");
    expect(LTR_JS).toContain("'/drafts/' + encodeURIComponent(S.draft.id)");
  });

  // ── Accessibility ───────────────────────────────────────────────────────
  test('accessibility basics: real labels, live regions, keyboard operation', () => {
    expect(LTR_JS).toContain('role="status" aria-live="polite"');
    expect(LTR_JS).toContain('aria-current="step"');
    expect(LTR_JS).toContain('<label class="ltr-sr-only" for="ltr-q">Search participants by name</label>');
    expect(LTR_JS).toContain('class="ltr-sr-only" for="ltr-cc-n-');
    expect(LTR_JS).toContain('role="dialog" aria-modal="true" aria-labelledby="ltr-title"');
    expect(LTR_JS).toContain('aria-describedby="ltr-date-help"');
    expect(LTR_CSS).toContain(':focus-visible');
    expect(LTR_CSS).toContain('.ltr-sr-only');
  });

  test('the preview is a right-side pane on desktop and a drawer when narrow', () => {
    expect(LTR_JS).toContain('data-ltr="preview-toggle"');
    expect(LTR_JS).toContain('aria-controls="ltr-preview"');
    expect(LTR_CSS).toContain('.ltr-body-split { display: grid;');
    expect(LTR_CSS).toContain('@media (max-width: 900px)');
    expect(LTR_CSS).toContain('.ltr-preview-open { display: block; }');
  });

  test('the preview covers every part of the letter the therapist can change', () => {
    ['ltr-doc-letterhead', 'ltr-doc-date', 'ltr-doc-to', 'ltr-doc-subject',
      'ltr-doc-ref', 'ltr-doc-sal', 'ltr-doc-blocks', 'ltr-doc-sign',
      'ltr-doc-cc'].forEach((cls) => {
      expect(LTR_JS).toContain(cls);
      expect(LTR_CSS).toContain('.' + cls);
    });
    // A CC that will not appear is stated as removed, not shown greyed out.
    expect(LTR_JS).toContain('No CC line will appear — the whole line is removed from the letter.');
    // The multiline address becomes one preview line per typed line, matching
    // the w:br the template writes.
    expect(LTR_JS).toContain("m.recipient.address.split(/\\r?\\n/)");
  });

  test('progress is saved as the therapist works, and survives a failure', () => {
    expect(LTR_JS).toContain('patchTimer = setTimeout(flushPatch, 600);');
    expect(LTR_JS).toContain('data-ltr="retry-save"');
    expect(LTR_JS).toContain('pendingPatch = Object.assign({}, body, pendingPatch || {});');
    // Typing repaints the preview only — it never re-renders the field the
    // caret is sitting in.
    expect(LTR_JS).toContain('if (typingNow()) { paintSave(); paintPreview(); return; }');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   IN-APP BROWSER BACK / FORWARD (navigation.js)

   The portal is a single-page app served from one static file. Before this
   module, Back left the site entirely and the user lost their place. These
   guards pin the properties that make the feature safe rather than merely
   working — a regression in any of them is either a trapped user, an
   infinite popstate loop, or a module that hard-fails a page it is loaded on.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('in-app Back/Forward navigation module', () => {
  const NAV_PATH = path.join(__dirname, '..', '..', 'frontend', 'current', 'navigation.js');
  const NAV_JS = fs.readFileSync(NAV_PATH, 'utf8');
  const nav = require('../../frontend/current/navigation.js');

  test('the module exists and exports the pure route helpers for node', () => {
    expect(fs.existsSync(NAV_PATH)).toBe(true);
    for (const fn of ['encodeRoute', 'decodeRoute', 'normaliseRoute', 'routesEqual', 'pushOrReplace']) {
      expect(typeof nav[fn]).toBe('function');
    }
    // Exported BEFORE the DOM is touched, like casenotes.js / supportpop.js.
    const exportIdx = NAV_JS.indexOf('module.exports = helpers');
    const domIdx = NAV_JS.indexOf('var doc = global.document;');
    expect(exportIdx).toBeGreaterThan(0);
    expect(domIdx).toBeGreaterThan(exportIdx);
  });

  test('requiring it in node is a no-op — it never touches a DOM that is not there', () => {
    expect(() => require('../../frontend/current/navigation.js')).not.toThrow();
    expect(NAV_JS).toContain("if (!global || !global.document || !global.history ||");
    expect(NAV_JS).toContain("typeof global.history.pushState !== 'function') return;");
  });

  // ── ANTI-TRAP ─────────────────────────────────────────────────────────────
  test('the user is never trapped on the page', () => {
    // onbeforeunload would let the app veto leaving — never acceptable here.
    expect(NAV_JS).not.toMatch(/onbeforeunload/i);
    expect(NAV_JS).not.toMatch(/beforeunload/i);
    // No sentinel/dummy entry pushed at boot to "absorb" the first Back.
    expect(NAV_JS).not.toMatch(/pushState\([^)]*sentinel/i);
    expect(NAV_JS).not.toMatch(/sentinel|__trap|dummyEntry|absorbBack/i);
    // The classic trap is re-pushing from inside the popstate handler.
    expect(NAV_JS).not.toMatch(/popstate[\s\S]{0,400}?history\.pushState/);
    // history.forward() would fight the user's own Back press.
    expect(NAV_JS).not.toContain('history.forward()');
    // Boot writes with replaceState (adds no entry), never pushState.
    expect(NAV_JS).toContain('never clobber the arrival hash');
    expect(NAV_JS).toContain("if (!prev) return 'replace';");
  });

  test('pushOrReplace adds no entry at boot and no duplicate on re-render', () => {
    expect(nav.pushOrReplace(null, { tab: 'calendar' })).toBe('replace');
    expect(nav.pushOrReplace({ tab: 'calendar' }, { tab: 'calendar' })).toBe('replace');
    expect(nav.pushOrReplace({ tab: 'calendar' }, { tab: 'profile' })).toBe('push');
  });

  // ── ANTI-LOOP ─────────────────────────────────────────────────────────────
  test('re-entrancy and double-fire guards are present', () => {
    expect(NAV_JS).toContain('NAV.restoring++');
    expect(NAV_JS).toContain('NAV.restoring--');
    expect(NAV_JS).toContain('} finally {');
    expect(NAV_JS).toContain('if (NAV.restoring) return;');   // restoration never pushes
    expect(NAV_JS).toContain('NAV.inNav');                    // switchTab's own overlay closes
    expect(NAV_JS).toContain('NAV.lastBackAt');               // back() throttle
    expect(NAV_JS).toContain('NAV.current = baseOf(NAV.current);'); // demote before back()
    // The hashchange net must bail out when it agrees with popstate, or the
    // two listeners feed each other.
    expect(NAV_JS).toContain('if (routesEqual(next, NAV.current)) return;');
  });

  // ── HISTORY API, NOT hashchange-only ──────────────────────────────────────
  test('it uses pushState/replaceState and popstate, not hashchange alone', () => {
    expect(NAV_JS).toContain('hist.pushState(');
    expect(NAV_JS).toContain('hist.replaceState(');
    expect(NAV_JS).toContain("addEventListener('popstate'");
    // hashchange may exist as a secondary net, but popstate must be the primary.
    const popIdx = NAV_JS.indexOf("addEventListener('popstate'");
    const hashIdx = NAV_JS.indexOf("addEventListener('hashchange'");
    expect(popIdx).toBeGreaterThan(0);
    if (hashIdx !== -1) expect(popIdx).toBeLessThan(hashIdx);
  });

  test('routing is hash-based — a refresh can never 404 on a static file', () => {
    expect(NAV_JS).toContain("var out = '#' + s.tab;");
    // No path-style pushState that the server would have to route.
    expect(NAV_JS).not.toMatch(/pushState\([^)]*['"]\/(?!\*)/);
  });

  // ── SELF-INSTALLING, TYPEOF-GUARDED HOOKS ─────────────────────────────────
  test('every global it hooks is typeof-guarded and degrades to a no-op', () => {
    expect(NAV_JS).toContain("function isFn(v) { return typeof v === 'function'; }");
    // Core page globals go through hookGlobalFn, which refuses a non-function.
    expect(NAV_JS).toContain('if (!isFn(orig)) return false;');
    // Module namespaces go through hookMethod, which refuses a missing module.
    expect(NAV_JS).toContain("if (!ns || !isFn(ns[method])) return false;");
    for (const g of ['switchTab', 'setCalendarMode', 'switchCalendarView',
      'openBookingPanel', 'closeBookingPanel', 'openBlockDetail', 'closeBlockDetail']) {
      expect(NAV_JS).toContain("hookGlobalFn('" + g + "'");
    }
    for (const [ns, m] of [['RH2', 'nav'], ['RH2', 'openDetail'],
      ['CaseNotes', 'select'], ['SupportPop', 'open'], ['SupportPop', 'close']]) {
      expect(NAV_JS).toContain("hookMethod('" + ns + "', '" + m + "'");
    }
    // Optional modules are existence-checked before any hook is attempted.
    expect(NAV_JS).toContain('if (global.RH2) {');
    expect(NAV_JS).toContain('if (global.CaseNotes) {');
    expect(NAV_JS).toContain('if (global.SupportPop) {');
    expect(NAV_JS).toContain("if (!global[nsName]) { done = false; return; }");
  });

  test('restoration goes through the app\'s own functions, not raw DOM writes', () => {
    expect(NAV_JS).toContain('if (isFn(global.switchTab)) { try { global.switchTab(t.tab); } catch (e) {} }');
    expect(NAV_JS).toContain('global.setCalendarMode(mode)');
    expect(NAV_JS).toContain('global.RH2.nav(');
    expect(NAV_JS).toContain('global.CaseNotes.select(t.id)');
  });

  // ── RBAC + the existing view guards ───────────────────────────────────────
  test('RBAC is resolved through the app\'s own allow-list, quietly', () => {
    expect(NAV_JS).toContain('global.NAV_ALLOWED_TABS');
    expect(NAV_JS).toContain('global.navAllowedTabs(global.APP_USER.role)');
    expect(NAV_JS).toContain('if (!tabAllowed(target.tab)) {');
    expect(NAV_JS).toContain("target = normaliseRoute({ tab: DEFAULT_TAB });");
    // A denied restore must not scold the user for a hash they did not type.
    expect(NAV_JS).not.toContain('showToast');
  });

  test('a restored calendar view sets __viewManuallySet so late settings cannot stomp it', () => {
    expect(NAV_JS).toContain('global.__viewManuallySet = true;');
  });

  test('no localStorage/sessionStorage is touched — existing state is untouched', () => {
    expect(NAV_JS).not.toContain('localStorage');
    expect(NAV_JS).not.toContain('sessionStorage');
  });

  // ── OVERLAYS AS HISTORY STEPS ─────────────────────────────────────────────
  test('overlays push an entry and consume it again on a normal close', () => {
    expect(NAV_JS).toContain("openOverlay('booking'");
    expect(NAV_JS).toContain("openOverlay('event'");
    expect(NAV_JS).toContain("openOverlay('support'");
    expect(NAV_JS).toContain("openOverlay('modal'");
    expect(NAV_JS).toContain("closeOverlay('booking')");
    expect(NAV_JS).toContain("closeOverlay('event')");
    expect(NAV_JS).toContain('hist.back()');
    // Restoration closes overlays first, then applies the view.
    expect(NAV_JS).toContain('closeOverlays(target);');
    const closeIdx = NAV_JS.indexOf('closeOverlays(target);');
    const applyIdx = NAV_JS.indexOf('applyBase(target);');
    expect(closeIdx).toBeLessThan(applyIdx);
  });

  test('generic .modal-backdrop/.modal overlays are observed per element, not on body', () => {
    expect(NAV_JS).toContain("qa('.modal-backdrop[id], .modal[id]')");
    expect(NAV_JS).not.toMatch(/observe\(\s*doc\.body/);
  });

  // ── WIZARD ESCAPE HATCH ───────────────────────────────────────────────────
  test('an optional pushStep hook is offered rather than hacking wizard internals', () => {
    expect(NAV_JS).toContain('pushStep: function (name, step)');
    expect(NAV_JS).toContain('global.OpalNav = {');
  });

  test('the route grammar covers every navigable surface', () => {
    expect(nav.encodeRoute(nav.decodeRoute('#calendar/scheduler'))).toBe('#calendar/scheduler');
    expect(nav.encodeRoute(nav.decodeRoute('#resources/detail/r1'))).toBe('#resources/detail/r1');
    expect(nav.encodeRoute(nav.decodeRoute('#casenotes/d1'))).toBe('#casenotes/d1');
    expect(nav.encodeRoute(nav.decodeRoute('#fca/step-2'))).toBe('#fca/step-2');
    expect(nav.encodeRoute(nav.decodeRoute('#letter/step-3'))).toBe('#letter/step-3');
    // Garbage is safe.
    expect(nav.encodeRoute(nav.decodeRoute('#wibble'))).toBe('#calendar');
  });
});

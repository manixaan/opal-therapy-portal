/* ═══════════════════════════════════════════════════════════════════════════
   DAILY & WEEKLY SNAPSHOT — portal module

   Lifted out of mockup_v3.html unchanged (2026-08-23). This is the whole
   reporting domain behind the header's snapshot icon — about 1,340 lines —
   moved without a change to what any of it does.

   WHAT IS HERE
     Panel shell     openReportPanel / closeReportPanel / switchReportMode /
                     reportNavDate / renderReportPanel / rptOpenDay, the
                     Escape handler, and the _report* panel state
     Targets         RPT_BILLABLE_TYPES and the RPT_*_TARGET_H defaults that
                     Settings → Reports overrides through window.*
     Data helpers    the _rpt* layer — date/day keys, session classification,
                     metrics, travel, idle gaps, missing locations, formatting
     Today's work    the Snapshot Day V2 unified reminder/task list (snap*,
                     sw*, and their __snap / __sw state) rendered in the daily panel.
                     It has no other entry point: the report panel is the only
                     surface that loads it, so it belongs to this domain and
                     travels with it.
     Renderers       buildDailyReportHTML / buildWeeklyReportHTML and the
                     _rptDailyRecs / _rptDailyAttn / _rptWeeklyRecs /
                     _rptWeeklyAttn / _rptCard / _rptEmpty helpers

   NOT A MODULE PATTERN, DELIBERATELY
   No IIFE and no namespace object. Every function below is called by name
   from an onclick= attribute in the shell's markup, from the shell's inline
   script, or from HTML this file itself builds, so all of it stays global
   exactly as it was. Nothing is renamed, nothing is wrapped, and the file is
   not strict-mode — because the inline script it came from is not either, and
   'use strict' would be a behaviour change wearing a tidy-up's clothes.

   The top-level `var`s matter for the same reason. applyUserSettings() in the
   shell writes window.RPT_DAILY_TARGET_H / window.RPT_WEEKLY_TARGET_H and
   reads window._reportOpen; a classic script's top-level `var` is that same
   window property, so the two halves keep talking exactly as before.

   LOAD ORDER
   Loaded with defer, so it executes after every inline <script> in the shell
   has parsed and before DOMContentLoaded — the same position it held as the
   last-but-one inline block. It reaches the shell's globals at call time:
   escapeHtml(), showToast(), opIcon(), switchTab(), gotoToday(), mapsLink(),
   fmtMin(), computeDayTravelSegments(), __perthParts()/__perthDateStr(),
   window.DAY_DATES, window.__outlookEventsCache, window.APP_SETTINGS,
   window.APP_USER and window.OpalUndo. The shell's only parse-time touch of
   this domain is _applySettingsAtBoot() → applyUserSettings(), which reads
   window._reportOpen behind a `typeof … !== 'undefined'` guard and finds it
   undefined — exactly as it did when this block sat further down the file.

   WHAT STAYED IN THE SHELL
   The #report-overlay / #report-modal markup and every #report-*, .rpt-* and
   .sw-* style rule. Moving those needs a templating step this repository does
   not have, and moving the CSS would change cascade order for no gain; the
   point of the move was the logic.
   ═══════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════
//  TASK #117 — DAILY & WEEKLY SNAPSHOT REPORT
// ═══════════════════════════════════════════════════════════════

var _reportOpen  = false;
var _reportMode  = 'daily';   // 'daily' | 'weekly'
var _reportDate  = null;      // Date object

var RPT_BILLABLE_TYPES   = new Set(['therapy','initial','assessment','mdt','report']);
var RPT_DAILY_TARGET_H   = 5.0;   // default hours/day  (overridden by settings when available)
var RPT_WEEKLY_TARGET_H  = 25.0;  // default hours/week

// ── Open / close ─────────────────────────────────────────────

/* The panel zooms out of whatever opened it and shrinks back into it on
   close, so it is obvious where it came from. `source` is the element that
   triggered it; anything without one (auto-open on sign-in, the help panel)
   anchors to the header calendar icon, which is the panel's home. */
function reportPanelAnchorTo(source) {
  var modal = document.getElementById('report-modal');
  var el = (source && source.getBoundingClientRect) ? source
         : document.querySelector('[data-help="header-report"]');
  if (!el) { modal.style.removeProperty('--rpt-ox'); modal.style.removeProperty('--rpt-oy'); return null; }
  var r = el.getBoundingClientRect();
  // At rest the modal is centred (translate(-50%,-50%)), so its untransformed
  // box sits at these coordinates regardless of the scale mid-transition.
  var left = window.innerWidth / 2 - modal.offsetWidth / 2;
  var top  = window.innerHeight / 2 - modal.offsetHeight / 2;
  modal.style.setProperty('--rpt-ox', Math.round(r.left + r.width / 2 - left) + 'px');
  modal.style.setProperty('--rpt-oy', Math.round(r.top + r.height / 2 - top) + 'px');
  return el;
}

var _reportAnchorEl = null;
var _reportGenieAnim = null;

/* Genie-style motion (like a window minimising to the Dock): the panel is
   pulled into a tall thin stream that flows into the anchor, sheared toward
   it, rather than shrinking evenly. Built with the Web Animations API so the
   shear direction can follow wherever the anchor is. `dir` is 'in' (opening)
   or 'out' (closing). Returns the Animation, or null when unsupported. */
function reportPanelGenie(modal, dir) {
  if (!modal.animate) return null;
  if (_reportGenieAnim) { try { _reportGenieAnim.cancel(); } catch (_) {} }
  var ox = parseFloat(modal.style.getPropertyValue('--rpt-ox')) || modal.offsetWidth / 2;
  var oy = parseFloat(modal.style.getPropertyValue('--rpt-oy')) || modal.offsetHeight / 2;
  // Shear toward the anchor: it sits right of centre → lean the stream right;
  // above → the funnel narrows at the top.
  var sx = (ox - modal.offsetWidth / 2) / modal.offsetWidth;   // -0.5..0.5
  var sy = (oy - modal.offsetHeight / 2) / modal.offsetHeight;
  var skX = Math.round(-sx * 28);  // deg
  var skY = Math.round(-sy * 10);
  var T = 'translate(-50%,-50%) ';
  var frames = [
    { transform: T + 'scale(0.02, 0.10) skew(' + (skX * 1.4) + 'deg,' + (skY * 1.4) + 'deg)', opacity: 0, offset: 0 },
    { transform: T + 'scale(0.06, 0.55) skew(' + (skX * 1.2) + 'deg,' + (skY * 1.2) + 'deg)', opacity: 1, offset: 0.22 },
    { transform: T + 'scale(0.22, 1.10) skew(' + skX + 'deg,' + skY + 'deg)', opacity: 1, offset: 0.5 },
    { transform: T + 'scale(0.85, 1.03) skew(' + Math.round(skX * 0.3) + 'deg,' + Math.round(skY * 0.3) + 'deg)', opacity: 1, offset: 0.8 },
    { transform: T + 'scale(1, 1) skew(0deg,0deg)', opacity: 1, offset: 1 }
  ];
  if (dir === 'out') frames = frames.slice().reverse().map(function (f) { return { transform: f.transform, opacity: f.opacity, offset: 1 - f.offset }; });
  modal.classList.add('genie');
  var a = modal.animate(frames, { duration: dir === 'out' ? 520 : 560, easing: dir === 'out' ? 'cubic-bezier(0.55,0,0.75,0.2)' : 'cubic-bezier(0.2,0.8,0.25,1)', fill: 'forwards' });
  _reportGenieAnim = a;
  a.onfinish = a.oncancel = function () { modal.classList.remove('genie'); if (_reportGenieAnim === a) { _reportGenieAnim = null; } try { a.cancel(); } catch (_) {} };
  return a;
}
function reportPanelPulseAnchor(el) {
  if (!el) return;
  el.classList.remove('rpt-anchor-pulse');
  void el.offsetWidth; // restart the animation if it is still running
  el.classList.add('rpt-anchor-pulse');
  setTimeout(function () { el.classList.remove('rpt-anchor-pulse'); }, 750);
}

function openReportPanel(mode, source) {
  if (typeof snapLoad === 'function') snapLoad().then(function () { try { renderReportPanel(); } catch (_) {} });
  _reportMode = mode || 'daily';
  if (!_reportDate) _reportDate = new Date();
  _reportOpen = true;
  renderReportPanel();
  _reportAnchorEl = reportPanelAnchorTo(source);
  reportPanelPulseAnchor(_reportAnchorEl);
  var modal = document.getElementById('report-modal');
  document.getElementById('report-overlay').classList.add('open');
  modal.classList.add('open');
  reportPanelGenie(modal, 'in');
}

/* Auto-open on sign-in: owners, admins and therapists see the Today
   snapshot once per browser session as a reminder of the day ahead.
   Waits for the calendar's event cache so the panel is not empty on first
   paint, skips read-only accounts, honours the org "Daily & Weekly Reports"
   flag, and never re-opens on a plain reload within the same session. */
function autoOpenDailySnapshot() {
  var u = window.APP_USER;
  if (!u || ['owner', 'admin', 'therapist'].indexOf(u.role) === -1) return;
  var ff = ((window.APP_ORG_SETTINGS || {}).featureFlags) || {};
  if (ff.dailyWeeklyReports === false) return;
  var key = 'snapshot_auto_shown:' + u.id;
  try {
    // A fresh sign-in (flag set by login.html) always shows it; otherwise
    // only once per browser session, so reloads stay quiet.
    var fresh = sessionStorage.getItem('snapshot_just_signed_in');
    sessionStorage.removeItem('snapshot_just_signed_in');
    if (!fresh && sessionStorage.getItem(key)) return;
  } catch (_) { return; }
  // Give the calendar cache a brief chance to fill so the first paint is
  // not empty, but never hold the panel back: it must be up within ~3s of
  // landing. openReportPanel re-renders once the day's data has loaded.
  (function whenEventsReady(attempt) {
    var loaded = (window.__outlookEventsCache || []).length > 0;
    if (!loaded && attempt < 6) { setTimeout(function () { whenEventsReady(attempt + 1); }, 250); return; }
    if (_reportOpen) return;
    try { sessionStorage.setItem(key, '1'); } catch (_) {}
    _reportDate = new Date();
    openReportPanel('daily');
  })(0);
}

function closeReportPanel() {
  _reportOpen = false;
  var overlay = document.getElementById('report-overlay');
  var modal = document.getElementById('report-modal');
  // Fade the overlay while the panel shrinks back to its anchor; the
  // overlay stays in the DOM until the transition has finished.
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  var anchor = _reportAnchorEl;
  var anim = reportPanelGenie(modal, 'out');
  var done = function () {
    if (_reportOpen) return; // reopened mid-flight
    modal.classList.remove('open');
    overlay.classList.remove('closing');
    reportPanelPulseAnchor(anchor); // the panel has landed — flash where it went
  };
  if (anim) { anim.addEventListener('finish', done); } else { modal.classList.remove('open'); done(); }
}

function switchReportMode(mode) {
  _reportMode = mode;
  renderReportPanel();
}

function reportNavDate(delta) {
  if (!_reportDate) _reportDate = new Date();
  var d = new Date(_reportDate);
  if (_reportMode === 'daily') {
    d.setDate(d.getDate() + delta);
  } else {
    d.setDate(d.getDate() + delta * 7);
  }
  _reportDate = d;
  renderReportPanel();
}

function renderReportPanel() {
  var role = (window.APP_USER && window.APP_USER.role) || 'therapist';
  var content = document.getElementById('report-content');
  if (!content) return;
  content.innerHTML = _reportMode === 'daily'
    ? buildDailyReportHTML(_reportDate || new Date(), role)
    : buildWeeklyReportHTML(_reportDate || new Date(), role);
  _rptUpdateHeader();
}

function _rptUpdateHeader() {
  var el = document.getElementById('report-date-label');
  if (!el || !_reportDate) return;
  var d = _reportDate;
  if (_reportMode === 'daily') {
    el.textContent = d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  } else {
    var day  = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    var mon  = new Date(d); mon.setDate(d.getDate() + diff);
    var sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    el.textContent = mon.toLocaleDateString('en-AU', { day:'numeric', month:'short' })
      + ' – ' + sun.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
  }
  document.querySelectorAll('.report-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.mode === _reportMode);
  });
}

// ── Data helpers ─────────────────────────────────────────────

function _rptDateKey(date) {
  var d = (date instanceof Date) ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

function _rptDayKey(dateStr) {
  if (!window.DAY_DATES) return null;
  var found = null;
  Object.keys(window.DAY_DATES).forEach(function(k) {
    if (window.DAY_DATES[k] === dateStr) found = k;
  });
  return found;
}

// Classify an Outlook event into a report type based on its categories array.
function _rptClassifyType(cats, eventType) {
  var lc = (cats || []).map(function(c) { return (c || '').toLowerCase(); });
  if (lc.some(function(c) { return c === 'travel'; }))                               return 'travel';
  if (lc.some(function(c) { return c.includes('client') || c.includes('appoint'); })) return 'therapy';
  if (lc.some(function(c) { return c.includes('report'); }))                          return 'report';
  if (lc.some(function(c) { return c.includes('case') || c.includes('admin'); }))     return 'admin';
  if (lc.some(function(c) { return c.includes('cpd') || c.includes(' pd'); }))        return 'cpd';
  if (lc.some(function(c) { return c.includes('meeting') || c.includes('mdt'); }))    return 'mdt';
  if (lc.some(function(c) { return c.includes('leave') || c.includes('sick') || c.includes('annual'); })) return 'leave';
  return eventType || 'outlook';
}

// Return sessions for a given date string (YYYY-MM-DD, Perth time).
// Reads directly from __outlookEventsCache (all synced events regardless of
// which week is displayed in the calendar), then adds any SESSIONS entries
// that are not yet in the cache. This fixes the "no appointments" bug that
// occurred when the snapshot date was not the currently displayed week.
function _rptSessionsForDate(dateStr) {
  var events = [];
  var seen   = new Set();

  // Primary: live event cache — all events from /api/events
  (window.__outlookEventsCache || []).forEach(function(e) {
    if (!e || !e.start_time || e.is_deleted) return;
    // Use Perth-aware date comparison
    var eDateStr = (typeof __perthDateStr === 'function')
      ? __perthDateStr(new Date(e.start_time))
      : e.start_time.slice(0, 10);
    if (eDateStr !== dateStr) return;
    if (seen.has(e.id)) return;
    seen.add(e.id);
    var startD = new Date(e.start_time);
    var endD   = new Date(e.end_time || e.start_time);
    var sp = (typeof __perthParts === 'function') ? __perthParts(startD) : { hour: String(startD.getHours()), minute: String(startD.getMinutes()) };
    var ep = (typeof __perthParts === 'function') ? __perthParts(endD)   : { hour: String(endD.getHours()),   minute: String(endD.getMinutes()) };
    var cats = Array.isArray(e.categories) ? e.categories : [];
    events.push({
      id:           e.id,
      title:        e.title || '(No title)',
      type:         _rptClassifyType(cats, e.event_type),
      startH:       parseInt(sp.hour, 10),
      startM:       parseInt(sp.minute, 10),
      endH:         parseInt(ep.hour, 10),
      endM:         parseInt(ep.minute, 10),
      patient:      e.patient_name || null,
      location:     e.location || e.address || null,
      address:      e.address  || e.location || null,
      suburb:       null,
      categories:   cats,
      cancelled:    false,
      source:       e.source || 'outlook',
      dbId:         e.id,
      outlookSynced: true,
    });
  });

  // Secondary: SESSIONS registry — app-created events not yet synced to cache
  var dayKey = _rptDayKey(dateStr);
  if (dayKey) {
    Object.values(window.SESSIONS || {}).forEach(function(s) {
      if (!s || s.day !== dayKey || s.cancelled || s.outlookSynced) return;
      if (seen.has(s.id)) return;
      seen.add(s.id);
      events.push(s);
    });
  }

  events.sort(function(a, b) {
    return (a.startH * 60 + (a.startM || 0)) - (b.startH * 60 + (b.startM || 0));
  });

  console.debug('[Snapshot] ' + dateStr + ': ' + events.length + ' events' +
    ' (cache=' + (window.__outlookEventsCache ? window.__outlookEventsCache.length : 0) +
    ' total, dayKey=' + (dayKey || 'none') + ')');
  return events;
}

function _rptMetrics(sessions) {
  var billableMin = 0, nonBillableMin = 0, totalMin = 0;
  var clients = new Set(), appts = 0;
  sessions.forEach(function(s) {
    if (s.type === 'travel' || s.type === 'leave') return;
    var dur = ((s.endH || s.startH) - s.startH) * 60 + ((s.endM || 0) - (s.startM || 0));
    if (dur <= 0) dur = 60;
    totalMin += dur;
    appts++;
    if (RPT_BILLABLE_TYPES.has(s.type)) {
      billableMin += dur;
      if (s.patient) clients.add(s.patient);
      else if (s.title) clients.add(s.title);
    } else {
      nonBillableMin += dur;
    }
  });
  return { billableMin: billableMin, nonBillableMin: nonBillableMin, totalMin: totalMin,
           appts: appts, uniqueClients: clients.size };
}

function _rptTravel(dayKey) {
  if (!dayKey || typeof computeDayTravelSegments !== 'function') return { travelMin: 0, legs: [] };
  var segs = computeDayTravelSegments(dayKey);
  var travelMin = 0, legs = [];
  segs.forEach(function(seg) {
    if (seg.kind !== 'gap') { travelMin += (seg.travelMin || 0); legs.push(seg); }
  });
  return { travelMin: travelMin, legs: legs };
}

function _rptGaps(dayKey) {
  if (!dayKey || typeof computeDayTravelSegments !== 'function') return [];
  return computeDayTravelSegments(dayKey).filter(function(seg) { return seg.kind === 'gap'; });
}

function _rptMissingLocs(sessions) {
  return sessions.filter(function(s) {
    return s.type !== 'travel' && s.type !== 'leave' && !s.location && !s.address && !s.suburb;
  });
}

function _rptFmtH(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? h + 'h' : h + 'h ' + m + 'm';
}

function _rptFmtTime(h, m) {
  if ((window.APP_SETTINGS || {}).timeFormat === '24') {
    return String(h).padStart(2,'0') + ':' + String(m || 0).padStart(2,'0');
  }
  var ap = h < 12 ? 'am' : 'pm';
  return (h % 12 || 12) + ':' + String(m || 0).padStart(2, '0') + ap;
}

function _rptWeekStart(date) {
  var d = new Date(date), day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

// ── Daily report ─────────────────────────────────────────────

/* ── Snapshot Day V2 (2026-08-09): ONE unified To-Do-style list over the
   /api/snapshot backend, rendered inside the daily panel. Reminders and
   tasks present as a single list — a reminder is simply a row whose due
   time shows on the right. Presentation is unified; architecture is not:
   every row keeps its origin (kind 'reminder' | 'task') and calls the
   matching endpoints. Personal scope only (backend enforces user_id). */
var __snapReminders = [], __snapTasks = [];
// ── UI state (frontend-only; empty composers never hit the API) ──
var __swFocus = null;         // truthy → refocus the composer after re-render
var __swVal = '';             // composer text survives re-renders/failures
var __swErr = null;           // composer save error (typed text is never discarded)
var __swEditingKey = null;    // 'kind:id' of the row in inline title edit
var __swSelectedKey = null;   // 'kind:id' of the selected row (reveals quick actions)
var __swPop = null;           // open popover: { key, type: 'menu' | 'remind' | 'date' }
var __swPendingDone = {};     // 'kind:id' → timer for the ~800ms completion animation

async function snapLoad() {
  try {
    const [r, t] = await Promise.all([
      fetch('/api/snapshot/reminders', { credentials: 'include' }).then(x => x.ok ? x.json() : { reminders: [] }),
      fetch('/api/snapshot/tasks', { credentials: 'include' }).then(x => x.ok ? x.json() : { tasks: [] }),
    ]);
    __snapReminders = r.reminders || [];
    __snapTasks = t.tasks || [];
  } catch (_) { __snapReminders = []; __snapTasks = []; }
}

// Surgical re-render: only the Today's-work section, then restore focus so
// composing feels continuous (a full panel re-render would eat the caret).
function snapRenderWork() {
  var host = document.getElementById('snap-work');
  if (!host) { if (typeof renderReportPanel === 'function') renderReportPanel(); return; }
  var tmp = document.createElement('div');
  tmp.innerHTML = buildSnapshotWorkHTML();
  host.replaceWith(tmp.firstElementChild);
  snapAfterRender();
}
function snapAfterRender() {
  if (__swEditingKey) {
    var ed = document.getElementById('sw-edit-' + __swEditingKey.replace(':', '-'));
    if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
    return;
  }
  if (__swFocus) {
    var inp = document.getElementById('sw-composer-input');
    if (inp) { inp.value = __swVal || ''; inp.focus(); }
  }
}
function snapRefresh() { snapLoad().then(snapRenderWork); }

// ── Unified row model (presentation only — origin preserved) ─────
function swKey(kind, id) { return kind + ':' + id; }
function swFind(kind, id) {
  var list = kind === 'task' ? __snapTasks : __snapReminders;
  return list.find(function (x) { return x.id === id; });
}
// Date-only due dates (Today / Tomorrow / Pick a date…) are stored as the
// end-of-day sentinel 23:59 so they rank after timed rows and never read
// as overdue mid-day; timed reminders keep their real times.
function swIsDateOnly(d) { return d.getHours() === 23 && d.getMinutes() === 59; }
function swModel() {
  var todayKey = new Date().toDateString();
  var items = [];
  __snapReminders.forEach(function (r) {
    if (r.state === 'dismissed') return; // dismiss lives on the notification surface, not here
    if (r.state === 'completed' && new Date(r.due_at).toDateString() !== todayKey) return;
    items.push({ kind: 'reminder', id: r.id, title: r.title, when: r.due_at || null,
                 done: r.state === 'completed', saving: !!r._saving, raw: r });
  });
  __snapTasks.forEach(function (t) {
    items.push({ kind: 'task', id: t.id, title: t.title, when: t.due_time || null,
                 done: !!t.completed, saving: !!t._saving, raw: t });
  });
  var active = items.filter(function (it) { return !it.done; });
  var done = items.filter(function (it) { return it.done; });
  active.sort(swCompare); // stable sort: ties keep API order; renders only on discrete actions
  done.sort(function (a, b) {
    return new Date(b.raw.completed_at || 0) - new Date(a.raw.completed_at || 0);
  });
  return { active: active, done: done };
}
// Sort: overdue first, then due-today by time, then today-without-time
// (date-only sentinel), then dated later, then undated.
function swGroupOf(it) {
  if (!it.when) return 4;
  var d = new Date(it.when), now = new Date();
  if (d < now) return 0;
  if (d.toDateString() === now.toDateString()) return swIsDateOnly(d) ? 2 : 1;
  return 3;
}
function swCompare(a, b) {
  var ga = swGroupOf(a), gb = swGroupOf(b);
  if (ga !== gb) return ga - gb;
  if (ga === 4) return 0; // undated: keep the API's sort_order
  return new Date(a.when) - new Date(b.when);
}
// Right-side label: time-only if today, 'Tomorrow', else 'D Mmm';
// overdue ('Yesterday' / an earlier time / a past date) in muted terracotta.
function swWhenLabel(it) {
  if (!it.when) return null;
  var d = new Date(it.when), now = new Date();
  var startOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
  var dayDiff = Math.round((startOf(d) - startOf(now)) / 86400000);
  var dateOnly = swIsDateOnly(d);
  var overdue = !it.done && d < now;
  var text;
  if (dayDiff === 0) text = dateOnly ? 'Today' : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  else if (dayDiff === 1) text = 'Tomorrow';
  else if (dayDiff === -1) text = 'Yesterday';
  else text = d.getDate() + ' ' + d.toLocaleDateString('en-AU', { month: 'short' });
  return { text: text, overdue: overdue };
}
function swAbsorb(kind, row) {
  if (!row) return;
  var list = kind === 'task' ? __snapTasks : __snapReminders;
  var i = list.findIndex(function (x) { return x.id === row.id; });
  if (i >= 0) list[i] = row;
}

// ── Composer: the permanent last active row; Enter creates, never on empty ──
function swFocusComposer() {
  __swFocus = true;
  var inp = document.getElementById('sw-composer-input');
  if (inp) { inp.scrollIntoView({ block: 'nearest' }); inp.focus(); }
}
function swComposerKey(ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    var text = ev.target.value.trim();
    if (!text) { ev.target.blur(); __swFocus = null; return; }
    swCreateTask(text);
  } else if (ev.key === 'Escape') {
    ev.target.value = ''; __swVal = ''; __swErr = null;
    ev.target.blur(); __swFocus = null; snapRenderWork();
  }
}
async function swCreateTask(title) {
  var tempId = 'tmp-' + Date.now();
  __snapTasks.push({ id: tempId, title: title, completed: false, _saving: true });
  __swVal = ''; __swErr = null; __swFocus = true;
  snapRenderWork(); // fresh empty composer, immediately refocused
  try {
    var r = await fetch('/api/snapshot/tasks', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) });
    if (!r.ok) throw new Error('save failed');
    var j = await r.json();
    var i = __snapTasks.findIndex(t => t.id === tempId);
    if (i >= 0) __snapTasks[i] = j.task;
    // Cmd+Z undo: the inverse of composer-create is the existing DELETE.
    if (j.task && j.task.id && window.OpalUndo) {
      (function (createdId) {
        OpalUndo.register({ label: 'Task created', undo: async function () {
          var dr = await fetch('/api/snapshot/tasks/' + createdId, { method: 'DELETE', credentials: 'include' });
          if (!dr.ok) throw new Error('delete failed');
          __snapTasks = __snapTasks.filter(function (t) { return t.id !== createdId; });
          snapRenderWork();
        } });
      })(j.task.id);
    }
  } catch (_) {
    __snapTasks = __snapTasks.filter(t => t.id !== tempId);
    __swVal = title; __swErr = 'Could not save — press Enter to retry.';
  }
  snapRenderWork();
}

// ── Selection: click a row → quick actions; click the selected title → edit ──
function swRowClick(ev, kind, id) {
  if (ev.target.closest('.sw-circle, .sw-actions, .sw-pop, input')) return;
  var key = swKey(kind, id);
  if (__swSelectedKey === key) return;
  __swSelectedKey = key; __swPop = null;
  snapRenderWork();
}
function swTitleClick(ev, kind, id) {
  ev.stopPropagation();
  var key = swKey(kind, id);
  if (__swSelectedKey === key) { swEditStart(kind, id); return; }
  __swSelectedKey = key; __swPop = null;
  snapRenderWork();
}
// One document-level binding: outside click / Escape closes popovers and
// clears the selection (never while an inline edit is in progress).
(function () {
  if (window.__swDocBound) return; window.__swDocBound = true;
  document.addEventListener('click', function (ev) {
    if (!__swSelectedKey && !__swPop) return;
    if (ev.target.closest && (ev.target.closest('.sw-row') || ev.target.closest('.sw-pop'))) return;
    __swSelectedKey = null; __swPop = null; snapRenderWork();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && (__swSelectedKey || __swPop) && !__swEditingKey) {
      __swSelectedKey = null; __swPop = null; snapRenderWork();
    }
  });
})();

// ── Completion circle: fill + strike, then the row moves after ~800ms.
// A second click during the animation cancels it (easy accidental-click
// reversal); clicking a completed row's check reopens it.
function swCircle(kind, id) {
  if (String(id).indexOf('tmp-') === 0) return;
  var it = swFind(kind, id); if (!it) return;
  var key = swKey(kind, id);
  if (__swPendingDone[key]) {
    clearTimeout(__swPendingDone[key]); delete __swPendingDone[key];
    snapRenderWork(); return;
  }
  var isDone = kind === 'task' ? !!it.completed : it.state === 'completed';
  if (isDone) { swSetDone(kind, id, false); return; }
  var row = document.getElementById('sw-row-' + kind + '-' + id);
  if (row) {
    row.classList.add('sw-done-anim');
    var btn = row.querySelector('.sw-circle');
    if (btn) { btn.innerHTML = swCircleSvg(true); btn.setAttribute('aria-label', 'Reopen'); }
  }
  __swPendingDone[key] = setTimeout(function () {
    delete __swPendingDone[key];
    swSetDone(kind, id, true);
  }, 800);
}
// skipUndo: internal callers (restore, and Cmd+Z itself) must not push fresh
// undo entries — only a user-initiated completion registers one.
// Returns true on saved, false on failure (additive — for the undo wiring).
async function swSetDone(kind, id, done, skipUndo) {
  var it = swFind(kind, id); if (!it) return false;
  var revert;
  if (kind === 'task') { revert = it.completed; it.completed = done; }
  else { revert = it.state; it.state = done ? 'completed' : 'upcoming'; }
  it.completed_at = done ? new Date().toISOString() : null;
  snapRenderWork();
  try {
    var r = await fetch('/api/snapshot/' + (kind === 'task' ? 'tasks/' : 'reminders/') + id +
      '/' + (done ? 'complete' : 'reopen'), { method: 'POST', credentials: 'include' });
    if (!r.ok) throw new Error();
    var j = await r.json();
    swAbsorb(kind, j.task || j.reminder);
    snapRenderWork();
    // Cmd+Z undo for completing a task: the inverse is the existing reopen.
    if (!skipUndo && kind === 'task' && done && window.OpalUndo) {
      OpalUndo.register({ label: 'Task completed', undo: async function () {
        if (await swSetDone('task', id, false, true) === false) throw new Error('reopen failed');
      } });
    }
    return true;
  } catch (_) {
    if (kind === 'task') it.completed = revert; else it.state = revert;
    snapRenderWork();
    return false;
  }
}

// ── Inline title editing (Enter/blur saves, Escape restores) ─────
function swEditStart(kind, id) {
  if (String(id).indexOf('tmp-') === 0) return;
  var it = swFind(kind, id); if (!it) return;
  // Completed rows are not editable (the backend freezes completed reminders).
  if (kind === 'task' ? it.completed : it.state !== 'upcoming') return;
  __swEditingKey = swKey(kind, id); __swPop = null;
  snapRenderWork();
}
function swEditKey(ev, kind, id) {
  if (ev.key === 'Enter') { ev.preventDefault(); swEditCommit(kind, id, ev.target.value); }
  else if (ev.key === 'Escape') { __swEditingKey = null; snapRenderWork(); }
}
async function swEditCommit(kind, id, value) {
  if (__swEditingKey !== swKey(kind, id)) return; // Escape or a second commit already handled it
  __swEditingKey = null;
  var it = swFind(kind, id);
  var title = (value || '').trim();
  if (!it || !title || title === it.title) { snapRenderWork(); return; }
  var prev = it.title; it.title = title;
  snapRenderWork();
  try {
    var r = await fetch('/api/snapshot/' + (kind === 'task' ? 'tasks/' : 'reminders/') + id, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) });
    if (!r.ok) throw new Error();
  } catch (_) {
    it.title = prev; snapRenderWork();
    if (typeof showToast === 'function') showToast('Edit not saved — check your connection and try again.', true);
  }
}

// ── Quick actions: Today / Remind / ••• (due dates + reminders) ──
function swPopToggle(ev, kind, id, type) {
  ev.stopPropagation();
  var key = swKey(kind, id);
  __swPop = (__swPop && __swPop.key === key && __swPop.type === type) ? null : { key: key, type: type };
  __swSelectedKey = key;
  snapRenderWork();
}
function swEod(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  d.setHours(23, 59, 0, 0);
  return d;
}
function swSetWhenPreset(kind, id, preset) {
  var d;
  if (preset === 'today') d = swEod(0);
  else if (preset === 'tomorrow') d = swEod(1);
  else { // 'week' — the coming Friday (from the weekend: next week's Friday)
    d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    d.setHours(23, 59, 0, 0);
  }
  swSetWhen(kind, id, d);
}
function swRemindPreset(kind, id, preset) {
  var d = new Date();
  if (preset === 'later') { d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 3); }
  else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); } // tomorrow morning
  swSetWhen(kind, id, d);
}
function swRemindCustom(kind, id, hhmm) {
  if (!hhmm) return;
  var hm = hhmm.split(':').map(Number);
  var d = new Date(); d.setHours(hm[0] || 0, hm[1] || 0, 0, 0);
  if (d < new Date()) d.setDate(d.getDate() + 1); // that time has passed → tomorrow
  swSetWhen(kind, id, d);
}
function swDatePicked(kind, id, val) {
  if (!val) return;
  var p = val.split('-').map(Number);
  swSetWhen(kind, id, new Date(p[0], p[1] - 1, p[2], 23, 59, 0, 0));
}
async function swSetWhen(kind, id, dateObj) {
  var it = swFind(kind, id);
  if (!it || String(id).indexOf('tmp-') === 0) return;
  __swPop = null;
  var iso = dateObj.toISOString();
  var field = kind === 'task' ? 'due_time' : 'due_at';
  var prev = it[field]; it[field] = iso;
  snapRenderWork();
  try {
    var r = await fetch('/api/snapshot/' + (kind === 'task' ? 'tasks/' : 'reminders/') + id, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'task' ? { dueTime: iso } : { dueAt: iso }) });
    if (!r.ok) throw new Error();
    var j = await r.json();
    swAbsorb(kind, j.task || j.reminder);
    snapRenderWork();
  } catch (_) {
    it[field] = prev; snapRenderWork();
    if (typeof showToast === 'function') showToast('Change not saved — try again.', true);
  }
}

// ── Delete: optimistic removal + toast undo. The backend DELETE is a
// hard delete (snapshot-routes.js), so Undo re-creates the row with the
// same fields; the restored row simply gets a fresh id from the server.
async function swDelete(kind, id) {
  __swPop = null; __swSelectedKey = null;
  var list = kind === 'task' ? __snapTasks : __snapReminders;
  var idx = list.findIndex(function (x) { return x.id === id; });
  if (idx < 0) return;
  var removed = list.splice(idx, 1)[0];
  snapRenderWork();
  try {
    var r = await fetch('/api/snapshot/' + (kind === 'task' ? 'tasks/' : 'reminders/') + id,
      { method: 'DELETE', credentials: 'include' });
    if (!r.ok) throw new Error();
    // The same restore serves both undo surfaces: the toast button and Cmd+Z.
    // Whichever runs first unregisters the Cmd+Z entry so it can't run twice.
    var undoLabel = (kind === 'task' ? 'Task' : 'Reminder') + ' deleted';
    var undoEntry = window.OpalUndo ? OpalUndo.register({ label: undoLabel, undo: async function () {
      if (await swRestore(kind, removed) === false) throw new Error('restore failed');
    } }) : null;
    swUndoToast(undoLabel, function () {
      if (undoEntry && window.OpalUndo) OpalUndo.unregister(undoEntry);
      swRestore(kind, removed);
    });
  } catch (_) {
    list.splice(Math.min(idx, list.length), 0, removed);
    snapRenderWork();
    if (typeof showToast === 'function') showToast('Delete failed — try again.', true);
  }
}
// Returns true on success, false on failure (additive — for the undo wiring).
async function swRestore(kind, row) {
  var body = kind === 'task'
    ? { title: row.title, note: row.note || undefined, dueTime: row.due_time || undefined }
    : { title: row.title, dueAt: row.due_at, note: row.note || undefined, priority: row.priority || undefined };
  try {
    var r = await fetch('/api/snapshot/' + (kind === 'task' ? 'tasks' : 'reminders'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error();
    var j = await r.json();
    var restored = j.task || j.reminder;
    (kind === 'task' ? __snapTasks : __snapReminders).push(restored);
    snapRenderWork();
    var wasDone = kind === 'task' ? !!row.completed : row.state === 'completed';
    if (wasDone) swSetDone(kind, restored.id, true, true); // deleted-while-completed stays completed (no fresh undo entry)
    return true;
  } catch (_) {
    if (typeof showToast === 'function') showToast('Could not restore — try again.', true);
    return false;
  }
}
// Undo toast — follows the live showToast pattern (the second, admin-toast
// definition is the one that wins at runtime; it renders plain text only,
// so the undo variant carries its own action button).
function swUndoToast(msg, onUndo) {
  var t = document.getElementById('sw-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'sw-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#241f1a;color:#fff;padding:10px 14px 10px 20px;border-radius:10px;font-size:13.5px;font-weight:500;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:opacity 0.3s;display:flex;align-items:center;gap:14px;';
    document.body.appendChild(t);
  }
  t.innerHTML = '';
  var span = document.createElement('span'); span.textContent = msg;
  var btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = 'Undo';
  btn.style.cssText = 'border:none;background:none;color:#7fd4c6;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;padding:2px 4px;';
  btn.onclick = function () { t.style.opacity = '0'; clearTimeout(t._timer); onUndo(); };
  t.appendChild(span); t.appendChild(btn);
  t.style.opacity = '1'; t.style.pointerEvents = 'auto';
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.style.opacity = '0'; t.style.pointerEvents = 'none'; }, 6000);
}

// ── Completed section: collapsed state persists per browser ──────
function swCompletedCollapsed() {
  try { return localStorage.getItem('sw_completed_collapsed') !== '0'; } catch (_) { return true; }
}
function swToggleCompleted() {
  try { localStorage.setItem('sw_completed_collapsed', swCompletedCollapsed() ? '0' : '1'); } catch (_) {}
  snapRenderWork();
}

// Reminder lifecycle helper — dismiss/defer stay backend-supported for the
// notification surface (they are deliberately not part of the list rows).
async function snapReminderAct(id, action, body) {
  await fetch('/api/snapshot/reminders/' + id + '/' + action, { method: 'POST', credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).catch(function () {});
  snapRefresh();
}
// Back-compat shims (older callers/tests)
function snapAddReminder() { swFocusComposer(); }
function snapAddTask() { swFocusComposer(); }
function snapTaskToggle(id, done) { return swCircle('task', id); }
function snapTaskDelete(id) { return swDelete('task', id); }

// ── Render ───────────────────────────────────────────────────────
// Icon-system circle: open ring while active; on completion the circle
// fills with the opIcon('check') mark — never a literal character.
function swCircleSvg(done) {
  if (done) return '<span class="sw-check">' + window.opIcon('check', 11) + '</span>';
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/></svg>';
}
function swPopHtml(it, args) {
  if (!__swPop || __swPop.key !== swKey(it.kind, it.id)) return '';
  if (__swPop.type === 'remind') {
    return '<div class="sw-pop" onclick="event.stopPropagation()">' +
      '<div class="sw-pop-label">Remind me</div>' +
      '<button type="button" class="sw-pop-item" onclick="swRemindPreset(' + args + ',\'later\')">Later today</button>' +
      '<button type="button" class="sw-pop-item" onclick="swRemindPreset(' + args + ',\'tomorrow\')">Tomorrow morning</button>' +
      '<div class="sw-pop-sep"></div>' +
      '<label class="sw-pop-item" style="cursor:default;">Custom time' +
        '<input type="time" class="sw-time" onchange="swRemindCustom(' + args + ', this.value)" aria-label="Custom reminder time"></label>' +
      '</div>';
  }
  if (__swPop.type === 'date') {
    return '<div class="sw-pop" onclick="event.stopPropagation()">' +
      '<div class="sw-pop-label">Due date</div>' +
      '<label class="sw-pop-item" style="cursor:default;">Date' +
        '<input type="date" class="sw-time" onchange="swDatePicked(' + args + ', this.value)" aria-label="Due date"></label>' +
      '</div>';
  }
  return '<div class="sw-pop" onclick="event.stopPropagation()">' +
    '<div class="sw-pop-label">Set due date</div>' +
    '<button type="button" class="sw-pop-item" onclick="swSetWhenPreset(' + args + ',\'today\')">Today</button>' +
    '<button type="button" class="sw-pop-item" onclick="swSetWhenPreset(' + args + ',\'tomorrow\')">Tomorrow</button>' +
    '<button type="button" class="sw-pop-item" onclick="swSetWhenPreset(' + args + ',\'week\')">This week</button>' +
    '<button type="button" class="sw-pop-item" onclick="swPopToggle(event,' + args + ',\'date\')">Pick a date&#8230;</button>' +
    '<div class="sw-pop-sep"></div>' +
    '<button type="button" class="sw-pop-item" onclick="swPopToggle(event,' + args + ',\'remind\')">Add reminder</button>' +
    '<button type="button" class="sw-pop-item danger" onclick="event.stopPropagation();swDelete(' + args + ')">Delete</button>' +
    '</div>';
}
function swRowHtml(it) {
  var esc = escapeHtml;
  var key = swKey(it.kind, it.id);
  var args = "'" + it.kind + "','" + it.id + "'";
  var domId = 'sw-row-' + it.kind + '-' + it.id;

  if (__swEditingKey === key) {
    return '<div class="sw-row editing" id="' + domId + '">' +
      '<span class="sw-circle ghost">' + swCircleSvg(false) + '</span>' +
      '<input id="sw-edit-' + it.kind + '-' + it.id + '" class="sw-input" type="text" value="' + esc(it.title) + '" ' +
        'onkeydown="swEditKey(event,' + args + ')" onblur="swEditCommit(' + args + ', this.value)"></div>';
  }

  var pending = !!__swPendingDone[key]; // mid completion animation
  var showDone = it.done || pending;
  var cls = 'sw-row' + (it.done ? ' done' : '') +
    (__swSelectedKey === key ? ' selected' : '') +
    (it.saving ? ' saving' : '') + (pending ? ' sw-done-anim' : '');
  var w = swWhenLabel(it);
  var h = '<div class="' + cls + '" id="' + domId + '" onclick="swRowClick(event,' + args + ')">';
  h += '<button type="button" class="sw-circle" aria-label="' + (showDone ? 'Reopen' : 'Complete') + '" ' +
    'onclick="event.stopPropagation();swCircle(' + args + ')">' + swCircleSvg(showDone) + '</button>';
  h += '<span class="sw-title" onclick="swTitleClick(event,' + args + ')">' + esc(it.title) +
    (it.saving ? ' <span class="sw-meta">saving&#8230;</span>' : '') + '</span>';
  if (w) h += '<span class="sw-when' + (w.overdue ? ' overdue' : '') + '">' + esc(w.text) + '</span>';
  if (!it.done && !it.saving) {
    h += '<span class="sw-actions">' +
      '<button type="button" class="sw-mini" onclick="event.stopPropagation();swSetWhenPreset(' + args + ',\'today\')">Today</button>' +
      '<button type="button" class="sw-mini" onclick="swPopToggle(event,' + args + ',\'remind\')">Remind</button>' +
      '<button type="button" class="sw-mini sw-more" aria-label="More actions" onclick="swPopToggle(event,' + args + ',\'menu\')">&#8226;&#8226;&#8226;</button>' +
      '</span>';
    h += swPopHtml(it, args);
  }
  h += '</div>';
  return h;
}
function buildSnapshotWorkHTML() {
  var esc = escapeHtml;
  var model = swModel();
  var collapsed = swCompletedCollapsed();

  // Quiet header: title + right-aligned remaining count, nothing else.
  var html = '<div class="rpt-section" id="snap-work">' +
    '<div class="rpt-section-title" style="display:flex;align-items:baseline;gap:8px;">Today\'s work' +
    '<span style="flex:1"></span>' +
    '<span style="font-weight:400;color:var(--muted);letter-spacing:0;text-transform:none;">' +
      model.active.length + ' remaining</span></div>';

  html += model.active.map(swRowHtml).join('');

  // Composer — the permanent last active row.
  html += '<div class="sw-row sw-composer" onclick="swFocusComposer()">' +
    '<span class="sw-circle ghost">' + swCircleSvg(false) + '</span>' +
    '<input id="sw-composer-input" class="sw-input" type="text" placeholder="Add a task&#8230;" ' +
      'value="' + esc(__swVal || '') + '" ' +
      'oninput="__swVal=this.value" onkeydown="swComposerKey(event)" onfocus="__swFocus=true" onblur="__swFocus=null"></div>';
  if (__swErr) html += '<div class="sw-error">' + esc(__swErr) + '</div>';

  if (model.done.length) {
    html += '<button type="button" class="sw-completed-toggle" onclick="swToggleCompleted()" aria-expanded="' + (!collapsed) + '">' +
      '<span class="sw-caret' + (collapsed ? '' : ' open') + '">&#9656;</span>Completed (' + model.done.length + ')</button>';
    if (!collapsed) html += model.done.map(swRowHtml).join('');
  }
  html += '</div>';
  return html;
}

function buildDailyReportHTML(date, role) {
  // ── Report preferences ──────────────────────────────────────────
  var _rptPrefs = ((window.APP_SETTINGS || {}).reportPreferences) || {};
  var _inclTravel  = _rptPrefs.includeTravel        !== false;
  var _inclGaps    = _rptPrefs.includeIdleGaps      !== false;
  var _inclCpd     = _rptPrefs.includeCpdSuggestions !== false;
  var _inclLunch   = _rptPrefs.includeLunchSuggestions !== false;

  var dateStr   = _rptDateKey(date);
  var dayKey    = _rptDayKey(dateStr);
  var sessions  = _rptSessionsForDate(dateStr);
  var metrics   = _rptMetrics(sessions);
  var travel    = _inclTravel ? _rptTravel(dayKey) : { travelMin: 0, legs: [], kmTotal: 0 };
  var gaps      = _inclGaps   ? _rptGaps(dayKey)   : [];
  var missing   = _rptMissingLocs(sessions);
  var _snapHTML = (typeof buildSnapshotWorkHTML === 'function') ? buildSnapshotWorkHTML() : '';
  var targetH   = RPT_DAILY_TARGET_H;
  var billableH = metrics.billableMin / 60;
  var targetPct = Math.min(100, Math.round(billableH / targetH * 100));
  var isToday   = dateStr === _rptDateKey(new Date());
  var dayLabel  = isToday ? 'Today' : date.toLocaleDateString('en-AU', { weekday: 'long' });

  if (sessions.length === 0) {
    return _snapHTML + _rptEmpty(dayLabel + ' — no appointments', 'No sessions found for ' + dateStr + '. If you expect appointments, check that the Outlook sync has run and events have loaded into the calendar.');
  }

  var html_prefix = _snapHTML; // Snapshot Day work section leads the report
  var clientSessions = sessions.filter(function(s) { return s.type !== 'travel' && s.type !== 'leave'; });
  var first = clientSessions[0];
  var last  = clientSessions[clientSessions.length - 1];
  var startT = first ? _rptFmtTime(first.startH, first.startM) : '—';
  var endT   = last  ? _rptFmtTime(last.endH || last.startH, last.endM || 0) : '—';

  var recs    = _rptDailyRecs({ billableH: billableH, targetH: targetH, travel: travel, gaps: gaps, missing: missing, sessions: sessions });
  var attn    = _rptDailyAttn({ missing: missing, travel: travel, billableH: billableH, targetH: targetH });

  var html = '';

  // Summary cards
  html += '<div class="rpt-summary-cards">';
  html += _rptCard('', metrics.appts, 'Appointments', metrics.uniqueClients + 'client'+ (metrics.uniqueClients !== 1 ? 's': ''), '#3d6cae');
  html += _rptCard('', billableH.toFixed(1) + 'h', 'Billable', 'of '+ targetH + 'h target', '#2f7d4f');
  html += _rptCard('', _rptFmtH(travel.travelMin), 'Travel', travel.legs.length + ' leg' + (travel.legs.length !== 1 ? 's' : ''), '#b06e12');
  html += _rptCard('', gaps.length, 'Free gaps', gaps.length >0 ? 'available today': 'none found', '#8b80c8');
  if (attn.length >0) html += _rptCard('', attn.length, 'Attention', 'item'+ (attn.length !== 1 ? 's': '') + 'to review', '#c2412e');
  html += '</div>';

  // Overview bar
  html += '<div class="rpt-overview-bar">';
  html += '<span>Start <strong>'+ startT + '</strong></span>';
  html += '<span>Finish <strong>'+ endT + '</strong></span>';
  html += '<span>Booked <strong>'+ _rptFmtH(metrics.totalMin) + '</strong></span>';
  html += '<span>Billable <strong>'+ _rptFmtH(metrics.billableMin) + '</strong></span>';
  if (metrics.nonBillableMin >0) html += '<span>Admin <strong>'+ _rptFmtH(metrics.nonBillableMin) + '</strong></span>';
  html += '</div>';

  // Visual Gantt strip — horizontal day bar
  (function() {
    var gStartH = (typeof START_H !== 'undefined') ? START_H : 7;
    var gEndH   = (typeof END_H   !== 'undefined') ? END_H   : 20;
    var dayStartMin = gStartH * 60;
    var daySpan     = (gEndH - gStartH) * 60;
    html += '<div class="rpt-gantt-wrap">';
    html += '<div class="rpt-gantt-strip">';
    // session blocks
    sessions.forEach(function(s) {
      var sMin = s.startH * 60 + (s.startM || 0);
      var eMin = (s.endH || s.startH) * 60 + (s.endM || 0);
      if (eMin <= sMin) eMin = sMin + 60;
      var left  = Math.max(0, (sMin - dayStartMin) / daySpan * 100);
      var width = Math.min(100 - left, (eMin - sMin) / daySpan * 100);
      if (width <= 0) return;
      var cls = s.type === 'travel' ? 'travel' : (RPT_BILLABLE_TYPES.has(s.type) ? 'billable' : 'nonbillable');
      var tip = (s.patient || s.title || s.type) + ' · ' + _rptFmtTime(s.startH, s.startM);
      html += '<div class="rpt-gantt-block ' + cls + '" style="left:' + left.toFixed(1) + '%;width:' + Math.max(1.5, width).toFixed(1) + '%" title="' + tip.replace(/"/g, '&quot;') + '"></div>';
    });
    // travel blocks (from travel.legs, avoiding double-counting — skip if already in sessions)
    travel.legs.forEach(function(seg) {
      var sMin = seg.startMin, eMin = seg.endMin;
      var left  = Math.max(0, (sMin - dayStartMin) / daySpan * 100);
      var width = Math.min(100 - left, (eMin - sMin) / daySpan * 100);
      if (width <= 0) return;
      html += '<div class="rpt-gantt-block travel" style="left:' + left.toFixed(1) + '%;width:' + Math.max(1.5, width).toFixed(1) + '%" title="Travel · ' + (seg.travelMin || '?') + ' min"></div>';
    });
    html += '</div>';
    // time ticks
    html += '<div class="rpt-gantt-ticks">';
    var _gFmt = (window.APP_SETTINGS || {}).timeFormat;
    for (var gt = gStartH; gt <= gEndH; gt += 2) {
      html += '<span>' + (_gFmt === '24'
        ? String(gt).padStart(2,'0') + ':00'
        : ((gt % 12) || 12) + (gt < 12 ? 'am' : 'pm')) + '</span>';
    }
    html += '</div></div>';
  })();

  // Billable target — SVG ring
  if (role !== 'admin') {
    var ringColor = targetPct >= 100 ? '#2f7d4f' : targetPct >= 70 ? '#b06e12' : '#c2412e';
    var r = 34, cx = 40, cy = 40, circ = 2 * Math.PI * r;
    var dash = (circ * Math.min(targetPct, 100) / 100).toFixed(1);
    html += '<div class="rpt-section"><div class="rpt-section-title">Billable Target</div>';
    html += '<div class="rpt-ring-wrap">';
    html += '<svg class="rpt-ring-svg" width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">';
    html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#e9e3d9" stroke-width="8"/>';
    html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + ringColor + '" stroke-width="8"';
    html += ' stroke-dasharray="' + dash + ' ' + circ.toFixed(1) + '"';
    html += ' stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
    html += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="14" font-weight="700" fill="' + ringColor + '">' + targetPct + '%</text>';
    html += '<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" font-size="9" fill="#a39b90">billed</text>';
    html += '</svg>';
    html += '<div class="rpt-ring-info">';
    html += '<div class="rpt-ring-headline">' + billableH.toFixed(1) + 'h <small>of ' + targetH + 'h target</small></div>';
    html += '<div class="rpt-ring-sub">'+ (targetPct >= 100 ? 'Daily target reached!': ''+ (targetH - billableH).toFixed(1) + 'h remaining to hit target') + '</div>';
    if (targetPct < 100) {
      html += '<div class="rpt-ring-bar"><div class="rpt-ring-bar-fill" style="width:' + targetPct + '%;background:' + ringColor + '"></div></div>';
    }
    html += '</div></div></div>';
  }

  // Timeline
  html += '<div class="rpt-section"><div class="rpt-section-title">Day Timeline</div><div class="rpt-timeline">';
  var timeline = [];
  sessions.forEach(function(s) {
    if (s.type !== 'travel') timeline.push({ kind: 'session', s: s, startMin: s.startH * 60 + (s.startM || 0) });
  });
  travel.legs.forEach(function(seg) { timeline.push({ kind: 'travel', seg: seg, startMin: seg.startMin }); });
  gaps.forEach(function(seg)        { timeline.push({ kind: 'gap',    seg: seg, startMin: seg.startMin }); });
  timeline.sort(function(a, b) { return a.startMin - b.startMin; });

  if (timeline.length === 0) {
    html += '<div class="rpt-empty-inline">No timeline items to show.</div>';
  } else {
    timeline.forEach(function(item) {
      if (item.kind === 'session') {
        var s = item.s;
        var isBillable = RPT_BILLABLE_TYPES.has(s.type);
        var loc = s.location || s.suburb || s.address || '';
        var missingLoc = !loc && s.type !== 'leave';
        var typeLabel = ({therapy:'Client Session',initial:'Initial Session',assessment:'Assessment',mdt:'MDT Meeting',outlook:'Outlook Event',admin:'Admin',leave:'Leave'})[s.type] || s.type;
        var startT2 = _rptFmtTime(s.startH, s.startM);
        var endT2   = _rptFmtTime(s.endH || s.startH, s.endM || 0);
        html += '<div class="rpt-timeline-row">';
        html += '<div class="rpt-tl-time">' + startT2 + '<br><span class="rpt-tl-end">' + endT2 + '</span></div>';
        html += '<div class="rpt-tl-dot ' + (isBillable ? 'billable' : 'nonbillable') + '"></div>';
        html += '<div class="rpt-tl-body"><div class="rpt-tl-title">' + (s.patient || s.title || typeLabel) + '</div>';
        html += '<div class="rpt-tl-meta">' + typeLabel;
        if (loc) html += ' · ' + loc;
        if (missingLoc) html += ' <span class="rpt-warn-chip">No address</span>';
        if (isBillable) html += ' <span class="rpt-badge billable">Billable</span>';
        html += '</div></div></div>';
      } else if (item.kind === 'travel') {
        var seg = item.seg;
        var from = (seg.fromLoc && (seg.fromLoc.suburb || seg.fromLoc.label)) || 'Base';
        var to   = (seg.toLoc   && (seg.toLoc.suburb   || seg.toLoc.label))   || 'Base';
        var tT   = typeof fmtMin === 'function' ? fmtMin(seg.startMin) : '';
        html += '<div class="rpt-timeline-row">';
        html += '<div class="rpt-tl-time">' + tT + '</div>';
        html += '<div class="rpt-tl-dot travel"></div>';
        html += '<div class="rpt-tl-body"><div class="rpt-tl-title">Travel · ' + (seg.travelMin || '?') + ' min</div>';
        html += '<div class="rpt-tl-meta">' + from + ' → ' + to + '</div></div></div>';
      } else if (item.kind === 'gap') {
        var seg = item.seg;
        var free    = (seg.endMin - seg.startMin) - (seg.travelMin || 0);
        var gapStartT = typeof fmtMin === 'function' ? fmtMin(seg.startMin) : '';
        var gapEndT   = typeof fmtMin === 'function' ? fmtMin(seg.endMin)   : '';
        html += '<div class="rpt-timeline-row">';
        html += '<div class="rpt-tl-time">' + gapStartT + '<br><span class="rpt-tl-end">' + gapEndT + '</span></div>';
        html += '<div class="rpt-tl-dot gap"></div>';
        html += '<div class="rpt-tl-body"><div class="rpt-tl-title">Free window · '+ free + 'min usable</div>';
        html += '<div class="rpt-tl-meta"><span style="cursor:pointer;color:var(--accent);text-decoration:underline;" onclick="closeReportPanel();switchTab(\'book\')">Book appointment</span> · Case notes · CPD · Break</div></div></div>';
      }
    });
  }
  html += '</div></div>';

  // Travel summary
  if (travel.travelMin > 0 || missing.length > 0) {
    html += '<div class="rpt-section"><div class="rpt-section-title">Travel Summary</div><div class="rpt-travel-list">';
    travel.legs.forEach(function(seg) {
      var from = (seg.fromLoc && seg.fromLoc.suburb) || 'Base';
      var to   = (seg.toLoc   && seg.toLoc.suburb)   || 'Base';
      var allotted = seg.endMin - seg.startMin;
      var tight = allotted < seg.travelMin - 5;
      html += '<div class="rpt-travel-leg' + (tight ? ' tight' : '') + '">';
      html += '<div class="rpt-travel-route">' + from + ' → ' + to + '</div>';
      html += '<div class="rpt-travel-detail">~'+ seg.travelMin + 'min estimated'+ (tight ? '<span class="rpt-warn-chip">May be too short</span>': '') + '</div>';
      if (typeof mapsLink === 'function') {
        html += '<a class="rpt-maps-link" href="' + mapsLink(from + ' WA', to + ' WA') + '" target="_blank" rel="noopener">Open in Google Maps →</a>';
      }
      html += '</div>';
    });
    if (missing.length > 0) {
      html += '<div class="rpt-warn-box">Travel cannot be fully calculated — '+ missing.length + 'appointment'+ (missing.length >1 ? 's are': 'is') + 'missing a location address.</div>';
    }
    html += '</div></div>';
  }

  // Free windows
  if (gaps.length > 0) {
    html += '<div class="rpt-section"><div class="rpt-section-title">Free Windows & Idle Gaps</div><div class="rpt-gap-list">';
    gaps.forEach(function(seg) {
      var gapMin  = seg.endMin - seg.startMin;
      var free    = gapMin - (seg.travelMin || 0);
      var sT      = typeof fmtMin === 'function' ? fmtMin(seg.startMin) : '';
      var eT      = typeof fmtMin === 'function' ? fmtMin(seg.endMin)   : '';
      var szLabel = free >= 60 ? 'Large block' : free >= 30 ? 'Admin window' : 'Quick task';
      html += '<div class="rpt-gap-item">';
      html += '<div class="rpt-gap-header"><span>' + sT + '–' + eT + '</span><span class="rpt-gap-size">' + free + ' min · ' + szLabel + '</span></div>';
      html += '<div class="rpt-gap-suggestions">';
      if (free >= 45) {
        html += '<span class="rpt-chip">Case notes</span><span class="rpt-chip">Admin work</span>';
        if (_inclCpd) html += '<span class="rpt-chip">CPD reading</span>';
      }
      if (free >= 30) { html += '<span class="rpt-chip">Emails</span><span class="rpt-chip">Phone calls</span>'; }
      if (free >= 20 && _inclLunch) { html += '<span class="rpt-chip">Break</span>'; }
      html += '</div></div>';
    });
    // Lunch check: any gap between 11am–2pm
    var hasLunch = gaps.some(function(g) { return (g.endMin - g.startMin - (g.travelMin||0)) >= 25 && g.startMin >= 660 && g.startMin <= 840; });
    if (_inclLunch && !hasLunch && clientSessions.length >= 2) {
      html += '<div class="rpt-warn-box" style="margin-top:8px;">No lunch break identified. Consider blocking 30 minutes around midday.<br><small style="opacity:.8;">Nearby café suggestions can be enabled once a Places/Maps integration is configured.</small></div>';
    }
    html += '</div></div>';
  }

  // Needs attention
  if (attn.length > 0) {
    html += '<div class="rpt-section rpt-section-warn"><div class="rpt-section-title">Needs Attention</div><div class="rpt-attention-list">';
    attn.forEach(function(item) {
      html += '<div class="rpt-attention-item"><span class="rpt-attention-icon">' + item.icon + '</span><div><div class="rpt-attention-msg">' + item.msg + '</div>' + (item.action ? '<div class="rpt-attention-action">' + item.action + '</div>' : '') + '</div></div>';
    });
    html += '</div></div>';
  }

  // Recommendations
  if (recs.length > 0) {
    html += '<div class="rpt-section"><div class="rpt-section-title">Smart Recommendations</div><div class="rpt-rec-list">';
    recs.forEach(function(r) {
      html += '<div class="rpt-rec-item"><span class="rpt-rec-icon">' + r.icon + '</span><div class="rpt-rec-text">' + r.text + '</div></div>';
    });
    html += '</div></div>';
  }

  // Action buttons
  html += '<div class="rpt-actions">';
  html += '<button class="rpt-action-btn" onclick="closeReportPanel();typeof gotoToday===\'function\'&&gotoToday()">Open Calendar</button>';
  html += '<button class="rpt-action-btn" onclick="closeReportPanel();switchTab(\'book\')">Book Appointment</button>';
  html += '<button class="rpt-action-btn" onclick="closeReportPanel();switchTab(\'logbook\')">Travel Logbook</button>';
  html += '<button class="rpt-action-btn" onclick="switchReportMode(\'weekly\')">View This Week</button>';
  html += '</div>';

  return html_prefix + html;
}

// ── Weekly report ─────────────────────────────────────────────

function buildWeeklyReportHTML(date, role) {
  // ── Report preferences ──────────────────────────────────────────
  var _rptPrefsW = ((window.APP_SETTINGS || {}).reportPreferences) || {};
  var _inclTravelW = _rptPrefsW.includeTravel          !== false;
  var _inclGapsW   = _rptPrefsW.includeIdleGaps        !== false;
  var _inclCpdW    = _rptPrefsW.includeCpdSuggestions  !== false;

  var weekStart = _rptWeekStart(date);
  var dayNames  = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  var weekData  = [];
  var totalBillMin = 0, totalTravelMin = 0, totalAppts = 0, totalGaps = 0, totalMissing = 0;
  var allClients = new Set();

  for (var i = 0; i < 5; i++) {
    var d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    var dateStr  = _rptDateKey(d);
    var dayKey   = _rptDayKey(dateStr);
    var sessions = _rptSessionsForDate(dateStr);
    var metrics  = _rptMetrics(sessions);
    var travel   = _inclTravelW ? _rptTravel(dayKey || '') : { travelMin: 0, legs: [], kmTotal: 0 };
    var gaps     = _inclGapsW   ? _rptGaps(dayKey || '')   : [];
    var missing  = _rptMissingLocs(sessions);
    weekData.push({ date: d, dateStr: dateStr, dayKey: dayKey, dayName: dayNames[i],
                    sessions: sessions, metrics: metrics, travel: travel, gaps: gaps, missing: missing });
    totalBillMin  += metrics.billableMin;
    totalTravelMin += travel.travelMin;
    totalAppts    += metrics.appts;
    totalGaps     += gaps.length;
    totalMissing  += missing.length;
    sessions.forEach(function(s) { if (s.patient) allClients.add(s.patient); });
  }

  var weekTarget  = RPT_WEEKLY_TARGET_H;
  var billableH   = totalBillMin / 60;
  var targetPct   = Math.min(100, Math.round(billableH / weekTarget * 100));

  if (totalAppts === 0) {
    return _rptEmpty('No appointments this week', 'No sessions found for the week of ' + _rptDateKey(weekStart) + '. If you expect appointments, check that the Outlook sync has run and events have loaded into the calendar.');
  }

  var recs = _rptWeeklyRecs({ weekData: weekData, billableH: billableH, weekTarget: weekTarget,
                               totalTravelMin: totalTravelMin, totalGaps: totalGaps, totalMissing: totalMissing, role: role });
  var attn = _rptWeeklyAttn({ weekData: weekData, billableH: billableH, weekTarget: weekTarget, totalMissing: totalMissing });

  var html = '';

  // Summary cards
  var fillColor = targetPct >= 100 ? '#2f7d4f' : targetPct >= 70 ? '#b06e12' : '#c2412e';
  html += '<div class="rpt-summary-cards">';
  html += _rptCard('', billableH.toFixed(1) + 'h', 'Billable', 'of '+ weekTarget + 'h target', '#2f7d4f');
  html += _rptCard('', totalAppts, 'Appointments', allClients.size + 'clients', '#3d6cae');
  html += _rptCard('', _rptFmtH(totalTravelMin), 'Travel', 'this week', '#b06e12');
  html += _rptCard('', totalGaps, 'Free gaps', 'across Mon–Fri', '#8b80c8');
  if (totalMissing >0) html += _rptCard('', totalMissing, 'Missing addr', 'location'+ (totalMissing >1 ? 's': '') + 'missing', '#c2412e');
  html += '</div>';

  // Weekly target progress — SVG ring
  if (role !== 'admin') {
    var wRingColor = targetPct >= 100 ? '#2f7d4f' : targetPct >= 70 ? '#b06e12' : '#c2412e';
    var wr = 34, wcx = 40, wcy = 40, wCirc = 2 * Math.PI * wr;
    var wDash = (wCirc * Math.min(targetPct, 100) / 100).toFixed(1);
    html += '<div class="rpt-section"><div class="rpt-section-title">Weekly Billable Target</div>';
    html += '<div class="rpt-ring-wrap">';
    html += '<svg class="rpt-ring-svg" width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">';
    html += '<circle cx="' + wcx + '" cy="' + wcy + '" r="' + wr + '" fill="none" stroke="#e9e3d9" stroke-width="8"/>';
    html += '<circle cx="' + wcx + '" cy="' + wcy + '" r="' + wr + '" fill="none" stroke="' + wRingColor + '" stroke-width="8"';
    html += ' stroke-dasharray="' + wDash + ' ' + wCirc.toFixed(1) + '"';
    html += ' stroke-linecap="round" transform="rotate(-90 ' + wcx + ' ' + wcy + ')"/>';
    html += '<text x="' + wcx + '" y="' + (wcy - 4) + '" text-anchor="middle" font-size="14" font-weight="700" fill="' + wRingColor + '">' + targetPct + '%</text>';
    html += '<text x="' + wcx + '" y="' + (wcy + 12) + '" text-anchor="middle" font-size="9" fill="#a39b90">billed</text>';
    html += '</svg>';
    html += '<div class="rpt-ring-info">';
    html += '<div class="rpt-ring-headline">' + billableH.toFixed(1) + 'h <small>of ' + weekTarget + 'h target</small></div>';
    html += '<div class="rpt-ring-sub">'+ (targetPct >= 100 ? 'Weekly target reached!': ''+ (weekTarget - billableH).toFixed(1) + 'h remaining') + '</div>';
    if (targetPct < 100) {
      html += '<div class="rpt-ring-bar"><div class="rpt-ring-bar-fill" style="width:' + targetPct + '%;background:' + wRingColor + '"></div></div>';
    }
    html += '</div></div></div>';
  }

  // Appointment count bar chart
  (function() {
    var todayStr = _rptDateKey(new Date());
    var maxAppts = 1;
    weekData.forEach(function(d) { if (d.metrics.appts > maxAppts) maxAppts = d.metrics.appts; });
    html += '<div class="rpt-section"><div class="rpt-section-title">Appointments per Day</div>';
    html += '<div class="rpt-appt-chart">';
    weekData.forEach(function(day) {
      var n   = day.metrics.appts;
      var pct = Math.round(n / maxAppts * 100);
      var isToday = day.dateStr === todayStr;
      html += '<div class="rpt-appt-bar-col" onclick="rptOpenDay(\'' + day.dateStr + '\')" title="' + day.dayName + ': ' + n + ' appts">';
      html += '<div class="rpt-appt-count">' + (n || '') + '</div>';
      html += '<div class="rpt-appt-bar ' + (n === 0 ? 'zero' : isToday ? 'today' : '') + '" style="height:' + Math.max(4, pct) + '%"></div>';
      html += '<div class="rpt-appt-day">' + day.dayName.slice(0,3) + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  })();

  // Daily breakdown cards
  html += '<div class="rpt-section"><div class="rpt-section-title">Daily Breakdown</div><div class="rpt-day-cards">';
  weekData.forEach(function(day) {
    var hasIssues = day.missing.length > 0;
    html += '<div class="rpt-day-card' + (hasIssues ? ' has-issues' : '') + '" onclick="rptOpenDay(\'' + day.dateStr + '\')">';
    html += '<div class="rpt-day-card-name">' + day.dayName.slice(0,3) + '<span class="rpt-day-date">' + day.date.toLocaleDateString('en-AU',{day:'numeric',month:'short'}) + '</span></div>';
    html += '<div class="rpt-day-card-metrics">';
    html += '<div class="rpt-day-stat"><strong>' + day.metrics.appts + '</strong><span>appts</span></div>';
    html += '<div class="rpt-day-stat"><strong>' + (day.metrics.billableMin / 60).toFixed(1) + 'h</strong><span>billable</span></div>';
    if (day.travel.travelMin > 0) html += '<div class="rpt-day-stat"><strong>' + day.travel.travelMin + 'm</strong><span>travel</span></div>';
    if (day.gaps.length > 0)      html += '<div class="rpt-day-stat"><strong>' + day.gaps.length + '</strong><span>gaps</span></div>';
    html += '</div>';
    if (hasIssues) html += '<div class="rpt-day-card-warn">'+ day.missing.length + 'missing address</div>';
    html += '<div class="rpt-day-card-open">View daily report →</div>';
    html += '</div>';
  });
  html += '</div></div>';

  // Workload mix bars
  html += '<div class="rpt-section"><div class="rpt-section-title">Workload Mix</div><div class="rpt-mix-bars">';
  var REF_MIN = 480; // 8h reference bar
  weekData.forEach(function(day) {
    if (day.metrics.appts === 0 && day.travel.travelMin === 0) return;
    var bPct = Math.min(95, Math.round(day.metrics.billableMin    / REF_MIN * 100));
    var nPct = Math.min(95, Math.round(day.metrics.nonBillableMin / REF_MIN * 100));
    var tPct = Math.min(95, Math.round(day.travel.travelMin       / REF_MIN * 100));
    html += '<div class="rpt-mix-row">';
    html += '<div class="rpt-mix-label">' + day.dayName.slice(0,3) + '</div>';
    html += '<div class="rpt-mix-bar-track">';
    if (bPct > 0) html += '<div class="rpt-mix-fill billable"    style="width:' + bPct + '%" title="Billable: '     + _rptFmtH(day.metrics.billableMin)    + '"></div>';
    if (nPct > 0) html += '<div class="rpt-mix-fill nonbillable" style="width:' + nPct + '%" title="Admin: '        + _rptFmtH(day.metrics.nonBillableMin) + '"></div>';
    if (tPct > 0) html += '<div class="rpt-mix-fill travel"      style="width:' + tPct + '%" title="Travel: '       + _rptFmtH(day.travel.travelMin)       + '"></div>';
    html += '</div>';
    html += '<div class="rpt-mix-total">' + _rptFmtH(day.metrics.totalMin + day.travel.travelMin) + '</div>';
    html += '</div>';
  });
  html += '<div class="rpt-mix-legend">';
  html += '<span><span class="rpt-legend-dot billable"></span>Billable</span>';
  html += '<span><span class="rpt-legend-dot nonbillable"></span>Admin</span>';
  html += '<span><span class="rpt-legend-dot travel"></span>Travel</span>';
  html += '</div></div></div>';

  // Needs attention
  if (attn.length > 0) {
    html += '<div class="rpt-section rpt-section-warn"><div class="rpt-section-title">Needs Attention</div><div class="rpt-attention-list">';
    attn.forEach(function(item) {
      html += '<div class="rpt-attention-item"><span class="rpt-attention-icon">' + item.icon + '</span><div><div class="rpt-attention-msg">' + item.msg + '</div>' + (item.action ? '<div class="rpt-attention-action">' + item.action + '</div>' : '') + '</div></div>';
    });
    html += '</div></div>';
  }

  // Recommendations
  if (recs.length > 0) {
    html += '<div class="rpt-section"><div class="rpt-section-title">Smart Recommendations</div><div class="rpt-rec-list">';
    recs.forEach(function(r) {
      html += '<div class="rpt-rec-item"><span class="rpt-rec-icon">' + r.icon + '</span><div class="rpt-rec-text">' + r.text + '</div></div>';
    });
    html += '</div></div>';
  }

  // Action buttons
  html += '<div class="rpt-actions">';
  html += '<button class="rpt-action-btn" onclick="closeReportPanel();typeof gotoToday===\'function\'&&gotoToday()">Open Calendar</button>';
  html += '<button class="rpt-action-btn" onclick="closeReportPanel();switchTab(\'logbook\')">Travel Logbook</button>';
  html += '<button class="rpt-action-btn" onclick="closeReportPanel();switchTab(\'profile\')">My Profile</button>';
  html += '<button class="rpt-action-btn" onclick="switchReportMode(\'daily\')">View Today</button>';
  html += '</div>';

  return html;
}

// ── Recommendation engines ────────────────────────────────────

function _rptDailyRecs(d) {
  var recs = [];
  if (d.billableH < d.targetH - 0.5) {
    recs.push({ icon: '', text: 'You are '+ (d.targetH - d.billableH).toFixed(1) + 'h below your daily billable target. Consider booking available time if capacity allows.'});
  }
  if (d.travel && d.travel.travelMin > 90) {
    recs.push({ icon: opIcon('car'), text: 'High travel day — ' + _rptFmtH(d.travel.travelMin) + ' estimated. Consider clustering nearby clients or reviewing route order.' });
  }
  if (d.gaps && d.gaps.length > 0) {
    var bigGap = null;
    d.gaps.forEach(function(g) { var f = g.endMin - g.startMin - (g.travelMin||0); if (!bigGap || f > (bigGap.endMin - bigGap.startMin - (bigGap.travelMin||0))) bigGap = g; });
    if (bigGap) {
      var free = bigGap.endMin - bigGap.startMin - (bigGap.travelMin || 0);
      recs.push({ icon: '', text: free + '-minute free window available. Consider case notes, CPD, admin, or a proper break.'});
    }
  }
  if (d.missing && d.missing.length > 0) {
    recs.push({ icon: '', text: d.missing.length + 'appointment'+ (d.missing.length >1 ? 's are': 'is') + 'missing an address. Fix locations before the day starts to enable travel calculation.'});
  }
  var hasLunch = d.gaps && d.gaps.some(function(g) {
    return (g.endMin - g.startMin - (g.travelMin||0)) >= 25 && g.startMin >= 660 && g.startMin <= 840;
  });
  if (!hasLunch && d.sessions && d.sessions.length >= 3) {
    recs.push({ icon: '', text: 'No lunch break identified. Consider blocking 30 minutes around midday to avoid a full day without a break.'});
  }
  return recs.slice(0, 5);
}

function _rptDailyAttn(d) {
  var items = [];
  (d.missing || []).forEach(function(s) {
    items.push({ icon: '', msg: (s.patient || s.title || 'An appointment') + 'is missing a full address — travel time cannot be calculated.', action: 'Open the calendar tile and add a location address.'});
  });
  if (d.travel && d.travel.legs) {
    d.travel.legs.forEach(function(seg) {
      var allotted = seg.endMin - seg.startMin;
      if (allotted < seg.travelMin - 5) {
        var from = (seg.fromLoc && seg.fromLoc.suburb) || 'Base';
        var to   = (seg.toLoc   && seg.toLoc.suburb)   || 'Base';
        items.push({ icon: '', msg: 'Travel from '+ from + 'to '+ to + ': estimated '+ seg.travelMin + 'min, but only '+ allotted + 'min is blocked.', action: 'Allow more travel time or adjust appointment times.'});
      }
    });
  }
  if (d.billableH < d.targetH * 0.5) {
    items.push({ icon: '', msg: 'Billable hours ('+ d.billableH.toFixed(1) + 'h) are significantly below the daily target ('+ d.targetH + 'h).', action: 'Review schedule or book additional capacity.'});
  }
  return items;
}

function _rptWeeklyRecs(d) {
  var recs = [];
  if (d.billableH < d.weekTarget * 0.85) {
    recs.push({ icon: '', text: 'Billable hours are at '+ d.billableH.toFixed(1) + 'h vs a '+ d.weekTarget + 'h weekly target ('+ Math.round(d.billableH / d.weekTarget * 100) + '%). Consider filling available slots.'});
  }
  if (d.totalMissing > 0) {
    recs.push({ icon: '', text: d.totalMissing + 'appointment location'+ (d.totalMissing >1 ? 's are': 'is') + 'missing this week — fix before the day to enable accurate travel calculation.'});
  }
  if (d.totalTravelMin > 180) {
    recs.push({ icon: opIcon('car'), text: 'High travel load this week — ' + _rptFmtH(d.totalTravelMin) + '. Consider clustering appointments by suburb to reduce drive time.' });
  }
  if (d.totalGaps >= 2) {
    recs.push({ icon: '', text: d.totalGaps + 'free windows this week. Use them for case notes, CPD, supervision, or admin catch-up rather than leaving them unplanned.'});
  }
  var heavyDay = null;
  d.weekData.forEach(function(day) { if (!heavyDay || day.travel.travelMin > heavyDay.travel.travelMin) heavyDay = day; });
  if (heavyDay && heavyDay.travel.travelMin >= 90) {
    recs.push({ icon: '', text: heavyDay.dayName + 'has the highest travel load ('+ _rptFmtH(heavyDay.travel.travelMin) + '). Consider reviewing route order or rescheduling nearby clients.'});
  }
  if (d.totalGaps >= 2) {
    recs.push({ icon: '', text: 'With '+ d.totalGaps + 'free windows available this week, consider scheduling a CPD activity, supervision session, or professional development.'});
  }
  return recs.slice(0, 6);
}

function _rptWeeklyAttn(d) {
  var items = [];
  if (d.totalMissing > 0) {
    items.push({ icon: '', msg: d.totalMissing + 'appointment'+ (d.totalMissing >1 ? 's': '') + 'this week missing location data.', action: 'Fix addresses on calendar tiles to enable travel calculation.'});
  }
  if (d.billableH < d.weekTarget * 0.5) {
    items.push({ icon: '', msg: 'Weekly billable hours ('+ d.billableH.toFixed(1) + 'h) are significantly below target ('+ d.weekTarget + 'h).', action: 'Review available capacity and consider additional bookings.'});
  }
  d.weekData.forEach(function(day) {
    var conflicts = day.sessions.filter(function(s) { return s.element && s.element.classList.contains('conflict-tile'); });
    if (conflicts.length >= 2) {
      items.push({ icon: '', msg: day.dayName + 'has overlapping appointments.', action: 'Review and resolve scheduling conflicts on '+ day.dayName + '.'});
    }
  });
  return items;
}

// ── UI helpers ────────────────────────────────────────────────

function _rptCard(icon, value, label, sub, color) {
  return '<div class="rpt-card" style="border-top:3px solid ' + color + '">' +
    '<div class="rpt-card-icon">' + icon + '</div>' +
    '<div class="rpt-card-value">' + value + '</div>' +
    '<div class="rpt-card-label">' + label + '</div>' +
    (sub ? '<div class="rpt-card-sub">' + sub + '</div>' : '') +
    '</div>';
}

function _rptEmpty(title, msg) {
  return '<div class="rpt-empty"><div class="rpt-empty-icon"></div>'+
    '<div class="rpt-empty-title">' + title + '</div>' +
    '<div class="rpt-empty-msg">' + msg + '</div></div>';
}

function rptOpenDay(dateStr) {
  _reportDate = new Date(dateStr + 'T00:00:00');
  _reportMode = 'daily';
  renderReportPanel();
}

// Escape closes report panel
(function() {
  var _origKd = document.onkeydown;
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _reportOpen) { e.stopPropagation(); closeReportPanel(); }
  }, true);
})();


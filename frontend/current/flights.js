/* ═══════════════════════════════════════════════════════════════════════════
   ADD A FLIGHT + LIVE FLIGHT STATUS (14 Nov 2026)

   Calendar sidebar → "Add a flight" (and Travel & Flights → Add Flight):
     1. Flight number + date → Find flight (GET /api/flights/lookup, the
        AeroDataBox proxy in backend/flight-routes.js). Several matches → pick
        one. No key on the server (503) or no match → enter it by hand.
     2. The check-in & boarding buffer is the therapist's own number on every
        flight (remembered from last time, never a built-in default).
     3. The drive to the airport starts where the therapist will be (whereAtMin)
        or at home, and is priced by Google (fetchRoute) at the time it will be
        driven; the drive onward after landing goes home unless changed. Either
        address can be cleared to leave that drive out.
     4. Add to calendar books, in order: drive to the airport, check-in &
        boarding, the flight, the drive onward — Travel blocks through
        POST /api/outlook/events (booking kinds travel-block / flight-checkin /
        flight, booking-rules.js).

   Live status: flights departing within 36 h, or in the air, are looked up at
   most every 10 minutes while the Calendar is on screen and the page is
   visible. The tile carries a small badge; the event panel shows status,
   revised times, terminal and gate. A delay never moves anything by itself —
   "Update times to revised" in the panel moves the flight and shifts its
   check-in and drives (PATCH /api/outlook/events/:id, as a drag does).

   Globals reached at call time: fetchRoute, whereAtMin, attachPlacesAutocomplete,
   WORK_BASES, DAY_DATES, SESSIONS, showToast, loadOutlookEventsToCalendar,
   gotoWeekOf, switchTab, __registerBookingUndo, addSession, openBlockDetail.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var FT = global.FlightTrack = global.FlightTrack || {};
  var TZ = 'Australia/Perth';
  var POLL_MS = 10 * 60 * 1000;
  var WINDOW_MS = 36 * 3600 * 1000;
  var LS_BUFFER = 'opal.flight.bufferMin';
  var LS_AFTER = 'opal.flight.afterLandingMin';
  var ZONES = [
    ['Australia/Perth', 'Perth (AWST)'], ['Australia/Darwin', 'Darwin'], ['Australia/Adelaide', 'Adelaide'],
    ['Australia/Brisbane', 'Brisbane'], ['Australia/Sydney', 'Sydney / Canberra'], ['Australia/Melbourne', 'Melbourne'],
    ['Australia/Hobart', 'Hobart'], ['Asia/Singapore', 'Singapore'], ['Asia/Makassar', 'Bali'], ['Pacific/Auckland', 'Auckland'],
  ];

  function $(id) { return document.getElementById(id); }
  function fn(name) { return typeof global[name] === 'function'; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(a, b, kind) { if (fn('showToast')) global.showToast(a, b, kind); }
  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function reqId() { return 'flt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }

  /* ───────────────────────────── Pure helpers ───────────────────────────── */
  function ceil5(min) { var m = Number(min); return Number.isFinite(m) && m > 0 ? Math.ceil(m / 5) * 5 : 0; }
  FT._ceil5 = ceil5;

  /* PURE — the ordered blocks for a flight. Times are ISO (UTC). A drive or
     buffer of 0 is left out. [] when the flight times do not make sense.
       drive-to    ends when check-in starts
       checkin     bufferMin before departure → departure
       flight      departure → arrival
       drive-from  starts afterLandingMin after arrival */
  FT._plan = function (o) {
    o = o || {};
    var dep = Date.parse(o.depUtc || ''), arr = Date.parse(o.arrUtc || '');
    if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr <= dep) return [];
    var buf = Math.max(0, Math.round(Number(o.bufferMin) || 0));
    var after = Math.max(0, Math.round(Number(o.afterLandingMin) || 0));
    var toMin = ceil5(o.driveToMin), fromMin = ceil5(o.driveFromMin);
    var M = 60000, iso = function (t) { return new Date(t).toISOString(); };
    var out = [];
    var checkStart = dep - buf * M;
    if (toMin) out.push({ role: 'drive-to', start: iso(checkStart - toMin * M), end: iso(checkStart), minutes: toMin });
    if (buf) out.push({ role: 'checkin', start: iso(checkStart), end: iso(dep), minutes: buf });
    out.push({ role: 'flight', start: iso(dep), end: iso(arr), minutes: Math.round((arr - dep) / M) });
    if (fromMin) {
      var s = arr + after * M;
      out.push({ role: 'drive-from', start: iso(s), end: iso(s + fromMin * M), minutes: fromMin });
    }
    return out;
  };

  /* PURE — the tile badge for a looked-up flight: { text, cls } or null. */
  FT._badge = function (f) {
    if (!f) return null;
    var st = String(f.status || '').toLowerCase().replace(/[\s_-]+/g, '');
    var d = f.departure || {}, a = f.arrival || {};
    if (st === 'canceled' || st === 'cancelled' || st === 'canceleduncertain') return { text: 'Cancelled', cls: 'bad' };
    if (st === 'diverted') return { text: 'Diverted', cls: 'bad' };
    if (st === 'arrived') return { text: 'Landed', cls: 'ok' };
    if (st === 'departed' || st === 'enroute' || st === 'approaching') return { text: 'Departed', cls: 'info' };
    var delay = delayMin(d.scheduledUtc, d.revisedUtc);
    if (delay >= 5) return { text: 'Delayed +' + fmtDur(delay), cls: 'warn' };
    if (st === 'delayed') return { text: 'Delayed', cls: 'warn' };
    if (st === 'boarding' || st === 'gateclosed') return { text: st === 'boarding' ? 'Boarding' : 'Gate closed', cls: 'info' };
    if (delay <= -5) return { text: 'Early ' + fmtDur(-delay), cls: 'ok' };
    return { text: 'On time', cls: 'ok' };
  };
  function delayMin(sched, rev) {
    var a = Date.parse(sched || ''), b = Date.parse(rev || '');
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : 0;
  }
  function fmtDur(min) { var h = Math.floor(min / 60), m = min % 60; return h ? h + 'h' + (m ? String(m).padStart(2, '0') : '') : m + 'm'; }
  FT._fmtDur = fmtDur;

  /* PURE — a wall-clock time in a time zone → UTC ISO. "2026-11-20T09:35". */
  FT._zonedToUtc = function (local, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
    if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  function tzOffsetMs(t, tz) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
    } catch (e) { return 8 * 3600 * 1000; }
  }

  function perthParts(iso) {
    var p = {};
    new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  function perthYmd(iso) { var p = perthParts(iso); return p.year + '-' + p.month + '-' + p.day; }
  function perthMin(iso) { var p = perthParts(iso); return (+p.hour % 24) * 60 + (+p.minute); }
  function fmtTime(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  }
  function fmtClock(iso) { return iso ? new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—'; }
  function todayPerth() { return perthYmd(new Date().toISOString()); }

  /* The address Google is asked to route to for an airport. */
  function airportQuery(a) {
    if (!a) return '';
    var name = String(a.name || a.iata || '').trim();
    if (!name) return '';
    var q = /airport/i.test(name) ? name : name + ' Airport';
    if (a.city && q.toLowerCase().indexOf(String(a.city).toLowerCase()) < 0) q += ', ' + a.city;
    return q;
  }
  function airportLabel(a) {
    if (!a) return 'the airport';
    var name = String(a.name || '').trim();
    if (name) return /airport/i.test(name) ? name : name + ' Airport';
    return a.iata ? a.iata + ' Airport' : 'the airport';
  }
  FT._airportQuery = airportQuery;

  function homeAddr() {
    try { return (typeof WORK_BASES !== 'undefined' && WORK_BASES.homes && WORK_BASES.homes[0] && WORK_BASES.homes[0].addr) || ''; }
    catch (e) { return ''; }
  }
  function placeLabel(addr) {
    var a = String(addr || '').trim();
    if (!a) return '';
    var h = homeAddr();
    if (h && h.trim().toLowerCase() === a.toLowerCase()) return 'Home';
    return a.split(',')[0].trim() || a;
  }
  /* Where the therapist will be at that time, if the day is on screen. */
  function whereAt(iso) {
    try {
      var ymd = perthYmd(iso);
      if (typeof DAY_DATES !== 'undefined' && fn('whereAtMin')) {
        var day = Object.keys(DAY_DATES).find(function (k) { return DAY_DATES[k] === ymd; });
        if (day) { var w = global.whereAtMin(day, perthMin(iso)); if (w && w.address) return w.address; }
      }
    } catch (e) { /* fall back to home */ }
    return homeAddr();
  }

  async function api(url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    var j = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, json: j };
  }
  async function lookup(number, date) {
    var r = await api('/api/flights/lookup?number=' + encodeURIComponent(number) + '&date=' + encodeURIComponent(date));
    if (r.status === 503) return { unconfigured: true, flights: [] };
    if (!r.ok) { var e = new Error(r.json.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return { flights: Array.isArray(r.json.flights) ? r.json.flights : [] };
  }
  FT._lookup = lookup;

  async function price(from, to, departureIso) {
    if (!from || !to || !fn('fetchRoute')) return null;
    try {
      var r = await global.fetchRoute(from, to, 'driving', departureIso ? { departureTime: departureIso } : undefined);
      if (!r || !(r.durationMin > 0)) return null;
      return { minutes: r.durationMin, km: r.distanceMeters ? Math.round(r.distanceMeters / 100) / 10 : null, estimate: r.source !== 'routes-api' };
    } catch (e) { return null; }
  }
  /* Drive to the airport: estimate, then re-price for the time it will be driven. */
  async function priceDriveTo(from, to, checkStartMs) {
    var first = await price(from, to, new Date(checkStartMs).toISOString());
    if (!first) return null;
    var second = await price(from, to, new Date(checkStartMs - ceil5(first.minutes) * 60000).toISOString());
    return second || first;
  }

  /* ───────────────────────────── The dialog ───────────────────────────── */
  var D = null; // the open dialog's state

  FT.open = function () {
    if (D) { var f = D.el.querySelector('#flt-number'); if (f) f.focus(); return; }
    var sb = $('cal-sidebar'); if (sb) sb.classList.remove('open'); // the drawer on small screens
    var el = document.createElement('div');
    el.className = 'pd-backdrop flt-backdrop';
    var zoneOpts = ZONES.map(function (z) { return '<option value="' + z[0] + '">' + esc(z[1]) + '</option>'; }).join('');
    var buf = lsGet(LS_BUFFER), after = lsGet(LS_AFTER);
    el.innerHTML =
      '<section class="pd-dialog flt-dialog" role="dialog" aria-modal="true" aria-labelledby="flt-title">' +
      '<div class="pd-head"><h2 class="pd-title" id="flt-title">Add a flight</h2></div>' +
      '<div class="pd-body">' +
        '<div class="flt-row">' +
          '<label class="flt-field"><span class="pd-lbl">Flight number</span><input id="flt-number" class="pd-input" autocomplete="off" placeholder="QF643" maxlength="9" spellcheck="false"></label>' +
          '<label class="flt-field"><span class="pd-lbl">Date</span><input id="flt-date" class="pd-input" type="date" value="' + todayPerth() + '"></label>' +
          '<button type="button" class="pd-btn pd-btn-primary flt-find" data-act="find">Find flight</button>' +
        '</div>' +
        '<div id="flt-find-status" class="flt-status" aria-live="polite"></div>' +
        '<div id="flt-results" class="flt-results" role="radiogroup" aria-label="Matching flights"></div>' +
        '<button type="button" class="flt-link" data-act="manual">Enter the flight by hand</button>' +
        '<fieldset id="flt-manual" class="flt-manual" hidden><legend>Flight details</legend>' +
          '<div class="flt-row"><label class="flt-field"><span class="pd-lbl">From airport</span><input id="flt-m-from" class="pd-input" placeholder="PER or Perth" autocomplete="off"></label>' +
          '<label class="flt-field"><span class="pd-lbl">To airport</span><input id="flt-m-to" class="pd-input" placeholder="SYD or Sydney" autocomplete="off"></label></div>' +
          '<div class="flt-row"><label class="flt-field"><span class="pd-lbl">Departs (local)</span><input id="flt-m-dep" class="pd-input" type="datetime-local"></label>' +
          '<label class="flt-field"><span class="pd-lbl">Time zone</span><select id="flt-m-deptz" class="pd-input">' + zoneOpts + '</select></label></div>' +
          '<div class="flt-row"><label class="flt-field"><span class="pd-lbl">Arrives (local)</span><input id="flt-m-arr" class="pd-input" type="datetime-local"></label>' +
          '<label class="flt-field"><span class="pd-lbl">Time zone</span><select id="flt-m-arrtz" class="pd-input">' + zoneOpts + '</select></label></div>' +
        '</fieldset>' +
        '<div id="flt-trip" class="flt-trip" hidden>' +
          '<div class="flt-row">' +
            '<label class="flt-field"><span class="pd-lbl">Check-in &amp; boarding (minutes before departure)</span><input id="flt-buffer" class="pd-input" type="number" min="0" max="600" step="5" inputmode="numeric" required value="' + esc(buf || '') + '"></label>' +
            '<label class="flt-field"><span class="pd-lbl">After landing (bags, minutes)</span><input id="flt-after" class="pd-input" type="number" min="0" max="600" step="5" inputmode="numeric" value="' + esc(after || '') + '" placeholder="0"></label>' +
          '</div>' +
          '<label class="flt-field flt-addr"><span class="pd-lbl">Leaving from <span class="flt-dim">(clear to leave out the drive)</span></span><input id="flt-from" class="pd-input" autocomplete="off"></label>' +
          '<label class="flt-field flt-addr"><span class="pd-lbl">After landing, going to <span class="flt-dim">(clear to leave out the drive)</span></span><input id="flt-to" class="pd-input" autocomplete="off"></label>' +
          '<div class="flt-plan-head">On your calendar <span class="flt-dim">(Perth time)</span></div>' +
          '<ol id="flt-plan" class="flt-plan" aria-live="polite"></ol>' +
        '</div>' +
        '<div id="flt-result" class="flt-status" aria-live="assertive"></div>' +
      '</div>' +
      '<div class="pd-foot"><button type="button" class="pd-btn" data-act="cancel">Cancel</button>' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="add" disabled>Add to calendar</button></div>' +
      '</section>';
    document.body.appendChild(el);
    D = { el: el, flight: null, flights: [], manual: false, plan: [], drives: {}, seq: 0, fromEdited: false, toEdited: false, created: [], busy: false };

    var close = function () {
      if (D && D.busy) return;
      el.remove(); D = null; document.removeEventListener('keydown', onKey, true);
    };
    var onKey = function (e) { if (e.key === 'Escape' && D && !D.busy) { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'cancel') close();
      else if (act === 'find') find();
      else if (act === 'manual') showManual(true);
      else if (act === 'add') addToCalendar(close);
      else if (act === 'undo-partial') undoPartial();
    });
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'flt-pick') { D.flight = D.flights[Number(t.value)] || null; prefillAndPlan(); }
      else if (/^flt-m-/.test(t.id)) { D.flight = manualFlight(); prefillAndPlan(); }
    });
    var debounce = null;
    el.addEventListener('input', function (e) {
      var id = e.target.id;
      if (id === 'flt-from') D.fromEdited = true;
      if (id === 'flt-to') D.toEdited = true;
      if (id === 'flt-buffer' || id === 'flt-after' || id === 'flt-from' || id === 'flt-to') {
        clearTimeout(debounce); debounce = setTimeout(replan, id === 'flt-buffer' || id === 'flt-after' ? 350 : 700);
      }
    });
    $('flt-number').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    ['flt-from', 'flt-to'].forEach(function (id) {
      var inp = $(id);
      if (inp && fn('attachPlacesAutocomplete')) {
        global.attachPlacesAutocomplete(inp, function () { if (id === 'flt-from') D.fromEdited = true; else D.toEdited = true; replan(); });
      }
    });
    $('flt-number').focus();
  };

  function setStatus(id, kind, html) { var s = $(id); if (!s) return; s.className = 'flt-status' + (kind ? ' ' + kind : ''); s.innerHTML = html || ''; }
  function showManual(on) {
    var m = $('flt-manual'); if (!m) return;
    m.hidden = !on; D.manual = !!on;
    if (on) {
      $('flt-results').innerHTML = '';
      var dep = $('flt-m-dep'); if (dep && !dep.value) dep.value = ($('flt-date').value || todayPerth()) + 'T09:00';
      D.flight = manualFlight(); prefillAndPlan();
      var first = $('flt-m-from'); if (first) first.focus();
    }
  }
  function manualFlight() {
    var dep = FT._zonedToUtc($('flt-m-dep').value, $('flt-m-deptz').value);
    var arr = FT._zonedToUtc($('flt-m-arr').value, $('flt-m-arrtz').value);
    var num = String($('flt-number').value || '').replace(/\s+/g, '').toUpperCase();
    var ap = function (v) { v = String(v || '').trim(); return /^[A-Za-z]{3}$/.test(v) ? { iata: v.toUpperCase(), name: null } : { iata: null, name: v || null }; };
    return {
      source: 'manual', number: num, airline: null, status: null,
      departure: Object.assign(ap($('flt-m-from').value), { scheduledUtc: dep }),
      arrival: Object.assign(ap($('flt-m-to').value), { scheduledUtc: arr }),
    };
  }

  async function find() {
    var number = String($('flt-number').value || '').trim();
    var date = $('flt-date').value;
    if (!/^[A-Za-z0-9]{2,3}\s?\d{1,4}[A-Za-z]?$/.test(number)) { setStatus('flt-find-status', 'warn', 'Enter a flight number like QF643.'); $('flt-number').focus(); return; }
    if (!date) { setStatus('flt-find-status', 'warn', 'Choose the date the flight leaves.'); return; }
    setStatus('flt-find-status', '', 'Looking up ' + esc(number.toUpperCase()) + '…');
    $('flt-results').innerHTML = '';
    var res;
    try { res = await lookup(number, date); }
    catch (e) { setStatus('flt-find-status', 'warn', esc(e.message) + ' — you can enter the flight by hand.'); showManual(true); return; }
    if (!D) return;
    if (res.unconfigured) {
      setStatus('flt-find-status', 'info', 'Flight lookup is not set up on this server — enter the flight by hand. Live status needs the lookup.');
      showManual(true); return;
    }
    var flights = res.flights.filter(function (f) { return f && f.departure && f.departure.scheduledUtc && f.arrival && f.arrival.scheduledUtc; });
    if (!flights.length) { setStatus('flt-find-status', 'warn', 'No flight ' + esc(number.toUpperCase()) + ' found on that date — check it, or enter it by hand.'); return; }
    showManual(false);
    D.flights = flights.map(function (f) { return Object.assign({ source: 'lookup', date: date }, f); });
    setStatus('flt-find-status', 'ok', flights.length === 1 ? 'Found it.' : flights.length + ' legs match — pick yours.');
    $('flt-results').innerHTML = D.flights.map(function (f, i) {
      return '<label class="flt-card"><input type="radio" name="flt-pick" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span><b>' + esc(f.number || '') + '</b> ' + esc(f.departure.iata || f.departure.name || '?') + ' → ' + esc(f.arrival.iata || f.arrival.name || '?') +
        (f.airline ? ' <span class="flt-dim">' + esc(f.airline) + '</span>' : '') + '<br>' +
        '<span class="flt-dim">Departs ' + esc(fmtTime(f.departure.revisedUtc || f.departure.scheduledUtc)) +
        (f.departure.terminal ? ' · T' + esc(f.departure.terminal) : '') + ' · arrives ' + esc(fmtTime(f.arrival.revisedUtc || f.arrival.scheduledUtc)) +
        (f.status ? ' · ' + esc(f.status) : '') + '</span></span></label>';
    }).join('');
    D.flight = D.flights[0];
    prefillAndPlan();
  }

  function depOf(f) { return f && f.departure ? (f.departure.revisedUtc || f.departure.scheduledUtc) : null; }
  function arrOf(f) { return f && f.arrival ? (f.arrival.revisedUtc || f.arrival.scheduledUtc) : null; }
  function bufferVal() { var v = $('flt-buffer').value; return v === '' ? null : Math.round(Number(v)); }
  function afterVal() { var v = $('flt-after').value; return v === '' ? 0 : Math.round(Number(v)); }

  function prefillAndPlan() {
    if (!D) return;
    $('flt-trip').hidden = !D.flight;
    if (!D.flight) { replan(); return; }
    var dep = Date.parse(depOf(D.flight) || '');
    var b = bufferVal();
    if (!D.fromEdited && Number.isFinite(dep)) $('flt-from').value = whereAt(new Date(dep - (b || 0) * 60000).toISOString()) || '';
    if (!D.toEdited) $('flt-to').value = homeAddr();
    replan();
  }

  async function replan() {
    if (!D) return;
    var seq = ++D.seq;
    var addBtn = D.el.querySelector('[data-act="add"]');
    addBtn.disabled = true;
    D.plan = [];
    var planEl = $('flt-plan');
    var f = D.flight;
    if (!f) { if (planEl) planEl.innerHTML = ''; return; }
    var dep = depOf(f), arr = arrOf(f);
    if (!Number.isFinite(Date.parse(dep || '')) || !Number.isFinite(Date.parse(arr || '')) || Date.parse(arr) <= Date.parse(dep)) {
      planEl.innerHTML = '<li class="flt-dim">Enter when the flight departs and arrives (arrival after departure).</li>'; return;
    }
    var buf = bufferVal();
    var bufBad = buf == null || !Number.isFinite(buf) || buf < 0 || buf > 600;
    var after = afterVal();
    if (!Number.isFinite(after) || after < 0 || after > 600) after = 0;
    if (bufBad) { planEl.innerHTML = '<li class="flt-warn">Set your check-in &amp; boarding time — how many minutes before departure you want to be at the airport.</li>'; return; }
    var from = $('flt-from').value.trim(), to = $('flt-to').value.trim();
    var depAp = airportQuery(f.departure), arrAp = airportQuery(f.arrival);
    planEl.innerHTML = '<li class="flt-dim">Working out the drives…</li>';
    var checkStart = Date.parse(dep) - buf * 60000;
    var results = await Promise.all([
      from && depAp ? priceDriveTo(from, depAp, checkStart) : Promise.resolve(null),
      to && arrAp ? price(arrAp, to, new Date(Date.parse(arr) + after * 60000).toISOString()) : Promise.resolve(null),
    ]);
    if (!D || seq !== D.seq) return;
    D.drives = { to: results[0], from: results[1], fromAddr: from, toAddr: to, depAp: depAp, arrAp: arrAp, buf: buf, after: after };
    D.plan = FT._plan({ depUtc: dep, arrUtc: arr, bufferMin: buf, afterLandingMin: after,
      driveToMin: results[0] ? results[0].minutes : 0, driveFromMin: results[1] ? results[1].minutes : 0 });
    var notes = [];
    if (from && !results[0]) notes.push('<li class="flt-warn">Could not price the drive from ' + esc(placeLabel(from)) + ' — it is left out. Check the address.</li>');
    if (to && !results[1]) notes.push('<li class="flt-warn">Could not price the drive to ' + esc(placeLabel(to)) + ' — it is left out. Check the address.</li>');
    if (results[1] && results[1].minutes > 240) notes.push('<li class="flt-warn">The drive after landing is ' + fmtDur(ceil5(results[1].minutes)) + ' — clear “going to” if you are not driving it.</li>');
    planEl.innerHTML = D.plan.map(function (b) {
      return '<li><span class="flt-when">' + esc(fmtTime(b.start)) + ' – ' + esc(fmtClock(b.end)) + '</span> <span>' + esc(titleFor(b, f)) +
        (b.role.indexOf('drive') === 0 && D.drives[b.role === 'drive-to' ? 'to' : 'from'].estimate ? ' <span class="flt-dim">(estimated)</span>' : '') + '</span></li>';
    }).join('') + notes.join('');
    addBtn.disabled = !D.plan.length || D.busy;
  }

  function titleFor(b, f) {
    var route = (f.departure.iata || f.departure.name || '?') + '→' + (f.arrival.iata || f.arrival.name || '?');
    var num = f.number || 'flight';
    if (b.role === 'flight') return 'Flight ' + num + ' ' + route;
    if (b.role === 'checkin') return 'Check-in & boarding · ' + num;
    if (b.role === 'drive-to') return 'Travel: ' + placeLabel(D.drives.fromAddr) + ' → ' + airportLabel(f.departure);
    return 'Travel: ' + airportLabel(f.arrival) + ' → ' + placeLabel(D.drives.toAddr);
  }

  function flightMeta(f, buf, after) {
    var dep = f.departure || {}, arr = f.arrival || {};
    var m = {
      number: f.number, depUtc: dep.scheduledUtc, arrUtc: arr.scheduledUtc,
      revisedDepUtc: dep.revisedUtc || undefined, revisedArrUtc: arr.revisedUtc || undefined,
      airline: f.airline || undefined, status: f.status || undefined,
      from: { iata: dep.iata || null, name: dep.name || null }, to: { iata: arr.iata || null, name: arr.name || null },
      terminal: dep.terminal || undefined, gate: dep.gate || undefined, arrTerminal: arr.terminal || undefined,
      source: f.source === 'lookup' ? 'lookup' : 'manual', bufferMin: buf, afterLandingMin: after,
    };
    if (f.date) m.date = f.date;
    return m;
  }

  function bodyFor(b, f) {
    var dr = D.drives, title = titleFor(b, f);
    var base = { title: title, startTime: b.start, endTime: b.end, categories: ['Travel'], requestId: b.requestId };
    if (b.role === 'flight' || b.role === 'checkin') {
      base.location = dr.depAp || undefined;
      base.booking = { kind: b.role === 'flight' ? 'flight' : 'flight-checkin', flight: flightMeta(f, dr.buf, dr.after) };
    } else {
      var leg = b.role === 'drive-to' ? dr.to : dr.from;
      base.booking = { kind: 'travel-block', route: {
        from: b.role === 'drive-to' ? dr.fromAddr : dr.arrAp, to: b.role === 'drive-to' ? dr.depAp : dr.toAddr,
        minutes: b.minutes, distanceKm: leg && leg.km != null ? leg.km : undefined } };
    }
    return base;
  }

  async function addToCalendar(close) {
    if (!D || D.busy || !D.plan.length) return;
    var f = D.flight;
    if (f.source === 'manual') f.number = String($('flt-number').value || '').replace(/\s+/g, '').toUpperCase();
    if (!f.number || !/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(String(f.number).replace(/\s+/g, '').toUpperCase())) {
      setStatus('flt-result', 'warn', 'Enter the flight number at the top (like QF643).'); return;
    }
    f.number = String(f.number).replace(/\s+/g, '').toUpperCase();
    D.busy = true;
    var btn = D.el.querySelector('[data-act="add"]');
    btn.disabled = true; btn.textContent = 'Adding…';
    lsSet(LS_BUFFER, String(D.drives.buf));
    lsSet(LS_AFTER, String(D.drives.after));
    var plan = D.plan;
    plan.forEach(function (b) { if (!b.requestId) b.requestId = reqId(); });
    var failed = null;
    for (var i = 0; i < plan.length; i++) {
      var b = plan[i];
      if (b.dbId) continue; // created on an earlier try
      try {
        var r = await api('/api/outlook/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFor(b, f)) });
        if (!r.ok || !r.json.dbId) { failed = { b: b, error: r.json.error || ('HTTP ' + r.status) }; break; }
        b.dbId = r.json.dbId;
        D.created.push({ dbId: b.dbId, title: titleFor(b, f) });
      } catch (e) { failed = { b: b, error: e.message || 'network error' }; break; }
    }
    D.busy = false;
    var ymd = perthYmd(plan[0].start);
    if (fn('loadOutlookEventsToCalendar')) global.loadOutlookEventsToCalendar();
    if (failed) {
      btn.disabled = false; btn.textContent = 'Retry the rest';
      setStatus('flt-result', 'warn',
        '<b>Not everything was added.</b> “' + esc(titleFor(failed.b, f)) + '” failed: ' + esc(failed.error) + '.' +
        (D.created.length ? '<br>Added: ' + D.created.map(function (c) { return '“' + esc(c.title) + '”'; }).join(', ') +
          '. <button type="button" class="flt-link" data-act="undo-partial">Remove these</button>' : '<br>Nothing was added.'));
      return;
    }
    D.created.forEach(function (c) { if (fn('__registerBookingUndo')) global.__registerBookingUndo(c.dbId, c.title); });
    if (fn('switchTab')) { global.__viewManuallySet = true; global.switchTab('calendar'); }
    if (fn('gotoWeekOf')) global.gotoWeekOf(ymd);
    toast('Flight ' + f.number + ' added', plan.length + ' block' + (plan.length === 1 ? '' : 's') + ' on your calendar' + (f.source === 'lookup' ? ' · live status is on' : ''));
    close();
    LIVE.lastScan = 0; setTimeout(pollDue, 1500);
  }

  async function undoPartial() {
    if (!D || D.busy || !D.created.length) return;
    D.busy = true;
    var left = [];
    for (var i = 0; i < D.created.length; i++) {
      var c = D.created[i];
      try {
        var r = await fetch('/api/outlook/events/' + encodeURIComponent(c.dbId), { method: 'DELETE', credentials: 'include' });
        if (!r.ok) left.push(c);
      } catch (e) { left.push(c); }
    }
    D.busy = false;
    D.plan.forEach(function (b) { if (!left.some(function (c) { return c.dbId === b.dbId; })) { b.dbId = null; b.requestId = null; } });
    D.created = left;
    var btn = D.el.querySelector('[data-act="add"]'); btn.textContent = 'Add to calendar'; btn.disabled = !D.plan.length;
    setStatus('flt-result', left.length ? 'warn' : 'ok', left.length ? 'Could not remove ' + left.map(function (c) { return '“' + esc(c.title) + '”'; }).join(', ') + ' — delete it from the calendar.' : 'Removed — nothing from this flight is on the calendar.');
    if (fn('loadOutlookEventsToCalendar')) global.loadOutlookEventsToCalendar();
  }

  /* ───────────────────────────── Live status ───────────────────────────── */
  var LIVE = { byKey: {}, lastScan: 0, timer: null, unconfigured: false, inflight: {} };

  function flightOf(s) { var b = s && s.booking; return b && (b.kind === 'flight' || b.kind === 'flight-checkin') && b.flight ? b.flight : null; }
  function keyOf(fl) { return fl && fl.number && fl.date ? fl.number + '|' + fl.date : null; }
  function liveFor(fl) { var k = keyOf(fl); return k && LIVE.byKey[k] ? LIVE.byKey[k] : null; }
  /* The looked-up leg that matches the booked one (several legs share a number). */
  function matchLeg(flights, fl) {
    if (!flights || !flights.length) return null;
    var dep = fl.from && fl.from.iata;
    return flights.find(function (x) { return x.departure && dep && x.departure.iata === dep; }) ||
      flights.find(function (x) { return x.departure && x.departure.scheduledUtc === fl.depUtc; }) || flights[0];
  }
  function trackable(fl, now) {
    if (!keyOf(fl)) return false;
    var dep = Date.parse(fl.revisedDepUtc || fl.depUtc), arr = Date.parse(fl.revisedArrUtc || fl.arrUtc || '') || dep + 3600000;
    var l = liveFor(fl);
    if (l && l.leg) { dep = Date.parse(depOf(l.leg)) || dep; arr = Date.parse(arrOf(l.leg)) || arr; }
    return now >= dep - WINDOW_MS && now <= arr + 3600000;
  }
  FT._trackable = trackable;
  function calendarVisible() { var v = $('view-calendar'); return !v || v.classList.contains('active'); }

  async function refreshOne(fl, force) {
    var k = keyOf(fl); if (!k) return null;
    var cur = LIVE.byKey[k];
    if (!force && cur && Date.now() - cur.at < POLL_MS) return cur;
    if (LIVE.inflight[k]) return LIVE.inflight[k];
    var p = (async function () {
      try {
        var res = await lookup(fl.number, fl.date);
        if (res.unconfigured) { LIVE.unconfigured = true; return null; }
        LIVE.byKey[k] = { at: Date.now(), leg: matchLeg(res.flights, fl) };
      } catch (e) { LIVE.byKey[k] = { at: Date.now(), leg: cur ? cur.leg : null, error: true }; }
      return LIVE.byKey[k];
    })();
    LIVE.inflight[k] = p;
    try { return await p; } finally { delete LIVE.inflight[k]; }
  }

  async function pollDue() {
    if (LIVE.unconfigured || document.hidden || !calendarVisible()) return;
    var now = Date.now(), seen = {};
    var due = Object.values(global.SESSIONS || {}).map(flightOf).filter(function (fl) {
      var k = keyOf(fl); if (!k || seen[k]) return false; seen[k] = true;
      return trackable(fl, now);
    });
    if (!due.length) return;
    for (var i = 0; i < due.length; i++) await refreshOne(due[i], false);
    decorateAllTiles();
  }
  FT._pollDue = pollDue;

  function decorateTile(s) {
    if (!s || !s.element) return;
    var fl = flightOf(s);
    var old = s.element.querySelector('.flt-badge');
    if (!fl || (s.booking.kind !== 'flight')) { if (old) old.remove(); return; }
    var l = liveFor(fl);
    var bd = l && l.leg ? FT._badge(l.leg) : null;
    if (!bd) { if (old) old.remove(); return; }
    if (!old) { old = document.createElement('span'); s.element.appendChild(old); }
    old.className = 'flt-badge ' + bd.cls;
    old.textContent = bd.text;
    old.title = 'Live flight status — updated ' + fmtClock(new Date(l.at).toISOString());
  }
  function decorateAllTiles() {
    Object.values(global.SESSIONS || {}).forEach(function (s) { try { decorateTile(s); } catch (e) { /* tile gone */ } });
  }
  FT.decorateAllTiles = decorateAllTiles;

  /* ───────────────────────────── Event panel ───────────────────────────── */
  global.flightDecorateDetail = function (s) {
    var host = $('bd-body');
    var old = $('flt-detail'); if (old) old.remove();
    var fl = flightOf(s);
    if (!host || !fl) return;
    var box = document.createElement('div');
    box.className = 'flt-detail'; box.id = 'flt-detail';
    host.appendChild(box);
    var paint = function () {
      var l = liveFor(fl), leg = l && l.leg;
      var d = leg ? leg.departure || {} : {}, a = leg ? leg.arrival || {} : {};
      var bd = leg ? FT._badge(leg) : null;
      var rows = [];
      var r = function (k, v) { rows.push('<div class="flt-kv"><span>' + esc(k) + '</span><span>' + v + '</span></div>'); };
      r('Flight', '<b>' + esc(fl.number) + '</b>' + (fl.airline ? ' · ' + esc(fl.airline) : '') + ' · ' +
        esc((fl.from && (fl.from.iata || fl.from.name)) || '?') + ' → ' + esc((fl.to && (fl.to.iata || fl.to.name)) || '?'));
      if (bd) r('Status', '<span class="flt-badge ' + bd.cls + '">' + esc(bd.text) + '</span>' + (leg.status ? ' <span class="flt-dim">' + esc(leg.status) + '</span>' : ''));
      r('Departs', esc(fmtTime(fl.depUtc)) + (d.revisedUtc && d.revisedUtc !== fl.depUtc ? ' → <b>' + esc(fmtTime(d.revisedUtc)) + '</b>' : ''));
      if (fl.arrUtc) r('Arrives', esc(fmtTime(fl.arrUtc)) + (a.revisedUtc && a.revisedUtc !== fl.arrUtc ? ' → <b>' + esc(fmtTime(a.revisedUtc)) + '</b>' : ''));
      var term = d.terminal || fl.terminal, gate = d.gate || fl.gate;
      if (term || gate || d.checkInDesk) r('Terminal', [term ? 'T' + esc(term) : '', gate ? 'Gate ' + esc(gate) : '', d.checkInDesk ? 'Check-in ' + esc(d.checkInDesk) : ''].filter(Boolean).join(' · '));
      if (s.booking.kind === 'flight' && fl.bufferMin != null) r('Check-in buffer', esc(fl.bufferMin) + ' min');
      var note = '';
      if (LIVE.unconfigured) note = 'Live status needs the flight lookup set up on the server.';
      else if (!keyOf(fl)) note = 'Entered by hand — no live status.';
      else if (l) note = (l.error ? 'Lookup not answering — showing what we had. ' : '') + 'Updated ' + esc(fmtClock(new Date(l.at).toISOString())) + '.';
      else note = trackable(fl, Date.now()) ? 'Checking…' : 'Live status starts 36 hours before departure.';
      var actions = '';
      if (keyOf(fl) && !LIVE.unconfigured) actions += '<button type="button" class="pd-btn" data-flt-refresh>Refresh status</button>';
      var shift = leg ? revisedShift(s, fl, leg) : null;
      if (shift) actions += '<button type="button" class="pd-btn pd-btn-primary" data-flt-revise>Update times to revised</button>';
      box.innerHTML = '<b>Flight</b>' + rows.join('') + '<div class="flt-dim flt-note">' + note + '</div>' +
        (shift ? '<div class="flt-warn flt-note">The calendar has departure at ' + esc(fmtClock(shift.curDep)) + '; the airline now says ' + esc(fmtClock(shift.newDep)) + '. Nothing moves until you update it.</div>' : '') +
        (actions ? '<div class="flt-actions">' + actions + '</div>' : '');
    };
    box.addEventListener('click', async function (e) {
      if (e.target.closest('[data-flt-refresh]')) {
        e.target.disabled = true;
        await refreshOne(fl, true); decorateAllTiles(); if (box.isConnected) paint();
      } else if (e.target.closest('[data-flt-revise]')) {
        e.target.disabled = true;
        await applyRevised(s, fl);
      }
    });
    paint();
    if (keyOf(fl) && !LIVE.unconfigured && trackable(fl, Date.now()) && !liveFor(fl)) {
      refreshOne(fl, false).then(function () { decorateAllTiles(); if (box.isConnected) paint(); });
    }
  };

  /* The flight session for a flight's blocks, and how far the airline's revised
     times are from what is on the calendar. null when within 5 minutes. */
  function sessionsOfFlight(fl) {
    return Object.values(global.SESSIONS || {}).filter(function (x) {
      var f2 = flightOf(x); return f2 && f2.number === fl.number && f2.depUtc === fl.depUtc && x.dbId;
    });
  }
  function revisedShift(s, fl, leg) {
    var flightS = sessionsOfFlight(fl).find(function (x) { return x.booking.kind === 'flight'; });
    if (!flightS || !flightS.startTimeIso) return null;
    var newDep = depOf(leg), newArr = arrOf(leg);
    var curDep = new Date(flightS.startTimeIso).toISOString(), curArr = new Date(flightS.endTimeIso || flightS.startTimeIso).toISOString();
    if (!newDep || !newArr) return null;
    var dDep = Date.parse(newDep) - Date.parse(curDep), dArr = Date.parse(newArr) - Date.parse(curArr);
    if (Math.abs(dDep) < 5 * 60000 && Math.abs(dArr) < 5 * 60000) return null;
    return { flightS: flightS, curDep: curDep, curArr: curArr, newDep: newDep, newArr: newArr, dDep: dDep, dArr: dArr };
  }

  /* PURE — the moves for "Update times to revised": [{ dbId, start, end }].
     blocks: [{ dbId, role, start, end }] as they are on the calendar now. */
  FT._shiftPlan = function (blocks, dDepMs, dArrMs) {
    return blocks.map(function (b) {
      var d = (b.role === 'drive-from') ? dArrMs : dDepMs;
      var s = Date.parse(b.start) + d, e = Date.parse(b.end) + (b.role === 'flight' ? dArrMs : d);
      return { dbId: b.dbId, start: new Date(s).toISOString(), end: new Date(e).toISOString() };
    }).filter(function (m) { return m.end > m.start; });
  };

  async function applyRevised(s, fl) {
    var l = liveFor(fl); var shift = l && l.leg ? revisedShift(s, fl, l.leg) : null;
    if (!shift) return;
    var mine = sessionsOfFlight(fl);
    var checkS = mine.find(function (x) { return x.booking.kind === 'flight-checkin'; });
    var fS = shift.flightS;
    var names = function (route, ap) {
      var key = ap && (ap.name || ap.iata);
      return !key || String(route || '').toLowerCase().indexOf(String(key).toLowerCase()) >= 0;
    };
    var checkStart = checkS ? new Date(checkS.startTimeIso).toISOString() : shift.curDep;
    var afterArr = Date.parse(shift.curArr) + (Number(fl.afterLandingMin) || 0) * 60000;
    // Its drives: the travel block that ends as check-in starts and goes to
    // the airport, and the one leaving the arrival airport after landing.
    var drives = Object.values(global.SESSIONS || {}).filter(function (x) {
      var r = x && x.booking && x.booking.kind === 'travel-block' && x.booking.route; return r && x.dbId && x.startTimeIso;
    });
    var toS = drives.find(function (x) { return new Date(x.endTimeIso).toISOString() === checkStart && names(x.booking.route.to, fl.from); });
    var fromS = drives.find(function (x) { return Date.parse(x.startTimeIso) === afterArr && names(x.booking.route.from, fl.to); });
    var blocks = [];
    var add = function (x, role) { if (x) blocks.push({ dbId: x.dbId, role: role, start: new Date(x.startTimeIso).toISOString(), end: new Date(x.endTimeIso).toISOString() }); };
    add(toS, 'drive-to'); add(checkS, 'checkin'); add(fS, 'flight'); add(fromS, 'drive-from');
    var moves = FT._shiftPlan(blocks, shift.dDep, shift.dArr);
    var failed = 0;
    for (var i = 0; i < moves.length; i++) {
      try {
        var r = await api('/api/outlook/events/' + encodeURIComponent(moves[i].dbId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startTime: moves[i].start, endTime: moves[i].end }) });
        if (!r.ok) failed++;
      } catch (e) { failed++; }
    }
    if (failed) toast('Some blocks did not move', failed + ' of ' + moves.length + ' could not be saved — check the calendar.', 'warn');
    else toast('Flight ' + fl.number + ' moved to the revised times', moves.length + ' block' + (moves.length === 1 ? '' : 's') + ' updated' + (toS ? '' : ' (no drive to the airport found to shift)'));
    if (fn('closeBlockDetail')) global.closeBlockDetail();
    if (fn('loadOutlookEventsToCalendar')) global.loadOutlookEventsToCalendar();
  }

  /* ───────────────────────────── Wiring ───────────────────────────── */
  function wrapGlobal(name, after) {
    var orig = global[name];
    if (typeof orig !== 'function' || orig['__flt_' + name]) return;
    var w = function () { var out = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { /* enhancement only */ } return out; };
    Object.keys(orig).forEach(function (k) { w[k] = orig[k]; });
    w['__flt_' + name] = true;
    global[name] = w;
  }
  function wire() {
    var pending = false;
    wrapGlobal('addSession', function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; decorateAllTiles(); pollDue(); }, 0);
    });
    var btn = $('cal-add-flight'); if (btn) btn.addEventListener('click', FT.open);
    var tb = $('travel-add-flight'); if (tb) tb.addEventListener('click', FT.open);
    LIVE.timer = setInterval(pollDue, 60 * 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pollDue(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})(window);

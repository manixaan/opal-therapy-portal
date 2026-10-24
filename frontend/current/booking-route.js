/* ═══════════════════════════════════════════════════════════════════════════
   BOOKING ROUTE — route-aware Smart Booking (2 Oct 2026)

   Extends the EXISTING New Appointment side panel; nothing here is a second
   booking screen. It adds, inside the panel's own WHEN & WHERE card:

     • a client location selector over the existing Location field — the
       Splose address (read live), the client's saved service locations and
       the addresses earlier bookings used, plus "+ Add another address"
       (Google Places, via the shell's attachPlacesAutocomplete). A picked
       address is saved for the client, deduplicated server-side;
     • the work-location notice — Smart Scheduling needs the clinician's base
       for the day; the notice links to My Profile and the unfinished booking
       is kept and reopened on return;
     • after Create appointment: "What would you like to do next?" —
       Return Home / Book Another Client / Go Somewhere Else.

   The route maths (planNextStop, routeBufferMin, the live preview and the
   BOOKING_ROUTE state) live in travel.js with the rest of the travel domain.
   Travel legs stay what they already are in this system: computed overlays
   from each session's saved "after" answer (custom_metadata.travel) — Return
   Home and Go Somewhere Else write that answer with the routed minutes; Book
   Another Client chains through BOOKING_STATE.travelFrom like "add a stop".

   Loaded deferred after travel.js. Globals reached at call time: BOOKING_STATE,
   BOOKING_LEAVES, PATIENTS, SESSIONS, DAY_DATES, _bspSelectedTherapist,
   getSelectedPatient, openBookingPanel, selectBookingLeaf, attachPlacesAutocomplete,
   showToast, and travel.js's fetchRoute / setTravelOverride / dayAnchorBase /
   calendarWeekLocations / openWorkLocationsForCalendarWeek / ceilToSlot.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var BR = global.BookingRoute = global.BookingRoute || {};
  var LABELS = ['Home', 'School', 'Day Program', 'Work', 'Hospital', 'Other'];
  var DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  var DRAFT_TTL_MS = 30 * 60 * 1000;

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(t, sub, kind) { if (typeof global.showToast === 'function') global.showToast(t, sub, kind); }
  function fn(name) { return typeof global[name] === 'function' ? global[name] : null; }
  function hhmm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
  function fmt(min) { var f = fn('fmtTime'); return f ? f(Math.floor(min / 60), min % 60) : hhmm(min); }
  function perthIso(day, min) {
    var d = (typeof DAY_DATES !== 'undefined' && DAY_DATES) ? DAY_DATES[day] : null;
    return d ? d + 'T' + hhmm(min) + ':00+08:00' : null;
  }
  function panelOpen() { var p = $('booking-side-panel'); return !!(p && p.classList.contains('open')); }
  function activeDay() { var c = document.querySelector('.bsp-day-chip.active'); return c && c.dataset ? c.dataset.day : null; }
  function bookingState() { return (typeof BOOKING_STATE !== 'undefined' && BOOKING_STATE) || null; }
  function isClientCategory() { var b = bookingState(); return !b || !b.category || b.category === 'client'; }
  function selectedPatient() { var g = fn('getSelectedPatient'); return g ? g() : null; }
  function routeState() { return (typeof BOOKING_ROUTE !== 'undefined' && BOOKING_ROUTE) || null; }
  function canon(a) { var c = fn('canonAddr'); return c ? c(a) : String(a || '').toLowerCase().trim(); }
  function wrapGlobal(name, after) {
    var orig = global[name];
    if (typeof orig !== 'function' || orig['__br_' + name]) return;
    var w = function () { var out = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { /* enhancement only */ } return out; };
    w['__br_' + name] = true;
    global[name] = w;
  }
  async function getJson(url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  function postJson(url, body) {
    return getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /* ─────────────────────────── Clinician context ───────────────────────────
     Route maths and allocations follow the clinician under BOOKING FOR, not
     the signed-in account. Another clinician's week is read (owner/admin only,
     enforced server-side) from GET /api/profile/work-schedule/:userId. */
  var CLINICIAN_WL = new Map(); // userId → { schedule, bases } | { error }

  function selectedClinician() {
    var me = global.APP_USER && global.APP_USER.id;
    var t = (typeof _bspSelectedTherapist !== 'undefined') ? _bspSelectedTherapist : null;
    if (!t || !t.userId || String(t.userId) === String(me)) return { own: true, userId: me || null, name: 'you', profileId: t ? t.id : null };
    return { own: false, userId: t.userId, name: t.displayName || 'this clinician', profileId: t.id };
  }
  async function loadClinicianSchedule(userId) {
    if (!userId || CLINICIAN_WL.has(userId)) return CLINICIAN_WL.get(userId);
    CLINICIAN_WL.set(userId, { loading: true });
    try {
      var j = await getJson('/api/profile/work-schedule/' + encodeURIComponent(userId));
      CLINICIAN_WL.set(userId, { schedule: j.workLocationSchedule || {}, bases: j.travelBases || {} });
    } catch (e) {
      CLINICIAN_WL.set(userId, { error: e.status || true });
    }
    return CLINICIAN_WL.get(userId);
  }
  function calendarWeekKey() {
    var mon = global.__currentWeekMonday;
    var wk = fn('weekKeyFor');
    if (!mon || !wk) return null;
    return wk(new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate()));
  }
  /* PURE — a day's base from a clinician's saved schedule + bases (same rules
     as travel.js dayAnchorBase: only a real, addressed base counts; the
     coming-soon office never does). */
  function baseFromSchedule(schedule, bases, weekKey, day) {
    var wk = (schedule && weekKey && schedule[weekKey]) || {};
    var key = wk[day];
    if (key === 'leave') return { status: 'leave', key: key };
    if (!key || key === 'unset' || key === 'office') return { status: 'unset', key: key || null };
    var homes = (bases && Array.isArray(bases.homes)) ? bases.homes : [];
    var b = homes.find(function (h) { return h && h.id === key; }) || null;
    if (!b || !(b.addr || b.suburb)) return { status: 'unset', key: key };
    return { status: 'set', key: key, base: { addr: b.addr || null, suburb: b.suburb || null, label: b.label || 'Base' } };
  }
  /* The selected clinician's base for a day: { status: set|unset|leave|loading|unknown, … }. */
  function clinicianDayBase(day) {
    var c = selectedClinician();
    if (c.own) {
      var st = fn('dayWorkLocationStatus') ? global.dayWorkLocationStatus(day) : 'unknown';
      var wkObj = fn('calendarWeekLocations') ? global.calendarWeekLocations() : {};
      var base = st === 'set' ? global.dayAnchorBase(day) : null;
      return { status: st, key: wkObj ? wkObj[day] : null, base: base ? { addr: base.addr, suburb: base.suburb, label: base.label } : null, own: true, name: c.name };
    }
    var wl = CLINICIAN_WL.get(c.userId);
    if (!wl || wl.loading) { loadClinicianSchedule(c.userId).then(function () { refreshWorkLocationNotice(); }); return { status: 'loading', own: false, name: c.name }; }
    if (wl.error) return { status: 'unknown', own: false, name: c.name };
    var r = baseFromSchedule(wl.schedule, wl.bases, calendarWeekKey(), day);
    r.own = false; r.name = c.name;
    return r;
  }

  /* ─────────────────────── Work-location notice (§4) ─────────────────────── */
  function refreshWorkLocationNotice() {
    var el = $('bsp-wl-notice');
    if (!el) return;
    var day = activeDay();
    if (!panelOpen() || !isClientCategory() || !day) { el.hidden = true; return; }
    var st = clinicianDayBase(day);
    if (st.status !== 'unset') { el.hidden = true; return; }
    var dayName = DAY_NAMES[day] || day;
    el.innerHTML = '<div class="bsp-wl-title">Work location required for Smart Scheduling</div>' +
      (st.own
        ? '<div class="bsp-wl-text">Set your work location for this week so travel and route calculations can be completed (' + esc(dayName) + ' has none).</div>' +
          '<button type="button" class="bsp-wl-btn" data-br="set-weekly">Set weekly location</button>'
        : '<div class="bsp-wl-text">' + esc(st.name) + ' has no work location for ' + esc(dayName) + '. Travel for their bookings can be calculated once they set it in My Profile.</div>');
    el.hidden = false;
  }
  BR.refreshWorkLocationNotice = refreshWorkLocationNotice;

  /* ─────────── Unfinished booking — kept while the location is set ─────────── */
  var DRAFT = null;
  function captureDraft() {
    var b = bookingState() || {};
    var p = selectedPatient();
    var loc = $('bsp-location');
    var day = activeDay();
    var start = ($('bsp-start') || {}).value || '';
    var dur = parseInt(($('bsp-dur-slider') || {}).value || '60', 10) || 60;
    var rs = routeState() || {};
    return {
      savedAt: Date.now(), leaf: b.serviceType || null, cat: b.category || null,
      patientId: p ? String(p.id) : null, day: day, start: start, dur: dur,
      location: loc ? { value: loc.value, placeId: loc.dataset.placeId || '', lat: loc.dataset.lat || '', lng: loc.dataset.lng || '', locId: loc.dataset.locId || '' } : null,
      unsure: !!(($('bsp-location-unsure') || {}).checked), home: HOME.on,
      therapistId: (typeof _bspSelectedTherapist !== 'undefined' && _bspSelectedTherapist) ? _bspSelectedTherapist.id : null,
      context: rs.context || null, manualStart: !!rs.manualStart, travelFrom: b.travelFrom || null,
    };
  }
  function saveDraftAndSetLocation() {
    DRAFT = captureDraft();
    var rs = routeState(); if (rs) rs.keepOnClose = true;
    if (fn('openWorkLocationsForCalendarWeek')) global.openWorkLocationsForCalendarWeek();
    if (rs) setTimeout(function () { rs.keepOnClose = false; }, 0);
  }
  function restoreDraft() {
    var d = DRAFT; DRAFT = null;
    if (!d || (Date.now() - d.savedAt) > DRAFT_TTL_MS || !d.day || !fn('openBookingPanel')) return;
    var parts = (d.start || '09:00').split(':').map(Number);
    var s = parts[0] * 60 + (parts[1] || 0), e = s + d.dur;
    global.openBookingPanel({ day: d.day, date: (typeof DAY_DATES !== 'undefined' && DAY_DATES) ? DAY_DATES[d.day] : null,
      startH: Math.floor(s / 60), startM: s % 60, endH: Math.floor(e / 60), endM: e % 60 });
    setTimeout(function () {
      if (d.therapistId && fn('selectBspTherapist')) global.selectBspTherapist(d.therapistId);
      if (d.leaf && typeof BOOKING_LEAVES !== 'undefined' && BOOKING_LEAVES[d.leaf] && fn('selectBookingLeaf')) global.selectBookingLeaf(d.leaf);
      var rs = routeState(); var b = bookingState();
      if (rs) { rs.context = d.context; rs.manualStart = d.manualStart; }
      if (b && d.travelFrom) b.travelFrom = d.travelFrom;
      LOC.pending = d.home ? null : d.location; LOC.pendingUnsure = d.unsure;
      if (d.patientId) {
        var card = document.querySelector('.patient-card[data-patient-id="' + String(d.patientId).replace(/"/g, '') + '"]');
        if (card) card.click();
      }
      var u = $('bsp-location-unsure'); if (u) { u.checked = !!d.unsure; applyUnsure(); }
      if (d.home) applyHome();
      refreshWorkLocationNotice();
      if (fn('bspTravelPreview')) global.bspTravelPreview();
      toast('Booking restored', 'Your unfinished appointment is back where you left it.');
    }, 90);
  }
  BR.captureDraft = captureDraft;

  /* ─────────────────────── Client location selector (§5–7) ─────────────────── */
  var LOC = { clientId: null, list: [], seq: 0, mode: 'none', label: 'Other', applying: false, pending: null, pendingUnsure: false, patient: null, userPicked: false };
  /* The chosen booking type says not to assume the client's address (a
     telehealth, an MDT/MDU — they can happen from anywhere). */
  function leafNoDefaultAddress() {
    var b = bookingState(); var leaves = (typeof BOOKING_LEAVES !== 'undefined' && BOOKING_LEAVES) || {};
    var leaf = b && b.serviceType ? leaves[b.serviceType] : null;
    return !!(leaf && leaf.noDefaultAddress);
  }

  function sploseFallback(p) {
    var a = p && (p.address || '').trim();
    return a ? [{ id: null, label: 'Home', address: a, source: 'splose' }] : [];
  }
  /* Same normalisation the server dedupes with (client-locations-db.js):
     "12 Example St, Como WA 6152" ≡ "12 Example Street, Como, WA, 6152, Australia". */
  var ABBREV = { st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive', ct: 'court', cres: 'crescent', cr: 'crescent',
    pl: 'place', hwy: 'highway', pde: 'parade', tce: 'terrace', blvd: 'boulevard', bvd: 'boulevard', ln: 'lane', cl: 'close',
    cct: 'circuit', gr: 'grove', sq: 'square', esp: 'esplanade', mt: 'mount', n: 'north', s: 'south', e: 'east', w: 'west' };
  function normAddr(a) {
    var t = String(a || '').toLowerCase().replace(/,?\s*(australia|au)\s*$/, '').replace(/\b(western australia|wa)\b/g, ' ').replace(/[^a-z0-9/ ]+/g, ' ');
    return t.split(/\s+/).filter(Boolean).map(function (w) { return ABBREV[w] || w; }).join(' ');
  }
  BR.normAddr = normAddr;
  /* PURE — merge the server list with the in-memory Splose address, unique by
     normalised address. The fallback is only for when the server could not say
     what Splose holds. */
  function mergeLocations(serverList, fallback) {
    var out = [], seen = {};
    var serverHasSplose = (serverList || []).some(function (l) { return l && l.source === 'splose'; });
    (serverList || []).concat(serverHasSplose ? [] : (fallback || [])).forEach(function (l) {
      if (!l || !l.address) return;
      var k = (l.placeId ? 'p:' + l.placeId : '') || ('a:' + normAddr(l.address));
      var ka = 'a:' + normAddr(l.address);
      if (seen[k] || seen[ka]) return;
      seen[k] = seen[ka] = true;
      out.push(l);
    });
    return out;
  }
  BR.mergeLocations = mergeLocations;
  BR.baseFromSchedule = baseFromSchedule;

  var SOURCE_TEXT = { splose: 'Splose', manual: 'Saved', previous_booking: 'Previously used', portal: 'Portal' };
  function optionText(l) {
    var label = l.source === 'previous_booking' && (!l.label || l.label === 'Previously used') ? 'Previously used' : (l.label || 'Other');
    return label + ' — ' + l.address;
  }

  function renderLocationUI() {
    var sel = $('bsp-loc-select'), input = $('bsp-location'), add = $('bsp-loc-add'), meta = $('bsp-loc-meta');
    if (!sel || !input) return;
    var client = isClientCategory() && LOC.clientId;
    if (!client) {
      LOC.mode = 'none';
      sel.hidden = true; if (add) add.hidden = true; if (meta) { meta.hidden = true; meta.textContent = ''; }
      input.hidden = false; input.placeholder = 'Start typing an address…';
      if (HOME.on) applyHome();
      return;
    }
    // Address is optional for every booking: "No address" means the therapist
    // stays where they were for travel (travel.js).
    var html = '<option value="__none">No address — I stay where I am</option>';
    if (LOC.list.length) {
      html += '<optgroup label="Known locations">' + LOC.list.map(function (l, i) {
        return '<option value="' + i + '" title="' + esc(l.address) + '">' + esc(optionText(l)) + '</option>';
      }).join('') + '</optgroup>';
    } else {
      html += '<option value="" disabled>No known address for this client</option>';
    }
    html += '<option value="__add">+ Add another address</option>';
    sel.innerHTML = html;
    sel.hidden = HOME.on; // Home shows the greyed address, not the picker
  }

  function setMeta(text, kind) {
    var meta = $('bsp-loc-meta'); if (!meta) return;
    meta.hidden = !text; meta.textContent = text || '';
    meta.className = 'bsp-loc-meta' + (kind ? ' ' + kind : '');
  }

  function applySelection(idx) {
    var input = $('bsp-location'), sel = $('bsp-loc-select'), add = $('bsp-loc-add');
    var l = LOC.list[idx];
    if (!input || !l) return;
    LOC.mode = 'select';
    LOC.selIdx = idx;
    if (sel) sel.value = String(idx);
    if (add) add.hidden = true;
    input.hidden = true;
    LOC.applying = true;
    input.value = l.address;
    input.dataset.placeId = l.placeId || '';
    if (l.lat != null && l.lng != null) { input.dataset.lat = String(l.lat); input.dataset.lng = String(l.lng); } else { delete input.dataset.lat; delete input.dataset.lng; }
    input.dataset.locId = l.id || '';
    input.dataset.locSource = l.source || '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    LOC.applying = false;
    setMeta((SOURCE_TEXT[l.source] || 'Saved') + ' · ' + l.address);
  }

  function applyNone() {
    var input = $('bsp-location'), sel = $('bsp-loc-select'), add = $('bsp-loc-add');
    if (!input) return;
    LOC.mode = 'noaddr';
    if (sel) sel.value = '__none';
    if (add) add.hidden = true;
    input.hidden = true;
    LOC.applying = true;
    input.value = '';
    ['placeId', 'lat', 'lng', 'locId', 'locSource'].forEach(function (k) { delete input.dataset[k]; });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    LOC.applying = false;
    setMeta('No address — travel treats you as staying where you were before this.');
  }
  /* The booking type changed: re-pick the default unless the therapist chose. */
  function relevelLocationDefault() {
    if (HOME.on) return;
    if (LOC.userPicked || !LOC.clientId || !isClientCategory()) return;
    if (LOC.mode !== 'select' && LOC.mode !== 'noaddr') return;
    if (leafNoDefaultAddress()) { if (LOC.mode !== 'noaddr') applyNone(); }
    else if (LOC.mode === 'noaddr' && LOC.list.length) applySelection(0);
  }

  function enterAddMode() {
    var input = $('bsp-location'), add = $('bsp-loc-add'), sel = $('bsp-loc-select');
    if (!input) return;
    LOC.mode = 'add';
    if (sel) sel.value = '__add';
    input.hidden = false;
    LOC.applying = true;
    input.value = '';
    ['placeId', 'lat', 'lng', 'locId', 'locSource'].forEach(function (k) { delete input.dataset[k]; });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    LOC.applying = false;
    input.placeholder = 'Search Google for the address…';
    if (add) { add.hidden = false; renderLabelChips(); }
    setMeta('Pick a Google suggestion to save it to this client for next time.');
    setTimeout(function () { try { input.focus(); } catch (e) { /* hidden */ } }, 0);
  }

  function renderLabelChips() {
    var add = $('bsp-loc-add'); if (!add) return;
    add.innerHTML = '<span class="bsp-loc-add-lbl">Label</span>' + LABELS.map(function (l) {
      return '<button type="button" class="bsp-loc-chip' + (l === LOC.label ? ' on' : '') + '" data-br-label="' + esc(l) + '">' + esc(l) + '</button>';
    }).join('');
  }

  async function loadClientLocations(p) {
    var mySeq = ++LOC.seq;
    LOC.patient = p;
    LOC.list = sploseFallback(p);
    renderLocationUI();
    restoreOrDefault();
    setMeta(LOC.list.length ? 'Splose · ' + LOC.list[0].address + ' · checking saved locations…' : 'Checking saved locations…');
    if (HOME.on) applyHome();
    var server = null, failed = false;
    try {
      var j = await getJson('/api/client-locations/' + encodeURIComponent(p.id));
      server = j.locations || [];
    } catch (e) { failed = true; }
    if (mySeq !== LOC.seq) return;
    var keepAddr = LOC.mode === 'select' ? ($('bsp-location') || {}).value : null;
    var wasAdd = LOC.mode === 'add';
    LOC.list = mergeLocations(server || [], sploseFallback(p));
    renderLocationUI();
    if (wasAdd) { $('bsp-loc-select').value = '__add'; if (HOME.on) applyHome(); return; }
    var idx = keepAddr ? LOC.list.findIndex(function (l) { return canon(l.address) === canon(keepAddr); }) : -1;
    if (!restoreOrDefault(idx)) {
      if (!LOC.list.length) enterAddMode();
    }
    if (failed) setMeta('Saved locations are unavailable right now — the Splose address is still here.', 'muted');
    if (HOME.on) applyHome();
  }

  /* Re-select a draft's location, else the given index, else the first. True if one was applied. */
  function restoreOrDefault(idx) {
    if (LOC.pending && LOC.pending.value) {
      var pend = LOC.pending;
      var i = LOC.list.findIndex(function (l) { return canon(l.address) === canon(pend.value); });
      if (i >= 0) { LOC.pending = null; applySelection(i); return true; }
      enterAddMode();
      var input = $('bsp-location'); if (input) { input.value = pend.value; if (pend.lat) { input.dataset.lat = pend.lat; input.dataset.lng = pend.lng; } }
      LOC.pending = null;
      return true;
    }
    if (idx != null && idx >= 0) { applySelection(idx); return true; }
    if (LOC.mode === 'noaddr' && LOC.userPicked) { applyNone(); return true; }
    if (leafNoDefaultAddress()) { applyNone(); return true; }
    if (LOC.list.length) { applySelection(0); return true; }
    return false;
  }

  async function saveNewLocation() {
    var input = $('bsp-location'); var p = LOC.patient;
    if (!input || !p || !input.value.trim()) return;
    var body = { address: input.value.trim(), label: LOC.label, placeId: input.dataset.placeId || undefined,
                 lat: input.dataset.lat ? Number(input.dataset.lat) : undefined, lng: input.dataset.lng ? Number(input.dataset.lng) : undefined };
    var clientId = String(p.id);
    setMeta('Saving to ' + (p.first || 'the client') + '’s locations…');
    var res;
    try { res = await postJson('/api/client-locations/' + encodeURIComponent(clientId), body); }
    catch (e) { setMeta('Couldn’t save it for next time — this booking still uses it.', 'warn'); return; }
    if (LOC.clientId !== clientId) return;
    var typed = body.address;
    if (res.duplicate && res.of === 'splose') {
      var si = LOC.list.findIndex(function (l) { return l.source === 'splose'; });
      if (si >= 0) { applySelection(si); setMeta('Already on file in Splose — selected.'); return; }
    }
    var saved = res.location;
    if (saved) {
      LOC.list = mergeLocations([saved].concat(LOC.list.filter(function (l) { return !(l.id && l.id === saved.id); })), []);
      renderLocationUI();
      var ni = LOC.list.findIndex(function (l) { return l.id === saved.id; });
      applySelection(ni >= 0 ? ni : 0);
      setMeta(res.duplicate ? 'Already saved as ' + saved.label + ' — selected.' : 'Saved as ' + saved.label + ' for next time · ' + saved.address);
    } else {
      setMeta('Using ' + typed + '.');
    }
  }

  function applyUnsure() {
    var u = $('bsp-location-unsure'), sel = $('bsp-loc-select'), input = $('bsp-location');
    var on = !!(u && u.checked);
    if (on && HOME.on) releaseHome();
    if (!on && HOME.on) return; // Home keeps its greyed address
    if (sel) sel.disabled = on;
    if (input) input.disabled = on;
    var field = document.querySelector('.bsp-loc-field');
    if (field) field.classList.toggle('is-unsure', on);
    if (on) setMeta('Smart Travel can’t calculate travel until a location is provided — set it on the calendar later.', 'warn');
    else if (LOC.mode === 'select') { var sv = sel && sel.value; if (sv && sv !== '__add' && sv !== '__none') applySelection(Number(sv)); }
    else if (LOC.mode === 'noaddr') applyNone();
    else setMeta('');
  }

  /* ─────────── Home — "this one happens at home" (18 Oct 2026) ───────────
     One chip for every booking type: the address becomes the selected
     clinician's home base for the booking's day, shown greyed so they can see
     the right home was picked up. The underlying choice (client location,
     No address, a typed address) is left alone and comes back on release. */
  var HOME = { on: false };
  function homeBtn() { return $('bsp-loc-home'); }
  function paintHome(on) {
    var b = homeBtn(); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    var field = document.querySelector('.bsp-loc-field'); if (field) field.classList.toggle('is-home', on);
  }
  /* PURE-ish — the home address for the booking's day, or why there is none. */
  function homeForDay(day) {
    var st = clinicianDayBase(day || activeDay() || 'mon');
    if (st.status === 'set' && st.base && (st.base.addr || st.base.suburb)) {
      return { ok: true, addr: st.base.addr || st.base.suburb, label: st.base.label || 'Home', own: st.own, name: st.name };
    }
    var who = st.own === false ? (st.name || 'this clinician') + ' has' : 'You have';
    var why = st.status === 'loading' ? 'Checking ' + (st.name || 'the clinician') + '’s work locations…'
      : st.status === 'leave' ? 'That day is marked as leave — there is no home base to use.'
      : who + ' no home base set for ' + (DAY_NAMES[day] || 'that day') + ' — set it in weekly work locations.';
    return { ok: false, why: why };
  }
  function applyHome() {
    var input = $('bsp-location'), sel = $('bsp-loc-select'), add = $('bsp-loc-add'), u = $('bsp-location-unsure');
    if (!input) return false;
    var day = activeDay();
    var h = homeForDay(day);
    if (!h.ok) { if (HOME.on) releaseHome(); paintHome(false); setMeta(h.why, 'warn'); return false; }
    HOME.on = true;
    if (u && u.checked) { u.checked = false; var f = document.querySelector('.bsp-loc-field'); if (f) f.classList.remove('is-unsure'); if (sel) sel.disabled = false; }
    if (sel) sel.hidden = true;
    if (add) add.hidden = true;
    input.hidden = false;
    input.disabled = true;
    LOC.applying = true;
    input.value = h.addr;
    ['placeId', 'lat', 'lng', 'locId'].forEach(function (k) { delete input.dataset[k]; });
    input.dataset.locSource = 'home';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    LOC.applying = false;
    paintHome(true);
    setMeta('Home · ' + h.label + ' — ' + (h.own === false ? h.name + '’s' : 'your') + ' base for ' + (DAY_NAMES[day] || 'this day') + '.');
    return true;
  }
  /* Back to whatever the field held before Home. */
  function releaseHome() {
    var input = $('bsp-location'), sel = $('bsp-loc-select');
    HOME.on = false;
    paintHome(false);
    if (!input) return;
    input.disabled = false;
    if (input.dataset.locSource === 'home') { input.value = ''; delete input.dataset.locSource; }
    if (isClientCategory() && LOC.clientId) {
      renderLocationUI();
      if (LOC.mode === 'add') { if (sel) sel.value = '__add'; enterAddMode(); }
      else if (LOC.mode === 'select' && LOC.selIdx != null && LOC.list[LOC.selIdx]) applySelection(LOC.selIdx);
      else if (LOC.mode === 'noaddr' || !restoreOrDefault()) applyNone();
    } else {
      input.hidden = false;
      LOC.applying = true; input.dispatchEvent(new Event('change', { bubbles: true })); LOC.applying = false;
      setMeta('');
    }
  }
  function resetHome() { if (HOME.on) releaseHome(); else paintHome(false); }
  BR.applyHome = applyHome;
  BR.releaseHome = releaseHome;
  BR.homeOn = function () { return HOME.on; };

  function onPatientMaybeChanged() {
    var p = isClientCategory() ? selectedPatient() : null;
    var id = p ? String(p.id) : null;
    if (id === LOC.clientId) { renderLocationUIIfNeeded(); return; }
    LOC.clientId = id;
    LOC.userPicked = false;
    if (!id) {
      LOC.list = []; LOC.patient = null; LOC.mode = 'none';
      renderLocationUI(); setMeta('');
      return;
    }
    loadClientLocations(p);
    if (LOC.pendingUnsure) { var u = $('bsp-location-unsure'); if (u) { u.checked = true; } LOC.pendingUnsure = false; applyUnsure(); }
  }
  function renderLocationUIIfNeeded() { if (!isClientCategory()) { LOC.clientId = null; renderLocationUI(); } }

  /* ───────────────────── Post-booking continuation (§8–22) ───────────────────── */
  function sessionFor(info) {
    if (!info || !global.SESSIONS) return null;
    return Object.values(global.SESSIONS).find(function (s) { return s && info.dbId && String(s.dbId) === String(info.dbId) && !s.cancelled; }) || null;
  }
  function laterSessionsOnDay(info) {
    var f = fn('sessionsForDay'); if (!f) return [];
    return f(info.day).filter(function (s) { return String(s.dbId) !== String(info.dbId) && global.sessionStartMin(s) >= info.endMin && !(fn('isTravelBlock') && global.isTravelBlock(s)); });
  }

  var NEXT = null; // the open continuation dialog

  function closeNext() {
    if (!NEXT) return;
    document.removeEventListener('keydown', NEXT.onKey, true);
    NEXT.el.remove();
    document.body.classList.remove('pd-open');
    NEXT = null;
  }

  function nextUi() {
    var box = NEXT && NEXT.el;
    return {
      msg: function (html, kind) { var m = box && box.querySelector('.br-msg'); if (!m) return; m.hidden = !html; m.className = 'br-msg' + (kind ? ' ' + kind : ''); m.innerHTML = html || ''; },
      busy: function (on) { if (box) box.querySelectorAll('button').forEach(function (b) { if (!b.hasAttribute('data-keep')) b.disabled = !!on; }); },
    };
  }

  function showContinuation(info) {
    closeNext();
    var el = document.createElement('div');
    el.className = 'pd-backdrop br-next-backdrop';
    var who = info.patientName || 'the client';
    el.innerHTML = '<section class="pd-dialog br-next" role="dialog" aria-modal="true" aria-labelledby="br-next-title">' +
      '<div class="pd-head"><h2 class="pd-title" id="br-next-title">What would you like to do next?</h2></div>' +
      '<div class="pd-body">' +
        '<p class="br-sub">' + esc(who) + ' · ' + esc(DAY_NAMES[info.day] || info.day) + ' ' + esc(fmt(info.startMin)) + '–' + esc(fmt(info.endMin)) + ' is booked.</p>' +
        '<div class="br-choices">' +
          (alreadyHome(info) ? '' : '<button type="button" class="br-choice" data-next="home"><strong>Return Home</strong><span>Drive back to your base after this session</span></button>') +
          '<button type="button" class="br-choice" data-next="another"><strong>Book Another Client</strong><span>The next appointment starts after the drive</span></button>' +
          '<button type="button" class="br-choice" data-next="elsewhere"><strong>Go Somewhere Else</strong><span>Hospital, school, office, supplier, meeting…</span></button>' +
        '</div>' +
        '<div class="br-elsewhere" hidden></div>' +
        '<div class="br-msg" hidden></div>' +
      '</div>' +
      '<div class="pd-foot"><button type="button" class="pd-btn" data-next="done" data-keep>Done</button></div>' +
    '</section>';
    document.body.appendChild(el);
    document.body.classList.add('pd-open');
    NEXT = { el: el, info: info, onKey: function (e) { if (e.key === 'Escape') { e.preventDefault(); closeNext(); } } };
    document.addEventListener('keydown', NEXT.onKey, true);
    el.addEventListener('mousedown', function (e) { if (e.target === el) closeNext(); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-next]'); if (!b || b.disabled) return;
      var what = b.getAttribute('data-next');
      if (what === 'done') closeNext();
      else if (what === 'home') returnHome(info);
      else if (what === 'another') bookAnother(info);
      else if (what === 'elsewhere') showElsewhere(info);
      else if (what === 'set-weekly') { closeNext(); if (fn('openWorkLocationsForCalendarWeek')) global.openWorkLocationsForCalendarWeek(); }
      else if (what === 'back') backToChoices();
    });
    var first = el.querySelector('.br-choice'); if (first) first.focus();
  }
  BR.showContinuation = showContinuation;

  /* Already home after this session? A booking with no address (a
     telehealth) leaves the clinician where they were; when the day's travel
     before it ends at the day's home, "Return Home" is no choice — the
     choices are another booking, somewhere else, or Done (11 Oct 2026). */
  function alreadyHome(info) {
    if (!info || info.unsure) return false;
    var st = clinicianDayBase(info.day);
    if (!st.own || st.status !== 'set' || !st.base) return false;
    var home = canon(st.base.addr || st.base.suburb || '');
    // Booked at home (the Home chip, 18 Oct 2026): already there.
    if (info.location) return !!home && canon(info.location) === home;
    if (!home || !fn('computeDayTravelSegments')) return false;
    var legs = global.computeDayTravelSegments(info.day).filter(function (x) {
      return x.kind !== 'gap' && x.travelMin > 0 && x.endMin <= info.startMin;
    }).sort(function (a, b) { return a.endMin - b.endMin; });
    // No drive yet today: the day has not left its start point.
    if (!legs.length) return true;
    var to = legs[legs.length - 1].toLoc || {};
    return canon(to.address || to.addr || to.suburb || '') === home;
  }
  BR.alreadyHome = alreadyHome;

  function backToChoices() {
    if (!NEXT) return;
    NEXT.el.querySelector('.br-choices').hidden = false;
    NEXT.el.querySelector('.br-elsewhere').hidden = true;
    nextUi().msg('');
  }

  /* Route the leg leaving the booked session. Resolves the routed result, or
     null when the session has no location (Unsure) — and throws on failure,
     so a failed lookup is never saved as an invented duration. */
  async function routeFrom(info, destAddr, fresh) {
    if (info.unsure || !info.location) return null;
    var r = await global.fetchRoute(info.location, destAddr, 'driving', { departureTime: perthIso(info.day, info.endMin), fresh: !!fresh });
    if (!r || r.source !== 'routes-api') { var e = new Error('route_failed'); e.route = true; throw e; }
    return r;
  }

  /* Save the session's "after" answer: the travel leg the calendar draws. */
  async function saveAfter(info, spec, doneText, ui) {
    var s = sessionFor(info);
    if (!s) { ui.busy(false); ui.msg('The appointment is still saving — try again in a moment.', 'warn'); return false; }
    var ok = await global.setTravelOverride(s.id, 'after', spec);
    // With another appointment later that day (6 Oct 2026) the answer is the
    // way to it as well: Return Home = home in between; Go Somewhere Else =
    // via that place, so any earlier Direct / Home choice is cleared.
    var later = laterSessionsOnDay(info);
    if (ok && later.length && fn('setBetweenTravel')) {
      var cur = sessionFor(info) || s;
      if (spec.purpose === 'home') ok = await global.setBetweenTravel(cur.id, 'home');
      else if (spec.purpose === 'elsewhere' && cur.travel && cur.travel.next) ok = await global.setBetweenTravel(cur.id, null);
    }
    ui.busy(false);
    if (!ok) { ui.msg('Couldn’t save the travel leg. The appointment itself is booked.', 'error'); return false; }
    closeNext();
    toast(doneText, later.length ? 'The calendar routes the drive there before the next appointment.' : '');
    return true;
  }

  async function returnHome(info, retry) {
    var ui = nextUi();
    var st = clinicianDayBase(info.day);
    if (st.status === 'loading') { ui.msg('Loading the clinician’s work locations…'); setTimeout(function () { returnHome(info); }, 400); return; }
    if (st.status !== 'set' || !st.base || !(st.base.addr || st.base.suburb)) {
      ui.msg(st.own
        ? '<strong>No home/base set for ' + esc(DAY_NAMES[info.day] || info.day) + '.</strong> Set your weekly location so the drive home can be calculated. <button type="button" class="pd-btn" data-next="set-weekly">Set weekly location</button>'
        : '<strong>' + esc(st.name) + ' has no base set for ' + esc(DAY_NAMES[info.day] || info.day) + '.</strong> They can add it in My Profile › Work locations.', 'warn');
      return;
    }
    var destAddr = st.base.addr || st.base.suburb;
    var spec = st.own ? { kind: 'base', id: st.key, purpose: 'home' }
                      : { kind: 'address', address: destAddr, suburb: st.base.suburb || undefined, label: st.base.label || 'Home', purpose: 'home' };
    ui.busy(true); ui.msg('<span class="bsp-route-spin" aria-hidden="true"></span>Calculating travel home…');
    var r;
    try { r = await routeFrom(info, destAddr, retry); }
    catch (e) {
      ui.busy(false);
      ui.msg('<strong>Unable to calculate travel right now.</strong> <button type="button" class="pd-btn" data-br-act="home-retry">Retry</button> <button type="button" class="pd-btn" data-br-act="home-plain">Save without travel time</button>', 'error');
      NEXT.retry = { home: function () { returnHome(info, true); }, plain: function () { ui.busy(true); saveAfter(info, spec, 'Return home saved', ui); } };
      return;
    }
    if (r) { spec.travelMin = r.durationMin; spec.distanceMeters = r.distanceMeters || 0; spec.routedAt = new Date().toISOString(); }
    var label = st.base.label || 'home';
    saveAfter(info, spec, r ? 'Travel home added · ' + r.durationMin + ' min to ' + label : 'Return home saved — travel calculates once the session has a location', ui);
  }

  function bookAnother(info) {
    closeNext();
    var s = sessionFor(info);
    var rs = routeState();
    var ctx = {
      sessionId: s ? s.id : null, dbId: info.dbId, day: info.day, endMin: info.endMin,
      address: info.unsure ? null : (info.location || null),
      suburb: info.suburb || (info.location && fn('addrSuburb') ? global.addrSuburb(info.location) : ''),
      label: info.patientName || 'previous client', patientId: info.patientId || null,
      therapistId: info.therapistId || null, travelMin: null,
    };
    if (rs) { rs.context = ctx; rs.manualStart = false; rs.manualTiming = false; rs.lastClamp = null; rs.squeeze = null; }
    var start = global.ceilToSlot ? global.ceilToSlot(info.endMin) : info.endMin;
    var end = start + (info.durationMin || 60);
    global.openBookingPanel({ day: info.day, date: (typeof DAY_DATES !== 'undefined' && DAY_DATES) ? DAY_DATES[info.day] : null,
      startH: Math.floor(start / 60), startM: start % 60, endH: Math.floor(end / 60), endM: end % 60 });
    setTimeout(function () {
      var b = bookingState();
      if (b) b.travelFrom = ctx;
      if (rs) rs.context = ctx;
      // Only the route carries over (travelling from the last client). The
      // client and booking type are chosen afresh — nothing from the last
      // booking is pre-selected (5 Oct 2026); the client list is shown.
      if (fn('selectBookingCat')) global.selectBookingCat('client');
      var text = $('bsp-prefill-text'), strip = $('bsp-prefill-strip');
      if (text && strip) { strip.style.display = 'flex'; text.textContent = 'After ' + ctx.label + ' · finishes ' + fmt(info.endMin) + ' — pick the next client'; }
      if (fn('bspTravelPreview')) global.bspTravelPreview();
      var search = $('patient-search'); if (search) { try { search.focus(); } catch (e) { /* ignore */ } }
    }, 60);
  }

  async function showElsewhere(info) {
    if (!NEXT) return;
    var box = NEXT.el.querySelector('.br-elsewhere');
    NEXT.el.querySelector('.br-choices').hidden = true;
    nextUi().msg('');
    box.hidden = false;
    box.innerHTML = '<div class="br-else-title">Where are you going next?</div>' +
      '<div class="br-else-list" role="list"><div class="br-else-empty">Loading your places…</div></div>' +
      '<label class="br-else-field">New destination<input type="text" id="br-else-addr" autocomplete="off" placeholder="Search Google for a place or address…"></label>' +
      '<label class="br-else-field">Name <span class="bsp-optional">(optional)</span><input type="text" id="br-else-name" maxlength="80" placeholder="e.g. Fiona Stanley Hospital"></label>' +
      '<div class="br-else-actions"><button type="button" class="pd-btn" data-next="back">Back</button><button type="button" class="pd-btn pd-btn-primary" data-br-act="else-go" disabled>Go here</button></div>';
    var addr = box.querySelector('#br-else-addr'), name = box.querySelector('#br-else-name'), go = box.querySelector('[data-br-act="else-go"]');
    var picked = null;
    if (fn('attachPlacesAutocomplete')) {
      global.attachPlacesAutocomplete(addr, function (a, lat, lng, placeId) {
        picked = { address: a, lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null, placeId: placeId || addr.dataset.placeId || null,
                   name: addr.dataset.placeName || '' };
        go.disabled = false;
        if (!name.value) name.placeholder = picked.name || a.split(',')[0];
      });
    }
    addr.addEventListener('input', function () { picked = null; go.disabled = addr.value.trim().length < 4; });
    go.addEventListener('click', function () {
      var a = addr.value.trim(); if (!a) return;
      var dest = picked && picked.address === a ? picked : { address: a, placeId: null, lat: null, lng: null };
      dest.label = name.value.trim() || (dest.name || '') || a.split(',')[0];
      goElsewhere(info, Object.assign({ kind: 'address' }, dest));
    });

    // Remembered destinations + known work places (own clinician only).
    var items = [];
    try { var j = await getJson('/api/travel-destinations'); (j.destinations || []).forEach(function (d) { items.push({ kind: 'address', id: d.id, label: d.label, address: d.address, placeId: d.placeId, lat: d.lat, lng: d.lng, tag: 'Recent' }); }); }
    catch (e) { /* remembered places unavailable — typing still works */ }
    if (selectedClinician().own && typeof LOCATIONS !== 'undefined' && fn('getBase')) {
      if (fn('rebuildLocationCatalogue')) global.rebuildLocationCatalogue();
      Object.keys(LOCATIONS).forEach(function (k) {
        if (k === 'leave' || k === 'unset' || LOCATIONS[k].comingSoon) return;
        var b = global.getBase(k);
        if (b && (b.addr || b.suburb) && b.kind !== 'remote') items.push({ kind: 'base', baseId: k, label: LOCATIONS[k].label || b.label || k, address: b.addr || b.suburb, tag: 'Work location' });
      });
    }
    if (!NEXT) return;
    var list = box.querySelector('.br-else-list');
    list.innerHTML = items.length ? items.map(function (it, i) {
      return '<button type="button" class="br-else-item" role="listitem" data-else="' + i + '"><strong>' + esc(it.label) + '</strong><span>' + esc(it.address) + '</span><em>' + esc(it.tag) + '</em></button>';
    }).join('') : '<div class="br-else-empty">No saved places yet — search for one below. It will be remembered.</div>';
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-else]'); if (!b) return;
      goElsewhere(info, items[Number(b.getAttribute('data-else'))]);
    });
    addr.focus();
  }

  async function goElsewhere(info, dest, retry) {
    var ui = nextUi();
    ui.busy(true); ui.msg('<span class="bsp-route-spin" aria-hidden="true"></span>Calculating travel to ' + esc(dest.label) + '…');
    var spec = dest.kind === 'base'
      ? { kind: 'base', id: dest.baseId, purpose: 'elsewhere' }
      : { kind: 'address', address: dest.address, label: dest.label, purpose: 'elsewhere' };
    if (dest.kind !== 'base') {
      if (dest.placeId) spec.placeId = dest.placeId;
      if (dest.lat != null && dest.lng != null) { spec.lat = dest.lat; spec.lng = dest.lng; }
      if (fn('addrSuburb')) { var sub = global.addrSuburb(dest.address); if (sub) spec.suburb = sub; }
    }
    var r;
    try { r = await routeFrom(info, dest.address, retry); }
    catch (e) {
      ui.busy(false);
      ui.msg('<strong>Unable to calculate travel right now.</strong> <button type="button" class="pd-btn" data-br-act="else-retry">Retry</button> <button type="button" class="pd-btn" data-br-act="else-plain">Save without travel time</button>', 'error');
      NEXT.retry = { elsewhere: function () { goElsewhere(info, dest, true); }, plain: function () { ui.busy(true); finishElsewhere(info, dest, spec, null, ui); } };
      return;
    }
    finishElsewhere(info, dest, spec, r, ui);
  }
  async function finishElsewhere(info, dest, spec, r, ui) {
    if (r) { spec.travelMin = r.durationMin; spec.distanceMeters = r.distanceMeters || 0; spec.routedAt = new Date().toISOString(); }
    // Remember a non-client destination for next time (never tied to a client).
    if (dest.kind !== 'base') {
      try {
        var saved = await postJson('/api/travel-destinations', { address: dest.address, label: dest.label, placeId: dest.placeId || undefined, lat: dest.lat == null ? undefined : dest.lat, lng: dest.lng == null ? undefined : dest.lng });
        if (saved && saved.destination && saved.destination.id) spec.destinationId = saved.destination.id;
      } catch (e) { /* remembering is a convenience; the leg still saves */ }
    }
    saveAfter(info, spec, r ? 'Travel to ' + dest.label + ' added · ' + r.durationMin + ' min' : 'Destination saved — travel calculates once the session has a location', ui);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-br-act]');
    if (!b || !NEXT || !NEXT.retry) return;
    var act = b.getAttribute('data-br-act');
    if (act === 'home-retry' && NEXT.retry.home) NEXT.retry.home();
    if (act === 'else-retry' && NEXT.retry.elsewhere) NEXT.retry.elsewhere();
    if ((act === 'home-plain' || act === 'else-plain') && NEXT.retry.plain) NEXT.retry.plain();
  });

  /* Called by confirmBooking once a CLIENT appointment is saved. */
  function onBookingCreated(info) {
    if (!info) return;
    if (info.locId && info.patientId) {
      postJson('/api/client-locations/' + encodeURIComponent(info.patientId) + '/' + encodeURIComponent(info.locId) + '/used', {}).catch(function () {});
    }
    if (!info.dbId) return; // not saved — nothing to chain from
    setTimeout(function () { showContinuation(info); }, 120);
  }
  global.onBookingCreated = onBookingCreated;
  BR.onBookingCreated = onBookingCreated;

  /* ───────────────────── Dragging the proposed appointment (§17) ─────────────────────
     The proposal moves on the 15-minute grid. Later is always allowed; earlier
     than the drive allows is clamped by the planner with a warning. */
  var PDRAG = null;
  document.addEventListener('pointerdown', function (e) {
    var blk = e.target && e.target.closest && e.target.closest('.cal-preview-block');
    if (!blk || e.button !== 0 || !panelOpen()) return;
    var col = blk.parentElement;
    var top = col.getBoundingClientRect().top;
    PDRAG = { blk: blk, col: col, startY: e.clientY, grab: e.clientY - blk.getBoundingClientRect().top, moved: false, colTop: top };
    e.stopPropagation(); e.preventDefault();
    try { blk.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!PDRAG) return;
    if (!PDRAG.moved && Math.abs(e.clientY - PDRAG.startY) < 5) return;
    PDRAG.moved = true;
    var min = fn('calYToMinutes') ? global.calYToMinutes(PDRAG.col, e.clientY - PDRAG.grab) : null;
    if (min == null) return;
    PDRAG.min = min;
    PDRAG.blk.style.top = (fn('calMinutesToY') ? global.calMinutesToY(min) : 0) + 'px';
    PDRAG.blk.classList.add('dragging');
  }, true);
  document.addEventListener('pointerup', function () {
    var d = PDRAG; PDRAG = null;
    if (!d) return;
    d.blk.classList.remove('dragging');
    if (!d.moved || d.min == null) return;
    var st = $('bsp-start');
    if (st) { st.value = hhmm(d.min); if (fn('bspOnStartChange')) global.bspOnStartChange(); }
  }, true);

  /* ───────────────────────────── Wiring ───────────────────────────── */
  var wired = false;
  function wire() {
    if (wired) return; // DOMContentLoaded and a late load must not double every listener
    wired = true;
    var sel = $('bsp-loc-select'), input = $('bsp-location'), add = $('bsp-loc-add'), unsure = $('bsp-location-unsure');
    if (sel) sel.addEventListener('change', function () {
      LOC.userPicked = true;
      if (sel.value === '__add') enterAddMode();
      else if (sel.value === '__none') applyNone();
      else if (sel.value !== '') applySelection(Number(sel.value));
    });
    if (add) add.addEventListener('click', function (e) {
      var c = e.target.closest('[data-br-label]'); if (!c) return;
      LOC.label = c.getAttribute('data-br-label'); renderLabelChips();
    });
    if (input) input.addEventListener('change', function () {
      if (LOC.applying || LOC.mode !== 'add') return;
      // A Google pick carries coordinates/place id — that is what gets saved.
      if (input.dataset.placeId || input.dataset.lat) saveNewLocation();
    });
    if (unsure) unsure.addEventListener('change', applyUnsure);
    var hb = homeBtn();
    if (hb) hb.addEventListener('click', function () { if (HOME.on) releaseHome(); else applyHome(); });
    var start = $('bsp-start');
    if (start) start.addEventListener('blur', function () {
      // Typed times land on the 15-minute grid like every calendar gesture —
      // once the field is left. Chrome fires 'change' on every keystroke in a
      // time field, so snapping there turned the "4" of "45" into :00 and no
      // minute could be typed (11 Oct 2026). While typing, the calendar block
      // follows each keystroke through the field's own oninput.
      var parts = (start.value || '').split(':').map(Number);
      if (parts.length < 2 || !Number.isFinite(parts[0])) return;
      var m = parts[0] * 60 + (parts[1] || 0);
      var snapped = Math.min(23 * 60 + 45, Math.round(m / 15) * 15);
      if (snapped !== m) { start.value = hhmm(snapped); if (fn('bspOnStartChange')) global.bspOnStartChange(); }
    });
    var wl = $('bsp-wl-notice');
    if (wl) wl.addEventListener('click', function (e) { if (e.target.closest('[data-br="set-weekly"]')) saveDraftAndSetLocation(); });

    wrapGlobal('renderRightContext', onPatientMaybeChanged);
    wrapGlobal('selectBookingCat', function () { onPatientMaybeChanged(); relevelLocationDefault(); refreshWorkLocationNotice(); });
    wrapGlobal('bspSelectDay', function () { refreshWorkLocationNotice(); if (HOME.on) applyHome(); });
    wrapGlobal('selectBspTherapist', function () {
      var c = selectedClinician();
      if (!c.own) loadClinicianSchedule(c.userId).then(function () { refreshWorkLocationNotice(); if (HOME.on) applyHome(); if (fn('bspTravelPreview')) global.bspTravelPreview(); });
      refreshWorkLocationNotice();
      if (HOME.on) applyHome();
      if (fn('bspTravelPreview')) global.bspTravelPreview();
    });
    // A keepState open (a re-pick on the grid while the panel is open, or the
    // navigation restore) keeps the client's chosen location: skip only the
    // forced reset — the day's notice and Unsure still refresh (10 Oct 2026).
    wrapGlobal('openBookingPanel', function (o) {
      var keep = !!(o && o.keepState);
      setTimeout(function () { if (!keep) { resetHome(); LOC.clientId = '__reset'; } onPatientMaybeChanged(); refreshWorkLocationNotice(); applyUnsure(); }, 40);
    });
    wrapGlobal('closeBookingPanel', function () {
      var rs = routeState();
      if (!(rs && rs.keepOnClose)) resetHome();
      if (rs && !rs.keepOnClose) { rs.context = null; rs.manualStart = false; rs.manualTiming = false; rs.lastClamp = null; rs.squeeze = null; rs.viaMode = 'auto'; var b = bookingState(); if (b) b.travelFrom = null; }
      if (fn('setBspRouteStatus')) global.setBspRouteStatus('hidden');
      var n = $('bsp-wl-notice'); if (n) n.hidden = true;
    });

    // Back on the calendar with an unfinished booking → reopen it.
    var cal = $('view-calendar');
    if (cal && typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (DRAFT && cal.classList.contains('active') && !panelOpen()) setTimeout(restoreDraft, 120);
      }).observe(cal, { attributes: true, attributeFilter: ['class'] });
    }
  }
  /* ─────────── MMM zone — where the session happens (10 Oct 2026) ───────────
     The NDIS price limit follows the Modified Monash zone of the session's
     address. The server looks the address up in its built-in MMM 2023 table
     (POST /api/mmm-zone/lookup — no client data, nothing saved) and the panel
     shows the zone under the address; the clinician can change it. The value
     goes with Create appointment and the server keeps it only when it differs
     from what the address says. Watched by polling the address value, because
     the selector, Places and the draft restore all set it programmatically. */
  var MMM = { addr: null, seq: 0, picked: false, lookup: null };
  function mmmVisible() {
    var input = $('bsp-location'), unsure = $('bsp-location-unsure');
    return !!(input && panelOpen() && selectedPatient() && input.value.trim() && !(unsure && unsure.checked));
  }
  function renderMmm() {
    var box = $('bsp-mmm'), sel = $('bsp-mmm-zone'), note = $('bsp-mmm-note');
    if (!box || !sel || !note) return;
    var lk = MMM.lookup;
    if (!mmmVisible() || !lk) { box.hidden = true; return; }
    var cur = MMM.picked ? sel.value : (lk.confident ? String(lk.zone) : '');
    sel.innerHTML = (lk.confident ? '' : '<option value="">Choose zone…</option>') +
      [1, 2, 3, 4, 5, 6, 7].map(function (z) { return '<option value="' + z + '"' + (String(z) === cur ? ' selected' : '') + '>MM' + z + '</option>'; }).join('');
    var where = lk.locality ? lk.locality + (lk.postcode ? ' ' + lk.postcode : '') : (lk.postcode || '');
    var text, warn = false;
    if (MMM.picked && cur && (!lk.confident || cur !== String(lk.zone))) {
      text = 'Changed by you' + (lk.confident ? ' — the address says MM' + lk.zone : '') + '.';
    } else if (lk.confident) {
      text = 'From ' + (where || 'the address') + ' · NDIS MMM 2023';
    } else {
      warn = true;
      text = (lk.reason ? lk.reason.charAt(0).toUpperCase() + lk.reason.slice(1) : 'Address not recognised') +
        (lk.zones && lk.zones.length ? ' (MM' + lk.zones.join(' or MM') + ')' : '') + '. Choose a zone, or invoicing will ask for one.';
    }
    note.textContent = text;
    note.classList.toggle('warn', warn);
    box.hidden = false;
  }
  function checkMmm() {
    var input = $('bsp-location');
    var addr = mmmVisible() ? input.value.trim() : '';
    if (addr === MMM.addr) return;
    MMM.addr = addr; MMM.picked = false; MMM.lookup = null;
    if (!addr) { renderMmm(); return; }
    var seq = ++MMM.seq;
    postJson('/api/mmm-zone/lookup', { address: addr }).then(function (r) {
      if (seq !== MMM.seq) return;
      MMM.lookup = r; renderMmm();
    }).catch(function () { if (seq === MMM.seq) { MMM.lookup = { confident: false, reason: 'the zone lookup is unavailable', zones: [] }; renderMmm(); } });
  }
  /** The zone to send with Create appointment, or null (nothing chosen). */
  BR.mmmZoneForSave = function (address) {
    var sel = $('bsp-mmm-zone');
    if (!sel || !MMM.lookup || String(address || '').trim() !== MMM.addr) return null;
    var z = parseInt(sel.value, 10);
    return z >= 1 && z <= 7 ? z : null;
  };
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'bsp-mmm-zone') { MMM.picked = true; renderMmm(); }
  });
  /* No address on a non-client event (lunch, admin, PD…): it is saved where
     the therapist already is (travel.js whereAtMin — confirmBooking does the
     same), so say where before Create (18 Oct 2026). Own calendar only, and
     never over another message in the line. */
  var STAY = { text: '' };
  function stayHintText() {
    var input = $('bsp-location'), u = $('bsp-location-unsure'), st = $('bsp-start');
    if (!input || !panelOpen() || isClientCategory() || HOME.on || (u && u.checked) || input.value.trim()) return '';
    if (!selectedClinician().own || !fn('whereAtMin') || !st || !st.value) return '';
    var day = activeDay(); if (!day) return '';
    var p = st.value.split(':').map(Number);
    var w = global.whereAtMin(day, p[0] * 60 + (p[1] || 0));
    if (!w || !w.address) return '';
    var lbl = w.label && canon(w.label) !== canon(w.address) ? w.label + ' · ' : '';
    return 'No address — you stay at ' + lbl + w.address + '. Type an address to change it.';
  }
  BR.stayHintText = stayHintText;
  function renderStayHint() {
    var meta = $('bsp-loc-meta'); if (!meta) return;
    var text = stayHintText();
    var mine = !meta.textContent || meta.textContent === STAY.text;
    if (text === STAY.text && (!text || meta.textContent === text)) return;
    if (!mine) { STAY.text = ''; return; }
    STAY.text = text;
    setMeta(text, 'muted');
  }
  setInterval(function () { checkMmm(); renderStayHint(); }, 600);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})(window);

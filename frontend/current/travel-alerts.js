'use strict';

/**
 * TRAFFIC ALERTS (29 Oct 2026, Antony's spec).
 *
 * A drive is priced on traffic at the time it is driven (travel.js travelAt),
 * and re-priced as the day comes closer. When a re-priced drive now runs into
 * a CLIENT SESSION (a direct service — desk work, admin and meetings never
 * count), a small popup says so and points at the drive:
 *
 *   Make room is possible  → "Make room" opens the same planner booking uses
 *                            (planMakeRoom): the flexible blocks before the
 *                            session move up / shorten, −/+ per block, Apply.
 *   not possible           → Acknowledge.
 *   always                 → Ignore (this drive, this day: never again).
 *
 * Only a CHANGE alerts: the first time a drive is seen its minutes are the
 * baseline, and an alert needs the drive to have grown since and to overlap a
 * session by more than it did. Acknowledged → quiet unless it gets worse.
 * Only Routes API answers count, never the suburb-table estimate. Watched
 * days: today and tomorrow (Perth); re-checked every 10 minutes while the
 * portal is open, and whenever the day is redrawn.
 *
 * Per-browser memory (localStorage) — a convenience, not a record: an
 * unreadable store just means alerts start from a fresh baseline.
 *
 * Globals (no modules): window.TravelAlerts. Reads travel.js's engine
 * (sessionsForDay, isDirectService, isFlexibleBlock, planMakeRoom,
 * applyMakeRoomBlocks, openTravelPanel, _tpEsc) and the shell's DAY_DATES.
 */
(function () {
  var STORE_KEY = 'opal.travelAlerts.v1';
  var CHECK_EVERY_MS = 10 * 60 * 1000;
  var MIN_OVERLAP = 2;          // minutes — less than this is noise, not lateness
  var STEP = 5;

  var queue = [], showing = null;

  function perthDate(offsetDays) {
    var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(d);
  }
  function dateOf(day) {
    return (typeof DAY_DATES !== 'undefined' && DAY_DATES) ? DAY_DATES[day] || null : null;
  }
  function watched(date) { return !!date && (date === perthDate(0) || date === perthDate(1)); }

  // Kept in memory as well: with storage blocked (a private window, site data
  // off) the baseline still holds for as long as the page is open — without
  // it every check would be a "first sight" and nothing would ever alert.
  var memory = null;
  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) { var v = JSON.parse(raw); if (v && typeof v === 'object') return v; }
    } catch (_) { /* blocked or corrupt — fall back to memory */ }
    return memory ? JSON.parse(JSON.stringify(memory)) : {};
  }
  function save(store) {
    var today = perthDate(0);
    Object.keys(store).forEach(function (d) { if (d < today) delete store[d]; });
    memory = JSON.parse(JSON.stringify(store));
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* blocked: memory holds it */ }
  }

  /* PURE — the client session this leg runs into the most, or null. */
  function overlapWithSession(seg, sessions, isDirect) {
    var best = null;
    (sessions || []).forEach(function (s) {
      if (!s || s.cancelled || !isDirect(s)) return;
      var st = sessionStartMin(s), en = sessionEndMin(s);
      var ov = Math.min(seg.endMin, en) - Math.max(seg.startMin, st);
      if (ov >= MIN_OVERLAP && (!best || ov > best.overlapMin)) best = { session: s, overlapMin: ov };
    });
    return best;
  }
  /* PURE — what to do with one observation of a leg.
       record  the stored { min, overlap, status } or undefined
       obs     { min, overlap }
     → { action: 'baseline'|'alert'|'update'|'none', record } */
  function decide(record, obs) {
    if (!record) return { action: 'baseline', record: { min: obs.min, overlap: obs.overlap } };
    if (record.status === 'ignore') return { action: 'none', record: record };
    if (obs.min > record.min && obs.overlap >= MIN_OVERLAP && obs.overlap > (record.overlap || 0)) {
      return { action: 'alert', record: { min: obs.min, overlap: obs.overlap, status: 'shown', wasMin: record.min } };
    }
    if (obs.min !== record.min || obs.overlap !== record.overlap) {
      // Track the drive as it is: a later rise is measured from here. An
      // acknowledgement stands only while the overlap is no worse.
      var keep = record.status && obs.overlap <= (record.overlap || 0) ? record.status : undefined;
      return { action: 'update', record: { min: obs.min, overlap: obs.overlap, status: keep } };
    }
    return { action: 'none', record: record };
  }
  function legKey(seg) {
    var S = window.SESSIONS || {};
    var owner = S[seg.ownerSessionId], to = S[seg.toSessionId || seg.gapToSessionId];
    return [owner && owner.dbId, seg.ownerSide, to && to.dbId, seg.via || seg.kind].join('|');
  }

  /* Called by travel.js after a day is drawn. */
  function check(day, segs) {
    var date = dateOf(day);
    if (!watched(date) || !window.SESSIONS) return;
    if (typeof TRAVEL_DRAG !== 'undefined' && TRAVEL_DRAG && TRAVEL_DRAG.active) return;
    var sessions = sessionsForDay(day);
    var store = load(), byDay = store[date] || (store[date] = {}), dirty = false;
    (segs || []).forEach(function (seg) {
      if (!seg || seg.kind === 'gap' || seg.skipped || !seg.routeReal || !(seg.travelMin > 0) || !seg.ownerSessionId) return;
      var hit = overlapWithSession(seg, sessions, isDirectService);
      var key = legKey(seg);
      var res = decide(byDay[key], { min: seg.travelMin, overlap: hit ? hit.overlapMin : 0 });
      if (res.action === 'none') return;
      byDay[key] = res.record; dirty = true;
      if (res.action === 'alert' && hit) enqueue({ day: day, date: date, key: key, seg: seg, session: hit.session, overlapMin: hit.overlapMin, wasMin: res.record.wasMin });
    });
    if (dirty) save(store);
  }

  function enqueue(a) {
    if ((showing && showing.key === a.key) || queue.some(function (q) { return q.key === a.key; })) return;
    queue.push(a);
    if (!showing) next();
  }
  function next() {
    showing = queue.shift() || null;
    var old = document.getElementById('tr-alert');
    if (old) old.remove();
    if (showing) render(showing);
  }
  function setStatus(a, status) {
    var store = load(), byDay = store[a.date] || (store[a.date] = {});
    byDay[a.key] = Object.assign({}, byDay[a.key] || { min: a.seg.travelMin, overlap: a.overlapMin }, { status: status });
    save(store);
  }

  function fmt(min) { return (typeof fmtTime === 'function') ? fmtTime(Math.floor(min / 60), min % 60) : (Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0')); }
  function esc(v) { return _tpEsc(v); }
  function who(s) { return (typeof _stopName === 'function' ? _stopName(s) : '') || s.title || 'the client'; }

  /* The Make room plan for the session this drive runs into, or null. Only
     when that session is where the drive is going. */
  function roomFor(a, cuts) {
    var seg = a.seg, target = a.session;
    if (!(seg.toSessionId === target.id || seg.gapToSessionId === target.id)) return null;
    var items = sessionsForDay(a.day).filter(function (x) { return !isTravelBlock(x) && !x.cancelled && x !== target; })
      .map(function (x) { return { id: x.id, startMin: sessionStartMin(x), endMin: sessionEndMin(x), label: x.patient || x.title || 'Block', flexible: isFlexibleBlock(x) }; });
    return planMakeRoom({ items: items, desiredStartMin: sessionStartMin(target), travelMin: seg.travelMin, bufferMin: 0, cuts: cuts || {} });
  }

  function render(a) {
    var seg = a.seg, s = a.session;
    var from = seg.fromLoc.suburb || seg.fromLoc.label || 'your last stop';
    var to = seg.toLoc.suburb || seg.toLoc.label || 'the next stop';
    var cuts = {};
    var room = roomFor(a, cuts);
    var canRoom = !!(room && room.ok);
    var el = document.createElement('div');
    el.id = 'tr-alert';
    el.className = 'tr-alert';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-labelledby', 'tr-alert-title');
    var draw = function () {
      el.innerHTML =
        '<div class="tr-head"><span class="tr-eyebrow">Traffic update</span>' +
          '<button type="button" class="tr-x" data-tr="close" aria-label="Close">×</button></div>' +
        '<div class="tr-title" id="tr-alert-title">Running into ' + esc(who(s)) + '’s ' + esc(fmt(sessionStartMin(s))) + ' session</div>' +
        '<p class="tr-body">Your drive ' + esc(from) + ' → ' + esc(to) + ' now takes <strong>' + seg.travelMin + ' min</strong>' +
          (a.wasMin ? ' (was ' + a.wasMin + ')' : '') + ' and runs <strong>' + a.overlapMin + ' min</strong> into the session.</p>' +
        (canRoom && el.__open ? roomHtml(room) : '') +
        '<div class="tr-actions">' +
          '<button type="button" class="tr-btn" data-tr="show">Show me</button>' +
          (canRoom
            ? (el.__open
                ? '<button type="button" class="tr-btn primary" data-tr="apply">Apply</button>'
                : '<button type="button" class="tr-btn primary" data-tr="room">Make room ▸</button>')
            : '<button type="button" class="tr-btn primary" data-tr="ack">Acknowledge</button>') +
          '<button type="button" class="tr-btn" data-tr="ignore">Ignore</button>' +
        '</div>';
    };
    var roomHtml = function (r) {
      return '<div class="tr-room"><div class="tr-room-sum">Leave by <strong>' + esc(fmt(r.leaveByMin)) + '</strong> — frees ' + r.freedMin + ' of ' + r.needMin + ' min' + (r.ok ? '' : ' (' + r.shortMin + ' short)') + '.</div><ul class="tr-room-list">' +
        r.blocks.map(function (b) {
          var moved = b.newStartMin !== b.startMin || b.newEndMin !== b.endMin;
          return '<li><span class="tr-room-name">' + esc(b.label) + '</span>' +
            '<span class="tr-room-time">' + esc(fmt(b.startMin)) + '–' + esc(fmt(b.endMin)) + (moved ? ' → <strong>' + esc(fmt(b.newStartMin)) + '–' + esc(fmt(b.newEndMin)) + '</strong>' : '') + '</span>' +
            '<span class="tr-room-step"><button type="button" class="tr-step" data-tr="step" data-id="' + esc(b.id) + '" data-delta="-' + STEP + '"' + (b.cutMin <= 0 ? ' disabled' : '') + ' aria-label="Take less off ' + esc(b.label) + '">−</button>' +
            '<span class="tr-room-cut">' + b.cutMin + ' min</span>' +
            '<button type="button" class="tr-step" data-tr="step" data-id="' + esc(b.id) + '" data-delta="' + STEP + '"' + (b.cutMin >= b.maxCutMin ? ' disabled' : '') + ' aria-label="Take more off ' + esc(b.label) + '">+</button></span></li>';
        }).join('') + '</ul><div class="tr-room-foot">Only blocks that are not client sessions move. Saved to Outlook and Splose like a drag; Cmd+Z undoes it.</div></div>';
    };
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tr]') : null;
      if (!b) return;
      var what = b.getAttribute('data-tr');
      if (what === 'close' || what === 'ack') { setStatus(a, 'ack'); next(); return; }
      if (what === 'ignore') { setStatus(a, 'ignore'); next(); return; }
      if (what === 'show') { showLeg(seg); return; }
      if (what === 'room') { el.__open = true; draw(); return; }
      if (what === 'step') {
        var id = b.getAttribute('data-id'), row = room.blocks.find(function (x) { return String(x.id) === id; });
        if (!row) return;
        cuts[id] = Math.max(0, Math.min(row.maxCutMin, row.cutMin + Number(b.getAttribute('data-delta'))));
        room = roomFor(a, cuts) || room; canRoom = true; draw(); return;
      }
      if (what === 'apply') {
        if (!room.ok) { if (typeof showToast === 'function') showToast('Not enough room yet', 'Take ' + room.shortMin + ' more minutes off, or Ignore.', 'warn'); return; }
        b.disabled = true; b.textContent = 'Saving…';
        applyMakeRoomBlocks(room.blocks).then(function (r) {
          setStatus(a, 'ack');
          if (typeof showToast === 'function') {
            if (r.failed) showToast('Some blocks were not moved', 'Check the blocks before ' + who(s) + '’s session.', 'warn');
            else showToast('Made room — leave by ' + fmt(room.leaveByMin), r.done + ' block' + (r.done === 1 ? '' : 's') + ' moved up');
          }
          next();
        });
      }
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setStatus(a, 'ack'); next(); } });
    draw();
    document.body.appendChild(el);
    showLeg(seg, true);
  }

  /* Point at the drive: scroll it into view and pulse it for a few seconds. */
  function showLeg(seg, quiet) {
    var col = document.getElementById('day-' + seg.day);
    if (!col) return;
    var hit = Array.prototype.find.call(col.querySelectorAll('.travel-overlay'), function (x) {
      return x.dataset.ownerSession === String(seg.ownerSessionId || '') && x.dataset.ownerSide === String(seg.ownerSide || '');
    });
    if (!hit) return;
    hit.classList.add('tr-flash');
    setTimeout(function () { hit.classList.remove('tr-flash'); }, 4000);
    if (!quiet && hit.scrollIntoView) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* Every 10 minutes (while the tab is visible), redraw today and tomorrow:
     their drives re-price from fresh traffic and check() runs again. */
  function tick() {
    if (document.hidden || typeof DAY_DATES === 'undefined' || !DAY_DATES || typeof refreshDayOverlays !== 'function') return;
    Object.keys(DAY_DATES).forEach(function (day) { if (watched(DAY_DATES[day])) refreshDayOverlays(day); });
  }
  var timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(tick, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  }

  window.TravelAlerts = { check: check, tick: tick, start: start,
    _decide: decide, _overlapWithSession: overlapWithSession, _roomFor: roomFor, _legKey: legKey, _queue: function () { return { showing: showing, queue: queue }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

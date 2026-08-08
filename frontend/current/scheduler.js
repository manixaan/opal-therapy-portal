/* ═══════════════════════════════════════════════════════════════════════════
   OPAL MASTER SCHEDULER — Phase 1
   An intelligent VIEW over the canonical calendar: therapist-column day grid
   and a group-by-therapist week overview, fed by the existing aggregated
   GET /api/calendar/master endpoint (one request per visible range).

   Pure helpers are exported for unit tests (jest requires this file in node);
   browser wiring attaches window.OpalScheduler.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Perth time helpers (AWST, UTC+8, no DST) ──────────────────────────────
  var PERTH_OFFSET_MIN = 8 * 60;

  function pad2(n) { return String(n).padStart(2, '0'); }

  // ISO instant → {y,m,d,hh,mm, minutes} in Perth local time.
  function perthParts(iso) {
    var t = new Date(iso).getTime() + PERTH_OFFSET_MIN * 60000;
    var d = new Date(t);
    return {
      y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
      hh: d.getUTCHours(), mm: d.getUTCMinutes(),
      ymd: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()),
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  }

  function todayPerthYmd() { return perthParts(new Date().toISOString()).ymd; }

  function addDaysYmd(ymd, n) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function mondayOfYmd(ymd) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    return addDaysYmd(ymd, -dow);
  }

  function fmtDayLabel(ymd) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function fmtTime12(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    var ap = h < 12 ? 'am' : 'pm';
    var h12 = (h % 12) || 12;
    return h12 + ':' + pad2(m) + ap;
  }

  // ── Privacy-safe labels ───────────────────────────────────────────────────
  // Cross-therapist views must not surface raw Outlook subjects or client
  // names: an admin scanning the whole practice sees the event's TYPE, not
  // its subject. Full titles appear only in single-therapist focus mode
  // (the server already gates who can request this data at all).
  var TYPE_LABELS = {
    therapy:       'Client session',
    travel:        'Travel',
    meeting:       'Meeting',
    teams_meeting: 'Teams meeting',
    admin:         'Admin',
    report:        'Report writing',
    cpd:           'Professional development',
    lunch:         'Lunch',
    leave:         'Leave',
    outlook:       'Busy',
  };

  function isPlaceholderTitle(t) {
    var s = (t || '').trim();
    return !s || s === '(No subject)' || s === '(No title)' || s === 'Untitled';
  }

  // mode: 'cross' (multi-therapist grid) | 'focus' (single therapist)
  function safeLabel(ev, mode) {
    if (mode === 'focus') {
      if (isPlaceholderTitle(ev.title)) return TYPE_LABELS[ev.eventType] || 'Untitled event';
      return String(ev.title).trim();
    }
    return TYPE_LABELS[ev.eventType] || 'Busy';
  }

  // Pull a display suburb out of a free-text address. Conservative: prefer the
  // component that looks like a suburb (before "WA"/postcode); fall back to a
  // short whole string; never invent anything.
  function extractSuburb(location) {
    var s = (location || '').trim();
    if (!s) return '';
    // Virtual/telehealth locations are not geography — show nothing.
    if (/\b(teams|zoom|online|telehealth|virtual|video|phone)\b/i.test(s)) return '';
    // strip country + postcode + state tokens off the end
    s = s.replace(/,?\s*(Australia)\s*$/i, '');
    s = s.replace(/,?\s*(WA|Western Australia)\s*\.?\s*(\d{4})?\s*$/i, '');
    s = s.replace(/\s+\d{4}\s*$/, '');
    var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) return '';
    var last = parts[parts.length - 1];
    // If the last component still looks like a street line (has digits), and
    // it is the only component, show nothing rather than a house address.
    if (parts.length === 1) return /\d/.test(last) ? '' : (last.length <= 40 ? last : '');
    return /\d/.test(last) ? extractSuburb(parts.slice(0, -1).join(', ')) : last;
  }

  // ── Lane assignment (overlapping events share the column width) ───────────
  // items: [{startMin, endMin, ...}] → same objects gain {lane, laneCount}.
  function assignLanes(items) {
    var sorted = items.slice().sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
    var cluster = [], clusterEnd = -Infinity;
    function flush() {
      if (!cluster.length) return;
      var lanes = [];
      cluster.forEach(function (t) {
        var lane = -1;
        for (var i = 0; i < lanes.length; i++) { if (lanes[i] <= t.startMin) { lane = i; break; } }
        if (lane === -1) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = t.endMin;
        t.lane = lane;
      });
      cluster.forEach(function (t) { t.laneCount = lanes.length; });
      cluster = [];
    }
    sorted.forEach(function (t) {
      if (t.startMin >= clusterEnd) { flush(); clusterEnd = t.endMin; }
      else { clusterEnd = Math.max(clusterEnd, t.endMin); }
      cluster.push(t);
    });
    flush();
    return sorted;
  }

  // ── Filtering / grouping ──────────────────────────────────────────────────
  function filterTherapists(therapists, filter) {
    filter = filter || {};
    return (therapists || []).filter(function (t) {
      if (filter.focusId) return t.id === filter.focusId;
      if (filter.ids && filter.ids.size > 0 && !filter.ids.has(t.id)) return false;
      if (filter.discipline && (t.roleTitle || 'Other') !== filter.discipline) return false;
      return true;
    });
  }

  function disciplinesOf(therapists) {
    var seen = {};
    (therapists || []).forEach(function (t) { seen[t.roleTitle || 'Other'] = true; });
    return Object.keys(seen).sort();
  }

  // Visible, day-scoped events for one therapist, with Perth minute bounds
  // clamped to the given day. Deleted/cancelled events are excluded, matching
  // the existing calendar rules.
  function eventsForTherapistDay(events, therapistId, ymd) {
    var out = [];
    (events || []).forEach(function (ev) {
      if (ev.isDeleted || ev.isCancelled) return;
      if (ev.therapistProfileId !== therapistId) return;
      var s = perthParts(ev.start), e = perthParts(ev.end);
      if (s.ymd > ymd || e.ymd < ymd) return;
      var startMin = s.ymd < ymd ? 0 : s.minutes;
      var endMin   = e.ymd > ymd ? 24 * 60 : e.minutes;
      if (endMin <= startMin) endMin = Math.min(startMin + 15, 24 * 60);
      out.push({ ev: ev, startMin: startMin, endMin: endMin });
    });
    return out;
  }

  // Week grouping: therapist → [ymd → sorted events] for the 7 days from monday.
  function groupWeek(events, therapists, mondayYmd) {
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDaysYmd(mondayYmd, i));
    var byT = {};
    therapists.forEach(function (t) {
      var m = {};
      days.forEach(function (d) { m[d] = eventsForTherapistDay(events, t.id, d)
        .sort(function (a, b) { return a.startMin - b.startMin; }); });
      byT[t.id] = m;
    });
    return { days: days, byTherapist: byT };
  }

  function apptCount(dayEvents) {
    return dayEvents.filter(function (x) { return x.ev.eventType !== 'travel'; }).length;
  }

  // Clinical minutes = time in client-facing therapy events (scheduling
  // capacity language — scheduling data, never a staff-measurement figure).
  function clinicalMinutes(dayEvents) {
    return dayEvents
      .filter(function (x) { return x.ev.eventType === 'therapy'; })
      .reduce(function (sum, x) { return sum + (x.endMin - x.startMin); }, 0);
  }

  // First available segment starting at/after fromMin (canonical segments in).
  function nextAvailableSegment(segments, fromMin) {
    var best = null;
    (segments || []).forEach(function (sg) {
      if (sg.type !== 'available' || sg.endMin <= fromMin) return;
      if (!best || sg.startMin < best.startMin) best = sg;
    });
    return best;
  }

  function snap15(min) { return Math.round(min / 15) * 15; }

  // ── Phase 6 pure geometry (deterministic, unit-tested) ────────────────────
  function haversineKm(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
    var q = s1 * s1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(q));
  }

  // One geographic point per suburb with a visit count (repeat visits to the
  // same suburb must not distort the footprint).
  function dedupSuburbPoints(points) {
    var by = {};
    (points || []).forEach(function (p) {
      var k = (p.suburb || '').toLowerCase();
      if (!by[k]) by[k] = { suburb: p.suburb, lat: p.lat, lng: p.lng, visits: 0 };
      by[k].visits += 1;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  // Single-linkage clustering with a distance threshold — widely separated
  // localities become separate clusters instead of one misleading giant hull.
  function clusterPoints(points, maxKm) {
    maxKm = maxKm || 45;
    var clusters = [];
    (points || []).forEach(function (p) {
      var homes = [];
      clusters.forEach(function (c, i) {
        if (c.some(function (q) { return haversineKm(p, q) <= maxKm; })) homes.push(i);
      });
      if (!homes.length) { clusters.push([p]); return; }
      // merge every cluster this point bridges
      var target = clusters[homes[0]];
      target.push(p);
      for (var i = homes.length - 1; i >= 1; i--) {
        target.push.apply(target, clusters[homes[i]]);
        clusters.splice(homes[i], 1);
      }
    });
    return clusters;
  }

  // Andrew monotone-chain convex hull over {lat, lng} points.
  function convexHull(points) {
    var pts = (points || []).slice().sort(function (a, b) { return a.lng - b.lng || a.lat - b.lat; });
    if (pts.length < 3) return pts;
    var cross = function (o, a, b) {
      return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    };
    var lower = [];
    pts.forEach(function (p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    });
    var upper = [];
    for (var i = pts.length - 1; i >= 0; i--) {
      var p2 = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p2) <= 0) upper.pop();
      upper.push(p2);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // ── Exports for unit tests (node) ─────────────────────────────────────────
  var helpers = {
    perthParts: perthParts, addDaysYmd: addDaysYmd, mondayOfYmd: mondayOfYmd,
    fmtTime12: fmtTime12, safeLabel: safeLabel, extractSuburb: extractSuburb,
    assignLanes: assignLanes, filterTherapists: filterTherapists,
    disciplinesOf: disciplinesOf, eventsForTherapistDay: eventsForTherapistDay,
    groupWeek: groupWeek, apptCount: apptCount, isPlaceholderTitle: isPlaceholderTitle,
    clinicalMinutes: clinicalMinutes, nextAvailableSegment: nextAvailableSegment, snap15: snap15,
    haversineKm: haversineKm, dedupSuburbPoints: dedupSuburbPoints,
    clusterPoints: clusterPoints, convexHull: convexHull,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test environment stops here

  // ═══════════════════════════════════════════════════════════════════════
  //  Browser wiring
  // ═══════════════════════════════════════════════════════════════════════

  var HOUR = function () { return global.HOUR_PX || 48; };
  var WORK_START_H = 8, WORK_END_H = 18; // soft visual wash only (not availability)

  var SCHED = {
    date: null,             // 'YYYY-MM-DD' (Perth)
    mode: 'day',            // 'day' | 'week'
    therapists: [],
    events: [],
    rangeKey: null,         // cache key of last fetch
    filterIds: null,        // Set of therapist ids | null = everyone
    discipline: null,
    // Focus state — Phase 4 (availability Focus Mode) extends this object
    // rather than replacing it: keep it a plain serialisable shape.
    focusId: null,
    loading: false,
    nowTimer: null,
    // Phase 2 — availability intelligence layer
    overlay: (function () { try { return localStorage.getItem('sch_overlay') === '1'; } catch (e) { return false; } })(),
    avail: { key: null, byId: {}, meta: null, loading: false },
    common: { open: false, minDur: 30, loading: false, result: null },
    // Phase 3 — Quick Availability Finder (right intelligence panel)
    // Phase 5/6 — Scheduler Map (right intelligence panel tab)
    map: {
      open: (function () { try { return localStorage.getItem('sch_map') === '1'; } catch (e) { return false; } })(),
      footprints: (function () { try { return localStorage.getItem('sch_footprints') !== '0'; } catch (e) { return true; } })(),
      sdk: 'none',              // none | loading | ready | error
      gmap: null, el: null,     // persistent map DOM element survives re-renders
      markers: [], polys: [], info: null,
      points: null, pointsKey: null, loading: false, error: false,
      meta: { telehealth: 0, unmappable: 0 },
      userMoved: false, boundsKey: null,
    },
    finder: {
      open: false, mode: 'exact',
      startMin: 10 * 60, durationMin: 60,
      rangeStartMin: 8 * 60, rangeEndMin: 12 * 60,
      discipline: '',
      loading: false, error: false, result: null,
      gen: 0, timer: null,
    },
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function root() { return document.getElementById('scheduler-root'); }

  // ── Data (single aggregated request per range) ────────────────────────────
  function rangeFor(state) {
    if (state.mode === 'week') {
      var mon = mondayOfYmd(state.date);
      return { start: mon, end: addDaysYmd(mon, 7) };
    }
    return { start: state.date, end: addDaysYmd(state.date, 1) };
  }

  function fmtDur(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m || !h ? m + 'm' : '');
  }

  function loadAvailability(force) {
    if ((!SCHED.overlay && !SCHED.focusId) || SCHED.mode !== 'day') return Promise.resolve();
    var key = SCHED.date;
    if (!force && SCHED.avail.key === key) return Promise.resolve();
    SCHED.avail.loading = true;
    return fetch('/api/scheduler/availability?date=' + key, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        SCHED.avail.loading = false;
        if (!j) { SCHED.avail = { key: key, byId: {}, meta: null, loading: false }; return; }
        var byId = {};
        (j.therapists || []).forEach(function (t) { byId[t.therapistProfileId] = t; });
        SCHED.avail = { key: key, byId: byId, meta: j, loading: false };
        render();
      })
      .catch(function () { SCHED.avail.loading = false; });
  }

  function load(force) {
    var r = rangeFor(SCHED);
    var key = r.start + '..' + r.end;
    if (!force && key === SCHED.rangeKey) { render(); return Promise.resolve(); }
    SCHED.loading = true; render();
    return fetch('/api/calendar/master?startDate=' + r.start + '&endDate=' + r.end,
      { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) return res.json().catch(function () { return {}; })
          .then(function (j) { throw new Error(j.error || ('HTTP ' + res.status)); });
        return res.json();
      })
      .then(function (data) {
        SCHED.therapists = data.therapists || [];
        SCHED.events = data.events || [];
        SCHED.rangeKey = key;
        SCHED.loading = false;
        render();
        loadAvailability();
        if (SCHED.map.open) mapFetchPoints();
      })
      .catch(function (err) {
        SCHED.loading = false;
        var el = root();
        if (el) el.innerHTML = '<div class="sch-status">Could not load the scheduler: ' +
          esc(err.message) + '</div>';
        console.error('Master Scheduler load error:', err);
      });
  }

  // ── Toolbar + filters ─────────────────────────────────────────────────────
  function renderToolbar(frag) {
    var tb = document.createElement('div');
    tb.className = 'sch-toolbar';
    tb.innerHTML =
      '<span class="sch-title">MASTER SCHEDULER</span>' +
      '<div class="sch-nav">' +
        '<button type="button" data-act="prev" title="Previous ' + SCHED.mode + '" aria-label="Previous">&#8249;</button>' +
        '<button type="button" data-act="next" title="Next ' + SCHED.mode + '" aria-label="Next">&#8250;</button>' +
      '</div>' +
      '<span class="sch-date-label">' + esc(SCHED.mode === 'week'
        ? 'Week of ' + fmtDayLabel(mondayOfYmd(SCHED.date))
        : fmtDayLabel(SCHED.date)) + '</span>' +
      '<button type="button" class="sch-today-btn" data-act="today">Today</button>' +
      '<input type="date" class="sch-date-input" value="' + esc(SCHED.date) + '" aria-label="Pick a date" />' +
      '<div class="sch-mode" role="tablist">' +
        '<button type="button" data-act="mode-day"' + (SCHED.mode === 'day' ? ' class="active"' : '') + '>Day</button>' +
        '<button type="button" data-act="mode-week"' + (SCHED.mode === 'week' ? ' class="active"' : '') + '>Week</button>' +
      '</div>' +
      '<div class="sch-spacer"></div>' +
      (SCHED.mode === 'day'
        ? '<button type="button" class="sch-toggle' + (SCHED.overlay ? ' on' : '') + '" data-act="overlay" ' +
            'title="Distinguish true availability from empty calendar space" aria-pressed="' + (SCHED.overlay ? 'true' : 'false') + '">' +
            '<span class="sch-toggle-dot"></span>Availability</button>' +
          '<button type="button" class="sch-common-btn' + (SCHED.common.open ? ' on' : '') + '" data-act="common">Common availability</button>' +
          '<button type="button" class="sch-common-btn' + (SCHED.finder.open ? ' on' : '') + '" data-act="finder">Find availability</button>' +
          '<button type="button" class="sch-common-btn' + (SCHED.map.open ? ' on' : '') + '" data-act="map">Map</button>'
        : '') +
      '<button type="button" class="sch-add-btn" data-act="add">+ Appointment</button>';

    tb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'prev')  nav(-1);
      if (act === 'next')  nav(1);
      if (act === 'today') nav('today');
      if (act === 'overlay') {
        SCHED.overlay = !SCHED.overlay;
        try { localStorage.setItem('sch_overlay', SCHED.overlay ? '1' : '0'); } catch (err) {}
        if (SCHED.overlay) { render(); loadAvailability(); } else { render(); }
      }
      if (act === 'common') { SCHED.common.open = !SCHED.common.open; SCHED.common.result = null; render(); if (SCHED.common.open && !SCHED.overlay) loadAvailability(); }
      if (act === 'finder') {
        SCHED.finder.open = !SCHED.finder.open;
        if (SCHED.finder.open) { SCHED.map.open = false; persistMapOpen(); SCHED.finder.result = null; render(); finderSearch(); }
        else render();
      }
      if (act === 'map') {
        SCHED.map.open = !SCHED.map.open;
        if (SCHED.map.open) SCHED.finder.open = false;
        persistMapOpen();
        render();
        if (SCHED.map.open) mapEnsure();
      }
      if (act === 'mode-day')  { SCHED.mode = 'day'; load(); }
      if (act === 'mode-week') { SCHED.mode = 'week'; load(); }
      if (act === 'add') {
        // Open the Smart Booking slide-over directly — switchTab('book') would
        // raw-switch to the default week grid underneath the scheduler.
        if (typeof global.openBookingPanel === 'function') global.openBookingPanel();
        else if (typeof global.switchTab === 'function') global.switchTab('book');
      }
    });
    tb.querySelector('.sch-date-input').addEventListener('change', function (e) {
      if (e.target.value) { SCHED.date = e.target.value; load(); }
    });
    frag.appendChild(tb);
  }

  function renderFilters(frag) {
    var bar = document.createElement('div');
    bar.className = 'sch-filters';

    if (SCHED.focusId) {
      var t = SCHED.therapists.find(function (x) { return x.id === SCHED.focusId; });
      var av = SCHED.avail.key === SCHED.date ? SCHED.avail.byId[SCHED.focusId] : null;
      var dayEvents = eventsForTherapistDay(SCHED.events, SCHED.focusId, SCHED.date);
      var appts = apptCount(dayEvents);
      var clin = clinicalMinutes(dayEvents);
      var nowM = SCHED.date === todayPerthYmd() ? perthParts(new Date().toISOString()).minutes : 0;
      var nextSeg = av && av.working ? nextAvailableSegment(av.segments, nowM) : null;
      var nextTxt;
      if (!av) nextTxt = '';
      else if (!av.working) nextTxt = av.segments.some(function (x) { return x.type === 'leave'; }) ? 'On leave' : 'Not working today';
      else if (nextSeg) nextTxt = 'Next available ' + fmtTime12(nextSeg.startMin) + '–' + fmtTime12(nextSeg.endMin) + ' · ' + fmtDur(nextSeg.endMin - nextSeg.startMin);
      else nextTxt = 'No further availability today';

      bar.className = 'sch-focus-head';
      bar.innerHTML =
        '<button type="button" class="sch-focus-crumb" data-act="unfocus">&#8592; All therapists</button>' +
        '<div class="sch-fh-main">' +
          '<span class="sch-h-av" style="background:' + esc((t && t.colour) || '#0f7c6c') + ';">' + esc((t && t.initials) || '?') + '</span>' +
          '<div class="sch-fh-id">' +
            '<div class="sch-fh-name">' + esc((t && t.displayName) || '') + '</div>' +
            '<div class="sch-fh-role">' + esc((t && t.roleTitle) || '') +
              (av && av.availabilityConfidence === 'default'
                ? ' · <span class="sch-defbadge" title="No work schedule entered for this week">using organisation default hours</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="sch-fh-stats">' +
            '<span class="sch-fh-stat"><strong>' + appts + '</strong> appointment' + (appts === 1 ? '' : 's') + '</span>' +
            '<span class="sch-fh-stat"><strong>' + fmtDur(clin) + '</strong> clinical</span>' +
            (av && av.working ? '<span class="sch-fh-stat cap"><strong>' + fmtDur(av.capacity.availableMin) + '</strong> available</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="sch-fh-next">' + esc(nextTxt) + '</div>' +
        '<div class="sch-weekstrip" id="sch-weekstrip"></div>';
      bar.addEventListener('click', function (e) {
        if (e.target.closest('[data-act="unfocus"]')) { SCHED.focusId = null; render(); return; }
        var day = e.target.closest('.sch-ws-day');
        if (day) { SCHED.date = day.dataset.date; load(); loadAvailability(true); loadWeekCapacity(); }
      });
      frag.appendChild(bar);
      var stripHost = bar.querySelector('#sch-weekstrip');
      if (stripHost) renderWeekStripInto(stripHost);
      return;
    }

    var html = '<span class="sch-filter-label">Therapists</span>' +
      '<button type="button" class="sch-chip all' + (SCHED.filterIds ? ' muted' : ' selected') + '" data-tid="__all">' +
        '<span class="sch-chip-av">&#9733;</span>Everyone</button>';
    SCHED.therapists.forEach(function (t) {
      var on = !SCHED.filterIds || SCHED.filterIds.has(t.id);
      html += '<button type="button" class="sch-chip' + (on ? ' selected' : ' muted') + '"' +
        ' data-tid="' + esc(t.id) + '" style="color:' + esc(t.colour || '#0f7c6c') + ';">' +
        '<span class="sch-chip-av" style="background:' + esc(t.colour || '#0f7c6c') + ';">' + esc(t.initials || '?') + '</span>' +
        esc(t.displayName) + '</button>';
    });

    var discs = disciplinesOf(SCHED.therapists);
    if (discs.length > 1) {
      html += '<span class="sch-filter-label" style="margin-left:8px;">Discipline</span>' +
        '<select class="sch-select" data-role="discipline">' +
        '<option value="">All</option>' +
        discs.map(function (d) {
          return '<option value="' + esc(d) + '"' + (SCHED.discipline === d ? ' selected' : '') + '>' + esc(d) + '</option>';
        }).join('') + '</select>';
    }
    // NOTE: region filter intentionally absent — no reliable region data yet.
    // The filter state object already carries a `region` seam for Phase 5+.

    bar.innerHTML = html;
    bar.addEventListener('click', function (e) {
      var chip = e.target.closest('.sch-chip'); if (!chip) return;
      var tid = chip.getAttribute('data-tid');
      if (tid === '__all') { SCHED.filterIds = null; render(); return; }
      if (!SCHED.filterIds) SCHED.filterIds = new Set([tid]);
      else if (SCHED.filterIds.has(tid)) {
        SCHED.filterIds.delete(tid);
        if (!SCHED.filterIds.size) SCHED.filterIds = null;
      } else SCHED.filterIds.add(tid);
      render();
    });
    var sel = bar.querySelector('[data-role="discipline"]');
    if (sel) sel.addEventListener('change', function (e) {
      SCHED.discipline = e.target.value || null; render();
    });
    frag.appendChild(bar);
  }

  // ── Phase 4: focused-therapist week capacity strip ────────────────────────
  // One small aggregated request per weekday for the FOCUSED therapist only,
  // cached by therapist+date; reuses the canonical availability endpoint.
  var WEEK_CAP = {}; // 'tid|date' -> availableMin | 'x' (not working/leave)
  function loadWeekCapacity() {
    var tid = SCHED.focusId;
    if (!tid || SCHED.mode !== 'day') return;
    var mon = mondayOfYmd(SCHED.date);
    for (var i = 0; i < 5; i++) (function (d) {
      var key = tid + '|' + d;
      if (WEEK_CAP[key] !== undefined) return;
      WEEK_CAP[key] = null; // in flight
      fetch('/api/scheduler/availability?date=' + d + '&therapistIds=' + encodeURIComponent(tid),
        { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var t = j && j.therapists && j.therapists[0];
          WEEK_CAP[key] = t ? (t.working ? t.capacity.availableMin : 'x') : 'x';
          var strip = document.getElementById('sch-weekstrip');
          if (strip && SCHED.focusId === tid) renderWeekStripInto(strip);
        })
        .catch(function () { WEEK_CAP[key] = undefined; });
    })(addDaysYmd(mon, i));
  }

  function renderWeekStripInto(host) {
    var tid = SCHED.focusId; if (!tid) return;
    var mon = mondayOfYmd(SCHED.date);
    var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var html = '';
    for (var i = 0; i < 5; i++) {
      var d = addDaysYmd(mon, i);
      var cap = WEEK_CAP[tid + '|' + d];
      var capTxt = cap === undefined || cap === null ? '·'
        : cap === 'x' ? '—' : fmtDur(cap);
      html += '<button type="button" class="sch-ws-day' + (d === SCHED.date ? ' on' : '') + '" data-date="' + d + '">' +
        '<span class="sch-ws-name">' + names[i] + ' ' + Number(d.slice(8)) + '</span>' +
        '<span class="sch-ws-cap">' + capTxt + '</span></button>';
    }
    host.innerHTML = html;
  }

  // ── Common availability (Phase 2) ─────────────────────────────────────────
  function commonTherapistIds(visible) {
    return visible.map(function (t) { return t.id; });
  }

  function renderCommon(frag, visible) {
    if (!SCHED.common.open || SCHED.mode !== 'day') return;
    var bar = document.createElement('div');
    bar.className = 'sch-common';
    var ids = commonTherapistIds(visible);
    var res = SCHED.common.result;
    var html = '<span class="sch-filter-label">Common availability</span>' +
      '<span class="sch-common-sub">' + ids.length + ' therapist' + (ids.length === 1 ? '' : 's') + ' · ' + esc(fmtDayLabel(SCHED.date)) + '</span>' +
      '<label class="sch-common-sub" for="sch-common-min">Minimum</label>' +
      '<select id="sch-common-min" class="sch-select">' +
        [30, 45, 60, 90].map(function (m) {
          return '<option value="' + m + '"' + (SCHED.common.minDur === m ? ' selected' : '') + '>' + m + ' min</option>';
        }).join('') + '</select>' +
      '<button type="button" class="sch-common-find" data-act="find"' + (ids.length < 2 ? ' disabled title="Select at least two therapists"' : '') + '>' +
        (SCHED.common.loading ? 'Finding…' : 'Find') + '</button>';
    if (res) {
      if (!res.slots.length) {
        html += '<span class="sch-common-none">No common ' + res.minDurationMin + '-minute window — try a shorter minimum or fewer therapists.</span>';
      } else {
        html += res.slots.map(function (sl, i) {
          return '<button type="button" class="sch-common-slot" data-slot="' + i + '">' +
            fmtTime12(sl.startMin) + '–' + fmtTime12(sl.endMin) +
            '<span class="sch-common-dur">' + esc(fmtDur(sl.durationMin)) + '</span></button>';
        }).join('');
      }
    }
    bar.innerHTML = html;
    bar.addEventListener('click', function (e) {
      var find = e.target.closest('[data-act="find"]');
      if (find && !find.disabled) {
        SCHED.common.loading = true; render();
        fetch('/api/scheduler/common-availability', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: SCHED.date, therapistIds: ids, minDurationMin: SCHED.common.minDur }),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { SCHED.common.loading = false; SCHED.common.result = j; render(); })
          .catch(function () { SCHED.common.loading = false; render(); });
        return;
      }
      var slot = e.target.closest('[data-slot]');
      if (slot && SCHED.common.result) {
        var sl = SCHED.common.result.slots[Number(slot.dataset.slot)];
        if (sl) jumpToMinute(sl.startMin);
      }
    });
    var sel = bar.querySelector('#sch-common-min');
    if (sel) sel.addEventListener('change', function (e) {
      SCHED.common.minDur = Number(e.target.value) || 30; SCHED.common.result = null; render();
    });
    frag.appendChild(bar);
  }

  function jumpToMinute(min) {
    var scroll = document.querySelector('#scheduler-root .sch-scroll');
    if (scroll) scroll.scrollTo({ top: Math.max(0, min / 60 * HOUR() - 90), behavior: 'smooth' });
    document.querySelectorAll('#scheduler-root .sch-col').forEach(function (c) {
      c.classList.remove('sch-flash');
      void c.offsetWidth; // restart the animation
      c.classList.add('sch-flash');
    });
  }

  // ── Phase 3: Quick Availability Finder ────────────────────────────────────
  function minToHHMM(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  function hhmmToMin(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
    return m ? Math.min(1435, Number(m[1]) * 60 + Number(m[2])) : null;
  }

  // Debounced canonical search — a generation counter makes stale responses
  // impossible to apply over newer criteria.
  function finderSearch() {
    var f = SCHED.finder;
    if (!f.open || SCHED.mode !== 'day') return;
    if (f.timer) clearTimeout(f.timer);
    f.timer = setTimeout(function () {
      var gen = ++f.gen;
      f.loading = true; f.error = false;
      renderFinderOnly();
      var visible = filterTherapists(SCHED.therapists, { ids: SCHED.filterIds, discipline: SCHED.discipline, focusId: SCHED.focusId });
      var body = {
        date: SCHED.date, durationMin: f.durationMin, mode: f.mode,
        therapistIds: visible.length === SCHED.therapists.length ? [] : visible.map(function (t) { return t.id; }),
        discipline: f.discipline || undefined,
      };
      if (f.mode === 'exact') body.startMin = f.startMin;
      else { body.rangeStartMin = f.rangeStartMin; body.rangeEndMin = f.rangeEndMin; }
      fetch('/api/scheduler/find-availability', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http')); })
        .then(function (j) {
          if (gen !== f.gen) return; // superseded
          f.loading = false; f.result = j; renderFinderOnly();
        })
        .catch(function () {
          if (gen !== f.gen) return;
          f.loading = false; f.error = true; f.result = null; renderFinderOnly();
        });
    }, 280);
  }

  function renderFinderOnly() {
    var host = document.getElementById('sch-finder');
    if (!host) { render(); return; }
    var fresh = buildFinder();
    host.replaceWith(fresh);
  }

  function finderReasonText(u) {
    if (u.reason === 'busy') {
      return u.busyUntilMin != null ? 'Busy until ' + fmtTime12(u.busyUntilMin) : 'Busy';
    }
    if (u.reason === 'too_short') {
      return 'Only ' + fmtDur(u.availableMin || 0) + ' free — ' + SCHED.finder.durationMin + ' min requested';
    }
    return u.reasonLabel || 'Unavailable';
  }

  function buildFinder() {
    var f = SCHED.finder;
    var aside = document.createElement('aside');
    aside.className = 'sch-finder';
    aside.id = 'sch-finder';
    aside.setAttribute('aria-label', 'Quick availability finder');

    var discs = disciplinesOf(SCHED.therapists);
    var html =
      '<div class="sch-f-head">Find availability' +
        '<button type="button" class="sch-f-close" data-act="close" aria-label="Close finder">&#10005;</button></div>' +
      '<div class="sch-f-form">' +
        '<label class="sch-f-lbl">Date<input type="date" class="sch-f-input" data-f="date" value="' + esc(SCHED.date) + '"></label>' +
        '<div class="sch-f-modes" role="radiogroup" aria-label="Search mode">' +
          '<button type="button" class="sch-f-mode' + (f.mode === 'exact' ? ' on' : '') + '" data-mode="exact">Exact time</button>' +
          '<button type="button" class="sch-f-mode' + (f.mode === 'range' ? ' on' : '') + '" data-mode="range">Time range</button>' +
        '</div>' +
        (f.mode === 'exact'
          ? '<label class="sch-f-lbl">Start<input type="time" step="900" class="sch-f-input" data-f="start" value="' + minToHHMM(f.startMin) + '"></label>'
          : '<div class="sch-f-range">' +
              '<label class="sch-f-lbl">Between<input type="time" step="900" class="sch-f-input" data-f="rstart" value="' + minToHHMM(f.rangeStartMin) + '"></label>' +
              '<label class="sch-f-lbl">and<input type="time" step="900" class="sch-f-input" data-f="rend" value="' + minToHHMM(f.rangeEndMin) + '"></label>' +
            '</div>' +
            '<div class="sch-f-dayparts">' +
              '<button type="button" class="sch-chip" data-part="480,720">Morning</button>' +
              '<button type="button" class="sch-chip" data-part="720,1020">Afternoon</button>' +
              '<button type="button" class="sch-chip" data-part="480,1020">All day</button>' +
            '</div>') +
        '<label class="sch-f-lbl">Duration<select class="sch-f-input" data-f="dur">' +
          [30, 45, 60, 90, 120].map(function (d) {
            return '<option value="' + d + '"' + (f.durationMin === d ? ' selected' : '') + '>' + d + ' min</option>';
          }).join('') +
          '<option value="custom"' + ([30, 45, 60, 90, 120].indexOf(f.durationMin) === -1 ? ' selected' : '') + '>Custom…</option>' +
        '</select></label>' +
        ([30, 45, 60, 90, 120].indexOf(f.durationMin) === -1
          ? '<label class="sch-f-lbl">Minutes<input type="number" min="5" max="480" step="5" class="sch-f-input" data-f="durcustom" value="' + f.durationMin + '"></label>'
          : '') +
        (discs.length > 1
          ? '<label class="sch-f-lbl">Discipline<select class="sch-f-input" data-f="disc">' +
              '<option value="">All</option>' +
              discs.map(function (d) {
                return '<option value="' + esc(d) + '"' + (f.discipline === d ? ' selected' : '') + '>' + esc(d) + '</option>';
              }).join('') + '</select></label>'
          : '') +
        '<div class="sch-f-scope">Searches the therapists selected in the filter bar.</div>' +
      '</div>';

    // ── Results ──
    if (f.loading) {
      html += '<div class="sch-f-status">Checking availability…</div>';
    } else if (f.error) {
      html += '<div class="sch-f-status">Availability couldn\'t be checked. <button type="button" class="sch-mini" data-act="retry">Retry</button></div>';
    } else if (!f.result) {
      html += '<div class="sch-f-status">Choose a time to find available therapists.</div>';
    } else {
      var r = f.result;
      html += '<div class="sch-f-counts">' + r.counts.available + ' available · ' + r.counts.unavailable + ' unavailable</div>';

      if (r.available.length) {
        html += '<div class="sch-f-group">Available · ' + r.available.length + '</div>';
        r.available.forEach(function (c, i) {
          var line = f.mode === 'exact'
            ? '<span class="sch-f-fit">&#10003; ' + fmtTime12(r.requested.startMin) + '–' + fmtTime12(r.requested.endMin) + '</span>' +
              '<span class="sch-f-window">Window ' + fmtTime12(c.window.startMin) + '–' + fmtTime12(c.window.endMin) + ' · ' + fmtDur(c.windowMin) + '</span>'
            : '<span class="sch-f-window">' + c.windows.map(function (w) {
                return fmtTime12(w.startMin) + '–' + fmtTime12(w.endMin) + ' (' + fmtDur(w.durationMin) + ')';
              }).join(' · ') + '</span>';
          html += '<div class="sch-f-card" data-tid="' + esc(c.therapistProfileId) + '" data-idx="' + i + '">' +
            '<span class="sch-f-dot" style="background:' + esc(c.colour || '#0f7c6c') + ';"></span>' +
            '<span class="sch-f-main">' +
              '<span class="sch-f-name">' + esc(c.displayName) +
                (c.availabilityConfidence === 'default' ? ' <span class="sch-defbadge" title="Using the practice default hours">default hours</span>' : '') + '</span>' +
              '<span class="sch-f-role">' + esc(c.roleTitle || '') + '</span>' +
              line +
            '</span>' +
            '<span class="sch-f-actions">' +
              '<button type="button" class="sch-mini" data-act="view">View calendar</button>' +
              '<button type="button" class="sch-mini primary" data-act="book">Schedule</button>' +
            '</span></div>';
        });
      } else {
        html += '<div class="sch-f-none">No therapists available' +
          (f.mode === 'exact' ? ' at ' + fmtTime12(r.requested.startMin) : ' in this range') + '.</div>' +
          '<div class="sch-f-nudges">' +
            '<button type="button" class="sch-chip" data-nudge="-30">Earlier</button>' +
            '<button type="button" class="sch-chip" data-nudge="30">Later</button>' +
          '</div>';
        if (r.suggestions && r.suggestions.length) {
          html += '<div class="sch-f-group">Closest availability</div>' +
            r.suggestions.map(function (sg) {
              return '<button type="button" class="sch-f-sugg" data-sugg="' + sg.startMin + '">' +
                '<span class="sch-f-dot" style="background:' + esc(sg.colour || '#0f7c6c') + ';"></span>' +
                esc(sg.displayName) + ' · ' + fmtTime12(sg.startMin) + '–' + fmtTime12(sg.endMin) + '</button>';
            }).join('');
        }
      }

      if (r.unavailable.length) {
        html += '<details class="sch-f-unav"' + (r.available.length ? '' : ' open') + '><summary>Unavailable · ' + r.unavailable.length + '</summary>' +
          r.unavailable.map(function (u) {
            return '<div class="sch-f-urow"><span class="sch-f-dot" style="background:' + esc(u.colour || '#99928a') + ';"></span>' +
              '<span class="sch-f-uname">' + esc(u.displayName) + '</span>' +
              '<span class="sch-f-ureason">' + esc(finderReasonText(u)) + '</span></div>';
          }).join('') + '</details>';
      }
    }

    aside.innerHTML = html;

    // ── Wiring ──
    aside.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act],[data-mode],[data-part],[data-nudge],[data-sugg]');
      if (!el) return;
      if (el.dataset.act === 'close') { SCHED.finder.open = false; render(); return; }
      if (el.dataset.act === 'retry') { finderSearch(); return; }
      if (el.dataset.mode) { f.mode = el.dataset.mode; f.result = null; render(); finderSearch(); return; }
      if (el.dataset.part) {
        var pp = el.dataset.part.split(',').map(Number);
        f.rangeStartMin = pp[0]; f.rangeEndMin = pp[1]; render(); finderSearch(); return;
      }
      if (el.dataset.nudge) {
        f.startMin = Math.max(0, Math.min(1435 - f.durationMin, f.startMin + Number(el.dataset.nudge)));
        render(); finderSearch(); return;
      }
      if (el.dataset.sugg) { f.startMin = Number(el.dataset.sugg); render(); finderSearch(); return; }

      var card = e.target.closest('.sch-f-card');
      if (card && el.dataset.act === 'view') {
        SCHED.focusId = card.dataset.tid; render();
        jumpToMinute(f.mode === 'exact' ? f.startMin : f.rangeStartMin);
        return;
      }
      if (card && el.dataset.act === 'book') {
        var startMin = f.mode === 'exact' ? f.startMin
          : (SCHED.finder.result && findFirstWindowStart(card.dataset.tid)) || f.rangeStartMin;
        if (typeof global.openBookingPanel === 'function') {
          var dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          var ppd = SCHED.date.split('-').map(Number);
          global.openBookingPanel({
            day: dayKeys[new Date(Date.UTC(ppd[0], ppd[1] - 1, ppd[2])).getUTCDay()],
            date: SCHED.date,
            startH: Math.floor(startMin / 60), startM: startMin % 60,
            endH: Math.floor((startMin + f.durationMin) / 60), endM: (startMin + f.durationMin) % 60,
          });
          if (typeof global.selectBspTherapist === 'function') {
            setTimeout(function () { try { global.selectBspTherapist(card.dataset.tid); } catch (err) {} }, 400);
          }
        }
      }
    });

    aside.addEventListener('change', function (e) {
      var t = e.target, v = t.value;
      if (t.dataset.f === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { SCHED.date = v; load(); finderSearch(); }
      if (t.dataset.f === 'start') { var m = hhmmToMin(v); if (m != null) { f.startMin = m; finderSearch(); } }
      if (t.dataset.f === 'rstart') { var m1 = hhmmToMin(v); if (m1 != null) { f.rangeStartMin = m1; finderSearch(); } }
      if (t.dataset.f === 'rend') { var m2 = hhmmToMin(v); if (m2 != null) { f.rangeEndMin = m2; finderSearch(); } }
      if (t.dataset.f === 'dur') {
        if (v === 'custom') { f.durationMin = 75; render(); finderSearch(); }
        else { f.durationMin = Number(v); render(); finderSearch(); }
      }
      if (t.dataset.f === 'durcustom') {
        var n = Math.max(5, Math.min(480, Number(v) || 60)); f.durationMin = n; finderSearch();
      }
      if (t.dataset.f === 'disc') { f.discipline = v; finderSearch(); }
    });

    // Hover cross-highlighting: result card ↔ therapist column
    aside.addEventListener('mouseover', function (e) {
      var card = e.target.closest('.sch-f-card'); if (!card) return;
      var col = document.querySelector('.sch-col[data-tid="' + card.dataset.tid + '"]');
      if (col) col.classList.add('sch-hovered');
    });
    aside.addEventListener('mouseout', function (e) {
      var card = e.target.closest('.sch-f-card'); if (!card) return;
      var col = document.querySelector('.sch-col[data-tid="' + card.dataset.tid + '"]');
      if (col) col.classList.remove('sch-hovered');
    });

    return aside;
  }

  function findFirstWindowStart(tid) {
    var r = SCHED.finder.result;
    if (!r) return null;
    var row = (r.available || []).find(function (c) { return c.therapistProfileId === tid; });
    return row && row.windows && row.windows.length ? row.windows[0].startMin : null;
  }

  // ── Phase 5/6: Scheduler Map ──────────────────────────────────────────────
  function persistMapOpen() {
    try {
      localStorage.setItem('sch_map', SCHED.map.open ? '1' : '0');
      localStorage.setItem('sch_footprints', SCHED.map.footprints ? '1' : '0');
    } catch (e) {}
  }

  // Lazy SDK: fetched only when the map first opens; the calendar never waits.
  function mapEnsure() {
    var m = SCHED.map;
    if (m.sdk === 'ready') { mapFetchPoints(); return; }
    if (m.sdk === 'loading') return;
    m.sdk = 'loading'; renderMapStatus();
    global.onGoogleMapsReady = global.onGoogleMapsReady || function () {};
    var prevReady = global.onGoogleMapsReady;
    global.onGoogleMapsReady = function () {
      prevReady();
      m.sdk = 'ready';
      mapInit();
      mapFetchPoints();
    };
    fetch('/api/maps/sdk-url', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('unavailable')); })
      .then(function (j) {
        if (global.google && global.google.maps) { global.onGoogleMapsReady(); return; }
        var sc = document.createElement('script');
        sc.src = j.url; sc.async = true;
        sc.onerror = function () { m.sdk = 'error'; renderMapStatus(); };
        document.head.appendChild(sc);
      })
      .catch(function () { m.sdk = 'error'; renderMapStatus(); });
  }

  function mapInit() {
    var m = SCHED.map;
    if (m.gmap || !global.google) return;
    if (!m.el) { m.el = document.createElement('div'); m.el.className = 'sch-map-canvas'; }
    m.gmap = new google.maps.Map(m.el, {
      center: { lat: -31.95, lng: 115.86 }, zoom: 9,   // starting view only — bounds follow data
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      clickableIcons: false,
    });
    m.info = new google.maps.InfoWindow();
    // Respect the user's viewport after a manual gesture (§18)
    m.gmap.addListener('dragstart', function () { m.userMoved = true; });
  }

  function mapFetchPoints(force) {
    var m = SCHED.map;
    if (!m.open || SCHED.mode !== 'day') return;
    var key = SCHED.date;
    if (!force && m.pointsKey === key && m.points) { mapDraw(); return; }
    m.loading = true; m.error = false; renderMapStatus();
    fetch('/api/scheduler/map-points?date=' + key, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http')); })
      .then(function (j) {
        if (SCHED.date !== key) return; // superseded by a date change
        m.points = j.points || [];
        m.meta = { telehealth: j.telehealth || 0, unmappable: j.unmappable || 0 };
        m.pointsKey = key; m.loading = false; m.userMoved = false;
        renderMapStatus(); mapDraw();
      })
      .catch(function () { m.loading = false; m.error = true; renderMapStatus(); });
  }

  function mapVisiblePoints(visible) {
    var ids = {};
    (visible || filterTherapists(SCHED.therapists, {
      ids: SCHED.filterIds, discipline: SCHED.discipline, focusId: SCHED.focusId,
    })).forEach(function (t) { ids[t.id] = true; });
    return (SCHED.map.points || []).filter(function (p) { return ids[p.therapistProfileId]; });
  }

  function mapClear() {
    SCHED.map.markers.forEach(function (mk) { mk.setMap(null); });
    SCHED.map.polys.forEach(function (pg) { pg.setMap(null); });
    SCHED.map.markers = []; SCHED.map.polys = [];
  }

  function mapDraw() {
    var m = SCHED.map;
    if (!m.gmap || !m.points) return;
    mapClear();
    var pts = mapVisiblePoints();
    var focus = SCHED.focusId;

    // Same suburb, several therapists → deterministic small offsets so
    // markers stay individually clickable.
    var bySub = {};
    pts.forEach(function (p) {
      var k = p.suburb.toLowerCase();
      bySub[k] = bySub[k] || [];
      bySub[k].push(p);
    });
    var bounds = new google.maps.LatLngBounds();

    Object.keys(bySub).forEach(function (k) {
      // group per therapist within the suburb (one marker + visit count)
      var byT = {};
      bySub[k].forEach(function (p) {
        byT[p.therapistProfileId] = byT[p.therapistProfileId] || [];
        byT[p.therapistProfileId].push(p);
      });
      Object.keys(byT).forEach(function (tid, ti) {
        var list = byT[tid].sort(function (a, b) { return a.startMin - b.startMin; });
        var first = list[0];
        var faded = focus && tid !== focus;
        var pos = { lat: first.lat + ti * 0.006, lng: first.lng + ti * 0.006 };
        bounds.extend(pos);
        var mk = new google.maps.Marker({
          map: m.gmap, position: pos,
          title: first.therapistName + ' · ' + first.suburb +
            (list.length > 1 ? ' · ' + list.length + ' visits' : ' · ' + fmtTime12(first.startMin)),
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: faded ? 6 : 9,
            fillColor: first.therapistColour, fillOpacity: faded ? 0.3 : 0.95,
            strokeColor: '#ffffff', strokeWeight: 2, strokeOpacity: faded ? 0.4 : 1,
          },
          zIndex: faded ? 1 : 3,
          label: list.length > 1 ? { text: String(list.length), color: '#fff', fontSize: '10px', fontWeight: '700' } : null,
        });
        mk.__eids = list.map(function (p) { return p.eventId; });
        mk.addListener('mouseover', function () { mapHighlightTiles(mk.__eids, true); });
        mk.addListener('mouseout', function () { mapHighlightTiles(mk.__eids, false); });
        mk.addListener('click', function () {
          var content = document.createElement('div');
          content.className = 'sch-map-pop';
          content.innerHTML = '<strong>' + esc(first.therapistName) + '</strong><br>' +
            list.map(function (p) { return fmtTime12(p.startMin) + '–' + fmtTime12(p.endMin); }).join(', ') +
            '<br>' + esc(first.suburb);
          var btn = document.createElement('button');
          btn.className = 'sch-mini'; btn.textContent = 'View on calendar';
          btn.addEventListener('click', function () {
            m.info.close();
            jumpToMinute(first.startMin);
            mapHighlightTiles(mk.__eids, true);
            setTimeout(function () { mapHighlightTiles(mk.__eids, false); }, 2400);
          });
          content.appendChild(document.createElement('br'));
          content.appendChild(btn);
          m.info.setContent(content);
          m.info.open({ map: m.gmap, anchor: mk });
        });
        m.markers.push(mk);
      });
    });

    // ── Phase 6: daily service footprints (derived, never stored) ──
    if (m.footprints) {
      var byTher = {};
      pts.forEach(function (p) {
        byTher[p.therapistProfileId] = byTher[p.therapistProfileId] || [];
        byTher[p.therapistProfileId].push(p);
      });
      Object.keys(byTher).forEach(function (tid) {
        var uniq = dedupSuburbPoints(byTher[tid]);
        var clusters = clusterPoints(uniq, 45);
        clusters.forEach(function (cluster) {
          if (cluster.length < 3) return;      // 1-2 points: markers carry the story
          var hull = convexHull(cluster);
          if (hull.length < 3) return;
          var faded = focus && tid !== focus;
          var colour = byTher[tid][0].therapistColour;
          m.polys.push(new google.maps.Polygon({
            map: m.gmap,
            paths: hull.map(function (h) { return { lat: h.lat, lng: h.lng }; }),
            fillColor: colour, fillOpacity: faded ? 0.04 : (focus === tid ? 0.18 : 0.09),
            strokeColor: colour, strokeOpacity: faded ? 0.1 : 0.35, strokeWeight: 1.5,
            clickable: false, zIndex: 0,
          }));
        });
      });
    }

    // Bounds: only on data/context changes, never fighting a manual viewport
    var bKey = SCHED.date + '|' + (focus || 'all') + '|' + pts.length;
    if (!m.userMoved && pts.length && m.boundsKey !== bKey) {
      m.boundsKey = bKey;
      m.gmap.fitBounds(bounds, 48);
      if (pts.length === 1) m.gmap.setZoom(Math.min(m.gmap.getZoom(), 13));
    }

    renderMapLegend(pts);
  }

  function mapHighlightTiles(eids, on) {
    (eids || []).forEach(function (eid) {
      var tile = document.querySelector('.sch-tile[data-eid="' + eid + '"]');
      if (tile) tile.classList.toggle('sch-map-hi', !!on);
    });
  }

  // Calendar → map: hovering a tile emphasises its marker
  function mapEmphasiseEvent(eid, on) {
    var m = SCHED.map;
    if (!m.gmap) return;
    m.markers.forEach(function (mk) {
      if ((mk.__eids || []).indexOf(eid) === -1) return;
      var ic = mk.getIcon();
      ic.scale = on ? 12 : 9;
      mk.setIcon(ic);
      mk.setZIndex(on ? 9 : 3);
    });
  }

  function renderMapStatus() {
    var host = document.getElementById('sch-map-status');
    if (!host) return;
    var m = SCHED.map;
    if (m.sdk === 'error') host.innerHTML = 'Map unavailable. <button type="button" class="sch-mini" onclick="OpalScheduler._mapRetry()">Retry</button>';
    else if (m.sdk === 'loading' || m.loading) host.textContent = 'Loading service locations…';
    else if (m.error) host.innerHTML = 'Locations couldn\'t be loaded. <button type="button" class="sch-mini" onclick="OpalScheduler._mapRetry()">Retry</button>';
    else host.textContent = '';
  }

  function renderMapLegend(pts) {
    var host = document.getElementById('sch-map-legend');
    if (!host) return;
    var m = SCHED.map;
    if (!pts.length) {
      var msg = 'No service locations to show for this day.';
      var extra = [];
      if (m.meta.telehealth) extra.push('Telehealth: ' + m.meta.telehealth);
      if (m.meta.unmappable) extra.push('Without location: ' + m.meta.unmappable);
      host.innerHTML = '<div class="sch-map-empty">' + msg +
        (extra.length ? '<br><span>' + extra.join(' · ') + '</span>' : '') + '</div>';
      return;
    }
    var byT = {};
    pts.forEach(function (p) {
      byT[p.therapistProfileId] = byT[p.therapistProfileId] ||
        { name: p.therapistName, colour: p.therapistColour, visits: 0, suburbs: [] };
      byT[p.therapistProfileId].visits += 1;
      if (byT[p.therapistProfileId].suburbs.indexOf(p.suburb) === -1) byT[p.therapistProfileId].suburbs.push(p.suburb);
    });
    var extra2 = [];
    if (m.meta.telehealth) extra2.push('Telehealth today: ' + m.meta.telehealth);
    if (m.meta.unmappable) extra2.push(m.meta.unmappable + ' without a mappable location');
    host.innerHTML = Object.keys(byT).map(function (tid) {
      var t = byT[tid];
      return '<button type="button" class="sch-map-leg" data-tid="' + esc(tid) + '"' +
        ' aria-label="' + esc(t.name + ', ' + t.visits + ' face-to-face visits today: ' + t.suburbs.join(', ')) + '">' +
        '<span class="sch-f-dot" style="background:' + esc(t.colour) + ';"></span>' +
        '<span class="sch-map-leg-name">' + esc(t.name) + '</span>' +
        '<span class="sch-map-leg-n">' + t.visits + ' visit' + (t.visits === 1 ? '' : 's') + '</span>' +
        '<span class="sch-map-leg-subs">' + esc(t.suburbs.join(' · ')) + '</span>' +
        '</button>';
    }).join('') + (extra2.length ? '<div class="sch-map-note">' + extra2.join(' · ') + '</div>' : '');
    host.onclick = function (e) {
      var b = e.target.closest('.sch-map-leg'); if (!b) return;
      SCHED.focusId = SCHED.focusId === b.dataset.tid ? null : b.dataset.tid;
      render(); loadAvailability(); loadWeekCapacity(); mapDraw();
    };
  }

  function buildMapPanel() {
    var m = SCHED.map;
    var aside = document.createElement('aside');
    aside.className = 'sch-finder sch-map-panel';
    aside.id = 'sch-map-panel';
    aside.innerHTML =
      '<div class="sch-f-head">Map — ' + esc(fmtDayLabel(SCHED.date)) +
        '<span style="flex:1"></span>' +
        '<label class="sch-map-toggle"><input type="checkbox" id="sch-fp-toggle"' + (m.footprints ? ' checked' : '') + '> Operating areas</label>' +
        '<button type="button" class="sch-f-close" data-act="close" aria-label="Hide map">&#10005;</button></div>' +
      '<div id="sch-map-status" class="sch-f-status"></div>' +
      '<div id="sch-map-host"></div>' +
      '<div id="sch-map-legend" class="sch-map-legend" aria-live="polite"></div>';
    aside.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="close"]')) { m.open = false; persistMapOpen(); render(); }
    });
    aside.addEventListener('change', function (e) {
      if (e.target.id === 'sch-fp-toggle') { m.footprints = e.target.checked; persistMapOpen(); mapDraw(); }
    });
    return aside;
  }

  function mountMapPanel(wrap) {
    var aside = buildMapPanel();
    wrap.appendChild(aside);
    var host = aside.querySelector('#sch-map-host');
    if (!SCHED.map.el) { SCHED.map.el = document.createElement('div'); SCHED.map.el.className = 'sch-map-canvas'; }
    host.appendChild(SCHED.map.el);   // persistent canvas — the map instance survives re-renders
    renderMapStatus();
    if (SCHED.map.sdk === 'ready') { mapDraw(); }
    else mapEnsure();
  }

  // ── Day grid ──────────────────────────────────────────────────────────────
  function renderDay(frag, visible) {
    var wrap = document.createElement('div');
    wrap.className = 'sch-day-wrap';
    var scroll = document.createElement('div');
    scroll.className = 'sch-scroll';
    var grid = document.createElement('div');
    grid.className = 'sch-grid' + (SCHED.focusId ? ' focused' : '');
    grid.style.setProperty('--sch-cols', String(visible.length || 1));
    grid.style.setProperty('--sch-hour', HOUR() + 'px');

    var bodyH = 24 * HOUR();
    var isToday = SCHED.date === todayPerthYmd();
    var mode = SCHED.focusId ? 'focus' : 'cross';

    // header row
    var corner = document.createElement('div');
    corner.className = 'sch-corner';
    grid.appendChild(corner);
    visible.forEach(function (t) {
      var dayEvents = eventsForTherapistDay(SCHED.events, t.id, SCHED.date);
      var head = document.createElement('div');
      head.className = 'sch-headcell';
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.title = 'Focus on ' + t.displayName;
      var avh = (SCHED.overlay || SCHED.focusId) && SCHED.avail.key === SCHED.date ? SCHED.avail.byId[t.id] : null;
      var subBits = [esc(t.roleTitle || '')];
      if (avh && avh.working) subBits.push('<span class="sch-cap">' + esc(fmtDur(avh.capacity.availableMin)) + ' free</span>');
      if (avh && avh.availabilityConfidence === 'default') subBits.push('<span class="sch-defbadge" title="No work schedule entered for this week — using the practice default hours">default hours</span>');
      head.innerHTML =
        '<span class="sch-h-av" style="background:' + esc(t.colour || '#0f7c6c') + ';">' + esc(t.initials || '?') + '</span>' +
        '<span class="sch-h-id">' +
          '<span class="sch-h-name">' + esc(t.displayName) + '</span>' +
          '<span class="sch-h-sub">' + subBits.filter(Boolean).join(' · ') + '</span>' +
        '</span>' +
        '<span class="sch-h-count" title="Appointments this day">' + apptCount(dayEvents) + '</span>';
      var focus = function () { SCHED.focusId = t.id; render(); loadAvailability(); loadWeekCapacity(); };
      head.addEventListener('click', focus);
      head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); } });
      grid.appendChild(head);
    });

    // body row: time rail
    var rail = document.createElement('div');
    rail.className = 'sch-timerail';
    rail.style.height = bodyH + 'px';
    for (var h = 0; h < 24; h++) {
      var lbl = document.createElement('div');
      lbl.className = 'sch-t-label';
      lbl.style.top = (h * HOUR()) + 'px';
      lbl.textContent = ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM');
      rail.appendChild(lbl);
    }
    grid.appendChild(rail);

    // body row: one column per therapist
    visible.forEach(function (t) {
      var col = document.createElement('div');
      col.className = 'sch-col';
      col.dataset.tid = t.id;
      col.style.height = bodyH + 'px';

      var av = (SCHED.overlay || SCHED.focusId) && SCHED.avail.key === SCHED.date ? SCHED.avail.byId[t.id] : null;
      if (av) {
        // Real availability from the engine: paint every segment type.
        if (!av.working) {
          col.classList.add('sch-notworking');
          var onLeave = av.segments.some(function (x) { return x.type === 'leave'; });
          var nw = document.createElement('div');
          nw.className = 'sch-nw-label' + (SCHED.focusId ? ' focus' : '');
          nw.textContent = SCHED.focusId
            ? (t.displayName + (onLeave ? ' is on leave this day.' : " isn't scheduled to work this day."))
            : (onLeave ? 'On leave' : 'Not working');
          nw.style.top = (10.5 * HOUR()) + 'px';
          col.appendChild(nw);
        } else {
          var inFocus = !!SCHED.focusId;
          av.segments.forEach(function (seg) {
            if (seg.type === 'busy') return; // tiles carry busy visually
            var band = document.createElement('div');
            band.className = 'sch-avl ' + seg.type + (inFocus ? ' focus' : '');
            band.style.top = (seg.startMin / 60 * HOUR()) + 'px';
            var bandPx = (seg.endMin - seg.startMin) / 60 * HOUR();
            band.style.height = bandPx + 'px';

            if (seg.type === 'buffer' && inFocus && bandPx >= 12) {
              var bl = document.createElement('span');
              bl.className = 'sch-buf-lbl';
              bl.textContent = 'Buffer · ' + (seg.endMin - seg.startMin) + ' min';
              band.appendChild(bl);
            }

            if (seg.type === 'available') {
              var dur = seg.endMin - seg.startMin;
              band.title = fmtDur(dur) + ' available · ' + fmtTime12(seg.startMin) + '–' + fmtTime12(seg.endMin) + ' · click to book';
              if (inFocus && bandPx >= 46) {
                // Focus Mode: availability is the headline — full gap card
                var card = document.createElement('span');
                card.className = 'sch-avl-card';
                card.innerHTML =
                  '<span class="sch-avl-tag">Available</span>' +
                  '<span class="sch-avl-times">' + fmtTime12(seg.startMin) + ' – ' + fmtTime12(seg.endMin) + ' · ' + fmtDur(dur) + '</span>' +
                  '<button type="button" class="sch-avl-add">+ Add appointment</button>';
                band.appendChild(card);
              } else if (dur >= 60 && bandPx >= 34) {
                var lbl = document.createElement('span');
                lbl.className = 'sch-avl-lbl';
                lbl.textContent = fmtDur(dur) + ' available';
                band.appendChild(lbl);
              }
              (function (startMin, endMin) {
                band.addEventListener('click', function (ev) {
                  if (typeof global.openBookingPanel !== 'function') return;
                  // Click WITHIN the gap: snap the clicked time (15-min grid),
                  // then clamp so the appointment still fits the true segment.
                  var windowLen = endMin - startMin;
                  var dflt = Math.min(global.DEFAULT_BOOKING_TYPE ? 60 : 60, 60, windowLen);
                  var clicked = startMin + Math.floor((ev.offsetY || 0) / HOUR() * 60);
                  var start = Math.max(startMin, Math.min(snap15(clicked), endMin - dflt));
                  var dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                  var pp = SCHED.date.split('-').map(Number);
                  var dayKey = dayKeys[new Date(Date.UTC(pp[0], pp[1] - 1, pp[2])).getUTCDay()];
                  global.openBookingPanel({
                    day: dayKey, date: SCHED.date,
                    startH: Math.floor(start / 60), startM: start % 60,
                    endH: Math.floor((start + dflt) / 60), endM: (start + dflt) % 60,
                  });
                  if (SCHED.focusId && typeof global.selectBspTherapist === 'function') {
                    setTimeout(function () { try { global.selectBspTherapist(SCHED.focusId); } catch (err) {} }, 400);
                  }
                });
              })(seg.startMin, seg.endMin);
            }
            col.appendChild(band);
          });
        }
      } else {
        // soft off-hours wash (visual calm, explicitly NOT availability)
        [['0', WORK_START_H], [String(WORK_END_H), 24 - WORK_END_H]].forEach(function (band) {
          var off = document.createElement('div');
          off.className = 'sch-offhours';
          off.style.top = (Number(band[0]) * HOUR()) + 'px';
          off.style.height = (band[1] * HOUR()) + 'px';
          col.appendChild(off);
        });
      }

      var items = assignLanes(eventsForTherapistDay(SCHED.events, t.id, SCHED.date));
      items.forEach(function (it) {
        var tile = document.createElement('div');
        tile.className = 'sch-tile';
        tile.setAttribute('data-type', it.ev.eventType || 'outlook');
        if (it.ev.id) tile.setAttribute('data-eid', it.ev.id);
        var top = it.startMin / 60 * HOUR();
        // 4px bottom gap keeps back-to-back events visibly separate (matches
        // the personal calendar's separation rule)
        var height = Math.max(9, (it.endMin - it.startMin) / 60 * HOUR() - 4);
        var w = 100 / (it.laneCount || 1);
        tile.style.top = top + 'px';
        tile.style.height = height + 'px';
        if ((it.laneCount || 1) > 1) {
          tile.style.left = 'calc(' + (it.lane * w) + '% + 3px)';
          tile.style.right = 'auto';
          tile.style.width = 'calc(' + w + '% - 6px)';
        }
        var label = safeLabel(it.ev, mode);
        var suburb = extractSuburb(it.ev.location);
        var timeStr = fmtTime12(it.startMin) + '–' + fmtTime12(it.endMin);
        var html = '';
        if (height >= 30) html += '<span class="sch-e-time">' + esc(timeStr) + '</span>';
        html += '<span class="sch-e-label">' + esc(label) + '</span>';
        if (height >= 42 && suburb) html += '<span class="sch-e-loc">' + esc(suburb) + '</span>';
        tile.innerHTML = html;
        tile.title = timeStr + ' · ' + label + (suburb ? ' · ' + suburb : '');
        col.appendChild(tile);
      });

      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'sch-empty-col';
        empty.textContent = 'No appointments';
        col.appendChild(empty);
      }

      if (isToday) {
        var nowMin = perthParts(new Date().toISOString()).minutes;
        var line = document.createElement('div');
        line.className = 'sch-nowline';
        line.style.top = (nowMin / 60 * HOUR()) + 'px';
        col.appendChild(line);
      }
      // Finder emphasis: outline the requested slot in available columns
      var fr = SCHED.finder;
      if (fr.open && fr.mode === 'exact' && fr.result && fr.result.requested &&
          fr.result.requested.date === SCHED.date &&
          (fr.result.available || []).some(function (c) { return c.therapistProfileId === t.id; })) {
        var req = document.createElement('div');
        req.className = 'sch-req-slot';
        req.style.top = (fr.result.requested.startMin / 60 * HOUR()) + 'px';
        req.style.height = ((fr.result.requested.endMin - fr.result.requested.startMin) / 60 * HOUR()) + 'px';
        col.appendChild(req);
      }
      grid.appendChild(col);
    });

    scroll.appendChild(grid);
    wrap.appendChild(scroll);
    if (SCHED.finder.open) wrap.appendChild(buildFinder());
    else if (SCHED.map.open) mountMapPanel(wrap);
    frag.appendChild(wrap);

    // Calendar → map cross-highlighting (delegated, subtle)
    grid.addEventListener('mouseover', function (e) {
      var tile = e.target.closest('.sch-tile[data-eid]');
      if (tile && SCHED.map.open) mapEmphasiseEvent(tile.dataset.eid, true);
    });
    grid.addEventListener('mouseout', function (e) {
      var tile = e.target.closest('.sch-tile[data-eid]');
      if (tile && SCHED.map.open) mapEmphasiseEvent(tile.dataset.eid, false);
    });

    // scroll to working hours on first paint of the day
    requestAnimationFrame(function () {
      scroll.scrollTop = Math.max(0, (WORK_START_H - 0.5) * HOUR());
    });

    // keep the now-line honest without re-rendering the world
    if (SCHED.nowTimer) clearInterval(SCHED.nowTimer);
    if (isToday) {
      SCHED.nowTimer = setInterval(function () {
        var el = root(); if (!el || SCHED.mode !== 'day') return;
        var nowMin = perthParts(new Date().toISOString()).minutes;
        el.querySelectorAll('.sch-nowline').forEach(function (l) {
          l.style.top = (nowMin / 60 * HOUR()) + 'px';
        });
      }, 60000);
    }
  }

  // ── Week view (group by therapist) ────────────────────────────────────────
  var WK_MAX_ITEMS = 5;

  function renderWeek(frag, visible) {
    var wrap = document.createElement('div');
    wrap.className = 'sch-week';
    var monday = mondayOfYmd(SCHED.date);
    var grouped = groupWeek(SCHED.events, visible, monday);
    var todayYmd = todayPerthYmd();

    // include weekend columns only when the week actually has weekend events
    var hasWeekend = visible.some(function (t) {
      return grouped.byTherapist[t.id][grouped.days[5]].length ||
             grouped.byTherapist[t.id][grouped.days[6]].length;
    });
    var days = hasWeekend ? grouped.days : grouped.days.slice(0, 5);
    var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    visible.forEach(function (t) {
      var weekTotal = 0;
      days.forEach(function (d) { weekTotal += apptCount(grouped.byTherapist[t.id][d]); });

      var row = document.createElement('div');
      row.className = 'sch-wk-row';
      var head = document.createElement('div');
      head.className = 'sch-wk-head';
      head.setAttribute('role', 'button'); head.setAttribute('tabindex', '0');
      head.title = 'Focus on ' + t.displayName;
      head.innerHTML =
        '<span class="sch-h-av" style="background:' + esc(t.colour || '#0f7c6c') + ';">' + esc(t.initials || '?') + '</span>' +
        '<span class="sch-wk-name">' + esc(t.displayName) + '</span>' +
        '<span class="sch-wk-sub">' + esc(t.roleTitle || '') +
          ' · ' + weekTotal + ' appointment' + (weekTotal === 1 ? '' : 's') + ' this week</span>';
      head.addEventListener('click', function () { SCHED.focusId = t.id; SCHED.mode = 'day'; render(); });
      row.appendChild(head);

      var daysEl = document.createElement('div');
      daysEl.className = 'sch-wk-days';
      daysEl.style.setProperty('--sch-wk-cols', String(days.length));
      days.forEach(function (d, i) {
        var evs = grouped.byTherapist[t.id][d];
        var cell = document.createElement('div');
        cell.className = 'sch-wk-day' + (d === todayYmd ? ' today' : '');
        cell.title = 'Open ' + dayNames[i] + ' in day view';
        var html = '<div class="sch-wk-daylabel">' + dayNames[i] + ' ' + Number(d.slice(8)) + '</div>';
        if (!evs.length) html += '<div class="sch-wk-quiet">—</div>';
        evs.slice(0, WK_MAX_ITEMS).forEach(function (x) {
          var suburb = extractSuburb(x.ev.location);
          html += '<div class="sch-wk-item" data-type="' + esc(x.ev.eventType || 'outlook') + '">' +
            '<span class="sch-wk-dot"></span>' +
            '<span class="sch-wk-time">' + esc(fmtTime12(x.startMin)) + '</span>' +
            '<span>' + esc(safeLabel(x.ev, 'cross')) + (suburb ? ' · ' + esc(suburb) : '') + '</span>' +
            '</div>';
        });
        if (evs.length > WK_MAX_ITEMS) html += '<div class="sch-wk-more">+' + (evs.length - WK_MAX_ITEMS) + ' more</div>';
        cell.innerHTML = html;
        cell.addEventListener('click', function () { SCHED.date = d; SCHED.mode = 'day'; load(); });
        daysEl.appendChild(cell);
      });
      row.appendChild(daysEl);
      wrap.appendChild(row);
    });

    if (!visible.length) {
      wrap.innerHTML = '<div class="sch-status">No therapists match the current filters.</div>';
    }
    frag.appendChild(wrap);
  }

  // ── Render root ───────────────────────────────────────────────────────────
  function render() {
    var el = root(); if (!el) return;
    var frag = document.createDocumentFragment();
    renderToolbar(frag);
    renderFilters(frag);

    if (SCHED.loading) {
      var st = document.createElement('div');
      st.className = 'sch-status';
      st.textContent = 'Loading schedules…';
      frag.appendChild(st);
    } else {
      var visible = filterTherapists(SCHED.therapists, {
        ids: SCHED.filterIds, discipline: SCHED.discipline, focusId: SCHED.focusId,
      });
      if (!SCHED.therapists.length) {
        var none = document.createElement('div');
        none.className = 'sch-status';
        none.textContent = 'No therapists found for this practice.';
        frag.appendChild(none);
      } else if (SCHED.mode === 'week') {
        renderWeek(frag, visible);
      } else {
        renderCommon(frag, visible);
        renderDay(frag, visible);
      }
    }
    el.innerHTML = '';
    el.appendChild(frag);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function open() {
    if (!SCHED.date) SCHED.date = todayPerthYmd();
    load();
  }

  function nav(dir) {
    if (dir === 'today') SCHED.date = todayPerthYmd();
    else SCHED.date = addDaysYmd(SCHED.date || todayPerthYmd(),
      (SCHED.mode === 'week' ? 7 : 1) * dir);
    load();
    if (SCHED.map.open) mapFetchPoints();
    if (SCHED.finder.open) finderSearch();
  }

  function refresh() { load(true); }

  global.OpalScheduler = {
    open: open, nav: nav, refresh: refresh, _state: SCHED,
    _mapRetry: function () { SCHED.map.sdk = 'none'; SCHED.map.error = false; mapEnsure(); },
  };

})(typeof window !== 'undefined' ? window : null);

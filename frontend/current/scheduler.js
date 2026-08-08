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


  // ── Matrix pure helpers (Scheduling-Assistant pivot) ──────────────────────
  // The horizontal free/busy matrix derives everything it paints from the
  // canonical availability segments; these helpers are pure so the matrix
  // logic is unit-testable in node.

  // Visible time window for the matrix. 'work' hugs the organisation's
  // working-day bounds with an hour of context either side; 'full' shows
  // the whole day.
  function matrixWindow(zoom, workingHours) {
    if (zoom === 'full') return { startMin: 0, endMin: 1440 };
    var ws = (workingHours && workingHours.startMin != null) ? workingHours.startMin : 480;
    var we = (workingHours && workingHours.endMin != null) ? workingHours.endMin : 1020;
    var s = Math.max(0, Math.floor(ws / 60) * 60 - 60);
    var e = Math.min(1440, Math.ceil(we / 60) * 60 + 60);
    if (e <= s) { s = 420; e = 1140; }
    return { startMin: s, endMin: e };
  }

  // Simplified paint runs for one therapist row. Quiet background means
  // genuinely available; only the non-bookable states get a wash. Busy time
  // is drawn as event blocks, so busy segments need no paint of their own.
  function trackPaint(entry) {
    if (!entry || !entry.segments) return [];
    var runs = [];
    entry.segments.forEach(function (s) {
      var cls = null;
      if (s.type === 'outside_hours' || s.type === 'not_working') cls = 'off';
      else if (s.type === 'leave') cls = 'leave';
      else if (s.type === 'buffer') cls = 'buffer';
      else if (s.type === 'short_gap') cls = 'short';
      if (!cls) return;
      var last = runs[runs.length - 1];
      if (last && last.cls === cls && last.endMin === s.startMin) { last.endMin = s.endMin; return; }
      runs.push({ startMin: s.startMin, endMin: s.endMin, cls: cls });
    });
    return runs;
  }

  // Verdict for a proposed [startMin, startMin+durationMin) slot against one
  // therapist's availability segments. Busy/leave outrank outside-hours so a
  // row is never called merely "outside hours" when it actually conflicts.
  function slotVerdict(entry, startMin, durationMin) {
    if (!entry || !entry.segments || !entry.segments.length) {
      return { state: 'unknown', label: 'No availability data' };
    }
    var endMin = startMin + durationMin;
    var hasBusy = false, hasLeave = false, hasOff = false, offType = null;
    var hasBuffer = false, hasShort = false;
    entry.segments.forEach(function (s) {
      if (s.endMin <= startMin || s.startMin >= endMin) return;
      if (s.type === 'busy') hasBusy = true;
      else if (s.type === 'leave') hasLeave = true;
      else if (s.type === 'outside_hours' || s.type === 'not_working') { hasOff = true; offType = offType || s.type; }
      else if (s.type === 'buffer') hasBuffer = true;
      else if (s.type === 'short_gap') hasShort = true;
    });
    if (hasBusy) return { state: 'conflict', label: 'Busy' };
    if (hasLeave) return { state: 'conflict', label: 'On leave' };
    if (hasOff) {
      return { state: 'outside', label: offType === 'not_working' ? 'Not working' : 'Outside working hours' };
    }
    if (hasBuffer) return { state: 'conflict', label: 'Buffer time' };
    if (hasShort) return { state: 'conflict', label: 'Not enough free time' };
    return { state: 'available', label: 'Available' };
  }

  // Client-side mirror of the engine's intersection, used only for the
  // common-free header highlight; the server calculation stays canonical.
  function commonFreeWindows(entries, minDurationMin) {
    var lists = (entries || []).map(function (e) {
      return ((e && e.segments) || []).filter(function (s) { return s.type === 'available'; })
        .map(function (s) { return { startMin: s.startMin, endMin: s.endMin }; });
    });
    if (!lists.length) return [];
    var acc = lists[0];
    for (var i = 1; i < lists.length && acc.length; i++) {
      var next = [];
      /* eslint-disable no-loop-func */
      acc.forEach(function (a) {
        lists[i].forEach(function (b) {
          var s2 = Math.max(a.startMin, b.startMin), e2 = Math.min(a.endMin, b.endMin);
          if (e2 - s2 > 0) next.push({ startMin: s2, endMin: e2 });
        });
      });
      acc = next;
    }
    return acc.filter(function (w) { return w.endMin - w.startMin >= (minDurationMin || 0); })
      .sort(function (a, b) { return a.startMin - b.startMin; });
  }

  function searchTherapists(list, q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return list;
    return (list || []).filter(function (t) {
      return String(t.displayName || '').toLowerCase().indexOf(s) !== -1 ||
             String(t.roleTitle || '').toLowerCase().indexOf(s) !== -1;
    });
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
    matrixWindow: matrixWindow, trackPaint: trackPaint, slotVerdict: slotVerdict,
    commonFreeWindows: commonFreeWindows, searchTherapists: searchTherapists,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test environment stops here

  // ═══════════════════════════════════════════════════════════════════════
  //  Browser wiring — Scheduling-Assistant free/busy matrix
  //  Therapists down the left, time across the top. One primary surface;
  //  map / therapist details / recommendations live in a single contextual
  //  inspector. All intelligence comes from the same aggregated endpoints
  //  as before — this layer is presentation only.
  // ═══════════════════════════════════════════════════════════════════════

  var PPM = 2;                 // horizontal pixels per minute
  var RAIL_W = 216;            // fixed therapist rail width
  var ROW_H = 46;              // compact row height (44 content + separation)

  var SCHED = {
    date: null,               // 'YYYY-MM-DD' (Perth)
    therapists: [],           // [{id, displayName, initials, colour, roleTitle}]
    events: [],
    rangeKey: null,
    loading: false,
    gen: 0,                   // request generation — bumped on every date change
    nowTimer: null,
    // one canonical proposed slot drives band, statuses, candidates, prefill
    proposed: null,           // { startMin, durationMin } | null
    duration: 60,
    targetId: null,           // therapist picked from the matrix (schedule target)
    client: { suburb: '', telehealth: false },
    filters: { discipline: '', search: '', checked: null }, // checked: Set|null = all
    sort: 'practice',         // 'practice' | 'available' | 'name'
    zoom: 'work',             // 'work' | 'full'
    // one contextual inspector; never several panels at once
    inspector: null,          // null | 'therapist' | 'map' | 'recs'
    inspectorId: null,        // therapist id when inspector === 'therapist'
    avail: { key: null, byId: {}, meta: null, loading: false },
    common: { minDur: 30, key: null, slots: null, loading: false, gen: 0, timer: null },
    recs: { key: null, result: null, loading: false, error: false, gen: 0, timer: null },
    map: {
      footprints: (function () { try { return localStorage.getItem('sch_footprints') !== '0'; } catch (e) { return true; } })(),
      sdk: 'none', gmap: null, el: null,
      markers: [], polys: [], info: null,
      points: null, pointsKey: null, loading: false, error: false,
      meta: { telehealth: 0, unmappable: 0 },
      userMoved: false, boundsKey: null,
    },
    drag: null,               // transient pointer-drag state for the band
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function root() { return document.getElementById('scheduler-root'); }

  function fmtDur(min) {
    if (min % 60 === 0) return (min / 60) + 'h';
    if (min < 60) return min + 'm';
    return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
  }

  function minToHHMM(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
  function hhmmToMin(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m) return null;
    var out = (+m[1]) * 60 + (+m[2]);
    return out >= 0 && out < 1440 ? out : null;
  }

  // ── Derived views of state ────────────────────────────────────────────────

  function displayWindow() {
    var meta = SCHED.avail.meta;
    return matrixWindow(SCHED.zoom, meta && meta.workingHours);
  }

  function visibleTherapists() {
    var base = filterTherapists(SCHED.therapists, null, null, SCHED.filters.discipline || null);
    return searchTherapists(base, SCHED.filters.search);
  }

  function isChecked(tid) {
    return !SCHED.filters.checked || SCHED.filters.checked.has(tid);
  }

  function checkedVisible() {
    return visibleTherapists().filter(function (t) { return isChecked(t.id); });
  }

  function availEntry(tid) {
    return SCHED.avail.key === SCHED.date ? SCHED.avail.byId[tid] : null;
  }

  // Travel/fit intelligence for a therapist from the last candidates result,
  // keyed to the current proposed slot + client suburb (Level 3+ context).
  function recsStatusFor(tid) {
    var r = SCHED.recs.result;
    if (!r || SCHED.recs.key !== recsKey()) return null;
    var i;
    for (i = 0; i < (r.candidates || []).length; i++) {
      if (r.candidates[i].therapistProfileId === tid) return { kind: 'candidate', c: r.candidates[i] };
    }
    for (i = 0; i < (r.notPractical || []).length; i++) {
      if (r.notPractical[i].therapistProfileId === tid) return { kind: 'notPractical', c: r.notPractical[i] };
    }
    return null;
  }

  function rowStatus(t) {
    if (!SCHED.proposed) return null;
    var verdict = slotVerdict(availEntry(t.id), SCHED.proposed.startMin, SCHED.proposed.durationMin);
    var rs = recsStatusFor(t.id);
    if (rs && verdict.state === 'available') {
      if (rs.kind === 'notPractical') return { state: 'conflict', label: 'Not practical for this location' };
      var tr = rs.c.travel || {};
      if (tr.status === 'travel_feasible') return { state: 'available', label: 'Travel feasible' };
      if (tr.status === 'tight_fit') return { state: 'tight', label: 'Tight travel' };
      if (tr.status === 'travel_unknown') return { state: 'available', label: 'Available · travel unknown' };
    }
    return verdict;
  }

  function sortedRows(list) {
    if (SCHED.sort === 'name') {
      return list.slice().sort(function (a, b) { return String(a.displayName).localeCompare(String(b.displayName)); });
    }
    if (SCHED.sort === 'available' && SCHED.proposed) {
      var rank = { available: 0, tight: 1, outside: 2, conflict: 3, unknown: 4 };
      return list.slice().sort(function (a, b) {
        var ra = rowStatus(a), rb = rowStatus(b);
        var d = (rank[ra ? ra.state : 'unknown'] || 0) - (rank[rb ? rb.state : 'unknown'] || 0);
        return d || String(a.displayName).localeCompare(String(b.displayName));
      });
    }
    return list; // practice order — never reorder while the admin scans
  }

  // ── Data layer ────────────────────────────────────────────────────────────

  function load(force) {
    var start = SCHED.date, end = addDaysYmd(SCHED.date, 1);
    var key = start + '..' + end;
    var gen = SCHED.gen;
    if (!force && SCHED.rangeKey === key && SCHED.events.length) { render(); loadAvailability(force); return; }
    SCHED.loading = true;
    render();
    fetch('/api/calendar/master?startDate=' + start + '&endDate=' + end, { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('master ' + r.status); return r.json(); })
      .then(function (data) {
        if (gen !== SCHED.gen) return; // stale response — a newer date won
        SCHED.therapists = data.therapists || [];
        SCHED.events = data.events || [];
        SCHED.rangeKey = key;
        SCHED.loading = false;
        render();
      })
      .catch(function () {
        if (gen !== SCHED.gen) return;
        SCHED.loading = false;
        render();
      });
    loadAvailability(force);
    if (SCHED.inspector === 'map') mapFetchPoints(force);
  }

  // The availability engine paints the matrix itself — always loaded.
  function loadAvailability(force) {
    var key = SCHED.date;
    var gen = SCHED.gen;
    if (!force && SCHED.avail.key === key) { return; }
    SCHED.avail.loading = true;
    fetch('/api/scheduler/availability?date=' + key, { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('availability ' + r.status); return r.json(); })
      .then(function (j) {
        if (gen !== SCHED.gen || SCHED.date !== key) return;
        var byId = {};
        (j.therapists || []).forEach(function (t) { byId[t.therapistProfileId] = t; });
        SCHED.avail = { key: key, byId: byId, meta: j, loading: false };
        scheduleCommonFetch();
        render();
      })
      .catch(function () {
        if (gen !== SCHED.gen) return;
        SCHED.avail.loading = false;
        render();
      });
  }

  // Server-verified common availability for the checked set (the header
  // highlight uses the client-side mirror immediately; this confirms it).
  function scheduleCommonFetch() {
    var c = SCHED.common;
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(fetchCommon, 300);
  }

  function fetchCommon() {
    var c = SCHED.common;
    var ids = checkedVisible().map(function (t) { return t.id; });
    if (ids.length < 2) { c.slots = null; c.key = null; renderSummaryOnly(); return; }
    c.minDur = SCHED.proposed ? SCHED.proposed.durationMin : SCHED.duration;
    var key = SCHED.date + '|' + ids.join(',') + '|' + c.minDur;
    if (c.key === key && c.slots) { renderSummaryOnly(); return; }
    var gen = ++c.gen;
    c.loading = true;
    fetch('/api/scheduler/common-availability', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: SCHED.date, therapistIds: ids, minDurationMin: SCHED.common.minDur }),
    })
      .then(function (r) { if (!r.ok) throw new Error('common ' + r.status); return r.json(); })
      .then(function (j) {
        var f = c;
        if (gen !== f.gen) return;
        c.loading = false;
        c.key = key;
        c.slots = j.slots || [];
        render();
      })
      .catch(function () { if (gen === c.gen) { c.loading = false; } });
  }

  function recsKey() {
    var p = SCHED.proposed;
    if (!p) return null;
    return [SCHED.date, p.startMin, p.durationMin, SCHED.client.suburb.trim().toLowerCase(),
      SCHED.client.telehealth ? 't' : 'f', SCHED.filters.discipline || ''].join('|');
  }

  function scheduleRecsFetch() {
    var f = SCHED.recs;
    if (f.timer) clearTimeout(f.timer);
    f.timer = setTimeout(fetchRecs, 350);
  }

  // Candidate scoring + travel feasibility (Levels 3–4). Only meaningful with
  // a proposed slot; geography engages once a client suburb (or telehealth)
  // context exists.
  function fetchRecs() {
    var f = SCHED.recs;
    var p = SCHED.proposed;
    var suburb = SCHED.client.suburb.trim();
    if (!p || (!SCHED.client.telehealth && suburb.length < 3)) {
      f.result = null; f.key = null; render();
      return;
    }
    var key = recsKey();
    if (f.key === key && f.result) { render(); return; }
    var gen = ++f.gen;
    f.loading = true; f.error = false;
    renderSummaryOnly();
    var body = {
      date: SCHED.date, startMin: p.startMin, durationMin: p.durationMin,
      isTelehealth: SCHED.client.telehealth,
      discipline: SCHED.filters.discipline || undefined,
      therapistIds: [],
    };
    if (!SCHED.client.telehealth) body.location = { suburb: suburb };
    fetch('/api/scheduler/candidates', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { if (!r.ok) throw new Error('candidates ' + r.status); return r.json(); })
      .then(function (j) {
        if (gen !== f.gen) return;
        f.loading = false; f.result = j; f.key = key;
        if (SCHED.inspector === 'map' && j.clientPoint) mapShowClientPoint(j.clientPoint);
        render();
      })
      .catch(function () {
        if (gen !== f.gen) return;
        f.loading = false; f.error = true;
        render();
      });
  }

  // Week capacity summary for the therapist inspector (Mon–Fri of the
  // selected week; cached per therapist+date, cleared on refresh).
  var WEEK_CAP = {};
  function loadWeekCapacity(tid) {
    var monday = mondayOfYmd(SCHED.date);
    var days = [0, 1, 2, 3, 4].map(function (i) { return addDaysYmd(monday, i); });
    var pending = days.filter(function (d) { return WEEK_CAP[tid + '|' + d] === undefined; });
    if (!pending.length) { renderWeekStripInto(tid, days); return; }
    pending.forEach(function (d) {
      WEEK_CAP[tid + '|' + d] = null; // in flight
      fetch('/api/scheduler/availability?date=' + d + '&therapistIds=' + encodeURIComponent(tid), { credentials: 'include' })
        .then(function (r) { if (!r.ok) throw new Error('cap ' + r.status); return r.json(); })
        .then(function (j) {
          var t = j.therapists && j.therapists[0];
          WEEK_CAP[tid + '|' + d] = t ? (t.working ? (t.capacity && t.capacity.availableMin) || 0 : 'x') : 'x';
          renderWeekStripInto(tid, days);
        })
        .catch(function () { WEEK_CAP[tid + '|' + d] = undefined; });
    });
    renderWeekStripInto(tid, days);
  }

  // ── State transitions (deterministic reset rules) ─────────────────────────

  function setDate(ymd) {
    if (ymd === SCHED.date) return;
    SCHED.date = ymd;
    SCHED.gen++;                                  // invalidate every in-flight response
    SCHED.rangeKey = null;
    SCHED.avail = { key: null, byId: {}, meta: null, loading: false };
    SCHED.common.slots = null; SCHED.common.key = null;
    SCHED.recs.result = null; SCHED.recs.key = null;
    SCHED.targetId = null;
    SCHED.map.pointsKey = null;
    // proposed slot (time-of-day) stays — same time on the new date
    load();
    if (SCHED.proposed) scheduleRecsFetch();
  }

  function setProposed(startMin, durationMin) {
    var win = displayWindow();
    var dur = Math.max(15, Math.min(480, durationMin || SCHED.duration));
    var s = Math.max(0, Math.min(1440 - dur, startMin));
    SCHED.proposed = { startMin: s, durationMin: dur };
    SCHED.duration = dur;
    if (s < win.startMin || s + dur > win.endMin) SCHED.zoom = 'full';
    scheduleRecsFetch();
    scheduleCommonFetch();
    render();
  }

  function clearProposed() {
    SCHED.proposed = null;
    SCHED.targetId = null;
    SCHED.recs.result = null; SCHED.recs.key = null;
    if (SCHED.inspector === 'recs') SCHED.inspector = null;
    render();
  }

  function setClient(suburb, telehealth) {
    SCHED.client.suburb = suburb != null ? suburb : SCHED.client.suburb;
    if (telehealth != null) SCHED.client.telehealth = telehealth;
    SCHED.recs.result = null; SCHED.recs.key = null;   // geography context changed
    scheduleRecsFetch();
  }

  function openInspector(kind, tid) {
    SCHED.inspector = kind;
    SCHED.inspectorId = kind === 'therapist' ? tid : null;
    if (kind === 'map') { mapFetchPoints(); }
    render();
    if (kind === 'map') mapEnsure();
    if (kind === 'therapist' && tid) loadWeekCapacity(tid);
  }

  function closeInspector() {
    SCHED.inspector = null;
    SCHED.inspectorId = null;
    render();
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────

  function renderToolbar(frag) {
    var bar = document.createElement('div');
    bar.className = 'sch-toolbar sm-toolbar';
    var p = SCHED.proposed;
    bar.innerHTML =
      '<span class="sch-title">Master Scheduler</span>' +
      '<span class="sch-nav">' +
        '<button type="button" class="sch-nav-btn" data-act="prev" title="Previous day">&lsaquo;</button>' +
        '<button type="button" class="sch-nav-btn" data-act="next" title="Next day">&rsaquo;</button>' +
      '</span>' +
      '<span class="sch-date-label">' + esc(fmtDayLabel(SCHED.date)) + '</span>' +
      '<button type="button" class="sch-today-btn" data-act="today">Today</button>' +
      '<input type="date" class="sch-date-input" data-act="date" value="' + esc(SCHED.date) + '" aria-label="Scheduler date" />' +
      '<span class="sm-ctl"><label>Start</label>' +
        '<input type="time" step="900" class="sch-date-input sm-time" data-act="start" value="' + (p ? minToHHMM(p.startMin) : '') + '" aria-label="Proposed start time" /></span>' +
      '<span class="sm-ctl"><label>Duration</label>' +
        '<select class="sch-select sm-dur" data-act="duration" aria-label="Proposed duration">' +
          [15, 30, 45, 60, 90, 120].map(function (d) {
            return '<option value="' + d + '"' + (SCHED.duration === d ? ' selected' : '') + '>' + fmtDur(d) + '</option>';
          }).join('') +
        '</select></span>' +
      '<span class="sm-ctl"><label>Discipline</label>' +
        '<select class="sch-select" data-act="discipline" aria-label="Discipline filter">' +
          '<option value="">All</option>' +
          disciplinesOf(SCHED.therapists).map(function (d) {
            return '<option value="' + esc(d) + '"' + (SCHED.filters.discipline === d ? ' selected' : '') + '>' + esc(d) + '</option>';
          }).join('') +
        '</select></span>' +
      '<span class="sm-ctl"><label>Client suburb</label>' +
        '<input type="text" class="sch-date-input sm-suburb" data-act="suburb" placeholder="Optional" value="' + esc(SCHED.client.suburb) + '" aria-label="Client suburb for travel checks" /></span>' +
      '<span class="sch-spacer"></span>' +
      '<span class="sm-ctl"><label>Sort</label>' +
        '<select class="sch-select" data-act="sort" aria-label="Row order">' +
          '<option value="practice"' + (SCHED.sort === 'practice' ? ' selected' : '') + '>Practice order</option>' +
          '<option value="available"' + (SCHED.sort === 'available' ? ' selected' : '') + '>Available first</option>' +
          '<option value="name"' + (SCHED.sort === 'name' ? ' selected' : '') + '>Name</option>' +
        '</select></span>' +
      '<select class="sch-select" data-act="zoom" aria-label="Time window">' +
        '<option value="work"' + (SCHED.zoom === 'work' ? ' selected' : '') + '>Working day</option>' +
        '<option value="full"' + (SCHED.zoom === 'full' ? ' selected' : '') + '>Full day</option>' +
      '</select>' +
      '<button type="button" class="sch-toggle' + (SCHED.inspector === 'map' ? ' on' : '') + '" data-act="map">Map</button>' +
      '<button type="button" class="sch-toggle' + (SCHED.inspector === 'recs' ? ' on' : '') + '" data-act="recs"' + (p ? '' : ' disabled title="Pick a time first"') + '>Recommend</button>' +
      '<button type="button" class="sch-add-btn" data-act="add">+ Appointment</button>';

    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'prev') nav(-1);
      else if (act === 'next') nav(1);
      else if (act === 'today') nav('today');
      else if (act === 'map') { SCHED.inspector === 'map' ? closeInspector() : openInspector('map'); }
      else if (act === 'recs') { SCHED.inspector === 'recs' ? closeInspector() : openInspector('recs'); }
      else if (act === 'add') { openBooking(SCHED.targetId); }
    });
    bar.addEventListener('change', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.dataset.act;
      if (act === 'date' && el.value) setDate(el.value);
      else if (act === 'duration') {
        var d = parseInt(el.value, 10) || 60;
        if (SCHED.proposed) setProposed(SCHED.proposed.startMin, d);
        else { SCHED.duration = d; scheduleCommonFetch(); render(); }
      }
      else if (act === 'start') {
        var m = hhmmToMin(el.value);
        if (m != null) setProposed(snap15(m), SCHED.duration);
      }
      else if (act === 'discipline') {
        SCHED.filters.discipline = el.value || '';
        SCHED.recs.result = null; SCHED.recs.key = null;
        scheduleCommonFetch(); scheduleRecsFetch(); render();
      }
      else if (act === 'sort') { SCHED.sort = el.value; render(); }
      else if (act === 'zoom') { SCHED.zoom = el.value; render(); }
    });
    bar.addEventListener('input', function (e) {
      var el = e.target.closest('[data-act="suburb"]');
      if (el) setClient(el.value, null);
    });
    frag.appendChild(bar);
  }

  // ── Summary bar: proposed slot + who fits + common free ───────────────────

  function summaryText() {
    var p = SCHED.proposed;
    var checked = checkedVisible();
    var parts = [];
    if (p) {
      var free = checked.filter(function (t) {
        var st = rowStatus(t);
        return st && (st.state === 'available' || st.state === 'tight');
      }).length;
      parts.push('<strong>' + fmtTime12(p.startMin) + '&ndash;' + fmtTime12(p.startMin + p.durationMin) + '</strong>' +
        ' &middot; ' + free + ' of ' + checked.length + ' selected therapist' + (checked.length === 1 ? '' : 's') + ' available' +
        (SCHED.recs.loading ? ' &middot; checking travel&hellip;' : ''));
      if (SCHED.targetId) {
        var t = SCHED.therapists.find(function (x) { return x.id === SCHED.targetId; });
        if (t) parts.push('<span class="sm-target">' + esc(t.displayName) + '</span>' +
          '<button type="button" class="sch-add-btn sm-sched-btn" data-act="schedule">Schedule</button>');
      }
      parts.push('<button type="button" class="sm-clear" data-act="clear">Clear slot</button>');
    } else {
      parts.push('Click a clear moment in any row to propose a time &mdash; or set Start above.');
    }
    var slots = SCHED.common.slots;
    if (slots && checked.length >= 2) {
      if (slots.length) {
        parts.push('<span class="sm-cf-note">Common free: ' + slots.slice(0, 3).map(function (s) {
          return fmtTime12(s.startMin) + '&ndash;' + fmtTime12(s.endMin);
        }).join(', ') + (slots.length > 3 ? ' &hellip;' : '') + '</span>');
      } else {
        parts.push('<span class="sm-cf-note">No common free window for everyone selected.</span>');
      }
    }
    return parts.join(' ');
  }

  function renderSummary(frag) {
    var el = document.createElement('div');
    el.className = 'sm-summary';
    el.id = 'sm-summary';
    el.innerHTML = summaryText();
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'clear') clearProposed();
      if (b.dataset.act === 'schedule') openBooking(SCHED.targetId);
    });
    frag.appendChild(el);
  }

  function renderSummaryOnly() {
    var el = document.getElementById('sm-summary');
    if (el) el.innerHTML = summaryText();
  }

  function openBooking(tid) {
    if (tid && typeof global.selectBspTherapist === 'function') {
      try { global.selectBspTherapist(tid); } catch (e) { /* booking panel optional */ }
    }
    if (typeof global.openBookingPanel === 'function') global.openBookingPanel();
  }

  // ── The matrix ────────────────────────────────────────────────────────────

  function renderMatrix(frag, visible) {
    var win = displayWindow();
    var span = win.endMin - win.startMin;
    var width = span * PPM;
    var mode = 'cross'; // matrix is always a cross-therapist comparison surface

    var scroll = document.createElement('div');
    scroll.className = 'sm-scroll';
    scroll.id = 'sm-scroll';

    var grid = document.createElement('div');
    grid.className = 'sm-grid';
    grid.style.width = (RAIL_W + width) + 'px';

    // ── header: corner + time scale ──
    var head = document.createElement('div');
    head.className = 'sm-headrow';
    var corner = document.createElement('div');
    corner.className = 'sm-corner';
    var checkedAll = !SCHED.filters.checked;
    corner.innerHTML =
      '<input type="text" class="sm-search" placeholder="Search therapist" value="' + esc(SCHED.filters.search) + '" aria-label="Search therapist" />' +
      '<span class="sm-selacts"><button type="button" data-act="all"' + (checkedAll ? ' disabled' : '') + '>Select all</button>' +
      '<button type="button" data-act="none">Clear</button></span>';
    corner.querySelector('.sm-search').addEventListener('input', function (e) {
      SCHED.filters.search = e.target.value;
      renderRowsOnly();
    });
    corner.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'all') SCHED.filters.checked = null;
      else SCHED.filters.checked = new Set();
      scheduleCommonFetch();
      render();
    });
    head.appendChild(corner);

    var timehead = document.createElement('div');
    timehead.className = 'sm-timehead';
    timehead.style.width = width + 'px';
    var html = '';
    for (var m = Math.ceil(win.startMin / 60) * 60; m < win.endMin; m += 60) {
      html += '<span class="sm-tick" style="left:' + ((m - win.startMin) * PPM) + 'px">' + fmtTime12(m) + '</span>';
    }
    // common-free windows as a subtle top highlight
    (SCHED.common.slots || []).forEach(function (s) {
      var a = Math.max(s.startMin, win.startMin), b = Math.min(s.endMin, win.endMin);
      if (b <= a) return;
      html += '<span class="sm-cf" title="All selected therapists available ' + fmtTime12(s.startMin) + '&ndash;' + fmtTime12(s.endMin) + '" style="left:' + ((a - win.startMin) * PPM) + 'px;width:' + ((b - a) * PPM) + 'px"></span>';
    });
    if (SCHED.proposed) {
      var p = SCHED.proposed;
      var a2 = Math.max(p.startMin, win.startMin), b2 = Math.min(p.startMin + p.durationMin, win.endMin);
      if (b2 > a2) {
        html += '<span class="sm-headband sch-req-slot" style="left:' + ((a2 - win.startMin) * PPM) + 'px;width:' + ((b2 - a2) * PPM) + 'px">' +
          fmtTime12(p.startMin) + '&ndash;' + fmtTime12(p.startMin + p.durationMin) + '</span>';
      }
    }
    timehead.innerHTML = html;
    head.appendChild(timehead);
    grid.appendChild(head);

    // ── rows ──
    var rows = document.createElement('div');
    rows.className = 'sm-rows';
    rows.id = 'sm-rows';
    sortedRows(visible).forEach(function (t) {
      rows.appendChild(buildRow(t, win, width, mode));
    });
    grid.appendChild(rows);

    scroll.appendChild(grid);
    frag.appendChild(scroll);

    // initial horizontal position: proposed slot or morning
    requestAnimationFrame(function () {
      var el = document.getElementById('sm-scroll');
      if (!el || el.dataset.positioned) return;
      el.dataset.positioned = '1';
      var target = SCHED.proposed ? SCHED.proposed.startMin - 60 : (8 * 60 - 30);
      el.scrollLeft = Math.max(0, (target - win.startMin) * PPM);
    });
  }

  function renderRowsOnly() {
    var rows = document.getElementById('sm-rows');
    if (!rows) { render(); return; }
    var win = displayWindow();
    var width = (win.endMin - win.startMin) * PPM;
    rows.innerHTML = '';
    sortedRows(visibleTherapists()).forEach(function (t) {
      rows.appendChild(buildRow(t, win, width, 'cross'));
    });
  }

  function buildRow(t, win, width, mode) {
    var checked = isChecked(t.id);
    var entry = availEntry(t.id);
    var row = document.createElement('div');
    row.className = 'sm-row' + (checked ? '' : ' sm-unchecked') +
      (entry && entry.working === false ? ' sch-notworking' : '') +
      (SCHED.targetId === t.id ? ' sm-target-row' : '') +
      (SCHED.inspectorId === t.id ? ' sm-inspected' : '');
    row.dataset.tid = t.id;

    // ── rail cell ──
    var rail = document.createElement('div');
    rail.className = 'sm-rail';
    var st = checked ? rowStatus(t) : null;
    var conf = entry && entry.availabilityConfidence === 'default';
    rail.innerHTML =
      '<input type="checkbox" class="sm-check" aria-label="Compare ' + esc(t.displayName) + '"' + (checked ? ' checked' : '') + ' />' +
      '<span class="sm-ava" style="background:' + esc(t.colour || '#0f7c6c') + '">' + esc(t.initials || (t.displayName || '?').slice(0, 2).toUpperCase()) + '</span>' +
      '<span class="sm-id"><button type="button" class="sm-name" title="Therapist details">' + esc(t.displayName) + '</button>' +
      '<span class="sm-role">' + esc(t.roleTitle || 'Therapist') + (conf ? ' <span class="sch-defbadge" title="No configured schedule this week - showing default hours">default hours</span>' : '') + '</span></span>' +
      (st ? '<span class="sm-chip sm-chip-' + st.state + '">' + esc(st.label) + '</span>' : '');
    var slotDesc = SCHED.proposed && st
      ? (t.displayName + ', ' + fmtTime12(SCHED.proposed.startMin) + ' to ' + fmtTime12(SCHED.proposed.startMin + SCHED.proposed.durationMin) + ' ' + (st.state === 'available' ? 'available' : 'unavailable') + '.')
      : t.displayName + '.';
    rail.setAttribute('aria-label', slotDesc);
    rail.querySelector('.sm-check').addEventListener('change', function (e) {
      var set = SCHED.filters.checked;
      if (!set) { // everyone → materialise the full set, then toggle
        set = new Set(visibleTherapists().map(function (x) { return x.id; }));
        SCHED.filters.checked = set;
      }
      if (e.target.checked) set.add(t.id); else set.delete(t.id);
      if (set.size === visibleTherapists().length) SCHED.filters.checked = null;
      if (!e.target.checked && SCHED.targetId === t.id) SCHED.targetId = null;
      scheduleCommonFetch();
      render();
    });
    rail.querySelector('.sm-name').addEventListener('click', function () {
      if (SCHED.inspector === 'therapist' && SCHED.inspectorId === t.id) closeInspector();
      else openInspector('therapist', t.id);
    });
    row.appendChild(rail);

    // ── track ──
    var track = document.createElement('div');
    track.className = 'sm-track';
    track.style.width = width + 'px';
    track.dataset.tid = t.id;

    if (checked) {
      var thtml = '';
      // availability paint (engine-derived); quiet background = available
      trackPaint(entry).forEach(function (r) {
        var a = Math.max(r.startMin, win.startMin), b = Math.min(r.endMin, win.endMin);
        if (b <= a) return;
        thtml += '<span class="sch-avl sm-paint sm-paint-' + r.cls + '" style="left:' + ((a - win.startMin) * PPM) + 'px;width:' + ((b - a) * PPM) + 'px"></span>';
      });

      // events as horizontal blocks — eventsForTherapistDay already returns
      // day-clamped { ev, startMin, endMin } wrappers
      var items = eventsForTherapistDay(SCHED.events, t.id, SCHED.date);
      assignLanes(items);
      items.forEach(function (it) {
        var a = Math.max(it.startMin, win.startMin), b = Math.min(it.endMin, win.endMin);
        if (b <= a) return;
        var laneCount = it.laneCount || 1;
        var h = laneCount > 1 ? Math.floor(36 / laneCount) : 36;
        var top = 4 + (it.lane || 0) * (h + 1);
        var label = safeLabel(it.ev, mode);
        var suburb = extractSuburb(it.ev.manualLocation || it.ev.location);
        var w = Math.max(8, (b - a) * PPM - 4); // 4px separation between blocks
        thtml += '<button type="button" class="sm-ev sm-ev-' + esc(it.ev.eventType || 'outlook') + '" data-eid="' + esc(it.ev.id) + '"' +
          ' style="left:' + ((a - win.startMin) * PPM) + 'px;width:' + w + 'px;top:' + top + 'px;height:' + h + 'px"' +
          ' title="' + esc(fmtTime12(it.startMin) + '–' + fmtTime12(it.endMin) + '  ' + label + (suburb ? '  · ' + suburb : '')) + '">' +
          '<span>' + esc(label) + '</span>' +
        '</button>';
      });

      // current time (vertical line, today only)
      if (SCHED.date === todayPerthYmd()) {
        var nowMin = perthParts(new Date().toISOString()).minutes;
        if (nowMin >= win.startMin && nowMin <= win.endMin) {
          thtml += '<span class="sm-now" style="left:' + ((nowMin - win.startMin) * PPM) + 'px"></span>';
        }
      }

      // proposed band segment
      if (SCHED.proposed) {
        var p = SCHED.proposed;
        var a3 = Math.max(p.startMin, win.startMin), b3 = Math.min(p.startMin + p.durationMin, win.endMin);
        if (b3 > a3) {
          thtml += '<span class="sm-bandseg" tabindex="0" role="slider" aria-label="Proposed slot for ' + esc(t.displayName) + '" aria-valuetext="' + fmtTime12(p.startMin) + ' to ' + fmtTime12(p.startMin + p.durationMin) + '"' +
            ' style="left:' + ((a3 - win.startMin) * PPM) + 'px;width:' + ((b3 - a3) * PPM) + 'px">' +
            '<span class="sm-band-grip" aria-hidden="true"></span></span>';
        }
      }
      track.innerHTML = thtml;

      track.addEventListener('click', function (e) {
        if (SCHED.drag && SCHED.drag.moved) return; // drag, not click
        var evBtn = e.target.closest('.sm-ev');
        if (evBtn) {
          var id = evBtn.dataset.eid;
          mapEmphasiseEvent(id);
          if (typeof global.openBlockDetail === 'function') { try { global.openBlockDetail(id); } catch (err) { /* detail optional */ } }
          return;
        }
        if (e.target.closest('.sm-bandseg')) return;
        var rect = track.getBoundingClientRect();
        var clicked = win.startMin + (e.clientX - rect.left) / PPM;
        SCHED.targetId = t.id;
        setProposed(snap15(clicked), SCHED.duration);
      });

      attachTrackDrag(track, win);
    } else {
      track.className += ' sm-track-off';
    }

    row.appendChild(track);
    return row;
  }

  // ── Band interactions: drag to move, grip to resize, drag-create ─────────

  function attachTrackDrag(track, win) {
    track.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var band = e.target.closest('.sm-bandseg');
      var grip = e.target.closest('.sm-band-grip');
      var onEmpty = !band && !e.target.closest('.sm-ev');
      var rect = track.getBoundingClientRect();
      var atMin = win.startMin + (e.clientX - rect.left) / PPM;
      if (grip && SCHED.proposed) {
        SCHED.drag = { kind: 'resize', startX: e.clientX, origin: SCHED.proposed.startMin, dur: SCHED.proposed.durationMin, moved: false, win: win };
      } else if (band && SCHED.proposed) {
        SCHED.drag = { kind: 'move', startX: e.clientX, origin: SCHED.proposed.startMin, dur: SCHED.proposed.durationMin, moved: false, win: win };
      } else if (onEmpty) {
        SCHED.drag = { kind: 'create', startX: e.clientX, anchorMin: snap15(atMin), tid: track.dataset.tid, moved: false, win: win };
      } else { return; }
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    });
    track.addEventListener('pointermove', function (e) {
      var d = SCHED.drag;
      if (!d) return;
      var dx = e.clientX - d.startX;
      if (Math.abs(dx) > 6) d.moved = true;
      if (!d.moved) return;
      if (d.kind === 'move') {
        var next = snap15(d.origin + dx / PPM);
        next = Math.max(0, Math.min(1440 - d.dur, next));
        if (!SCHED.proposed || SCHED.proposed.startMin !== next) {
          SCHED.proposed = { startMin: next, durationMin: d.dur };
          updateBandLight();
        }
      } else if (d.kind === 'resize') {
        var dur = snap15(d.dur + dx / PPM);
        dur = Math.max(15, Math.min(480, Math.min(dur, 1440 - d.origin)));
        if (SCHED.proposed && SCHED.proposed.durationMin !== dur) {
          SCHED.proposed = { startMin: d.origin, durationMin: dur };
          SCHED.duration = dur;
          updateBandLight();
        }
      } else if (d.kind === 'create') {
        var rect = track.getBoundingClientRect();
        var cur = snap15(d.win.startMin + (e.clientX - rect.left) / PPM);
        var s = Math.min(d.anchorMin, cur), en = Math.max(d.anchorMin, cur);
        if (en - s >= 15) {
          SCHED.proposed = { startMin: Math.max(0, s), durationMin: Math.min(480, en - s) };
          SCHED.duration = SCHED.proposed.durationMin;
          SCHED.targetId = d.tid;
          updateBandLight();
        }
      }
    });
    var finish = function () {
      var d = SCHED.drag;
      if (!d) return;
      SCHED.drag = null;
      if (d.moved) {
        scheduleRecsFetch();
        scheduleCommonFetch();
        render();
        // keep drag-vs-click disambiguation for the click handler
        SCHED.drag = { moved: true };
        setTimeout(function () { if (SCHED.drag && !SCHED.drag.kind) SCHED.drag = null; }, 0);
      }
    };
    track.addEventListener('pointerup', finish);
    track.addEventListener('pointercancel', function () { SCHED.drag = null; });

    // keyboard: arrows move the proposed slot in 15-minute steps
    track.addEventListener('keydown', function (e) {
      if (!e.target.closest('.sm-bandseg') || !SCHED.proposed) return;
      var p = SCHED.proposed;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setProposed(Math.max(0, p.startMin - 15), p.durationMin); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setProposed(Math.min(1440 - p.durationMin, p.startMin + 15), p.durationMin); }
      else if (e.key === 'Escape') { clearProposed(); }
    });
  }

  // Light mid-drag update: move every band segment + header chip + statuses
  // without rebuilding the DOM (full render happens on release).
  function updateBandLight() {
    var win = displayWindow();
    var p = SCHED.proposed;
    if (!p) return;
    var left = (Math.max(p.startMin, win.startMin) - win.startMin) * PPM;
    var w = (Math.min(p.startMin + p.durationMin, win.endMin) - Math.max(p.startMin, win.startMin)) * PPM;
    document.querySelectorAll('.sm-bandseg').forEach(function (el) {
      el.style.left = left + 'px';
      el.style.width = Math.max(0, w) + 'px';
      el.setAttribute('aria-valuetext', fmtTime12(p.startMin) + ' to ' + fmtTime12(p.startMin + p.durationMin));
    });
    var hb = document.querySelector('.sm-headband');
    if (hb) {
      hb.style.left = left + 'px';
      hb.style.width = Math.max(0, w) + 'px';
      hb.textContent = fmtTime12(p.startMin) + '–' + fmtTime12(p.startMin + p.durationMin);
    }
    var timeInput = document.querySelector('.sm-time');
    if (timeInput) timeInput.value = minToHHMM(p.startMin);
    // status chips
    document.querySelectorAll('.sm-row').forEach(function (rowEl) {
      var tid = rowEl.dataset.tid;
      var t = SCHED.therapists.find(function (x) { return x.id === tid; });
      if (!t || !isChecked(tid)) return;
      var st = rowStatus(t);
      var chip = rowEl.querySelector('.sm-chip');
      if (chip && st) { chip.className = 'sm-chip sm-chip-' + st.state; chip.textContent = st.label; }
    });
    renderSummaryOnly();
  }

  // Horizontal scroll-to-time with a row flash (kept name; the axis changed).
  function jumpToMinute(min, tid) {
    var el = document.getElementById('sm-scroll');
    var win = displayWindow();
    if (el) el.scrollTo({ left: Math.max(0, (min - 45 - win.startMin) * PPM), behavior: 'smooth' });
    if (tid) {
      var row = document.querySelector('.sm-row[data-tid="' + tid + '"]');
      if (row) {
        row.classList.add('sch-flash');
        setTimeout(function () { row.classList.remove('sch-flash'); }, 1200);
      }
    }
  }

  // ── Inspector (one contextual panel: therapist | map | recs) ─────────────

  function renderInspector(host) {
    if (!SCHED.inspector) return;
    var aside = document.createElement('aside');
    aside.className = 'sm-inspector';
    if (SCHED.inspector === 'therapist') buildTherapistInspector(aside);
    else if (SCHED.inspector === 'map') buildMapInspector(aside);
    else if (SCHED.inspector === 'recs') buildRecsInspector(aside);
    host.appendChild(aside);
  }

  function inspectorHead(aside, title) {
    var h = document.createElement('div');
    h.className = 'sm-insp-head';
    h.innerHTML = '<span>' + esc(title) + '</span><button type="button" class="sch-f-close" aria-label="Close panel">&times;</button>';
    h.querySelector('button').addEventListener('click', closeInspector);
    aside.appendChild(h);
    return h;
  }

  // Level 2 — therapist summary without leaving the matrix.
  function buildTherapistInspector(aside) {
    var t = SCHED.therapists.find(function (x) { return x.id === SCHED.inspectorId; });
    if (!t) { closeInspector(); return; }
    inspectorHead(aside, 'Therapist');
    var entry = availEntry(t.id);
    var items = eventsForTherapistDay(SCHED.events, t.id, SCHED.date);
    var body = document.createElement('div');
    body.className = 'sm-insp-body';

    var html = '<div class="sch-fh-id"><span class="sm-ava sm-ava-lg" style="background:' + esc(t.colour || '#0f7c6c') + '">' + esc(t.initials || '') + '</span>' +
      '<div><div class="sch-fh-name">' + esc(t.displayName) + '</div>' +
      '<div class="sch-fh-role">' + esc(t.roleTitle || 'Therapist') +
      (entry && entry.availabilityConfidence === 'default' ? ' <span class="sch-defbadge">default hours</span>' : '') + '</div></div></div>';

    html += '<div class="sm-insp-date">' + esc(fmtDayLabel(SCHED.date)) + '</div>';

    if (entry && entry.working === false) {
      var leaveDay = (entry.segments || []).some(function (s) { return s.type === 'leave'; });
      html += '<div class="sm-insp-note">' + esc(t.displayName) +
        (leaveDay ? ' is on leave this day.' : " isn't scheduled to work this day.") + '</div>';
    } else {
      var clin = clinicalMinutes(items);
      var availMin = entry && entry.capacity ? entry.capacity.availableMin : null;
      html += '<div class="sch-fh-stats">' +
        '<span class="sch-fh-stat"><strong>' + apptCount(items) + '</strong> appointments</span>' +
        '<span class="sch-fh-stat"><strong>' + fmtDur(clin) + '</strong> clinical</span>' +
        (availMin != null ? '<span class="sch-fh-stat"><strong>' + fmtDur(availMin) + '</strong> available</span>' : '') +
        '</div>';
      var nowMin = SCHED.date === todayPerthYmd() ? perthParts(new Date().toISOString()).minutes : 0;
      var seg = entry ? nextAvailableSegment(entry.segments, nowMin) : null;
      html += seg
        ? '<div class="sch-fh-next">Next available ' + fmtTime12(seg.startMin) + '&ndash;' + fmtTime12(seg.endMin) + '</div>'
        : '<div class="sch-fh-next">No further availability today</div>';
    }

    // open gaps as actionable cards
    if (entry && entry.working !== false) {
      var gaps = (entry.segments || []).filter(function (s) { return s.type === 'available'; });
      if (gaps.length) {
        html += '<div class="sm-insp-sub">Open windows</div>';
        gaps.slice(0, 6).forEach(function (g) {
          html += '<div class="sch-avl-card"><span class="sch-avl-times">' + fmtTime12(g.startMin) + '&ndash;' + fmtTime12(g.endMin) +
            ' <span class="sch-avl-tag">' + fmtDur(g.endMin - g.startMin) + '</span></span>' +
            '<button type="button" class="sch-avl-add" data-min="' + g.startMin + '">+ Add appointment</button></div>';
        });
      }
    }

    // day list with focus-grade labels (single-therapist inspection)
    if (items.length) {
      html += '<div class="sm-insp-sub">Day</div>';
      items.forEach(function (it) {
        html += '<div class="sm-insp-ev"><span class="sm-insp-ev-time">' + fmtTime12(it.startMin) + '&ndash;' + fmtTime12(it.endMin) + '</span> ' +
          esc(safeLabel(it.ev, 'focus')) + '</div>';
      });
    }

    html += '<div class="sm-insp-sub">This week</div><div id="sch-weekstrip" class="sch-weekstrip"></div>';
    body.innerHTML = html;
    body.addEventListener('click', function (e) {
      var add = e.target.closest('.sch-avl-add');
      if (add) {
        var clicked = parseInt(add.dataset.min, 10);
        SCHED.targetId = t.id;
        setProposed(snap15(clicked), SCHED.duration);
        jumpToMinute(snap15(clicked), t.id);
      }
    });
    aside.appendChild(body);
  }

  function renderWeekStripInto(tid, days) {
    var host = document.getElementById('sch-weekstrip');
    if (!host || SCHED.inspectorId !== tid) return;
    var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    host.innerHTML = days.map(function (d, i) {
      var v = WEEK_CAP[tid + '|' + d];
      var label = v === null || v === undefined ? '&hellip;' : (v === 'x' ? 'Off' : fmtDur(v));
      return '<button type="button" class="sch-ws-day' + (d === SCHED.date ? ' on' : '') + '" data-d="' + d + '">' +
        '<span class="sch-ws-name">' + names[i] + '</span><span class="sch-ws-cap">' + label + '</span></button>';
    }).join('');
    host.querySelectorAll('[data-d]').forEach(function (b) {
      b.addEventListener('click', function () { setDate(b.dataset.d); });
    });
  }

  // Level 5 — map + service footprints, contextual only.
  function buildMapInspector(aside) {
    inspectorHead(aside, 'Map');
    var body = document.createElement('div');
    body.className = 'sm-insp-body sm-insp-map';
    var m = SCHED.map;

    var controls = document.createElement('div');
    controls.className = 'sch-map-toggle';
    controls.innerHTML =
      '<label><input type="checkbox" data-act="fp"' + (m.footprints ? ' checked' : '') + ' /> Operating areas</label>' +
      '<span class="sch-map-note">' + (m.meta.telehealth ? m.meta.telehealth + ' telehealth' : '') +
      (m.meta.unmappable ? (m.meta.telehealth ? ' &middot; ' : '') + m.meta.unmappable + ' without a mappable location' : '') + '</span>';
    controls.querySelector('[data-act="fp"]').addEventListener('change', function (e) {
      m.footprints = e.target.checked;
      try { localStorage.setItem('sch_footprints', m.footprints ? '1' : '0'); } catch (err) { /* private mode */ }
      mapDraw();
    });
    body.appendChild(controls);

    var canvasHost = document.createElement('div');
    canvasHost.id = 'sch-map-host';
    canvasHost.className = 'sch-map-canvas';
    body.appendChild(canvasHost);

    var status = document.createElement('div');
    status.id = 'sch-map-status';
    body.appendChild(status);

    var legend = document.createElement('div');
    legend.id = 'sch-map-legend';
    body.appendChild(legend);

    aside.appendChild(body);
    renderMapStatus();
    renderMapLegend();
  }

  // Level 4 — explainable recommendations, on request.
  var TIER_LABELS = { best: 'Best fit', good: 'Good fit', possible: 'Possible', poor: 'Not ideal' };

  function buildRecsInspector(aside) {
    inspectorHead(aside, 'Recommendations');
    var body = document.createElement('div');
    body.className = 'sm-insp-body';
    var f = SCHED.recs;
    var p = SCHED.proposed;

    var form = document.createElement('div');
    form.className = 'sm-recs-form';
    form.innerHTML =
      '<label class="sch-f-tele"><input type="checkbox" data-act="tele"' + (SCHED.client.telehealth ? ' checked' : '') + ' /> Telehealth (no travel)</label>' +
      (p ? '<div class="sm-recs-slot">For <strong>' + fmtTime12(p.startMin) + '&ndash;' + fmtTime12(p.startMin + p.durationMin) + '</strong>' +
        (SCHED.client.suburb ? ' near <strong>' + esc(SCHED.client.suburb) + '</strong>' : '') + '</div>'
        : '<div class="sm-recs-slot">Pick a time in the matrix first.</div>') +
      (!SCHED.client.telehealth && SCHED.client.suburb.trim().length < 3
        ? '<div class="sm-insp-note">Add a client suburb in the toolbar for travel-aware ranking; without it, ranking is availability-only.</div>' : '');
    form.querySelector('[data-act="tele"]').addEventListener('change', function (e) {
      setClient(null, e.target.checked);
      render();
    });
    body.appendChild(form);

    var list = document.createElement('div');
    if (f.loading) list.innerHTML = '<div class="sch-status">Checking candidates&hellip;</div>';
    else if (f.error) list.innerHTML = '<div class="sch-status">Could not load recommendations. Scheduling still works from the matrix.</div>';
    else if (!f.result) {
      if (p && (SCHED.client.telehealth || SCHED.client.suburb.trim().length >= 3)) fetchRecs();
      list.innerHTML = '<div class="sch-status">&nbsp;</div>';
    } else {
      var html = '';
      (f.result.candidates || []).forEach(function (c) {
        var tr = c.travel || {};
        html += '<div class="sch-f-card sm-cand" data-tid="' + esc(c.therapistProfileId) + '" data-start="' + (c.suggestedSlot ? c.suggestedSlot.startMin : '') + '">' +
          '<span class="sch-tier ' + esc(c.fitTier) + '">' + esc(TIER_LABELS[c.fitTier] || c.fitTier) + '</span>' +
          '<span class="sch-f-name"><span class="sch-f-dot" style="background:' + esc(c.colour || '#0f7c6c') + '"></span>' + esc(c.displayName) + '</span>' +
          '<span class="sch-f-role">' + esc(c.roleTitle || '') + '</span>' +
          (c.suggestedSlot ? '<span class="sch-f-window">' + fmtTime12(c.suggestedSlot.startMin) + '&ndash;' + fmtTime12(c.suggestedSlot.endMin) + '</span>' : '') +
          '<span class="sm-reasons">' + (c.reasons || []).map(function (r) {
            var neg = /far_|travel_tight|travel_infeasible|travel_unknown|geography_unknown|default_hours/.test(r.code);
            return '<span class="sch-f-reason' + (neg ? ' neg' : '') + '">' + esc(r.label) + '</span>';
          }).join('') + '</span>' +
          (tr.status === 'travel_feasible' && (tr.beforeMinutes != null || tr.afterMinutes != null)
            ? '<span class="sm-travel">Travel feasible' +
              (tr.beforeMinutes != null ? ' &middot; ~' + tr.beforeMinutes + ' min from previous' : '') +
              (tr.afterMinutes != null ? ' &middot; ~' + tr.afterMinutes + ' min to next' : '') + '</span>' : '') +
          '</div>';
      });
      (f.result.notPractical || []).forEach(function (c) {
        html += '<div class="sch-f-card sm-cand sm-cand-np" data-tid="' + esc(c.therapistProfileId) + '" data-start="' + (c.alternativeSlot ? c.alternativeSlot.startMin : '') + '">' +
          '<span class="sch-tier poor">Not practical for this location</span>' +
          '<span class="sch-f-name"><span class="sch-f-dot" style="background:' + esc(c.colour || '#0f7c6c') + '"></span>' + esc(c.displayName) + '</span>' +
          (c.alternativeSlot ? '<span class="sch-f-window">Closest feasible option ' + fmtTime12(c.alternativeSlot.startMin) + '&ndash;' + fmtTime12(c.alternativeSlot.endMin) + '</span>' : '') +
          '</div>';
      });
      var excluded = f.result.excluded || [];
      if (excluded.length) {
        html += '<div class="sm-insp-sub">Unavailable</div>';
        excluded.forEach(function (u) {
          var reasonText = u.reason === 'busy'
            ? (u.busyUntilMin != null ? 'Busy until ' + fmtTime12(u.busyUntilMin) : 'Busy')
            : u.reason === 'leave' ? 'On leave'
            : u.reason === 'not_working' ? 'Not working'
            : u.reason === 'outside_hours' ? 'Outside working hours' : 'Not enough free time';
          html += '<div class="sch-f-urow"><span class="sch-f-uname">' + esc(u.displayName) + '</span>' +
            '<span class="sch-f-ureason">' + esc(reasonText) + '</span></div>';
        });
      }
      if (!html) html = '<div class="sch-status">No candidates for this slot.</div>';
      list.innerHTML = html;
      list.addEventListener('click', function (e) {
        var card = e.target.closest('.sm-cand');
        if (!card) return;
        var tid = card.dataset.tid;
        SCHED.targetId = tid;
        if (SCHED.filters.checked) SCHED.filters.checked.add(tid);
        var start = parseInt(card.dataset.start, 10);
        if (!isNaN(start)) setProposed(start, SCHED.proposed ? SCHED.proposed.durationMin : SCHED.duration);
        else render();
        jumpToMinute(isNaN(start) ? (SCHED.proposed ? SCHED.proposed.startMin : 600) : start, tid);
      });
    }
    body.appendChild(list);
    aside.appendChild(body);
  }

  // ── Map internals (SDK, points, drawing) — unchanged behaviour ───────────

  function mapEnsure() {
    var m = SCHED.map;
    if (m.sdk === 'ready') { mapInit(); return; }
    if (m.sdk === 'loading' || m.sdk === 'error') return;
    m.sdk = 'loading';
    fetch('/api/maps/sdk-url', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('sdk ' + r.status); return r.json(); })
      .then(function (j) {
        if (!j.url) throw new Error('no url');
        var prev = global.onGoogleMapsReady;
        global.onGoogleMapsReady = function () {
          if (typeof prev === 'function') { try { prev(); } catch (e) { /* other consumer */ } }
          m.sdk = 'ready';
          mapInit();
        };
        if (global.google && global.google.maps) { m.sdk = 'ready'; mapInit(); return; }
        if (!document.querySelector('script[data-sch-maps]')) {
          var sc = document.createElement('script');
          sc.src = j.url; sc.async = true; sc.defer = true;
          sc.dataset.schMaps = '1';
          sc.onerror = function () { m.sdk = 'error'; m.error = true; renderMapStatus(); };
          document.head.appendChild(sc);
        }
      })
      .catch(function () { m.sdk = 'error'; m.error = true; renderMapStatus(); });
  }

  function mapInit() {
    var m = SCHED.map;
    var host = document.getElementById('sch-map-host');
    if (!host || !(global.google && global.google.maps)) return;
    if (!m.el) {
      m.el = document.createElement('div');
      m.el.style.cssText = 'width:100%;height:100%;';
      m.gmap = new google.maps.Map(m.el, {
        center: { lat: -31.99, lng: 115.87 }, zoom: 10,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      });
      m.info = new google.maps.InfoWindow();
      m.gmap.addListener('dragstart', function () { m.userMoved = true; });
    }
    if (m.el.parentNode !== host) { host.innerHTML = ''; host.appendChild(m.el); }
    google.maps.event.trigger(m.gmap, 'resize');
    mapDraw();
  }

  function mapFetchPoints(force) {
    var m = SCHED.map;
    var key = SCHED.date;
    if (!force && m.pointsKey === key && m.points) { mapDraw(); return; }
    m.loading = true; m.error = false;
    renderMapStatus();
    fetch('/api/scheduler/map-points?date=' + key, { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('points ' + r.status); return r.json(); })
      .then(function (j) {
        if (SCHED.date !== key) return; // date changed while loading
        m.loading = false;
        m.points = j.points || [];
        m.pointsKey = key;
        m.meta = { telehealth: j.telehealth || 0, unmappable: j.unmappable || 0 };
        renderMapStatus(); renderMapLegend(); mapDraw();
      })
      .catch(function () {
        if (SCHED.date !== key) return;
        m.loading = false; m.error = true;
        renderMapStatus();
      });
  }

  function mapVisiblePoints() {
    var m = SCHED.map;
    var vis = {};
    visibleTherapists().forEach(function (t) { if (isChecked(t.id)) vis[t.id] = true; });
    return (m.points || []).filter(function (p) { return vis[p.therapistProfileId]; });
  }

  function mapClear() {
    var m = SCHED.map;
    m.markers.forEach(function (mk) { mk.setMap(null); });
    m.polys.forEach(function (pl) { pl.setMap(null); });
    m.markers = []; m.polys = [];
  }

  function mapDraw() {
    var m = SCHED.map;
    if (!m.gmap || !(global.google && global.google.maps)) return;
    mapClear();
    var pts = mapVisiblePoints();
    var bounds = new google.maps.LatLngBounds();
    var byTher = {};
    pts.forEach(function (p) {
      (byTher[p.therapistProfileId] = byTher[p.therapistProfileId] || []).push(p);
    });
    Object.keys(byTher).forEach(function (tid) {
      var list = byTher[tid];
      var dedup = dedupSuburbPoints(list);
      dedup.forEach(function (p, idx) {
        var off = 0.006 * (idx % 3 - 1);
        var mk = new google.maps.Marker({
          map: m.gmap,
          position: { lat: p.lat + off, lng: p.lng },
          label: p.count > 1 ? { text: String(p.count), color: '#fff', fontSize: '11px' } : null,
          title: p.suburb + ' - ' + p.therapistName,
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: p.count > 1 ? 11 : 8,
            fillColor: p.therapistColour || '#0f7c6c', fillOpacity: 0.92,
            strokeColor: '#ffffff', strokeWeight: 2,
          },
        });
        mk.addListener('click', function () {
          var evs = list.filter(function (q) { return q.suburb === p.suburb; });
          m.info.setContent('<div class="sch-map-pop"><strong>' + esc(p.therapistName) + '</strong><br/>' +
            esc(p.suburb) + '<br/>' + evs.map(function (q) {
              return fmtTime12(q.startMin) + '–' + fmtTime12(q.endMin);
            }).join('<br/>') +
            '<br/><button type="button" data-eid="' + esc(evs[0].eventId) + '" class="sch-map-view">View on calendar</button></div>');
          m.info.open(m.gmap, mk);
          setTimeout(function () {
            var btn = document.querySelector('.sch-map-view');
            if (btn) btn.addEventListener('click', function () { mapHighlightTiles(btn.dataset.eid); });
          }, 60);
        });
        m.markers.push(mk);
        bounds.extend(mk.getPosition());
      });
      // service footprint hull for the day (derived, never stored)
      if (m.footprints) {
        var cluster = dedupSuburbPoints(list);
        if (cluster.length < 3) return; // 1-2 suburbs: markers alone tell the story
        clusterPoints(cluster).forEach(function (cl) {
          if (cl.length < 3) return;
          var hull = convexHull(cl);
          if (hull.length < 3) return;
          m.polys.push(new google.maps.Polygon({
            map: m.gmap,
            paths: hull.map(function (p) { return { lat: p.lat, lng: p.lng }; }),
            fillColor: list[0].therapistColour || '#0f7c6c', fillOpacity: 0.10,
            strokeColor: list[0].therapistColour || '#0f7c6c', strokeOpacity: 0.5, strokeWeight: 1.5,
          }));
        });
      }
    });
    var bk = pts.map(function (p) { return p.eventId; }).join(',');
    if (!m.userMoved && pts.length && bk !== m.boundsKey) {
      m.boundsKey = bk;
      m.gmap.fitBounds(bounds, 48);
    }
  }

  // map marker → matrix block highlight
  function mapHighlightTiles(eid) {
    document.querySelectorAll('.sm-ev[data-eid]').forEach(function (el) {
      if (el.dataset.eid === eid) {
        el.classList.add('sch-flash');
        el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        setTimeout(function () { el.classList.remove('sch-flash'); }, 1400);
      }
    });
  }

  // matrix block → map marker emphasis
  function mapEmphasiseEvent(eid) {
    var m = SCHED.map;
    if (SCHED.inspector !== 'map' || !m.gmap) return;
    var p = (m.points || []).find(function (q) { return q.eventId === eid; });
    if (p) m.gmap.panTo({ lat: p.lat, lng: p.lng });
  }

  // temporary proposed-client marker (star); cleared, never persisted
  function mapShowClientPoint(pt) {
    var m = SCHED.map;
    if (!m.gmap || !(global.google && global.google.maps)) return;
    if (m.clientMarker) { m.clientMarker.setMap(null); m.clientMarker = null; }
    if (!pt || pt.lat == null) return;
    m.clientMarker = new google.maps.Marker({
      map: m.gmap,
      position: { lat: pt.lat, lng: pt.lng },
      title: (pt.suburb || 'Client') + ' - not yet booked',
      icon: {
        path: 'M 0,-12 L 3,-4 11,-4 5,1 7,9 0,4 -7,9 -5,1 -11,-4 -3,-4 Z',
        fillColor: '#d96f4e', fillOpacity: 0.95, strokeColor: '#ffffff', strokeWeight: 1.5, scale: 1,
      },
    });
    m.gmap.panTo({ lat: pt.lat, lng: pt.lng });
  }

  function renderMapStatus() {
    var host = document.getElementById('sch-map-status');
    if (!host) return;
    var m = SCHED.map;
    host.className = 'sch-map-note';
    host.innerHTML = m.error
      ? 'Map unavailable right now. Scheduling is unaffected. <button type="button" class="sch-map-retry">Retry</button>'
      : (m.loading ? 'Loading locations&hellip;' : '');
    var retry = host.querySelector('.sch-map-retry');
    if (retry) retry.addEventListener('click', function () { SCHED.map.error = false; mapFetchPoints(true); mapEnsure(); });
  }

  function renderMapLegend() {
    var host = document.getElementById('sch-map-legend');
    if (!host) return;
    var byTher = {};
    mapVisiblePoints().forEach(function (p) {
      (byTher[p.therapistProfileId] = byTher[p.therapistProfileId] || { name: p.therapistName, colour: p.therapistColour, suburbs: {}, n: 0 }); // eslint-disable-line
      byTher[p.therapistProfileId].n += 1;
      byTher[p.therapistProfileId].suburbs[p.suburb] = 1;
    });
    var ids = Object.keys(byTher);
    host.innerHTML = ids.length
      ? ids.map(function (tid) {
          var e = byTher[tid];
          return '<button type="button" class="sch-map-leg" data-tid="' + esc(tid) + '">' +
            '<span class="sch-map-leg-n" style="background:' + esc(e.colour || '#0f7c6c') + '">' + e.n + '</span>' +
            '<span class="sch-map-leg-name">' + esc(e.name) + ' <span class="sch-map-leg-subs">' + e.n + ' visit' + (e.n === 1 ? '' : 's') + ' &middot; ' +
            esc(Object.keys(e.suburbs).join(' · ')) + '</span></span></button>';
        }).join('')
      : '<div class="sch-map-empty">No mappable visits for this day.</div>';
    host.querySelectorAll('[data-tid]').forEach(function (b) {
      b.addEventListener('click', function () {
        openInspector('therapist', b.dataset.tid);
      });
    });
  }

  // ── Root render ───────────────────────────────────────────────────────────

  function render() {
    var el = root();
    if (!el) return;
    var frag = document.createDocumentFragment();
    renderToolbar(frag);
    renderSummary(frag);

    var body = document.createElement('div');
    body.className = 'sm-body' + (SCHED.inspector ? ' has-insp' : '');
    var visible = visibleTherapists();
    if (SCHED.loading && !SCHED.therapists.length) {
      var ld = document.createElement('div');
      ld.className = 'sch-status';
      ld.textContent = 'Loading schedules…';
      body.appendChild(ld);
    } else if (!visible.length) {
      var none = document.createElement('div');
      none.className = 'sch-status';
      none.textContent = SCHED.therapists.length ? 'No therapists match the current filters.' : 'No therapists found for this practice.';
      body.appendChild(none);
    } else {
      renderMatrix(body, visible);
    }
    renderInspector(body);
    frag.appendChild(body);

    var note = document.createElement('div');
    note.className = 'sch-mobile-note';
    note.textContent = 'On small screens the matrix condenses to the therapist list; pick a time with Start above.';
    frag.appendChild(note);

    el.innerHTML = '';
    el.appendChild(frag);

    if (SCHED.inspector === 'map') { mapEnsure(); }
    if (SCHED.inspector === 'therapist' && SCHED.inspectorId) loadWeekCapacity(SCHED.inspectorId);
    ensureNowTimer();
  }

  function ensureNowTimer() {
    if (SCHED.nowTimer) { clearInterval(SCHED.nowTimer); SCHED.nowTimer = null; }
    if (SCHED.date !== todayPerthYmd()) return;
    SCHED.nowTimer = setInterval(function () {
      var win = displayWindow();
      var nowMin = perthParts(new Date().toISOString()).minutes;
      document.querySelectorAll('.sm-now').forEach(function (elx) {
        elx.style.left = ((nowMin - win.startMin) * PPM) + 'px';
      });
    }, 60000);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function open() {
    if (!SCHED.date) SCHED.date = todayPerthYmd();
    load();
  }

  function nav(dir) {
    if (dir === 'today') setDate(todayPerthYmd());
    else setDate(addDaysYmd(SCHED.date || todayPerthYmd(), dir));
  }

  function refresh() {
    WEEK_CAP = {};
    SCHED.avail.key = null;
    SCHED.recs.key = null;
    SCHED.common.key = null;
    load(true);
  }

  global.OpalScheduler = {
    open: open, nav: nav, refresh: refresh, _state: SCHED,
    _mapRetry: function () { SCHED.map.sdk = 'none'; SCHED.map.error = false; mapEnsure(); },
  };


})(typeof window !== 'undefined' ? window : null);

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

  // ── Exports for unit tests (node) ─────────────────────────────────────────
  var helpers = {
    perthParts: perthParts, addDaysYmd: addDaysYmd, mondayOfYmd: mondayOfYmd,
    fmtTime12: fmtTime12, safeLabel: safeLabel, extractSuburb: extractSuburb,
    assignLanes: assignLanes, filterTherapists: filterTherapists,
    disciplinesOf: disciplinesOf, eventsForTherapistDay: eventsForTherapistDay,
    groupWeek: groupWeek, apptCount: apptCount, isPlaceholderTitle: isPlaceholderTitle,
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
      '<button type="button" class="sch-add-btn" data-act="add">+ Appointment</button>';

    tb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'prev')  nav(-1);
      if (act === 'next')  nav(1);
      if (act === 'today') nav('today');
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
      bar.innerHTML =
        '<button type="button" class="sch-focus-crumb" data-act="unfocus">&#8592; All therapists</button>' +
        '<span class="sch-filter-label">Focused on</span>' +
        '<span class="sch-chip selected" style="color:' + esc((t && t.colour) || '#0f7c6c') + ';">' +
          '<span class="sch-chip-av" style="background:' + esc((t && t.colour) || '#0f7c6c') + ';">' + esc((t && t.initials) || '?') + '</span>' +
          esc((t && t.displayName) || '') + '</span>';
      bar.addEventListener('click', function (e) {
        if (e.target.closest('[data-act="unfocus"]')) { SCHED.focusId = null; render(); }
      });
      frag.appendChild(bar);
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

  // ── Day grid ──────────────────────────────────────────────────────────────
  function renderDay(frag, visible) {
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
      head.innerHTML =
        '<span class="sch-h-av" style="background:' + esc(t.colour || '#0f7c6c') + ';">' + esc(t.initials || '?') + '</span>' +
        '<span class="sch-h-id">' +
          '<span class="sch-h-name">' + esc(t.displayName) + '</span>' +
          '<span class="sch-h-sub">' + esc(t.roleTitle || '') + '</span>' +
        '</span>' +
        '<span class="sch-h-count" title="Appointments this day">' + apptCount(dayEvents) + '</span>';
      var focus = function () { SCHED.focusId = t.id; render(); };
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
      col.style.height = bodyH + 'px';

      // soft off-hours wash (visual calm, explicitly NOT availability)
      [['0', WORK_START_H], [String(WORK_END_H), 24 - WORK_END_H]].forEach(function (band) {
        var off = document.createElement('div');
        off.className = 'sch-offhours';
        off.style.top = (Number(band[0]) * HOUR()) + 'px';
        off.style.height = (band[1] * HOUR()) + 'px';
        col.appendChild(off);
      });

      var items = assignLanes(eventsForTherapistDay(SCHED.events, t.id, SCHED.date));
      items.forEach(function (it) {
        var tile = document.createElement('div');
        tile.className = 'sch-tile';
        tile.setAttribute('data-type', it.ev.eventType || 'outlook');
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
      grid.appendChild(col);
    });

    scroll.appendChild(grid);
    frag.appendChild(scroll);

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
  }

  function refresh() { load(true); }

  global.OpalScheduler = { open: open, nav: nav, refresh: refresh, _state: SCHED };

})(typeof window !== 'undefined' ? window : null);

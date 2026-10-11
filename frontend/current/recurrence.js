/* ═══════════════════════════════════════════════════════════════════════════
   RECURRENCE — repeating appointments, the Outlook way (11 Oct 2026).

   Three places:
     • Smart Booking › WHEN & WHERE › Repeat: Doesn't repeat / Weekly /
       Fortnightly / Monthly / Custom… The custom editor is Outlook's: Repeat
       every [N] [day|week|month|year], the weekday circles, "On day 12" or
       "On the second Monday", and when it ends (on a date, or after N). The
       line under it is the server's "Occurs every…" with the count.
     • The event's detail panel: "Repeat…" for an appointment that does not
       repeat yet (do it later), or the series line for one that does.
     • Delete: Outlook's three choices — this event, this and following, or
       all events in the series.

   A series is ordinary dated appointments (series-routes.js, migration 075):
   the first is booked by Create appointment, the repeats by the server through
   the same path — Outlook mirror, client link, MMM zone and the Splose draft
   queue (nothing reaches Splose before "Write to Splose"). Capped at 12
   months / 52 appointments.

   Globals reached at call time: DAY_DATES, SESSIONS, showToast,
   loadOutlookEventsToCalendar, openBookingPanel, performDeleteEvent.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var Rec = global.Recurrence = global.Recurrence || {};
  var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var WEEK = [['mon', 'M', 'Monday'], ['tue', 'T', 'Tuesday'], ['wed', 'W', 'Wednesday'], ['thu', 'T', 'Thursday'],
              ['fri', 'F', 'Friday'], ['sat', 'S', 'Saturday'], ['sun', 'S', 'Sunday']];
  var ORD = ['first', 'second', 'third', 'fourth', 'last'];
  var DAY_NAME = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(a, b, kind) { if (typeof global.showToast === 'function') global.showToast(a, b, kind); }
  async function api(url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  function postJson(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addMonths(s, n) {
    var d = parseYmd(s); if (!d) return s;
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return ymd(new Date(Date.UTC(yy, mm, Math.min(day, last))));
  }
  function dayKeyOf(s) { var d = parseYmd(s); return d ? DAY_KEYS[d.getUTCDay()] : 'mon'; }
  function ordinalOf(s) { var d = parseYmd(s); return d ? Math.min(5, Math.ceil(d.getUTCDate() / 7)) : 1; }
  function dateOfMonth(s) { var d = parseYmd(s); return d ? d.getUTCDate() : 1; }

  /* ─────────────────────────── The editor (shared) ───────────────────────────
     state: { preset, interval, freq, days[], monthly, endType, until, count }
     preset: none | weekly | fortnightly | monthly | monthly-weekday | custom */
  function freshState(anchor) {
    return { preset: 'none', freq: 'week', interval: 1, days: [dayKeyOf(anchor)], monthly: 'date',
             endType: 'date', until: addMonths(anchor, 2), count: 10, anchor: anchor };
  }
  function ruleOf(st) {
    if (!st || st.preset === 'none') return null;
    var anchorDay = dayKeyOf(st.anchor);
    var r;
    if (st.preset === 'weekly') r = { freq: 'week', interval: 1, days: [anchorDay] };
    else if (st.preset === 'fortnightly') r = { freq: 'week', interval: 2, days: [anchorDay] };
    else if (st.preset === 'monthly') r = { freq: 'month', interval: 1, monthly: 'date' };
    else if (st.preset === 'monthly-weekday') r = { freq: 'month', interval: 1, monthly: 'weekday' };
    else {
      r = { freq: st.freq, interval: Math.max(1, Math.min(99, parseInt(st.interval, 10) || 1)) };
      if (st.freq === 'week') r.days = st.days.length ? st.days.slice() : [anchorDay];
      if (st.freq === 'month') r.monthly = st.monthly;
    }
    r.end = st.endType === 'count' ? { type: 'count', count: Math.max(2, parseInt(st.count, 10) || 2) } : { type: 'date', until: st.until };
    return r;
  }

  function presetLabels(anchor) {
    var day = DAY_NAME[dayKeyOf(anchor)];
    return [
      ['none', 'Doesn’t repeat'],
      ['weekly', 'Weekly on ' + day],
      ['fortnightly', 'Fortnightly on ' + day],
      ['monthly', 'Monthly on day ' + dateOfMonth(anchor)],
      ['monthly-weekday', 'Monthly on the ' + ORD[ordinalOf(anchor) - 1] + ' ' + day],
      ['custom', 'Custom…'],
    ];
  }

  function editorHtml(st, idp) {
    var anchor = st.anchor;
    var opts = presetLabels(anchor).map(function (p) {
      return '<option value="' + p[0] + '"' + (st.preset === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    }).join('');
    var custom = st.preset === 'custom';
    var unit = function (v, l) { return '<option value="' + v + '"' + (st.freq === v ? ' selected' : '') + '>' + l + '</option>'; };
    var circles = WEEK.map(function (w) {
      var on = st.days.indexOf(w[0]) >= 0;
      return '<button type="button" class="rec-day' + (on ? ' on' : '') + '" data-rec-day="' + w[0] + '" aria-pressed="' + on + '" aria-label="' + w[2] + '" title="' + w[2] + '">' + w[1] + '</button>';
    }).join('');
    var dayName = DAY_NAME[dayKeyOf(anchor)];
    return '' +
      '<label class="bsp-field-label" for="' + idp + '-preset">Repeat</label>' +
      '<select id="' + idp + '-preset" class="rec-preset" data-rec="preset">' + opts + '</select>' +
      '<div class="rec-custom"' + (custom ? '' : ' hidden') + '>' +
        '<div class="rec-row"><span class="rec-lbl">Repeat every</span>' +
          '<input type="number" min="1" max="99" class="rec-interval" data-rec="interval" value="' + esc(st.interval) + '" aria-label="Repeat every">' +
          '<select class="rec-unit" data-rec="freq" aria-label="Unit">' + unit('day', st.interval > 1 ? 'days' : 'day') + unit('week', st.interval > 1 ? 'weeks' : 'week') +
            unit('month', st.interval > 1 ? 'months' : 'month') + unit('year', st.interval > 1 ? 'years' : 'year') + '</select></div>' +
        (st.freq === 'week' ? '<div class="rec-row rec-days" role="group" aria-label="On these days">' + circles + '</div>' : '') +
        (st.freq === 'month' ? '<div class="rec-row rec-monthly" role="radiogroup">' +
          '<label><input type="radio" name="' + idp + '-monthly" data-rec="monthly" value="date"' + (st.monthly === 'date' ? ' checked' : '') + '> On day ' + dateOfMonth(anchor) + '</label>' +
          '<label><input type="radio" name="' + idp + '-monthly" data-rec="monthly" value="weekday"' + (st.monthly === 'weekday' ? ' checked' : '') + '> On the ' + ORD[ordinalOf(anchor) - 1] + ' ' + dayName + '</label></div>' : '') +
      '</div>' +
      '<div class="rec-end"' + (st.preset === 'none' ? ' hidden' : '') + '>' +
        '<label class="rec-end-opt"><input type="radio" name="' + idp + '-end" data-rec="endType" value="date"' + (st.endType === 'date' ? ' checked' : '') + '> Until ' +
          '<input type="date" class="rec-until" data-rec="until" value="' + esc(st.until) + '" min="' + esc(anchor) + '" max="' + esc(addMonths(anchor, 12)) + '" aria-label="Until"></label>' +
        '<label class="rec-end-opt"><input type="radio" name="' + idp + '-end" data-rec="endType" value="count"' + (st.endType === 'count' ? ' checked' : '') + '> After ' +
          '<input type="number" min="2" max="52" class="rec-count" data-rec="count" value="' + esc(st.count) + '" aria-label="Number of appointments"> appointments</label>' +
      '</div>' +
      '<div class="rec-summary" aria-live="polite"' + (st.preset === 'none' ? ' hidden' : '') + '></div>';
  }

  /* Wire an editor inside `box`; onChange(state) after every edit. */
  function mountEditor(box, st, idp, onChange) {
    var render = function () { box.innerHTML = editorHtml(st, idp); refreshSummary(box, st); };
    box.addEventListener('change', function (e) {
      var k = e.target && e.target.getAttribute('data-rec'); if (!k) return;
      if (k === 'preset') st.preset = e.target.value;
      else if (k === 'interval') st.interval = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1));
      else if (k === 'freq') st.freq = e.target.value;
      else if (k === 'monthly') st.monthly = e.target.value;
      else if (k === 'endType') st.endType = e.target.value;
      else if (k === 'until') { st.until = e.target.value; st.endType = 'date'; }
      else if (k === 'count') { st.count = Math.max(2, Math.min(52, parseInt(e.target.value, 10) || 2)); st.endType = 'count'; }
      render();
      if (onChange) onChange(st);
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-rec-day]'); if (!b) return;
      var d = b.getAttribute('data-rec-day'), i = st.days.indexOf(d);
      if (i >= 0) { if (st.days.length > 1) st.days.splice(i, 1); } else st.days.push(d);
      render();
      if (onChange) onChange(st);
    });
    render();
    return { render: render };
  }

  var SUMMARY_SEQ = 0;
  function refreshSummary(box, st) {
    var el = box.querySelector('.rec-summary');
    var rule = ruleOf(st);
    if (!el) return;
    if (!rule) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = 'Working out the dates…';
    var seq = ++SUMMARY_SEQ;
    postJson('/api/recurrence/preview', { rule: rule, start: st.anchor }).then(function (p) {
      if (seq !== SUMMARY_SEQ) return;
      el.classList.remove('warn');
      el.textContent = p.summary + ' · ' + p.count + ' appointments, the last on ' + p.last + '.' +
        (p.capped ? ' Capped at 12 months or 52 appointments.' : '');
    }).catch(function (err) {
      if (seq !== SUMMARY_SEQ) return;
      el.classList.add('warn');
      el.textContent = err.message;
    });
  }

  /* ───────────────────────── Smart Booking › Repeat ───────────────────────── */
  var PANEL = { st: null, editor: null, anchor: null };
  function panelAnchor() {
    var chip = document.querySelector('.bsp-day-chip.active');
    var day = chip && chip.dataset ? chip.dataset.day : null;
    return day && typeof DAY_DATES !== 'undefined' && DAY_DATES ? DAY_DATES[day] || null : null;
  }
  function panelSync() {
    var box = $('bsp-repeat'); if (!box) return;
    var anchor = panelAnchor();
    if (!anchor) { box.hidden = true; return; }
    box.hidden = false;
    if (!PANEL.st) PANEL.st = freshState(anchor);
    if (PANEL.anchor !== anchor) {
      // A new day: the weekday and "day N" follow it; the chosen pattern stays.
      var old = PANEL.st;
      var keepDays = old.preset === 'custom' && old.freq === 'week' && old.days.length > 1;
      PANEL.st.anchor = anchor;
      if (!keepDays) PANEL.st.days = [dayKeyOf(anchor)];
      if (!old.untilTouched) PANEL.st.until = addMonths(anchor, 2);
      PANEL.anchor = anchor;
      if (PANEL.editor) PANEL.editor.render();
    }
    if (!PANEL.editor) PANEL.editor = mountEditor(box, PANEL.st, 'bsp-rec', function (st) { if (st.endType === 'date') st.untilTouched = true; });
  }
  function panelReset() {
    PANEL.st = null; PANEL.anchor = null;
    var box = $('bsp-repeat');
    if (box) { box.innerHTML = ''; box.hidden = true; }
    if (PANEL.editor) PANEL.editor = null;
    // A fresh editor needs fresh listeners: replace the node.
    if (box && box.parentNode) { var n = box.cloneNode(false); box.parentNode.replaceChild(n, box); }
  }
  /** The rule the panel holds, or null for "Doesn't repeat". */
  Rec.panelRule = function () { return PANEL.st ? ruleOf(PANEL.st) : null; };

  /* After Create appointment saved the first one: book the repeats. */
  Rec.afterBooked = async function (dbId, rule) {
    rule = rule || Rec.panelRule();
    if (!dbId || !rule) return null;
    return createSeries(dbId, rule);
  };

  async function createSeries(dbId, rule) {
    toast('Booking the repeats…', 'Each one is added to the calendar and Outlook like a single booking.');
    try {
      var r = await postJson('/api/events/' + encodeURIComponent(dbId) + '/series', { rule: rule });
      var made = r.created.length;
      var queued = r.created.filter(function (c) { return c.sploseQueued; }).length;
      toast(r.summary, (made + 1) + ' appointments booked' + (queued ? ' · ' + queued + ' waiting for “Write to Splose”' : '') +
        (r.failed.length ? ' · ' + r.failed.length + ' could not be saved (' + r.failed.map(function (f) { return f.date; }).join(', ') + ')' : ''),
        r.failed.length ? 'warn' : undefined);
      if (typeof global.loadOutlookEventsToCalendar === 'function') global.loadOutlookEventsToCalendar();
      return r;
    } catch (e) {
      toast('Could not book the repeats', e.message + ' The first appointment is booked.', 'warn');
      return null;
    }
  }

  /* ───────────────────── The event's detail panel ───────────────────── */
  function perthYmd(iso) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  }
  global.recurrenceDecorateDetail = function (s) {
    var host = $('bd-body');
    if (!host || !s || !s.dbId) return;
    var old = $('rec-detail'); if (old) old.remove();
    if (s.travelLegKey || s.type === 'travel') return;
    var box = document.createElement('div');
    box.className = 'rec-detail'; box.id = 'rec-detail';
    host.appendChild(box);
    if (!s.seriesId) {
      box.innerHTML = '<b>Repeat</b> <span class="rec-dim">Doesn’t repeat.</span> <button type="button" class="rec-link" data-rec-open>Make it repeat…</button>';
      box.querySelector('[data-rec-open]').addEventListener('click', function () { openRepeatDialog(s); });
      return;
    }
    box.innerHTML = '<b>Repeat</b> <span class="rec-dim">loading…</span>';
    api('/api/events/' + encodeURIComponent(s.dbId) + '/series').then(function (r) {
      if (!r.series) { box.innerHTML = '<b>Repeat</b> <span class="rec-dim">Doesn’t repeat.</span>'; return; }
      var i = r.events.findIndex(function (e) { return e.isThis; });
      box.innerHTML = '<b>Repeat</b> ' + esc(r.series.summary || 'Part of a series') +
        '<div class="rec-dim">Appointment ' + (i + 1) + ' of ' + r.events.length + '. Delete offers this one, this and following, or the whole series.</div>';
    }).catch(function () { box.remove(); });
  };

  function openRepeatDialog(s) {
    var anchor = s.startTimeIso ? perthYmd(s.startTimeIso) : (typeof DAY_DATES !== 'undefined' && DAY_DATES ? DAY_DATES[s.day] : null);
    if (!anchor) { toast('Cannot repeat this one', 'It has no date yet.', 'warn'); return; }
    var st = freshState(anchor); st.preset = 'weekly';
    var el = document.createElement('div');
    el.className = 'pd-backdrop rec-backdrop';
    el.innerHTML = '<section class="pd-dialog rec-dialog" role="dialog" aria-modal="true" aria-labelledby="rec-dlg-title">' +
      '<div class="pd-head"><h2 class="pd-title" id="rec-dlg-title">Make it repeat</h2></div>' +
      '<div class="pd-body"><p class="rec-dim">' + esc(s.patient || s.title || 'This appointment') + ' stays where it is; the repeats are booked after it, each like a single booking.</p>' +
      '<div class="rec-editor"></div></div>' +
      '<div class="pd-foot"><button type="button" class="pd-btn" data-rec-cancel>Cancel</button><button type="button" class="pd-btn pd-btn-primary" data-rec-save>Book the repeats</button></div></section>';
    document.body.appendChild(el);
    mountEditor(el.querySelector('.rec-editor'), st, 'rec-dlg');
    var close = function () { el.remove(); document.removeEventListener('keydown', onKey, true); };
    var onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    el.querySelector('[data-rec-cancel]').addEventListener('click', close);
    el.querySelector('[data-rec-save]').addEventListener('click', async function () {
      var rule = ruleOf(st);
      if (!rule) { close(); return; }
      this.disabled = true;
      close();
      if (typeof global.closeBlockDetail === 'function') global.closeBlockDetail();
      await createSeries(s.dbId, rule);
    });
    var first = el.querySelector('.rec-preset'); if (first) first.focus();
  }
  Rec.openRepeatDialog = openRepeatDialog;

  /* ───────────────────────────── Delete ─────────────────────────────
     Outlook's choices for an appointment in a series. Resolves 'one' |
     'following' | 'all', or null when cancelled. */
  Rec.chooseDeleteScope = function (label) {
    return new Promise(function (resolve) {
      var el = document.createElement('div');
      el.className = 'pd-backdrop rec-backdrop';
      el.innerHTML = '<section class="pd-dialog" role="dialog" aria-modal="true" aria-labelledby="rec-del-title">' +
        '<div class="pd-head"><h2 class="pd-title" id="rec-del-title">Delete a repeating appointment</h2></div>' +
        '<div class="pd-body"><p>“' + esc(label) + '” is part of a series.</p>' +
        '<div class="rec-scope" role="radiogroup">' +
          '<label><input type="radio" name="rec-scope" value="one" checked> This event</label>' +
          '<label><input type="radio" name="rec-scope" value="following"> This and all following events</label>' +
          '<label><input type="radio" name="rec-scope" value="all"> All events in the series</label>' +
        '</div><p class="rec-dim">Each one is removed from the calendar and Outlook; a client session already written to Splose is queued for cancellation there.</p></div>' +
        '<div class="pd-foot"><button type="button" class="pd-btn" data-act="cancel">Cancel</button><button type="button" class="pd-btn pd-btn-danger" data-act="ok">Delete</button></div></section>';
      document.body.appendChild(el);
      var done = function (v) { el.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      var onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      el.addEventListener('mousedown', function (e) { if (e.target === el) done(null); });
      el.querySelector('[data-act="cancel"]').addEventListener('click', function () { done(null); });
      el.querySelector('[data-act="ok"]').addEventListener('click', function () {
        var v = el.querySelector('input[name="rec-scope"]:checked'); done(v ? v.value : null);
      });
      el.querySelector('[data-act="cancel"]').focus();
    });
  };

  /* Delete this and following / all: the ordinary delete, one by one, so
     Outlook and the Splose queue follow each appointment. */
  Rec.deleteSeries = async function (s, scope) {
    var r;
    try { r = await api('/api/events/' + encodeURIComponent(s.dbId) + '/series'); }
    catch (e) { toast('Could not read the series', e.message, 'warn'); return false; }
    if (!r.series) return false;
    var thisStart = (r.events.find(function (e) { return e.isThis; }) || {}).start;
    var targets = r.events.filter(function (e) { return scope === 'all' || new Date(e.start) >= new Date(thisStart); });
    var failed = 0;
    for (var i = 0; i < targets.length; i++) {
      try { await api('/api/outlook/events/' + encodeURIComponent(targets[i].dbId), { method: 'DELETE' }); }
      catch (e) { if (e.status !== 404) failed++; }
    }
    if (typeof global.loadOutlookEventsToCalendar === 'function') global.loadOutlookEventsToCalendar();
    toast((targets.length - failed) + ' appointment' + (targets.length - failed === 1 ? '' : 's') + ' deleted',
      failed ? failed + ' could not be deleted — try again' : (scope === 'all' ? 'The whole series is gone.' : 'This one and the ones after it.'), failed ? 'warn' : undefined);
    return true;
  };

  /* ───────────────────────────── Wiring ───────────────────────────── */
  function wrapGlobal(name, after) {
    var orig = global[name];
    if (typeof orig !== 'function' || orig['__rec_' + name]) return;
    var w = function () { var out = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { /* enhancement only */ } return out; };
    w['__rec_' + name] = true;
    global[name] = w;
  }
  function wire() {
    wrapGlobal('openBookingPanel', function (o) {
      if (!(o && o.keepState)) panelReset();
      setTimeout(panelSync, 60);
    });
    wrapGlobal('bspSelectDay', function () { setTimeout(panelSync, 0); });
    wrapGlobal('closeBookingPanel', function () { /* kept until the next fresh open */ });
  }
  Rec._ruleOf = ruleOf; Rec._freshState = freshState; Rec._panelSync = panelSync;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})(window);

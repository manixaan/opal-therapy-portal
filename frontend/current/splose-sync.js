/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — SPLOSE DRAFT-AND-PUBLISH SYNC (frontend)

   The calendar is where a client appointment is created, moved or cancelled.
   Those changes queue up on the server (splose_sync_queue) and nothing goes to
   Splose until the user presses "Sync Splose". This module:

     • puts the Sync Splose button (with a pending count) in the calendar bar
     • draws the review panel: every queued change, a service/case/reason
       chooser where one is needed, Publish, and live progress
     • marks unsynced tiles on the calendar grid
     • never prompts about waiting changes: the server's auto-sync writes
       them, and Sync Splose stays the manual way (6 Oct 2026)
     • makes a drag / resize / time-edit real: the existing commitMove only
       repainted the tile — this persists the new time (PATCH), which the
       backend queues for Splose
     • polls for "changed inside Splose" alerts and shows each one, asking
       whether the change was valid
     • match, link or ignore (080): each queued new appointment shows whether
       Splose already holds it; Link adopts that appointment (no write),
       Ignore drops the booking from Splose sync for good (Owner/Admin can
       undo), Send creates it — Send needs ENABLE_SPLOSE_WRITE, the others don't

   Globals on window (window.SploseSync), no modules — the house pattern.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  var doc = global.document;
  if (!doc) return;

  var S = {
    enabled: false,
    writeEnabled: false,
    autoSync: false,        // server writes the queue itself after a quiet period
    watching: false,
    pending: [],            // rows from /api/splose-sync/pending
    pendingByEvent: {},     // eventId → row
    services: null, reasons: null, cases: {},
    panelOpen: false,
    publishing: null,       // status object while a run is active
    alertQueue: [], alertShowing: false,
    pollTimer: null,
    lastRunShown: null,
    // Match, link or ignore (080)
    match: null,            // { state: 'loading'|'ready'|'error', byRow: { queueId: [candidates] }, error }
    ignored: [], ignoredCanUndo: false, showIgnored: false,
    picked: {},             // queueId → ticked (survives re-renders)
    svcChoice: {},          // queueId → chosen service id
  };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fetchJson(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, json: j }; });
    });
  }
  function toast(msg, isError) {
    if (typeof global.showToast === 'function') global.showToast(msg, isError);
  }
  function confirmDialog(msg, opts) {
    if (typeof global.portalConfirm === 'function') return global.portalConfirm(msg, opts);
    return Promise.resolve(global.confirm(msg));
  }
  function fmtPerth(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function fmtTimeOnly(iso) {
    try { return new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso; }
  }
  function isCalendarActive() {
    var el = doc.querySelector('.tab.active[data-tab]');
    return !!(el && el.dataset.tab === 'calendar');
  }
  function canUse() {
    var u = global.APP_USER;
    return S.enabled && u && u.role !== 'read_only' && u.role !== 'pre_employee';
  }

  // ── Server state ──────────────────────────────────────────────────────────

  function refreshPending() {
    if (!canUse()) return Promise.resolve();
    return fetchJson('/api/splose-sync/pending').then(function (r) {
      if (!r.ok) { if (r.status === 403 && r.json.code === 'feature_disabled') { S.enabled = false; renderButton(); } return; }
      S.pending = r.json.changes || [];
      S.pendingByEvent = {};
      S.pending.forEach(function (c) { S.pendingByEvent[c.eventId] = c; });
      renderButton();
      decorateTiles();
      if (S.panelOpen) renderPanel();
    }).catch(function () {});
  }

  // ── No sync popups (6 Oct 2026, owner's call) ─────────────────────────────
  // Waiting changes are written by the server's auto-sync after a quiet
  // period; anything it cannot write alone (a new booking without a service,
  // a failed row) waits under Sync Splose. Nothing prompts — no idle nudge, no
  // "Sync Splose?" on leaving the calendar, no browser "Leave site?".

  function refreshStatus() {
    if (!canUse()) return Promise.resolve(null);
    return fetchJson('/api/splose-sync/status').then(function (r) {
      if (!r.ok) return null;
      S.writeEnabled = r.json.writeEnabled === true;
      S.autoSync = r.json.autoSyncEnabled === true;
      S.publishing = r.json.running || null;
      if (!S.publishing && r.json.lastRun && S.lastRunShown !== r.json.lastRun.finishedAt) {
        S.lastRunShown = r.json.lastRun.finishedAt;
        S.lastRun = r.json.lastRun;
      }
      return r.json;
    }).catch(function () { return null; });
  }

  function loadReference() {
    var jobs = [];
    // The proxy maps Splose's `name` to `title`; keep only live appointment
    // services (support-activity and archived ones cannot be booked).
    if (!S.services) jobs.push(fetchJson('/api/splose/services').then(function (r) {
      S.services = (r.ok ? (r.json.data || []) : [])
        .filter(function (s) { return !s.archived && (!s.for || /appointment/i.test(String(s.for))); })
        .map(function (s) { return { id: s.id, name: s.title || s.name || ('Service ' + s.id) }; });
    }));
    if (!S.reasons) jobs.push(fetchJson('/api/splose/cancellation-reasons').then(function (r) { S.reasons = r.ok ? (r.json.data || []) : []; }));
    return Promise.all(jobs);
  }

  function casesFor(patientId) {
    if (!patientId) return Promise.resolve([]);
    if (S.cases[patientId]) return Promise.resolve(S.cases[patientId]);
    return fetchJson('/api/splose/cases?patientId=' + encodeURIComponent(patientId)).then(function (r) {
      var list = r.ok ? (r.json.data || []) : [];
      S.cases[patientId] = list;
      return list;
    });
  }

  // Session type → the Splose service the practice actually uses for it.
  var SERVICE_HINT = {
    initial: /initial/i, therapy: /^therapy session/i, assessment: /^assessment session/i, mdt: /mdt/i,
  };
  function defaultServiceId(change) {
    if (change.payload.serviceId) return change.payload.serviceId;
    var hint = SERVICE_HINT[change.payload.sessionType];
    if (!hint || !S.services) return null;
    var hit = S.services.find(function (s) { return hint.test(s.name || ''); });
    return hit ? hit.id : null;
  }

  // ── Button in the calendar bar ────────────────────────────────────────────

  function ensureButton() {
    var bar = doc.querySelector('#view-calendar .cal-topbar');
    if (!bar || doc.getElementById('splose-sync-btn')) return;
    var btn = doc.createElement('button');
    btn.id = 'splose-sync-btn';
    btn.className = 'splose-sync-btn';
    btn.type = 'button';
    btn.title = 'Review the changes waiting to be written to Splose';
    btn.setAttribute('data-help', 'cal-splose-sync');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span class="lbl">Sync Splose</span><span class="cnt" hidden>0</span>';
    btn.addEventListener('click', function () { openPanel(); });
    var legend = doc.getElementById('cal-legend-wrap');
    if (legend && legend.parentElement === bar) bar.insertBefore(btn, legend); else bar.appendChild(btn);
  }

  function renderButton() {
    ensureButton();
    var btn = doc.getElementById('splose-sync-btn');
    if (!btn) return;
    btn.hidden = !canUse();
    var n = S.pending.filter(function (c) { return c.status !== 'publishing'; }).length;
    var cnt = btn.querySelector('.cnt');
    cnt.textContent = String(n);
    cnt.hidden = n === 0;
    btn.classList.toggle('has-pending', n > 0);
    btn.classList.toggle('publishing', !!S.publishing);
    btn.querySelector('.lbl').textContent = S.publishing ? 'Syncing…' : 'Sync Splose';
  }

  // ── Tile decoration ───────────────────────────────────────────────────────

  function decorateTiles() {
    var sessions = global.SESSIONS || {};
    Object.keys(sessions).forEach(function (k) {
      var s = sessions[k];
      if (!s || !s.element) return;
      var row = s.dbId ? S.pendingByEvent[s.dbId] : null;
      s.element.classList.toggle('splose-unsynced', !!row);
      var chip = s.element.querySelector('.splose-chip');
      if (row && !chip) {
        chip = doc.createElement('span');
        chip.className = 'splose-chip';
        s.element.appendChild(chip);
      }
      if (chip) {
        if (!row) { chip.remove(); return; }
        // Write only on change (10 Oct 2026). A same-text textContent write
        // still replaces the text node, a childList mutation in #cal-grid, and
        // the grid observer in boot() answers every one with another pass here:
        // a permanent ~8 Hz redecorate loop while any tile had a pending row.
        var glyph = row.status === 'failed' ? '!' : '↑';
        if (chip.textContent !== glyph) chip.textContent = glyph;
        var tip = row.status === 'failed' ? ('Splose sync failed: ' + (row.error || ''))
          : (S.autoSync && !needsReview(row)) ? ('Writing to Splose shortly — ' + row.action)
          : ('Not yet in Splose — ' + row.action);
        if (chip.title !== tip) chip.title = tip;
        chip.classList.toggle('failed', row.status === 'failed');
      }
    });
  }

  // ── Review panel ──────────────────────────────────────────────────────────

  function ensurePanel() {
    var p = doc.getElementById('splose-sync-panel');
    if (p) return p;
    p = doc.createElement('div');
    p.id = 'splose-sync-panel';
    p.className = 'splose-sync-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-labelledby', 'splose-sync-title');
    p.hidden = true;
    p.innerHTML =
      '<div class="ssp-backdrop"></div>' +
      '<div class="ssp-card">' +
        '<header class="ssp-head"><div><div class="ssp-eyebrow">Splose</div><h2 id="splose-sync-title">Changes waiting to be written to Splose</h2></div>' +
        '<button type="button" class="ssp-close" aria-label="Close">×</button></header>' +
        '<div class="ssp-body"></div>' +
        '<footer class="ssp-foot"></footer>' +
      '</div>';
    doc.body.appendChild(p);
    p.querySelector('.ssp-close').addEventListener('click', closePanel);
    p.querySelector('.ssp-backdrop').addEventListener('click', closePanel);
    p.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    return p;
  }

  function openPanel() {
    if (!canUse()) return;
    S.panelOpen = true;
    var p = ensurePanel();
    p.hidden = false;
    p.querySelector('.ssp-body').innerHTML = '<div class="ssp-empty">Loading…</div>';
    Promise.all([refreshPending(), refreshStatus(), loadReference(), loadIgnored()]).then(function () {
      renderPanel();
      var first = p.querySelector('button, select, input');
      if (first) first.focus();
      loadMatches();
    });
  }
  function closePanel() {
    S.panelOpen = false;
    var p = doc.getElementById('splose-sync-panel');
    if (p) p.hidden = true;
  }

  var ACTION_LABEL = { create: 'New appointment', update: 'Moved', cancel: 'Cancelled' };
  var WRITE_OFF_REASON = 'Splose writing is switched off in this environment';

  // ── Match, link or ignore (080) ───────────────────────────────────────────
  // For every queued new appointment the server looks in the practitioner's
  // Splose diary for one that is already there (same client, same day, start
  // within ±30 min). Link adopts it (no write), Ignore drops the booking from
  // Splose sync for good, Send creates it. Link and Ignore work with writing off.

  function loadMatches() {
    var creates = S.pending.filter(function (c) { return c.action === 'create'; });
    if (!creates.length) { S.match = { state: 'ready', byRow: {} }; return Promise.resolve(); }
    S.match = { state: 'loading', byRow: (S.match && S.match.byRow) || {} };
    if (S.panelOpen) renderPanel();
    return fetchJson('/api/splose-sync/matches').then(function (r) {
      if (!r.ok) S.match = { state: 'error', error: r.json.error || 'Could not check Splose', byRow: {} };
      else S.match = { state: 'ready', byRow: r.json.matches || {}, windowMinutes: r.json.windowMinutes };
    }).catch(function () {
      S.match = { state: 'error', error: 'Could not reach the portal to check Splose', byRow: {} };
    }).then(function () { if (S.panelOpen && !S.publishing) renderPanel(); });
  }

  function loadIgnored() {
    return fetchJson('/api/splose-sync/ignored').then(function (r) {
      if (!r.ok) return;
      S.ignored = r.json.events || [];
      S.ignoredCanUndo = r.json.canUndo === true;
    }).catch(function () {});
  }

  function matchesFor(id) {
    return (S.match && S.match.state === 'ready' && S.match.byRow[id]) || null;
  }
  function exactSingles() {
    return S.pending.filter(function (c) {
      var m = c.action === 'create' ? matchesFor(c.id) : null;
      return m && m.length === 1 && m[0].confidence === 'exact';
    });
  }
  // A create that looks like it is already in Splose starts unticked: sending
  // it would make a duplicate.
  function isPicked(c) {
    if (Object.prototype.hasOwnProperty.call(S.picked, c.id)) return S.picked[c.id];
    var m = c.action === 'create' ? matchesFor(c.id) : null;
    return !(m && m.length);
  }
  function describeMatch(m) {
    var bits = [fmtTimeOnly(m.start)];
    if (m.serviceName) bits.push(m.serviceName);
    var s = bits.join(' ') + (m.patientName ? ' with ' + m.patientName : '');
    if (m.locationName) s += ' · ' + m.locationName;
    return s;
  }

  function renderMatch(c) {
    var st = S.match ? S.match.state : 'idle';
    if (st === 'loading' || st === 'idle') return '<div class="ssp-match checking">Checking Splose for this appointment…</div>';
    if (st === 'error') return '<div class="ssp-match err">Could not check Splose: ' + esc(S.match.error) + '</div>';
    var list = matchesFor(c.id) || [];
    if (!list.length) return '<div class="ssp-match none">No match found in Splose</div>';
    return '<div class="ssp-match found"><ul class="ssp-cands">' + list.map(function (m) {
      return '<li><span class="ssp-conf ' + esc(m.confidence) + '">' + (m.confidence === 'exact' ? 'Already in Splose' : 'Possibly in Splose') + '</span> ' +
        '<span class="ssp-cand-text">' + esc(describeMatch(m)) + (m.confidence === 'likely' && m.minutesApart ? ' <span class="ssp-hint">(' + esc(m.minutesApart) + ' min apart)</span>' : '') + '</span> ' +
        '<button type="button" class="btn small" data-link="' + esc(c.id) + '" data-appt="' + esc(m.sploseAppointmentId) + '">Link</button></li>';
    }).join('') + '</ul></div>';
  }

  function renderIgnored() {
    var list = S.ignored || [];
    if (!list.length) return '';
    return '<details class="ssp-ignored"' + (S.showIgnored ? ' open' : '') + '><summary>Ignored <span class="n">' + list.length + '</span></summary>' +
      '<p class="ssp-hint">These bookings stay in the portal and are never sent to Splose or asked about again.' +
      (S.ignoredCanUndo ? '' : ' Only an Owner or Admin can undo an ignore.') + '</p>' +
      '<ul class="ssp-list">' + list.map(function (e) {
        return '<li class="ssp-row ign"><span></span><div class="ssp-main"><div class="ssp-title">' + esc(e.title || 'Appointment') +
          (e.clientName ? ' <span class="who">' + esc(e.clientName) + '</span>' : '') + '</div>' +
          '<div class="ssp-when">' + esc(fmtPerth(e.start)) + '</div></div>' +
          (S.ignoredCanUndo ? '<button type="button" class="ssp-discard" data-unignore="' + esc(e.eventId) + '">Undo ignore</button>' : '<span></span>') +
          '</li>';
      }).join('') + '</ul></details>';
  }

  function wireIgnored(body) {
    var det = body.querySelector('.ssp-ignored');
    if (det) det.addEventListener('toggle', function () { S.showIgnored = det.open; });
    body.querySelectorAll('[data-unignore]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        fetchJson('/api/splose-sync/ignored/' + encodeURIComponent(b.getAttribute('data-unignore')) + '/undo', { method: 'POST', body: {} }).then(function (r) {
          if (!r.ok) { b.disabled = false; toast(r.json.error || 'Could not undo the ignore', true); return; }
          toast(r.json.queued ? 'Ignore undone — the booking is waiting for Splose again' : 'Ignore undone');
          return Promise.all([refreshPending(), loadIgnored()]).then(function () { renderPanel(); loadMatches(); });
        });
      });
    });
  }

  function afterResolve(msg) {
    toast(msg);
    return Promise.all([refreshPending(), loadIgnored()]).then(function () {
      if (S.panelOpen) renderPanel();
      if (typeof global.loadOutlookEventsToCalendar === 'function') { try { global.loadOutlookEventsToCalendar(); } catch (e) {} }
    });
  }

  function linkOne(queueId, apptId, btn) {
    if (btn) btn.disabled = true;
    return fetchJson('/api/splose-sync/pending/' + encodeURIComponent(queueId) + '/link', { method: 'POST', body: { sploseAppointmentId: apptId } }).then(function (r) {
      if (!r.ok) { if (btn) btn.disabled = false; toast(r.json.error || 'Could not link', true); return; }
      delete S.picked[queueId];
      return afterResolve('Linked to the Splose appointment — nothing was written to Splose');
    });
  }

  function linkAllExact() {
    var n = exactSingles().length;
    if (!n) return Promise.resolve();
    return confirmDialog('Link ' + n + ' booking' + (n === 1 ? '' : 's') + ' to the matching appointment' + (n === 1 ? '' : 's') + ' already in Splose? Nothing is written to Splose; later changes in the portal will update those appointments.', { title: 'Link exact matches', ok: 'Link ' + n })
      .then(function (yes) {
        if (!yes) return;
        return fetchJson('/api/splose-sync/link-matches', { method: 'POST', body: {} }).then(function (r) {
          if (!r.ok) { toast(r.json.error || 'Could not link', true); return; }
          var k = (r.json.linked || []).length, s = (r.json.skipped || []).length;
          return afterResolve(k + ' linked' + (s ? ' · ' + s + ' left for review (Splose changed since the check)' : '')).then(loadMatches);
        });
      });
  }

  function ignoreIds(ids) {
    if (!ids.length) { toast('Tick the new appointments to ignore first'); return Promise.resolve(); }
    var n = ids.length;
    return confirmDialog('Ignore ' + n + ' booking' + (n === 1 ? '' : 's') + ' permanently? ' + (n === 1 ? 'It stays' : 'They stay') + ' in the portal but will never be sent to Splose or asked about again. An Owner or Admin can undo this.', { title: 'Ignore permanently', ok: 'Ignore', danger: true })
      .then(function (yes) {
        if (!yes) return;
        var req = n === 1
          ? fetchJson('/api/splose-sync/pending/' + encodeURIComponent(ids[0]) + '/ignore', { method: 'POST', body: {} }).then(function (r) { return r.ok ? { ok: true, json: { ignored: [ids[0]], skipped: [] } } : r; })
          : fetchJson('/api/splose-sync/ignore', { method: 'POST', body: { queueIds: ids } });
        return req.then(function (r) {
          if (!r.ok) { toast(r.json.error || 'Could not ignore', true); return; }
          ids.forEach(function (id) { delete S.picked[id]; });
          var k = (r.json.ignored || []).length, s = (r.json.skipped || []).length;
          return afterResolve(k + ' ignored' + (s ? ' · ' + s + ' could not be (refresh and check)' : ''));
        });
      });
  }

  function pickedIds(body, action) {
    var ids = [];
    body.querySelectorAll('input[data-pick]:checked').forEach(function (i) {
      var c = S.pending.find(function (x) { return x.id === i.getAttribute('data-pick'); });
      if (c && (!action || c.action === action)) ids.push(c.id);
    });
    return ids;
  }

  function renderPanel() {
    var p = ensurePanel();
    var body = p.querySelector('.ssp-body');
    var foot = p.querySelector('.ssp-foot');
    var rows = S.pending;

    if (S.publishing) {
      var st = S.publishing;
      var pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      body.innerHTML =
        '<div class="ssp-progress"><div class="ssp-bar"><div class="ssp-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="ssp-progress-text">' + st.done + ' of ' + st.total + ' written' + (st.failed ? ' · ' + st.failed + ' failed' : '') +
        (st.current ? ' · now: ' + esc(ACTION_LABEL[st.current.action] || st.current.action) + ' — ' + esc(st.current.title || '') : '') + '</div>' +
        '<p class="ssp-note">Splose allows 60 calls a minute across the whole practice. Changes are sent one at a time with a short gap so the calendar watchers keep working. A full week for one therapist takes about a minute.</p></div>';
      foot.innerHTML = '<button type="button" class="btn" data-act="close">Keep working</button>';
      foot.querySelector('[data-act=close]').addEventListener('click', closePanel);
      return;
    }

    var html = '';
    if (S.lastRun && S.lastRun.results && S.lastRun.results.length) {
      var lr = S.lastRun;
      var failed = lr.results.filter(function (r) { return !r.ok; });
      html += '<div class="ssp-lastrun ' + (failed.length ? 'has-fail' : 'all-ok') + '">' +
        '<b>Last sync:</b> ' + (lr.total - lr.failed) + ' written' + (lr.failed ? ', ' + lr.failed + ' failed — still listed below' : '') +
        '</div>';
    }
    if (!S.writeEnabled) {
      html += '<div class="ssp-warn">' + esc(WRITE_OFF_REASON) + '. You can still link bookings to appointments already in Splose, or ignore them — neither writes to Splose. Sending is unavailable until the practice owner turns writing on.</div>';
    }
    if (!rows.length) {
      html += '<div class="ssp-empty">Nothing waiting. Every client appointment on your calendar is in Splose, linked or ignored.</div>';
      html += renderIgnored();
      body.innerHTML = html;
      wireIgnored(body);
      foot.innerHTML = '<button type="button" class="btn" data-act="close">Close</button>';
      foot.querySelector('[data-act=close]').addEventListener('click', closePanel);
      return;
    }

    var groups = { cancel: [], update: [], create: [] };
    rows.forEach(function (r) { (groups[r.action] || groups.create).push(r); });
    html += '<p class="ssp-intro">Tick what should go to Splose now. Cancellations are sent first so their slots are free, then moves, then new appointments.</p>';
    ['cancel', 'update', 'create'].forEach(function (act) {
      var list = groups[act];
      if (!list.length) return;
      html += '<h3 class="ssp-group">' + esc(ACTION_LABEL[act]) + ' <span class="n">' + list.length + '</span></h3>';
      if (act === 'create') html += renderCreateSummary(list);
      html += '<ul class="ssp-list">';
      list.forEach(function (c) {
        var when = fmtPerth(c.start) + (c.end ? ' – ' + fmtTimeOnly(c.end) : '');
        var who = c.clientName ? esc(c.clientName) : (c.payload.patientId ? 'Client #' + esc(c.payload.patientId) : '');
        var create = c.action === 'create';
        html += '<li class="ssp-row ' + (c.status === 'failed' ? 'failed' : '') + '" data-id="' + esc(c.id) + '">' +
          '<label class="ssp-check"><input type="checkbox"' + (isPicked(c) ? ' checked' : '') + ' data-pick="' + esc(c.id) + '" aria-label="Select ' + esc(c.title || 'appointment') + '"></label>' +
          '<div class="ssp-main"><div class="ssp-title">' + esc(c.title || 'Appointment') + (who ? ' <span class="who">' + who + '</span>' : '') + '</div>' +
          '<div class="ssp-when">' + esc(when) + '</div>' +
          (c.status === 'failed' ? '<div class="ssp-err">' + esc(c.error || 'Failed last time') + '</div>' : '') +
          (create ? renderMatch(c) : '') +
          renderRowControls(c) +
          (create ? '<div class="ssp-actions">' +
            '<button type="button" class="btn small" data-send="' + esc(c.id) + '"' + (S.writeEnabled ? '' : ' disabled title="' + esc(WRITE_OFF_REASON) + '"') + '>Send to Splose</button>' +
            '<button type="button" class="btn small" data-ignore="' + esc(c.id) + '">Ignore permanently</button>' +
          '</div>' : '') +
          '</div>' +
          (create ? '<span></span>' : '<button type="button" class="ssp-discard" data-discard="' + esc(c.id) + '" title="Drop this change from the queue (the calendar keeps it)">Discard</button>') +
          '</li>';
      });
      html += '</ul>';
    });
    html += renderIgnored();
    body.innerHTML = html;

    // Keep ticks and chosen services across re-renders (the match check re-renders).
    body.querySelectorAll('input[data-pick]').forEach(function (i) {
      i.addEventListener('change', function () { S.picked[i.getAttribute('data-pick')] = i.checked; });
    });
    body.querySelectorAll('select[data-service]').forEach(function (sel) {
      var id = sel.getAttribute('data-service');
      if (S.svcChoice[id]) sel.value = S.svcChoice[id];
      sel.addEventListener('change', function () { S.svcChoice[id] = sel.value; });
    });
    body.querySelectorAll('[data-discard]').forEach(function (b) {
      b.addEventListener('click', function () { discardChange(b.getAttribute('data-discard')); });
    });
    body.querySelectorAll('[data-link]').forEach(function (b) {
      b.addEventListener('click', function () { linkOne(b.getAttribute('data-link'), b.getAttribute('data-appt'), b); });
    });
    body.querySelectorAll('[data-ignore]').forEach(function (b) {
      b.addEventListener('click', function () { ignoreIds([b.getAttribute('data-ignore')]); });
    });
    body.querySelectorAll('[data-send]').forEach(function (b) {
      b.addEventListener('click', function () { publishSelected({ ids: [b.getAttribute('data-send')] }); });
    });
    var bl = body.querySelector('[data-bulk=link]');
    if (bl) bl.addEventListener('click', function () { linkAllExact(); });
    var bi = body.querySelector('[data-bulk=ignore]');
    if (bi) bi.addEventListener('click', function () { ignoreIds(pickedIds(body, 'create')); });
    var br = body.querySelector('[data-bulk=retry]');
    if (br) br.addEventListener('click', function () { loadMatches(); });
    wireIgnored(body);
    // Case chooser for creates that have none yet
    rows.filter(function (c) { return c.action === 'create' && !c.payload.caseId && c.payload.patientId; }).forEach(function (c) {
      casesFor(c.payload.patientId).then(function (list) {
        var sel = body.querySelector('select[data-case="' + c.id + '"]');
        if (!sel) return;
        var live = list.filter(function (k) { return !k.archived; });
        if (live.length <= 1) { sel.closest('.ssp-field').hidden = true; return; }
        sel.innerHTML = '<option value="">Choose a case…</option>' + live.map(function (k) {
          return '<option value="' + esc(k.id) + '">' + esc(k.name || k.title || ('Case #' + k.id)) + (k.status ? ' · ' + esc(k.status) : '') + '</option>';
        }).join('');
        sel.closest('.ssp-field').hidden = false;
      });
    });

    foot.innerHTML =
      '<button type="button" class="btn" data-act="close">Not now</button>' +
      '<span class="spacer"></span>' +
      (S.writeEnabled ? '' : '<span class="ssp-hint ssp-off">' + esc(WRITE_OFF_REASON) + '</span>') +
      '<button type="button" class="btn primary" data-act="publish"' + (S.writeEnabled ? '' : ' disabled title="' + esc(WRITE_OFF_REASON) + '"') + '>Send selected to Splose</button>';
    foot.querySelector('[data-act=close]').addEventListener('click', closePanel);
    foot.querySelector('[data-act=publish]').addEventListener('click', function () { publishSelected(); });
  }

  function renderCreateSummary(list) {
    var st = S.match ? S.match.state : 'idle';
    var counts = '';
    if (st === 'ready') {
      var exact = 0, likely = 0, none = 0;
      list.forEach(function (c) {
        var m = matchesFor(c.id) || [];
        if (!m.length) none++; else if (m[0].confidence === 'exact') exact++; else likely++;
      });
      counts = '<div class="ssp-counts">' + exact + ' already in Splose · ' + likely + ' possible match' + (likely === 1 ? '' : 'es') + ' · ' + none + ' not found</div>';
    } else if (st === 'error') {
      counts = '<div class="ssp-counts err">Could not check Splose: ' + esc(S.match.error) + ' <button type="button" class="btn small" data-bulk="retry">Try again</button></div>';
    } else {
      counts = '<div class="ssp-counts checking" role="status">Checking Splose for appointments that already exist…</div>';
    }
    var n = st === 'ready' ? exactSingles().length : 0;
    return counts + '<div class="ssp-bulk">' +
      '<button type="button" class="btn small" data-bulk="link"' + (n ? '' : ' disabled') + '>Link all exact matches (' + n + ')</button>' +
      '<button type="button" class="btn small" data-bulk="ignore">Ignore selected</button>' +
      '</div>';
  }

  function renderRowControls(c) {
    if (c.action === 'create') {
      var svc = S.services || [];
      var chosen = defaultServiceId(c);
      var html = '<div class="ssp-field"><label>Service <select data-service="' + esc(c.id) + '">' +
        '<option value="">Choose a service…</option>' +
        svc.map(function (s) { return '<option value="' + esc(s.id) + '"' + (String(s.id) === String(chosen) ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
        '</select></label></div>';
      if (!c.payload.caseId) html += '<div class="ssp-field" hidden><label>Case <select data-case="' + esc(c.id) + '"></select></label></div>';
      return html;
    }
    if (c.action === 'cancel') {
      var rs = S.reasons || [];
      var def = c.payload.reasonId || (rs.find(function (r) { return /^other$/i.test(r.reason); }) || {}).id;
      return '<div class="ssp-field"><label>Reason <select data-reason="' + esc(c.id) + '">' +
        rs.map(function (r) { return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(def) ? ' selected' : '') + '>' + esc(r.reason) + '</option>'; }).join('') +
        '</select></label><span class="ssp-hint">The reason drives short-notice charging in Splose.</span></div>';
    }
    return '';
  }

  function discardChange(id) {
    confirmDialog('Drop this change from the Splose queue? The calendar keeps what you did; Splose simply will not hear about it.', { title: 'Discard change', ok: 'Discard', danger: true })
      .then(function (yes) {
        if (!yes) return;
        return fetchJson('/api/splose-sync/pending/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
          if (!r.ok) { toast(r.json.error || 'Could not discard', true); return; }
          return refreshPending();
        });
      });
  }

  function collectOverrides(body, ids) {
    var overrides = {};
    ids.forEach(function (id) {
      var o = {};
      var s = body.querySelector('select[data-service="' + id + '"]'); if (s && s.value) o.serviceId = s.value;
      var k = body.querySelector('select[data-case="' + id + '"]');    if (k && k.value) o.caseId = k.value;
      var r = body.querySelector('select[data-reason="' + id + '"]');  if (r && r.value) o.reasonId = r.value;
      overrides[id] = o;
    });
    return overrides;
  }

  function publishSelected(opts) {
    opts = opts || {};
    var p = ensurePanel();
    var body = p.querySelector('.ssp-body');
    if (!S.writeEnabled) { toast(WRITE_OFF_REASON, true); return Promise.resolve(); }
    var ids = [];
    body.querySelectorAll('input[data-pick]:checked').forEach(function (i) { ids.push(i.getAttribute('data-pick')); });
    if (opts.all) ids = S.pending.map(function (c) { return c.id; });
    if (opts.ids) ids = opts.ids.slice();
    if (!ids.length) { toast('Nothing ticked'); return Promise.resolve(); }
    var overrides = collectOverrides(body, ids);
    // A new appointment cannot go without a service.
    var missing = ids.filter(function (id) {
      var c = S.pendingByEvent[(S.pending.find(function (x) { return x.id === id; }) || {}).eventId];
      return c && c.action === 'create' && !(overrides[id] && overrides[id].serviceId) && !defaultServiceId(c);
    });
    if (missing.length) { toast('Choose a service for every new appointment first', true); return Promise.resolve(); }
    // Fill defaults for creates we could infer.
    ids.forEach(function (id) {
      var c = S.pending.find(function (x) { return x.id === id; });
      if (c && c.action === 'create' && !overrides[id].serviceId) overrides[id].serviceId = defaultServiceId(c);
    });
    var cancels = ids.filter(function (id) { var c = S.pending.find(function (x) { return x.id === id; }); return c && c.action === 'cancel'; });
    var go = cancels.length
      ? confirmDialog(cancels.length + ' cancellation' + (cancels.length === 1 ? '' : 's') + ' will be sent to Splose. Cancelling there may trigger a short-notice charge and a client message. Continue?', { title: 'Confirm cancellations', ok: 'Send', danger: true })
      : Promise.resolve(true);
    // Sending a booking Splose already holds makes a duplicate: say so first.
    var dupes = ids.filter(function (id) { var m = matchesFor(id); return m && m.length; });
    if (dupes.length) {
      go = go.then(function (yes) {
        if (!yes) return false;
        return confirmDialog(dupes.length + ' of these look' + (dupes.length === 1 ? 's' : '') + ' already in Splose. Sending creates a second appointment there — use Link instead unless you are sure. Send anyway?', { title: 'Possible duplicates', ok: 'Send anyway', danger: true });
      });
    }
    return go.then(function (yes) {
      if (!yes) return;
      return fetchJson('/api/splose-sync/publish', { method: 'POST', body: { queueIds: ids, overrides: overrides } }).then(function (r) {
        if (!r.ok) { toast(r.json.error || 'Could not start the sync', true); return; }
        S.publishing = { total: ids.length, done: 0, failed: 0, current: null };
        renderButton(); if (S.panelOpen) renderPanel();
        return watchPublish();
      });
    });
  }

  function watchPublish() {
    if (S.watching) return Promise.resolve();
    S.watching = true;
    return new Promise(function (resolve) {
      var tick = function () {
        refreshStatus().then(function (st) {
          if (st && st.running) { if (S.panelOpen) renderPanel(); renderButton(); setTimeout(tick, 1200); return; }
          S.publishing = null;
          refreshPending().then(function () {
            renderButton();
            if (S.panelOpen) renderPanel();
            if (S.lastRun) {
              var ok = S.lastRun.total - S.lastRun.failed;
              toast(ok + ' change' + (ok === 1 ? '' : 's') + ' written to Splose' + (S.lastRun.failed ? ' · ' + S.lastRun.failed + ' failed' : ''), S.lastRun.failed > 0);
            }
            if (typeof global.loadOutlookEventsToCalendar === 'function') { try { global.loadOutlookEventsToCalendar(); } catch (e) {} }
            S.watching = false;
            resolve();
          });
        });
      };
      setTimeout(tick, 800);
    });
  }

  // A queued row the server will not write on its own: it failed once, or it
  // is a new booking that still needs a service chosen in the review list.
  function needsReview(row) {
    if (!row) return false;
    if (row.status === 'failed') return true;
    if (row.action === 'create') {
      var p = row.payload || {};
      return !(p.patientId && p.serviceId);
    }
    return false;
  }

  // ── Instant count ─────────────────────────────────────────────────────────
  // Every booking, cancellation or Splose-side answer ends by reloading the
  // calendar. Refresh the queue right after, so the Sync Splose count and the
  // tile markers change with the calendar instead of on the next 60 s poll.
  function installReloadHook() {
    if (global.__sploseSyncReloadHook) return;
    global.__sploseSyncReloadHook = true;
    var orig = global.loadOutlookEventsToCalendar;
    if (typeof orig !== 'function') return;
    global.loadOutlookEventsToCalendar = function () {
      var out = orig.apply(this, arguments);
      var after = function () { refreshPending(); };
      if (out && typeof out.then === 'function') out.then(after, after); else setTimeout(after, 0);
      return out;
    };
  }

  // ── Making a move real ────────────────────────────────────────────────────

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function perthYmdOf(iso) {
    var t = new Date(iso).getTime() + 8 * 3600000;
    var d = new Date(t);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  function shiftYmd(ymd, days) {
    var d = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2] + days));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function perthIso(ymd, h, m) {
    return ymd[0] + '-' + pad(ymd[1]) + '-' + pad(ymd[2]) + 'T' + pad(h) + ':' + pad(m) + ':00+08:00';
  }

  function installMovePersist() {
    if (global.__sploseSyncMovePersist) return;
    global.__sploseSyncMovePersist = true;
    var origCommit = global.commitMove;
    if (typeof origCommit !== 'function') return;
    global.commitMove = function () {
      var pm = global.pendingMove;
      var before = pm && global.SESSIONS ? global.SESSIONS[pm.id] : null;
      var snapshot = before ? { day: before.day, iso: before.startTimeIso, dbId: before.dbId, type: before.type, cancelled: before.cancelled } : null;
      var out = origCommit.apply(this, arguments);
      if (!snapshot || !snapshot.dbId || !pm) return out;
      try {
        var s = global.SESSIONS[pm.id];
        var origIdx = DAYS.indexOf(snapshot.day), newIdx = DAYS.indexOf(s.day);
        var baseYmd = snapshot.iso ? perthYmdOf(snapshot.iso) : null;
        if (!baseYmd || origIdx < 0 || newIdx < 0) return out;
        var ymd = shiftYmd(baseYmd, newIdx - origIdx);
        var startIso = perthIso(ymd, s.startH, s.startM || 0);
        var endIso = perthIso(ymd, s.endH, s.endM || 0);
        s.startTimeIso = new Date(startIso).toISOString();
        s.endTimeIso = new Date(endIso).toISOString();
        // The save is handed back on the move (pm.persisted) so a caller that
        // moves several blocks at once (Make room, travel.js) can wait for
        // them; pm.quiet leaves the one summary toast to that caller.
        pm.persisted = fetchJson('/api/outlook/events/' + encodeURIComponent(snapshot.dbId), { method: 'PATCH', body: { startTime: startIso, endTime: endIso } })
          .then(function (r) {
            if (!r.ok) {
              toast(r.json.error || 'The move could not be saved', true);
              if (typeof global.loadOutlookEventsToCalendar === 'function') global.loadOutlookEventsToCalendar();
              return r;
            }
            if (pm.quiet) { refreshPending(); return r; }
            var tail = S.autoSync ? 'Splose will follow shortly.' : 'Sync Splose when the week is right.';
            // Say what actually happened to Outlook (10 Oct 2026): with write-back
            // off, or on a portal-only row, nothing will "catch up".
            var os = r.json.outlookStatus;
            toast(r.json.savedToOutlook ? 'Moved — Outlook updated. ' + tail
              : os === 'disabled' ? 'Moved — saved in the portal (Outlook write-back is off). ' + tail
              : os === 'not_linked' ? 'Moved — saved. ' + tail
              : 'Moved — saved. Outlook will catch up; ' + tail);
            refreshPending();
            return r;
          });
      } catch (e) { /* the visual move already happened; nothing else to undo */ }
      return out;
    };
  }

  // ── Changes made inside Splose ────────────────────────────────────────────

  var KIND_TEXT = {
    cancelled: 'was cancelled in Splose',
    moved: 'was moved in Splose',
    deleted: 'was deleted in Splose',
    created: 'was booked directly in Splose',
    unlinked: 'is in the portal but was never written to Splose',
  };

  function pollAlerts() {
    if (!canUse() || doc.hidden) return Promise.resolve();
    return fetchJson('/api/splose-sync/alerts').then(function (r) {
      if (!r.ok) return;
      var seen = {};
      S.alertQueue.forEach(function (a) { seen[a.id] = true; });
      (r.json.alerts || []).forEach(function (a) { if (!seen[a.id]) S.alertQueue.push(a); });
      showNextAlert();
    }).catch(function () {});
  }

  function ensureAlertBox() {
    var b = doc.getElementById('splose-alert-box');
    if (b) return b;
    b = doc.createElement('div');
    b.id = 'splose-alert-box';
    b.className = 'splose-alert';
    b.setAttribute('role', 'alertdialog');
    b.setAttribute('aria-labelledby', 'splose-alert-title');
    b.hidden = true;
    doc.body.appendChild(b);
    return b;
  }

  function showNextAlert() {
    if (S.alertShowing || !S.alertQueue.length) return;
    var a = S.alertQueue.shift();
    S.alertShowing = true;
    var b = ensureAlertBox();
    var d = a.details || {};
    var when = a.kind === 'moved'
      ? 'From ' + fmtPerth(d.from && d.from.start) + ' to <b>' + esc(fmtPerth(d.to && d.to.start)) + '</b>'
      : fmtPerth(d.start || (d.from && d.from.start));
    var unlinked = a.kind === 'unlinked';
    b.innerHTML =
      '<div class="sa-backdrop"></div><div class="sa-card">' +
      '<div class="sa-eyebrow">' + (unlinked ? 'Out of step with Splose' : 'Change made in Splose') + '</div>' +
      '<h2 id="splose-alert-title">' + esc(a.title || 'A client appointment') + ' ' + esc(KIND_TEXT[a.kind] || 'changed in Splose') + '</h2>' +
      '<div class="sa-when">' + when + (d.reason ? ' · reason: ' + esc(d.reason) : '') + '</div>' +
      (unlinked
        ? '<p class="sa-rule">This booking exists only in the portal: nothing is queued for it and Splose has no appointment. Should it be written to Splose?</p>'
        : '<p class="sa-rule">Bookings are made and changed in the portal, not in Splose. The portal only found this out by checking. Was this change meant to happen?</p>') +
      '<div class="sa-actions">' +
        '<button type="button" class="btn" data-verdict="invalid">' + (unlinked ? 'Leave it portal-only' : 'No — it was a mistake') + '</button>' +
        '<button type="button" class="btn primary" data-verdict="valid">' + (unlinked ? 'Queue it for Splose' : 'Yes — apply it to the calendar') + '</button>' +
      '</div>' +
      '<div class="sa-foot">' + (unlinked
        ? 'Queue: it joins the changes waiting to be written and syncs like any booking (a service may need choosing). Leave: it stays a portal-only block and is not asked about again.'
        : 'Yes: the portal and Outlook are updated to match Splose. No: the portal keeps its own copy, the owner is told, and the correction is made in Splose.') + '</div>' +
      '</div>';
    b.hidden = false;
    b.querySelectorAll('[data-verdict]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        fetchJson('/api/splose-sync/alerts/' + encodeURIComponent(a.id) + '/ack', { method: 'POST', body: { verdict: btn.getAttribute('data-verdict') } })
          .then(function (r) {
            if (!r.ok) toast(r.json.error || 'Could not record your answer', true);
            else if (r.json.verdict === 'valid') {
              toast('Calendar updated to match Splose');
              if (typeof global.loadOutlookEventsToCalendar === 'function') { try { global.loadOutlookEventsToCalendar(); } catch (e) {} }
            } else toast('Noted. Please correct it in Splose so the systems agree.');
            b.hidden = true;
            S.alertShowing = false;
            showNextAlert();
          });
      });
    });
    var first = b.querySelector('[data-verdict=valid]');
    if (first) first.focus();
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    var u = global.APP_USER;
    if (!u) { setTimeout(boot, 400); return; }
    if (u.role === 'read_only' || u.role === 'pre_employee') return;
    fetchJson('/api/splose/sync-status').then(function (r) {
      S.enabled = !!(r.ok && r.json.draftSyncEnabled === true);
      if (!S.enabled) return;
      installMovePersist();
      installReloadHook();
      ensureButton();
      refreshStatus().then(function (st) { if (st && st.running) watchPublish(); });
      refreshPending();
      pollAlerts();
      // Modest polling, paused while hidden: pending every 60 s, alerts every 2 min.
      // The status poll also catches an automatic run the server started on
      // its own, so the tiles and the count update when it finishes.
      S.pollTimer = setInterval(function () {
        if (doc.hidden) return;
        refreshPending();
        refreshStatus().then(function (st) { if (st && st.running) watchPublish(); });
      }, 60000);
      setInterval(function () { pollAlerts(); }, 120000);
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { refreshPending(); pollAlerts(); } });
      // Re-decorate whenever the grid is repainted.
      var grid = doc.getElementById('cal-grid');
      if (grid && global.MutationObserver) {
        var pendingDecor = null;
        new MutationObserver(function () {
          if (pendingDecor) return;
          pendingDecor = setTimeout(function () { pendingDecor = null; decorateTiles(); }, 120);
        }).observe(grid, { childList: true, subtree: true });
      }
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();

  global.SploseSync = {
    open: openPanel, close: closePanel, refresh: refreshPending, publishAll: function () { return openPanel(); },
    _state: S,
  };
})(window);
